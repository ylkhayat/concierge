import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diff } from './pins.ts'

test('a bookmark: first sight records, a change alerts once, a closed one ends, a missing one stays', () => {
  let r = diff({ 'pr:a': '', 'ticket:B-1': 'todo', 'pr:gone': 'ready for you' }, [
    { key: 'pr:a', text: 'in review', you: true }, { key: 'ticket:B-1', text: 'todo', you: false }, { key: 'pr:x', text: 'new', you: false },
  ])
  assert.deepEqual(r.changes, []) // pr:a just bookmarked; B-1 unchanged; pr:x not bookmarked
  assert.deepEqual(r.next, { 'pr:a': 'in review', 'ticket:B-1': 'todo', 'pr:gone': 'ready for you' }) // pr:gone missing: kept
  r = diff(r.next, [{ key: 'ticket:B-1', text: 'asking you on Linear', you: true }, { key: 'pr:a', text: 'Closed or merged', you: false, gone: true }])
  assert.deepEqual(r.changes.map((c) => [c.key, c.you, !!c.gone]), [['ticket:B-1', true, false], ['pr:a', false, true]])
  assert.ok(!('pr:a' in r.next) && r.next['ticket:B-1'] === 'asking you on Linear')
})
