import { currentRole, slot } from './roles.ts'
import { copilotProblem } from './providers.ts'
import { UNTRUSTED_ARGS, UNTRUSTED_NOTE, untrustedEnv } from './untrusted.ts'
import { type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { appendFile, open, readdir, stat } from 'node:fs/promises'
import { freemem, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { explain, loadOverlay, mapBase } from './explain.ts'
import { execCommand, furthest, handoversIn, MULTI_NOTE, outcomesIn, phaseOf, prLinksIn, stackLinesIn, type Phase } from './exec.ts'
import { defaultBranch } from './github.ts'
import { fill } from './config.ts'
import { STATE_DIR, config, isFollowUp, type BaseTask, type ExecRun, type ExplainTask, type Job, type JobState, LOG_DIR, MAX_CONTINUES, overBudget, save, slow, spentToday, state, type JobKind, type Pr, addSpend } from './store.ts'
import { authFailed, cantPay, checkClaudeAuth } from './claudeLogin.ts'
import { planNote } from './router.ts'
import { missingOn } from './connections.ts'
import { markUsed, skillsIn, skillsNote } from './orgSkills.ts'
import { normsNote } from './norms.ts'
import { accountOf, available, codexWindowsOf, kindOf, limitedUntil, limitUntil, llamaPulling, markLimited, openaiAuth, providerFor, identityOf, spawnAgent, tokensOf, watchClaudePlan, watchPlanUse, type ProviderId, type Work } from './providers.ts'
import { eventsSync, eventsWritten, transition } from './lifecycle.ts'
import { fleet } from './fleet.ts'
import { mine, readLines } from './perMachine.ts'
import { scrub } from './scrub.ts'
import { busyUnder, newRun, watch as watchBackground } from './background.ts'
import { draining, machines, place, slotsHere, token } from './machines.ts'
import { remoteAgent } from './worker.ts'
import { STOP_AT, limitHit, spentText, spentWindow, windowsOf } from './usage.ts'
import { sharedNow } from './sharedEnv.ts'
import { DECIDE_NOTE, LOCAL_NOTE, fromAgent, hashOf, proseOf, type NextSteps } from './next.ts'

/** A run's final words: the prose kept as its summary, and the decisions block it ended with as its next steps. */
function finalWords(result: string): { summary: string; next?: NextSteps } {
  const { text, steps } = fromAgent(result.trim())
  const summary = scrub(text).slice(0, 12000)
  return { summary, next: steps && { ...steps, for: hashOf(summary) } }
}

export const bus = new EventEmitter()

export type Activity = {
  at: string
  kind: 'text' | 'tool' | 'denied' | 'result' | 'error' | 'section' | 'you' | 'event' // you: what you did or said; event: from outside (a push, comments)
  lane?: 'intent' | 'understanding' // a turn of a discussion beside the work (discussions.ts), shown in the same conversation
  who?: string // an event's actor
  tool?: string
  text: string
  plan?: { skills: { name: string; why: string }[]; steps: string[]; env?: string; by: string } // an event: the run's plan, before it starts
  todos?: { text: string; state: 'pending' | 'in_progress' | 'completed' }[] // a TodoWrite: the agent's own plan as it stands now
  // an event's data, kept apart from its sentence so the feed shows the sentence and lists these under it
  items?: { label: string; detail?: string }[] // e.g. background tasks: what each is, and its command
  names?: string[] // e.g. connectors that didn't start
  skill?: string // a skill it loaded: readable on hover
  costUsd?: number; ms?: number // a result: what the turn cost, and how long it took
}

// log writes never hold the thread: queued per file (so lines keep their order) and written off it
const queues = new Map<string, Promise<void>>()
function append(file: string, text: string) {
  const next = (queues.get(file) ?? Promise.resolve()).then(() => appendFile(file, text)).catch(() => { /* no log yet */ })
  queues.set(file, next)
  next.then(() => { if (queues.get(file) === next) queues.delete(file) })
}
// a feed's log: this machine appends to its own copy (perMachine.ts); a feed reads every machine's, in time order
const sharedLog = (id: string) => join(LOG_DIR, `${id.replace(/[/#]/g, '_')}.jsonl`)
const logFile = (id: string) => mine(sharedLog(id))

// one slot per running task: `<pr id>` for review/revise jobs, `<pr id>:explain` for explanations
export const children = new Map<string, Pick<ChildProcess, 'kill'> & Partial<Pick<ChildProcess, 'stdin'>>>()
const feeds = new Map<string, Activity[]>()
// runs whose result is in, kept alive only by a background task the agent started: a restart finds them done
const resultIn = new Set<string>()
let stopping = false // the server is going down: runs stay as they are, for the next start to continue

// what a run stopped by a restart gets instead of its command, on its own session
const continuePrompt = (asked: string) => `Concierge restarted while you were working (a deploy), and your process was stopped mid-run. `
  + `Continue the same task from where you left off. It was: ${asked}\n\n`
  + 'Your last steps may or may not have landed, so look before you act: re-read the files, worktree and git state you were changing. '
  + 'Anything already posted, pushed, commented or moved on GitHub or Linear counts as done: never do it twice.\n'
  + 'Processes you started are gone (the crit daemon, background shells and tasks, dev servers): start again only what you still need. '
  + 'The crit port is pinned, so its URL stays the same. If git reports an index.lock and no git is running, remove the lock.\n'
  + 'Then finish exactly as the original instructions say, including how to end your turn.'

const short = (s: unknown, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': return short(input.description || input.command)
    case 'Read': case 'Write': case 'Edit': return short(input.file_path)
    case 'Grep': case 'Glob': return short(input.pattern)
    case 'Skill': return short(input.skill)
    case 'Agent': return short(input.description)
    default: return short(Object.values(input).find((v) => typeof v === 'string') ?? JSON.stringify(input), 100)
  }
}

// a tool call Claude Code refused: no permission, outside the working directories, or it would have needed approval
const REFUSED = /requires? approval|needs approval|was blocked|has been denied|haven't granted|not allowed/i
const toolResultText = (c: any) => short(typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join(' '), 220)

/** One stream-json line → zero or more feed entries. */
// a connector's tools are named mcp__<its name, anything but letters, digits, _ and - made _>__<tool>
const usable = (server: string) => {
  const p = `mcp__${server.replace(/[^\w-]/g, '_')}`
  return [...config.agent.allowedTools, ...config.exec.allowedTools, ...config.exec.actions.flatMap((a) => a.allowedTools ?? [])]
    .some((t) => t === p || t.startsWith(`${p}__`))
}

export function parseLine(line: string): Activity[] {
  let m: any
  try { m = JSON.parse(line) } catch { return [] }
  const at = m.timestamp ?? new Date().toISOString()
  if (m.type === 'review-deck') return m.activity ? [m.activity] : [{ at, kind: 'section', text: m.section }]
  if (m.type === 'assistant' && !m.parent_tool_use_id) {
    return (m.message?.content ?? []).flatMap((c: any): Activity[] => {
      // what it says keeps its lines: it is markdown, which the feed renders
      if (c.type === 'text' && proseOf(c.text).trim()) return [{ at, kind: 'text', text: proseOf(c.text).trim().replace(/\n{3,}/g, '\n\n').slice(0, 6000) }]
      if (c.type === 'tool_use') return [{ at, kind: 'tool', tool: c.name.replace(/^mcp__\w+?__/, ''), text: (c.input?.run_in_background ? 'in the background: ' : '') + toolLabel(c.name, c.input ?? {}),
        ...(c.name === 'TodoWrite' && Array.isArray(c.input?.todos) && { todos: c.input.todos.slice(0, 30).map((t: any) => ({ text: String(t.content ?? t.activeForm ?? '').slice(0, 160), state: ['in_progress', 'completed'].includes(t.status) ? t.status : 'pending' })) }) }]
      return []
    })
  }
  // a tool that failed or was refused, the moment it happens (the run's result only lists the refusals at the end,
  // all stamped with its time): without this a failed call reads as a success in the feed
  if (m.type === 'user' && !m.parent_tool_use_id) {
    return (m.message?.content ?? []).flatMap((c: any): Activity[] => {
      if (c.type !== 'tool_result' || !c.is_error) return []
      const text = toolResultText(c)
      return [{ at, kind: REFUSED.test(text) ? 'denied' : 'error', text }]
    })
  }
  // connectors that didn't start: an agent that needs one fails later for a reason it never names. Only the ones an
  // agent may use: a synced plugin's Gmail that no allowlist mentions failing changes nothing
  if (m.type === 'system' && m.subtype === 'init') {
    const failed = (m.mcp_servers ?? []).filter((s: any) => s.status === 'failed' && usable(s.name)).map((s: any) => s.name)
    return failed.length ? [{ at, kind: 'event', text: `${failed.length === 1 ? 'A connector' : `${failed.length} connectors`} didn't start: the agent can't use ${failed.length === 1 ? 'it' : 'them'} this run.`, names: failed }] : []
  }
  if (m.type === 'result') {
    const text = proseOf(String(m.result ?? '')).trim()
    if (!text && !m.is_error) return [] // an empty 0-turn result (stale task notification): nothing to show
    return [{ at, kind: m.is_error ? 'error' : 'result', text: text || m.subtype,
      ...(typeof m.total_cost_usd === 'number' && { costUsd: m.total_cost_usd }), ...(typeof m.duration_ms === 'number' && { ms: m.duration_ms }) }]
  }
  return []
}

/** What each refusal in a run's result was: "Bash: git diff …", for the run's summary and its alert. */
export const refusalsOf = (r: any): string[] =>
  (r?.permission_denials ?? []).map((d: any) => `${d.tool_name}: ${toolLabel(d.tool_name, d.tool_input ?? {})}`).slice(0, 20)

/**
 * Stream lines carry no time of their own, so a reloaded log would date them all "now". Each line written gets its
 * arrival time as its first field. Tracks line starts across chunks, so a chunk that begins mid-line is left alone.
 */
export function stamper() {
  let atStart = true
  return (chunk: Buffer | string) => {
    const text = String(chunk), now = JSON.stringify(new Date().toISOString())
    let out = ''
    for (let i = 0; i < text.length; i++) {
      if (atStart && text[i] === '{' && !text.startsWith('{"timestamp"', i)) { out += `{"timestamp":${now},`; atStart = false; continue }
      out += text[i]
      atStart = text[i] === '\n'
    }
    return out
  }
}

// a feed keeps every chapter (each run adds one, nothing is wiped); this many entries stay in memory and on screen
const FEED_CAP = 3000
const TAIL = 2_000_000 // bytes of a log read back: far more than FEED_CAP entries
const loading = new Map<string, Promise<Activity[]>>()
const late = new Map<string, Activity[]>() // notes that arrive while a feed is still being read
/**
 * A feed, read off the thread the first time: the log's tail, after its queued writes, parsed in slices that let
 * other work through. Every route that shows a feed awaits this.
 */
export function loadActivity(id: string): Promise<Activity[]> {
  if (feeds.has(id)) return Promise.resolve(feeds.get(id)!)
  if (!loading.has(id)) loading.set(id, (async () => {
    await (queues.get(logFile(id)) ?? Promise.resolve())
    const text = await readLines(sharedLog(id), TAIL)
    const lines = text.split('\n'), items: Activity[] = []
    for (let i = 0; i < lines.length; i += 400) {
      for (const l of lines.slice(i, i + 400)) for (const a of parseLine(l)) items.push({ ...a, text: scrub(a.text) })
      await new Promise((r) => setImmediate(r))
    }
    const seen = new Set(items.map((a) => a.at + a.text))
    const feed = [...items, ...(late.get(id) ?? []).filter((a) => !seen.has(a.at + a.text))].slice(-FEED_CAP)
    feeds.set(id, feed); late.delete(id); loading.delete(id)
    return feed
  })())
  return loading.get(id)!
}
/** What a feed holds between two times, read without keeping it (the Skills views go through many old runs). */
export async function activityBetween(id: string, from: string, to: string): Promise<Activity[]> {
  const inside = (a: Activity) => a.at >= from && a.at <= to
  if (feeds.has(id)) return feeds.get(id)!.filter(inside)
  const text = await readLines(sharedLog(id), TAIL).catch(() => '')
  const lines = text.split('\n'), out: Activity[] = []
  for (let i = 0; i < lines.length; i += 400) {
    for (const l of lines.slice(i, i + 400)) for (const a of parseLine(l)) if (inside(a)) out.push({ ...a, text: scrub(a.text) })
    await new Promise((r) => setImmediate(r))
  }
  return out
}

/** A feed if it is in memory; otherwise empty for now, and read in the background. Never waits. */
export function activity(id: string): Activity[] {
  if (feeds.has(id)) return feeds.get(id)!
  void loadActivity(id)
  return []
}

// what each running run used, gathered as its activity arrives: the skills it loaded and your words while it worked.
// Read once when it ends, into the lifecycle log, where the Skills views count them.
const used = new Map<string, { skills: Set<string>; steers: number }>()
const skillName = (s: string) => s.trim().replace(/^\//, '').split(/\s/)[0]
/** The skill a command starts with (`/concierge-review {number}` → concierge-review), if it starts with one. */
export const commandSkill = (cmd?: string) => (cmd?.trim().startsWith('/') ? skillName(cmd) : undefined)
/** A run starting: what it uses is counted from here. */
const useFrom = (key: string) => used.delete(key)
/** A run ending: what it used (its command's own skill too), for its last lifecycle event. */
function usedBy(key: string, command?: string): { skills: string[]; steers: number } {
  const u = used.get(key); used.delete(key)
  const skills = new Set(u?.skills); const c = commandSkill(command); if (c) skills.add(c)
  return { skills: [...skills], steers: u?.steers ?? 0 }
}
const ENDS = new Set(['done', 'failed', 'cancelled', 'interrupted'])

/** Add to a feed. `keep`: also write it to the feed's log, so it survives a restart (stream lines are there already). */
export function note(id: string, raw: Activity, keep = true) {
  const a = { ...raw, text: scrub(raw.text) } // no secret reaches a log or the page
  if ((a.kind === 'tool' && a.tool === 'Skill' && a.text) || a.skill || a.kind === 'you') {
    const u = used.get(id) ?? { skills: new Set<string>(), steers: 0 }
    if (a.kind === 'tool' && a.tool === 'Skill') u.skills.add(skillName(a.text))
    if (a.skill) u.skills.add(a.skill)
    if (a.kind === 'you') u.steers++
    used.set(id, u)
  }
  if (keep) append(logFile(id), JSON.stringify({ type: 'review-deck', activity: a }) + '\n')
  const feed = feeds.get(id)
  if (feed) { feed.push(a); if (feed.length > FEED_CAP) feed.splice(0, feed.length - FEED_CAP) }
  else if (loading.has(id)) late.set(id, [...(late.get(id) ?? []), a])
  bus.emit('activity', id, a)
  // an exec run's lines also belong to each of its tickets' timelines
  if (id.startsWith('exec:')) for (const t of state.execs[id.slice(5)]?.ids ?? []) bus.emit('activity', `ticket:${t}`, a)
}

// --- one agent session per PR and per ticket: every run continues it, so context and prompt cache are reused ---
/** The session for a PR id or ticket id: recorded, else the PR's last job, else the ticket's latest run. */
/** A ticket's whole timeline: every run that worked on it, oldest first, each opening with its own chapter heading. */
export async function ticketActivity(id: string): Promise<Activity[]> {
  const runs = Object.values(state.execs).filter((r) => r.ids.includes(id) && (r.startedAt || r.state === 'queued'))
    .sort((a, b) => (a.startedAt ?? a.queuedAt).localeCompare(b.startedAt ?? b.queuedAt))
  const feeds = await Promise.all(runs.map((r) => loadActivity(`exec:${r.id}`)))
  return runs
    .flatMap((r, i) => {
      // every run opens its own chapter; runs from before chapters were kept get a heading made from the run itself
      const feed = feeds[i]
      const head: Activity = { at: r.startedAt ?? r.queuedAt, kind: 'section', text: r.label ? `${r.label} · ${r.ids.join(' → ')}` : `Ship ${r.ids.join(' → ')}` }
      return feed[0]?.kind === 'section' ? feed : [head, ...feed]
    }).slice(-FEED_CAP)
}

export function sessionOf(key: string): { id: string; total: number; provider?: ProviderId } | undefined {
  if (state.sessions[key]) return state.sessions[key]
  const job = state.prs[key]?.job
  if (job) return { id: job.sessionId, total: job.sessionCostUsd ?? job.costUsd ?? 0, provider: job.provider }
  const run = Object.values(state.execs).filter((r) => r.ids.includes(key) && r.startedAt).sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))[0]
  if (run) return { id: run.sessionId, total: (run.costBefore ?? 0) + (run.costUsd ?? 0), provider: run.provider }
}
/** After a run: these PRs/tickets now own `id` (a stack run's session goes to the tickets that had none). */
export function remember(keys: string[], id: string, total: number, provider: ProviderId = 'claude') {
  for (const k of keys) if (!state.sessions[k] || state.sessions[k].id === id) state.sessions[k] = { id, total, ...(provider !== 'claude' && { provider }) }
}
// a session belongs to the provider it was started on: another one can't continue it
const sameProvider = (s: { provider?: ProviderId } | undefined, p: ProviderId) => !!s && (s.provider ?? 'claude') === p
// a resumed session Claude no longer has (cleaned up): start that run over in a fresh one
const GONE = /No conversation found|session .* not found/i

