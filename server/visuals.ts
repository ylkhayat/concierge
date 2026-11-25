// Visuals: what a pull request looks like, before and after, without opening it. Design's own workspace.
//
// When it applies: a PR that changes what people see (its files say so, or a ticket it ships is marked design), in a
// repository where visuals are on (Settings → Repositories: off, auto, always; per workspace, a repository's own
// choice first), or one you turned on yourself. Off unless you turn it on, and only once you joined Design.
//
// How: an agent, on a machine that has the checkout, captures the screens the change touches: the repository's
// Storybook stories when it has Storybook, else the running app through Playwright. Each screen twice, on the base
// branch (before) and on the PR (after). What it saves, per PR and per commit:
//
//   <STATE_DIR>/visuals/<owner>-<repo>-<number>/<sha>/manifest.json   what was captured, and how
//   <STATE_DIR>/visuals/<owner>-<repo>-<number>/<sha>/*.png           the screenshots
//
// The folder travels to every machine (replica.ts), so the page shows them wherever it is served. Like a plan, a PR's
// visuals are a conversation: what you say ("also at phone width", "the empty state too") continues the agent's own
// session, and it captures again (feed: "visuals:<pr id>").
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.ts'
import { STATE_DIR } from './paths.ts'

export type VisualsMode = 'off' | 'auto' | 'always'
export const VISUALS_MODES: VisualsMode[] = ['off', 'auto', 'always']
/** A PR's own choice, over its repository's: capture it, or never. */
export type VisualsOverride = 'on' | 'off'

/** What a repository's visuals are set to: its own choice, else its workspace's (organization), else off. */
export function modeOf(repo: string): VisualsMode {
  return config.visuals?.repos?.[repo] ?? config.visuals?.orgs?.[repo.split('/')[0]] ?? 'off'
}

// --- does it change what people see? ---------------------------------------------------------------------------------
// The files decide, by rules: markup, components and styles count; tests, stories' snapshots, servers, migrations and
// config don't. A ticket it ships marked design (a label) counts too, whatever its files.
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|styl|html|mdx)$/i
const UI_DIR = /(^|\/)(components?|pages|app|views|screens|ui|styles|layouts|routes|widgets|design-system|theme)\//i
const NOT_UI = /(^|\/)(__tests__|tests?|e2e|cypress|playwright|server|api|supabase|migrations?|scripts|\.github)\/|\.(test|spec)\.[jt]sx?$|\.d\.ts$|(^|\/)(vite|next|tailwind|postcss|webpack|tsconfig)[^/]*$/i
export const DESIGN_LABEL = /^(design|ui|ux|visual|frontend|front-end)$/i

