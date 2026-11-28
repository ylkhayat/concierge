import { execFile } from 'node:child_process'
import { readdir, readFile, statfs } from 'node:fs/promises'
import { availableParallelism, freemem, homedir, totalmem } from 'node:os'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import { CRIT_DIR } from './crit.ts'
import { stopAt, usageOf, cancel, cancelBase, cancelExec, cancelExplain, children, waitReason, STOPPED } from './runner.ts'
import { state } from './store.ts'
import { capped, hosted, machines } from './machines.ts'
import { accountOf } from './providers.ts'
import { fleet } from './fleet.ts'
import { every } from './every.ts'

const run = promisify(execFile)

/**
 * What is running on this machine because of Concierge or crit, and what it costs: agent runs, crit servers,
 * stray agents a restart left behind. One call stops a kind, or all of it.
 */
type Proc = { pid: number; ppid: number; cpu: number; mb: number; cmd: string }
// off the thread: ps runs as a child process the server waits for without blocking
const ps = async (): Promise<Proc[]> => (await run('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command='], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim().split('\n').map((l) => {
  const [, pid, ppid, cpu, rss, cmd] = l.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/) ?? []
  return { pid: +pid, ppid: +ppid, cpu: +cpu, mb: Math.round(+rss / 1024), cmd }
}).filter((p) => p.pid)
/** pid and everything below it */
export const treeOf = (root: number, all: Proc[]): Proc[] => {
  const out = all.filter((p) => p.pid === root)
  for (let i = 0; i < out.length; i++) out.push(...all.filter((p) => p.ppid === out[i].pid))
  return out
}
const plus = (u: { cpu: number; mb: number }, cpu: number, mb: number) => ({ cpu: u.cpu + cpu, mb: u.mb + mb })
const sum = (t: Proc[]) => ({ cpu: Math.round(t.reduce((n, p) => n + p.cpu, 0)), mb: t.reduce((n, p) => n + p.mb, 0) })
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const readJson = (p: string) => readFile(p, 'utf8').then((t) => JSON.parse(t), () => undefined)

const crits = async (all: Proc[]) => {
  const dir = join(CRIT_DIR, 'sessions')
  return (await Promise.all((await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, f)))))
    .filter((s) => s?.pid && alive(s.pid))
    .map((s) => {
      // the `crit` launcher sits above its `crit _serve`; both go
      const up = all.find((p) => p.pid === all.find((q) => q.pid === s.pid)?.ppid && /(^|\/)crit /.test(p.cmd))
      const tree = treeOf(up?.pid ?? s.pid, all)
      return { pid: up?.pid ?? (s.pid as number), port: s.port as number, name: basename(s.cwd ?? '?'), target: critTarget(s.port, s.cwd), ...sum(tree), tree }
    })
}

export type Target = { kind: 'pr' | 'ticket' | 'codebase'; id: string }
/** What a run is about, so the page can take you there. */
function targetOf(key: string): Target | undefined {
  if (key.startsWith('exec:')) { const id = state.execs[key.slice(5)]?.ids[0]; return id ? { kind: 'ticket', id } : undefined }
  if (key.startsWith('base:')) return { kind: 'codebase', id: key.slice(5) }
  const id = key.replace(/:(explain|rebase)$/, '')
  return state.prs[id] ? { kind: 'pr', id } : undefined
}
// a crit server belongs to the PR whose run started it (its port), or whose worktree it serves
const critTarget = (port: number, cwd?: string): Target | undefined => {
  const p = Object.values(state.prs).find((x) => x.job?.critPort === port || (!!cwd && x.job?.critCwd === cwd))
  return p && { kind: 'pr', id: p.id }
}

function label(key: string) {
  const [, id, what] = key.match(/^(.+?)(?::(explain|rebase))?$/)!
  if (key.startsWith('exec:')) { const r = state.execs[key.slice(5)]; return `${r?.label ?? 'Ship'} ${r?.ids.join(' → ') ?? ''}`.trim() }
  if (key.startsWith('base:')) return `Map ${key.slice(5)}`
  const pr = state.prs[id]
  return `${what === 'explain' ? 'Explain' : what === 'rebase' ? 'Rebase' : pr?.job?.kind === 'revise' ? 'Revise' : 'Review'} #${pr?.number ?? id}`
}

