// Deterministic facts about a repo at a commit: tree, diff, import graph. No LLM here.
import { execFile } from 'node:child_process'
import { existsSync, rmSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
// never wait on a prompt, and never hang: a fetch of a branch deleted on merge once held a slot for an hour
const gitOnce = async (repo: string, args: string[]) =>
  (await run('git', ['-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024, timeout: 180_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout

/**
 * git in `repo`. A git killed midway (a restart, a timeout) leaves its `.lock` file behind and every later call fails
 * on it. A lock older than any git call can run (3 minutes, with room to spare) is such a leftover: it is removed and
 * the call retried once. A younger one may belong to a live git (yours, an editor's), so it is left alone.
 */
export const git = async (repo: string, ...args: string[]) => {
  try { return await gitOnce(repo, args) } catch (e) {
    const lock = String((e as Error).message).match(/Unable to create '([^']+\.lock)': File exists/)?.[1]
    if (!lock || !existsSync(lock) || Date.now() - statSync(lock).mtimeMs < STALE_LOCK) throw e
    console.warn(`git: removing a stale lock left by an interrupted git (${lock})`)
    rmSync(lock, { force: true })
    return gitOnce(repo, args)
  }
}
export const STALE_LOCK = 10 * 60_000

export type Entry = { type: 'tree' | 'blob'; sha: string }
export type Change = { path: string; status: 'added' | 'modified' | 'removed'; from?: string }

/** Every path at `rev` (dirs and files) → its git object. '' is the root. */
export async function listTree(repo: string, rev: string): Promise<Map<string, Entry>> {
  const out = await git(repo, 'ls-tree', '-r', '-t', '--full-tree', rev)
  const map = new Map<string, Entry>([['', { type: 'tree', sha: (await git(repo, 'rev-parse', `${rev}^{tree}`)).trim() }]])
  for (const line of out.split('\n')) {
    const m = line.match(/^\d+ (tree|blob|commit) ([0-9a-f]+)\t(.+)$/)
    if (m && m[1] !== 'commit') map.set(m[3], { type: m[1] as Entry['type'], sha: m[2] })
  }
  return map
}

export async function diff(repo: string, from: string, to: string): Promise<Change[]> {
  const out = await git(repo, 'diff', '--name-status', '-M', from, to)
  return out.split('\n').filter(Boolean).map((l) => {
    const [st, a, b] = l.split('\t')
    if (st.startsWith('R')) return { path: b, status: 'modified', from: a }
    return { path: a, status: st === 'A' ? 'added' : st === 'D' ? 'removed' : 'modified' }
  })
}

/** Make sure `sha` exists locally; GitHub serves every PR head at pull/N/head. */
export async function ensureCommit(repo: string, sha: string, prNumber: number) {
  try { await git(repo, 'cat-file', '-e', `${sha}^{commit}`) } catch { await git(repo, 'fetch', '--quiet', 'origin', `pull/${prNumber}/head`) }
}

export async function mergeBase(repo: string, baseRef: string, head: string) {
  await git(repo, 'fetch', '--quiet', 'origin', baseRef).catch(() => {})
  return (await git(repo, 'merge-base', `origin/${baseRef}`, head)).trim()
}

export const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const ancestors = (p: string) => { const out: string[] = []; for (let d = parentOf(p); ; d = parentOf(d)) { out.push(d); if (!d) return out } }

const CONTAINERS = new Set(['apps', 'packages', 'libs', 'services', 'src', 'modules'])
/** Where a "system" starts for a path: the longest known system path, else apps/x, src/x, or the top folder. */
export function systemRoot(path: string, known: string[] = []): string {
  const hit = known.filter((k) => path === k || path.startsWith(k + '/')).sort((a, b) => b.length - a.length)[0]
  if (hit) return hit
  const parts = path.split('/')
  if (parts.length > 2 && CONTAINERS.has(parts[0])) return parts.slice(0, 2).join('/')
  return parts.length > 1 ? parts[0] : ''
}

// --- imports -------------------------------------------------------------------------------
// ponytail: regex imports (TS/JS/Python), no tsconfig path aliases; add them if the graph looks thin

const TS_RE = /(?:^\s*(?:import|export)\b[^'"]*?from\s*|^\s*import\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/
const PY_RE = /^\s*(?:from\s+(\.*[\w.]*)\s+import\s+([\w*, ()]+)|import\s+([\w.]+))/
const TS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js']

/** The specifier one import line refers to, or undefined. */
export function parseImport(file: string, line: string): string | undefined {
  if (/\.(py)$/.test(file)) {
    const m = line.match(PY_RE)
    return m ? (m[1] ?? m[3]) : undefined
  }
  return line.match(TS_RE)?.[1]
}

export type Graph = { out: Map<string, Set<string>>; in: Map<string, Set<string>> }

/** File-level import graph for the whole repo at `rev`, from one `git grep`. */
export async function importGraph(repo: string, rev: string, files: Set<string>): Promise<Graph> {
  const out = await git(repo, 'grep', '-n', '-I', '-E',
    '-e', '^[[:space:]]*(import|export|from)[[:space:]]', '-e', 'require\\(', '-e', 'import\\(',
    rev, '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.py').catch(() => '')
  const pkgs = await packageNames(repo, rev)
  const g: Graph = { out: new Map(), in: new Map() }
  const add = (a: string, b: string) => {
    if (a === b) return
    if (!g.out.has(a)) g.out.set(a, new Set())
    if (!g.in.has(b)) g.in.set(b, new Set())
    g.out.get(a)!.add(b); g.in.get(b)!.add(a)
  }
  for (const line of out.split('\n')) {
    // <rev>:<path>:<line>:<text>
    const m = line.match(/^[^:]+:([^:]+):\d+:(.*)$/)
    if (!m) continue
    const spec = parseImport(m[1], m[2])
    const target = spec && resolve(m[1], spec, files, pkgs)
    if (target) add(m[1], target)
  }
  return g
}

/** Workspace package name → folder, from every package.json up to 3 levels deep. */
async function packageNames(repo: string, rev: string) {
  const out = await git(repo, 'grep', '-n', '-m1', '-E', '"name"[[:space:]]*:', rev, '--', 'package.json', '*/package.json', '*/*/package.json').catch(() => '')
  const map = new Map<string, string>()
  for (const line of out.split('\n')) {
    const m = line.match(/^[^:]+:([^:]*package\.json):\d+:.*"name"\s*:\s*"([^"]+)"/)
    if (m) map.set(m[2], dirname(m[1]) === '.' ? '' : dirname(m[1]))
  }
  return map
}

export function resolve(file: string, spec: string, files: Set<string>, pkgs: Map<string, string>): string | undefined {
  const tryAll = (base: string, exts: string[]) => exts.map((e) => base + e).find((c) => files.has(c))
  if (file.endsWith('.py')) {
    const dots = spec.match(/^\.*/)![0].length
    const mod = spec.slice(dots).replace(/\./g, '/')
    const roots = dots
      ? [ancestors(file)[dots - 1] ?? '']
      : ancestors(file) // absolute: try every enclosing folder as the package root
    for (const r of roots) {
      const base = r ? `${r}/${mod}` : mod
      const hit = mod ? tryAll(base, ['.py', '/__init__.py']) ?? tryAll(base.split('/').slice(0, -1).join('/'), ['.py']) : tryAll(r, ['/__init__.py'])
      if (hit) return hit
    }
    return undefined
  }
  if (spec.startsWith('.')) return tryAll(normalize(join(dirname(file), spec)), TS_EXT)
  // workspace package, possibly with a subpath: @scope/pkg/sub
  for (const [name, dir] of pkgs) {
    if (spec === name || spec.startsWith(name + '/')) {
      const sub = spec.slice(name.length).replace(/^\//, '')
      return tryAll(join(dir, sub || 'src/index'), TS_EXT) ?? tryAll(join(dir, sub || 'index'), TS_EXT) ?? tryAll(join(dir, 'package.json'), [''])
    }
  }
  return undefined
}

/** The direct child of `dir` that contains `path` (or undefined when it is outside). */
export function childOf(dir: string, path: string): string | undefined {
  if (dir && !path.startsWith(dir + '/')) return undefined
  const rest = dir ? path.slice(dir.length + 1) : path
  const head = rest.split('/')[0]
  return head ? (dir ? `${dir}/${head}` : head) : undefined
}
