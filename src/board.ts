// The blueprint board's arithmetic (components/DesignWorkspace.tsx): kept apart from the page so it is tested alone.
import type { Mark, Part, Shot } from '../server/visuals.ts'

/**
 * The component under a point of a screen (in percent of it): the smallest one there, so a component inside another
 * wins. One pass over the screen's marks per pointer move: the board has no element per component to ask.
 */
export function partAt(marks: Mark[], x: number, y: number): string | undefined {
  let best: Mark | undefined
  for (const m of marks) if (m.part && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h && (!best || m.w * m.h < best.w * best.h)) best = m
  return best?.part
}

// --- which application a component or a screen belongs to ------------------------------------------------------------
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** A component's name as people read it, without the application the agent added to tell two of a name apart. */
export const bare = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '')
/**
 * The application a component is part of: the one its name carries ("Pager (Rumanna)"), else the app folder its file
 * is in (apps/<app>/…, packages/<app>/…), else none (a repository of one app).
 */
export function appOfPart(name: string, file?: string): string | undefined {
  const named = /\(([^)]+)\)\s*$/.exec(name)?.[1]
  if (named) return cap(named.trim())
  const dir = file && /(?:^|\/)(?:apps|packages)\/([\w.-]+)\//.exec(file)?.[1]
  return dir ? cap(dir) : undefined
}
/** The application a screen belongs to: its Storybook's package, else the application most of its components are of. */
export function appOfScreen(sh: Shot, partApp: (name: string) => string | undefined): string | undefined {
  if (sh.book) return cap(sh.book)
  const count = new Map<string, number>()
  for (const m of sh.marks ?? []) { const a = m.part && partApp(m.part); if (a) count.set(a, (count.get(a) ?? 0) + 1) }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export type Row = { name: string; screens: Shot[] }
/** The board's rows, grouped by application in the order the capture gave them: each application, its domains, each domain's screens. */
export function layout(screens: Shot[], parts: Part[]): { app?: string; domains: Row[] }[] {
  const file = new Map(parts.map((p) => [p.name, p.file]))
  const partApp = (n: string) => appOfPart(n, file.get(n))
  const groups: { app?: string; domains: Row[] }[] = []
  for (const sh of screens) {
    const app = appOfScreen(sh, partApp)
    // "Buffehgi · Inbox" under Buffehgi reads "Inbox"
    const name = app && sh.domain!.toLowerCase().startsWith(app.toLowerCase()) ? sh.domain!.slice(app.length).replace(/^\s*[·:—-]\s*/, '') || sh.domain! : sh.domain!
    let g = groups.find((x) => x.app === app)
    if (!g) groups.push((g = { app, domains: [] }))
    let d = g.domains.find((x) => x.name === name)
    if (!d) g.domains.push((d = { name, screens: [] }))
    d.screens.push(sh)
  }
  return groups
}

/** The components grouped by application, each group most used first; components of no application last. */
export function byApp(names: string[], parts: Part[], uses: (n: string) => number): { app?: string; names: string[] }[] {
  const file = new Map(parts.map((p) => [p.name, p.file]))
  const out = new Map<string | undefined, string[]>()
  for (const n of names) { const a = appOfPart(n, file.get(n)); out.set(a, [...(out.get(a) ?? []), n]) }
  return [...out].sort((a, b) => (a[0] === undefined ? 1 : b[0] === undefined ? -1 : a[0].localeCompare(b[0])))
    .map(([app, ns]) => ({ app, names: ns.sort((x, y) => uses(y) - uses(x) || bare(x).localeCompare(bare(y))) }))
}

/**
 * The transform that brings a component of an enlarged screen to the middle of the view, filling about three
 * quarters of it, never smaller than the whole screen and never more than 4 times larger. Applied to the screen with
 * its origin at its top left: translate(tx%, ty%) scale(s), the shift kept so the screen always covers the view.
 */
export function focusOn(m: Pick<Mark, 'x' | 'y' | 'w' | 'h'>): { s: number; tx: number; ty: number } {
  const s = Math.min(4, Math.max(1, Math.min(75 / Math.max(m.w, 1), 75 / Math.max(m.h, 1))))
  const clamp = (t: number) => Math.min(0, Math.max(100 - 100 * s, t))
  return { s, tx: clamp(50 - (m.x + m.w / 2) * s), ty: clamp(50 - (m.y + m.h / 2) * s) }
}
