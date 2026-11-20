import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagramOf } from './discussions.ts'

test("a card's picture: a path when it has steps, a fork when something was chosen", () => {
  assert.equal(diagramOf('understanding', { status: '', short: '', long: '', steps: [] }), undefined)
  const p = diagramOf('understanding', { status: '', short: '', long: '', before: 'a', after: 'b', steps: Array.from({ length: 7 }, (_, i) => ({ label: `s${i}`, file: '', detail: '' })) })
  assert.equal(p?.kind === 'path' && p.steps.length, 5)
  assert.equal(diagramOf('intent', { status: '', short: '', long: '', chosen: { label: '', why: '' } }), undefined)
  const f = diagramOf('intent', { status: '', short: '', long: '', problem: 'p', chosen: { label: 'x', why: 'y' }, setAside: [], open: ['o'] })
  assert.deepEqual(f, { kind: 'fork', problem: 'p', chosen: { label: 'x', why: 'y' }, setAside: [], open: ['o'] })
})
