// A short name for the board: kept on add and update, and on an item already in Linear (whose title changes there).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, type Plan } from './planOps.ts'

const plan = (): Plan => ({ id: 'p', title: 'P', brief: '', method: 'agile', nodes: [], links: [], messages: [], costUsd: 0, at: '' })

test('an epic or ticket keeps its short name, trimmed and capped; one in Linear takes it too', () => {
  const p = plan()
  apply(p, { op: 'add', id: 'e1', kind: 'epic', title: 'Learners study inside a course that knows their language and level', short: '  Courses  ' } as never, 'agent')
  assert.equal(p.nodes[0].short, 'Courses')
  apply(p, { op: 'update', id: 'e1', short: 'Course setup and study purpose for every learner of every level' } as never, 'agent')
  assert.equal(p.nodes[0].short!.length, 40)
  p.nodes.push({ id: 'ENG-1', kind: 'ticket', title: 'Long title in Linear', created: { id: 'x', url: 'u' } })
  assert.ok(apply(p, { op: 'update', id: 'ENG-1', short: 'Linear one' } as never, 'agent'))
  assert.equal(p.nodes[1].short, 'Linear one')
  assert.equal(p.nodes[1].title, 'Long title in Linear')
})
