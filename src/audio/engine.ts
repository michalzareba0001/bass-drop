import { clamp, defaultParams, mtof, type ParamKey, type Params } from './params'
import { drums } from './drums'
import { mixer } from './mixer'
import { hold, KNOB_SMOOTH } from './util'

interface Voice {
  o1: OscillatorNode
  o2: OscillatorNode
  g1: GainNode
  g2: GainNode
  amp: GainNode
  fr: AudioParam[]
  midi: number
  offAt: number | null
  stop(at: number): void
}

function driveCurve(d: number) {
  const k = 0.01 + d * 40
  const n = 2048
  const c = new Float32Array(n)
  const t = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(k * x) / t
  }
  return c
}

/** Linear up to 0.8, then bends smoothly toward 0.98. */
function softClipCurve() {
  const n = 4096
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 1.5
    const a = Math.abs(x)
    const y = a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18)
    c[i] = Math.sign(x) * y
  }
  return c
}

/**
 * Audio graph:
 *   synth voice → shaper → filter → synthOut → [mixer: Bas]   ─┐
 *   drum voices ─────────────────────────────→ [mixer: Bębny] ─┤
 *   pad voices ──────────────────────────────→ [mixer: Pad N] ─┼→ mix → master → limiter → soft clip → analyser → speakers
 *   clip previews ───────────────────────────→ previewBus ─────┘
 * The kick ducks the sidechained mixer channels. The recorder taps the soft-clip output (or the microphone).
 */
class Engine {
  ctx: AudioContext | null = null
  P: Params = defaultParams()
  voice: Voice | null = null
  pbCents = 0

  shaper!: WaveShaperNode
  filt!: BiquadFilterNode
  synthOut!: GainNode
  previewBus!: GainNode
  mix!: GainNode
  master!: GainNode
  limiter!: DynamicsCompressorNode
  /** final soft clip; never exceeds ±0.98. The recorder taps this node. */
  out!: WaveShaperNode
  analyser!: AnalyserNode
  private lfo!: OscillatorNode
  private lfoGain!: GainNode
  private noiseBuf!: AudioBuffer
  private readyCbs: ((ctx: AudioContext) => void)[] = []

  onReady(cb: (ctx: AudioContext) => void) {
    if (this.ctx) cb(this.ctx)
    else this.readyCbs.push(cb)
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running'
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0
  }

  ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
      return this.ctx
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.shaper = ctx.createWaveShaper()
    this.shaper.oversample = '4x'
    this.filt = ctx.createBiquadFilter()
    this.filt.type = 'lowpass'
    this.synthOut = ctx.createGain()
    this.synthOut.gain.value = 0.72 // headroom so the Bas channel peaks below 0 dBFS
    this.previewBus = ctx.createGain()
    this.mix = ctx.createGain()
    this.mix.gain.value = 0.6 // bass + drums + pads summed: leave room before the limiter
    this.master = ctx.createGain()
    this.limiter = ctx.createDynamicsCompressor()
    // Web Audio compressors add automatic make-up gain; a high threshold keeps it a peak catcher only
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.out = ctx.createWaveShaper()
    this.out.curve = softClipCurve()
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.12
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 16384
    this.analyser.smoothingTimeConstant = 0.6

    mixer.init(ctx, this.mix)
    drums.init(ctx, mixer.input('drums'))
    this.shaper.connect(this.filt).connect(this.synthOut).connect(mixer.input('bass'))
    this.previewBus.connect(this.mix)
    this.mix.connect(this.master).connect(this.limiter).connect(this.out).connect(this.analyser).connect(ctx.destination)

    this.lfo = ctx.createOscillator()
    this.lfoGain = ctx.createGain()
    this.lfo.connect(this.lfoGain).connect(this.filt.frequency)
    this.lfo.start()

    this.noiseBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

