import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deckKey, designOn, readPlace, workspaceFor } from './modes.ts'

const isTicket = (id: string) => id.startsWith('ENG-')

test('the feed read is the open item\'s, in each view', () => {
  assert.equal(deckKey('review', 'o/app#1', isTicket), 'o/app#1')
  assert.equal(deckKey('exec', 'ENG-1', isTicket), 'ticket:ENG-1')
  assert.equal(deckKey('exec', 'stack:o/app#1', isTicket), undefined)
  assert.equal(deckKey('read', 'ENG-1', isTicket), 'ticket:ENG-1')
  assert.equal(deckKey('read', 'o/app#1', isTicket), 'o/app#1')
  assert.equal(deckKey('design', 'repo:o/web', isTicket), 'setup:o/web')
  assert.equal(deckKey('design', 'repo:o/web', isTicket, 'tokens'), 'design-tokens:o/web')
  assert.equal(deckKey('design', 'pr-1', isTicket, 'components'), undefined)
  assert.equal(deckKey('design', 'o/web#2', isTicket), 'visuals:o/web#2')
  assert.equal(deckKey('design', 'ticket:ENG-1', isTicket), undefined)
  assert.equal(deckKey('skills', undefined, isTicket), undefined)
})

test('a kept place reads back, and anything else is no place', () => {
  assert.deepEqual(readPlace('{"selected":"o/app#1","query":"fix"}'), { selected: 'o/app#1', query: 'fix' })
  assert.deepEqual(readPlace('{"selected":"","query":""}'), {})
  assert.deepEqual(readPlace('{"selected":3}'), {})
  assert.deepEqual(readPlace('null'), {})
  assert.deepEqual(readPlace('{oops'), {})
  assert.deepEqual(readPlace(null), {})
})

test('Design is on for a repository by its own setting, else its organization\'s', () => {
  const v = { repos: { 'o/web': 'auto', 'o/api': 'off' }, orgs: { o: 'always', p: 'off' } }
  assert.equal(designOn(v, 'o/web'), true)
  assert.equal(designOn(v, 'o/api'), false)
  assert.equal(designOn(v, 'o/cli'), true)
  assert.equal(designOn(v, 'p/x'), false)
  assert.equal(designOn(undefined, 'o/web'), false)
})

const v = { repos: { 'o/web': 'auto' } }, repos = ['o/api', 'o/web', 'o/cli']

test('moving to Design from a workspace where it is off opens one where it is on, and leaving goes back', () => {
  const into = workspaceFor('design', 'review', 'o/api', repos, v)
  assert.deepEqual(into, { focus: 'o/web', from: { was: 'o/api', picked: 'o/web' } })
  // inside Design nothing moves
  assert.deepEqual(workspaceFor('design', 'design', 'o/web', repos, v, into.from), into)
  assert.deepEqual(workspaceFor('review', 'design', 'o/web', repos, v, into.from), { focus: 'o/api' })
  // a reload in Design, then out: still back
  assert.deepEqual(workspaceFor('exec', undefined, 'o/web', repos, v, into.from), { focus: 'o/api' })
})

test('a workspace you picked in Design stays when you leave', () => {
  assert.deepEqual(workspaceFor('review', 'design', 'o/cli', repos, v, { was: 'o/api', picked: 'o/web' }), { focus: 'o/cli' })
})

test('Design keeps the workspace where it is on, every workspace, or when it is on nowhere', () => {
  assert.deepEqual(workspaceFor('design', 'review', 'o/web', repos, v), { focus: 'o/web' })
  assert.deepEqual(workspaceFor('design', 'review', undefined, repos, v), { focus: undefined })
  assert.deepEqual(workspaceFor('design', 'review', 'o/api', repos, {}), { focus: 'o/api' })
  // other switches keep it too
  assert.deepEqual(workspaceFor('exec', 'review', 'o/api', repos, v), { focus: 'o/api' })
})
