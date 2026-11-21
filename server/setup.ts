// First-run onboarding: check the tools, find local checkouts, suggest repos, install the skills from the skill source.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { config, repoPath, WORK_DIR } from './config.ts'
import { STATE_DIR } from './paths.ts'
import { getMe, searchRepos } from './github.ts'

const run = promisify(execFile)
import { CLAUDE_HOME } from './agentHome.ts'
const SKILLS_DIR = join(homedir(), '.claude', 'skills')

export type Check = { ok: boolean; detail: string; fix?: string }

const version = (cmd: string, args = ['--version']) =>
  run(cmd, args, { timeout: 5000 }).then((r) => r.stdout.trim().split('\n')[0], () => undefined)

// each check starts a CLI (claude --version takes seconds, longer when the machine is busy): kept 10 minutes, so a
// page asking for the setup never waits on them twice
let checked: { at: number; out: Promise<Record<'github' | 'claude' | 'crit', Check>> } | undefined
export function checks(fresh = false): Promise<Record<'github' | 'claude' | 'crit', Check>> {
  if (!fresh && checked && Date.now() - checked.at < 10 * 60_000) return checked.out
  checked = { at: Date.now(), out: runChecks() }
  checked.out.catch(() => { checked = undefined })
  return checked.out
}
async function runChecks(): Promise<Record<'github' | 'claude' | 'crit', Check>> {
  const [me, claude, crit] = await Promise.all([
    getMe().catch(() => undefined), version('claude'), version('crit'),
  ])
  return {
    // no fix command: the page takes a token itself (in Docker there is no gh to sign in with)
    github: me ? { ok: true, detail: `Signed in as ${me.login}` } : { ok: false, detail: 'Not connected yet' },
    claude: claude ? { ok: true, detail: claude } : { ok: false, detail: 'Claude Code is not installed', fix: 'npm install -g @anthropic-ai/claude-code' },
    crit: crit ? { ok: true, detail: crit } : { ok: false, detail: 'crit is not installed', fix: 'brew install crit' },
  }
}

// --- local checkouts -----------------------------------------------------------------------

// the folder Docker mounts your clones at (CODE_DIR, or DECK_CODE inside) comes first: it may be anywhere
const ROOTS = [...new Set([process.env.DECK_CODE, process.env.CODE_DIR].filter((d): d is string => !!d)
  .concat(['code', 'src', 'dev', 'projects', 'Developer', 'work', 'workspace', 'repos', 'git', 'Sites', 'Documents/GitHub'].map((d) => join(homedir(), d))))]
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'Library', 'Applications', '.venv', 'venv'])
const GITHUB = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/

let scanned: { at: number; found: Promise<Map<string, string[]>> } | undefined

/** "owner/repo" → local checkouts, found by walking the usual code folders (cached for a minute). */
export function localCheckouts(): Promise<Map<string, string[]>> {
  if (scanned && Date.now() - scanned.at < 60_000) return scanned.found
  const found = (async () => {
    const dirs: string[] = []
    let budget = 25_000 // ponytail: bounded walk, 4 levels deep; add roots in ROOTS if a checkout lives elsewhere
    // async: thousands of folders over the Mac's file sharing would otherwise freeze the server while it walks
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4 || budget-- <= 0) return
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined)
      if (!entries) return
      // a real clone has a .git folder; worktrees have a .git file and are skipped
      if (entries.some((e) => e.name === '.git' && e.isDirectory())) { dirs.push(dir); return }
      await Promise.all(entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => walk(join(dir, e.name), depth + 1)))
    }
    await Promise.all(ROOTS.map((r) => walk(r, 0)))
    const map = new Map<string, string[]>()
    await Promise.all([...new Set(dirs)].map(async (d) => {
      const url = (await run('git', ['-C', d, 'remote', 'get-url', 'origin'], { timeout: 3000 }).catch(() => undefined))?.stdout.trim()
      const m = url?.match(GITHUB)
      if (!m) return
      const repo = `${m[1]}/${m[2]}`.toLowerCase()
      map.set(repo, [...(map.get(repo) ?? []), d])
    }))
    return map
  })()
  scanned = { at: Date.now(), found }
  return found
}

