// The machines that run agents, as the control plane sees them (worker.ts has the wire). Each machine's bin/standby
// writes where its worker answers into its heartbeat (hosts/<name>.json, in the synced state); the control plane asks
// each one how much room it has every 15s and sends an exec run to the one with the most. A machine's room is its own
// DECK_SLOTS (your work laptop: 1), so the busy ones get less. Nothing here while this is one machine (no fleet).
import { readdir, readFile } from 'node:fs/promises'
import { availableParallelism, cpus, freemem, homedir, totalmem } from 'node:os'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { busyUnder } from './background.ts'
import { fleet } from './fleet.ts'
import { STATE_DIR } from './paths.ts'
import { recentLines } from './logRing.ts'
import { scrub } from './scrub.ts'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { state } from './store.ts'
import { spawnAgent, type ProviderId } from './providers.ts'
import { call, serveWorker, tokenIn, type WorkerStatus } from './worker.ts'
import { runningHere, type Running } from './versions.ts'

let tok: string | undefined, tokAt = 0, prev: { t: string; until: number } | undefined
/** The token every machine shares (a file in the synced state), re-read now and then: the sync may replace it. */
export const token = () => {
  if (!tok || Date.now() - tokAt > 30_000) {
    const now = tokenIn(STATE_DIR)
    if (tok && now !== tok) prev = { t: tok, until: Date.now() + 10 * 60_000 } // rotated: the old one still works a while
    tok = now; tokAt = Date.now()
  }
  return tok
}
/** What a caller may present: the token, and for 10 minutes after a rotation the one before (runs in flight still use it). */
const accepted = () => [token(), ...(prev && prev.until > Date.now() ? [prev.t] : [])]
/** A new machine key (Settings → Machines; the route sends it to the other machines first): the old one works 10 more minutes. */
export function rotateToken(next = randomBytes(32).toString('hex')) {
  const old = token()
  writeFileSync(join(STATE_DIR, 'worker-token'), next + '\n', { mode: 0o600 })
  tokAt = 0; token()
  prev = { t: old, until: Date.now() + 10 * 60_000 }
}

const LOW_MB = 1536
/** How many agents this machine takes at once: its own DECK_SLOTS, else the app's parallel cap. */
export const slotsHere = (cap: number) => Math.max(0, Number(process.env.DECK_SLOTS) || cap)

/** A machine's room, after the cap on the one you work on (Settings → Machines): set here, so it holds at once. */
export const capped = (name: string | undefined, slots: number) =>
  name && name === state.settings.workMachine ? Math.min(slots, state.settings.workSlots ?? 1) : slots

let cameBack: ((name: string) => void) | undefined
/** Called when a machine starts answering (a new one, or one back from sleep): it gets what changed while it was away. */
export const onCameBack = (f: (name: string) => void) => { cameBack = f }
/** Ask every other machine (or one) a named thing (worker `extra`); one that doesn't answer is skipped. */
export const ask = <T>(what: string, input: unknown, only?: string) => Promise.all([...machines.values()].filter((m) => m.status && (!only || m.name === only))
  .map((m) => call<T>(m.base, token(), 'POST', `/x/${what}`, input, 90_000).then((r) => [m.name, r] as const, (e: Error) => { console.warn(`machines: ${m.name} ${what}: ${e.message}`); return [m.name, undefined] as const })))

export type Machine = { name: string; base: string; status?: WorkerStatus; seen: number }
export const machines = new Map<string, Machine>()

async function refresh() {
  // only the control plane sends work out; every other machine is a worker itself
  if (!fleet.machine || fleet.elsewhere()) { machines.clear(); return }
  const dir = join(STATE_DIR, 'hosts')
  const names = new Set<string>()
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const name = f.slice(0, -5)
    if (name === fleet.machine) continue
    const b = JSON.parse(await readFile(join(dir, f), 'utf8').catch(() => '{}')) as { worker?: string }
    if (!b.worker || !/^https?:\/\/[\w.:[\]-]+$/.test(b.worker)) continue
    names.add(name)
    const status = await call<WorkerStatus>(b.worker, token(), 'GET', '/status', undefined, 5000).catch(() => undefined)
    const was = machines.get(name)
    if (!!status !== !!was?.status) console.log(`machines: ${name} ${status ? `answers at ${b.worker} (${status.slots} slots)` : `doesn't answer at ${b.worker}`}`)
    if (status && !was?.status) cameBack?.(name)
    machines.set(name, { name, base: b.worker, status, seen: status ? Date.now() : was?.seen ?? 0 })
  }
  for (const n of machines.keys()) if (!names.has(n)) machines.delete(n)
}
if (fleet.machine) { void refresh(); setInterval(() => void refresh(), 15_000).unref() }

/**
 * Where a run goes: the machine it ran on before (its worktree and session are there) if it has room, else the one
 * with the most room left, this one included. `here` is how many this machine runs and may run; `out` how many this
 * control plane already sent to each machine. Undefined: nowhere has room.
 */
