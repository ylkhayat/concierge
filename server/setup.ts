// First-run onboarding: check the tools, find local checkouts, suggest repos, install the skills from the skill source.
import { fleet } from './fleet.ts'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { config, configured, repoPath, WORK_DIR } from './config.ts'
import { STATE_DIR } from './paths.ts'
import { CONCIERGE_SKILLS, ownHomes, refreshSkills } from './agentHome.ts'
import { forgetSkillScan } from './skillScan.ts'
import { getMe, myRepos, repoByName, searchRepos, type RepoHit } from './github.ts'

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

/** owner/repo out of what was typed or pasted: a GitHub link (https, ssh, a PR or file inside it), or owner/repo itself. */
export function repoOf(text: string): string | undefined {
  const t = text.trim().replace(/\.git$/, '')
  const m = t.match(/github\.com[:/]([\w.-]+)\/([\w.-]+)/i) ?? t.match(/^([\w.-]+)\/([\w.-]+)\/?$/)
  return m ? `${m[1]}/${m[2].replace(/\.git$/, '')}` : undefined
}

export type RepoFound = RepoHit & { paths: string[]; watched: boolean }
/**
 * Repositories for the onboarding's search: yours whose name or description has every word typed, best first (the name
 * itself, one that starts with it, then one that has it); a link or owner/repo is looked up as it is, so one outside your account
 * works too. Each with its checkouts on this machine.
 */
export async function findRepos(q: string): Promise<RepoFound[]> {
  const [list, local] = await Promise.all([myRepos(), localCheckouts()])
  const exact = repoOf(q)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  let hits: RepoHit[]
  if (exact) {
    const known = list.find((r) => r.repo.toLowerCase() === exact.toLowerCase())
    const one = known ?? await repoByName(exact)
    hits = one ? [one] : []
  } else {
    const score = (r: RepoHit) => { const name = r.repo.toLowerCase().split('/')[1], w = words[0] ?? ''; return name === w ? 0 : name.startsWith(w) ? 1 : r.repo.toLowerCase().includes(w) ? 2 : 3 }
    hits = list.filter((r) => words.every((w) => `${r.repo} ${r.description ?? ''}`.toLowerCase().includes(w)))
      .map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.r)
  }
  return hits.slice(0, 20).map((r) => ({ ...r, paths: local.get(r.repo.toLowerCase()) ?? [], watched: Object.keys(config.repos).some((w) => w.toLowerCase() === r.repo.toLowerCase()) }))
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

/**
 * Take a checkout off this machine (it was unticked here), but only when nothing would be lost: no uncommitted
 * changes, no commits that aren't on the remote, and no worktree using it (an agent's run). Undefined when it went;
 * otherwise why it stays.
 */
export async function takeOff(path: string): Promise<string | undefined> {
  const git = (args: string[]) => run('git', ['-C', path, ...args], { timeout: 20_000 }).then((r) => r.stdout.trim())
  try {
    if (await git(['status', '--porcelain'])) return 'kept: it has uncommitted changes'
    if (await git(['log', '--branches', '--not', '--remotes', '--oneline', '-1'])) return 'kept: it has commits not pushed'
    if ((await git(['worktree', 'list', '--porcelain'])).split('\n').filter((l) => l.startsWith('worktree ')).length > 1) return 'kept: a worktree (an agent run) still uses it'
  } catch (e) { return `kept: ${(e as Error).message.split('\n')[0].slice(0, 120)}` }
  await rm(path, { recursive: true, force: true })
  scanned = undefined
  return undefined
}

