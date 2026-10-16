/**
 * Glue between inputs (screen, computer keyboard, MIDI) and the audio modules.
 * Everything here works outside React and reads state with getState().
 */
import { engine } from './audio/engine'
import { recorder } from './audio/recorder'
import { sampler, type Pad } from './audio/sampler'
import { slicer, TrackError } from './audio/slicer'
import { sequencer } from './audio/sequencer'
import { computePeaks, deleteClipAudio, saveClipAudio } from './lib/clips'
import { PAD_COUNT, TABS, useRuntime, useStore } from './store'

/* ---------- synth notes: mono, last-note priority, legato = slide ---------- */
const held: number[] = []
let sustainDown = false
let pendingOff = false

const syncDown = () => useRuntime.setState({ down: held.slice() })

export function press(m: number, vel = 1) {
  engine.ensure()
  const legato = held.length > 0 && engine.P.glide > 0.001
  const i = held.indexOf(m)
  if (i >= 0) held.splice(i, 1)
  held.push(m)
  pendingOff = false
  engine.noteOn(m, engine.now(), legato, vel)
  syncDown()
}

export function release(m: number) {
  const i = held.indexOf(m)
  if (i < 0) return
  held.splice(i, 1)
  syncDown()
  if (engine.voiceMidi !== m) return
  if (held.length) engine.noteOn(held[held.length - 1], engine.now(), engine.P.glide > 0.001)
  else if (sustainDown) pendingOff = true
  else engine.noteOff()
}

export function setSustain(on: boolean) {
  sustainDown = on
  if (!on && pendingOff && !held.length) {
    engine.noteOff()
    pendingOff = false
  }
}

export function panic() {
  held.length = 0
  sustainDown = false
  pendingOff = false
  engine.setBend(0)
  if (engine.ctx) engine.noteOff()
  sampler.stopAll()
  syncDown()
}

/* ---------- transport ---------- */
sequencer.getSteps = () => useStore.getState().steps
sequencer.getBpm = () => useStore.getState().bpm
sequencer.getDrumSteps = () => useStore.getState().drumSteps
sequencer.onPlayingChange = (p) => useRuntime.setState({ playing: p })

export function togglePlay() {
  if (sequencer.playing) sequencer.stop()
  else sequencer.start()
}

/* ---------- pads ---------- */
sampler.onChange = () => {
  useRuntime.setState({ padsOn: Array.from({ length: PAD_COUNT }, (_, i) => sampler.isPlaying('pad' + i)) })
}

function padWhen(i: number) {
  const pad = useStore.getState().pads[i]
  return pad.sync && sequencer.playing ? (sequencer.nextBeatTime() ?? undefined) : undefined
}

export function padDown(i: number) {
  const st = useStore.getState()
  const pad = st.pads[i]
  if (st.selectedPad !== i) st.selectPad(i)
  if (!pad || !pad.clipId) return
  engine.ensure()
  const key = 'pad' + i
  if (pad.mode === 'toggle' && sampler.isPlaying(key)) {
    sampler.stop(key, padWhen(i))
    return
  }
  sampler.play(key, pad.clipId, pad, padWhen(i))
}

export function padUp(i: number) {
  const pad = useStore.getState().pads[i]
  if (pad && pad.mode === 'hold') sampler.stop('pad' + i)
}

/* ---------- recording ---------- */
recorder.onState = (s) => useRuntime.setState({ recState: s })
recorder.onError = (msg) => {
  useRuntime.setState({ recError: msg })
  useStore.getState().setRec({ recSource: 'out' })
}

let recBarsUsed: number | null = null

export async function toggleRecord() {
  if (recorder.state !== 'idle') {
    recorder.stop()
    return
  }
  useRuntime.setState({ recError: null })
  const st = useStore.getState()
  try {
    await recorder.init()
    await recorder.setSource(st.recSource)
  } catch {
    return
  }
  const bars = st.recBars
  recBarsUsed = bars > 0 ? bars : null
  if (bars > 0) {
    const dur = bars * sequencer.barDur()
    // free-running pattern: wait for the next bar; stopped pattern: start it now and record from step 1
    const at = sequencer.playing ? sequencer.nextBarTime()! : sequencer.start()
    await recorder.start({ at, duration: dur })
  } else {
    await recorder.start()
  }
}

recorder.onDone = (ch, sr) => {
  const st = useStore.getState()
  const id = storeClip(ch, sr, 'Nagranie ' + (st.clips.length + 1), recBarsUsed)
  // drop it on the selected pad if empty, otherwise on the first empty pad
  const pads = useStore.getState().pads
  let target = pads[st.selectedPad].clipId ? pads.findIndex((p) => !p.clipId) : st.selectedPad
  if (target >= 0) {
    st.assignClip(target, id)
    st.selectPad(target)
  }
}

