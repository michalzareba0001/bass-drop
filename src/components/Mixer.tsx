import { useEffect, useRef } from 'react'
import { engine } from '../audio/engine'
import { CHANNELS, mixer, type StripCfg } from '../audio/mixer'
import { fPct, fS } from '../audio/params'
import { fmtDb } from '../audio/util'
import { useStore } from '../store'
import { Knob } from './Knob'

/** Peak meter: -48 dBFS..0 dBFS mapped to 0..1, with a short peak hold. */
const meterLevel = (p: number) => (p <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(p) + 48) / 48)))

export function Mixer() {
  const mix = useStore((s) => s.mix)
  const setStrip = useStore((s) => s.setStrip)
  const clips = useStore((s) => s.clips)
  const pads = useStore((s) => s.pads)
  const sc = useStore((s) => s.sidechain)
  const setSidechain = useStore((s) => s.setSidechain)
  const volume = useStore((s) => s.params.volume)
  const setParam = useStore((s) => s.setParam)
  const meters = useRef<Record<string, HTMLDivElement | null>>({})
  const ducks = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    let raf = 0
    const hold: Record<string, number> = {}
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!engine.ctx) return
      for (const id of [...CHANNELS.map((c) => c.id), 'master']) {
        const el = meters.current[id]
        if (!el) continue
        const p = id === 'master' ? masterPeak() : mixer.peak(id)
        const lv = meterLevel(p)
        hold[id] = Math.max(lv, (hold[id] ?? 0) - 0.012)
        el.style.setProperty('--lv', String(lv))
        el.style.setProperty('--hold', String(hold[id]))
        el.classList.toggle('clip', p >= 0.97)
        const dk = ducks.current[id]
        if (dk) dk.style.setProperty('--dk', String(mixer.ducking(id)))
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  const anySolo = Object.values(mix).some((c) => c.solo)

  return (
    <section className="panel mixer">
      <div className="panel-head">
        <h2>Mikser</h2>
        <span className="hint">M wycisza kanał, S zostawia tylko kanały z solo, SC włącza przyciszanie przez stopę (sidechain). Dwuklik na suwaku wraca do 0 dB.</span>
      </div>
      <div className="mixer-body">
        <div className="strips">
          {CHANNELS.map((c) => {
            const cfg = mix[c.id]
            const sub = c.id.startsWith('pad') ? clips.find((k) => k.id === pads[+c.id.slice(3)]?.clipId)?.name ?? 'pusty' : c.id === 'bass' ? 'syntezator' : 'wzór bębnów'
            const silenced = cfg.mute || (anySolo && !cfg.solo)
            return (
              <Strip
                key={c.id}
                id={c.id}
                name={c.name}
                sub={sub}
                cfg={cfg}
                canSc={c.canSc}
                silenced={silenced}
                meterRef={(el) => {
                  meters.current[c.id] = el
                }}
                duckRef={(el) => {
                  ducks.current[c.id] = el
                }}
                onChange={(p) => setStrip(c.id, p)}
              />
            )
          })}
          <div className="strip master">
            <div className="st-name">Master</div>
            <div className="st-sub">wyjście</div>
            <div className="st-body">
              <div className="meter-v" ref={(el) => {
                  meters.current.master = el
                }}>
                <div className="lv" />
                <div className="pk" />
              </div>
              <input
                type="range"
                className="fader"
                id="fader-master"
                aria-label="Głośność master"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setParam('volume', +e.target.value)}
                onDoubleClick={() => setParam('volume', 0.8)}
              />
            </div>
            <div className="st-db">{fmtDb(volume)} dB</div>
          </div>
        </div>
        <div className="sc-box">
          <h3>Sidechain od stopy</h3>
          <p className="msg">Każde uderzenie stopy na chwilę przycisza kanały z włączonym SC. Dzięki temu bas 808 i stopa nie zlewają się w jedno.</p>
          <div className="knobs">
            <Knob id="sc-amount" label="Siła" value={sc.amount} range={{ min: 0, max: 1 }} def={0.6} color="var(--red)" format={fPct}
              onChange={(v) => setSidechain({ amount: v })} />
            <Knob id="sc-release" label="Powrót" value={sc.release} range={{ min: 0.03, max: 0.8, log: true }} def={0.18} color="var(--red)" format={fS}
              onChange={(v) => setSidechain({ release: v })} />
          </div>
        </div>
      </div>
    </section>
  )
}

let mbuf: Float32Array<ArrayBuffer> | null = null
function masterPeak() {
  const an = engine.analyser
  if (!mbuf || mbuf.length !== an.fftSize) mbuf = new Float32Array(an.fftSize)
  an.getFloatTimeDomainData(mbuf)
  // the master analyser window is long; the newest 2048 samples are enough for a meter
  let p = 0
  for (let i = mbuf.length - 2048; i < mbuf.length; i++) p = Math.max(p, Math.abs(mbuf[i]))
  return p
}

function Strip({ id, name, sub, cfg, canSc, silenced, meterRef, duckRef, onChange }: {
  id: string; name: string; sub: string; cfg: StripCfg; canSc: boolean; silenced: boolean
  meterRef: (el: HTMLDivElement | null) => void
  duckRef: (el: HTMLDivElement | null) => void
  onChange: (p: Partial<StripCfg>) => void
}) {
  return (
    <div className={'strip' + (silenced ? ' silenced' : '')}>
      <div className="st-name">{name}</div>
      <div className="st-sub" title={sub}>{sub}</div>
      <div className="st-body">
        <div className="meter-v" ref={meterRef}>
          <div className="lv" />
          <div className="pk" />
        </div>
        <input
          type="range"
          className="fader"
          id={'fader-' + id}
          aria-label={'Głośność ' + name}
          min={0}
          max={1.25}
          step={0.01}
          value={cfg.vol}
          onChange={(e) => onChange({ vol: +e.target.value })}
          onDoubleClick={() => onChange({ vol: 1 })}
        />
      </div>
      <div className="st-db">{fmtDb(cfg.vol)} dB</div>
      <div className="st-btns">
        <button className="mb m" aria-pressed={cfg.mute} aria-label={'Wycisz ' + name} onClick={() => onChange({ mute: !cfg.mute })}>
          M
        </button>
        <button className="mb s" aria-pressed={cfg.solo} aria-label={'Solo ' + name} onClick={() => onChange({ solo: !cfg.solo })}>
          S
        </button>
        {canSc && (
          <button className="mb sc" aria-pressed={cfg.sc} aria-label={'Sidechain na ' + name} onClick={() => onChange({ sc: !cfg.sc })}>
            SC
          </button>
        )}
      </div>
      {canSc && (
        <div className="duck" ref={duckRef} title="Ile sidechain przycisza kanał w tej chwili">
          <div />
        </div>
      )}
    </div>
  )
}