export type UiCheck = { is: boolean; why: string; files: string[]; head: string; at: string }
/** Whether these changed files (and these ticket labels) make a PR one that changes what people see, and why. */
export function uiChange(paths: string[], labels: string[], head: string, now = new Date().toISOString()): UiCheck {
  const files = paths.filter((p) => !NOT_UI.test(p) && (UI_FILE.test(p) || (UI_DIR.test(p) && /\.(ts|js)$/i.test(p))))
  const marked = labels.find((l) => DESIGN_LABEL.test(l.trim()))
  const is = files.length > 0 || !!marked
  const why = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} people see: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}`
    : marked ? `its ticket is marked ${marked}` : paths.length ? 'no file that people see' : 'no changed files yet'
  return { is, why, files: files.slice(0, 50), head, at: now }
}

/** Whether to capture this PR: your choice for it first, else its repository's (auto: when it changes what people see). */
export function wanted(mode: VisualsMode, override: VisualsOverride | undefined, ui: UiCheck | undefined): boolean {
  if (override) return override === 'on'
  return mode === 'always' || (mode === 'auto' && !!ui?.is)
}

// --- what was captured -------------------------------------------------------------------------------------------------
export const VISUALS_DIR = join(STATE_DIR, 'visuals')
export const slugOf = (prId: string) => prId.replace(/[^\w.-]+/g, '-')
export const shotsDir = (prId: string, sha: string) => join(VISUALS_DIR, slugOf(prId), sha)

// --- the impact: what the PR changes, and where that shows ------------------------------------------------------------
// A capture is read through two lenses. Changed: each component the PR edits, in focus (alone: its story, or the
// element itself on the screen). Affected: the components, layouts and screens that use a changed one (up to three
// imports away), each with the changed ones that flow into it, captured whole for context.
export type Kind = 'component' | 'layout' | 'screen'
/** What a file is, by where it lives and how it is named: a route's page is a screen, a layout or shell a layout. */
export function kindOf(file: string): Kind {
  const f = file.replace(/\\/g, '/')
  if (/(^|\/)(layout|template)\.[jt]sx?$|(^|\/)(layouts?|shells?)\/|(Layout|Shell|Frame|Scaffold)\.[jt]sx?$/.test(f)) return 'layout'
  if (/(^|\/)page\.[jt]sx?$|(^|\/)(pages|screens|views|routes)\/|Screen\.[jt]sx?$|Page\.[jt]sx?$/.test(f)) return 'screen'
  return 'component'
}
/** A changed component: its name and file. An affected one also names the changed ones that reach it, and how far. */
export type Part = { name: string; file: string; kind: Kind }
export type Affected = Part & { via: string[]; depth: number }
export type Impact = { changed: Part[]; affected: Affected[] }

/**
 * One capture: a changed component in focus, or an affected one (or a whole screen) for context; what the agent says
 * about it, and its before and after images (file names in its folder).
 */
// a mark: where a changed component sits on the image, in percent of its width and height, for the numbered outline
export type Mark = { x: number; y: number; w: number; h: number; part?: string; label?: string; side?: 'before' | 'after' }
// domain, variant: a whole screen's place on the baseline's board (the blueprint): its row (an area of the app) and
// its column (a step or state of that area's storyline, in the order shot); its marks then say where every component sits
export type Shot = { name: string; note?: string; before?: string; after?: string; width?: number; lens?: 'changed' | 'affected'; part?: string; viewport?: string; marks?: Mark[]; domain?: string; variant?: string; thumb?: string
  // a screen of the baseline's board, live: its story in the Storybook built beside the capture (storybook/<book>/),
  // and the page's height at its width, so the small render keeps the screenshot's shape and its marks stay in place
  book?: string; story?: string; height?: number }
export type Manifest = { head: string; base?: string; at: string; source: 'storybook' | 'app'; summary?: string; impact?: Impact; shots: Shot[] }
export type VisualSet = Manifest & { sha: string }

const pct = (n: unknown) => Math.min(100, Math.max(0, Number(n) || 0))
/** A shot's marks, kept to boxes inside the image (they come from an agent). */
export function marksOf(raw: unknown, max = 12): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.flatMap((m) => {
    const o = m as Partial<Mark>
    const x = pct(o.x), y = pct(o.y), w = Math.min(pct(o.w), 100 - x), h = Math.min(pct(o.h), 100 - y)
    if (w < 0.5 || h < 0.5) return []
    return [{ x, y, w, h, ...(o.part && { part: String(o.part).slice(0, 80) }), ...(o.label && { label: String(o.label).slice(0, 160) }), ...((o.side === 'before' || o.side === 'after') && { side: o.side }) }]
  }).slice(0, max)
  return out.length ? out : undefined
}

const PATH = /^[\w@()[\]./ -]{1,240}$/
const part = (x: unknown): Part | undefined => {
  const o = x as Partial<Part>
  if (!o || typeof o.file !== 'string' || !PATH.test(o.file) || o.file.includes('..')) return undefined
  const kind = o.kind === 'layout' || o.kind === 'screen' || o.kind === 'component' ? o.kind : kindOf(o.file)
  return { name: String(o.name ?? o.file.split('/').pop()!.replace(/\.[jt]sx?$/, '')).slice(0, 80), file: o.file, kind }
}
/** A manifest's impact, kept to plain names and paths inside the repository (it comes from an agent). */
export function impactOf(raw: unknown): Impact | undefined {
  const r = raw as { changed?: unknown[]; affected?: unknown[] } | undefined
  if (!r || !Array.isArray(r.changed)) return undefined
  const changed = r.changed.map(part).filter((x): x is Part => !!x).slice(0, 60)
  const names = new Set(changed.map((c) => c.name))
  const affected = (Array.isArray(r.affected) ? r.affected : []).flatMap((x) => {
    const p = part(x), o = x as { via?: unknown; depth?: unknown }
    if (!p) return []
    const via = (Array.isArray(o.via) ? o.via : []).map(String).filter((v) => names.has(v))
    return via.length ? [{ ...p, via, depth: Math.min(3, Math.max(1, Number(o.depth) || 1)) }] : []
  }).slice(0, 120)
  return { changed, affected }
}

const FILE = /^[\w.-]{1,120}\.png$/
/** An image's file name from a manifest, kept to a plain name in its own folder (never a path elsewhere). */
export const safeFile = (f?: string) => (f && FILE.test(f) ? f : undefined)

/** Every capture of a PR, newest first: the folders that have a manifest. */
export async function setsOf(prId: string): Promise<VisualSet[]> {
  const dir = join(VISUALS_DIR, slugOf(prId))
  const out: VisualSet[] = []
  for (const sha of await readdir(dir).catch(() => [] as string[])) {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue
    const m = await readFile(join(dir, sha, 'manifest.json'), 'utf8').then((t) => JSON.parse(t) as Manifest, () => undefined)
    if (!m || !Array.isArray(m.shots)) continue
    const shots: Shot[] = m.shots.filter((s) => s && typeof s.name === 'string').slice(0, 200).map((s) => ({
      name: String(s.name).slice(0, 120), note: s.note ? String(s.note).slice(0, 400) : undefined, before: safeFile(s.before), after: safeFile(s.after), width: Number(s.width) || undefined,
      lens: s.lens === 'changed' || s.lens === 'affected' ? s.lens : undefined, part: s.part ? String(s.part).slice(0, 80) : undefined, viewport: s.viewport ? String(s.viewport).slice(0, 20) : undefined,
      // a screen on the board names every component on it: more marks than a capture's few
      marks: marksOf(s.marks, s.domain ? 60 : 12), domain: s.domain ? String(s.domain).slice(0, 40) : undefined, variant: s.variant ? String(s.variant).slice(0, 60) : undefined, thumb: safeFile(s.thumb),
      book: typeof s.book === 'string' && /^[\w.-]{1,60}$/.test(s.book) && !s.book.includes('..') ? s.book : undefined, story: typeof s.story === 'string' && /^[\w-]{1,200}$/.test(s.story) ? s.story : undefined, height: Number(s.height) > 0 ? Math.min(20000, Number(s.height)) : undefined,
    }))
    out.push({ ...m, sha, source: m.source === 'storybook' ? 'storybook' : 'app', summary: m.summary ? String(m.summary).slice(0, 2000) : undefined, impact: impactOf(m.impact), shots })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** The path of one image of a capture, if it is one (for the route that serves it). */
export async function imagePath(prId: string, sha: string, file: string): Promise<string | undefined> {
  if (!/^[0-9a-f]{7,40}$/.test(sha) || !safeFile(file)) return undefined
  const p = join(shotsDir(prId, sha), file)
  return (await stat(p).then((s) => s.isFile(), () => false)) ? p : undefined
}
/**
 * A file of the Storybook built beside a baseline (visuals/repo-<owner>-<repo>/<sha>/storybook/…), for the board's live
 * screens. Baselines only: a repository's own default branch, as the agents already run it; a PR's capture (it may be
 * someone else's code) is never served as a page, only as images.
 */
export async function storybookFile(slug: string, sha: string, rest: string): Promise<string | undefined> {
  if (!/^repo-[\w.-]+$/.test(slug) || !/^[0-9a-f]{7,40}$/.test(sha)) return undefined
  const parts = rest.split('/').filter(Boolean)
  if (!parts.length || parts.some((x) => x === '..' || x.startsWith('.') && x !== '.storybook' || !/^[\w@.+~-]+$/.test(x))) return undefined
  const root = join(VISUALS_DIR, slug, sha, 'storybook'), p = join(root, ...parts)
  if (!p.startsWith(root + '/')) return undefined
  return (await stat(p).then((s) => s.isFile(), () => false)) ? p : undefined
}
export const hasSet = (prId: string, sha: string) => existsSync(join(shotsDir(prId, sha), 'manifest.json'))

// --- what the agents are asked ----------------------------------------------------------------------------------------
// As everywhere in Concierge (method.ts): the method is a skill of yours (Settings → Skills: Visuals, Blueprint,
// Storybook setup), and Concierge brings only the ask (which PR, which repository, where to save) and the format its
// pages read back (the manifest). The methods below are the ones used when a machine doesn't have the skill; the skills
// in the skill source say the same, and are yours to change. Nothing here is ever shown as a message of yours.

/** The id a repository's baseline is kept under, beside its PRs' captures (visuals/repo-<owner>-<repo>/<sha>). */
export const baselineId = (repo: string) => `repo:${repo}`

/** The methods, as Concierge has them built in: what each skill says when it isn't installed (`how` not given). */
export const METHODS = {
  // capture-visuals: a PR's screens, before and after
  capture: `First, the impact (read the after worktree's code, not guesses):
- Changed: each component, layout or screen the PR edits (its changed files that render something), by its exported name and file.
- Affected: every component, layout and screen that imports a changed one, directly or through others, up to three imports away (follow the imports, re-exports and barrel files included), each with which changed ones reach it ("via") and how far ("depth": 1 for a direct import). Kind: "screen" for a route's page, "layout" for a layout, shell or frame, else "component".

Then capture through both lenses:
- Changed, in focus: each changed component alone, its whole frame and nothing around it: its story, or on the running app the element itself (Playwright locator screenshot with 16px of padding), before and after, in each state the change touches.
- Affected, for context: the layouts and screens that show a changed component, whole, so its fit in the page shows (the most used first); affected components only when the change alters them visibly.
- Marks: on every affected shot, mark where each changed component sits (Playwright boundingBox of its element, as percent of the screenshot's width and height, on the side it is on); on a changed shot, mark the parts inside it that the change alters most, when there are some. Each mark names its part and says in a few words what changed there.

How:
- Make a worktree of the PR's branch (the after) and of its base (the before) in a scratch folder of your own (git worktree add, never your checkout's own branch), install what they need, and take them off when you are done.
- The repository has Storybook (a .storybook folder, or @storybook in a package.json): run its dev server in each worktree (one port each). With its components manifest on (features.componentsManifest), read http://localhost:<port>/manifests/components.json: each component's file, props, summary and stories with their ids. It maps the changed files to their components and stories, and its imports give the impact, without searching files. Capture the stories of the changed components, each state the change touches: screenshot each story's iframe page (/iframe.html?id=<story id>&viewMode=story, #storybook-root) with Playwright, at the viewports the story lists in parameters.capture.viewports, else the repo's viewport set's phone and laptop sizes (its .storybook/preview, named as the repo names them). Changed components without stories: write their stories with the storybook-stories skill in the after worktree only, never committed, run their tests (vitest --project=storybook) until they pass, and say in the summary which stories the PR should add.
- No Storybook: run the app (its dev server, the way its README or package.json says) and screenshot the screens it changes with Playwright at phone (375 wide) and laptop (1280 wide), logged out unless a seed or test account makes the screen meaningful. A screen that needs data you can't get: say so in its note, never fake it. Say in the summary that stories (the storybook-architecture skill) would make these captures exact.
- The same screens, the same viewports and the same state before and after. A screen that is new has no before; one that is gone has no after.
- Never push, commit to the PR, or open anything; this only looks.
- At most 30 shots: every changed component in focus first, then the affected layouts and screens that matter most.`,

  // set-up-storybook: a repository's Storybook, as a PR
  storybook: `1. Work in a new worktree on a branch \`storybook/setup\` off the up-to-date default branch (git worktree add, never your checkout's own branch).
2. Set Storybook up the way the storybook-architecture skill says: one per UI package (composed at the root when there are several), the layers, the shared decorators for every provider, one named viewport set, data mocked at the network, and the agent tooling: @storybook/addon-a11y, @storybook/addon-vitest, @storybook/addon-mcp and the components manifest (features.componentsManifest), so the next agents read the components from it and test through it.
3. Write stories the way the storybook-stories skill says: every component the app's screens are built from, primitives first, each as its state matrix composed from its parts' stories (a story per state a person meets, prop combinations in controls), each component, prop and story with its JSDoc @summary. Many components: cover every component of the main screens, and list the rest in the PR.
4. Write the docs the way the design-docs skill says: the foundations pages generated from the tokens, and a page for each primitive.
5. Prove it as the skills say, working the loop (run the tests, fix, run again): for each package storybook build succeeds, vitest --project=storybook passes with no a11y violation, and /manifests/components.json lists every component with its summary and props. Commit (conventional commits), push, and open the PR: title "Storybook: the design system, in stories"; its body says what each layer holds, how to add a story, and what is covered and what isn't yet.
6. The first shot: screenshot every story you wrote (#storybook-root of its iframe page, with Playwright) at the phone and laptop viewports (after-<story-id>-<viewport>.png; there is no before: this is the baseline). At most 80 of these shots: each component's default story at both viewports first, then its other states at laptop.
7. Then the map, as the draw-blueprint skill says.`,

  // draw-blueprint: the map of a project, its screens by domain and step
  blueprint: `The blueprint is a map of the project: every screen in small, a row per domain and a column per step or variation, each component marked wherever it shows.
1. Work on the Storybook's branch (\`storybook/setup\` until its PR is merged, then a branch off the default one), in a worktree, up to date.
2. The screens, as a storyline: for each domain of each app (an area a person would name: its navigation's entries, its route folders), a screen story for each step and state a person goes through there, in order (arriving with nothing, filled, in the middle of the main action, done, when it fails), with mocked data, the way the storybook-stories skill says. Keep the ones that exist; write the missing ones, at least three domains an app and two steps a domain where the app has them. Their tests pass (vitest --project=storybook). Commit (conventional commits) and push.
3. Build each package's Storybook (storybook build) into the capture's folder, under storybook/<package name>/ (static files, with its mockServiceWorker.js): the map shows the screens live from it.
4. Screenshot every screen story at the laptop viewport, the whole page (after-board-<story-id>.png), and the same again small (thumb-board-<story-id>.png, 480px wide: the same page at a device scale factor of 480 / the viewport's width).
5. Mark every component on every screen: one mark per component instance that shows (Playwright boundingBox of its root element, as percent of the screenshot; find each root by its role, test id or the element its story renders), nested ones included, 60 at most a screen. Every part a mark names is in the impact's changed list (add the ones that aren't).
6. Several apps: the domain carries the app when two share a name ("Buffehgi · Inbox"). Domains in the order of the app's navigation, a domain's screens in the order a person meets them: the map lays them out as rows and columns in that order.`,
}

