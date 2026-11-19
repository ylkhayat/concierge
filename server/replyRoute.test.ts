import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brief, capOf, keepSession, modelOf } from './replyRoute.ts'

test('a small or just-used conversation is continued; a long cold one is not', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  assert.equal(keepSession({ sessionCostBefore: 0.4 }, now), true)
  assert.equal(keepSession({ sessionCostBefore: 12, lastEndedAt: '2026-11-19T11:58:00Z' }, now), true)
  assert.equal(keepSession({ sessionCostBefore: 12, lastEndedAt: '2026-11-19T11:00:00Z' }, now), false)
  assert.equal(keepSession({ sessionCostBefore: 12 }, now), false)
})

test('routes: caps rise with the work, only an edit drops to the mid-size model', () => {
  assert.ok(capOf('answer') < capOf('edit') && capOf('edit') < capOf('change'))
  assert.equal(modelOf('edit'), 'sonnet')
  assert.equal(modelOf('change'), undefined)
})

test('the brief hands over the last report and its steps', () => {
  const b = brief({ url: 'u', title: 't', head: 'h', base: 'b', lastSaid: undefined } as never, { lastWords: 'did X', lastSteps: ['push?'] })
  assert.match(b, /did X/)
  assert.match(b, /1\. push\?/)
})
