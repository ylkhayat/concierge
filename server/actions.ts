// Everyday tools around a PR, grouped by what they act on, each runnable on one PR, its whole stack,
// or every PR it fits at once. Every one reports into the PR's activity feed, step by step.
import { checkedOut, missingError, missingFor } from './setup.ts'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import { critOfPr, refreshCrit } from './crit.ts'
import { fill } from './config.ts'
import { bus, cancel, children, enqueue, enqueueExplain, note, parseLine, type Activity } from './runner.ts'
import { config, save, state, STATE_DIR, type Pr, type StackRef, addSpend } from './store.ts'
import { providerFor, spawnAgent, tokensOf } from './providers.ts'
import { authFailed, checkClaudeAuth } from './claudeLogin.ts'
import { transition } from './lifecycle.ts'
import { restack } from './github.ts'
import { shq } from './shell.ts'

const run = promisify(execFile)
const sh = async (cmd: string, args: string[], cwd?: string) => (await run(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout.trim()

/** Where a tool's steps go: the PR's feed, plus any mirrored ones (the Exec ticket it was run from). */
export type Log = (a: Omit<Activity, 'at'>) => void
const feedLog = (ids: string[]): Log => (a) => { const at = new Date().toISOString(); for (const id of ids) note(id, { at, ...a }) }
/** A command run as a step: shown in the feed like the agent's own Bash calls, then run. */
const step = (log: Log, cmd: string, args: string[], cwd?: string) => { log({ kind: 'tool', tool: 'Bash', text: [cmd, ...args].join(' ').slice(0, 300) }); return sh(cmd, args, cwd) }
/**
 * Our own worktree for a rebase or an alignment, made fresh. One stopped halfway (a restart, a crash) leaves git's lock
 * and its unfinished merge or rebase in it: cleared first, so the next run doesn't fail on "remove the file manually".
 */
async function clearWorktree(git: (args: string[], cwd?: string) => Promise<string>, dir: string) {
  // a main checkout (its .git a folder, not a worktree's file) is never ours to clear
  if (existsSync(join(dir, '.git')) && statSync(join(dir, '.git')).isDirectory()) throw new Error(`${dir} is a checkout, not a worktree of ours`)
  if (existsSync(dir)) {
    const gitdir = await git(['rev-parse', '--absolute-git-dir'], dir).then((t) => t.trim(), () => '')
    if (gitdir) await Promise.all(['index.lock', 'HEAD.lock', 'AUTO_MERGE.lock'].map((f) => rm(join(gitdir, f), { force: true })))
    await git(['merge', '--abort'], dir).catch(() => {}); await git(['rebase', '--abort'], dir).catch(() => {})
  }
  await git(['worktree', 'remove', '--force', '--force', dir]).catch(() => {})
  await rm(dir, { recursive: true, force: true })
  await git(['worktree', 'prune']).catch(() => {})
}

export type Scope = 'this' | 'stack' | 'all'
export type Op = { action: string; label: string; state: 'running' | 'done' | 'failed'; at: string; endedAt?: string; result?: string; error?: string; scope?: Scope }
/** The latest tool run per PR, kept in state so it survives a restart. One still running when the server stopped did
 * not finish: it comes back as interrupted, so the page never claims it is running or forgets it failed. */
class Ops extends Map<string, Op> {
  set(id: string, op: Op) { super.set(id, op); state.ops = { ...state.ops, [id]: op }; return this }
  delete(id: string) { const had = super.delete(id); if (state.ops) delete state.ops[id]; return had }
}
export const ops = new Ops(Object.entries(state.ops ?? {}).map(([id, op]) => [id, op.state === 'running'
  ? (op.result = 'interrupted when Concierge restarted; nothing more was done',
    transition('op', id, op.at, op, 'failed', 'restart', { endedAt: new Date().toISOString() }, { kind: op.action })) : op]))

const busy = (p: Pr) => p.job?.state === 'queued' || p.job?.state === 'running' || ops.get(p.id)?.state === 'running'
const critDown = (p: Pr) => { const c = critOfPr(p); return !!p.job?.reviewDone && !busy(p) && !!c?.port && !!c.sessionKey && !c.live }
const tracked = (s: StackRef) => state.prs[`${s.repo}#${s.number}`]
/** Your whole stack, bottom to top, when every PR in it is yours (the only ones a rebase may force-push). */
const myStack = (p: Pr) => p.mine && p.stack?.every((s) => s.author === p.author.login) ? p.stack : undefined

type Def = {
  id: string; group: 'Pull request' | 'Stack' | 'crit' | 'Agent'; label: string; hint: string
  confirm?: string // asked before running ({n} is how many PRs)
  applies: (p: Pr) => boolean
  scopes: Scope[]
  // one call per target; a stack-wide action gets the whole chain at once. `mirror`: extra feeds to report into
  go: (targets: Pr[], scope: Scope, mirror: string[]) => Promise<unknown> | unknown
}

const DEFS: Def[] = [
  {
    id: 'link-stack', group: 'Stack', label: 'Link into stack', scopes: ['this'],
    hint: 'It is built on another PR, but GitHub does not list it in that stack, so reviewers see it on its own. Links the whole chain into one stack (gh stack link).',
    confirm: 'Link this chain of PRs into one stack on GitHub? Nothing in the code changes.',
    applies: (p) => !!p.unlinked && !!p.stack && checkedOut(p.repo) && !busy(p),
    go: (targets) => Promise.all(targets.map((p) => linkChain(p, p.stack!.map(tracked).filter((x): x is Pr => !!x && !x.closed), 'Link into stack'))),
  },
  {
    id: 'smart-rebase', group: 'Pull request', label: 'Smart rebase', scopes: ['this', 'stack', 'all'],
    hint: 'Rebase onto the latest base, cascading up the stack. Conflicts go to the agent to resolve. Force-pushes with lease; your local checkouts are left alone.',
    confirm: 'Smart rebase {n}: rebase onto the latest base and force-push (with lease). Continue?',
    applies: (p) => !!p.mine && checkedOut(p.repo) && !busy(p),
    go: (targets, scope, mirror) => {
      // a stack rebases as one cascade; "all" makes one cascade per stack you own plus each lone PR
      const chains = new Map<string, Pr[]>()
      for (const p of targets) {
        const chain = scope !== 'this' && myStack(p)
        const key = chain ? `${p.repo}:${chain[0].number}` : p.id
        // a merged PR has left the stack: its branch is often deleted, and what sat on it now sits on its base
        if (!chains.has(key)) chains.set(key, chain ? chain.map(tracked).filter((x): x is Pr => !!x && !x.closed) : [p])
      }
      for (const chain of chains.values()) void smartRebase(chain, mirror)
    },
  },
  {
    id: 'finalize', group: 'Pull request', label: 'Finish the last comments', scopes: ['this', 'stack', 'all'],
    hint: 'Approved, but reviewers still asked for things: a revise brings those threads into crit to fix or answer, then Push & reply.',
    applies: (p) => !!p.mine && p.reviewDecision === 'APPROVED' && (p.awaiting ?? p.unresolved ?? 0) > 0 && !!config.repos[p.repo] && !busy(p),
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'finalize', 'Finish the last comments', async () => { enqueue(p, 'revise'); return `revise queued for ${p.awaiting ?? p.unresolved} thread${(p.awaiting ?? p.unresolved) === 1 ? '' : 's'}` }, mirror, false))),
  },
  {
    id: 'rerun-ci', group: 'Pull request', label: 'Re-run failed checks', scopes: ['this', 'stack', 'all'],
    hint: 'Re-run the failed jobs of every failed workflow on the head commit.',
    applies: (p) => !!p.mine,
    go: (targets, _, mirror) => targets.map((p) => track(p, 'rerun-ci', 'Re-run failed checks', async (log) => {
      const runs = JSON.parse(await step(log, 'gh', ['run', 'list', '-R', p.repo, '--commit', p.headSha, '--json', 'databaseId,conclusion', '--limit', '50'])) as { databaseId: number; conclusion: string }[]
      const failed = runs.filter((r) => ['failure', 'cancelled', 'timed_out'].includes(r.conclusion))
      for (const r of failed) await step(log, 'gh', ['run', 'rerun', String(r.databaseId), '--failed', '-R', p.repo])
      return failed.length ? `re-running ${failed.length} workflow${failed.length === 1 ? '' : 's'}` : 'nothing failed'
    }, mirror)),
  },
  {
    id: 'fix-ci', group: 'Pull request', label: 'Fix CI', scopes: ['this', 'stack', 'all'],
    hint: 'An agent reads the failing checks on the head commit, fixes the cause and commits it. It pushes only once you say so (its next steps offer it).',
    applies: (p) => !!p.mine && !!config.repos[p.repo] && !busy(p),
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'fix-ci', 'Fix CI', async () => {
      enqueue(p, 'reply', `CI fails on ${p.url} (head ${p.headSha.slice(0, 9)}, branch ${p.head}). Read the failing checks (gh pr checks ${p.number} -R ${p.repo}; `
        + `gh run view <id> --log-failed -R ${p.repo}), find the cause, and fix it with the smallest change in this PR's branch; run the failing step `
        + 'locally if you can, then commit. A flaky failure unrelated to the change: say so and re-run it with gh run rerun --failed instead of changing code. '
        + 'Do not push or post: end with what failed, why, and what you changed, and offer the push as a next step.', 'Fix CI')
      return 'an agent is on it'
    }, mirror, false))),
  },
  {
    id: 'ready', group: 'Pull request', label: 'Mark ready for review', scopes: ['this', 'stack', 'all'],
    hint: 'Take the draft flag off, so reviewers get notified.', confirm: 'Mark {n} ready for review? Reviewers get notified.',
    applies: (p) => !!p.mine && p.draft,
    go: (targets, _, mirror) => targets.map((p) => track(p, 'ready', 'Mark ready', (log) => step(log, 'gh', ['pr', 'ready', String(p.number), '-R', p.repo]).then(() => 'ready for review'), mirror)),
  },
  {
    id: 'review-stack', group: 'Stack', label: 'Review the stack', scopes: ['stack'],
    hint: 'Open your stack command in the terminal: it works each PR bottom to top, reviewing others’ and revising yours.',
    applies: (p) => !!config.agent.stack && !!p.stack && checkedOut(p.repo),
    go: ([p], _, mirror) => track(p, 'review-stack', 'Review the stack', async (log) => {
      const n = await step(log, 'gh', ['api', `repos/${p.repo}/pulls/${p.number}`, '--jq', '.stack.number // empty'])
      if (!/^\d+$/.test(n)) throw new Error('GitHub has no stack for this PR')
      // repoPath is from config.json and n is digits only: nothing user-typed reaches the shell
      const command = fill(config.agent.stack!, { stack: n, number: p.number, repo: p.repo })
      openTerminal(`cd ${shq(config.repos[p.repo])} && claude ${shq(command)}`)
      return `opened ${command} in your terminal`
    }, mirror),
  },
  {
    id: 'crit-restart', group: 'crit', label: 'Restart crit', scopes: ['this', 'stack', 'all'],
    hint: 'Bring a stopped crit back on the same port with the same session. Comments are kept.',
    applies: (p) => critDown(p) && checkedOut(p.repo),
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'crit-restart', 'Restart crit', (log) => restartCrit(p, log).then((port) => `back on :${port}`), mirror))),
  },
  {
    id: 'crit-stop', group: 'crit', label: 'Stop crit', scopes: ['this', 'stack', 'all'],
    hint: 'Stop the crit daemon to free its port and memory. Restart brings it back with your comments.',
    applies: (p) => !!critOfPr(p)?.live,
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'crit-stop', 'Stop crit', async (log) => {
      const c = critOfPr(p)
      if (!c?.pid) return 'not running'
      log({ kind: 'tool', tool: 'Bash', text: `kill ${c.pid} (crit :${c.port})` })
      process.kill(c.pid, 'SIGTERM')
      return `stopped :${c.port}; Restart crit brings it back with your comments`
    }, mirror))),
  },
  {
    id: 'rerun', group: 'Agent', label: 'Re-run from scratch', scopes: ['this', 'stack', 'all'],
    hint: 'Start the review (or revise, on your PRs) over. The current crit session is replaced.',
    confirm: 'Re-run {n} from scratch? Their crit sessions are replaced.',
    applies: (p) => !!config.repos[p.repo] && !busy(p),
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'rerun', 'Re-run from scratch', async () => { enqueue(p, p.mine ? 'revise' : 'review'); return `${p.mine ? 'revise' : 'review'} queued` }, mirror, false))),
  },
  {
    id: 'explain', group: 'Agent', label: 'Re-explain', scopes: ['this', 'stack', 'all'],
    hint: 'Rebuild the Explain maps against the current head.',
    applies: (p) => !!config.repos[p.repo] && p.explain?.state !== 'running' && p.explain?.state !== 'queued',
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'explain', 'Re-explain', async () => { enqueueExplain(p, true); return 'queued; the Explain tab updates when it is done' }, mirror, false))),
  },
  {
    id: 'cancel', group: 'Agent', label: 'Cancel run', scopes: ['this', 'stack', 'all'],
    hint: 'Stop the agent run that is going or queued.',
    applies: (p) => p.job?.state === 'queued' || p.job?.state === 'running',
    go: (targets, _, mirror) => Promise.all(targets.map((p) => track(p, 'cancel', 'Cancel run', async () => { cancel(p); return 'cancelled' }, mirror, false))),
  },
]

