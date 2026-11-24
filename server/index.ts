// first: the keys every machine shares go into the environment before any module reads it
import { markNotWaiting } from './judge.ts'
import { reviewStack, type StackItem } from './stackSteps.ts'
import { FEATURES, method, rereadMethods, skillFor, skillPath } from './method.ts'
import './sharedEnv.ts'
import { recentLines } from './logRing.ts'
import { profile } from './profile.ts'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { watch as fsWatch } from 'node:fs'
import { ended as bgEnded, openTasks, stop as bgStop, stopOf as bgStopOf, view as bgView, viewOf as bgViewOf, type BgTask } from './background.ts'
import { join, relative } from 'node:path'
import { execFile } from 'node:child_process'
import { commandFor, scanSkills } from './skillScan.ts'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { live, stale } from './live.ts'
import { brief as workBrief, component, remember as rememberWork, workFor, type WorkStore } from './work.ts'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'
import { basicAuth } from 'hono/basic-auth'
import { actionsFor, alignStacks, followRemote, linkStacks, markBehind, ops, runAction, setTerminal, type Op, type Scope } from './actions.ts'
import { critFor, critOfPr, deliberateNote, ownReviewFile, normsOf, refreshCrit, statusOf, type Crit, type Status } from './crit.ts'
import { addException, exceptionsOf } from './norms.ts'
import { defaultBranch, tokenChanged, getMe, gh, ghBudget, outside, poll, prHealth, refreshOne, setOnStacks } from './github.ts'
import { assignIssue, commentOnIssue, issueOf, myIssues } from './issues.ts'
import { assignToMe, bucketOf, handedBack, DONE_DAYS, hasKey, myTickets, postComment, ticketsById, type Bucket, type Ticket } from './linear.ts'
import { combinePrompt, decisionsIn, execCommand, gate, prepOf, prepPrompt, repoFor, allOver, settledIn, submitPrompt, workNote, type Batch, stackOrder, ticketStacks, type Handover, type TicketStack } from './exec.ts'
import { sentryEnv, sentryRef, textEnv, type Env } from './envOf.ts'
import { cachedStackTour, makeStackTour, writingStackTour } from './stackTour.ts'
import { trackTurns } from './turns.ts'
import { hashOf, nextSteps, stepHash, toSteps, withoutCiWatch, type NextSteps } from './next.ts'
import { pendingOf, routeSteps } from './reply.ts'
import { alert, alerts, condition, seeAlerts, whenAlerts } from './alerts.ts'
import { pin, pins, prText, prYours, ticketText, ticketYours, watch, type Seen } from './pins.ts'
import { infraView } from './infra.ts'
import { runs, totals } from './lifecycle.ts'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { freemem, homedir, tmpdir } from 'node:os'
import { fleet } from './fleet.ts'
import { fleetMachines } from './perMachine.ts'
import { selfPatch } from './scope.ts'
import { behind, latestHeads, overdue, readLatest, runningHere, type Running } from './versions.ts'
import { capped, machines, serve as serveMachine, slotsHere, token as machineToken, rotateToken, ask, matrix, heldWhy, onCameBack, hosted, statsHere, type Stats } from './machines.ts'
import { updateStatus } from './updateStatus.ts'
import { accountToken, accountTokenAt, applyShared, local as localKeys, SHARED_KEYS, sharedNow, type SharedKey } from './sharedEnv.ts'
import { call } from './worker.ts'
import { factsKey, forTeams, lastWorkday, localDay, standup, startOf, workdayBefore, writeInput } from './standup.ts'
import { areaOf, suggestPr } from './links.ts'
import { children, stopAt, planRunsWith, routing, whyNot, tell, planSpent, waitingOn, queuedWhy, windowsFor, activity, loadActivity, setLinkNote, ticketActivity, bus, cancel, note, cancelExec, runAgain, reroute, probePlan, followUnfollowed, enqueueExec, ticketBusy, cancelBase, cancelExplain, enqueue, enqueueBase, enqueueExplain, explainAfterBase, mapping, pump, running, shutdown, drained, waitReason, type Activity } from './runner.ts'
import { basePlan, callClaude, codebase, loadBase, loadNodes, loadOverlay, loadSkeleton } from './explain.ts'
import { git } from './atlas.ts'
import { load, ownUsage, stop, stoppedRuns } from './load.ts'
import { azureLoginState, azureNote, azureStatus, startAzureLogin } from './azure.ts'
import { claudeAuth, checkClaudeAuth, claudeLoginState, finishClaudeLogin, keepAccountLogins, keepClaudeAuth, lapsedLogins, onFallbackToken, startClaudeLogin, stopUsingLogin } from './claudeLogin.ts'
import { readSecrets, rereadSecrets, saveSecrets, scrub, SECRETS_FILE } from './scrub.ts'
import { applyConnectors, addCustom, customName, ownServers, removeCustom, connect, connectSentry, connections, recheck, finishLogin, loginState, reconnect, removeFix, startLogin, accountConnections } from './connections.ts'
import { spentText } from './usage.ts'
import { belongsTo, cleanWorktrees, sweepDue, worktrees } from './worktrees.ts'
import { flowInOf, flowOf, type Flow } from './flow.ts'
import { planStacks, valid, validPrep, type Prep } from './plan.ts'
import { CONFIG_FILE, WORK_DIR, CODE_DIR_SET, configured, reloadConfig, repoPath, fill, saveConfig, userConfig, workspaces, type Workspace } from './config.ts'
import { accountOf, accounts, available, modelsOf, spawnAgent, identityOf, loginText, markLimited, setIdentity, providerFor, envOf as accountEnv, limitedUntil, llamaPulling, modelOf, ollamaOf, readCodexWindows, watchOllamas, ollamaState, openaiAuth, openaiLoginState, prepareHome, PROVIDERS, readOpenaiAuth, startOpenaiLogin } from './providers.ts'
import { orgSkills, setMode, syncOrgSkills } from './orgSkills.ts'
import { improveSkill, removeSkill, skillsView, suggestSkills } from './skills.ts'
import { adopt as adoptCards, ask as askCard, discussionsOf, markSent, reset, say, settled, type Topic } from './discussions.ts'
import { domainOf, writeDomain, writingDomain } from './domain.ts'
import { peers as replicaPeers, replicaExtras, replicaStatus } from './replica.ts'
import { laneByModel } from './laneModel.ts'
import { ask as joinAsk, decide as joinDecide, hello as joinHello, status as joinStatus, waiting as joinsWaiting } from './join.ts'
import { baseSlots, canChange, mustChange, ownerOf, roles, setOwner, setRoles, slot, withRole, type Owner, type Role } from './roles.ts'
import { CERTIFICATIONS, DATA, REGIONS, REVIEWS, ROLES, type Compliance } from './readiness.ts'
import { suggestCompliance } from './complianceScan.ts'
import { allowed as allowedLogins, refuse, whoFrom } from './access.ts'
import { addToProject as addPlanToProject, applyScenario as applyPlanScenario, applyVision, create as createPlan, setScenario as setPlanScenario, addToScenario, edit as editPlan, linearProjects, linearTeams, linkProject, syncProject, newPlan, planOf, plans as allPlans, removePlan, setPlan, talk as talkPlan, undoRedo as undoRedoPlan, withHistory, type Op as PlanOp } from './plans.ts'
import { brokenSkillLinks, checkedOut, markClones, notHere, reviewIn, critInstalled, checks, cloneRepo, findRepos, cloneState, ensureClones, installSourceSkills, skillSources, mySkills, missingError, missingFor, whenMissingChanges, skillExists, skillFile, skillsNeeded, sourceSkills, suggestions, validate } from './setup.ts'
import { afterMerge, type Written, config, isFollowUp, overBudget, prune, save, saveNow, slow, spentToday, state, type BaseTask, type ExecRun, type Job, type StackRef, type Pr, type Settings, STATE_DIR, addSpend, today } from './store.ts'
import { planFor } from './router.ts'
import { CONFIG_DIR, setting } from './paths.ts'
import { githubLoginState, startGithubLogin } from './githubLogin.ts'
import { complianceFor, githubProjects, orgs, ownerRepos, planOrg, setCompliance, setTracker, setWorkspace, workspaceOffers } from './orgs.ts'
import { nearbyMachines, tailnetOwner, tailscaleView, tsStatus, watchTailnet, type TsPeer } from './tailscale.ts'
import { gitIdentity } from './gitIdentity.ts'
import { bankView, writeBank } from './bank.ts'
import { refusedForLimit } from './usage.ts'
import { stateEpoch, transition } from './lifecycle.ts'
import { cachedStackCheck, checkingStack, checkStack, partOf } from './stackCheck.ts'
import { directionOf, setDirection } from './stackDirection.ts'
import { planStack, type PlanItem } from './stackPlan.ts'
import { agentHomesReady } from './agentHome.ts'

export type Queued = { why: string; until?: number; signIn?: { machine: string; account: string } } // why queued work hasn't started, when it should, and the sign-in it waits for (queuedWhy)
export type PrView = Omit<Pr, 'body' | 'bodyHtml'> & { queued?: Queued; hasBody: boolean; background: number; status: Status; flow: Flow; missing: string[]; crit?: Crit; op?: Op; repoPath?: string; codebaseMap?: { task?: BaseTask; mappedAt?: string }; linked: Linked[]; waiting?: { label: string; why: string; until?: number }; pinned?: boolean; stackRun?: 'queued' | 'running'; stackAnswered?: string; critOff?: boolean }
/** An error in a few words, with what is under Node's bare "fetch failed" (ENOTFOUND: no DNS, a timeout, a reset). */
const whyFailed = (e: unknown) => {
  const c = (e as { cause?: { code?: string; message?: string } }).cause
  return (e as Error).message + (c ? ` (${c.code ?? c.message})` : '')
}
const health: { lastPollAt?: string; pollError?: string; polling: boolean } = { polling: false }
const healthView = () => ({
  ...health, autoStart: state.autoStart, running: running(), waiting: waitReason(), settings: state.settings,
  spentToday: spentToday(), overBudget: overBudget(), base: state.base, github: ghBudget, routing: routing(), now: accountNow(),
  // the last 7 days of agent spend, oldest first, for the sidebar meter
  spendDays: Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.now() - (6 - i) * 86400_000).toLocaleDateString('en-CA')
    return { day, usd: Math.round((state.spend[day] ?? 0) * 100) / 100 }
  }),
})
export type Health = ReturnType<typeof healthView>

/** The account the agents use now (the one most kinds of work go to), its plan windows and today's use: the sidebar's chip. */
function accountNow() {
  const r = routing()
  const counts = new Map<string, number>()
  for (const x of r) counts.set(x.using, (counts.get(x.using) ?? 0) + 1)
  const id = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'claude', a = accounts().find((x) => x.id === id)
  const standIn = r.find((x) => x.using === id && x.chosen !== id)
  return { id, label: a?.label ?? id, kind: a?.kind ?? 'claude', windows: windowsFor(id), today: state.spendBy?.[today()]?.[id], standingInFor: standIn?.chosenLabel, why: standIn?.why }
}
const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400_000).toLocaleDateString('en-CA'))


const critOfView = (p: Pr) => {
  const repoPath = config.repos[p.repo]
  const crit = repoPath ? critFor({ port: p.job?.critPort, key: p.job?.critKey }, config.agent.worktree && fill(config.agent.worktree, { repoPath, number: p.number, repo: p.repo })) : undefined
  // a review another machine ran: its crit is there, reached at that machine's tailnet address
  const base = crit?.machine ? machines.get(crit.machine)?.base : undefined
  return base ? { ...crit!, host: new URL(base).hostname } : crit
}
// remember each live crit session's key, so its counts survive the daemon stopping: done here, every 10s, never
// while reading the views (a read path that writes is how a page refresh used to change what's saved)
setInterval(() => {
  let changed = false
  for (const p of Object.values(state.prs)) {
    if (!p.job || p.closed) continue
    const crit = critOfView(p)
    if (crit?.live && crit.sessionKey && (p.job.critKey !== crit.sessionKey || (crit.cwd && p.job.critCwd !== crit.cwd))) {
      p.job.critKey = crit.sessionKey; p.job.critCwd = crit.cwd ?? p.job.critCwd; changed = true
    }
  }
  if (changed) save()
}, 10_000).unref()

function views(): PrView[] {
  const critOff = reviewIn() === 'concierge' // reviews read in Concierge: no crit to show or open
  const maps = new Map<string, string | undefined>()
  const mappedAt = (repo: string) => { if (!maps.has(repo)) maps.set(repo, loadBase(repo)?.mappedAt); return maps.get(repo) }
  const tickets = ticketViews() // once per update: every PR's linked ticket reads from it
  // the stacks one agent is resolving now (Answer the stack): every PR of one shows it, in the list and on its page
  const driving = new Map(Object.values(state.execs).filter((r) => r.ids[0]?.startsWith('STACK-') && (r.state === 'running' || r.state === 'queued')).map((r) => [r.ids[0], r.state as 'queued' | 'running']))
  return Object.values(state.prs)
    // a merged or closed one stays a few days, under Done, so it doesn't vanish from under you
    .filter((p) => !p.dismissed && (!p.closed || (!!p.closedAt && Date.now() - Date.parse(p.closedAt) < DONE_DAYS * 86_400_000)))
    .map((p) => {
      const repoPath = config.repos[p.repo]
      const crit = critOfView(p)
      const op = ops.get(p.id)
      // the description is fetched when you open it (/prs/:id/body): the live list stays small
      const { body, bodyHtml: _html, lastSaid: _said, ...pr } = p
      // and the job without what only the server reads (its prompt, the last run's words and steps): the list is sent
      // again on every change, so each byte here costs on both ends
      if (pr.job) { const { prompt: _p, lastWords: _w, lastSteps: _s, ...job } = pr.job; pr.job = { ...job, ...(job.summary && { summary: cap(job.summary, 1500) }) } as typeof pr.job }
      const waiting = p.job?.state === 'queued' ? waitingOn(p.job, p.mine ? 'revise' : 'review', p.repo) : undefined
      // queued: why it hasn't started (and when it should), shown on the PR
      const below = p.job?.state === 'queued' && p.job.after && ['queued', 'running'].includes(state.prs[p.job.after]?.job?.state ?? '') ? `#${state.prs[p.job.after].number}` : undefined
      const queued = p.job?.state === 'queued' ? queuedWhy(p.job, p.mine ? 'revise' : 'review', below, p.repo) : undefined
      const stackRun = driving.size && p.stack && p.stack.length > 1 && !p.closed ? driving.get(driveKey(p)) : undefined
      const stackAnswered = answeredAt(p)
      if (stackAnswered && pr.job) pr.job = { ...pr.job, next: undefined }
      // and its flow and status read it so too: the agent no longer "asks you" what the stack's answer covered
      const q = stackAnswered && p.job ? { ...p, job: { ...p.job, next: undefined } } : p // answered with the stack: nothing asked any more
      return { ...pr, ...(critOff && { critOff }), ...(stackRun && { stackRun }), ...(stackAnswered && { stackAnswered }), waiting, queued, pinned: `pr:${p.id}` in pins(), hasBody: !!body?.trim(), background: openTasks(p.id), repoPath, crit, linked: linksOfPr(p, tickets), op, status: statusOf(q, crit, !!repoPath, op), flow: flowOf(flowInOf(q, crit, !!repoPath, op)),
        missing: missingFor(slot(p.mine ? 'revise' : 'review')), codebaseMap: repoPath ? { task: state.base[p.repo], mappedAt: mappedAt(p.repo) } : undefined }
    })
}

