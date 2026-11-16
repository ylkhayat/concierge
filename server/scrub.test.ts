import assert from 'node:assert/strict'
import { test } from 'node:test'

test('known secrets never survive into what is stored or shown', async () => {
  process.env.LINEAR_API_KEY = 'lin_api_SECRETSECRETSECRET123'
  const { scrub, forgetSecretCache } = await import('./scrub.ts')
  forgetSecretCache()
  assert.equal(scrub('Bearer lin_api_SECRETSECRETSECRET123 used'), 'Bearer *** used')
  assert.equal(scrub('nothing secret here'), 'nothing secret here')
  assert.equal(scrub('twice lin_api_SECRETSECRETSECRET123 and lin_api_SECRETSECRETSECRET123'), 'twice *** and ***')
})
