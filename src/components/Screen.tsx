import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { clamp, noteName } from '../audio/params'

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

function fit(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect()
  const d = devicePixelRatio || 1
  const w = Math.round(r.width * d)
  const h = Math.round(r.height * d)
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return d
}

/** Oscilloscope + spectrum. Draws straight to canvas in rAF, outside React renders. */
export function Screen() {
  const scopeRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef<HTMLCanvasElement>(null)
  const roRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const COL = { trace: css('--yellow'), fill: css('--orange'), grid: 'rgba(236,230,214,.08)', txt: css('--muted') }
    let raf = 0
    let tbuf: Float32Array<ArrayBuffer> | null = null
    let fbuf: Float32Array<ArrayBuffer> | null = null
    const specGrid = (g: CanvasRenderingContext2D, W: number, H: number, d: number) => {
      g.font = `${10 * d}px "IBM Plex Mono", monospace`
      for (const f of [30, 44, 60, 100, 200, 500, 1000, 2000]) {
        const x = (Math.log(f / 20) / Math.log(100)) * W
        g.fillStyle = COL.grid
        g.fillRect(x, 0, d, H)
        g.fillStyle = COL.txt
        g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3 * d, H - 5 * d)
      }
    }
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const scope = scopeRef.current!
      const spec = specRef.current!
      let d = fit(scope)
      let g = scope.getContext('2d')!
      let W = scope.width
      let H = scope.height
      g.clearRect(0, 0, W, H)
      g.fillStyle = COL.grid
      g.fillRect(0, H / 2, W, d)
      d = fit(spec)
      const g2 = spec.getContext('2d')!
      const W2 = spec.width
      const H2 = spec.height
      g2.clearRect(0, 0, W2, H2)
      specGrid(g2, W2, H2, d)
      const an = engine.ctx ? engine.analyser : null
      if (!an || !engine.ctx) return
      if (!tbuf) {
        tbuf = new Float32Array(an.fftSize)
        fbuf = new Float32Array(an.frequencyBinCount)
      }
      an.getFloatTimeDomainData(tbuf)
      an.getFloatFrequencyData(fbuf!)
      let st = 0
      for (let i = 1; i < tbuf.length / 2; i++)
        if (tbuf[i - 1] < 0 && tbuf[i] >= 0) {
          st = i
          break
        }
      const N = Math.min(4096, tbuf.length - st)
      g.strokeStyle = COL.trace
      g.lineWidth = 2 * d
      g.beginPath()
      for (let i = 0; i < N; i++) {
        const x = (i / N) * W
        const y = H / 2 - tbuf[st + i] * H * 0.45
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
      W = W2
      H = H2
      g = g2
      const fb = fbuf!
      const bin = engine.ctx.sampleRate / an.fftSize
      g.beginPath()
      g.moveTo(0, H)
      for (let x = 0; x <= W; x += 2 * d) {
        const f = 20 * Math.pow(100, x / W)
        const i = f / bin
        const i0 = Math.floor(i)
        const fr = i - i0
        const v = (fb[i0] ?? -140) * (1 - fr) + (fb[i0 + 1] ?? -140) * fr
        g.lineTo(x, H - clamp((v + 100) / 90, 0, 1) * H)
      }
      g.lineTo(W, H)
      g.closePath()
      g.fillStyle = COL.fill + '55'
      g.fill()
      g.strokeStyle = COL.fill
      g.lineWidth = 1.5 * d
      g.stroke()
      let bi = -1
      let bv = -999
      for (let i = Math.floor(22 / bin); i < Math.ceil(400 / bin); i++)
        if (fb[i] > bv) {
          bv = fb[i]
          bi = i
        }
      const ro = roRef.current!
      if (bv > -60 && bi > 0) {
        const y0 = fb[bi - 1]
        const y1 = fb[bi]
        const y2 = fb[bi + 1]
        const p = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 || 1)
        const f = (bi + p) * bin
        const m = 69 + 12 * Math.log2(f / 440)
        ro.firstChild!.textContent = `${f.toFixed(1)} Hz · ${noteName(Math.round(m))}`
      } else ro.firstChild!.textContent = '— Hz'
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="screen">
      <div className="scr-cell">
        <span className="scr-label">Przebieg</span>
        <canvas ref={scopeRef} />
      </div>
      <div className="scr-cell">
        <span className="scr-label">Widmo 20 Hz – 2 kHz</span>
        <canvas ref={specRef} />
        <div className="readout" ref={roRef}>
          <span>— Hz</span>
          <small>podstawowa</small>
        </div>
      </div>
    </div>
  )
}
