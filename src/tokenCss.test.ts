import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokensOf } from '../server/tokens.ts'
import { draftCss } from './tokenCss.ts'

const { tokens } = tokensOf(`@layer theme{:root{--radius:4px}}
:root{--bg:246 243 237;--ink:#111}
[data-theme=dark]{--bg:24 17 20}`)

test('a change is set again where the app sets it, inside its layer', () => {
  assert.equal(draftCss(tokens, [{ book: 'a', name: '--radius', theme: 'default', value: '12px' }]), '@layer theme{:root{--radius:12px}}')
})

test('a root change keeps each theme its own value, set after it', () => {
  assert.equal(draftCss(tokens, [{ book: 'a', name: '--bg', theme: 'default', value: '255 255 255' }]),
    ':root{--bg:255 255 255}\n[data-theme=dark]{--bg:24 17 20}')
  assert.equal(draftCss(tokens, [{ book: 'a', name: '--bg', theme: 'default', value: '1 1 1' }, { book: 'a', name: '--bg', theme: 'dark', value: '2 2 2' }]),
    ':root{--bg:1 1 1}\n[data-theme=dark]{--bg:2 2 2}')
})
