// Design's Tokens view: a project's design tokens as its built Storybook ships them. Each app's CSS custom properties on
// its root (:root, :host, html) and on its themes ([data-theme=…], .dark, .light), read from the stylesheets of the
// Storybook built beside the baseline (visuals/repo-<owner>-<repo>/<sha>/storybook/<app>/). What a token is (a colour,
// a type size, a radius…) is read from its name, the way Tailwind and most design systems name them, else its value.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TokenKind = 'color' | 'font' | 'text' | 'weight' | 'leading' | 'tracking' | 'spacing' | 'radius' | 'shadow' | 'size' | 'motion' | 'other'
export type Token = {
  name: string
  kind: TokenKind
  values: Record<string, string> // theme → value ('default' for the root's own)
  rgb?: boolean // its value is bare channels ("22 19 16"), used as rgb(var(--x))
  hsl?: boolean // bare hsl channels ("210 40% 98%"), used as hsl(var(--x))
  uses: number // how many times the stylesheets read it
  at?: Record<string, { sel: string; wrap: string[] }> // theme → the selector that sets it and the at-rules around it (@layer, @media): where a preview overrides it
}
export type TokenBook = { book: string; themes: string[]; tokens: Token[] }

const ROOT = /^(:root|:host|html|body)$/
/** Which theme a selector of a root block names: 'default' for the root itself, else the theme's name; none for a component's own. */
export function themeOf(sel: string): string | undefined {
  const s = sel.trim().replace(/\s+/g, ' ')
  if (ROOT.test(s)) return 'default'
  const attr = /\[data-(?:theme|mode|color-scheme)=["']?([\w-]+)["']?\]/.exec(s)?.[1]
  if (attr && /^(:root|html|body)?\s*\[data-[\w-]+=[^\]]+\]$/.test(s)) return attr
  const cls = /^(?::root|html|body)?\.(dark|light|[\w-]*theme[\w-]*)$/.exec(s)?.[1]
  if (cls) return cls
  if (/^@media \(prefers-color-scheme: ?dark\) :root$/.test(s)) return 'dark'
  return undefined
}

const COLOR_FN = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix|light-dark)\(.*\))$/i
const RGB = /^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?(\s*\/\s*[\d.]+%?)?$/
const HSL = /^\d{1,3}(\.\d+)?(deg)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/
export function kindOf(name: string, value: string): Pick<Token, 'kind' | 'rgb' | 'hsl'> {
  const n = name.slice(2), v = value.trim()
  if (/^font-weight/.test(n)) return { kind: 'weight' }
  if (/^(font|default-font|default-mono-font)/.test(n)) return { kind: 'font' }
  if (/^text-/.test(n)) return { kind: 'text' }
  if (/^leading/.test(n)) return { kind: 'leading' }
  if (/^tracking/.test(n)) return { kind: 'tracking' }
  if (/^(spacing|space|gap)/.test(n)) return { kind: 'spacing' }
  if (/^(radius|rounded)/.test(n)) return { kind: 'radius' }
  if (/^(shadow|drop-shadow|inset-shadow|elevation|e\d)/.test(n)) return { kind: 'shadow' }
  if (/^(container|breakpoint|width|max-w|size)/.test(n)) return { kind: 'size' }
  if (/^(ease|animate|duration|default-transition|transition)/.test(n)) return { kind: 'motion' }
  if (RGB.test(v)) return { kind: 'color', rgb: true }
  if (HSL.test(v)) return { kind: 'color', hsl: true }
  if (/^color-/.test(n) || COLOR_FN.test(v)) return { kind: 'color' }
  return { kind: 'other' }
}

/**
 * The tokens of one app's stylesheets: every custom property set on its root or a theme, in the order first set, with
 * each theme's value. Tailwind's own plumbing (--tw-*), Storybook's (--sb-*) and a size's companion (--text-xs--line-height)
 * are not tokens. A theme whose every value is the root's own (":root, [data-theme=light]") is the root, not a column.
 */
