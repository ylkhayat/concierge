// Switching views and workspaces: which feed a view reads, the place each view keeps, and the workspace Design opens
// in. Pure, so it is tested on its own (modes.test.ts); App.tsx keeps the state and the storage.

export type Mode = 'review' | 'exec' | 'read' | 'focus' | 'standup' | 'skills' | 'plans' | 'design'

/**
 * Whose activity feed the open item reads, from the same render that opens it (a key set in an effect lagged a render
 * behind, so the item opened before was read, and shown, first). Design's items are captures and baselines.
 */
export function deckKey(mode: Mode, selected: string | undefined, isTicket: (id: string) => boolean): string | undefined {
  if (!selected) return undefined
  if (mode === 'review') return selected
  if (mode === 'design') return selected.startsWith('ticket:') ? undefined : selected.startsWith('repo:') ? `setup:${selected.slice(5)}` : `visuals:${selected}`
  if (isTicket(selected)) return `ticket:${selected}`
  return mode === 'exec' ? undefined : selected // Ship's open stack has no feed of its own
}

/** Where you were in a view: the open item and the filter. */
export type Place = { selected?: string; query?: string }
/** A kept place, read back: anything else (an older shape, a hand edit) is no place rather than a broken page. */
export function readPlace(raw: string | null | undefined): Place {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown
    if (!v || typeof v !== 'object') return {}
    const { selected, query } = v as Record<string, unknown>
    return { ...(typeof selected === 'string' && selected && { selected }), ...(typeof query === 'string' && query && { query }) }
  } catch { return {} }
}

/** Settings → Repositories' visuals: per repository, else its organization's (server/visuals.ts modeOf). */
export type Visuals = { repos?: Record<string, string>; orgs?: Record<string, string> }
export const designOn = (v: Visuals | undefined, repo: string) => (v?.repos?.[repo] ?? v?.orgs?.[repo.split('/')[0]] ?? 'off') !== 'off'

/** The workspace Design moved you from, and the one it moved you to. */
export type DesignFrom = { was?: string; picked: string }

/**
 * The workspace a view opens in. Design shows only where it is on: arriving from another view on a workspace where it
 * is off, it moves to the first one where it is on, and remembers where you were (`from`). Leaving Design goes back
 * there, unless you picked another workspace meanwhile (then that one is yours). Every other switch keeps the workspace.
 */
export function workspaceFor(to: Mode, cameFrom: Mode | undefined, focus: string | undefined, repos: string[], v: Visuals | undefined, from?: DesignFrom): { focus?: string; from?: DesignFrom } {
  if (to === 'design') {
    if (cameFrom === 'design') return { focus, from }
    const picked = focus && !designOn(v, focus) ? repos.find((r) => designOn(v, r)) : undefined
    return picked ? { focus: picked, from: { was: focus, picked } } : { focus }
  }
  if (from && focus === from.picked) return { focus: from.was }
  return { focus }
}