let pollAgain = false
let lastPollAt = 0
async function doPoll(forced?: unknown) {
  if (fleet.elsewhere()) return // a worker: the control plane polls, once for all machines (GitHub's budget is shared)
  // a poll asked for while one runs is not dropped: it runs right after
  if (health.polling) { pollAgain = true; return }
  // GitHub's budget nearly spent (it is shared with your own gh): every 5 minutes instead of every minute, until it resets
  if (forced !== true && (ghBudget.remaining ?? 5000) < 500 && Date.now() - lastPollAt < 5 * 60_000) return
  lastPollAt = Date.now()
  health.polling = true
  bus.emit('health')
  try {
    const openBefore = new Set(Object.values(state.prs).filter((p) => !p.closed).map((p) => p.id))
    const { fresh } = await poll()
    // a PR that just merged or closed: its worktrees go (the rules still keep anything with work in it)
    const justClosed = Object.values(state.prs).filter((p) => p.closed && openBefore.has(p.id))
    if (state.autoClean && justClosed.length) void autoClean(`${justClosed.map((p) => `#${p.number}`).join(', ')} closed`, (w) => justClosed.some((p) => belongsTo(w, p)))
    trackTurns() // a PR whose head moved: how it changed direction, in the background
    // what others did since the last sync goes into each PR's Activity, as outside events
    for (const e of outside.splice(0)) {
      note(e.id, { at: e.at ?? new Date().toISOString(), kind: 'event', who: e.who, text: e.text })
      const p = state.prs[e.id]
      if (p) alert(prTarget(p), e.who ? `${e.who}: ${e.text}` : e.text, p.mine && !e.info ? 'you' : 'info')
    }
    // First ever poll: show the backlog but only auto-run requests that arrive from now on.
    if (!state.seeded) { state.seeded = true; save() }
    else for (const id of fresh) {
      const pr = state.prs[id]
      if (!pr) continue
      if (!pr.mine) alert(prTarget(pr), `Review requested by ${pr.author.login}`, 'you')
      if (state.autoStart && autoReviews(pr)) enqueue(pr)
    }
    // a new head on an explained PR (your push, a resolved conflict, a rebase, someone else's commit): explain it,
    // building on the previous iteration, only for a PR you switched following on for (otherwise explain runs when you ask)
    for (const p of Object.values(state.prs)) {
      const e = p.explain
      if (e && !p.closed && p.explainFollow === true && e.headSha !== p.headSha && (e.state === 'done' || e.state === 'failed')) enqueueExplain(p)
    }
    refreshBaseMaps().catch((e) => console.error('codebase map:', e.message))
    // a stack of yours with a branch left behind (a push into its middle) is aligned at once; on the first poll after a
    // start (a deploy, a hand-over from the other machine), your checkout catches up with GitHub too
    markBehind(Object.values(state.prs)).then(() => {
      bus.emit('change'); alignStacks(Object.values(state.prs))
      for (const p of linkStacks(Object.values(state.prs))) alert(prTarget(p), `Not in its stack on GitHub: it is built on #${p.stack![p.stack!.findIndex((s) => s.number === p.number) - 1]?.number ?? '?'}, but reviewers see it on its own. Link into stack puts it there.`, 'warn')
    }, (e) => console.error('stack check:', e.message))
    if (!followed) { followed = true; followRemote(Object.values(state.prs)).catch((e) => console.error('follow remote:', e.message)) }
    health.pollError = undefined
  } catch (e) {
    health.pollError = whyFailed(e)
  }
  condition('github', 'GitHub sync', health.pollError && `GitHub sync is failing: ${health.pollError.slice(0, 160)}`)
  if (state.claudeLoginLapsed && state.claudeLoginLapsed !== lapsedSeen) {
    lapsedSeen = state.claudeLoginLapsed
    alert({ kind: 'system', id: 'claude-login', label: 'Claude sign-in', title: 'Claude sign-in' }, 'The claude.ai sign-in stopped working: agents use the token instead. Sign in again under Settings → Connections.', 'warn')
  }
  dropClosed()
  pump()
  health.lastPollAt = new Date().toISOString()
  health.polling = false
  bus.emit('change')
  bus.emit('health')
  if (pollAgain) { pollAgain = false; doPoll() }
}

let lapsedSeen = state.claudeLoginLapsed // a lapse already known at start was alerted before

/** A line in a feed for something you did by hand (resume, cancel, dismiss): Activity tells the whole story. */
const logged = (feed: string, text: string) => note(feed, { at: new Date().toISOString(), kind: 'you', text })

// Keep each mapped repo's base map current: when its default branch moves, re-map only what drifted.
const baseChecked = new Map<string, number>()
async function refreshBaseMaps() {
  for (const [repo, path] of Object.entries(config.repos)) {
    const meta = loadBase(repo), task = state.base[repo]
    if (!meta || meta.complete === false || task?.state === 'running' || task?.state === 'queued') continue
    if (Date.now() - (baseChecked.get(repo) ?? 0) < 30 * 60_000) continue
    baseChecked.set(repo, Date.now())
    const head = (await git(path, 'ls-remote', 'origin', `refs/heads/${meta.branch}`).catch(() => '')).split('\t')[0].trim()
    if (head && head !== meta.sha) enqueueBase(repo)
  }
}

/** Open the configured terminal running `cmd`. Callers pass only config paths and our own UUIDs. */
setTerminal(openTerminal)
setOnStacks(() => bus.emit('change'))
bus.on('poll', () => void doPoll())
/** Resume: a Terminal window on this Mac when you sit at it; elsewhere (another device, a Linux/WSL server) the command to copy. */
function resume(c: { req: { header: (k: string) => string | undefined }; env: unknown }, cmd: string) {
  const ip = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress ?? ''
  const local = /^(::1|127\.|::ffff:127\.)/.test(ip) && !c.req.header('x-forwarded-for')
  if (process.platform === 'darwin' && local) { openTerminal(cmd); return { ok: true, opened: true, command: cmd } }
  return { ok: true, opened: false, command: cmd }
}
function openTerminal(cmd: string) {
  // JSON string escaping is also a valid AppleScript string literal
  const script = config.terminal === 'iTerm'
    ? ['-e', `tell application "iTerm" to tell current session of (create window with default profile) to write text ${JSON.stringify(cmd)}`, '-e', 'tell application "iTerm" to activate']
    : ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`, '-e', 'tell application "Terminal" to activate']
  execFile('osascript', script)
}

// --- in-app alerts (toasts and their inbox): what happened to each PR and ticket, as it happens ---
const JOB = { review: 'Review', revise: 'Revise', post: 'Posting the review', approve: 'Approving', publish: 'Push & reply', reply: 'Your reply' } as const
const prTarget = (p: Pr) => ({ kind: 'pr' as const, id: p.id, label: `#${p.number}`, title: p.title })
const ticketTarget = (id: string) => { const t = execBoard.tickets.find((x) => x.id === id); return { kind: 'ticket' as const, id, label: id, title: t?.title ?? id } }
const asks = (n?: NextSteps) => pendingOf(n) > 0
// what the agent asks, in its own words, so the alert says what to decide instead of "it asks you something"
const asked = (n?: NextSteps) => {
  const d = n?.decisions ?? []
  if (d.length) return `asks: ${d[0].question}${d.length > 1 ? ` (+${d.length - 1} more)` : ''}`
  return n?.actions.length ? `next: ${n.actions.map((a) => a.label).join(' · ')}` : ''
}
whenAlerts(() => bus.emit('alerts'))
// gone features leave no state: Linear releases by merge (Linear's own release integration does that, from CI) with its
// alert, auto-exec (tickets start when you run them), and a suggested verdict (the review skill proposes one)
{ const s = state as unknown as Record<string, unknown>; for (const k of ['autoRelease', 'releaseSeen', 'releaseLog', 'releaseError', 'execAuto', 'execSeen']) delete s[k]; delete (state.settings as { verdict?: unknown }).verdict; delete state.alerts?.['system:releases'] }
// what a run couldn't do: N commands refused reads as "finished" otherwise
const refusedNote = (r: { refused?: string[] }) =>
  r.refused?.length ? `${r.refused.length} command${r.refused.length > 1 ? 's' : ''} refused (${r.refused[0].slice(0, 90)}${r.refused.length > 1 ? ', …' : ''})` : ''
// the plan's window near its end: say so once, and that it clears itself when the window resets
const planAlert = () => { const s = planSpent(); condition('plan', 'Claude plan', s && `Agents are paused: ${spentText(s)}. They pick up where they left off after that.`) }
bus.on('health', planAlert); setInterval(planAlert, 60_000).unref()
bus.on('held', (short: boolean) => condition('memory', 'Memory', short ? 'Runs are waiting: under 1.5 GB of memory free on this machine' : undefined))
// a run starting answers whatever its item was waiting on: the alert stops asking for you
bus.on('started', (id: string, job: Job) => { const p = state.prs[id]; if (p) { alert(prTarget(p), `${JOB[job.kind] ?? 'Agent'} started`); seeAlerts([`pr:${p.id}`]) } })
bus.on('exec-started', (run: ExecRun) => { for (const id of run.ids) { alert(ticketTarget(id), `${run.label ?? 'Ship'} started`); seeAlerts([`ticket:${id}`]) } })
bus.on('exec-finished', (run: ExecRun) => {
  stepsFor(run, `exec:${run.id}`).then(() => bus.emit('exec')).catch(() => {}) // ready by the time you look
  for (const id of run.ids) {
    const out = run.outcomes[id]?.outcome
    if (run.refused?.length) alert(ticketTarget(id), `${run.label ?? 'Ship'}: ${refusedNote(run)}`, 'warn')
    if (run.state === 'failed') alert(ticketTarget(id), `${run.label ?? 'Ship'} failed${run.error ? `: ${run.error.slice(0, 120)}` : ''}`, 'warn')
    else if (run.state === 'done') stepsFor(run, `exec:${run.id}`).then((n) => alert(ticketTarget(id), asks(n ?? undefined) || out === 'refined' ? `${run.label ?? 'Ship'} finished, ${asked(n ?? undefined) || 'it needs your decision on Linear'}` : `${run.label ?? 'Ship'} finished${out ? ` (${out})` : ''}`, asks(n ?? undefined) || out === 'refined' ? 'you' : 'ok')).catch(() => {})
  }
  if (run.state === 'done') for (const h of run.handovers ?? []) void handOver(run, h)
  batchStep(run)
  setTimeout(() => pollTickets(), 3000) // Linear and the PRs are the truth: re-read them
})

/** Start picked tickets as a batch: every ticket now, side by side; the ones that share something after their short prep. */
function startBatch(stacks: string[][], said: string, prep?: Batch['prep'], mode?: Batch['mode']) {
  const at = new Date().toISOString(), old = Date.now() - 14 * 86_400_000
  for (const [k, x] of Object.entries(state.batches)) if (Date.parse(x.at) < old) delete state.batches[k]
  const b: Batch = { id: randomUUID().slice(0, 8), at, stacks, ...(said && { said }), ...(prep && { prep }), ...(mode && { mode }), submitted: {} }
  state.batches[b.id] = b; save()
  const p = prep && enqueueExec(prep.ids, repoFor(prep.ids[0], config.exec.repoByPrefix)!, false, { label: 'Prep', role: 'prep', batch: b.id, prompt: prepPrompt(prep, said), said: said || `Prep: ${prep.task}` })
  // the tickets the prep isn't for start now; its own once it hands over
  return [...(p ? [p] : []), ...startWork(b, b.stacks.flat().filter((id) => !p || !prep.ids.includes(id)))]
}
const startWork = (b: Batch, ids: string[]) => ids.map((id) => enqueueExec([id], repoFor(id, config.exec.repoByPrefix)!, false, { batch: b.id, ...(b.said && { said: b.said }), brief: workNote(b, id) })).filter(Boolean)

/** A batch run ended: a prep hands over to the tickets; a ticket ready in a stack submits it once the whole stack is. */
function batchStep(run: ExecRun) {
  const b = run.batch ? state.batches[run.batch] : undefined, key = `exec:${run.id}`, at = new Date().toISOString()
  // Ship as one PR: a ticket that failed doesn't hold the others, so any end counts
  if (b?.mode === 'one-pr' && run.role !== 'submit' && run.role !== 'prep' && run.state !== 'queued' && run.state !== 'running') return combineStep(b, run)
  if (!b || run.state !== 'done' || run.role === 'submit') return
  if (run.role === 'prep') {
    const p = prepOf(run.summary ?? '')
    if (!p) { note(key, { at, kind: 'event', text: `${b.prep?.ids.join(', ')} wait for the prep: it ended without its PREP line. Answer it, or run it again.` }); return }
    b.prep = { ...b.prep!, ...p, brief: (run.summary ?? '').replace(/^\s*`?PREP\s+\S+`?\s*$/m, '').trim().slice(0, 6000) }
    save()
    const started = startWork(b, b.prep!.ids).flatMap((r) => r!.ids)
    note(key, { at, kind: 'event', text: `Prep done${p.branch ? ` on \`${p.branch}\`` : ''}: ${started.join(', ')} start now, side by side.` })
    return
  }
  for (const s of b.stacks) {
    if (s.length < 2 || b.submitted[s[0]] || !run.ids.some((id) => s.includes(id))) continue
    const g = gate(s, Object.values(state.execs), b.id)
    if ('go' in g) {
      const r = enqueueExec(s, repoFor(s[0], config.exec.repoByPrefix)!, false, { label: 'Submit stack', role: 'submit', batch: b.id, prompt: submitPrompt(g.go, execCommand(slot('exec'), s)) })
      if (r) { b.submitted[s[0]] = r.id; save() }
      note(key, { at, kind: 'event', text: r ? `All of ${s.join(' → ')} are ready: submitting them as one stack.` : `${s.join(' → ')} are ready, but the submit couldn't start (one is busy). Run it again once they're free.` })
    } else if (run.ids.some((id) => g.ready.includes(id))) note(key, { at, kind: 'event', text: `Ready. The stack ${s.join(' → ')} is submitted once ${g.waiting.join(', ')} ${g.waiting.length === 1 ? 'is' : 'are'} too.` })
  }
}

/**
 * Ship as one PR: once every ticket's run is over, one combine run takes the ones that got done into one PR (and merges
 * it when its repository allows: Settings → Repositories). Tickets that didn't get done stay open, with their reason
 * in the PR and on their own page.
 */
function combineStep(b: Batch, run: ExecRun) {
  const ids = b.stacks.flat(), key = `exec:${run.id}`, at = new Date().toISOString()
  if (b.submitted[ids[0]]) return
  const s = allOver(ids, Object.values(state.execs), b.id)
  if (!s) { note(key, { at, kind: 'event', text: 'Done here. The one PR is made once the other tickets are over too.' }); return }
  if (!s.go.length) { note(key, { at, kind: 'event', text: `None of ${ids.join(', ')} got done, so there is no PR to make. Each one's page says why.` }); return }
  const runs = Object.values(state.execs).filter((x) => x.batch === b.id && !x.role)
  const latest = (id: string) => runs.filter((x) => x.ids.includes(id)).sort((x, y) => y.queuedAt.localeCompare(x.queuedAt))[0]
  const decisions = Object.fromEntries(s.go.map((g) => [g.id, decisionsIn(latest(g.id)?.summary ?? '') ?? '(none listed)']))
  const left = s.left.map((id) => ({ id, why: latest(id)?.outcomes[id]?.reason ?? latest(id)?.error?.slice(0, 200) ?? (latest(id)?.outcomes[id]?.outcome === 'refined' ? 'it stopped to ask' : 'it didn\'t finish') }))
  const repo = repoFor(s.go[0].id, config.exec.repoByPrefix)!
  const merge = (config.mergeOnGreen ?? []).includes(repo)
  const r = enqueueExec(s.go.map((g) => g.id), repo, false, { label: merge ? 'Ship as one PR and merge' : 'Ship as one PR', role: 'submit', batch: b.id, prompt: combinePrompt({ go: s.go, left, decisions, command: execCommand(slot('exec'), s.go.map((g) => g.id)), merge, said: b.said }) })
  if (r) { b.submitted[ids[0]] = r.id; save() }
  note(key, { at, kind: 'event', text: r ? `${s.go.map((g) => g.id).join(', ')} are done: combining them into one PR${merge ? ', merged once its checks pass' : ''}.${s.left.length ? ` Not in it: ${s.left.join(', ')}.` : ''}` : `Ready to combine into one PR, but it couldn't start (one of them is busy). Run it again once they're free.` })
}

/**
 * A run handed work to another ticket: that ticket is assigned to you and gets its own run with the brief, so its
 * progress is tracked there; the handing run's activity says where it went.
 */
async function handOver(from: ExecRun, h: Handover) {
  const src = from.ids.join(', '), key = `exec:${from.id}`, at = () => new Date().toISOString()
  const repo = repoFor(h.id, config.exec.repoByPrefix)
  if (!repo) { note(key, { at: at(), kind: 'error', text: `Not handed over to ${h.id}: no repository is mapped for ${h.id.split('-')[0]} (Settings › Workflows).` }); return }
  if (ticketBusy(h.id)) { note(key, { at: at(), kind: 'event', text: `${h.id} already has a run going; the handover waits for you there.` }); return }
  const assigned = await (issueOf(h.id) ? assignIssue(h.id) : assignToMe(h.id)).then(() => '', (e: Error) => ` It could not be assigned to you (${e.message}); do that in ${issueOf(h.id) ? 'GitHub' : 'Linear'}.`)
  const cmd = slot('exec') ? execCommand(slot('exec'), [h.id]) : ''
  const next = enqueueExec([h.id], repo, false, { label: `Handed over from ${src}`, prompt: `${cmd}\n\nHanded over from ${src}, whose run decided this:\n${h.brief}`.trim() })
  note(key, { at: at(), kind: 'event', text: next ? `Handed over to ${h.id}: its own run started, and its progress shows on ${h.id}.${assigned}` : `Could not start ${h.id}'s run.${assigned}` })
  if (next) alert(ticketTarget(h.id), `Handed over from ${src}: its run started`, 'info')
  void pollTickets()
}

let followed = false
bus.on('finished', (id: string, job: Job) => {
  const pr = state.prs[id]
  if (!pr) return
  // an agent may have pushed from its own worktree: your checkout of that branch follows when it is only behind
  if (pr.mine) setTimeout(() => followRemote([pr]).catch((e) => console.error('follow remote:', e.message)), 3000)
  if (job.refused?.length) alert(prTarget(pr), `${JOB[job.kind] ?? 'Agent'}: ${refusedNote(job)}`, 'warn')
  if (job.state === 'done') stepsFor(job, id).then((n) => { bus.emit('change'); alert(prTarget(pr), asks(n ?? undefined) ? `${JOB[job.kind] ?? 'Agent'} finished, ${asked(n ?? undefined)}` : `${JOB[job.kind] ?? 'Agent'} finished`, asks(n ?? undefined) ? 'you' : 'ok') }).catch(() => {})
  if (job.state === 'failed') alert(prTarget(pr), `${JOB[job.kind] ?? 'Agent'} failed${job.error ? `: ${job.error.slice(0, 120)}` : ''}`, 'warn')
  if (isFollowUp(job.kind)) {
    // show the new review at once; GitHub can take a few seconds to list it, so look twice more
    const sync = () => refreshOne(id).then(() => bus.emit('change')).catch((e) => console.error('refresh', id, e.message))
    sync(); setTimeout(sync, 5000); setTimeout(sync, 15000)
  }
  // map the change while you open crit (only when following is on for this PR); if the repo is being mapped right now, wait for the richer map
  else if (job.state === 'done' && pr.explainFollow === true) mapping(pr.repo) ? explainAfterBase(pr, false) : enqueueExplain(pr)
})

// a background skills check found something new missing (or back): the pages re-render their run buttons
whenMissingChanges(() => { bus.emit('exec'); bus.emit('change') })

// --- linked work: a PR and the Linear ticket it ships (named in its title, branch or description) ------------
export type Linked = { kind: 'pr' | 'ticket'; id: string; label: string; title: string; url?: string; agent: 'working' | 'asks' | 'idle' | 'none'; said?: string; area?: string; suggest?: string }
const firstLine = (t?: string) => t?.replace(/[#*_`>]/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 180)
// its own: named in its title or branch, or one its body closes ("Fixes AI-12"). A body that only mentions tickets (a
// release's list, an ADR's references) would tie every one of them, and their PRs, into one Work
const ticketsOf = (p: Pr) => {
  const closes = [...(p.body ?? '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of|implements?)[:\s]+([A-Za-z]{2,4}-\d{1,6})\b/gi)].map((m) => m[1])
  const ids = new Set([...(`${p.title} ${p.head}`.toUpperCase().match(/\b[A-Z]{2,4}-\d{1,6}\b/g) ?? []), ...closes.map((x) => x.toUpperCase())])
  return execBoard.tickets.filter((t) => ids.has(t.id))
}
const ticketLink = (id: string, views: TicketView[]): Linked | undefined => {
  const t = views.find((x) => x.id === id)
  if (!t) return undefined
  const asks = t.agentWaiting || pendingOf(t.run?.next) > 0
  return { kind: 'ticket', id: t.id, label: t.id, title: t.title, url: t.url, agent: t.busy ? 'working' : asks ? 'asks' : t.run ? 'idle' : 'none', said: firstLine(t.run?.summary) }
}
const prLink = (p: Pr): Linked => {
  const j = p.job, busy = j?.state === 'running' || j?.state === 'queued'
  return { kind: 'pr', id: p.id, label: `#${p.number}`, title: p.title, url: p.url, agent: busy ? 'working' : pendingOf(j?.next) ? 'asks' : j ? 'idle' : 'none', said: firstLine(j?.summary) }
}
export const linksOfPr = (p: Pr, views = ticketViews()): Linked[] => ticketsOf(p).flatMap((t) => ticketLink(t.id, views) ?? [])
export const linksOfTicket = (t: Ticket, said = ''): Linked[] => {
  const links = prsOf(t).flatMap((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return p && !p.closed ? [{ ...prLink(p), area: areaOf(p.title, p.head), number: p.number }] : [] })
  const pick = said ? suggestPr(said, links.map((l) => ({ number: l.number, area: l.area }))) : undefined
  return links.map(({ number, ...l }) => (number === pick?.number ? { ...l, suggest: pick.why } : l)).sort((a, b) => Number(!!b.suggest) - Number(!!a.suggest))
}
// an agent starting while its counterpart works (or has just left a word) is told, so they don't work over each other
// --- Works (work.ts): what is linked shares one memory ------------------------------------------------------
// a repo none of whose PRs ever named a ticket works without tickets: its open PRs are one Work, so one memory and one
// chat look after all of it (ponytail: read again at most once a minute; a first PR naming a ticket splits it up)
let noTickets: { at: number; repos: Set<string> } = { at: 0, repos: new Set() }
function ticketless(repo: string) {
  if (Date.now() - noTickets.at > 60_000) {
    // from the PRs alone (a ticket id in a title, or a branch that starts with one), never the board: before Linear is read (a restart, a
    // machine without its key) the board is empty, and every repo would look ticketless and fold into one Work
    const named = new Set(Object.values(state.prs).filter((p) => /\b[A-Z]{2,5}-\d+\b/.test(p.title) || /^[a-z]{2,5}-\d+(?:[-_/]|$)/i.test(p.head)).map((p) => p.repo))
    noTickets = { at: Date.now(), repos: new Set(Object.values(state.prs).map((p) => p.repo).filter((r) => !named.has(r))) }
  }
  return noTickets.repos.has(repo)
}
function workEdges(k: string): string[] {
  const manual = Object.values(state.works ?? {}).flatMap((w) => w.links).flatMap(([a, b]) => (a === k ? [b] : b === k ? [a] : []))
  const open = (id: string) => !!state.prs[id] && !state.prs[id].closed
  if (k.startsWith('pr:')) {
    const p = state.prs[k.slice(3)]
    if (!p) return manual
    const repoMates = !p.closed && ticketless(p.repo) ? Object.values(state.prs).filter((x) => x.repo === p.repo && x.id !== p.id && !x.closed).map((x) => `pr:${x.id}`) : []
    return [...ticketsOf(p).map((t) => `ticket:${t.id}`), ...(p.stack ?? []).map((x) => `${x.repo}#${x.number}`).filter((id) => id !== p.id && open(id)).map((id) => `pr:${id}`), ...repoMates, ...manual]
  }
  const id = k.slice(7)
  return [...Object.values(state.prs).filter((p) => !p.closed && ticketsOf(p).some((t) => t.id === id)).map((p) => `pr:${p.id}`), ...manual]
}
/** A member's Work (merged with any other it is now linked to) and its members, labelled. */
export function workOfMember(key: string) {
  const keys = component(key, workEdges)
  const w = workFor(state as unknown as WorkStore & typeof state, keys)
  const members = keys.map((k) => {
    if (k.startsWith('pr:')) { const p = state.prs[k.slice(3)]; return { key: k, kind: 'pr' as const, label: `#${p?.number ?? k.split('#')[1]}`, title: p?.title ?? '' } }
    const t = execBoard.tickets.find((x) => x.id === k.slice(7))
    return { key: k, kind: 'ticket' as const, label: k.slice(7), title: t?.title ?? '' }
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, undefined, { numeric: true }))
  return { w, members }
}
/** Your words on a member: kept in its Work's memory, so every run on any part of it follows them. */
function rememberSaid(key: string, text: string) { const { w } = workOfMember(key); rememberWork(w, key, text); save() }
(state as { works?: unknown }).works ??= {}; (state as { workOf?: unknown }).workOf ??= {}

// a part's work moved on: pages showing the shared chat of a Work it is in read the others again (at most every 3s)
let feedSoon: ReturnType<typeof setTimeout> | undefined
bus.on('activity', (id: string) => {
  const key = id.startsWith('exec:') ? state.execs[id.slice(5)]?.ids.map((t) => `ticket:${t}`).find((k) => state.workOf?.[k]) : `pr:${id}`
  const w = key && state.workOf?.[key]
  if (!w || Object.values(state.workOf ?? {}).filter((x) => x === w).length < 2) return
  feedSoon ??= setTimeout(() => { feedSoon = undefined; stale('/works/feed') }, 3000)
})

/**
 * Once: every Work filled from what its parts held before Works existed. What you said on each part (your words in
 * its history), the stack's direction, and each part's Intent and Understanding cards, all into the Work's.
 */
async function seedWorks() {
  if (state.worksSeeded || !fleet.mayWrite()) return
  if (!execBoard.tickets.length) { setTimeout(() => void seedWorks(), 60_000).unref(); return } // the board isn't read yet
  const done = new Set<string>()
  const keys = [...Object.values(state.prs).filter((p) => !p.closed).map((p) => `pr:${p.id}`), ...execBoard.tickets.map((t) => `ticket:${t.id}`)]
  let n = 0
  for (const k of keys) {
    if (done.has(k)) continue
    const { w, members } = workOfMember(k)
    for (const m of members) done.add(m.key)
    if (members.length < 2) continue
    for (const m of members) {
      const feed = m.kind === 'pr' ? await loadActivity(m.key.slice(3)) : await ticketActivity(m.key.slice(7))
      for (const a of feed.filter((x) => x.kind === 'you' && !x.lane).slice(-30)) w.said.push({ text: a.text.slice(0, 2000), at: a.at, on: m.key })
    }
    for (const d of Object.values(state.stackDirections ?? {})) {
      const on = d.numbers.map((x) => `pr:${d.repo}#${x}`).find((x) => members.some((m) => m.key === x))
      if (on) w.said.push({ text: `The direction the stack follows: ${d.text}`, at: d.at, on })
    }
    const seen = new Set<string>()
    w.said = w.said.sort((a, b) => a.at.localeCompare(b.at)).filter((x) => { const id = `${x.on}|${x.text}`; return !seen.has(id) && !!seen.add(id) }).slice(-200)
    // the cards: each part's own, and its stack's, into the Work's
    const stacks = members.flatMap((m) => { const p = m.kind === 'pr' ? state.prs[m.key.slice(3)] : undefined; return p?.stack && p.stack.length > 1 ? [`stack:${p.stack[0].repo}#${p.stack[0].number}`] : [] })
    adoptCards(`work:${w.id}`, [...new Set([...members.map((m) => m.key), ...stacks])])
    n++
  }
  state.worksSeeded = true; save()
  console.log(`works: filled ${n} from what their parts held`)
}
setTimeout(() => void seedWorks(), 30_000).unref()

/** The parts your words name with @ (a ticket @AI-1500, a PR @#5201 of this repository or @owner/repo#12): linked into
 *  `here`'s Work. Returns what the agent should be told about the ones that are new to it. */
function linkMentions(here: string, text: string, repo?: string): string {
  const named = [
    ...[...text.matchAll(/@([A-Z]{2,5}-\d{1,6})\b/g)].map((m) => `ticket:${m[1]}`),
    ...[...text.matchAll(/@(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g)].map((m) => `pr:${m[1] ?? repo}#${m[2]}`).filter((k) => !!state.prs[k.slice(3)]),
  ]
  const before = new Set(workOfMember(here).members.map((m) => m.key))
  const fresh = [...new Set(named)].filter((k) => k !== here && !before.has(k))
  if (!fresh.length) return ''
  const { w } = workOfMember(here)
  for (const k of fresh) w.links.push([here, k])
  workOfMember(here) // merges their Works into this one
  save(); stale('/works')
  const about = fresh.map((k) => {
    if (k.startsWith('pr:')) { const x = state.prs[k.slice(3)]!; return `- PR #${x.number} "${x.title}" (${x.head} into ${x.base})${x.job?.summary ? `; its agent last said: ${firstLine(x.job.summary)}` : ''}` }
    const t = execBoard.tickets.find((x) => x.id === k.slice(7))
    return `- Linear ticket ${k.slice(7)}${t ? ` "${t.title}"\n${t.description.slice(0, 2500)}` : ' (not on your board: read it in Linear)'}`
  })
  return `\n\n(Linked to this work just now, as the developer asked with @: it shares this work's memory from here on.\n${about.join('\n')}\nIf the message asks to bring one of them into this work (integrate a ticket into the stack, take over a PR), plan where it fits and do it as part of this work.)`
}

setLinkNote(({ pr: p, ticketIds }) => {
  const here = p ? `pr:${p.id}` : ticketIds?.[0] && execBoard.tickets.some((t) => t.id === ticketIds[0]) ? `ticket:${ticketIds[0]}` : undefined
  const shared = here ? (() => { const { w, members } = workOfMember(here); return workBrief(w, members, here) })() : ''
  const others = p ? linksOfPr(p) : (ticketIds ?? []).flatMap((id) => { const t = execBoard.tickets.find((x) => x.id === id); return t ? linksOfTicket(t) : [] })
  if (!others.length) return shared
  const line = (l: Linked) => `- ${l.kind === 'ticket' ? `Linear ticket ${l.id}` : `PR ${l.label}`} "${l.title}": its agent is ${l.agent === 'working' ? 'WORKING on it right now' : l.agent === 'asks' ? 'waiting on the owner' : l.agent === 'idle' ? 'idle' : 'not started'}${l.said ? `; its last word: "${l.said}"` : ''}`
  return shared + '\n\nLinked work, handled by another agent of Concierge (the owner can hand the work between you):\n' + others.map(line).join('\n')
    + '\nIf it is working right now, do not push to the same branch or post on the same threads; say in your final message what you left for it.'
})

const app = new Hono().basePath('/api')
// another website can't make Concierge act: a page you visit could otherwise POST to 127.0.0.1 and start a run, post
// a review or write to Linear (it can't read the answer, but the action would happen). Browsers say where a request
// comes from (Sec-Fetch-Site); anything changing state from another site is refused. This page's own calls are
// same-origin, and scripts and the other machines send no such header.
app.use('*', async (c, next) => {
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && (c.req.header('sec-fetch-site') === 'cross-site' || c.req.header('sec-fetch-site') === 'same-site')) {
    return c.json({ error: 'Refused: this request came from another website' }, 403)
  }
  await next()
})
// a route that throws answers with what went wrong, as JSON like every other answer (not the framework's bare
// "Internal Server Error", which the page can't read), and says so in the log with the route
app.onError((e, c) => { console.error(`[api] ${c.req.method} ${c.req.path}:`, e); return c.json({ error: e instanceof Error ? e.message : String(e) }, 500) })
// an answer that hasn't changed goes back as an empty 304 (the page's browser keeps the last one and asks with its
// ETag): the big reads (an explanation, a feed, the setup) aren't sent and parsed again. Never the live stream or a profile
const tagged = etag({ weak: true })
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' || c.req.path.endsWith('/events') || c.req.path.includes('/debug/')) return next()
  await tagged(c, next)
  if (c.res.status === 200 || c.res.status === 304) c.header('Cache-Control', 'no-cache') // kept, but asked again every time
})
// --- scope: this machine or the whole fleet --------------------------------------------------------------------------
// Every machine follows the same state, so it is one API; the scope only filters what the lists return. Asked for with
// ?scope=self|fleet or the page's x-concierge-scope header; unsaid, it follows how the page was opened: this machine's
// localhost is that machine (self), the tailnet link is the fleet. One machine: always the fleet (it is this one)
type ViewScope = 'self' | 'fleet'
const scopeOf = (c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }): ViewScope => {
  const said = c.req.query('scope') ?? c.req.header('x-concierge-scope')
  if (fleetMachines().length < 2) return 'fleet'
  if (said === 'self' || said === 'fleet') return said
  return c.req.header('x-forwarded-for') ? 'fleet' : 'self'
}
/** The repositories this machine doesn't have (not allowed here, or unticked and kept for now): what self leaves out. */
const awayHere = () => new Set(Object.keys(config.repos).filter(notHere))
const repoOfPr = (id: string) => state.prs[id]?.repo ?? id.split('#')[0]

// the role the page is in comes with each request: what it starts runs that role's commands (roles.ts)
app.use('*', (c, next) => withRole(c.req.header('x-concierge-role'), next))
// a machine that may not save (another one holds the lease, or this one just woke) does no click itself: a reply or a
// run started here would live only in its memory. It hands the click to the machine that saves, over the machines' own
// link (the machine key), so a page opened on any machine's localhost stays live; the result comes back here within 2s
// (replica.ts). No machine that saves answering: refused, as before
// What acts on this machine itself stays here, on any machine: updating it, its own sign-ins, its clones and worktrees,
// a terminal on it. None of it is the shared state
const HERE_ONLY = /^\/api\/(update$|claude-auth\/|azure\/login$|github\/login$|connections\/login|accounts\/[^/]+\/(login|adopt-login)$|setup\/(clone|validate|skills)$|worktrees\/clean$|debug\/|(prs|exec)\/[^/]+\/resume-terminal$)/
// what only the main server knows whole (every machine, how full each is, the joins, where they differ): a follower
// shows the main server's, so Settings → Machines lists the whole fleet on any machine's localhost
// (an account's machines and its sync check ask every machine, which only the main one knows)
const FLEET_VIEW = /^\/api\/(machines|machines\/joins|machines\/[^/]+\/logs|fleet\/alignment|repos\/held|accounts\/[^/]+\/(machines|security))$/
app.use('*', async (c, next) => {
  if (fleet.mayWrite() || (c.req.method === 'GET' ? !FLEET_VIEW.test(c.req.path) : HERE_ONLY.test(c.req.path))) return next()
  const main = (await replicaPeers()).find((p) => p.active)
  if (main) try {
    const r = await call<{ status: number; text: string; type?: string }>(main.base, machineToken(), 'POST', '/x/api',
      { method: c.req.method, path: c.req.path + (new URL(c.req.url).search), body: await c.req.text(), role: c.req.header('x-concierge-role') }, 120_000)
    return new Response(r.text, { status: r.status, headers: { 'content-type': r.type ?? 'application/json' } })
  } catch (e) { console.warn(`api: couldn't hand ${c.req.method} ${c.req.path} to ${main.name}: ${(e as Error).message}`) }
  if (c.req.method === 'GET') return next() // the main server didn't answer: this machine's own view, as before
  return c.json({ error: fleet.whyNot?.() ?? `${fleet.elsewhere() ?? 'Another machine'} runs Concierge now: nothing done here is kept. Reload in a moment.` }, 409)
})
// an application no machine can work on now (machines.ts heldWhy): its pull requests and tickets are there to read, but
// nothing is started for them (a run, a reply, an explanation, an action, a post), so nothing lands where it can't go.
// What only reads or tidies stays open: marking read, dismissing, cancelling or stopping what runs, its domain
const OPEN_ON_HELD = /^(read|dismiss|op\/dismiss|cancel|background\/stop|domain|resume-terminal)$/
async function heldTarget(c: { req: { path: string; json: <T>() => Promise<T> } }): Promise<string | undefined> {
  const m = c.req.path.match(/^\/api\/(?:prs\/([^/]+)\/(.+)|exec\/tickets\/([^/]+)\/(actions|steer)|exec\/([^/]+)\/(reply|steer)|exec\/(action|plan)|stacks\/(say|drive))$/)
  if (!m) return undefined
  const body = () => c.req.json<{ id?: unknown; ids?: unknown; pr?: unknown }>().catch(() => ({} as { id?: unknown; ids?: unknown; pr?: unknown }))
  const ticketRepo = (id: unknown) => (typeof id === 'string' ? ticketViews().find((t) => t.id === id)?.repo : undefined)
  const repos: (string | undefined)[] =
    m[1] ? (OPEN_ON_HELD.test(m[2]) ? [] : [repoOfPr(decodeURIComponent(m[1]))])
    : m[3] ? [ticketRepo(decodeURIComponent(m[3]))]
    : m[5] ? [state.execs[m[5]]?.repo]
    : m[7] === 'action' ? [ticketRepo((await body()).id)]
    : m[7] === 'plan' ? [((await body()).ids as unknown[] | undefined) ?? []].flat().map(ticketRepo)
    : m[8] === 'say' ? [((await body()).ids as unknown[] | undefined) ?? []].flat().map((id) => (typeof id === 'string' ? repoOfPr(id) : undefined))
    : [typeof (await body()).pr === 'string' ? repoOfPr((await body()).pr as string) : undefined]
  for (const r of repos) { const why = r && heldWhy(r); if (why) return why }
  return undefined
}
app.use('*', async (c, next) => {
  if (c.req.method !== 'POST' || !fleet.machine) return next()
  const why = await heldTarget(c)
  if (!why) return next()
  return c.json({ error: `No machine can work on this now: ${why}. It is here to read; actions wait until one of its machines is back.`, held: true }, 409)
})
app.get('/alerts', (c) => c.json(alerts()))
// dim a ticket for now: it stays listed, faded and last in its group, until its state changes
app.post('/exec/tickets/:id/dim', async (c) => {
  const { on } = await c.req.json<{ on?: boolean }>()
  const id = c.req.param('id'), v = ticketViews().find((t) => t.id === id)
  if (!v) return c.json({ error: 'No such ticket' }, 404)
  const d = { ...state.dimmed }
  for (const k of Object.keys(d)) if (!execBoard.tickets.some((t) => t.id === k)) delete d[k] // gone from your list
  if (on) d[id] = v.bucket; else delete d[id]
  state.dimmed = d; save(); bus.emit('exec')
  return c.json({ ok: true })
})
// bookmarks: on or off for a PR ("pr:<id>") or a ticket ("ticket:<id>")
app.post('/pins', async (c) => {
  const { key, on } = await c.req.json<{ key?: string; on?: boolean }>()
  if (!key || !/^(pr|ticket):\S+$/.test(key)) return c.json({ error: 'key must be pr:<id> or ticket:<id>' }, 400)
  pin(key, !!on); watchPins(); bus.emit('change'); bus.emit('exec')
  return c.json({ ok: true })
})
// each change of a bookmarked item's state is an alert; a merged, closed or done one loses its bookmark
function watchPins() {
  const keys = Object.keys(pins())
  if (!keys.length) return
  const prs = keys.some((k) => k.startsWith('pr:')) ? new Map(views().map((p) => [p.id, p])) : new Map<string, PrView>()
  const tickets = keys.some((k) => k.startsWith('ticket:')) ? new Map(ticketViews().map((t) => [t.id, t])) : new Map<string, TicketView>()
  const now: Seen[] = keys.flatMap((key): Seen[] => {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    if (kind === 'pr') {
      const raw = state.prs[id]
      if (raw?.closed) return [{ key, text: 'Closed or merged', you: false, gone: true }]
      const p = prs.get(id)
      return p ? [{ key, text: prText(p.status, !!p.mine), you: prYours(p.status, !!p.mine) }] : []
    }
    const t = tickets.get(id)
    return t ? [{ key, text: ticketText(t.bucket), you: ticketYours(t.bucket), gone: t.bucket === 'closed' }] : []
  })
  for (const ch of watch(now)) {
    const [kind, id] = [ch.key.slice(0, ch.key.indexOf(':')), ch.key.slice(ch.key.indexOf(':') + 1)]
    const target = kind === 'pr' ? (state.prs[id] && prTarget(state.prs[id])) : ticketTarget(id)
    if (target) alert(target, ch.text, ch.you ? 'you' : ch.gone ? 'ok' : 'info', true)
  }
}
let pinsSoon: ReturnType<typeof setTimeout> | undefined
const pinsLater = () => { pinsSoon ??= setTimeout(() => { pinsSoon = undefined; watchPins() }, 2000) }
bus.on('change', pinsLater)
bus.on('exec', pinsLater)
app.post('/alerts/seen', async (c) => { const { keys } = await c.req.json<{ keys?: string[] }>().catch(() => ({ keys: undefined })); seeAlerts(keys); return c.json({ ok: true }) })
const pr = (id: string) => state.prs[decodeURIComponent(id)]

// machine: which of two machines runs it (DECK_NAME), so crit links opened through the shared link reach this one.
// alive: answers without asking anything else (GitHub, the agents), for Docker's health check
app.get('/alive', (c) => c.text('ok'))
app.get('/me', async (c) => c.json({
  ...(await getMe()), machine: fleet.reach ? fleet.machine : undefined, reach: fleet.reach,
  viewer: await viewerOf(c.req.header('x-forwarded-for'), c.req.header('tailscale-user-login')),
  serving: { role: process.env.DECK_ROLE, version: process.env.DECK_VERSION, control: fleet.mayWrite() },
}))
/** Who opens the page: no forwarded address is this machine itself (localhost); else the tailnet device that address is. */
async function viewerOf(fwd?: string, login?: string) {
  const ip = fwd?.split(',')[0]?.trim()
  if (!ip) return { here: true }
  const s = await tsStatus()
  const p = [s?.Self, ...Object.values(s?.Peer ?? {})].find((x) => x?.TailscaleIPs?.includes(ip))
  return { here: false, ip, device: p?.HostName, os: p?.OS, login: login?.trim() || undefined }
}
// updating a Docker install: the container can't rebuild itself, so the button leaves a note that bin/update
// (run every minute by cron on the host) picks up; its log and the commit it deployed come back the same way
// where it runs: this machine, the other one, their heartbeats and the sync between them (Settings → About)
app.get('/infra', async (c) => c.json(await infraView()))
// the machines that run agents (several machines: machines.ts): this one, every one that beats, how full each is, and
// which one you work on. Settings → Machines
app.get('/machines', async (c) => {
  const beats = ((await infraView()) as { beats?: { name: string; role?: string; active?: boolean; agoS?: number }[] }).beats ?? []
  const here = [...children.values()].filter((x) => !(x as { machine?: string }).machine).length
  const me = fleet.machine ?? 'this machine', own = slotsHere(state.settings.maxJobs)
  const list = [{ name: me, role: process.env.DECK_ROLE, control: fleet.mayWrite(), online: true, slots: own, room: capped(fleet.machine, own), running: here, freeMb: Math.round(freemem() / 1048576) }]
  for (const b of beats) {
    if (b.name === fleet.machine || b.name.includes('.sync-conflict-')) continue
    const m = machines.get(b.name), s = m?.status
    // a standby doesn't poll the other machines' workers (the control plane does): their heartbeat says they are up
    list.push({ name: b.name, role: b.role, control: !!b.active, online: !!s || (b.agoS ?? Infinity) < 90, slots: s?.slots ?? 0, room: capped(b.name, s?.slots ?? 0), running: s?.running ?? 0, freeMb: s?.freeMb ?? 0 })
  }
  return c.json({ machines: list, workMachine: state.settings.workMachine, workSlots: state.settings.workSlots ?? 1, several: !!fleet.machine })
})
// the keys every machine uses (sharedEnv.ts): whether each is set and since when, never the value
const KEY_LABEL: Record<SharedKey, string> = { GITHUB_TOKEN: 'GitHub token', LINEAR_API_KEY: 'Linear API key', CLAUDE_CODE_OAUTH_TOKEN: 'Claude token (claude setup-token)' }
app.get('/shared-keys', (c) => c.json(SHARED_KEYS.map((k) => ({ name: k, label: KEY_LABEL[k], shared: sharedNow()[k]?.at, from: sharedNow()[k]?.from, here: !!localKeys[k] }))))
/** Who a key belongs to, or why it isn't accepted: checked before it is kept, since a wrong key would stop every machine at once. */
async function whoseKey(k: SharedKey, v: string): Promise<{ who?: string; error?: string }> {
  if (k === 'GITHUB_TOKEN') {
    const r = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${v}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
    if (!r?.ok) return { error: 'GitHub didn\'t accept that token' }
    const u = await r.json().catch(() => ({})) as { login?: string }
    return { who: u.login }
  }
  if (k === 'LINEAR_API_KEY') {
    const r = await fetch('https://api.linear.app/graphql', { method: 'POST', headers: { authorization: v, 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ viewer { name } organization { name } }' }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
    if (!r?.ok) return { error: 'Linear didn\'t accept that key' }
    const d = (await r.json().catch(() => ({})) as { data?: { viewer?: { name?: string }; organization?: { name?: string } } }).data
    return { who: [d?.viewer?.name, d?.organization?.name].filter(Boolean).join(', ') || undefined }
  }
  if (k === 'CLAUDE_CODE_OAUTH_TOKEN' && !/^sk-ant-oat/.test(v)) return { error: 'That isn\'t a claude setup-token token (it starts with sk-ant-oat)' }
  return {}
}
/** Keep (or, with null, drop) a key every machine uses. */
function keepKey(k: SharedKey, v: string | null) {
  const shared = { ...sharedNow() }
  if (v) shared[k] = { value: v, at: new Date().toISOString(), from: 'you' }; else delete shared[k]
  saveSecrets({ shared })
  sharedChanged(applyShared(true))
  if (k === 'CLAUDE_CODE_OAUTH_TOKEN') markLimited('claude', 0) // a limit the old token hit is its plan's, not this one's
  console.log(`shared keys: ${KEY_LABEL[k]} ${v ? 'set' : 'removed'}`)
}
app.post('/shared-keys', async (c) => {
  const { name, value } = await c.req.json() as { name?: string; value?: string | null }
  if (!SHARED_KEYS.includes(name as SharedKey)) return c.json({ error: 'Unknown key' }, 400)
  const k = name as SharedKey
  const v = typeof value === 'string' ? value.trim() : null
  if (v !== null && (v.length < 20 || v.length > 4000 || /\s/.test(v))) return c.json({ error: 'That doesn\'t look like a key' }, 400)
  const w = v ? await whoseKey(k, v) : {}
  if (w.error) return c.json({ error: w.error }, 400)
  keepKey(k, v)
  return c.json({ ok: true, who: w.who })
})
// GitHub without a token to paste: the GitHub CLI's device sign-in (githubLogin.ts); the token it gets is kept as GITHUB_TOKEN
app.post('/github/login', async (c) => {
  try {
    return c.json(await startGithubLogin(async (token) => { const w = await whoseKey('GITHUB_TOKEN', token); if (w.error) throw new Error(w.error); keepKey('GITHUB_TOKEN', token); return w.who }))
  } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
app.get('/github/login', (c) => c.json(githubLoginState() ?? null))
/** Shared keys changed (here, or on another machine through the sync): the parts that keep their own copy pick them up. */
function sharedChanged(changed: SharedKey[]) {
  if (!changed.length) return
  rereadSecrets()
  if (changed.includes('GITHUB_TOKEN')) { tokenChanged(); void checks(true); void gitIdentity() } // a new sign-in: the GitHub check reads it again
  if (changed.includes('LINEAR_API_KEY')) void pollTickets()
}
setInterval(() => sharedChanged(applyShared()), 30_000).unref()
void gitIdentity() // a token from an earlier sign-in: commits carry its account from the start
// a machine's recent log (scrubbed), this one's or another's through its worker
// the page's slow moments (src/slowUi.ts), into this machine's log, where its logs page shows them
app.post('/debug/ui', async (c) => {
  const { lines } = await c.req.json<{ lines?: unknown }>().catch(() => ({ lines: [] }))
  for (const l of (Array.isArray(lines) ? lines : []).slice(0, 20)) if (typeof l === 'string') console.warn(`slow ui: ${l.slice(0, 200)}`)
  return c.json({ ok: true })
})
// where this server's thread spends its time, for a few seconds (profile.ts): ?seconds=10
app.get('/debug/profile', async (c) => { try { return c.json(await profile(Number(c.req.query('seconds') ?? 10))) } catch (e) { return c.json({ error: (e as Error).message }, 409) } })
app.get('/machines/:name/logs', async (c) => {
  const name = c.req.param('name')
  if (name === (fleet.machine ?? 'this machine')) return c.json({ lines: recentLines().map(scrub) })
  const m = machines.get(name)
  if (!m) return c.json({ error: `${name} isn't connected` }, 404)
  try { return c.json(await call<{ lines: string[] }>(m.base, machineToken(), 'GET', '/logs')) } catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
// restart a machine's Concierge: a note its bin/standby acts on within ~10s (sent to that machine over the machines'
// link). The only thing it does; nothing a note can say runs anything else
app.post('/machines/:name/restart', async (c) => {
  const name = c.req.param('name')
  if (!/^[\w.-]{1,64}$/.test(name) || !fleet.machine) return c.json({ error: 'Unknown machine' }, 400)
  if (name === fleet.machine) await replicaExtras['ask-restart']({ by: fleet.machine })
  else {
    const peer = (await replicaPeers()).find((p) => p.name === name)
    if (!peer) return c.json({ error: `${name} doesn't answer` }, 502)
    try { await call(peer.base, machineToken(), 'POST', '/x/ask-restart', { by: fleet.machine }) } catch (e) { return c.json({ error: `${name}: ${(e as Error).message}` }, 502) }
  }
  console.log(`machines: asked ${name} to restart`)
  return c.json({ ok: true })
})
// the machines out of step for 5 minutes (the one followed doesn't answer, or files can't come over): an alert that
// clears itself once they are back in step
let outOfStep: number | undefined
if (fleet.machine) setInterval(() => {
  const r = replicaStatus()
  const late = r.following && (r.stateError || !r.caughtUp)
  outOfStep = late ? (outOfStep ?? Date.now()) : undefined
  const mins = outOfStep ? Math.round((Date.now() - outOfStep) / 60_000) : 0
  condition('replica', 'Machines in step', mins >= 5 ? `Not in step with ${r.following} for ${mins} minutes${r.stateError ? ` (${r.stateError})` : ''}: what happens there doesn't reach this machine` : undefined)
}, 60_000).unref()
// the lane of what you are typing, read by a small model when you pause (laneModel.ts): it confirms or corrects the
// rules the box applied at once
app.post('/lane', async (c) => {
  const { text, asked } = await c.req.json<{ text?: string; asked?: string }>()
  if (!text?.trim() || text.length > 4000) return c.json({ error: 'nothing to read' }, 400)
  try {
    const r = await laneByModel(text, asked)
    if (r.costUsd) addSpend(r.costUsd)
    return c.json({ lane: r.lane, sure: r.sure })
  } catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
// machines asking to join from another Tailscale login (join.ts): yours to approve or deny
app.get('/machines/joins', (c) => c.json({ joins: joinsWaiting() }))
app.post('/machines/joins/:id', async (c) => {
  const { approve } = await c.req.json<{ approve?: boolean }>()
  try { const j = joinDecide(c.req.param('id'), !!approve); return c.json({ ok: true, name: j.name, state: j.state }) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
// a new machine key: sent to every other machine with the old one first (they keep the old one 10 minutes), then used
app.post('/machines/rotate-key', async (c) => {
  const next = randomBytes(32).toString('hex'), old = machineToken()
  const sent = await Promise.all((await replicaPeers()).map((p) => call(p.base, old, 'POST', '/x/token', { token: next }).then(() => p.name, () => undefined)))
  rotateToken(next)
  console.log(`machines: rotated the machine key (${sent.filter(Boolean).join(', ') || 'no other machine answered'})`)
  return c.json({ ok: true })
})
app.post('/machines', async (c) => {
  const b = await c.req.json() as { workMachine?: string | null; workSlots?: number; rename?: { machine?: string; name?: string } }
  if (b.rename) {
    const id = String(b.rename.machine ?? ''), name = String(b.rename.name ?? '').trim()
    if (!/^[\w.-]{1,64}$/.test(id)) return c.json({ error: 'Unknown machine' }, 400)
    if (name.length > 40) return c.json({ error: 'A name is 40 characters at most' }, 400)
    const { [id]: _, ...rest } = config.machineNames ?? {}
    saveConfig({ machineNames: name && name !== id ? { ...rest, [id]: name } : rest }) // empty: back to its own name
    return c.json({ ok: true, names: config.machineNames })
  }
  if (b.workMachine !== undefined) {
    if (b.workMachine !== null && !/^[\w.-]{1,64}$/.test(b.workMachine)) return c.json({ error: 'Unknown machine' }, 400)
    if (b.workMachine === null) delete state.settings.workMachine; else state.settings.workMachine = b.workMachine
  }
  if (b.workSlots !== undefined) {
    if (!Number.isInteger(b.workSlots) || b.workSlots < 0 || b.workSlots > 8) return c.json({ error: 'agents on the work machine must be 0 to 8' }, 400)
    state.settings.workSlots = b.workSlots
  }
  save(); pump()
  return c.json({ ok: true })
})
// the tailnet as this machine's Tailscale sees it (Settings → Machines), read-only; no Tailscale here says so
app.get('/tailnet', async (c) => {
  const j = await tsStatus()
  if (!j) return c.json({ available: false })
  const dev = (p: TsPeer, self: boolean) => ({ name: p.HostName ?? p.DNSName?.split('.')[0] ?? '?', dns: p.DNSName?.replace(/\.$/, ''), os: p.OS, online: self || !!p.Online, tagged: !!p.Tags?.length, ip: p.TailscaleIPs?.[0], lastSeen: p.LastSeen, self })
  return c.json({ available: true, tailnet: j.CurrentTailnet?.Name, devices: [...(j.Self ? [dev(j.Self, true)] : []), ...Object.values(j.Peer ?? {}).map((p) => dev(p, false))] })
})
// onboarding with the fleet: is the link's Tailscale signed in, and if not, the address that signs it in
app.get('/tailscale', async (c) => c.json(await tailscaleView()))
// Tailscale says when the tailnet changes (pushed, not polled): the page's list of your other machines follows
watchTailnet((now, before) => {
  stale('/fleet/nearby')
  const came = now.filter((m) => m.online && !before.some((b) => b.name === m.name && b.online))
  if (came.length) console.log(`tailnet: ${came.map((m) => m.name).join(' and ')} came online`)
})
// the other Concierge machines on the tailnet (online or not), and whether this one is with them yet: a machine that
// isn't joins them by itself once one is online (the fleet's standby runs bin/join --wait, and says how it goes in
// join.json), never as the main one
const JOIN_NOTE = join(STATE_DIR, 'join.json')
app.get('/fleet/nearby', async (c) => {
  const near = await nearbyMachines()
  const mine = new Set([fleet.machine, ...machines.keys()].filter(Boolean))
  const joining = await readFile(JOIN_NOTE, 'utf8').then((t) => JSON.parse(t) as Record<string, unknown>, () => undefined)
  return c.json({ joined: !!fleet.machine, machine: fleet.machine, joining, machines: near.map((m) => ({ ...m, ours: mine.has(m.name) })) })
})
// the standby writing join.json: the page hears it then (a file event, not a timer)
try { fsWatch(STATE_DIR, (_e, f) => { if (f === 'join.json') stale('/fleet/nearby') }).unref() } catch { /* no events here: it shows on the next tailnet change */ }
// the run history, from the event log: the latest runs (each as it ended) and per-day totals (Settings → Usage)
// standup: since the start of the last working day by default (?since=ISO for another start)
const standupFacts = async (since: Date) =>
  standup({ since, runs: await runs(Math.ceil((Date.now() - since.getTime()) / 86400_000) + 1), prs: state.prs, tickets: ticketViews(), execs: state.execs })
const writtenKey = (day: string, teams: string[]) => `${day}|${[...teams].sort().join(',')}`
const writing = new Map<string, Promise<Written | undefined>>()
/** Word a day's standup with the model, from the facts as they are now (for these teams), and keep it with them. */
function writeStandup(day: string, since: Date, teams: string[]) {
  const k = writtenKey(day, teams)
  if (writing.has(k)) return writing.get(k)!
  const p = (async () => {
    const s = await standupFacts(since)
    const did = forTeams(s.did, teams), next = forTeams(s.next, teams), blockers = forTeams(s.blockers, teams), notes = state.standupNotes?.[day] ?? {}
    if (!did.length && !next.length && !blockers.length && !Object.values(notes).some((x) => x?.length)) return undefined
    const { result, cost, provider, tokens } = await callClaude<{ text: string }>(writeInput(did, next, blockers, notes), tmpdir(), undefined, () => {},
      { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, 0.3, await method('standup', 'Keep the ticket IDs exactly as given, so they can be linked. The text field holds the update.'), 'haiku')
    addSpend(cost, provider, tokens)
    const w: Written = { day, teams, since: since.toISOString(), key: factsKey(did, next, blockers, notes), text: result.text.trim(), at: new Date().toISOString(), costUsd: cost, tickets: new Set([...did, ...next].map((x) => x.id)).size }
    // the newest 30 stay: a month of mornings
    state.standups = Object.fromEntries([...Object.entries(state.standups ?? {}), [k, w] as const].sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(-30))
    save()
    return w
  })().finally(() => writing.delete(k))
  writing.set(k, p)
  return p
}
// the facts, live, and the written version for that day and those teams, saying whether the facts moved since
// --- the Desk's brief: a topic (a ticket and its PRs, a stack, a PR) in two or three sentences, written by a small model
// from the facts here, kept until those facts change (then written again on the next look)
const briefing = new Map<string, Promise<string | undefined>>()
function briefFacts(ticketId: string | undefined, prIds: string[]) {
  const t = ticketId ? ticketViews().find((x) => x.id === ticketId) : undefined
  const prs = views().filter((p) => prIds.includes(p.id))
  return {
    ticket: t && { id: t.id, title: t.title, state: t.state, project: t.project, about: t.description.slice(0, 900), lastComment: t.lastComment && `${t.lastComment.by}: ${t.lastComment.body.slice(0, 300)}` },
    prs: prs.map((p) => {
      const o = loadOverlay(state.prs[p.id])
      return { pr: `#${p.number}`, title: p.title, mine: !!p.mine, status: p.status, stands: p.flow.why, about: o?.business.headline, threadsWaitingOnYou: p.awaiting ?? p.unresolved ?? 0, review: p.reviewDecision ?? undefined, agentWorking: p.status === 'preparing' || p.status === 'posting' }
    }),
  }
}
app.post('/desk/brief', async (c) => {
  const { key, ticket, prs } = await c.req.json<{ key?: string; ticket?: string; prs?: string[] }>()
  if (!key || key.length > 300) return c.json({ error: 'key required' }, 400)
  const facts = briefFacts(ticket, (prs ?? []).slice(0, 12))
  if (!facts.ticket && !facts.prs.length) return c.json({ error: 'Nothing known about that topic' }, 404)
  const input = JSON.stringify(facts)
  const fp = createHash('sha1').update(input).digest('hex').slice(0, 12)
  const had = state.briefs?.[key]
  if (had && had.key === fp) return c.json({ text: had.text, at: had.at })
  // one write per topic at a time; an old brief shows meanwhile, marked as catching up
  if (!briefing.has(key)) briefing.set(key, (async () => {
    const { result, cost, provider, tokens } = await callClaude<{ text: string }>(input, tmpdir(), undefined, () => {},
      { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, 0.1, await method('brief', 'The text field holds the brief.'), 'haiku')
    addSpend(cost, provider, tokens)
    // the newest 100 stay
    state.briefs = Object.fromEntries([...Object.entries(state.briefs ?? {}), [key, { key: fp, text: result.text.trim(), at: new Date().toISOString() }] as const].sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(-100))
    save()
    return result.text.trim()
  })().catch((e) => { console.warn(`desk brief ${key}: ${(e as Error).message.split('\n')[0]}`); return undefined }).finally(() => briefing.delete(key)))
  const text = await briefing.get(key)
  return text ? c.json({ text, at: new Date().toISOString() }) : c.json({ text: had?.text, at: had?.at, stale: true, error: had ? undefined : 'Could not write the brief' }, had ? 200 : 502)
})
app.get('/standup', async (c) => {
  const q = c.req.query('since'), since = q && !isNaN(Date.parse(q)) ? new Date(q) : lastWorkday()
  const day = c.req.query('day') ?? '', teams = (c.req.query('teams') ?? '').split(',').filter(Boolean)
  const s = await standupFacts(since)
  const written = day ? state.standups?.[writtenKey(day, teams)] : undefined
  const notes = (day && state.standupNotes?.[day]) || {}
  const now = factsKey(forTeams(s.did, teams), forTeams(s.next, teams), forTeams(s.blockers, teams), notes)
  return c.json({ ...s, notes, written: written && { ...written, stale: written.key !== now || written.since !== since.toISOString() } })
})
// your own lines for a day's standup, per part (what only you know): kept with the day, said in the copy and the written one
app.post('/standup/notes', async (c) => {
  const b = await c.req.json<{ day?: string; part?: string; lines?: unknown }>()
  if (!b.day || !/^\d{4}-\d\d-\d\d$/.test(b.day) || !['did', 'blockers', 'next'].includes(b.part ?? '')) return c.json({ error: 'Which day, and which part?' }, 400)
  if (!Array.isArray(b.lines) || b.lines.length > 20 || b.lines.some((x) => typeof x !== 'string' || x.length > 300)) return c.json({ error: 'Up to 20 lines of 300 characters' }, 400)
  const lines = (b.lines as string[]).map((x) => x.trim()).filter(Boolean)
  const all = { ...state.standupNotes }
  all[b.day] = { ...all[b.day], [b.part!]: lines }
  // a month of mornings, like the written ones
  state.standupNotes = Object.fromEntries(Object.entries(all).sort(([a], [z]) => a.localeCompare(z)).slice(-30))
  save()
  return c.json({ ok: true, notes: state.standupNotes[b.day] })
})
app.post('/standup/write', async (c) => {
  const b = await c.req.json<{ day?: string; since?: string; teams?: string[] }>()
  if (!b.day || !/^\d{4}-\d\d-\d\d$/.test(b.day) || !b.since || isNaN(Date.parse(b.since))) return c.json({ error: 'Which day, and since when?' }, 400)
  if (overBudget()) return c.json({ error: "Today's budget is spent" }, 400)
  try {
    const w = await writeStandup(b.day, new Date(b.since), (b.teams ?? []).filter((t) => /^[A-Z]{2,5}$/.test(t)))
    return w ? c.json(w) : c.json({ error: 'Nothing to write about for that day' }, 400)
  } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0].slice(0, 200) }, 502) }
})
// at 07:00 on a weekday (your time zone, from the page), or as soon as the machine is up after, the morning's standup
// is written, for every team at once
let wroteMorning = ''
setInterval(() => {
  const tz = state.settings.timezone ?? process.env.TZ ?? 'UTC', now = new Date(), day = localDay(now, tz)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now))
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() % 6 !== 0
  // the machine was off at 07:00: it is written when it comes up. Only a write from this morning counts as done; one
  // from before (Saturday's for Monday, written by hand) is stale by then
  const had = state.standups?.[writtenKey(day, [])]
  const fresh = had && localDay(new Date(had.at), tz) === day && Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(had.at))) >= 7
  if (!weekday || hour < 7 || wroteMorning === day || fleet.elsewhere() || overBudget() || fresh) return
  wroteMorning = day
  // a failed write (no network yet after waking, the model down) is tried again next minute
  writeStandup(day, startOf(workdayBefore(day), tz), []).catch((e) => { wroteMorning = ''; console.error('standup at 07:00:', (e as Error).message) })
}, 60_000).unref()
// the standup's calendar: when work happened over the last 60 days (runs that ended, PRs you opened), for its dots.
// Times, not days: the page buckets them by its own day, which is yours, not the server's
app.get('/standup/days', async (c) => {
  const since = new Date(Date.now() - 60 * 86400_000).toISOString()
  const at = [...(await runs(60)).filter((r) => r.to === 'done' && (r.entity === 'job' || r.entity === 'exec')).map((r) => r.at),
    ...Object.values(state.prs).filter((p) => p.mine && p.createdAt >= since).map((p) => p.createdAt)]
  return c.json({ at })
})
// the Intent and Understanding discussions beside a PR or ticket (discussions.ts). target: "pr:<id>" or "ticket:<id>"
// what the Explain view shows of a PR, compact, for the Understanding discussion
async function explainedOf(id: string) {
  const res = await Promise.resolve(app.request(`/api/prs/${encodeURIComponent(id)}/explain`)).catch(() => undefined)
  const r = res?.ok ? await res.json().catch(() => undefined) as { overlay?: unknown; stale?: boolean } | undefined : undefined
  return r?.overlay ? `${r.stale ? '(for an older push) ' : ''}${JSON.stringify(r.overlay).slice(0, 8000)}` : '(not explained yet)'
}
async function lastWord(key: string) {
  const said = (await loadActivity(key)).filter((a) => a.kind === 'result' || a.kind === 'text').map((a) => a.text)
  return said.slice(-3).join('\n\n').slice(-3000) || '(nothing yet)'
}
// a stack's discussion: target "stack:<repo>#<the bottom PR's number>", the same from any PR of it
const stackOfTarget = (target: string) => {
  const m = /^stack:(.+)#(\d+)$/.exec(target)
  return m ? Object.values(state.prs).find((p) => p.repo === m[1] && p.stack?.[0].number === Number(m[2]))?.stack : undefined
}
/** The PRs a discussion covers when it covers several: a stack's, or the ones a ticket ships as. */
const workMembers = (target: string) => { const w = state.works?.[target.slice(5)]; return w ? Object.entries(state.workOf ?? {}).filter(([, id]) => id === w.id).map(([k]) => k) : [] }
function discussionPrs(target: string): { repo: string; number: number }[] | undefined {
  if (target.startsWith('work:')) { const prs = workMembers(target).filter((k) => k.startsWith('pr:')).map((k) => state.prs[k.slice(3)]).filter((p): p is Pr => !!p); return prs.length > 1 ? prs.map((p) => ({ repo: p.repo, number: p.number })) : undefined }
  if (target.startsWith('stack:')) return stackOfTarget(target)?.map((x) => ({ repo: x.repo, number: x.number }))
  if (target.startsWith('ticket:')) { const t = ticketViews().find((x) => x.id === target.slice(7)); return t && t.prs.length > 1 ? t.prs.map((x) => ({ repo: x.repo, number: x.number })) : undefined }
  return undefined
}
/** The version of the work a card was written for: a PR's head and its feedback (every PR's, for a stack), a ticket's last run. */
function versionOf(target: string): string | undefined {
  if (target.startsWith('work:')) return workMembers(target).sort().map((k) => versionOf(k)).join()
  if (target.startsWith('stack:')) return stackOfTarget(target)?.map((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return `${p?.headSha ?? ''}:${p?.feedbackAt ?? ''}` }).join()
  if (target.startsWith('pr:')) { const p = state.prs[target.slice(3)]; return p && `${p.headSha}:${p.feedbackAt ?? ''}` }
  const run = ticketViews().find((x) => x.id === target.slice(7))?.run
  return `${run?.id ?? ''}:${run?.endedAt ?? ''}`
}
async function discussionContext(target: string, topic: Topic): Promise<{ context: string; cwd?: string; version: string }> {
  // a Work: each of its parts as it would be on its own, cut so the whole stays small
  if (target.startsWith('work:')) {
    const keys = workMembers(target).sort()
    if (!keys.length) throw new Error('That piece of work is gone')
    const parts = await Promise.all(keys.map((k) => discussionContext(k, topic).catch(() => undefined)))
    const each = Math.floor(24_000 / keys.length)
    return {
      version: versionOf(target) ?? '',
      cwd: parts.find((x) => x?.cwd)?.cwd,
      context: `One piece of work in ${keys.length} parts (tickets and pull requests linked together, sharing one memory):\n\n`
        + parts.map((x, i) => `### ${keys[i]}\n${x ? x.context.slice(0, each) : '(could not be read)'}`).join('\n\n'),
    }
  }
  if (target.startsWith('stack:')) {
    const stack = stackOfTarget(target)
    if (!stack) throw new Error('That stack is no longer open')
    const each = stack.map((x, i) => {
      const p = state.prs[`${x.repo}#${x.number}`]
      return `${i + 1}. #${x.number} "${x.title}" by ${x.author}: ${x.head} into ${x.base}${p ? `, ${p.changedFiles} files, +${p.additions} −${p.deletions}` : ''}. Its diff: git diff origin/${x.base}...origin/${x.head}`
        + `\n   Its description: ${(p?.body ?? '').slice(0, 1500).replace(/\n+/g, ' ') || '(none)'}`
    }).join('\n')
    const tickets = [...new Map(stack.flatMap((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return p ? ticketsOf(p) : [] }).map((t) => [t.id, t])).values()]
      .map((t) => `- ${t.id} ${t.title}\n${t.description.slice(0, 1200)}`).join('\n') || '(none)'
    return {
      version: stack.map((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return `${p?.headSha ?? ''}:${p?.feedbackAt ?? ''}` }).join(),
      cwd: config.repos[stack[0].repo],
      context: `The work: a stack of ${stack.length} pull requests in ${stack[0].repo}, bottom first (each builds on the one before):\n${each}`
        + '\n(git fetch origin first if a branch is missing.)'
        + `\n\nThe tickets they name:\n${tickets}`,
    }
  }
  if (target.startsWith('pr:')) {
    const p = state.prs[target.slice(3)]
    if (!p) throw new Error('No such PR')
    const tickets = ticketsOf(p).map((t) => `- ${t.id} ${t.title}\n${t.description.slice(0, 1500)}`).join('\n') || '(none)'
    // the change itself, cut: the card is written without tools, so what it says about the code comes from here
    const dir = config.repos[p.repo]
    const diff = topic === 'understanding' && dir ? await git(dir, 'diff', '-U1', '--no-color', `origin/${p.base}...origin/${p.head}`, '--', '.', ':!*lock*', ':!*.snap').then((t) => t.slice(0, 9000), () => '') : ''
    return {
      version: `${p.headSha}:${p.feedbackAt ?? ''}`,
      cwd: config.repos[p.repo],
      context: `The work: pull request ${p.repo}#${p.number} "${p.title}" by ${p.author.login}${p.mine ? ' (the developer\'s own, revised by an agent)' : ' (the developer reviews it, helped by an agent)'}: ${p.head} into ${p.base}, ${p.changedFiles} files, +${p.additions} −${p.deletions}.`
        + `\nIts diff: git diff origin/${p.base}...origin/${p.head} (git fetch origin first if a branch is missing).`
        + `\n\nThe PR's description:\n${(p.body ?? '').slice(0, 4000) || '(none)'}\n\nThe tickets it names:\n${tickets}\n\nWhat the main agent said last:\n${await lastWord(p.id)}`
        + (topic === 'understanding' ? `\n\nIts explanation (what the Explain view shows: the tour, the business and technical views):\n${await explainedOf(p.id)}` : '')
        + (diff ? `\n\nThe diff (cut at 9000 characters):\n${diff}` : ''),
    }
  }
  const id = target.slice(7)
  const t = ticketViews().find((x) => x.id === id)
  if (!t) throw new Error('No such ticket')
  const run = t.run
  return {
    version: `${run?.id ?? ''}:${run?.endedAt ?? ''}`,
    cwd: t.repo ? config.repos[t.repo] : undefined,
    context: `The work: the Linear ticket ${t.id} "${t.title}"${t.labels.length ? ` (${t.labels.join(', ')})` : ''}, shipped by a coding agent.`
      + `\n\nThe ticket:\n${t.description.slice(0, 5000) || '(no description)'}`
      + (run?.plan ? `\n\nThe agent's plan: skills ${run.plan.skills.map((x) => x.name).join(', ') || 'none'}; steps: ${run.plan.steps.join('; ')}` : '')
      + (t.prs.length ? `\n\nIts PRs: ${t.prs.map((x) => `#${x.number} ${x.url}`).join(', ')}` : '')
      + `\n\nWhat the main agent said last:\n${run ? await lastWord(`exec:${run.id}`) : '(no run yet)'}`,
  }
}
// each card says whether the work moved on since it was written (it is written again when next asked)
app.get('/discussions', (c) => {
  const target = String(c.req.query('target')), v = versionOf(target), d = discussionsOf(target)
  return c.json(Object.fromEntries(Object.entries(d).map(([k, x]) => [k, { ...x, stale: !!x.brief && !!v && x.brief.version !== v }])))
})
app.post('/discussions/say', async (c) => {
  const { target, topic, text } = await c.req.json<{ target: string; topic: Topic; text: string }>()
  if (!text?.trim() || !['intent', 'understanding'].includes(topic)) return c.json({ error: 'Nothing to say' }, 400)
  try {
    const { context, cwd } = await discussionContext(target, topic)
    say(target, topic, text.trim(), context, cwd, settled(discussionsOf(target)[topic === 'intent' ? 'understanding' : 'intent']), discussionPrs(target))
    return c.json(discussionsOf(target))
  } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
// the other parts' conversations, for one shared chat: each entry says which part it is from
app.get('/works/feed', async (c) => {
  const here = String(c.req.query('member') ?? '')
  const { members } = workOfMember(here)
  const feeds = await Promise.all(members.filter((m) => m.key !== here).map(async (m) =>
    (m.kind === 'pr' ? await loadActivity(m.key.slice(3)) : await ticketActivity(m.key.slice(7))).slice(-600).map((a) => ({ ...a, part: m.label }))))
  return c.json(feeds.flat().sort((a, b) => a.at.localeCompare(b.at)).slice(-1500))
})
// what @ in the box can name: the tickets on your board and the PRs being tracked
app.get('/works/candidates', (c) => c.json([
  ...execBoard.tickets.map((t) => ({ key: `ticket:${t.id}`, kind: 'ticket', label: t.id, title: t.title })),
  ...Object.values(state.prs).filter((p) => !p.closed).map((p) => ({ key: `pr:${p.id}`, kind: 'pr', label: `#${p.number}`, repo: p.repo, title: p.title })),
]))
// a link you made, undone: the part that comes apart takes a copy of the memory with it
app.post('/works/unlink', async (c) => {
  const { a, b } = await c.req.json<{ a: string; b: string }>()
  const { w } = workOfMember(a)
  const had = w.links.length
  w.links = w.links.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)))
  if (w.links.length === had) return c.json({ error: 'Linked by name or by its stack, not by you: rename the PR, or move it out of the stack, to separate them' }, 400)
  const keep = new Set(component(a, workEdges)), apart = component(b, workEdges)
  if (!keep.has(b)) { const id = randomUUID().slice(0, 8); state.works![id] = { id, at: new Date().toISOString(), said: [...w.said], links: [] }; for (const k of apart) state.workOf![k] = id }
  save(); stale('/works')
  return c.json({ ok: true })
})
// a member's Work: its id, the target its cards live under, and its parts
app.get('/works', (c) => {
  const key = String(c.req.query('member') ?? '')
  if (!/^(pr|ticket):/.test(key)) return c.json({ error: 'member is pr:… or ticket:…' }, 400)
  const { w, members } = workOfMember(key)
  save()
  return c.json({ id: w.id, target: `work:${w.id}`, members, links: w.links, said: w.said.slice(-20) })
})
// a card asked (or, with no words, written): answered from the card, which is written again first when the work moved on
app.post('/discussions/ask', async (c) => {
  const { target, topic, text } = await c.req.json<{ target: string; topic: Topic; text?: string }>()
  if (!['intent', 'understanding'].includes(topic)) return c.json({ error: 'No such card' }, 400)
  try {
    const { context, cwd, version } = await discussionContext(target, topic)
    askCard(target, topic, (text ?? '').trim().slice(0, 4000), { context, cwd, version, shared: settled(discussionsOf(target)[topic === 'intent' ? 'understanding' : 'intent']), prs: discussionPrs(target) })
    return c.json(discussionsOf(target))
  } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
app.post('/discussions/sent', async (c) => { const { target, topic, number } = await c.req.json<{ target: string; topic: Topic; number?: number }>(); markSent(target, topic, number); return c.json(discussionsOf(target)) })
app.post('/discussions/reset', async (c) => { const { target, topic } = await c.req.json<{ target: string; topic: Topic }>(); reset(target, topic); return c.json(discussionsOf(target)) })

// the skills: how they are used and how well they work (skills.ts); proposals, written on demand by the small model
app.get('/skills/view', async (c) => c.json(await skillsView(Math.min(90, Number(c.req.query('days')) || 30))))
// proposals take a minute or two: written in the background and kept (state.skillAdvice), so leaving the page loses
// nothing; the page asks how it stands
const advising = new Map<string, string | undefined>() // what is being written: 'improve:<skill>' or 'suggest', and its error once failed
const advice = () => (state.skillAdvice ??= { improve: {} })
app.get('/skills/advice', (c) => {
  const name = c.req.query('name')
  const k = name ? `improve:${name}` : 'suggest'
  return c.json({ result: name ? advice().improve[name] : advice().suggest, busy: advising.has(k) && advising.get(k) === undefined, error: advising.get(k) })
})
app.post('/skills/improve', async (c) => {
  const { name, days } = await c.req.json<{ name: string; days?: number }>()
  try { mustChange(String(name)) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  const k = `improve:${name}`
  if (advising.has(k) && advising.get(k) === undefined) return c.json({ busy: true })
  advising.set(k, undefined)
  improveSkill(String(name), Math.min(90, Number(days) || 30))
    .then((r) => { advice().improve[String(name)] = r; save(); advising.delete(k) }, (e: Error) => advising.set(k, e.message))
  return c.json({ busy: true })
})
app.post('/skills/remove', async (c) => {
  const { name } = await c.req.json<{ name: string }>()
  try { mustChange(String(name)); return c.json({ said: await removeSkill(String(name)) }) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
app.post('/skills/suggest', async (c) => {
  const { days } = await c.req.json<{ days?: number }>().catch(() => ({ days: 30 }))
  if (advising.has('suggest') && advising.get('suggest') === undefined) return c.json({ busy: true })
  advising.set('suggest', undefined)
  const d = Math.min(90, Number(days) || 30)
  suggestSkills(d).then((r) => { advice().suggest = { ...r, at: new Date().toISOString(), days: d }; save(); advising.delete('suggest') }, (e: Error) => advising.set('suggest', e.message))
  return c.json({ busy: true })
})
app.get('/runs', async (c) => {
  const days = Math.min(90, Number(c.req.query('days')) || 7)
  let list = await runs(days)
  if (scopeOf(c) === 'self') { // this machine's runs: where it ran (the run's state says), else its repository is here
    const away = awayHere()
    const where = (r: (typeof list)[number]): { machine?: string; repo?: string } =>
      r.entity === 'exec' ? { machine: state.execs[r.run]?.machine, repo: state.execs[r.run]?.repo }
      : r.entity === 'base' ? { repo: r.id } : { machine: state.prs[r.id]?.job?.machine, repo: repoOfPr(r.id) }
    list = list.filter((r) => { const w = where(r); return w.machine ? w.machine === fleet.machine : !w.repo || !away.has(w.repo) })
  }
  return c.json({ runs: list.slice(0, 200), totals: await totals(days) })
})
app.get('/update', async (c) => {
  // asked and not yet handled by this machine (bin/update notes the ask each machine handled; the folder syncs)
  const read = (f: string) => readFile(join(STATE_DIR, f), 'utf8').then((t) => t.trim(), () => '')
  const [asked, deployed, log] = await Promise.all([
    Promise.all([read('update-asked'), read(`update-handled${fleet.machine ? `.${fleet.machine}` : ''}`)]).then(([a, h]) => !!a && a !== h),
    readFile(join(STATE_DIR, `deployed${fleet.machine ? `.${fleet.machine}` : ''}`), 'utf8').then((t) => t.trim().slice(0, 7), () => undefined),
    readUpdateLog().then((t) => t.trim().split('\n').slice(-3), () => [] as string[]),
  ])
  // where the update stands now, from bin/update's own lines and files (updateStatus.ts)
  const me = fleet.machine ? `.${fleet.machine}` : ''
  const [ask, full, lock, drain] = await Promise.all([read('update-asked'), readUpdateLog().catch(() => ''),
    stat(join(STATE_DIR, 'update.lock.d')).catch(() => undefined), read(`draining${me}`)])
  const askedAt = asked ? (/^now (\d+)/.exec(ask) ? Number(/^now (\d+)/.exec(ask)![1]) * 1000 : Date.parse(ask.replace(/^upstream /, ''))) || Date.now() : undefined
  const status = updateStatus(full.split('\n').slice(-60), {
    askedAt, locked: !!lock && Date.now() - lock.mtimeMs < 3 * 3600_000, drainingSince: Number(drain) * 1000 || undefined,
    running: process.env.DECK_VERSION, agents: children.size,
  })
  const latest = latestHeads().app
  // a fork: what the original repo has that it lacks, and bin/update's last word on merging it
  const up = await readUpstream()
  const note = up && full.split('\n').reverse().find((l) => /upstream/.test(l))
  // standby: the fleet's standby does the update on this machine (it may run Docker; the app, which runs agents, may not).
  // Without one, you run bin/update yourself (or a cron line of yours does)
  return c.json({ asked, deployed, log, version: process.env.DECK_VERSION, status, standby: !!process.env.DECK_ROLE, latest: latest && { sha: latest.sha.slice(0, 7), at: latest.at },
    upstream: up && { ...up, note: note?.replace(/^.*?\d{4}: /, '') } }) // the build this server runs (bin/update)
})
/** A fork's distance from the original repo, as bin/update last fetched it ("<count> <at> <url>", then "<sha> <subject>" lines). */
async function readUpstream() {
  const t = await readFile(join(STATE_DIR, `upstream${fleet.machine ? `.${fleet.machine}` : ''}`), 'utf8').catch(() => '')
  const [head, ...lines] = t.trim().split('\n')
  const [n, at, url] = (head ?? '').split(' ')
  if (!url) return undefined
  return { behind: Number(n) || 0, at, url: url.replace(/\.git$/, ''), commits: lines.filter(Boolean).map((l) => ({ sha: l.slice(0, l.indexOf(' ')), subject: l.slice(l.indexOf(' ') + 1) })) }
}
// a fork behind the original repo: said now and then (every 3 days at most, or sooner once it is 10 commits further)
async function remindUpstream() {
  const up = await readUpstream()
  if (!up?.behind) return
  const last = state.upstreamTold
  if (last && Date.now() - Date.parse(last.at) < 3 * 86400_000 && up.behind < last.behind + 10) return
  state.upstreamTold = { at: new Date().toISOString(), behind: up.behind }
  alert({ kind: 'system', id: 'upstream', label: 'Concierge updates', title: 'Concierge updates' },
    `The original Concierge has ${up.behind} new commit${up.behind === 1 ? '' : 's'} your fork lacks: Settings → Machines → Updates merges them`)
}
setTimeout(() => void remindUpstream(), 60_000).unref(); setInterval(() => void remindUpstream(), 3600_000).unref()
// "now": restart even with agents working (they continue after, losing what ran in their background)
// this machine's update log (bin/update writes update.<machine>.log), else the shared one of an older install
const readUpdateLog = () => readFile(join(STATE_DIR, `update${fleet.machine ? `.${fleet.machine}` : ''}.log`), 'utf8').catch(() => readFile(join(STATE_DIR, 'update.log'), 'utf8'))
app.post('/update', async (c) => {
  const { now, upstream } = await c.req.json<{ now?: boolean; upstream?: boolean }>().catch(() => ({ now: false, upstream: false }))
  // one at a time: while one is under way a second ask only restarts it, so it is refused, except "now" (it's a skip)
  const lock = await stat(join(STATE_DIR, 'update.lock.d')).catch(() => undefined)
  if (!now && lock && Date.now() - lock.mtimeMs < 3 * 3600_000) return c.json({ error: 'An update is already under way: Settings → Machines shows where it stands' }, 409)
  await writeFile(join(STATE_DIR, 'update-asked'), now ? `now ${Math.floor(Date.now() / 1000)}` : `${upstream ? 'upstream ' : ''}${new Date().toISOString()}`)
  return c.json({ ok: true })
})

// --- exec mode: your Linear tickets, shipped by the configured exec command ---------------------
type PrHealth = Awaited<ReturnType<typeof prHealth>>
const execBoard: { tickets: Ticket[]; health: Record<string, PrHealth>; at?: string; error?: string; polling: boolean } = { tickets: [], health: {}, polling: false }

type TicketPr = Ticket['prs'][number] & Partial<PrHealth>
export type TicketView = Omit<Ticket, 'prs'> & { queued?: Queued; waitsOn?: string; background: number; prs: TicketPr[]; closedPrs: TicketPr[]; bucket: Bucket; repo?: string; pr?: TicketPr; run?: ExecRun; busy: boolean; env: Env & { asking?: boolean }; linked: Linked[]; stack?: TicketStack; pinned?: boolean; dimmed?: boolean }
// which environment a ticket is about: cached from Sentry, else plain words in the ticket, else unknown
const envAsked = new Set<string>()
function envOf(t: Ticket): Env & { asking?: boolean } {
  if (state.envs[t.id]) return state.envs[t.id]
  const text = `${t.title}\n${t.description}`
  // a Sentry link is read when the ticket is opened; until then the ticket's own words are the guess
  const guess = textEnv(text)
  if (sentryRef(text)) return { ...(guess ?? { env: 'unknown', source: 'none', detail: envAsked.has(t.id) ? 'asking Sentry…' : 'Sentry not read yet' }), asking: envAsked.has(t.id) }
  return guess ?? { env: 'unknown', source: 'none', detail: 'no Sentry link, and the ticket does not say' }
}
/** Read the ticket's environment from Sentry once (about a cent); later calls use the cache. */
function askEnv(t: Ticket) {
  const ref = sentryRef(`${t.title}\n${t.description}`)
  if (!ref || state.envs[t.id] || envAsked.has(t.id)) return
  envAsked.add(t.id)
  bus.emit('exec')
  sentryEnv(ref.org, ref.issue).then(({ env, costUsd }) => {
    addSpend(costUsd)
    if (env.env !== 'unknown') state.envs[t.id] = { ...env, at: new Date().toISOString() }
    else envAsked.delete(t.id)
    save(); bus.emit('exec'); bus.emit('health')
  }, (e: Error) => { console.error(`sentry env for ${t.id}:`, e.message); envAsked.delete(t.id); bus.emit('exec') })
}

// the PRs linked on Linear plus the ones its latest run opened, in repos you track (a run's text can name example URLs)
// each ticket's latest run, from one pass over the runs, kept until one changes state (prsOf asked a pass per ticket)
let latestRuns: { epoch: number; at: number; by: Map<string, ExecRun> } | undefined
function latestRun(id: string) {
  if (!latestRuns || latestRuns.epoch !== stateEpoch || Date.now() - latestRuns.at > 2000) {
    const by = new Map<string, ExecRun>()
    for (const r of Object.values(state.execs)) for (const t of r.ids) if (!by.has(t) || r.queuedAt > by.get(t)!.queuedAt) by.set(t, r)
    latestRuns = { epoch: stateEpoch, at: Date.now(), by }
  }
  return latestRuns.by.get(id)
}
const prsOf = (t: Ticket, run = latestRun(t.id)) =>
  ([...t.prs, ...(run?.prs ?? []).filter((p) => p.repo in config.repos)].filter((p, i, a) => a.findIndex((q) => q.url === p.url) === i) as Ticket['prs'])
    .map((p) => ({ ...p, title: p.title ?? t.prs.find((q) => q.url === p.url)?.title }))
// built once for the PR list and the board together (both read it on every change), kept half a second
let ticketCache: { at: number; v: TicketView[] } | undefined
function ticketViews(): TicketView[] {
  if (ticketCache && Date.now() - ticketCache.at < 500) return ticketCache.v
  ticketCache = { at: Date.now(), v: buildTicketViews() }
  return ticketCache.v
}
function buildTicketViews(): TicketView[] {
  const runs = Object.values(state.execs).sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
  const views: TicketView[] = execBoard.tickets.map((t) => {
    const run = latestRun(t.id) // the index, not a search of every run per ticket (profiled)
    // every PR the ticket has, bottom of the stack first, each with its own CI and threads
    const all = stackOrder(prsOf(t, run).map((p) => ({ ...p, ...execBoard.health[`${p.repo}#${p.number}`] })))
    const prs = all.filter((p) => !p.merged && p.state !== 'CLOSED')
    const pr = prs.find((p) => p.actionable) ?? prs.at(-1) ?? all.at(-1)
    // out of a run that still works on the others: its outcome is in, so it is yours (parked) or shipped, not "running"
    // ready in a stack that isn't submitted yet: the tickets it waits on (the stack submits once they're ready too)
    const b = run?.batch && !run.role ? state.batches[run.batch] : undefined, inStack = b?.stacks.find((s) => s.includes(t.id))
    const g = b && inStack && inStack.length > 1 && !b.submitted[inStack[0]] ? gate(inStack, runs, b.id) : undefined
    const waitsOn = g && 'waiting' in g && g.ready.includes(t.id) ? g.waiting.join(', ') : undefined
    const settled = settledIn(run, t.id), bucket = handedBack(ticketBusy(t.id) ? undefined : run, bucketOf(t, pr && { actionable: prs.some((p) => p.actionable) }))
    return {
      // the open ones (all of them when none is open); closed and merged ones apart, so they show but don't count
      ...t, ...(waitsOn && !ticketBusy(t.id) && { waitsOn }), ...(run?.state === 'queued' && { queued: queuedWhy(run, 'exec', undefined, run.repo) }), background: run ? openTasks(`exec:${run.id}`) : 0, prs: prs.length ? prs : all, closedPrs: prs.length ? all.filter((p) => !prs.includes(p)) : [], env: envOf(t), repo: repoFor(t.id, config.exec.repoByPrefix), run, busy: ticketBusy(t.id) && !settled,
      bucket: settled === 'parked' && bucket !== 'closed' && bucket !== 'handed' ? 'needs-you' as const : bucket, pr, linked: linksOfTicket(t, `${run?.summary ?? ''}\n${t.lastComment?.body ?? ''}`),
    }
  })
  // the tickets that ship together (their PRs stacked on GitHub, or one run's), for the list to keep as one
  const stacks = ticketStacks(views, (k) => state.prs[k]?.stack)
  // dimmed for now: until its state moves on (another bucket), then it's back to normal by itself
  return views.map((v) => ({ ...v, stack: stacks.get(v.id), pinned: `ticket:${v.id}` in pins(), dimmed: state.dimmed?.[v.id] === v.bucket }))
}
const cap = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)
/**
 * A ticket as the board sends it: the run without what only the server reads (its prompt, plan, brief, handovers), and
 * a done one without its long text. Measured: 2 MB a send before, most of it closed tickets' descriptions and runs'
 * prompts, sent again on every change.
 */
function slimTicket(t: TicketView): TicketView {
  const r = t.run && (({ prompt: _p, plan: _l, brief: _b, handovers: _h, ...x }) => ({ ...x, ...(x.summary && { summary: cap(x.summary, 1500) }) }))(t.run as typeof t.run & { plan?: unknown; brief?: unknown; handovers?: unknown })
  const done = t.bucket === 'closed'
  return { ...t, ...(r && { run: r as typeof t.run }), ...(done && { description: cap(t.description, 400), ...(t.lastComment && { lastComment: { ...t.lastComment, body: cap(t.lastComment.body, 300) } }) }) }
}
// The board, like the PR list (prsHub): worked out once for every open page, which gets the whole board when it
// connects and then only the tickets that changed, the ones that went, the order, and the rest when it changed.
// A burst of changes (each line of a run says 'exec') is one rebuild, at most one a second.
const execHub = (() => {
  let byId = new Map<string, string>(), order = '', meta = '', full: ExecView | undefined
  const pages = new Set<(data: string) => void>()
  let soon: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    soon = undefined
    const t = performance.now()
    const v = execView(), { tickets, ...rest } = v
    const next = new Map(tickets.map((x) => [x.id, JSON.stringify(x)]))
    const set = tickets.filter((x) => byId.get(x.id) !== next.get(x.id))
    const del = [...byId.keys()].filter((id) => !next.has(id))
    const nextOrder = tickets.map((x) => x.id).join('\n'), nextMeta = JSON.stringify(rest)
    slow('execView (live update)', t)
    full = v
    if (!set.length && !del.length && nextOrder === order && nextMeta === meta) return
    const patch = JSON.stringify({ set, del, order: tickets.map((x) => x.id), ...(nextMeta !== meta && { meta: rest }) })
    byId = next; order = nextOrder; meta = nextMeta
    for (const send of pages) send(patch)
  }
  bus.on('exec', () => { soon ??= setTimeout(refresh, 1000) })
  setInterval(() => { if (pages.size) refresh() }, 5000).unref()
  return {
    join(send: (data: string) => void) { if (!pages.size || !full) refresh(); pages.add(send); return full! },
    leave(send: (data: string) => void) { pages.delete(send) },
  }
})()
const execView = () => ({
  actions: config.exec.actions.map(({ id, label, hint, icon, confirm, env, prompt }) => ({ id, label, hint, icon, confirm, env, missing: missingFor(prompt) })),
  missing: missingFor(slot('exec')), // skills the exec command needs that this machine lacks
  tickets: ticketViews().map(slimTicket), at: execBoard.at, error: execBoard.error, polling: execBoard.polling,
  configured: (!!config.exec.command && Object.keys(config.exec.repoByPrefix).length > 0) || execBoard.tickets.some((t) => t.source === 'github'), hasKey: hasKey(),
})
export type ExecView = ReturnType<typeof execView>

const TICKET_ID = /\b[A-Z]{2,5}-\d+\b/g
const REREAD = 10 * 60_000
const notFound = new Set<string>() // ids Linear doesn't have: not asked again until a restart
/**
 * The tickets named here that aren't on your Linear list any more: one you handed over (still yours to drive, never
 * picked) or one closed (only its name and page, for the standup and the runs that name it). Named by a run, a written
 * standup or one of your PRs' titles; once nothing names one, it is dropped. Each re-read at most every 10 minutes.
 */
async function offList(mine: Ticket[]): Promise<Ticket[]> {
  const on = new Set(mine.map((t) => t.id))
  const named = new Set([
    ...Object.values(state.execs).flatMap((r) => r.ids),
    ...Object.values(state.standups ?? {}).flatMap((w) => w.text.match(TICKET_ID) ?? []),
    ...Object.values(state.prs).filter((p) => p.mine).flatMap((p) => p.title.match(TICKET_ID) ?? []),
  ].filter((id) => !on.has(id) && !issueOf(id) && repoFor(id, config.exec.repoByPrefix)))
  const refs = state.ticketRefs ??= {}
  for (const id of Object.keys(refs)) if (!named.has(id)) delete refs[id]
  // ponytail: 50 a poll keeps one query small; a backlog of more fills in over a few polls
  const due = [...named].filter((id) => !notFound.has(id) && (!refs[id] || Date.now() - Date.parse(refs[id].readAt) > REREAD)).slice(0, 50)
  if (due.length) {
    const readAt = new Date().toISOString()
    // one id Linear doesn't have (deleted, another workspace's) fails the whole query: then one at a time, and that one is skipped
    const got = await ticketsById(due).catch(async () => (await Promise.all(due.map((id) => ticketsById([id]).catch((e) => {
      if (/not found/i.test((e as Error).message)) notFound.add(id); else console.error('tickets by id:', (e as Error).message)
      return []
    })))).flat())
    for (const t of got) if (!on.has(t.id)) refs[t.id] = { ...t, readAt }
  }
  return Object.values(refs).filter((t) => !on.has(t.id)).map(({ readAt: _, ...t }) => t)
}

const healthAt = new Map<string, number>()
async function pollTickets() {
  if (fleet.elsewhere()) return // a worker: the control plane polls
  if (execBoard.polling) return
  execBoard.polling = true
  bus.emit('exec')
  try {
    const linear = hasKey() && config.exec.command ? await myTickets() : []
    // and your GitHub issues in the repos you watch: for work not tracked in Linear
    const taken = new Set([...Object.keys(config.exec.repoByPrefix), ...linear.map((t) => t.id.split('-')[0])])
    const prs = Object.values(state.prs).map((p) => ({ repo: p.repo, number: p.number, url: p.url, title: p.title, body: p.body, head: p.head }))
    const login = (await getMe().catch(() => undefined))?.login?.toLowerCase()
    const own = Object.keys(config.repos).filter((r) => !!login && r.split('/')[0].toLowerCase() === login) // your own repositories: their unassigned issues are yours
    const issues = await myIssues(Object.keys(config.repos), (k) => taken.has(k), prs, (q) => gh(`/search/issues?q=${encodeURIComponent(q)}&per_page=100`), own)
      .catch((e: Error) => { console.error('github issues:', e.message); return execBoard.tickets.filter((t) => t.source === 'github') })
    const tickets = [...linear, ...issues]
    // PR health for tickets in review: red CI or open threads mean "tend"
    await Promise.all(tickets.filter((t) => t.state.toLowerCase().includes('review') && prsOf(t).length).map(async (t) => {
      // every linked PR (a ticket can ship as a stack), up to 12
      await Promise.all(prsOf(t).slice(-12).map(async (pr) => {
        // CI and threads move slowly: re-read each PR at most every 5 minutes (GitHub's budget is shared with your gh)
        const key = `${pr.repo}#${pr.number}`
        if (Date.now() - (healthAt.get(key) ?? 0) < 5 * 60_000) return
        // a failed read (rate limit, network) is retried on the next poll, not 5 minutes later
        const h = await prHealth(pr.repo, pr.number).catch(() => undefined)
        if (h) { execBoard.health[key] = h; healthAt.set(key, Date.now()) }
      }))
    }))
    execBoard.tickets = [...tickets, ...(hasKey() ? await offList(linear) : [])]
    execBoard.error = undefined
    save()
  } catch (e) {
    execBoard.error = (e as Error).message
  }
  execBoard.at = new Date().toISOString()
  execBoard.polling = false
  bus.emit('exec')
}


app.get('/exec', (c) => { const v = execView(), away = scopeOf(c) === 'self' ? awayHere() : undefined; return c.json(away ? { ...v, tickets: v.tickets.filter((t) => !t.repo || !away.has(t.repo)) } : v) })
// steer a running exec run without stopping it: it reads your words between steps, or right after it ends
app.post('/exec/:run/steer', async (c) => {
  const { text } = await c.req.json<{ text?: string }>()
  const words = typeof text === 'string' ? text.trim().slice(0, 4000) : ''
  if (!words) return c.json({ error: 'Write what it should do first' }, 400)
  const run = state.execs[c.req.param('run')]
  const sent = run ? tell(`exec:${run.id}`, words, continueExec(run)) : 'idle'
  return sent === 'idle' ? c.json({ error: 'That run is not running' }, 409) : c.json({ ok: true, sent })
})
app.get('/exec/:run/activity', async (c) => c.json(await loadActivity(`exec:${c.req.param('run')}`)))
app.get('/exec/tickets/:id/activity', async (c) => c.json(await ticketActivity(c.req.param('id'))))
app.post('/exec/poll', async (c) => { await pollTickets(); return c.json(execView()) })
// picked tickets, checked: every id well-formed, mapped to a repo with a checkout, none already running
function pickedTickets(ids: unknown): { error: string; code: 400 | 409 } | { id: string; title: string; description: string; repo: string }[] {
  if (!Array.isArray(ids) || !ids.length || ids.some((i) => typeof i !== 'string' || !/^[A-Z][A-Z0-9]*-\d+$/.test(i))) return { error: 'Pick one or more tickets', code: 400 }
  if (!config.exec.command && !(ids as string[]).every((i) => issueOf(i))) return { error: 'Set the command that ships tickets in Settings → Ship', code: 400 }
  const unmapped = (ids as string[]).filter((i) => !repoFor(i, config.exec.repoByPrefix))
  if (unmapped.length) return { error: `No repository mapped for ${unmapped.join(', ')}`, code: 400 }
  const noCheckout = (ids as string[]).map((i) => repoFor(i, config.exec.repoByPrefix)!).filter((r) => !config.repos[r])
  if (noCheckout.length) return { error: `${noCheckout[0]} has no local checkout`, code: 400 }
  if (ids.some(ticketBusy)) return { error: 'A picked ticket is already running', code: 409 }
  const lacks = missingFor(slot('exec'))
  if (lacks.length) return { error: missingError(lacks), code: 400 }
  return (ids as string[]).map((id) => {
    const t = execBoard.tickets.find((x) => x.id === id)
    return { id, title: t?.title ?? '', description: t?.description ?? '', repo: repoFor(id, config.exec.repoByPrefix)! }
  })
}
// which tickets build on which: dependent ones become one stack, independent ones run side by side. Shown before it runs.
/** Your direction for picked tickets: plain text, bounded. */
const noteOf = (n: unknown) => (typeof n === 'string' ? n.trim().slice(0, 2000) : '')
app.post('/exec/plan', async (c) => {
  const body = await c.req.json() as { ids?: unknown; note?: unknown }
  const picked = pickedTickets(body.ids)
  if ('error' in picked) return c.json({ error: picked.error }, picked.code)
  const plan = await planStacks(picked, noteOf(body.note))
  if (plan.costUsd || plan.tokens) { addSpend(plan.costUsd, plan.provider, plan.tokens); save(); bus.emit('health') }
  return c.json({ stacks: plan.stacks, why: plan.why, prep: plan.prep })
})
// run the picked tickets: as the plan you confirmed (`stacks`), or planned now
app.post('/exec', async (c) => {
  const { ids, stacks, note: given, prep, mode } = await c.req.json() as { ids?: unknown; stacks?: unknown; note?: unknown; prep?: Prep; mode?: unknown }
  const picked = pickedTickets(ids), note = noteOf(given)
  if ('error' in picked) return c.json({ error: picked.error }, picked.code)
  // Ship as one PR: no plan to make, every picked ticket side by side, then one PR of those that got done
  if (mode === 'one-pr') {
    if (new Set(picked.map((t) => t.repo)).size > 1) return c.json({ error: 'One PR is one repository: pick tickets of one repository' }, 400)
    const ids1 = picked.map((t) => t.id)
    return c.json({ stacks: [ids1], why: '', runs: startBatch([ids1], note, undefined, 'one-pr'), merge: (config.mergeOnGreen ?? []).includes(picked[0].repo) })
  }
  let plan: { stacks: string[][]; why: string; prep?: Prep }
  if (stacks !== undefined) {
    if (!Array.isArray(stacks) || !stacks.every((s) => Array.isArray(s) && s.every((x) => typeof x === 'string')) || !valid(stacks as string[][], picked)) return c.json({ error: 'That plan does not cover each picked ticket once, one repo per stack' }, 400)
    // the prep you saw in the plan, checked again (it comes from the page)
    plan = { stacks: stacks as string[][], why: '', prep: prep && Array.isArray(prep.ids) && typeof prep.task === 'string' ? validPrep(prep, picked) : undefined }
  } else {
    const p = await planStacks(picked, note)
    if (p.costUsd || p.tokens) { addSpend(p.costUsd, p.provider, p.tokens); save(); bus.emit('health') }
    plan = p
  }
  // every ticket at once (after the prep, when there is one); each stack submits once all of it is ready
  const runs = startBatch(plan.stacks, note, plan.prep)
  return c.json({ stacks: plan.stacks, why: plan.why, prep: plan.prep, runs })
})
// A way past a ticket that waits on you: reply on Linear and re-run, or a configured action (proceed, write the ADR…).
app.post('/exec/action', async (c) => {
  const { id, action, note } = await c.req.json() as { id?: string; action?: string; note?: string }
  const t = execBoard.tickets.find((x) => x.id === id)
  if (!t) return c.json({ error: 'Unknown ticket' }, 404)
  const repo = repoFor(t.id, config.exec.repoByPrefix)
  if (!repo) return c.json({ error: `No repository mapped for ${t.team}` }, 400)
  if (ticketBusy(t.id)) return c.json({ error: `${t.id} is running; its session is in use until the run ends` }, 409)
  const text = typeof note === 'string' ? note.trim().slice(0, 4000) : ''
  // refuse before anything is posted when the run would need a skill this machine lacks
  const lacks = missingFor(action === 'reply' ? slot('exec') : config.exec.actions.find((x) => x.id === action)?.prompt)
  if (lacks.length) return c.json({ error: missingError(lacks) }, 400)
  if (action === 'reply') {
    if (!text) return c.json({ error: 'Write your answer first' }, 400)
    // your words, posted as you: no AI marker. The exec command reads a newer human reply as the go-ahead.
    let url: string
    // answer where the agent asked: in the thread of its latest comment
    try { url = issueOf(t.id) ? await commentOnIssue(t.id, text) : await postComment(t.id, text, t.agentWaiting ? t.lastComment?.threadId : undefined) }
    catch (e) { console.error(`reply on ${t.id} failed:`, (e as Error).message); return c.json({ error: `${issueOf(t.id) ? 'GitHub' : 'Linear'}: ${(e as Error).message}` }, 502) }
    console.log(`replied on ${t.id}: ${url}`)
    const run = enqueueExec([t.id], repo)
    return c.json({ commentUrl: url, run })
  }
  const run = await execAction(t, action ?? '', text)
  return run ? c.json({ run }) : c.json({ error: 'Could not start the run' }, 400)
})
async function execAction(t: Ticket, action: string, note = '') {
  const a = config.exec.actions.find((x) => x.id === action)
  const repo = repoFor(t.id, config.exec.repoByPrefix)
  if (!a || !repo) return undefined
  // {skill:name} → that skill's file, so a session that can't load it by name (synced skills) can still follow it
  const files = new Map(await Promise.all([...a.prompt.matchAll(/\{skill:([\w-]+)\}/g)].map(async ([, n]) => [n, await skillFile(n)] as const)))

  const withSkills = a.prompt.replace(/\{skill:([\w-]+)\}/g, (_, n: string) => files.get(n) ?? `the ${n} skill`)
  const prompt = fill(withSkills, {
    command: execCommand(slot('exec'), [t.id]), id: t.id, title: t.title, url: t.url,
    slug: t.branch || t.id.toLowerCase(), note: note ? `\n\nGuidance from the ticket owner: ${note}` : '',
  }) + (a.env ? azureNote() : '')
  // an investigation reads the database: right after a restart its connectors take a minute; it waits in the queue
  // (its activity says so) and starts once they are there
  return enqueueExec([t.id], repo, false, { label: a.label, prompt, allowedTools: a.allowedTools, said: note ? `${a.label}: ${note}` : a.label })
}

// the tools menu on a ticket: run it (alone, with its stack, or every ticket in its column), the configured
// ways past a waiting ticket, and the linked PR's own tools
type TicketScope = 'this' | 'stack' | 'all'
function ticketTools(id: string) {
  const views = ticketViews()
  const t = views.find((x) => x.id === id)
  if (!t) return undefined
  const free = (x: typeof t) => !x.busy && !!x.repo
  const lastRun = t.run && t.run.ids.length > 1 ? t.run.ids : undefined
  const column = views.filter((x) => x.bucket === t.bucket && free(x))
  const defs: { id: string; group: string; label: string; hint: string; confirm?: string; missing?: string[]; targets: Partial<Record<TicketScope, string[]>>; go: (ids: string[], scope: TicketScope, note: string) => unknown }[] = [
    {
      id: 'run', group: 'Ticket', label: t.run ? 'Run again' : 'Run', missing: missingFor(slot('exec')), hint: 'Start the exec command on it. Stack re-runs the tickets of its last run together, in order; All starts one run per ticket in this column.',
      confirm: 'Start exec on {n}?',
      targets: { this: free(t) ? [t.id] : [], stack: lastRun && lastRun.every((i) => !ticketBusy(i)) ? lastRun : [], all: column.map((x) => x.id) },
      // with a note: the command, then your words, so the run starts the way you want it to
      go: (ids, scope, note) => {
        // a stack: built side by side, submitted together once all of it is ready
        return scope === 'stack' ? startBatch([ids], note) : ids.forEach((i) => enqueueExec([i], repoFor(i, config.exec.repoByPrefix)!, false, note ? { said: note } : undefined))
      },
    },
    {
      id: 'one-pr', group: 'Ticket', label: 'Ship as one PR', missing: missingFor(slot('exec')),
      hint: `Build them side by side, each agent deciding on its own (no questions), then combine the ones that got done into one pull request${(config.mergeOnGreen ?? []).includes(t.repo ?? '') ? ', merged once its checks pass' : ''}. All takes every ticket of this repository in this column.`,
      confirm: 'Ship {n} as one PR?',
      targets: { this: free(t) ? [t.id] : [], stack: lastRun && lastRun.every((i) => !ticketBusy(i)) ? lastRun : [], all: column.filter((x) => x.repo === t.repo).map((x) => x.id) },
      go: (ids, _scope, note) => startBatch([ids], note, undefined, 'one-pr'),
    },
    ...config.exec.actions.filter((a) => !a.env || t.env.env === 'unknown' || a.env === t.env.env).map((a) => ({
      id: `action:${a.id}`, group: a.env ? 'Investigate' : 'Ticket', label: a.label, missing: missingFor(a.prompt),
      hint: a.env && t.env.env !== 'unknown' ? `${t.env.detail}. ${a.hint}` : a.env ? `Environment not known yet (${t.env.detail}). ${a.hint}` : a.hint, confirm: a.env ? a.confirm : a.confirm ?? `${a.label}: start on {n}?`,
      targets: a.env ? { this: free(t) ? [t.id] : [] } : { this: free(t) ? [t.id] : [], all: column.map((x) => x.id) },
      go: (ids: string[], _: TicketScope, note: string) => Promise.all(ids.map((i) => execAction(execBoard.tickets.find((x) => x.id === i)!, a.id, note))),
    })),
    {
      id: 'cancel', group: 'Ticket', label: 'Cancel run', hint: 'Stop the run working on it.',
      targets: { this: t.busy && t.run ? [t.id] : [], all: views.filter((x) => x.busy && x.run).map((x) => x.id) },
      go: (ids) => new Set(ids.map((i) => views.find((x) => x.id === i)?.run?.id)).forEach((r) => { if (r) { cancelExec(r); logged(`exec:${r}`, 'You cancelled the run') } }),
    },
  ]
  const linked = t.pr && state.prs[`${t.pr.repo}#${t.pr.number}`]
  return { t, defs, linked }
}
app.get('/exec/tickets/:id/env', (c) => {
  const t = execBoard.tickets.find((x) => x.id === c.req.param('id'))
  if (!t) return c.json({ error: 'Unknown ticket' }, 404)
  askEnv(t)
  return c.json(envOf(t))
})
app.get('/exec/tickets/:id/actions', (c) => {
  const x = ticketTools(c.req.param('id'))
  if (!x) return c.json({ error: 'Unknown ticket' }, 404)
  const own = x.defs.map(({ id, group, label, hint, confirm, targets, missing }) => ({ id, group, label, hint, confirm, missing, counts: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v!.length])) }))
  // the PR's tools, minus the ones about reviewing it
  const pr = x.linked ? actionsFor(x.linked).filter((a) => a.group !== 'Agent').map((a) => ({ ...a, id: `pr:${a.id}`, group: a.group === 'Pull request' ? `PR #${x.linked!.number}` : a.group })) : []
  return c.json([...own, ...pr])
})
app.post('/exec/tickets/:id/actions', async (c) => {
  const { action, scope, note } = await c.req.json<{ action: string; scope: TicketScope; note?: string }>()
  const x = ticketTools(c.req.param('id'))
  if (!x) return c.json({ error: 'Unknown ticket' }, 404)
  if (action.startsWith('pr:')) {
    if (!x.linked) return c.json({ error: 'No tracked PR on this ticket' }, 400)
    return runAction(x.linked, action.slice(3), scope, x.t.run ? [`exec:${x.t.run.id}`] : []).then((r) => c.json(r), (e: Error) => c.json({ error: e.message }, 400))
  }
  const d = x.defs.find((y) => y.id === action)
  const ids = d?.targets[scope] ?? []
  if (!d || !ids.length) return c.json({ error: 'Nothing to do here' }, 400)
  if (d.missing?.length) return c.json({ error: missingError(d.missing) }, 400)
  if (!config.exec.command) return c.json({ error: 'Set the command that ships tickets in Settings → Ship' }, 400)
  d.go(ids, scope, typeof note === 'string' ? note.trim().slice(0, 4000) : '')
  bus.emit('exec')
  return c.json({ label: d.label, count: ids.length })
})
// what is running (agents, crit servers) and what it costs; and one call to stop a kind of it, or all
app.get('/load', async (c) => c.json(await load()))
// worktrees: what each is and whether it can go; one call removes those that can (never with uncommitted or unpushed work)
// the agents' Claude Code: your claude.ai login (its connectors come along) or the model-only token
app.get('/claude-auth', async (c) => c.json({ ...(await claudeAuth()), lapsed: state.claudeLoginLapsed, login: claudeLoginState() }))
app.post('/claude-auth/login', async (c) => { try { return c.json({ url: await startClaudeLogin() }) } catch (e) { return c.json({ error: (e as Error).message }, 400) } })
app.post('/claude-auth/finish', async (c) => { const { input } = await c.req.json<{ input?: string }>(); try { finishClaudeLogin(String(input ?? '')); return c.json({ ok: true }) } catch (e) { return c.json({ error: (e as Error).message }, 400) } })
app.post('/claude-auth/token', (c) => { stopUsingLogin(); return c.json({ ok: true }) })
keepClaudeAuth()
// the accounts you added: their login on this machine, checked every 2 minutes (keepAccountLogins, beside readCan);
// lapsed, their runs go on their fallback token, and this machine says which (its status) so the control plane shows it
/**
 * One notice for every machine where an added Claude account's login stopped working: raised the moment a machine says
 * so, with where to sign it in again (the ticket that waits on it has the button too). Gone once each is signed in.
 */
async function loginNotice() {
  if (fleet.elsewhere()) return
  const where = new Map<string, string[]>() // account → machines
  const add = (m: string, ids: string[] = []) => { for (const id of ids) where.set(id, [...(where.get(id) ?? []), m]) }
  add(fleet.machine ?? 'this machine', lapsedLogins())
  for (const m of machines.values()) add(m.name, m.status?.lapsed)
  // only the accounts that have work (picked for some, in the order, or a repository's): an idle one is no news
  const used = new Set([...Object.values(config.providers?.use ?? {}), ...(config.providers?.fallback ?? []), ...Object.values(config.repoAccounts ?? {})].filter(Boolean) as string[])
  const lines = [...where].filter(([id]) => used.has(id)).map(([id, ms]) => `${accountOf(id).label} isn't signed in on ${ms.join(' and ')}: ${accountToken(id) ? 'its runs there use its fallback token, without its claude.ai connectors' : 'that machine takes none of its work (add a fallback token so it never stops)'}`)
  condition('login-lapsed', 'Claude accounts', lines.length ? `${lines.join('; ')}. Sign in again: Settings → Accounts → the account → Sign in on the machine.` : undefined)
}
setInterval(() => void loginNotice(), 60_000).unref()
// every account's folder has its links on this machine too (they are made where the account was added, and don't travel)
for (const a of accounts()) if (a.home && (a.kind === 'claude' || a.kind === 'openai')) void prepareHome(a.home, a.kind).catch((e) => console.warn(`accounts: ${a.label}: ${(e as Error).message}`))
// the organization's skills: mirrored for every machine, offered to every run (orgSkills.ts)
const syncSkills = () => fleet.elsewhere() ? Promise.resolve() : syncOrgSkills().catch((e) => console.warn('org skills:', (e as Error).message))
void syncSkills()
setInterval(() => void syncSkills(), 10 * 60_000)
// what a skill says, for the feed's preview: the company's (mirrored) first, then your own skills and commands
// every skill and command here, each with the command it would run as for a workflow (?work=review|revise|stack|exec)
app.get('/skills', async (c) => {
  const work = c.req.query('work') ?? 'review'
  return c.json((await scanSkills()).map((x) => ({ ...x, ...commandFor(x.invoke, x.argumentHint, work) })))
})
app.get('/skills/:name', async (c) => {
  const name = c.req.param('name').split(':').pop() ?? ''
  if (!/^[\w.-]{1,100}$/.test(name) || name.startsWith('.')) return c.json({ error: 'not a skill name' }, 400)
  const home = join(homedir(), '.claude')
  const files = [orgSkills().find((s) => s.name === name)?.file, join(home, 'skills', name, 'SKILL.md'), join(home, 'commands', `${name}.md`)].filter(Boolean) as string[]
  for (const f of files) {
    const text = await readFile(f, 'utf8').catch(() => undefined)
    if (text === undefined) continue
    const fm = text.match(/^---\n([\s\S]*?)\n---\n?/)
    const description = fm?.[1].match(/^description:\s*["']?([\s\S]*?)["']?\s*$/m)?.[1]
    return c.json({ name, description, body: (fm ? text.slice(fm[0].length) : text).slice(0, 40_000), company: files[0] === f && !!orgSkills().find((s) => s.name === name)?.company })
  }
  return c.json({ name, missing: true })
})
app.get('/org-skills', async (c) => { if (c.req.query('fresh') === '1') await syncSkills(); return c.json(orgSkills()) })
app.post('/org-skills/:name/mode', async (c) => {
  const { mode } = await c.req.json<{ mode?: string }>()
  if (mode !== 'auto' && mode !== 'always' && mode !== 'off') return c.json({ error: 'auto, always or off' }, 400)
  if (!orgSkills().some((s) => s.name === c.req.param('name'))) return c.json({ error: 'No such org skill' }, 404)
  setMode(c.req.param('name'), mode)
  return c.json({ ok: true })
})
// connectors the agents can use, and the one-click fixes for those they can't
// connectors you don't use: listed folded, out of the way (names, for every account)
app.get('/connections/muted', (c) => c.json(state.mutedConnectors ?? []))
app.post('/connections/muted', async (c) => {
  const { name, on } = await c.req.json<{ name?: string; on?: boolean }>()
  if (!name || name.length > 200) return c.json({ error: 'name required' }, 400)
  const s = new Set(state.mutedConnectors); if (on) s.add(name); else s.delete(name)
  state.mutedConnectors = [...s]; save()
  return c.json(state.mutedConnectors)
})
// a connector that isn't listed: added by its address, and taken out again
// a change to the connectors here reaches every other machine (pushConnectors, below)
app.use('/connections/*', async (c, next) => { await next(); if (c.req.method === 'POST' && c.res.status < 300 && !c.req.path.endsWith('/muted')) pushConnectors() })
app.get('/connections/custom', (c) => c.json(Object.keys(state.customConnectors ?? {})))
app.post('/connections/custom', async (c) => {
  const { name, url, remove } = await c.req.json<{ name?: string; url?: string; remove?: boolean }>()
  if (typeof name !== 'string' || !customName(name)) return c.json({ error: 'Name: letters, digits, - and _' }, 400)
  try {
    if (remove) { await removeCustom(name); return c.json((await connections(false, Infinity)).map(({ target: _, ...x }) => x)) }
    const u = String(url ?? '').trim()
    // claude.ai's own connectors (its directory) come through your claude.ai login, not by address
    if (/^https:\/\/claude\.ai\//.test(u)) return c.json({ error: "That's claude.ai's page for it, not an MCP address. Connect it at claude.ai/settings/connectors: it then shows here as claude.ai <name>" }, 400)
    await addCustom(name, u)
    const list = await recheck(name)
    // an address that doesn't answer as an MCP server: taken out again, or every run reports it didn't start
    if (list.find((x) => x.name === name)?.status === 'failed') {
      await removeCustom(name)
      return c.json({ error: `${u} didn't answer as an MCP server; nothing was added. Check the address in the service's MCP docs` }, 400)
    }
    return c.json(list.map(({ target: _, ...x }) => x))
  } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
app.get('/connections', async (c) => c.json((await connections(c.req.query('fresh') === '1')).map(({ target: _, ...c }) => c)))
app.post('/connections/connect', async (c) => {
  const { fix } = await c.req.json<{ fix?: string }>()
  if (fix !== 'linear-key' && fix !== 'sentry-token') return c.json({ error: 'Unknown fix' }, 400)
  try { await connect(fix); return c.json((await connections(true)).map(({ target: _, ...x }) => x)) } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0] }, 500) }
})
app.post('/connections/sentry', async (c) => {
  const { token, org } = await c.req.json<{ token?: string; org?: string }>()
  // any token without spaces: Sentry's newer ones are base64 and can hold + / = as well
  if (typeof token !== 'string' || !/^\S{20,1000}$/.test(token.trim())) { console.warn(`sentry connect: refused before asking Sentry (${typeof token === 'string' ? `${token.trim().length} chars, has spaces: ${/\s/.test(token.trim())}` : 'no token'})`); return c.json({ error: 'That does not look like a Sentry token (no spaces, at least 20 characters)' }, 400) }
  try {
    // the organization: as typed, else the one in your tickets' Sentry links
    const fromTickets = execBoard.tickets.map((t) => sentryRef(`${t.description} ${t.lastComment?.body ?? ''}`)?.org).filter((x): x is string => !!x)
    const r = await connectSentry(token.trim(), [org?.trim(), ...fromTickets].filter((x): x is string => !!x))
    console.log(`sentry connect: ok, ${r.orgs.join(', ')} on ${r.host}`)
    return c.json({ ...r, list: (await connections(true)).map(({ target: _, ...x }) => x) })
  } catch (e) {
    const msg = scrub((e as Error).message.split('\n')[0])
    console.warn(`sentry connect: ${msg}`) // what each address answered, never the token
    return c.json({ error: msg }, 400)
  }
})
// --- what agents started in the background: each with its state and last output, and a way to stop it -----------
const agentPid = (key: string) => (children.get(key) as { pid?: number } | undefined)?.pid
app.get('/prs/:id/background', async (c) => c.json(await bgView(c.req.param('id'), agentPid(c.req.param('id')))))
app.post('/prs/:id/background/stop', async (c) => {
  const id = c.req.param('id'), b = await c.req.json<{ task?: string; pid?: number }>()
  try { const r = await bgStop(id, b, agentPid(id)); bus.emit('change'); return c.json(r) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
/** A run another machine hosts (machines.ts): its background lives there, and that machine is asked. */
const hostedOn = (key: string) => { const ch = children.get(key) as { machine?: string; remoteId?: string } | undefined; return ch?.machine && ch.remoteId ? { machine: ch.machine, id: ch.remoteId } : undefined }
app.get('/exec/:run/background', async (c) => {
  const key = `exec:${c.req.param('run')}`, there = hostedOn(key)
  if (!there) return c.json(await bgView(key, agentPid(key)))
  const list = (state.background?.[key] ?? []).slice(-20)
  const [[, r]] = await ask<Awaited<ReturnType<typeof bgView>>>('bg', { id: there.id, tasks: list }, there.machine)
  if (!r) return c.json({ tasks: [], procs: [] })
  bgEnded(list, r.tasks)
  return c.json(r)
})
app.post('/exec/:run/background/stop', async (c) => {
  const key = `exec:${c.req.param('run')}`, b = await c.req.json<{ task?: string; pid?: number }>(), there = hostedOn(key)
  try {
    let r: unknown
    if (there) {
      const t = b.task ? (state.background?.[key] ?? []).find((x) => x.id === b.task) : undefined
      ;[[, r]] = await ask('bgStop', { id: there.id, task: t, pid: b.pid }, there.machine)
      if (!r) throw new Error(`${there.machine} didn't answer`)
      if (t) { t.stoppedAt = new Date().toISOString(); save() }
    } else r = await bgStop(key, b, agentPid(key))
    bus.emit('exec'); return c.json(r)
  } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})

void azureStatus()
app.get('/azure', async (c) => c.json({ ...(await azureStatus()), login: azureLoginState() }))
app.post('/azure/login', async (c) => { try { return c.json(await startAzureLogin()) } catch (e) { return c.json({ error: (e as Error).message }, 400) } })
// browser logins for connectors that only offer them: start, (from another device) finish, and watch
// the row's name → the connector actually logged in (Sentry's plugin logs in as the plain `sentry`)
const loginOf = (name: string) => (name === 'plugin:sentry:sentry' ? 'sentry' : name)
app.post('/connections/login', async (c) => {
  const { name, account: who } = await c.req.json<{ name?: string; account?: string }>()
  // another Claude account's own connector: logged in in its own folder (Llama's are the first account's)
  const a = accounts().find((x) => x.id === who)
  if (a && a.id !== 'claude' && a.kind === 'claude') {
    const theirs = (await accountConnections(a.id, a.kind, accountEnv(a.id))).find((x) => x.name === name && x.status !== 'connected' && x.via === 'claude code')
    if (!theirs) return c.json({ error: 'No connector by that name needs a login on that account' }, 400)
    try { return c.json({ url: await startLogin(theirs.name, a.id, accountEnv(a.id)) }) } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0] }, 400) }
  }
  // any list already in hand will do to know the row: not a fresh check of all ~40 before the login page opens
  const known = (await connections(false, Infinity)).find((x) => x.name === name && x.status !== 'connected')
  if (!known) return c.json({ error: 'No connector by that name needs a login' }, 400)
  try {
    // Sentry's plugin address can't log in (see sentry-login): register the plain one, remembered across rebuilds, and log that in
    if (known.name === 'plugin:sentry:sentry') { await connect('sentry-login'); return c.json({ url: await startLogin('sentry') }) }
    return c.json({ url: await startLogin(known.name) })
  } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0] }, 400) }
})
app.post('/connections/remove', async (c) => {
  const { fix } = await c.req.json<{ fix?: string }>()
  if (fix !== 'sentry-token' && fix !== 'linear-key') return c.json({ error: 'Unknown connector' }, 400)
  await removeFix(fix)
  return c.json((await connections(true)).map(({ target: _, ...x }) => x))
})
app.post('/connections/login/finish', async (c) => {
  const { name, redirect, account: who } = await c.req.json<{ name?: string; redirect?: string; account?: string }>()
  const own = who && who !== 'claude' && accounts().find((x) => x.id === who)?.kind === 'claude'
  try { finishLogin(own ? String(name) : loginOf(String(name)), String(redirect ?? ''), own ? who : 'claude'); return c.json({ ok: true }) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
app.get('/connections/login/:name', async (c) => {
  const who = c.req.query('account'), a = who && who !== 'claude' ? accounts().find((x) => x.id === who && x.kind === 'claude') : undefined
  if (a) {
    const st = loginState(c.req.param('name'), a.id)
    return c.json({ ...st, list: st?.done ? await accountConnections(a.id, a.kind, accountEnv(a.id), true) : undefined })
  }
  const st = loginState(loginOf(c.req.param('name')))
  return c.json({ ...st, list: st?.done ? (await recheck(loginOf(c.req.param('name')))).map(({ target: _, ...x }) => x) : undefined })
})
// this machine's own sign-in decides which connectors it adds (the saved choice may be another machine's), and the
// plugins are in place first: both write Claude Code's config
void Promise.all([checkClaudeAuth(), agentHomesReady()]).then(() => reconnect())
// the connection bank, written where each account's runs are pointed at: at start, and kept in step (a key set, a
// connector added, the sign-in changed, another account)
const bankNow = () => writeBank(accounts().map((a) => a.id)).catch((e) => console.warn('bank:', (e as Error).message))
void bankNow(); setInterval(() => void bankNow(), 30_000).unref()
app.get('/bank', (c) => c.json(bankView()))
// a connection of your own in the bank: a name, its MCP address, and its key when it has one (kept with the secrets)
app.post('/bank/add', async (c) => {
  const b = await c.req.json<{ name?: string; url?: string; key?: string; command?: string; env?: Record<string, string>; was?: string }>()
  const name = String(b.name ?? '').trim()
  if (!customName(name)) return c.json({ error: 'A name: letters, digits, - and _' }, 400)
  if (ownServers().some((s) => s.name === name && !s.mine)) return c.json({ error: `${name} is already in the bank` }, 400)
  // editing one of yours (`was`: its name before): a key or a value left empty keeps the one kept, so nothing has to be pasted again
  const before = b.was ? readSecrets().bank?.[b.was] : undefined
  if (b.was && !before) return c.json({ error: `${b.was} isn't in the bank any more` }, 400)
  if (b.was !== name && readSecrets().bank?.[name]) return c.json({ error: `${name} is already in the bank${b.was ? '' : ': edit it instead'}` }, 400)
  let entry: { url?: string; key?: string; command?: string[]; env?: Record<string, string> }
  if (b.command !== undefined) {
    // a command Concierge starts (an MCP server over stdio): split like a shell would, without one (no pipes, no $), and its
    // values handed to it as it starts (bin/bank-env.mjs), never on its command line
    const command = (String(b.command).match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^(["'])(.*)\1$/, '$2'))
    const env = Object.fromEntries(Object.entries(b.env ?? {}).map(([k, v]) => [k.trim(), String(v) || before?.env?.[k.trim()] || '']).filter(([k, v]) => k && v))
    if (!command.length) return c.json({ error: 'The command that starts it' }, 400)
    if (Object.keys(env).some((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) return c.json({ error: 'Each value needs a name like MDB_MCP_CONNECTION_STRING' }, 400)
    entry = { command, env }
  } else {
    const url = String(b.url ?? '').trim(), key = String(b.key ?? '').trim() || before?.key || ''
    if (!/^https:\/\/\S+$/.test(url)) return c.json({ error: 'An https:// address' }, 400)
    // one without a key signs in in the browser, into one tool's own store: there is no shared sign-in for those
    if (!key) return c.json({ error: 'It needs a key (an API key or token of that service): a connection that signs in in the browser can’t be shared between tools' }, 400)
    entry = { url, key }
  }
  const { [b.was ?? name]: _, ...rest } = readSecrets().bank ?? {}
  saveSecrets({ bank: { ...rest, [name]: entry } })
  if (b.was && b.was !== name) saveConfig({ exec: { allowedTools: config.exec.allowedTools.filter((t) => t !== `mcp__${b.was}`) } })
  const tools = `mcp__${name}`
  if (!config.exec.allowedTools.includes(tools)) saveConfig({ exec: { allowedTools: [...config.exec.allowedTools, tools] } })
  await bankNow()
  return c.json(bankView())
})
app.post('/bank/remove', async (c) => {
  const { name } = await c.req.json<{ name?: string }>()
  const { [String(name)]: _, ...rest } = readSecrets().bank ?? {}
  saveSecrets({ bank: rest })
  saveConfig({ exec: { allowedTools: config.exec.allowedTools.filter((t) => t !== `mcp__${name}`) } })
  await bankNow()
  return c.json(bankView())
})
app.post('/bank', async (c) => {
  const { only } = await c.req.json<{ only?: boolean }>()
  saveConfig({ connections: { ...userConfig().connections, bankOnly: !!only } })
  await bankNow()
  return c.json(bankView())
})
app.get('/worktrees', async (c) => c.json(await worktrees(c.req.query('fresh') === '1')))
app.post('/worktrees/clean', async (c) => c.json(await cleanWorktrees()))
app.post('/worktrees/auto', async (c) => { const { on } = await c.req.json<{ on?: boolean }>(); state.autoClean = !!on; save(); return c.json({ on: state.autoClean, last: state.lastClean }) })
app.get('/worktrees/auto', (c) => c.json({ on: state.autoClean, last: state.lastClean }))
/** The automatic cleanup: after a PR closes (only its worktrees), and every night at 03:00 (everything the rules allow). */
async function autoClean(why: string, only?: Parameters<typeof cleanWorktrees>[0]) {
  const r = await cleanWorktrees(only).catch((e: Error) => { console.error('auto clean:', e.message); return undefined })
  if (!r || !r.removed) return
  state.lastClean = { at: new Date().toISOString(), removed: r.removed, mb: r.mb, why }
  console.log(`auto clean (${why}): removed ${r.removed} worktree(s), ${r.mb} MB`)
  save()
}
// the nightly sweep: due when the last one ran before the most recent 03:00. Checked at boot and every 10 minutes, so
// a PC that was off at 03:00 sweeps soon after it starts, still once a night.
const sweep = () => {
  // a worker sweeps only while it runs nothing for the control plane: it can't tell which worktrees those runs use
  // (and the sweep never takes one with uncommitted or unpushed work either way)
  if ((fleet.elsewhere() && hosted().size) || !state.autoClean || !sweepDue(state.lastSweepAt)) return
  state.lastSweepAt = new Date().toISOString(); save() // claimed first: a slow sweep is not started twice
  void autoClean('nightly sweep')
}
setTimeout(sweep, 2 * 60_000) // after boot, once restarted work has settled
setInterval(sweep, 10 * 60_000)
setTimeout(() => void worktrees().catch(() => {}), 30_000) // size them in the background before anyone opens the list
// stopped runs go again: one (its key), or every one in the list
app.post('/load/again', async (c) => {
  const { key } = await c.req.json() as { key?: unknown }
  const keys = typeof key === 'string' ? [key] : stoppedRuns().map((r) => r.key)
  const failed = keys.map((k) => runAgain(k)).filter(Boolean) as string[]
  if (failed.length === keys.length && keys.length) return c.json({ error: failed[0] }, 409)
  return c.json({ started: keys.length - failed.length, failed })
})
app.post('/load/stop', async (c) => {
  const { what } = await c.req.json<{ what: 'crit' | 'runs' | 'all' }>()
  if (!['crit', 'runs', 'all'].includes(what)) return c.json({ error: 'what: crit | runs | all' }, 400)
  return c.json({ stopped: await stop(what) })
})
app.post('/exec/:run/cancel', (c) => { cancelExec(c.req.param('run')); logged(`exec:${c.req.param('run')}`, 'You cancelled the run'); return c.json({ ok: true }) })
app.post('/exec/:run/resume-terminal', (c) => {
  const run = state.execs[c.req.param('run')]
  const path = run && config.repos[run.repo]
  if (!run || !path) return c.json({ error: 'no session to resume' }, 400)
  const out = resume(c, `cd ${JSON.stringify(path)} && claude --resume ${run.sessionId}`)
  if (out.opened) logged(`exec:${run.id}`, `Session opened in your terminal (claude --resume ${run.sessionId.slice(0, 8)}…)`)
  return c.json(out)
})

// --- the codebase map: a summary of each repo's default branch that every PR is explained against ---
app.get('/base', (c) => c.json(Object.keys(config.repos).map((repo) => ({ repo, meta: loadBase(repo), task: state.base[repo] }))))
const plans = new Map<string, { at: number; plan: Promise<object> }>()
app.get('/base/plan', async (c) => {
  const repo = c.req.query('repo') ?? ''
  if (!config.repos[repo]) return c.json({ error: 'unknown repo' }, 404)
  const under = c.req.query('under') || undefined
  const key = `${repo}:${under ?? ''}`
  const cached = plans.get(key)
  if (!cached || Date.now() - cached.at > 120_000) plans.set(key, { at: Date.now(), plan: defaultBranch(repo).then(async (b) => {
    const p = await basePlan(repo, config.repos[repo], b, under)
    // systems: the system map is missing or lumps the repo together, so a map run redraws it (about $0.30)
    return { branch: p.branch, sha: p.sha, folders: p.scope.length, known: p.known, toMap: p.asks.length, systems: p.needSkeleton, estimateUsd: Math.round((p.estimateUsd + (p.needSkeleton ? 0.3 : 0)) * 100) / 100 }
  }) })
  try { return c.json({ ...(await plans.get(key)!.plan), complete: loadBase(repo)?.complete !== false, mapped: !!loadBase(repo) }) } catch (e) { plans.delete(key); return c.json({ error: (e as Error).message }, 500) }
})
app.get('/codebase', async (c) => {
  const repo = c.req.query('repo') ?? ''
  if (!config.repos[repo]) return c.json({ error: 'unknown repo' }, 404)
  const data = await codebase(repo, config.repos[repo])
  return data ? c.json(data) : c.json({ error: 'not mapped yet' }, 404)
})
app.post('/base', async (c) => {
  const { repo, action, under } = await c.req.json() as { repo: string; action: 'start' | 'cancel'; under?: string }
  if (!config.repos[repo]) return c.json({ error: 'unknown repo' }, 404)
  if (under !== undefined && (typeof under !== 'string' || under.includes('..') || under.startsWith('/'))) return c.json({ error: 'bad folder' }, 400)
  if (action === 'cancel') cancelBase(repo); else { for (const k of plans.keys()) if (k.startsWith(repo + ':')) plans.delete(k); enqueueBase(repo, under || undefined) }
  return c.json({ ok: true })
})

// --- onboarding and settings: everything the app needs, saved to ~/.config/concierge/config.json ---
const setupView = async (light = false) => ({
  configured: configured(), configFile: CONFIG_FILE, checks: light ? undefined : await checks(), skills: light ? [] : await sourceSkills().catch(() => []),
  // your skills that are links this machine can't follow (Docker: the folder they point into isn't mounted; bin/up mounts it)
  brokenLinks: light ? [] : await brokenSkillLinks(), skillSources: skillSources(),
  reviewIn: reviewIn(), critInstalled: critInstalled(), workDir: WORK_DIR, clones: cloneState(), away: Object.keys(config.repos).filter(notHere), machine: fleet.machine, machines: fleetMachines(), machineNames: config.machineNames ?? {}, cloneOn: config.cloneOn ?? {}, removeFrom: config.removeFrom ?? {},
  // where each repository is checked out now: this machine's, and each worker's as it reports (machines.ts)
  checkedOut: { ...(fleet.machine && { [fleet.machine]: Object.keys(config.repos).filter((r) => !(r in cloneState())) }), ...Object.fromEntries([...machines.values()].filter((m) => m.status?.repos).map((m) => [m.name, m.status!.repos!])) } as Record<string, string[]>,
  config: { repos: config.repos, repoAccounts: config.repoAccounts ?? {}, mergeOnGreen: config.mergeOnGreen ?? [], review: config.agent.review.command, revise: config.agent.revise.command, stack: config.agent.stack ?? '', workspaces: workspaces(), linearDesktop: !!config.linearDesktop, terminal: config.terminal, compliance: config.compliance ?? {}, orgs: config.orgs ?? {}, explainBudgetUsd: config.explainBudgetUsd, exec: config.exec },
  linearKey: hasKey(), // whether it is set; the key itself never leaves the server
  // the fleet extension is loaded (fleet/compose.fleet.yml sets it): onboarding then signs Tailscale in after GitHub
  fleet: !!process.env.CONCIERGE_FLEET,
  codeDirSet: CODE_DIR_SET, // CODE_DIR unset: clones go to Concierge's own folder (workDir), and setup says so
  placement: fleet.machine ? matrix() : [], // where each repository's work runs (machines.ts route)
  onboardingStep: state.onboardingStep,
  // every skill the settings run (and the ones they name), found or missing here: a new machine shows what to sync
  needed: await skillsNeeded([config.agent.review.command, config.agent.revise.command, config.agent.stack ?? '', config.exec.command, ...config.exec.actions.map((x) => x.prompt)]),
  commands: { review: await skillExists(config.agent.review.command), revise: await skillExists(config.agent.revise.command), stack: !!config.agent.stack && await skillExists(config.agent.stack) },
})
export type SetupView = Awaited<ReturnType<typeof setupView>>
// light: what the app needs to start (no CLI checks, no skill source): it shows its boot screen until this answers
app.get('/setup', async (c) => c.json(await setupView(c.req.query('light') === '1')))
app.get('/setup/repos', async (c) => c.json(await suggestions()))
// the onboarding's repository search: every repository you reach, by name or description, or one pasted as a link
app.get('/setup/repos/search', async (c) => {
  try { return c.json(await findRepos((c.req.query('q') ?? '').slice(0, 200))) } catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
// where onboarding was left: the step's id, kept so it opens there again
app.post('/setup/step', async (c) => {
  const { step } = await c.req.json<{ step?: unknown }>().catch(() => ({ step: undefined }))
  if (typeof step !== 'string' || !/^[a-z]{1,20}$/.test(step)) return c.json({ error: 'Not a step' }, 400)
  if (state.onboardingStep !== step) { state.onboardingStep = step; save() }
  return c.json({ ok: true })
})
app.get('/setup/my-skills', async (c) => c.json(await mySkills()))
/** Which machines may clone a repository (several machines: a company may keep one off some). Allowing it here clones it. */
app.post('/repos/clone-on', async (c) => {
  const { repo, machine, on } = await c.req.json() as { repo?: string; machine?: string; on?: boolean }
  // a repository, or a whole organization ("owner/*": its repositories now and later)
  const org = repo?.endsWith('/*') ? repo.slice(0, -2) : undefined
  if (!repo || !(org ? Object.keys(config.repos).some((r) => r.startsWith(`${org}/`)) : repo in config.repos)) return c.json({ error: 'Not a watched repository or organization' }, 400)
  if (!machine || !fleetMachines().includes(machine)) return c.json({ error: 'No such machine' }, 400)
  allowClone(repo, machine, !!on)
  void ensureClones()
  alignLater(machine) // that machine clones it (or takes it off) now, if it is online
  return c.json(await setupView())
})
// unticking also takes the checkout off that machine (when nothing would be lost: setup.ts takeOff); ticking again undoes it
const allowClone = (repo: string, machine: string, on: boolean) => {
  const now = new Set(config.cloneOn?.[repo] ?? []), off = new Set(config.removeFrom?.[repo] ?? [])
  if (on) { now.add(machine); off.delete(machine) } else { now.delete(machine); if (!repo.endsWith('/*')) off.add(machine) }
  const removeFrom = { ...config.removeFrom, [repo]: [...off] }
  // a whole organization ticked on a machine: the newest choice wins over an older untick of one of its repositories
  // there (that untick kept the repository off the machine while the main server counted it allowed, and its work
  // waited on a clone that never came: "still being cloned")
  if (on && repo.endsWith('/*')) for (const r of Object.keys(removeFrom)) if (r.startsWith(repo.slice(0, -1))) removeFrom[r] = removeFrom[r].filter((m) => m !== machine)
  saveConfig({ cloneOn: { ...config.cloneOn, [repo]: [...now] }, removeFrom })
}
app.post('/setup/clone', async (c) => {
  const { repo } = await c.req.json() as { repo: string }
  // cloning it here by hand allows it here
  if (fleet.machine && repo in config.repos) allowClone(String(repo), fleet.machine, true)
  try { return c.json(await cloneRepo(String(repo))) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
app.post('/setup/validate', async (c) => {
  const { repo, path } = await c.req.json() as { repo: string; path: string }
  return c.json(await validate(String(repo), String(path)))
})
app.post('/setup/skills', async (c) => c.json(await installSourceSkills()))
// Settings → Skills: which skill each feature uses (method.ts), its default, and whether it is installed here
app.get('/method', async (c) => c.json({
  source: skillSources().join(', '),
  features: await Promise.all((Object.keys(FEATURES) as (keyof typeof FEATURES)[]).map(async (k) => ({
    key: k, label: FEATURES[k].label, hint: FEATURES[k].hint, default: FEATURES[k].skill, skill: skillFor(k), found: !!(await skillPath(skillFor(k))),
  }))),
}))
// the profile once had the company's name: it isn't kept
const withoutName = (c?: Compliance) => { const { name: _, ...rest } = (c ?? {}) as Compliance & { name?: string }; return rest }
// the compliance profile, filled for you: from Linear and your code, as suggestions to take (complianceScan.ts)
app.get('/compliance/suggest', async (c) => c.json(await suggestCompliance(c.req.query('fresh') === '1')))
// who may open it through the tailnet link: the list, and changes to it (never empty while someone is on it: the last
// one can't be removed from a request through the link, so the owner can't lock themselves out)
// nobody allowed through the link yet, and the tailnet is one person's (every untagged device signed in as one login):
// that person, without waiting for them to open it first. Checked every minute on the main server
const ownerIn = () => {
  if (fleet.elsewhere() || allowedLogins().length) return
  void tailnetOwner().then((who) => {
    if (!who || allowedLogins().length) return
    saveConfig({ access: { logins: [who] } })
    console.log(`access: ${who} may open it through the link (every person's device on the tailnet is theirs)`)
  }, () => {})
}
setTimeout(ownerIn, 10_000).unref(); setInterval(ownerIn, 60_000).unref()
app.get('/access', (c) => c.json({ logins: allowedLogins(), you: whoFrom((n) => c.req.header(n)).login, proxied: whoFrom((n) => c.req.header(n)).proxied, fromEnv: (setting('ALLOW') ?? '').split(',').map((x) => x.trim()).filter(Boolean) }))
app.post('/access', async (c) => {
  const { logins } = await c.req.json<{ logins: string[] }>()
  if (!Array.isArray(logins) || logins.some((l) => typeof l !== 'string' || !/^[^\s@]+@[^\s@]+$|^[\w.-]+@github$|^[\w.-]+$/.test(l) || l.length > 120)) return c.json({ error: 'A login is an email, as Tailscale shows it' }, 400)
  const you = whoFrom((n) => c.req.header(n)).login
  if (you && !logins.includes(you)) return c.json({ error: 'Keep yourself on the list: you would lose access from here' }, 400)
  saveConfig({ access: { logins: [...new Set(logins.map((l) => l.trim()))] } })
  return c.json({ logins: allowedLogins(), you })
})
app.post('/config', async (c) => {
  const b = await c.req.json() as { mergeOnGreen?: string[]; reviewIn?: 'crit' | 'concierge'; repos?: Record<string, string>; repoAccounts?: Record<string, string>; review?: string; revise?: string; stack?: string; workspaces?: Workspace[]; linearDesktop?: boolean; terminal?: string; explainBudgetUsd?: number; exec?: Partial<typeof config.exec>; compliance?: Compliance; orgCompliance?: { owner: string; compliance: Compliance | null }; skills?: Record<string, string>; skillSource?: string; skillSources?: string[] }
  const errors: string[] = []
  if (b.repos) {
    if (!Object.keys(b.repos).length) errors.push('Pick at least one repository')
    for (const [repo, path] of Object.entries(b.repos)) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) errors.push(`${repo}: not an owner/repo name`)
      else { const v = await validate(repo, path); if (!v.ok) errors.push(`${repo}: ${v.error}`) }
    }
  }
  // a repository kept to one account: a watched repository, and an account that exists
  if (b.repoAccounts !== undefined && (typeof b.repoAccounts !== 'object' || Object.entries(b.repoAccounts).some(([r, a]) => !(r in (b.repos ?? config.repos)) || typeof a !== 'string' || !accounts().some((x) => x.id === a)))) errors.push('Each repository takes one of your accounts')
  for (const k of ['review', 'revise'] as const) {
    const v = b[k]
    if (v !== undefined && (typeof v !== 'string' || !v.trim() || v.length > 200)) errors.push(`The ${k} command can't be empty`)
  }
  if (b.stack !== undefined && (typeof b.stack !== 'string' || b.stack.length > 200 || (b.stack.trim() && !b.stack.includes('{stack}')))) errors.push('The stack command must include {stack}')
  if (b.workspaces !== undefined && (!Array.isArray(b.workspaces) || !b.workspaces.length || b.workspaces.some((w) => w !== 'review' && w !== 'exec'))) errors.push('Pick at least one workspace')
  if (b.terminal !== undefined && b.terminal !== 'Terminal' && b.terminal !== 'iTerm') errors.push('Terminal must be Terminal or iTerm')
  if (b.explainBudgetUsd !== undefined && !(typeof b.explainBudgetUsd === 'number' && b.explainBudgetUsd >= 0.1 && b.explainBudgetUsd <= 20)) errors.push('Explain budget must be between $0.10 and $20')
  if (b.exec) {
    const x = b.exec
    if (x.command !== undefined && (typeof x.command !== 'string' || x.command.length > 200 || (x.command && !x.command.includes('{ids}')))) errors.push('The exec command must include {ids}')
    if (x.teams !== undefined && (!Array.isArray(x.teams) || x.teams.some((t) => !/^[A-Z][A-Z0-9]*$/.test(t)))) errors.push('Teams are Linear team keys like BLI')
    if (x.repoByPrefix !== undefined && (typeof x.repoByPrefix !== 'object' || Object.entries(x.repoByPrefix).some(([k, v]) => !/^[A-Z][A-Z0-9]*$/.test(k) || !(v in (b.repos ?? config.repos))))) errors.push('Each prefix must map to a watched repository')
    if (x.allowedTools !== undefined && (!Array.isArray(x.allowedTools) || x.allowedTools.some((t) => typeof t !== 'string' || !t.trim() || t.length > 200))) errors.push('Allowed tools must be a list of tool rules')
  }
  // which skill each feature uses (method.ts): a skill name, or empty for its default
  if (b.skills !== undefined && (typeof b.skills !== 'object' || Object.entries(b.skills).some(([k, v]) => !(k in FEATURES) || typeof v !== 'string' || !/^[\w:./-]{0,120}$/.test(v)))) errors.push('Each feature takes a skill name')
  if (b.skillSource !== undefined && (typeof b.skillSource !== 'string' || (b.skillSource.trim() && !/^(https:\/\/|git@)[\w.@:/~-]+$/.test(b.skillSource.trim())))) errors.push('The skill source is a git repository URL (https:// or git@)')
  if (b.skillSources !== undefined && (!Array.isArray(b.skillSources) || b.skillSources.length > 20 || b.skillSources.some((u) => typeof u !== 'string' || !/^(https:\/\/|git@)[\w.@:/~-]+$/.test(u.trim())))) errors.push('Each skill source is a git repository link (https:// or git@)')
  const checkCompliance = (k: Compliance) => {
    if (k.off !== undefined && typeof k.off !== 'boolean') errors.push('Compliance is on or off')
    const known: Record<string, [string, string][]> = { regions: REGIONS, certifications: CERTIFICATIONS, data: DATA, reviews: REVIEWS }
    for (const [f, list] of Object.entries(known)) { const v = (k as Record<string, unknown>)[f]; if (v !== undefined && (!Array.isArray(v) || v.some((x) => !list.some(([id]) => id === x)))) errors.push(`Unknown ${f}`) }
    if (k.team !== undefined && (!Array.isArray(k.team) || k.team.length > 50 || k.team.some((m) => typeof m?.name !== 'string' || !m.name.trim() || m.name.length > 60 || !ROLES.some(([id]) => id === m.role) || (m.pace !== undefined && !(Number(m.pace) > 0 && Number(m.pace) <= 50)) || (m.teams !== undefined && (!Array.isArray(m.teams) || m.teams.some((t) => !/^[A-Z][A-Z0-9]*$/.test(t))))))) errors.push('Each person needs a name and a role')
  }
  if (b.compliance !== undefined) checkCompliance(b.compliance)
  // an organization's own profile (Settings → Compliance, per organization); null: back to the shared one
  const oc = b.orgCompliance
  if (oc !== undefined && (typeof oc?.owner !== 'string' || !/^[\w.-]{1,100}$/.test(oc.owner) || (oc.compliance !== null && typeof oc.compliance !== 'object'))) errors.push('Which organization, and its profile')
  else if (oc?.compliance) checkCompliance(oc.compliance)
  if (b.reviewIn !== undefined && b.reviewIn !== 'crit' && b.reviewIn !== 'concierge') errors.push('Reviews happen in crit or in Concierge')
  if (errors.length) return c.json({ error: errors.join('. ') }, 400)

  const prev = userConfig().agent, prevRepos = Object.keys(config.repos)
  saveConfig({
    // kept as a folder name when it sits in the working directory: then each machine finds it in its own
    ...(b.repos && { repos: Object.fromEntries(Object.entries(b.repos).map(([r, p]) => { const rel = relative(WORK_DIR, repoPath(p)); return [r, /^[\w-][\w.-]*$/.test(rel) ? rel : p] })) }),
    ...(b.repoAccounts && { repoAccounts: b.repoAccounts }),
    ...(Array.isArray(b.mergeOnGreen) && { mergeOnGreen: b.mergeOnGreen.filter((r) => typeof r === 'string' && r in config.repos) }),
    ...(b.reviewIn && { reviewIn: b.reviewIn }),
    ...(b.terminal && { terminal: b.terminal as 'Terminal' | 'iTerm' }),
    ...(b.workspaces && { workspaces: [...new Set(b.workspaces)] }),
    ...(typeof b.linearDesktop === 'boolean' && { linearDesktop: b.linearDesktop }),
    ...(b.explainBudgetUsd !== undefined && { explainBudgetUsd: b.explainBudgetUsd }),
    ...(b.exec && { exec: b.exec }),
    // the profile moves off its old key (company) on the first save
    ...(b.compliance && { compliance: { ...withoutName(config.compliance), ...b.compliance }, company: undefined }),
    ...(b.skills && { skills: Object.fromEntries(Object.entries({ ...config.skills, ...b.skills }).filter(([, v]) => v?.trim())) }),
    ...(b.skillSource !== undefined && { skillSource: b.skillSource.trim() || undefined }),
    // the list replaces the single source of before
    ...(b.skillSources !== undefined && { skillSources: [...new Set(b.skillSources.map((u) => u.trim().replace(/\/$/, '')))], skillSource: undefined }),
    ...((b.review || b.revise || b.stack !== undefined) && { agent: {
      ...(b.stack !== undefined && { stack: b.stack.trim() }),
      ...(b.review && { review: { ...prev?.review, command: b.review.trim() } }),
      ...(b.revise && { revise: { ...prev?.revise, command: b.revise.trim() } }),
    } }),
  })
  if (b.skills) void rereadMethods()
  doPoll() // pick up the newly watched repos right away
  if (b.exec) pollTickets()
  bus.emit('change')
  // a repository added from this machine's page may be cloned here (other machines wait until you allow them)
  if (b.repos && fleet.machine) for (const r of Object.keys(b.repos)) if (!(prevRepos as string[]).includes(r)) allowClone(r, fleet.machine, true)
  if (b.repos) void ensureClones() // a repository new to this machine is cloned in the background
  if (b.orgCompliance) setCompliance(b.orgCompliance.owner, b.orgCompliance.compliance && withoutName(b.orgCompliance.compliance))
  if (b.repos || b.skillSources !== undefined || b.skillSource !== undefined) alignLater() // every machine follows (clones, skill sources)
  return c.json(await setupView())
})
// who does the work: accounts (Claude, OpenAI, Llama; more of each, every one signed in on its own), one per kind of
// work, the fallback order, budgets, models, and what each spent today (providers.ts)
void readOpenaiAuth()
setInterval(() => void readOpenaiAuth(), 10 * 60_000)
void watchOllamas()
setInterval(() => void watchOllamas(), 60_000)
/**
 * Whose plan a Claude account spends: the claude.ai login's email, organization and tier. A setup token says none of
 * that (Anthropic doesn't tell a token's owner): for one, when it was set and by whom. Two accounts signed in as the
 * same claude.ai login are one plan under two names (samePlanAs).
 */
async function whoOf(a: { id: string; home?: string }) {
  const auth = await claudeAuth(a.home)
  const token = !a.home && !auth.usingLogin ? sharedNow().CLAUDE_CODE_OAUTH_TOKEN : undefined
  if (auth.loggedIn) setIdentity(a.id, a.home || auth.usingLogin
    ? `login:${auth.email ?? '?'}|${auth.org ?? '?'}`
    : `token:${createHash('sha256').update(process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '').digest('hex').slice(0, 12)}`)
  return {
    signedIn: auth.loggedIn, email: auth.email, org: auth.org, tier: auth.plan, byToken: !a.home && !auth.usingLogin,
    ...(token && { tokenSet: token.at, tokenFrom: token.from }),
  }
}
/** The other Claude account signed in as the same login as `id`, if any. */
const twinOf = (id: string) => accounts().find((x) => x.kind === 'claude' && x.id !== id && identityOf(x.id)?.startsWith('login:') && identityOf(x.id) === identityOf(id))
// who each Claude account is now, read every 5 minutes too: a sign-in changed elsewhere (Connections, a new token)
// shows in its plan and limits without opening Settings
const readIdentities = () => Promise.all(accounts().filter((a) => a.kind === 'claude').map((a) => whoOf(a).catch(() => undefined))).then(() => {
  // two accounts signed in as one claude.ai login: one plan under two names, so neither adds anything to the other
  const twins = accounts().filter((a) => a.kind === 'claude' && twinOf(a.id))
  condition('same-plan', 'Claude accounts', twins.length ? `${twins.map((a) => a.label).join(' and ')} are signed in as the same claude.ai account (${identityOf(twins[0].id)!.slice(6).split('|')[0]}), so they share one plan. Sign one in to another account (Settings → Accounts → Sign in again, approved in a browser signed in to that account).` : undefined)
})
setTimeout(() => void readIdentities(), 5_000).unref(); setInterval(() => void readIdentities(), 5 * 60_000).unref()

// --- one account, one login, on every machine (several machines) -------------------------------------------------------
/** Each machine's login for `account`: this one's and what every other one says (machines.ts status.who). */
const loginsOf = (account: string): Record<string, string | undefined> => ({
  [fleet.machine!]: identityOf(account), ...Object.fromEntries([...machines.values()].filter((m) => m.status).map((m) => [m.name, m.status!.who?.[account]])),
})
/** Keep (or change) the login an account is: the synced config, so every machine compares itself with the same one. */
function pinLogin(id: string, login: string) {
  const mine = userConfig().accounts ?? [], had = mine.find((a) => a.id === id)
  const a = accountOf(id)
  saveConfig({ accounts: had ? mine.map((x) => (x.id === id ? { ...x, login } : x)) : [...mine, { id, label: a.label, kind: a.kind, login }] })
  alignLater() // which machines now differ from it
}
// every 30s on the main server: an account without a login yet takes the first one seen (here first); a machine signed in
// as someone else under its name takes none of its work (machines.ts loginOk), and the page says where and who
setInterval(() => {
  if (!fleet.machine || fleet.elsewhere() || !machines.size) return
  const off: string[] = []
  for (const a of accounts()) {
    const by = loginsOf(a.id)
    if (!a.login) { const first = by[fleet.machine] ?? Object.values(by).find(Boolean); if (first) pinLogin(a.id, first); continue }
    const other = Object.entries(by).filter(([, w]) => w && w !== a.login)
    if (other.length) off.push(`${a.label} is ${loginText(a.login)}, but ${other.map(([m, w]) => `${m} has it signed in as ${loginText(w)}`).join(', ')}`)
  }
  condition('logins', 'Accounts', off.length ? `${off.join('; ')}. That machine takes none of the account's work until it signs in again as its login, or you make its login the account's (Settings → Agents).` : undefined)
}, 30_000).unref()
// make `machine`'s login the account's own (it was signed in as another one on purpose): the others then sign in again
app.post('/accounts/:id/adopt-login', async (c) => {
  const { machine } = await c.req.json<{ machine?: string }>().catch(() => ({ machine: undefined }))
  const id = c.req.param('id'), who = machine ? loginsOf(id)[machine] : undefined
  if (!isAccount(id) || !who) return c.json({ error: 'That machine has no login for this account' }, 400)
  pinLogin(id, who)
  return c.json({ ok: true, login: loginText(who) })
})

// --- the placement matrix: where each repository's work runs (machines.ts route), logged when it moves
app.get('/placement', (c) => c.json(matrix().map((r) => ({ ...r, main: fleet.machine }))))
// the repositories no machine can work on now (none it is allowed on is online with its checkout), and why: the page
// says so wherever they show (their pull requests and tickets stay to read; their runs wait). Several machines only
app.get('/repos/held', (c) => c.json(fleet.machine ? Object.fromEntries(matrix().filter((r) => !r.order.length && r.why).map((r) => [r.repo, r.why])) : {}))
let placedAs = ''
setInterval(() => {
  if (!fleet.machine || fleet.elsewhere()) return
  const m = matrix(), now = JSON.stringify(m.map((r) => [r.repo, r.order]))
  if (now === placedAs) return
  if (placedAs) console.log(`placement: ${m.map((r) => `${r.repo} → ${r.order.join(', ') || `nowhere (${r.why})`}`).join('; ')}`)
  placedAs = now
  bus.emit('change'); pump(); stale('/repos/held')
}, 15_000).unref()
const providersView = async () => ({
  use: config.providers?.use ?? {}, fallback: config.providers?.fallback ?? [], budgets: config.providers?.budgets ?? {}, stopAt: Math.round(stopAt() * 100),
  login: { claude: claudeLoginState(), openai: openaiLoginState() }, routing: routing(),
  accounts: await Promise.all(accounts().map(async (a) => { const who = a.kind === 'claude' ? await whoOf(a) : undefined; return {
    id: a.id, label: a.label, kind: a.kind, host: a.host, builtIn: ['claude', 'openai', 'llama'].includes(a.id),
    models: { large: modelOf(a.id, 'large'), small: modelOf(a.id, 'small') },
    available: available(a.id), why: whyNot(a.id)?.why, limitedUntil: limitedUntil(a.id), plan: a.kind === 'claude' ? planSpent(a.id) : undefined,
    who: who && { ...who, ...(twinOf(a.id) && { samePlanAs: accountOf(twinOf(a.id)!.id).label }) },
    signedIn: a.kind === 'claude' ? who!.signedIn || (!!a.keyEverywhere && !!accountToken(a.id)) : a.kind === 'openai' ? openaiAuth(a.id) !== 'none' : undefined,
    // an added Claude account's own setup token: since when it is set (never the value), and whether runs here use it now
    fallbackToken: a.kind === 'claude' && a.home ? { set: accountTokenAt(a.id), inUse: onFallbackToken(a.id), everywhere: !!a.keyEverywhere } : undefined,
    openai: a.kind === 'openai' ? openaiAuth(a.id) : undefined,
    llama: a.kind === 'llama' ? { ...await ollamaState(a.id), pulling: llamaPulling(a.id) } : undefined,
    today: state.spendBy?.[today()]?.[a.id],
  } })),
})
const isAccount = (p: unknown): p is string => typeof p === 'string' && PROVIDERS().includes(p)
// each account's use: its plan windows, and per day for a week its dollars, tokens and runs (Settings → Usage)
app.get('/usage/accounts', async (c) => {
  await readCodexWindows()
  const using = new Set(routing().map((x) => x.using))
  return c.json(await Promise.all(accounts().map(async (a) => ({
    id: a.id, label: a.label, kind: a.kind, using: using.has(a.id), windows: windowsFor(a.id),
    days: days(7).map((day) => ({ day, ...{ usd: 0, input: 0, output: 0, runs: 0 }, ...state.spendBy?.[day]?.[a.id] })),
    ollama: a.kind === 'llama' ? await fetch(`${ollamaOf(a.id)}/api/ps`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json() as Promise<{ models?: { name: string; size_vram?: number; size?: number }[] }>)
      .then((r) => ({ up: true, loaded: (r.models ?? []).map((m) => m.name) }), () => ({ up: false, loaded: [] as string[] })) : undefined,
  }))))
})
void readCodexWindows()
setInterval(() => void readCodexWindows(), 2 * 60_000)
// is a Llama account's Ollama on the GPU, and how fast: what it has loaded (and how much of it in GPU memory), and a short
// timed answer from its small model (or its large one, or any model it could use: ?model=, tried before it is chosen; an
// Ollama Cloud one is fetched first, which only registers it)
app.get('/ollama/check', async (c) => {
  const id = c.req.query('account') ?? 'llama', host = ollamaOf(id), asked = c.req.query('model')
  if (asked && !/^[\w.\/-]+(:[\w.-]+)?$/.test(asked)) return c.json({ error: 'A model name looks like gemma4:31b-cloud' }, 400)
  const model = asked || modelOf(id, c.req.query('size') === 'large' ? 'large' : 'small'), t0 = Date.now()
  let fresh = false // fetched for this try: dropped again when it can't answer, so the list keeps only usable ones
  try {
    if (asked && /cloud$/.test(asked) && !(await ollamaState(id)).models.includes(asked)) {
      const p = await fetch(`${host}/api/pull`, { method: 'POST', signal: AbortSignal.timeout(30_000), body: JSON.stringify({ model, stream: false }) })
      const pe = (await p.json() as { error?: string }).error
      if (pe) return c.json({ model, error: /file does not exist/.test(pe) ? 'Ollama Cloud has no model by that name' : pe })
      fresh = true
    }
    const r = await fetch(`${host}/api/generate`, { method: 'POST', signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({ model, prompt: `Summarise in one line: ${'the quick brown fox jumps over the lazy dog. '.repeat(60)}`, stream: false, options: { num_predict: 48 } }) })
    const g = await r.json() as { prompt_eval_count?: number; prompt_eval_duration?: number; eval_count?: number; eval_duration?: number; error?: string }
    if (g.error && fresh) await fetch(`${host}/api/delete`, { method: 'DELETE', body: JSON.stringify({ model }) }).catch(() => {})
    const ps = await fetch(`${host}/api/ps`).then((x) => x.json() as Promise<{ models?: { name: string; size: number; size_vram: number }[] }>)
    return c.json({
      model, error: g.error, seconds: Math.round((Date.now() - t0) / 100) / 10,
      readingPerSecond: g.prompt_eval_count && g.prompt_eval_duration ? Math.round(g.prompt_eval_count / (g.prompt_eval_duration / 1e9)) : undefined,
      writingPerSecond: g.eval_count && g.eval_duration ? Math.round((g.eval_count / (g.eval_duration / 1e9)) * 10) / 10 : undefined,
      loaded: (ps.models ?? []).map((m) => ({ name: m.name, gb: Math.round(m.size / 1e8) / 10, onGpu: m.size ? Math.round((m.size_vram / m.size) * 100) : 0 })),
    })
  } catch (e) { return c.json({ model, error: (e as Error).message }, 502) }
})
// a fresh ticket run is planned before it starts: the skills that fit it and the environment it reads (router.ts)
planRunsWith(async (run) => {
  const t = execBoard.tickets.find((x) => x.id === run.ids[0])
  if (!t) return
  const plan = await planFor({ id: t.id, title: t.title, description: run.said ? `${t.description}\n\nThe person's direction: ${run.said}` : t.description, labels: t.labels, env: ((e) => (e === 'prod' || e === 'dev' ? e : undefined))(state.envs[t.id]?.env) })
  if (!plan) return
  run.plan = plan
  if (plan.costUsd) addSpend(plan.costUsd, providerFor('small'))
  note(`exec:${run.id}`, { at: new Date().toISOString(), kind: 'event', text: `Plan (${plan.by === 'rules' ? 'by rule' : 'picked by a small model'}): ${plan.skills.length ? `use ${plan.skills.map((s) => s.name).join(', ')}` : 'no skill fits especially'}${plan.env ? `; ${plan.env === 'prod' ? 'production' : 'development'} data` : ''}.`, plan: { skills: plan.skills, steps: plan.steps, env: plan.env, by: plan.by } })
})
// each account's connectors (names and status): its own folder's, read now and then so a stand-in's run knows what it lacks
app.get('/accounts/:id/connections', async (c) => {
  const a = accounts().find((x) => x.id === c.req.param('id'))
  if (!a) return c.json({ error: 'No such account' }, 404)
  return c.json(await accountConnections(a.id, a.kind, accountEnv(a.id), c.req.query('fresh') === '1'))
})
const readAccountConnections = async () => { for (const a of accounts()) await accountConnections(a.id, a.kind, accountEnv(a.id)).catch(() => {}) }
setTimeout(() => void readAccountConnections(), 30_000).unref()
setInterval(() => void readAccountConnections(), 10 * 60_000).unref()
app.get('/providers', async (c) => c.json(await providersView()))
// "Does this account actually answer?": one tiny question through the same path a run takes, and what came back (its
// words, or the error, the exit code and what it wrote to stderr), so a silent account says why
app.post('/providers/:id/test', async (c) => {
  const id = c.req.param('id')
  if (!isAccount(id)) return c.json({ error: 'No such account' }, 404)
  if (accountOf(id).kind === 'claude') void probePlan(id) // and its plan's windows are read again: a limit you lifted shows at once
  const t0 = Date.now(), ac = new AbortController(), timer = setTimeout(() => ac.abort(), 90_000)
  const r = await new Promise<{ ok: boolean; text?: string; error?: string }>((done) => {
    let out = '', err = ''
    try {
      const child = spawnAgent(id, ['-p', 'Reply with the single word: ok', '--output-format', 'json', '--tools', '', '--model', 'haiku', '--max-budget-usd', '0.1'], { cwd: tmpdir(), signal: ac.signal })
      child.stdout.on('data', (d: Buffer) => { out += d }); child.stderr.on('data', (d: Buffer) => { err = (err + d).slice(-600) })
      child.on('error', (e: Error) => done({ ok: false, error: (e as NodeJS.ErrnoException).code === 'ENOENT' ? "Its CLI isn't installed in this image: run bin/update --force" : ac.signal.aborted ? 'No answer within 90 seconds' : e.message }))
      child.on('close', (code: number | null) => {
        const last = out.trim().split('\n').map((l) => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean).at(-1) as { result?: string; is_error?: boolean } | undefined
        const text = String(last?.result ?? '').trim()
        if (code === 0 && text && !last?.is_error) done({ ok: true, text: text.slice(0, 200) })
        else done({ ok: false, error: [text && `It said: ${text.slice(0, 300)}`, code ? `exit code ${code}` : '', err.trim() && `stderr: ${err.trim().slice(-400)}`].filter(Boolean).join(' · ') || 'It ended without an answer' })
      })
    } catch (e) { done({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
  })
  clearTimeout(timer)
  return c.json({ ...r, ms: Date.now() - t0 })
})
// the models an account can be told to use, for its Models picker (providers.ts modelsOf)
app.get('/accounts/:id/models', async (c) => {
  const id = c.req.param('id')
  if (!isAccount(id)) return c.json({ error: 'No such account' }, 404)
  return c.json({ models: await modelsOf(id).catch(() => []), picked: config.providers?.models?.[id] ?? {} })
})
app.post('/providers', async (c) => {
  const b = await c.req.json() as { use?: Record<string, string>; fallback?: string[]; budgets?: Record<string, number | null>; models?: Record<string, { large?: string; small?: string }>; stopAt?: number }
  if (b.stopAt !== undefined && !(Number.isInteger(b.stopAt) && b.stopAt >= 50 && b.stopAt <= 100)) return c.json({ error: 'Pause agents at 50% to 100% of a plan window' }, 400)
  const works = ['review', 'revise', 'exec', 'small']
  if (b.use && Object.entries(b.use).some(([w, p]) => !works.includes(w) || !isAccount(p))) return c.json({ error: 'Each kind of work takes one of your accounts' }, 400)
  if (b.fallback && (!Array.isArray(b.fallback) || !b.fallback.every(isAccount))) return c.json({ error: 'The fallback order lists accounts' }, 400)
  if (b.budgets && Object.entries(b.budgets).some(([p, v]) => !isAccount(p) || (v !== null && !(typeof v === 'number' && v >= 0 && v <= 1000)))) return c.json({ error: 'A budget is $0 to $1000 a day, or none' }, 400)
  if (b.models && Object.entries(b.models).some(([p, m]) => !isAccount(p) || Object.values(m).some((v) => typeof v !== 'string' || v.length > 80))) return c.json({ error: 'Model names are short strings' }, 400)
  const prev = userConfig().providers ?? {}
  const budgets: Record<string, number> = { ...prev.budgets }
  for (const [k, v] of Object.entries(b.budgets ?? {})) if (v == null) delete budgets[k]; else budgets[k] = v
  const models = { ...prev.models }
  // an empty name inherits again: the key goes
  for (const [k, m] of Object.entries(b.models ?? {})) models[k] = Object.fromEntries(Object.entries({ ...models[k], ...m }).filter(([, v]) => v)) as typeof models[string]
  saveConfig({ providers: { ...prev, ...(b.use && { use: { ...prev.use, ...b.use } }), ...(b.fallback && { fallback: b.fallback }), ...(b.budgets && { budgets }), ...(b.models && { models }), ...(b.stopAt !== undefined && { stopAt: b.stopAt }) } })
  reroute() // decided again at once: the pause point or the order may have changed who takes what
  return c.json(await providersView())
})
// another account: a Claude or OpenAI one gets its own sign-in folder; a Llama one is an Ollama somewhere
app.post('/accounts', async (c) => {
  const b = await c.req.json() as { label?: string; kind?: string; host?: string }
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 40) : ''
  if (!label) return c.json({ error: 'Give it a name, like Claude (personal)' }, 400)
  if (b.kind !== 'claude' && b.kind !== 'openai' && b.kind !== 'llama') return c.json({ error: 'Claude, OpenAI or Llama' }, 400)
  if (b.kind === 'llama' && b.host && !/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(b.host)) return c.json({ error: 'An Ollama address looks like http://host:11434' }, 400)
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || b.kind
  let id = base
  for (let n = 2; isAccount(id); n++) id = `${base}-${n}`
  const home = b.kind === 'llama' ? undefined : join(CONFIG_DIR, 'accounts', id, b.kind === 'claude' ? 'claude' : 'codex')
  if (home) await prepareHome(home, b.kind as 'claude' | 'openai')
  saveConfig({ accounts: [...(userConfig().accounts ?? []), { id, label, kind: b.kind, ...(home && { home }), ...(b.host && { host: b.host.replace(/\/$/, '') }) }] })
  void readOpenaiAuth()
  alignLater() // a new account: which machines have it signed in
  return c.json(await providersView())
})
app.delete('/accounts/:id', async (c) => {
  const id = c.req.param('id')
  if (['claude', 'openai', 'llama'].includes(id) || !isAccount(id)) return c.json({ error: 'Only an account you added can go' }, 400)
  const prev = userConfig().providers ?? {}
  // its work goes back to Claude; its folder (and sign-in) stays on disk
  saveConfig({ accounts: (userConfig().accounts ?? []).filter((a) => a.id !== id), providers: { ...prev, use: Object.fromEntries(Object.entries(prev.use ?? {}).filter(([, p]) => p !== id)), fallback: (prev.fallback ?? []).filter((p) => p !== id) } })
  return c.json(await providersView())
})
app.post('/accounts/:id/login', async (c) => {
  const a = accounts().find((x) => x.id === c.req.param('id'))
  if (!a || a.kind === 'llama') return c.json({ error: 'Nothing to sign in to' }, 400)
  try { return c.json(a.kind === 'openai' ? await startOpenaiLogin(a.id) : { url: await startClaudeLogin(a.home) }) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})

// an added Claude account's key (claude setup-token, run in a terminal and pasted on the page: making it from here, by
// driving that full-screen CLI, never worked reliably)
function keepAccountToken(id: string, v: string | null) {
  const all = { ...(readSecrets().accountTokens ?? {}) }
  if (v) all[id] = { value: v, at: new Date().toISOString() }; else delete all[id]
  // no key left: an account that ran on it everywhere goes back to each machine's own sign-in
  if (!v && accountOf(id).keyEverywhere) saveConfig({ accounts: (userConfig().accounts ?? []).map((a) => a.id === id ? { ...a, keyEverywhere: undefined } : a) })
  saveSecrets({ accountTokens: all })
  applyShared(true)
  console.log(`accounts: ${accountOf(id).label}'s fallback token ${v ? 'set' : 'removed'}`)
}
const addedClaude = (id: string) => accounts().find((a) => a.id === id && a.kind === 'claude' && !!a.home)
app.post('/accounts/:id/token', async (c) => {
  const id = c.req.param('id')
  if (!addedClaude(id)) return c.json({ error: 'Only a Claude account you added has its own fallback token' }, 400)
  const { value, everywhere } = await c.req.json() as { value?: string | null; everywhere?: boolean }
  // the key on every machine (or back to each machine's own sign-in): the account's setting, every machine follows it
  if (typeof everywhere === 'boolean') {
    if (everywhere && !accountToken(id)) return c.json({ error: 'Set its key first' }, 400)
    saveConfig({ accounts: (userConfig().accounts ?? []).map((a) => a.id === id ? { ...a, keyEverywhere: everywhere || undefined } : a) })
    console.log(`accounts: ${accountOf(id).label} ${everywhere ? 'runs on its key on every machine' : 'signs in on each machine again'}`)
    alignLater(); void loginNotice()
    return c.json(await providersView())
  }
  const v = typeof value === 'string' ? value.trim() : null
  if (v !== null && !/^sk-ant-oat[\w-]{20,}$/.test(v)) return c.json({ error: 'That isn\'t a claude setup-token token (it starts with sk-ant-oat)' }, 400)
  keepAccountToken(id, v)
  return c.json(await providersView())
})

app.get('/prs', (c) => { const away = scopeOf(c) === 'self' ? awayHere() : undefined; return c.json(away ? views().filter((p) => !away.has(p.repo)) : views()) })
app.get('/prs/:id/activity', async (c) => c.json(await loadActivity(decodeURIComponent(c.req.param('id')))))
app.post('/poll', async (c) => { await doPoll(true); return c.json(healthView()) })
// a review request Auto-review starts on its own: in the Review workspace, with a checkout, and not started yet
const autoReviews = (pr: Pr) => !pr.mine && workspaces().includes('review') && !!config.repos[pr.repo] && !pr.closed && statusOf(pr, undefined, true) === 'new'
app.post('/auto-start', async (c) => {
  const was = state.autoStart
  state.autoStart = !!(await c.req.json()).on
  // switched on: what already waits goes too, not only what is requested from now on; a stack bottom first, each
  // review after the one below it
  if (state.autoStart && !was) {
    const prev = new Map<string, string>()
    const at = (p: Pr) => p.stack?.findIndex((x) => x.number === p.number) ?? 0
    for (const p of Object.values(state.prs).filter(autoReviews).sort((a, b) => at(a) - at(b))) {
      const k = p.stack ? `${p.repo}#${p.stack[0].number}` : p.id
      enqueue(p, 'review', undefined, undefined, prev.get(k))
      prev.set(k, p.id)
    }
  }
  save()
  bus.emit('health')
  return c.json(healthView())
})
app.post('/settings', async (c) => {
  const b = (await c.req.json()) as Partial<Settings>
  if (b.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en', { timeZone: b.timezone }) } catch { return c.json({ error: 'Unknown time zone' }, 400) }
    state.settings.timezone = b.timezone
  }
  if (b.maxJobs !== undefined) {
    if (!Number.isInteger(b.maxJobs) || b.maxJobs < 1 || b.maxJobs > 8) return c.json({ error: 'parallel reviews must be 1 to 8' }, 400)
    state.settings.maxJobs = b.maxJobs
  }
  if (b.dailyBudgetUsd !== undefined) {
    if (b.dailyBudgetUsd !== null && !(typeof b.dailyBudgetUsd === 'number' && b.dailyBudgetUsd >= 0 && b.dailyBudgetUsd <= 10000)) return c.json({ error: 'budget must be a dollar amount or empty' }, 400)
    state.settings.dailyBudgetUsd = b.dailyBudgetUsd
  }
  save()
  pump() // a higher cap may free queued reviews
  bus.emit('health')
  return c.json(healthView())
})

// Post or approve: resume the review's own session and hand it your answers (note, GIF),
// so the skill submits exactly as it would if you typed the request in the terminal.
app.post('/prs/:id/submit', async (c) => {
  const p = pr(c.req.param('id'))
  if (p?.mine) return c.json({ error: 'you cannot review your own PR' }, 400)
  if (!p?.job?.reviewDone) return c.json({ error: 'run the review before posting it' }, 400)
  if (p.job.state === 'running' || p.job.state === 'queued') return c.json({ error: 'an agent run is already in progress' }, 409)
  const b = await c.req.json() as { event?: string; note?: string; gif?: string; findings?: 'post' | 'drop' }
  if (b.event !== 'APPROVE' && b.event !== 'COMMENT') return c.json({ error: 'event must be APPROVE or COMMENT' }, 400)
  const note = (b.note ?? '').trim().slice(0, 4000)
  const gif = (b.gif ?? '').trim()
  if (gif && !/^https:\/\/\S+$/.test(gif)) return c.json({ error: 'GIF must be an https:// URL' }, 400)
  if (b.event === 'COMMENT' && b.findings === 'drop' && !note) return c.json({ error: 'nothing to post: no findings and no note' }, 400)
  const prompt = fill(config.agent.post, {
    event: b.event,
    note: note ? JSON.stringify(note) : '(none, leave the note out)',
    gif: b.event === 'APPROVE' ? gif || '(none, skip the GIF)' : '(not an approval, no GIF)',
  }) + (b.findings === 'drop' ? '\nThe reviewer chose to leave the crit findings out: do not post them, not even summarised. Submit only the note (and the GIF, if any); with no note, an approval goes with an empty body.' : '')
  const what = b.event === 'APPROVE' ? (b.findings === 'drop' ? 'Approve without the findings' : 'Approve') : 'Post the review'
  enqueue(p, b.event === 'APPROVE' ? 'approve' : 'post', prompt, `${what}${note ? `: ${note}` : ''}`)
  return c.json({ ok: true })
})

// everything answered: ask the reviewers to look again (GitHub notifies them)
// a review read in Concierge (no crit): its findings, from the file the agent wrote where crit keeps reviews (crit.ts
// ownReviewFile), and keeping or dropping one. A dropped finding is marked resolved, so posting leaves it out
type OwnComment = { id: string; start_line?: string; end_line?: string; body?: string; resolved?: boolean; scope?: string }
const ownReview = async (p: Pr) => {
  const key = p.job?.critKey
  if (!key?.startsWith('cc-')) return undefined
  const file = ownReviewFile(key)
  const json = JSON.parse(await readFile(file, 'utf8').catch(() => '{}')) as { files?: Record<string, { comments?: OwnComment[] }>; review_comments?: OwnComment[] }
  return { file, json }
}
app.get('/prs/:id/findings', async (c) => {
  const p = pr(c.req.param('id'))
  const r = p && await ownReview(p)
  if (!r) return c.json({ own: false, findings: [] })
  const one = (x: OwnComment, path?: string) => ({ id: x.id, path, line: x.start_line ? Number(x.start_line) : undefined, end: x.end_line ? Number(x.end_line) : undefined, body: x.body ?? '', dropped: !!x.resolved })
  return c.json({ own: true, findings: [...(r.json.review_comments ?? []).map((x) => one(x)), ...Object.entries(r.json.files ?? {}).flatMap(([path, f]) => (f.comments ?? []).map((x) => one(x, path)))] })
})
app.post('/prs/:id/findings/:cid', async (c) => {
  const p = pr(c.req.param('id')), cid = c.req.param('cid')
  const { dropped } = await c.req.json<{ dropped?: boolean }>().catch(() => ({ dropped: undefined }))
  const r = p && await ownReview(p)
  if (!r || typeof dropped !== 'boolean') return c.json({ error: 'no such finding' }, 404)
  const all = [...(r.json.review_comments ?? []), ...Object.values(r.json.files ?? {}).flatMap((f) => f.comments ?? [])]
  const x = all.find((y) => y.id === cid)
  if (!x) return c.json({ error: 'no such finding' }, 404)
  x.resolved = dropped
  await writeFile(r.file + '.tmp', JSON.stringify(r.json, null, 2)); await rename(r.file + '.tmp', r.file)
  await refreshCrit(); bus.emit('change')
  return c.json({ ok: true })
})

// the review's NORM findings (code that differs from a written convention) and the repo's deliberate exceptions
app.get('/prs/:id/norms', (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  const crit = critOfPr(p)
  return c.json({ norms: normsOf(crit?.sessionKey), exceptions: exceptionsOf(p.repo), live: !!crit?.live })
})
// "This is deliberate": you chose it, so the finding is answered and resolved in crit (it won't be posted), and the
// repo remembers the exception so later reviews don't file it again
app.post('/prs/:id/norms/:cid/deliberate', async (c) => {
  const p = pr(c.req.param('id')), cid = c.req.param('cid')
  const { why = '' } = await c.req.json<{ why?: string }>().catch(() => ({ why: '' }))
  const crit = p && critOfPr(p)
  const n = normsOf(crit?.sessionKey).find((x) => x.id === cid)
  if (!p || !crit?.sessionKey || !n) return c.json({ error: 'no such norm finding' }, 404)
  if (!/^c_[\w-]+$/.test(cid) || why.length > 500) return c.json({ error: 'bad request' }, 400)
  const args = ['comment', '--session', crit.sessionKey, '--reply-to', cid, ...(n.path ? ['--path', n.path] : []), '--resolve', '--author', 'Concierge', deliberateNote(why)]
  const err = await new Promise<Error | null>((resolve) => execFile('crit', args, { cwd: crit.cwd, timeout: 15_000 }, (e) => resolve(e)))
  if (err) return c.json({ error: `crit: ${err.message.split('\n').pop()}` }, 502)
  await addException(p.repo, { norm: n.norm, source: n.source, why: why.trim(), pr: p.number, at: new Date().toISOString() })
  await refreshCrit()
  logged(p.id, `Kept on purpose: ${n.norm}`)
  return c.json({ ok: true })
})
app.post('/prs/:id/rerequest', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p?.mine || !p.reviewers?.length) return c.json({ error: 'no reviewers to ask' }, 400)
  const args = ['api', '-X', 'POST', `repos/${p.repo}/pulls/${p.number}/requested_reviewers`, ...p.reviewers.flatMap((r) => ['-f', `reviewers[]=${r}`])]
  return new Promise<Response>((resolve) => execFile('gh', args, (err) => {
    if (err) return resolve(c.json({ error: err.message.split('\n').pop() }, 502))
    logged(p.id, `Asked ${p.reviewers!.join(', ')} to review again`)
    resolve(c.json({ ok: true, reviewers: p.reviewers }))
  }))
})
app.post('/prs/:id/run', (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  if (!config.repos[p.repo]) return c.json({ error: `no local checkout for ${p.repo} in config.json` }, 400)
  const lacks = missingFor(slot(p.mine ? 'revise' : 'review'))
  if (lacks.length) return c.json({ error: missingError(lacks) }, 400)
  enqueue(p, p.mine ? 'revise' : 'review')
  return c.json({ ok: true })
})

// several reviews as planned (the list's picks): each stack's in order, each waiting for the one below; the stacks side by side
app.post('/review/run', async (c) => {
  const { stacks } = await c.req.json() as { stacks?: unknown }
  if (!Array.isArray(stacks) || !stacks.length || !stacks.every((s) => Array.isArray(s) && s.length && s.every((x) => typeof x === 'string'))) return c.json({ error: 'stacks: lists of PR ids' }, 400)
  const ps = (stacks as string[][]).map((s) => s.map((id) => pr(id)))
  const bad = (stacks as string[][]).flat().find((id) => { const p = pr(id); return !p || !config.repos[p.repo] || p.closed })
  if (bad) return c.json({ error: `${bad} can't be reviewed here (unknown, closed, or no local checkout)` }, 400)
  const lacks = [...new Set(ps.flat().map((p) => p!.mine ? 'revise' as const : 'review' as const))].flatMap((k) => missingFor(slot(k)))
  if (lacks.length) return c.json({ error: missingError(lacks) }, 400)
  for (const s of ps) {
    let prev: string | undefined
    for (const p of s) {
      enqueue(p!, p!.mine ? 'revise' : 'review', undefined, undefined, prev)
      prev = p!.id
    }
  }
  return c.json({ ok: true })
})

// Your PR: resume the revise session with the explicit go-ahead to publish.
app.post('/prs/:id/publish', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p?.mine) return c.json({ error: 'publish is for your own PRs' }, 400)
  if (!p.job?.reviewDone) return c.json({ error: 'run revise before publishing' }, 400)
  if (p.job.state === 'running' || p.job.state === 'queued') return c.json({ error: 'an agent run is already in progress' }, 409)
  // stacked on a PR that moved: you may ask for this branch to be rebased onto it first (the one rewrite you approve here)
  const { rebaseFirst } = await c.req.json<{ rebaseFirst?: boolean }>().catch(() => ({ rebaseFirst: false }))
  const first = rebaseFirst && p.behindBase
    ? `\n\nBefore pushing: this PR is stacked on \`${p.base}\`, which moved past this branch (the PR below was pushed or rebased). The author chose to rebase first. `
      + `Fetch, then rebase only this PR's own commits (the ones that are not in the PR below) onto origin/${p.base}, resolve any conflict keeping the intent of both sides, `
      + 'push with --force-with-lease (CI runs the checks on the push: no typecheck, lint or test suites here). That one rewrite of this branch is approved for this push; nothing else may be rewritten. '
      + 'Do not touch the PRs above: they will show as outdated and get their own smart rebase.'
    : ''
  enqueue(p, 'publish', config.agent.publish + first, first ? 'Rebase onto the PR below, push the fixes and post the drafted replies' : 'Push the fixes and post the drafted replies')
  return c.json({ ok: true })
})
// The PR overlay plus only the slice of the repo map it references.
app.get('/prs/:id/explain', (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  const overlay = loadOverlay(p)
  const all = loadNodes(p.repo)
  const paths = new Set(Object.entries(overlay?.facts.views ?? {}).flatMap(([d, v]) => [d, ...v.children.map((k) => k.drill ?? k.path), ...v.children.map((k) => k.path)]))
  const nodes = Object.fromEntries([...paths].filter((x) => all[x]).map((x) => [x, { summary: all[x].summary, responsibilities: all[x].responsibilities, businessRole: all[x].businessRole }]))
  return c.json({
    task: p.explain, overlay, skeleton: loadSkeleton(p.repo), nodes, stale: !!overlay && overlay.headSha !== p.headSha,
    base: { meta: loadBase(p.repo), waiting: !!p.explainAfterBase },
  })
})
// plans: a brief broken down with an agent, drawn live, then created in Linear (plans.ts)
const planErr = (c: Context, e: unknown) => c.json({ error: (e as Error).message }, 400)
// roles: the setups you joined, and who each skill belongs to (roles.ts)
app.get('/roles', async (c) => {
  const names = [...new Set([...(await scanSkills()).map((x) => x.name), ...Object.keys(roles().skills)])]
  return c.json({ ...roles(), base: baseSlots(), owners: Object.fromEntries(names.map((n) => [n, ownerOf(n)])) })
})
app.post('/roles', async (c) => { try { return c.json(setRoles(await c.req.json())) } catch (e) { return c.json({ error: (e as Error).message }, 400) } })
app.post('/roles/skill', async (c) => {
  const { name, owner } = await c.req.json<{ name: string; owner: Owner }>()
  try { setOwner(String(name), owner); return c.json({ ok: true, owner: ownerOf(name) }) } catch (e) { return c.json({ error: (e as Error).message }, 403) }
})
app.get('/plans', (c) => c.json({ plans: allPlans().map(({ id, title, method, nodes, busy, creating, at }) => ({ id, title, method, count: nodes.length, made: nodes.filter((n) => n.created).length, busy, creating, at })) }))
app.post('/plans', async (c) => { const b = await c.req.json<{ title?: string; brief?: string; method?: 'agile' | 'waterfall'; appetite?: number; org?: string }>(); return c.json(newPlan(b.title ?? '', b.brief ?? '', b.method, b.appetite, b.org)) })
// which organization a plan is for, and the compliance profile it is checked against (its own, the shared one, or off)
app.get('/plans/:id/checks', async (c) => {
  const p = planOf(c.req.param('id'))
  if (!p) return c.json({ error: 'No such plan' }, 404)
  const org = await planOrg(p), o = (await orgs().catch(() => [])).find((x) => x.owner === org)
  // where its tickets go: the organization's tracker (Linear, or GitHub issues in its first watched repository)
  return c.json({ org, tracker: o?.tracker ?? 'linear', repo: o?.tracker === 'github' ? o.repos[0] : undefined, profile: (await complianceFor(org)) ?? {} })
})
app.get('/plans/teams', async (c) => { try { return c.json({ teams: await linearTeams() }) } catch (e) { return planErr(c, e) } })
// an organization's projects, from where it manages its work: Linear's, or its GitHub Projects (orgs.ts). No organization
// given: Linear's, as before
app.get('/plans/projects', async (c) => {
  try {
    const owner = c.req.query('org'), o = owner ? (await orgs()).find((x) => x.owner === owner) : undefined
    if (o?.tracker === 'github') return c.json({ source: 'github', projects: (await githubProjects(o.owner, o.personal)).map((p) => ({ ...p, mine: false })) })
    return c.json({ source: 'linear', projects: await linearProjects() })
  } catch (e) { return planErr(c, e) }
})
app.get('/orgs', async (c) => c.json(await orgs()))
// workspaces (Settings → Workspaces): what to offer when adding one, adding or taking one away, and a workspace's
// repositories on GitHub to pick from
app.get('/workspaces/offers', async (c) => c.json(await workspaceOffers()))
app.post('/workspaces', async (c) => {
  const { owner, on } = await c.req.json<{ owner?: string; on?: boolean }>()
  if (!owner || !/^[\w.-]{1,100}$/.test(owner)) return c.json({ error: 'Which organization' }, 400)
  setWorkspace(owner, on !== false)
  return c.json(await orgs())
})
app.get('/workspaces/:owner/repos', async (c) => {
  const owner = c.req.param('owner')
  if (!/^[\w.-]{1,100}$/.test(owner)) return c.json({ error: 'Which organization' }, 400)
  try { return c.json(await ownerRepos(owner)) } catch (e) { return c.json({ error: `GitHub didn't list ${owner}'s repositories: ${(e as Error).message}` }, 502) }
})
app.post('/orgs', async (c) => {
  const { owner, tracker } = await c.req.json<{ owner?: string; tracker?: string }>()
  if (!owner || !/^[\w.-]+$/.test(owner) || (tracker !== 'linear' && tracker !== 'github')) return c.json({ error: 'An organization and linear or github' }, 400)
  setTracker(owner, tracker)
  return c.json(await orgs())
})
app.post('/plans/:id/project', async (c) => { try { const { project } = await c.req.json<{ project?: string }>().catch(() => ({ project: undefined })); if (!project) return c.json({ error: 'Which project?' }, 400); return c.json(withHistory(await linkProject(c.req.param('id'), project))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/sync', async (c) => { try { return c.json(withHistory(await syncProject(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/vision', async (c) => { try { return c.json(withHistory(await applyVision(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
app.get('/plans/:id', (c) => { const p = planOf(c.req.param('id')); return p ? c.json(withHistory(p)) : c.json({ error: 'No such plan' }, 404) })
app.post('/plans/:id', async (c) => { try { return c.json(withHistory(setPlan(c.req.param('id'), await c.req.json()))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/say', async (c) => { try { await talkPlan(c.req.param('id'), (await c.req.json<{ text: string }>()).text); return c.json(withHistory(planOf(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/scenario', async (c) => { try { return c.json(withHistory(setPlanScenario(c.req.param('id'), (await c.req.json<{ ops: PlanOp[] }>()).ops ?? []))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/scenario/add', async (c) => { try { return c.json(withHistory(addToScenario(c.req.param('id'), (await c.req.json<{ ops: PlanOp[] }>()).ops ?? []))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/scenario/apply', async (c) => { try { return c.json(await applyPlanScenario(c.req.param('id'))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/edit', async (c) => { try { return c.json(withHistory(editPlan(c.req.param('id'), (await c.req.json<{ ops: PlanOp[] }>()).ops))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/create', async (c) => { try { return c.json(withHistory(await createPlan(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/github-project', async (c) => { try { return c.json(withHistory(await addPlanToProject(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/undo', (c) => { try { return c.json(withHistory(undoRedoPlan(c.req.param('id'), true))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/redo', (c) => { try { return c.json(withHistory(undoRedoPlan(c.req.param('id'), false))) } catch (e) { return planErr(c, e) } })
app.post('/plans/:id/remove', (c) => { removePlan(c.req.param('id')); return c.json({ ok: true }) })
// the product lens (Product and Design roles): kept per PR, written on request from what is already known
app.get('/prs/:id/domain', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  const d = await domainOf(p.id)
  return c.json({ domain: d ?? null, stale: !!d && d.headSha !== p.headSha, writing: writingDomain(p.id), explained: !!loadOverlay(p) })
})
app.post('/prs/:id/domain', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  const tickets = ticketsOf(p).map((t) => `- ${t.id} ${t.title}\n${t.description.slice(0, 2000)}`).join('\n') || '(none)'
  const context = `The change: "${p.title}" in ${p.repo}.\n\nIts description:\n${(p.body ?? '').slice(0, 4000) || '(none)'}\n\nThe tickets it names:\n${tickets}`
    + `\n\nWhat an engineer's explanation of it says:\n${await explainedOf(p.id)}`
  writeDomain(p.id, p.headSha, context, (r) => { addSpend(r.costUsd, r.provider, r.tokens); save(); bus.emit('health') },
    (e) => console.error(`domain ${p.id}: ${e.message}`))
  return c.json({ ok: true })
})
app.get('/exec/tickets/:id/domain', async (c) => {
  const t = ticketViews().find((x) => x.id === c.req.param('id'))
  if (!t) return c.json({ error: 'No such ticket' }, 404)
  const key = `ticket:${t.id}`, d = await domainOf(key)
  return c.json({ domain: d ?? null, stale: !!d && d.headSha !== ticketVersion(t), writing: writingDomain(key), explained: t.prs.some((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return !!p && !!loadOverlay(p) }) })
})
app.post('/exec/tickets/:id/domain', async (c) => {
  const t = ticketViews().find((x) => x.id === c.req.param('id'))
  if (!t) return c.json({ error: 'No such ticket' }, 404)
  const explained = await Promise.all(t.prs.map(async (x) => `#${x.number}: ${await explainedOf(`${x.repo}#${x.number}`)}`))
  const context = `The change: the ticket ${t.id} "${t.title}".\n\nThe ticket:\n${t.description.slice(0, 5000) || '(no description)'}`
    + `\n\nIts pull requests, as an engineer's explanation describes them:\n${explained.join('\n\n') || '(none yet: read only the ticket)'}`
  writeDomain(`ticket:${t.id}`, ticketVersion(t), context, (r) => { addSpend(r.costUsd, r.provider, r.tokens); save(); bus.emit('health') },
    (e) => console.error(`domain ${t.id}: ${e.message}`))
  return c.json({ ok: true })
})
// what a ticket's lens was written from: its PRs' heads (none: the ticket alone)
const ticketVersion = (t: { prs: { repo: string; number: number }[] }) => t.prs.map((x) => state.prs[`${x.repo}#${x.number}`]?.headSha.slice(0, 7) ?? x.number).join(',') || 'ticket'
app.get('/prs/:id/turns', (c) => { const p = pr(c.req.param('id')); return c.json({ turns: (p && state.turns?.[p.id]?.list) ?? [] }) })
// the stack's tour: cached (and whether it still matches the stack), or written on request (about a cent)
app.get('/prs/:id/stack-tour', (c) => {
  const p = pr(c.req.param('id'))
  if (!p?.stack) return c.json({ error: 'not in a stack' }, 404)
  return c.json({ tour: cachedStackTour(p.stack) ?? null, writing: writingStackTour(p.stack) })
})
app.post('/prs/:id/stack-tour', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p?.stack) return c.json({ error: 'not in a stack' }, 404)
  return makeStackTour(p.stack).then((t) => {
    addSpend(t.costUsd, t.provider, t.tokens); save(); bus.emit('health')
    return c.json({ tour: t })
  }, (e: Error) => c.json({ error: e.message }, 502))
})
/** Every PR of the tree `p` sits in, as refs, each after the one it is built on (PRs built on the same one are one stack). */
function treeChain(p: Pr): StackRef[] {
  const root = (x: Pr) => x.stack?.[0].number ?? x.number
  const refs = new Map<number, StackRef>()
  for (const x of Object.values(state.prs)) if (!x.closed && x.repo === p.repo && root(x) === root(p)) for (const r of x.stack ?? []) if (!refs.has(r.number)) refs.set(r.number, r)
  const byHead = new Map([...refs.values()].map((r) => [r.head, r])), out: StackRef[] = [], seen = new Set<number>()
  const walk = (r: StackRef) => { if (seen.has(r.number)) return; seen.add(r.number); out.push(r); for (const k of [...refs.values()].filter((x) => x.base === r.head).sort((a, b) => a.number - b.number)) walk(k) }
  for (const r of [...refs.values()].filter((x) => !byHead.has(x.base)).sort((a, b) => a.number - b.number)) walk(r)
  for (const r of refs.values()) walk(r)
  return out
}
// across a stack: where its PRs disagree with each other (stackCheck.ts). A PR in no stack has nothing to compare
app.get('/prs/:id/stack-check', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p?.stack) return c.json({ check: null, checking: false, direction: null })
  return c.json({ check: (await cachedStackCheck(treeChain(p))) ?? null, checking: checkingStack(treeChain(p)), direction: directionOf(p) ?? null })
})
app.post('/prs/:id/stack-check', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p?.stack) return c.json({ error: 'not in a stack' }, 404)
  const chain = treeChain(p), had = directionOf(p)
  return checkStack(chain, had?.by === 'you' ? had.text : '').then((t) => {
    addSpend(t.costUsd, t.provider, t.tokens)
    // the check's reading becomes the stack's direction unless you wrote one yourself: yours stands until you change it
    if (t.direction && had?.by !== 'you') setDirection(chain, t.direction, 'check')
    save(); bus.emit('health')
    return c.json({ check: { ...t, stale: false }, direction: directionOf(p) ?? null })
  }, (e: Error) => c.json({ error: e.message }, 400))
})
// the stack's direction in your own words (none: it is dropped, and the next check writes one again)
app.post('/prs/:id/stack-direction', async (c) => {
  const p = pr(c.req.param('id'))
  const { text, append } = await c.req.json<{ text?: string; append?: string }>()
  if (!p?.stack) return c.json({ error: 'not in a stack' }, 404)
  // append: what you just decided for the stack, kept on top of the direction it had, so no agent of it asks again
  const had = directionOf(p)?.text ?? ''
  const next = append !== undefined ? [had, ...String(append).split('\n').map((l) => l.trim()).filter((l) => l && !had.includes(l))].filter(Boolean).join('\n') : String(text ?? '')
  setDirection(treeChain(p), next, 'you')
  return c.json({ direction: directionOf(p) ?? null })
})
// what a stack's agents wait on, boiled down to a few decisions and steps (stackPlan.ts); `again`: read afresh
app.post('/stacks/plan', async (c) => {
  const b = await c.req.json<{ items?: PlanItem[]; steer?: string; again?: boolean; pr?: string }>().catch(() => ({} as { items?: PlanItem[]; steer?: string; again?: boolean; pr?: string }))
  const items = b.items
  if (!Array.isArray(items) || items.length < 2 || items.length > 200 || items.some((x) => typeof x?.id !== 'string' || typeof x.text !== 'string' || !['decide', 'do', 'publish'].includes(x.kind))) return c.json({ error: 'items: the steps, each with an id, a kind and its text' }, 400)
  const of = b.pr ? pr(b.pr) : undefined
  return planStack(items, String(b.steer ?? '').slice(0, 4000), (of && directionOf(of)?.text) || '', !!b.again).then(({ costUsd, provider, tokens, ...plan }) => {
    if (costUsd) { addSpend(costUsd, provider, tokens); save(); bus.emit('health') }
    return c.json(plan)
  }, (e: Error) => c.json({ error: e.message }, 502))
})
app.get('/prs/:id/diff', async (c) => {
  const p = pr(c.req.param('id'))
  const path = c.req.query('path') ?? ''
  const o = p && loadOverlay(p)
  const repo = p && config.repos[p.repo]
  if (p && !checkedOut(p.repo)) return c.json({ error: `${p.repo} isn't checked out on this machine: ${heldWhy(p.repo) ?? 'its diff is read where it is'}` }, 409)
  if (!o || !repo || !o.facts.changes.some((x) => x.path === path)) return c.json({ error: 'not a file this PR changes' }, 404)
  const diff = await git(repo, 'diff', '--no-color', '-U3', o.baseSha, o.headSha, '--', path).catch((e: Error) => `could not read the diff: ${e.message}`)
  return c.json({ diff: diff.length > 60_000 ? diff.slice(0, 60_000) + '\n… (cut: open it on GitHub for the rest)' : diff })
})
// explain a stacked PR with everything below it: the missing or outdated ones first, bottom up (enqueueExplain orders it)
app.post('/prs/:id/explain-stack', (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  enqueueExplain(p)
  return c.json({ ok: true })
})
app.post('/prs/:id/explain-follow', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  const { on } = await c.req.json<{ on?: boolean }>()
  p.explainFollow = on === true
  // switched on behind the latest commit: catch up now
  if (p.explainFollow && p.explain && p.explain.headSha !== p.headSha && (p.explain.state === 'done' || p.explain.state === 'failed')) enqueueExplain(p)
  save(); bus.emit('change')
  return c.json({ ok: true })
})
app.post('/prs/:id/explain', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  if (!config.repos[p.repo]) return c.json({ error: `no local checkout for ${p.repo} in config.json` }, 400)
  const { fresh, cancel: stop, afterBase } = await c.req.json().catch(() => ({})) as { fresh?: boolean; cancel?: boolean; afterBase?: boolean }
  if (stop) { cancelExplain(p); p.explainAfterBase = false; save(); bus.emit('change') }
  else if (afterBase) explainAfterBase(p, true)
  else enqueueExplain(p, !!fresh)
  return c.json({ ok: true })
})

// --- what a finished run waits on, and answering it -------------------------------------------
/** The run's final message: stored since this feature, else the last result in its log. */
const finalMessage = (job: { summary?: string } | undefined, feedId: string) =>
  job?.summary ?? [...activity(feedId)].reverse().find((a) => a.kind === 'result')?.text
const stepsFor = async (holder: { summary?: string; next?: NextSteps; state: string } | undefined, feedId: string) => withoutCiWatch(await stepsOf(holder, feedId))
async function stepsOf(holder: { summary?: string; next?: NextSteps; state: string } | undefined, feedId: string) {
  if (!holder || holder.state === 'running' || holder.state === 'queued') return null
  const msg = finalMessage(holder, feedId)
  // the agent's own block, or read before (one saved before checklists: its decisions and moves as one)
  if (msg && holder.next?.for === hashOf(msg)) return holder.next.steps ? holder.next : { ...holder.next, steps: toSteps(holder.next.decisions, holder.next.actions) }
  if (!msg || msg.length < 40) return null
  holder.next = await nextSteps(msg)
  if (holder.next.costUsd || holder.next.tokens) addSpend(holder.next.costUsd ?? 0, holder.next.provider, holder.next.tokens)
  save()
  return holder.next
}
// each PR has its own agent: one never changes another PR's branch, it names the work and Concierge hands it over
const OWN_PR = 'Change only this PR\'s branch. Work that belongs to another of my PRs goes to that PR\'s own agent: name it as a next step for that PR (with its #number) instead of doing it here. Work on someone else\'s PR is never an agent\'s: offer to draft a comment to its author instead. Never suggest again a step that was already handed over. '
const REPLY_NOTE = '\n\n(Sent from Concierge: this is my answer to your last message. Carry on from where you stopped. '
  + OWN_PR + 'Push, post or submit only if I said so above.)'
const AFTER_NOTE = '\n\n(Sent from Concierge while you were finishing that run: carry on from where you ended, with this in mind. '
  + 'Push, post or submit only if I said so above.)'
// words for an exec run that was wrapping up: once it ends, its session goes on with them (on a re-read of the run,
// so its cost then is the one carried over)
const continueExec = (run: ExecRun) => (t: string) => {
  const r = state.execs[run.id] ?? run
  if (!enqueueExec(r.ids, r.repo, false, { label: 'Your steer', prompt: t + AFTER_NOTE, resume: r.sessionId, said: t, costBefore: (r.costBefore ?? 0) + (r.costUsd ?? 0), allowedTools: r.allowedTools })) note(`exec:${r.id}`, { at: new Date().toISOString(), kind: 'error', text: `Your words didn't reach it (the ticket is busy again): ${t.slice(0, 200)}` })
}

// a stack's waiting steps, read together: which are the same action and which can't both happen (stackSteps.ts)
app.post('/stacks/steps-review', async (c) => {
  const { items } = await c.req.json<{ items?: StackItem[] }>().catch(() => ({ items: undefined }))
  if (!Array.isArray(items) || items.length > 200 || items.some((x) => typeof x?.id !== 'string' || typeof x.text !== 'string')) return c.json({ error: 'items: the steps, each with an id and its text' }, 400)
  const r = await reviewStack(items.map((x) => ({ id: x.id, pr: Number(x.pr) || 0, text: x.text.slice(0, 500), kind: String(x.kind ?? 'do'), options: Array.isArray(x.options) ? x.options.slice(0, 6).map(String) : undefined })))
  if (r.costUsd || r.tokens) { addSpend(r.costUsd, r.provider, r.tokens); save() }
  return c.json({ duplicates: r.duplicates, conflicts: r.conflicts })
})
app.get('/prs/:id/next', async (c) => {
  const p = pr(c.req.param('id'))
  try {
    if (p && answered(p)) return c.json({ steps: null }) // answered with the whole stack: its agent took them up
    const n = await stepsFor(p?.job, p?.id ?? '')
    // a step already handed over isn't offered again: the same wording, compared by hash (case, punctuation and spacing
    // aside), so a new suggestion worded the same is recognised and one worded differently is shown
    const gone = new Set((p?.handoffs ?? []).map((h) => stepHash(h.text)))
    const handed = (text: string) => gone.has(stepHash(text))
    return c.json({ steps: n && gone.size ? { ...n, steps: (n.steps ?? []).filter((x) => !handed(x.text)) } : n })
  } catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
// hand linked work from one agent to the other: the source's latest word goes to the target's own session, which
// continues; the source stops being the one that acts. Refused while either is working (stop it first).
app.post('/handoff', async (c) => {
  const { from, to } = await c.req.json<{ from?: { kind: string; id: string }; to?: { kind: string; id: string } }>()
  if (!from || !to) return c.json({ error: 'Say who hands over to whom' }, 400)
  const side = (x: { kind: string; id: string }) => x.kind === 'pr'
    ? (() => { const p = state.prs[x.id]; return p && { name: `PR #${p.number}`, said: p.job?.summary, busy: p.job?.state === 'running' || p.job?.state === 'queued', p } })()
    : (() => { const t = execBoard.tickets.find((y) => y.id === x.id); const r = t && ticketViews().find((y) => y.id === t.id)?.run; return t && { name: `ticket ${t.id}`, said: r?.summary, busy: ticketBusy(t.id), t, r } })()
  const a = side(from), b = side(to)
  if (!a || !b) return c.json({ error: 'Unknown item' }, 404)
  if (a.busy) return c.json({ error: `The ${a.name} agent is still working; let it finish or stop it first` }, 409)
  if (b.busy) return c.json({ error: `The ${b.name} agent is working; let it finish first` }, 409)
  const msg = `Handover from the agent on ${a.name}: it stops here, and you continue this work from where it left off.`
    + (a.said ? `\n\nIts latest report:\n${a.said.slice(0, 5000)}` : '\n\n(It has no report yet.)')
    + '\n\nCheck the current state of the branch and threads first, keep what it did, and do not redo it.'
  const said = `Handover from ${a.name}`
  // noted on the giving side only once the handover happened
  const fromFeed = 'p' in a ? a.p!.id : 'r' in a && a.r ? `exec:${a.r.id}` : undefined // a ticket's timeline is its runs'
  const done = () => { if (fromFeed) logged(fromFeed, `Handed over to ${b.name}`) }
  if ('p' in b && b.p) {
    if (!b.p.job?.sessionId) return c.json({ error: `${b.name} has no agent session yet; run it first` }, 400)
    enqueue(b.p, 'reply', msg + REPLY_NOTE, said)
    done()
    return c.json({ ok: true })
  }
  const t = 't' in b ? b.t : undefined, r = 'r' in b ? b.r : undefined
  const repo = t && repoFor(t.id, config.exec.repoByPrefix)
  if (!t || !repo) return c.json({ error: 'No repository mapped for that ticket' }, 400)
  const run = enqueueExec([t.id], repo, false, { label: 'Handover', prompt: msg + REPLY_NOTE, said, ...(r && { resume: r.sessionId, costBefore: (r.costBefore ?? 0) + (r.costUsd ?? 0) }) })
  if (run) done()
  return run ? c.json({ ok: true, run }) : c.json({ error: 'Could not start the ticket agent' }, 400)
})
app.post('/prs/:id/reply', async (c) => {
  const p = pr(c.req.param('id'))
  const { text } = await c.req.json() as { text?: string }
  const msg = typeof text === 'string' ? text.trim().slice(0, 6000) : ''
  if (!p) return c.json({ error: 'Unknown PR' }, 404)
  if (!msg) return c.json({ error: 'Pick something or write your answer' }, 400)
  rememberSaid(`pr:${p.id}`, msg)
  const linked = linkMentions(`pr:${p.id}`, msg, p.repo)
  // steps that name another open PR of the same repo go to that PR's agent, as a handover with this one's last word
  // only my own PRs have an agent of mine to take work; a review PR's agent reviews, and someone else's branch isn't ours
  const peers = new Map(Object.values(state.prs).filter((x) => x.repo === p.repo && !x.closed && x.id !== p.id && x.mine).map((x) => [x.number, x]))
  // a step for a PR that isn't mine (someone else's, or not tracked): no agent can take it, so this agent drafts a
  // comment to that PR's author instead of being told to do it (which it would refuse, and suggest again)
  const route = routeSteps(msg, p.number, new Set(peers.keys()))
  const { there } = route, foreign = { here: route.here, there: route.foreign }
  const askAuthor = [...foreign.there].map(([n, lines]) => `For #${n}, which isn't my PR (no agent of mine works on it, and its branch isn't ours): draft a short comment to its author asking for the following, show it to me, and don't post it or change their branch.\n${lines.join('\n')}`)
  const here = [foreign.here, ...askAuthor].filter(Boolean).join('\n\n')
  const record = (to: number, lines: string[]) => { p.handoffs = [...(p.handoffs ?? []), ...lines.map((l) => ({ to, text: l.replace(/^- /, ''), at: new Date().toISOString() }))].slice(-20) }
  for (const [n, lines] of [...there, ...foreign.there]) record(n, lines)
  for (const [n, lines] of there) {
    const t = peers.get(n)!
    const ctx = p.job?.summary ? `\n\nWhat the agent on #${p.number} said last, for context:\n${p.job.summary.slice(0, 3000)}` : ''
    sendReply(t, `Handed over from the agent on #${p.number} ("${p.title}"): do these here, on this PR.\n${lines.join('\n')}${ctx}`)
    logged(p.id, `Handed over to #${n}'s agent: ${lines.map((l) => l.replace(/^- /, '')).join('; ')}`)
  }
  // what went over is done here: those steps leave this PR's Next panel (a reply here brings a new list anyway)
  const moved = new Set([...there.values(), ...foreign.there.values()].flat().map((l) => stepHash(l.replace(/^- /, ''))))
  if (moved.size && p.job?.next) {
    const n = p.job.next, was = (t?: string) => !!t && moved.has(stepHash(t))
    p.job.next = { ...n, steps: (n.steps ?? []).filter((x) => !was(x.text)), actions: n.actions.filter((x) => !was(x.label) && !was(x.reply)) }
    save(); bus.emit('change')
  }
  if (there.size || foreign.there.size) save()
  const handedOver = [...there.keys()]
  return c.json({ ok: true, handedOver, askAuthor: [...foreign.there.keys()], sent: here ? sendReply(p, here + linked + handedNote(p)) : undefined })
})
/**
 * Your words for work still in the queue: kept on it (they survive a restart) and shown in its feed now, then told to
 * it between its first steps once it starts; one that is already done by then gets them as a reply, like any run.
 */
function holdWords(holder: { heldWords?: string[] }, key: string, text: string) {
  (holder.heldWords ??= []).push(text)
  note(key, { at: new Date().toISOString(), kind: 'you', text })
  note(key, { at: new Date().toISOString(), kind: 'event', text: 'It waits in the queue: it reads this the moment it starts.' })
  save(); bus.emit('change'); bus.emit('exec')
}
function sayHeld(holder: { heldWords?: string[] }, key: string, then: (t: string) => void) {
  const words = holder.heldWords
  if (!words?.length) return
  delete holder.heldWords; save()
  // the started signal comes just before its agent does: give it a moment to be there to tell
  // its agent already gone by then (it failed at once, or was requeued): the words go the way a reply does, not nowhere
  setTimeout(() => { for (const w of words) if (tell(key, w, then, true) === 'idle') then(w) }, 1500)
}
bus.on('started', (id: string, job: Job) => { const p = state.prs[id]; if (p) sayHeld(job, id, (t) => enqueue(p, 'reply', t + REPLY_NOTE, t)) })
bus.on('exec-started', (run: ExecRun) => sayHeld(run, `exec:${run.id}`, continueExec(run)))
/** What this PR's agent already sent elsewhere, so it doesn't suggest it again. */
const handedNote = (p: Pr) => p.handoffs?.length
  ? `\n\n(Already handed over, so don't suggest these again: ${p.handoffs.slice(-8).map((h) => `#${h.to}: ${h.text}`).join('; ')})` : ''
/** Your words to a PR's agent: they start a run, reach the running one between steps, or replace a queued start. */
// one message to a whole stack: each PR's agent gets it in its own conversation, told that it is one of several
export const STACK_MARK = '\n\n(To the whole stack'
app.post('/stacks/say', async (c) => {
  const { ids, text } = await c.req.json() as { ids?: unknown; text?: unknown }
  const msg = typeof text === 'string' ? text.trim().slice(0, 6000) : ''
  if (!msg) return c.json({ error: 'Write what the stack should do' }, 400)
  const ps = (Array.isArray(ids) ? ids : []).map((id) => (typeof id === 'string' ? pr(id) : undefined)).filter((p): p is Pr => !!p && !p.closed && !!config.repos[p.repo])
  if (!ps.length) return c.json({ error: 'None of these pull requests can take a message here (unknown, closed, or no local checkout)' }, 400)
  const chain = ps.map((p) => `#${p.number}`).join(' → ')
  const sent = ps.map((p) => ({ number: p.number, how: sendReply(p, `${msg}${STACK_MARK}, bottom first: ${chain}. You work on #${p.number}. Do the part of this that belongs to #${p.number}; when none of it does, say so in one line and change nothing. The agents on the other pull requests got the same message, each for its own.)`) }))
  return c.json({ sent })
})
// one agent for the whole stack (the drive-stack skill): it works bottom-up through every PR, settles what crosses them,
// restacks and checks again after each, and ends done or with one question. One run instead of a resume per PR's agent
// a PR's agent's questions are answered once the stack was resolved after it finished: the stack's run took them up
// (a new run of the PR's own ends later, and asks anew)
const answeredAt = (p: Pr) => {
  if (!p.job?.endedAt || !p.stack || p.stack.length < 2) return undefined
  const r = driveOf(driveKey(p))
  return r?.queuedAt && r.queuedAt > p.job.endedAt ? r.queuedAt : undefined
}
const answered = (p: Pr) => !!answeredAt(p)
const driveKey = (p: Pr) => { const c = treeChain(p); return `STACK-${p.repo.split('/')[1]}-${c[0]?.number ?? p.number}` }
// each stack's latest drive, from one pass over the runs, kept half a second: every PR of the list asks (profiled: a
// scan of every run per PR was the PR list's heaviest part)
let drives: { at: number; n: number; by: Map<string, ExecRun> } | undefined
const driveOf = (key: string) => {
  const n = Object.keys(state.execs).length
  if (!drives || drives.n !== n || Date.now() - drives.at > 500) {
    const by = new Map<string, ExecRun>()
    for (const r of Object.values(state.execs)) { const k = r.ids[0]; if (k?.startsWith('STACK-') && (!by.has(k) || (r.queuedAt ?? '') > (by.get(k)!.queuedAt ?? ''))) by.set(k, r) }
    drives = { at: Date.now(), n, by }
  }
  return drives.by.get(key)
}
app.get('/stacks/drive', (c) => {
  const p = pr(c.req.query('pr') ?? '')
  const r = p && driveOf(driveKey(p))
  return c.json({ run: r ? { id: r.id, state: r.state, summary: r.summary?.slice(-1500), costUsd: r.costUsd, at: r.endedAt ?? r.startedAt ?? r.queuedAt } : null })
})
app.post('/stacks/drive', async (c) => {
  const b = await c.req.json<{ pr?: string; text?: string; push?: boolean }>().catch(() => ({} as { pr?: string; text?: string; push?: boolean }))
  const p = b.pr ? pr(b.pr) : undefined
  if (!p || !config.repos[p.repo]) return c.json({ error: 'Unknown pull request, or no local checkout for its repository' }, 400)
  const key = driveKey(p)
  if (ticketBusy(key)) return c.json({ error: 'The stack already has a run going: it reads new words once it ends' }, 409)
  if (b.text?.trim()) rememberSaid(`pr:${p.id}`, b.text)
  const chain = treeChain(p), dir = directionOf(p)?.text, check = await cachedStackCheck(chain)
  const lines = chain.map((s, i) => { const t = state.prs[`${s.repo}#${s.number}`]; return `${i + 1}. #${s.number} "${s.title}" branch ${t?.head ?? '?'} into ${s.base}${t?.mine ? '' : " (not the person's: never change it)"}` })
  const parts = chain.map((s, i) => partOf(s, i, state.prs[`${s.repo}#${s.number}`]).text)
  const words = String(b.text ?? '').trim().slice(0, 12_000)
  const prompt = [`Use the drive-stack skill. The stack in ${p.repo}, bottom first:\n${lines.join('\n')}`,
    dir && `The direction the stack follows:\n${dir}`,
    words && `What the person says now (their answers and steer; it wins over the PRs' own notes):\n${words}`,
    driveOf(key)?.summary && `The last stack run ended with this (continue from its worktree and branches; don't redo what it did):\n${driveOf(key)!.summary!.slice(-6000)}`,
    check?.issues.length ? `The agreement check found (it may be out of date: verify against the branches):\n${check.issues.map((x) => `- ${x.title} (${x.prs.map((n) => `#${n}`).join(', ')}): ${x.why} Fix: ${x.fix}`).join('\n')}` : '',
    `What each PR's own agent last found and left open:\n${parts.join('\n\n')}`,
    // the Work's memory: what was said and decided on any of its parts (tickets included) holds for the whole stack
    (() => { const { w, members } = workOfMember(`pr:${p.id}`); return workBrief(w, members, `pr:${p.id}`).trim() })(),
    b.push ? 'Push each changed branch when its part is done (with lease).' : 'Do not push: commit in the worktrees and report the shas.',
  ].filter(Boolean).join('\n\n')
  const run = enqueueExec([key], p.repo, false, { label: 'Resolve stack', prompt, said: words || 'Resolve the stack', role: 'stack' })
  return run ? c.json({ ok: true, run: { id: run.id, state: run.state } }) : c.json({ error: 'Could not start the stack run' }, 400)
})
function sendReply(p: Pr, msg: string): string | undefined {
  // no run has worked on it yet: your words start one
  if (!p.job?.sessionId) {
    enqueue(p, 'reply', `${msg}\n\n(Sent from Concierge about ${p.mine ? 'my' : 'a'} pull request ${p.url}: "${p.title}", branch ${p.head} into ${p.base}. `
      + 'Read it with gh and the checkout here before acting. ' + OWN_PR + 'Push, post or submit only if I said so above.)', msg)
    return 'started'
  }
  // a running agent is never stopped: it reads your words between steps, or gets them the moment it ends
  if (p.job.state === 'running') { const sent = tell(p.id, msg, (t) => enqueue(p, 'reply', t + REPLY_NOTE, t)); if (sent !== 'idle') return sent }
  // not started yet: your words wait with it, and it reads them the moment it starts
  if (p.job.state === 'queued') { holdWords(p.job, p.id, msg); return 'queued' }
  enqueue(p, 'reply', msg + REPLY_NOTE, msg)
  return 'started'
}
app.get('/exec/:run/next', async (c) => {
  const run = state.execs[c.req.param('run')]
  try { return c.json({ steps: await stepsFor(run, `exec:${run?.id}`) }) } catch (e) { return c.json({ error: (e as Error).message }, 502) }
})
app.post('/exec/:run/reply', async (c) => {
  const run = state.execs[c.req.param('run')]
  const { text } = await c.req.json() as { text?: string }
  const msg = typeof text === 'string' ? text.trim().slice(0, 6000) : ''
  if (!run) return c.json({ error: 'Unknown run' }, 404)
  if (!msg) return c.json({ error: 'Pick something or write your answer' }, 400)
  for (const id of run.ids) if (execBoard.tickets.some((t) => t.id === id)) { rememberSaid(`ticket:${id}`, msg); linkMentions(`ticket:${id}`, msg, run.repo); break }
  // still at it: a running one reads your words between steps; a queued one, the moment it starts
  if (run.state === 'queued') { holdWords(run, `exec:${run.id}`, msg); return c.json({ ok: true, sent: 'queued' }) }
  if (run.state === 'running') { const sent = tell(`exec:${run.id}`, msg, continueExec(run)); if (sent !== 'idle') return c.json({ ok: true, sent }) }
  // a ticket of this run that another run works on now: your words reach that run between its steps, and this one
  // leaves it alone, instead of the whole reply being refused
  const busy = run.ids.filter(ticketBusy), free = run.ids.filter((id) => !busy.includes(id))
  for (const id of busy) {
    const other = Object.values(state.execs).find((r) => (r.state === 'running' || r.state === 'queued') && r.ids.includes(id))
    if (other) tell(`exec:${other.id}`, `My answer, given on an earlier run that also held ${id} (what concerns ${id} is yours):\n${msg}`, continueExec(other))
  }
  if (!free.length) return c.json({ ok: true, passedTo: busy })
  const elsewhere = busy.length ? `\n\n(${busy.join(', ')} ${busy.length === 1 ? 'is' : 'are'} being worked on by another run right now, which got this answer too: leave ${busy.length === 1 ? 'it' : 'them'} alone here.)` : ''
  const next = enqueueExec(free, run.repo, false, {
    label: 'Your reply', prompt: msg + elsewhere + REPLY_NOTE, said: msg, resume: run.sessionId, costBefore: (run.costBefore ?? 0) + (run.costUsd ?? 0), batch: run.batch, role: run.role, // a reply to a prep or a stacked ticket still moves its batch on
  })
  return next ? c.json({ run: next, passedTo: busy }) : c.json({ error: 'Could not resume the session' }, 400)
})

// Steer a ticket from the dock whatever state it is in: a running agent is stopped first, then the ticket's one
// session continues with your direction; a ticket never run here gets a run told where its work lives.
app.post('/exec/tickets/:id/steer', async (c) => {
  const t = ticketViews().find((x) => x.id === c.req.param('id'))
  const { text } = await c.req.json() as { text?: string }
  const msg = typeof text === 'string' ? text.trim().slice(0, 6000) : ''
  if (!t) return c.json({ error: 'Unknown ticket' }, 404)
  if (!msg) return c.json({ error: 'Write your direction first' }, 400)
  if (!t.repo) return c.json({ error: `No repository mapped for ${t.team}` }, 400)
  if (ticketBusy(t.id) && t.run) { // a parked ticket still lives in its run: your words go there
    const run = state.execs[t.run.id]
    // queued, not started: your direction waits with it, and it reads it the moment it starts
    if (run?.state === 'queued') { holdWords(run, `exec:${run.id}`, msg); return c.json({ ok: true, sent: 'queued' }) }
    const sent = run ? tell(`exec:${run.id}`, msg, continueExec(run)) : 'idle'
    if (sent !== 'idle') return c.json({ ok: true, sent })
    for (let i = 0; i < 40 && ticketBusy(t.id); i++) await new Promise((r) => setTimeout(r, 250))
    if (ticketBusy(t.id)) return c.json({ error: 'The agent is busy; try again in a moment' }, 409)
  }
  const pr = t.pr ?? t.run?.prs[0]
  // the ticket's session (sessionOf, inside enqueueExec) already knows the ticket; a fresh one is told where the work is
  const where = `${t.id} "${t.title}" (${t.url})${pr ? `; its PR is ${pr.url}${t.branch ? ` on branch ${t.branch}` : ''}` : ''}`
  const prompt = `Direction from the ticket owner for ${where}:\n\n${msg}\n\nApply it to the existing implementation: work on the ticket's branch the way your exec command does (worktree, checks), `
    + `then update the PR (follow the repo's rules for amending or adding commits, and never rewrite history others built on). End with what changed.`
  const run = enqueueExec([t.id], t.repo, false, { label: 'Your direction', prompt, said: msg })
  return run ? c.json({ run }) : c.json({ error: 'Could not start the run' }, 400)
})

// crit stopped (crashed, rebooted, Finish with nothing open…): reattach the same session on the same port
app.post('/prs/:id/crit-restart', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  // the same tracked path as Tools → Restart crit, so it shows in Activity
  return runAction(p, 'crit-restart', 'this').then(() => c.json({ ok: true }), (e: Error) => c.json({ error: e.message }, 409))
})

// the tools menu: what can be done to this PR, its stack, or all of them, and running one
// put a failed tool run away (its story stays in Activity)
// what waits on you needs no answer (a status note, "holding approval until…"): it stops waiting, without a run
app.post('/prs/:id/read', async (c) => {
  const p = pr(c.req.param('id'))
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  // these comments, by id, need no answer (a new one there counts again); the time still covers review bodies
  markNotWaiting(p.waitingIds ?? []); p.readAt = new Date().toISOString(); logged(p.id, 'Marked what waited on you as needing no answer')
  save(); await refreshOne(p.id).catch((e) => console.error('refresh', p.id, e.message)); bus.emit('change')
  return c.json({ ok: true })
})
app.post('/prs/:id/op/dismiss', (c) => { ops.delete(decodeURIComponent(c.req.param('id'))); bus.emit('change'); return c.json({ ok: true }) })
app.get('/prs/:id/actions', (c) => {
  const p = pr(c.req.param('id'))
  return p ? c.json(actionsFor(p)) : c.json({ error: 'unknown PR' }, 404)
})
app.post('/prs/:id/actions', async (c) => {
  const p = pr(c.req.param('id'))
  const { action, scope } = await c.req.json<{ action: string; scope: Scope }>()
  if (!p) return c.json({ error: 'unknown PR' }, 404)
  return runAction(p, action, scope).then((r) => c.json(r), (e: Error) => c.json({ error: e.message }, 400))
})

app.post('/prs/:id/cancel', (c) => {
  const p = pr(c.req.param('id'))
  if (p) { cancel(p); logged(p.id, 'You cancelled the run') }
  return c.json({ ok: true })
})
app.post('/prs/:id/dismiss', (c) => {
  const p = pr(c.req.param('id'))
  if (p) { cancel(p); p.dismissed = true; logged(p.id, 'Dismissed until it is requested again'); save(); bus.emit('change') }
  return c.json({ ok: true })
})
app.post('/prs/:id/resume-terminal', (c) => {
  const p = pr(c.req.param('id'))
  const repoPath = p && config.repos[p.repo]
  if (!p?.job || !repoPath) return c.json({ error: 'no session to resume' }, 400)
  // repoPath comes from config.json and sessionId is a UUID we made: nothing user-controlled reaches the shell.
  const out = resume(c, `cd ${JSON.stringify(repoPath)} && claude --resume ${p.job.sessionId}`)
  if (out.opened) logged(p.id, `Session opened in your terminal (claude --resume ${p.job.sessionId.slice(0, 8)}…)`)
  return c.json(out)
})

// The PR list, worked out once for every open page and sent as patches: each page gets the whole list when it
// connects, then only the PRs that changed and the ones that went. Recomputed after a change (several in a row make
// one) and every 4s (crit's state lives on disk, with nothing to say it changed).
const prsHub = (() => {
  let byId = new Map<string, string>(), list: PrView[] = [], order = ''
  const pages = new Set<(event: 'prs-patch', data: string) => void>()
  let soon: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    soon = undefined
    const t = performance.now()
    const next = views()
    const nextById = new Map(next.map((p) => [p.id, JSON.stringify(p)]))
    const set = next.filter((p) => byId.get(p.id) !== nextById.get(p.id))
    const del = [...byId.keys()].filter((id) => !nextById.has(id))
    const nextOrder = next.map((p) => p.id).join('\n')
    slow('views (live update)', t)
    if (!set.length && !del.length && nextOrder === order) return
    byId = nextById; list = next; order = nextOrder
    const data = JSON.stringify({ set, del, order: next.map((p) => p.id) })
    for (const send of pages) send('prs-patch', data)
  }
  bus.on('change', () => { soon ??= setTimeout(refresh, 400) }) // a run's burst of changes is one rebuild: views() is the server's heaviest read
  setInterval(() => { if (pages.size) refresh() }, 4000).unref()
  return {
    join(send: (event: 'prs-patch', data: string) => void) { if (!pages.size) refresh(); pages.add(send); return list },
    leave(send: (event: 'prs-patch', data: string) => void) { pages.delete(send) },
  }
})()

// a PR's description, when you open it: kept out of the live list, which every change sends to every page
app.get('/prs/:id/body', (c) => {
  const p = state.prs[c.req.param('id')]
  return p ? c.json({ body: p.body ?? '', bodyHtml: p.bodyHtml ?? '' }) : c.json({ error: 'not found' }, 404)
})

app.get('/events', (c) => streamSSE(c, async (stream) => {
  // self: this machine's lists only (scopeOf), filtered per page from the one list every page shares
  const self = scopeOf(c) === 'self', away = () => (self ? awayHere() : new Set<string>())
  const hiddenPrs = new Set<string>(), hiddenTickets = new Set<string>()
  const patch = (event: 'prs-patch', data: string) => void stream.writeSSE({ event, data: self ? selfPatch(data, away(), hiddenPrs) : data })
  const sendPrs = async () => {
    const a = away(), list = prsHub.join(patch)
    for (const p of list) if (a.has(p.repo)) hiddenPrs.add(p.id)
    await stream.writeSSE({ event: 'prs', data: JSON.stringify(list.filter((p) => !hiddenPrs.has(p.id))) })
  }
  const sendHealth = () => stream.writeSSE({ event: 'health', data: JSON.stringify(healthView()) })
  const onActivity = (id: string, a: Activity) => stream.writeSSE({ event: 'activity', data: JSON.stringify({ id, a }) })
  // a burst of changes (a run's every line says 'exec') is one send, at most one a second, built once for every page
  const execPatch = (data: string) => void stream.writeSSE({ event: 'exec-patch', data: self ? selfPatch(data, away(), hiddenTickets) : data })
  const sendAlerts = () => stream.writeSSE({ event: 'alerts', data: JSON.stringify(alerts()) })
  // what changed, by API path: gathered for a moment so a burst of saves is one message
  let pending = new Set<string>(), flush: ReturnType<typeof setTimeout> | undefined
  const onStale = (paths: string[]) => { for (const x of paths) pending.add(x); flush ??= setTimeout(() => { flush = undefined; const out = [...pending]; pending = new Set(); void stream.writeSSE({ event: 'stale', data: JSON.stringify(out) }) }, 250) }
  live.on('stale', onStale)
  bus.on('alerts', sendAlerts)
  bus.on('health', sendHealth)
  bus.on('activity', onActivity)
  await sendPrs() // the whole list once; from here on prsHub sends this page patches
  await sendHealth()
  const board = execHub.join(execPatch), a = away()
  for (const t of board.tickets) if (t.repo && a.has(t.repo)) hiddenTickets.add(t.id)
  await stream.writeSSE({ event: 'exec', data: JSON.stringify(self ? { ...board, tickets: board.tickets.filter((t) => !hiddenTickets.has(t.id)) } : board) }) // the whole board once; then patches
  await sendAlerts()
  const tick = setInterval(() => { stream.writeSSE({ event: 'ping', data: '' }) }, 4000)
  await new Promise<void>((resolve) => stream.onAbort(resolve))
  clearInterval(tick)
  prsHub.leave(patch)
  bus.off('alerts', sendAlerts)
  live.off('stale', onStale); if (flush) clearTimeout(flush)
  execHub.leave(execPatch)
  bus.off('health', sendHealth)
  bus.off('activity', onActivity)
}))


// a restart killed these mid-run: runs and jobs already went back in the queue to continue their own session
// (store.ts pickUp). One still `interrupted` is waiting for you on purpose (stopped by restart after restart): starting
// it over here with its original command would re-post or re-push what it may already have done.
// a codebase map interrupted by a restart picks up where it stopped (finished batches are saved)
for (const [repo, t] of Object.entries(state.base)) if (t.state === 'interrupted') enqueueBase(repo, t.under)
const stoppedRestarts = (s?: string) => !!s && /restarts in a row/.test(s)
for (const p of Object.values(state.prs)) {
  // an explanation only reads, and you asked for it: it always picks back up
  if (p.explain?.state === 'interrupted' && !p.closed) enqueueExplain(p, p.explain.fresh)
  // one that just ran out of restarts asks you, once
  if (p.job?.state === 'interrupted' && !p.closed && stoppedRestarts(p.job.error) && !p.job.alerted) {
    alert(prTarget(p), `${JOB[p.job.kind] ?? 'Agent'} stopped: ${p.job.error}`, 'you'); p.job.alerted = true
  }
}
for (const r of Object.values(state.execs)) {
  if (r.state === 'interrupted' && stoppedRestarts(r.error) && !r.alerted) {
    for (const id of r.ids) alert(ticketTarget(id), `${r.label ?? 'Ship'} stopped: ${r.error}`, 'you')
    r.alerted = true
  }
}

// a merged or closed PR's queued or running work is pointless, and nothing on screen could cancel it any more
function dropClosed() {
  for (const p of Object.values(state.prs)) {
    if (!p.closed) continue
    if (p.job?.state === 'queued' || p.job?.state === 'running') cancel(p)
    if (p.explain?.state === 'queued' || p.explain?.state === 'running') cancelExplain(p)
  }
}
dropClosed()
// only the machine that runs it: a follower's copy of the state is the holder's to act on
if (!fleet.elsewhere()) followUnfollowed()
// runs whose whole "answer" was Claude's refusal for a limit (read as an answer before that was recognised): they
// failed, and their "next steps" (switch model, manage credits) were never the agent's. Failed ones can be run again
if (!fleet.elsewhere()) {
  let n = 0
  for (const p of Object.values(state.prs)) if (p.job?.state === 'done' && refusedForLimit(p.job.summary)) {
    transition('job', p.id, p.job.queuedAt, p.job, 'failed', 'refused for a limit', { error: p.job.summary!.trim().slice(0, 400), summary: undefined, next: undefined }, { kind: p.job.kind }); n++
    if (refusedForLimit(p.lastSaid?.summary)) delete p.lastSaid
  }
  for (const r of Object.values(state.execs)) if (r.state === 'done' && refusedForLimit(r.summary)) {
    transition('exec', r.ids.join(' → '), r.id, r, 'failed', 'refused for a limit', { error: r.summary!.trim().slice(0, 400), summary: undefined, next: undefined }, { kind: r.label ?? 'exec' }); n++
  }
  if (n) { console.log(`runs: ${n} that only got a limit refusal are marked failed (they can be run again)`); save() }
}
pump() // whatever waited in the queue before the restart starts now

// Linear has its own clock, so a slow GitHub sync never holds up the ticket board
pollTickets()
setInterval(() => pollTickets(), config.pollSeconds * 1000)

doPoll()
setInterval(doPoll, config.pollSeconds * 1000)
// your skills, kept current from their repo (fast-forward only: local edits are never overwritten)
// the control plane only: ~/.claude is synced, and two machines pulling into it would fight
const pullSkills = () => fleet.elsewhere() ? undefined : [config.skillsRepo ?? []].flat().forEach((dir) => execFile('git', ['-C', dir.replace(/^~/, process.env.HOME ?? '~'), 'pull', '--ff-only', '--quiet'], { timeout: 60_000 },
  (e) => e && console.warn(`skills pull (${dir}): ${e.message.split('\n')[0]}`)))
pullSkills(); setInterval(pullSkills, 3600_000)
// a state.json that only grew: trimmed once a day (and at every start, store.ts)
setInterval(() => { const n = prune(); if (n) { console.log(`state: pruned ${n} old closed PRs and exec runs`); save() } }, 86400_000).unref()
// several machines (fleet.ts): their own alerts, such as the sync between them being down
fleet.watch?.(condition)
// several machines: this one also runs agents another machine (the control plane) sends it (machines.ts)
serveMachine(() => state.settings.maxJobs, ownUsage, {
  // the state and the files the other machines follow this one by (replica.ts)
  ...replicaExtras,
  // a click made on another machine's page (its localhost), done here, where the state is kept (the write hand-off above)
  api: async (b: { method?: string; path?: string; body?: string; role?: string }) => {
    if (!fleet.mayWrite()) throw new Error('this machine does not run Concierge now')
    const method = String(b.method ?? ''), path = String(b.path ?? '')
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || !path.startsWith('/api/') || path.includes('..')) throw new Error('bad request')
    const r = await app.request(path, { method, body: method === 'GET' ? undefined : b.body || undefined, headers: { 'content-type': 'application/json', ...(b.role && { 'x-concierge-role': String(b.role) }) } })
    return { status: r.status, text: await r.text(), type: r.headers.get('content-type') ?? undefined }
  },
  // the control plane's connectors, made this machine's too (applyConnectors)
  connectors: (b: { custom?: Record<string, string>; connected?: string[] }) => applyConnectors(b.custom ?? {}, b.connected ?? []),
  // which connectors this machine has for an account, and in what state (the markers on Settings → Connections)
  has: async (b: { account?: string }) => connectorsHere(b.account),
  // this machine's numbers for the Machines page
  stats: async () => statsHere(ownUsage, hosted().size, slotsHere(state.settings.maxJobs)),
  // the keys in this machine's own .env, for the control plane to share when it lacks one (adoptKeys); tailnet only,
  // and only with the machine key
  keys: async () => localKeys,
  // whether an account is signed in here, and signing it in from the dashboard (the page relays the code)
  signedIn: async (b: { account?: string }) => signedInHere(b.account),
  // whether an account works here, and how: its own sign-in, or the account's shared key (Settings → Accounts → Machines)
  ready: async (b: { account?: string }) => readyHere(b.account ?? 'claude'),
  // how an account's sign-in is kept here, for Settings → Accounts → Sync & security (never the key: a short hash of it)
  security: async (b: { account?: string }) => securityHere(b.account ?? 'claude'),
  // the keys file back to readable only by you (Sync & security's fix)
  fixSecrets: async () => { const { chmod } = await import('node:fs/promises'); await chmod(SECRETS_FILE, 0o600).catch(() => {}); return true },
  signin: async (b: { account?: string; step?: string; input?: string }) => signinHere(b),
  // the alignment protocol: bring this machine in line with the shared settings, and say what still differs
  align: async () => alignHere(),
  // a hosted run's background, here where its processes are (the control plane keeps its task list)
  bg: async (b: { id: string; tasks: BgTask[] }) => bgViewOf(b.tasks ?? [], hosted().get(b.id)?.child.pid),
  bgStop: async (b: { id: string; task?: BgTask; pid?: number }) => bgStopOf(b.task, b.pid, hosted().get(b.id)?.child.pid),
}, () => canHere, { hello: joinHello, ask: joinAsk, status: joinStatus })
// the accounts this machine can run (signed in here, or its Ollama up): checked every minute, so a run is only sent
// to a machine that can do it
let canHere: string[] = []
const readCan = async () => {
  if (!fleet.elsewhere()) return // only a worker is asked
  const out: string[] = []
  for (const a of accounts()) if (onFallbackToken(a.id) || await signedInHere(a.id).catch(() => false)) out.push(a.id)
  canHere = out
}
void readCan(); setInterval(() => void readCan(), 60_000).unref()
// (started here, after readCan: a lapse or a recovery is told to the control plane at once)
keepAccountLogins(() => accounts().filter((a) => a.kind === 'claude' && !!a.home), () => { void readCan(); void loginNotice() })
/** Whether an account works on this machine, and how: its sign-in here, or its shared key (an added Claude account's). */
async function readyHere(account: string) {
  const key = onFallbackToken(account) || (!!accountOf(account).keyEverywhere && !!accountToken(account))
  const login = accountOf(account).keyEverywhere ? false : await signedInHere(account).catch(() => false)
  return { login, key, who: identityOf(account) }
}
/**
 * How an account's sign-in is kept on this machine: which key it has (a short hash, so machines are compared without the
 * key leaving any of them), whether the file that holds the key and this machine's login file are readable only by you,
 * and whether this machine has the main machine's settings (so it follows the account's setting).
 */
async function securityHere(account: string) {
  const a = accountOf(account)
  const mode = async (f: string) => stat(f).then((s) => (s.mode & 0o777).toString(8), () => undefined)
  const token = a.kind === 'claude' && a.home ? accountToken(account) : undefined
  return {
    keyHash: token ? createHash('sha256').update(token).digest('hex').slice(0, 12) : undefined,
    keyEverywhere: !!a.keyEverywhere,
    secretsMode: await mode(SECRETS_FILE),
    loginMode: a.kind === 'claude' ? await mode(join(a.home ?? join(homedir(), '.claude'), '.credentials.json')) : undefined,
  }
}
/** Is this account signed in on this machine (its own session)? */
async function signedInHere(account = 'claude') {
  const a = accounts().find((x) => x.id === account)
  if (!a) return false
  if (a.kind === 'openai') return openaiAuth(a.id) !== 'none'
  if (a.kind === 'llama') return (await ollamaState(a.id)).up
  if (a.keyEverywhere && accountToken(a.id)) return true // its one key, shared with every machine: nothing to sign in here
  return (await claudeAuth(a.home)).loggedIn
}
// --- aligning the machines: one protocol over the tailnet, between machines that are online -----------------------------
// The main server asks each machine to align when it comes online, and again when something every machine must agree on
// changes (which machines may have a repository, the skill sources, the accounts, an account's login). Each machine
// fixes what it can by itself: clones the repositories allowed on it (and takes off the ones no longer allowed, once
// nothing would be lost), fetches the skill sources. Then it says what still differs; what only you can do (a sign-in,
// a clone that failed) shows in Settings → Machines and as one notice. Nothing is polled and nothing times out: an
// offline machine is aligned when it is back.
export type AlignReport = {
  version?: string; repos: Record<string, string>; checkedOut: string[]; missingSkills: string[]; brokenLinks: string[]
  accounts: { id: string; signedIn: boolean; who?: string; fallback?: boolean }[] // fallback: not signed in, its runs on its fallback token
}
async function alignHere(): Promise<AlignReport> {
  await ensureClones().catch((e: Error) => console.warn('align: clones:', e.message))
  if (skillSources().length) await installSourceSkills().catch((e: Error) => console.warn('align: skills:', e.message))
  const needed = await skillsNeeded([config.agent.review.command, config.agent.revise.command, config.agent.stack ?? '', config.exec.command, ...config.exec.actions.map((x) => x.prompt)])
  const clones = cloneState()
  return {
    version: process.env.DECK_VERSION, repos: clones, checkedOut: Object.keys(config.repos).filter((r) => !(r in clones)),
    missingSkills: needed.filter((x) => !x.found).map((x) => x.name), brokenLinks: (await brokenSkillLinks()).map((l) => l.name),
    accounts: await Promise.all(accounts().map(async (a) => ({ id: a.id, signedIn: await signedInHere(a.id).catch(() => false), who: identityOf(a.id), fallback: onFallbackToken(a.id) }))),
  }
}
type AlignItem = { machine: string; what: string; state: 'fixing' | 'needs-you'; fix?: string }
let alignment: { at?: string; items: AlignItem[]; asked: string[] } = { items: [], asked: [] }
/** Ask every online machine (or one) to align, and gather what still differs. */
async function alignAll(only?: string) {
  if (!fleet.machine || fleet.elsewhere()) return
  const here = only && only !== fleet.machine ? undefined : await alignHere().catch(() => undefined)
  const there = await ask<AlignReport>('align', {}, only && only !== fleet.machine ? only : undefined)
  const reports = new Map<string, AlignReport | undefined>([...(here ? [[fleet.machine, here] as const] : []), ...there])
  // what each account must be (one account, one login) and which ones the work uses
  const used = new Set([...Object.values(config.providers?.use ?? {}), ...(config.providers?.fallback ?? []), 'claude'].filter(Boolean) as string[])
  const items: AlignItem[] = []
  for (const [m, r] of reports) {
    if (!r) { items.push({ machine: m, what: "didn't answer the alignment (an older version: it updates itself)", state: 'fixing' }); continue }
    if (r.version && process.env.DECK_VERSION && r.version !== process.env.DECK_VERSION) items.push({ machine: m, what: `runs build ${r.version}, this one ${process.env.DECK_VERSION}: it updates itself when idle`, state: 'fixing' })
    for (const [repo, st] of Object.entries(r.repos)) {
      if (st === 'not-here') continue // not allowed there: as it should be
      items.push(st === 'cloning' ? { machine: m, what: `cloning ${repo}`, state: 'fixing' } : { machine: m, what: `couldn't clone ${repo}: ${st}`, state: 'needs-you', fix: 'Check the repository and its access from that machine (Settings → Repositories)' })
    }
    if (r.missingSkills.length) items.push({ machine: m, what: `lacks ${r.missingSkills.map((x) => `/${x}`).join(', ')}, which your settings run`, state: 'needs-you', fix: 'Add a skill source that has them (Settings → Skills), or the skills on that machine' })
    if (r.brokenLinks.length) items.push({ machine: m, what: `can't follow its skill links ${r.brokenLinks.join(', ')}`, state: 'needs-you', fix: 'Run bin/up on that machine: it mounts the folder they point into' })
    for (const a of r.accounts) {
      if (!used.has(a.id)) continue
      const acc = accountOf(a.id)
      if (!a.signedIn) items.push({ machine: m, what: a.fallback ? `${acc.label} isn't signed in: its runs there use its fallback token, without its claude.ai connectors` : `${acc.label} isn't signed in`, state: 'needs-you', fix: `Settings → Accounts → ${acc.label} → Sign in on ${m}` })
      else if (acc.login && a.who && a.who !== acc.login) items.push({ machine: m, what: `${acc.label} is signed in as ${loginText(a.who)}, not ${loginText(acc.login)}`, state: 'needs-you', fix: `Sign it in again there, or make that login the account's (Settings → Accounts)` })
    }
  }
  // what a machine that answered no longer has: gone from the list; one that didn't answer this time keeps its items
  const answered = new Set(reports.keys())
  alignment = { at: new Date().toISOString(), asked: [...answered], items: [...(only ? alignment.items.filter((x) => !answered.has(x.machine)) : []), ...items] }
  const mine = alignment.items.filter((x) => x.state === 'needs-you')
  condition('alignment', 'Machines', mine.length ? `${mine.length} thing${mine.length === 1 ? '' : 's'} only you can do to align your machines: ${mine.slice(0, 3).map((x) => `${x.machine}: ${x.what}`).join('; ')}${mine.length > 3 ? '…' : ''} (Settings → Machines)` : undefined)
  stale('/fleet/alignment')
  if (items.length) console.log(`align: ${items.map((x) => `${x.machine}: ${x.what}`).join('; ')}`)
}
// asked a moment after a change, once for a burst of them
let alignSoon: NodeJS.Timeout | undefined
const alignLater = (only?: string) => { clearTimeout(alignSoon); alignSoon = setTimeout(() => void alignAll(only), 3_000) }
app.get('/fleet/alignment', (c) => c.json(alignment))
app.post('/fleet/align', async (c) => { await alignAll(); return c.json(alignment) })

/** Sign an account in on this machine: start (an address to approve), finish (the code it showed), state. */
async function signinHere(b: { account?: string; step?: string; input?: string }) {
  const a = accounts().find((x) => x.id === (b.account ?? 'claude'))
  if (!a || a.kind === 'llama') throw new Error('Nothing to sign in to')
  if (b.step === 'start') return a.kind === 'openai' ? startOpenaiLogin(a.id) : { url: await startClaudeLogin(a.home) }
  if (b.step === 'finish') { finishClaudeLogin(String(b.input ?? '')); return { ok: true } }
  return { state: (a.kind === 'openai' ? openaiLoginState() : claudeLoginState()) ?? null, signedIn: await signedInHere(a.id) }
}
/**
 * The shared keys fill themselves: one not shared yet is taken from this machine's .env, else from another machine's
 * (asked over the worker channel), and kept for all. Only the control plane does this; a key you replace stays yours.
 */
async function adoptKeys() {
  if (fleet.elsewhere()) return
  const missing = SHARED_KEYS.filter((k) => !sharedNow()[k])
  if (!missing.length) return
  const theirs = missing.some((k) => !localKeys[k]) ? await ask<Partial<Record<SharedKey, string>>>('keys', {}) : []
  const shared = { ...sharedNow() }
  for (const k of missing) {
    const here = localKeys[k], there = theirs.find(([, r]) => r?.[k])
    const value = here ?? there?.[1]?.[k]
    if (value) shared[k] = { value, at: new Date().toISOString(), from: here ? fleet.machine ?? 'this machine' : there![0] }
  }
  if (Object.keys(shared).length === Object.keys(sharedNow()).length) return
  saveSecrets({ shared })
  sharedChanged(applyShared(true))
  console.log(`shared keys: took ${missing.filter((k) => shared[k]).map((k) => `${KEY_LABEL[k]} from ${shared[k]!.from}`).join(', ')}`)
}
setTimeout(() => void adoptKeys().catch(() => {}), 60_000).unref()
setInterval(() => void adoptKeys().catch(() => {}), 10 * 60_000).unref()
// every machine's numbers, this one first (Settings → Machines)
app.get('/machines/stats', async (c) => {
  const here = [...children.values()].filter((x) => !(x as { machine?: string }).machine).length
  const [mine, others] = await Promise.all([statsHere(ownUsage, here, slotsHere(state.settings.maxJobs)), ask<Stats>('stats', {})])
  const all = [mine, ...others.flatMap(([, r]) => (r ? [r] : []))]
  return c.json({ machines: all.map((m) => ({ ...m, room: capped(m.name, m.slots), work: m.name === state.settings.workMachine, behind: behind(m) })), workSlots: state.settings.workSlots ?? 1, several: !!fleet.machine, latest: latestHeads() })
})
// every machine on the latest commit: read from GitHub, and an alert for one that stays behind past an update's time
async function checkVersions() {
  if (fleet.elsewhere()) return
  await readLatest().catch((e) => console.warn('versions:', (e as Error).message))
  const others = fleet.machine ? await ask<Stats>('stats', {}).catch(() => []) : []
  const all: (Running & { name: string })[] = [{ name: fleet.machine ?? 'this machine', ...runningHere() }, ...others.flatMap(([, r]) => (r ? [r] : []))]
  const late = all.filter((m) => overdue(m))
  condition('versions', 'Updates', late.length ? `Not on the latest commit: ${late.map((m) => `${m.name} (runs ${m.version ?? 'an older build'}${behind(m).includes('fleet') ? `, fleet ${m.fleet ?? 'older'}` : ''})`).join(', ')}. Its update log (Settings → Machines) says why.` : undefined)
}
setTimeout(() => void checkVersions(), 30_000).unref()
setInterval(() => void checkVersions(), 5 * 60_000).unref()
// sign an account in on a machine from here: the page shows the address to approve and relays the code back
app.post('/machines/:name/signin', async (c) => {
  const name = c.req.param('name'), b = await c.req.json() as { account?: string; step?: string; input?: string }
  try {
    if (name === (fleet.machine ?? 'this machine')) return c.json(await signinHere(b))
    // only a machine reporting in is asked: none answering is said in words, never as a crash of an empty answer
    const r = (await ask('signin', b, name))[0]?.[1]
    if (!machines.get(name)?.status) return c.json({ error: `${name} isn't reachable from here right now: is it on and online? Try again once it shows online under Settings → Machines` }, 502)
    return r ? c.json(r) : c.json({ error: `${name} didn't answer the sign-in (an older version there? It updates itself when idle)` }, 502)
  } catch (e) { return c.json({ error: (e as Error).message }, 400) }
})
/** Every other machine gets the control plane's connectors: after a change here, and when one comes back. */
const pushConnectors = (only?: string) => { if (machines.size) void ask('connectors', { custom: state.customConnectors ?? {}, connected: state.connected ?? [] }, only) }
onCameBack((name, atStart) => {
  pushConnectors(name)
  alignLater(name) // back online, however long it was away: brought in line, and what still differs is said
  // a machine came online: said once, as a notification (pin), unless this one only just started and is seeing it for the first time
  if (!atStart) alert({ kind: 'system', id: `machine:${name}`, label: 'Machines', title: `${name} is online` }, `${name} is online again and takes runs`, 'info', true)
})
/** An account's connectors on this machine: name → state. */
async function connectorsHere(account = 'claude'): Promise<Record<string, string>> {
  const a = accounts().find((x) => x.id === account)
  const list = !a || a.id === 'claude' ? await connections() : await accountConnections(a.id, a.kind, accountEnv(a.id))
  return Object.fromEntries(list.map((x) => [x.name, x.status]))
}
// where each of an account's connectors works: this machine and every other one (Settings → Connections)
/**
 * Where an account works (Settings → Accounts → its Machines): each machine, ready or not and how. ready: signed in
 * there, or on the account's shared key; not: signed out, signed in as another login (it takes none of the work), or
 * no answer (offline, or an older version). With the account's key, if it has one, and whether every machine uses it.
 */
type MachineReady = { name: string; state: 'signed-in' | 'key' | 'signed-out' | 'other-login' | 'no-answer'; who?: string }
app.get('/accounts/:id/machines', async (c) => {
  const a = accounts().find((x) => x.id === c.req.param('id'))
  if (!a) return c.json({ error: 'No such account' }, 404)
  const [here, there] = await Promise.all([readyHere(a.id), machines.size ? ask<Awaited<ReturnType<typeof readyHere>>>('ready', { account: a.id }) : Promise.resolve([] as [string, Awaited<ReturnType<typeof readyHere>> | undefined][])])
  const stateOf = (r?: Awaited<ReturnType<typeof readyHere>>): MachineReady['state'] =>
    !r ? 'no-answer' : r.key ? 'key' : !r.login ? 'signed-out' : a.login && r.who && r.who !== a.login ? 'other-login' : 'signed-in'
  const list: MachineReady[] = [[fleet.machine ?? 'This machine', here] as const, ...there].map(([name, r]) => ({ name, state: stateOf(r), ...(r?.who && { who: loginText(r.who) }) }))
  return c.json({
    machines: list, login: a.login ? loginText(a.login) : undefined,
    // the shared key: only an added Claude account has one of its own (the first account's is Settings → Machines' Claude token)
    key: a.kind === 'claude' && a.home ? { set: accountTokenAt(a.id), everywhere: !!a.keyEverywhere } : undefined,
  })
})
/**
 * Sync & security for an account, every machine asked: does each have the same key as this one (synced), is the key's
 * file and the login file private there, and does each follow the account's one-key setting. ok: nothing to fix.
 */
app.get('/accounts/:id/security', async (c) => {
  const a = accounts().find((x) => x.id === c.req.param('id'))
  if (!a) return c.json({ error: 'No such account' }, 404)
  type Sec = Awaited<ReturnType<typeof securityHere>>
  const [here, there] = await Promise.all([securityHere(a.id), machines.size ? ask<Sec>('security', { account: a.id }) : Promise.resolve([] as [string, Sec | undefined][])])
  const priv = (m?: string) => !m || m === '600' || m === '400' // no file: nothing to keep private
  const rows = ([[fleet.machine ?? 'This machine', here] as const, ...there] as [string, Sec | undefined][]).map(([name, s]) => {
    if (!s) return { name, answered: false, problems: ["didn't answer (offline or updating)"] }
    const problems: string[] = []
    if (here.keyHash && s.keyHash !== here.keyHash) problems.push(s.keyHash ? 'has a different key: its copy of the settings is behind' : "doesn't have the key yet: its copy of the settings is behind")
    if (s.keyEverywhere !== here.keyEverywhere) problems.push("doesn't follow the one-key setting yet: its copy of the settings is behind")
    if (!priv(s.secretsMode)) problems.push(`the keys file can be read by others there (permissions ${s.secretsMode})`)
    if (!priv(s.loginMode)) problems.push(`its sign-in file can be read by others there (permissions ${s.loginMode})`)
    return { name, answered: true, hasKey: !!s.keyHash, problems }
  })
  return c.json({ checkedAt: new Date().toISOString(), hasKey: !!here.keyHash, keyEverywhere: here.keyEverywhere, machines: rows, ok: rows.every((r) => r.answered && !r.problems.length) })
})
/** Make the keys file private again on this machine and every other (Sync & security's fix). */
app.post('/accounts/:id/security/fix', async (c) => {
  const fix = async () => { const { chmod } = await import('node:fs/promises'); await chmod(SECRETS_FILE, 0o600).catch(() => {}) }
  await fix()
  if (machines.size) await ask('fixSecrets', {})
  return c.json({ ok: true })
})
app.get('/connections/where', async (c) => {
  const account = c.req.query('account') ?? 'claude'
  if (!machines.size) return c.json({ machines: [] })
  const [here, others, inHere, inThere] = await Promise.all([connectorsHere(account), ask<Record<string, string>>('has', { account }), signedInHere(account), ask<boolean>('signedIn', { account })])
  return c.json({
    machines: [fleet.machine, ...others.map(([n]) => n)], has: { [fleet.machine!]: here, ...Object.fromEntries(others.filter(([, r]) => r)) },
    // a machine that didn't answer (offline, or an older version) is said apart: neither signed in nor not
    signedIn: { [fleet.machine!]: inHere, ...Object.fromEntries(inThere.map(([n, r]) => [n, r === undefined ? null : !!r])) },
    // who it is on each machine, and who it should be (one account, one login)
    who: Object.fromEntries(Object.entries(loginsOf(account)).map(([m, w]) => [m, w ? loginText(w) : undefined])),
    login: accountOf(account).login ? loginText(accountOf(account).login) : undefined,
    off: Object.entries(loginsOf(account)).filter(([, w]) => w && accountOf(account).login && w !== accountOf(account).login).map(([m]) => m),
    silent: [...others, ...inThere].filter(([, r]) => r === undefined).map(([n]) => n).filter((n, i, a) => a.indexOf(n) === i),
  })
})
// which account takes the work: when it moves to a fallback (a plan window spent, a limit, a lapsed sign-in), an alert
// says so until it moves back, and the sidebar follows at once
let routedAs = ''
setInterval(() => {
  const r = routing(), now = JSON.stringify(r.map((x) => [x.work, x.using, x.stuck]))
  if (now === routedAs) return
  const first = !routedAs
  routedAs = now
  const moved = r.filter((x) => x.using !== x.chosen), stuck = r.filter((x) => x.stuck)
  const names = (xs: typeof r) => [...new Set(xs.map((x) => x.chosenLabel))].join(' and ')
  const text = moved.length ? `${names(moved)} can't take work now (${moved[0].why ?? 'its limit or budget'}): ${[...new Set(moved.map((x) => x.label))].join(' and ')} stands in` + (stuck.length ? `; ${names(stuck)} work waits` : '')
    : stuck.length ? `${names(stuck)} can't take work now (${stuck[0].why}) and nothing is set to stand in: its work waits (Settings → Agents)` : undefined
  if (!first) console.log(`accounts: ${text ?? 'every kind of work is back on its own account'}`)
  condition('accounts', 'Accounts', text)
  bus.emit('health')
}, 30_000).unref()
// a run that has said nothing for a while: you hear about it, once per silence
bus.on('stalled', (key: string, label: string) => {
  const p = state.prs[key]
  if (p) alert(prTarget(p), `${label}: no output for 15 minutes, it may be stuck`, 'warn')
  else if (key.startsWith('exec:')) for (const id of state.execs[key.slice(5)]?.ids ?? []) alert(ticketTarget(id), `${label}: no output for 15 minutes, it may be stuck`, 'warn')
})

let exiting = false
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  // a deploy never waits for the agents' work: each run is saved as it stands and the next start continues it. It
  // only waits (5s at most) for them to exit and their last log lines to land, which the continued run reads back
  process.on(sig, async () => {
    if (exiting) return
    exiting = true
    shutdown()
    await drained()
    saveNow(); server.close(); process.exit(0)
  })
}

// last: root.route copies the routes app has right now, so every route must be registered above this
const root = new Hono()
// through the tailnet link, only the people allowed (access.ts); on this machine itself, as always
root.use('/*', async (c, next) => {
  const why = refuse(whoFrom((n) => c.req.header(n)))
  if (!why) return next()
  return c.req.path.startsWith('/api/') ? c.json({ error: why }, 403)
    : c.html(`<!doctype html><meta name="viewport" content="width=device-width"><title>Concierge</title><body style="font:15px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#333"><h1 style="font-size:20px">Not for you, yet</h1><p>${why.replace(/[<>&]/g, '')}</p></body>`, 403)
})
// a password, when set: anyone who reaches the dashboard can start agents that run commands and push
if (setting('PASSWORD')) root.use('/*', basicAuth({ username: setting('USER') ?? 'deck', password: setting('PASSWORD')! }))
// compressed (the bundle and the PR list shrink ~4x over a tailnet or a phone), except the live event stream, which a
// compressor would hold back
const squeeze = compress()
root.use('/*', (c, next) => (c.req.path.endsWith('/events') ? next() : squeeze(c, next)))
root.route('/', app)
if (process.env.NODE_ENV === 'production') {
  const dist = new URL('../dist', import.meta.url).pathname
  // hashed file names: a browser keeps them for good and only index.html is asked for again
  root.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable') })
  root.use('/*', serveStatic({ root: dist }))
  root.get('/*', serveStatic({ path: `${dist}/index.html` }))
}

bus.setMaxListeners(50)
// runs and replies another machine made before it stopped, arrived late through the sync: shown, and queued ones start
afterMerge(() => { bus.emit('change'); bus.emit('exec'); pump() })
const server = serve({ fetch: root.fetch, hostname: setting('HOST') ?? '127.0.0.1', port: config.port }, ({ port }) =>
  console.log(`Concierge on http://${setting('HOST') ?? '127.0.0.1'}:${port}`))
if ((setting('HOST') ?? '127.0.0.1') !== '127.0.0.1' && !setting('PASSWORD')) console.warn('Concierge listens beyond this machine with no CONCIERGE_PASSWORD: only do this on a private network such as a tailnet')
// every machine keeps a checkout of each watched repository: cloned at start, and again when config.json (synced) adds one
// what is missing here is known from the start (the clones themselves wait 15s): before, a page opened in those
// seconds took every repository for checked out on this machine
markClones()
setTimeout(() => void ensureClones(), 15_000).unref(); setInterval(() => void reloadConfig().then(ensureClones), 5 * 60_000).unref()
