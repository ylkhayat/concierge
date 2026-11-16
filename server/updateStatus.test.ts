import assert from 'node:assert/strict'
import { test } from 'node:test'
import { datedLines, updateStatus } from './updateStatus.ts'

const T = Date.parse('2026-11-11T11:07:41Z')
const L = (min: number, text: string) => `${new Date(T + min * 60_000).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 UTC $4')}: ${text}`
const at = (lines: string[], o: Partial<Parameters<typeof updateStatus>[1]> = {}) => updateStatus(lines, { locked: false, agents: 0, now: T + 10 * 60_000, ...o })

test('the update log, read as a phase', () => {
  assert.equal(datedLines([L(0, 'running 7205a0d'), ' Container x Started '])[0].text, 'running 7205a0d')
  assert.equal(at([], { askedAt: T + 9 * 60_000 }).phase, 'queued')
  assert.match(at([], { askedAt: T }).text, /isn't running/) // asked 10 minutes ago, nobody picked it up
  assert.equal(at([L(1, 'building 0ec2fd5 A new Claude token')], { locked: true }).phase, 'building')
  assert.equal(at([L(1, 'building 0ec2fd5 A new Claude token')]).phase, 'failed') // no lock: the build died
  const d = at([L(1, 'building 0ec2fd5 x'), L(2, 'built; no new runs start here until it restarts (at most 30 minutes)')], { locked: true, agents: 2, drainingSince: (T + 2 * 60_000) / 1000 * 1000 })
  assert.equal(d.phase, 'draining'); assert.match(d.text, /2 running agents/); assert.match(d.text, /11:39 UTC/)
  assert.equal(at([L(8, 'running 0ec2fd5')], { running: '512-b51d689' }).phase, 'restarting') // the old one still answers
  // minutes later another version runs: it came another way (an update by hand), nothing is restarting
  assert.equal(at([L(3, 'running 0ec2fd5')], { running: '528-6616fc3' }).phase, 'updated')
  assert.equal(at([L(3, 'running 0ec2fd5')], { running: '513-0ec2fd5' }).phase, 'updated')
  assert.equal(at([L(3, 'up to date (0ec2fd5)')]).phase, 'current')
  assert.equal(at([L(3, 'pull failed (local changes or a diverged branch?)')]).phase, 'failed')
  assert.equal(at([L(3, 'running 0ec2fd5')], { now: T + 2 * 86400_000 }).phase, 'idle') // a day old: nothing going on
})

test('a line in the machine\'s own zone (CET) is read, not skipped', () => {
  const [l] = datedLines(['Sat Nov 14 19:54:21 CET 2026: built; no new runs start here until it restarts (at most 30 minutes)'])
  assert.equal(new Date(l.at).toISOString(), '2026-11-14T18:54:21.000Z')
})
