import assert from 'node:assert/strict'
import { test } from 'node:test'

test('a machine is behind when its commit isn\'t the latest, and overdue once an update had time to land', async () => {
  const real = globalThis.fetch
  const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const heads: Record<string, { sha: string; at: string }> = { 'o/app': { sha: 'c64ac77aaaa', at: at(200) }, 'o/fleet': { sha: '1476f9fbbbb', at: at(10) } }
  globalThis.fetch = (async (url: string) => {
    const h = heads[String(url).match(/repos\/(.+)\/commits/)![1]]
    return new Response(JSON.stringify({ sha: h.sha, commit: { committer: { date: h.at } } }))
  }) as typeof fetch
  process.env.DECK_REPOS = 'o/app o/fleet'
  const { readLatest, behind, overdue } = await import('./versions.ts')
  await readLatest()
  globalThis.fetch = real
  assert.deepEqual(behind({ version: '499-c64ac77', fleet: '1476f9f' }), [])
  assert.deepEqual(behind({ version: '498-aae6cc5', fleet: '1476f9f' }), ['app'])
  assert.deepEqual(behind({}), ['app', 'fleet']) // a build from before versions were reported
  assert.equal(overdue({ version: '498-aae6cc5', fleet: '1476f9f' }), true) // the app commit is 200 min old
  assert.equal(overdue({ version: '499-c64ac77', fleet: '0000000' }), false) // fleet's is 10 min old: its update may be on the way
})
