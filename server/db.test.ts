import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { StateDb } from './db.ts'

const fresh = () => new StateDb(join(mkdtempSync(join(tmpdir(), 'rd-db-')), 'state.db'))

test('entries are written, deleted and logged; a follower takes what changed since its last change', () => {
  const a = fresh(), b = fresh()
  assert.ok(a.empty)
  a.write([{ key: 'prs/x#1', value: '{"n":1}' }, { key: 'execAuto', value: 'false' }])
  a.write([{ key: 'prs/x#1', value: '{"n":2}' }])
  a.write([{ key: 'execAuto', value: null }])
  assert.deepEqual([...a.all()], [['prs/x#1', '{"n":2}']])
  assert.equal(a.head(), 4)
  // b follows a from 2: the last two changes
  const got = a.since(2)
  assert.deepEqual(got.map((c) => [c.seq, c.key, c.value]), [[3, 'prs/x#1', '{"n":2}'], [4, 'execAuto', null]])
  b.write([{ key: 'execAuto', value: 'false' }])
  b.write(got.map(({ key, value }) => ({ key, value })))
  assert.deepEqual([...b.all()], [['prs/x#1', '{"n":2}']])
})

test('replace makes the entries exactly those given, and logs only the difference', () => {
  const a = fresh()
  a.write([{ key: 'a', value: '1' }, { key: 'b', value: '2' }])
  const before = a.head()
  const changed = a.replace(new Map([['a', '1'], ['c', '3']]))
  assert.deepEqual(changed, [{ key: 'c', value: '3' }, { key: 'b', value: null }])
  assert.deepEqual([...a.all()].sort(), [['a', '1'], ['c', '3']])
  assert.equal(a.head(), before + 2)
  a.setKv('applied:win', '42')
  assert.equal(a.getKv('applied:win'), '42')
})
