// Across a stack's waiting steps: which say the same thing (one PR's agent asks another's to do what that agent already
// suggests), and which can't both happen (rebase A onto B, and B onto A; two decisions pulling opposite ways). The same
// wording is caught by its hash; the rest by a small model, cached per set of steps. Concierge's own reading, like the
// next steps it reads from a message: nothing here is a method of yours.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { haiku, hashOf, stepHash } from './next.ts'
import { STATE_DIR } from './paths.ts'
import type { ProviderId } from './providers.ts'

export type StackItem = { id: string; pr: number; text: string; kind: string; options?: string[] } // id: "<pr>:<index>"
export type StackReview = { duplicates: { items: string[]; why: string }[]; conflicts: { items: string[]; why: string; title?: string; keep?: string }[] } // title: the choice in a few words; keep: the side the texts favour ('' none)

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['duplicates', 'conflicts'],
  properties: {
    duplicates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['items', 'why'], properties: { items: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } } } },
    conflicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['items', 'why', 'title', 'keep'], properties: { items: { type: 'array', items: { type: 'string' } }, why: { type: 'string' }, title: { type: 'string' }, keep: { type: 'string' } } } },
  },
}
const SYSTEM = 'You read the next steps several coding agents propose for one stack of pull requests, and find the ones that are the same action and the ones that cannot both be done. Return only the structured output.'
const prompt = (items: StackItem[]) => `Each line is one proposed step or decision: its id, the PR whose agent proposes it, its kind (do, publish, decide), and its text.

duplicates: groups of two or more ids that would do the same thing to the same PR or branch, however worded (for example one agent asks #N's agent to rebase, and #N's own agent proposes the same rebase). Not steps that are merely similar in kind.
conflicts: groups of ids that cannot both be done, or would undo each other (rebase A onto B and B onto A; push before the rebase it depends on is undone; two decisions choosing opposite options on the same question). why: one short sentence each. title: the choice in at most 8 words, as a question ("Who moves the tool list?"). keep: the id of the side to keep when the texts favour one (the one more agents recommend, the one the others build on, the one marked as the agent's own job), else "".
Only what the texts support; empty lists when nothing qualifies.

${items.map((x) => `${x.id} · #${x.pr} · ${x.kind} · ${x.text}${x.options?.length ? ` (options: ${x.options.join(' / ')})` : ''}`).join('\n')}`

const seen = new Map<string, Promise<StackReview & { costUsd: number; provider?: ProviderId; tokens?: { input: number; output: number } }>>()
/** Duplicates and conflicts among `items`: the same wording at once, the rest read once per set of steps. */
export function reviewStack(items: StackItem[]) {
  const k = hashOf(items.map((x) => `${x.id}|${x.kind}|${x.text}`).join('\n'))
  // kept on disk as well: after a restart the same steps are not read (and paid for) again
  const f = join(STATE_DIR, 'explain', `stack-steps2-${k}.json`)
  if (!seen.has(k)) seen.set(k, readFile(f, 'utf8').then((t) => ({ ...(JSON.parse(t) as StackReview), costUsd: 0 }), () => fresh(items, k).then(async (r) => { await mkdir(join(STATE_DIR, 'explain'), { recursive: true }); await writeFile(f, JSON.stringify({ duplicates: r.duplicates, conflicts: r.conflicts })); return r })))
  if (seen.size > 200) seen.delete(seen.keys().next().value!)
  return seen.get(k)!
}
function fresh(items: StackItem[], _k: string): Promise<StackReview & { costUsd: number; provider?: ProviderId; tokens?: { input: number; output: number } }> {
    // the same wording, by hash: no model needed for those
    const byHash = new Map<string, string[]>()
    for (const x of items) byHash.set(stepHash(x.text), [...(byHash.get(stepHash(x.text)) ?? []), x.id])
    const exact = [...byHash.values()].filter((ids) => ids.length > 1 && new Set(ids.map((id) => id.split(':')[0])).size > 1).map((ids) => ({ items: ids, why: 'The same step, word for word.' }))
    const known = new Set(items.map((x) => x.id))
    const clean = <G extends { items: string[]; keep?: string }>(groups: G[]) => groups.map((g) => ({ ...g, items: [...new Set(g.items)].filter((id) => known.has(id)), ...(g.keep !== undefined && { keep: g.items.includes(g.keep) && known.has(g.keep) ? g.keep : '' }) })).filter((g) => g.items.length > 1)
    return (items.length < 2 ? Promise.resolve({ out: { duplicates: [], conflicts: [] } as StackReview, costUsd: 0 }) : haiku<StackReview>(prompt(items), SCHEMA, SYSTEM, 0.1))
      .then(({ out, costUsd, ...rest }) => {
        const dup = clean(out.duplicates ?? []).filter((g) => !exact.some((e) => g.items.every((id) => e.items.includes(id))))
        return { duplicates: [...exact, ...dup], conflicts: clean(out.conflicts ?? []), costUsd, ...rest }
      }, () => ({ duplicates: exact, conflicts: [], costUsd: 0 }))
}
