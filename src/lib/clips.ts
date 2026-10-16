import { del, get, set } from 'idb-keyval'

/** Clip audio lives in IndexedDB (too big for localStorage); metadata lives in the store. */
export interface ClipAudio {
  sr: number
  ch: Float32Array[]
}

const key = (id: string) => 'sd808-clip:' + id

export const saveClipAudio = (id: string, a: ClipAudio) => set(key(id), a)
export const loadClipAudio = (id: string) => get<ClipAudio>(key(id))
export const deleteClipAudio = (id: string) => del(key(id))

export function computePeaks(ch: Float32Array[], n = 300): number[] {
  const len = ch[0].length
  const out: number[] = []
  const step = Math.max(1, Math.floor(len / n))
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * len) / n)
    const b = Math.min(len, a + step)
    let p = 0
    for (const c of ch) for (let j = a; j < b; j += 2) p = Math.max(p, Math.abs(c[j]))
    out.push(Math.round(p * 1000) / 1000)
  }
  return out
}
