import assert from 'node:assert/strict'
import { test } from 'node:test'
import { takeRecent } from './recent.ts'

test('recent units come out newest first, a stack whole, the rest keep their order', () => {
  const all = [['a'], ['b1', 'b2'], ['c'], ['d']]
  const { recent, rest } = takeRecent(all, (x) => x, new Map([['c', 10], ['b2', 20]]))
  assert.deepEqual(recent, [['b1', 'b2'], ['c']])
  assert.deepEqual(rest, [['a'], ['d']])
})
