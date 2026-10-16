import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { engine } from './audio/engine'
import { drums } from './audio/drums'
import { mixer } from './audio/mixer'
import { sequencer } from './audio/sequencer'
import { sampler } from './audio/sampler'
import { installAudioUnlock, installKeyboard } from './control'
import { connectMidi } from './audio/midi'
import { loadClipAudio } from './lib/clips'
import { useStore } from './store'
import './styles.css'

engine.setParams(useStore.getState().params)
{
  const st = useStore.getState()
  drums.configure(st.drumCfg)
  mixer.configure(st.mix, st.sidechain)
}
installKeyboard()
// dev-only handle for poking at the audio modules from the browser console
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  Object.assign(window, { __bassDrop: { engine, mixer, drums, sequencer } })
installAudioUnlock()
connectMidi()

// load saved recordings back into the sampler
for (const c of useStore.getState().clips) {
  loadClipAudio(c.id)
    .then((a) => a && sampler.setClip(c.id, a.ch, a.sr))
    .catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