export function enqueue(pr: Pr, kind: JobKind = 'review', prompt?: string, said?: string, after?: string) {
  if (children.has(pr.id) || pr.job?.state === 'queued') return
  const now = new Date().toISOString()
  const prev = pr.job
  // who runs it: a follow-up stays with its session's provider; fresh work goes to the one set for it (providers.ts)
  const provider = isFollowUp(kind) ? (prev?.provider ?? 'claude') : providerFor(pr.mine ? 'revise' : 'review')
  const own = sessionOf(pr.id), mine = sameProvider(own, provider) ? own : undefined
  pr.job = !isFollowUp(kind)
    // a fresh review/revise still continues the PR's one session, when it has one on this provider
    ? mine ? { kind, sessionId: mine.id, resumed: true, sessionCostBefore: mine.total, state: 'queued', headSha: pr.headSha, queuedAt: now, roundAt: now }
      : { kind, sessionId: randomUUID(), state: 'queued', headSha: pr.headSha, queuedAt: now, roundAt: now }
    // follow-ups continue the same session, so the agent keeps its findings and context; your words on a PR no run
    // has touched start one (the PR's own session, when it has one)
    : !prev ? { kind, prompt, sessionId: own?.id ?? randomUUID(), resumed: !!own, sessionCostBefore: own?.total ?? 0, state: 'queued', headSha: pr.headSha, queuedAt: now, roundAt: now }
    : {
      kind, prompt, sessionId: prev!.sessionId, reviewDone: prev!.reviewDone, roundAt: prev!.roundAt, critPort: prev!.critPort, critKey: prev!.critKey, lastWords: prev!.summary,
      state: 'queued', headSha: prev!.headSha, queuedAt: now,
      sessionCostBefore: prev!.sessionCostUsd ?? prev!.costUsd ?? 0, // what the session had cost before this run
    }
  if (provider !== 'claude') pr.job.provider = provider
  if (said) pr.job.said = said
  if (currentRole() !== 'developer') pr.job.as = currentRole()
  if (after) pr.job.after = after
  transition('job', pr.id, now, pr.job, 'queued', said ? 'you asked' : 'queued', {}, { kind })
  save()
  bus.emit('change')
  pump()
}

// runs you stopped: their close handler ends them as cancelled before anything else it might read in their exit
const cancelled = new Set<string>()
// near the end of the plan's window (usage.ts): runs are stopped and go back in the queue, to continue their session
// once it resets
const paused = new Set<string>()

