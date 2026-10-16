import { hold } from './util'

export type ChannelId = 'bass' | 'drums' | `pad${number}`

export interface StripCfg {
  vol: number
  mute: boolean
  solo: boolean
  sc: boolean // ducked by the kick
}

export interface SidechainCfg {
  amount: number // 0..1, how deep the duck goes
  release: number // seconds back to full level
}

export const CHANNELS: { id: ChannelId; name: string; canSc: boolean }[] = [
  { id: 'bass', name: 'Bas', canSc: true },
  { id: 'drums', name: 'Bębny', canSc: false },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `pad${i}` as ChannelId, name: `Pad ${i + 1}`, canSc: true })),
]

export const defaultMixer = (): Record<string, StripCfg> =>
  Object.fromEntries(
    CHANNELS.map((c) => [c.id, { vol: c.id === 'drums' ? 0.8 : 0.9, mute: false, solo: false, sc: c.canSc }]),
  )

export const defaultSidechain = (): SidechainCfg => ({ amount: 0.6, release: 0.18 })

interface Strip {
  input: GainNode
  duck: GainNode
  fader: GainNode
  mute: GainNode
  an: AnalyserNode
  buf: Float32Array<ArrayBuffer>
}

/**
 * One strip per channel:  input → duck (sidechain) → fader → mute/solo → mix
 * A post-fader analyser on each strip feeds the level meters.
 */
class Mixer {
  private ctx: AudioContext | null = null
  private strips = new Map<string, Strip>()
  cfg: Record<string, StripCfg> = defaultMixer()
  sc: SidechainCfg = defaultSidechain()

  init(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx
    for (const c of CHANNELS) {
      const input = ctx.createGain()
      const duck = ctx.createGain()
      const fader = ctx.createGain()
      const mute = ctx.createGain()
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      input.connect(duck).connect(fader).connect(mute).connect(dest)
      mute.connect(an)
      this.strips.set(c.id, { input, duck, fader, mute, an, buf: new Float32Array(an.fftSize) })
    }
    this.apply()
  }

  input(id: string): AudioNode {
    const s = this.strips.get(id)
    if (!s) throw new Error('no mixer channel ' + id)
    return s.input
  }

  configure(cfg: Record<string, StripCfg>, sc: SidechainCfg) {
    this.cfg = cfg
    this.sc = sc
    this.apply()
  }

  private apply() {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const anySolo = Object.values(this.cfg).some((c) => c.solo)
    for (const [id, s] of this.strips) {
      const c = this.cfg[id]
      if (!c) continue
      s.fader.gain.setTargetAtTime(c.vol, now, 0.015)
      const audible = !c.mute && (!anySolo || c.solo)
      s.mute.gain.setTargetAtTime(audible ? 1 : 0, now, 0.01)
      if (!c.sc) {
        hold(s.duck.gain, now)
        s.duck.gain.setTargetAtTime(1, now, 0.02)
      }
    }
  }

  /** False when the channel is muted, turned down, or left out by someone else's solo. */
  isAudible(id: string) {
    const c = this.cfg[id]
    if (!c || c.mute || c.vol <= 0.001) return false
    return !Object.values(this.cfg).some((x) => x.solo) || c.solo
  }

  /** Called on every kick: pull sidechained channels down, then let them recover. */
  duck(t: number) {
    const { amount, release } = this.sc
    if (amount <= 0) return
    const floor = 1 - amount
    for (const [id, s] of this.strips) {
      if (!this.cfg[id]?.sc) continue
      const g = s.duck.gain
      // exponential approach both ways: never dips below the floor, even when kicks overlap
      hold(g, t)
      g.setTargetAtTime(floor, t, 0.002)
      g.setTargetAtTime(1, t + 0.015, release / 3)
    }
  }

  /** Peak level (0..1+) of a channel since the last read. */
  peak(id: string) {
    const s = this.strips.get(id)
    if (!s) return 0
    s.an.getFloatTimeDomainData(s.buf)
    let p = 0
    for (let i = 0; i < s.buf.length; i++) {
      const v = Math.abs(s.buf[i])
      if (v > p) p = v
    }
    return p
  }

  /** How far the channel is pulled down by the sidechain right now (0 = not at all). */
  ducking(id: string) {
    const s = this.strips.get(id)
    return s ? 1 - s.duck.gain.value : 0
  }
}

export const mixer = new Mixer()