// the formats: what the pages read back, the same whoever's method was followed
const SHOT = `{"name":"<Component or screen> · <state>","lens":"changed"|"affected","part":"<its name in the impact>","viewport":"<viewport name>","width":<viewport width>,"note":"<what to look at here>","before":"before-<name>-<viewport>.png","after":"after-<name>-<viewport>.png","marks":[{"x":<% from left>,"y":<% from top>,"w":<% wide>,"h":<% high>,"part":"<changed name>","label":"<what changed there>","side":"after"}]}`
const IMPACT = `"impact":{"changed":[{"name":"<Component>","file":"<path in the repo>","kind":"component"|"layout"|"screen"}],"affected":[{"name":"<Component>","file":"<path>","kind":"…","via":["<changed name>"],"depth":1}]}`
const SCREEN = `{"name":"<Domain> · <step or state>","lens":"affected","domain":"<Domain>","variant":"<step or state, a few words>","viewport":"laptop","width":<width>,"note":"<what a person does here>","after":"after-board-<story-id>.png","thumb":"thumb-board-<story-id>.png","book":"<package name>","story":"<story-id>","height":<page height in px>,"marks":[{"x":<% from left>,"y":<% from top>,"w":<% wide>,"h":<% high>,"part":"<Component, as named in the impact>"}]}`
const said = (x?: string) => (x ? `\n\nWhat I asked for: ${x}` : '')