/** Repos worth watching: where you reviewed or wrote PRs lately, with any checkouts found on this machine. */
export async function suggestions() {
  const [active, local] = await Promise.all([searchRepos().catch(() => new Map<string, number>()), localCheckouts()])
  const repos = new Map<string, { repo: string; prs: number; paths: string[]; watched: boolean }>()
  const add = (repo: string, prs: number) => {
    const key = repo.toLowerCase()
    const cur = repos.get(key)
    repos.set(key, { repo: cur?.repo ?? repo, prs: (cur?.prs ?? 0) + prs, paths: local.get(key) ?? [], watched: Object.keys(config.repos).some((r) => r.toLowerCase() === key) })
  }
  for (const [repo, n] of active) add(repo, n)
  for (const r of Object.keys(config.repos)) add(r, 0)
  for (const r of local.keys()) if (!repos.has(r)) add(r, 0) // every clone on this machine, private ones too, after the active ones
  return [...repos.values()].sort((a, b) => Number(b.watched) - Number(a.watched) || Number(b.paths.length > 0) - Number(a.paths.length > 0) || b.prs - a.prs)
}

/** Is `path` a checkout of `repo`? */
export async function validate(repo: string, path: string): Promise<{ ok: boolean; error?: string; clone?: boolean }> {
  const p = repoPath(path)
  if (!(await stat(p).then((x) => x.isDirectory(), () => false))) {
    // a folder name in the working directory that isn't there yet: each machine clones it (ensureClones)
    return /^[\w.-]+$/.test(path) ? { ok: true, clone: true } : { ok: false, error: 'No such folder (give just a folder name to clone it into the working directory)' }
  }
  const url = (await run('git', ['-C', p, 'remote', 'get-url', 'origin'], { timeout: 3000 }).catch(() => undefined))?.stdout.trim()
  if (!url) return { ok: false, error: 'Not a git checkout with an origin remote' }
  const m = url.match(GITHUB)
  if (!m || `${m[1]}/${m[2]}`.toLowerCase() !== repo.toLowerCase()) return { ok: false, error: `This checkout's origin is ${m ? `${m[1]}/${m[2]}` : url}` }
  return { ok: true }
}

/** Clone `repo` into the code folder (CODE_DIR, or ~/code), for a suggestion with no checkout yet. An existing folder of
 *  that name is used if it is that repo's checkout. */
export async function cloneRepo(repo: string, at?: string): Promise<{ path: string }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Use the owner/repo form')
  const path = at ?? join(WORK_DIR, repo.split('/')[1])
  if (await stat(path).then(() => true, () => false)) {
    const v = await validate(repo, path)
    if (!v.ok) throw new Error(`${path} already exists: ${v.error}`)
  } else {
    await run('gh', ['repo', 'clone', repo, path], { timeout: 15 * 60_000 }).catch((e) => { throw new Error(`Could not clone ${repo}: ${String(e.stderr || e.message).trim().split('\n').pop()}`) })
  }
  scanned = undefined
  return { path }
}

// --- every watched repository on this machine -------------------------------------------
// config.json is shared, checkouts are not: a machine missing one clones it into its working directory. One at a time,
// in the background; what is cloning or failed shows on the repository's card.
const clones = new Map<string, string>() // repo → 'cloning', or why it failed
export const cloneState = () => Object.fromEntries(clones)
let cloningNow = false
export async function ensureClones() {
  // said at once, so the page that just saved it shows "cloning" rather than a git error from the missing folder
  for (const [repo, path] of Object.entries(config.repos)) if (!clones.has(repo) && !existsSync(path)) clones.set(repo, 'cloning')
  if (cloningNow) return
  cloningNow = true
  try {
    for (const [repo, path] of Object.entries(config.repos)) {
      if (await stat(path).then(() => true, () => false)) { clones.delete(repo); continue }
      clones.set(repo, 'cloning')
      console.log(`repos: cloning ${repo} into ${path}`)
      await cloneRepo(repo, path).then(() => { clones.delete(repo); console.log(`repos: cloned ${repo}`) }, (e: Error) => { clones.set(repo, e.message); console.error(`repos: ${e.message}`) })
    }
  } finally { cloningNow = false }
}

// --- skills --------------------------------------------------------------------------------