async function snapshot() {
  const all = await ps()
  const crit = await crits(all)
  const critPids = new Set(crit.flatMap((c) => c.tree.map((p) => p.pid)))
  const ours = treeOf(process.pid, all).filter((p) => p.pid !== process.pid && !critPids.has(p.pid))
  // agents whose parent is gone (a restart mid-run): they keep burning until killed
  const strays = all.filter((p) => p.ppid === 1 && /\bclaude\b.*--output-format stream-json/.test(p.cmd) && !ours.some((o) => o.pid === p.pid))
  const strayTrees = strays.flatMap((p) => treeOf(p.pid, all))
  const queued = Object.values(state.prs).filter((p) => p.job?.state === 'queued').length + Object.values(state.prs).filter((p) => p.explain?.state === 'queued').length
    + Object.values(state.execs).filter((r) => r.state === 'queued').length + Object.values(state.base).filter((t) => t.state === 'queued').length
  return { all, crit, ours, strays, strayTrees, queued }
}

// what this machine (in Docker or WSL: the VM it gets) has in total, and what is still free
const MB = 1024 * 1024
async function machine() {
  const d = await statfs(homedir()).catch(() => undefined)
  return {
    cores: availableParallelism(), mb: Math.round(totalmem() / MB), freeMb: Math.round(freemem() / MB),
    diskGb: d ? Math.round((d.blocks * d.bsize) / 1024 / MB) : undefined, diskFreeGb: d ? Math.round((d.bavail * d.bsize) / 1024 / MB) : undefined,
    slots: state.settings.maxJobs,
  }
}
/** What this process's agents use (on a worker: the ones it runs for the control plane). */
export const ownUsage = async () => { const all = await ps(); return sum(treeOf(process.pid, all).filter((p) => p.pid !== process.pid)) }

/**
 * Runs that stopped without finishing in the last week (failed, killed by restarts, cancelled) and that nothing has
 * run for since: kept in one place so each can go again (runner.ts runAgain).
 */
export function stoppedRuns() {
  const since = Date.now() - 7 * 86_400_000, execs = Object.values(state.execs)
  const row = (key: string, t: { state: string; error?: string; endedAt?: string; startedAt?: string; queuedAt: string }) =>
    ({ key, label: label(key), target: targetOf(key), state: t.state, why: t.error?.slice(0, 200), at: t.endedAt ?? t.startedAt ?? t.queuedAt })
  return [
    ...execs.filter((r) => STOPPED.has(r.state) && !execs.some((o) => o.id !== r.id && o.queuedAt > r.queuedAt && o.ids.some((id) => r.ids.includes(id)))).map((r) => row(`exec:${r.id}`, r)),
    ...Object.values(state.prs).filter((p) => p.job && !p.closed && STOPPED.has(p.job.state)).map((p) => row(p.id, p.job!)),
  ].filter((r) => Date.parse(r.at) > since).sort((a, b) => b.at.localeCompare(a.at))
}

