import assert from 'node:assert/strict'
import { test } from 'node:test'
process.env.LINEAR_API_KEY = 'lin_test'
const { myTickets, forgetTickets } = await import('./linear.ts')

// Linear, stood in for: the list by its fields asked, and tickets by id
const node = (id: string, updatedAt: string, title = id) => ({ identifier: id, title, url: `https://linear.app/x/${id}`, description: 'd'.repeat(2000), priority: 2, updatedAt, createdAt: updatedAt,
  state: { name: 'Todo', type: 'unstarted' }, team: { key: 'AC' }, labels: { nodes: [] }, assignee: { name: 'Me', isMe: true }, comments: { nodes: [] }, attachments: { nodes: [] }, branchName: id })
let list = [node('AC-1', '2026-11-01T00:00:00Z'), node('AC-2', '2026-11-01T00:00:00Z')]
const asked: string[] = []
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const q = JSON.parse(init.body).query as string
  if (q.includes('assignedIssues')) {
    const light = !q.includes('description')
    asked.push(light ? 'list:light' : 'list:whole')
    return { json: async () => ({ data: { viewer: { assignedIssues: { nodes: light ? list.map((n) => ({ identifier: n.identifier, updatedAt: n.updatedAt })) : list } } } }) }
  }
  const ids = [...q.matchAll(/issue\(id: "([^"]+)"\)/g)].map((m) => m[1])
  asked.push(`byId:${ids.join(',')}`)
  return { json: async () => ({ data: Object.fromEntries(ids.map((id, i) => [`t${i}`, list.find((n) => n.identifier === id)])) }) }
}) as unknown as typeof fetch

test('between whole reads, a poll asks what changed and reads only that in full', async () => {
  forgetTickets()
  const t0 = Date.parse('2026-11-28T10:00:00Z')
  assert.deepEqual((await myTickets(t0)).map((t) => t.id), ['AC-1', 'AC-2'])
  assert.deepEqual(asked.splice(0), ['list:whole'])
  // a minute later, nothing changed: the light list only
  assert.deepEqual((await myTickets(t0 + 60_000)).map((t) => t.id), ['AC-1', 'AC-2'])
  assert.deepEqual(asked.splice(0), ['list:light'])
  // one changed, one is new, one left the list
  list = [node('AC-2', '2026-11-28T10:01:30Z', 'renamed'), node('AC-3', '2026-11-28T10:01:00Z')]
  const got = await myTickets(t0 + 120_000)
  assert.deepEqual(got.map((t) => [t.id, t.title]), [['AC-2', 'renamed'], ['AC-3', 'AC-3']])
  assert.deepEqual(asked.splice(0), ['list:light', 'byId:AC-2,AC-3'])
  // five minutes after the whole read: a whole one again
  await myTickets(t0 + 5 * 60_000)
  assert.deepEqual(asked.splice(0), ['list:whole'])
})
