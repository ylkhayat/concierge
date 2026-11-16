import { haiku } from './next.ts'

/**
 * Split picked tickets into runs: tickets that build on each other go in one stack (in build order), independent
 * ones run side by side. A small model reads the tickets; whatever it returns is checked, and a bad answer falls
 * back to one stack per repo, which is what a multi-pick did before.
 */
export type Prep = { ids: string[]; task: string }
export type Plan = { stacks: string[][]; why: string; prep?: Prep; costUsd: number; provider?: import('./providers.ts').ProviderId; tokens?: { input: number; output: number } }
type T = { id: string; title: string; description: string; repo: string }

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['stacks', 'why', 'prep'],
  properties: {
    stacks: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, why: { type: 'string' },
    prep: { type: 'object', additionalProperties: false, required: ['ids', 'task'], properties: { ids: { type: 'array', items: { type: 'string' } }, task: { type: 'string' } } },
  },
}
const PROMPT = (ts: T[], note: string) => `Plan how to ship these tickets. Every ticket is built at the same time by its own agent; you plan what they share and the order they are submitted in.
stacks: a stack is an ordered chain of PRs, submitted together once all of them are done, each on top of the one before. Put tickets in one stack only when a later one needs the earlier one's code (it extends, uses, or edits what the earlier one adds), or when both would edit the same code and conflict.
- Tickets that do not depend on each other go in separate stacks, so they run in parallel. Prefer more, smaller stacks when unsure.
- Order each stack foundations first. Never put tickets from different repos in one stack.
- Every ticket id appears exactly once.
prep: when several tickets need the same thing settled before they can be built apart (a decision, or shared code: a type, interface, schema, migration or helper that more than one uses, or that a later ticket in a stack needs from an earlier one), list those tickets in ids and say in one or two sentences what to settle in task. A short agent does only that first, then every ticket is built on top of it. Prep tickets are all in one repo. Nothing shared: ids [] and task "".
why: one short sentence per stack with more than one ticket, saying what links them; or "All independent."
${note ? `\nThe person's direction for these tickets (follow it where it bears on grouping or order):\n<direction>${note}</direction>\n` : ''}
${ts.map((t) => `<ticket id="${t.id}" repo="${t.repo}">\n${t.title}\n${t.description.slice(0, 1500)}\n</ticket>`).join('\n')}`

/** Each repo's tickets in one stack, in the order picked. */
export const byRepo = (ts: T[]) => [...new Set(ts.map((t) => t.repo))].map((r) => ts.filter((t) => t.repo === r).map((t) => t.id))

/** Is this a usable plan for these tickets: each once, no stack across repos? */
export function valid(stacks: string[][], ts: T[]): boolean {
  const ids = stacks.flat()
  const repo = (id: string) => ts.find((t) => t.id === id)?.repo
  return ids.length === ts.length && new Set(ids).size === ids.length && ids.every(repo) && stacks.every((s) => s.length && s.every((id) => repo(id) === repo(s[0])))
}

/** A prep worth running: two or more known tickets, one repo, and something to settle. */
export function validPrep(p: Prep | undefined, ts: T[]): Prep | undefined {
  const repo = (id: string) => ts.find((t) => t.id === id)?.repo
  const ids = [...new Set(p?.ids ?? [])]
  return p && p.task.trim() && ids.length > 1 && ids.every(repo) && ids.every((id) => repo(id) === repo(ids[0])) ? { ids, task: p.task.trim().slice(0, 1000) } : undefined
}

export async function planStacks(ts: T[], note = ''): Promise<Plan> {
  if (ts.length < 2) return { stacks: [ts.map((t) => t.id)], why: '', costUsd: 0 }
  try {
    const { out, costUsd, provider, tokens } = await haiku<{ stacks: string[][]; why: string; prep?: Prep }>(PROMPT(ts, note), SCHEMA, 'You plan how to split coding tickets into independent stacks. Return only the structured output.', 0.3)
    return valid(out.stacks, ts) ? { ...out, prep: validPrep(out.prep, ts), costUsd, provider, tokens } : { stacks: byRepo(ts), why: 'Kept as picked: the plan did not cover every ticket once.', costUsd, provider, tokens }
  } catch (e) {
    return { stacks: byRepo(ts), why: `Kept as picked: ${(e as Error).message.slice(0, 120)}`, costUsd: 0 }
  }
}
