import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { pickOnsets } from '../audio/beats'
import { slicer, PRE_ROLL } from '../audio/slicer'
import { loadTrack, slicesToPads, type Slice } from '../control'
import { computePeaks } from '../lib/clips'
import { PAD_COUNT, useRuntime, useStore, type TrackInfo } from '../store'

type Mode = 'loops' | 'hits'

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
const pl = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
const fBpm = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2)).replace('.', ',')
const fTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const mod = (v: number, m: number) => ((v % m) + m) % m
const PAD_COL = ['--red', '--red', '--orange', '--orange', '--yellow', '--yellow', '--cream', '--cream']

export function TrackSlicer() {
  const track = useRuntime((s) => s.track)
  const status = useRuntime((s) => s.trackStatus)
  const error = useRuntime((s) => s.trackError)
  const input = useRef<HTMLInputElement>(null)
  const pick = (f?: File | null) => {
    if (f && !status) loadTrack(f)
  }

  return (
    <section className="panel slicer">
      <div className="panel-head">
        <h2>Kawałek → pętle</h2>
        <span className="hint">Apka sama znajdzie tempo i takty. Wycięte pętle trafiają na pady i do Nagrań, sam plik nie jest zapisywany.</span>
      </div>
      <div className="mrow">
        <button className="btn" disabled={!!status} onClick={() => input.current?.click()}>
          {track ? 'Wczytaj inny plik' : 'Wczytaj plik'}
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {status ? (
          <span className="busy" role="status">
            {status}
          </span>
        ) : (
          !track && <span className="hint">albo przeciągnij go w dowolne miejsce strony: mp3, wav, m4a, ogg</span>
        )}
      </div>
      {error && <p className="msg err">{error}</p>}
      {track && <TrackEditor key={track.id} track={track} />}
    </section>
  )
}

