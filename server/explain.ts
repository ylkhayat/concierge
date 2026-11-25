// The Explain pipeline: deterministic facts (atlas.ts) + one lean structured `claude -p` call per iteration.
// Two caches keep work from being redone:
//   atlas/<repo>/nodes.json     what a folder is, keyed by path and the git tree sha it was written for
//   explain/<repo>-<n>/<head>   the PR overlay; a new push only re-explains files changed since the last head
import { tmpdir } from 'node:os'
import { LEVELS_SCHEMA, LEVELS_SYSTEM, levelsOf, levelsPrompt } from './levels.ts'
import { method } from './method.ts'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { mine, readMerged } from './perMachine.ts'
import { join } from 'node:path'
import {
  ancestors, childOf, diff, ensureCommit, git, importGraph, listTree, mergeBase, parentOf, systemRoot,
  type Change, type Entry,
} from './atlas.ts'
import { fill } from './config.ts'
import { ticketBrief } from './linear.ts'
import { config, STATE_DIR, type Pr } from './store.ts'
import { providerFor, spawnAgent, tokensOf, type ProviderId } from './providers.ts'

// --- shapes ----------------------------------------------------------------------------------

export type NodeSummary = { sha: string; children: string[]; summary: string; responsibilities: string[]; businessRole?: string; at: string }
export type System = { id: string; name: string; kind: string; paths: string[]; summary: string; businessRole?: string }
export type Skeleton = {
  signature: string
  actors: { id: string; name: string; description: string }[]
  systems: System[]
  edges: { from: string; to: string; kind: string; label: string }[]
}
export type Mark = 'added' | 'modified' | 'removed' | 'contains'
export type ViewChild = { path: string; name: string; type: 'dir' | 'file'; drill?: string; touched?: Mark; impacted?: boolean }
export type Facts = {
  changes: Change[]
  roots: string[] // system roots the PR touches
  views: Record<string, { children: ViewChild[]; more: number }>
  edges: Record<string, { from: string; to: string; count: number }[]>
  systemEdges: { from: string; to: string; count: number }[]
  dependents: { path: string; imports: string }[]
}
export type Touched = { path: string; change: 'added' | 'modified' | 'removed'; before?: string; after: string; why: string }
export type Overlay = {
  iteration: number
  headSha: string
  baseSha: string
  prevHeadSha?: string
  createdAt: string
  costUsd: number
  reused: number // touched entries carried over from the previous iteration
  asked: number // touched entries explained in this iteration
  nodesAsked: number
  nodesKnown?: number // folder summaries the prompt reused from the map
  business: { headline: string; what: string; why: string; who: string; risk: 'low' | 'medium' | 'high'; riskWhy: string }
  touched: Touched[]
  impact: { path: string; reason: string }[]
  flows: { title: string; scope: string; before?: string; after: string }[]
  tour?: Tour // absent on explanations made before the tour existed
  facts: Facts
  levels?: import('./levels.ts').Levels // the change at five depths, by dimension (the Understanding board's meter)
}
/** A guided reading of the PR: why it exists, then the change in the order that makes sense, then what does not belong. */
export type Shape = { label: string; tone: 'ok' | 'bad' | 'neutral' }
export type Tour = {
  // the opening story, understood in a minute: why the work exists, what was done, before and now, quick answers (older tours lack it)
  story?: {
    push: string; dimension: 'users' | 'business' | 'reliability' | 'security' | 'cost' | 'developers'; ticket?: string
    solution: string
    before: { shapes: Shape[]; caption: string }; after: { shapes: Shape[]; caption: string }
    questions: { q: string; a: string }[]
  }
  overview?: { what: string; why: string; who: string } // the start slide, a line each (older tours lack it)
  focus?: string // if the reviewer reads one thing: what, and why
  // every step answers the same three questions; narrative/lookFor are the pre-playbook shape, still shown
  steps: { title: string; kind: 'context' | 'core' | 'supporting' | 'tests' | 'cleanup'; what?: string; why?: string; check?: string[]; narrative?: string; lookFor?: string[]; paths: string[] }[]
  outOfScope: { path: string; reason: string }[]
}

const slug = (repo: string) => repo.replace('/', '-')
const ATLAS = (repo: string) => join(STATE_DIR, 'atlas', slug(repo))
const OVERLAYS = (pr: Pr) => join(STATE_DIR, 'explain', `${slug(pr.repo)}-${pr.number}`)

// maps and explanations are only written here, so they stay in memory once read: a page view never reads them
// from disk again, and writes go out off the thread (in order, per file) while readers already see the new data
const cache = new Map<string, unknown>()
const readJson = <T>(p: string): T | undefined => {
  if (cache.has(p)) return cache.get(p) as T | undefined
  // every machine's copy (perMachine.ts): a folder map merged entry by entry, anything else the newest copy
  const v = readMerged<T>(p, basename(p) === 'nodes.json' ? 'entries' : 'newest')
  cache.set(p, v)
  return v
}
const writes = new Map<string, Promise<void>>()
let written = 0 // bumped by every map or explanation write: what the codebase view's cache keys on
function writeJson(logical: string, data: unknown) {
  cache.set(logical, data); written++
  const p = mine(logical) // this machine's copy, never one another machine writes
  const text = JSON.stringify(data)
  const next = (writes.get(p) ?? Promise.resolve())
    .then(async () => { await mkdir(join(p, '..'), { recursive: true }); await writeFile(p + '.tmp', text); await rename(p + '.tmp', p) })
    .catch((e) => console.error(`write ${p}:`, (e as Error).message))
  writes.set(p, next)
}

export const loadNodes = (repo: string) => readJson<Record<string, NodeSummary>>(join(ATLAS(repo), 'nodes.json')) ?? {}
export const loadSkeleton = (repo: string) => readJson<Skeleton>(join(ATLAS(repo), 'skeleton.json'))
// a skeleton with no systems draws an empty business map: never kept, and one on disk counts as missing
const usable = (s?: { systems?: unknown[] }) => !!s?.systems?.length

