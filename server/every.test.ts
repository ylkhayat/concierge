import { test } from 'node:test'
import assert from 'node:assert/strict'
import { every, timers } from './every.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('a job that throws is counted and runs again', async () => {
  let n = 0
  const t = every('throws', () => { n++; throw new Error('no') }, 10)
  await wait(60); clearInterval(t)
  const j = timers().find((x) => x.name === 'throws')!
  assert.ok(n >= 2 && j.errors === n && j.lastError === 'no')
})

test('an async job still running is not started beside itself', async () => {
  let on = 0, most = 0
  const t = every('slow', async () => { on++; most = Math.max(most, on); await wait(35); on-- }, 10)
  await wait(100); clearInterval(t)
  assert.equal(most, 1)
  assert.ok(timers().find((x) => x.name === 'slow')!.skipped > 0)
})

test('two jobs of one name are told apart', () => {
  clearInterval(every('same', () => {}, 1000)); clearInterval(every('same', () => {}, 1000))
  assert.ok(timers().some((x) => x.name === 'same#2'))
})
