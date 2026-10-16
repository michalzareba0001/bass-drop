/**
 * Beat analysis for imported tracks: onset strength envelope (spectral flux), tempo,
 * bar grid and individual hits. Pure functions with no DOM or Web Audio, so they can
 * run in a worker (beats.worker.ts).
 */

export interface Analysis {
  /** onset strength per frame, roughly 0..1 */
  env: Float32Array
  /** seconds between frames */
  hop: number
  /** time of frame 0 (s) */
  lat: number
  bpm: number
  /** time of a downbeat, 0 <= t0 < one bar */
  t0: number
}

function makeFFT(n: number) {
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = -Math.sin((2 * Math.PI * i) / n)
  }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j
          const b = a + half
          const tr = re[b] * cos[k] - im[b] * sin[k]
          const ti = re[b] * sin[k] + im[b] * cos[k]
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
  }
}

/** Moving average over ±w frames. */
function movingMean(x: Float32Array, w: number) {
  const n = x.length
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w)
    const b = Math.min(n, i + w + 1)
    out[i] = (pre[b] - pre[a]) / (b - a)
  }
  return out
}

/** Remove the slow-moving level, keep only the rises, scale so the 99th percentile is 1. */
function shape(x: Float32Array, w: number) {
  const m = movingMean(x, w)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = Math.max(0, x[i] - m[i])
  const sorted = Float32Array.from(out).sort()
  const ref = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1] || 1
  for (let i = 0; i < out.length; i++) out[i] /= ref
  return out
}

const at = (x: Float32Array, t: number) => {
  const i = Math.floor(t)
  const f = t - i
  return x[i] * (1 - f) + (x[i + 1] ?? 0) * f
}

/** Mean envelope value on a beat grid of period P (frames) starting at phase. */
function comb(env: Float32Array, P: number, phase: number) {
  let s = 0
  let c = 0
  for (let t = phase; t < env.length - 1; t += P) {
    s += at(env, t)
    c++
  }
  return c ? s / c : 0
}

function bestPhase(env: Float32Array, P: number, step: number, from = 0, to = P): [number, number] {
  let best = -1
  let bestPh = 0
  for (let p = from; p < to; p += step) {
    const ph = ((p % P) + P) % P
    const s = comb(env, P, ph)
    if (s > best) {
      best = s
      bestPh = ph
    }
  }
  return [best, bestPh]
}

/**
 * Autocorrelation tempo with a prior around 120 BPM (one octave wide) against double/half errors.
 * The envelope is compressed first so a loud backbeat snare does not halve the tempo.
 * Weights were tuned on synthetic boom-bap, trap, house and backbeat patterns.
 */
function roughTempo(envIn: Float32Array, hop: number) {
  const env = envIn.map((v) => Math.pow(v, 0.6))
  const n = env.length
  const lagMin = Math.floor(60 / 200 / hop)
  const lagMax = Math.ceil(60 / 60 / hop)
  const score = new Float64Array(lagMax + 2)
  for (let L = lagMin - 1; L <= lagMax + 1; L++) {
    let s = 0
    for (let i = 0; i + L < n; i++) s += env[i] * env[i + L]
    const bpm = 60 / (L * hop)
    score[L] = (s / (n - L)) * Math.exp(-0.5 * Math.log2(bpm / 120) ** 2)
  }
  let L = lagMin
  for (let k = lagMin; k <= lagMax; k++) if (score[k] > score[L]) L = k
  // parabolic interpolation between neighbouring lags
  const a = score[L - 1]
  const b = score[L]
  const c = score[L + 1]
  const den = a - 2 * b + c
  const lag = den < 0 ? L + (0.5 * (a - c)) / den : L
  return 60 / (lag * hop)
}

