import type { Env } from './envOf.ts'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { appendFile, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { config } from './config.ts'
import { transition, type RunState } from './lifecycle.ts'
import { fleet } from './fleet.ts'
import { mine } from './perMachine.ts'
import { drop, emptyMeta, entriesOf, merge, put, valueOf, type Meta } from './merge.ts'
import { StateDb } from './db.ts'
export { config }

export { STATE_DIR } from './paths.ts'
import { STATE_DIR } from './paths.ts'
export const LOG_DIR = join(STATE_DIR, 'logs')
mkdirSync(LOG_DIR, { recursive: true })
const LEGACY_FILE = join(STATE_DIR, 'state.json')
// one machine: state.json, as always. Several (fleet.ts names this one): each writes only its own state.<name>.json
// and reads them all (merge.ts), so the sync never has two writers on one file
const SNAPSHOT = /^state\.([\w-]+)\.json$/ // not a conflict copy (state.sync-conflict-….json has dots in its name)
export const STATE_FILE = fleet.machine ? join(STATE_DIR, `state.${fleet.machine}.json`) : LEGACY_FILE

// review (someone else's PR) and revise (yours) start a fresh agent session; the rest resume it with one instruction
export type JobKind = 'review' | 'revise' | 'post' | 'approve' | 'publish' | 'reply'
export const isFollowUp = (k: JobKind) => k === 'post' || k === 'approve' || k === 'publish' || k === 'reply'
export type JobState = RunState // what may follow what: lifecycle.ts

export type Job = {
  kind: JobKind
  as?: import('./roles.ts').Role // the role it was started in: its command is that role's (roles.ts)
  prompt?: string // follow-up instruction for post/approve, sent with --resume
  sessionId: string
  provider?: import('./providers.ts').ProviderId // who runs its session (none: Claude); a resume stays with it
  tokens?: { input: number; output: number } // what its last run read and wrote
  reviewDone?: boolean // the review/revise run finished for headSha; survives follow-up jobs
  roundAt?: string // when this review/revise round started; follow-ups (fix, push, reply) keep it
  leftNothing?: boolean // it ended with an empty deck-next block: by its own word, nothing left to do or answer
  sessionCostUsd?: number // the agent session's running total after this run
  summary?: string // the run's final message
  next?: import('./next.ts').NextSteps // what that message waits on, read once
  sessionCostBefore?: number // for resumed runs: the session's total before it
  said?: string // what you asked for, in your words, shown in Activity
  shown?: boolean // its heading and your words are in the feed already: written the moment you sent them, not when it started
  heldWords?: string[] // your words sent while it waited in the queue: told to it the moment it starts
  resumed?: boolean // a review/revise run that continues the PR's existing session
  critPort?: number // read from the agent's output ("crit is at http://localhost:<port>")
  critKey?: string
  critCwd?: string // the folder the crit daemon ran in, so it can be restarted after it stops
  machine?: string // where it last ran (several machines: the repository's route, machines.ts): a follow-up goes back there
  continuing?: boolean // a restart stopped it mid-run: the next start continues its session instead of sending the command again
  continued?: number // restarts in a row it was picked up after
  deployStop?: boolean // the server stopped it on purpose (a deploy): its pick-up doesn't count toward MAX_CONTINUES
  notBefore?: string // waits until then before it starts again (a network blip)
  lastWords?: string // a follow-up: what the session it continues last said (handed to a new one if it must move)
  lastSteps?: string[] // a reply: the steps the last run left, handed to a fresh conversation (replyRoute.ts)
  lastEndedAt?: string // a reply: when the run it follows ended (its conversation's cache is warm for a few minutes)
  route?: import('./replyRoute.ts').Route // a reply: how it was sent (answered, mid-size model, large model)
  capped?: boolean // it stopped at its spending cap
  escalated?: boolean // an edit that continued on the large model
  gathering?: boolean // a new reply waiting a moment for more of your messages
  pausedAt?: string // stopped near the end of the plan's window: it continues its session once the window resets
  after?: string // a planned review: it starts once this PR's (the one below it in its stack) has finished
  alerted?: boolean // stopped by restart after restart, and you were told
  unfollowed?: boolean // marked done while the server was stopping: what follows a finish is still owed (runner.ts followUnfollowed)
  state: JobState
  headSha: string
  queuedAt: string
  startedAt?: string
  endedAt?: string
  error?: string
  costUsd?: number
  denials?: string[]
  refused?: string[] // what was refused, "Bash: git diff …": the denials with what they tried
}

/** A capture of a PR's screens, before and after (visuals.ts): one at a time per PR, beside its review and explanation. */
export type VisualsTask = {
  state: JobState
  headSha: string // the commit it captures
  queuedAt: string
  startedAt?: string
  endedAt?: string
  said?: string // what you asked for, when you asked (the conversation): the agent's session goes on with it
  auto?: boolean // started by itself (a new commit on a PR that changes what people see)
  sessionId?: string // the agent's own session, continued by what you say next
  provider?: string
  machine?: string // where it ran: its worktrees and session are there
  costUsd?: number
  error?: string
  summary?: string // its final words: what changed visually
}

export type ExplainTask = {
  state: JobState
  headSha: string
  fresh?: boolean
  queuedAt: string
  startedAt?: string
  endedAt?: string
  step?: string // live progress line
  costUsd?: number
  error?: string
  iteration?: number
}

export type BaseTask = {
  state: JobState
  branch?: string
  under?: string // a "map deeper" run for this folder
  queuedAt: string
  startedAt?: string
  endedAt?: string
  step?: string
  done?: number // folders mapped in this run
  total?: number // folders this run has to map
  costUsd?: number
  error?: string
}

/** One PR in a stack, which may or may not be one we track. */
export type StackRef = { repo: string; number: number; title: string; url: string; head: string; base: string; author: string; draft: boolean }

/** One exec run: one or more tickets, worked (and stacked) in order by the exec command. */
export type ExecRun = {
  id: string
  as?: import('./roles.ts').Role // the role it was started in (roles.ts)
  ids: string[]
  plan?: import('./router.ts').Plan // the skills, environment and steps picked for it before it started (router.ts)
  planning?: boolean // being planned: it starts once the plan is in
  opened?: boolean // its chapter heading is already in its activity (written while it waited)
  label?: string // an action run ("Create the ADR"); absent for a plain exec run
  prompt?: string // the action's filled prompt; absent means the configured exec command
  allowedTools?: string[] // the action's own tools, when it has them
  said?: string // what you asked for, in your words, shown in Activity
  shown?: boolean // its heading and your words are in the feed already: written the moment you sent them, not when it started
  heldWords?: string[] // your words sent while it waited in the queue: told to it the moment it starts
  batch?: string // the batch it works for (state.batches): picked together, built in parallel, submitted per stack
  role?: 'prep' | 'submit' | 'stack' // a batch's shared prep, the run that stacks and submits a ready stack, or one that drives a whole stack of PRs (drive-stack); absent: a ticket's own work
  brief?: string // added to the exec command: the batch's prep brief and, in a stack, how to end at the submit gate
  repo: string
  machine?: string // where it last ran (machines.ts): a follow-up goes back there, to its worktree and session
  sessionId: string
  provider?: import('./providers.ts').ProviderId // who runs its session (none: Claude); a resume stays with it
  tokens?: { input: number; output: number } // what its last run read and wrote
  state: JobState
  auto?: boolean
  queuedAt: string
  startedAt?: string
  endedAt?: string
  costUsd?: number
  error?: string
  denials?: string[]
  refused?: string[] // what was refused, "Bash: git diff …": the denials with what they tried
  phase?: string // furthest phase reached by the run
  phases: Record<string, string> // per ticket, when a tool call names it
  outcomes: Record<string, import('./exec.ts').Outcome>
  handovers?: import('./exec.ts').Handover[] // work it handed to other tickets (HANDOVER lines), each started as that ticket's own run
  prs: { repo: string; number: number; url: string }[]
  stack: string[]
  summary?: string // the run's final message
  resume?: string // a reply: resume this session instead of starting one
  replyTo?: string // set when that resume is your reply to a run: losing its session fails the run, never starts it over
  costBefore?: number // the resumed session's total before this run
  continuing?: boolean // a restart stopped it mid-run: the next start continues its session instead of sending the command again
  continued?: number // restarts in a row it was picked up after
  deployStop?: boolean // the server stopped it on purpose (a deploy): its pick-up doesn't count toward MAX_CONTINUES
  notBefore?: string // waits until then before it starts again (a network blip)
  lastWords?: string // a follow-up: what the session it continues last said (handed to a new one if it must move)
  pausedAt?: string // stopped near the end of the plan's window: it continues its session once the window resets
  after?: string // a planned review: it starts once this PR's (the one below it in its stack) has finished
  alerted?: boolean // stopped by restart after restart, and you were told
  unfollowed?: boolean // marked done while the server was stopping: what follows a finish is still owed (runner.ts followUnfollowed)
  next?: import('./next.ts').NextSteps
}

export type Pr = {
  id: string // "owner/repo#123"
  repo: string
  number: number
  title: string
  body: string
  bodyHtml: string
  url: string
  author: { login: string; avatar: string }
  draft: boolean
  base: string
  head: string
  headSha: string
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  updatedAt: string
  firstSeenAt: string
  requested: boolean // currently in review-requested:@me
  mine?: boolean // authored by you: the revise side
  visuals?: VisualsTask // its latest capture (Design)
  ui?: import('./visuals.ts').UiCheck // whether it changes what people see, for its head (visuals.ts uiChange)
  visualsOverride?: import('./visuals.ts').VisualsOverride // your choice for this PR, over its repository's
  unresolved?: number // unresolved review threads (mine only)
  awaiting?: number // of those, the ones whose last comment is not yours: waiting on you
  feedbackAt?: string // when threads last started (or grew) waiting on you: a round older than this hasn't seen them
  readAt?: string // you said nothing of what waited needs an answer (Nothing to answer): only what comes after counts
  seenReviews?: string[] // review ids already reported, so each new review shows once in Activity
  heardAt?: string // the newest comment by someone else already reported in Activity (newer ones show, once each)
  waitingIds?: string[] // the comments waiting on you now, by id (judge.ts)
  settledIds?: string[] // the waiting comments a run saw and found nothing to do about: Fix isn't offered again for them alone
  reviewers?: string[] // who opened the open threads (or asked for changes): who to ask for a re-review
  verdicts?: { who: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'REQUESTED' }[] // yours: each reviewer's latest word, or a request still open
  reviewDecision?: string | null // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED (mine only)
  closed: boolean
  handoffs?: { to: number; text: string; at: string }[] // steps of this PR's agent you sent to another PR (its agent, or its author): never suggested here again
  closedAt?: string // merged or closed: the list keeps it under Done for a few days (DONE_DAYS)
  merged?: boolean
  dismissed: boolean
  myReview?: { state: string; commitId: string; submittedAt: string }
  explain?: ExplainTask
  explainFollow?: boolean // true: the explanation follows new commits (default: it runs only when you ask)
  explainAfterBase?: boolean // explain once the repo's codebase map finishes
  behindBase?: boolean // stacked on another PR whose branch moved past this one (it was pushed or rebased): needs a smart rebase
  stack?: StackRef[] // its line through the open PRs it is stacked with, bottom (on the default branch) to top: what is below it, itself, and up along the oldest PR built on each; absent when alone. PRs built on the same one have different lines with the same bottom
  lastSaid?: { summary: string; at: string; kind: string } // the last thing an agent said when a run on it ended: outlives the job slot, which the next run takes
  below?: number // the PR it is built on: the one relation everything about stacks follows from (a tree, since several can sit on one)
  ghStack?: { number: number; position: number; size: number } | null // the stack GitHub lists it in (yours only): null when none, absent until read
  unlinked?: boolean // built on another PR, but GitHub doesn't list it in that stack, and linking it is not clear-cut
  job?: Job
}

/** A written standup: the model's wording of the facts, and a fingerprint of the facts it was written from. */
export type Written = { day: string; teams: string[]; since: string; key: string; text: string; at: string; costUsd: number; tickets: number }
export type Verdict = 'comment' | 'approve' | 'approve-quiet' // post as comments; approve with the findings; approve without them
export type Settings = {
  maxJobs: number; dailyBudgetUsd: number | null; timezone?: string // timezone: your browser's, for the standup's 07:00
  workMachine?: string // the machine you work on (several machines): it takes at most workSlots agents, so it stays quick
  workSlots?: number // 0: it takes none
}
type State = {
  prs: Record<string, Pr>
  seeded: boolean
  autoStart: boolean
  settings: Settings
  spend: Record<string, number> // YYYY-MM-DD → USD spent by agent runs that day
  base: Record<string, BaseTask> // "owner/repo" → the codebase-map job
  visualsSetup?: Record<string, VisualsTask & { prUrl?: string; board?: boolean }> // board: this run adds only the blueprint to a baseline that has its stories // "owner/repo" → its Storybook set up and first shot (Design)
  execs: Record<string, ExecRun>
  batches: Record<string, import('./exec.ts').Batch>
  stackDirections?: Record<string, import('./stackDirection.ts').Direction> // the direction each stack follows (stackDirection.ts)
  envs: Record<string, Env & { at: string }> // ticket id → the environment it is about, once read from Sentry
  works?: Record<string, import('./work.ts').WorkMemory> // each Work's shared memory (work.ts)
  worksSeeded?: boolean // the Works were filled once from what each part held before they existed
  workOf?: Record<string, string> // member (pr:… / ticket:…) → its Work's id
  sessions: Record<string, { id: string; total: number; provider?: import('./providers.ts').ProviderId }> // PR id or ticket id → its one agent session, and that session's cost so far
  autoClean: boolean // remove a PR's worktrees when it merges or closes, and sweep every night
  lastClean?: { at: string; removed: number; mb: number; why: string } // what the last automatic cleanup did
  lastSweepAt?: string // when the nightly sweep last ran (it catches up after the PC was off)
  ops?: Record<string, import('./actions.ts').Op> // the latest tool run per PR (Smart rebase, re-run checks…)
  background?: Record<string, import('./background.ts').BgTask[]> // what agents started in the background, per run key
  claudeLogin?: boolean // agents run on your full claude.ai login (its connectors come with it), not the model-only token
  claudeLoginLapsed?: string // when that login last stopped working (agents fell back to the token)
  onboardingStep?: string // the onboarding step you were on last (its id): a reload, another browser or a rebuild opens it there
  usageBy?: Record<string, import('./usage.ts').Usage> // the plan windows of Claude accounts beyond the first (that one's: usage)
  skillModes?: Record<string, import('./orgSkills.ts').Mode> // per org skill: offered by fit, loaded on every run, or never
  skillUse?: Record<string, { count: number; lastAt: string; lastFor: string }>
  me?: { login: string; name: string | null; avatar: string } // you on GitHub, as last read: when GitHub refuses, still known
  roles?: import('./roles.ts').Roles // the roles you joined and each one's setup (roles.ts)
  plans?: Record<string, import('./plans.ts').Plan> // project plans drawn with an agent (plans.ts)
  discussions?: Record<string, import('./discussions.ts').Discussion> // "<target>|<topic>": the Intent and Understanding talks beside a PR or ticket
  // what each provider cost and used, per day: dollars where known, and tokens
  spendBy?: Record<string, Record<string, { usd: number; input: number; output: number; runs: number }>> // how often runs loaded each org skill
  upstreamTold?: { at: string; behind: number } // a fork: when it was last told the original repo moved on (index.ts)
  alerts?: Record<string, import('./alerts.ts').Alert> // in-app alerts, one per PR or ticket (alerts.ts)
  connected?: string[] // connector fixes applied (e.g. Linear by API key), re-applied when the container is rebuilt
  usage?: import('./usage.ts').Usage // the Claude plan's windows, as the agents last reported them
  skillAdvice?: { improve: Record<string, import('./skills.ts').Improvement>; suggest?: { suggestions: unknown[]; costUsd: number; from: number; at: string; days: number } } // the last proposals, kept until asked again
  briefs?: Record<string, { key: string; text: string; at: string }> // the Desk's written brief per topic, with the facts it was written from
  judged?: Record<string, boolean> // per comment id: does it ask anything of the PR's author (judge.ts), judged once
  notWaiting?: string[] // comment ids you marked as needing no answer
  standupNotes?: Record<string, import('./standup.ts').Notes> // your own lines for a day's standup, by day
  standups?: Record<string, Written> // written standups, by "<day>|<teams>": what the model made of the facts, and from which
  // tickets that left your Linear list (handed over, closed) but are still named here (a run, a standup, a PR title):
  // kept so their name and page still work, re-read now and then, dropped once nothing names them
  ticketRefs?: Record<string, import('./linear.ts').Ticket & { readAt: string }>
  turns?: Record<string, import('./turns.ts').Turns> // how each PR changed direction, push by push
  customConnectors?: Record<string, string> // connectors you added by address (name → URL), re-added when the container is rebuilt
  mutedConnectors?: string[] // connectors you don't use: folded away in Settings → Connections
  dimmed?: Record<string, string> // tickets dimmed for now → their bucket then: they light up again once it changes
  handed?: Record<string, import('./handover.ts').TicketHandover> // tickets handed over to their PRs: the PRs' agents own their next steps (handover.ts)
  // GitHub webhooks (hooks.ts, hookSetup.ts): the public address the funnel opened, the hooks Concierge made (removed by
  // Turn off), and why a repository has none (no admin, the token's scope)
  hooks?: { url?: string; repos: Record<string, { id: number; at: string }>; problems?: Record<string, { problem: 'no-admin' | 'scope' | 'error'; text: string; at: string }> }
  pinned?: Record<string, string> // bookmarked PRs and tickets ("pr:<id>", "ticket:<id>") → their state when last seen (pins.ts)
}

// The state lives in a SQLite database, one row per entry (db.ts): a save writes the entries that changed, and another
// machine follows this one by its change log (replica.ts). Each machine has its own file (state.<machine>.db), which
// never travels as a file. The JSON snapshots from before are read once, to fill a new database.
const meta: Meta = emptyMeta()
export const DB_FILE = mine(join(STATE_DIR, 'state.db'))
export const db = new StateDb(DB_FILE)
const readSnapshot = (file: string): { s: Record<string, unknown>; meta: Meta; mtime: string } => {
  const s = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { _meta?: Meta }
  const m = s._meta ?? emptyMeta(); delete s._meta
  return { s, meta: m, mtime: statSync(file).mtime.toISOString() }
}
function loadState(): State | null {
  if (!db.empty) { const into: Record<string, unknown> = {}; for (const [k, j] of db.all()) put(into, k, JSON.parse(j)); return into as unknown as State }
  if (!fleet.machine) return existsSync(LEGACY_FILE) ? JSON.parse(readFileSync(LEGACY_FILE, 'utf8')) : null
  const files = readdirSync(STATE_DIR).filter((f) => SNAPSHOT.test(f)).map((f) => join(STATE_DIR, f))
  if (!files.length && existsSync(LEGACY_FILE)) files.push(LEGACY_FILE) // the first start since snapshots per machine
  if (!files.length) return null
  const into: Record<string, unknown> = {}
  for (const f of files) {
    try { const x = readSnapshot(f); merge(into, meta, x.s, x.meta, x.mtime) } catch (e) { console.error(`state: can't read ${f}: ${(e as Error).message}`) }
  }
  return into as unknown as State
}
const loaded = loadState()
export const state: State = {
  prs: {}, seeded: false, autoStart: config.autoStart, spend: {}, base: {}, execs: {}, batches: {}, envs: {}, sessions: {}, autoClean: true,
  ...loaded,
  settings: { maxJobs: config.maxJobs, dailyBudgetUsd: 20, ...loaded?.settings }, // a fresh install starts capped at $20 a day
}
for (const pr of Object.values(state.prs)) {
  if (!pr.job) continue
  pr.job.kind ??= 'review'
  if (!isFollowUp(pr.job.kind) && pr.job.state === 'done') pr.job.reviewDone ??= true
}

/**
 * What a state.json that only ever grew no longer needs: a closed PR's body after 3 days (the rest of it stays for its
 * history), the closed PR itself after 60, an exec run 90 days after it ended, spend older than a year. Their activity
 * logs and the event log keep the story. Runs still queued or going are never touched. Returns how many went.
 */
export function prune(now = Date.now()) {
  const DAY = 86400_000, busy = (s?: string) => s === 'queued' || s === 'running'
  let gone = 0
  for (const [id, p] of Object.entries(state.prs)) {
    if (!p.closed || busy(p.job?.state) || busy(p.explain?.state)) continue
    const age = now - Date.parse(p.updatedAt || p.firstSeenAt || '')
    if (!(age >= 0)) continue
    if (age > 60 * DAY) { delete state.prs[id]; delete state.sessions[id]; gone++ }
    else if (age > 3 * DAY && (p.body || p.bodyHtml)) { p.body = ''; p.bodyHtml = '' }
  }
  for (const [id, r] of Object.entries(state.execs)) {
    // one cancelled in the queue, or stopped by restarts, has no end: its last known time stands in
    const last = r.endedAt ?? r.startedAt ?? (r.state === 'cancelled' ? r.queuedAt : undefined) // (one that never started and wasn't cancelled goes back in the queue below)
    if (!busy(r.state) && last && now - Date.parse(last) > 90 * DAY) { delete state.execs[id]; gone++ }
  }
  const year = new Date(now - 366 * DAY).toLocaleDateString('en-CA')
  for (const day of Object.keys(state.spend)) if (day < year) delete state.spend[day]
  for (const day of Object.keys(state.spendBy ?? {})) if (day < year) delete state.spendBy![day]
  return gone
}
prune()
// what the loaded state is: only what changes from here on is stamped as this machine's change
const last = new Map<string, string>()
for (const [k, v] of entriesOf(state as unknown as Record<string, unknown>)) last.set(k, JSON.stringify(v))
// a new database: filled from what the JSON snapshots held (once)
if (db.empty && last.size) { db.write([...last].map(([key, value]) => ({ key, value }))); console.log(`state: moved ${last.size} entries into ${mine('state.db')}`) }

/** What changed since the last save, entry by entry (null: deleted); `last` then holds the new JSON. */
function changes(): { key: string; value: string | null }[] {
  const cur = entriesOf(state as unknown as Record<string, unknown>), out: { key: string; value: string | null }[] = []
  for (const [k, v] of cur) { const j = JSON.stringify(v); if (j !== undefined && last.get(k) !== j) { out.push({ key: k, value: j }); last.set(k, j) } }
  for (const k of [...last.keys()]) if (!cur.has(k)) { out.push({ key: k, value: null }); last.delete(k) }
  return out
}
/**
 * What another machine changed, pulled from its change log (replica.ts): into the database and into the state as it
 * runs here, never counted as a change of ours. `full`: every entry it has (this one was too far behind).
 */
export function applyRemote(got: { key: string; value: string | null }[], full?: Map<string, string>) {
  const applied = full ? db.replace(full) : (db.write(got), got)
  for (const c of applied) {
    if (c.value === null) { drop(state as unknown as Record<string, unknown>, c.key); last.delete(c.key) }
    else { put(state as unknown as Record<string, unknown>, c.key, JSON.parse(c.value)); last.set(c.key, c.value) }
  }
  if (applied.length) onMerged(applied.map((c) => c.key))
  return applied.length
}

export const today = () => new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD
export const spentToday = () => state.spend[today()] ?? 0
/** Count what a run cost: today's total, and per provider its dollars and tokens (Usage and the spend meter). */
export function addSpend(usd: number, provider: import('./providers.ts').ProviderId = 'claude', tokens?: { input?: number; output?: number }) {
  const d = today()
  state.spend[d] = spentToday() + usd
  const s = ((state.spendBy ??= {})[d] ??= {})[provider] ??= { usd: 0, input: 0, output: 0, runs: 0 }
  s.usd += usd; s.input += tokens?.input ?? 0; s.output += tokens?.output ?? 0; s.runs++
}
export const overBudget = () => state.settings.dailyBudgetUsd != null && spentToday() >= state.settings.dailyBudgetUsd

// A run that was going when the server stopped (a deploy, a crash) picks up where it left off: its agent session is on
// disk (~/.claude), so it goes back in the queue to continue that session, ahead of newer work (it keeps its queuedAt).
// Explanations and the codebase map keep their caches, so they simply run again. One still queued never started, so
// it just waits on (the queue is pumped at startup); older state marked those interrupted too, and those go back.
export const MAX_CONTINUES = 3 // restarts in a row before a run waits for you instead: a run that keeps dying stops costing
export function pickUp(entity: 'job' | 'exec', id: string, runId: string, run: Job | ExecRun) {
  const deploy = run.deployStop
  delete run.deployStop
  if (deploy) return transition(entity, id, runId, run, 'queued', 'restart (deploy)', { continuing: true, error: undefined } as Partial<Job & ExecRun>)
  if ((run.continued ?? 0) >= MAX_CONTINUES) {
    run.error = `Stopped by ${MAX_CONTINUES} restarts in a row. Run it again to continue.`
    return transition(entity, id, runId, run, 'interrupted', 'restart limit', { continuing: false } as Partial<Job & ExecRun>)
  }
  return transition(entity, id, runId, run, 'queued', 'restart', { continuing: true, continued: (run.continued ?? 0) + 1, error: undefined } as Partial<Job & ExecRun>)
}
for (const pr of Object.values(state.prs)) {
  if (pr.job?.state === 'running') pickUp('job', pr.id, pr.job.queuedAt, pr.job)
  if (pr.explain?.state === 'running') transition('explain', pr.id, pr.explain.queuedAt, pr.explain, 'queued', 'restart')
}
for (const r of Object.values(state.execs)) {
  delete r.planning // its plan was being made by the server that stopped: nothing would ever say it is in, so it starts without one
  if (r.state === 'running') pickUp('exec', r.ids.join(' → '), r.id, r)
  else if (r.state === 'interrupted' && !r.startedAt) transition('exec', r.ids.join(' → '), r.id, r, 'queued', 'never started')
}
for (const [repo, t] of Object.entries(state.base)) {
  if (t.state === 'running') transition('base', repo, t.queuedAt, t, 'queued', 'restart')
}
// Design's runs (a PR's capture, a repository's Storybook and map) don't outlive this process: one caught mid-run by
// a restart says so, so its page offers it again instead of showing it running forever. A queued one starts as usual
for (const t of [...Object.values(state.prs).map((p) => p.visuals), ...Object.values(state.visualsSetup ?? {})]) {
  if (t?.state === 'running') Object.assign(t, { state: 'failed', error: 'A restart interrupted it: start it again (it goes on where it was)', endedAt: new Date().toISOString() })
}

// saving never holds the thread: calls within 300ms become one write, off the thread (the file is ~1MB, on the Mac's
// slow file sharing). saveNow() is for shutdown, where waiting is fine.
let pending = false
let writing: Promise<void> = Promise.resolve()
// fenced: another machine holds the lease (it runs Concierge, and this one stops in a moment: fleet.ts), or this
// one just woke from a sleep. Writing now would sync an old state over the newer one: a sync conflict at best.
let fenced = false
const fence = () => {
  const ok = fleet.mayWrite()
  if (!ok && !fenced) console.warn(`state: not saved here while ${fleet.elsewhere() ?? 'another machine'} may be running it`)
  fenced = !ok
  return !ok
}
export function save() {
  if (pending) return
  pending = true
  setTimeout(() => {
    writing = writing.then(async () => {
      pending = false
      if (fence()) return
      const t = performance.now()
      const c = changes()
      if (c.length) db.write(c)
      slow('save state', t)
    }).catch((e) => console.error('save state:', (e as Error).message))
  }, 1000) // a busy run saves many times a second, and each save reads every entry for what changed: once a second is plenty
}
export function saveNow() {
  if (fence()) return
  const c = changes()
  if (c.length) db.write(c)
}
/** Logs work that held the (single) server thread long enough to be felt. */
export const slow = (what: string, t: number) => { const ms = performance.now() - t; if (ms > 150) logSlow(`${what} took ${Math.round(ms)}ms`) }
// also kept in a file that outlives the container (docker logs go with it), written off the thread
const SLOW_LOG = mine(join(STATE_DIR, 'slow.log')) // this machine's own (perMachine.ts)
const logSlow = (line: string) => { console.warn(`slow: ${line}`); void appendFile(SLOW_LOG, `${new Date().toISOString()} ${line}\n`).catch(() => {}) }
// the thread frozen for over half a second: everything waits behind it, the page included
let tick = performance.now()
setInterval(() => { const lag = performance.now() - tick - 1000; if (lag > 500) logSlow(`server thread blocked ~${Math.round(lag)}ms`); tick = performance.now() }, 1000).unref()
save()

// what another machine changed, as replica.ts applies it: the server refreshes what it shows
let onMerged: (keys: string[]) => void = () => {}
export const afterMerge = (f: (keys: string[]) => void) => { onMerged = f }

