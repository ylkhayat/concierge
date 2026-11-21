// Two machines, one state, no file sync. The machine holding the lease (fleet.ts) is the only one that changes the state;
// every other one follows it over the machines' own link (worker.ts: tailnet only, the machine key):
//
//   the state  a follower asks the holder for its change log since the last change it has (db.ts), every 2s, and
//              applies it (store.ts applyRemote). A run's update is one entry, a few kilobytes. A follower too far
//              behind (or new) takes every entry once.
//   files      what agents and the app write beside the state and that the other machine needs to go on where this
//              one stopped: run logs, explanations, drafts, the skills' notes, the settings, and Concierge's Claude
//              sessions (so a run continues in the same conversation there). Each machine keeps an index of those
//              (size, time) and pulls from every other what is newer there, every 20s; a log that only grew comes
//              over from where it was. Worktrees, scratch folders, caches and sign-ins never do: those stay per machine.
//
// What replaced Syncthing, which re-walked ~100k files every minute and re-sent a 7 MB state file on every change.
import { randomUUID } from 'node:crypto'
import { appendFile, lstat, mkdir, open, readdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CLAUDE_HOME, sessionDir } from './agentHome.ts'
import { reloadConfig } from './config.ts'
import { fleet } from './fleet.ts'
import { token } from './machines.ts'
import { CONFIG_DIR, STATE_DIR } from './paths.ts'
import { applyRemote, db } from './store.ts'
import { call } from './worker.ts'

// --- where the other machines answer: their heartbeats (hosts/<name>.json, bin/standby) say ------------------------
export async function peers(): Promise<{ name: string; base: string; active?: boolean }[]> {
  const dir = join(STATE_DIR, 'hosts'), out: { name: string; base: string; active?: boolean }[] = []
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith('.json') || f.startsWith('.') || f.slice(0, -5) === fleet.machine) continue
    const b = JSON.parse(await readFile(join(dir, f), 'utf8').catch(() => '{}')) as { worker?: string; active?: boolean }
    if (b.worker && /^https?:\/\/[\w.:[\]-]+$/.test(b.worker)) out.push({ name: f.slice(0, -5), base: b.worker, active: b.active })
  }
  return out
}

// --- the state: follow the holder's change log -----------------------------------------------------------------------
/** This database's identity: a follower that has another one's numbers starts over (it was recreated). */
const epoch = () => db.getKv('epoch') ?? (db.setKv('epoch', randomUUID()), db.getKv('epoch')!)
type Changes = { epoch: string; head: number; upto: number; more?: boolean; changes?: { key: string; value: string | null }[]; full?: [string, string][] }

/** The holder's side: what changed after `since` (or every entry, when the follower is new or too far behind). */
export function changesSince(since: number, theirEpoch?: string): Changes {
  const head = db.head(), mine = epoch()
  if (!since || theirEpoch !== mine || since > head || since < db.oldest() - 1) return { epoch: mine, head, upto: head, full: [...db.all()] }
  const got = db.since(since)
  const upto = got.at(-1)?.seq ?? since
  return { epoch: mine, head, upto, more: upto < head, changes: got.map(({ key, value }) => ({ key, value })) }
}

const follow = { from: undefined as string | undefined, head: 0, applied: 0, at: 0, error: undefined as string | undefined }
async function pullState() {
  const from = fleet.elsewhere()
  if (!from) { follow.from = undefined; return } // this machine holds it (or nobody does): nothing to follow
  const peer = (await peers()).find((p) => p.name === from)
  if (!peer) { Object.assign(follow, { from, error: `no address for ${from} yet` }); return }
  try {
    for (let round = 0; round < 50; round++) { // a long backlog in pages of 2000, then wait for the next tick
      const since = Number(db.getKv(`applied:${from}`) ?? 0)
      const r = await call<Changes>(peer.base, token(), 'POST', '/x/replica', { since, epoch: db.getKv(`epoch:${from}`) }, 60_000)
      if (r.full) { applyRemote([], new Map(r.full)); console.log(`replica: took all ${r.full.length} entries from ${from}`) }
      else if (r.changes?.length) applyRemote(r.changes)
      db.setKv(`applied:${from}`, String(r.upto)); db.setKv(`epoch:${from}`, r.epoch)
      Object.assign(follow, { from, head: r.head, applied: r.upto, at: Date.now(), error: undefined })
      if (!r.more) break
    }
  } catch (e) { Object.assign(follow, { from, error: (e as Error).message }) }
}

