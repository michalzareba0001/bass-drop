import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { engine } from './audio/engine'
import { clamp, DEF, DEFAULT_PRESET, defaultParams, PRESETS, type ParamKey, type Params } from './audio/params'
import { emptyPad, sampler, type Pad } from './audio/sampler'
import { STEPS, type Step } from './audio/sequencer'
import type { RecSource, RecState } from './audio/recorder'
import { defaultDrumCfg, drums, type DrumId, type DrumVoiceCfg } from './audio/drums'
import { defaultMixer, defaultSidechain, mixer, type SidechainCfg, type StripCfg } from './audio/mixer'

export interface ClipMeta {
  id: string
  name: string
  duration: number
  sr: number
  created: number
  bars: number | null // bar length it was recorded to, if any
  peaks: number[]
}

export interface MidiSettings {
  transpose: number
  pbRange: number
  velocity: boolean
  input: string
}

const defaultSteps = (): Step[] => {
  const s: Step[] = Array.from({ length: STEPS }, () => ({ note: null, slide: false }))
  const pat: [number, number, boolean?][] = [[0, 29], [3, 29], [6, 32], [8, 29], [10, 29], [11, 36, true], [13, 34], [14, 31, true]]
  for (const [i, n, sl] of pat) s[i] = { note: n, slide: !!sl }
  return s
}

export const PAD_COUNT = 8

const defaultDrumSteps = (): Record<DrumId, number[]> => {
  const row = (hits: Record<number, number>) => Array.from({ length: STEPS }, (_, i) => hits[i] ?? 0)
  return {
    kick: row({ 0: 1, 3: 1, 10: 1 }),
    snare: row({ 8: 1 }),
    clap: row({ 8: 1 }),
    chh: row({ 0: 1, 2: 1, 4: 1, 6: 1, 7: 2, 8: 1, 10: 1, 12: 3, 13: 3, 14: 1, 15: 2 }),
    ohh: row({ 11: 1 }),
  }
}

const STORAGE_KEY = 'bass-drop'
// carry over settings saved under the project's old name
try {
  const old = localStorage.getItem('sub-drop-808')
  if (old && !localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, old)
  localStorage.removeItem('sub-drop-808')
} catch {
  /* storage unavailable */
}

interface State {
  params: Params
  preset: string | null
  steps: Step[]
  bpm: number
  octave: number
  midi: MidiSettings
  ccMap: Record<string, ParamKey>
  clips: ClipMeta[]
  pads: Pad[]
  selectedPad: number
  recSource: RecSource
  recBars: number
  drumSteps: Record<DrumId, number[]>
  drumCfg: Record<DrumId, DrumVoiceCfg>
  mix: Record<string, StripCfg>
  sidechain: SidechainCfg

  setParam: (k: ParamKey, v: number) => void
  applyPreset: (name: string) => void
  toggleNote: (i: number, note: number) => void
  toggleSlide: (i: number) => void
  clearSteps: () => void
  setBpm: (b: number) => void
  setOctave: (o: number) => void
  setMidi: (m: Partial<MidiSettings>) => void
  mapCC: (cc: number, k: ParamKey) => void
  clearCC: () => void
  addClip: (c: ClipMeta) => void
  renameClip: (id: string, name: string) => void
  removeClip: (id: string) => void
  assignClip: (pad: number, clipId: string | null) => void
  updatePad: (i: number, p: Partial<Pad>) => void
  selectPad: (i: number) => void
  setRec: (r: Partial<Pick<State, 'recSource' | 'recBars'>>) => void
  setDrumStep: (id: DrumId, i: number, v: number) => void
  clearDrums: () => void
  setDrumCfg: (id: DrumId, c: Partial<DrumVoiceCfg>) => void
  setStrip: (id: string, c: Partial<StripCfg>) => void
  setSidechain: (c: Partial<SidechainCfg>) => void
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      params: defaultParams(),
      preset: DEFAULT_PRESET,
      steps: defaultSteps(),
      bpm: 123,
      octave: 1,
      midi: { transpose: -12, pbRange: 12, velocity: true, input: 'all' },
      ccMap: {},
      clips: [],
      pads: Array.from({ length: PAD_COUNT }, emptyPad),
      selectedPad: 0,
      recSource: 'out',
      recBars: 2,
      drumSteps: defaultDrumSteps(),
      drumCfg: defaultDrumCfg(),
      mix: defaultMixer(),
      sidechain: defaultSidechain(),