/** Saves new audio as a clip (sampler, IndexedDB, library) and returns its id. */
function storeClip(ch: Float32Array[], sr: number, name: string, bars: number | null) {
  const id = crypto.randomUUID()
  sampler.setClip(id, ch, sr)
  saveClipAudio(id, { sr, ch }).catch(() =>
    useRuntime.setState({ recError: 'Nie udało się zapisać nagrania w przeglądarce (brak miejsca?). Pobierz je jako WAV.' }),
  )
  useStore.getState().addClip({
    id,
    name,
    duration: ch[0].length / sr,
    sr,
    created: Date.now(),
    bars,
    peaks: computePeaks(ch),
  })
  return id
}

export async function removeClip(id: string) {
  const st = useStore.getState()
  st.pads.forEach((p, i) => p.clipId === id && sampler.stop('pad' + i))
  sampler.stop('prev:' + id)
  sampler.removeClip(id)
  st.removeClip(id)
  await deleteClipAudio(id).catch(() => {})
}

/* ---------- computer keyboard ---------- */
const KMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
}
const downCodes: Record<string, number> = {}
const padCodes: Record<string, number> = {}

export function installKeyboard() {
  const onDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.matches('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      const st = useStore.getState()
      panic()
      st.setOctave(st.octave + (e.code === 'KeyX' ? 1 : -1))
      return
    }
    if (e.code === 'Space' && !t.matches('button')) {
      e.preventDefault()
      togglePlay()
      return
    }
    if (e.code === 'KeyR') {
      toggleRecord()
      return
    }
    const d = /^Digit([1-8])$/.exec(e.code)
    if (d && e.shiftKey) {
      // Shift+1…5 switches sections
      const tab = TABS[+d[1] - 1]
      if (tab) useStore.getState().setTab(tab.id)
      return
    }
    if (d) {
      const i = +d[1] - 1
      padCodes[e.code] = i
      padDown(i)
      return
    }
    const o = KMAP[e.code]
    if (o == null) return
    e.preventDefault()
    const m = (useStore.getState().octave + 1) * 12 + o
    downCodes[e.code] = m
    press(m)
  }
  const onUp = (e: KeyboardEvent) => {
    if (e.code in downCodes) {
      release(downCodes[e.code])
      delete downCodes[e.code]
    }
    if (e.code in padCodes) {
      padUp(padCodes[e.code])
      delete padCodes[e.code]
    }
  }
  const onBlur = () => {
    for (const c in downCodes) {
      release(downCodes[c])
      delete downCodes[c]
    }
  }
  window.addEventListener('keydown', onDown)
  window.addEventListener('keyup', onUp)
  window.addEventListener('blur', onBlur)
}

/* ---------- audio unlock: MIDI may arrive before the first click ---------- */
export function installAudioUnlock() {
  window.setInterval(() => {
    const locked = !!engine.ctx && engine.ctx.state !== 'running'
    if (locked !== useRuntime.getState().audioLocked) useRuntime.setState({ audioLocked: locked })
  }, 400)
  document.addEventListener(
    'pointerdown',
    () => {
      if (engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume().catch(() => {})
    },
    true,
  )
}

/* ---------- imported track → pads ---------- */
let trackSeq = 0

export async function loadTrack(file: File) {
  useRuntime.setState({ trackStatus: 'Wczytuję plik…', trackError: null })
  try {
    const buf = await slicer.load(file)
    useRuntime.setState({ track: null, trackStatus: 'Szukam tempa i taktów…' })
    const a = await slicer.analyse()
    const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
    useRuntime.setState({
      track: {
        id: ++trackSeq,
        name: file.name.replace(/\.[^.]+$/, '') || 'Kawałek',
        duration: buf.duration,
        peaks: computePeaks(ch, 1600),
        detectedBpm: a.bpm,
        bpm: a.bpm,
        t0: a.t0,
      },
      trackStatus: null,
    })
  } catch (e) {
    useRuntime.setState({
      trackStatus: null,
      trackError: e instanceof TrackError ? e.message : 'Coś poszło nie tak przy wczytywaniu pliku.',
    })
  }
}

export interface Slice {
  /** pad index */
  pad: number
  /** start in the track (s) */
  start: number
  /** length in the track (s) */
  dur: number
  name: string
  bars: number | null
}

/**
 * Cuts slices out of the loaded track and puts each on its pad. Loops with `bars` set are
 * resampled to the project tempo when `fitBpm` is given, so they line up with the pattern.
 */
export async function slicesToPads(slices: Slice[], trackBpm: number, fitBpm: number | null, pad: Partial<Pad>) {
  const b = slicer.buf
  if (!b) return
  for (const s of slices) {
    const rate = s.bars && fitBpm ? fitBpm / trackBpm : 1
    const outDur = s.bars && fitBpm ? (s.bars * 240) / fitBpm : s.dur
    const ch = await slicer.render(s.start, outDur, rate)
    const id = storeClip(ch, b.sampleRate, s.name, s.bars)
    const st = useStore.getState()
    st.assignClip(s.pad, id)
    if (Object.keys(pad).length) st.updatePad(s.pad, pad)
  }
  useStore.getState().selectPad(slices[0]?.pad ?? useStore.getState().selectedPad)
}
