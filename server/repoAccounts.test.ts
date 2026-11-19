import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from './config.ts'
import { chosenFor, pinOf, providerFor } from './providers.ts'

test('a repository kept to one account always gets it, for every kind of work', () => {
  const was = config.repoAccounts
  config.repoAccounts = { 'me/private': 'claude-person' }
  try {
    assert.equal(pinOf('me/private'), 'claude-person')
    for (const w of ['review', 'revise', 'exec', 'small'] as const) assert.equal(providerFor(w, 'me/private'), 'claude-person')
    assert.equal(chosenFor('review', 'me/private'), 'claude-person')
    // other repositories, and work with no repository, follow the order as before
    assert.equal(pinOf('org/app'), undefined)
    assert.equal(providerFor('review', 'org/app'), providerFor('review'))
  } finally { config.repoAccounts = was }
})
