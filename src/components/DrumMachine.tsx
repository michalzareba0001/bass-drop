import { useEffect, useState } from 'react'
import { DRUMS, drums, ROLL_LABEL, type DrumId } from '../audio/drums'
import { engine } from '../audio/engine'
import { fPct, fSt } from '../audio/params'
import { sequencer, STEPS } from '../audio/sequencer'
import { useStore } from '../store'
import { Knob } from './Knob'

const BRUSHES: { v: number; label: string; hint: string }[] = [
  { v: 1, label: 'Uderzenie', hint: 'jedno uderzenie na krok' },
  { v: 2, label: 'Rolka 1/32', hint: '2 uderzenia na krok' },
  { v: 3, label: 'Trioli', hint: '3 uderzenia na krok' },
  { v: 4, label: 'Rolka 1/64', hint: '4 uderzenia na krok' },
]

export function DrumMachine() {
  const steps = useStore((s) => s.drumSteps)
  const setDrumStep = useStore((s) => s.setDrumStep)
  const clearDrums = useStore((s) => s.clearDrums)
  const [brush, setBrush] = useState(1)
  const [ph, setPh] = useState(-1)

  useEffect(() => {
    let raf = 0
    let last = -2
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const s = sequencer.currentStep()
      if (s !== last) {
        last = s
        setPh(s)
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  const audition = (id: DrumId, n = 1) => {
    engine.ensure()
    const t = engine.now() + 0.01
    const sd = sequencer.stepDur()
    if (n <= 1) drums.trigger(id, t)
    else for (let k = 0; k < n; k++) drums.trigger(id, t + (k * sd) / n, 0.6 + (0.4 * k) / (n - 1))
  }

  return (
    <section className="panel drums">
      <div className="panel-head">
        <h2>Bębny · 16 kroków</h2>
        <div className="brushes" role="group" aria-label="Co wstawia kliknięcie">
          {BRUSHES.map((b) => (
            <button key={b.v} className="chip sm" aria-pressed={brush === b.v} title={b.hint} onClick={() => setBrush(b.v)}>
              {b.label}
            </button>
          ))}
          <button className="btn sm" onClick={clearDrums}>
            Wyczyść bębny
          </button>
        </div>
      </div>
      <p className="msg drum-help">
        Wybierz, co wstawia kliknięcie, i klikaj w kroki. Kliknięcie w ten sam rodzaj usuwa krok. Rolki najlepiej brzmią na hi-hacie. Nazwa ścieżki odsłuchuje dźwięk.
      </p>
      <div className="grid-scroll">
        <div className="dgrid">
          <span />
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className="stepn">
              {i + 1}
            </span>
          ))}
          {DRUMS.map((d) => (
            <DrumRow key={d.id} id={d.id} name={d.name} color={d.color} row={steps[d.id]} ph={ph} brush={brush}
              onAudition={() => audition(d.id)}
              onSet={(i, v) => {
                setDrumStep(d.id, i, v)
                if (v && !sequencer.playing) audition(d.id, v)
              }}
            />
          ))}
        </div>
      </div>
      <DrumSounds />
    </section>
  )
}

function DrumRow({ name, color, row, ph, brush, onAudition, onSet }: {
  id: DrumId; name: string; color: string; row: number[]; ph: number; brush: number
  onAudition: () => void; onSet: (i: number, v: number) => void
}) {
  return (
    <>
      <button className="dname" style={{ ['--c' as string]: color }} onClick={onAudition}>
        {name}
      </button>
      {row.map((v, i) => (
        <button
          key={i}
          className={'cell' + (i % 4 === 0 ? ' beat' : '') + (v ? ' on' : '') + (i === ph ? ' ph' : '')}
          style={{ ['--c' as string]: color }}
          aria-pressed={v > 0}
          aria-label={`${name}, krok ${i + 1}${v > 1 ? ', rolka ' + ROLL_LABEL[v] : ''}`}
          onClick={() => onSet(i, v === brush ? 0 : brush)}
        >
          {v > 1 ? <span className="roll">{v === 3 ? '3' : v === 2 ? '×2' : '×4'}</span> : null}
        </button>
      ))}
    </>
  )
}

function DrumSounds() {
  const cfg = useStore((s) => s.drumCfg)
  const setDrumCfg = useStore((s) => s.setDrumCfg)
  return (
    <div className="drum-sounds">
      {DRUMS.map((d) => (
        <div className="dsound" key={d.id}>
          <h3>
            <i style={{ background: d.color }} />
            {d.name}
          </h3>
          <div className="knobs">
            <Knob id={`d-${d.id}-level`} label="Głośność" value={cfg[d.id].level} range={{ min: 0, max: 1.5 }} def={1} color={d.color}
              format={fPct} onChange={(v) => setDrumCfg(d.id, { level: v })} />
            <Knob id={`d-${d.id}-pitch`} label="Strój" value={cfg[d.id].pitch} range={{ min: -12, max: 12, step: 1 }} def={0} color={d.color}
              format={fSt} onChange={(v) => setDrumCfg(d.id, { pitch: v })} />
            <Knob id={`d-${d.id}-decay`} label="Długość" value={cfg[d.id].decay} range={{ min: 0.3, max: 3, log: true }} def={1} color={d.color}
              format={(v) => '×' + v.toFixed(2)} onChange={(v) => setDrumCfg(d.id, { decay: v })} />
          </div>
        </div>
      ))}
    </div>
  )
}