/** The folders a system map has to account for: each app, service, package or lib (an -e2e folder goes with its app). */
export const unitsOf = (sig: string) => sig.split(',').filter((p) => p.split('/').length === 2 && !/-e2e$/.test(p))
/**
 * A system map worth drawing: in a repo of several units, at least 3 systems, and together they own at least 80% of
 * the units (a system owning "apps" owns every app, which is how a lazy map hides a monorepo's domains: it fails here).
 */
export function goodSkeleton(sk: { systems?: { paths: string[] }[] } | undefined, sig: string): boolean {
  if (!usable(sk)) return false
  const units = unitsOf(sig)
  if (units.length < 4) return true
  const owned = sk!.systems!.flatMap((x) => x.paths.map((p) => p.replace(/^\/|\/$/g, '')))
  const covered = units.filter((u) => owned.some((p) => p === u || u.startsWith(`${p}-`) || (p.includes('/') && u.startsWith(`${p}/`)))).length
  return sk!.systems!.length >= 3 && covered / units.length >= 0.8
}
export function loadOverlay(pr: Pr): Overlay | undefined {
  const latest = readJson<{ head: string }>(join(OVERLAYS(pr), 'latest.json'))
  return latest && readJson<Overlay>(join(OVERLAYS(pr), `${latest.head}.json`))
}

// --- facts -----------------------------------------------------------------------------------

const MAX_CHILDREN = 30
const MAX_NODES = 40 // folder summaries asked per run; the rest fill in on later PRs
const DRIFT = 8 // a folder summary survives this many changed files below it, if its children are the same

function childIndex(tree: Map<string, Entry>) {
  const idx = new Map<string, string[]>()
  for (const p of tree.keys()) if (p) { const d = parentOf(p); if (!idx.has(d)) idx.set(d, []); idx.get(d)!.push(p) }
  return idx
}

export async function buildFacts(repo: string, base: string, head: string, known: string[]): Promise<{ facts: Facts; tree: Map<string, Entry>; idx: Map<string, string[]> }> {
  const [changes, tree] = await Promise.all([diff(repo, base, head), listTree(repo, head)])
  const files = new Set([...tree].filter(([, e]) => e.type === 'blob').map(([p]) => p))
  const g = await importGraph(repo, head, files)
  const idx = childIndex(tree)
  const status = new Map(changes.map((c) => [c.path, c.status]))
  const touchedPaths = changes.map((c) => c.path)

  const roots = [...new Set(touchedPaths.map((p) => systemRoot(p, known)))]
  const viewDirs = new Set<string>()
  for (const p of touchedPaths) {
    const root = systemRoot(p, known)
    for (const a of ancestors(p)) if ((a === root || a.startsWith(root + '/')) && (tree.has(a) || a === '')) viewDirs.add(a)
  }

  const dependents: Facts['dependents'] = []
  for (const p of touchedPaths) for (const d of g.in.get(p) ?? []) if (!status.has(d)) dependents.push({ path: d, imports: p })
  const impacted = new Set(dependents.map((d) => d.path))
  const hasInside = (dir: string, set: Iterable<string>) => { for (const p of set) if (p.startsWith(dir + '/')) return true; return false }

  const views: Facts['views'] = {}
  for (const dir of viewDirs) {
    const kids = [...(idx.get(dir) ?? [])]
    for (const p of touchedPaths) if (status.get(p) === 'removed' && parentOf(p) === dir && !kids.includes(p)) kids.push(p)
    const children: ViewChild[] = kids.map((path) => {
      const type = tree.get(path)?.type === 'tree' ? 'dir' : 'file'
      let drill: string | undefined
      if (type === 'dir') for (let d = path; ;) { const k = idx.get(d) ?? []; if (k.length === 1 && tree.get(k[0])?.type === 'tree') { d = k[0]; drill = d } else break }
      return {
        path, name: path.slice(dir ? dir.length + 1 : 0), type,
        ...(drill && { drill }),
        touched: status.get(path) ?? (type === 'dir' && hasInside(path, touchedPaths) ? 'contains' : undefined),
        impacted: impacted.has(path) || (type === 'dir' && hasInside(path, impacted)) || undefined,
      }
    })
    const rank = (c: ViewChild) => (c.touched ? 0 : c.impacted ? 1 : c.type === 'dir' ? 2 : 3)
    children.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    views[dir] = { children: children.slice(0, MAX_CHILDREN), more: Math.max(0, children.length - MAX_CHILDREN) }
  }

  // import edges between the children of each view, and between systems
  const viewEdges = new Map<string, Map<string, { from: string; to: string; count: number }>>()
  const sys = new Map<string, number>()
  for (const [a, targets] of g.out) for (const b of targets) {
    for (const dir of viewDirs) {
      const ca = childOf(dir, a), cb = childOf(dir, b)
      if (!ca || !cb || ca === cb) continue
      if (!viewEdges.has(dir)) viewEdges.set(dir, new Map())
      const m = viewEdges.get(dir)!, k = `${ca}\0${cb}`
      if (!m.has(k)) m.set(k, { from: ca, to: cb, count: 0 })
      m.get(k)!.count++
    }
    const ra = systemRoot(a, known), rb = systemRoot(b, known)
    if (ra && rb && ra !== rb) sys.set(`${ra}\0${rb}`, (sys.get(`${ra}\0${rb}`) ?? 0) + 1)
  }
  const edges: Facts['edges'] = Object.fromEntries([...viewEdges].map(([d, m]) => [d, [...m.values()]]))
  const systemEdges = [...sys].map(([k, count]) => { const [from, to] = k.split('\0'); return { from, to, count } })

  return { facts: { changes, roots, views, edges, systemEdges, dependents: dependents.slice(0, 60) }, tree, idx }
}

