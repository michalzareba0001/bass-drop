import { useRef } from 'react'
import { noteName } from '../audio/params'
import { panic, press, release } from '../control'
import { useRuntime, useStore } from '../store'

const BLACK = [1, 3, 6, 8, 10]

export function Piano() {
  const octave = useStore((s) => s.octave)
  const setOctave = useStore((s) => s.setOctave)
  const down = useRuntime((s) => s.down)
  const ptr = useRef<Record<number, number>>({})
  const base = (octave + 1) * 12
  const whites: number[] = []
  for (let m = base; m <= base + 24; m++) if (!BLACK.includes(m % 12)) whites.push(m)
  const w = 100 / whites.length
  const blacks: { m: number; left: number }[] = []
  for (let m = base; m < base + 24; m++) if (BLACK.includes(m % 12)) blacks.push({ m, left: (whites.indexOf(m - 1) + 1) * w - w * 0.32 })

  const noteAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const k = el?.closest<HTMLElement>('.piano [data-m]')
    return k ? +k.dataset.m! : null
  }
  const changeOct = (o: number) => {
    panic()
    setOctave(o)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="oct">
          <button onClick={() => changeOct(octave - 1)} aria-label="Oktawa niżej">−</button>
          <span>C{octave}</span>
          <button onClick={() => changeOct(octave + 1)} aria-label="Oktawa wyżej">+</button>
        </div>
        <span className="hint">Klawiatura komputera: A W S E D F T G Y H U J K · Z/X zmienia oktawę · dwa klawisze naraz = slide</span>
      </div>
      <div
        className="piano"
        onPointerDown={(e) => {
          const m = noteAt(e.clientX, e.clientY)
          if (m == null) return
          e.currentTarget.setPointerCapture(e.pointerId)
          ptr.current[e.pointerId] = m
          press(m)
        }}
        onPointerMove={(e) => {
          const cur = ptr.current[e.pointerId]
          if (cur == null) return
          const m = noteAt(e.clientX, e.clientY)
          if (m != null && m !== cur) {
            ptr.current[e.pointerId] = m
            press(m)
            release(cur)
          }
        }}
        onPointerUp={(e) => {
          const m = ptr.current[e.pointerId]
          if (m != null) release(m)
          delete ptr.current[e.pointerId]
        }}
        onPointerCancel={(e) => {
          const m = ptr.current[e.pointerId]
          if (m != null) release(m)
          delete ptr.current[e.pointerId]
        }}
      >
        {whites.map((m) => (
          <div key={m} data-m={m} className={'wk' + (down.includes(m) ? ' down' : '')}>
            {m % 12 === 0 ? noteName(m) : ''}
          </div>
        ))}
        {blacks.map(({ m, left }) => (
          <div key={m} data-m={m} className={'bk' + (down.includes(m) ? ' down' : '')} style={{ left: left + '%', width: w * 0.64 + '%' }} />
        ))}
      </div>
    </section>
  )
}