function TrackEditor({ track }: { track: TrackInfo }) {
  const projBpm = useStore((s) => s.bpm)
  const setProjBpm = useStore((s) => s.setBpm)
  const pads = useStore((s) => s.pads)
  const selectedPad = useStore((s) => s.selectedPad)
  useRuntime((s) => s.padsOn) // re-render when previews start and stop
  const [mode, setMode] = useState<Mode>('loops')
  const [bars, setBars] = useState(2)
  const [sel, setSel] = useState(0)
  const [sens, setSens] = useState(0.5)
  const [fit, setFit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [bpmText, setBpmText] = useState(fBpm(track.bpm))
  const loopPreview = useRef(false)

  const { bpm, t0, duration } = track
  useEffect(() => setBpmText(fBpm(bpm)), [bpm])
  useEffect(() => () => slicer.stopPreview(), [])

  const bar = 240 / bpm
  const nBars = Math.max(1, Math.floor((duration - t0) / bar))
  const span = Math.min(bars, nBars)
  const first = Math.min(sel, nBars - span)
  const selStart = t0 + first * bar
  const selEnd = selStart + span * bar

  const setGrid = (g: Partial<Pick<TrackInfo, 'bpm' | 't0'>>) =>
    useRuntime.setState((s) => {
      if (!s.track) return {}
      const nb = g.bpm ?? s.track.bpm
      return { track: { ...s.track, bpm: nb, t0: mod(g.t0 ?? s.track.t0, 240 / nb) } }
    })
  const commitBpm = (v: number) => {
    if (v >= 40 && v <= 250) setGrid({ bpm: Math.round(v * 100) / 100 })
    else setBpmText(fBpm(bpm))
  }

  const onsets = useMemo(() => (slicer.analysis ? pickOnsets(slicer.analysis, sens) : []), [sens])
  const slices = useMemo(() => {
    const hits = onsets.filter((t) => t >= selStart - 0.015 && t < selEnd - 0.03).map((t) => slicer.refine(t))
    return hits.map((s, i) => ({ s, e: hits[i + 1] ?? selEnd - PRE_ROLL }))
  }, [onsets, selStart, selEnd])
  const detailPeaks = useMemo(() => computePeaks(slicer.cut(selStart, selEnd - selStart), 900), [selStart, selEnd])

  // keep a running loop preview on the selection as it moves
  useEffect(() => {
    if (loopPreview.current && slicer.previewing) slicer.preview(selStart - PRE_ROLL, selEnd - PRE_ROLL, true)
  }, [selStart, selEnd])

  const previewLoop = () => {
    if (slicer.previewing) {
      slicer.stopPreview()
      return
    }
    loopPreview.current = true
    slicer.preview(selStart - PRE_ROLL, selEnd - PRE_ROLL, true)
  }
  const previewHit = (i: number) => {
    const s = slices[i]
    if (!s) return
    loopPreview.current = false
    slicer.preview(s.s, s.e, false)
  }

  const base = track.name.length > 28 ? track.name.slice(0, 27) + '…' : track.name
  const barLabel = (a: number, n: number) => `t. ${a + 1}${n > 1 ? '–' + (a + n) : ''}`

  const loopSlices = (padList: number[]): Slice[] =>
    padList
      .map((pad, k) => ({ pad, a: first + k * span }))
      .filter(({ a }) => a + span <= nBars)
      .map(({ pad, a }) => ({ pad, start: t0 + a * bar - PRE_ROLL, dur: span * bar, name: `${base} · ${barLabel(a, span)}`, bars: span }))
  const hitSlices = (): Slice[] =>
    slices.slice(0, PAD_COUNT).map((s, i) => ({ pad: i, start: s.s, dur: s.e - s.s, name: `${base} · t. ${first + 1} · ud. ${i + 1}`, bars: null }))

  const run = async (list: Slice[], allPads: boolean) => {
    if (!list.length) return
    if (allPads && !confirm && list.some((s) => pads[s.pad].clipId)) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    setBusy(true)
    try {
      await slicesToPads(list, bpm, mode === 'loops' && fit ? projBpm : null, mode === 'hits' ? { loop: false, mode: 'shot', sync: false } : {})
    } finally {
      setBusy(false)
    }
  }

  const semis = 12 * Math.log2(projBpm / bpm)
  const all8 = Array.from({ length: PAD_COUNT }, (_, i) => i)
  const loops8 = loopSlices(all8)

  /* ---------- canvases ---------- */
  const view = { track, nBars, bar, selStart, selEnd, first, span, mode, slices, detailPeaks }
  const v = useRef(view)
  v.current = view

  const overview = useCanvas((g, W, H, d, C) => {
    const { track, nBars, bar, selStart, selEnd } = v.current
    const x = (t: number) => (t / track.duration) * W
    drawPeaks(g, track.peaks, W, H, d, C.wave)
    const px = (bar / track.duration) * (W / d)
    const every = [1, 2, 4, 8, 16, 32, 64].find((n) => n * px >= 30) ?? 128
    g.font = `${10 * d}px ${C.mono}`
    for (let k = 0; k <= nBars; k++) {
      const xx = x(track.t0 + k * bar)
      if (k % 4 === 0 || px >= 4) {
        g.fillStyle = k % 4 === 0 ? C.line + 'cc' : C.line + '77'
        g.fillRect(xx, 0, d, H)
      }
      if (k % every === 0 && k < nBars) {
        g.fillStyle = C.muted
        g.fillText(String(k + 1), xx + 3 * d, 11 * d)
      }
    }
    g.fillStyle = C.sel + '33'
    g.fillRect(x(selStart), 0, x(selEnd) - x(selStart), H)
    g.fillStyle = C.sel
    g.fillRect(x(selStart), 0, 2 * d, H)
    g.fillRect(x(selEnd) - 2 * d, 0, 2 * d, H)
    const ph = slicer.playhead()
    if (ph != null) {
      g.fillStyle = C.ph
      g.fillRect(x(ph), 0, 2 * d, H)
    }
  })

  const detail = useCanvas((g, W, H, d, C) => {
    const { selStart, selEnd, first, span, mode, slices, detailPeaks } = v.current
    const len = selEnd - selStart
    const x = (t: number) => ((t - selStart) / len) * W
    if (mode === 'hits')
      slices.forEach((s, i) => {
        if (i % 2) {
          g.fillStyle = C.line + '44'
          g.fillRect(x(s.s), 0, x(s.e) - x(s.s), H)
        }
      })
    drawPeaks(g, detailPeaks, W, H, d, C.wave)
    const steps = span * 16
    g.font = `${10 * d}px ${C.mono}`
    for (let k = 0; k <= steps; k++) {
      const xx = (k / steps) * W
      const isBar = k % 16 === 0
      const isBeat = k % 4 === 0
      if (!isBeat && W / steps < 5 * d) continue
      g.fillStyle = isBar ? C.muted + 'aa' : isBeat ? C.line + 'dd' : C.line + '66'
      g.fillRect(Math.min(xx, W - d), 0, d, H)
      if (isBar && k < steps) {
        g.fillStyle = C.muted
        g.fillText('t. ' + (first + k / 16 + 1), xx + 3 * d, 11 * d)
      }
    }
    if (mode === 'hits')
      slices.forEach((s, i) => {
        const on = i < PAD_COUNT
        g.fillStyle = on ? C.pads[i] : C.muted + '88'
        g.fillRect(x(s.s), 0, 2 * d, H)
        if (on) {
          g.font = `600 ${11 * d}px ${C.mono}`
          g.fillText(String(i + 1), x(s.s) + 4 * d, H - 6 * d)
        }
      })
    const ph = slicer.playhead()
    if (ph != null && ph >= selStart - 0.01 && ph <= selEnd) {
      g.fillStyle = C.ph
      g.fillRect(x(ph), 0, 2 * d, H)
    }
  })

  const pickBar = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width) * duration
    setSel(Math.max(0, Math.min(nBars - span, Math.floor((t - t0) / bar))))
    setConfirm(false)
  }

  return (
    <div className="slicer-body">
      <div className="sl-info">
        <strong>{track.name}</strong>
        <span>
          {fTime(duration)} · wykryte tempo {fBpm(track.detectedBpm)} BPM · {nBars} {pl(nBars, 'takt', 'takty', 'taktów')}
        </span>
      </div>

      <canvas
        ref={overview}
        className="wave sl-overview"
        style={{ height: 64, touchAction: 'none', cursor: 'pointer' }}
        role="img"
        aria-label="Cały kawałek z siatką taktów. Kliknij, żeby zaznaczyć takt."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickBar(e)
        }}
        onPointerMove={(e) => e.buttons && pickBar(e)}
      />

      <div className="mrow sl-grid">
        <label htmlFor="slBpm">
          Tempo
          <input
            id="slBpm"
            className="sl-num"
            inputMode="decimal"
            value={bpmText}
            onChange={(e) => setBpmText(e.target.value)}
            onBlur={() => commitBpm(parseFloat(bpmText.replace(',', '.')))}
            onKeyDown={(e) => e.key === 'Enter' && commitBpm(parseFloat(bpmText.replace(',', '.')))}
          />
          BPM
        </label>
        <button className="btn sm" title="Połowa tempa" onClick={() => setGrid({ bpm: bpm / 2 })}>
          ½×
        </button>
        <button className="btn sm" title="Podwójne tempo" onClick={() => setGrid({ bpm: bpm * 2 })}>
          2×
        </button>
        {bpm !== track.detectedBpm && (
          <button className="btn sm" onClick={() => setGrid({ bpm: track.detectedBpm })}>
            Wykryte
          </button>
        )}
        <span className="sl-group" role="group" aria-label="Przesuń siatkę taktów">
          <span className="sl-lab">Siatka</span>
          <button className="btn sm" title="O ćwierćnutę wcześniej" onClick={() => setGrid({ t0: t0 - bar / 4 })}>
            ‹ 1/4
          </button>
          <button className="btn sm" title="O ćwierćnutę później" onClick={() => setGrid({ t0: t0 + bar / 4 })}>
            1/4 ›
          </button>
          <button className="btn sm" title="O 10 ms wcześniej" onClick={() => setGrid({ t0: t0 - 0.01 })}>
            −10 ms
          </button>
          <button className="btn sm" title="O 10 ms później" onClick={() => setGrid({ t0: t0 + 0.01 })}>
            +10 ms
          </button>
        </span>
      </div>

      <div className="mrow">
        <span className="sl-group" role="group" aria-label="Co wycinać">
          <button className="chip sm" aria-pressed={mode === 'loops'} onClick={() => (setMode('loops'), setConfirm(false))}>
            Pętle
          </button>
          <button className="chip sm" aria-pressed={mode === 'hits'} onClick={() => (setMode('hits'), setConfirm(false))}>
            Pojedyncze uderzenia
          </button>
        </span>
        <span className="sl-group" role="group" aria-label="Długość zaznaczenia">
          {[1, 2, 4, 8].map((n) => (
            <button key={n} className="chip sm" aria-pressed={bars === n} onClick={() => (setBars(n), setConfirm(false))}>
              {n} {pl(n, 'takt', 'takty', 'taktów')}
            </button>
          ))}
        </span>
        <span className="sl-group">
          <button className="btn sm" aria-label="Poprzednie zaznaczenie" disabled={first <= 0} onClick={() => setSel(Math.max(0, first - span))}>
            ‹
          </button>
          <span className="sl-pos">{barLabel(first, span)}</span>
          <button
            className="btn sm"
            aria-label="Następne zaznaczenie"
            disabled={first + span >= nBars}
            onClick={() => setSel(Math.min(nBars - span, first + span))}
          >
            ›
          </button>
        </span>
      </div>

      <canvas
        ref={detail}
        className="wave sl-detail"
        style={{ height: 120, cursor: mode === 'hits' ? 'pointer' : undefined }}
        role="img"
        aria-label={mode === 'hits' ? 'Zaznaczone takty z uderzeniami. Kliknij uderzenie, żeby je odsłuchać.' : 'Zaznaczone takty z siatką kroków.'}
        onPointerDown={(e) => {
          if (mode !== 'hits') return
          const r = e.currentTarget.getBoundingClientRect()
          const t = selStart + ((e.clientX - r.left) / r.width) * (selEnd - selStart)
          previewHit(slices.findIndex((s) => t >= s.s && t < s.e))
        }}
      />

      {mode === 'loops' ? (
        <>
          <div className="mrow">
            <button className="btn sm" aria-pressed={slicer.previewing} onClick={previewLoop}>
              {slicer.previewing ? '■ Stop' : '▶ Odsłuchaj pętlę'}
            </button>
            <button className="btn sm" disabled={busy} onClick={() => run(loopSlices([selectedPad]), false)}>
              Na pad {selectedPad + 1}
            </button>
            <button className="btn sm" disabled={busy || loops8.length < 2} onClick={() => run(loops8, true)}>
              {confirm ? 'Zastąpi zajęte pady. Na pewno?' : `${loops8.length} kolejnych pętli na pady 1–${loops8.length}`}
            </button>
            {busy && <span className="busy">Tnę…</span>}
          </div>
          <div className="mrow">
            <label htmlFor="slFit">
              <input id="slFit" type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
              Dopasuj pętle do tempa projektu ({projBpm} BPM)
            </label>
            {Math.round(bpm) !== projBpm && Math.round(bpm) >= 50 && Math.round(bpm) <= 200 && (
              <button className="btn sm" onClick={() => setProjBpm(Math.round(bpm))}>
                Ustaw tempo projektu: {Math.round(bpm)} BPM
              </button>
            )}
          </div>
          <p className="msg">
            {!fit
              ? `Pętle zostaną wycięte bez zmian, w tempie ${fBpm(bpm)} BPM. Przy innym tempie projektu rozjadą się ze wzorem.`
              : Math.abs(semis) < 0.01
                ? 'Tempo kawałka zgadza się z projektem, pętle zostaną wycięte bez zmian.'
                : `Pętle zostaną ${projBpm > bpm ? 'przyspieszone' : 'zwolnione'} z ${fBpm(bpm)} do ${projBpm} BPM jak na gramofonie, więc zmieni się też wysokość: o ${Math.abs(semis).toFixed(1).replace('.', ',')} półtonu ${semis > 0 ? 'w górę' : 'w dół'}.${Math.abs(semis) > 2 ? ' To dużo: lepiej ustaw tempo projektu bliżej tempa kawałka.' : ''}`}
          </p>
        </>
      ) : (
        <>
          <div className="mrow">
            <label htmlFor="slSens">
              Czułość
              <input id="slSens" type="range" min={0} max={1} step={0.05} value={sens} onChange={(e) => setSens(+e.target.value)} />
            </label>
            <span className="hint">
              {slices.length} {pl(slices.length, 'uderzenie', 'uderzenia', 'uderzeń')} w zaznaczeniu
              {slices.length > PAD_COUNT ? `, na pady trafi pierwsze ${PAD_COUNT}` : ''}
            </span>
          </div>
          <div className="mrow">
            <button className="btn sm" disabled={busy || !slices.length} onClick={() => run(hitSlices(), true)}>
              {confirm ? 'Zastąpi zajęte pady. Na pewno?' : `Uderzenia na pady 1–${Math.min(PAD_COUNT, slices.length) || 8}`}
            </button>
            {busy && <span className="busy">Tnę…</span>}
          </div>
          <p className="msg">Kliknij uderzenie na przebiegu, żeby je odsłuchać. Każde trafia na pad jako „odpal od początku”, bez pętli.</p>
        </>
      )}
    </div>
  )
}