// --- every watched repository on this machine -------------------------------------------
// config.json is shared, checkouts are not: a machine missing one clones it into its working directory. One at a time,
// in the background; what is cloning or failed shows on the repository's card.
const clones = new Map<string, string>() // repo → 'cloning', 'not-here' (not allowed on this machine), or why it failed
/** May this machine clone `repo`? With one machine always; with several, only where it is allowed (config.cloneOn). */
// a key is a repository, or a whole organization as "owner/*" (its repositories now and later)
/** Was it unticked on this machine? Then the checkout goes (see takeOff), and it isn't cloned again. */
export const unticked = (repo: string) => !!fleet.machine && !!config.removeFrom?.[repo]?.includes(fleet.machine)
export const mayClone = (repo: string) => !unticked(repo) && !fleet.machine || [repo, `${repo.split('/')[0]}/*`].some((k) => !!config.cloneOn?.[k]?.includes(fleet.machine!))
export const cloneState = () => Object.fromEntries(clones)
let cloningNow = false
export async function ensureClones() {
  // said at once, so the page that just saved it shows "cloning" rather than a git error from the missing folder
  for (const [repo, path] of Object.entries(config.repos)) if (!existsSync(path)) clones.set(repo, mayClone(repo) ? (clones.get(repo) === 'not-here' ? 'cloning' : clones.get(repo) ?? 'cloning') : 'not-here')
  if (cloningNow) return
  cloningNow = true
  try {
    for (const [repo, path] of Object.entries(config.repos)) {
      if (await stat(path).then(() => true, () => false)) {
        if (unticked(repo)) { const why = await takeOff(path); clones.set(repo, why ?? 'not-here'); if (!why) console.log(`repos: took ${repo} off this machine`) } else clones.delete(repo)
        continue
      }
      if (!mayClone(repo)) { clones.set(repo, 'not-here'); continue }
      clones.set(repo, 'cloning')
      console.log(`repos: cloning ${repo} into ${path}`)
      await cloneRepo(repo, path).then(() => { clones.delete(repo); console.log(`repos: cloned ${repo}`) }, (e: Error) => { clones.set(repo, e.message); console.error(`repos: ${e.message}`) })
    }
  } finally { cloningNow = false }
}

// --- skills --------------------------------------------------------------------------------

// skill sources: git repositories of skills you add (onboarding, Settings → Skills), as many as you like. Each is cloned
// into Concierge's state and kept current; their skills reach the agents through one folder of links
// (agentHome.ts CONCIERGE_SKILLS: the first source wins a name, and yours win over all of them). Nothing is ever written
// into your ~/.claude. A new setup has none: you add the ones you want.
export const DEFAULT_SOURCE = 'https://github.com/ylkhayat/skills' // what a setup from before the list used, unless it picked one
const SOURCES_DIR = join(STATE_DIR, 'skill-sources')
/** The sources this setup uses: its list; else the one source it picked before; else, set up before sources were
 *  chosen, the one it used then. A new setup: none. */