export function tokensOf(css: string): Omit<TokenBook, 'book'> {
  const byName = new Map<string, Token>(), themes: string[] = []
  // each block with what it sits in (@layer, @media), by braces: a rule's selector is the text since the last `;`
  const stack: string[] = []
  let buf = ''
  const take = (sel: string, decls: string) => {
    if (!decls.includes('--')) return
    const dark = stack.some((x) => /^@media\b.*prefers-color-scheme:\s*dark/.test(x))
    const wrap = stack.filter((x) => x.startsWith('@'))
    const named = sel.split(',').map((s) => ({ sel: s.trim(), th: themeOf(dark && ROOT.test(s.trim()) ? `@media (prefers-color-scheme: dark) ${s.trim()}` : s) })).filter((x): x is { sel: string; th: string } => !!x.th)
    const names = [...new Set(named.map((x) => x.th))]
    for (const d of decls.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
      const name = d[1], value = d[2].trim()
      if (!names.length || /^--(tw|sb)-/.test(name) || /^--[\w-]+--/.test(name) || !value) continue
      let t = byName.get(name)
      if (!t) { t = { name, values: {}, uses: 0, ...kindOf(name, value) }; byName.set(name, t) }
      for (const th of names) { t.values[th] = value; (t.at ??= {})[th] = { sel: named.find((x) => x.th === th)!.sel, wrap }; if (!themes.includes(th)) themes.push(th) }
    }
  }
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') { stack.push(buf.slice(buf.lastIndexOf(';') + 1).trim()); buf = '' }
    else if (ch === '}') { const sel = stack.pop(); if (sel !== undefined) take(sel, buf); buf = '' }
    else buf += ch
  }
  for (const t of byName.values()) t.uses = css.split(`var(${t.name}`).length - 1
  // a theme that only repeats the root is the root
  const shown = themes.filter((th) => th === 'default' || [...byName.values()].some((t) => th in t.values && t.values[th] !== t.values.default))
  for (const t of byName.values()) for (const th of Object.keys(t.values)) if (!shown.includes(th)) { delete t.values[th]; delete t.at?.[th] }
  const order = ['default', 'light', 'dark']
  shown.sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9))
  return { themes: shown, tokens: [...byName.values()].filter((t) => Object.keys(t.values).length) }
}

/** Each app's tokens in a repository's latest baseline (its built Storybook), with the commit they were read at. */
export async function tokensFor(repo: string): Promise<{ sha?: string; books: TokenBook[] }> {
  const { setsOf, slugOf, baselineId, VISUALS_DIR } = await import('./visuals.ts') // the rest of this file is pure (the preview reads it alone)
  const set = (await setsOf(baselineId(repo)).catch(() => []))[0]
  if (!set) return { books: [] }
  return { sha: set.sha, books: await booksIn(join(VISUALS_DIR, slugOf(baselineId(repo)), set.sha, 'storybook')) }
}
/** Each app's tokens in a folder of built Storybooks (one folder an app). */
export async function booksIn(root: string): Promise<TokenBook[]> {
  const books: TokenBook[] = []
  for (const book of (await readdir(root).catch(() => [] as string[])).sort()) {
    if (!/^[\w.-]+$/.test(book) || book.startsWith('.')) continue
    const dir = join(root, book)
    const css: string[] = []
    for (const f of await readdir(join(dir, 'assets')).catch(() => [] as string[])) if (f.endsWith('.css')) css.push(await readFile(join(dir, 'assets', f), 'utf8').catch(() => ''))
    const html = await readFile(join(dir, 'iframe.html'), 'utf8').catch(() => '')
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css.push(m[1])
    if (!css.length) continue
    const t = tokensOf(css.join('\n'))
    if (t.tokens.length) books.push({ book, ...t })
  }
  return books
}
