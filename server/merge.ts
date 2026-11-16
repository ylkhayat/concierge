// Several machines, one state, no sync conflicts. Each machine writes only its own snapshot (state.<machine>.json),
// so the file sync (Syncthing) never sees two writers on one file, and nothing is ever dropped as a conflict copy.
// Each snapshot carries, for every entry (one PR, one run, one setting), when it last changed and what was deleted.
// Loading merges them entry by entry, the newest change winning (a last-writer-wins map); the machine running
// Concierge merges again whenever another machine's snapshot arrives late, so what that machine did before it stopped
// (a run, a reply) comes back instead of vanishing. A top-level object is a map of entries; anything else is one entry.

export type Meta = { at: Record<string, string>; gone: Record<string, string> } // entry key → when it changed / was deleted
export const emptyMeta = (): Meta => ({ at: {}, gone: {} })

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every entry of a state, by key: "execs/ab12cd34", "prs/owner/repo#12" (split at the first /), "execAuto". */
export function entriesOf(s: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [k, v] of Object.entries(s)) {
    if (k === '_meta' || v === undefined) continue
    if (isMap(v)) for (const [id, x] of Object.entries(v)) { if (x !== undefined) out.set(`${k}/${id}`, x) }
    else out.set(k, v)
  }
  return out
}

const split = (key: string) => { const i = key.indexOf('/'); return i < 0 ? [key] : [key.slice(0, i), key.slice(i + 1)] }
/** One entry's value, by its key (undefined: none). */
export function valueOf(s: Record<string, unknown>, key: string): unknown {
  const [k, id] = split(key)
  return id === undefined ? s[k] : isMap(s[k]) ? (s[k] as Record<string, unknown>)[id] : undefined
}
/** Set one entry by its key. */
export function put(s: Record<string, unknown>, key: string, v: unknown) {
  const [k, id] = split(key)
  if (id === undefined) s[k] = v
  else (isMap(s[k]) ? s[k] as Record<string, unknown> : (s[k] = {}) as Record<string, unknown>)[id] = v
}
/** Delete one entry by its key. */
export function drop(s: Record<string, unknown>, key: string) {
  const [k, id] = split(key)
  if (id === undefined) delete s[k]
  else if (isMap(s[k])) delete (s[k] as Record<string, unknown>)[id]
}

/**
 * Merge `from` (another machine's snapshot) into `into`, entry by entry: the later change wins, a deletion included.
 * `fallback` dates entries a snapshot from before this has no date for (its file's time). Returns the keys taken.
 */
export function merge(into: Record<string, unknown>, meta: Meta, from: Record<string, unknown>, fromMeta: Meta, fallback: string): string[] {
  const taken: string[] = []
  const ours = (k: string) => [meta.at[k], meta.gone[k]].reduce<string>((a, b) => (b && b > a ? b : a), '')
  for (const [k, v] of entriesOf(from)) {
    const at = fromMeta.at[k] ?? fallback
    if (at <= ours(k)) continue
    put(into, k, structuredClone(v)); meta.at[k] = at; delete meta.gone[k]; taken.push(k)
  }
  for (const [k, at] of Object.entries(fromMeta.gone)) {
    if (at <= ours(k)) continue
    drop(into, k); meta.gone[k] = at; delete meta.at[k]; taken.push(k)
  }
  return taken
}

/**
 * What changed since the last save (`last`: each entry's JSON then), stamped `now` in meta, and the snapshot to write,
 * built from the same per-entry JSON so the state is serialized once. Deletions older than 30 days are forgotten.
 */
export function stamp(s: Record<string, unknown>, meta: Meta, last: Map<string, string>, now: string): { data: string; changed: number } {
  const cur = new Map<string, string>()
  let changed = 0
  for (const [k, v] of entriesOf(s)) {
    const j = JSON.stringify(v)
    if (j === undefined) continue
    cur.set(k, j)
    if (last.get(k) !== j) { meta.at[k] = now; delete meta.gone[k]; changed++ }
  }
  for (const k of last.keys()) if (!cur.has(k)) { meta.gone[k] = now; delete meta.at[k]; changed++ }
  const old = new Date(Date.parse(now) - 30 * 86400_000).toISOString()
  for (const [k, at] of Object.entries(meta.gone)) if (at < old) delete meta.gone[k]
  last.clear(); for (const [k, j] of cur) last.set(k, j)
  // assembled by hand from the entries' JSON: {"_meta":…,"prs":{"a":…},"execAuto":false}
  const top = new Map<string, string[] | string>()
  for (const [k, j] of cur) {
    const [t, id] = split(k)
    if (id === undefined) top.set(t, j)
    else { const l = top.get(t); (Array.isArray(l) ? l : (top.set(t, []), top.get(t) as string[])).push(`${JSON.stringify(id)}:${j}`) }
  }
  for (const [k, v] of Object.entries(s)) if (isMap(v) && !top.has(k)) top.set(k, []) // an empty map stays a map
  const parts = [`"_meta":${JSON.stringify(meta)}`, ...[...top].map(([t, v]) => `${JSON.stringify(t)}:${Array.isArray(v) ? `{${v.join(',')}}` : v}`)]
  return { data: `{${parts.join(',')}}`, changed }
}
