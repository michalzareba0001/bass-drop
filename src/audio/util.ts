/** Freeze an AudioParam at time t, dropping later automation (falls back where cancelAndHold is missing). */
export const hold = (p: AudioParam, t: number) => {
  const pp = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }
  if (pp.cancelAndHoldAtTime) pp.cancelAndHoldAtTime(t)
  else p.cancelScheduledValues(t)
}

/**
 * Time constant for knob, fader and level changes: about 95 % of a move is heard after 3× this
 * (18 ms). Shorter would let fast knob turns step audibly; longer feels laggy.
 */
export const KNOB_SMOOTH = 0.006

export const toDb = (g: number) => (g <= 0.0001 ? -Infinity : 20 * Math.log10(g))
export const fmtDb = (g: number) => {
  const d = toDb(g)
  return d === -Infinity ? '−∞' : (d > 0 ? '+' : '') + d.toFixed(1)
}
