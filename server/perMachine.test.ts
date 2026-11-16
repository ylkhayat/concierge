import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// two machines: this one is "mac", the other "windows" (their heartbeats name them)
const root = mkdtempSync(join(tmpdir(), 'rd-permachine-'))
process.env.XDG_STATE_HOME = root
const fleetMod = join(root, 'fleet.mjs')
writeFileSync(fleetMod, "export default { machine: 'mac', elsewhere: () => undefined, mayWrite: () => true }")
process.env.CONCIERGE_FLEET = fleetMod
const dir = join(root, 'concierge')
mkdirSync(join(dir, 'hosts'), { recursive: true })
for (const m of ['mac', 'windows']) writeFileSync(join(dir, 'hosts', `${m}.json`), '{}')
const { mine, readLines, readMerged } = await import('./perMachine.ts')

test('each machine writes its own copy, and a feed reads every copy in time order', async () => {
  const log = join(dir, 'logs', 'acme_api_5034.jsonl')
  assert.equal(mine(log), join(dir, 'logs', 'acme_api_5034.mac.jsonl'))
  mkdirSync(join(dir, 'logs'), { recursive: true })
  writeFileSync(log, '{"timestamp":"2026-11-10T10:00:00Z","n":1}\n') // from before copies per machine
  writeFileSync(mine(log), '{"timestamp":"2026-11-11T09:00:00Z","n":3}\n{"no":"time","n":4}\n')
  writeFileSync(join(dir, 'logs', 'acme_api_5034.windows.jsonl'), '{"type":"review-deck","activity":{"at":"2026-11-10T12:00:00Z"},"n":2}\n')
  writeFileSync(join(dir, 'logs', 'acme_api_5034.sync-conflict-20261110-1-X.jsonl'), '{"timestamp":"2026-11-10T11:00:00Z","n":99}\n')
  const order = (await readLines(log)).trim().split('\n').map((l) => JSON.parse(l).n)
  assert.deepEqual(order, [1, 2, 3, 4]) // a line with no time stays after the one before it; a conflict copy is not a copy
})

test('a folder map merges entry by entry, newest summary winning; anything else is the newest copy', () => {
  const nodes = join(dir, 'atlas', 'r', 'nodes.json')
  mkdirSync(join(dir, 'atlas', 'r'), { recursive: true })
  writeFileSync(mine(nodes), JSON.stringify({ 'apps/a': { at: '2026-11-12', s: 'mac' }, 'apps/b': { at: '2026-11-01', s: 'mac' } }))
  writeFileSync(join(dir, 'atlas', 'r', 'nodes.windows.json'), JSON.stringify({ 'apps/b': { at: '2026-11-05', s: 'win' }, 'apps/c': { at: '2026-11-02', s: 'win' } }))
  const m = readMerged<Record<string, { s: string }>>(nodes, 'entries')!
  assert.deepEqual(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.s])), { 'apps/a': 'mac', 'apps/b': 'win', 'apps/c': 'win' })
})
