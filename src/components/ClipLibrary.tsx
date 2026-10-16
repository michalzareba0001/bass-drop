import { useState } from 'react'
import { engine } from '../audio/engine'
import { sampler } from '../audio/sampler'
import { downloadBlob, encodeWav } from '../audio/wav'
import { removeClip } from '../control'
import { loadClipAudio } from '../lib/clips'
import { useRuntime, useStore, type ClipMeta } from '../store'
import { Waveform } from './Waveform'

export function ClipLibrary() {
  const clips = useStore((s) => s.clips)
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Nagrania · {clips.length}</h2>
        <span className="hint">Zapisane w tej przeglądarce. Pobierz jako WAV, żeby mieć je na dysku.</span>
      </div>
      {clips.length === 0 ? (
        <p className="msg">
          Nie masz jeszcze nagrań. Ustaw długość na 2 takty, kliknij <b>● Nagrywaj</b> i graj na klawiaturze albo puść wzór. Po nagraniu pętla pojawi się na padzie samplera.
        </p>
      ) : (
        <ul className="clips">
          {clips.map((c) => (
            <ClipRow key={c.id} c={c} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ClipRow({ c }: { c: ClipMeta }) {
  const selected = useStore((s) => s.selectedPad)
  const assignClip = useStore((s) => s.assignClip)
  const renameClip = useStore((s) => s.renameClip)
  useRuntime((s) => s.padsOn) // re-render when playback changes
  const [confirm, setConfirm] = useState(false)
  const key = 'prev:' + c.id
  const playing = sampler.isPlaying(key)

  const download = async () => {
    const a = await loadClipAudio(c.id)
    if (!a) return
    const safe = c.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'nagranie'
    downloadBlob(encodeWav(a.ch, a.sr), safe + '.wav')
  }

  return (
    <li className="clip">
      <Waveform peaks={c.peaks} progress={() => sampler.progress(key)} height={44} className="clip-wave" />
      <div className="clip-info">
        <input
          className="clip-name"
          id={'clip-' + c.id}
          aria-label="Nazwa nagrania"
          value={c.name}
          onChange={(e) => renameClip(c.id, e.target.value)}
        />
        <span className="clip-meta">
          {c.duration.toFixed(2)} s{c.bars ? ` · ${c.bars} ${c.bars === 1 ? 'takt' : c.bars < 5 ? 'takty' : 'taktów'}` : ''}
        </span>
      </div>
      <div className="clip-actions">
        <button
          className="btn sm"
          aria-pressed={playing}
          onClick={() => {
            engine.ensure()
            if (playing) sampler.stop(key)
            else sampler.play(key, c.id, { start: 0, end: 1, loop: true, pitch: 0, gain: 1 })
          }}
        >
          {playing ? '■ Stop' : '▶ Odsłuchaj'}
        </button>
        <button className="btn sm" onClick={() => assignClip(selected, c.id)}>
          Na pad {selected + 1}
        </button>
        <button className="btn sm" onClick={download}>
          WAV
        </button>
        {confirm ? (
          <>
            <button className="btn sm danger" onClick={() => removeClip(c.id)}>
              Usuń na pewno
            </button>
            <button className="btn sm" onClick={() => setConfirm(false)}>
              Anuluj
            </button>
          </>
        ) : (
          <button className="btn sm" onClick={() => setConfirm(true)}>
            Usuń
          </button>
        )}
      </div>
    </li>
  )
}
