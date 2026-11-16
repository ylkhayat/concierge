import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// the state file as a deploy leaves it: runs that were going when the server stopped, in a throwaway state dir
const dir = mkdtempSync(join(tmpdir(), 'rd-restart-'))
process.env.XDG_STATE_HOME = dir
mkdirSync(join(dir, 'review-deck'), { recursive: true })
const at = '2026-01-01T00:00:00.000Z', began = '2026-01-01T00:01:00.000Z'
const job = (o: object = {}) => ({ kind: 'review', sessionId: 's-pr', state: 'running', headSha: 'a', queuedAt: at, startedAt: began, ...o })
const run = (o: object = {}) => ({ ids: ['A-1'], repo: 'a/b', sessionId: 's-run', state: 'running', queuedAt: at, startedAt: began, phases: {}, outcomes: {}, prs: [], stack: [], ...o })
writeFileSync(join(dir, 'review-deck', 'state.json'), JSON.stringify({
  prs: {
    'a/b#1': { id: 'a/b#1', job: job(), explain: { state: 'running', headSha: 'a', queuedAt: at } },
    'a/b#2': { id: 'a/b#2', job: job({ continued: 3 }) },
    'a/b#3': { id: 'a/b#3', job: job({ state: 'queued', startedAt: undefined }) },
    'a/b#4': { id: 'a/b#4', job: job({ kind: 'post', state: 'done' }) },
    'a/b#5': { id: 'a/b#5', job: job({ continued: 3, deployStop: true }) },
  },
  execs: { r1: run({ id: 'r1' }), r2: run({ id: 'r2', state: 'interrupted', startedAt: undefined }) },
  base: { 'a/b': { state: 'running', queuedAt: at } },
}))
const { state, MAX_CONTINUES } = await import('./store.ts')

test('a review the restart stopped goes back in the queue to continue its own session, ahead of newer work', () => {
  const j = state.prs['a/b#1'].job!
  assert.equal(j.state, 'queued')
  assert.equal(j.continuing, true)
  assert.equal(j.continued, 1)
  assert.equal(j.sessionId, 's-pr') // the same session, so the agent keeps what it had done
  assert.equal(j.queuedAt, at) // its place in the queue
})

test('a run stopped by restart after restart waits for you instead of costing on', () => {
  const j = state.prs['a/b#2'].job!
  assert.equal(MAX_CONTINUES, 3)
  assert.equal(j.state, 'interrupted')
  assert.equal(j.continuing, false)
  assert.match(j.error!, /3 restarts in a row/)
})

test('queued work that never started just waits on, and finished work is left alone', () => {
  assert.equal(state.prs['a/b#3'].job!.state, 'queued')
  assert.equal(state.prs['a/b#3'].job!.continuing, undefined) // nothing to continue: it starts with its command
  assert.equal(state.prs['a/b#4'].job!.state, 'done')
  assert.equal(state.execs.r2.state, 'queued') // older state marked never-started runs interrupted
})

test('an exec run continues its session too; explanations and the codebase map simply run again', () => {
  assert.equal(state.execs.r1.state, 'queued')
  assert.equal(state.execs.r1.continuing, true)
  assert.equal(state.execs.r1.sessionId, 's-run')
  assert.equal(state.prs['a/b#1'].explain!.state, 'queued')
  assert.equal(state.base['a/b'].state, 'queued')
})

test('a deploy that stopped a run does not count toward the limit: it continues', () => {
  const j = state.prs['a/b#5'].job!
  assert.equal(j.state, 'queued')
  assert.equal(j.continuing, true)
  assert.equal(j.continued, 3) // unchanged
  assert.equal(j.deployStop, undefined)
})