/** Repo shape that, when it changes, means the system skeleton is out of date. */
export function signature(tree: Map<string, Entry>) {
  return [...tree].filter(([p, e]) => e.type === 'tree' && (!p.includes('/') || (p.split('/').length === 2 && /^(apps|packages|libs|services|src|modules)\//.test(p))))
    .map(([p]) => p).filter((p) => !p.startsWith('.')).sort().join(',')
}

type Ask = { path: string; mode: 'new' | 'update'; previous?: string; changed?: string[] }

/** Which folder summaries are missing or have drifted too far, nearest to the change first. */
export async function staleNodes(repo: string, facts: Facts, tree: Map<string, Entry>, idx: Map<string, string[]>, nodes: Record<string, NodeSummary>): Promise<Ask[]> {
  const order: string[] = []
  const views = Object.keys(facts.views).sort((a, b) => a.split('/').length - b.split('/').length)
  for (const v of views) if (v) order.push(v)
  for (const v of views) for (const c of facts.views[v].children) if (c.type === 'dir' && !order.includes(c.path)) order.push(c.drill ?? c.path)
  return driftAsks(repo, order, tree, idx, nodes, MAX_NODES)
}

/** Of `paths` (in priority order), the folders with no summary yet or whose contents drifted past DRIFT. */
export async function driftAsks(repo: string, paths: string[], tree: Map<string, Entry>, idx: Map<string, string[]>, nodes: Record<string, NodeSummary>, limit = Infinity): Promise<Ask[]> {
  const asks: Ask[] = []
  for (const path of paths) {
    const sha = tree.get(path)?.sha
    if (!sha) continue
    const cached = nodes[path]
    const children = (idx.get(path) ?? []).map((p) => p.split('/').pop()!)
    if (cached?.sha === sha) continue
    if (cached) {
      const sameKids = cached.children.join() === children.join()
      const changed = (await git(repo, 'diff', '--name-only', cached.sha, sha).catch(() => '')).split('\n').filter(Boolean)
      if (sameKids && changed.length <= DRIFT) continue
      asks.push({ path, mode: 'update', previous: cached.summary, changed: changed.slice(0, 20) })
    } else asks.push({ path, mode: 'new' })
    if (asks.length >= limit) break
  }
  return asks
}

const knownCount = (facts: Facts, nodes: Record<string, NodeSummary>, asks: Ask[]) => {
  const asked = new Set(asks.map((a) => a.path))
  const paths = new Set(Object.keys(facts.views).flatMap((v) => [v, ...facts.views[v].children.map((c) => c.drill ?? c.path)]))
  return [...paths].filter((p) => nodes[p] && !asked.has(p)).length
}

// --- the LLM call ----------------------------------------------------------------------------

const str = { type: 'string' }
const LANE = { type: 'object', additionalProperties: false, required: ['shapes', 'caption'], properties: {
  shapes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'tone'], properties: { label: str, tone: { enum: ['ok', 'bad', 'neutral'] } } } }, caption: str,
} }
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['nodes', 'overlay'],
  properties: {
    skeleton: {
      type: 'object', additionalProperties: false, required: ['actors', 'systems', 'edges'],
      properties: {
        actors: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'description'], properties: { id: str, name: str, description: str } } },
        systems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'kind', 'paths', 'summary'], properties: { id: str, name: str, kind: { enum: ['app', 'service', 'library', 'infra', 'external'] }, paths: { type: 'array', items: str }, summary: str, businessRole: str } } },
        edges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'kind', 'label'], properties: { from: str, to: str, kind: str, label: str } } },
      },
    },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'summary', 'responsibilities'], properties: { path: str, summary: str, responsibilities: { type: 'array', items: str }, businessRole: str } } },
    overlay: {
      type: 'object', additionalProperties: false, required: ['business', 'touched', 'impact', 'flows', 'tour', 'levels'],
      properties: {
        levels: LEVELS_SCHEMA, // the Understanding board's five levels, written in the same pass as the tour (Intent)
        business: { type: 'object', additionalProperties: false, required: ['headline', 'what', 'why', 'who', 'risk', 'riskWhy'], properties: { headline: str, what: str, why: str, who: str, risk: { enum: ['low', 'medium', 'high'] }, riskWhy: str } },
        touched: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'change', 'after', 'why'], properties: { path: str, change: { enum: ['added', 'modified', 'removed'] }, before: str, after: str, why: str } } },
        impact: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'reason'], properties: { path: str, reason: str } } },
        flows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'scope', 'after'], properties: { title: str, scope: str, before: str, after: str } } },
        tour: {
          type: 'object', additionalProperties: false, required: ['story', 'overview', 'focus', 'steps', 'outOfScope'],
          properties: {
            story: { type: 'object', additionalProperties: false, required: ['push', 'dimension', 'solution', 'before', 'after', 'questions'], properties: {
              push: str, dimension: { enum: ['users', 'business', 'reliability', 'security', 'cost', 'developers'] }, ticket: str, solution: str,
              before: LANE, after: LANE,
              questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a'], properties: { q: str, a: str } } },
            } },
            overview: { type: 'object', additionalProperties: false, required: ['what', 'why', 'who'], properties: { what: str, why: str, who: str } },
            focus: str,
            steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'kind', 'what', 'why', 'check', 'paths'], properties: {
              title: str, kind: { enum: ['context', 'core', 'supporting', 'tests', 'cleanup'] }, what: str, why: str, check: { type: 'array', items: str }, paths: { type: 'array', items: str },
            } } },
            outOfScope: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'reason'], properties: { path: str, reason: str } } },
          },
        },
      },
    },
  },
}
type Result = { skeleton?: Omit<Skeleton, 'signature'>; nodes: (Omit<NodeSummary, 'sha' | 'children' | 'at'> & { path: string })[]; overlay: Pick<Overlay, 'business' | 'touched' | 'impact' | 'flows'> & { tour: Tour } }

// how to explain is the user's skill (method.ts); the format below is what this view reads back
const FORMAT = 'Return only the structured output.'

