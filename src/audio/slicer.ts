import type { Analysis } from './beats'
import { engine } from './engine'
import { sampler } from './sampler'

/** Sampler key of the loaded track (not a saved clip) and of its preview voice. */
const TRACK = '__track'
const PREVIEW = 'prev:' + TRACK
/** Cuts start this much before the grid line so the attack is never clipped. */
export const PRE_ROLL = 0.003
/** Longest track we accept: the decoded audio stays in memory (about 23 MB per minute). */
export const MAX_MINUTES = 15

export class TrackError extends Error {}

/**
 * Holds an imported track (decoded, in memory only), runs the beat analysis in a worker,
 * plays previews and cuts loops or single hits out of it.
 */
class Slicer {
  buf: AudioBuffer | null = null
  analysis: Analysis | null = null
  private worker: Worker | null = null

  async load(file: File) {
    const ctx = engine.ensure()
    this.stopPreview()
    let buf: AudioBuffer
    try {
      buf = await ctx.decodeAudioData(await file.arrayBuffer())
    } catch {
      throw new TrackError('Nie udało się odczytać pliku. Spróbuj mp3, wav, m4a albo ogg.')
    }
    if (buf.duration > MAX_MINUTES * 60) throw new TrackError(`Plik jest dłuższy niż ${MAX_MINUTES} minut.`)
    if (buf.duration < 5) throw new TrackError('Plik jest za krótki, żeby wykryć tempo (potrzeba co najmniej 5 sekund).')
    this.buf = buf
    this.analysis = null
    sampler.setBuffer(TRACK, buf)
    return buf
  }

  analyse(): Promise<Analysis> {
    const buf = this.buf
    if (!buf) return Promise.reject(new TrackError('Brak pliku.'))
    const x = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < x.length; i++) x[i] += d[i] / buf.numberOfChannels
    }
    this.worker?.terminate()
    const w = new Worker(new URL('./beats.worker.ts', import.meta.url), { type: 'module' })
    this.worker = w
    return new Promise((resolve, reject) => {
      w.onmessage = (e: MessageEvent<{ ok: boolean; a?: Analysis; msg?: string }>) => {
        w.terminate()
        if (this.worker === w) this.worker = null
        if (e.data.ok && e.data.a && this.buf === buf) {
          this.analysis = e.data.a
          resolve(e.data.a)
        } else reject(new TrackError('Nie udało się wykryć tempa w tym pliku.'))
      }
      w.onerror = () => {
        w.terminate()
        reject(new TrackError('Analiza się nie powiodła.'))
      }
      w.postMessage({ x, sr: buf.sampleRate }, [x.buffer])
    })
  }

  /** Plays start..end (seconds) of the track on the preview bus. */
  preview(start: number, end: number, loop: boolean) {
    const b = this.buf
    if (!b) return
    engine.ensure()
    sampler.play(PREVIEW, TRACK, { start: start / b.duration, end: end / b.duration, loop, pitch: 0, gain: 1 })
  }

  stopPreview() {
    sampler.stop(PREVIEW)
  }

  get previewing() {
    return sampler.isPlaying(PREVIEW)
  }

  /** Preview playhead in seconds, or null. */
  playhead() {
    const p = sampler.progress(PREVIEW)
    return p == null || !this.buf ? null : p * this.buf.duration
  }

  /**
   * Moves a detected hit onto the actual attack in the audio: the steepest rise of a
   * 1 ms envelope near t, minus a little pre-roll.
   */
  refine(t: number) {
    const b = this.buf!
    const sr = b.sampleRate
    const blk = Math.max(1, Math.round(sr * 0.001))
    const a = Math.max(0, Math.round((t - 0.025) * sr))
    const z = Math.min(b.length, Math.round((t + 0.02) * sr))
    const chs = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c))
    const e: number[] = []
    for (let s = a; s + blk <= z; s += blk) {
      let v = 0
      for (const d of chs) for (let i = s; i < s + blk; i++) v += Math.abs(d[i])
      e.push(v)
    }
    let best = -1
    let bi = -1
    for (let i = 1; i < e.length; i++) {
      const rise = e[i] - e[i - 1]
      if (rise > best) [best, bi] = [rise, i]
    }
    if (bi < 0) return Math.max(0, t - PRE_ROLL)
    return Math.max(0, (a + (bi - 1) * blk) / sr - PRE_ROLL)
  }

  /** Copies start..start+dur seconds of the track, padding with silence past the end. */
  cut(start: number, dur: number): Float32Array[] {
    const b = this.buf!
    const sr = b.sampleRate
    const s = Math.round(start * sr)
    const len = Math.max(1, Math.round(dur * sr))
    return Array.from({ length: b.numberOfChannels }, (_, c) => {
      const out = new Float32Array(len)
      const d = b.getChannelData(c)
      const from = Math.max(0, s)
      const to = Math.min(b.length, s + len)
      if (to > from) out.set(d.subarray(from, to), from - s)
      return out
    })
  }

  /**
   * Like cut(), but plays the source at `rate` (like a turntable: tempo and pitch change
   * together) so the result is exactly `outDur` seconds long.
   */
  async render(start: number, outDur: number, rate: number): Promise<Float32Array[]> {
    if (Math.abs(rate - 1) < 1e-6) return this.cut(start, outDur)
    const b = this.buf!
    const sr = b.sampleRate
    const oc = new OfflineAudioContext(b.numberOfChannels, Math.max(1, Math.round(outDur * sr)), sr)
    const src = oc.createBufferSource()
    src.buffer = b
    src.playbackRate.value = rate
    src.connect(oc.destination)
    if (start >= 0) src.start(0, start)
    else src.start(-start / rate, 0)
    const r = await oc.startRendering()
    return Array.from({ length: r.numberOfChannels }, (_, c) => r.getChannelData(c).slice())
  }
}

export const slicer = new Slicer()