export async function load() {
  const { crit, ours, strays, strayTrees, queued } = await snapshot()
  // several machines: the totals are all of them together (the per-machine line under Agents splits them)
  const up = [...machines.values()].flatMap((m) => (m.status ? [m.status] : []))
  const add = (k: 'cpu' | 'usedMb' | 'cores' | 'mb' | 'freeMb') => up.reduce((n, s) => n + (s[k] ?? 0), 0)
  const here = await machine()
  return {
    // this machine's own, and the ones it runs for another machine's control plane (bin/update waits for both)
    runs: [...[...children.keys()].map((k) => ({ key: k, label: label(k), target: targetOf(k), machine: (children.get(k) as { machine?: string }).machine })),
      ...[...hosted().values()].map((h) => ({ key: `hosted:${h.label}`, label: `${h.label} (for the control plane)`, target: undefined }))],
    // the other machines that take runs, and how full each is
    machines: machines.size ? [
      { name: fleet.machine ?? 'here', up: true, slots: here.slots, running: [...children.values()].filter((c) => !(c as { machine?: string }).machine).length, freeMb: here.freeMb },
      ...[...machines.values()].map((m) => ({ name: m.name, up: !!m.status, slots: m.status ? capped(m.name, m.status.slots) : 0, running: m.status?.running ?? 0, freeMb: m.status?.freeMb })),
    ] : [],
    queued,
    waiting: waitReason(), // why the queued ones aren't starting
    stopped: stoppedRuns(),

    strays: strays.length,
    crit: crit.map(({ tree: _, ...c }) => c),
    agents: plus(sum([...ours, ...strayTrees]), add('cpu'), add('usedMb')),
    total: plus(sum([...ours, ...strayTrees, ...crit.flatMap((c) => c.tree)]), add('cpu'), add('usedMb')),
    machine: { ...here, cores: here.cores + add('cores'), mb: here.mb + add('mb'), freeMb: here.freeMb + add('freeMb'),
      slots: here.slots + [...machines.values()].reduce((n, m) => n + (m.status ? capped(m.name, m.status.slots) : 0), 0), count: 1 + up.length },
    plan: usageOf('claude') && { ...usageOf('claude')!, stopAt: stopAt(), label: accountOf('claude').label }, // the Claude plan's windows, as the agents last reported them
  }
}
export type Load = Awaited<ReturnType<typeof load>>

const term = (pids: number[]) => {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  // ponytail: one hard pass after 5s for whatever ignored SIGTERM
  setTimeout(() => { for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }, 5000)
}

/** Stop crit servers, agent runs (queued ones too), or both. Returns how many things it stopped. */
export async function stop(what: 'crit' | 'runs' | 'all') {
  const { crit, ours, strayTrees } = await snapshot()
  let n = 0
  if (what !== 'crit') {
    for (const p of Object.values(state.prs)) {
      if (p.job?.state === 'queued' || p.job?.state === 'running') { cancel(p); n++ }
      if (p.explain?.state === 'queued' || p.explain?.state === 'running') { cancelExplain(p); n++ }
    }
    for (const r of Object.values(state.execs)) if (r.state === 'queued' || r.state === 'running') { cancelExec(r.id); n++ }
    for (const [repo, t] of Object.entries(state.base)) if (t.state === 'queued' || t.state === 'running') { cancelBase(repo); n++ }
    for (const [k, c] of children) if (k.endsWith(':rebase')) { c.kill('SIGTERM'); n++ }
    // and every process below them (subagents, nested claude -p), plus strays from an earlier server
    const procs = [...ours, ...strayTrees].map((p) => p.pid)
    n += strayTrees.filter((p) => p.ppid === 1).length
    term(procs)
  }
  if (what !== 'runs') { term(crit.flatMap((c) => c.tree.map((p) => p.pid))); n += crit.length }
  return n
}

/**
 * Crit servers nothing uses any more: the PR was merged or closed, or its last run ended over CRIT_IDLE_H ago with
 * none since. Each is ~40 MB and they piled up. Stopping one keeps its session: Restart crit brings it back as it was.
 */
const CRIT_IDLE_H = 12
export async function reapCrit() {
  const { crit } = await snapshot()
  const old = Date.now() - CRIT_IDLE_H * 3600_000
  const gone = crit.filter((c) => {
    if (c.target?.kind !== 'pr') return false
    const p = state.prs[c.target.id]
    if (!p) return false
    if (p.closed) return true
    const j = p.job
    return !!j && j.state !== 'running' && j.state !== 'queued' && !!j.endedAt && Date.parse(j.endedAt) < old
  })
  if (gone.length) { term(gone.flatMap((c) => c.tree.map((p) => p.pid))); console.log(`crit: stopped ${gone.map((c) => c.name).join(', ')}`) }
  return gone.length
}
every('reap crit', () => reapCrit(), 10 * 60_000)
