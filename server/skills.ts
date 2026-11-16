// How the skills are used, and how well they work: counted from the lifecycle log (events.jsonl), where every run's
// last event names the skills it used and how often you steered it. Runs from before that was recorded get their
// skills read back from their activity logs, once, and kept here.
import { runs } from './lifecycle.ts'
import { activityBetween, commandSkill } from './runner.ts'
import { config } from './store.ts'
import { mySkills, skillFile, starterSkills } from './setup.ts'
import { orgSkills, setMode } from './orgSkills.ts'
import { mkdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { haiku } from './next.ts'

export type Run = Awaited<ReturnType<typeof runs>>[number]
type Kind = 'review' | 'revise' | 'exec' | 'other'
export type Verdict = 'good' | 'watch' | 'fix' | 'few'

export type SkillRow = {
  name: string
  runs: number; done: number; failed: number; cancelled: number
  costUsd: number; turns: number // turns: per run, on average
  steers: number // your messages while its runs worked, in all
  refusedRuns: number // runs that had a tool refused
  followed: number // runs redone: the same kind on the same PR or ticket again within two hours
  lastAt: string
  kinds: Partial<Record<Kind, number>>
  score: number; verdict: Verdict; reasons: string[]
  recent: { at: string; entity: string; id: string; to: string }[]
  perDay: Record<string, number> // runs per day, for its trend
}
export type Advice = { kind: 'new' | 'modify' | 'remove'; skill?: string; title: string; why: string; evidence?: string[] }

const REDO = 2 * 3600_000, DAY = 86400_000
const kindOf = (r: Run): Kind => r.entity === 'exec' ? 'exec' : r.kind === 'review' ? 'review' : r.kind === 'revise' ? 'revise' : 'other'
const ENDED = new Set(['done', 'failed', 'cancelled', 'interrupted'])

/**
 * Per skill: its runs, how they ended, what they cost, and a usefulness score out of 100 from four signals: they
 * finish (40), they need no second run (25), they need little steering (20), nothing they need is refused (15).
 */
export function scoreSkills(list: Run[]): SkillRow[] {
  const ended = list.filter((r) => ENDED.has(r.to))
  // a run "redone" when the same kind of run on the same PR or ticket started again within two hours of it ending: the
  // first try wasn't enough. The next step of the flow (a post after a review, a push after a revise, a reply to its
  // question) is another kind, so it doesn't count
  const byThing = new Map<string, Run[]>()
  for (const r of ended) { const k = `${r.entity}|${r.id}|${r.kind ?? ''}`; byThing.set(k, [...(byThing.get(k) ?? []), r]) }
  const followed = new Set<Run>()
  for (const rs of byThing.values()) {
    rs.sort((a, b) => a.at.localeCompare(b.at))
    // a ticket's runs chain by design (it asks, you answer, it goes on): there only a run that didn't finish counts
    for (let i = 0; i + 1 < rs.length; i++) if ((rs[i].entity !== 'exec' || rs[i].to !== 'done') && Date.parse(rs[i + 1].queuedAt ?? rs[i + 1].at) - Date.parse(rs[i].at) < REDO) followed.add(rs[i])
  }
  const rows = new Map<string, SkillRow>()
  for (const r of ended) for (const name of r.skills ?? []) {
    const s = rows.get(name) ?? { name, runs: 0, done: 0, failed: 0, cancelled: 0, costUsd: 0, turns: 0, steers: 0, refusedRuns: 0, followed: 0, lastAt: '', kinds: {}, score: 0, verdict: 'few' as Verdict, reasons: [], recent: [], perDay: {} }
    s.runs++
    if (r.to === 'done') s.done++; else if (r.to === 'cancelled') s.cancelled++; else s.failed++
    s.costUsd += r.costUsd ?? 0; s.turns += r.turns ?? 0; s.steers += r.steers ?? 0
    if (r.refused) s.refusedRuns++
    if (followed.has(r)) s.followed++
    if (r.at > s.lastAt) s.lastAt = r.at
    s.kinds[kindOf(r)] = (s.kinds[kindOf(r)] ?? 0) + 1
    s.recent.push({ at: r.at, entity: r.entity, id: r.id, to: r.to })
    s.perDay[r.at.slice(0, 10)] = (s.perDay[r.at.slice(0, 10)] ?? 0) + 1
    rows.set(name, s)
  }
  for (const s of rows.values()) {
    s.turns = s.runs ? s.turns / s.runs : 0
    s.recent = s.recent.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
    const judged = s.runs - s.cancelled // cancelled is your call, not the skill's
    const finish = judged ? s.done / judged : 1
    const firstTry = 1 - s.followed / s.runs
    const quiet = 1 - Math.min(1, s.steers / s.runs / 2) // two of your messages a run reads as needing a hand throughout
    const clean = 1 - s.refusedRuns / s.runs
    s.score = Math.round(100 * (0.4 * finish + 0.25 * firstTry + 0.2 * quiet + 0.15 * clean))
    s.verdict = s.runs < 3 ? 'few' : s.score >= 80 ? 'good' : s.score >= 60 ? 'watch' : 'fix'
    if (judged && finish < 0.8) s.reasons.push(`${Math.round((1 - finish) * 100)}% of its runs failed or were stopped`)
    if (firstTry < 0.75) s.reasons.push(`${s.followed} of ${s.runs} runs were run again within two hours`)
    if (quiet < 0.75) s.reasons.push(`you stepped in ${(s.steers / s.runs).toFixed(1)} times a run`)
    if (clean < 0.85) s.reasons.push(`${s.refusedRuns} run${s.refusedRuns === 1 ? '' : 's'} had a tool refused`)
  }
  return [...rows.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
}

/** What to do about the skills: modify the ones that struggle, remove the unused, write one where runs keep needing you. */
export function advise(rows: SkillRow[], installed: string[], bare: { runs: number; steers: number; kinds: Partial<Record<Kind, number>> }, days: number): Advice[] {
  const out: Advice[] = []
  for (const s of rows) {
    if (s.verdict === 'fix' && s.runs >= 5 && s.score < 40) out.push({ kind: 'remove', skill: s.name, title: `Rewrite or remove ${s.name}`, why: `It scores ${s.score} over ${s.runs} runs: ${s.reasons.join('; ')}.` })
    else if (s.verdict === 'fix' || s.verdict === 'watch') out.push({ kind: 'modify', skill: s.name, title: `Improve ${s.name}`, why: `${s.reasons.join('; ') || 'Its runs are uneven'}.` })
  }
  const used = new Set(rows.map((s) => s.name))
  const idle = installed.filter((n) => !used.has(n))
  if (idle.length) out.push({ kind: 'remove', title: `${idle.length} skill${idle.length === 1 ? '' : 's'} unused in ${days} days`, why: 'No run loaded them. Remove what you no longer need, or check the ones a run should have picked.', evidence: idle.slice(0, 30) })
  if (bare.runs >= 3 && bare.steers / bare.runs >= 1) {
    const top = Object.entries(bare.kinds).sort((a, b) => b[1] - a[1])[0]?.[0]
    out.push({ kind: 'new', title: 'A skill for the runs that keep needing you', why: `${bare.runs} runs used no skill beyond their command, and you stepped in ${bare.steers} times${top ? `, mostly on ${top === 'exec' ? 'tickets' : `${top}s`}` : ''}. Draft one from what you told them.` })
  }
  return out
}

// skills (and your messages) read back from the activity of runs from before they were recorded: kept per run
const backfilled = new Map<string, { skills: string[]; steers: number }>()
const keyOf = (r: Run) => (r.entity === 'exec' ? `exec:${r.run}` : r.id)

async function withSkills(list: Run[]): Promise<Run[]> {
  const out: Run[] = []
  for (const r of list) {
    if (r.skills || !ENDED.has(r.to) || (r.entity !== 'job' && r.entity !== 'exec') || !r.startedAt) { out.push(r); continue }
    const k = `${keyOf(r)}|${r.run}`
    if (!backfilled.has(k)) {
      const acts = await activityBetween(keyOf(r), r.startedAt, r.at)
      const s = new Set<string>(); let steers = 0
      for (const a of acts) { if (a.kind === 'tool' && a.tool === 'Skill' && a.text) s.add(a.text.trim().replace(/^\//, '').split(/\s/)[0]); if (a.skill) s.add(a.skill); if (a.kind === 'you') steers++ }
      const cmd = r.entity === 'exec' ? config.exec.command : r.kind === 'review' || r.kind === 'revise' ? config.agent[r.kind].command : undefined
      const c = commandSkill(cmd); if (c) s.add(c)
      backfilled.set(k, { skills: [...s], steers })
    }
    out.push({ ...r, skills: backfilled.get(k)!.skills, steers: r.steers ?? backfilled.get(k)!.steers })
  }
  return out
}

export type Source = 'mine' | 'company' | 'starter' | 'plugin'
export type Installed = { name: string; source: Source; tokens?: number; mode?: string } // tokens: its SKILL.md, loaded each time

async function installed(): Promise<Installed[]> {
  const org = new Map(orgSkills().map((s) => [s.name, s]))
  const starters = new Set(starterSkills().map((s) => s.name))
  const names = [...new Set([...(await mySkills().catch(() => [])), ...starters, ...org.keys()])]
  return Promise.all(names.sort().map(async (name): Promise<Installed> => {
    const source: Source = org.has(name) ? 'company' : starters.has(name) ? 'starter' : name.includes(':') ? 'plugin' : 'mine'
    const file = org.get(name)?.file ?? await skillFile(name)
    const bytes = file ? (await stat(file).catch(() => undefined))?.size : undefined
    return { name, source, tokens: bytes ? Math.round(bytes / 4) : undefined, mode: org.get(name)?.mode }
  }))
}

/** Everything the Skills workspace shows, for the last `days`, with the same span before it for the trend. */
export async function skillsView(days: number) {
  const both = await withSkills((await runs(days * 2)).filter((r) => r.entity === 'job' || r.entity === 'exec'))
  const since = new Date(Date.now() - days * DAY).toISOString()
  const list = both.filter((r) => r.at >= since), before = both.filter((r) => r.at < since)
  const rows = scoreSkills(list)
  const prev = new Map(scoreSkills(before).map((s) => [s.name, s.runs]))
  const commands = new Set([config.agent.review.command, config.agent.revise.command, config.exec.command].map(commandSkill).filter(Boolean))
  const ended = list.filter((r) => ENDED.has(r.to))
  const bareRuns = ended.filter((r) => !(r.skills ?? []).some((s) => !commands.has(s)))
  const bare = { runs: bareRuns.length, steers: bareRuns.reduce((n, r) => n + (r.steers ?? 0), 0), kinds: {} as Partial<Record<Kind, number>> }
  for (const r of bareRuns) bare.kinds[kindOf(r)] = (bare.kinds[kindOf(r)] ?? 0) + 1
  const have = await installed()
  const meta = new Map(have.map((i) => [i.name, i]))
  const perDay: Record<string, number> = {}
  for (const r of ended) if (r.skills?.length) perDay[r.at.slice(0, 10)] = (perDay[r.at.slice(0, 10)] ?? 0) + 1
  return {
    days, runs: ended.length, withSkill: ended.filter((r) => r.skills?.some((s) => !commands.has(s))).length,
    skills: rows.map((s) => ({ ...s, before: prev.get(s.name) ?? 0, source: meta.get(s.name)?.source ?? (s.name.includes(':') ? 'plugin' as Source : 'mine' as Source), tokens: meta.get(s.name)?.tokens, mode: meta.get(s.name)?.mode })),
    installed: have, perDay, advice: advise(rows, have.map((i) => i.name), bare, days),
  }
}

const IMPROVE = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['keep', 'change', 'remove'] },
  why: { type: 'string' },
  changes: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string' }, edit: { type: 'string' } }, required: ['title', 'why', 'edit'] } },
  tokens: { type: 'object', properties: { after: { type: 'number' }, how: { type: 'string' } }, required: ['after', 'how'] },
  rewrite: { type: 'string' },
}, required: ['verdict', 'why', 'changes', 'tokens', 'rewrite'] }

/**
 * What to change in one skill, read from the skill itself, how its runs went, and what you told the agents in them:
 * concrete edits for the goal, and where it could cost fewer tokens. One Sonnet call; nothing is changed by it.
 */
export async function improveSkill(name: string, days: number) {
  const v = await skillsView(days)
  const row = v.skills.find((s) => s.name === name), meta = v.installed.find((i) => i.name === name)
  const file = orgSkills().find((s) => s.name === name)?.file ?? await skillFile(name)
  const text = file ? await import('node:fs/promises').then((f) => f.readFile(file, 'utf8')).catch(() => '') : ''
  const list = (await withSkills((await runs(days)).filter((r) => (r.entity === 'job' || r.entity === 'exec') && r.startedAt))).filter((r) => r.skills?.includes(name))
  const said: string[] = []
  for (const r of list.slice(0, 25)) {
    for (const a of await activityBetween(keyOf(r), r.startedAt!, r.at)) if (a.kind === 'you' && a.text.length > 12) said.push(a.text.slice(0, 300))
    if (said.length >= 40) break
  }
  const errors = list.filter((r) => r.error).map((r) => r.error!.slice(0, 160)).slice(0, 8)
  const prompt = `The skill "${name}" (${meta?.source ?? 'unknown'} skill, about ${meta?.tokens ?? '?'} tokens, loaded on each run that uses it):\n\n${text.slice(0, 24000) || '(its file could not be read)'}\n\n`
    + (row ? `Over ${days} days: ${row.runs} runs, ${row.done} finished, ${row.followed} run again within two hours, ${(row.steers / row.runs).toFixed(1)} messages from the developer a run, ${row.refusedRuns} with a tool refused, $${row.costUsd.toFixed(2)} in all. Score ${row.score}/100${row.reasons.length ? `: ${row.reasons.join('; ')}` : ''}.` : `No run used it in ${days} days.`)
    + `\n\nWhat the developer told the agents while they used it:\n${said.join('\n') || '(nothing)'}\n\nErrors its runs ended with:\n${errors.join('\n') || '(none)'}`
    + '\n\nSay whether to keep, change or remove it. Propose at most 5 concrete edits that would make its runs reach the goal with less of the developer\'s help (quote what to add, cut or rewrite), and how its token cost could drop (what to cut or move out, and the size it would have after).'
    + ' Then give rewrite: the whole skill file with every edit applied and the cuts made, ready to paste over the old one: keep its frontmatter (name, description) and everything that still earns its place, in its own voice. When the verdict is remove, rewrite is an empty string.'
  // the rewrite is the whole file: the budget allows for writing it out
  const { out, costUsd } = await haiku<{ verdict: 'keep' | 'change' | 'remove'; why: string; changes: { title: string; why: string; edit: string }[]; tokens: { after: number; how: string }; rewrite: string }>(
    prompt, IMPROVE, 'You review an AI coding agent\'s skill file for usefulness and token cost, from evidence, and rewrite it. Return only the structured output.', 1.5, 'sonnet')
  return { ...out, costUsd, tokensNow: meta?.tokens, tokensNew: out.rewrite ? Math.round(out.rewrite.length / 4) : undefined, file: file?.replace(homedir(), '~'), from: said.length }
}

/**
 * Take a skill out of use: yours or a starter is moved to ~/.claude/skills/.removed (put it back to restore), a company
 * skill is turned off here (it stays in the company's set), a plugin's is left to its plugin.
 */
export async function removeSkill(name: string): Promise<string> {
  if (orgSkills().some((s) => s.name === name)) { setMode(name, 'off'); return `${name} is off: no run here loads it. It stays in the company's skills.` }
  if (name.includes(':')) throw new Error('A plugin\'s skill: turn the plugin off in Claude Code instead')
  const file = await skillFile(name)
  if (!file) throw new Error(`Can't find ${name}`)
  const isCommand = file.endsWith(`${basename(name)}.md`) && basename(dirname(file)) === 'commands'
  const from = isCommand ? file : dirname(file)
  const bin = join(homedir(), '.claude', isCommand ? 'commands' : 'skills', '.removed')
  await mkdir(bin, { recursive: true })
  const to = join(bin, `${basename(from).replace(/\.md$/, '')}-${new Date().toISOString().slice(0, 10)}${isCommand ? '.md' : ''}`)
  await rename(from, to)
  return `Moved to ${to.replace(homedir(), '~')}: move it back to restore it.`
}

const SCHEMA = { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'object', properties: {
  kind: { type: 'string', enum: ['new', 'modify', 'remove'] }, skill: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' }, change: { type: 'string' },
}, required: ['kind', 'title', 'why', 'change'] } } }, required: ['suggestions'] }