export const skillSources = (): string[] => config.skillSources ?? (config.skillSource?.trim() ? [config.skillSource.trim()] : configured() ? [DEFAULT_SOURCE] : [])
/** A source's folder: its owner and name, readable (github.com/acme/skills → acme-skills). */
export const sourceSlug = (url: string) => url.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).slice(-2).join('-').replace(/[^\w.-]/g, '_')
let fetched: { key: string; at: number } | undefined
/** Every source cloned and current (fetched again after 10 minutes, or when the list changed), and the agents' links redone. */
async function sourceClone() {
  const urls = skillSources(), key = urls.join(' ')
  if (fetched?.key === key && Date.now() - fetched.at < 600_000) return
  await mkdir(SOURCES_DIR, { recursive: true })
  for (const url of urls) {
    const dir = join(SOURCES_DIR, sourceSlug(url))
    const had = (await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 5000 }).catch(() => ({ stdout: '' }))).stdout.trim()
    try {
      if (had === url) {
        // fetched and reset, not pulled: a source whose history was rewritten still updates
        await run('git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', 'HEAD'], { timeout: 60_000 })
        await run('git', ['-C', dir, 'reset', '-q', '--hard', 'FETCH_HEAD'], { timeout: 10_000 })
      } else {
        await rm(dir, { recursive: true, force: true })
        await run('git', ['clone', '-q', '--depth', '1', url, dir], { timeout: 120_000 })
      }
    } catch (e) { console.warn(`skills: ${url}: ${String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').pop()}`) }
  }
  // a source taken off the list goes
  const kept = new Set(urls.map(sourceSlug))
  for (const d of await readdir(SOURCES_DIR).catch(() => [] as string[])) if (!kept.has(d)) await rm(join(SOURCES_DIR, d), { recursive: true, force: true })
  // one folder of links: each source's skills (its skills/ folder, else its top level), the first source's on a name
  await rm(CONCIERGE_SKILLS, { recursive: true, force: true })
  await mkdir(CONCIERGE_SKILLS, { recursive: true })
  for (const url of urls) {
    const root = join(SOURCES_DIR, sourceSlug(url)), dir = (await stat(join(root, 'skills')).then((x) => x.isDirectory(), () => false)) ? join(root, 'skills') : root
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('.') || !(await exists(join(dir, e.name, 'SKILL.md')))) continue
      await symlink(join(dir, e.name), join(CONCIERGE_SKILLS, e.name)).catch(() => {}) // taken already: an earlier source has it
    }
  }
  fetched = { key, at: Date.now() }
  forgetSkillScan()
  await refreshSkills().catch((e: Error) => console.warn('skills: relinking:', e.message)) // the agents see what was fetched
}
/** Every skill the sources give, with the source it comes from, and whether the agents have it (yours, or Concierge's). */
export async function sourceSkills() {
  await sourceClone()
  const names = await Promise.all((await readdir(CONCIERGE_SKILLS).catch(() => [] as string[])).filter((n) => !n.startsWith('.')).sort().map(async (name) => {
    const to = await readlink(join(CONCIERGE_SKILLS, name)).catch(() => '')
    return { name, source: to.slice(SOURCES_DIR.length + 1).split('/')[0] }
  }))
  return Promise.all(names.map(async ({ name, source }) => {
    const at = join(SKILLS_DIR, name)
    const entry = await lstat(at).catch(() => undefined)
    const follows = !!(await stat(join(at, 'SKILL.md')).catch(() => undefined))
    // yours: anything of that name in your skills (a folder, a link, even one this machine can't follow); the agents use
    // it. Not yours: the agents use the source's, through Concierge's own folder (agentHome.ts), when they run in its folders
    return { name, source, yours: !!entry, installed: !!entry || ownHomes, ...(entry?.isSymbolicLink() && !follows && { brokenLink: await readlink(at).catch(() => '?') }) }
  }))
}
/**
 * Make the source's skills the agents': fetch them into Concierge's own folder and relink the agents' skill folders.
 * Nothing is written into your ~/.claude. A native install runs your own Claude Code in your folder, so there is no
 * way to add them without touching yours: it says so instead.
 */
export async function installSourceSkills() {
  if (!ownHomes) throw new Error('This install runs your own Claude Code in your ~/.claude, and Concierge never writes there: point it at commands of your own, or run it in Docker (bin/up), where its skills sit in its own folder')
  fetched = undefined // fetched now, not from the last ten minutes
  return sourceSkills()
}

/** Your skills and commands that are links this machine can't follow (in Docker: their target isn't mounted). */
export async function brokenSkillLinks(): Promise<{ name: string; to: string }[]> {
  const out: { name: string; to: string }[] = []
  for (const d of [SKILLS_DIR, join(homedir(), '.claude', 'commands')]) {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (!e.isSymbolicLink()) continue
      const at = join(d, e.name)
      if (!(await stat(at).then(() => true, () => false))) out.push({ name: e.name.replace(/\.md$/, ''), to: await readlink(at).catch(() => '?') })
    }
  }
  return out
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
  return firstThat([...direct, ...nested, ...deeper, join(CONCIERGE_SKILLS, name, 'SKILL.md')]) // a skill source's, last: yours win
}

export const skillExists = async (command: string) => {
  const name = command.trim().match(/^\/([\w:-]+)/)?.[1]
  return !!name && !!(await firstThat([join(SKILLS_DIR, name, 'SKILL.md'), join(homedir(), '.claude', 'commands', `${basename(name)}.md`), join(CONCIERGE_SKILLS, name, 'SKILL.md')]))
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
