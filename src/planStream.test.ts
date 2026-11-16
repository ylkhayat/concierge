import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlanNode } from '../server/plans.ts'
import { planStream, refineOf } from './planStream.ts'

const t = (id: string, parent: string, priority: number, estimate: number, extra = {}) => ({ id, kind: 'ticket' as const, title: id, parent, priority: priority as 1, estimate, ...extra })
const nodes = [
  { id: 'g', kind: 'goal' as const, title: 'Goal' },
  { id: 'e1', kind: 'epic' as const, title: 'Pause', parent: 'g' },
  { id: 'e2', kind: 'epic' as const, title: 'Billing', parent: 'g' },
  t('a', 'e1', 1, 5), t('b', 'e1', 2, 5), t('c', 'e2', 1, 10), t('d', 'e2', 3, 5),
  t('old', 'e1', 2, 5, { state: { name: 'Done', type: 'completed' } }),
]

test('one person works through the most valuable first; done work sits before now', () => {
  const s = planStream(nodes, [], 1, 5)
  const at = (id: string) => s.streams.flatMap((x) => x.slots).find((x) => x.id === id)!
  assert.deepEqual([at('a').start, at('a').end], [0, 1]) // urgent, 5 pt at 5 pt/wk
  assert.deepEqual([at('c').start, at('c').end], [1, 3]) // the other urgent one next
  assert.equal(at('b').start, 3); assert.equal(at('d').start, 4)
  assert.deepEqual([at('old').start, at('old').end, at('old').done], [-1, 0, true])
  assert.equal(s.end, 5)
})

test('two people work side by side, and a ticket waits for the ones it depends on', () => {
  const s = planStream(nodes, [{ from: 'c', to: 'a' }], 2, 5)
  const at = (id: string) => s.streams.flatMap((x) => x.slots).find((x) => x.id === id)!
  assert.equal(at('c').start, 0) // a waits for c, so c goes first
  assert.equal(at('a').start, 2) // after c ends (10 pt = 2 weeks)
  assert.equal(at('b').start, 0) // the other person takes b meanwhile
  assert.ok(s.end <= 3.01)
})

test('what still needs refining: backlog or triage in Linear, the planner\'s note, an unsized ticket; never what is going on or done', () => {
  const t = (x: Partial<PlanNode>) => ({ id: 't', kind: 'ticket', title: 't', estimate: 2, ...x }) as PlanNode
  assert.match(refineOf(t({ state: { name: 'Backlog', type: 'backlog' } }))!, /Backlog/)
  assert.equal(refineOf(t({ refine: 'pick the provider' })), 'pick the provider')
  assert.equal(refineOf(t({ estimate: undefined })), 'No estimate yet')
  assert.equal(refineOf(t({ state: { name: 'Todo', type: 'unstarted' } })), undefined)
  assert.equal(refineOf(t({ refine: 'x', state: { name: 'Doing', type: 'started' } })), undefined)
})

test('a rank moves a ticket in the order, whatever its priority', () => {
  const ranked = nodes.map((n) => (n.id === 'd' ? { ...n, rank: -1 } : n)) // d (low) first now
  const s = planStream(ranked, [], 1, 5)
  const at = (id: string) => s.streams.flatMap((x) => x.slots).find((x) => x.id === id)!
  assert.equal(at('d').start, 0); assert.equal(at('a').start, 1)
})

test('an assigned ticket waits for its own person; the rest go to whoever is free', () => {
  const mine = nodes.map((n) => (n.id === 'a' || n.id === 'c' ? { ...n, assignee: 'Mira' } : n))
  const s = planStream(mine, [], 2, 5)
  const at = (id: string) => s.streams.flatMap((x) => x.slots).find((x) => x.id === id)!
  assert.deepEqual(s.lanes, ['Mira', 'Person 2'])
  assert.equal(at('a').lane, 'Mira'); assert.equal(at('c').lane, 'Mira')
  assert.equal(at('c').start, 1) // after Mira's a
  assert.equal(at('b').lane, 'Person 2'); assert.equal(at('b').start, 0)
})

test('the critical path runs back from what ends last through what it waited for', () => {
  const s = planStream(nodes, [{ from: 'c', to: 'a' }], 2, 5)
  assert.equal(s.critical.at(-1), s.streams.flatMap((x) => x.slots).filter((x) => !x.done).sort((a, b) => b.end - a.end)[0].id)
  assert.ok(s.critical.includes('c'))
})
