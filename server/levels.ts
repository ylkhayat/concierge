// The change at five depths, for someone who knows nothing of it (the Understanding board's meter), and the reviewer's
// guide (the Intent board). The ladder:
//   1 Context        what this part of the product is, for a newcomer (no project words left undefined)
//   2 The problem    what went wrong, plainly, with a real example from the change, and why it matters
//   3 What changes   what became possible or different
//   4 How it works   the mechanisms
//   5 Code           each file
// 1 and 2 are read like a short article; 3 to 5 are a board, each card sorted into the dimension it changes (behaviour,
// data, contract…), a tree whose cards open into their children one level down. Every project word used is in the
// glossary (and a newcomer pass adds the ones the writing missed: explain.ts). Written with the explanation (levels 1–4;
// 5 is its per-file entries). v2: this ladder; an explanation drawn before it is drawn again on opening.
import type { Overlay } from './explain.ts'

export const DIMS = ['behaviour', 'data', 'contract', 'logic', 'wiring', 'security', 'safety'] as const
export type Dim = (typeof DIMS)[number]
export type LevelNode = { id: string; parent?: string; level: 1 | 2 | 3 | 4 | 5; dim: Dim; title: string; before?: string; after: string; why?: string; path?: string; story?: string; who?: string; when?: string } // who, when: a card's story in plain terms
/** What a reviewer checks: what the PR claims, why this way, what must be true for it to be right and where to see it, and its risks. */
export type Review = {
  claim: string; approach: string; why: string
  alternatives: { label: string; why: string }[]
  assumptions: { id: string; text: string; path: string; lines?: string; look: string }[]
  risks: { text: string; level: 'low' | 'medium' | 'high' }[]
}
export type Term = { term: string; means: string }

/** A card's "In context": a real example of it, written with the card (server/index.ts /story writes one for a card without). */
export const STORY_RULE = 'ONE concrete example of this card, at most 35 words: a real case from the change (an input, a test case, a request, a value) and what happens to it now, and before if that changed. E.g. "streichen" (delete or cancel?): before, it failed the run; now it is a known limit and never fails it. Use only what you know of the change; never invent a person or a scenario it does not contain.'
export type Levels = { v?: number; nodes: LevelNode[]; links: [string, string][]; glossary?: Term[]; review?: Review } // links: cause → effect, across dimensions

const str = { type: 'string' }
export const LEVELS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['nodes', 'links', 'files', 'glossary', 'review'],
  properties: {
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'level', 'dim', 'title', 'after', 'story'], properties: {
      id: str, parent: str, level: { type: 'integer', minimum: 1, maximum: 4 }, dim: { type: 'string', enum: [...DIMS] },
      title: str, before: str, after: str, why: str, story: str, who: str, when: str } } },
    links: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: str, to: str } } },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'parent', 'title', 'story'], properties: { path: str, parent: str, title: str, story: str } } },
    glossary: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'means'], properties: { term: str, means: str } } },
    review: { type: 'object', additionalProperties: false, required: ['claim', 'approach', 'why', 'alternatives', 'assumptions', 'risks'], properties: {
      claim: str, approach: str, why: str,
      alternatives: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'why'], properties: { label: str, why: str } } },
      assumptions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'path', 'look'], properties: { id: str, text: str, path: str, lines: str, look: str } } },
      risks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'level'], properties: { text: str, level: { type: 'string', enum: ['low', 'medium', 'high'] } } } },
    } },
  },
}

