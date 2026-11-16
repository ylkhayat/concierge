// The design system stays in one place: components use the tokens (tokens.css), not Tailwind's raw palette or their own
// colours. What is left of the old markup is counted here, and the count only goes down: lower LEFT when you clean some.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const LEFT = 108
const src = new URL('..', import.meta.url).pathname
const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx$/.test(f) && !f.startsWith('dev/'))
const RAW = /\b(?:bg|text|ring|border|divide|from|to|via|fill|stroke|outline|decoration)-(?:zinc|gray|slate|neutral|stone|violet|indigo|purple|amber|orange|yellow|emerald|green|teal|sky|blue|cyan|red|rose|pink|fuchsia|lime)-\d+/g

test('components colour themselves with the design tokens, not the raw palette', () => {
  const found = files.flatMap((f) => (readFileSync(join(src, f), 'utf8').match(RAW) ?? []).map((c) => `${f}: ${c}`))
  assert.ok(found.length <= LEFT, `${found.length} raw palette classes (at most ${LEFT}). Use a token from src/design/tokens.css instead, e.g. text-fg-3, bg-fill, text-ok-text, bg-accent/10. New ones:\n${found.slice(0, 12).join('\n')}`)
})
