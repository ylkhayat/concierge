// The change at five depths (the Understanding board's meter): 1 its purpose in one box, 2 what became possible,
// 3 the parts that changed, 4 how each does it, 5 the files. Each box is a change (before → after, why), sorted into the
// dimension it changes (behaviour, data, contract…), and a tree: a box opens into its children one level down, so moving
// the meter unfolds the board in place. Written once from the explanation (levels 1–4; 5 is its per-file entries).
import type { Overlay } from './explain.ts'

export const DIMS = ['behaviour', 'data', 'contract', 'logic', 'wiring', 'security', 'safety'] as const
export type Dim = (typeof DIMS)[number]
export type LevelNode = { id: string; parent?: string; level: 1 | 2 | 3 | 4 | 5; dim: Dim; title: string; before?: string; after: string; why?: string; path?: string }
export type Levels = { nodes: LevelNode[]; links: [string, string][] } // links: cause → effect, across dimensions

export const LEVELS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['nodes', 'links', 'files'],
  properties: {
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'level', 'dim', 'title', 'after'], properties: {
      id: { type: 'string' }, parent: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 4 }, dim: { type: 'string', enum: [...DIMS] },
      title: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, why: { type: 'string' } } } },
    links: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'parent', 'title'], properties: { path: { type: 'string' }, parent: { type: 'string' }, title: { type: 'string' } } } },
  },
}

export const LEVELS_SYSTEM = `You turn an explanation of a pull request into a tree of changes at four depths, for a reviewer who is lost.
Level 1: exactly one node, the purpose: what is now true for whom, no technical words.
Level 2: 2-4 capabilities: what became possible or different, in plain words. Parent: the level 1 node.
Level 3: the parts that changed (3-8), named as a person would say them, not file or class names. Parent: a level 2 node.
Level 4: how each part does it: the mechanism, concrete (names, limits, formats). Parent: a level 3 node.
Every node is a change: "before" what was true (omit when the thing is new), "after" what is true now, "why" in a short line.
Write short: a title of 2-6 words, after and before one sentence each.
dim: what the change is to: behaviour (what a user or caller notices), data (what is stored or sent, its shape), contract (APIs, interfaces, messages between parts), logic (rules and decisions), wiring (config, dependencies, environments), security (access, secrets, privacy), safety (tests and checks).
links: cause → effect between nodes of the same level where one change makes another necessary or visible (e.g. a contract change → a behaviour change). Few, only real ones.
files: every changed file path given, with the level 4 node it belongs to and a title of 2-5 words saying what it is or does (never its file or class name).
Ids: short, unique (e.g. p, c1, c1a, c1a1).`

/** The prompt: the explanation, without what the levels don't need. */
export const levelsPrompt = (o: Overlay) => JSON.stringify({
  business: o.business, story: o.tour?.story && { push: o.tour.story.push, solution: o.tour.story.solution, before: o.tour.story.before.caption, after: o.tour.story.after.caption },
  steps: o.tour?.steps.map((s) => ({ title: s.title, what: s.what ?? s.narrative, why: s.why, paths: s.paths })),
  flows: o.flows, files: o.touched.map((t) => ({ path: t.path, change: t.change, before: t.before, after: t.after, why: t.why })),
})

/** The model's answer made whole: level 5 from the files, every parent real, every file under a level 4 node. */
export function levelsOf(r: { nodes: LevelNode[]; links: { from: string; to: string }[]; files: { path: string; parent: string; title?: string }[] }, o: Overlay): Levels {
  const ids = new Set(r.nodes.map((n) => n.id))
  const nodes: LevelNode[] = r.nodes.map((n) => ({ ...n, parent: n.parent && ids.has(n.parent) && n.parent !== n.id ? n.parent : undefined }))
  const fours = nodes.filter((n) => n.level === 4)
  for (const t of o.touched) {
    const f = r.files.find((x) => x.path === t.path), under = f?.parent
    const parent = under && ids.has(under) ? under : fours[0]?.id
    const p = nodes.find((n) => n.id === parent)
    nodes.push({ id: `f:${t.path}`, parent, level: 5, dim: p?.dim ?? 'logic', title: f?.title ?? '', before: t.before, after: t.after, why: t.why, path: t.path })
  }
  return { nodes, links: r.links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to).map((l) => [l.from, l.to]) }
}

/** What the board shows at a level: that level's boxes, and shallower ones that don't go deeper. */
export function visibleAt(lv: Levels, level: number): LevelNode[] {
  const hasKids = new Set(lv.nodes.map((n) => n.parent).filter(Boolean))
  return lv.nodes.filter((n) => n.level === level || (n.level < level && !hasKids.has(n.id)))
}
/** A link drawn at a level: each end lifted to the box that shows it (a deeper node: its ancestor on the board). */
export function linksAt(lv: Levels, level: number): [string, string][] {
  const shown = new Set(visibleAt(lv, level).map((n) => n.id)), by = new Map(lv.nodes.map((n) => [n.id, n]))
  const up = (id?: string): string | undefined => { let n = id ? by.get(id) : undefined; while (n && !shown.has(n.id)) n = n.parent ? by.get(n.parent) : undefined; return n?.id }
  const out = new Map<string, [string, string]>()
  for (const [a, b] of lv.links) { const x = up(a), y = up(b); if (x && y && x !== y) out.set(`${x}>${y}`, [x, y]) }
  return [...out.values()]
}

// ponytail: the one check, run with `node --experimental-strip-types server/levels.ts`
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) { // never in the browser, which reads this file too
  const lv: Levels = { nodes: [
    { id: 'p', level: 1, dim: 'behaviour', title: 'P', after: '' }, { id: 'c', parent: 'p', level: 2, dim: 'behaviour', title: 'C', after: '' },
    { id: 'a', parent: 'c', level: 3, dim: 'contract', title: 'A', after: '' }, { id: 'b', parent: 'c', level: 3, dim: 'behaviour', title: 'B', after: '' },
    { id: 'a1', parent: 'a', level: 4, dim: 'contract', title: 'A1', after: '' }], links: [['a1', 'b']] }
  const ids = (l: number) => visibleAt(lv, l).map((n) => n.id).join()
  console.assert(ids(1) === 'p' && ids(3) === 'a,b' && ids(4) === 'b,a1', 'visible', ids(4))
  console.assert(JSON.stringify(linksAt(lv, 3)) === '[["a","b"]]' && linksAt(lv, 2).length === 0, 'links')
  console.log('levels ok')
}
