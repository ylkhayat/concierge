// Which skills a run should use, and in what setup: picked before a fresh ticket run starts, from the ticket and every
// skill that's there (the company's and your own, with what each is for). Clear signals decide by rule (a session id:
// the session investigator; a bug in production: the production investigation); anything less clear goes to a small
// model that reads the ticket against the catalog. The run is told to load those skills first and follow the plan; the
// ticket page shows it, and Activity says it.
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { haiku } from './next.ts'
import { orgSkills } from './orgSkills.ts'
import { textEnv } from './envOf.ts'
import { config, type SkillRule } from './config.ts'

export type Plan = {
  skills: { name: string; why: string }[]
  env?: 'prod' | 'dev' // which environment its investigation reads
  steps: string[]
  by: 'rules' | 'model'
  costUsd?: number
}
type Facts = { id: string; title: string; description?: string; labels?: string[]; env?: 'prod' | 'dev' }
type Skill = { name: string; description: string }

// --- the catalog: company skills that reach the agents, and your own (~/.claude/skills/<name>/SKILL.md)
let mine: { at: number; list: Skill[] } | undefined
async function ownSkills(): Promise<Skill[]> {
  if (mine && Date.now() - mine.at < 10 * 60_000) return mine.list
  const dir = join(homedir(), '.claude', 'skills'), list: Skill[] = []
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name === 'synced' || name.startsWith('.')) continue
    const text = await readFile(join(dir, name, 'SKILL.md'), 'utf8').catch(() => '')
    const description = text.match(/^description:\s*["']?([\s\S]*?)["']?\s*$/m)?.[1]
    if (description) list.push({ name, description: description.slice(0, 400) })
  }
  mine = { at: Date.now(), list }
  return list
}
export async function catalog(): Promise<Skill[]> {
  const org = orgSkills().filter((s) => s.mode !== 'off').map((s) => ({ name: s.name, description: s.description.slice(0, 400) }))
  return [...org, ...(await ownSkills()).filter((s) => !org.some((o) => o.name === s.name))]
}

const STEPS = ['Gather the evidence', 'Find the root cause', 'Make the smallest fix that holds', 'Run the checks and review it', 'Open the PR']
const bugLike = (f: Facts) => /\b(bug|user feedback|broken|crash|error|fails?|regression|incident)\b/i.test(`${f.title} ${(f.labels ?? []).join(' ')}`)
  || /sentry\.io\/(organizations\/[\w-]+\/)?issues\//i.test(f.description ?? '')

/** The plan by rule, when the ticket says plainly what it needs; undefined when it doesn't. */
export function byRules(f: Facts, have: Set<string>, rules: SkillRule[] = config.exec.rules ?? []): Plan | undefined {
  const text = `${f.title}\n${f.description ?? ''}`
  const env = f.env ?? ((e) => (e === 'prod' || e === 'dev' ? e : undefined))(textEnv(text)?.env)
  const skills: Plan['skills'] = []
  const add = (name: string, why: string) => { if (have.has(name) && !skills.some((s) => s.name === name)) skills.push({ name, why }) }
  // your rules (settings → exec.rules): a session id names its investigator, a production bug its investigation
  for (const r of rules) {
    const re = (x?: string) => { try { return x ? new RegExp(x, 'i') : undefined } catch { return undefined } }
    if (r.match && !re(r.match)?.test(text)) continue
    if (r.unless && re(r.unless)?.test(text)) continue
    if (r.bug && !bugLike(f)) continue
    if (r.env && r.env !== env) continue
    add(r.skill, r.why)
  }
  return skills.length ? { skills, env, steps: STEPS, by: 'rules' } : undefined
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['skills', 'env', 'steps'],
  properties: {
    skills: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'why'], properties: { name: { type: 'string' }, why: { type: 'string' } } } },
    env: { enum: ['prod', 'dev', 'none'] },
    steps: { type: 'array', items: { type: 'string' } },
  },
}

/** The plan for a ticket: by rule when it's clear, else a small model reads it against the catalog. */
export async function planFor(f: Facts): Promise<Plan | undefined> {
  const skills = await catalog()
  const have = new Set(skills.map((s) => s.name))
  const rules = byRules(f, have)
  if (rules) return rules
  if (!skills.length) return undefined
  const prompt = [
    `A coding agent is about to work on this ticket. Pick the skills (at most 3) that help most with it, from the list below, and only from it: none is fine when nothing fits. Say which environment's data it needs (prod, dev, or none), and the plan in 3 to 6 short steps.`,
    '', `Ticket ${f.id}: ${f.title}`, (f.labels ?? []).length ? `Labels: ${f.labels!.join(', ')}` : '', (f.description ?? '').slice(0, 4000),
    '', 'Skills:', ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].filter((l) => l !== undefined).join('\n')
  try {
    const { out, costUsd } = await haiku<{ skills: { name: string; why: string }[]; env: 'prod' | 'dev' | 'none'; steps: string[] }>(prompt, SCHEMA, 'You pick the right tools for a coding task. Return only the structured output.', 0.1)
    return {
      skills: out.skills.filter((s) => have.has(s.name)).slice(0, 3).map((s) => ({ name: s.name, why: s.why.slice(0, 200) })),
      ...(out.env !== 'none' && { env: out.env }), steps: out.steps.slice(0, 6).map((x) => x.slice(0, 160)), by: 'model', costUsd,
    }
  } catch { return undefined }
}

/** For the run's instructions: the skills to load first, the environment, and the plan. */
export function planNote(p?: Plan): string {
  if (!p || (!p.skills.length && !p.steps.length)) return ''
  return '\n\nConcierge planned this run from the ticket and the skills available.'
    + (p.skills.length ? ` Load these skills first, with the Skill tool (or read their files), and follow them: ${p.skills.map((s) => `${s.name} (${s.why})`).join('; ')}.` : '')
    + (p.env ? ` The problem is in ${p.env === 'prod' ? 'production' : 'development'}: read that environment's logs and data.` : '')
    + (p.steps.length ? ` The plan: ${p.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}` : '')
    + ' If the ticket turns out to need something else, say so and adapt.'
}
