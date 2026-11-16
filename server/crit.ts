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
type Session = { key: string; port?: number; cwd?: string; pid?: number; review_path?: string }
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
const wanted = new Set<string>() // session keys PRs remember, live or not: their counts are read too
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
    const sessions: Session[] = (await Promise.all(files.map(async (f) => ({ key: f.slice(0, -5), ...(await readJson(join(dir, f))) }))))
      .filter((x) => x.pid && alive(x.pid))
    const keys = new Set([...sessions.map((x) => x.key), ...wanted])
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
  if (sessionKey) wanted.add(sessionKey)
  const c = (sessionKey && snap.counts.get(sessionKey)) || { aiComments: 0, blocking: 0, drift: 0, myComments: 0, unresolved: 0 }
  const f = (sessionKey && snap.finish.get(sessionKey)) || { finishes: 0 }
  return { port: session?.port ?? seen.port, live: !!session, cwd: session?.cwd, pid: session?.pid, sessionKey, ...c, ...f }
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