export function buildPrompt(o: {
  pr: Pr; base: string; head: string; facts: Facts; skeleton?: Skeleton; needSkeleton: boolean; sig: string
  nodes: Record<string, NodeSummary>; asks: Ask[]; askTouched: string[]; prev?: Overlay; interdiff?: string[]; tickets?: string[]; builds?: string[]
}) {
  const { pr, base, head, facts } = o
  const known = Object.keys(facts.views).flatMap((v) => [v, ...facts.views[v].children.map((c) => c.drill ?? c.path)])
    .filter((p, i, a) => a.indexOf(p) === i && o.nodes[p] && !o.asks.some((a) => a.path === p))
    .map((p) => `- ${p}: ${o.nodes[p].summary}`)
  const lines = [
    `Repository ${pr.repo}, pull request #${pr.number} "${pr.title}" by ${pr.author.login}, into ${pr.base}.`,
    `The working directory is checked out at the PR head ${head}. The merge base is ${base}.`,
    `See a change with \`git diff ${base} ${head} -- <path>\`; the old version with \`git show ${base}:<path>\`.`,
    '', '## PR description', (pr.body || '(none)').slice(0, 3000),
  ]
  if (o.tickets?.length) lines.push('', '## The Linear ticket behind it (with its discussion: the analysis that led here)', ...o.tickets)
  if (o.builds?.length) lines.push('', '## The PRs below this one in its stack (it builds on them; their changes are not part of this diff)', ...o.builds,
    'Explain only what this PR adds on top of them, and in the story say plainly what it relies on from below.')
  if (o.skeleton && !o.needSkeleton) lines.push('', '## Known system map (reuse, do not re-derive)', JSON.stringify({ actors: o.skeleton.actors, systems: o.skeleton.systems.map(({ id, name, paths, summary }) => ({ id, name, paths, summary })) }))
  if (known.length) lines.push('', '## Known folder summaries (reuse, do not re-derive)', ...known.slice(0, 80))
  lines.push('', `## Changed files (${facts.changes.length})`, ...facts.changes.slice(0, 150).map((c) => `${c.status} ${c.path}${c.from ? ` (from ${c.from})` : ''}`))
  if (facts.dependents.length) lines.push('', '## Code that imports the changed files (blast radius, from the import graph)', ...facts.dependents.slice(0, 40).map((d) => `- ${d.path} imports ${d.imports}`))
  if (o.prev) lines.push('',
    `## Previous explanation (iteration ${o.prev.iteration}, at ${o.prev.headSha.slice(0, 9)})`,
    JSON.stringify({ business: o.prev.business, flows: o.prev.flows.map((f) => f.title), impact: o.prev.impact }),
    `Files changed since then: ${o.interdiff?.length ? o.interdiff.join(', ') : 'unknown (history was rewritten), treat all as changed'}.`,
    'Update the business section and the flows to reflect those changes; keep wording that is still true, do not rewrite from scratch.')

  lines.push('', '## Tasks')
  let n = 1
  if (o.needSkeleton) lines.push(`${n++}. \`skeleton\`: the business actors (people, customers, external systems) and the systems of this repo. Every system lists the folder paths it owns; cover these top-level folders where they are real systems: ${o.sig}. Edges are runtime relationships between systems (http, websocket, queue, db, sdk, import) with a short label. Use system ids that are short kebab-case.`)
  lines.push(`${n++}. \`nodes\`: one entry per path below. A one-sentence summary of what the folder does, 2 to 4 responsibilities, and a businessRole when the folder maps to something a user or the business would recognise. Glance at file names and entry points; do not read everything.`)
  for (const a of o.asks) lines.push(a.mode === 'new' ? `   - ${a.path}` : `   - ${a.path} (update; it was: "${a.previous}"; since then these changed: ${a.changed?.join(', ')})`)
  if (!o.asks.length) lines.push('   (none: return an empty array)')
  lines.push(`${n++}. \`overlay.touched\`: one entry for each of these paths, and only these: ${o.askTouched.length ? o.askTouched.join(', ') : '(none: return an empty array)'}. \`before\` (omit for added files) and \`after\` describe behaviour in one or two plain sentences; \`why\` is the reason for the change.`)
  lines.push(`${n++}. \`overlay.business\`: headline (12 words max), what, why, who is affected, risk (low, medium, high) and riskWhy (one sentence, at most 20 words: it shares a slide with the quick answers).`)
  lines.push(`${n++}. \`overlay.impact\`: up to 12 of the most significant dependents above (or other affected code you find), each with a concrete reason.`)
  lines.push(`${n++}. \`overlay.flows\`: 1 to 3 logic flows this PR changes, as Mermaid code (\`flowchart TD\` or \`sequenceDiagram\`), \`before\` (omit if the flow is new) and \`after\`, \`scope\` is the folder or file the flow lives in. At most 12 nodes, short labels, and no parentheses, quotes or semicolons inside labels.`)
  lines.push(`${n++}. \`overlay.tour\`: the guided tour, written as your instructions say: \`story\` (\`push\`, \`ticket\` when there is one, \`dimension\`, \`solution\`, \`before\` and \`after\` as shapes with \`label\` and \`tone\`, \`caption\`, \`questions\`), \`overview\` (\`what\`, \`why\`, \`who\`), \`focus\`, \`steps\` (each with \`title\`, \`what\`, \`why\`, \`check\`, \`paths\` from the changed files above, \`kind\`: context, core, supporting, tests or cleanup; every in-scope changed file in exactly one step) and \`outOfScope\` (an empty array when everything belongs).`)
  return lines.join('\n')
}

/**
 * Check out `sha` in worktree `wt`. A git killed mid-command (a restart, an update) leaves its index.lock behind, and
 * every later checkout there fails on it; a lock older than a minute has no git behind it, so it is removed once.
 */
export async function checkoutAt(wt: string, sha: string) {
  try { await git(wt, 'checkout', '--quiet', '--detach', '--force', sha) } catch (e) {
    const lock = String((e as Error).message).match(/Unable to create '([^']+\.lock)': File exists/)?.[1]
    if (!lock || Date.now() - (await stat(lock).then((x) => x.mtimeMs, () => Date.now())) < 60_000) throw e
    await unlink(lock).catch(() => {})
    await git(wt, 'checkout', '--quiet', '--detach', '--force', sha)
  }
}

/**
 * Our own read-only worktree `wt` of `repo`, at `sha`. One whose repository forgot it (its record pruned, the repo
 * re-cloned or moved: "not a git repository") is made again: it is ours, at a fixed commit, so nothing in it is lost.
 */
export async function worktreeAt(repo: string, wt: string, sha: string) {
  if (existsSync(wt) && !(await git(wt, 'rev-parse', '--git-dir').then(() => true, () => false))) {
    await rm(wt, { recursive: true, force: true })
    await git(repo, 'worktree', 'prune').catch(() => {})
  }
  if (existsSync(wt)) return checkoutAt(wt, sha)
  mkdirSync(join(wt, '..'), { recursive: true })
  await git(repo, 'worktree', 'add', '--quiet', '--detach', wt, sha)
}

