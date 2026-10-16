import { DEF, PRESETS, SECTIONS, type ParamKey } from '../audio/params'
import { engine } from '../audio/engine'
import { sequencer } from '../audio/sequencer'
import { useRuntime, useStore } from '../store'
import { Knob } from './Knob'

function ParamKnob({ k, color }: { k: ParamKey; color: string }) {
  const value = useStore((s) => s.params[k])
  const setParam = useStore((s) => s.setParam)
  const ccMap = useStore((s) => s.ccMap)
  const learning = useRuntime((s) => s.learning)
  const target = useRuntime((s) => s.learnTarget)
  const d = DEF[k]
  const cc = Object.entries(ccMap).find(([, p]) => p === k)?.[0]
  const tag = cc ? 'CC ' + cc : k === 'lfoDepth' && !ccMap['1'] ? 'kółko mod.' : undefined
  return (
    <Knob
      id={'k-' + k}
      label={d.l}
      value={value}
      range={d}
      def={d.v}
      color={color}
      format={d.f}
      onChange={(v) => setParam(k, v)}
      tag={tag}
      pickable={learning}
      picked={target === k}
      onPick={() =>
        useRuntime.setState({ learnTarget: k, learnMsg: `Teraz przekręć gałkę na kontrolerze, która ma sterować: ${d.l}.` })
      }
    />
  )
}

export function Presets() {
  const preset = useStore((s) => s.preset)
  const applyPreset = useStore((s) => s.applyPreset)
  return (
    <div className="presets" role="group" aria-label="Presety">
      {Object.keys(PRESETS).map((name) => (
        <button
          key={name}
          className="chip"
          aria-pressed={preset === name}
          onClick={() => {
            engine.ensure()
            applyPreset(name)
            if (!sequencer.playing) {
              const t = engine.now() + 0.02
              const P = engine.P
              engine.noteOn(29, t)
              engine.noteOff(t + Math.max(0.6, (P.gate * sequencer.stepDur()), P.attack + 0.2))
            }
          }}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

export function Rack() {
  return (
    <div className="rack">
      {SECTIONS.map((s) => (
        <section className="sec" key={s.t}>
          <h2>
            <i style={{ background: s.c }} />
            {s.t}
          </h2>
          <div className="knobs">
            {s.k.map((k) => (
              <ParamKnob key={k} k={k} color={s.c} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
