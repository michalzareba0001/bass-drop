import { useCallback } from 'react'
import { sampler, type PadMode } from '../audio/sampler'
import { fSt, fPct } from '../audio/params'
import { padDown, padUp } from '../control'
import { PAD_COUNT, useRuntime, useStore } from '../store'
import { Knob } from './Knob'
import { Waveform } from './Waveform'

const PAD_COLORS = ['var(--red)', 'var(--red)', 'var(--orange)', 'var(--orange)', 'var(--yellow)', 'var(--yellow)', 'var(--cream)', 'var(--cream)']

export function Sampler() {
  const pads = useStore((s) => s.pads)
  const clips = useStore((s) => s.clips)
  const selected = useStore((s) => s.selectedPad)
  const padsOn = useRuntime((s) => s.padsOn)

  return (
    <section className="panel sampler">
      <div className="panel-head">
        <h2>Sampler · pętle</h2>
        <span className="hint">Klawisze 1–8 albo pady MIDI (kanał 10). Nowe nagranie samo trafia na wolny pad.</span>
      </div>
      <div className="sampler-body">
        <div className="pads">
          {Array.from({ length: PAD_COUNT }, (_, i) => {
            const pad = pads[i]
            const clip = clips.find((c) => c.id === pad.clipId)
            return (
              <button
                key={i}
                className={'pad' + (padsOn[i] ? ' on' : '') + (selected === i ? ' sel' : '') + (clip ? '' : ' empty')}
                style={{ ['--pc' as string]: PAD_COLORS[i] }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  padDown(i)
                }}
                onPointerUp={() => padUp(i)}
                onPointerCancel={() => padUp(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') padDown(i)
                }}
                aria-pressed={padsOn[i]}
                aria-label={`Pad ${i + 1}${clip ? ', ' + clip.name : ', pusty'}`}
              >
                <span className="pad-n">{i + 1}</span>
                <span className="pad-name">{clip ? clip.name : 'pusty'}</span>
                {clip && <span className="pad-mode">{pad.loop ? 'pętla' : 'raz'}</span>}
              </button>
            )
          })}
        </div>
        <PadEditor />
      </div>
    </section>
  )
}

function PadEditor() {
  const i = useStore((s) => s.selectedPad)
  const pad = useStore((s) => s.pads[s.selectedPad])
  const clip = useStore((s) => s.clips.find((c) => c.id === s.pads[s.selectedPad].clipId))
  const bpm = useStore((s) => s.bpm)
  const updatePad = useStore((s) => s.updatePad)
  const assignClip = useStore((s) => s.assignClip)
  const onTrim = useCallback((start: number, end: number) => updatePad(i, { start, end }), [i, updatePad])
  const progress = useCallback(() => sampler.progress('pad' + i), [i])

  if (!clip)
    return (
      <div className="pad-editor empty">
        <p>
          Pad {i + 1} jest pusty. Nagraj coś w panelu <b>Nagrywanie</b> albo kliknij <b>Na pad {i + 1}</b> przy nagraniu na liście poniżej.
        </p>
      </div>
    )

  const len = (pad.end - pad.start) * clip.duration
  const bars = len / ((60 / bpm) * 4)

  return (
    <div className="pad-editor">
      <div className="pe-head">
        <strong>
          Pad {i + 1}: {clip.name}
        </strong>
        <span className="pe-len">
          {len.toFixed(2)} s · {bars.toFixed(2)} taktu przy {bpm} BPM
        </span>
      </div>
      <Waveform
        peaks={clip.peaks}
        start={pad.start}
        end={pad.end}
        onTrim={onTrim}
        progress={progress}
        height={110}
        className="wave"
        label="Przebieg nagrania. Przeciągnij znaczniki, żeby przyciąć początek i koniec."
      />
      <div className="pe-controls">
        <div className="mrow">
          <label htmlFor="padLoop">
            <input id="padLoop" type="checkbox" checked={pad.loop} onChange={(e) => updatePad(i, { loop: e.target.checked })} />
            Pętla
          </label>
          <label htmlFor="padMode">
            Tryb
            <select id="padMode" value={pad.mode} onChange={(e) => updatePad(i, { mode: e.target.value as PadMode })}>
              <option value="toggle">Włącz / wyłącz</option>
              <option value="hold">Gra, póki trzymasz</option>
              <option value="shot">Odpal od początku</option>
            </select>
          </label>
          <label htmlFor="padSync">
            <input id="padSync" type="checkbox" checked={pad.sync} onChange={(e) => updatePad(i, { sync: e.target.checked })} />
            Startuj na bicie, gdy gra wzór
          </label>
        </div>
        <div className="knobs">
          <Knob
            id="pad-pitch"
            label="Wysokość"
            value={pad.pitch}
            range={{ min: -24, max: 24, step: 1 }}
            def={0}
            color="var(--orange)"
            format={fSt}
            onChange={(v) => updatePad(i, { pitch: v })}
          />
          <Knob
            id="pad-gain"
            label="Głośność"
            value={pad.gain}
            range={{ min: 0, max: 1.5 }}
            def={1}
            color="var(--yellow)"
            format={fPct}
            onChange={(v) => updatePad(i, { gain: v })}
          />
        </div>
        <div className="mrow">
          <button className="btn sm" onClick={() => updatePad(i, { start: 0, end: 1 })}>
            Całe nagranie
          </button>
          <button className="btn sm" onClick={() => assignClip(i, null)}>
            Opróżnij pad
          </button>
        </div>
      </div>
    </div>
  )
}