// --- the orchestrator: when a better account can take work again (the one set for it, or one higher in the fallback
// order), what runs on another moves there. Claude Code accounts (Claude, and Llama through Ollama) keep a conversation
// as a file in their folder: copied across, a run continues the same conversation on the new one. Codex's can't move,
// so work on OpenAI moves only before it has started.
const moving = new Map<string, ProviderId>() // stopped to move: where to
const rank = (p: ProviderId, work: Work) => { const order = [config.providers?.use?.[work] ?? 'claude', ...(config.providers?.fallback ?? [])]; const i = order.indexOf(p); return i < 0 ? order.length : i }
const folderOf = (p: ProviderId) => accountOf(p).home ?? join(homedir(), '.claude')
/** Copy a Claude Code conversation into another account's folder (its projects/<dir>/<id>.jsonl), so it resumes there. */
async function carry(session: string, from: ProviderId, to: ProviderId): Promise<boolean> {
  if (folderOf(from) === folderOf(to)) return true
  const { readdir, copyFile, mkdir } = await import('node:fs/promises')
  const src = join(folderOf(from), 'projects')
  for (const dir of await readdir(src).catch(() => [] as string[])) {
    const file = join(src, dir, `${session}.jsonl`)
    if (!existsSync(file)) continue
    await mkdir(join(folderOf(to), 'projects', dir), { recursive: true })
    await copyFile(file, join(folderOf(to), 'projects', dir, `${session}.jsonl`))
    return true
  }
  return false
}
async function rebalance() {
  const items: { key: string; t: { provider?: ProviderId; sessionId: string; state: string; resumed?: boolean; resume?: string; replyTo?: string; continuing?: boolean; kind?: string }; work: Work; label: string }[] = [
    ...Object.values(state.prs).filter((p) => p.job && (p.job.state === 'queued' || p.job.state === 'running')).map((p) => ({ key: p.id, t: p.job!, work: (p.mine ? 'revise' : 'review') as Work, label: `#${p.number}` })),
    ...Object.values(state.execs).filter((r) => r.state === 'queued' || r.state === 'running').map((r) => ({ key: runKey(r), t: r, work: 'exec' as Work, label: r.ids.join(' → ') })),
  ]
  for (const { key, t, work, label } of items) {
    const now = t.provider ?? 'claude', lead = providerFor(work)
    if (lead === now || !available(lead) || rank(lead, work) >= rank(now, work) || moving.has(key)) continue
    const claudeCode = kindOf(now) !== 'openai' && kindOf(lead) !== 'openai'
    const started = !fresh(t) || t.state === 'running'
    if (started && !claudeCode) continue // a Codex conversation can't move: it finishes where it is
    if (started && !(await carry(t.sessionId, now, lead))) continue // its conversation isn't on disk yet: next time
    if (t.state === 'running') {
      moving.set(key, lead)
      note(key, { at: new Date().toISOString(), kind: 'event', text: `${accountOf(lead).label} can take work again: moving this run there, in the same conversation.` })
      console.log(`orchestrator: ${label} moves from ${now} to ${lead}`)
      children.get(key)?.kill('SIGTERM')
    } else {
      if (lead === 'claude') delete t.provider; else t.provider = lead
      note(key, { at: new Date().toISOString(), kind: 'event', text: `Moved to ${accountOf(lead).label}, which can take work again.` })
      save(); bus.emit('change'); bus.emit('exec')
    }
  }
}
setInterval(() => void rebalance().catch((e) => console.warn('orchestrator:', (e as Error).message)), 30_000).unref()
/**
 * A Claude account's plan windows as its agents last reported them: the first account's is `usage`, others' by id.
 * The first account runs on the shared Claude token: windows reported before that token was last set are another
 * plan's (the token was replaced), and count for nothing until its own runs report.
 */
export const usageOf = (p: ProviderId) => {
  const u = p === 'claude' ? state.usage : state.usageBy?.[p]
  if (!u) return undefined
  // reported under another sign-in (or before sign-ins were noted): another plan's windows
  const who = identityOf(p)
  if (who) return u.who === who ? u : undefined
  // not read yet (just started): the first account's still can't be from before its token was set
  const set = p === 'claude' ? sharedNow().CLAUDE_CODE_OAUTH_TOKEN?.at : undefined
  return !set || u.at >= set ? u : undefined
}
/** How full a plan window may get before its agents pause (0–1): Settings → Accounts, else 95%. */
export const stopAt = () => (config.providers?.stopAt ?? STOP_AT * 100) / 100
export const planSpent = (p: ProviderId = 'claude') => spentWindow(usageOf(p), Date.now(), stopAt())
watchClaudePlan((p) => !!planSpent(p))
watchPlanUse((p) => { const u = usageOf(p); const live = (w?: { used: number; resetsAt: number }) => (w && w.resetsAt * 1000 > Date.now() ? w.used : 0); return Math.max(live(u?.five), live(u?.seven)) })
/** An agent reported the plan's windows: keep them, and stop the agents once one is nearly used up. */
function sawLimit(info: any, p: ProviderId = 'claude') {
  if (kindOf(p) !== 'claude') return
  const was = !!planSpent(p)
  const now = { ...windowsOf(info, usageOf(p)), who: identityOf(p) }
  if (p === 'claude') state.usage = now
  else state.usageBy = { ...state.usageBy, [p]: now }
  save()
  const s = planSpent(p)
  if (!s) return
  if (!was) { console.log(`pausing agents: ${spentText(s)}`); bus.emit('health') }
  // a run whose result is in is only winding down; explanations and the map finish their step and wait in the queue
  // only runs on this account: the others have their own limits
  for (const [key, child] of children) if (!key.endsWith(':explain') && !key.startsWith('base:') && !resultIn.has(key) && !paused.has(key) && (runningOn.get(key) ?? 'claude') === p) { paused.add(key); child.kill('SIGTERM') }
}
/** Was this run ended by the plan (paused here, or refused by Claude)? Then it goes back in the queue. */
function pausedBy(key: string, e: Ended, error?: string, provider: ProviderId = 'claude') {
  if (paused.delete(key) && !e.resulted) return true
  if (!limitHit(error)) return false
  if (provider !== 'claude') return true // its limit is marked where the run said so (runAgent): it waits for that one
  // refused with no report saying so: count the session window as used up, so the queue doesn't start it again at once
  if (!planSpent('claude')) {
    const f = usageOf('claude')?.five
    state.usage = { ...usageOf('claude'), who: identityOf('claude'), five: { used: 1, resetsAt: f && f.resetsAt * 1000 > Date.now() ? f.resetsAt : Math.round(Date.now() / 1000) + 900 }, at: new Date().toISOString() }
  }
  return true
}
const pausedNote = (provider: ProviderId = 'claude') => provider !== 'claude' ? `Paused: ${accountOf(provider).label} reached its limit. It continues where it left off once it can.`
  : `Paused: ${planSpent() ? spentText(planSpent()!) : "the Claude plan's limit is reached"}. It continues where it left off after that.`
const SHUT_OUT_MS = 15 * 60_000
/** It ended because the network dropped (the API server unreachable): it continues its session in a minute. */
const netDown = (error?: string) => !!error && /agent hung|lost the connection to|Can't reach the API server|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|socket hang up/i.test(error)
const NET_NOTE = "It lost its connection to the AI (the network dropped, or a reply never came): it continues where it left off in a minute."
const soon = () => { setTimeout(() => pump(), 61_000).unref(); return new Date(Date.now() + 60_000).toISOString() }
const waited = (t: { notBefore?: string }) => !t.notBefore || t.notBefore <= new Date().toISOString()
/** It ended because its provider couldn't sign in or be paid: fresh work starts over (on the fallback, if one can). */
const shutOut = (error?: string) => !!error && (authFailed(error) || cantPay(error))
function startOver(t: { sessionId: string; provider?: ProviderId; resumed?: boolean; resume?: string; costBefore?: number; sessionCostBefore?: number }, key: string) {
  note(key, { at: new Date().toISOString(), kind: 'event', text: `${t.provider ?? 'claude'} couldn't sign in or be paid: it starts over${(config.providers?.fallback ?? []).length ? ' on the next provider that can take it' : ' once it can run again'}.` })
  t.sessionId = randomUUID(); delete t.provider; t.resumed = false; delete t.resume; t.costBefore = 0; t.sessionCostBefore = 0
}
// which provider each running agent is on (none: Claude)
const runningOn = new Map<string, ProviderId>()

export function cancel(pr: Pr) {
  if (pr.job?.state === 'queued') transition('job', pr.id, pr.job.queuedAt, pr.job, 'cancelled', 'cancelled by you', {}, { kind: pr.job.kind })
  if (children.has(pr.id)) cancelled.add(pr.id)
  children.get(pr.id)?.kill('SIGTERM') // the close handler marks it cancelled
  save()
  bus.emit('change')
}

// what an agent should know about the agent on the other side of its work (a PR's ticket, a ticket's PRs): set by
// the server, which knows both boards; appended to the agent's system prompt when it starts
let linkNote: (of: { pr?: Pr; ticketIds?: string[] }) => string = () => ''
export const setLinkNote = (f: typeof linkNote) => { linkNote = f }

// Memory runs out before the slots do: a few reviews, each with its typecheck and connectors, fill a small VM, and a
// machine that swaps freezes this server along with them. So the queue holds while too little is free (one run may
// always start), and looks again every 30s, since memory frees up without any event to say so.
const LOW_MB = 1536
let held = false
setInterval(() => pump(), 30_000).unref()

/** Why queued work isn't starting, in a few words, or nothing when it isn't waiting on anything. */
/** Why an account can't take work now, in a few words ("7-day plan window full until Fri 02:00"); none when it can. */
export function whyNot(p: ProviderId): { why: string; until?: number } | undefined {
  if (available(p)) return undefined
  const a = accountOf(p), plan = a.kind === 'claude' ? planSpent(p) : undefined
  if (plan) return { why: `${plan.which} plan window full`, until: plan.w.resetsAt * 1000 }
  if (a.kind === 'openai' && openaiAuth(p) === 'none') return { why: 'not signed in' }
  if (a.kind === 'copilot' && copilotProblem()) return { why: copilotProblem()! }
  if (a.kind === 'llama') { const pulling = llamaPulling(p); return { why: pulling.length ? `downloading ${pulling.join(' and ')}` : 'its Ollama is not running, or lacks its models' } }
  const until = limitedUntil(p)
  if (until) return { why: 'at its limit', until }
  const budget = config.providers?.budgets?.[p]
  return { why: budget ? `over its $${budget} budget for today` : 'unavailable' }
}
/** An account's plan windows as last reported: a Claude account's from its runs, an OpenAI one's from Codex's files. */
export const windowsFor = (p: ProviderId) => kindOf(p) === 'claude' ? usageOf(p) : kindOf(p) === 'openai' ? codexWindowsOf(p) : undefined

/** Who takes each kind of fresh work now: the chosen account, or the fallback standing in for it, and why. */
export function routing() {
  return (['review', 'revise', 'exec', 'small'] as Work[]).map((work) => {
    const chosen = config.providers?.use?.[work] ?? 'claude', using = providerFor(work)
    const w = whyNot(chosen)
    return { work, chosen, using, label: accountOf(using).label, chosenLabel: accountOf(chosen).label, why: w?.why, until: w?.until, stuck: !available(using) }
  })
}

