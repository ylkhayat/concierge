import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byRepo, valid, validPrep } from './plan.ts'

test('a plan covers every ticket once and never mixes repos', () => {
  const ts = [{ id: 'A-1', repo: 'x' }, { id: 'A-2', repo: 'x' }, { id: 'D-1', repo: 'y' }].map((t) => ({ ...t, title: '', description: '' }))
  assert.ok(valid([['A-2', 'A-1'], ['D-1']], ts))
  assert.ok(valid([['A-1'], ['A-2'], ['D-1']], ts))
  assert.ok(!valid([['A-1', 'D-1'], ['A-2']], ts)) // across repos
  assert.ok(!valid([['A-1'], ['D-1']], ts)) // A-2 missing
  assert.ok(!valid([['A-1', 'A-1'], ['A-2'], ['D-1']], ts)) // twice
  assert.deepEqual(byRepo(ts), [['A-1', 'A-2'], ['D-1']])
  assert.deepEqual(validPrep({ ids: ['A-1', 'A-2'], task: ' a shared type ' }, ts), { ids: ['A-1', 'A-2'], task: 'a shared type' })
  assert.equal(validPrep({ ids: ['A-1', 'D-1'], task: 'x' }, ts), undefined) // across repos
  assert.equal(validPrep({ ids: ['A-1'], task: 'x' }, ts), undefined) // one ticket has nothing to share
  assert.equal(validPrep({ ids: [], task: '' }, ts), undefined)
})
