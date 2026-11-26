// A live list's arrangement (which rows, in which section, in what order) changes in bursts: a run moves a PR from
// Working to In crit to Waiting within a second, the server sends a patch per step. Shown as they come, rows hop
// up and down once per step. So a new arrangement waits until the updates settle (a short quiet, never longer than
// `most`) and is then shown once; meanwhile the rows keep their places with their newest data in them. What you did
// yourself (a filter, a tab, a bookmark) shows at once.
import { useEffect, useReducer, useRef } from 'react'

export type Sections<T> = { units: T[][] }[]

/** The arrangement alone: each section's units, as ids. Same key, same rows in the same places. */
export function shapeKey<S extends { units: T[][] }, T>(sections: S[], id: (t: T) => string, head: (s: S) => string): string {
  return sections.map((s) => `${head(s)}:${s.units.map((u) => u.map(id).join('+')).join(',')}`).join('|')
}

/** `held`'s arrangement with `fresh`'s data: each item replaced by its newest version, the ones that went dropped
 *  (and units left empty with them). Ones that are new wait for the next arrangement. */
export function relayout<S extends { units: T[][] }, T>(held: S[], fresh: S[], id: (t: T) => string): S[] {
  const now = new Map(fresh.flatMap((s) => s.units.flat()).map((t) => [id(t), t]))
  return held.map((s) => ({ ...s, units: s.units.map((u) => u.flatMap((t) => now.get(id(t)) ?? [])).filter((u) => u.length) }))
}

/**
 * The sections to show: `fresh` when its arrangement is the one on screen or `mine` changed (what you did), else the
 * arrangement on screen with fresh data until updates have been quiet for `ms` (at most `most` after the first).
 */
export function useSettled<S extends { units: T[][] }, T>(fresh: S[], id: (t: T) => string, head: (s: S) => string, mine: string, ms = 400, most = 1200): S[] {
  const key = shapeKey(fresh, id, head)
  const s = useRef({ held: fresh, key, mine, since: 0, go: false })
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const c = s.current
  if (c.key === key || c.mine !== mine || c.go) Object.assign(c, { held: fresh, key, mine, since: 0, go: false })
  else if (!c.since) c.since = Date.now()
  const waiting = c.key !== key
  useEffect(() => {
    if (!waiting) return
    const t = setTimeout(() => { s.current.go = true; redraw() }, Math.max(0, Math.min(ms, s.current.since + most - Date.now())))
    return () => clearTimeout(t)
  }, [key, waiting, ms, most])
  return waiting ? relayout(c.held, fresh, id) : fresh
}

/** Clicks shown before the server has them (a bookmark, a hide): the ones it doesn't agree with yet. Kept until it
 *  does, not dropped on its next update whatever that was about (a row clicked up went back down on an unrelated
 *  update, then up again); one for an item that went is dropped. */
export function pending<O extends object>(over: Record<string, O>, given: { id: string }[]): Record<string, O> {
  const by = new Map(given.map((x) => [x.id, x as unknown as Record<string, unknown>]))
  const keep = Object.entries(over).filter(([id, o]) => { const x = by.get(id); return !!x && Object.entries(o).some(([k, v]) => !!x[k] !== !!v) })
  return keep.length === Object.keys(over).length ? over : Object.fromEntries(keep)
}
