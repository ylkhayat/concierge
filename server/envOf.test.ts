import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromSentry, sentryRef, textEnv } from './envOf.ts'

test('finds the Sentry issue behind issue and feedback links', () => {
  assert.deepEqual(sentryRef('see https://acme.sentry.io/issues/ACME-DESKTOP-1A2/?project=1'), { org: 'acme', issue: 'ACME-DESKTOP-1A2' })
  assert.deepEqual(sentryRef('[x](https://acme.sentry.io/feedback/?feedbackSlug=acme-desktop%3A123456789&project=42)'), { org: 'acme', issue: '123456789' })
  assert.equal(sentryRef('no link here'), undefined)
})

test('Sentry decides: staging or a sandbox app is dev, production is prod', () => {
  assert.equal(fromSentry('production', 'Acme').env, 'prod')
  assert.equal(fromSentry('staging', 'Acme Sandbox').env, 'dev')
  assert.equal(fromSentry('production', 'Acme Sandbox').env, 'dev')
  assert.equal(fromSentry('', '').env, 'unknown')
})

test('without Sentry, only unambiguous words in the ticket count', () => {
  assert.equal(textEnv('[Sentry][Dev] Acme Sandbox stuck')?.env, 'dev')
  assert.equal(textEnv('**Environment:** staging · **OS:** macOS')?.env, 'dev')
  assert.equal(textEnv('**Environment:** production')?.env, 'prod')
  assert.equal(textEnv('slower in production than sandbox'), undefined) // both: not sure
  assert.equal(textEnv('(app: Acme Sandbox, env: staging)')?.env, 'dev')
  assert.equal(textEnv('Production p95 regressed'), undefined) // the word alone is not the environment
})
