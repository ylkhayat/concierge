// Joining over the real worker server: who it is without the key, an ask from outside your Tailscale login waiting for
// approval with its code, the setup only to the asker once approved, and nothing with the key in it before that.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.CONCIERGE_FLEET = new URL('./testdata/fleet-test.mjs', import.meta.url).pathname
process.env.DECK_NAME = 'win'; process.env.HOLDER = 'win'; process.env.DECK_ROLE = 'primary'
const { STATE_DIR } = await import('./paths.ts')
mkdirSync(join(STATE_DIR, 'hosts'), { recursive: true })
writeFileSync(join(STATE_DIR, 'hosts', 'win.json'), JSON.stringify({ role: 'primary' }))
writeFileSync(join(STATE_DIR, 'worker-token'), 'z'.repeat(64) + '\n')
const { serveWorker } = await import('./worker.ts')
const join_ = await import('./join.ts')

const get = (u: string) => fetch(u).then(async (r) => ({ status: r.status, body: await r.json() as any }))
const post = (u: string, b: unknown) => fetch(u, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, body: await r.json() as any }))

test('a machine joins: asks, waits for approval with a code, then gets its setup', async () => {
  const w = serveWorker({ port: 0, host: '127.0.0.1', token: () => 'z'.repeat(64), start: () => { throw new Error('no runs') }, status: () => ({ name: 'win', slots: 0, running: 0, freeMb: 1 }), busy: async () => false,
    open: { hello: join_.hello, ask: join_.ask, status: join_.status } })
  await new Promise((r) => w.server.once('listening', r))
  const base = `http://127.0.0.1:${(w.server.address() as { port: number }).port}`
  try {
    // without the key: who this is, and nothing else
    assert.deepEqual((await get(`${base}/hello`)).body, { concierge: true, name: 'win', role: 'primary', main: 'win' })
    assert.equal((await get(`${base}/status`)).status, 403)
    // names are checked, and one already taken is refused
    assert.match((await post(`${base}/join`, { name: 'Bad Name!' })).body.error, /lowercase/)
    assert.match((await post(`${base}/join`, { name: 'win' })).body.error, /already/)
    // from 127.0.0.1 Tailscale can't say who asks: it waits for you, with a code, and no key in sight
    const a = (await post(`${base}/join`, { name: 'laptop' })).body
    assert.equal(a.state, 'waiting'); assert.match(a.code, /^\d{4}$/); assert.equal(a.setup, undefined)
    assert.equal((await get(`${base}/join/${a.id}`)).body.setup, undefined)
    assert.deepEqual(join_.waiting().map((j) => [j.name, j.code]), [['laptop', a.code]])
    // approved: the asker gets its setup (the key, its role, the main server)
    join_.decide(a.id, true)
    const s = (await get(`${base}/join/${a.id}`)).body
    assert.equal(s.state, 'approved')
    assert.equal(s.setup.key, 'z'.repeat(64)); assert.equal(s.setup.role, 'standby'); assert.equal(s.setup.main, 'win'); assert.equal(s.setup.name, 'laptop')
    assert.equal(join_.waiting().length, 0)
    // a denied one gets nothing
    const b = (await post(`${base}/join`, { name: 'other' })).body
    join_.decide(b.id, false)
    const d = (await get(`${base}/join/${b.id}`)).body
    assert.equal(d.state, 'denied'); assert.equal(d.setup, undefined)
  } finally { w.server.close() }
})

test('whois: only a Tailscale address can be vouched for, and a tagged node is never yours', async () => {
  assert.deepEqual(await join_.whoIs('127.0.0.1'), { mine: false })
  assert.deepEqual(await join_.whoIs('::ffff:192.168.1.4'), { mine: false })
})

test('whois: your own login is yours; another person or a tagged node is not', async () => {
  const { createServer } = await import('node:http')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const sock = join(mkdtempSync(join(tmpdir(), 'rd-ts-')), 'tailscaled.sock')
  const who: Record<string, unknown> = {
    '100.1.2.3': { UserProfile: { LoginName: 'me@x.com' }, Node: { Name: 'laptop' } },
    '100.9.9.9': { UserProfile: { LoginName: 'someone@y.com' }, Node: { Name: 'theirs' } },
    '100.5.5.5': { UserProfile: { LoginName: 'me@x.com' }, Node: { Name: 'concierge-mac', Tags: ['tag:concierge'] } },
  }
  const ts = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    const body = u.pathname === '/localapi/v0/status' ? { Self: { UserID: 7 }, User: { 7: { LoginName: 'me@x.com' } } } : who[u.searchParams.get('addr')!.split(':')[0]]
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(body ?? {}))
  })
  await new Promise<void>((r) => ts.listen(sock, r))
  process.env.TAILSCALE_SOCKET = sock
  try {
    assert.deepEqual(await join_.whoIs('100.1.2.3'), { login: 'me@x.com', mine: true })
    assert.deepEqual(await join_.whoIs('100.9.9.9'), { login: 'someone@y.com', mine: false })
    assert.deepEqual(await join_.whoIs('100.5.5.5'), { login: 'me@x.com', mine: false })
  } finally { ts.close(); delete process.env.TAILSCALE_SOCKET }
})
