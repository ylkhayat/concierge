// Whether a comment on your PR asks anything of you, judged once by its meaning (a small model) and kept by the comment's
// id: never by matching phrases, which broke on every new wording ("🤖 _Drafted…_ Verified at …" read as a request,
// a reply's prefix hid "thanks"). What can't be judged (no answer, a failure) counts as waiting: nothing is hidden.
import { tmpdir } from 'node:os'
import { callClaude } from './explain.ts'
import { addSpend, save, state } from './store.ts'

const KEEP = 3000 // verdicts kept: the newest ones

/** The kept verdict for a comment: true it asks something of the author, false it doesn't, undefined not judged. */
export const verdictOf = (id: string): boolean | undefined => state.judged?.[id]
/** You said these need no answer (Nothing to answer): kept by comment id, so a new comment there counts again. */
export const settled = (id: string) => !!state.notWaiting?.includes(id)
export function markNotWaiting(ids: string[]) {
  if (!ids.length) return
  state.notWaiting = [...new Set([...(state.notWaiting ?? []), ...ids])].slice(-KEEP)
  save()
}

const SCHEMA = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, asks: { type: 'boolean' } }, required: ['id', 'asks'] } } }, required: ['verdicts'] }
const SYSTEM = `You read review comments left on someone's pull request. For each, decide whether it asks anything of the PR's author: a change, a fix, an answer to a question, a decision, a finding to address. A sign-off, a confirmation that something is fixed or verified, thanks, agreement, or a note that needs no reply does not ask anything. Ignore attribution lines such as "Drafted by Claude Code". Answer every id given, with asks true or false.`

let busy: Promise<void> = Promise.resolve()
/** Judge the comments not judged yet, in one small call; one at a time, so two syncs don't pay twice. */
export function judge(comments: { id: string; body: string }[]): Promise<void> {
  busy = busy.then(async () => {
    const todo = comments.filter((c) => c.id && verdictOf(c.id) === undefined)
    if (!todo.length) return
    try {
      const input = JSON.stringify(todo.slice(0, 40).map((c) => ({ id: c.id, comment: c.body.slice(0, 1500) })))
      const { result, cost, provider, tokens } = await callClaude<{ verdicts: { id: string; asks: boolean }[] }>(input, tmpdir(), undefined, () => {}, SCHEMA, 0.2, SYSTEM, 'haiku')
      addSpend(cost, provider, tokens)
      const all = { ...state.judged }
      for (const v of result.verdicts) if (todo.some((c) => c.id === v.id)) all[v.id] = !!v.asks
      state.judged = Object.fromEntries(Object.entries(all).slice(-KEEP))
      save()
    } catch (e) { console.warn(`judge: ${(e as Error).message.split('\n')[0]}`) } // unjudged: they count as waiting
  })
  return busy
}
