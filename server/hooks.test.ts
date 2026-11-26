import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { badGate, coalescer, handlerFor, hookLive, hookStats, MAX_BODY, resetStats, targetsOf, verify, type Target } from './hooks.ts'

const SECRET = 'a'.repeat(64)
const sign = (body: string | Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

test('a signature verifies only with the same secret and the same bytes', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}')
  assert.equal(verify(SECRET, body, sign(body)), true)
  assert.equal(verify(SECRET, Buffer.from(`${body} `), sign(body)), false) // one byte more
  assert.equal(verify(SECRET, body, sign(body, 'b'.repeat(64))), false) // another secret
  assert.equal(verify(SECRET, body, undefined), false)
  assert.equal(verify(SECRET, body, 'sha1=' + 'a'.repeat(40)), false) // the old header's kind
  assert.equal(verify(SECRET, body, 'sha256=zz'), false)
  assert.equal(verify('', body, sign(body, '')), false) // no secret set: nothing passes
})

const tracked = [
  { id: 'o/r#1', repo: 'o/r', head: 'feat/a', headSha: 'aaa' },
  { id: 'o/r#2', repo: 'o/r', head: 'feat/b', headSha: 'bbb' },
  { id: 'o/r#3', repo: 'o/r', head: 'feat/a', headSha: 'ccc', closed: true },
  { id: 'x/y#1', repo: 'x/y', head: 'feat/a', headSha: 'aaa' },
]
const ctx = { me: 'me', tracked }
const ids = (e: string, p: object) => targetsOf(e, { repository: { full_name: 'o/r' }, ...p }, ctx).targets

test('each event names the PRs it is about', () => {
  assert.deepEqual(ids('pull_request', { action: 'synchronize', pull_request: { number: 7, user: { login: 'sam' } } }), [{ id: 'o/r#7' }])
  assert.deepEqual(ids('pull_request', { action: 'review_requested', requested_reviewer: { login: 'me' }, pull_request: { number: 7, user: { login: 'sam' } } }), [{ id: 'o/r#7', requested: true }])
  assert.deepEqual(ids('pull_request', { action: 'review_requested', requested_reviewer: { login: 'kim' }, pull_request: { number: 7, user: { login: 'sam' } } }), [{ id: 'o/r#7' }]) // someone else's request
  assert.deepEqual(ids('pull_request', { action: 'review_request_removed', requested_reviewer: { login: 'me' }, pull_request: { number: 7, user: { login: 'sam' } } }), [{ id: 'o/r#7', requested: false }])
  assert.deepEqual(ids('pull_request', { action: 'opened', pull_request: { number: 9, user: { login: 'me' } } }), [{ id: 'o/r#9', mine: true }])
  for (const e of ['pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread']) assert.deepEqual(ids(e, { pull_request: { number: 2 } }), [{ id: 'o/r#2' }])
  assert.deepEqual(ids('issue_comment', { issue: { number: 2, pull_request: { url: 'x' } } }), [{ id: 'o/r#2' }])
  assert.deepEqual(ids('issue_comment', { issue: { number: 2 } }), []) // an issue, not a PR
})

test('CI names its PRs, or its commit: the tracked open PRs with that head; only once it settles', () => {
  assert.deepEqual(ids('check_suite', { action: 'completed', check_suite: { head_sha: 'aaa', pull_requests: [{ number: 1 }, { number: 5 }] } }), [{ id: 'o/r#1' }, { id: 'o/r#5' }])
  assert.deepEqual(ids('check_run', { action: 'completed', check_run: { head_sha: 'bbb', pull_requests: [] } }), [{ id: 'o/r#2' }]) // a fork's PR: by sha
  assert.deepEqual(ids('check_run', { action: 'created', check_run: { head_sha: 'bbb', pull_requests: [{ number: 2 }] } }), [])
  assert.deepEqual(ids('status', { state: 'failure', sha: 'aaa' }), [{ id: 'o/r#1' }]) // not x/y's, not the closed one
  assert.deepEqual(ids('status', { state: 'pending', sha: 'aaa' }), [])
  assert.deepEqual(ids('status', { state: 'success', sha: 'zzz' }), [])
})