      setParam: (k, v) => {
        const d = DEF[k]
        v = clamp(v, d.min, d.max)
        engine.setParam(k, v)
        set((s) => ({ params: { ...s.params, [k]: v }, preset: null }))
      },
      applyPreset: (name) => {
        const params = { ...get().params, ...PRESETS[name] }
        engine.setParams(params)
        set({ params, preset: name })
      },
      toggleNote: (i, note) =>
        set((s) => {
          const steps = s.steps.slice()
          const on = steps[i].note === note
          steps[i] = { note: on ? null : note, slide: on ? false : steps[i].slide }
          return { steps }
        }),
      toggleSlide: (i) =>
        set((s) => {
          if (s.steps[i].note == null) return {}
          const steps = s.steps.slice()
          steps[i] = { ...steps[i], slide: !steps[i].slide }
          return { steps }
        }),
      clearSteps: () => set({ steps: Array.from({ length: STEPS }, () => ({ note: null, slide: false })) }),
      setBpm: (b) => set({ bpm: clamp(Math.round(b) || 123, 50, 200) }),
      setOctave: (o) => set({ octave: clamp(o, 0, 4) }),
      setMidi: (m) => set((s) => ({ midi: { ...s.midi, ...m } })),
      mapCC: (cc, k) =>
        set((s) => {
          const ccMap: Record<string, ParamKey> = {}
          for (const [c, p] of Object.entries(s.ccMap)) if (p !== k) ccMap[c] = p
          ccMap[cc] = k
          return { ccMap }
        }),
      clearCC: () => set({ ccMap: {} }),
      addClip: (c) => set((s) => ({ clips: [c, ...s.clips] })),
      renameClip: (id, name) => set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, name } : c)) })),
      removeClip: (id) =>
        set((s) => ({
          clips: s.clips.filter((c) => c.id !== id),
          pads: s.pads.map((p) => (p.clipId === id ? emptyPad() : p)),
        })),
      assignClip: (i, clipId) =>
        set((s) => {
          sampler.stop('pad' + i)
          const pads = s.pads.slice()
          pads[i] = { ...emptyPad(), clipId }
          return { pads }
        }),
      updatePad: (i, p) =>
        set((s) => {
          const pads = s.pads.slice()
          pads[i] = { ...pads[i], ...p }
          sampler.update('pad' + i, pads[i])
          return { pads }
        }),
      selectPad: (i) => set({ selectedPad: i }),
      setRec: (r) => set(r),
      setDrumStep: (id, i, v) =>
        set((s) => {
          const row = s.drumSteps[id].slice()
          row[i] = v
          return { drumSteps: { ...s.drumSteps, [id]: row } }
        }),
      clearDrums: () =>
        set((s) => ({
          drumSteps: Object.fromEntries(Object.keys(s.drumSteps).map((k) => [k, Array(STEPS).fill(0)])) as Record<DrumId, number[]>,
        })),
      setDrumCfg: (id, c) =>
        set((s) => {
          const drumCfg = { ...s.drumCfg, [id]: { ...s.drumCfg[id], ...c } }
          drums.configure(drumCfg)
          return { drumCfg }
        }),
      setStrip: (id, c) =>
        set((s) => {
          const mix = { ...s.mix, [id]: { ...s.mix[id], ...c } }
          mixer.configure(mix, s.sidechain)
          return { mix }
        }),
      setSidechain: (c) =>
        set((s) => {
          const sidechain = { ...s.sidechain, ...c }
          mixer.configure(s.mix, sidechain)
          return { sidechain }
        }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({
        params: s.params,
        preset: s.preset,
        steps: s.steps,
        bpm: s.bpm,
        octave: s.octave,
        midi: s.midi,
        ccMap: s.ccMap,
        clips: s.clips,
        pads: s.pads,
        selectedPad: s.selectedPad,
        recBars: s.recBars,
        drumSteps: s.drumSteps,
        drumCfg: s.drumCfg,
        mix: s.mix,
        sidechain: s.sidechain,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>
        return {
          ...current,
          ...p,
          params: { ...current.params, ...(p.params ?? {}) },
          midi: { ...current.midi, ...(p.midi ?? {}) },
          drumCfg: { ...current.drumCfg, ...(p.drumCfg ?? {}) },
          drumSteps: { ...current.drumSteps, ...(p.drumSteps ?? {}) },
          mix: { ...current.mix, ...(p.mix ?? {}) },
          sidechain: { ...current.sidechain, ...(p.sidechain ?? {}) },
        }
      },
    },
  ),
)

/** Short-lived UI state that is not saved. */
interface Runtime {
  playing: boolean
  recState: RecState
  recError: string | null
  down: number[]
  padsOn: boolean[]
  learning: boolean
  learnTarget: ParamKey | null
  learnMsg: string | null
  midiStatus: string
  midiInputs: { id: string; name: string }[]
  audioLocked: boolean
}

export const useRuntime = create<Runtime>()(() => ({
  playing: false,
  recState: 'idle',
  recError: null,
  down: [],
  padsOn: Array(PAD_COUNT).fill(false),
  learning: false,
  learnTarget: null,
  learnMsg: null,
  midiStatus: 'MIDI: sprawdzam…',
  midiInputs: [],
  audioLocked: false,
}))
