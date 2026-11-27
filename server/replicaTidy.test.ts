import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { tidy } from './replica.ts'

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
