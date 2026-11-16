// What you opened last, per list, so the lists can put it first ("Recent") and you find your way back.
// The order is a snapshot taken when the window comes back into view, not on every click: a row never jumps away
// from under the pointer or j/k while you work.
// shortcut: per browser (localStorage), so the phone keeps its own; move to the server if they should share it
import { useEffect } from 'react'

export type List = 'review' | 'exec'
const KEY = (l: List) => `recent:${l}`
const DAY = 86_400_000
const read = (l: List): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY(l)) ?? '{}') } catch { return {} } }
const snaps: Record<List, Record<string, number>> = { review: read('review'), exec: read('exec') }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { snaps.review = read('review'); snaps.exec = read('exec') }
})

/** Remember that you opened `id` (it moves up the next time the window comes back, or on reload). */
export function touch(l: List, id: string) {
  try {
    const m = { ...read(l), [id]: Date.now() }
    localStorage.setItem(KEY(l), JSON.stringify(Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 30))))
  } catch { /* private window: no Recent */ }
}
export const useTouch = (l: List, id?: string) => useEffect(() => { if (id) touch(l, id) }, [l, id])

/** The ids you opened in the last day, newest first, at most `max`, with when. */
export function recent(l: List, max = 5, now = Date.now()): Map<string, number> {
  return new Map(Object.entries(snaps[l]).filter(([, t]) => now - t < DAY).sort((a, b) => b[1] - a[1]).slice(0, max))
}

/** Pull the units holding a recent id out of `all` (newest first): they show once, in Recent, not in their group. */
export function takeRecent<T>(all: T[][], idOf: (x: T) => string, rec: Map<string, number>): { recent: T[][]; rest: T[][] } {
  const at = (u: T[]) => Math.max(...u.map((x) => rec.get(idOf(x)) ?? 0))
  return { recent: all.filter((u) => at(u) > 0).sort((a, b) => at(b) - at(a)), rest: all.filter((u) => !at(u)) }
}
