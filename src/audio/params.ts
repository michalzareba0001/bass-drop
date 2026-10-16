export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (m: number) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1)

export const fHz = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : v.toFixed(0) + ' Hz')
export const fS = (v: number) => (v < 1 ? (v * 1000).toFixed(0) + ' ms' : v.toFixed(2) + ' s')
export const fPct = (v: number) => Math.round(v * 100) + '%'
export const fSt = (v: number) => (v > 0 ? '+' : '') + Math.round(v) + ' st'

export type ParamKey =
  | 'shape' | 'click' | 'volume'
  | 'pitch' | 'pdecay' | 'glide' | 'bend' | 'bendTime'
  | 'attack' | 'decay' | 'sustain' | 'release' | 'gate'
  | 'drive' | 'cutoff' | 'res' | 'fenv'
  | 'lfoRate' | 'lfoDepth'

export interface Range {
  min: number
  max: number
  log?: boolean
  step?: number
}
export interface ParamDef extends Range {
  l: string
  v: number
  f: (v: number) => string
}

export const DEF: Record<ParamKey, ParamDef> = {
  shape: { l: 'Barwa', min: 0, max: 1, v: 0.1, f: fPct },
  click: { l: 'Klik', min: 0, max: 1, v: 0.2, f: fPct },
  volume: { l: 'Głośność', min: 0, max: 1, v: 0.8, f: fPct },
  pitch: { l: 'Spadek', min: 0, max: 36, v: 16, f: fSt, step: 1 },
  pdecay: { l: 'Czas spadku', min: 0.01, max: 0.6, v: 0.09, f: fS, log: true },
  glide: { l: 'Glide', min: 0, max: 1, v: 0.12, f: fS },
  bend: { l: 'Zjazd', min: -24, max: 24, v: 0, f: fSt, step: 1 },
  bendTime: { l: 'Czas zjazdu', min: 0.2, max: 8, v: 3, f: fS, log: true },
  attack: { l: 'Atak', min: 0.001, max: 1.5, v: 0.002, f: fS, log: true },
  decay: { l: 'Wybrzmienie', min: 0.05, max: 5, v: 1.2, f: fS, log: true },
  sustain: { l: 'Podtrzym.', min: 0, max: 1, v: 0.55, f: fPct },
  release: { l: 'Puszczenie', min: 0.02, max: 3, v: 0.35, f: fS, log: true },
  gate: { l: 'Długość nuty', min: 1, max: 16, v: 3, f: (v) => Math.round(v) + ' kr.', step: 1 },
  drive: { l: 'Przester', min: 0, max: 1, v: 0.45, f: fPct },
  cutoff: { l: 'Filtr', min: 60, max: 8000, v: 900, f: fHz, log: true },
  res: { l: 'Rezonans', min: 0.1, max: 18, v: 2, f: (v) => v.toFixed(1) },
  fenv: { l: 'Obwiednia filtra', min: 0, max: 1, v: 0.3, f: fPct },
  lfoRate: { l: 'Tempo LFO', min: 0.1, max: 16, v: 4, f: (v) => v.toFixed(1) + ' Hz', log: true },
  lfoDepth: { l: 'Głębokość', min: 0, max: 1, v: 0, f: fPct },
}

export type Params = Record<ParamKey, number>
export const defaultParams = (): Params =>
  Object.fromEntries(Object.entries(DEF).map(([k, d]) => [k, d.v])) as Params

export const toN = (r: Range, v: number) =>
  r.log ? Math.log(v / r.min) / Math.log(r.max / r.min) : (v - r.min) / (r.max - r.min)
export const fromN = (r: Range, n: number) => {
  n = clamp(n, 0, 1)
  let v = r.log ? r.min * Math.pow(r.max / r.min, n) : r.min + n * (r.max - r.min)
  if (r.step) v = Math.round(v / r.step) * r.step
  return v
}

export const SECTIONS: { t: string; c: string; k: ParamKey[] }[] = [
  { t: 'Oscylator', c: 'var(--red)', k: ['shape', 'click'] },
  { t: 'Wysokość', c: 'var(--orange)', k: ['pitch', 'pdecay', 'glide', 'bend', 'bendTime'] },
  { t: 'Głośność w czasie', c: 'var(--yellow)', k: ['attack', 'decay', 'sustain', 'release', 'gate'] },
  { t: 'Przester i filtr', c: 'var(--cream)', k: ['drive', 'cutoff', 'res', 'fenv'] },
  { t: 'Wobble (LFO na filtrze)', c: 'var(--muted)', k: ['lfoRate', 'lfoDepth'] },
]

export const PRESETS: Record<string, Partial<Params>> = {
  'Drop 808 (jak w pliku)': { shape: 0.1, click: 0.2, pitch: 16, pdecay: 0.09, glide: 0.12, bend: 0, attack: 0.002, decay: 1.2, sustain: 0.55, release: 0.35, drive: 0.45, cutoff: 900, res: 2, fenv: 0.3, lfoDepth: 0, gate: 3 },
  'Brudne 808': { shape: 0.3, click: 0.35, pitch: 19, pdecay: 0.07, glide: 0.1, bend: 0, attack: 0.002, decay: 1.6, sustain: 0.6, release: 0.4, drive: 0.88, cutoff: 2200, res: 1.5, fenv: 0.4, lfoDepth: 0, gate: 3 },
  'Czysty sub': { shape: 0, click: 0.1, pitch: 7, pdecay: 0.05, glide: 0.08, bend: 0, attack: 0.004, decay: 2, sustain: 0.7, release: 0.3, drive: 0, cutoff: 400, res: 0.7, fenv: 0, lfoDepth: 0, gate: 4 },
  'Długi slide': { shape: 0.15, click: 0.2, pitch: 14, pdecay: 0.1, glide: 0.4, bend: 0, attack: 0.002, decay: 3, sustain: 0.8, release: 0.5, drive: 0.55, cutoff: 1100, res: 2, fenv: 0.25, lfoDepth: 0, gate: 6 },
  'Zjazd w dół': { shape: 0.15, click: 0.25, pitch: 12, pdecay: 0.12, glide: 0.1, bend: -14, bendTime: 3, attack: 0.002, decay: 4, sustain: 0.85, release: 0.6, drive: 0.5, cutoff: 1200, res: 2, fenv: 0.2, lfoDepth: 0, gate: 16 },
  'Podjazd (riser)': { shape: 0.2, click: 0, pitch: 0, pdecay: 0.05, glide: 0.1, bend: 16, bendTime: 5, attack: 0.4, decay: 5, sustain: 1, release: 0.4, drive: 0.5, cutoff: 1500, res: 3, fenv: 0, lfoDepth: 0, gate: 16 },
  Wobble: { shape: 0.8, click: 0.1, pitch: 5, pdecay: 0.06, glide: 0.15, bend: 0, attack: 0.005, decay: 2, sustain: 0.9, release: 0.3, drive: 0.55, cutoff: 320, res: 9, fenv: 0.1, lfoRate: 4.1, lfoDepth: 0.85, gate: 8 },
}
export const DEFAULT_PRESET = 'Drop 808 (jak w pliku)'

/** Rows of the step grid: F minor, D#1..F2 */
export const ROWS = [41, 39, 37, 36, 34, 32, 31, 29, 27]
