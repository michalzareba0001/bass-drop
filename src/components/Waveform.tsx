import { useEffect, useRef, type PointerEvent } from 'react'

interface Props {
  peaks: number[]
  start?: number
  end?: number
  onTrim?: (start: number, end: number) => void
  progress?: () => number | null
  height?: number
  className?: string
  label?: string
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

/** Waveform from stored peaks, optional trim handles and a live playhead. */
export function Waveform({ peaks, start = 0, end = 1, onTrim, progress, height = 120, className, label }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ start, end, peaks, progress })
  st.current = { start, end, peaks, progress }
  const drag = useRef<'s' | 'e' | null>(null)
  const editable = !!onTrim

  useEffect(() => {
    const c = ref.current!
    const COL = { wave: css('--cream'), dim: css('--muted'), sel: css('--orange'), ph: css('--yellow'), bg: css('--screen') }
    let raf = 0
    const draw = () => {
      const r = c.getBoundingClientRect()
      const d = devicePixelRatio || 1
      if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) {
        c.width = Math.round(r.width * d)
        c.height = Math.round(r.height * d)
      }
      const g = c.getContext('2d')!
      const W = c.width
      const H = c.height
      const { start, end, peaks, progress } = st.current
      g.clearRect(0, 0, W, H)
      const n = peaks.length || 1
      const bw = W / n
      for (let i = 0; i < n; i++) {
        const x = i * bw
        const p = peaks[i] ?? 0
        const inSel = i / n >= start && i / n <= end
        g.fillStyle = inSel ? COL.wave : COL.dim + '66'
        const h = Math.max(d, p * H * 0.92)
        g.fillRect(x, (H - h) / 2, Math.max(d, bw - d * 0.5), h)
      }
      if (editable) {
        g.fillStyle = COL.sel + '22'
        g.fillRect(start * W, 0, (end - start) * W, H)
        g.fillStyle = COL.sel
        for (const v of [start, end]) {
          g.fillRect(v * W - d, 0, 2 * d, H)
          g.fillRect(v * W - 5 * d, 0, 10 * d, 8 * d)
        }
      }
      const p = progress?.()
      if (p != null) {
        g.fillStyle = COL.ph
        g.fillRect(p * W - d, 0, 2 * d, H)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [editable])

  const pos = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ height, touchAction: onTrim ? 'none' : undefined, cursor: onTrim ? 'ew-resize' : undefined }}
      role={onTrim ? 'img' : undefined}
      aria-label={label}
      onPointerDown={(e) => {
        if (!onTrim) return
        const x = pos(e)
        const { start, end } = st.current
        drag.current = Math.abs(x - start) <= Math.abs(x - end) ? 's' : 'e'
        e.currentTarget.setPointerCapture(e.pointerId)
        apply(x)
      }}
      onPointerMove={(e) => {
        if (drag.current) apply(pos(e))
      }}
      onPointerUp={() => (drag.current = null)}
    />
  )

  function apply(x: number) {
    const { start, end } = st.current
    const minLen = 0.005
    if (drag.current === 's') onTrim!(Math.min(x, end - minLen), end)
    else onTrim!(start, Math.max(x, start + minLen))
  }
}