/**
 * Proposals written by the small model from what you told the agents while they worked (your steering repeats what
 * a skill should have said) and how each skill scores. One call, a few cents; nothing changes until you act on it.
 */
export async function suggestSkills(days: number) {
  const v = await skillsView(days)
  const list = await withSkills((await runs(days)).filter((r) => (r.entity === 'job' || r.entity === 'exec') && (r.steers ?? 0) > 0 && r.startedAt))
  const said: string[] = []
  for (const r of list.slice(0, 40)) {
    for (const a of await activityBetween(keyOf(r), r.startedAt!, r.at)) if (a.kind === 'you' && a.text.length > 12) said.push(`[${(r.skills ?? []).join(', ') || 'no skill'}] ${a.text.slice(0, 400)}`)
    if (said.length >= 80) break
  }
  const prompt = `Skills are instructions a coding agent loads for a kind of work (reviewing a PR, revising one, shipping a ticket).\n\n`
    + `How each skill did over ${days} days (score out of 100; finishing, no second run needed, little steering, no refused tools):\n`
    + v.skills.map((s) => `- ${s.name}: ${s.runs} runs, score ${s.score}${s.reasons.length ? ` (${s.reasons.join('; ')})` : ''}`).join('\n')
    + `\n\nInstalled but unused: ${v.installed.filter((i) => !v.skills.some((s) => s.name === i.name)).map((i) => i.name).join(', ') || 'none'}\n\n`
    + `What the person told the agents while they worked, each with the skills that run used:\n${said.join('\n') || '(nothing)'}\n\n`
    + 'Suggest at most 6 changes: a new skill where the same correction keeps coming back, a change to a skill that scores low (say what to add or change in it), or removing one. Be concrete: name the instruction to write. Only what the evidence supports.'
  const { out, costUsd } = await haiku<{ suggestions: (Advice & { change: string })[] }>(prompt, SCHEMA, 'You review how well a team\'s agent skills work and propose concrete changes. Return only the structured output.', 0.3)
  return { suggestions: out.suggestions ?? [], costUsd, from: said.length }
}