export const LEVELS_SYSTEM = `You explain a pull request to someone who has never seen this project: a capable engineer, new to its product, its words and its history. You write a ladder from the obvious down to the code, and a guide for reviewing it.
Level 1 · Context: 1 or 2 nodes saying what this part of the product is and does, as you would to a new colleague on their first day, before any of this change. No "before"; "after" is the plain description. Never a project word without explaining it.
Level 2 · The problem: 1 or 2 nodes: "before" what went wrong or was missing, plainly; "after" what is true once this lands; "why" why it matters (who or what it hurt, with any number or evidence the input gives). Parent: none.
Level 3 · What changes: 2 to 5 nodes, what became possible or different, in plain words. Parent: a level 2 node.
Level 4 · How it works: 3 to 8 nodes, the mechanisms, concrete (names, limits, formats). Parent: a level 3 node.
From level 2 down every node is a change: "before" (omit when new), "after", "why", each one short sentence. Titles 2 to 6 words, never a file or class name.
Plain words first: a project word (a component's name, an acronym, a domain term like "gated", "held-out", "seesaw") is used only once the glossary defines it, and levels 1 and 2 use as few as they can.
glossary: the project or domain words a newcomer meets in levels 1 to 3 and would not know (at most 12, the ones that matter most), exactly as written in your text, each with a plain meaning in at most 15 words. Never a code identifier (a constant, a prefix, a function name): those belong to levels 4 and 5, where the reader is already in the code. Never an everyday word (branch, test, config).
dim (levels 3 and 4): what the change is to: behaviour (what a user or caller notices), data (what is stored or sent, its shape), contract (APIs, interfaces, messages between parts), logic (rules and decisions), wiring (config, dependencies, environments), security (access, secrets, privacy), safety (tests and checks). Levels 1 and 2: behaviour.
links: cause → effect between nodes of the same level (3 or 4) where one change makes another necessary or visible. Few, only real ones.
files: every changed file path given, with the level 4 node it belongs to and a title of 2 to 5 words saying what it is or does (never its file or class name).
story, on every node and every file: ${STORY_RULE} On a level 2 node it is the example that makes the problem obvious.
review, for whoever reviews it: claim (what this PR promises, one sentence); approach (how it does it) and why (why this way); alternatives (other ways it could have gone, each with why not; only real ones, none is fine); assumptions (2 to 6 things that must be true for it to be correct, each with the changed file to read (path), its line range if you know it (lines, e.g. "40-62"), and look: exactly what to check there); risks (what could go wrong, each low, medium or high).
who and when, on every node of levels 2 and 3 (its story in plain terms, read as labelled rows): who meets this change, as a role ("an engineer comparing two eval runs", "a caller hanging up mid-task"; never an invented name), and when it shows up (the situation, e.g. "after changing the router's input"). Short phrases, no project words a newcomer would not know.
Ids: short, unique (e.g. c1, p1, w1, h1, a1).`

/** The prompt: the explanation, without what the levels don't need. */
export const levelsPrompt = (o: Overlay) => JSON.stringify({
  business: o.business, story: o.tour?.story && { push: o.tour.story.push, solution: o.tour.story.solution, before: o.tour.story.before.caption, after: o.tour.story.after.caption },
  steps: o.tour?.steps.map((s) => ({ title: s.title, what: s.what ?? s.narrative, why: s.why, paths: s.paths })),
  flows: o.flows, files: o.touched.map((t) => ({ path: t.path, change: t.change, before: t.before, after: t.after, why: t.why })),
})

/** The model's answer made whole: level 5 from the files, every parent real, every file under a level 4 node. */
export function levelsOf(r: { nodes: LevelNode[]; links: { from: string; to: string }[]; files: { path: string; parent: string; title?: string; story?: string }[]; glossary?: Term[]; review?: Review }, o: Overlay): Levels {
  const ids = new Set(r.nodes.map((n) => n.id))
  const nodes: LevelNode[] = r.nodes.map((n) => ({ ...n, parent: n.parent && ids.has(n.parent) && n.parent !== n.id ? n.parent : undefined }))
  const fours = nodes.filter((n) => n.level === 4)
  for (const t of o.touched) {
    const f = r.files.find((x) => x.path === t.path), under = f?.parent
    const parent = under && ids.has(under) ? under : fours[0]?.id
    const p = nodes.find((n) => n.id === parent)
    nodes.push({ id: `f:${t.path}`, parent, level: 5, dim: p?.dim ?? 'logic', title: f?.title ?? '', before: t.before, after: t.after, why: t.why, path: t.path, story: f?.story })
  }
  return { v: 3, nodes, links: r.links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to).map((l) => [l.from, l.to]), glossary: r.glossary ?? [], review: r.review }
}

/** What shows at a level: that level's cards; on the board (3 and down) also its shallower ones that don't go deeper. Context and the problem stay on their own levels. */
export function visibleAt(lv: Levels, level: number): LevelNode[] {
  const hasKids = new Set(lv.nodes.map((n) => n.parent).filter(Boolean)), board = (lv.v ?? 1) >= 2 ? 3 : 1
  return lv.nodes.filter((n) => n.level === level || (level >= board && n.level >= board && n.level < level && !hasKids.has(n.id)))
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
  // v2: context and the problem stay on their own levels; the board starts at 3
  const v2: Levels = { v: 2, nodes: [
    { id: 'c', level: 1, dim: 'behaviour', title: 'C', after: '' }, { id: 'p', level: 2, dim: 'behaviour', title: 'P', after: '' },
    { id: 'w', parent: 'p', level: 3, dim: 'logic', title: 'W', after: '' }, { id: 'x', parent: 'p', level: 3, dim: 'data', title: 'X', after: '' },
    { id: 'h', parent: 'w', level: 4, dim: 'logic', title: 'H', after: '' }], links: [] }
  const at = (l: number) => visibleAt(v2, l).map((n) => n.id).join()
  console.assert(at(1) === 'c' && at(2) === 'p' && at(3) === 'w,x' && at(4) === 'x,h', 'v2 visible', at(1), at(2), at(3), at(4))
  console.log('levels ok')
}