export function waitReason(): string | undefined {
  const queued = Object.values(state.prs).filter((p) => p.job?.state === 'queued' || p.explain?.state === 'queued').length
    + Object.values(state.execs).filter((r) => r.state === 'queued').length + Object.values(state.base).filter((t) => t.state === 'queued').length
  if (!queued) return undefined
  if (fleet.elsewhere()) return `${fleet.elsewhere()} runs it now: nothing starts here`
  if (overBudget()) return `today's budget is spent ($${spentToday().toFixed(2)} of $${state.settings.dailyBudgetUsd})`
  if (draining()) return 'an update is waiting for the running agents to finish (at most 30 minutes): new runs start right after'
  const plan = planSpent()
  if (plan && !(['review', 'revise', 'exec'] as Work[]).some((w) => available(providerFor(w)))) return `${spentText(plan)}: ${queued} queued until then`
  if (held) return `under ${(LOW_MB / 1024).toFixed(1)} GB of memory free: ${queued} queued until more is`
  if (children.size >= state.settings.maxJobs) return `all ${state.settings.maxJobs} slots busy: ${queued} queued`
  return undefined
}

export function pump() {
  // another machine runs it now (fleet.ts), and this one stops shortly
  if (fleet.elsewhere()) return bus.emit('health')
  if (overBudget()) return bus.emit('health') // queued jobs wait for tomorrow or a higher cap
  const drain = draining() // an update waits for this machine to be quiet: nothing new starts here, other machines still take runs
  // each waits on its own provider: fresh work can go to another one (fallback); a session waits for the one it is on
  // what runs here, and what this control plane sent to each other machine (fleet: machines.ts)
  const out = new Map<string, number>()
  let here = 0
  for (const c of children.values()) { const m = (c as { machine?: string }).machine; if (m) out.set(m, (out.get(m) ?? 0) + 1); else here++ }
  const short = here > 0 && freemem() / 1048576 < LOW_MB // ponytail: a fixed floor; per-run estimates if it ever matters
  if (short !== held) { held = short; console.log(short ? `queue held: under ${LOW_MB} MB free` : 'queue resumed: memory is free again'); bus.emit('held', short) }
  if (short && !machines.size) return
  // reviews and explanations share the parallel cap, oldest first; the codebase map only takes what is left
  const waiting: { prio: number; at: string; go: () => void; exec?: ExecRun }[] = [
    ...Object.values(state.prs).flatMap((p) => [
      // a planned review waits while the one below it in its stack is still queued or running
      ...(p.job?.state === 'queued' && !['queued', 'running'].includes(state.prs[p.job.after ?? '']?.job?.state ?? '') && canRun(p.job, p.mine ? 'revise' : 'review') && waited(p.job) ? [{ prio: 0, at: p.job.queuedAt, go: () => start(p) }] : []),
      // an explanation waits while one below it in the stack is still being written: it reads theirs
      ...(p.explain?.state === 'queued' && !below(p).some((b) => b.explain?.state === 'queued' || b.explain?.state === 'running')
        && available(providerFor('review')) ? [{ prio: 0, at: p.explain.queuedAt, go: () => startExplain(p) }] : []),
    ]),
    ...Object.values(state.execs).filter((r) => r.state === 'queued' && !r.planning && canRun(r, 'exec') && waited(r)).map((r) => ({ prio: 0, at: r.queuedAt, go: () => startExec(r), exec: r })),
    ...Object.entries(state.base).filter(([, t]) => t.state === 'queued' && available(providerFor('review'))).map(([repo, t]) => ({ prio: 1, at: t.queuedAt, go: () => startBase(repo) })),
  ].sort((a, b) => a.prio - b.prio || a.at.localeCompare(b.at))
  for (const w of waiting) {
    if (!w.exec) {
      if (drain || short || here >= state.settings.maxJobs) continue
      here++; w.go(); continue
    }
    // an exec run goes where there is room: the machine it ran on before first, else the one with the most room
    const to = place(w.exec.machine, { running: here, slots: drain ? 0 : Math.min(state.settings.maxJobs, slotsHere(state.settings.maxJobs)), freeMb: short ? 0 : freemem() / 1048576 }, out, w.exec.provider ?? providerFor('exec'))
    if (to === undefined) continue
    if (!to || to === fleet.machine) { here++; startExec(w.exec) } else { out.set(to, (out.get(to) ?? 0) + 1); startExec(w.exec, to) }
  }
}

/** The tracked PRs below this one in its stack, bottom first: its explanation builds on theirs. */
export const below = (pr: Pr): Pr[] => {
  const i = pr.stack?.findIndex((s) => s.number === pr.number) ?? -1
  return i > 0 ? pr.stack!.slice(0, i).map((s) => state.prs[`${s.repo}#${s.number}`]).filter((p): p is Pr => !!p && !p.closed) : []
}
const explainedNow = (p: Pr) => p.explain?.state === 'done' && p.explain.headSha === p.headSha

export function enqueueExplain(pr: Pr, fresh = false) {
  if (!config.repos[pr.repo] || children.has(`${pr.id}:explain`) || pr.explain?.state === 'queued') return
  // a stacked PR is explained on top of the ones below: those missing or out of date go first (pump keeps the order)
  for (const b of below(pr)) if (!explainedNow(b) && b.explain?.state !== 'running') enqueueExplain(b)
  const queuedAt = new Date().toISOString()
  pr.explain = transition('explain', pr.id, queuedAt, { ...pr.explain, headSha: pr.headSha, fresh, queuedAt, error: undefined, step: 'Queued' } as ExplainTask, 'queued', 'queued')
  save()
  bus.emit('change')
  pump()
}

function startExplain(pr: Pr) {
  const key = `${pr.id}:explain`
  const task = pr.explain!
  const ctrl = new AbortController()
  children.set(key, { kill: () => (ctrl.abort(), true) })
  const ev = (to: JobState, cause: string, extra: Partial<ExplainTask> = {}) => transition('explain', pr.id, task.queuedAt, task, to, cause, extra, { costUsd: task.costUsd })
  ev('running', 'started', { startedAt: new Date().toISOString(), endedAt: undefined, costUsd: undefined })
  save()
  bus.emit('change')
  let last = 0
  const progress = (step: string) => {
    task.step = step
    if (Date.now() - last > 400) { last = Date.now(); bus.emit('change') } // throttle list pushes
  }
  explain(pr, { fresh: task.fresh, signal: ctrl.signal, progress, below: below(pr) })
    .then((o) => {
      // a cached overlay for this head costs nothing and keeps its iteration
      const ran = o.createdAt >= task.startedAt!
      task.costUsd = ran ? o.costUsd : 0
      ev('done', ran ? 'explained' : 'cached', { iteration: o.iteration, step: undefined })
      if (ran && o.costUsd) addSpend(o.costUsd, providerFor('review'))
    })
    .catch((e: Error) => ctrl.signal.aborted ? ev('cancelled', 'cancelled', { step: undefined }) : ev('failed', 'error', { error: e.message.slice(0, 400), step: undefined }))
    .finally(() => {
      children.delete(key)
      task.endedAt = new Date().toISOString()
      save()
      bus.emit('change')
      bus.emit('explained', pr.id, task)
      pump()
    })
}

export const mapping = (repo: string) => ['running', 'queued'].includes(state.base[repo]?.state ?? '')

/** Explain once the codebase map is ready: now if it is, else after the map (starting it if needed). */
export function explainAfterBase(pr: Pr, startMap: boolean) {
  pr.explainAfterBase = true
  if (startMap && !mapping(pr.repo)) enqueueBase(pr.repo)
  save(); bus.emit('change')
}

export function enqueueBase(repo: string, under?: string) {
  if (!config.repos[repo] || children.has(`base:${repo}`) || state.base[repo]?.state === 'queued') return
  const queuedAt = new Date().toISOString()
  state.base[repo] = transition('base', repo, queuedAt, { ...state.base[repo], under, queuedAt, error: undefined, step: 'Queued' } as BaseTask, 'queued', under ? `map ${under}` : 'queued')
  save(); bus.emit('health'); pump()
}

export function cancelBase(repo: string) {
  children.get(`base:${repo}`)?.kill('SIGTERM')
  const t = state.base[repo]
  if (t?.state === 'queued') transition('base', repo, t.queuedAt, t, 'cancelled', 'cancelled by you')
  save(); bus.emit('health')
}

function startBase(repo: string) {
  const key = `base:${repo}`, task = state.base[repo], ctrl = new AbortController()
  children.set(key, { kill: () => (ctrl.abort(), true) })
  const ev = (to: JobState, cause: string, extra: Partial<BaseTask> = {}) => transition('base', repo, task.queuedAt, task, to, cause, extra, { costUsd: task.costUsd })
  ev('running', 'started', { startedAt: new Date().toISOString(), endedAt: undefined, done: 0, total: undefined, costUsd: 0 })
  save(); bus.emit('health')
  let last = 0, charged = 0
  const charge = (usd: number) => { addSpend(usd - charged, providerFor('review')); charged = usd } // spend counts as batches finish
  defaultBranch(repo).then((branch) => {
    task.branch = branch
    return mapBase(repo, config.repos[repo], branch, {
      signal: ctrl.signal, overBudget: () => overBudget() || !available(providerFor('review')), under: task.under,
      progress: (step, done, total, cost) => {
        Object.assign(task, { step, done, total, costUsd: cost }); charge(cost)
        if (Date.now() - last > 400) { last = Date.now(); bus.emit('health'); bus.emit('change') }
      },
    })
  })
    .then(() => ev('done', 'mapped', { step: undefined }))
    .catch((e: Error) => ctrl.signal.aborted ? ev('cancelled', 'cancelled', { step: undefined }) : ev('failed', 'error', { error: e.message.slice(0, 300), step: undefined }))
    .finally(() => {
      children.delete(key); task.endedAt = new Date().toISOString()
      // explanations waiting on this map run now (fresh, so they use it); a failed map releases them too
      for (const p of Object.values(state.prs)) if (p.repo === repo && p.explainAfterBase && task.state !== 'cancelled') {
        p.explainAfterBase = false
        enqueueExplain(p, !!loadOverlay(p))
      }
      save(); bus.emit('health'); bus.emit('change'); pump()
    })
}