/** Worktree at the PR head for the agent to read: your review skill's (config.agent.worktree) if it sits on the head, else ours. */
async function worktree(pr: Pr, repo: string, head: string) {
  const at = async (wt: string) => existsSync(wt) && (await git(wt, 'rev-parse', 'HEAD').catch(() => '')).trim() === head
  const review = config.agent.worktree && fill(config.agent.worktree, { repoPath: repo, number: pr.number, repo: pr.repo })
  if (review && await at(review)) return review
  const own = join(STATE_DIR, 'worktrees', `${slug(pr.repo)}-${pr.number}`)
  await worktreeAt(repo, own, head)
  return own
}

/**
 * Iteration reuse: a file's explanation carries over when the file is still in the PR and did not change
 * since the previous head. Without an interdiff (history rewritten) nothing carries over.
 */
export function carryOver(prev: Touched[] | undefined, current: string[], interdiff: string[] | undefined) {
  const changed = new Set(interdiff)
  const kept = prev && interdiff ? prev.filter((t) => current.includes(t.path) && !changed.has(t.path)) : []
  const keptPaths = new Set(kept.map((k) => k.path))
  return { kept, ask: current.filter((p) => !keptPaths.has(p)) }
}

export type Progress = (step: string) => void

/** One explain iteration. Returns the overlay, or the previous one when nothing changed. */
export async function explain(pr: Pr, opts: { fresh?: boolean; signal?: AbortSignal; progress: Progress; below?: Pr[] }): Promise<Overlay> {
  const repo = config.repos[pr.repo]
  if (!repo) throw new Error(`no local checkout for ${pr.repo}`)
  const { progress } = opts
  progress('Fetching the PR head')
  await ensureCommit(repo, pr.headSha, pr.number)
  const base = await mergeBase(repo, pr.base, pr.headSha)
  const prev = opts.fresh ? undefined : loadOverlay(pr)
  // nothing changed: keep it, unless its tour is missing or predates the story slides; then files carry over and the tour is written
  if (prev && prev.headSha === pr.headSha && prev.baseSha === base && prev.tour?.story) {
    if (prev.levels) return prev
    // explained before the levels existed: only they are written, from the explanation it has
    const o = await withLevels(prev, pr, opts.signal, progress)
    writeJson(join(OVERLAYS(pr), `${pr.headSha}.json`), o)
    return o
  }

  progress('Mapping the change: tree, diff and import graph')
  let skeleton = loadSkeleton(pr.repo)
  const nodes = loadNodes(pr.repo)
  const { facts, tree, idx } = await buildFacts(repo, base, pr.headSha, skeleton?.systems.flatMap((s) => s.paths) ?? [])
  const sig = signature(tree)
  // the base map builds the system map from its folder summaries (mapSystems); a PR only sketches one where none is coming
  const needSkeleton = !loadBase(pr.repo) && (!goodSkeleton(skeleton, sig) || skeleton!.signature !== sig)
  const asks = await staleNodes(repo, facts, tree, idx, nodes)

  // iteration > 1: carry over every touched entry whose file did not change since the last head
  let interdiff: string[] | undefined
  if (prev) interdiff = (await diff(repo, prev.headSha, pr.headSha).catch(() => undefined))?.map((c) => c.path)
  const current = new Set(facts.changes.map((c) => c.path))
  const { kept, ask: askTouched } = carryOver(prev?.touched, [...current], interdiff)

  progress(`Explaining ${askTouched.length} changed file${askTouched.length === 1 ? '' : 's'}${kept.length ? `, reusing ${kept.length}` : ''}${asks.length ? `, mapping ${asks.length} folder${asks.length === 1 ? '' : 's'}` : ''}`)
  const cwd = await worktree(pr, repo, pr.headSha)
  // the ticket(s) it names (title, branch, description): where the story's "why" comes from
  const ids = [...new Set(`${pr.title} ${pr.head} ${pr.body ?? ''}`.toUpperCase().match(/\b[A-Z]{2,4}-\d{1,6}\b/g) ?? [])].slice(0, 2)
  const tickets = (await Promise.all(ids.map((id) => ticketBrief(id).catch(() => undefined)))).filter((x): x is string => !!x)
  // the PRs below in its stack, as their own explanations put them: this one builds on them, and says so
  const builds = (opts.below ?? []).flatMap((b) => {
    const o = loadOverlay(b)
    return o ? [`#${b.number} "${b.title}": ${o.business.headline}. ${o.tour?.story?.solution ?? o.business.what}`] : [`#${b.number} "${b.title}" (not explained yet)`]
  })
  const prompt = buildPrompt({ pr, base, head: pr.headSha, facts, skeleton, needSkeleton, sig, nodes, asks, askTouched, prev, interdiff, tickets, builds })
  writeJson(join(OVERLAYS(pr), 'last-prompt.json'), { prompt }) // for debugging what was (not) asked
  const { result, cost } = await callClaude(prompt, cwd, opts.signal, progress, SCHEMA, config.explainBudgetUsd ?? 1.5, await method('explainChange', `${FORMAT}\n\noverlay.levels: ${LEVELS_SYSTEM}`), undefined, pr.repo)

  // persist the shared knowledge first, so even a later failure leaves the atlas richer
  const now = new Date().toISOString()
  if (usable(result.skeleton)) { skeleton = { signature: sig, ...result.skeleton! }; writeJson(join(ATLAS(pr.repo), 'skeleton.json'), skeleton) }
  const fresh = loadNodes(pr.repo)
  for (const n of result.nodes) {
    const sha = tree.get(n.path)?.sha
    if (!sha) continue
    fresh[n.path] = { sha, children: (idx.get(n.path) ?? []).map((p) => p.split('/').pop()!), summary: n.summary, responsibilities: n.responsibilities, businessRole: n.businessRole, at: now }
  }
  writeJson(join(ATLAS(pr.repo), 'nodes.json'), fresh)

  const overlay: Overlay = {
    iteration: (prev?.iteration ?? 0) + 1, headSha: pr.headSha, baseSha: base, prevHeadSha: prev?.headSha,
    createdAt: now, costUsd: cost, reused: kept.length, asked: askTouched.length, nodesAsked: asks.length, nodesKnown: knownCount(facts, nodes, asks),
    ...result.overlay,
    touched: [...kept, ...result.overlay.touched.filter((t) => current.has(t.path))],
    facts,
  }
  // the levels come with the explanation; an answer without them (an old skill, a cut-off) gets them on their own
  const lv = (result.overlay as { levels?: Parameters<typeof levelsOf>[0] }).levels
  const done = lv?.nodes.length ? { ...overlay, levels: levelsOf(lv, overlay) } : await withLevels(overlay, pr, opts.signal, progress)
  writeJson(join(OVERLAYS(pr), `${pr.headSha}.json`), done)
  writeJson(join(OVERLAYS(pr), 'latest.json'), { head: pr.headSha })
  return overlay
}

