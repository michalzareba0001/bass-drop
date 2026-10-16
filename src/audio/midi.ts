import { clamp, DEF, fromN, type ParamKey } from './params'
import { engine } from './engine'
import { padDown, padUp, panic, press, release, setSustain } from '../control'
import { useRuntime, useStore } from '../store'

let access: MIDIAccess | null = null
let blinkCb: () => void = () => {}
export const onMidiActivity = (cb: () => void) => {
  blinkCb = cb
}

/** Pads on MIDI channel 10, notes 36–43 (the default on most pad controllers). */
const PAD_NOTE0 = 36

function onMessage(this: MIDIInput, ev: MIDIMessageEvent) {
  const st = useStore.getState()
  if (st.midi.input !== 'all' && this.id !== st.midi.input) return
  const data = ev.data
  if (!data || data.length < 1) return
  const [s, d1 = 0, d2 = 0] = data
  if (s >= 0xf0) return
  blinkCb()
  const c = s & 0xf0
  const chan = s & 0x0f
  const isOn = c === 0x90 && d2 > 0
  const isOff = c === 0x80 || (c === 0x90 && d2 === 0)

  if ((isOn || isOff) && chan === 9 && d1 >= PAD_NOTE0 && d1 < PAD_NOTE0 + 8) {
    if (isOn) padDown(d1 - PAD_NOTE0)
    else padUp(d1 - PAD_NOTE0)
    return
  }
  if (isOn) {
    const v = st.midi.velocity ? Math.pow(d2 / 127, 0.7) : 1
    press(clamp(d1 + st.midi.transpose, 0, 127), v)
  } else if (isOff) {
    release(clamp(d1 + st.midi.transpose, 0, 127))
  } else if (c === 0xe0) {
    const raw = ((d2 << 7) | d1) - 8192
    engine.setBend((raw / 8192) * st.midi.pbRange * 100)
  } else if (c === 0xb0) {
    const rt = useRuntime.getState()
    if (rt.learning && rt.learnTarget && d1 !== 64 && d1 < 120) {
      const k = rt.learnTarget
      st.mapCC(d1, k)
      useRuntime.setState({ learnTarget: null, learnMsg: `Przypisano CC ${d1} → ${DEF[k].l}. Kliknij kolejną gałkę albo „Gotowe”.` })
      return
    }
    const mapped = st.ccMap[d1] as ParamKey | undefined
    if (mapped) st.setParam(mapped, fromN(DEF[mapped], d2 / 127))
    else if (d1 === 1) st.setParam('lfoDepth', d2 / 127)
    else if (d1 === 64) setSustain(d2 >= 64)
    else if (d1 === 120 || d1 === 123) panic()
  }
}

function hookInputs() {
  if (!access) return
  const inputs: { id: string; name: string }[] = []
  access.inputs.forEach((inp) => {
    inp.onmidimessage = onMessage
    inputs.push({ id: inp.id, name: inp.name || 'Wejście ' + (inputs.length + 1) })
  })
  useRuntime.setState({
    midiInputs: inputs,
    midiStatus: inputs.length
      ? 'Połączono: ' + inputs.map((i) => i.name).join(', ')
      : 'Dostęp jest, ale nie widzę urządzenia. Podłącz kontroler przez USB, pojawi się tu sam.',
  })
}

export function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    useRuntime.setState({ midiStatus: 'Ta przeglądarka nie obsługuje Web MIDI. Otwórz apkę w Chrome lub Chromium.' })
    return
  }
  useRuntime.setState({ midiStatus: 'Łączę…' })
  navigator
    .requestMIDIAccess({ sysex: false })
    .then((acc) => {
      access = acc
      hookInputs()
      acc.onstatechange = hookInputs
    })
    .catch(() => useRuntime.setState({ midiStatus: 'Przeglądarka nie dała dostępu do MIDI. Zezwól na urządzenia MIDI w ustawieniach strony.' }))
}
