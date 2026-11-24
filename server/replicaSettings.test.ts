// After a restart a machine takes the running machine's settings first: those are only the files at the top of the
// settings folder, read from disk (not the whole index), never a sign-in, an account's home, or this machine's mcp.env.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-settings-state-'))
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'rd-settings-config-'))

test('the settings a machine sends first: the top-level files only', async () => {
  const { CONFIG_DIR } = await import('./paths.ts')
  mkdirSync(join(CONFIG_DIR, 'accounts', 'person', 'claude'), { recursive: true })
  writeFileSync(join(CONFIG_DIR, 'config.json'), '{"repos":{}}')
  writeFileSync(join(CONFIG_DIR, 'secrets.json'), '{}')
  writeFileSync(join(CONFIG_DIR, 'mcp.env'), 'X=1') // this machine's own
  writeFileSync(join(CONFIG_DIR, 'accounts', 'person', 'claude', '.credentials.json'), '{}') // a sign-in, and below the top
  const { replicaExtras } = await import('./replica.ts')
  const list = await replicaExtras['replica-settings']() as [string, number, number][]
  assert.deepEqual(list.map(([k]) => k).sort(), ['config:config.json', 'config:secrets.json'])
  assert.equal(list.find(([k]) => k === 'config:config.json')![1], 12) // its size, from disk
})
