// Compliance per organization: an organization's own profile, else the shared one; your personal one starts off, and
// off means nothing to cover.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { obligations, profileFor } from './readiness.ts'
import type { Plan } from './planOps.ts'

const plan = { id: 'p', title: 'Notes', brief: 'Learners record audio of their lessons; we store their email and name', method: 'agile', nodes: [], links: [], messages: [], costUsd: 0, at: '' } as unknown as Plan
const shared = { regions: ['eu'], data: ['personal', 'recordings'] }

test('an organization without its own profile uses the shared one; your personal one starts off', () => {
  assert.deepEqual(profileFor(undefined, shared, false), shared)
  assert.deepEqual(profileFor(undefined, shared, true), { off: true })
  assert.deepEqual(profileFor({ certifications: ['soc2'] }, shared, true), { certifications: ['soc2'] }) // its own wins, yours too
})

test('checks off: nothing to cover, whatever the plan says', () => {
  assert.ok(obligations(shared, plan).some((o) => o.id === 'dpia'))
  assert.deepEqual(obligations({ ...shared, off: true }, plan), [])
})
