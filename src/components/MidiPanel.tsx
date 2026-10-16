import { useEffect, useRef } from 'react'
import { connectMidi, onMidiActivity } from '../audio/midi'
import { panic } from '../control'
import { useRuntime, useStore } from '../store'

const HELP =
  'Kółko modulacji steruje wobble, pedał sustain przytrzymuje nutę, pitch bend robi zjazdy na żywo. Pady na kanale 10 (nuty 36–43) odpalają pady samplera.'

export function MidiPanel() {
  const midi = useStore((s) => s.midi)
  const setMidi = useStore((s) => s.setMidi)
  const clearCC = useStore((s) => s.clearCC)
  const { midiStatus, midiInputs, learning, learnMsg } = useRuntime()
  const led = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let t = 0
    onMidiActivity(() => {
      led.current?.classList.add('on')
      clearTimeout(t)
      t = window.setTimeout(() => led.current?.classList.remove('on'), 80)
    })
  }, [])

  const setLearning = (on: boolean) =>
    useRuntime.setState({
      learning: on,
      learnTarget: null,
      learnMsg: on ? 'Kliknij gałkę na ekranie, a potem przekręć gałkę na kontrolerze. Możesz przypisać kilka po kolei.' : null,
    })

  return (
    <section className="panel midi-sec" aria-labelledby="midiH">
      <h2 id="midiH">
        <span className="led" ref={led} />
        Kontroler MIDI
      </h2>
      <div className="mrow">
        <label htmlFor="midiIn">
          Wejście
          <select id="midiIn" value={midi.input} onChange={(e) => setMidi({ input: e.target.value })}>
            <option value="all">Wszystkie</option>
            {midiInputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="midiOct">
          Transpozycja
          <select
            id="midiOct"
            value={midi.transpose}
            onChange={(e) => {
              panic()
              setMidi({ transpose: +e.target.value })
            }}
          >
            <option value={-24}>−2 okt.</option>
            <option value={-12}>−1 okt.</option>
            <option value={0}>0</option>
            <option value={12}>+1 okt.</option>
          </select>
        </label>
        <label htmlFor="pbRange">
          Pitch bend
          <select id="pbRange" value={midi.pbRange} onChange={(e) => setMidi({ pbRange: +e.target.value })}>
            {[2, 7, 12, 24].map((v) => (
              <option key={v} value={v}>
                ±{v} st
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="velOn">
          <input id="velOn" type="checkbox" checked={midi.velocity} onChange={(e) => setMidi({ velocity: e.target.checked })} />
          Dynamika
        </label>
      </div>
      <div className="mrow">
        <button className="btn sm" onClick={connectMidi}>
          Połącz MIDI
        </button>
        <button className="btn sm learn" aria-pressed={learning} onClick={() => setLearning(!learning)}>
          {learning ? 'Gotowe' : 'Przypisz gałki'}
        </button>
        <button className="btn sm" onClick={clearCC}>
          Usuń przypisania
        </button>
        <button className="btn sm" onClick={panic}>
          Wycisz wszystko
        </button>
      </div>
      <p className="msg">MIDI: {midiStatus}</p>
      <p className="msg">{learnMsg ?? HELP}</p>
    </section>
  )
}
