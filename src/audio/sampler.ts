import { engine } from './engine'
import { mixer } from './mixer'

export type PadMode = 'toggle' | 'hold' | 'shot'

export interface Pad {
  clipId: string | null
  start: number // 0..1 of the clip
  end: number // 0..1 of the clip
  loop: boolean
  mode: PadMode
  pitch: number // semitones
  gain: number
  sync: boolean // start on the next beat while the pattern plays
}

export const emptyPad = (): Pad => ({
  clipId: null,
  start: 0,
  end: 1,
  loop: true,
  mode: 'toggle',
  pitch: 0,
  gain: 1,
  sync: true,
})

interface SVoice {
  src: AudioBufferSourceNode
  g: GainNode
  t0: number
  s: number
  len: number
  loop: boolean
  rate: number
  dur: number
}

type PlayOpts = Pick<Pad, 'start' | 'end' | 'loop' | 'pitch' | 'gain'>

class Sampler {
  buffers = new Map<string, AudioBuffer>()
  private voices = new Map<string, SVoice>()
  onChange: () => void = () => {}

  setClip(id: string, ch: Float32Array[], sampleRate: number) {
    const b = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate })
    ch.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i))
    this.buffers.set(id, b)
  }

  setBuffer(id: string, b: AudioBuffer) {
    this.buffers.set(id, b)
  }

  removeClip(id: string) {
    this.buffers.delete(id)
  }

  play(key: string, clipId: string, o: PlayOpts, when?: number) {
    const ctx = engine.ensure()
    const buf = this.buffers.get(clipId)
    if (!buf) return
    const t = Math.max(when ?? 0, ctx.currentTime)
    this.stop(key, t)
    const dur = buf.duration
    const s = o.start * dur
    const e = Math.max(s + 0.01, o.end * dur)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const rate = Math.pow(2, o.pitch / 12)
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.gain, t + 0.004)
    src.connect(g).connect(key.startsWith('pad') ? mixer.input(key) : engine.previewBus)
    if (o.loop) {
      src.loop = true
      src.loopStart = s
      src.loopEnd = e
      src.start(t, s)
    } else {
      src.start(t, s, e - s)
    }
    const v: SVoice = { src, g, t0: t, s, len: e - s, loop: o.loop, rate, dur }
    src.onended = () => {
      if (this.voices.get(key) === v) {
        this.voices.delete(key)
        this.onChange()
      }
    }
    this.voices.set(key, v)
    this.onChange()
  }

  /** Apply edits (trim, pitch, volume) to a voice that is already playing. */
  update(key: string, o: PlayOpts) {
    const v = this.voices.get(key)
    if (!v || !engine.ctx) return
    const now = engine.ctx.currentTime
    const s = o.start * v.dur
    const e = Math.max(s + 0.01, o.end * v.dur)
    if (v.loop) {
      v.src.loopStart = s
      v.src.loopEnd = e
    }
    const rate = Math.pow(2, o.pitch / 12)
    if (rate !== v.rate) {
      // re-anchor the playhead estimate before the rate changes
      const pos = this.positionSec(v, now)
      v.t0 = now - (pos - v.s) / rate
      v.rate = rate
      v.src.playbackRate.setValueAtTime(rate, now)
    }
    v.s = s
    v.len = e - s
    v.g.gain.setTargetAtTime(o.gain, now, 0.02)
  }

  stop(key: string, when?: number) {
    const v = this.voices.get(key)
    if (!v || !engine.ctx) return
    const t = Math.max(when ?? 0, engine.ctx.currentTime)
    v.g.gain.cancelScheduledValues(t)
    v.g.gain.setTargetAtTime(0, t, 0.006)
    try {
      v.src.stop(t + 0.05)
    } catch {
      /* already stopped */
    }
    this.voices.delete(key)
    this.onChange()
  }

  stopAll() {
    for (const k of [...this.voices.keys()]) this.stop(k)
  }

  isPlaying(key: string) {
    return this.voices.has(key)
  }

  private positionSec(v: SVoice, now: number) {
    const el = (now - v.t0) * v.rate
    if (el < 0) return v.s
    return v.s + (v.loop ? el % v.len : Math.min(el, v.len))
  }

  /** Playhead position as 0..1 of the clip, or null when not playing. */
  progress(key: string) {
    const v = this.voices.get(key)
    if (!v || !engine.ctx) return null
    return this.positionSec(v, engine.ctx.currentTime) / v.dur
  }
}

export const sampler = new Sampler()
