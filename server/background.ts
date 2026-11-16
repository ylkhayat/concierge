// What an agent started to run on its own while it went on: a shell with run_in_background, a background subagent,
// or a command detached by hand (nohup, setsid, a trailing &). The feed shows only the launch, so each is kept here
// per run key (a PR's id, exec:<run>): what it runs, where its output goes, whether it is still going, and it can be
// stopped. Read from the agent's own stream (watch) and from the process table when you look (view).
import { execFile } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { save, state } from './store.ts'
import { brief } from './brief.ts'

export type BgTask = {
  id: string // the tool call that started it
  kind: 'shell' | 'agent' | 'detached'
  cmd: string // the command (a subagent: its description)
  at: string
  shell?: string // Claude's id for a background shell, from the tool's answer
  output?: string // where its output is written
  checkedAt?: string // the agent read its output since
  stoppedAt?: string // stopped, by the agent or by you
  endedAt?: string // no process of it left
}

const list = (key: string): BgTask[] => ((state.background ??= {})[key] ??= [])
const short = (s: unknown, n = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
// a command that leaves something running after it returns: nohup, setsid, disown, or a lone & (not && or 2>&1)
const DETACHED = /\bnohup\b|\bsetsid\b|\bdisown\b|(?<![&>|0-9])&(?![&>])\s*(?:$|;|\n|\))/

/** One line of an agent's stream: note what it starts in the background, the answers that say where, and stops. */
export function watch(key: string, m: any) {
  let changed = false
  if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
    if (c.type !== 'tool_use') continue
    const i = c.input ?? {}
    const add = (kind: BgTask['kind'], cmd: string) => { list(key).push({ id: c.id, kind, cmd: short(cmd), at: new Date().toISOString() }); changed = true }
    if (c.name === 'Bash' && i.run_in_background) add('shell', i.command)
    else if (c.name === 'Bash' && typeof i.command === 'string' && DETACHED.test(i.command)) add('detached', i.command)
    else if ((c.name === 'Agent' || c.name === 'Task') && i.run_in_background) add('agent', i.description || i.prompt)
    else if (/^(BashOutput|TaskOutput)$/.test(c.name)) {
      const t = list(key).find((x) => x.shell && (x.shell === i.bash_id || x.shell === i.task_id || x.shell === i.shell_id))
      if (t) { t.checkedAt = new Date().toISOString(); changed = true }
    } else if (/^(KillShell|KillBash|TaskStop)$/.test(c.name)) {
      const t = list(key).find((x) => x.shell && (x.shell === i.shell_id || x.shell === i.bash_id || x.shell === i.task_id))
      if (t) { t.stoppedAt = new Date().toISOString(); changed = true }
    }
  }
  if (m.type === 'user') for (const c of m.message?.content ?? []) {
    if (c.type !== 'tool_result') continue
    const t = list(key).find((x) => x.id === c.tool_use_id)
    if (!t) continue
    const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x: any) => x.text ?? '').join('\n')
    t.shell ??= text.match(/\bID:?\s*([\w-]{4,})/)?.[1]
    t.output ??= text.match(/(?:written to|output (?:file|is in))[:\s]+(\S+)/i)?.[1]?.replace(/[.,;)]+$/, '')
    changed = true
  }
  // Claude says when a background task of its own ends (or is stopped): no need to wait for someone to look
  if (m.type === 'system' && m.subtype === 'task_notification') {
    const t = list(key).find((x) => x.id === m.tool_use_id)
    if (t && !t.endedAt && !t.stoppedAt) { t[m.status === 'stopped' ? 'stoppedAt' : 'endedAt'] = new Date().toISOString(); changed = true }
  }
  // a detached command's own redirect is where its output goes
  for (const t of list(key)) if (t.kind === 'detached' && !t.output) { const r = t.cmd.match(/>>?\s*(\/\S+)/)?.[1]; if (r) { t.output = r; changed = true } }
  if (changed) save()
}

/** A new run starts: what ended or was stopped before is history; what still runs stays in view. */
export function newRun(key: string) {
  const l = state.background?.[key]
  if (l) state.background![key] = l.filter((t) => !t.endedAt && !t.stoppedAt)
}

/** Background work you haven't seen end: what the page counts. */
export const openTasks = (key: string) => (state.background?.[key] ?? []).filter((t) => !t.endedAt && !t.stoppedAt).length

type Proc = { pid: number; ppid: number; cpu: number; mb: number; cmd: string }
const run = promisify(execFile)
const ps = async (): Promise<Proc[]> => (await run('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command='], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim().split('\n').map((l) => {
  const [, pid, ppid, cpu, rss, cmd] = l.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/) ?? []
  return { pid: +pid, ppid: +ppid, cpu: +cpu, mb: Math.round(+rss / 1024), cmd }
}).filter((p) => p.pid)
const below = (root: number, all: Proc[]) => { const out = all.filter((p) => p.pid === root); for (let i = 0; i < out.length; i++) out.push(...all.filter((p) => p.ppid === out[i].pid)); return out }
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
// the processes that are this task: its command line (a long enough piece of it) in theirs, and what they started
function procsOf(t: BgTask, all: Proc[]): Proc[] {
  if (t.kind === 'agent') return []
  // the command that does the work, not the setup in front of it ("B=…; setsid nohup …"): that is what ps shows
  const words = norm(brief(t.cmd))
  const probe = words.length > 60 ? words.slice(0, 60) : words
  if (probe.length < 6) return []
  // not the agent itself (its prompt can quote the command), unless the task is a nested claude -p (a /revise)
  const nested = /\bclaude\b.*(-p|--print)/
  const hits = all.filter((p) => norm(p.cmd).includes(probe) && (!nested.test(p.cmd) || nested.test(words)))
  return [...new Map(hits.flatMap((h) => below(h.pid, all)).map((p) => [p.pid, p])).values()]
}
async function tail(path?: string, bytes = 3000): Promise<string | undefined> {
  if (!path) return undefined
  try {
    const s = await stat(path), f = await open(path, 'r')
    try { const len = Math.min(bytes, s.size), b = Buffer.alloc(len); await f.read(b, 0, len, s.size - len); return b.toString('utf8') } finally { await f.close() }
  } catch { return undefined }
}

