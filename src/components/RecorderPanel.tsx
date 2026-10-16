import { useEffect, useRef } from 'react'
import { recorder } from '../audio/recorder'
import { toggleRecord } from '../control'
import { useRuntime, useStore } from '../store'

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

export function RecorderPanel() {
  const recSource = useStore((s) => s.recSource)
  const recBars = useStore((s) => s.recBars)
  const bpm = useStore((s) => s.bpm)
  const setRec = useStore((s) => s.setRec)
  const recState = useRuntime((s) => s.recState)
  const recError = useRuntime((s) => s.recError)
  const playing = useRuntime((s) => s.playing)
  const timeRef = useRef<HTMLSpanElement>(null)
  const meterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (timeRef.current) timeRef.current.textContent = fmtTime(recorder.elapsed())
      if (meterRef.current) {
        recorder.peak *= 0.94
        const p = recorder.state === 'idle' ? 0 : recorder.peak
        meterRef.current.style.transform = `scaleX(${Math.min(1, p)})`
        meterRef.current.classList.toggle('hot', p > 0.98)
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  const barSec = (60 / bpm) * 4
  const label =
    recState === 'waiting' ? 'Czekam na takt…' : recState === 'recording' ? '■ Zatrzymaj' : '● Nagrywaj'
  const hint =
    recBars > 0
      ? `Nagra dokładnie ${recBars} ${recBars === 1 ? 'takt' : recBars < 5 ? 'takty' : 'taktów'} (${(recBars * barSec).toFixed(2)} s przy ${bpm} BPM), od pierwszego kroku wzoru. Taki kawałek zapętla się bez przeskoku.`
      : 'Nagrywa od kliknięcia do kliknięcia.'

  return (
    <section className="panel rec-sec">
      <div className="panel-head">
        <h2>Nagrywanie</h2>
        <span className="hint">Klawisz R zaczyna i kończy nagrywanie.</span>
      </div>
      <div className="rec-row">
        <button
          className={'btn rec ' + recState}
          onClick={() => toggleRecord()}
          aria-pressed={recState !== 'idle'}
        >
          {label}
        </button>
        <span className="rec-time" ref={timeRef}>
          0:00.0
        </span>
        <div className="meter" aria-hidden="true">
          <div ref={meterRef} />
        </div>
      </div>
      <div className="mrow">
        <label htmlFor="recSrc">
          Źródło
          <select
            id="recSrc"
            value={recSource}
            disabled={recState !== 'idle'}
            onChange={(e) => setRec({ recSource: e.target.value as 'out' | 'mic' })}
          >
            <option value="out">Wyjście apki (syntezator + sampler)</option>
            <option value="mic">Mikrofon / wejście liniowe</option>
          </select>
        </label>
        <label htmlFor="recBars">
          Długość
          <select
            id="recBars"
            value={recBars}
            disabled={recState !== 'idle'}
            onChange={(e) => setRec({ recBars: +e.target.value })}
          >
            <option value={0}>Wolna</option>
            <option value={1}>1 takt</option>
            <option value={2}>2 takty</option>
            <option value={4}>4 takty</option>
            <option value={8}>8 taktów</option>
          </select>
        </label>
      </div>
      <p className="msg">
        {hint}
        {recBars > 0 && playing ? ' Wzór już gra, więc nagrywanie ruszy od następnego taktu.' : ''}
      </p>
      {recError && <p className="msg err">{recError}</p>}
    </section>
  )
}