/** Who `scope` reaches from `p`: itself, its stack (tracked PRs only), or every open PR on the same side (yours / to review). */
function targets(d: Def, p: Pr, scope: Scope): Pr[] {
  const pool = scope === 'this' ? [p]
    : scope === 'stack' ? (p.stack?.map(tracked).filter(Boolean) as Pr[] ?? [])
    : Object.values(state.prs).filter((x) => !x.closed && !x.dismissed && !!x.mine === !!p.mine)
  if (d.id === 'review-stack') return p.stack && d.applies(p) ? [p] : []
  if (d.id === 'smart-rebase' && scope === 'stack' && !myStack(p)) return []
  return pool.filter(d.applies)
}

/** The menu for one PR: every action with how many PRs each scope would touch. */
/** The command an action runs, for the skills it needs: a review or revise run, or the stack command. */
const commandOf = (id: string, p: Pr) => id === 'rerun' ? config.agent[p.mine ? 'revise' : 'review'].command
  : id === 'finalize' ? config.agent.revise.command : id === 'review-stack' ? config.agent.stack : undefined
export const actionsFor = (p: Pr) => DEFS.map(({ id, group, label, hint, confirm, scopes }) => {
  const d = DEFS.find((x) => x.id === id)!
  return { id, group, label, hint, confirm, missing: missingFor(commandOf(id, p)), counts: Object.fromEntries(scopes.map((s) => [s, targets(d, p, s).length])) as Partial<Record<Scope, number>> }
})

