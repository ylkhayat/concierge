import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Lru } from './lru.ts'

test('it keeps the entries used last and drops the one used longest ago', () => {
  const c = new Lru<string, number>(3)
  c.set('a', 1).set('b', 2).set('c', 3)
  assert.equal(c.get('a'), 1) // a is the newest now
  c.set('d', 4)               // b goes
  assert.deepEqual([...c.keys()], ['c', 'a', 'd'])
  assert.equal(c.get('b'), undefined)
  c.set('c', 30)              // set again: the newest, not a second entry
  assert.deepEqual([...c], [['a', 1], ['d', 4], ['c', 30]])
})