test('a push names the tracked open PRs whose head is that branch', () => {
  assert.deepEqual(ids('push', { ref: 'refs/heads/feat/a' }), [{ id: 'o/r#1' }])
  assert.deepEqual(ids('push', { ref: 'refs/tags/v1' }), [])
  assert.deepEqual(ids('push', { ref: 'refs/heads/main' }), [])
  assert.deepEqual(targetsOf('push', { ref: 'refs/heads/feat/a' }, ctx).targets, []) // no repository: nothing
  assert.deepEqual(ids('release', { action: 'published' }), [])
})

test('bad signatures cut a sender off for the rest of the minute, and everyone past four times that', () => {
  let t = 0
  const g = badGate(3, () => t)
  for (let i = 0; i < 3; i++) { assert.equal(g.blocked('1.2.3.4'), false); g.bad('1.2.3.4') }
  assert.equal(g.blocked('1.2.3.4'), true)
  assert.equal(g.blocked('5.6.7.8'), false)
  for (let i = 0; i < 9; i++) g.bad(`10.0.0.${i}`)
  assert.equal(g.blocked('5.6.7.8'), true) // 12 bad in all
  t = 61_000
  assert.equal(g.blocked('1.2.3.4'), false)
})

test('a burst on one PR is one read once it settles, and a busy PR is read at most every gap', async () => {
  const runs: Target[][] = []
  const c = coalescer((due) => { runs.push(due) }, 30, 120)
  c.add({ id: 'o/r#1' }); c.add({ id: 'o/r#1', requested: true }); c.add({ id: 'o/r#2' }); c.add({ id: 'o/r#1' })
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual(runs, [[{ id: 'o/r#1', requested: true, mine: undefined }, { id: 'o/r#2', requested: undefined, mine: undefined }]])
  c.add({ id: 'o/r#1' })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(runs.length, 1) // within the gap: waits
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(runs.length, 2)
})

test('the listener: only a signed POST to the hook path, answered 202 and handled after', async (t) => {
  resetStats()
  const got: [string, unknown][] = []
  let active = true
  const s = createServer(handlerFor({ secret: () => SECRET, active: () => active, deliver: (e, p) => got.push([e, p]) }, badGate(3)))
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  t.after(() => s.close())
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
  const post = (path: string, body: string, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })
  const body = JSON.stringify({ action: 'submitted', repository: { full_name: 'o/r' }, pull_request: { number: 1 } })
  const ok = { 'x-github-event': 'pull_request_review', 'x-hub-signature-256': sign(body) }

  assert.equal((await fetch(`${base}/hooks/github`)).status, 404) // GET
  assert.equal((await fetch(`${base}/`)).status, 404)
  assert.equal((await post('/api/prs', body, ok)).status, 404) // no app routes
  const yes = await post('/hooks/github', body, ok)
  assert.equal(yes.status, 202)
  assert.equal(await yes.text(), '') // nothing said back
  assert.deepEqual(got.map(([e]) => e), ['pull_request_review'])
  assert.equal(hookStats().today, 1)
  assert.equal(hookLive('o/r'), true)
  assert.equal(hookLive('x/y'), false)

  const ping = JSON.stringify({ zen: 'z', repository: { full_name: 'x/y' } })
  assert.equal((await post('/hooks/github', ping, { 'x-github-event': 'ping', 'x-hub-signature-256': sign(ping) })).status, 202)
  assert.equal(got.length, 1) // a ping only counts
  assert.equal(hookLive('x/y'), true)

  active = false // a worker: answered, nothing done
  assert.equal((await post('/hooks/github', body, ok)).status, 202)
  assert.equal(got.length, 1)

  const big = 'x'.repeat(MAX_BODY + 10)
  assert.equal((await post('/hooks/github', big, { 'x-github-event': 'push', 'x-hub-signature-256': sign(big) }).catch(() => ({ status: 413 }))).status, 413)

  for (let i = 0; i < 3; i++) assert.equal((await post('/hooks/github', body, { 'x-github-event': 'push' })).status, 401) // unsigned
  assert.equal((await post('/hooks/github', body, ok)).status, 429) // cut off now, even signed
})
