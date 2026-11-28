import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fill } from './config.ts'
import { config, type Pr } from './store.ts'
import { flowInOf, flowOf, statusOfFlow, type FlowIn } from './flow.ts'

export const CRIT_DIR = process.env.CRIT_DIR ?? join(homedir(), '.crit')
const AI_AUTHOR = 'Claude Code'

export type Crit = {
  port?: number
  live: boolean
  machine?: string // another machine runs it (several machines): its link reaches it there, not this machine's
  host?: string // that machine's address on the tailnet, for the link (index.ts)
  cwd?: string // where the daemon runs (only known while it is live)
  pid?: number
  sessionKey?: string
  aiComments: number
  blocking?: number // the AI's findings still unresolved and badged blocking (review-exchange): change before merge
  drift?: number // the AI's NORM findings still open: code that differs from a written convention (advisory)
  myComments: number // your comments + your replies
  unresolved: number
  finishes: number
  lastFinish?: { at: string; approved: boolean; unresolved: number }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

// crit's files, read off the thread every few seconds into a snapshot; building the page only looks things up
type Session = { key: string; port?: number; cwd?: string; pid?: number; review_path?: string; machine?: string }
// the crit sessions other machines run (each says so every 15s, machines.ts): their pids mean nothing here, so they are
// live by that machine's word. Its review files reach this machine with the synced state
const elsewhere = new Map<string, { key: string; port?: number }[]>()
/** What `machine` says it runs now (nothing: it stopped saying, or went offline). */
export const critElsewhere = (machine: string, sessions?: { key: string; port?: number }[]) => { if (sessions?.length) elsewhere.set(machine, sessions); else elsewhere.delete(machine) }
/** The crit sessions alive on this machine, for the control plane (as of the last read, every few seconds). */
export const liveCrit = () => snap.sessions.filter((x) => !x.machine).map((x) => ({ key: x.key, port: x.port }))
type Counts = { aiComments: number; blocking: number; drift: number; myComments: number; unresolved: number }
type C = { id?: string; author?: string; body?: string; start_line?: number; resolved?: boolean | null; replies?: { author?: string; body?: string }[] }
/** A NORM finding (review-exchange): the code works and differs from a written convention. */
export type Norm = { id: string; path?: string; line?: number; claim: string; norm: string; source: string; fix?: string; state: 'drift' | 'deliberate' | 'resolved' }
const DELIBERATE = 'Deliberate:'
/** A crit comment read back as a NORM finding, from the lines render.py writes; anything else is not one. */
export function normOf(c: C, path?: string): Norm | undefined {
  const b = c.body ?? ''
  if (c.author !== AI_AUTHOR || !c.id || !/!\[norm\]/.test(b)) return
  const norm = b.match(/^Norm: (.+)$/m)?.[1], source = b.match(/^Source: <(https:\/\/[^>\s]+)>/m)?.[1]
  if (!norm || !source) return
  const state = !c.resolved ? 'drift' : c.replies?.some((x) => x.body?.startsWith(DELIBERATE)) ? 'deliberate' : 'resolved'
  return { id: c.id, path, line: c.start_line, claim: b.match(/\*\*(.+?)\*\*/)?.[1] ?? norm, norm, source, fix: b.match(/^Align: (.+)$/m)?.[1], state }
}
export const deliberateNote = (why: string) => `${DELIBERATE} ${why.trim() || 'kept on purpose.'}`
type Finish = { finishes: number; lastFinish?: Crit['lastFinish'] }
let snap: { sessions: Session[]; counts: Map<string, Counts>; finish: Map<string, Finish>; norms: Map<string, Norm[]> } = { sessions: [], counts: new Map(), finish: new Map(), norms: new Map() }
// session keys PRs remember, live or not: their counts are read too. By when each was last asked for: one nothing has
// asked about for ten minutes (its PR closed, or went) is no longer read every three seconds, where every key ever
// seen was, for as long as the server ran
const wanted = new Map<string, number>()
const WANTED_MS = 10 * 60_000
const readJson = (p: string) => readFile(p, 'utf8').then((t) => JSON.parse(t), () => undefined)
let reading: Promise<void> | undefined
/** Re-read crit's files into the snapshot; a call during a refresh waits for that one. */
export function refreshCrit(): Promise<void> {
  reading ??= read().finally(() => { reading = undefined })
  return reading
}
async function read() {
  {
    const dir = join(CRIT_DIR, 'sessions')
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
    const all: Session[] = await Promise.all(files.map(async (f) => ({ key: f.slice(0, -5), ...(await readJson(join(dir, f))) })))
    const remote = new Map([...elsewhere].flatMap(([machine, list]) => list.map((x) => [x.key, { machine, port: x.port }] as const)))
    const sessions: Session[] = [
      ...all.filter((x) => x.pid && alive(x.pid) && !remote.has(x.key)),
      ...[...remote].map(([key, r]) => ({ ...all.find((x) => x.key === key), key, port: r.port, machine: r.machine, pid: undefined })),
    ]
    const fresh = Date.now() - WANTED_MS
    for (const [k, at] of wanted) if (at < fresh) wanted.delete(k)
    const keys = new Set([...sessions.map((x) => x.key), ...wanted.keys()])
    const counts = new Map<string, Counts>(), finish = new Map<string, Finish>(), norms = new Map<string, Norm[]>()
    await Promise.all([...keys].map(async (key) => {
      const live = sessions.find((x) => x.key === key)
      const review = await readJson(live?.review_path ? join(live.review_path, 'review.json') : join(CRIT_DIR, 'reviews', key, 'review.json'))
      const files = Object.entries<{ comments?: C[] }>(review?.files ?? {})
      const comments: C[] = [...(review?.review_comments ?? []), ...files.flatMap(([, f]) => f.comments ?? [])]
      const found = files.flatMap(([path, f]) => (f.comments ?? []).map((x) => normOf(x, path))).filter((n): n is Norm => !!n)
      norms.set(key, found)
      const c: Counts = { aiComments: 0, blocking: 0, drift: found.filter((n) => n.state === 'drift').length, myComments: 0, unresolved: 0 }
      for (const x of comments) {
        if (x.author === AI_AUTHOR) { c.aiComments++; if (!x.resolved && /!\[blocking\]/.test(x.body ?? '')) c.blocking++ }
        else c.myComments++
        if (!x.resolved) c.unresolved++
        c.myComments += (x.replies ?? []).filter((r) => r.author !== AI_AUTHOR).length
      }
      counts.set(key, c)
      const lines = (await readFile(join(CRIT_DIR, 'finish', `${key}.log`), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
      const [at, , approved, unresolved] = (lines.at(-1) ?? '').split('\t')
      finish.set(key, { finishes: lines.length, lastFinish: at ? { at, approved: approved === 'approved=true', unresolved: Number(unresolved?.split('=')[1] ?? 0) } : undefined })
    }))
    snap = { sessions, counts, finish, norms }
  }
}
void refreshCrit()
setInterval(() => void refreshCrit(), 3000).unref()

/**
 * Everything crit knows about PR `n`, from the last snapshot (a few seconds old at most). The session is found by
 * the port the agent printed, or, for a review started by hand, by the worktree your skill uses (config.agent.worktree).
 */
export function critFor(seen: { port?: number; key?: string }, worktree?: string): Crit {
  const session = snap.sessions.find((x) => (seen.port != null ? x.port === seen.port : !!worktree && x.cwd === worktree))
  const sessionKey: string | undefined = session?.key ?? seen.key
  if (sessionKey) wanted.set(sessionKey, Date.now())
  const c = (sessionKey && snap.counts.get(sessionKey)) || { aiComments: 0, blocking: 0, drift: 0, myComments: 0, unresolved: 0 }
  const f = (sessionKey && snap.finish.get(sessionKey)) || { finishes: 0 }
  return { port: session?.port ?? seen.port, live: !!session, machine: session?.machine, cwd: session?.cwd, pid: session?.pid, sessionKey, ...c, ...f }
}

export type Status =
  | 'new' | 'queued' | 'preparing' | 'posting' | 'ready' | 'in-review' | 'reviewed'
  | 'failed' | 'interrupted' | 'no-checkout' | 'closed'
  | 'clear' // your own PR with no unresolved threads and no changes requested
  | 'approved' // your own PR, approved: ready to merge, maybe a few comments to tidy
  | 'answered' // your own PR: every open thread has your reply; the reviewers are next

/** The list's word for a PR, read off its flow (flow.ts decides where a PR stands, once). */
export function statusOf(pr: Pr, crit: Crit | undefined, hasCheckout: boolean, op?: FlowIn['op']): Status {
  const touched = !!crit && (crit.finishes > 0 || crit.myComments > 0)
  // a review you started by hand in a terminal: crit is up with no run of ours behind it
  if (!pr.closed && hasCheckout && !pr.mine && !pr.job && crit?.live && !(pr.myReview?.commitId === pr.headSha)) return touched ? 'in-review' : 'ready'
  return statusOfFlow(flowOf(flowInOf(pr, crit, hasCheckout, op)), pr, touched)
}

/** A PR's crit, found the same way the dashboard shows it. */
export function critOfPr(p: Pr) {
  const repoPath = config.repos[p.repo]
  return repoPath ? critFor({ port: p.job?.critPort, key: p.job?.critKey }, config.agent.worktree && fill(config.agent.worktree, { repoPath, number: p.number, repo: p.repo })) : undefined
}

/** The NORM findings of a crit session, from the last snapshot. */
export const normsOf = (sessionKey?: string): Norm[] => (sessionKey && snap.norms.get(sessionKey)) || []

// --- reviews read in Concierge, without crit (setup.ts reviewIn) ---------------------------------------------------
// The agent writes its findings where crit keeps a review (review.json, the same shape), under a key of the PR's own:
// everything that reads crit's reviews (the counts, the norms, the PR page's findings, the other machines' copy) then
// works the same, with no daemon and nothing to install.
export const ownReviewKey = (p: Pick<Pr, 'repo' | 'number'>) => `cc-${p.repo.replace(/[^\w.-]/g, '-')}-${p.number}`
export const ownReviewFile = (key: string) => join(CRIT_DIR, 'reviews', key, 'review.json')
export const noCrit = (p: Pick<Pr, 'repo' | 'number'>, key: string) => `

There is no crit here: the person reads and answers this review in Concierge. Do not launch crit, wait for Finish Review, or run crit.sh. If your skill has a way to work without crit (review-pr: its "No crit (Concierge)" section), follow it with this file. Either way your findings go where Concierge reads them, the file ${ownReviewFile(key)} (create its folder), as JSON in crit's review shape:
{"files": {"<path in the repo>": {"comments": [{"id": "c_<6 hex>", "start_line": "<n>", "end_line": "<n>", "body": "<the finding, badges and all, exactly as you would author it in crit>", "author": "${AI_AUTHOR}", "scope": "line", "resolved": false, "replies": []}]}}, "review_comments": [<the same shape, scope "review", for findings about the whole PR>]}
Write the whole file in one go; on a later round read it first and keep what the person added (replies, "resolved": true). Then end your turn with a short summary of what you found. When you are asked to post, post the findings in that file that are not resolved, as your skill would post crit's, and leave out the resolved ones.`
export const NO_CRIT_REVISE = `

There is no crit here: the person works in Concierge. Follow your skill's path for no crit (keep the work-list in your notes, skip crit's steps), and never launch crit.`
