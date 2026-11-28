// What changed, said once to every open page (over /api/events, as 'stale' with the API paths it touches): the page
// reads those again at once, instead of asking every few seconds whether anything did.
import { EventEmitter } from 'node:events'

export const live = new EventEmitter()
live.setMaxListeners(0) // one per open page
/** These API paths (prefixes) changed: open pages showing them read them again. */
export const stale = (...paths: string[]) => { live.emit('stale', paths) }

// A read that costs something to answer (every machine asked, every manifest read from disk) and that several pages
// ask for at once, or again every few seconds: answered once for all of them, and kept for a moment. Said stale
// (above), it is forgotten at once, so nobody is shown what is known to have changed.
const kept = new Map<string, { at: number; answer: Promise<unknown> }>()
export function shared<T>(key: string, ms: number, read: () => Promise<T>): Promise<T> {
  const had = kept.get(key)
  if (had && Date.now() - had.at < ms) return had.answer as Promise<T>
  const answer = read()
  kept.set(key, { at: Date.now(), answer })
  answer.catch(() => { if (kept.get(key)?.answer === answer) kept.delete(key) }) // a failure isn't kept
  return answer
}
live.on('stale', (paths: string[]) => { for (const k of [...kept.keys()]) if (paths.some((p) => k.startsWith(p) || p.startsWith(k))) kept.delete(k) })
