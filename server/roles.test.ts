import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
// its own state folder: what this test saves must never reach the real one
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-roles-'))
const { config } = await import('./config.ts')
const { canChange, ownerOf, setOwner, setRoles, slot, withRole } = await import('./roles.ts')
const { state } = await import('./store.ts')

test('each role runs its own slot, else the developer\'s; skills change only in the role that owns them', () => {
  state.roles = { joined: ['developer'], setups: {}, skills: {} }
  config.exec.command = '/concierge-exec {ids}'
  setRoles({ joined: ['developer', 'product'] })
  setRoles({ role: 'product', setup: { slots: { exec: '/pm-exec {ids}' } } })
  assert.throws(() => setRoles({ role: 'product', setup: { slots: { exec: '/no-ids' } } }))
  assert.equal(slot('exec', 'product'), '/pm-exec {ids}')
  assert.equal(slot('exec', 'developer'), '/concierge-exec {ids}')
  assert.equal(slot('review', 'product'), config.agent.review.command) // not set: the developer's, shared as-is
  withRole('product', () => assert.equal(slot('exec'), '/pm-exec {ids}'))
  // owners: a starter by its role, a slot's skill by the role naming it, anything else by who you signed up as
  assert.equal(ownerOf('concierge-plan'), 'product')
  assert.equal(ownerOf('pm-exec'), 'product')
  assert.equal(ownerOf('junior-comments'), 'developer')
  withRole('product', () => {
    assert.ok(!canChange('junior-comments'))
    assert.throws(() => setOwner('junior-comments', 'shared'))
  })
  withRole('developer', () => setOwner('junior-comments', 'shared'))
  withRole('product', () => assert.ok(canChange('junior-comments')))
  assert.throws(() => setRoles({ joined: [] }))
})
