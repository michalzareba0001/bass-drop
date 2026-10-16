import { engine } from './engine'
import { drums, DRUMS, type DrumId } from './drums'

export interface Step {
  note: number | null
  slide: boolean
}

export const STEPS = 16

/** Look-ahead scheduler: a 25 ms timer schedules notes ~120 ms ahead on the audio clock. */
class Sequencer {
  playing = false
  private nextT = 0
  private cur = 0
  private timer = 0
  private queue: [number, number][] = []
  private lastStep = -1
  getSteps: () => Step[] = () => []
  getBpm: () => number = () => 123
  getDrumSteps: () => Record<DrumId, number[]> | null = () => null
  onPlayingChange: (p: boolean) => void = () => {}

  stepDur() {
    return 60 / this.getBpm() / 4
  }
  barDur() {
    return this.stepDur() * STEPS
  }

  /** Starts at the given audio time (or right away) and returns the time of step 1. */
  start(at?: number) {
    const ctx = engine.ensure()
    if (this.playing) this.stop()
    this.playing = true
    this.cur = 0
    this.nextT = at ?? ctx.currentTime + 0.06
    const t0 = this.nextT
    this.tick()
    this.timer = window.setInterval(() => this.tick(), 25)
    this.onPlayingChange(true)
    return t0
  }

  stop() {
    if (!this.playing) return
    this.playing = false
    window.clearInterval(this.timer)
    engine.noteOff()
    this.queue = []
    this.lastStep = -1
    this.onPlayingChange(false)
  }

  private tick() {
    const ctx = engine.ctx
    if (!ctx) return
    const sd = this.stepDur()
    const steps = this.getSteps()
    const dsteps = this.getDrumSteps()
    while (this.nextT < ctx.currentTime + 0.12) {
      const s = steps[this.cur]
      if (s && s.note != null) {
        engine.noteOn(s.note, this.nextT, s.slide)
        engine.noteOff(this.nextT + Math.round(engine.P.gate) * sd)
      }
      if (dsteps) {
        for (const d of DRUMS) {
          const n = dsteps[d.id]?.[this.cur] ?? 0
          if (n === 1) drums.trigger(d.id, this.nextT, 1)
          else if (n > 1)
            // rolls rise in velocity toward the next step
            for (let k = 0; k < n; k++) drums.trigger(d.id, this.nextT + (k * sd) / n, 0.6 + (0.4 * k) / (n - 1))
        }
      }
      this.queue.push([this.cur, this.nextT])
      this.nextT += sd
      this.cur = (this.cur + 1) % STEPS
    }
  }

  /** Audio time of the next step 1 (start of the next bar). */
  nextBarTime() {
    if (!this.playing) return null
    return this.nextT + ((STEPS - this.cur) % STEPS) * this.stepDur()
  }

  /** Audio time of the next quarter note. */
  nextBeatTime() {
    if (!this.playing) return null
    return this.nextT + ((4 - (this.cur % 4)) % 4) * this.stepDur()
  }

  /** The step that is sounding right now (for the playhead). */
  currentStep() {
    const t = engine.now()
    while (this.queue.length && this.queue[0][1] <= t) this.lastStep = this.queue.shift()![0]
    return this.playing ? this.lastStep : -1
  }
}

export const sequencer = new Sequencer()
