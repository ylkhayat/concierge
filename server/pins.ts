// Bookmarks: PRs and tickets you want to keep an eye on. They lead their list while they're still open, and every
// change of their state becomes an alert (one that needs you when it's your move). Keyed like alerts: "pr:<id>", "ticket:<id>".
import { save, state } from './store.ts'

/** What an item is now, in words, and whether that's your move; `gone`: closed, merged or done, so the bookmark ends. */
export type Seen = { key: string; text: string; you: boolean; gone?: boolean }
export type Change = { key: string; text: string; you: boolean; gone?: boolean }

export const pins = (): Record<string, string> => (state.pinned ??= {})
export const isPinned = (key: string) => key in pins()

export function pin(key: string, on: boolean) {
  if (on) pins()[key] ??= ''
  else delete pins()[key]
  save()
}

/**
 * Compare the bookmarked items as they are now with what was last seen of them: each change once, and the ones that
 * ended are dropped. The first sight of an item (just bookmarked) only records it. An item missing from `now` is left
 * alone: a list that failed to load must not end every bookmark.
 */
export function diff(last: Record<string, string>, now: Seen[]): { next: Record<string, string>; changes: Change[] } {
  const next = { ...last }, changes: Change[] = []
  for (const s of now) {
    if (!(s.key in last)) continue
    if (s.gone) { delete next[s.key]; changes.push({ key: s.key, text: `${s.text}: bookmark removed`, you: false, gone: true }); continue }
    if (last[s.key] !== s.text) { if (last[s.key]) changes.push({ key: s.key, text: `Now ${s.text}`, you: s.you }); next[s.key] = s.text }
  }
  return { next, changes }
}

/** Apply what changed (the caller raises the alerts). */
export function watch(now: Seen[]): Change[] {
  const { next, changes } = diff(pins(), now)
  if (JSON.stringify(next) !== JSON.stringify(pins())) { state.pinned = next; save() }
  return changes
}

// how a PR's state reads (as in the list's badge; your own PRs read a few differently)
const PR_TEXT: Record<string, string> = {
  new: 'new', queued: 'queued', preparing: 'being reviewed', posting: 'posting', ready: 'ready for you', 'in-review': 'in review',
  reviewed: 'reviewed', failed: 'failed', interrupted: 'interrupted', 'no-checkout': 'without a checkout', clear: 'all clear',
  approved: 'approved', answered: 'waiting on reviewers', closed: 'closed',
}
const MINE_TEXT: Record<string, string> = { new: 'feedback waiting', ready: 'in crit', posting: 'publishing' }
export const prText = (status: string, mine: boolean) => (mine && MINE_TEXT[status]) || PR_TEXT[status] || status
export const prYours = (status: string, mine: boolean) => (mine ? ['new', 'approved', 'failed', 'interrupted'] : ['ready', 'in-review', 'failed', 'interrupted']).includes(status)

const BUCKET_TEXT: Record<string, string> = {
  'needs-you': 'asking you on Linear', tend: 'needing you: red CI or open threads', stalled: 'gone quiet', 'in-progress': 'in progress',
  todo: 'todo', triage: 'in triage', backlog: 'in the backlog', shipped: 'shipped, in review', handed: 'handed over', closed: 'done',
}
export const ticketText = (bucket: string) => BUCKET_TEXT[bucket] ?? bucket
export const ticketYours = (bucket: string) => bucket === 'needs-you' || bucket === 'tend'
