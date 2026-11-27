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

test('the change log keeps the last changes only, cut when the database is opened and as it is written', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'rd-db-')), 'state.db')
  const a = new StateDb(file, 5)
  for (let i = 1; i <= 12; i++) a.write([{ key: 'k', value: String(i) }])
  assert.equal(a.oldest(), 1) // not on every write
  a.trim()
  assert.equal(a.oldest(), 8)
  assert.equal(a.head(), 12)
  for (let i = 13; i <= 20; i++) a.write([{ key: 'k', value: String(i) }])
  a.close()
  // opened again (a restart): cut to what is kept, and the numbering goes on from where it was
  const b = new StateDb(file, 5)
  assert.equal(b.oldest(), 16)
  assert.equal(b.head(), 20)
  b.write([{ key: 'k', value: '21' }])
  assert.equal(b.head(), 21)
  assert.deepEqual([...b.all()], [['k', '21']])
})

test('a snapshot is the entries in a file of its own, opened like any state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rd-db-')), a = new StateDb(join(dir, 'state.db'))
  a.write([{ key: 'prs/x#1', value: '{"n":1}' }, { key: 'settings/maxJobs', value: '2' }])
  a.write([{ key: 'prs/x#1', value: '{"n":2}' }])
  a.snapshot(join(dir, 'snap.db'))
  a.write([{ key: 'prs/x#1', value: '{"n":3}' }]) // after it: not in the copy
  const b = new StateDb(join(dir, 'snap.db'))
  assert.deepEqual([...b.all()].sort(), [['prs/x#1', '{"n":2}'], ['settings/maxJobs', '2']])
  assert.equal(b.since(0).length, 0)
})
