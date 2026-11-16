// The product lens of a change, for the Product and Design roles: nothing technical. What it means in the domain's own
// terms (domain-driven design): the bounded contexts it touches, the entities and rules that change, the user's journey
// before and after, the screens and states people see, and the words the business uses. Written once per commit from
// what is already known (the explanation, the description, the tickets), so it costs one short call, and is kept.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { method } from './method.ts'
import { haiku } from './next.ts'
import type { ProviderId } from './providers.ts'
import { STATE_DIR } from './store.ts'

type Change = 'added' | 'changed' | 'removed'
export type Domain = {
  headSha: string; at: string; costUsd: number
  headline: string // the change in one sentence a customer would understand
  outcome: string // what gets better for whom, and how you'd notice (a metric, a behaviour)
  contexts: { name: string; meaning: string; touched: boolean }[] // bounded contexts: the parts of the business, touched or next to it
  entities: { name: string; context: string; change: Change; meaning: string }[] // the things of the domain, and what changed about them
  rules: { rule: string; change: Change }[] // business rules and invariants
  journey: { actor: string; step: string; change: Change | 'same' }[] // the user's path through it, in order, as it is after
  events: { name: string; when: string }[] // domain events: things that happen that the business cares about
  screens: { name: string; change: string; states?: string }[] // what people see: screens, copy, empty, loading and error states
  glossary: { term: string; meaning: string }[] // the ubiquitous language: the business's words, as this change uses them
  questions: string[] // what product or design should decide or check
}

const str = { type: 'string' }, chg = { enum: ['added', 'changed', 'removed'] }
const arr = (props: Record<string, unknown>, req: string[]) => ({ type: 'array', items: { type: 'object', additionalProperties: false, required: req, properties: props } })
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'outcome', 'contexts', 'entities', 'rules', 'journey', 'events', 'screens', 'glossary', 'questions'],
  properties: {
    headline: str, outcome: str,
    contexts: arr({ name: str, meaning: str, touched: { type: 'boolean' } }, ['name', 'meaning', 'touched']),
    entities: arr({ name: str, context: str, change: chg, meaning: str }, ['name', 'context', 'change', 'meaning']),
    rules: arr({ rule: str, change: chg }, ['rule', 'change']),
    journey: arr({ actor: str, step: str, change: { enum: ['added', 'changed', 'removed', 'same'] } }, ['actor', 'step', 'change']),
    events: arr({ name: str, when: str }, ['name', 'when']),
    screens: arr({ name: str, change: str, states: str }, ['name', 'change']),
    glossary: arr({ term: str, meaning: str }, ['term', 'meaning']),
    questions: { type: 'array', items: str },
  },
}

const dir = join(STATE_DIR, 'domain')
const file = (id: string) => join(dir, `${id.replace(/[^\w.-]+/g, '_')}.json`)
const kept = new Map<string, Domain>()
const writing = new Set<string>()

/** The kept lens of a PR (any commit: `stale` when it was written for an older one). */
export async function domainOf(id: string): Promise<Domain | undefined> {
  if (!kept.has(id)) { const d = await readFile(file(id), 'utf8').then((t) => JSON.parse(t) as Domain, () => undefined); if (d) kept.set(id, d) }
  return kept.get(id)
}
export const writingDomain = (id: string) => writing.has(id)

/** Write the lens in the background from `context` (what the change is); `done` gets its cost. */
export function writeDomain(id: string, headSha: string, context: string, done: (r: { costUsd: number; provider: ProviderId; tokens?: { input: number; output: number } }) => void, fail: (e: Error) => void) {
  if (writing.has(id)) return
  writing.add(id)
  method('explainDomain', 'Return only the structured output.')
    .then((system) => haiku<Omit<Domain, 'headSha' | 'at' | 'costUsd'>>(context, SCHEMA, system, 0.6, 'sonnet'))
    .then(async (r) => {
      const d: Domain = { ...r.out, headSha, at: new Date().toISOString(), costUsd: r.costUsd }
      kept.set(id, d)
      await mkdir(dir, { recursive: true }); await writeFile(file(id), JSON.stringify(d))
      done(r)
    }, fail)
    .finally(() => writing.delete(id))
}