// --- files: an index of what may travel, and a pull of what is newer elsewhere --------------------------------------
type Root = { id: string; dir: string; walk: string[]; keep?: (rel: string) => boolean } // walk: the top-level files and folders that travel ('' : all); keep: which of what is under them
// the session folders of runs Concierge started: Claude names one after the run's working directory, every other character a dash
const SESSION_DIRS = [process.env.DECK_CODE || process.env.CODE_DIR, STATE_DIR].filter((x): x is string => !!x).map(sessionDir)
const CODE = process.env.DECK_CODE || process.env.CODE_DIR
const ROOTS: Root[] = [
  { id: 'state', dir: STATE_DIR, walk: ['logs', 'explain', 'domain', 'drafts', 'devlogs', 'atlas', 'crit', 'evals', 'review-records', 'review-pr-records', 'review-pr', 'revise', 'norms.json', 'events.jsonl'] },
  { id: 'config', dir: CONFIG_DIR, walk: [''] },
  // Claude files a session under its working directory with every other character a dash: Concierge's agents all work
  // under the clones folder, the same path on every machine. Your own sessions elsewhere stay where they are
  // Only those sessions travel, by the folder each run worked in: your clones (and their worktrees) and Concierge's own
  // worktrees in its state folder. Your Claude settings never do: they are yours, and each machine's own
  { id: 'claude', dir: CLAUDE_HOME, walk: ['projects'], keep: (rel: string) => { const d = rel.split('/')[1]; return !d || SESSION_DIRS.some((p) => d.startsWith(p)) } },
]
// never: checkouts and what they rebuild, scratch, conflict copies, and the sign-ins (each machine signs in itself)
const SKIP_DIR = new Set(['node_modules', '.venv', 'venv', '.pnpm-store', 'uv-cache', '__pycache__', '.git', '.nx', '.turbo', '.next', 'coverage', 'worktrees'])
// in an account's folder: what is a link on each machine (to your files and to this machine's plugins), never a copy from another
const LINKED = /^accounts\/[^/]+\/(claude|codex)\/(settings\.json|CLAUDE\.md|config\.toml|skills|commands|agents|plugins)(\/|$)/
const LOGINS = [/^accounts\/[^/]+\/claude\/\.credentials\.json$/, /^accounts\/[^/]+\/codex\/auth\.json$/]
// mcp.env: your values for the bank's connections, on this machine alone (localEnv.ts)
const skipFile = (root: string, rel: string) => (root === 'config' && rel === 'mcp.env') || /\.tmp$|\.sync-conflict-|\.bak-|(^|\/)\.st(folder|ignore|versions)/.test(rel) || (root === 'config' && (LOGINS.some((r) => r.test(rel)) || LINKED.test(rel)))
const MAX = 512 * 1024 * 1024 // a file bigger than this is someone's mistake, not state

type Entry = { size: number; mtimeMs: number; v: number }
const index = new Map<string, Entry>() // "<root>:<rel>"
const proc = randomUUID() // this index's identity: a pull with another one's numbers asks for all of it again
let ver = 0, scanned: Promise<void> | undefined, scanning = false

/** Whether `<root>:<rel>` is one that travels (the same rules as the scan: a request for anything else is refused). */
function travels(rootId: string, rel: string): Root | undefined {
  const root = ROOTS.find((r) => r.id === rootId)
  if (!root || !rel || rel.includes('\0') || rel.split('/').some((p) => p === '..' || p === '' || SKIP_DIR.has(p)) || skipFile(rootId, rel)) return undefined
  const top = root.walk.some((w) => w === '' || rel === w || rel.startsWith(w + '/') || (w === 'events.jsonl' && /^events(\.[\w-]+)?\.jsonl$/.test(rel)))
  return top && (!root.keep || root.keep(rel)) ? root : undefined
}

async function walk(root: Root, rel: string, depth = 0): Promise<void> {
  if (root.keep && rel && !root.keep(rel)) return
  const abs = join(root.dir, rel)
  const st = await lstat(abs).catch(() => undefined)
  if (!st || st.isSymbolicLink()) return // a link points somewhere of that machine's own (a skills folder, a cache): never followed
  if (st.isFile()) {
    if (st.size > MAX || skipFile(root.id, rel)) return
    const key = `${root.id}:${rel}`, was = index.get(key)
    if (!was || was.size !== st.size || was.mtimeMs !== Math.floor(st.mtimeMs)) index.set(key, { size: st.size, mtimeMs: Math.floor(st.mtimeMs), v: ++ver })
    return
  }
  if (!st.isDirectory() || depth > 8) return
  const kids = await readdir(abs, { withFileTypes: true }).catch(() => [])
  if (kids.some((k) => k.name === '.git')) return // a checkout (a skill's worktree): git rebuilds it from the branch
  for (const k of kids) if (!SKIP_DIR.has(k.name) && !(k.isDirectory() && /^wt/.test(k.name))) await walk(root, rel ? `${rel}/${k.name}` : k.name, depth + 1)
}
async function scan() {
  if (scanning) return
  scanning = true
  try {
    for (const root of ROOTS) for (const w of root.walk) {
      if (w === 'events.jsonl') { for (const f of await readdir(root.dir).catch(() => [] as string[])) if (/^events(\.[\w-]+)?\.jsonl$/.test(f)) await walk(root, f, 1) }
      else await walk(root, w, w ? 1 : 0)
    }
  } finally { scanning = false }
}

