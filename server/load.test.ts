import assert from 'node:assert/strict'
import { test } from 'node:test'
import { treeOf } from './load.ts'

test('treeOf takes a process and everything below it, nothing beside it', () => {
  const p = (pid: number, ppid: number) => ({ pid, ppid, cpu: 0, mb: 0, cmd: '' })
  assert.deepEqual(treeOf(10, [p(10, 1), p(11, 10), p(12, 11), p(20, 1), p(21, 20)]).map((x) => x.pid), [10, 11, 12])
})
