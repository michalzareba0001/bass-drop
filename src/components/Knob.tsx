import { useRef } from 'react'
import { fromN, toN, type Range } from '../audio/params'

const A0 = Math.PI * 0.75
const SW = Math.PI * 1.5
function arc(a0: number, a1: number, r: number) {
  const p = (a: number) => [24 + r * Math.cos(a), 24 + r * Math.sin(a)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
}

interface Props {
  id: string
  label: string
  value: number
  range: Range
  def: number
  color: string
  format: (v: number) => string
  onChange: (v: number) => void
  tag?: string
  pickable?: boolean
  picked?: boolean
  onPick?: () => void
}

export function Knob({ id, label, value, range, def, color, format, onChange, tag, pickable, picked, onPick }: Props) {
  const drag = useRef<{ y: number; n: number } | null>(null)
  const n = toN(range, value)
  const a = A0 + SW * n
  const bip = range.min < 0
  const mid = A0 + SW * toN(range, 0)
  const valPath =
    n < 0.002 && !bip ? '' : bip ? (a >= mid ? arc(mid, Math.max(a, mid + 0.001), 18) : arc(a, mid, 18)) : arc(A0, Math.max(a, A0 + 0.001), 18)

  return (
    <div
      id={id}
      className={'knob' + (picked ? ' target' : '')}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      onPointerDown={(e) => {
        if (pickable) {
          onPick?.()
          return
        }
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.focus()
        drag.current = { y: e.clientY, n }
      }}
      onPointerMove={(e) => {
        if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
        const sc = e.shiftKey ? 0.0015 : 0.006
        onChange(fromN(range, drag.current.n + (drag.current.y - e.clientY) * sc))
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => onChange(def)}
      onKeyDown={(e) => {
        const st = e.shiftKey ? 0.01 : 0.04
        let dn = 0
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') dn = st
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') dn = -st
        else return
        e.preventDefault()
        e.stopPropagation()
        let v = fromN(range, n + dn)
        if (range.step && v === value) v = Math.min(range.max, Math.max(range.min, value + Math.sign(dn) * range.step))
        onChange(v)
      }}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d={arc(A0, A0 + SW, 18)} stroke="var(--line)" strokeWidth="4" fill="none" strokeLinecap="round" />
        {valPath && <path d={valPath} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" />}
        <circle cx="24" cy="24" r="12" fill="var(--panel2)" stroke="var(--line)" />
        <line x1="24" y1="24" x2={24 + 13 * Math.cos(a)} y2={24 + 13 * Math.sin(a)} stroke="var(--fg)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="kl">{label}</span>
      <span className="kv">{format(value)}</span>
      <span className="kc">{tag ?? ''}</span>
    </div>
  )
}
