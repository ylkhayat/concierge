import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { tidy, wouldEmpty } from './replica.ts'

test('at start, keys and sign-ins are readable by you alone and a failed pull\'s leftovers are gone', async () => {
  const config = mkdtempSync(join(tmpdir(), 'rd-tidy-c-')), state = mkdtempSync(join(tmpdir(), 'rd-tidy-s-'))
  mkdirSync(join(config, 'secrets')); mkdirSync(join(config, 'azure')); mkdirSync(join(state, 'logs'))
  for (const f of ['secrets.json', 'secrets/db.env', 'azure/msal_token_cache.json', 'config.json']) writeFileSync(join(config, f), '{}', { mode: 0o644 })
  const longAgo = new Date(Date.now() - 2 * 3600_000)
  const stale = join(config, 'config.json.0a1b2c3d.tmp'), staleLog = join(state, 'logs', 'run.jsonl.0a1b2c3d.tmp'), fresh = join(config, 'secrets.json.0a1b2c3d.tmp')
  for (const f of [stale, staleLog, fresh]) writeFileSync(f, '')
  utimesSync(stale, longAgo, longAgo); utimesSync(staleLog, longAgo, longAgo)
  await tidy(config, state)
  const mode = (f: string) => statSync(join(config, f)).mode & 0o777
  assert.equal(mode('secrets.json'), 0o600)
  assert.equal(mode('secrets/db.env'), 0o600)
  assert.equal(mode('azure/msal_token_cache.json'), 0o600)
  assert.equal(mode('config.json'), 0o644) // not a secret: left as it was
  assert.ok(!existsSync(stale) && !existsSync(staleLog))
  assert.ok(existsSync(fresh)) // a pull may be writing it now
})

test('a whole copy from a machine with next to nothing is not taken over a state that has something', () => {
  assert.ok(wouldEmpty(6880, 0))
  assert.ok(wouldEmpty(6880, 5))      // a machine renamed or reinstalled: a new, empty state
  assert.ok(!wouldEmpty(6880, 6500))  // the fleet's state, a little behind or ahead
  assert.ok(!wouldEmpty(6880, 900))   // pruned hard, still the same state
  assert.ok(!wouldEmpty(12, 0))       // a new install here: takes whatever the fleet has
})