export function place(prefer: string | undefined, here: { running: number; slots: number; freeMb: number }, out: Map<string, number>, provider?: string): string | undefined {
  const room = new Map<string, number>()
  if (here.freeMb >= LOW_MB || here.running === 0) room.set(fleet.machine ?? '', capped(fleet.machine, here.slots) - here.running)
  for (const m of machines.values()) {
    if (!m.status || m.status.freeMb < LOW_MB) continue
    if (provider && m.status.can && !m.status.can.includes(provider)) continue // that account isn't signed in (or its Ollama isn't running) there
    room.set(m.name, capped(m.name, m.status.slots) - Math.max(m.status.running, out.get(m.name) ?? 0))
  }
  for (const [k, v] of room) if (v <= 0) room.delete(k)
  if (prefer && room.has(prefer)) return prefer
  return [...room.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

// --- this machine as a worker: runs what the control plane (another machine) sends it
let served: ReturnType<typeof serveWorker> | undefined
export const hosted = () => served?.hosted ?? new Map()
// the whole machine's CPU, sampled every 5s from the kernel's counters (what any monitor shows), 0-100
const ticks = () => cpus().reduce((t, c) => { const all = Object.values(c.times).reduce((a, b) => a + b, 0); return { idle: t.idle + c.times.idle, all: t.all + all } }, { idle: 0, all: 0 })
let lastTicks = ticks(), cpuPct = 0
setInterval(() => { const now = ticks(), d = now.all - lastTicks.all; if (d > 0) cpuPct = Math.round(100 * (1 - (now.idle - lastTicks.idle) / d)); lastTicks = now }, 5_000).unref()

export type Stats = {
  name: string; role?: string; control: boolean
  cores: number; cpu: number; agentsCpu: number // whole machine, and Concierge's agents: % of all its cores
  mb: number; usedMb: number; agentsMb: number
  diskGb?: number; diskUsedGb?: number
  running: number; slots: number
} & Running
/** This machine's numbers: the whole machine, and what Concierge's agents take of it. */
export async function statsHere(own: () => Promise<{ cpu: number; mb: number }>, running: number, slots: number): Promise<Stats> {
  const [u, d] = await Promise.all([own().catch(() => ({ cpu: 0, mb: 0 })), statfs(homedir()).catch(() => undefined)])
  const cores = availableParallelism(), mb = Math.round(totalmem() / 1048576)
  const gb = (blocks: number, size: number) => Math.round((blocks * size) / 1073741824)
  return {
    name: fleet.machine ?? 'this machine', role: process.env.DECK_ROLE, control: !fleet.elsewhere(),
    // ps's %cpu is each process's average over its life, the machine's is now: the agents' share never above the whole
    cores, cpu: cpuPct, agentsCpu: Math.min(cpuPct, Math.round(u.cpu / cores)), mb, usedMb: mb - Math.round(freemem() / 1048576), agentsMb: u.mb,
    ...(d && { diskGb: gb(d.blocks, d.bsize), diskUsedGb: gb(d.blocks - d.bavail, d.bsize) }),
    running, slots, ...runningHere(),
  }
}

// an update is built and waiting for this machine to be quiet (bin/update): no new runs here until it restarts
let drainingSince: number | undefined
const DRAIN = join(STATE_DIR, `draining${fleet.machine ? `.${fleet.machine}` : ''}`)
setInterval(() => void readFile(DRAIN, 'utf8').then((t) => { drainingSince = Number(t.trim()) * 1000 || Date.now() }, () => { drainingSince = undefined }), 10_000).unref()
/** Since when an update waits here (no new runs start meanwhile); undefined: none. Ignored after 2h (a stale file). */
export const draining = () => (drainingSince && Date.now() - drainingSince < 2 * 3600_000 ? drainingSince : undefined)

let usage = { cpu: 0, mb: 0 }
/** `own`: what the agents this process started use (load.ts), read every 10s while it hosts any. */
/** `can`: the accounts this machine can run right now (signed in, or its Ollama up), told to the control plane. */
export function serve(cap: () => number, own: () => Promise<{ cpu: number; mb: number }>, extra: Record<string, (input: any) => Promise<unknown>>, can: () => string[], open?: Parameters<typeof serveWorker>[0]['open']) {
  if (!fleet.machine || served) return
  setInterval(() => { if (served?.hosted.size) void own().then((u) => { usage = u }, () => {}); else usage = { cpu: 0, mb: 0 } }, 10_000).unref()
  const port = Number(process.env.DECK_WORKER_PORT) || 4748
  // WSL with its own Tailscale (LINK=host) is reachable only from Windows and the tailnet: every address. In Docker
  // Desktop the link container hands tailnet connections to 127.0.0.1, so loopback is enough there
  const host = process.env.DECK_WORKER_HOST || (process.env.LINK === 'host' ? '0.0.0.0' : '127.0.0.1')
  served = serveWorker({
    port, host, token: accepted,
    start: (s) => spawnAgent(s.provider as ProviderId, s.args, { cwd: s.cwd, stdin: s.stdin }),
    // no room while this machine is the control plane itself (it runs its own), or low on memory
    status: () => {
      const freeMb = Math.round(freemem() / 1048576)
      return { name: fleet.machine!, role: process.env.DECK_ROLE, slots: fleet.elsewhere() && freeMb >= LOW_MB && !draining() ? slotsHere(cap()) : 0, running: served?.hosted.size ?? 0, freeMb,
        cores: availableParallelism(), mb: Math.round(totalmem() / 1048576), cpu: usage.cpu, usedMb: usage.mb, can: can() }
    },
    busy: busyUnder,
    logs: () => recentLines().map(scrub),
    extra,
    open,
  })
  served.server.on('error', (e) => console.warn(`worker: can't listen on ${host}:${port} (${e.message}); this machine takes no work from others`))
  served.server.on('listening', () => console.log(`worker: takes runs from the control plane on ${host}:${port}`))
}
