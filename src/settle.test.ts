import assert from 'node:assert/strict'
import { test } from 'node:test'
import { minePrOrder, reviewPrOrder, ticketOrder } from './listOrder.ts'
import { pending, relayout, shapeKey } from './settle.ts'

type It = { id: string; v?: number }
const id = (x: It) => x.id, head = (s: { name: string }) => s.name
const lay = (...secs: [string, string[][]][]) => secs.map(([name, units]) => ({ name, units: units.map((u) => u.map((x): It => ({ id: x }))) }))

test('orders are total: the same items sort the same whatever order they came in', () => {
  const prs = [
    { id: 'r#3', awaiting: 1, createdAt: '2026-01-02', firstSeenAt: 't1' },
    { id: 'r#1', awaiting: 1, createdAt: '2026-01-02', firstSeenAt: 't1' },
    { id: 'r#2', awaiting: 2, createdAt: '2026-01-01', firstSeenAt: 't0' },
    { id: 'r#4', createdAt: '2026-01-03', firstSeenAt: 't1' },
  ]
  for (const cmp of [minePrOrder, reviewPrOrder]) {
    const a = [...prs].sort(cmp).map(id), b = [...prs].reverse().sort(cmp).map(id)
    assert.deepEqual(a, b)
  }
  assert.deepEqual([...prs].sort(minePrOrder).map(id), ['r#2', 'r#1', 'r#3', 'r#4']) // most waiting, then newest, then id
  const ts = [{ id: 'B-2', priority: 0, createdAt: 'x' }, { id: 'B-1', priority: 2, createdAt: 'x' }, { id: 'A-9', priority: 2, createdAt: 'x' }]
  assert.deepEqual([...ts].sort(ticketOrder).map(id), ['A-9', 'B-1', 'B-2'])
  assert.deepEqual([...ts].reverse().sort(ticketOrder).map(id), ['A-9', 'B-1', 'B-2'])
})

test('the arrangement on screen keeps its places, with the newest data in them', () => {
  const held = lay(['Working', [['a'], ['b', 'c']]], ['Done', [['d']]])
  const fresh = lay(['Working', [['b', 'c']]], ['Done', [['a'], ['e']]]) // a moved, d went, e is new
  fresh[0].units[0][0].v = 2
  const shown = relayout(held, fresh, id)
  assert.equal(shapeKey(shown, id, head), 'Working:a,b+c|Done:') // a stays put, d goes, e waits
  assert.equal(shown[0].units[1][0].v, 2) // but b shows its newest data
  assert.notEqual(shapeKey(held, id, head), shapeKey(fresh, id, head))
  assert.equal(shapeKey(fresh, id, head), shapeKey(lay(['Working', [['b', 'c']]], ['Done', [['a'], ['e']]]), id, head))
})

test('a click stays until the server agrees, and goes with its item', () => {
  const over = { a: { pinned: true }, b: { pinned: true }, c: { dismissed: true } }
  const given: { id: string; pinned?: boolean }[] = [{ id: 'a', pinned: false }, { id: 'b', pinned: true }]
  assert.deepEqual(pending(over, given), { a: { pinned: true } })
  const same = { a: { pinned: true } }
  assert.equal(pending(same, [{ id: 'a' }]), same) // nothing changed: the same object, no render
})
