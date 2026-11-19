import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brief, component, remember, workFor, type WorkStore } from './work.ts'

const edges: Record<string, string[]> = {
  'ticket:AI-1': ['pr:o/r#1', 'pr:o/r#2'], 'pr:o/r#1': ['ticket:AI-1'], 'pr:o/r#2': ['ticket:AI-1', 'pr:o/r#3'], 'pr:o/r#3': ['pr:o/r#2'],
  'ticket:AI-9': [],
}
const of = (k: string) => edges[k] ?? []

test('a Work is everything linked: a ticket, its PRs, and the stack they are in', () => {
  assert.deepEqual(component('pr:o/r#3', of).sort(), ['pr:o/r#1', 'pr:o/r#2', 'pr:o/r#3', 'ticket:AI-1'])
  assert.deepEqual(component('ticket:AI-9', of), ['ticket:AI-9'])
})

test('one memory: words on one member reach the others, and two Works linked later merge into the older', () => {
  const s: WorkStore = { works: {}, workOf: {} }
  const a = workFor(s, ['pr:o/r#1'], '2026-01-01T00:00:00Z')
  remember(a, 'pr:o/r#1', 'No fallback: deploy the backend first', '2026-01-01T01:00:00Z')
  const b = workFor(s, ['ticket:AI-9'], '2026-01-02T00:00:00Z')
  remember(b, 'ticket:AI-9', 'Keep the old field one release', '2026-01-02T01:00:00Z')
  // linked now: one Work, the older id, both memories in order
  const w = workFor(s, ['pr:o/r#1', 'ticket:AI-9'])
  assert.equal(w.id, a.id)
  assert.equal(Object.keys(s.works).length, 1)
  assert.deepEqual(w.said.map((x) => x.on), ['pr:o/r#1', 'ticket:AI-9'])
  const text = brief(w, [{ key: 'pr:o/r#1', label: '#1', title: 'one' }, { key: 'ticket:AI-9', label: 'AI-9', title: 'nine' }], 'ticket:AI-9')
  assert.match(text, /on #1 .*No fallback/)
  assert.match(text, /You are on AI-9/)
})
