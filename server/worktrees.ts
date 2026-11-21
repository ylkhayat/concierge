// Worktrees across the watched repos: what each one is, whether it can go, and one call to remove those that can.
// Never loses work: anything with uncommitted changes, commits not on a remote, recent activity, a running crit or an
// open PR's review stays. Only the folder goes; branches are kept.
import { execFile } from 'node:child_process'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CRIT_DIR } from './crit.ts'
import { fill } from './config.ts'
import { config, state, type Pr } from './store.ts'
import { STATE_DIR } from './paths.ts'

const run = promisify(execFile)
const git = (cwd: string, ...args: string[]) => run('git', ['-C', cwd, ...args], { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).then((r) => r.stdout)

export type Worktree = { repo: string; path: string; branch?: string; mb?: number; remove: boolean; why: string } // mb: undefined while it is being sized

const OWN = join(STATE_DIR, 'worktrees')
const RECENT = 15 * 60_000

/** Folders crit is serving right now. */
async function liveCritDirs(): Promise<Set<string>> {
  const dir = join(CRIT_DIR, 'sessions')
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
  const sessions = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8').then((t) => JSON.parse(t), () => undefined)))
  return new Set(sessions.filter((s) => s?.pid && s.cwd && alive(s.pid)).map((s) => s.cwd as string))
}
const there = (p: string) => access(p).then(() => true, () => false)

/** The rule list, in order; the first that applies decides. Pure, so it is tested on its own. */
export function verdict(w: { path: string; gone: boolean; dirty: number; unpushed: number; touchedAgo: number; crit: boolean; openReviewOf?: number; own?: { base: boolean; prOpen: boolean } }): { remove: boolean; why: string } {
  if (w.gone) return { remove: true, why: 'its folder is already gone' }
  if (w.dirty) return { remove: false, why: `${w.dirty} uncommitted change${w.dirty === 1 ? '' : 's'}` }
  if (w.unpushed) return { remove: false, why: `${w.unpushed} commit${w.unpushed === 1 ? '' : 's'} not on GitHub` }
  if (w.touchedAgo < RECENT) return { remove: false, why: 'in use in the last 15 minutes' }
  if (w.crit) return { remove: false, why: 'crit is running in it' }
  if (w.openReviewOf) return { remove: false, why: `the crit review of open PR #${w.openReviewOf}` }
  if (w.own?.base) return { remove: false, why: 'the codebase map' }
  if (w.own?.prOpen) return { remove: false, why: 'Explain for an open PR' }
  return { remove: true, why: 'clean, pushed and idle' }
}

let cache: { at: number; list: Worktree[] } | undefined
const asked = new Map<string, { sig: string; at: number; dirty: number; unpushed: number }>()

// sizes: du takes seconds per big worktree through a container's file sharing, and they barely change, so each is
// measured in the background, one at a time, and remembered for 30 minutes; the list never waits for it
const sizes = new Map<string, { mb: number; at: number }>()
const sizing: string[] = []
let sizer: Promise<void> | undefined
function sizeLater(path: string) {
  const s = sizes.get(path)
  if ((s && Date.now() - s.at < 30 * 60_000) || sizing.includes(path)) return
  sizing.push(path)
  sizer ??= (async () => {
    while (sizing.length) {
      const p = sizing[0]
      // installed packages and caches left out: walking them is what made du slow (and filled Docker's file cache)
      const kb = await run('du', ['-sk', '--exclude=node_modules', '--exclude=.venv', '--exclude=.pnpm-store', '--exclude=.nx', '--exclude=.turbo', p], { timeout: 120_000 }).then((r) => Number(r.stdout.split('\t')[0]) || 0, () => 0)
      sizes.set(p, { mb: Math.round(kb / 1024), at: Date.now() })
      sizing.shift()
    }
    sizer = undefined
    if (cache) for (const w of cache.list) w.mb = sizes.get(w.path)?.mb ?? w.mb
  })()
}

export async function worktrees(fresh = false): Promise<Worktree[]> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.list
  if (fresh) asked.clear() // before removing anything, git is asked again about every one
  const crit = await liveCritDirs()
  // where open PRs' crit reviews live (so Restart crit keeps working), and which PRs Concierge still tracks open
  const openPrs = Object.values(state.prs).filter((p) => !p.closed)
  const reviewDir = new Map(openPrs.filter((p) => p.job?.critCwd).map((p) => [p.job!.critCwd!, p.number]))
  // and where your review skill puts each open PR's worktree (config.agent.worktree), crit seen there or not
  if (config.agent.worktree) for (const p of openPrs) if (config.repos[p.repo]) reviewDir.set(fill(config.agent.worktree, { repoPath: config.repos[p.repo], number: p.number, repo: p.repo }), p.number)
  const openIds = new Set(openPrs.map((p) => p.id.replace(/[/#]/g, '-')))
  const out: Worktree[] = []
  for (const [repo, main] of Object.entries(config.repos)) {
    if (!(await there(main))) continue
    const porcelain = await git(main, 'worktree', 'list', '--porcelain').catch(() => '')
    const entries = porcelain.split('\n\n').map((b) => ({
      path: b.match(/^worktree (.+)$/m)?.[1] ?? '', branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1], gone: /^prunable/m.test(b),
    })).filter((e) => e.path && e.path !== main)
    await Promise.all(entries.map(async (e) => {
      const gone = e.gone || !(await there(e.path))
      // its git folder, from the ".git" file a worktree has (no git process: starting one blocks the server a moment,
      // and this ran three per worktree every minute; profiled, it was most of the server's busy time)
      const gd = gone ? '' : await readFile(join(e.path, '.git'), 'utf8').then((t) => { const g = /^gitdir: (.+)$/m.exec(t)?.[1]?.trim() ?? ''; return g && (g.startsWith('/') ? g : join(e.path, g)) }, () => join(e.path, '.git'))
      // "last used": its HEAD and HEAD log move on every checkout and commit (not its index: git status rewrites that)
      const marks = gd ? (await Promise.all([join(gd, 'HEAD'), join(gd, 'logs', 'HEAD')].map((f) => stat(f).then((x) => x.mtimeMs, () => undefined)))).filter((m): m is number => m != null) : []
      // what git says (changes, unpushed commits) is asked again only when its HEAD, log or index moved, or 10 minutes on
      const sig = gd ? [...marks, await stat(join(gd, 'index')).then((x) => x.mtimeMs, () => 0)].join(',') : ''
      const had = asked.get(e.path)
      const [dirty, unpushed] = gone ? [0, 0] : had && had.sig === sig && Date.now() - had.at < 10 * 60_000 ? [had.dirty, had.unpushed] : await Promise.all([
        git(e.path, 'status', '--porcelain').then((s) => s.split('\n').filter(Boolean).length, () => 0),
        git(e.path, 'rev-list', '--count', 'HEAD', '--not', '--remotes').then((s) => Number(s.trim()) || 0, () => 0),
      ]).then(([d, u]) => { asked.set(e.path, { sig, at: Date.now(), dirty: d, unpushed: u }); return [d, u] })
      const touchedAgo = marks.length ? Date.now() - Math.max(...marks) : Infinity
      const name = e.path.startsWith(OWN) ? e.path.slice(OWN.length + 1) : undefined
      const v = verdict({
        path: e.path, gone, dirty, unpushed, touchedAgo, crit: crit.has(e.path), openReviewOf: reviewDir.get(e.path),
        own: name ? { base: name.endsWith('-base'), prOpen: openIds.has(name) } : undefined,
      })
      if (!gone) sizeLater(e.path)
      out.push({ repo, path: e.path, branch: e.branch, mb: gone ? 0 : sizes.get(e.path)?.mb, ...v })
    }))
  }
  out.sort((a, b) => Number(b.remove) - Number(a.remove) || (b.mb ?? 0) - (a.mb ?? 0))
  cache = { at: Date.now(), list: out }
  return out
}

/** A PR's own worktrees: its Explain copy, its crit review folder, and any worktree on its branch. */
export function belongsTo(w: Pick<Worktree, 'path' | 'branch' | 'repo'>, pr: Pick<Pr, 'id' | 'repo' | 'number' | 'head'>) {
  if (w.repo !== pr.repo) return false
  if (w.path === join(OWN, pr.id.replace(/[/#]/g, '-'))) return true
  if (config.agent.worktree && w.path === fill(config.agent.worktree, { repoPath: config.repos[pr.repo], number: pr.number, repo: pr.repo })) return true
  return !!w.branch && w.branch === pr.head
}

/** Remove every worktree the rules allow (only those `only` accepts, when given), then prune. Re-checks each first. */
export async function cleanWorktrees(only?: (w: Worktree) => boolean): Promise<{ removed: number; mb: number; failed: string[] }> {
  const list = (await worktrees(true)).filter((w) => w.remove && (!only || only(w)))
  let removed = 0, mb = 0
  const failed: string[] = []
  for (const w of list) {
    const main = config.repos[w.repo]
    try {
      if (await there(w.path)) await git(main, 'worktree', 'remove', w.path)
      removed++; mb += w.mb ?? 0; sizes.delete(w.path)
    } catch (e) { failed.push(`${w.path}: ${(e as Error).message.split('\n')[0]}`) }
  }
  for (const main of new Set(list.map((w) => config.repos[w.repo]))) await git(main, 'worktree', 'prune').catch(() => {})
  cache = undefined
  return { removed, mb, failed }
}

/** The nightly sweep is due when the last one ran before the most recent 03:00 (local time). */
export function sweepDue(lastSweepAt: string | undefined, now = new Date()) {
  const last3 = new Date(now); last3.setHours(3, 0, 0, 0)
  if (now < last3) last3.setDate(last3.getDate() - 1)
  return !lastSweepAt || new Date(lastSweepAt) < last3
}
