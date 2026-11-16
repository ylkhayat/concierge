import type { Activity } from './lib.ts'

export type Chapter = { key: string; head?: Activity; items: Activity[]; end?: string; outcome?: Activity }
/** Runs as chapters: each 'section' entry opens one; anything before the first belongs to an untitled one. */
export function chaptersOf(feed: Activity[]): Chapter[] {
  const out: Chapter[] = []
  for (const a of feed) {
    // entries before the first heading (logs older than chapters) become an "Earlier" chapter
    if (a.kind === 'section' || !out.length) out.push({ key: a.kind === 'section' ? `${a.at}|${a.text}` : 'start', head: a.kind === 'section' ? a : { at: a.at, kind: 'section', text: 'Earlier' }, items: [] })
    const ch = out.at(-1)!
    if (a.kind === 'section') continue
    // the agent's last message, shortened, then its result in full: show it once, in full
    const prev = ch.items.at(-1)
    if (a.kind === 'result' && prev?.kind === 'text' && a.text.replace(/\s+/g, ' ').startsWith(prev.text.replace(/\s+/g, ' ').replace(/…$/, '').slice(0, 120))) ch.items.pop()
    ch.items.push(a); ch.end = a.at; if (a.kind === 'result' || a.kind === 'error') ch.outcome = a
  }
  return out
}


/**
 * A run's last message comes twice: as what it says, then as its result (same words, with the cost). The result stays;
 * the copy before it goes.
 */
export function once(feed: Activity[]): Activity[] {
  const results = new Set(feed.filter((a) => a.kind === 'result').map((a) => a.text.trim()))
  return results.size ? feed.filter((a) => a.kind !== 'text' || !results.has(a.text.trim())) : feed
}
/** A handover the server sent an agent on another's behalf: not your words, though it travels the same way. */
export const HANDOVER = /^Hand(?:ed )?over from (?:the agent on )?(.+?)(?::|\s\(|$)/
