import assert from 'node:assert/strict'
import test from 'node:test'
import { move, noStacks, oneStack, shapeOf, shift, stacksOf } from './stackEdit.ts'

test('the plan becomes lanes and tickets on their own, and back', () => {
  const s = shapeOf([['A', 'B'], ['C'], ['D']])
  assert.deepEqual(s, { lanes: [['A', 'B']], alone: ['C', 'D'] })
  assert.deepEqual(stacksOf(s), [['A', 'B'], ['C'], ['D']])
})

test('moving a ticket onto a lane puts it on top; out of a lane of two leaves the other on its own', () => {
  let s = shapeOf([['A', 'B'], ['C']])
  s = move(s, 'C', 0)
  assert.deepEqual(s, { lanes: [['A', 'B', 'C']], alone: [] })
  s = move(noStacks(['A', 'B']), 'A', 'new')
  assert.deepEqual(s, { lanes: [['A']], alone: ['B'] }) // a new lane holds its first ticket while you add the next
  s = move(s, 'B', 0)
  assert.deepEqual(s, { lanes: [['A', 'B']], alone: [] })
  s = move(s, 'B', 'alone')
  assert.deepEqual(s, { lanes: [], alone: ['B', 'A'] })
})

test('order within a lane moves one place at a time and stops at the ends', () => {
  const s = oneStack(['A', 'B', 'C'])
  assert.deepEqual(shift(s, 'C', -1).lanes, [['A', 'C', 'B']])
  assert.deepEqual(shift(s, 'A', -1).lanes, [['A', 'B', 'C']])
})

test('every ticket stays exactly once, whatever moves', () => {
  let s = shapeOf([['A', 'B', 'C'], ['D'], ['E']])
  for (const [id, to] of [['A', 'alone'], ['D', 0], ['E', 'new'], ['B', 1], ['C', 'alone']] as const) s = move(s, id, to)
  assert.deepEqual(stacksOf(s).flat().sort(), ['A', 'B', 'C', 'D', 'E'])
})
