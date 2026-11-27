// The design system stays in one place: components use the tokens (tokens.css), not Tailwind's raw palette or their own
// colours. What is left of the old markup is counted here, and the count only goes down: lower LEFT when you clean some.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const LEFT = 98
const src = new URL('..', import.meta.url).pathname
const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx$/.test(f) && !f.startsWith('dev/'))
const RAW = /\b(?:bg|text|ring|border|divide|from|to|via|fill|stroke|outline|decoration)-(?:zinc|gray|slate|neutral|stone|violet|indigo|purple|amber|orange|yellow|emerald|green|teal|sky|blue|cyan|red|rose|pink|fuchsia|lime)-\d+/g

test('components colour themselves with the design tokens, not the raw palette', () => {
  const found = files.flatMap((f) => (readFileSync(join(src, f), 'utf8').match(RAW) ?? []).map((c) => `${f}: ${c}`))
  assert.ok(found.length <= LEFT, `${found.length} raw palette classes (at most ${LEFT}). Use a token from src/design/tokens.css instead, e.g. text-fg-3, bg-fill, text-ok-text, bg-accent/10. New ones:\n${found.slice(0, 12).join('\n')}`)
})

test('a screen takes its buttons from the recipes (btn-*), not from a look of its own', () => {
  // a named button look (const primary / quiet / ghost / secondary / mini = '…') is a recipe plus layout, nothing else
  const own = files.flatMap((f) => [...readFileSync(join(src, f), 'utf8').matchAll(/const (primary|quiet|ghost|secondary|mini|primaryBtn) = '([^']*)'/g)]
    .filter((m) => !/\bbtn-(primary|quiet|outline|ghost)\b/.test(m[2])).map((m) => `${f}: ${m[1]}`))
  assert.deepEqual(own, [], 'Use btn-primary, btn-quiet, btn-outline or btn-ghost from src/design/recipes.css')
})

test('no React hook after an early return in the stack card (it crashes the page when the number of waiting PRs changes)', async () => {
  const { readFileSync } = await import('node:fs')
  const s = readFileSync(new URL('../thread/StackNext.tsx', import.meta.url), 'utf8')
  const after = s.slice(s.indexOf('if (waiting.length < 2) return'), s.indexOf('function Flags('))
  assert.deepEqual(after.match(/\buse(?:State|Effect|Query|Queries|Memo|Callback|Ref|Arm|Api)\(/g) ?? [], [])
})

test('a page of Settings is named through copy.ts (inSettings), so a renamed page leaves no old words behind', () => {
  const all = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !f.startsWith('dev/') && !/\.test\.ts$/.test(f) && f !== 'copy.ts')
  const said = all.flatMap((f) => readFileSync(join(src, f), 'utf8').split('\n')
    .filter((l) => /(?<!Developer |→ )Settings (→|›) /.test(l.replace(/\/\/.*$/, '').replace(/\/\*.*$/, '')) && !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => `${f}: ${l.trim().slice(0, 90)}`))
  assert.deepEqual(said, [], "Write inSettings('repos') (src/copy.ts) instead of the page's name")
})

// What still goes around the tokens, counted: each number only goes down (lower it when you clean some), so the scale
// of sizes, corners and shadows in tokens.css stays the whole scale, and buttons come from the recipes.
const count = (rx: RegExp) => files.reduce((n, f) => n + (readFileSync(join(src, f), 'utf8').match(rx) ?? []).length, 0)
for (const [what, rx, most, use] of [
  ['text sizes off the scale', /(?<![\w-])text-(?:\[\d[\d.]*px\]|xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g, 4, 'text-micro, -meta, -small, -body, -reading, -title or -display'],
  ['corners off the scale', /(?<![\w-])rounded(?:-(?:[trbl]|tl|tr|bl|br))?-(?:sm|md|lg|xl|2xl|3xl|\[[^\]]+\])(?![\w-])/g, 26, 'rounded-chip, -ctl, -card or -panel'],
  ['shadows off the scale', /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl|\[[^\]]+\])(?![\w-])/g, 79, 'shadow-e1, -e2 or -e3'],
] as const) {
  test(`${what}: no more than there are`, () => {
    const n = count(rx)
    assert.ok(n <= most, `${n} ${what} (at most ${most}). Use ${use} (src/design/tokens.css).`)
  })
}

test('buttons with a look of their own: no more than there are', () => {
  const MOST = 558
  const own = files.reduce((n, f) => n + [...readFileSync(join(src, f), 'utf8').matchAll(/<button\b[^>]*>/g)].filter((m) => !/\bbtn-(primary|quiet|outline|ghost)\b/.test(m[0])).length, 0)
  assert.ok(own <= MOST, `${own} buttons styled by hand (at most ${MOST}). Use btn-primary, btn-outline, btn-quiet or btn-ghost (src/design/recipes.css).`)
})