interface Colors {
  wave: string
  line: string
  muted: string
  sel: string
  ph: string
  mono: string
  pads: string[]
}

/** A canvas redrawn every animation frame by `draw` (read through a ref, so it can change freely). */
function useCanvas(draw: (g: CanvasRenderingContext2D, W: number, H: number, d: number, C: Colors) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const fn = useRef(draw)
  fn.current = draw
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const C: Colors = {
      wave: css('--cream'),
      line: css('--line'),
      muted: css('--muted'),
      sel: css('--orange'),
      ph: css('--yellow'),
      mono: css('--f-mono'),
      pads: PAD_COL.map(css),
    }
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const r = c.getBoundingClientRect()
      const d = devicePixelRatio || 1
      if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) {
        c.width = Math.round(r.width * d)
        c.height = Math.round(r.height * d)
      }
      const g = c.getContext('2d')!
      g.clearRect(0, 0, c.width, c.height)
      fn.current(g, c.width, c.height, d, C)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])
  return ref
}

function drawPeaks(g: CanvasRenderingContext2D, peaks: number[], W: number, H: number, d: number, col: string) {
  const n = peaks.length || 1
  const bw = W / n
  g.fillStyle = col + 'bb'
  for (let i = 0; i < n; i++) {
    const h = Math.max(d, (peaks[i] ?? 0) * H * 0.9)
    g.fillRect(i * bw, (H - h) / 2, Math.max(d, bw), h)
  }
}