/** The explanation with its five levels (levels.ts); a failure leaves it without them, the old map drawn instead. */
async function withLevels(o: Overlay, pr: Pr, signal: AbortSignal | undefined, progress: Progress): Promise<Overlay> {
  progress('Drawing the levels')
  try {
    const { result, cost } = await callClaude<Parameters<typeof levelsOf>[0]>(levelsPrompt(o), tmpdir(), signal, progress, LEVELS_SCHEMA, 0.6, LEVELS_SYSTEM, undefined, pr.repo)
    return { ...o, costUsd: o.costUsd + cost, levels: levelsOf(result, o) }
  } catch (e) { console.warn(`levels ${pr.repo}#${pr.number}: ${(e as Error).message.split('\n')[0]}`); return o }
}

export function callClaude<T = Result>(prompt: string, cwd: string, signal: AbortSignal | undefined, progress: Progress, schema: object = SCHEMA, budget = config.explainBudgetUsd ?? 1.5, system = FORMAT, model?: string, repo?: string): Promise<{ result: T; cost: number; provider: ProviderId; tokens?: { input: number; output: number } }> {
  // reading code is the review provider's; a small-model call goes to the one for quick calls (a pinned repo: its account)
  const provider = providerFor(model === 'haiku' ? 'small' : 'review', repo)
  return new Promise((resolve, reject) => {
    // Lean session: no MCP, skills, hooks or user settings. A bare call costs ~$0.01 instead of ~$1.50.
    const child = spawnAgent(provider, [
      '-p', prompt,
      '--json-schema', JSON.stringify(schema),
      '--output-format', 'stream-json', '--verbose',
      '--tools', 'Read', 'Grep', 'Glob', 'Bash',
      '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git:*)', 'Bash(ls:*)',
      '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence',
      '--system-prompt', system,
      '--max-budget-usd', String(budget),
      ...(model ? ['--model', model] : []),
    ], { cwd, signal })
    let buf = '', stderr = '', done: { result: T; cost: number; provider: ProviderId; tokens?: { input: number; output: number } } | undefined, error: string | undefined
    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk
      const lines = buf.split('\n'); buf = lines.pop()!
      for (const line of lines) {
        let m: any; try { m = JSON.parse(line) } catch { continue }
        if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
          if (c.type === 'tool_use') progress(c.name === 'Read' ? `Reading ${String(c.input?.file_path ?? '').split('/').slice(-2).join('/')}` : c.name === 'Bash' ? `Running ${String(c.input?.command ?? '').slice(0, 60)}` : `${c.name} ${String(c.input?.pattern ?? '')}`)
        }
        if (m.type === 'result') {
          if (m.is_error || !m.structured_output) error = String(m.result ?? m.subtype ?? 'no structured output').slice(0, 400)
          else done = { result: m.structured_output, cost: m.total_cost_usd ?? 0, provider, tokens: tokensOf(m) }
          setTimeout(() => child.kill('SIGTERM'), 3000)
        }
      }
    })
    child.stderr!.on('data', (c: Buffer) => { stderr = (stderr + c).slice(-2000) })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => done ? resolve(done) : reject(new Error(error ?? (stderr.trim().slice(-400) || `claude exited with ${code}`))))
  })
}

// --- the base map: summarise the default branch once, then keep it fresh ----------------------
// Every PR is then explained against a complete picture of the codebase instead of only what
// earlier PRs happened to touch. Same content-hash rules: unchanged folders are never re-asked.

// usdPerFolder: measured on a 383-folder monorepo ($1.85 for 331), rounded up a little
export const BASE = { depth: 5, minFiles: 3, batch: 40, usdPerFolder: 0.007 }
// complete: false while a map is still filling in (or was stopped part way); older files have no flag and are complete
export type BaseMeta = { branch: string; sha: string; mappedAt: string; folders: number; costUsd: number; complete?: boolean }
export const loadBase = (repo: string) => readJson<BaseMeta>(join(ATLAS(repo), 'base.json'))