/**
 * Set a repository's Storybook up (as a PR) and take its first shot and its map. `how`: your set-up-storybook and
 * draw-blueprint skills' words, when this machine has them.
 */
export function setupPrompt(p: { repo: string; dir: string; said?: string; how?: string; map?: string }): string {
  return `Give ${p.repo} a Storybook, as a pull request, then take its first shot and draw its map.${said(p.said)}

${p.how ?? METHODS.storybook}

The map:
${p.map ?? METHODS.blueprint}

Save everything into ${p.dir}/<the full sha of your last commit>/ (make it; file names in letters, digits, dots and dashes only), with manifest.json:
{"head":"<that sha>","at":"<now, ISO>","source":"storybook","summary":"<what the design system holds, in two or three sentences>","impact":{"changed":[{"name":"<Component>","file":"<path>","kind":"component"|"layout"|"screen"}],"affected":[]},"shots":[<one per story shot>, <one per screen of the map>]}
A story's shot: {"name":"<Component> · <story>","lens":"changed","part":"<Component>","viewport":"<viewport name>","width":<viewport width>,"note":"<the state it shows>","after":"after-<story-id>-<viewport>.png"}
A screen of the map: ${SCREEN}
The built Storybooks go in ${p.dir}/<that sha>/storybook/<package name>/.
End with the PR's address on its own line: PR <url>.`
}

