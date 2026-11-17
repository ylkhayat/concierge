// Concierge's own folder for each agent tool it runs. Whichever tool does the work (Claude Code, Codex, Copilot), it
// used to run in your folder for that tool, mounted into the container: Claude Code rewrote your plugin records with
// the container's paths, the tools shared your sign-in files, and the machines copied your Claude settings over each
// other's. Now each tool has a folder of its own in Concierge's state, per machine (docker-compose.yml sets
// CLAUDE_CONFIG_DIR, CODEX_HOME and COPILOT_HOME to claude-home, codex-home and copilot-home there). The same rule for
// every tool: it adapts to your setup and never changes it.
//
//   read from yours   your skills, wherever you keep them (the first of ~/.claude/skills and ~/.codex/skills: every
//                     tool gets the same ones), and the tool's settings: Claude's settings.json without the hooks and
//                     the status line (programs of your machine, which a container doesn't have), commands, agents and
//                     CLAUDE.md; Codex's config.toml
//   its own           its sign-in, its connectors, its sessions, and for Claude the plugins you enabled (installed
//                     here, with this machine's paths). They survive a rebuild
//   first start only  your sign-in file and the agents' earlier sessions are copied over, so nothing has to be signed
//                     in or started again. Copies: yours stay where they are.
//
// A tool you don't use costs an empty folder. Without these variables (a native install, where Concierge runs your
// own tools as you do) nothing here does anything.
import { execFile } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
/** Your own folders: what you wrote lives here, and Concierge's skill pages manage your skills here. */
export const USER_CLAUDE = join(homedir(), '.claude'), USER_CODEX = join(homedir(), '.codex')
const own = (name: string, yours: string) => { const v = process.env[name]; return v && v !== yours ? v : undefined }
const OWN = own('CLAUDE_CONFIG_DIR', USER_CLAUDE), OWN_CODEX = own('CODEX_HOME', USER_CODEX)
/** Where each tool keeps its own files (sign-in, sessions, plugins): Concierge's folder for it, else yours. */
export const CLAUDE_HOME = OWN ?? USER_CLAUDE, CODEX_HOME = OWN_CODEX ?? USER_CODEX
const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false)
/** Your skills folder: every tool reads the same one, whichever tool you keep them for. */
export const userSkills = async (first: 'claude' | 'codex' = 'claude') => {
  const order = first === 'claude' ? [USER_CLAUDE, USER_CODEX] : [USER_CODEX, USER_CLAUDE]
  for (const d of order) if (await isDir(join(d, 'skills'))) return join(d, 'skills')
  return join(order[0], 'skills')
}
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
      .then(() => console.log(`agent home: installed your plugin ${id}`), (e: { stderr?: string; message: string }) => console.warn(`agent home: could not install ${id}: ${String(e.stderr || e.message).trim().split('\n')[0].slice(0, 160)}`))
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
  for (const d of dirs) await run('cp', ['-a', '-n', join(from, d), to], { timeout: 30 * 60_000 }).catch((e: Error) => console.warn(`agent home: sessions of ${d}: ${e.message.split('\n')[0]}`))
  await writeFile(mark, new Date().toISOString())
  if (dirs.length) console.log(`agent home: copied the agents' sessions (${dirs.length} folders, ${Math.round((Date.now() - t) / 1000)}s)`)
}

