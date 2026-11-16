import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(join(tmpdir(), 'rd-life-'))
process.env.XDG_STATE_HOME = dir
const { EVENTS, eventsWritten, legal, runs, totals, transition } = await import('./lifecycle.ts')
const read = async () => { await eventsWritten(); return readFileSync(EVENTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) }

test('the table: what may follow what', () => {
  assert.ok(legal('queued', 'running'))
  assert.ok(legal('running', 'queued')) // session gone, or a restart: it goes back to continue
  assert.ok(legal('failed', 'queued')) // you run it again
  assert.ok(!legal('done', 'running')) // a finished run never runs again in place: a new run is queued
  assert.ok(!legal('queued', 'done'))
  assert.ok(!legal('interrupted', 'running')) // waits for you: only a new queue (you acting) moves it
})

test('every change is recorded with its cause; an illegal one is made but marked', async () => {
  const job = { state: 'queued' as const, error: undefined as string | undefined }
  transition('job', 'a/b#1', 'q1', job, 'running', 'started', {}, { kind: 'review' })
  job.error = 'boom'
  transition('job', 'a/b#1', 'q1', job, 'failed', 'exit 1', {}, { kind: 'review', costUsd: 0.4, refused: 2 })
  transition('job', 'a/b#1', 'q1', job, 'running', 'oops') // failed → running isn't allowed
  const ev = await read()
  assert.deepEqual(ev.map((e) => `${e.from}→${e.to}:${e.cause}`), ['queued→running:started', 'running→failed:exit 1', 'failed→running:oops'])
  assert.equal(ev[1].error, 'boom'); assert.equal(ev[1].costUsd, 0.4)
  assert.equal(ev[2].illegal, true); assert.equal(job.state, 'running') // still made: stopping halfway would be worse
})

test('the run history: each run as it ended, restarts counted, and per-day totals', async () => {
  const run = { state: 'queued' as const, error: undefined }
  transition('exec', 'BLI-1', 'r1', run, 'running', 'started', {}, { kind: 'exec' })
  transition('exec', 'BLI-1', 'r1', run, 'queued', 'restart')
  transition('exec', 'BLI-1', 'r1', run, 'running', 'continued')
  transition('exec', 'BLI-1', 'r1', run, 'done', 'result', {}, { kind: 'exec', costUsd: 1.25, turns: 9 })
  await eventsWritten()
  const r = (await runs(1)).find((x) => x.run === 'r1')!
  assert.equal(r.to, 'done'); assert.equal(r.restarts, 1); assert.equal(r.costUsd, 1.25); assert.ok(r.startedAt)
  const day = (await totals(1)).at(-1)!
  assert.ok(day.runs >= 1); assert.ok(day.done >= 1); assert.ok(day.costUsd >= 1.25)
})