/**
 * The map alone, for a baseline that has its Storybook and its components' shots (set up before the map, or drawn
 * again from the code as it is now). Into a new folder for the new commit, the earlier shots kept. `how`: your
 * draw-blueprint skill's words, when this machine has it.
 */
export function boardPrompt(p: { repo: string; dir: string; last?: string; said?: string; how?: string }): string {
  return `Draw the map of ${p.repo}: its baseline has its Storybook and its components' shots, and needs its screens.${said(p.said)}

${p.how ?? METHODS.blueprint}

Save into ${p.dir}/<the full sha of your last commit>/ (make it; file names in letters, digits, dots and dashes only): the built Storybooks under storybook/<package name>/, the screens' images, and manifest.json: ${p.last ? `the manifest of ${p.dir}/${p.last}/ as it is (copy its images too), its head and at made yours, its screens of an earlier map replaced, ` : 'the manifest as the baseline has it, '}with one shot per screen:
${SCREEN}
End with one short paragraph: the domains and how many screens each has.`
}

/** Show what a PR changes visually. `how`: your capture-visuals skill's words, when this machine has it. */
export function capturePrompt(p: { pr: { id: string; number: number; title: string; base: string; head: string; headSha: string }; out: string; files: string[]; said?: string; again?: boolean; how?: string }): string {
  if (p.again) return `${p.said ?? 'Capture again.'}

Capture again with that in mind, the same way as before, into ${p.out} (a new folder for the PR's current commit ${p.pr.headSha.slice(0, 7)}: write all of it there, the manifest included). End with one short paragraph on what changed visually.`
  return `Show what pull request #${p.pr.number} ("${p.pr.title}") changes visually, so a designer can judge it from screenshots alone, without opening it. The PR's branch \`${p.pr.head}\` (commit ${p.pr.headSha.slice(0, 7)}) is the after; its base \`${p.pr.base}\` is the before.
${p.files.length ? `The files it changes that people see: ${p.files.slice(0, 30).join(', ')}.` : 'Find from its diff which screens and components it changes.'}${said(p.said)}

${p.how ?? METHODS.capture}

Save into ${p.out} (make it): the images as PNG, named like before-<name>-<viewport>.png and after-<name>-<viewport>.png (letters, digits, dots and dashes only), and manifest.json with the impact and one shot per capture and viewport:
{"head":"${p.pr.headSha}","base":"<the base commit you used>","at":"<now, ISO>","source":"storybook" or "app","summary":"<two or three sentences: what changed visually>",
 ${IMPACT},
 "shots":[${SHOT}]}
End with the summary in one short paragraph.`
}
