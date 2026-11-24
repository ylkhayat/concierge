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

/** One screen: its name, what the agent says about it, and the before and after images (file names in its folder). */
export type Shot = { name: string; note?: string; before?: string; after?: string; width?: number }
export type Manifest = { head: string; base?: string; at: string; source: 'storybook' | 'app'; summary?: string; shots: Shot[] }
export type VisualSet = Manifest & { sha: string }

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
    const shots = m.shots.filter((s) => s && typeof s.name === 'string').slice(0, 40).map((s) => ({ name: String(s.name).slice(0, 120), note: s.note ? String(s.note).slice(0, 400) : undefined, before: safeFile(s.before), after: safeFile(s.after), width: Number(s.width) || undefined }))
    out.push({ ...m, sha, source: m.source === 'storybook' ? 'storybook' : 'app', summary: m.summary ? String(m.summary).slice(0, 2000) : undefined, shots })
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

How:
- The repository has Storybook (a .storybook folder, or @storybook in a package.json): capture the stories of the components it changes (build Storybook, or run it, and screenshot each story's iframe page with Playwright). Changed components without a story: write a small story for them in the after worktree only, never committed.
- No Storybook: run the app (its dev server, the way its README or package.json says) and screenshot the screens it changes with Playwright, logged out unless a seed or test account makes the screen meaningful. A screen that needs data you can't get: say so in its note, never fake it.
- The same screens, the same viewport (1280x800 unless the change is about another width) and the same state before and after. A screen that is new has no before; one that is gone has no after.
- Never push, commit to the PR, or open anything; this only looks.
${p.said ? `\nWhat I asked for: ${p.said}\n` : ''}
Save into ${p.out} (make it): the images as PNG, named like before-<screen>.png and after-<screen>.png (letters, digits, dots and dashes only), and manifest.json:
{"head":"${p.pr.headSha}","base":"<the base commit you used>","at":"<now, ISO>","source":"storybook" or "app","summary":"<two or three sentences: what changed visually>","shots":[{"name":"<screen>","note":"<what to look at here>","before":"before-<screen>.png","after":"after-<screen>.png"}]}
At most 12 screens: the ones that matter most. End with the summary in one short paragraph.`
}
