import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selfPatch } from './scope.ts'

test("this machine's view drops what isn't here, from the items and the order, and remembers it", () => {
  const hidden = new Set<string>(), away = new Set(['o/away'])
  const out = JSON.parse(selfPatch(JSON.stringify({ set: [{ id: 'a', repo: 'o/here' }, { id: 'b', repo: 'o/away' }], del: [], order: ['a', 'b', 'c'] }), away, hidden))
  assert.deepEqual(out.set.map((x: { id: string }) => x.id), ['a'])
  assert.deepEqual(out.order, ['a', 'c']) // c never seen with a repository: shown
  const next = JSON.parse(selfPatch(JSON.stringify({ set: [], del: [], order: ['b', 'a'] }), away, hidden))
  assert.deepEqual(next.order, ['a']) // b stays hidden from the earlier patch
})
