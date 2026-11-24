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
export type Shot = { name: string; note?: string; before?: string; after?: string; width?: number; lens?: 'changed' | 'affected'; part?: string; viewport?: string }
export type Manifest = { head: string; base?: string; at: string; source: 'storybook' | 'app'; summary?: string; impact?: Impact; shots: Shot[] }
export type VisualSet = Manifest & { sha: string }

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
    const shots: Shot[] = m.shots.filter((s) => s && typeof s.name === 'string').slice(0, 60).map((s) => ({
      name: String(s.name).slice(0, 120), note: s.note ? String(s.note).slice(0, 400) : undefined, before: safeFile(s.before), after: safeFile(s.after), width: Number(s.width) || undefined,
      lens: s.lens === 'changed' || s.lens === 'affected' ? s.lens : undefined, part: s.part ? String(s.part).slice(0, 80) : undefined, viewport: s.viewport ? String(s.viewport).slice(0, 20) : undefined,
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
export const hasSet = (prId: string, sha: string) => existsSync(join(shotsDir(prId, sha), 'manifest.json'))

// --- what the agent is asked ------------------------------------------------------------------------------------------
export function capturePrompt(p: { pr: { id: string; number: number; title: string; base: string; head: string; headSha: string }; out: string; files: string[]; said?: string; again?: boolean }): string {
  if (p.again) return `${p.said ?? 'Capture again.'}

Capture again with that in mind, the same way as before, into ${p.out} (a new folder for the PR's current commit ${p.pr.headSha.slice(0, 7)}: write all of it there, the manifest included). End with one short paragraph on what changed visually.`
  return `Show what pull request #${p.pr.number} ("${p.pr.title}") changes visually, so a designer can judge it from screenshots alone, without opening it.

Where: the PR's branch \`${p.pr.head}\` (commit ${p.pr.headSha.slice(0, 7)}) is the after; its base \`${p.pr.base}\` is the before. Make a worktree of each in a scratch folder of your own (git worktree add, never your checkout's own branch), install what they need, and take them off when you are done.
${p.files.length ? `The files it changes that people see: ${p.files.slice(0, 30).join(', ')}.` : 'Find from its diff which screens and components it changes.'}

First, the impact (read the after worktree's code, not guesses):
- Changed: each component, layout or screen the PR edits (its changed files that render something), by its exported name and file.
- Affected: every component, layout and screen that imports a changed one, directly or through others, up to three imports away (follow the imports, re-exports and barrel files included), each with which changed ones reach it ("via") and how far ("depth": 1 for a direct import). Kind: "screen" for a route's page, "layout" for a layout, shell or frame, else "component".

Then capture through both lenses:
- Changed, in focus: each changed component alone, its whole frame and nothing around it: its story, or on the running app the element itself (Playwright locator screenshot with 16px of padding), before and after, in each state the change touches.
- Affected, for context: the layouts and screens that show a changed component, whole, so its fit in the page shows (the most used first); affected components only when the change alters them visibly.

How:
- The repository has Storybook (a .storybook folder, or @storybook in a package.json): capture the stories of the components it changes, each state the change touches. Build Storybook in each worktree and screenshot each story's iframe page (#storybook-root) with Playwright, at the viewports the story lists in parameters.capture.viewports, else the repo's viewport set's phone and laptop sizes (its .storybook/preview, named as the repo names them). Changed components without stories: write their state matrix with the storybook-stories skill in the after worktree only, never committed, and say in the summary which stories the PR should add.
- No Storybook: run the app (its dev server, the way its README or package.json says) and screenshot the screens it changes with Playwright at phone (375 wide) and laptop (1280 wide), logged out unless a seed or test account makes the screen meaningful. A screen that needs data you can't get: say so in its note, never fake it. Say in the summary that stories (the storybook-architecture skill) would make these captures exact.
- The same screens, the same viewports and the same state before and after. A screen that is new has no before; one that is gone has no after.
- Never push, commit to the PR, or open anything; this only looks.
${p.said ? `\nWhat I asked for: ${p.said}\n` : ''}
Save into ${p.out} (make it): the images as PNG, named like before-<name>-<viewport>.png and after-<name>-<viewport>.png (letters, digits, dots and dashes only), and manifest.json with the impact and one shot per capture and viewport:
{"head":"${p.pr.headSha}","base":"<the base commit you used>","at":"<now, ISO>","source":"storybook" or "app","summary":"<two or three sentences: what changed visually>",
 "impact":{"changed":[{"name":"<Component>","file":"<path in the repo>","kind":"component"|"layout"|"screen"}],"affected":[{"name":"<Component>","file":"<path>","kind":"…","via":["<changed name>"],"depth":1}]},
 "shots":[{"name":"<Component or screen> · <state>","lens":"changed"|"affected","part":"<its name in the impact>","viewport":"<viewport name>","width":<viewport width>,"note":"<what to look at here>","before":"before-<name>-<viewport>.png","after":"after-<name>-<viewport>.png"}]}
At most 30 shots: every changed component in focus first, then the affected layouts and screens that matter most. End with the summary in one short paragraph.`
}
