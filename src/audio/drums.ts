import { mixer } from './mixer'
import { hold, KNOB_SMOOTH } from './util'

export type DrumId = 'kick' | 'snare' | 'clap' | 'chh' | 'ohh'

export const DRUMS: { id: DrumId; name: string; color: string }[] = [
  { id: 'kick', name: 'Stopa', color: 'var(--red)' },
  { id: 'snare', name: 'Werbel', color: 'var(--orange)' },
  { id: 'clap', name: 'Klask', color: 'var(--orange)' },
  { id: 'chh', name: 'Hi-hat zamk.', color: 'var(--yellow)' },
  { id: 'ohh', name: 'Hi-hat otw.', color: 'var(--cream)' },
]

export interface DrumVoiceCfg {
  level: number // 0..1.5
  pitch: number // semitones -12..12
  decay: number // length multiplier 0.3..3
}

export const defaultDrumCfg = (): Record<DrumId, DrumVoiceCfg> => ({
  kick: { level: 1, pitch: 0, decay: 1 },
  snare: { level: 0.8, pitch: 0, decay: 1 },
  clap: { level: 0.8, pitch: 0, decay: 1 },
  chh: { level: 0.55, pitch: 0, decay: 1 },
  ohh: { level: 0.5, pitch: 0, decay: 1 },
})

/**
 * Step values: 0 = off, 1 = hit, 2 = roll 1/32 (2 hits per step),
 * 3 = triplet roll (3 per step), 4 = roll 1/64 (4 per step).
 */
export const ROLL_LABEL: Record<number, string> = { 2: '1/32', 3: 'trioli', 4: '1/64' }

/** Synthesised 808-style drum voices. No samples. */
class Drums {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private voiceOut = new Map<DrumId, GainNode>()
  private noise: AudioBuffer | null = null
  private ohhGain: GainNode | null = null
  cfg: Record<DrumId, DrumVoiceCfg> = defaultDrumCfg()

  init(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0.65 // headroom for the Bębny channel
    this.out.connect(dest)
    for (const d of DRUMS) {
      const g = ctx.createGain()
      g.connect(this.out)
      this.voiceOut.set(d.id, g)
    }
    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const n = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) n[i] = Math.random() * 2 - 1
    this.apply()
  }

  configure(cfg: Record<DrumId, DrumVoiceCfg>) {
    this.cfg = cfg
    this.apply()
  }

  private apply() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const [id, g] of this.voiceOut) g.gain.setTargetAtTime(this.cfg[id].level, now, KNOB_SMOOTH)
  }

  trigger(id: DrumId, t: number, vel = 1) {
    if (!this.ctx) return
    const c = this.cfg[id]
    const p = Math.pow(2, c.pitch / 12)
    const d = c.decay
    const dest = this.voiceOut.get(id)!
    switch (id) {
      case 'kick':
        this.kick(t, vel, p, d, dest)
        // only a kick you can hear should pump the bass
        if (c.level > 0.01 && mixer.isAudible('drums')) mixer.duck(t)
        break
      case 'snare':
        this.snare(t, vel, p, d, dest)
        break
      case 'clap':
        this.clap(t, vel, p, d, dest)
        break
      case 'chh':
        this.choke(t)
        this.hat(t, vel, p, 0.045 * d, dest, false)
        break
      case 'ohh':
        this.choke(t)
        this.ohhGain = this.hat(t, vel, p, 0.35 * d, dest, true)
        break
    }
  }

  private noiseSrc(t: number, dur: number) {
    const ctx = this.ctx!
    const s = ctx.createBufferSource()
    s.buffer = this.noise
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.05)
    return s
  }

  private kick(t: number, v: number, p: number, d: number, dest: AudioNode) {
    const ctx = this.ctx!
    const len = 0.45 * d
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(160 * p, t)
    o.frequency.exponentialRampToValueAtTime(48 * p, t + 0.07)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(v, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.001, t + len)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + len + 0.02)
    // beater click
    const n = this.noiseSrc(t, 0.01)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 3000
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.25 * v, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.008)
    n.connect(hp).connect(ng).connect(dest)
  }

  private snare(t: number, v: number, p: number, d: number, dest: AudioNode) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(190 * p, t)
    o.frequency.exponentialRampToValueAtTime(160 * p, t + 0.05)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.55 * v, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12 * d)
    o.connect(og).connect(dest)
    o.start(t)
    o.stop(t + 0.15 * d)
    const len = 0.2 * d
    const n = this.noiseSrc(t, len)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1200 * p
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.75 * v, t)
    ng.gain.exponentialRampToValueAtTime(0.001, t + len)
    n.connect(hp).connect(ng).connect(dest)
  }

  private clap(t: number, v: number, p: number, d: number, dest: AudioNode) {
    const ctx = this.ctx!
    const len = 0.25 * d
    const n = this.noiseSrc(t, len + 0.03)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1300 * p
    bp.Q.value = 1.1
    const g = ctx.createGain()
    const gg = g.gain
    // three quick bursts, then the tail: the classic hand-clap shape
    gg.setValueAtTime(0, t)
    for (let k = 0; k < 3; k++) {
      const tk = t + k * 0.011
      gg.setValueAtTime(v * (1 - k * 0.1), tk)
      gg.exponentialRampToValueAtTime(0.06 * v, tk + 0.0095)
    }
    const tt = t + 0.033
    gg.setValueAtTime(0.9 * v, tt)
    gg.exponentialRampToValueAtTime(0.001, tt + len)
    n.connect(bp).connect(g).connect(dest)
  }

  private hat(t: number, v: number, p: number, len: number, dest: AudioNode, open: boolean) {
    const ctx = this.ctx!
    const n = this.noiseSrc(t, len)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000 * p
    const bp = ctx.createBiquadFilter()
    bp.type = 'peaking'
    bp.frequency.value = 10000 * p
    bp.gain.value = 6
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(v * (open ? 0.7 : 0.8), t + 0.001)
    g.gain.exponentialRampToValueAtTime(0.001, t + len)
    n.connect(hp).connect(bp).connect(g).connect(dest)
    return g
  }

  /** A new hat cuts off a ringing open hat, like on a real kit. */
  private choke(t: number) {
    const g = this.ohhGain
    if (!g) return
    hold(g.gain, t)
    g.gain.setTargetAtTime(0, t, 0.006)
    this.ohhGain = null
  }
}

export const drums = new Drums()
