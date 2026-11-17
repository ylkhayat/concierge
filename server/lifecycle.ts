// Every state change of a job, exec run, explanation or codebase map goes through transition(): it checks the move
// against one table of what may follow what, and appends it to the event log (events.jsonl, append-only). The log is
// the history nothing else keeps: state.json holds each PR's latest job only, and a feed only what the agent said.
// The Runs view and its totals are read from it. Own paths (no import of store.ts, which calls this while loading).
import { appendFile, readFile } from 'node:fs/promises'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './paths.ts'
import { mine, readLines } from './perMachine.ts'

export type RunState = 'queued' | 'running' | 'done' | 'failed' | 'interrupted' | 'cancelled'
export type Entity = 'job' | 'exec' | 'explain' | 'base' | 'op' // op: a tool run on a PR (Smart rebase, re-run checks…)

// what may follow what. running → queued: its session was gone (it starts over) or a restart stopped it (it continues).
// A finished one starts again only as a new run (queued). interrupted is final until you act: nothing restarts it.
const LEGAL: Record<RunState, RunState[]> = {
  queued: ['running', 'cancelled', 'interrupted'],
  running: ['done', 'failed', 'cancelled', 'interrupted', 'queued'],
  done: ['queued'],
  failed: ['queued'],
  cancelled: ['queued'],
  interrupted: ['queued', 'cancelled'],
}
export const legal = (from: RunState | undefined, to: RunState) => from === undefined || from === to || LEGAL[from].includes(to)

export const EVENTS = join(STATE_DIR, 'events.jsonl')
mkdirSync(join(EVENTS, '..'), { recursive: true })
// a log that only grows: past 20 MB (months of runs) it moves aside as events-<date>.jsonl and a new one starts
// each machine appends to its own copy (perMachine.ts); runs() reads them all, in time order
const OWN_EVENTS = mine(EVENTS)
try { if (statSync(OWN_EVENTS).size > 20 * 1024 * 1024) renameSync(OWN_EVENTS, OWN_EVENTS.replace(/\.jsonl$/, `-${new Date().toISOString().slice(0, 10)}.jsonl`)) } catch { /* none yet */ }

export type RunEvent = {
  at: string; entity: Entity; id: string // the PR, ticket run or repo it belongs to
  run: string // one run of it: a PR job's queuedAt, an exec run's id, a task's queuedAt
  kind?: string; from?: RunState; to: RunState; cause: string
  costUsd?: number; turns?: number; refused?: number; error?: string; illegal?: true
  skills?: string[]; steers?: number // on its last event: the skills it used, and how many times you steered it while it ran
}

let writing: Promise<void> = Promise.resolve()
let sync = false // while the server goes down: written at once, since nothing waits for a promise any more
export const eventsSync = () => { sync = true }
function record(e: RunEvent) {
  const line = JSON.stringify(e) + '\n'
  if (sync) { try { appendFileSync(OWN_EVENTS, line) } catch { /* nothing to do */ } return }
  writing = writing.then(() => appendFile(OWN_EVENTS, line)).catch((err) => console.error('events:', (err as Error).message))
}
export const eventsWritten = () => writing

type Thing = { state: RunState; error?: string }
/**
 * Move `thing` to `to` for `cause` ("started", "result", "cancelled", "session gone", "restart"…), with what changes
 * alongside. An illegal move is still made (stopping a run halfway would be worse) but logged loudly and marked in
 * the event log, so a lifecycle bug shows up instead of hiding in a state nobody expected.
 */
export function transition<T extends Thing>(entity: Entity, id: string, run: string, thing: T, to: RunState, cause: string,
  extra: Partial<T> = {}, facts: Pick<RunEvent, 'kind' | 'costUsd' | 'turns' | 'refused' | 'skills' | 'steers'> = {}): T {
  const from = thing.state
  const ok = legal(from, to)
  if (!ok) console.warn(`lifecycle: ${entity} ${id} went ${from} → ${to} (${cause}), which the table doesn't allow`)
  Object.assign(thing, extra, { state: to })
  record({ at: new Date().toISOString(), entity, id, run, from, to, cause, ...facts, ...(to === 'failed' || to === 'interrupted' ? { error: thing.error?.slice(0, 300) } : {}), ...(ok ? {} : { illegal: true as const }) })
  return thing
}

/** The event log's runs, newest first: each run's last word (its state now) with what it cost and why it ended. */
export async function runs(sinceDays = 7) {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString()
  const text = await readLines(EVENTS)
  const byRun = new Map<string, RunEvent & { startedAt?: string; queuedAt?: string; restarts: number }>()
  for (const line of text.split('\n')) {
    if (!line) continue
    let e: RunEvent
    try { e = JSON.parse(line) } catch { continue }
    if (e.at < since) continue
    const k = `${e.entity}|${e.id}|${e.run}`
    const prev = byRun.get(k)
    const r = { ...prev, ...e, restarts: (prev?.restarts ?? 0) + (e.cause === 'restart' ? 1 : 0),
      queuedAt: prev?.queuedAt ?? (e.to === 'queued' ? e.at : undefined), startedAt: prev?.startedAt ?? (e.to === 'running' ? e.at : undefined),
      // a run that was paused or continued ran in parts, each event carrying its own part's cost: the run cost their sum
      costUsd: e.from === 'running' ? ((prev?.costUsd ?? 0) + (e.costUsd ?? 0) || undefined) : (prev?.costUsd ?? e.costUsd), turns: e.turns ?? prev?.turns, refused: e.refused ?? prev?.refused, kind: e.kind ?? prev?.kind,
      skills: e.skills ?? prev?.skills, steers: e.steers ?? prev?.steers }
    byRun.set(k, r)
  }
  return [...byRun.values()].sort((a, b) => b.at.localeCompare(a.at))
}

/** Per day: how many runs ended, how they ended, what they cost, how many commands were refused. */
export async function totals(sinceDays = 7) {
  const days = new Map<string, { day: string; runs: number; done: number; failed: number; cancelled: number; interrupted: number; refused: number; costUsd: number }>()
  for (const r of await runs(sinceDays)) {
    if (!['done', 'failed', 'cancelled', 'interrupted'].includes(r.to)) continue
    const day = new Date(r.at).toLocaleDateString('en-CA')
    const d = days.get(day) ?? { day, runs: 0, done: 0, failed: 0, cancelled: 0, interrupted: 0, refused: 0, costUsd: 0 }
    d.runs++; (d as any)[r.to]++; d.refused += r.refused ?? 0; d.costUsd += r.costUsd ?? 0
    days.set(day, d)
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, costUsd: Math.round(d.costUsd * 100) / 100 }))
}
