import assert from 'node:assert/strict'
import { test } from 'node:test'
import { whyEnded } from './outcome.ts'
import { NO_ROOM } from './worker.ts'

test('how a run ended is read from its words once, as a code', () => {
  assert.equal(whyEnded(undefined), undefined)
  assert.equal(whyEnded(`${NO_ROOM}: win is full`), 'no-room')
  assert.equal(whyEnded('lost the connection to mac mid-run (it went silent)'), 'network')
  assert.equal(whyEnded('The agent hung: no output for 20 minutes and nothing running under it'), 'network')
  assert.equal(whyEnded('getaddrinfo ENOTFOUND api.anthropic.com'), 'network')
  assert.equal(whyEnded('Failed to authenticate. Please run /login'), 'shut-out')
  assert.equal(whyEnded('Your credit balance is too low to access the API'), 'shut-out')
  assert.equal(whyEnded('exit 1', 'No conversation found with session ID 1234'), 'session-gone')
  assert.equal(whyEnded(undefined, 'No conversation found with session ID 1234'), 'session-gone')
  assert.equal(whyEnded('The tests failed'), 'other')
  // a full machine is never a dropped connection, though both speak of the machine: it must not count against the run
  assert.equal(whyEnded(`${NO_ROOM}: lost the connection to win`), 'no-room')
})