/** Run an action. `mirror`: feeds that also get its steps (an Exec ticket's run, when started from the ticket). */
export async function runAction(p: Pr, id: string, scope: Scope, mirror: string[] = []) {
  // the automatic alignment after a push (alignStacks) isn't a listed action: trying it again runs it now, same heads or not
  if (id === 'align-stack') {
    const stack = myStack(p)
    if (!stack || !checkedOut(p.repo)) throw new Error(`Not a stack of yours with ${p.repo} checked out on this machine: nothing to align here`)
    alignTried.delete(`${p.repo}:${stack[0].number}`)
    const chain = stack.map(tracked).filter((x): x is Pr => !!x && !x.closed)
    if (!chain.some((x) => x.behindBase)) { ops.delete(p.id); save(); bus.emit('change'); return { label: 'Align the stack', count: 0 } } // already aligned
    alignStacks(chain)
    bus.emit('change')
    return { label: 'Align the stack', count: chain.length }
  }
  const d = DEFS.find((x) => x.id === id)
  if (!d || !d.scopes.includes(scope)) throw new Error('Unknown action')
  const missing = missingFor(commandOf(id, p))
  if (missing.length) throw new Error(missingError(missing))
  const list = targets(d, p, scope)
  if (!list.length) throw new Error(`${d.label}: nothing to do here`)
  await d.go(list, scope, mirror)
  // remember how it was run, so a failure can offer the same run again
  for (const t of list) { const o = ops.get(t.id); if (o?.action === id) o.scope = scope }
  bus.emit('change')
  return { label: d.label, count: list.length }
}

// --- the runnable pieces --------------------------------------------------------------------

let openTerminal: (cmd: string) => void = () => {}
export const setTerminal = (f: (cmd: string) => void) => { openTerminal = f }

/**
 * Run `work` as `p`'s tool op: a section in the feed (and any mirrored feeds), each step `work` logs, then the outcome.
 * `chip`: show it as the PR's current op (off for actions that hand over to a run with its own status).
 */
