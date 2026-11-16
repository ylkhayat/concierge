import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyAll, LATER, type Plan } from './planOps.ts'

const plan = (): Plan => ({ id: 'p', title: 't', brief: '', method: 'agile', messages: [], costUsd: 0, at: '', links: [], nodes: [
  { id: 'g', kind: 'goal', title: 'G' },
  { id: 'e1', kind: 'epic', title: 'E1', parent: 'g' }, { id: 'e2', kind: 'epic', title: 'E2', parent: 'g' },
  { id: 'a', kind: 'ticket', title: 'A', parent: 'e1', priority: 2 },
  { id: 'L-1', kind: 'ticket', title: 'In Linear', parent: 'e1', priority: 2, created: { id: 'x', identifier: 'L-1', url: '' } },
] })

test('a move ranks, re-parents, re-prioritises and assigns, Linear items too, on a copy', () => {
  const p = plan()
  const q = applyAll(p, [{ op: 'move', id: 'L-1', rank: -1, parent: 'e2', priority: 1, assignee: 'Mira', assigneeId: 'u1' }])
  const n = q.nodes.find((x) => x.id === 'L-1')!
  assert.deepEqual([n.rank, n.parent, n.priority, n.assignee, n.assigneeId], [-1, 'e2', 1, 'Mira', 'u1'])
  assert.equal(p.nodes.find((x) => x.id === 'L-1')!.parent, 'e1') // the plan itself is untouched
  // update still leaves Linear items alone
  assert.equal(applyAll(p, [{ op: 'update', id: 'L-1', title: 'x' }]).nodes.find((x) => x.id === 'L-1')!.title, 'In Linear')
})

test('cut puts it under one Later epic at the lowest priority, and back where it was', () => {
  const q = applyAll(plan(), [{ op: 'move', id: 'a', cut: true }])
  const a = q.nodes.find((x) => x.id === 'a')!
  assert.deepEqual([a.parent, a.priority, a.cutFrom], [LATER, 4, 'e1'])
  assert.equal(q.nodes.find((x) => x.id === LATER)!.parent, 'g')
  const r = applyAll(q, [{ op: 'move', id: 'a', cut: false }]).nodes.find((x) => x.id === 'a')!
  assert.deepEqual([r.parent, r.cutFrom], ['e1', undefined])
  // unassign
  assert.equal(applyAll(applyAll(plan(), [{ op: 'move', id: 'a', assignee: 'Mira' }]), [{ op: 'move', id: 'a', assignee: null }]).nodes.find((x) => x.id === 'a')!.assignee, undefined)
})
