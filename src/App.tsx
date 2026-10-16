import { useEffect, useRef, useState, type ReactNode } from 'react'
import { engine } from './audio/engine'
import { loadTrack, togglePlay, toggleRecord } from './control'
import { TABS, useRuntime, useStore, type Tab } from './store'
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
import { TrackSlicer } from './components/TrackSlicer'

function Transport() {
  const playing = useRuntime((s) => s.playing)
  const recState = useRuntime((s) => s.recState)
  const bpm = useStore((s) => s.bpm)
  const setBpm = useStore((s) => s.setBpm)
  const [bpmText, setBpmText] = useState(String(bpm))
  useEffect(() => setBpmText(String(bpm)), [bpm])
  return (
    <div className="transport">
      <button className="btn play" aria-pressed={playing} title="Start i stop (spacja)" onClick={togglePlay}>
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
      <button
        className={'btn rec top-rec ' + recState}
        aria-pressed={recState !== 'idle'}
        title="Nagrywanie (R). Ustawienia w sekcji Sampler."
        onClick={() => toggleRecord()}
      >
        {recState === 'recording' ? '■ Nagrywam' : recState === 'waiting' ? 'Czekam…' : '● Nagraj'}
      </button>
    </div>
  )
}

/** Small dot on a tab when something in it needs attention (playing, muted…). */
function useTabMarks(): Partial<Record<Tab, string>> {
  const padsOn = useRuntime((s) => s.padsOn)
  const recState = useRuntime((s) => s.recState)
  const mix = useStore((s) => s.mix)
  const muted = Object.values(mix).some((c) => c.mute || c.solo)
  return {
    sampler: recState !== 'idle' ? 'rec' : padsOn.some(Boolean) ? 'on' : undefined,
    mikser: muted ? 'warn' : undefined,
  }
}

function Tabs() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const marks = useTabMarks()
  const title: Partial<Record<Tab, string>> = {
    sampler: marks.sampler === 'rec' ? 'trwa nagrywanie' : marks.sampler ? 'grają pady' : undefined,
    mikser: marks.mikser ? 'któryś kanał jest wyciszony albo na solo' : undefined,
  }
  return (
    <nav className="tabs" aria-label="Sekcje">
      {TABS.map((t, i) => (
        <button
          key={t.id}
          className="tab"
          aria-current={tab === t.id ? 'page' : undefined}
          title={`${t.label} (Shift+${i + 1})${title[t.id] ? ': ' + title[t.id] : ''}`}
          onClick={() => {
            setTab(t.id)
            window.scrollTo({ top: 0 })
          }}
        >
          {t.label}
          {marks[t.id] && <i className={'mark ' + marks[t.id]} aria-label={title[t.id]} />}
        </button>
      ))}
    </nav>
  )
}

function Page({ id, children }: { id: Tab; children: ReactNode }) {
  const tab = useStore((s) => s.tab)
  // pages stay mounted so their state (slicer selection, editors) survives switching
  return (
    <div className="page" hidden={tab !== id}>
      {children}
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Spacja', 'start i stop wzoru'],
  ['A W S E D F T G Y H U J K', 'klawisze syntezatora (dwa naraz = slide)'],
  ['Z / X', 'oktawa niżej / wyżej'],
  ['1–8', 'pady samplera'],
  ['R', 'nagrywanie'],
  ['Shift+1…5', 'sekcje: Bas, Bębny, Sampler, Mikser, Więcej'],
]

function Help() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Skróty klawiszowe</h2>
        <span className="hint">Działają w każdej sekcji. Plik audio możesz przeciągnąć w dowolne miejsce strony.</span>
      </div>
      <dl className="keys">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
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

/** Dropping an audio file anywhere opens the Sampler section and loads it for slicing. */
function useFileDrop() {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const f = e.dataTransfer!.files[0]
      if (!f) return
      useStore.getState().setTab('sampler')
      window.scrollTo({ top: 0 })
      if (!useRuntime.getState().trackStatus) loadTrack(f)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}

export function App() {
  const audioLocked = useRuntime((s) => s.audioLocked)
  const dropping = useFileDrop()
  return (
    <>
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <h1>
              Bass <span>Drop</span>
            </h1>
          </div>
          <Transport />
        </div>
        <Tabs />
      </header>
      <main className="wrap">
        <Page id="bas">
          <Presets />
          <Screen />
          <Rack />
          <Sequencer />
          <Piano />
        </Page>
        <Page id="bebny">
          <DrumMachine />
        </Page>
        <Page id="sampler">
          <Sampler />
          <TrackSlicer />
          <RecorderPanel />
          <ClipLibrary />
        </Page>
        <Page id="mikser">
          <Mixer />
        </Page>
        <Page id="wiecej">
          <MidiPanel />
          <Help />
          <FileFacts />
        </Page>
      </main>
      {dropping && (
        <div className="dropzone" aria-hidden="true">
          <p>Upuść plik, żeby pociąć go na pętle</p>
        </div>
      )}
      {audioLocked && (
        <button className="btn unlock" onClick={() => engine.ctx?.resume()}>
          Kliknij, żeby włączyć dźwięk
        </button>
      )}
    </>
  )
}
