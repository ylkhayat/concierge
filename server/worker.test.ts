import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { allowed, call, remoteAgent, serveWorker } from './worker.ts'
import type { AgentProcess } from './providers.ts'

// a stand-in agent: echoes stdin back, prefixed, until stdin ends (or it is killed)
const start = () => spawn('sh', ['-c', 'while read l; do echo "got $l"; done; echo bye >&2; exit 3'], { stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as AgentProcess
const ended = (p: AgentProcess) => new Promise<[number | null, string | null, string[]]>((ok) => {
  const errs: string[] = []
  p.on('error', (e: Error) => errs.push(e.message))
  p.on('close', (c: number | null, s: string | null) => ok([c, s, errs]))
})
const read = (s: NodeJS.ReadableStream) => { let t = ''; s.on('data', (c) => { t += c }); return () => t }

function worker(slots = 2) {
  const w = serveWorker({ port: 0, host: '127.0.0.1', token: () => 't'.repeat(40), start, status: () => ({ name: 'win', slots, running: w.hosted.size, freeMb: 9000 }), busy: async () => false })
  return new Promise<typeof w & { base: string }>((ok) => w.server.on('listening', () => ok({ ...w, base: `http://127.0.0.1:${(w.server.address() as AddressInfo).port}` })))
}

test('an agent on another machine streams back, takes stdin, and ends with its exit code', async () => {
  const w = await worker()
  const p = remoteAgent('win', w.base, 't'.repeat(40), { provider: 'claude', args: [], cwd: '/', stdin: true })
  const out = read(p.stdout), err = read(p.stderr), done = ended(p)
  p.stdin!.write('one\n') // before the worker even answered: queued, not lost
  p.stdin!.write('two\n')
  p.stdin!.end()
  const [code, , errs] = await done
  assert.equal(out(), 'got one\ngot two\n')
  assert.equal(err(), 'bye\n')
  assert.equal(code, 3)
  assert.deepEqual(errs, [])
  assert.equal(w.hosted.size, 0)
  w.server.closeAllConnections(); w.server.close()
})

test('kill stops it over there; a wrong token, a full machine or a dropped stream say so', async () => {
  const w = await worker(1)
  const p = remoteAgent('win', w.base, 't'.repeat(40), { provider: 'claude', args: [], cwd: '/', stdin: true })
  await new Promise((r) => setTimeout(r, 150))
  // full: the second one is refused, as an error the runner treats as a lost connection
  const q = remoteAgent('win', w.base, 't'.repeat(40), { provider: 'claude', args: [], cwd: '/' })
  assert.match((await ended(q))[2][0], /win is full/)
  p.kill('SIGTERM')
  const [, signal] = await ended(p)
  assert.equal(signal, 'SIGTERM')
  await assert.rejects(call(w.base, 'nope', 'GET', '/status'), /not allowed/)
  assert.equal((await call<{ name: string }>(w.base, 't'.repeat(40), 'GET', '/status')).name, 'win')
  // the worker going away mid-run: an error the runner reads as a lost connection, then close
  const r = remoteAgent('win', w.base, 't'.repeat(40), { provider: 'claude', args: [], cwd: '/', stdin: true })
  await new Promise((res) => setTimeout(res, 150))
  w.server.closeAllConnections(); w.server.close()
  assert.match((await ended(r))[2][0], /lost the connection to win/)
})

test('only loopback and tailnet addresses may call', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '100.65.23.109', '100.127.1.1', 'fd7a:115c:a1e0::1']) assert.ok(allowed(ip), ip)
  for (const ip of ['192.168.1.5', '10.0.0.1', '100.63.0.1', '100.128.0.1', '8.8.8.8', '']) assert.ok(!allowed(ip), ip)
})

test('after a new key, the one before still works (runs in flight), and nothing else does', async () => {
  const w = serveWorker({ port: 0, host: '127.0.0.1', token: () => ['n'.repeat(40), 'o'.repeat(40)], start, status: () => ({ name: 'win', slots: 1, running: 0, freeMb: 9000 }), busy: async () => false, logs: () => ['a line'] })
  await new Promise((ok) => w.server.on('listening', ok))
  const base = `http://127.0.0.1:${(w.server.address() as AddressInfo).port}`
  assert.deepEqual(await call(base, 'n'.repeat(40), 'GET', '/logs'), { lines: ['a line'] })
  assert.equal((await call<{ name: string }>(base, 'o'.repeat(40), 'GET', '/status')).name, 'win')
  await assert.rejects(call(base, 'x'.repeat(40), 'GET', '/status'), /not allowed/)
  w.server.closeAllConnections(); w.server.close()
})