export const cancelExplain = (pr: Pr) => {
  children.get(`${pr.id}:explain`)?.kill('SIGTERM')
  if (pr.explain?.state === 'queued') transition('explain', pr.id, pr.explain.queuedAt, pr.explain, 'cancelled', 'cancelled by you')
  save(); bus.emit('change')
}

const LABEL: Record<JobKind, string> = {
  review: 'Review', revise: 'Revise', post: 'Posting review to GitHub', approve: 'Approving on GitHub', publish: 'Pushing fixes and posting replies', reply: 'Your reply',
}
// Running a PR's tests runs its code, in a container that holds your tokens: only on your own PRs (revise). A review
// of someone else's PR reads the code and its CI results instead.
const RUN_TESTS = ['Bash(uv run:*)', 'Bash(uv sync:*)', 'Bash(timeout:*)', 'Bash(pnpm test:*)', 'Bash(pnpm exec vitest:*)', 'Bash(make test-unit:*)',
  'Bash(*/.venv/bin/pytest:*)']
const CRIT_URL =/(?:crit daemon at|[Cc]rit is (?:open |up )?at) \*{0,2}https?:\/\/[\w.-]+:(\d{4,5})/

// --- one agent run, whatever it is for: spawn it, log and read its stream, end it after its result, say how it ended ---

type Ended = { code: number | null; signal: NodeJS.Signals | null; resulted: boolean; turns: number; stderr: string; cancelled: boolean; hung?: boolean }
const STALL_MS = 15 * 60_000 // no output at all for this long: said in the feed and alerted, once per silence
// silent this long mid-turn with nothing running under it: it waits on a model reply that never comes (a dropped
// connection). Stopped and continued in the same session, like a network drop (at most MAX_CONTINUES in a row)
const HANG_MS = 20 * 60_000
export const HUNG = 'The agent hung: no output for 20 minutes and nothing running under it (its connection to the AI likely dropped)'
const WAIT_MS = 40 * 60_000 // a turn that ended on background work waits this long for it (a nested /revise is capped at 25)

/**
 * The part every agent run shares. The result event is the real end of a run: a background task the agent started
 * (like a crit wait) can keep the process alive afterwards, so it gets a moment and is then ended. On a resumed session
 * Claude may first answer a stale background-task notification with an empty 0-turn result, then start a fresh turn
 * for our prompt: only a result with turns counts, and any new turn after a result cancels the pending stop.
 */
export function runAgent(o: {
  key: string; label: string; args: string[]; cwd: string
  on?: string // another machine runs it (machines.ts): its worker gets the same arguments
  provider?: ProviderId // who runs it (none: Claude)
  onSession?: (id: string) => void // the provider named its session (Codex picks its own id)
  onMessage?: (m: any, line: string) => void // each stream line, parsed, before the feed gets it
  onResult: (r: any) => void // the run's result event (cost, denials, its final words)
  onEnd: (e: Ended) => void // the process is gone, and the server isn't going down
  onError: (e: Error) => void
  untrusted?: boolean // it reads work by someone else (their PR): its secrets kept to what it needs, and its tools fenced (untrusted.ts)
}) {
  newRun(o.key) // what ended in the background before is history; what still runs stays in view
  // Claude: the prompt goes in on stdin, which stays open until the run's last result: a nudge can join it mid-run
  // (tell()). Codex takes its prompt once: words for it wait until it ends
  const provider = o.provider ?? 'claude'
  const m = o.on ? machines.get(o.on) : undefined
  const start = (args: string[], stdin: boolean) => m
    ? remoteAgent(m.name, m.base, token(), { provider, args, cwd: o.cwd, stdin, label: o.label })
    : spawnAgent(provider, o.untrusted ? [...args, ...UNTRUSTED_ARGS] : args, { cwd: o.cwd, stdin, ...(o.untrusted && { env: untrustedEnv() }) })
  let child
  if (kindOf(provider) !== 'openai') { // Claude Code, on a Claude account or on Ollama
    const at = o.args.indexOf('-p'), prompt = o.args[at + 1]
    const args = [...o.args.slice(0, at + 1), ...o.args.slice(at + 2), '--input-format', 'stream-json']
    child = start(args, true)
    child.stdin!.on('error', () => {}) // it went away first: its close says the rest
    child.stdin!.write(userLine(prompt))
  } else child = start(o.args, false)
  runningOn.set(o.key, provider)
  children.set(o.key, child)
  let buf = '', stderr = '', resulted = false, turns = 0, lastOut = Date.now(), stalled = false, hung = false
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  // what the agent left running in the background, from Claude's own stream (task id → what it is): a turn that ends
  // while one runs (a nested /revise, a test suite) is waiting for it, and Claude picks up again when it finishes
  const pending = new Map<string, { label: string; detail?: string }>(), cmds = new Map<string, string>()
  let waiting = false
  const usedHere = new Set<string>() // company skills this run loaded, counted once each
  const stamp = stamper()
  const watch = setInterval(() => {
    if (!hung && !waiting && !resulted && Date.now() - lastOut >= HANG_MS) void ('busy' in child ? (child as { busy: () => Promise<boolean> }).busy() : busyUnder(child.pid)).then((busy) => {
      if (busy || hung || Date.now() - lastOut < HANG_MS) return
      hung = true
      note(o.key, { at: new Date().toISOString(), kind: 'event', text: 'No output for 20 minutes and nothing running under it: its connection to the AI likely dropped. Restarting it in the same conversation.' })
      child.kill('SIGTERM')
    })
    if (stalled || waiting || Date.now() - lastOut < STALL_MS) return
    stalled = true
    note(o.key, { at: new Date().toISOString(), kind: 'event', text: `No output for ${STALL_MS / 60_000} minutes: the agent may be stuck (a hung command, or waiting on a background task). Stop it under Running if it doesn't move.` })
    bus.emit('stalled', o.key, o.label)
  }, 60_000)
  watch.unref()
  // how long handling a piece of agent output holds the thread (scrub, parse, log): measured to the end of the event
  child.stdout!.prependListener('data', () => { const t = performance.now(); queueMicrotask(() => slow(`agent output ${o.key}`, t)) })
  child.stdout!.on('data', (chunk: Buffer) => {
    lastOut = Date.now(); stalled = false
    buf += chunk
    const lines = buf.split('\n'); buf = lines.pop()!
    if (lines.length) append(logFile(o.key), scrub(stamp(lines.join('\n') + '\n')))
    for (const line of lines) {
      let m: any
      try { m = JSON.parse(line) } catch { continue }
      if (resulted && (m.type === 'assistant' || (m.type === 'system' && m.subtype === 'init'))) {
        clearTimeout(stopTimer); resulted = false; waiting = false; resultIn.delete(o.key) // a new turn started after that result
      }
      if (m.type === 'assistant') for (const c of m.message?.content ?? []) if (c.type === 'tool_use') cmds.set(c.id, String(c.input?.command ?? c.input?.description ?? ''))
      if (m.type === 'system' && m.subtype === 'task_started' && m.is_backgrounded) pending.set(m.task_id, { label: String(m.description ?? '').trim() || 'A background task', detail: cmds.get(m.tool_use_id) || undefined })
      if (m.type === 'system' && m.subtype === 'task_notification') pending.delete(m.task_id)
      if (m.type === 'system' && m.subtype === 'background_tasks_changed' && Array.isArray(m.tasks)) {
        const now = new Map<string, { label: string; detail?: string }>(m.tasks.map((t: any) => [t.task_id, pending.get(t.task_id) ?? { label: String(t.description ?? 'A background task') }]))
        pending.clear(); now.forEach((v, k) => pending.set(k, v))
      }
      if (m.type === 'rate_limit_event') sawLimit(m.rate_limit_info, provider)
      if (m.type === 'system' && m.subtype === 'init' && kindOf(provider) === 'openai' && m.session_id) o.onSession?.(m.session_id) // Codex names its own
      // a provider that says it hit its limit can't take work until it said it can again
      if (m.type === 'result' && m.provider && limitHit(String(m.result ?? ''))) markLimited(m.provider, limitUntil(String(m.result)))
      // can't sign in, or can't be paid (a subscription that ended): out of the rotation for a while, so fresh work goes
      // to the fallback; tried again after
      if ((m.type === 'result' || m.type === 'assistant') && (authFailed(line) || cantPay(line))) {
        if (provider === 'claude') void checkClaudeAuth() // the first account's login has a token to fall back to
        markLimited(provider, Date.now() + SHUT_OUT_MS)
      }
      watchBackground(o.key, m) // what it starts to keep running: shown with the run, stoppable
      for (const n of skillsIn(m)) if (!usedHere.has(n)) {
        usedHere.add(n); markUsed(n, o.label)
        note(o.key, { at: new Date().toISOString(), kind: 'event', text: `Loaded the company skill ${n}`, skill: n })
      }
      o.onMessage?.(m, line)
      if (m.type === 'result') {
        o.onResult(m)
        if (m.num_turns || String(m.result ?? '').trim()) {
          turns += m.num_turns ?? 1; resulted = true
          clearTimeout(stopTimer)
          // a crit session stays up for you to read: never waited on. Anything else gets its time, up to WAIT_MS
          const on = [...pending.values()].filter((d) => !/\bcrit\b/i.test(`${d.label} ${d.detail ?? ''}`))
          waiting = on.length > 0
          if (waiting) {
            note(o.key, { at: new Date().toISOString(), kind: 'event', text: `Its turn ended with ${on.length === 1 ? 'a task' : `${on.length} tasks`} still running in the background; it goes on once ${on.length === 1 ? 'it finishes' : 'they finish'}.`,
              items: on.map((d) => ({ label: d.label.slice(0, 160), ...(d.detail && { detail: d.detail.replace(/\s+/g, ' ').slice(0, 400) }) })) })
            stopTimer = setTimeout(() => {
              note(o.key, { at: new Date().toISOString(), kind: 'event', text: `Still running after ${WAIT_MS / 60_000} minutes: stopped.` })
              child.kill('SIGTERM')
            }, WAIT_MS)
          } else { child.stdin!.end(); resultIn.add(o.key); stopTimer = setTimeout(() => child.kill('SIGTERM'), 5000) }
        }
      }
      for (const a of parseLine(line)) note(o.key, a, false)
    }
  })
  child.stderr!.on('data', (c: Buffer) => { stderr = (stderr + c).slice(-2000) })
  child.on('close', (code, signal) => {
    clearInterval(watch)
    if (buf) { append(logFile(o.key), scrub(stamp(buf + '\n'))); buf = '' } // the last line, if it had no newline
    children.delete(o.key)
    runningOn.delete(o.key)
    resultIn.delete(o.key)
    if (stopping) return // the server is going down: shutdown() saved it as it stands
    o.onEnd({ code, signal, resulted, turns, stderr, cancelled: cancelled.delete(o.key), hung })
    const later = afterward.get(o.key)
    afterward.delete(o.key)
    later?.then(later.texts.join('\n\n'))
  })
  child.on('error', o.onError)
}

const userLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'
const NUDGE_NOTE = '\n\n(Sent from Concierge while you work. Nothing was stopped: keep going with this in mind.)'

// words for a run that was already wrapping up: they go to its session as soon as it ends
// ponytail: in memory, so a restart in that moment drops them; persist when that bites
const afterward = new Map<string, { texts: string[]; then: (text: string) => void }>()

/**
 * Tell a running agent something without ever stopping it: it reads your words between its steps ('now'). One already
 * wrapping up gets them the moment it ends, through `then` ('after'). 'idle' when nothing runs under that key.
 */
export function tell(key: string, text: string, then: (text: string) => void): 'now' | 'after' | 'idle' {
  const child = children.get(key)
  if (!child) return 'idle'
  const at = new Date().toISOString()
  if (child.stdin?.writable && !resultIn.has(key)) {
    child.stdin.write(userLine(text + NUDGE_NOTE))
    note(key, { at, kind: 'you', text })
  } else {
    const w = afterward.get(key)
    if (w) w.texts.push(text); else afterward.set(key, { texts: [text], then })
    note(key, { at, kind: 'event', text: "It's finishing up: your words go to it the moment it ends." })
  }
  bus.emit('change'); bus.emit('exec')
  return afterward.has(key) ? 'after' : 'now'
}

/** Fresh work: no session of its own to continue yet (a reply or a resume has one, and stays on its provider). */
const fresh = (t: { provider?: ProviderId; continuing?: boolean; resumed?: boolean; resume?: string; replyTo?: string; kind?: string }) =>
  !t.continuing && !t.resumed && !t.resume && !t.replyTo && !(t.kind && isFollowUp(t.kind as JobKind))
/** How long an account can't run for: until its plan window resets or its limit lifts; for good when signed out or over budget. */
function outFor(p: ProviderId): number {
  if (available(p)) return 0
  const plan = kindOf(p) === 'claude' ? planSpent(p) : undefined, until = limitedUntil(p)
  return plan ? plan.w.resetsAt * 1000 - Date.now() : until ? until - Date.now() : Infinity
}
const LONG_OUT = 30 * 60_000
/** Work with a session of its own moves only when that account is out for long: a short pause is worth waiting for. */
const movable = (t: Parameters<typeof fresh>[0]) => !fresh(t) && outFor(t.provider ?? 'claude') > LONG_OUT
/** May it start now: its account can run, or (fresh, or its account out for long) another one can take it. */
const canRun = (t: Parameters<typeof fresh>[0], work: Work) => available(t.provider ?? 'claude') || ((fresh(t) || movable(t)) && available(providerFor(work)))
/** What queued work waits for, when it can't start: its account, why, and until when. */
export function waitingOn(t: Parameters<typeof fresh>[0], work: Work) {
  if (canRun(t, work)) return undefined
  const p = t.provider ?? 'claude', w = whyNot(p)
  return { label: accountOf(p).label, why: w?.why ?? 'busy', until: w?.until }
}
/**
 * Work whose account can't run now goes to the next one that can (the fallback order). Fresh work just moves; work
 * with a session moves only when its account is out for long, and starts a new session there with `handoff`.
 */
function settle(t: Parameters<typeof fresh>[0], work: Work, key: string, handoff?: (prev: ProviderId) => void) {
  if (available(t.provider ?? 'claude') || (!fresh(t) && !movable(t))) return
  const prev = t.provider ?? 'claude', p = providerFor(work)
  if (p === prev) return
  note(key, { at: new Date().toISOString(), kind: 'event', text: `${accountOf(prev).label} can't run now (${whyNot(prev)?.why ?? 'its limit or budget'}): ${accountOf(p).label} takes it${fresh(t) ? '' : ', in a new session handed what the last one said'}.` })
  if (!fresh(t)) handoff?.(prev)
  if (p === 'claude') delete t.provider; else t.provider = p
}
/**
 * For a run on another account than the first: which one, and the connectors it lacks that the first has, so the agent
 * says "this account has no Sentry" instead of guessing at authorization, and works around it.
 */
function accountNote(p: ProviderId | undefined, key: string): string {
  if (!p || p === 'claude') return ''
  const missing = missingOn(p), label = accountOf(p).label
  // the connectors it lacks go apart from the sentence: the feed lists them under it, folded, instead of one long line
  note(key, { at: new Date().toISOString(), kind: 'event', text: `Runs on ${label}${missing.length ? `, without ${missing.length} connector${missing.length === 1 ? '' : 's'} the usual account has` : ''}.`, ...(missing.length && { names: missing }) })
  return `\n\nThis run is on the ${label} account, not the usual one.` + (missing.length
    ? ` It has none of these connectors the usual account has: ${missing.join(', ')}. When the task needs one, say plainly that this account doesn't have it (not that it isn't authorized), do what you can without it, and list what to check once the usual account can run it.`
    : '')
}

/** The note a new session gets when it takes over another's work: what that one last said, and to read the rest. */
const handoffNote = (prev: ProviderId, last?: string) => `(Picking up from an earlier session on ${accountOf(prev).label}, which can't continue right now.`
  + (last?.trim() ? ` Its last message was:\n\n${last.trim().slice(0, 4000)}\n\n` : ' ')
  + 'Read the current state (the PR, its threads, the ticket) before you act.)'

function start(pr: Pr) {
  const cwd = config.repos[pr.repo]
  const job = pr.job!
  settle(job, pr.mine ? 'revise' : 'review', pr.id, (prev) => {
    // a new session: a follow-up carries the last words and its own; a review or revise starts its command again
    if (isFollowUp(job.kind)) job.prompt = `${handoffNote(prev, job.lastWords)}\n\n${job.prompt ?? ''}`
    Object.assign(job, { sessionId: randomUUID(), resumed: false, continuing: false, sessionCostBefore: 0 })
  })
  const ev = (to: JobState, cause: string, extra: Partial<Job> = {}) => {
    if (to === 'running' && cause !== 'continued') useFrom(pr.id)
    const cmd = job.kind === 'review' || job.kind === 'revise' ? slot(job.kind, job.as ?? 'developer') : undefined
    return transition('job', pr.id, job.queuedAt, job, to, cause, extra, { kind: job.kind, costUsd: job.costUsd, turns, refused: job.refused?.length, ...(ENDS.has(to) && usedBy(pr.id, cmd)) })
  }
  let turns: number | undefined
  const startedAt = new Date().toISOString(), wasPaused = !!job.pausedAt
  ev('running', job.continuing ? 'continued' : 'started', { startedAt, endedAt: undefined, error: undefined, costUsd: undefined, refused: undefined, denials: [], pausedAt: undefined })
  const asked = isFollowUp(job.kind) ? job.prompt! : fill(slot(job.kind as 'review' | 'revise', job.as ?? 'developer'), { number: pr.number, repo: pr.repo })
  if (wasPaused) note(pr.id, { at: startedAt, kind: 'event', text: "The plan's window has room again: it continues where it left off." })
  else if (job.continuing) note(pr.id, { at: startedAt, kind: 'event', text: `It continues where it left off${job.continued ? ` (restart ${job.continued} of ${MAX_CONTINUES})` : ''}.` })
  else {
    note(pr.id, { at: startedAt, kind: 'section', text: LABEL[job.kind] }, false) // the line below writes it
    append(logFile(pr.id), JSON.stringify({ type: 'review-deck', section: LABEL[job.kind], timestamp: startedAt }) + '\n')
    if (job.said) note(pr.id, { at: startedAt, kind: 'you', text: job.said }) // your words, as you wrote them
  }
  save()
  bus.emit('change')
  bus.emit('started', pr.id, job)

  runAgent({
    key: pr.id, label: `${LABEL[job.kind]} #${pr.number}`, cwd, provider: job.provider,
    onSession: (id) => { if (job.sessionId !== id) { job.sessionId = id; save() } },
    args: [
      ...(job.continuing ? ['-p', continuePrompt(asked), '--resume', job.sessionId]
        : isFollowUp(job.kind) ? ['-p', asked, ...(job.resumed === false ? ['--session-id', job.sessionId] : ['--resume', job.sessionId])]
        : ['-p', asked, ...(job.resumed ? ['--resume', job.sessionId] : ['--session-id', job.sessionId])]),
      '--output-format', 'stream-json', '--verbose',
      '--allowedTools', ...config.agent.allowedTools, ...(pr.mine ? RUN_TESTS : []),
      '--append-system-prompt', config.agent[pr.mine ? 'revise' : 'review'].instructions + linkNote({ pr }) + normsNote(pr.repo) + DECIDE_NOTE + LOCAL_NOTE + devlogs + skillsNote() + accountNote(job.provider, pr.id) + (pr.mine ? '' : UNTRUSTED_NOTE), ...devlogArgs(),
    ],
    untrusted: !pr.mine,
    onMessage: (_m, line) => {
      const port = line.match(CRIT_URL)?.[1]
      if (port && job.critPort !== Number(port)) { job.critPort = Number(port); save(); bus.emit('change') }
    },
    onResult: (r) => {
      // Claude reports a resumed session's running total, so this run cost the difference; Codex reports this run's own
      const total = r.provider ? (job.sessionCostBefore ?? 0) + (r.total_cost_usd ?? 0) : r.total_cost_usd ?? 0
      job.sessionCostUsd = total
      remember([pr.id], job.sessionId, total, job.provider)
      job.costUsd = Math.max(0, total - (job.sessionCostBefore ?? 0))
      job.tokens = tokensOf(r)
      job.denials = (r.permission_denials ?? []).map((d: any) => d.tool_name)
      job.refused = refusalsOf(r)
      if (r.is_error) job.error = short(r.result ?? r.subtype, 400)
      if (String(r.result ?? '').trim()) {
        ({ summary: job.summary, next: job.next } = finalWords(String(r.result)))
        // its own word that nothing is left (an empty deck-next block), kept apart: next is trimmed later for other reasons
        job.leftNothing = job.next?.source === 'agent' && !job.next.steps.length
      }
    },
    onEnd: (e) => {
      turns = e.turns
      job.endedAt = new Date().toISOString()
      addSpend(job.costUsd ?? 0, job.provider, job.tokens)
      const told = (kind: 'error' | 'event', text: string) => note(pr.id, { at: job.endedAt!, kind, text })
      if (e.cancelled) { // you stopped it: that is the whole story, whatever its exit says
        ev('cancelled', 'cancelled by you', { continuing: false })
        save(); bus.emit('change'); bus.emit('finished', pr.id, job); pump(); return
      }
      if (moving.has(pr.id) && e.resulted) moving.delete(pr.id) // it finished first: nothing to move
      if (moving.has(pr.id)) { // stopped to move to the account that leads now: it continues there, same conversation
        const to = moving.get(pr.id)!; moving.delete(pr.id)
        if (to === 'claude') delete job.provider; else job.provider = to
        ev('queued', 'moved', { continuing: true, error: undefined, sessionCostBefore: e.resulted ? job.sessionCostUsd : job.sessionCostBefore })
        told('event', `Moved to ${accountOf(to).label}: it continues the same conversation there.`)
        save(); bus.emit('change'); pump(); return
      }
      if (e.hung && !e.resulted) job.error = HUNG
      if (netDown(job.error) && (job.continued ?? 0) < MAX_CONTINUES) {
        ev('queued', 'network', { continuing: true, continued: (job.continued ?? 0) + 1, error: undefined, notBefore: soon(), sessionCostBefore: e.resulted ? job.sessionCostUsd : job.sessionCostBefore })
        told('event', NET_NOTE)
        save(); bus.emit('change'); return
      }
      if (shutOut(job.error) && fresh({ kind: job.kind })) {
        startOver(job, pr.id)
        ev('queued', 'provider unavailable', { continuing: false, error: undefined })
        save(); bus.emit('change'); pump(); return
      }
      if (pausedBy(pr.id, e, job.error, job.provider)) {
        // what this part cost is counted now, so the next part counts from here
        ev('queued', 'plan limit', { continuing: true, pausedAt: job.endedAt, error: undefined, sessionCostBefore: e.resulted ? job.sessionCostUsd : job.sessionCostBefore })
        told('event', pausedNote(job.provider))
        save(); bus.emit('change'); pump(); return
      }
      if (!e.resulted && GONE.test(e.stderr) && (job.resumed || job.continuing || isFollowUp(job.kind))) {
        delete state.sessions[pr.id]
        // a review/revise just starts over in a new session (a restart may have stopped it before its session was
        // saved); a follow-up needs the old one, so say so
        if (!isFollowUp(job.kind)) {
          ev('queued', 'session gone', { sessionId: randomUUID(), resumed: false, continuing: false, sessionCostBefore: 0, error: undefined })
          told('event', 'Its agent session is gone (Claude cleaned it up): starting over in a new one.')
        } else {
          job.error = 'The agent session is gone (Claude cleaned it up). Re-run to start a new one.'
          ev('failed', 'session gone', { continuing: false }); told('error', job.error)
        }
        save(); bus.emit('change'); pump(); return
      }
      job.continuing = false
      if (e.signal && !e.resulted) ev('cancelled', `stopped (${e.signal})`)
      else if ((e.code === 0 || e.resulted) && !job.error && isFollowUp(job.kind) && e.turns === 0) {
        // the agent ended without doing anything: nothing was posted, so say so instead of "done"
        job.error = 'The agent session ended without acting, so nothing was posted. Try again.'
        ev('failed', 'ended without acting'); told('error', job.error)
      } else if ((e.code === 0 || e.resulted) && !job.error) {
        ev('done', 'result', isFollowUp(job.kind) ? {} : { reviewDone: true })
      } else {
        job.error ??= short(e.stderr, 400) || `claude exited with code ${e.code}`
        ev('failed', e.resulted ? 'error result' : `exit ${e.code}`); told('error', job.error)
      }
      save(); bus.emit('change'); bus.emit('finished', pr.id, job); pump()
    },
    onError: (e) => { job.error = e.message },
  })
}

