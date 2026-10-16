import { Fragment, useEffect, useState } from 'react'
import { engine } from '../audio/engine'
import { noteName, ROWS } from '../audio/params'
import { sequencer, STEPS } from '../audio/sequencer'
import { useStore } from '../store'

const GC = ['var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--cream)']

export function Sequencer() {
  const steps = useStore((s) => s.steps)
  const toggleNote = useStore((s) => s.toggleNote)
  const toggleSlide = useStore((s) => s.toggleSlide)
  const clearSteps = useStore((s) => s.clearSteps)
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

  return (
    <section className="seq panel">
      <div className="panel-head">
        <h2>Wzór · 16 kroków · F-moll</h2>
        <span className="hint">Kliknij pole, żeby wstawić nutę. „Slide” płynnie przejeżdża z poprzedniej nuty.</span>
        <button className="btn sm" onClick={clearSteps}>
          Wyczyść wzór
        </button>
      </div>
      <div className="grid-scroll">
        <div className="grid">
          <span className="rl" />
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className="stepn">
              {i + 1}
            </span>
          ))}
          {ROWS.map(renderRow)}
          <span className="rl">slide</span>
          {steps.map((s, i) => (
            <button
              key={i}
              className={'slide' + (s.slide ? ' on' : '')}
              style={{ visibility: s.note == null ? 'hidden' : 'visible' }}
              aria-pressed={s.slide}
              aria-label={`Slide na kroku ${i + 1}`}
              onClick={() => toggleSlide(i)}
            >
              ↗
            </button>
          ))}
        </div>
      </div>
    </section>
  )

  function renderRow(m: number) {
    return (
      <Fragment key={m}>
        <span className="rl">{noteName(m)}</span>
        {steps.map((s, i) => {
          const on = s.note === m
          return (
            <button
              key={i}
              className={'cell' + (i % 4 === 0 ? ' beat' : '') + (on ? ' on' : '') + (i === ph ? ' ph' : '')}
              style={{ ['--c' as string]: GC[Math.floor(i / 4)] }}
              aria-pressed={on}
              aria-label={`Krok ${i + 1}, ${noteName(m)}`}
              onClick={() => {
                engine.ensure()
                toggleNote(i, m)
                if (!on && !sequencer.playing) {
                  const t = engine.now() + 0.01
                  engine.noteOn(m, t)
                  engine.noteOff(t + 0.35)
                }
              }}
            />
          )
        })}
      </Fragment>
    )
  }
}