/**
 * Is the agent (pid) doing anything besides talking to the model: a process under it other than its connectors (a
 * test run, a build, a shell). None while it says nothing for long means it is waiting on a reply that never comes.
 * A failing ps counts as busy: never restart an agent on a guess.
 */
export async function busyUnder(pid?: number): Promise<boolean> {
  if (!pid) return true
  const all = await ps().catch(() => undefined)
  if (!all) return true
  return below(pid, all).some((p) => p.pid !== pid && !/\bmcp\b|mcp-server|@modelcontextprotocol|npm exec|npx /i.test(p.cmd))
}

/**
 * What runs in the background for `key` right now: each task with whether a process of it is left, what it last
 * printed, and whether it outlived the agent; and every other process under the agent (agentPid, when it runs).
 */
export async function view(key: string, agentPid?: number) {
  const list = (state.background?.[key] ?? []).slice(-20)
  const v = await viewOf(list, agentPid)
  ended(list, v.tasks)
  return v
}
/** A task the view found gone gets its end noted (on the machine that keeps the run's state). */
export function ended(list: BgTask[], seen: { id: string; alive: boolean; gone: boolean }[]) {
  let changed = false
  for (const s of seen) { const t = list.find((x) => x.id === s.id); if (t && s.gone && !t.endedAt && !t.stoppedAt) { t.endedAt = new Date().toISOString(); changed = true } }
  if (changed) save()
}
/**
 * The view itself, on the machine where the processes are: here for a local run, or on the worker that hosts a run for
 * another machine (machines.ts asks it with the run's task list).
 */
export async function viewOf(list: BgTask[], agentPid?: number) {
  const all = await ps().catch(() => [] as Proc[])
  const tasks = await Promise.all(list.map(async (t) => {
    const procs = procsOf(t, all)
    // a shell task's process may not be found by its line (Claude wraps it): its output file still growing says it runs
    const out = t.output ? await stat(t.output).then((s) => s.mtimeMs, () => 0) : 0
    // Claude's stream says when its own background shells and subagents end (task_notification): until then, while the
    // agent runs, they do too, printing or not (a watcher loop prints nothing)
    const alive = !t.stoppedAt && (procs.length > 0 || (t.kind !== 'detached' && !!agentPid && (!t.endedAt || Date.now() - out < 30_000)))
    const gone = !alive && procs.length === 0 && (t.kind === 'detached' || !agentPid)
    return { ...t, alive, gone, outlived: alive && !agentPid, pids: procs.map((p) => p.pid), cpu: Math.round(procs.reduce((n, p) => n + p.cpu, 0)), mb: procs.reduce((n, p) => n + p.mb, 0), tail: await tail(t.output) }
  }))
  // under the agent: what is not the agent itself and not one of its connectors (MCP servers it talks to)
  const tree = agentPid ? below(agentPid, all).filter((p) => p.pid !== agentPid && !/\bmcp\b|mcp-server|@modelcontextprotocol|npm exec|npx /i.test(p.cmd)) : []
  return { tasks: tasks.reverse(), procs: tree.map((p) => ({ pid: p.pid, cmd: short(p.cmd, 200), cpu: Math.round(p.cpu), mb: p.mb })) }
}

/** Stop one task (its processes, and what they started), or one process under the agent. Nothing else. */
export async function stop(key: string, which: { task?: string; pid?: number }, agentPid?: number) {
  const t = which.task ? (state.background?.[key] ?? []).find((x) => x.id === which.task) : undefined
  const r = await stopOf(t, which.pid, agentPid)
  if (t) { t.stoppedAt = new Date().toISOString(); save() }
  return r
}
/** The stop itself, on the machine where the processes are (see viewOf). */
export async function stopOf(t: BgTask | undefined, pid: number | undefined, agentPid?: number) {
  const all = await ps()
  let pids: number[] = []
  if (t) pids = procsOf(t, all).map((p) => p.pid)
  else if (pid && agentPid && below(agentPid, all).some((p) => p.pid === pid && p.pid !== agentPid)) pids = below(pid, all).map((p) => p.pid)
  if (!t && !pids.length) throw new Error('Not a background process of this run')
  for (const p of pids) { try { process.kill(p, 'SIGTERM') } catch { /* gone */ } }
  setTimeout(() => { for (const p of pids) { try { process.kill(p, 'SIGKILL') } catch { /* gone */ } } }, 3000).unref()
  return { stopped: pids.length }
}
