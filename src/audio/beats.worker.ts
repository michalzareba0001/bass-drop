import { analyse } from './beats'

/** Runs the beat analysis off the main thread so the page stays responsive. */
onmessage = (e: MessageEvent<{ x: Float32Array; sr: number }>) => {
  try {
    postMessage({ ok: true, a: analyse(e.data.x, e.data.sr) })
  } catch (err) {
    postMessage({ ok: false, msg: String(err) })
  }
}
