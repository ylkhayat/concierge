import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitHit, spentWindow, windowsOf } from './usage.ts'

const now = 1_792_600_000_000
test('reads both windows from a rate_limit_event, and keeps what an event leaves out', () => {
  const u = windowsOf({ status: 'allowed', rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.66, resetsAt: 1792603800 }, seven_day: { utilization: 0.64, resetsAt: 1792717200 } } }, undefined, now)
  assert.deepEqual([u.five, u.seven], [{ used: 0.66, resetsAt: 1792603800 }, { used: 0.64, resetsAt: 1792717200 }])
  const v = windowsOf({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.78, resetsAt: 1792717200 }, u, now)
  assert.deepEqual([v.five, v.seven], [u.five, { used: 0.78, resetsAt: 1792717200 }])
  assert.equal(windowsOf({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1792603800 }, u, now).five!.used, 1)
})
test('a window near its end stops work until it resets', () => {
  const u = { five: { used: 0.96, resetsAt: 1792603800 }, seven: { used: 0.5, resetsAt: 1792717200 }, at: '' }
  assert.equal(spentWindow(u, now)?.which, '5-hour')
  assert.equal(spentWindow(u, 1792603800_000 + 1), undefined) // reset: work goes on
  assert.equal(spentWindow({ ...u, five: { used: 0.9, resetsAt: 1792603800 } }, now), undefined)
  assert.equal(spentWindow(undefined, now), undefined)
})
test('tells the plan refusing from other errors', () => {
  assert.ok(limitHit('Claude AI usage limit reached|1792603800'))
  assert.ok(limitHit("You've hit your limit · resets 5pm (Europe/Berlin)"))
  assert.ok(!limitHit('GitHub API rate limit exceeded'))
})


test('the pause level is yours: a window counts as spent at the level set, 100% only when it is full', () => {
  const now = 1_792_600_000_000, u = { five: { used: 0.97, resetsAt: now / 1000 + 3600 }, at: '' }
  assert.equal(spentWindow(u, now)?.which, '5-hour') // the default, 95%
  assert.equal(spentWindow(u, now, 0.99), undefined)
  assert.equal(spentWindow({ ...u, five: { ...u.five, used: 1 } }, now, 1)?.which, '5-hour')
})
