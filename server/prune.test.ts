import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-prune-'))
const { prune, state } = await import('./store.ts')
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString()
const pr = (id: string, o: object) => ({ id, closed: true, body: 'b', bodyHtml: '<p>b</p>', updatedAt: ago(0), ...o }) as never

test('a state that only grew is trimmed, never what is open or still running', () => {
  state.prs = {
    'a/b#1': pr('a/b#1', { updatedAt: ago(90) }), // long closed: goes
    'a/b#2': pr('a/b#2', { updatedAt: ago(10) }), // closed a while: keeps, without its body
    'a/b#3': pr('a/b#3', { updatedAt: ago(1) }), // just closed: untouched
    'a/b#4': pr('a/b#4', { closed: false, updatedAt: ago(400) }), // open: untouched however old
    'a/b#5': pr('a/b#5', { updatedAt: ago(90), job: { state: 'running' } }), // still running: untouched
  }
  state.execs = { old: { state: 'done', endedAt: ago(120) } as never, recent: { state: 'failed', endedAt: ago(5) } as never, going: { state: 'running', endedAt: ago(200) } as never }
  state.spend = { [ago(400).slice(0, 10)]: 3, [ago(1).slice(0, 10)]: 2 }
  assert.equal(prune(), 2)
  assert.deepEqual(Object.keys(state.prs).sort(), ['a/b#2', 'a/b#3', 'a/b#4', 'a/b#5'])
  assert.equal(state.prs['a/b#2'].body, ''); assert.equal(state.prs['a/b#3'].body, 'b')
  assert.deepEqual(Object.keys(state.execs).sort(), ['going', 'recent'])
  assert.equal(Object.keys(state.spend).length, 1)
})