/** The index, or what changed in it after `since` (any machine's side). */
export async function filesSince(since: number, theirProc?: string) {
  await (scanned ??= scan())
  const all = !since || theirProc !== proc
  const entries = [...index].filter(([, e]) => all || e.v > since).map(([k, e]) => [k, e.size, e.mtimeMs] as const)
  return { proc, ver, entries }
}
/** A piece of a file that travels (8 MB at most), for another machine. */
export async function readPiece(key: string, from = 0, len = 8 * 1024 * 1024) {
  const i = key.indexOf(':'), rootId = key.slice(0, i), rel = key.slice(i + 1)
  const root = travels(rootId, rel)
  if (!root) throw new Error('not a file that travels')
  const fh = await open(join(root.dir, rel), 'r')
  try {
    const { size, mtimeMs } = await fh.stat()
    const n = Math.max(0, Math.min(len, size - from)), buf = Buffer.alloc(n)
    if (n) await fh.read(buf, 0, n, from)
    return { size, mtimeMs: Math.floor(mtimeMs), data: buf.toString('base64') }
  } finally { await fh.close() }
}

const pulled = new Map<string, { proc: string; ver: number; at: number; pending: number; skipped?: number; error?: string }>()
/** Whether a file there is newer than ours. */
export const newer = (there: { size: number; mtimeMs: number }, here?: { size: number; mtimeMs: number }) =>
  !here || (there.mtimeMs > here.mtimeMs && (there.size !== here.size || there.mtimeMs - here.mtimeMs > 1))

/** Whether to take that file from that machine. The settings come only from the machine running Concierge (the lease),
 *  as it has them: a machine that just joined has newer ones of its own (its onboarding), and newest-wins would hand
 *  those (no repositories) to every machine. Everything else: whichever copy is newer. */
export function takes(k: string, peer: { active?: boolean }, there: { size: number; mtimeMs: number }, here: { size: number; mtimeMs: number } | undefined, holder = fleet.mayWrite()) {
  if (!k.startsWith('config:')) return newer(there, here)
  return !holder && !!peer.active && (!here || here.size !== there.size || here.mtimeMs !== there.mtimeMs)
}

async function pullFiles() {
  await (scanned ??= scan())
  for (const peer of await peers()) {
    const was = pulled.get(peer.name)
    try {
      const r = await call<Awaited<ReturnType<typeof filesSince>>>(peer.base, token(), 'POST', '/x/replica-files', { since: was?.ver ?? 0, proc: was?.proc }, 60_000)
      const todo = r.entries.filter(([k, size, mtimeMs]) => travels(k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)) && takes(k, peer, { size, mtimeMs }, index.get(k)))
      let left = todo.length
      const failed: string[] = []
      for (const [k, size, mtimeMs] of todo) try {
        const i = k.indexOf(':'), root = travels(k.slice(0, i), k.slice(i + 1))!, abs = join(root.dir, k.slice(i + 1))
        const here = index.get(k)
        // a log that only grew: the new part; anything else: all of it
        let from = here && size > here.size && /\.(jsonl|log|md|txt)$/.test(k) ? here.size : 0
        const append = from > 0, tmp = `${abs}.${proc.slice(0, 8)}.tmp`
        await mkdir(dirname(abs), { recursive: true })
        if (!append) await writeFile(tmp, '') // a whole file lands under a temporary name, then takes its place
        while (from < size) {
          const p = await call<{ data: string }>(peer.base, token(), 'POST', '/x/replica-file', { key: k, from }, 120_000)
          const buf = Buffer.from(p.data, 'base64')
          if (!buf.length) break
          await appendFile(append ? abs : tmp, buf)
          from += buf.length
        }
        if (!append) await rename(tmp, abs)
        if (k === 'config:config.json') void reloadConfig() // the main server's settings apply at once, not at the next 5-minute check
        // their time on our copy: the other side then sees the same file, and never pulls it back
        await utimes(abs, new Date(), new Date(mtimeMs)).catch(() => {})
        const st = await stat(abs).catch(() => undefined)
        if (st) index.set(k, { size: st.size, mtimeMs: Math.floor(st.mtimeMs), v: ++ver })
        left--
      } catch (e) {
        // this one can't be written here (a folder that is a link on this machine, a path it can't have): skipped and
        // said, so the rest still come over and the machines still count as in step
        left--; failed.push(k)
        if (failed.length <= 3) console.warn(`replica: can't take ${k} from ${peer.name}: ${(e as Error).message}`)
      }
      pulled.set(peer.name, { proc: r.proc, ver: r.ver, at: Date.now(), pending: left, ...(failed.length && { skipped: failed.length }) })
      if (todo.length) console.log(`replica: ${todo.length} file${todo.length === 1 ? '' : 's'} from ${peer.name}`)
    } catch (e) { pulled.set(peer.name, { ...(was ?? { proc: '', ver: 0, at: 0, pending: 0 }), error: (e as Error).message }) }
  }
}

