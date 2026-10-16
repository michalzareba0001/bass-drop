import { engine } from './engine'

/**
 * Capture runs in an AudioWorklet so it stays sample-accurate. The worklet sends
 * blocks of 4096 frames stamped with their audio-clock frame number; the main
 * thread keeps only the frames between startFrame and endFrame. That is what
 * makes bar-length recordings loop cleanly.
 */
const WORKLET = `
const N = 4096
class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = false
    this.buf = [new Float32Array(N), new Float32Array(N)]
    this.n = 0
    this.start = 0
    this.port.onmessage = (e) => {
      if (e.data === 'on') { this.on = true; this.n = 0 }
      else if (e.data === 'off') { this.flush(); this.on = false; this.port.postMessage({ done: true }) }
    }
  }
  flush() {
    if (this.n > 0) {
      this.port.postMessage({ frame: this.start, ch: this.buf.map((b) => b.slice(0, this.n)) })
      this.n = 0
    }
  }
  process(inputs) {
    if (!this.on) return true
    const inp = inputs[0]
    const len = inp && inp[0] ? inp[0].length : 128
    if (this.n + len > N) this.flush()
    if (this.n === 0) this.start = currentFrame
    for (let c = 0; c < 2; c++) {
      const src = inp && (inp[c] || inp[0])
      if (src) this.buf[c].set(src, this.n)
      else this.buf[c].fill(0, this.n, this.n + len)
    }
    this.n += len
    if (this.n >= N) this.flush()
    return true
  }
}
registerProcessor('sd-capture', Capture)
`

export type RecSource = 'out' | 'mic'
export type RecState = 'idle' | 'waiting' | 'recording'

interface Chunk {
  frame: number
  ch: Float32Array[]
}

class Recorder {
  state: RecState = 'idle'
  source: RecSource = 'out'
  peak = 0
  onState: (s: RecState) => void = () => {}
  onDone: (ch: Float32Array[], sampleRate: number) => void = () => {}
  onError: (msg: string) => void = () => {}

  private node: AudioWorkletNode | null = null
  private ready: Promise<void> | null = null
  private mic: MediaStream | null = null
  private micNode: MediaStreamAudioSourceNode | null = null
  private chunks: Chunk[] = []
  private startFrame: number | null = null
  private endFrame = Infinity
  private lastFrame = 0
  private offSent = false

  init() {
    if (this.ready) return this.ready
    const ctx = engine.ensure()
    this.ready = (async () => {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      this.node = new AudioWorkletNode(ctx, 'sd-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      })
      // keep the node pulled by the graph without making it audible
      const sink = ctx.createGain()
      sink.gain.value = 0
      this.node.connect(sink).connect(ctx.destination)
      this.node.port.onmessage = (e) => this.onMsg(e.data)
      await this.connectSource()
    })()
    this.ready.catch(() => {
      this.ready = null
    })
    return this.ready
  }

  async setSource(s: RecSource) {
    this.source = s
    if (this.node) await this.connectSource()
  }

  private async connectSource() {
    const node = this.node
    const ctx = engine.ctx
    if (!node || !ctx) return
    try {
      engine.out.disconnect(node)
    } catch {
      /* not connected */
    }
    if (this.micNode) {
      try {
        this.micNode.disconnect(node)
      } catch {
        /* not connected */
      }
    }
    if (this.source === 'out') {
      engine.out.connect(node)
      return
    }
    if (!this.mic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
      } catch {
        this.onError('Przeglądarka nie dała dostępu do mikrofonu. Zezwól na mikrofon w ustawieniach strony.')
        this.source = 'out'
        engine.out.connect(node)
        throw new Error('mic denied')
      }
      this.micNode = ctx.createMediaStreamSource(this.mic)
    }
    this.micNode!.connect(node)
  }

  /** at: audio time to start from (sample-accurate); duration: seconds, or free length if omitted. */
  async start(opts: { at?: number; duration?: number } = {}) {
    if (this.state !== 'idle') return
    await this.init()
    const ctx = engine.ctx!
    const sr = ctx.sampleRate
    this.chunks = []
    this.offSent = false
    this.peak = 0
    this.startFrame = opts.at != null ? Math.round(opts.at * sr) : null
    this.endFrame =
      opts.duration && this.startFrame != null ? this.startFrame + Math.round(opts.duration * sr) : Infinity
    this.setState(opts.at != null && opts.at > ctx.currentTime + 0.02 ? 'waiting' : 'recording')
    this.node!.port.postMessage('on')
  }

  stop() {
    if (this.state === 'idle' || this.offSent || !engine.ctx) return
    const nowFrame = Math.round(engine.ctx.currentTime * engine.ctx.sampleRate)
    if (this.startFrame != null && nowFrame <= this.startFrame) {
      // stopped while still waiting for the bar: discard
      this.startFrame = nowFrame
    }
    this.endFrame = Math.min(this.endFrame, nowFrame)
    this.offSent = true
    this.node!.port.postMessage('off')
  }

  elapsed() {
    const ctx = engine.ctx
    if (!ctx || this.state !== 'recording' || this.startFrame == null) return 0
    return Math.max(0, ctx.currentTime - this.startFrame / ctx.sampleRate)
  }

  private setState(s: RecState) {
    this.state = s
    this.onState(s)
  }

  private onMsg(d: { done?: boolean; frame?: number; ch?: Float32Array[] }) {
    if (d.done) {
      this.finish()
      return
    }
    if (d.frame == null || !d.ch) return
    this.chunks.push({ frame: d.frame, ch: d.ch })
    if (this.startFrame == null) this.startFrame = d.frame
    this.lastFrame = d.frame + d.ch[0].length
    if (this.state === 'waiting' && this.lastFrame > this.startFrame) this.setState('recording')
    let p = 0
    for (const c of d.ch) for (let i = 0; i < c.length; i += 4) p = Math.max(p, Math.abs(c[i]))
    this.peak = Math.max(p, this.peak * 0.8)
    if (!this.offSent && this.lastFrame >= this.endFrame) {
      this.offSent = true
      this.node!.port.postMessage('off')
    }
  }

  private finish() {
    const sr = engine.ctx!.sampleRate
    const s = this.startFrame ?? 0
    const e = Math.min(this.endFrame, this.lastFrame)
    const len = e - s
    const chunks = this.chunks
    this.chunks = []
    this.setState('idle')
    if (len < sr * 0.05) return
    const out = [new Float32Array(len), new Float32Array(len)]
    for (const c of chunks) {
      const a = Math.max(s, c.frame)
      const b = Math.min(e, c.frame + c.ch[0].length)
      if (b <= a) continue
      for (let k = 0; k < 2; k++) out[k].set(c.ch[k].subarray(a - c.frame, b - c.frame), a - s)
    }
    this.onDone(out, sr)
  }
}

export const recorder = new Recorder()