    for (const k of Object.keys(this.P) as ParamKey[]) this.apply(k)
    window.setInterval(() => this.gc(), 150)
    const cbs = this.readyCbs
    this.readyCbs = []
    cbs.forEach((cb) => cb(ctx))
    return ctx
  }

  setParams(p: Params) {
    this.P = { ...p }
    if (this.ctx) for (const k of Object.keys(p) as ParamKey[]) this.apply(k)
  }

  setParam(k: ParamKey, v: number) {
    this.P[k] = v
    this.apply(k)
  }

  private apply(k: ParamKey) {
    if (!this.ctx) return
    const P = this.P
    const now = this.ctx.currentTime
    switch (k) {
      case 'drive':
        this.shaper.curve = driveCurve(P.drive)
        break
      case 'cutoff':
        this.filt.frequency.cancelScheduledValues(now)
        this.filt.frequency.setTargetAtTime(P.cutoff, now, KNOB_SMOOTH)
        this.lfoGain.gain.setTargetAtTime(P.lfoDepth * P.cutoff * 0.9, now, KNOB_SMOOTH)
        break
      case 'res':
        this.filt.Q.setTargetAtTime(P.res, now, KNOB_SMOOTH)
        break
      case 'volume':
        this.master.gain.setTargetAtTime(P.volume, now, KNOB_SMOOTH)
        break
      case 'lfoRate':
        this.lfo.frequency.setTargetAtTime(P.lfoRate, now, KNOB_SMOOTH)
        break
      case 'lfoDepth':
        this.lfoGain.gain.setTargetAtTime(P.lfoDepth * P.cutoff * 0.9, now, KNOB_SMOOTH)
        break
      case 'shape':
        if (this.voice) {
          this.voice.g1.gain.setTargetAtTime(1 - P.shape * 0.6, now, KNOB_SMOOTH)
          this.voice.g2.gain.setTargetAtTime(P.shape * 0.55, now, KNOB_SMOOTH)
        }
        break
    }
  }

  /**
   * True while the voice still holds its note at time t. A note-off landing exactly on t
   * still counts: with a 1-step gate the sequencer schedules the off on the very next step,
   * and a slide there must glide instead of retriggering.
   */
  private alive(t: number) {
    return !!this.voice && (this.voice.offAt == null || this.voice.offAt >= t - 0.001)
  }

  noteOn(m: number, t = this.now(), slide = false, vel = 1) {
    const ctx = this.ensure()
    const P = this.P
    const f = mtof(m)
    if (slide && this.alive(t) && this.voice) {
      const g = Math.max(0.03, P.glide)
      for (const p of this.voice.fr) {
        hold(p, t)
        p.setTargetAtTime(f, t, g / 3)
      }
      if (this.voice.offAt != null) {
        hold(this.voice.amp.gain, t)
        this.voice.offAt = null
      }
      this.voice.midi = m
      return
    }
    if (this.voice) {
      const v = this.voice
      hold(v.amp.gain, t)
      v.amp.gain.setTargetAtTime(0, t, 0.004)
      v.stop(t + 0.06)
    }
    const o1 = ctx.createOscillator()
    const o2 = ctx.createOscillator()
    o1.type = 'sine'
    o2.type = 'sawtooth'
    const g1 = ctx.createGain()
    const g2 = ctx.createGain()
    const amp = ctx.createGain()
    g1.gain.value = 1 - P.shape * 0.6
    g2.gain.value = P.shape * 0.55
    amp.gain.value = 0
    o1.connect(g1).connect(amp)
    o2.connect(g2).connect(amp)
    amp.connect(this.shaper)
    o1.detune.value = this.pbCents
    o2.detune.value = this.pbCents

    const fr = [o1.frequency, o2.frequency]
    const f0 = f * Math.pow(2, P.pitch / 12)
    for (const p of fr) {
      p.setValueAtTime(f0, t)
      p.setTargetAtTime(f, t, P.pdecay / 3)
      if (Math.round(P.bend) !== 0) {
        const tb = t + P.pdecay * 1.7
        p.setValueAtTime(f, tb)
        p.exponentialRampToValueAtTime(clamp(f * Math.pow(2, P.bend / 12), 15, 4000), tb + P.bendTime)
      }
    }
    const pk = 0.8 * vel
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(pk, t + P.attack)
    amp.gain.setTargetAtTime(pk * P.sustain, t + P.attack, P.decay / 3)

    const top = Math.min(P.cutoff * Math.pow(2, P.fenv * 5), 18000)
    hold(this.filt.frequency, t)
    this.filt.frequency.setValueAtTime(top, t)
    this.filt.frequency.setTargetAtTime(P.cutoff, t, Math.max(0.02, P.decay * 0.12))

    if (P.click > 0) {
      const ns = ctx.createBufferSource()
      ns.buffer = this.noiseBuf
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 1800
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(P.click * 0.7, t)
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02)
      ns.connect(hp).connect(ng).connect(this.shaper)
      ns.start(t)
      ns.stop(t + 0.05)
    }
    o1.start(t)
    o2.start(t)
    this.voice = {
      o1, o2, g1, g2, amp, fr, midi: m, offAt: null,
      stop(at: number) {
        try {
          o1.stop(at)
          o2.stop(at)
        } catch {
          /* already stopped */
        }
      },
    }
  }

  noteOff(t = this.now()) {
    const v = this.voice
    if (!v) return
    hold(v.amp.gain, t)
    v.amp.gain.setTargetAtTime(0, t, this.P.release / 4)
    v.offAt = t
  }

  get voiceMidi() {
    return this.voice ? this.voice.midi : null
  }

  setBend(cents: number) {
    this.pbCents = cents
    if (this.voice && this.ctx) {
      const n = this.ctx.currentTime
      this.voice.o1.detune.setTargetAtTime(cents, n, 0.008)
      this.voice.o2.detune.setTargetAtTime(cents, n, 0.008)
    }
  }

  private gc() {
    const v = this.voice
    if (v && this.ctx && v.offAt != null && this.ctx.currentTime > v.offAt + this.P.release * 1.7 + 0.05) {
      v.stop(this.ctx.currentTime)
      this.voice = null
    }
  }
}

export const engine = new Engine()
