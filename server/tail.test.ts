import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tailOf, type Activity } from './runner.ts'

const line = (kind: Activity['kind'], text: string): Activity => ({ at: '2026-11-28T10:00:00Z', kind, text })
test('the newest part of a feed is whole runs, behind one line that says how many came before', () => {
  const run = (name: string, n: number) => [line('section', name), ...Array.from({ length: n }, (_, i) => line('text', `${name} ${i}`))]
  const feed = [...run('first', 9), ...run('second', 9), ...run('third', 4)] // 10 + 10 + 5 lines
  assert.equal(tailOf(feed, 0), feed)    // not asked for a part: all of it
  assert.equal(tailOf(feed, 100), feed)  // shorter than the part asked for
  const last = tailOf(feed, 5)
  assert.deepEqual([last[0].earlier, last[1].text, last.length], [20, 'third', 6])
  // the part asked for starts inside a run: back to that run's start
  const two = tailOf(feed, 8)
  assert.deepEqual([two[0].earlier, two[1].text, two.length], [10, 'second', 16])
  // one long run with nothing before it: there is no earlier part to stand for
  assert.equal(tailOf(run('only', 50), 10).length, 51)
})
