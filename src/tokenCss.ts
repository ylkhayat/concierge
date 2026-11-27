// The Tokens view's preview: a draft's changes as a stylesheet a screen takes last, so it shows the screen with them.
import type { Token } from '../server/tokens.ts'

export type Change = { book: string; name: string; theme: string; value: string }

/**
 * The CSS that sets each changed token again where the app sets it (its selector, inside its @layer or @media), after
 * the app's own rules, so it wins by order. A changed root value would also win over a theme's (same weight, later), so
 * each theme the token has is set again after it, with its own value or its own change.
 */
export function draftCss(tokens: Token[], changes: Change[]): string {
  const by = new Map(tokens.map((t) => [t.name, t]))
  const blocks = new Map<string, { sel: string; wrap: string[]; decls: string[]; late: boolean }>()
  const put = (theme: string, name: string, value: string) => {
    const at = by.get(name)?.at?.[theme] ?? (theme === 'default' ? { sel: ':root', wrap: [] } : { sel: `[data-theme="${theme}"]`, wrap: [] })
    const k = `${at.wrap.join('|')}|${at.sel}`
    const b = blocks.get(k) ?? { ...at, decls: [], late: theme !== 'default' }
    if (!b.decls.some((d) => d.startsWith(`${name}:`))) b.decls.push(`${name}:${value}`)
    blocks.set(k, b)
  }
  const mine = (name: string, theme: string) => changes.find((c) => c.name === name && c.theme === theme)
  for (const c of changes.filter((c) => c.theme === 'default')) put('default', c.name, c.value)
  for (const c of changes.filter((c) => c.theme !== 'default')) put(c.theme, c.name, c.value)
  for (const c of changes.filter((c) => c.theme === 'default')) {
    for (const [th, v] of Object.entries(by.get(c.name)?.values ?? {})) if (th !== 'default' && !mine(c.name, th)) put(th, c.name, v)
  }
  return [...blocks.values()].sort((a, b) => Number(a.late) - Number(b.late))
    .map((b) => b.wrap.reduceRight((inner, w) => `${w}{${inner}}`, `${b.sel}{${b.decls.join(';')}}`)).join('\n')
}

/** A token's value with a draft's changes: what the sheet draws. */
export const valueWith = (t: Token, theme: string, changes: Change[]) => changes.find((c) => c.name === t.name && c.theme === theme)?.value ?? t.values[theme]
