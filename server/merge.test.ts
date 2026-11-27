import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyMeta, merge, stamp, settled } from './merge.ts'

const T = (h: number) => `2026-11-11T0${h}:00:00.000Z`

test('a snapshot is the state, with when each entry changed', () => {
  const s = { prs: { 'o/r#1': { title: 'a' } }, execs: {}, execAuto: true }, meta = emptyMeta(), last = new Map<string, string>()
  const first = stamp(s, meta, last, T(1))
  const back = JSON.parse(first.data)
  assert.deepEqual({ ...back, _meta: undefined }, { ...s, _meta: undefined })
  assert.equal(back._meta.at['prs/o/r#1'], T(1))
  assert.equal(first.changed, 2)
  s.prs['o/r#1'].title = 'b'
  assert.equal(stamp(s, meta, last, T(2)).changed, 1)
  assert.equal(meta.at['prs/o/r#1'], T(2)); assert.equal(meta.at.execAuto, T(1)) // only what changed is restamped
  delete (s.prs as Record<string, unknown>)['o/r#1']
  stamp(s, meta, last, T(3))
  assert.equal(meta.gone['prs/o/r#1'], T(3))
})

// AC-1376: the Mac ran a reply the Windows snapshot never had; the late Mac snapshot brings it back
test('the newer entry wins, whichever machine made it, and a deletion counts as a change', () => {
  const win = { execs: { old: { state: 'done' } }, prs: { p: { t: 'win' } } }
  const winMeta = { at: { 'execs/old': T(1), 'prs/p': T(5) }, gone: {} }
  const mac = { execs: { old: { state: 'done' }, cd0536cd: { state: 'done' } }, prs: { p: { t: 'mac' } } }
  const macMeta = { at: { 'execs/old': T(1), 'execs/cd0536cd': T(3), 'prs/p': T(4) }, gone: { 'execs/gone': T(3) } }
  const into: Record<string, any> = structuredClone(win), meta = structuredClone(winMeta) as typeof winMeta & { gone: Record<string, string> }
  ;(into.execs as any).gone = { state: 'done' }; (meta.at as any)['execs/gone'] = T(2)
  const taken = merge(into, meta, mac, macMeta, T(0))
  assert.deepEqual(taken.sort(), ['execs/cd0536cd', 'execs/gone'])
  assert.deepEqual(into.execs.cd0536cd, { state: 'done' }) // came back
  assert.equal(into.prs.p.t, 'win') // Windows' change was later
  assert.equal(into.execs.gone, undefined) // deleted after it last changed here
  assert.deepEqual(merge(into, meta, mac, macMeta, T(0)), []) // merging again changes nothing
})

test('an older snapshot without dates (state.json) counts as of its file time', () => {
  const into: Record<string, unknown> = {}, meta = emptyMeta()
  merge(into, meta, { execAuto: true, prs: { a: 1 } }, emptyMeta(), T(1))
  assert.deepEqual(into, { execAuto: true, prs: { a: 1 } })
  merge(into, meta, { execAuto: false }, emptyMeta(), T(0)) // older file: loses
  assert.equal(into.execAuto, true)
})

test('an entry that stopped changing is one a save may skip: a run that ended, a closed PR nothing works on', () => {
  const now = Date.parse('2026-11-28T12:00:00Z'), ago = (min: number) => new Date(now - min * 60_000).toISOString()
  assert.ok(settled('execs/a', { state: 'done', endedAt: ago(20) }, now))
  assert.ok(!settled('execs/a', { state: 'done', endedAt: ago(5) }, now))      // just ended: its page is still being written to
  assert.ok(!settled('execs/a', { state: 'running', startedAt: ago(90) }, now))
  assert.ok(!settled('execs/a', { state: 'queued', queuedAt: ago(90) }, now))
  assert.ok(settled('prs/o/r#1', { closed: true, updatedAt: ago(3 * 24 * 60), job: { state: 'done' } }, now))
  assert.ok(!settled('prs/o/r#1', { closed: true, updatedAt: ago(3 * 24 * 60), job: { state: 'running' } }, now))
  assert.ok(!settled('prs/o/r#1', { closed: false, updatedAt: ago(3 * 24 * 60) }, now)) // open: anything may touch it
  assert.ok(!settled('settings/maxJobs', 2, now))
  assert.ok(!settled('ticketRefs/AB-1', { id: 'AB-1' }, now))
})