export const running = () => children.size
export function stopAll() { for (const c of children.values()) c.kill('SIGTERM') }

/**
 * The server is going down (a deploy): stop every agent without waiting, and leave each run the way the next start
 * should find it. One still working stays running, so the next start continues its session (store.ts picks it up);
 * one whose result is already in was only waiting on a background task, so it is done.
 */
export function shutdown() {
  stopping = true
  const now = new Date().toISOString()
  eventsSync() // what's recorded from here on is written at once: the process won't be around to finish a queue
  for (const pr of Object.values(state.prs)) if (pr.job?.state === 'running' && resultIn.has(pr.id)) {
    transition('job', pr.id, pr.job.queuedAt, pr.job, 'done', 'result (server stopping)', { endedAt: now, continuing: false, ...(isFollowUp(pr.job.kind) ? {} : { reviewDone: true }) },
      { kind: pr.job.kind, costUsd: pr.job.costUsd, refused: pr.job.refused?.length })
    if (pr.job.costUsd) addSpend(pr.job.costUsd)
  }
  for (const r of Object.values(state.execs)) if (r.state === 'running' && resultIn.has(runKey(r))) {
    transition('exec', r.ids.join(' → '), r.id, r, 'done', 'result (server stopping)', { phase: 'done', endedAt: now, continuing: false },
      { kind: r.label ?? 'exec', costUsd: r.costUsd, refused: r.refused?.length })
    if (r.costUsd) addSpend(r.costUsd)
  }
  // stopped by a deploy, not dying on its own: the next start continues it without counting it toward the limit
  for (const pr of Object.values(state.prs)) if (pr.job?.state === 'running') pr.job.deployStop = true
  for (const r of Object.values(state.execs)) if (r.state === 'running') r.deployStop = true
  stopAll()
}