/** Folders worth a map entry: up to BASE.depth deep, holding at least BASE.minFiles files, shallow first. */
export function baseScope(tree: Map<string, Entry>): string[] {
  const files = new Map<string, number>()
  for (const [p, e] of tree) if (e.type === 'blob') for (const a of ancestors(p)) if (a) files.set(a, (files.get(a) ?? 0) + 1)
  return [...files].filter(([d, n]) => n >= BASE.minFiles && d.split('/').length <= BASE.depth && !d.split('/').some((x) => x.startsWith('.')))
    .map(([d]) => d).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

/** Below `under`: up to 3 more levels of folders that hold any files. For "map deeper" on one folder. */
export function deepScope(tree: Map<string, Entry>, under: string): string[] {
  const base = under.split('/').length, files = new Set<string>()
  for (const [p, e] of tree) if (e.type === 'blob' && p.startsWith(under + '/')) for (const a of ancestors(p)) if (a.startsWith(under + '/')) files.add(a)
  return [...files].filter((d) => d.split('/').length <= base + 3 && !d.split('/').some((x) => x.startsWith('.')))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

export async function basePlan(repoName: string, repoPath: string, branch: string, under?: string) {
  // a repository just added: this machine is still cloning it (setup.ts ensureClones)
  if (!(await stat(repoPath).then(() => true, () => false))) throw new Error('Not on this machine yet: it is being cloned')
  await git(repoPath, 'fetch', '--quiet', 'origin', branch)
  const sha = (await git(repoPath, 'rev-parse', `origin/${branch}`)).trim()
  const tree = await listTree(repoPath, sha)
  const idx = childIndex(tree)
  const scope = under ? deepScope(tree, under) : baseScope(tree)
  const asks = await driftAsks(repoPath, scope, tree, idx, loadNodes(repoName))
  const skeleton = loadSkeleton(repoName)
  return {
    branch, sha, tree, idx, scope, asks, needSkeleton: !under && (!goodSkeleton(skeleton, signature(tree)) || skeleton!.signature !== signature(tree)),
    known: scope.length - asks.length, estimateUsd: Math.round(asks.length * BASE.usdPerFolder * 100) / 100,
  }
}

const BASE_SCHEMA = { type: 'object', additionalProperties: false, required: ['nodes'], properties: { skeleton: SCHEMA.properties.skeleton, nodes: SCHEMA.properties.nodes } }

export async function mapBase(repoName: string, repoPath: string, branch: string, opts: {
  signal?: AbortSignal; progress: (step: string, done: number, total: number, costUsd: number) => void; overBudget: () => boolean
  under?: string // map deeper below this folder instead of the whole default branch
}): Promise<BaseMeta> {
  opts.progress('Reading the default branch', 0, 0, 0)
  const plan = await basePlan(repoName, repoPath, branch, opts.under)
  const prev = loadBase(repoName)
  // the map file is written after every batch, so a stopped or running map is still browsable
  const writeMeta = (cost: number, finished: boolean) => {
    const meta: BaseMeta = {
      branch, sha: opts.under && prev ? prev.sha : plan.sha, mappedAt: new Date().toISOString(),
      folders: opts.under && prev ? prev.folders : plan.scope.length,
      costUsd: Math.round(((prev?.costUsd ?? 0) + cost) * 1000) / 1000,
      complete: opts.under ? prev?.complete !== false : finished,
    }
    writeJson(join(ATLAS(repoName), 'base.json'), meta)
    return meta
  }
  const { tree, idx, asks } = plan
  const wt = join(STATE_DIR, 'worktrees', `${slug(repoName)}-base`)
  await worktreeAt(repoPath, wt, plan.sha)

  let cost = 0, done = 0
  for (let i = 0; i < asks.length; i += BASE.batch) {
    if (opts.signal?.aborted) throw new Error('cancelled')
    if (opts.overBudget()) throw new Error('Daily budget or the Claude plan limit reached; the map picks up where it stopped once there is room')
    const batch = asks.slice(i, i + BASE.batch)
    const nodes = loadNodes(repoName)
    const parents = [...new Set(batch.flatMap((a) => ancestors(a.path)).filter((p) => p && nodes[p]))]
    const lines = [
      `Repository ${repoName}, branch ${branch} at ${plan.sha}. The working directory is checked out there.`,
      'For each folder below, write: a one-sentence summary of what it does, 2 to 4 responsibilities, and a businessRole when users or the business would recognise it.',
      'Use the file names given, plus READMEs, manifests and entry points when you need them. Do not read whole files.',
    ]
    if (parents.length) lines.push('', '## Known parent folders (context, do not re-derive)', ...parents.map((p) => `- ${p}: ${nodes[p].summary}`))
    lines.push('', '## Folders', ...batch.map((a) => {
      const kids = (idx.get(a.path) ?? []).map((k) => k.split('/').pop()! + (tree.get(k)?.type === 'tree' ? '/' : '')).slice(0, 14).join(', ')
      return a.mode === 'new' ? `- ${a.path} (contains: ${kids})` : `- ${a.path} (contains: ${kids}; update, it was: "${a.previous}"; since then these changed: ${a.changed?.join(', ')})`
    }))
    // name the area being mapped, not the agent's shell commands
    const areas = [...new Set(batch.map((x) => x.path.split('/').slice(0, 2).join('/')))]
    const label = `Mapping ${areas.slice(0, 2).join(', ')}${areas.length > 2 ? ` and ${areas.length - 2} more` : ''}`
    opts.progress(label, done, asks.length, cost)
    const { result, cost: c } = await callClaude<{ nodes: Result['nodes'] }>(
      lines.join('\n'), wt, opts.signal, () => opts.progress(label, done, asks.length, cost), BASE_SCHEMA, 2, await method('explainCodebase', FORMAT), undefined, repoName)
    cost += c
    const fresh = loadNodes(repoName), now = new Date().toISOString()
    for (const n of result.nodes) {
      const sha = tree.get(n.path)?.sha
      if (sha) fresh[n.path] = { sha, children: (idx.get(n.path) ?? []).map((p) => p.split('/').pop()!), summary: n.summary, responsibilities: n.responsibilities, businessRole: n.businessRole, at: now }
    }
    writeJson(join(ATLAS(repoName), 'nodes.json'), fresh)
    done += batch.length
    writeMeta(cost, false)
    opts.progress('Saved', done, asks.length, cost)
  }
  // last, from what the folders turned out to be: the systems and how they talk
  if (plan.needSkeleton) {
    if (opts.overBudget()) throw new Error('Daily budget or the Claude plan limit reached; the map picks up where it stopped once there is room')
    opts.progress('Mapping the systems', done, asks.length, cost)
    cost += await mapSystems(repoName, tree, wt, opts.signal, () => opts.progress('Mapping the systems', done, asks.length, cost))
  }
  return writeMeta(cost, true)
}

const SYSTEMS_SCHEMA = { type: 'object', additionalProperties: false, required: ['skeleton'], properties: { skeleton: SCHEMA.properties.skeleton } }
/**
 * The system map, written from the folder summaries the base map just made: one call, after them, with rules that keep
 * a monorepo's domains apart (one system per deployable app, libraries grouped by domain, infra and outside services
 * named). Tried twice; a map that still lumps the repo together is not kept. Returns what it cost.
 */
export async function mapSystems(repoName: string, tree: Map<string, Entry>, cwd: string, signal: AbortSignal | undefined, progress: () => void): Promise<number> {
  const sig = signature(tree), nodes = loadNodes(repoName), units = unitsOf(sig)
  const line = (p: string) => {
    const n = nodes[p], e2e = tree.has(`${p}-e2e`) ? ' (has an -e2e folder: part of it)' : ''
    return `- ${p}${e2e}: ${n ? `${n.summary}${n.responsibilities?.length ? ` Does: ${n.responsibilities.join('; ')}.` : ''}${n.businessRole ? ` Business: ${n.businessRole}` : ''}` : '(not summarised)'}`
  }
  const prompt = [
    `Repository ${repoName}. Write its system map: the systems it is made of, the business actors around them, and how they talk.`,
    '',
    '## Its units, as the folder map describes them',
    ...(units.length ? units : sig.split(',').filter((p) => p && !p.includes('/'))).map(line),
    '',
    '## Format',
    `- Group them into systems as your instructions say. Every unit above belongs to exactly one system; at most 16 systems in all, so the map stays readable.`,
    '- Edges are runtime relationships between systems (http, websocket, queue, db, sdk, import), each with a short label. Actors are the people and companies using it.',
    '- Short kebab-case ids.',
  ].join('\n')
  let cost = 0
  for (let tries = 0; tries < 2; tries++) {
    const { result, cost: c } = await callClaude<{ skeleton: Omit<Skeleton, 'signature'> }>(prompt, cwd, signal, progress, SYSTEMS_SCHEMA, 1.5, await method('explainCodebase', FORMAT), undefined, repoName)
    cost += c
    if (goodSkeleton(result.skeleton, sig)) { writeJson(join(ATLAS(repoName), 'skeleton.json'), { signature: sig, ...result.skeleton }); return cost }
  }
  console.warn(`atlas: the system map for ${repoName} came back lumped together twice; kept the previous one`)
  return cost
}

// --- the codebase view: browse a repo's map without a PR -------------------------------------

// deeper: unmapped subfolders below this one (up to 3 levels), what "Map deeper" would cover
export type CodebaseFolder = { children: string[]; files: number; summary?: string; responsibilities?: string[]; businessRole?: string; deeper: number }
export type Codebase = {
  meta: BaseMeta
  skeleton?: Skeleton
  folders: Record<string, CodebaseFolder> // mapped folders, plus '' for the repo root
  edges: Record<string, { from: string; to: string; count: number }[]> // import wiring between a folder's children
  systemEdges: { from: string; to: string; count: number }[]
}
const codebaseCache = new Map<string, { key: string; data: Codebase }>()

/** The mapped default branch as a browsable tree. Each import edge counts once, at the deepest folder holding both ends. */
export async function codebase(repoName: string, repoPath: string): Promise<Codebase | undefined> {
  const meta = loadBase(repoName)
  if (!meta) return undefined
  // the map changes as batches land, and its systems are drawn last: key on the commit and on every write here (a key on
  // the folder file's time missed a system map written after the last folder batch, and kept the old one on the page)
  const key = `${meta.sha}:${written}`
  const hit = codebaseCache.get(repoName)
  if (hit?.key === key) return hit.data
  await ensureCommit(repoPath, meta.sha, 0).catch(() => git(repoPath, 'fetch', '--quiet', 'origin', meta.branch))
  const tree = await listTree(repoPath, meta.sha)
  const files = new Set([...tree].filter(([, e]) => e.type === 'blob').map(([p]) => p))
  const g = await importGraph(repoPath, meta.sha, files)
  const nodes = loadNodes(repoName)
  // the default scope, plus anything mapped deeper on request
  const scope = new Set([...baseScope(tree), ...Object.keys(nodes).filter((p) => p && tree.get(p)?.type === 'tree')])
  const skeleton = loadSkeleton(repoName)
  const count = new Map<string, number>()
  for (const f of files) for (const a of ancestors(f)) count.set(a, (count.get(a) ?? 0) + 1)
  const idx = childIndex(tree)
  const folders: Codebase['folders'] = {}
  for (const d of ['', ...scope]) {
    const n = nodes[d]
    folders[d] = { children: (idx.get(d) ?? []).filter((c) => scope.has(c)), files: count.get(d) ?? 0, summary: n?.summary, responsibilities: n?.responsibilities, businessRole: n?.businessRole, deeper: 0 }
  }
  // how much "Map deeper" would add under each folder
  const holdsFiles = new Set<string>()
  for (const f of files) for (const a of ancestors(f)) holdsFiles.add(a)
  for (const dir of holdsFiles) {
    if (!dir || scope.has(dir) || dir.split('/').some((x) => x.startsWith('.'))) continue
    const parts = dir.split('/')
    for (let k = parts.length - 1; k >= Math.max(1, parts.length - 3); k--) {
      const owner = parts.slice(0, k).join('/')
      if (folders[owner]) { folders[owner].deeper++; break }
    }
  }
  // owner folder of an edge: the longest common folder prefix that is mapped; its children are the two ends
  const edgeMap = new Map<string, Map<string, { from: string; to: string; count: number }>>()
  const known = skeleton?.systems.flatMap((s) => s.paths) ?? []
  const sys = new Map<string, number>()
  for (const [a, targets] of g.out) for (const b of targets) {
    const pa = a.split('/'), pb = b.split('/')
    let i = 0
    while (i < pa.length - 1 && i < pb.length - 1 && pa[i] === pb[i]) i++
    for (let k = i; k >= 0; k--) {
      const owner = pa.slice(0, k).join('/')
      if (!(owner in folders)) continue
      const ca = pa.slice(0, k + 1).join('/'), cb = pb.slice(0, k + 1).join('/')
      if (ca !== cb && folders[ca] && folders[cb]) {
        if (!edgeMap.has(owner)) edgeMap.set(owner, new Map())
        const m = edgeMap.get(owner)!, key = `${ca}\0${cb}`
        if (!m.has(key)) m.set(key, { from: ca, to: cb, count: 0 })
        m.get(key)!.count++
      }
      break
    }
    const ra = systemRoot(a, known), rb = systemRoot(b, known)
    if (ra && rb && ra !== rb) sys.set(`${ra}\0${rb}`, (sys.get(`${ra}\0${rb}`) ?? 0) + 1)
  }
  const data: Codebase = {
    meta, skeleton, folders,
    edges: Object.fromEntries([...edgeMap].map(([o, m]) => [o, [...m.values()].sort((x, y) => y.count - x.count)])),
    systemEdges: [...sys].map(([k, c]) => { const [from, to] = k.split('\0'); return { from, to, count: c } }),
  }
  codebaseCache.set(repoName, { key, data })
  return data
}