// the skill source: a git repo of skills (Settings → Skills; github.com/ylkhayat/skills unless you pick another). A new
// setup copies its skills into ~/.claude/skills; Concierge itself ships none.
export const DEFAULT_SOURCE = 'https://github.com/ylkhayat/skills'
const SOURCE_DIR = join(STATE_DIR, 'skill-source')
let fetched: { url: string; at: number } | undefined
/** The source's clone, fetched again when it is older than 10 minutes or the source changed. */
async function sourceClone() {
  const url = config.skillSource?.trim() || DEFAULT_SOURCE
  if (fetched?.url === url && Date.now() - fetched.at < 600_000) return SOURCE_DIR
  const had = (await run('git', ['-C', SOURCE_DIR, 'remote', 'get-url', 'origin'], { timeout: 5000 }).catch(() => ({ stdout: '' }))).stdout.trim()
  if (had === url) {
    // fetched and reset, not pulled: a source whose history was rewritten still updates
    await run('git', ['-C', SOURCE_DIR, 'fetch', '-q', '--depth', '1', 'origin', 'HEAD'], { timeout: 60_000 })
    await run('git', ['-C', SOURCE_DIR, 'reset', '-q', '--hard', 'FETCH_HEAD'], { timeout: 10_000 })
  } else {
    await rm(SOURCE_DIR, { recursive: true, force: true })
    await run('git', ['clone', '-q', '--depth', '1', url, SOURCE_DIR], { timeout: 120_000 })
  }
  fetched = { url, at: Date.now() }
  return SOURCE_DIR
}
/** The source's skills, and whether each is installed here. */
export async function sourceSkills() {
  const dir = join(await sourceClone(), 'skills')
  const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  return Promise.all(names.map(async (name) => ({ name, installed: !!(await stat(join(SKILLS_DIR, name, 'SKILL.md')).catch(() => undefined)) })))
}
/** Copy the source's skills into ~/.claude/skills. Never overwrites one that is already there. */
export async function installSourceSkills() {
  const dir = join(await sourceClone(), 'skills')
  return Promise.all((await sourceSkills()).map(async (s) => {
    if (!s.installed) await cp(join(dir, s.name), join(SKILLS_DIR, s.name), { recursive: true })
    return { ...s, installed: true }
  }))
}

/** The skills and commands already on this machine (~/.claude), to suggest instead of typing a name. */
export async function mySkills(): Promise<string[]> {
  const top = await readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => [])
  const skills = (await Promise.all(top.filter((e) => e.isDirectory() || e.isSymbolicLink()).map(async (e) => {
    if (await exists(join(SKILLS_DIR, e.name, 'SKILL.md'))) return [e.name]
    // a folder of skills (synced buckets): one level down
    const inner = await dirs(join(SKILLS_DIR, e.name))
    return (await Promise.all(inner.map(async (n) => (await exists(join(SKILLS_DIR, e.name, n, 'SKILL.md')) ? [n] : [])))).flat()
  }))).flat()
  const commands = (await dirs(join(homedir(), '.claude', 'commands'))).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  return [...new Set([...skills, ...commands])].sort()
}

/** Does a slash command resolve to a skill we can see? (Plugins and built-ins can't be checked; that's fine.) */
/** The SKILL.md (or command file) for `name`: ~/.claude/skills/<name>, one folder deeper (synced skills), or a command. */
// every lookup below goes through the async file API: ~/.claude sits on the Mac, behind slow file sharing, and a
// synchronous scan there froze the whole server (and the page) for seconds
const exists = (f: string) => access(f).then(() => true, () => false)
const dirs = (d: string) => readdir(d).catch(() => [] as string[])
const firstThat = async (files: string[]) => { for (const f of files) if (await exists(f)) return f; return undefined }

export async function skillFile(name: string): Promise<string | undefined> {
  const direct = [join(SKILLS_DIR, name, 'SKILL.md'), join(homedir(), '.claude', 'commands', `${basename(name)}.md`)]
  const nested = (await Promise.all((await dirs(SKILLS_DIR)).map(async (d) => ((await dirs(join(SKILLS_DIR, d))).includes(name) ? [join(SKILLS_DIR, d, name, 'SKILL.md')] : []))) ).flat()
  // ponytail: two levels covers ~/.claude/skills/synced/<bucket>/<name>
  const deeper = (await dirs(join(SKILLS_DIR, 'synced'))).map((b) => join(SKILLS_DIR, 'synced', b, name, 'SKILL.md'))
  return firstThat([...direct, ...nested, ...deeper])
}

export const skillExists = async (command: string) => {
  const name = command.trim().match(/^\/([\w:-]+)/)?.[1]
  return !!name && !!(await firstThat([join(SKILLS_DIR, name, 'SKILL.md'), join(homedir(), '.claude', 'commands', `${basename(name)}.md`)]))
}

