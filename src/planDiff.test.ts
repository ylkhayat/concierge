import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAll, type Plan } from '../server/planOps.ts'
import { impact } from './planDiff.ts'

const plan = (): Plan => ({ id: 'p', title: 't', brief: '', method: 'agile', messages: [], costUsd: 0, at: '', links: [{ from: 'b', to: 'c' }], nodes: [
  { id: 'g', kind: 'goal', title: 'G' },
  { id: 'E-1', kind: 'epic', title: 'E1', parent: 'g', created: { id: 'ie1', identifier: 'E-1', url: '' } },
  { id: 'a', kind: 'ticket', title: 'A', parent: 'E-1', priority: 1, estimate: 5 },
  { id: 'b', kind: 'ticket', title: 'B', parent: 'E-1', priority: 2, estimate: 5 },
  { id: 'c', kind: 'ticket', title: 'C', parent: 'E-1', priority: 3, estimate: 5 },
  { id: 'L-9', kind: 'ticket', title: 'In Linear', parent: 'g', priority: 3, estimate: 10, created: { id: 'i9', identifier: 'L-9', url: '' } },
], appetite: { weeks: 4, from: new Date(0).toISOString() } })

test('cutting work lands it earlier, says what was cut, and writes Backlog to Linear for an issue there', () => {
  const p = plan(), now = Date.parse(p.appetite!.from)
  const ops = [{ op: 'move' as const, id: 'L-9', cut: true }]
  const i = impact({ ...p, scenario: { ops, at: '' } }, applyAll(p, ops), 1, 5, now)
  assert.equal(i.endBefore, 5); assert.equal(i.endAfter, 3); assert.equal(i.days, -14)
  assert.deepEqual([i.fitsBefore, i.fitsAfter], [false, true])
  assert.deepEqual(i.cut.map((x) => x.id), ['L-9'])
  assert.deepEqual(i.writes, [{ id: 'L-9', issue: 'i9', identifier: 'L-9', changes: ['to Backlog (cut)', 'priority Medium → Low'], patch: { backlog: true, priority: 4 } }])
})

test('moving a blocker later says which tickets now finish later, and because of what; a move under an epic in Linear is a parent write', () => {
  const p = plan()
  const ops = [{ op: 'move' as const, id: 'b', rank: 99 }, { op: 'move' as const, id: 'L-9', parent: 'E-1', assignee: 'Mira', assigneeId: 'u1' }]
  const i = impact(p, applyAll(p, ops), 1, 5)
  assert.ok(i.later.some((x) => x.id === 'c' && x.because === 'B'))
  assert.deepEqual(i.writes[0].patch, { parentId: 'ie1', assigneeId: 'u1' })
})
