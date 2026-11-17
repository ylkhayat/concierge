// The stack's answer, boiled down. Each PR's agent leaves its own list (decisions, steps, public steps): read together
// they repeat and contradict each other, and the person was left to sort thirty-five items. One read turns them into a
// few decisions and an ordered list of steps, each still pointing at the items it stands for, so answering the short
// plan answers every agent exactly as its own list would have (StackNext.tsx sends each PR its own part). The method
// is the simplify-stack-steps skill; the shape it answers in, and the check that nothing was lost or made up, are here.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { method } from './method.ts'
import { STATE_DIR } from './paths.ts'
import { haiku, hashOf } from './next.ts'
import type { ProviderId } from './providers.ts'

export type PlanItem = { id: string; pr: number; kind: 'decide' | 'do' | 'publish'; text: string; why?: string; options?: string[]; recommended?: number; blocking?: boolean }
export type StackPlan = {
  summary: string
  decisions: { question: string; why: string; suggested: number; options: { label: string; picks: { id: string; option: number }[] }[] }[]
  steps: { text: string; why: string; items: string[]; public: boolean; on: boolean }[]
  skipped: { items: string[]; why: string }[]
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'decisions', 'steps', 'skipped'],
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'why', 'suggested', 'options'], properties: {
      question: { type: 'string' }, why: { type: 'string' }, suggested: { type: 'number' },
      options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'picks'], properties: {
        label: { type: 'string' }, picks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'option'], properties: { id: { type: 'string' }, option: { type: 'number' } } } } } } },
    } } },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'why', 'items', 'public', 'on'], properties: { text: { type: 'string' }, why: { type: 'string' }, items: { type: 'array', items: { type: 'string' } }, public: { type: 'boolean' }, on: { type: 'boolean' } } } },
    skipped: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['items', 'why'], properties: { items: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } } } },
  },
}
const FORMAT = `Return only the structured output.
decisions: each option's \`picks\` names, for every decision item it settles, that item's id and the 0-based index of the option of THAT item it means. \`suggested\`: the 0-based index of the option you suggest, or -1 for none.
steps: \`items\` are the ids of the do and publish items a step stands for. \`public\`: true when any of them is a publish item.
skipped: ids of do and publish items left out. Every item id appears exactly once across decisions' picks (decision items), steps and skipped (the others).`

/**
 * The plan made safe to act on: only ids that exist, options that exist, every item in one place. What the model lost
 * comes back as it was (a decision as its own decision, a step as its own step), so nothing an agent asked is dropped.
 */
export function settle(items: PlanItem[], raw: StackPlan): StackPlan {
  const by = new Map(items.map((x) => [x.id, x])), used = new Set<string>()
  const take = (ids: string[], kinds: PlanItem['kind'][]) => [...new Set(ids)].filter((id) => by.has(id) && kinds.includes(by.get(id)!.kind) && !used.has(id) && (used.add(id), true))
  const decisions = (raw.decisions ?? []).map((d) => {
    // the decision items this one settles: those every option gives a valid pick for
    const ids = [...new Set(d.options.flatMap((o) => o.picks.map((p) => p.id)))].filter((id) => by.get(id)?.kind === 'decide' && !used.has(id)
      && d.options.every((o) => { const p = o.picks.find((x) => x.id === id); return !!p && Number.isInteger(p.option) && p.option >= 0 && p.option < (by.get(id)!.options?.length ?? 0) }))
    ids.forEach((id) => used.add(id))
    const options = d.options.map((o) => ({ label: o.label, picks: o.picks.filter((p) => ids.includes(p.id)) }))
    return { question: d.question, why: d.why ?? '', suggested: Number.isInteger(d.suggested) && d.suggested >= 0 && d.suggested < options.length ? d.suggested : -1, options }
  }).filter((d) => d.options.length > 1 && d.options[0].picks.length > 0)
  const steps = (raw.steps ?? []).map((s) => { const ids = take(s.items ?? [], ['do', 'publish']); return { text: s.text, why: s.why ?? '', items: ids, public: ids.some((id) => by.get(id)!.kind === 'publish'), on: !!s.on } }).filter((s) => s.items.length)
  const skipped = (raw.skipped ?? []).map((s) => ({ items: take(s.items ?? [], ['do', 'publish']), why: s.why ?? '' })).filter((s) => s.items.length)
  for (const x of items) {
    if (used.has(x.id)) continue
    if (x.kind === 'decide') decisions.push({ question: `#${x.pr}: ${x.text}`, why: x.why ?? '', suggested: x.recommended ?? -1, options: (x.options ?? []).map((label, option) => ({ label, picks: [{ id: x.id, option }] })) })
    else steps.push({ text: `#${x.pr}: ${x.text}`, why: x.why ?? '', items: [x.id], public: x.kind === 'publish', on: true })
  }
  return { summary: raw.summary ?? '', decisions: decisions.filter((d) => d.options.length > 0), steps, skipped }
}

const prompt = (items: PlanItem[], steer?: string, direction?: string) => `${direction ? `The stack's direction (it outranks the agents' own recommendations):\n${direction}\n\n` : ''}${steer ? `The person's steer (it outranks everything else):\n${steer}\n\n` : ''}The items, one per line: id · PR · kind · text (why) [options, the agent's own pick marked *]

${items.map((x) => `${x.id} · #${x.pr} · ${x.kind}${x.blocking ? ' (needed)' : ''} · ${x.text}${x.why ? ` (${x.why})` : ''}${x.options?.length ? ` [${x.options.map((o, i) => `${i}: ${o}${i === x.recommended ? ' *' : ''}`).join(' | ')}]` : ''}`).join('\n')}`

type Made = StackPlan & { costUsd: number; provider?: ProviderId; tokens?: { input: number; output: number }; sig: string; steer: string }
// kept on disk, by the items it was read from: a restart (an update) must not make you pay and wait for the same read
// again, or hand you a different plan than the one you were answering. One plan per set of items: the last one read,
// with the steer it was read with
const DIR = join(STATE_DIR, 'explain')
const file = (items: PlanItem[]) => join(DIR, `stack-plan-${hashOf(JSON.stringify(items.map((x) => [x.id, x.kind, x.text, x.options])))}.json`)
const reading = new Map<string, Promise<Made>>()
/**
 * The plan for these items. With no steer and not `again`: the one last read for them, whatever steer that was read
 * with (so the page finds it again after a reload); otherwise read now, and kept.
 */
export async function planStack(items: PlanItem[], steer = '', direction = '', again = false): Promise<Made> {
  const f = file(items)
  if (!again && !steer.trim()) {
    const kept = await readFile(f, 'utf8').then((t) => JSON.parse(t) as Made, () => undefined)
    if (kept) return { ...kept, costUsd: 0 } // paid for when it was read
  }
  const sig = hashOf(JSON.stringify([f, steer.trim(), direction.trim(), again ? Date.now() : 0]))
  const key = `${f}|${steer.trim()}`
  if (!reading.has(key)) {
    reading.set(key, method('stackPlan', FORMAT).then((system) => haiku<StackPlan>(prompt(items, steer.trim() || undefined, direction.trim() || undefined), SCHEMA, system, 0.6, 'sonnet'))
      .then(async ({ out, ...rest }) => {
        const made: Made = { ...settle(items, out), ...rest, sig, steer: steer.trim() }
        await mkdir(DIR, { recursive: true }); await writeFile(f, JSON.stringify(made))
        return made
      }).finally(() => reading.delete(key)))
  }
  return reading.get(key)!
}
