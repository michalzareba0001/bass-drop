import { useEffect, useState } from 'react'
import { engine } from './audio/engine'
import { togglePlay } from './control'
import { useRuntime, useStore } from './store'
import { ClipLibrary } from './components/ClipLibrary'
import { DrumMachine } from './components/DrumMachine'
import { Mixer } from './components/Mixer'
import { MidiPanel } from './components/MidiPanel'
import { Piano } from './components/Piano'
import { Presets, Rack } from './components/Rack'
import { RecorderPanel } from './components/RecorderPanel'
import { Sampler } from './components/Sampler'
import { Screen } from './components/Screen'
import { Sequencer } from './components/Sequencer'

function Transport() {
  const playing = useRuntime((s) => s.playing)
  const bpm = useStore((s) => s.bpm)
  const setBpm = useStore((s) => s.setBpm)
  const clearSteps = useStore((s) => s.clearSteps)
  const [bpmText, setBpmText] = useState(String(bpm))
  useEffect(() => setBpmText(String(bpm)), [bpm])
  return (
    <div className="transport">
      <button className="btn play" aria-pressed={playing} onClick={togglePlay}>
        {playing ? '■ Stop' : '▶ Graj'}
      </button>
      <label className="bpm" htmlFor="bpm">
        BPM
        <input
          id="bpm"
          type="number"
          min={50}
          max={200}
          value={bpmText}
          onChange={(e) => setBpmText(e.target.value)}
          onBlur={() => setBpm(+bpmText)}
          onKeyDown={(e) => e.key === 'Enter' && setBpm(+bpmText)}
        />
      </label>
      <button className="btn" onClick={clearSteps}>
        Wyczyść wzór
      </button>
    </div>
  )
}

function FileFacts() {
  return (
    <section className="file">
      <h2>Co było w analizowanym pliku</h2>
      <dl className="facts">
        <div><dt>Rodzaj dźwięku</dt><dd>bas 808 z przesterem</dd></div>
        <div><dt>Główna nuta</dt><dd>F1 ≈ 43,7 Hz (też G1, G#1, A#1)</dd></div>
        <div><dt>Atak</dt><dd>start ~110–200 Hz, spadek w ~0,1 s</dd></div>
        <div><dt>Tempo</dt><dd>ok. 123 BPM (półtakt 61,5)</dd></div>
        <div><dt>Energia poniżej 60 Hz</dt><dd>53% całości</dd></div>
        <div><dt>Efekty</dt><dd>zjazd 80→30 Hz, podjazd 30→80 Hz</dd></div>
      </dl>
      <p className="msg">Te basy siedzą w okolicach 40–60 Hz. Słuchaj na słuchawkach albo z subwooferem, głośnik laptopa ich prawie nie odda.</p>
    </section>
  )
}

export function App() {
  const audioLocked = useRuntime((s) => s.audioLocked)
  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>
            Bass <span>Drop</span>
          </h1>
          <p>Bas 808, bębny, sampler pętli i mikser w przeglądarce.</p>
        </div>
        <Transport />
      </header>
      <Presets />
      <Screen />
      <Rack />
      <Sequencer />
      <DrumMachine />
      <Mixer />
      <Piano />
      <div className="duo">
        <RecorderPanel />
        <MidiPanel />
      </div>
      <Sampler />
      <ClipLibrary />
      <FileFacts />
      {audioLocked && (
        <button className="btn unlock" onClick={() => engine.ctx?.resume()}>
          Kliknij, żeby włączyć dźwięk
        </button>
      )}
    </div>
  )
}