// --- one skills folder for the tools that aren't Claude Code. Claude Code finds your skills, your commands and its
// plugins' skills by itself; Codex and Copilot only know skill folders. So Concierge keeps a folder of links, rebuilt at
// start and every ten minutes: each of your skills, each of your commands as a skill of the same name (a command file is
// a skill's text without the folder), and each skill of the plugins you enabled. Nothing is copied or changed.
const base = OWN ?? OWN_CODEX ?? process.env.COPILOT_HOME
const SHARED = base ? join(dirname(base), 'agent-skills') : undefined
/** The skills folder Codex and Copilot read: Concierge's folder of links, or yours on a native install. */
export const agentSkills = async () => SHARED ?? userSkills()
/** What the folder should hold: name → the skill folder it links to, or the command file that is its SKILL.md. */
export async function wantedSkills(skills: string, commands: string, pluginDirs: string[]) {
  const want = new Map<string, { dir: string } | { file: string }>()
  const names = async (d: string) => (await readdir(d).catch(() => [] as string[])).filter((n) => !n.startsWith('.')).sort()
  for (const n of await names(skills)) if (await there(join(skills, n, 'SKILL.md'))) want.set(n, { dir: join(skills, n) })
  for (const f of await names(commands)) if (f.endsWith('.md') && !want.has(f.slice(0, -3))) want.set(f.slice(0, -3), { file: join(commands, f) })
  for (const d of pluginDirs) for (const n of await names(d)) if (!want.has(n) && await there(join(d, n, 'SKILL.md'))) want.set(n, { dir: join(d, n) })
  return want
}
async function shareSkills() {
  if (!SHARED) return
  const installed = await readFile(join(CLAUDE_HOME, 'plugins', 'installed_plugins.json'), 'utf8').then((t) => Object.values((JSON.parse(t) as { plugins?: Record<string, { installPath?: string }[]> }).plugins ?? {}).flatMap((v) => (v[0]?.installPath ? [join(v[0].installPath, 'skills')] : [])), () => [] as string[])
  const want = await wantedSkills(await userSkills(), join(USER_CLAUDE, 'commands'), installed)
  await mkdir(SHARED, { recursive: true })
  for (const n of await readdir(SHARED).catch(() => [] as string[])) if (!want.has(n)) await rm(join(SHARED, n), { recursive: true, force: true }) // a link, or a command's folder: never what they point to
  for (const [n, w] of want) {
    const here = join(SHARED, n), st = await lstat(here).catch(() => undefined)
    if ('dir' in w) { if (st?.isDirectory()) await rm(here, { recursive: true, force: true }); await link(w.dir, here) }
    else { if (st?.isSymbolicLink()) await unlink(here); await mkdir(here, { recursive: true }); await link(w.file, join(here, 'SKILL.md')) }
  }
}

/** Codex's folder: your config (when yours is newer), your skills, and once your sign-in and its sessions so far. */
async function codexHome() {
  if (!OWN_CODEX) return
  await mkdir(OWN_CODEX, { recursive: true })
  await link(await agentSkills(), join(OWN_CODEX, 'skills'))
  const yours = join(USER_CODEX, 'config.toml'), mine = join(OWN_CODEX, 'config.toml')
  const [a, b] = await Promise.all([stat(yours).catch(() => undefined), stat(mine).catch(() => undefined)])
  if (a && (!b || a.mtimeMs > b.mtimeMs)) await copyFile(yours, mine)
  const login = join(OWN_CODEX, 'auth.json')
  if (!(await there(login)) && await there(join(USER_CODEX, 'auth.json'))) { await copyFile(join(USER_CODEX, 'auth.json'), login); await chmod(login, 0o600) }
  if (!(await there(join(OWN_CODEX, 'sessions'))) && await there(join(USER_CODEX, 'sessions'))) await run('cp', ['-a', '-n', join(USER_CODEX, 'sessions'), OWN_CODEX], { timeout: 30 * 60_000 }).catch((e: Error) => console.warn(`agent home: codex sessions: ${e.message.split('\n')[0]}`))
}

let slow: Promise<unknown> = Promise.resolve()
/** Runs wait for this: the sessions they continue and the plugins they use are in place (or five minutes have passed). */
export const agentHomesReady = () => slow
/**
 * At start, before anything asks a tool who it is: each folder, its links, your settings and (the first time) your
 * sign-in. The sessions and Claude's plugins follow in the background; agent runs wait for them (agentHomesReady).
 */
export async function ensureAgentHomes() {
  await shareSkills().catch((e: Error) => console.warn('agent home: skills:', e.message))
  if (process.env.COPILOT_HOME) await mkdir(process.env.COPILOT_HOME, { recursive: true }).catch(() => {}) // its sessions, kept across rebuilds; it signs in with the GitHub token
  await codexHome().catch((e: Error) => console.warn('agent home: codex:', e.message))
  if (!OWN) return
  await mkdir(OWN, { recursive: true })
  await link(await userSkills('claude'), join(OWN, 'skills'))
  for (const name of ['commands', 'agents', 'CLAUDE.md']) await link(join(USER_CLAUDE, name), join(OWN, name))
  await settings().catch((e: Error) => console.warn('agent home: claude settings:', e.message))
  const login = join(OWN, '.credentials.json')
  if (!(await there(login)) && await there(join(USER_CLAUDE, '.credentials.json'))) { await copyFile(join(USER_CLAUDE, '.credentials.json'), login); await chmod(login, 0o600) }
  const work = Promise.all([sessions(), plugins().then(shareSkills)]).catch((e: Error) => console.warn('agent home:', e.message))
  slow = Promise.race([work, new Promise((r) => setTimeout(r, 5 * 60_000).unref())])
  // your settings may change while it runs (a plugin enabled, a permission): followed every ten minutes
  setInterval(() => void settings().then(plugins).then(shareSkills).catch(() => {}), 10 * 60_000).unref()
}
await ensureAgentHomes() // on import: every module that starts a tool imports this first, so its folder is there before it is asked anything
