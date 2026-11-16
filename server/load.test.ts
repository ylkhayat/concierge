import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stoppedRuns, treeOf } from './load.ts'
import { state } from './store.ts'

test('treeOf takes a process and everything below it, nothing beside it', () => {
  const p = (pid: number, ppid: number) => ({ pid, ppid, cpu: 0, mb: 0, cmd: '' })
  assert.deepEqual(treeOf(10, [p(10, 1), p(11, 10), p(12, 11), p(20, 1), p(21, 20)]).map((x) => x.pid), [10, 11, 12])
})

test('stopped runs: failed, killed and cancelled ones from the last week, unless something ran for the ticket since', () => {
  const now = Date.now(), at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()
  const run = (id: string, ids: string[], s: string, minAgo: number) => ({ id, ids, repo: 'o/r', sessionId: id, state: s, queuedAt: at(minAgo), phases: {}, outcomes: {}, prs: [], stack: [] })
  Object.assign(state.execs, {
    a: run('a', ['T-1'], 'interrupted', 10), // killed, nothing since: listed
    b: run('b', ['T-2'], 'failed', 30), c: run('c', ['T-2'], 'done', 20), // failed, then ran again: not listed
    d: run('d', ['T-3'], 'cancelled', 5),
    e: run('e', ['T-4'], 'failed', 8 * 24 * 60), // over a week old
    f: run('f', ['T-5'], 'running', 1),
  })
  assert.deepEqual(stoppedRuns().map((r) => r.key), ['exec:d', 'exec:a'])
})