async function track(p: Pr, action: string, label: string, work: (log: Log) => Promise<string>, mirror: string[] = [], chip = true) {
  const log = feedLog([p.id, ...mirror])
  const at = new Date().toISOString()
  const op = transition('op', p.id, at, { action, label, state: 'queued', at } as unknown as Op, 'running', 'you asked', {}, { kind: action })
  if (chip) ops.set(p.id, op)
  log({ kind: 'you', text: mirror.length ? `${label} · ${p.repo.split('/')[1]}#${p.number}` : label })
  bus.emit('change')
  try {
    op.result = await work(log)
    transition('op', p.id, op.at, op, 'done', 'done', {}, { kind: action })
    log({ kind: 'result', text: `${label}: ${op.result}` })
  } catch (e) {
    op.result = String((e as Error).message).split('\n').slice(-3).join(' ').slice(0, 400)
    op.error = op.result
    transition('op', p.id, op.at, op, 'failed', 'error', {}, { kind: action })
    log({ kind: 'error', text: `${label} failed: ${op.result}` })
  }
  op.endedAt = new Date().toISOString()
  save() // the outcome survives a restart
  bus.emit('change')
  bus.emit('poll') // the new heads, CI and drafts show without waiting for the next poll
  return op
}

export async function restartCrit(p: Pr, log: Log = () => {}) {
  const crit = critOfPr(p)
  if (!p.job || !crit?.sessionKey || !crit.port) throw new Error('No crit session to restart')
  if (crit.live) return crit.port
  const cwd = p.job.critCwd
  if (!cwd || !existsSync(cwd)) throw new Error('crit’s folder is gone (worktree removed). Re-run to start a new session.')
  // sessionKey and port come from crit's own files; cwd from its live session: nothing typed by a user reaches the command
  log({ kind: 'tool', tool: 'Bash', text: `CRIT_PORT=${crit.port} crit --session ${crit.sessionKey} --no-open  (in ${cwd})` })
  spawn('crit', ['--session', crit.sessionKey, '--no-open'], { cwd, env: { ...process.env, CRIT_PORT: String(crit.port) }, detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 500))
    await refreshCrit()
    if (critOfPr(p)?.live) { bus.emit('change'); return crit.port }
  }
  throw new Error('crit did not come back; try Resume to restart it from the session')
}

const RESOLVE = 'A git rebase in this directory stopped on conflicts. Resolve them: keep the intent of both sides (the base moved; '
  + 'this branch\'s change must still do what it did), `git add` the files, and `git rebase --continue` (with GIT_EDITOR=true). '
  + 'Repeat until the rebase finishes. Do not push, do not run `git rebase --abort`, and do not change anything beyond the conflicts. '
  + 'When the base rewrote the code a commit changed (renamed helpers, moved files, a new design for the same thing), resolving it means '
  + 'porting that commit\'s change onto the base\'s new code: do what the commit did, the way the new code does things, and no more than it '
  + 'did. That is resolving, not new work, so do it; a large conflict is not a reason to stop. Stop (leave the rebase where it is) only when '
  + 'the base deliberately removed what the commit builds on, so there is nothing to port it onto; then say exactly why. '
  + 'If git stops on a commit whose change is already in the history (an empty pick, or "nothing to commit"), run `git rebase --skip`; '
  + 'never edit the rebase todo file. To keep one side of a file, edit the file and remove the conflict markers: `git checkout --ours/--theirs` '
  + 'is refused here. End with one line per conflict you resolved, and one line starting PORTED <short sha>: per commit you had to port '
  + 'onto rewritten code, saying what it does now and what you could not check (tests you could not run).'

// Docker's file sharing on a Mac reports inode and ctime inconsistently, so git takes a clean file for a changed one
// ("Your local changes would be overwritten"). In rebase worktrees, compare only mtime and size, which it reports reliably.
// No hooks either: the repo's commit hooks (husky) guard commits someone writes, and need an install a throwaway
// worktree never has; a rebase or a merge here only moves commits that were already made, so it runs without them.
const STAT_SAFE = ['-c', 'core.checkStat=minimal', '-c', 'core.trustctime=false', '-c', 'core.hooksPath=/dev/null']
const STAT_SAFE_ENV = { GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'core.checkStat', GIT_CONFIG_VALUE_0: 'minimal', GIT_CONFIG_KEY_1: 'core.trustctime', GIT_CONFIG_VALUE_1: 'false',
  GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: '/dev/null' }

/**
 * Rebase `chain` (bottom to top, one PR or a whole stack) onto the latest base: the bottom onto origin/<its base>,
 * each next one onto the new tip below it. Works in a detached throwaway worktree, so branches checked out
 * elsewhere (crit, revise) are untouched, then force-pushes every moved branch in one atomic push with lease.
 */
function smartRebase(chain: Pr[], mirror: string[] = []) {
  const top = chain.at(-1)!
  const label = chain.length > 1 ? `Smart rebase (stack of ${chain.length})` : 'Smart rebase'
  const repo = config.repos[top.repo]
  // the work runs once; every PR in the stack gets its steps, so each one's feed tells the whole story
  const others = chain.slice(0, -1)
  for (const p of others) ops.set(p.id, { action: 'smart-rebase', label, state: 'running', at: new Date().toISOString() })
  const dir = join(STATE_DIR, 'worktrees', `rebase-${top.repo.replace('/', '-')}-${chain[0].number}`)
  return track(top, 'smart-rebase', label, (log) => rebaseChain(repo, dir, chain, (n) => {
    log({ kind: 'text', text: `#${n} has conflicts: the agent is resolving them` })
    return resolveConflicts(dir, top.id, log)
  }, log), [...others.map((p) => p.id), ...mirror]).then((op) => {
    for (const p of others) ops.set(p.id, { ...op })
    save(); bus.emit('change')
  })
}

