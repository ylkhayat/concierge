import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kindOf, themeOf, tokensOf } from './tokens.ts'

test('themes: the root, a data-theme, a dark class; a component is none', () => {
  assert.equal(themeOf(':root'), 'default')
  assert.equal(themeOf('[data-theme=dark]'), 'dark')
  assert.equal(themeOf(':root[data-theme="light"]'), 'light')
  assert.equal(themeOf('.dark'), 'dark')
  assert.equal(themeOf('.card'), undefined)
})

test('kinds: from the name first, else the value', () => {
  assert.equal(kindOf('--text-sm', '.875rem').kind, 'text')
  assert.equal(kindOf('--font-weight-medium', '500').kind, 'weight')
  assert.deepEqual(kindOf('--bg', '22 19 16'), { kind: 'color', rgb: true })
  assert.deepEqual(kindOf('--background', '210 40% 98%'), { kind: 'color', hsl: true })
  assert.equal(kindOf('--brand', 'oklch(0.6 0.1 30)').kind, 'color')
  assert.equal(kindOf('--line-stride', '44px').kind, 'other')
})

test('a stylesheet: root and themes per token, plumbing left out, uses counted, a repeating theme folded', () => {
  const css = `@layer theme{:root,:host{--font-sans:ui-sans-serif;--text-xs:.75rem;--text-xs--line-height:1.3;--radius-md:.375rem}}
*,:before{--tw-border-style:solid}
:root,[data-theme=light]{--bg:246 243 237;--accent:166 41 63}
[data-theme=dark]{--bg:24 17 20;--accent:233 134 154}
.card{--card-pad:12px}
@media (prefers-color-scheme: dark){:root{--ink:#eee}}
.a{background:rgb(var(--bg));color:rgb(var(--accent))}.b{border-color:rgb(var(--bg) / .5)}`
  const t = tokensOf(css)
  assert.deepEqual(t.themes, ['default', 'dark'])
  const by = Object.fromEntries(t.tokens.map((x) => [x.name, x]))
  assert.deepEqual(Object.keys(by).sort(), ['--accent', '--bg', '--font-sans', '--ink', '--radius-md', '--text-xs'])
  assert.deepEqual(by['--bg'].values, { default: '246 243 237', dark: '24 17 20' })
  assert.equal(by['--bg'].uses, 2)
  assert.deepEqual(by['--ink'].values, { dark: '#eee' })
  assert.equal(by['--radius-md'].kind, 'radius')
  // where each is set, for a preview to set it again in the same place
  assert.deepEqual(by['--bg'].at, { default: { sel: ':root', wrap: [] }, dark: { sel: '[data-theme=dark]', wrap: [] } })
  assert.deepEqual(by['--text-xs'].at?.default, { sel: ':root', wrap: ['@layer theme'] })
  assert.deepEqual(by['--ink'].at, { dark: { sel: ':root', wrap: ['@media (prefers-color-scheme: dark)'] } })
})