export function analyse(x: Float32Array, sr: number): Analysis {
  const N = sr > 50000 ? 2048 : 1024
  const H = N / 2
  const hop = H / sr
  const frames = Math.floor((x.length - N) / H) + 1
  if (!(frames > 4 / hop)) throw new Error('too short')
  const fft = makeFFT(N)
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const prev = new Float64Array(N / 2 + 1)
  const flux = new Float32Array(frames)
  const low = new Float32Array(frames)
  const body = new Float32Array(frames)
  const lowK = Math.max(2, Math.round(150 / (sr / N)))
  const bodyK = Math.round(4000 / (sr / N))
  for (let n = 0; n < frames; n++) {
    const o = n * H
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    let f = 0
    let l = 0
    let bd = 0
    for (let k = 1; k <= N / 2; k++) {
      const m = Math.log1p((400 / N) * Math.sqrt(re[k] * re[k] + im[k] * im[k]))
      const d = m - prev[k]
      prev[k] = m
      if (d > 0) {
        f += d
        if (k <= lowK) l += d
        if (k <= bodyK) bd += d
      }
    }
    flux[n] = n ? f : 0
    low[n] = n ? l : 0
    body[n] = n ? bd : 0
  }
  const w = Math.round(0.25 / hop)
  const env = shape(flux, w)
  const lowEnv = shape(low, w)
  const midEnv = shape(body.map((v, i) => v - low[i]), w)

  // tempo: a rough estimate leaning on kick and snare (bright hats alone double slow beats),
  // then the beat grid that best fits the whole track
  const bodyEnv = shape(body, w)
  const rough = roughTempo(bodyEnv.map((v, i) => 0.3 * v + 0.7 * env[i]), hop)
  let bpm = rough
  let score = -1
  let phase = 0
  for (let b = rough * 0.97; b <= rough * 1.03; b += 0.05) {
    const [s, ph] = bestPhase(env, 60 / b / hop, 0.5)
    if (s > score) [score, phase, bpm] = [s, ph, b]
  }
  const coarse = bpm
  for (let b = coarse - 0.06; b <= coarse + 0.06; b += 0.005) {
    const P = 60 / b / hop
    const [s, ph] = bestPhase(env, P, 0.1, phase - 1.5, phase + 1.5)
    if (s > score) [score, phase, bpm] = [s, ph, b]
  }
  // most produced music sits on a whole BPM: prefer it when it fits nearly as well
  const whole = Math.round(bpm)
  if (Math.abs(bpm - whole) < 0.1) {
    const P = 60 / whole / hop
    const [s, ph] = bestPhase(env, P, 0.1, phase - 2, phase + 2)
    if (s >= score * 0.98) [phase, bpm] = [ph, whole]
  }

  // downbeat: the beat of four with the most kick-like attacks (lots of low end, little middle)
  const P = 60 / bpm / hop
  let bestR = 0
  let bestS = -1
  for (let r = 0; r < 4; r++) {
    let s = 0
    for (let t = phase + r * P; t < env.length - 1; t += 4 * P) s += at(lowEnv, t) - 0.5 * at(midEnv, t)
    if (s > bestS) [bestS, bestR] = [s, r]
  }
  // where in a frame an attack shows up, measured on synthetic beats
  const lat = (0.9 * H) / sr
  const bar = 240 / bpm
  const t0 = (((lat + (phase + bestR * P) * hop) % bar) + bar) % bar
  return { env, hop, lat, bpm, t0 }
}

/** Times (s) of individual hits. sens 0..1: higher finds quieter hits. */
export function pickOnsets(a: Analysis, sens: number): number[] {
  const { env, hop, lat } = a
  const w = Math.max(1, Math.round(0.03 / hop))
  const mean = movingMean(env, Math.round(0.5 / hop))
  const delta = 0.04 + (1 - sens) * 0.4
  const gap = Math.round(0.06 / hop)
  const out: number[] = []
  let last = -Infinity
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i]
    if (v < mean[i] + delta || i - last < gap) continue
    let peak = true
    for (let j = Math.max(0, i - w); j <= Math.min(env.length - 1, i + w); j++) {
      if (env[j] > v || (j < i && env[j] === v)) {
        peak = false
        break
      }
    }
    if (!peak) continue
    out.push(lat + i * hop)
    last = i
  }
  return out
}