/** After shutdown(): the agents gone (their close handlers write each one's last line) and every log line on disk. */
export async function drained(ms = 5000) {
  const end = Date.now() + ms // Docker allows 10s after its SIGTERM before it kills the container
  while (children.size && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
  await Promise.race([Promise.allSettled([...queues.values(), eventsWritten()]), new Promise((r) => setTimeout(r, Math.max(0, end - Date.now())))])
}

// --- exec runs: ship Linear tickets with the configured command (e.g. /my-exec) ---------------

const runKey = (r: ExecRun) => `exec:${r.id}`
/** Where the exec command keeps a repo's ticket worktrees: <clones>/worktrees/<repo name>. */
const execWorktrees = (repo: string) => join(dirname(config.repos[repo]), 'worktrees', repo.split('/').pop()!)
/** Is any of these tickets already queued or running? */
export const ticketBusy = (id: string) => Object.values(state.execs).some((r) => (r.state === 'queued' || r.state === 'running') && r.ids.includes(id))

export function enqueueExec(ids: string[], repo: string, auto = false, action?: { label?: string; prompt?: string; resume?: string; costBefore?: number; allowedTools?: string[]; said?: string; batch?: string; role?: ExecRun['role']; brief?: string }): ExecRun | undefined {
  if (!ids.length || ids.some(ticketBusy) || !config.repos[repo] || (!config.exec.command && !action)) return undefined
  // continue the first ticket's session; an explicit resume (a reply to a run) wins
  // a reply stays with its run's provider; fresh work goes to the one set for Exec, continuing its session if it has one there
  const provider = action?.resume ? (Object.values(state.execs).find((r) => r.sessionId === action.resume)?.provider ?? 'claude') : providerFor('exec')
  const was = action?.resume ? undefined : sessionOf(ids[0]), own = sameProvider(was, provider) ? was : undefined
  const as = currentRole()
  const run: ExecRun = {
    ...(as !== 'developer' && { as }),
    id: randomUUID().slice(0, 8), ids, repo, sessionId: action?.resume ?? own?.id ?? randomUUID(), state: 'queued', auto, ...action,
    ...(provider !== 'claude' && { provider }),
    ...(action?.resume && { replyTo: action.resume }), // a reply: its session is the point, never swapped for a new one
    ...(own && { resume: own.id, costBefore: own.total }),
    queuedAt: new Date().toISOString(), phases: {}, outcomes: {}, prs: [], stack: [],
  }
  state.execs[run.id] = run
  transition('exec', ids.join(' → '), run.id, run, 'queued', action?.said ? 'you asked' : auto ? 'auto' : 'queued', {}, { kind: run.label ?? 'exec' })
  // fresh work on a ticket is planned first (its skills and setup, router.ts): it starts once the plan is in
  if (planner && !action?.resume && !action?.prompt) {
    run.planning = true
    const done = () => { if (!run.planning) return; run.planning = false; save(); bus.emit('exec'); pump() }
    setTimeout(done, 60_000).unref() // a plan that takes too long: it starts without one
    void planner(run).catch(() => {}).finally(done)
  }
  save(); bus.emit('exec'); pump()
  return run
}
/** Plans a fresh ticket run before it starts (set by the server, which has the tickets). */
let planner: ((run: ExecRun) => Promise<void>) | undefined
export const planRunsWith = (f: (run: ExecRun) => Promise<void>) => { planner = f }

// The person's dev servers' recent output, kept by bin/devlog on their machine and synced here: listed for every run,
// and readable to it, so an agent reads what their server said instead of guessing. Re-read every minute, off the thread.
const DEVLOGS = join(STATE_DIR, 'devlogs')
let devlogs = ''
async function readDevlogs() {
  const found: string[] = []
  for (const m of await readdir(DEVLOGS).catch(() => [] as string[])) {
    for (const f of await readdir(join(DEVLOGS, m)).catch(() => [] as string[])) {
      const st = await stat(join(DEVLOGS, m, f)).catch(() => undefined)
      if (st?.isFile()) found.push(`- ${join(DEVLOGS, m, f)}: ${f.replace(/\.log$/, '')} on ${m}, last written ${Math.max(0, Math.round((Date.now() - st.mtimeMs) / 60_000))} min ago`)
    }
  }
  devlogs = found.length ? `\n\nTheir local servers' recent output, newest at the end (timestamped), kept on their machine by devlog. When it matters what a server of theirs did, read it first:\n${found.join('\n')}` : ''
}
void readDevlogs(); setInterval(() => void readDevlogs(), 60_000).unref()
const devlogArgs = () => (devlogs ? ['--add-dir', DEVLOGS] : [])

export function cancelExec(id: string) {
  const run = state.execs[id]
  if (!run) return
  if (run.state === 'queued') transition('exec', run.ids.join(' → '), run.id, run, 'cancelled', 'cancelled by you', {}, { kind: run.label ?? 'exec' })
  if (children.has(runKey(run))) cancelled.add(runKey(run))
  children.get(runKey(run))?.kill('SIGTERM')
  save(); bus.emit('exec')
}

// work for another ticket gets that ticket's own run, so its progress shows there and not on this one
const handoverNote = (ids: string[]) => `

This run is for ${ids.join(', ')}. When you are asked (or about to) build, fix or ship work that belongs to another
ticket, one with its own id (a follow-up you filed, one the person names, "stack it now"), don't do that work here.
Finish what belongs to ${ids.join(', ')}, then end your final message with one line per such ticket:
HANDOVER <ID>: <what to do there, with everything a fresh agent needs: the decisions made, the branch or PR to build on, the order>
and stop. Concierge assigns that ticket to the person and starts its own run with your brief. Only for work wanted now:
what they said to do later stays a note on the ticket.`

function startExec(run: ExecRun, on?: string) {
  const key = runKey(run)
  settle(run, 'exec', key, (prev) => {
    const before = Object.values(state.execs).find((r) => r.id !== run.id && r.sessionId === (run.replyTo ?? run.resume))
    if (run.prompt) run.prompt = `${handoffNote(prev, before?.summary)}\n\n${run.prompt}`
    Object.assign(run, { sessionId: randomUUID(), continuing: false, costBefore: 0 })
    delete run.resume; delete run.replyTo
  })
  const now = new Date().toISOString(), wasPaused = !!run.pausedAt
  let turns: number | undefined
  const ev = (to: JobState, cause: string, extra: Partial<ExecRun> = {}) => {
    if (to === 'running' && cause !== 'continued') useFrom(key)
    return transition('exec', run.ids.join(' → '), run.id, run, to, cause, extra, { kind: run.label ?? 'exec', costUsd: run.costUsd, turns, refused: run.refused?.length, ...(ENDS.has(to) && usedBy(key, config.exec.command)) })
  }
  // a continued run keeps its start, so its chapter stays where it was in the ticket's timeline
  ev('running', run.continuing ? 'continued' : 'started', { startedAt: run.continuing && run.startedAt ? run.startedAt : now, endedAt: undefined, error: undefined, denials: [], refused: undefined, pausedAt: undefined })
  if (wasPaused) note(key, { at: now, kind: 'event', text: "The plan's window has room again: it continues where it left off." })
  else if (run.continuing) note(key, { at: now, kind: 'event', text: `It continues where it left off${run.continued ? ` (restart ${run.continued} of ${MAX_CONTINUES})` : ''}.` })
  else if (!run.opened) {
    note(key, { at: run.startedAt!, kind: 'section', text: run.label ? `${run.label} · ${run.ids.join(' → ')}` : `Ship ${run.ids.join(' → ')}` })
    if (run.said) note(key, { at: run.startedAt!, kind: 'you', text: run.said })
  } else note(key, { at: run.startedAt!, kind: 'event', text: 'The database is connected; starting.' })
  bus.emit('exec-started', run)
  save(); bus.emit('exec')

  // a fresh run's direction (your note when you picked the tickets) rides along with the command
  const asked = run.prompt ?? execCommand(slot('exec', run.as ?? 'developer'), run.ids) + (run.said ? `\n\nMy direction for these tickets, follow it: ${run.said}` : '') + (run.brief ?? '')
  let last = 0
  const changed = () => { if (Date.now() - last > 400) { last = Date.now(); bus.emit('exec') } }
  const read = (text: string) => {
    Object.assign(run.outcomes, outcomesIn(text))
    for (const p of prLinksIn(text)) if (!run.prs.some((x) => x.url === p.url)) run.prs.push(p)
    for (const l of stackLinesIn(text)) if (!run.stack.includes(l)) run.stack.push(l)
    for (const h of handoversIn(text, run.ids)) run.handovers = [...(run.handovers ?? []).filter((x) => x.id !== h.id), h]
  }
  run.machine = on ?? fleet.machine
  if (on) note(key, { at: new Date().toISOString(), kind: 'event', text: `Runs on ${on}.` })
  runAgent({
    key, label: `${run.label ?? 'Ship'} ${run.ids.join(' → ')}`, cwd: config.repos[run.repo], on,
    provider: run.provider, onSession: (id) => { if (run.sessionId !== id) { run.sessionId = id; save() } },
    args: [
      ...(run.continuing ? ['-p', continuePrompt(asked), '--resume', run.sessionId]
        : ['-p', asked, ...(run.resume ? ['--resume', run.resume] : ['--session-id', run.sessionId])]),
      '--output-format', 'stream-json', '--verbose', '--allowedTools', ...(run.allowedTools ?? config.exec.allowedTools),
      // the exec command keeps its worktrees next to the repo (<clones>/worktrees/<repo>/<ticket>): outside the working
      // directory, so without this every read in the agent's own worktree is refused
      ...(existsSync(execWorktrees(run.repo)) ? ['--add-dir', execWorktrees(run.repo)] : []),
      '--append-system-prompt', linkNote({ ticketIds: run.ids }) + handoverNote(run.ids) + (run.ids.length > 1 && !run.role ? MULTI_NOTE : '') + DECIDE_NOTE + LOCAL_NOTE + devlogs + skillsNote() + accountNote(run.provider, key) + planNote(run.plan), ...devlogArgs(),
    ],
    onMessage: (m) => {
      if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
        if (c.type === 'text') read(c.text)
        if (c.type === 'tool_use') {
          const input = JSON.stringify(c.input ?? {})
          const ph = phaseOf(c.name, input)
          if (ph) {
            run.phase = furthest(run.phase as Phase, ph)
            for (const id of run.ids) if (input.includes(id) || input.toLowerCase().includes(id.toLowerCase())) run.phases[id] = furthest(run.phases[id] as Phase, ph)!
          }
        }
      }
      if (m.type === 'user') for (const c of m.message?.content ?? []) if (c.type === 'tool_result') read(typeof c.content === 'string' ? c.content : JSON.stringify(c.content))
      changed()
    },
    onResult: (m) => {
      // Claude reports a resumed session's running total; Codex this run's own
      const total = m.provider ? (run.costBefore ?? 0) + (m.total_cost_usd ?? 0) : m.total_cost_usd ?? 0
      run.costUsd = Math.max(0, total - (run.costBefore ?? 0))
      run.tokens = tokensOf(m)
      remember(run.ids, run.sessionId, total, run.provider)
      run.denials = (m.permission_denials ?? []).map((d: any) => d.tool_name)
      run.refused = refusalsOf(m)
      if (m.is_error) run.error = short(m.result ?? m.subtype, 400)
      const text = String(m.result ?? '').trim()
      if (text) { ({ summary: run.summary, next: run.next } = finalWords(text)); read(text) }
    },
    onEnd: (e) => {
      turns = e.turns
      run.endedAt = new Date().toISOString()
      addSpend(run.costUsd ?? 0, run.provider, run.tokens)
      const told = (kind: 'error' | 'event', text: string) => note(key, { at: run.endedAt!, kind, text })
      const finished = () => { save(); bus.emit('exec'); bus.emit('exec-finished', run); pump() }
      if (e.cancelled) { ev('cancelled', 'cancelled by you', { continuing: false }); return finished() } // that's the whole story
      if (moving.has(key) && e.resulted) moving.delete(key) // it finished first: nothing to move
      if (moving.has(key)) {
        const to = moving.get(key)!; moving.delete(key)
        if (to === 'claude') delete run.provider; else run.provider = to
        ev('queued', 'moved', { continuing: true, error: undefined, costBefore: e.resulted ? (run.costBefore ?? 0) + (run.costUsd ?? 0) : run.costBefore })
        told('event', `Moved to ${accountOf(to).label}: it continues the same conversation there.`)
        return finished()
      }
      if (e.hung && !e.resulted) run.error = HUNG
      if (netDown(run.error) && (run.continued ?? 0) < MAX_CONTINUES) {
        ev('queued', 'network', { continuing: true, continued: (run.continued ?? 0) + 1, error: undefined, notBefore: soon(), costBefore: e.resulted ? (run.costBefore ?? 0) + (run.costUsd ?? 0) : run.costBefore })
        told('event', NET_NOTE)
        return finished()
      }
      if (shutOut(run.error) && !run.replyTo) {
        startOver(run, key)
        ev('queued', 'provider unavailable', { continuing: false, error: undefined })
        return finished()
      }
      if (pausedBy(key, e, run.error, run.provider)) {
        ev('queued', 'plan limit', { continuing: true, pausedAt: run.endedAt, error: undefined, costBefore: e.resulted ? (run.costBefore ?? 0) + (run.costUsd ?? 0) : run.costBefore })
        told('event', pausedNote(run.provider))
        save(); bus.emit('exec'); pump(); return
      }
      if (!e.resulted && (run.resume || run.continuing) && GONE.test(e.stderr)) {
        for (const id of run.ids) if (state.sessions[id]?.id === (run.resume ?? run.sessionId)) delete state.sessions[id]
        if (run.replyTo) {
          // your reply was to that conversation: in a new session it would land with no context, so say so instead
          run.error = 'The run you replied to has no agent session any more (Claude cleaned it up). Run it again to start a new one.'
          ev('failed', 'session gone', { continuing: false }); told('error', run.error)
          return finished()
        }
        // it only continued the ticket's earlier session (or a restart stopped it before its session was saved): start over
        ev('queued', 'session gone', { resume: undefined, continuing: false, costBefore: 0, sessionId: randomUUID(), error: undefined })
        told('event', 'Its agent session is gone (Claude cleaned it up): starting over in a new one.')
        save(); bus.emit('exec'); pump(); return
      }
      run.continuing = false
      if (e.signal && !e.resulted) ev('cancelled', `stopped (${e.signal})`)
      else if ((e.code === 0 || e.resulted) && !run.error && e.turns > 0) ev('done', 'result', { phase: 'done' })
      else {
        run.error ??= short(e.stderr, 400) || `exited with code ${e.code}`
        ev('failed', e.resulted ? 'error result' : `exit ${e.code}`); told('error', run.error) // a failed exec run says so in its feed too
      }
      finished()
    },
    onError: (e) => { run.error = e.message },
  })
}
