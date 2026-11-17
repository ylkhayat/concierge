// Concierge's own Claude Code folder. Its agents' Claude Code used to run in your ~/.claude (mounted into the
// container): it rewrote your plugin records with the container's paths, shared your sign-in file, and the machines
// copied your settings.json over each other's. Now the container's Claude Code has a folder of its own
// (CLAUDE_CONFIG_DIR, set in docker-compose.yml), in Concierge's state and per machine. It adapts to your setup and
// never changes it:
//
//   read from yours   skills, commands, agents, CLAUDE.md (links), and settings.json (copied without the hooks and the
//                     status line: those are programs of your machine, which a container doesn't have)
//   its own           the plugins you enabled (installed here, with this machine's paths), its sign-in, its connectors
//                     (.claude.json, which now survives a rebuild), its sessions
//   first start only  your sign-in file and the agents' earlier sessions are copied over, so nothing has to be signed
//                     in or started again. Copies: yours stay where they are.
//
// Without CLAUDE_CONFIG_DIR (a native install, where Concierge runs your own Claude Code) nothing here does anything.
import { execFile } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, readdir, readFile, readlink, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
/** Your own Claude Code folder: your skills and commands live here, and Concierge's skill pages manage them here. */
export const USER_CLAUDE = join(homedir(), '.claude')
const OWN = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR !== USER_CLAUDE ? process.env.CLAUDE_CONFIG_DIR : undefined
/** Where the agents' Claude Code keeps its own files (plugins, sessions, sign-in): Concierge's folder, else yours. */
export const CLAUDE_HOME = OWN ?? USER_CLAUDE
/** Claude files a session under its working directory with every other character a dash. */
export const sessionDir = (cwd: string) => cwd.replace(/\/$/, '').replace(/[^A-Za-z0-9]/g, '-')

const there = (p: string) => lstat(p).then(() => true, () => false)
/** `here` links to `to` (when that exists). A link pointing elsewhere is redone; anything else there is left, unless `replace`. */
export async function link(to: string, here: string, replace = false) {
  const st = await lstat(here).catch(() => undefined)
  if (st?.isSymbolicLink()) { if (await readlink(here).catch(() => '') === to) return; await unlink(here) }
  else if (st?.isFile() && replace) await unlink(here)
  else if (st) return
  if (await there(to)) await symlink(to, here).catch(() => {})
}

type Settings = { hooks?: unknown; statusLine?: unknown; enabledPlugins?: Record<string, boolean>; extraKnownMarketplaces?: Record<string, { source?: { source?: string; repo?: string; url?: string; path?: string } }> }
const yours = (): Promise<Settings | undefined> => readFile(join(USER_CLAUDE, 'settings.json'), 'utf8').then((t) => JSON.parse(t) as Settings, () => undefined)
/** Your settings without what only runs on your machine: written here when they differ. */
export const adapted = (s: Settings) => { const { hooks: _h, statusLine: _s, ...rest } = s; return rest }
async function settings() {
  const s = await yours()
  if (!s) return
  const text = JSON.stringify(adapted(s), null, 2) + '\n', file = join(OWN!, 'settings.json')
  if (await readFile(file, 'utf8').catch(() => '') !== text) await writeFile(file, text)
}

/** What `claude plugin marketplace add` takes for a marketplace as your settings declare it. */
export const marketplaceSource = (m?: { source?: { source?: string; repo?: string; url?: string; path?: string } }) => m?.source?.repo ?? m?.source?.url ?? m?.source?.path
/** The plugins you enabled, installed in this folder (each once; a later start only installs what is new). */
async function plugins() {
  const s = await yours()
  const want = Object.entries(s?.enabledPlugins ?? {}).filter(([, on]) => on).map(([id]) => id)
  if (!want.length) return
  const have = await readFile(join(OWN!, 'plugins', 'installed_plugins.json'), 'utf8').then((t) => Object.keys((JSON.parse(t) as { plugins?: object }).plugins ?? {}), () => [] as string[])
  const added = new Set<string>()
  for (const id of want.filter((w) => !have.includes(w))) {
    const market = id.slice(id.lastIndexOf('@') + 1), src = marketplaceSource(s?.extraKnownMarketplaces?.[market])
    if (src && !added.has(market)) { added.add(market); await run('claude', ['plugin', 'marketplace', 'add', src], { timeout: 120_000, cwd: '/tmp' }).catch(() => {}) } // already known: fine
    await run('claude', ['plugin', 'install', id], { timeout: 180_000, cwd: '/tmp' })
      .then(() => console.log(`claude home: installed your plugin ${id}`), (e: { stderr?: string; message: string }) => console.warn(`claude home: could not install ${id}: ${String(e.stderr || e.message).trim().split('\n')[0].slice(0, 160)}`))
  }
}

/** Once: the agents' sessions so far (under the clones folder) come over, so a run or a reply continues its conversation. */
async function sessions() {
  const mark = join(OWN!, '.sessions-copied'), code = process.env.DECK_CODE || process.env.CODE_DIR
  if (!code || await there(mark)) return
  const from = join(USER_CLAUDE, 'projects'), to = join(OWN!, 'projects'), prefix = sessionDir(code)
  const dirs = (await readdir(from).catch(() => [] as string[])).filter((d) => d.startsWith(prefix))
  await mkdir(to, { recursive: true })
  const t = Date.now()
  // cp, not a loop of copyFile: gigabytes of small files, off the thread; -n never overwrites what a run already wrote here
  for (const d of dirs) await run('cp', ['-a', '-n', join(from, d), to], { timeout: 30 * 60_000 }).catch((e: Error) => console.warn(`claude home: sessions of ${d}: ${e.message.split('\n')[0]}`))
  await writeFile(mark, new Date().toISOString())
  if (dirs.length) console.log(`claude home: copied the agents' sessions (${dirs.length} folders, ${Math.round((Date.now() - t) / 1000)}s)`)
}

let slow: Promise<unknown> = Promise.resolve()
/** Runs wait for this: the sessions they continue and the plugins they use are in place (or five minutes have passed). */
export const claudeHomeReady = () => slow
/**
 * At start, before anything asks Claude Code who it is: the folder, its links, your settings and (the first time)
 * your sign-in. The sessions and the plugins follow in the background; agent runs wait for them (claudeHomeReady).
 */
export async function ensureClaudeHome() {
  if (!OWN) return
  await mkdir(OWN, { recursive: true })
  for (const name of ['skills', 'commands', 'agents', 'CLAUDE.md']) await link(join(USER_CLAUDE, name), join(OWN, name))
  await settings().catch((e: Error) => console.warn('claude home: settings:', e.message))
  const login = join(OWN, '.credentials.json')
  if (!(await there(login)) && await there(join(USER_CLAUDE, '.credentials.json'))) { await copyFile(join(USER_CLAUDE, '.credentials.json'), login); await chmod(login, 0o600) }
  const work = Promise.all([sessions(), plugins()]).catch((e: Error) => console.warn('claude home:', e.message))
  slow = Promise.race([work, new Promise((r) => setTimeout(r, 5 * 60_000).unref())])
  // your settings may change while it runs (a plugin enabled, a permission): followed every ten minutes
  setInterval(() => void settings().then(plugins).catch(() => {}), 10 * 60_000).unref()
}
await ensureClaudeHome() // on import: every module that starts Claude Code imports this first, so the folder is there before it is asked anything