const RESOLVE_MERGE = 'A git merge in this directory stopped on conflicts: the branch below this one in a stack moved, and this branch '
  + 'is taking its new commits in. Resolve them: keep the intent of both sides, `git add` the files, and `git commit --no-edit`. '
  + 'Do not push, do not run `git merge --abort`, and do not change anything beyond the conflicts. To keep one side of a file, edit the file '
  + 'and remove the conflict markers: `git checkout --ours/--theirs` is refused here. End with one line per conflict you resolved.'

/** Hand a stopped rebase (or merge) to a lean agent: files and git only, nothing else. Throws when it is still stuck. */
function resolveConflicts(dir: string, feedId: string, log: Log, how: 'rebase' | 'merge' = 'rebase') {
  return new Promise<void>((resolve, reject) => {
    const provider = providerFor('review') // conflicts are a code reader's work
    // ponytail: $15 a stop covers porting a big commit onto rewritten code; one that needs more fails, nothing pushed
    const child = spawnAgent(provider, ['-p', how === 'merge' ? RESOLVE_MERGE : RESOLVE, '--output-format', 'stream-json', '--verbose', '--max-budget-usd', '15',
      '--allowedTools', 'Read', 'Edit', 'Grep', 'Glob', 'Bash(git:*)', 'Bash(GIT_EDITOR=true git:*)'], { cwd: dir, env: { ...process.env, ...STAT_SAFE_ENV } })
    children.set(`${feedId}:rebase`, child) // counts as a running job, so a restart waits for it
    let buf = '', signedOut = false
    child.stdout.on('data', (c: Buffer) => {
      buf += c
      const lines = buf.split('\n'); buf = lines.pop()!
      for (const l of lines) {
        if (l.includes('"type":"result"')) {
          const r = JSON.parse(l)
          if (r.total_cost_usd || r.usage) { addSpend(r.total_cost_usd ?? 0, provider, tokensOf(r)); save(); bus.emit('health') }
        }
        if (!signedOut && authFailed(l)) { signedOut = true; void checkClaudeAuth() }
        for (const a of parseLine(l)) if (a.kind !== 'section') log(a) // its reads, edits, git calls and final note, as it goes
      }
    })
    child.on('error', reject)
    child.on('close', async () => {
      children.delete(`${feedId}:rebase`)
      // a worktree's .git is a file: ask git where its rebase state lives
      const paths = await Promise.all((how === 'merge' ? ['MERGE_HEAD'] : ['rebase-merge', 'rebase-apply']).map((d) => sh('git', ['rev-parse', '--git-path', d], dir).catch(() => '')))
      const stuck = paths.some((x) => x && existsSync(resolvePath(dir, x)))
      if (stuck) {
        await sh('git', [how, '--abort'], dir).catch(() => {})
        reject(new Error(signedOut ? "the agent couldn't sign in to Claude, so the conflicts are as they were; nothing was pushed. Sign in again under Settings → Connections, then rerun" : 'the agent could not resolve the conflicts; nothing was pushed'))
      } else resolve()
    })
  })
}

/**
 * What to do with your own copy of a branch the rebase just moved on GitHub: follow it when nothing of yours would be
 * lost (it was at the old tip, or behind it), else leave it. Checked out somewhere: moved in place, keeping your edits.
 */
export function localMove(o: { exists: boolean; atOld: boolean; behindOld: boolean; checkedOut: boolean }): 'none' | 'ref' | 'checkout' | 'keep' {
  if (!o.exists) return 'none'
  if (!o.atOld && !o.behindOld) return 'keep' // it has commits GitHub never had: yours to sort out
  return o.checkedOut ? 'checkout' : 'ref'
}

async function syncLocal(repo: string, moved: { branch: string; from: string; to: string }[], git: (args: string[], cwd?: string) => Promise<string>, log: Log) {
  // which worktree (your main checkout included) has each branch checked out
  const where = new Map<string, string>()
  let wt = ''
  for (const l of (await git(['worktree', 'list', '--porcelain']).catch(() => '')).split('\n')) {
    if (l.startsWith('worktree ')) wt = l.slice(9)
    if (l.startsWith('branch refs/heads/')) where.set(l.slice(18), wt)
  }
  for (const m of moved) {
    const local = await git(['rev-parse', '-q', '--verify', `refs/heads/${m.branch}`]).catch(() => '')
    if (local === m.to) continue // already there
    // behind the old tip, or any tip GitHub had before (an earlier rebase): every commit on it was pushed, nothing is lost
    const behindOld = !!local && (await git(['merge-base', '--is-ancestor', local, m.from]).then(() => true, () => false)
      || (await git(['reflog', 'show', '--format=%H', `refs/remotes/origin/${m.branch}`]).catch(() => '')).split('\n').includes(local))
    const how = localMove({ exists: !!local, atOld: local === m.from, behindOld, checkedOut: where.has(m.branch) })
    if (how === 'ref') await git(['update-ref', `refs/heads/${m.branch}`, m.to, local])
    if (how === 'checkout') {
      // --keep refuses rather than overwrite uncommitted edits to files the move touches
      const ok = await git(['reset', '-q', '--keep', m.to], where.get(m.branch)).then(() => true, () => false)
      if (!ok) { log({ kind: 'text', text: `Your local ${m.branch} has uncommitted changes in files the rebase moved; left as is. Commit or stash, then: git reset --keep origin/${m.branch}` }); continue }
    }
    if (how === 'keep') log({ kind: 'text', text: `Your local ${m.branch} has commits that are not on GitHub; left as is. To follow the rebase: git rebase --onto origin/${m.branch} ${m.from} ${m.branch}` })
    else if (how !== 'none') log({ kind: 'text', text: `Your local ${m.branch} now matches the rebased one` })
  }
}