// --- where it stands (Settings → Machines, and bin/standby before a hand-over) ----------------------------------------
export function replicaStatus() {
  const now = Date.now()
  const files = Object.fromEntries([...pulled].map(([n, p]) => [n, { at: p.at, pending: p.pending, skipped: p.skipped, error: p.error }]))
  const stateOk = !follow.from || (!follow.error && now - follow.at < 15_000 && follow.applied >= follow.head)
  const filesOk = !follow.from || (!!pulled.get(follow.from) && now - pulled.get(follow.from)!.at < 90_000 && !pulled.get(follow.from)!.pending)
  return { me: fleet.machine, head: db.head(), following: follow.from, applied: follow.applied, sourceHead: follow.head, stateAt: follow.at, stateError: follow.error, files, caughtUp: stateOk && filesOk }
}

// --- what used to be files in the synced hosts folder: heartbeats, a restart asked, a new machine key -----------------
const NAME = /^[\w.-]{1,64}$/
async function writeAtomic(file: string, data: string, mode?: number) {
  await mkdir(dirname(file), { recursive: true })
  // a tmp of its own: two writes of one file at once (two beats) must not interleave into one broken file
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, data, mode ? { mode } : undefined); await rename(tmp, file)
}

/** The worker's named calls for the other machines: the change log, the file index, a file's piece, the status, and
 * the few things each machine's bin/standby and Settings → Machines send each other. */
export const replicaExtras = {
  // another machine's heartbeat (its bin/standby sends it every 10s): kept where this one's bin/standby reads it
  beat: async (b: { name?: string; beat?: Record<string, unknown> }) => {
    if (!b.name || !NAME.test(b.name) || b.name === fleet.machine || !b.beat || typeof b.beat !== 'object') throw new Error('bad beat')
    await writeAtomic(join(STATE_DIR, 'hosts', `${b.name}.json`), JSON.stringify(b.beat))
  },
  // Settings → Machines asked this machine to restart its Concierge: a note its bin/standby acts on (only that)
  'ask-restart': async (b: { by?: string }) => {
    await writeAtomic(join(STATE_DIR, 'hosts', `${fleet.machine}.ask`), JSON.stringify({ restart: Date.now(), by: typeof b.by === 'string' ? b.by.slice(0, 64) : undefined }))
  },
  // a new machine key, sent with the old one before it changes there (the old one still works 10 minutes)
  token: async (b: { token?: string }) => {
    if (!b.token || !/^[0-9a-f]{64}$/.test(b.token)) throw new Error('bad key')
    await writeAtomic(join(STATE_DIR, 'worker-token'), b.token + '\n', 0o600)
  },
  replica: async (b: { since?: number; epoch?: string }) => changesSince(Number(b.since) || 0, b.epoch),
  'replica-files': async (b: { since?: number; proc?: string }) => filesSince(Number(b.since) || 0, b.proc),
  'replica-file': async (b: { key: string; from?: number }) => readPiece(String(b.key), Number(b.from) || 0),
  'replica-status': async () => replicaStatus(),
}

if (fleet.machine) {
  let busy = false, filesBusy = false
  // how often: the state every 2s, files every 20s (a test sets them shorter)
  const every = Number(process.env.DECK_REPLICA_MS) || 2_000, filesEvery = Number(process.env.DECK_REPLICA_FILES_MS) || 20_000
  setInterval(() => { if (busy) return; busy = true; void pullState().finally(() => { busy = false }) }, every).unref()
  setInterval(() => { if (filesBusy) return; filesBusy = true; void scan().then(pullFiles).finally(() => { filesBusy = false }) }, filesEvery).unref()
  void (scanned ??= scan())
}
