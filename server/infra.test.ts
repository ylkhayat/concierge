import assert from 'node:assert/strict'
import { test } from 'node:test'
import { behind } from './infra.ts'

test('a beating standby on another script than this build\'s is behind; one from before it said counts too', () => {
  assert.equal(behind({ name: 'w', code: 'abc', agoS: 3 }, 'abc'), false)
  assert.equal(behind({ name: 'w', code: 'old', agoS: 3 }, 'abc'), true)
  assert.equal(behind({ name: 'w', agoS: 3 }, 'abc'), true) // a standby from before heartbeats carried it
  assert.equal(behind({ name: 'w', code: 'old', agoS: 300 }, 'abc'), false) // not beating: nothing runs to restart
  assert.equal(behind({ name: 'w', code: 'old', agoS: 3 }, undefined), false) // no fleet in this build
})