/**
 * gh stack keeps its own record of each branch's head and base (.git/gh-stack); after a rebase elsewhere it points at
 * commits the branches no longer contain and `gh stack sync` gives up ("could not determine the previous base").
 * Write in the new heads and bases (atomically). Left alone when gh stack isn't used.
 */
async function syncGhStack(repo: string, chain: { base: string; head: string }[], fresh: string[], git: (args: string[], cwd?: string) => Promise<string>, log: Log) {
  const dir = await git(['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => '')
  const file = join(dir, 'gh-stack')
  // (its lock files stay on disk between runs, empty: their presence doesn't mean gh stack is busy)
  if (!dir || !existsSync(file)) return
  const d = JSON.parse(readFileSync(file, 'utf8')) as { stacks: { branches: { branch: string; head: string; base: string }[] }[] }
  let changed = 0
  for (const [i, p] of chain.entries()) {
    // the bottom sits on its base branch where the rebase put it; each next one on the branch below
    const base = i === 0 ? await git(['merge-base', fresh[0], `origin/${p.base}`]).catch(() => '') : fresh[i - 1]
    for (const s of d.stacks) for (const b of s.branches) {
      if (b.branch !== p.head || !base || (b.head === fresh[i] && b.base === base)) continue
      b.head = fresh[i]; b.base = base; changed++
    }
  }
  if (!changed) return
  writeFileSync(`${file}.tmp`, JSON.stringify(d, null, 2)); renameSync(`${file}.tmp`, file)
  log({ kind: 'text', text: `gh stack's record of the stack updated (${changed} branch${changed === 1 ? '' : 'es'}), so gh stack sync works again` })
}

/**
 * The cascade itself: in a detached worktree at `dir`, rebase the bottom of `chain` onto origin/<its base> and each
 * next one onto the new tip below it (only its own commits move), then push every moved branch atomically with lease.
 */
export async function rebaseChain(repo: string, dir: string, chain: { number: number; base: string; head: string }[], onConflict: (n: number) => Promise<void>, log: Log = () => {}) {
  const git = (args: string[], cwd = repo) => step(log, 'git', cwd === dir ? [...STAT_SAFE, ...args] : args, cwd)
  await git(['fetch', '-q', 'origin', ...new Set(chain.flatMap((p) => [p.base, p.head]))])
  const old = await Promise.all(chain.map((p) => git(['rev-parse', `origin/${p.head}`])))
  mkdirSync(dirname(dir), { recursive: true })
  await clearWorktree(git, dir)
  await git(['worktree', 'add', '-q', '--detach', dir, old[0]])
  try {
    const fresh: string[] = []
    for (const [i, p] of chain.entries()) {
      await git(['checkout', '-q', '--detach', old[i]], dir)
      const onto = i === 0 ? `origin/${p.base}` : fresh[i - 1]
      const upstream = i === 0 ? `origin/${p.base}` : old[i - 1]
      let ok = await git(['-c', 'core.editor=true', 'rebase', '--onto', onto, upstream], dir).then(() => true, () => false)
      // stopped with nothing actually conflicted: a stale view of the files, not a conflict. Refresh and go on, a few times.
      for (let tries = 0; !ok && tries < 3 && !(await git(['diff', '--name-only', '--diff-filter=U'], dir).catch(() => 'x')).trim(); tries++) {
        log({ kind: 'text', text: `#${p.number}: git stopped without a conflict; refreshing its view of the files and continuing` })
        await git(['update-index', '-q', '--refresh'], dir).catch(() => {})
        ok = await git(['-c', 'core.editor=true', 'rebase', '--continue'], dir).then(() => true, () => false)
      }
      if (!ok) await onConflict(p.number)
      // whatever happened above, the result must sit on its new base, or nothing is pushed
      if (!(await git(['merge-base', '--is-ancestor', onto, 'HEAD'], dir).then(() => true, () => false))) throw new Error(`#${p.number} did not end up on its base; nothing was pushed`)
      fresh.push(await git(['rev-parse', 'HEAD'], dir))
      log({ kind: 'text', text: `#${p.number} ${fresh[i] === old[i] ? 'already on its base' : `rebased onto ${i === 0 ? `origin/${p.base}` : `#${chain[i - 1].number}`}`}` })
    }
    const moved = chain.flatMap((p, i) => (fresh[i] !== old[i] ? [{ p, from: old[i], to: fresh[i] }] : []))
    if (moved.length) {
      await git(['push', '-q', '--atomic', 'origin',
        ...moved.map((m) => `--force-with-lease=refs/heads/${m.p.head}:${m.from}`),
        ...moved.map((m) => `${m.to}:refs/heads/${m.p.head}`)])
    }
    // your checkout follows GitHub even when nothing moved now (an earlier rebase may have left it behind)
    await syncLocal(repo, chain.map((p, i) => ({ branch: p.head, from: old[i], to: fresh[i] })), git, log)
    await syncGhStack(repo, chain, fresh, git, log)
    // where each branch was: a port you'd rather not keep goes back with git push --force-with-lease origin <old>:<branch>
    return moved.length ? `rebased and pushed ${moved.map((m) => `#${m.p.number} (was ${m.from.slice(0, 9)})`).join(', ')}` : 'already up to date'
  } finally {
    await git(['worktree', 'remove', '--force', dir]).catch(() => {})
  }
}

/** Has anyone reviewed this PR? Then its history is someone's reference point: it takes new commits by merge, never a rewrite. */
export const reviewed = (p: Pick<Pr, 'seenReviews' | 'reviewDecision'>) => (p.seenReviews?.length ?? 0) > 0 || p.reviewDecision === 'APPROVED' || p.reviewDecision === 'CHANGES_REQUESTED'

/**
 * After a push into a stack: every branch above the one that moved must contain the new tip below it. The bottom
 * stays where it is. A reviewed PR merges the branch below in (a plain fast-forward push, so its reviewers keep their
 * history); one nobody reviewed yet is rebased onto it. Works in a detached throwaway worktree, then pushes every moved
 * branch in one atomic push with lease, and brings your checkout and gh stack's record along.
 */
export async function alignChain(repo: string, dir: string, chain: { number: number; base: string; head: string; merge: boolean }[], onConflict: (n: number, how: 'rebase' | 'merge') => Promise<void>, log: Log = () => {}) {
  const git = (args: string[], cwd = repo) => step(log, 'git', cwd === dir ? [...STAT_SAFE, ...args] : args, cwd)
  const contains = (a: string, b: string) => git(['merge-base', '--is-ancestor', a, b], dir).then(() => true, () => false)
  await git(['fetch', '-q', 'origin', ...new Set(chain.map((p) => p.head))])
  const old = await Promise.all(chain.map((p) => git(['rev-parse', `origin/${p.head}`])))
  mkdirSync(dirname(dir), { recursive: true })
  await clearWorktree(git, dir)
  await git(['worktree', 'add', '-q', '--detach', dir, old[0]])
  try {
    const fresh = [old[0]]
    for (const [i, p] of chain.entries()) {
      if (i === 0) continue
      const below = fresh[i - 1]
      if (await contains(below, old[i])) { fresh.push(old[i]); continue }
      await git(['checkout', '-q', '--detach', old[i]], dir)
      const how = p.merge ? 'merge' : 'rebase'
      // where this branch's own commits start: the tip of the branch below from before it moved. Moved in this run: its
      // old tip. Moved before (the push that started this): the remote's reflog knows its earlier tip (--fork-point).
      // A plain merge-base would reach back past the old copies of the commits below and replay them on their new copies.
      const from = async () => fresh[i - 1] !== old[i - 1] ? old[i - 1]
        : await git(['merge-base', '--fork-point', `refs/remotes/origin/${chain[i - 1].head}`, old[i]]).catch(() => '') || await git(['merge-base', old[i], below], dir)
      // (a merge's message is the one git writes itself, which commit linters let through)
      const ok = await (p.merge
        ? git(['-c', 'core.editor=true', 'merge', '--no-ff', '--no-edit', '-m', `Merge branch '${chain[i - 1].head}' into ${p.head}`, below], dir)
        : git(['-c', 'core.editor=true', 'rebase', '--onto', below, await from()], dir)).then(() => true, () => false)
      if (!ok) await onConflict(p.number, how)
      if (!(await contains(below, 'HEAD'))) throw new Error(`#${p.number} did not end up with the branch below it; nothing was pushed`)
      fresh.push(await git(['rev-parse', 'HEAD'], dir))
      log({ kind: 'text', text: `#${p.number} ${p.merge ? 'merged' : 'rebased onto'} #${chain[i - 1].number}${p.merge ? ' in (it has reviews, so its history stays)' : ' (nobody reviewed it yet)'}` })
    }
    const moved = chain.flatMap((p, i) => (fresh[i] !== old[i] ? [{ p, from: old[i], to: fresh[i] }] : []))
    if (moved.length) {
      await git(['push', '-q', '--atomic', 'origin',
        ...moved.map((m) => `--force-with-lease=refs/heads/${m.p.head}:${m.from}`),
        ...moved.map((m) => `${m.to}:refs/heads/${m.p.head}`)])
    }
    await syncLocal(repo, chain.map((p, i) => ({ branch: p.head, from: old[i], to: fresh[i] })), git, log)
    await syncGhStack(repo, chain, fresh, git, log)
    return moved.length ? `${moved.map((m) => `#${m.p.number}`).join(', ')} now ${moved.length === 1 ? 'has' : 'have'} the branch below` : 'already aligned'
  } finally {
    await git(['worktree', 'remove', '--force', dir]).catch(() => {})
  }
}

// a stack whose alignment failed is not tried again on the same heads: something has to move first
const alignTried = new Map<string, string>()

/**
 * Keep your stacks aligned: a stack of yours (every PR in it yours) with a branch behind the one below it, and no agent
 * or tool at work on any of it, is aligned now. Called after each poll's behind check.
 */
export function alignStacks(prs: Pr[]) {
  const done = new Set<string>()
  for (const p of prs) {
    const stack = p.behindBase && checkedOut(p.repo) ? myStack(p) : undefined
    const key = stack && `${p.repo}:${stack[0].number}`
    if (!stack || !key || done.has(key)) continue
    done.add(key)
    const chain = stack.map(tracked).filter((x): x is Pr => !!x && !x.closed)
    if (chain.length !== stack.length || chain.some(busy)) continue
    const heads = chain.map((x) => x.headSha).join()
    if (alignTried.get(key) === heads) continue
    alignTried.set(key, heads)
    const top = chain.at(-1)!, dir = join(STATE_DIR, 'worktrees', `align-${top.repo.replace('/', '-')}-${chain[0].number}`)
    const others = chain.slice(0, -1).map((x) => x.id)
    void track(top, 'align-stack', 'Aligning the stack after a push', (log) => alignChain(config.repos[top.repo], dir,
      chain.map((x) => ({ number: x.number, base: x.base, head: x.head, merge: reviewed(x) })),
      (n, how) => { log({ kind: 'text', text: `#${n} has conflicts: the agent is resolving them` }); return resolveConflicts(dir, top.id, log, how) }, log), others)
      .then(() => { save(); bus.emit('change') })
  }
}

/**
 * What a chain of PRs built on each other needs on GitHub's side: nothing when GitHub lists them all in one stack;
 * `link` when some aren't in any stack and the rest are in one at most, and every PR is yours (clear-cut); `ask`
 * otherwise (someone else's PR in it, or two stacks). `wait` until each one's GitHub stack has been read.
 */
export function stackLink(chain: Pick<Pr, 'ghStack'>[], allMine: boolean): 'ok' | 'link' | 'ask' | 'wait' {
  if (chain.some((p) => p.ghStack === undefined)) return 'wait'
  const stacks = new Set(chain.flatMap((p) => (p.ghStack ? [p.ghStack.number] : [])))
  if (chain.every((p) => p.ghStack) && stacks.size === 1) return 'ok'
  if (!chain.some((p) => !p.ghStack)) return 'ask' // every one is in a stack, just not the same one
  return allMine && stacks.size <= 1 ? 'link' : 'ask'
}

const linkTried = new Map<string, string>()
const linkChain = (top: Pr, chain: Pr[], label: string) => track(top, 'link-stack', label, async (log) => {
  // PR numbers, bottom to top: gh stack adds the missing ones to the stack (creating it when there is none) and never removes any
  await step(log, 'gh', ['stack', 'link', ...chain.map((x) => String(x.number))], config.repos[top.repo])
  for (const x of chain) { restack(x.id); x.unlinked = false } // read the stack again on the next sync
  return `${chain.map((x) => `#${x.number}`).join(', ')} are one stack on GitHub`
}, chain.slice(0, -1).map((x) => x.id))

/**
 * Your PRs built on each other that GitHub doesn't list as one stack: linked now when it is clear-cut, else marked
 * `unlinked` (an alert and a "Link into stack" action). Returns the ones newly marked. Called after each poll.
 */
export function linkStacks(prs: Pr[]): Pr[] {
  const asked: Pr[] = [], done = new Set<string>()
  for (const p of prs) {
    if (!p.mine || p.closed || !p.stack || !config.repos[p.repo]) continue
    const key = `${p.repo}:${p.stack[0].number}`
    if (done.has(key)) continue
    done.add(key)
    const chain = p.stack.map(tracked).filter((x): x is Pr => !!x && !x.closed)
    if (chain.length !== p.stack.length) continue
    const need = stackLink(chain, !!myStack(p))
    if (need === 'ok') for (const x of chain) x.unlinked = false // linked since, here or elsewhere
    if (need === 'ask') { for (const x of chain) if (!x.ghStack && !x.unlinked) { x.unlinked = true; asked.push(x) } }
    if (need !== 'link' || chain.some(busy) || !checkedOut(p.repo)) continue // linking runs in the checkout
    const heads = chain.map((x) => x.number).join()
    if (linkTried.get(key) === heads) continue
    linkTried.set(key, heads)
    void linkChain(chain.at(-1)!, chain, 'Linking the stack on GitHub').then(() => { save(); bus.emit('change') })
  }
  return asked
}

/**
 * Your checkout follows GitHub for these PRs' branches when it is only behind (nothing of yours would be lost): after
 * an agent pushed from its worktree, and when Concierge starts on a machine (its clones are its own).
 */
export async function followRemote(prs: Pr[]) {
  for (const repo of new Set(prs.map((p) => p.repo))) {
    const dir = config.repos[repo], mine = prs.filter((p) => p.repo === repo && p.mine && !p.closed)
    if (!checkedOut(repo) || !mine.length) continue
    const git = (args: string[], cwd = dir) => sh('git', args, cwd)
    if (!(await git(['fetch', '-q', 'origin', ...new Set(mine.map((p) => p.head))]).then(() => true, () => false))) continue
    const behind: { branch: string; from: string; to: string }[] = []
    for (const p of mine) {
      const local = await git(['rev-parse', '-q', '--verify', `refs/heads/${p.head}`]).catch(() => ''), tip = await git(['rev-parse', `origin/${p.head}`]).catch(() => '')
      if (local && tip && local !== tip && await git(['merge-base', '--is-ancestor', local, tip]).then(() => true, () => false)) behind.push({ branch: p.head, from: local, to: tip })
    }
    // what moved is told in that PR's activity, without the git calls
    const log: Log = (a) => { if (a.kind === 'tool') return; const p = mine.find((x) => a.text.includes(` ${x.head} `)); if (p) note(p.id, { at: new Date().toISOString(), ...a }) }
    if (behind.length) await syncLocal(dir, behind, git, log)
  }
}

/**
 * Your stacked PRs whose base (the PR below) moved past them, after a push or a rebase down the stack: marked, never
 * pushed for you. One fetch per repo; the bottom PR (on the default branch) is never marked.
 */
export async function markBehind(prs: Pr[]) {
  const stacked = prs.filter((p) => p.mine && !p.closed && p.stack && p.stack[0].number !== p.number && checkedOut(p.repo))
  for (const repo of new Set(stacked.map((p) => p.repo))) {
    const dir = config.repos[repo], mine = stacked.filter((p) => p.repo === repo)
    const ok = await sh('git', ['fetch', '-q', 'origin', ...new Set(mine.flatMap((p) => [p.base, p.head]))], dir).then(() => true, () => false)
    if (!ok) continue
    for (const p of mine) p.behindBase = !(await sh('git', ['merge-base', '--is-ancestor', `origin/${p.base}`, `origin/${p.head}`], dir).then(() => true, () => false))
  }
  for (const p of prs) if (!stacked.includes(p)) p.behindBase = false
}
