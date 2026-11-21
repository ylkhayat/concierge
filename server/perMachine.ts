// Files two machines would both write (activity logs, the event log, codebase maps, explanations): each machine writes
// its own copy, `name.<machine>.ext` beside the shared name, and readers merge every machine's copy. The file sync
// (Syncthing) then never sees two writers on one file, so it never splits one into conflict copies and loses lines.
// One machine (no fleet): the plain name, as before. A copy from before this (the plain name) is read as one more.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fleet } from './fleet.ts'
import { STATE_DIR } from './paths.ts'

const parts = (p: string) => {
  const file = basename(p), dot = file.lastIndexOf('.')
  return { dir: dirname(p), name: dot > 0 ? file.slice(0, dot) : file, ext: dot > 0 ? file.slice(dot) : '' }
}
const variant = (p: string, machine: string) => { const { dir, name, ext } = parts(p); return join(dir, `${name}.${machine}${ext}`) }

/** Where this machine writes `p`. */
export const mine = (p: string) => (fleet.machine ? variant(p, fleet.machine) : p)

// the machines there are: from their heartbeats (hosts/<name>.json), re-read every minute
let known: string[] = [], readAt = 0
/** The fleet's machines by name (none with one machine). */
export const fleetMachines = () => machines()
function machines(): string[] {
  if (!fleet.machine) return []
  if (Date.now() - readAt > 60_000) {
    readAt = Date.now()
    try {
      known = readdirSync(join(STATE_DIR, 'hosts')).filter((f) => f.endsWith('.json') && !f.startsWith('.') && !f.includes('sync-conflict')).map((f) => f.slice(0, -5))
    } catch { known = [] }
    if (!known.includes(fleet.machine)) known.push(fleet.machine)
  }
  return known
}

/** Every copy of `p` that exists: the plain one (from before, or one machine), then each machine's. */
export const copies = (p: string): string[] => [p, ...machines().map((m) => variant(p, m))].filter((f) => existsSync(f))

/** A JSON file's copies, merged: `entries` merges a record whose values carry `at` (newest wins), else the newest file. */
export function readMerged<T>(p: string, how: 'newest' | 'entries' = 'newest'): T | undefined {
  const files = copies(p)
  if (files.length <= 1) { try { return files[0] ? JSON.parse(readFileSync(files[0], 'utf8')) : undefined } catch { return undefined } }
  const read = files.flatMap((f) => { try { return [{ v: JSON.parse(readFileSync(f, 'utf8')), t: statSync(f).mtimeMs }] } catch { return [] } })
  if (how === 'newest') return read.sort((a, b) => b.t - a.t)[0]?.v
  const out: Record<string, { at?: string }> = {}
  for (const { v } of read) for (const [k, x] of Object.entries(v as Record<string, { at?: string }>)) if (!out[k] || (x?.at ?? '') > (out[k].at ?? '')) out[k] = x
  return out as T
}

const TIME = /"(?:timestamp|at)":"([^"]+)"/
/**
 * A JSONL log's copies as one text, its lines in time order (each line's "timestamp" or "at"; a line without one keeps
 * its place after the line before it). `tail`: at most that many bytes of each copy, from its end.
 */
export async function readLines(p: string, tail = Infinity): Promise<string> {
  const files = copies(p)
  const texts = await Promise.all(files.map(async (f) => {
    const fh = await open(f, 'r').catch(() => undefined)
    if (!fh) return ''
    try {
      const { size } = await fh.stat()
      const n = Math.min(size, tail), buf = Buffer.alloc(n)
      await fh.read(buf, 0, n, size - n)
      const text = buf.toString('utf8')
      return size > n ? text.slice(text.indexOf('\n') + 1) : text // a cut first line is dropped
    } finally { await fh.close() }
  }))
  if (texts.length <= 1) return texts[0] ?? ''
  const lines: { t: string; f: number; i: number; l: string }[] = []
  texts.forEach((text, f) => { let t = ''; text.split('\n').forEach((l, i) => { if (!l) return; t = TIME.exec(l)?.[1] ?? t; lines.push({ t, f, i, l }) }) })
  lines.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.f - b.f || a.i - b.i))
  return lines.map((x) => x.l).join('\n') + '\n'
}
