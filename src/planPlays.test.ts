import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAll, type Plan } from '../server/planOps.ts'
import { planStream } from './planStream.ts'
import { balanceOwners, criticalFirst, fitAppetite, riskFirst } from './planPlays.ts'

const plan = (): Plan => ({ id: 'p', title: 't', brief: '', method: 'agile', messages: [], costUsd: 0, at: '', links: [], nodes: [
  { id: 'g', kind: 'goal', title: 'G' }, { id: 'e', kind: 'epic', title: 'E', parent: 'g' },
  { id: 'must', kind: 'ticket', title: 'Must', parent: 'e', priority: 1, estimate: 5, moscow: 'must' },
  { id: 'nice', kind: 'ticket', title: 'Nice', parent: 'e', priority: 3, estimate: 5, moscow: 'could' },
  { id: 'meh', kind: 'ticket', title: 'Meh', parent: 'e', priority: 4, estimate: 5, moscow: 'wont' },
  { id: 'spike', kind: 'ticket', title: 'Spike: the billing API', parent: 'e', priority: 3 },
], members: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }], appetite: { weeks: 2, from: new Date(0).toISOString() } })

test('fit the appetite cuts the least valuable first (a won\'t, then a could), never a must, until it fits', () => {
  const p = plan(), now = 0
  const ops = fitAppetite(p, 1, 5, now)
  assert.deepEqual(ops.map((o) => o.id), ['meh', 'nice'])
  assert.ok(planStream(applyAll(p, ops).nodes, p.links, 1, 5).end <= 2)
})

test('risk first puts the spike and the unsized ahead; protect the date ranks the critical chain first', () => {
  const p = plan()
  assert.deepEqual(riskFirst(p).map((o) => o.id), ['spike'])
  p.links = [{ from: 'meh', to: 'must' }]
  assert.ok(criticalFirst(p, 1, 5).length > 0)
})

test('balance owners hands the unassigned work to whoever has the least', () => {
  const ops = balanceOwners(plan())
  assert.equal(ops.length, 4)
  assert.deepEqual(new Set(ops.map((o) => o.assignee)), new Set(['Ana', 'Ben']))
})
