import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linearMd } from './linearMd.ts'

test('Linear markdown: bold ending in a space, and pipes inside code in a table cell', () => {
  assert.equal(linearMd('**Issue: **[X](<https://a>)'), '**Issue:** [X](<https://a>)')
  assert.equal(linearMd('| Auth0 ID | `waad|qiAs` |'), '| Auth0 ID | `waad\\|qiAs` |')
  assert.equal(linearMd('a `x|y` outside a table'), 'a `x|y` outside a table')
  assert.equal(linearMd('**fine** and **also fine**'), '**fine** and **also fine**')
})

test('titleParts and chainsOf read a PR stack', async () => {
  const { titleParts, chainsOf } = await import('./stack.ts')
  assert.deepEqual(titleParts('feat(web-app): AC-1064 set the daily call time'), { type: 'feat', scope: 'web-app', text: 'set the daily call time' })
  assert.deepEqual(titleParts('plain title'), { text: 'plain title' })
  const p = (n: number, base: string, head: string) => ({ number: n, base, head, url: `u${n}`, repo: 'r' }) as never
  assert.deepEqual(chainsOf([p(1, 'main', 'a'), p(2, 'a', 'b'), p(3, 'main', 'c')]).map((c: { number: number }[]) => c.map((x) => x.number)), [[1, 2], [3]])
})

test('chaptersOf: each run a chapter, nothing lost, the outcome kept', async () => {
  const { chaptersOf } = await import('./chapters.ts')
  const a = (kind: string, text: string, at = '2026-10-19T09:00:00Z') => ({ kind, text, at }) as never
  const ch = chaptersOf([a('event', 'pushed'), a('section', 'Review'), a('tool', 'git'), a('result', 'done'), a('section', 'Revise'), a('error', 'boom')])
  assert.deepEqual(ch.map((c: { head?: { text: string }; items: unknown[]; outcome?: { kind: string } }) => [c.head?.text ?? '-', c.items.length, c.outcome?.kind ?? '-']),
    [['Earlier', 1, '-'], ['Review', 2, 'result'], ['Revise', 1, 'error']])
})

test('time: date-fns based labels', async () => {
  const { ago, short, duration } = await import('./time.ts')
  const now = Date.parse('2026-10-19T12:00:00Z')
  assert.equal(ago('2026-10-19T11:59:40Z', now), 'just now')
  assert.equal(ago('2026-10-19T11:57:00Z', now), '3 minutes ago')
  assert.equal(ago('2026-10-17T12:00:00Z', now), '2 days ago')
  assert.equal(short('2026-10-19T10:00:00Z', now), '2h')
  assert.equal(duration('2026-10-19T11:00:00Z', '2026-10-19T11:03:05Z'), '3m 05s')
  assert.equal(duration('2026-10-19T09:00:00Z', '2026-10-19T10:12:00Z'), '1h 12m')
})

test('chaptersOf shows the final message once', async () => {
  const { chaptersOf } = await import('./chapters.ts')
  const a = (kind: string, text: string) => ({ kind, text, at: '2026-10-19T09:00:00Z' }) as never
  const [ch] = chaptersOf([a('section', 'Push'), a('text', 'I published nothing, because there is…'), a('result', 'I published nothing, because there is still nothing fixed.\n\n- Code: …')])
  assert.deepEqual(ch.items.map((x: { kind: string }) => x.kind), ['result'])
})
