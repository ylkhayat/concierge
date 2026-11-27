// How long what the runs leave behind is kept. Everything here grew without end: a run's log, the agents' own
// transcripts, explanations, screenshots, the skills' working folders. Each has one rule, by how long a file has gone
// untouched (a PR or a ticket still being worked keeps touching its files, so nothing live is ever old). A file past its
// rule is removed on every machine by the same rule; a log or a transcript past it is not pulled back from a machine
// that still has it (replica.ts).
import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_HOME } from './agentHome.ts'
import { setting, STATE_DIR } from './paths.ts'

const DAY = 86_400_000
/**
 * Off until you turn it on (CONCIERGE_RETENTION=1): removing files is yours to decide. Off, a sweep only counts what it
 * would remove (the log says so once a day), and nothing is refused from another machine for its age.
 */
export const retentionOn = () => setting('RETENTION') === '1'
/**
 * root: replica.ts's name for the folder a path is under; dir: the folder inside it; days: untouched this long, it goes.
 * unit: what goes as one, by its depth under dir (1: each entry of the folder, a run's log or a PR's own folder; 2: each
 * entry one folder down, a session under its project). A unit is as old as the newest file in it: a skill's working
 * folder holds copies of sources with the dates they had years ago, beside what it wrote yesterday.
 * own: its files are written here and nowhere else took their dates from, so a file's own date says how old it is
 * (a log, a transcript): only these are also refused from another machine by their date.
 */
export const RULES: { root: 'state' | 'claude'; dir: string; days: number; unit: 1 | 2; own?: true }[] = [
  { root: 'state', dir: 'logs', days: 60, unit: 1, own: true }, // a run's activity: its page reads the tail of it
  { root: 'state', dir: 'explain', days: 90, unit: 1 },         // an explanation costs money to write again: kept longest
  { root: 'state', dir: 'visuals', days: 60, unit: 1 },
  { root: 'state', dir: 'revise', days: 60, unit: 1 },
  { root: 'state', dir: 'review-pr', days: 60, unit: 1 },
  { root: 'state', dir: 'review-pr-records', days: 60, unit: 1 },
  { root: 'state', dir: 'review-records', days: 60, unit: 1 },
  { root: 'state', dir: 'evals', days: 60, unit: 1 },
  { root: 'state', dir: 'crit', days: 60, unit: 1 },
  { root: 'state', dir: 'devlogs', days: 30, unit: 1, own: true },
  // the agents' own transcripts (what a run resumes from): a run idle for a month starts over if it is ever continued
  { root: 'claude', dir: 'projects', days: 30, unit: 2, own: true },
]

/** Past its rule, by its own date: only where a file's date is its own (see `own`). `rel`: the path inside its root. */
export function expired(root: string, rel: string, mtimeMs: number, now = Date.now(), on = retentionOn()): boolean {
  if (!on) return false
  const rule = RULES.find((r) => r.own && r.root === root && (rel === r.dir || rel.startsWith(`${r.dir}/`)))
  return !!rule && now - mtimeMs > rule.days * DAY
}

/** The newest date of anything under a path, and how much is there. */
async function measure(p: string): Promise<{ newest: number; files: number; bytes: number }> {
  const st = await lstat(p).catch(() => undefined)
  if (!st) return { newest: 0, files: 0, bytes: 0 }
  if (!st.isDirectory()) return { newest: st.mtimeMs, files: 1, bytes: st.size }
  let newest = 0, files = 0, bytes = 0
  for (const name of await readdir(p).catch(() => [] as string[])) { const m = await measure(join(p, name)); newest = Math.max(newest, m.newest); files += m.files; bytes += m.bytes }
  return { newest: files ? newest : st.mtimeMs, files, bytes } // an empty folder: as old as itself
}

/** Remove the units under one folder that are past their rule. Returns what went. */
async function expire(dir: string, days: number, unit: 1 | 2, now: number, remove: boolean): Promise<{ files: number; bytes: number }> {
  let files = 0, bytes = 0
  const units = async (d: string, depth: number): Promise<string[]> => {
    const here = (await readdir(d).catch(() => [] as string[])).map((n) => join(d, n))
    return depth === 1 ? here : (await Promise.all(here.map(async (p) => ((await lstat(p).catch(() => undefined))?.isDirectory() ? units(p, depth - 1) : [])))).flat()
  }
  for (const p of await units(dir, unit)) {
    const m = await measure(p)
    if (now - m.newest <= days * DAY) continue
    if (!remove) { files += m.files; bytes += m.bytes; continue }
    await rm(p, { recursive: true, force: true }).then(() => { files += m.files; bytes += m.bytes }, () => {})
  }
  return { files, bytes }
}

/** Apply every rule on this machine, or (remove: false) only count what it would take. `roots`: where each root is (a test gives its own). */
export async function sweep(now = Date.now(), roots: Record<string, string> = { state: STATE_DIR, claude: CLAUDE_HOME }, remove = retentionOn()) {
  let files = 0, bytes = 0
  for (const r of RULES) { const x = await expire(join(roots[r.root], r.dir), r.days, r.unit, now, remove); files += x.files; bytes += x.bytes }
  return { files, bytes, removed: remove }
}