/** A plugin skill (`plugin:name`): somewhere under ~/.claude/plugins as skills/<name>/SKILL.md or commands/<name>.md. */
export async function pluginSkill(name: string): Promise<string | undefined> {
  const root = join(CLAUDE_HOME, 'plugins')
  // ponytail: a bounded walk; plugins are a few hundred files at most
  const want = [join('skills', name, 'SKILL.md'), join('commands', `${name}.md`)]
  const walk = async (dir: string, depth: number): Promise<string | undefined> => {
    const hit = await firstThat(want.map((w) => join(dir, w)))
    if (hit || depth === 0) return hit
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && !e.name.startsWith('.')) { const f = await walk(join(dir, e.name), depth - 1); if (f) return f }
    return undefined
  }
  return walk(root, 5)
}
// ponytail: lookups cached 5 minutes; reading ~/.claude through a container's file sharing is slow (seconds per scan)
const found = new Map<string, { at: number; file?: string }>()
const findSkill = async (name: string) => {
  const hit = found.get(name)
  if (hit && Date.now() - hit.at < 300_000) return hit.file
  const file = name.includes(':') ? await pluginSkill(name.split(':').pop()!) : await skillFile(name)
  found.set(name, { at: Date.now(), file })
  return file
}

/** Skill names a prompt or skill file points at: `/name`, {skill:name}, Skill(name), and `name` named as a skill. */
export function skillRefs(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?:^|[\s`'"(])\/([a-z][\w-]*(?::[\w-]+)?)(?=[\s`'")]|$)/gm)) out.add(m[1])
  for (const m of text.matchAll(/\{skill:([\w-]+)\}|Skill\(([\w:-]+)\)|`([a-z][\w:-]+)`\s+skill\b/g)) out.add(m[1] ?? m[2] ?? m[3])
  return [...out]
}

/**
 * Every skill this setup runs, found or missing on this machine: the configured commands and actions, and the
 * skills those files mention by name (one level). A second machine with missing skills shows it here.
 */
export async function skillsNeeded(prompts: string[]) {
  const seen = new Map<string, { name: string; found: boolean; from: string }>()
  const add = async (name: string, from: string) => {
    if (seen.has(name) || /^(tmp|dev|usr|etc|bin|users|home|var|opt|api|exec|prs)$/i.test(name)) return
    seen.set(name, { name, found: false, from })
    const file = await findSkill(name)
    seen.set(name, { name, found: !!file, from })
    return file
  }
  for (const p of prompts) for (const n of skillRefs(p)) {
    const file = await add(n, 'settings')
    if (!file) continue
    const text = await readFile(file, 'utf8').catch(() => '')
    for (const m of skillRefs(text)) if (m !== n) await add(m, n)
    // and any `backticked` name that is a skill here (prose like `commit-with-stack` with no "skill" after it)
    for (const m of text.matchAll(/`([a-z][\w-]{2,})`/g)) if (m[1] !== n && !seen.has(m[1]) && await findSkill(m[1])) await add(m[1], n)
  }
  // a name mentioned in passing that exists nowhere is likely prose, not a skill; keep only misses named directly
  return [...seen.values()].filter((s) => s.found || s.from === 'settings')
}

const missCache = new Map<string, { at: number; names: string[]; checking?: boolean }>()
let onMissing: () => void = () => {}
/** Told when a background check changed what is missing (the server re-sends its views). */
export const whenMissingChanges = (f: () => void) => { onMissing = f }
/**
 * Skills this command or prompt needs that this machine lacks (its own, and the ones those name). Never waits: the
 * last answer comes back at once (nothing missing until the first check), and a check older than a minute is
 * redone in the background.
 */
export function missingFor(prompt: string | undefined): string[] {
  if (!prompt?.trim()) return []
  const hit = missCache.get(prompt)
  if (!hit || (Date.now() - hit.at > 60_000 && !hit.checking)) {
    missCache.set(prompt, { at: hit?.at ?? 0, names: hit?.names ?? [], checking: true })
    skillsNeeded([prompt]).then((s) => {
      const names = s.filter((x) => !x.found).map((x) => x.name)
      const changed = names.join() !== (hit?.names ?? []).join()
      missCache.set(prompt, { at: Date.now(), names })
      if (changed) onMissing()
    }, () => missCache.set(prompt, { at: Date.now(), names: hit?.names ?? [] }))
  }
  return hit?.names ?? []
}
/** The error a refused run returns: what is missing and how to get it. */
export const missingError = (names: string[]) =>
  `Missing on this machine: ${names.map((n) => `/${n}`).join(', ')}. Add ${names.length === 1 ? 'it' : 'them'} to ~/.claude/skills (or ~/.claude/commands), or sync your skills repo; Settings → Skills lists what this setup needs.`
