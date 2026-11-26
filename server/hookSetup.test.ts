import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askDoor, connectRepo, doorAnswer, doorResult, funnelBlocker, funnelError, pingHook, removeHook, scopesAllowHooks, type Call } from './hookSetup.ts'
import { deviceCode } from './githubLogin.ts'

const self = { DNSName: 'box.tail123.ts.net.', Capabilities: ['https', 'funnel', 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000'] }
test('the app asks the fleet for the door and reads its answer, never running Tailscale itself', async () => {
  const hosts = mkdtempSync(join(tmpdir(), 'door-'))
  const at = askDoor(hosts, true, 8790, 1000)
  assert.deepEqual(JSON.parse(readFileSync(join(hosts, 'hooks-funnel.json'), 'utf8')), { on: true, port: 8790, at: 1000 })
  assert.equal(doorResult(hosts, 'windows'), undefined) // the standby hasn't said anything yet
  assert.equal(await doorAnswer(hosts, 'windows', at, 50, 10), undefined) // and doesn't in time: no answer
  writeFileSync(join(hosts, 'hooks-funnel.windows.result.json'), JSON.stringify({ on: false, ok: true, asked: 999, at: 1 })) // an older ask's
  assert.equal(await doorAnswer(hosts, 'windows', at, 50, 10), undefined)
  writeFileSync(join(hosts, 'hooks-funnel.windows.result.json'), JSON.stringify({ on: true, ok: true, asked: 1000, at: 2 }))
  assert.deepEqual(await doorAnswer(hosts, 'windows', at, 50, 10), { on: true, ok: true, asked: 1000, at: 2 })
  assert.equal(doorResult(hosts, 'mac'), undefined) // each machine's standby answers for itself
  assert.equal(doorResult(hosts, undefined), undefined) // no fleet, no door
})

test('what stops Funnel is said before trying, with where to fix it', () => {
  assert.equal(funnelBlocker(self), undefined)
  assert.match(funnelBlocker({ ...self, Capabilities: ['https'] })!, /admin\/acls.*"funnel" node attribute/)
  assert.match(funnelBlocker({ ...self, Capabilities: ['funnel'] })!, /HTTPS certificates/)
  assert.equal(funnelBlocker({ ...self, Capabilities: [], CapMap: { https: [], funnel: [] } }), undefined) // newer status: CapMap
  assert.match(funnelBlocker(undefined)!, /isn't running/)
  assert.match(funnelError('Funnel not available; "funnel" node attribute not set. See https://tailscale.com/s/no-funnel.'), /isn't allowed/)
  assert.match(funnelError('Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/funnel?node=abc\n'), /login\.tailscale\.com\/f\/funnel\?node=abc/)
  assert.match(funnelError('error: HTTPS is not enabled for your tailnet'), /HTTPS certificates are off/)
  assert.match(funnelError('something odd happened'), /Tailscale refused: something odd happened/)
})

type Reply = { status: number; json?: unknown }
const fake = (routes: Record<string, Reply>) => {
  const seen: string[] = []
  const call: Call = async (method, path, body) => {
    seen.push(`${method} ${path}${body ? ' ' + JSON.stringify(body) : ''}`)
    const r = routes[`${method} ${path}`] ?? { status: 404, json: { message: 'Not Found' } }
    return { status: r.status, json: (r.json ?? {}) as never }
  }
  return { call, seen }
}
const URL_ = 'https://box.tail123.ts.net:8443/hooks/github'

test('a repository gets its webhook only with admin rights, and an existing one is updated, never doubled', async () => {
  const made = fake({ 'GET /repos/o/r': { status: 200, json: { permissions: { admin: true } } }, 'GET /repos/o/r/hooks?per_page=100': { status: 200, json: [{ id: 3, config: { url: 'https://elsewhere' } }] }, 'POST /repos/o/r/hooks': { status: 201, json: { id: 42 } } })
  assert.deepEqual(await connectRepo(made.call, 'o/r', URL_, 's3cret'), { repo: 'o/r', ok: true, id: 42, reused: false })
  const body = JSON.parse(made.seen.at(-1)!.split(' ').slice(2).join(' '))
  assert.deepEqual(body, { name: 'web', active: true, events: ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'issue_comment', 'check_suite', 'check_run', 'status', 'push'], config: { url: URL_, content_type: 'json', secret: 's3cret', insecure_ssl: '0' } })

  const reuse = fake({ 'GET /repos/o/r': { status: 200, json: { permissions: { admin: true } } }, 'GET /repos/o/r/hooks?per_page=100': { status: 200, json: [{ id: 7, config: { url: URL_ } }] }, 'PATCH /repos/o/r/hooks/7': { status: 200, json: { id: 7 } } })
  assert.deepEqual(await connectRepo(reuse.call, 'o/r', URL_, 's'), { repo: 'o/r', ok: true, id: 7, reused: true })
  assert.equal(reuse.seen.some((s) => s.startsWith('POST')), false)

  const notAdmin = fake({ 'GET /repos/o/r': { status: 200, json: { permissions: { admin: false } } } })
  assert.deepEqual(await connectRepo(notAdmin.call, 'o/r', URL_, 's'), { repo: 'o/r', ok: false, problem: 'no-admin', text: 'Needs admin on this repository: it keeps polling' })
  assert.equal(notAdmin.seen.length, 1)
  assert.equal((await connectRepo(fake({}).call, 'o/r', URL_, 's') as { problem: string }).problem, 'no-admin') // can't even see it

  const scope = fake({ 'GET /repos/o/r': { status: 200, json: { permissions: { admin: true } } }, 'GET /repos/o/r/hooks?per_page=100': { status: 404 } })
  assert.equal((await connectRepo(scope.call, 'o/r', URL_, 's') as { problem: string }).problem, 'scope') // admin, yet refused: the token's
  const failed = fake({ 'GET /repos/o/r': { status: 200, json: { permissions: { admin: true } } }, 'GET /repos/o/r/hooks?per_page=100': { status: 200, json: [] }, 'POST /repos/o/r/hooks': { status: 422, json: { message: 'Validation Failed' } } })
  assert.deepEqual(await connectRepo(failed.call, 'o/r', URL_, 's'), { repo: 'o/r', ok: false, problem: 'error', text: 'GitHub 422: Validation Failed' })
})

test('removing and pinging a hook', async () => {
  assert.equal(await removeHook(fake({ 'DELETE /repos/o/r/hooks/7': { status: 204 } }).call, 'o/r', 7), true)
  assert.equal(await removeHook(fake({}).call, 'o/r', 7), true) // already gone
  assert.equal(await removeHook(fake({ 'DELETE /repos/o/r/hooks/7': { status: 403 } }).call, 'o/r', 7), false)
  assert.deepEqual(await pingHook(fake({ 'POST /repos/o/r/hooks/7/pings': { status: 204 } }).call, 'o/r', 7), { ok: true })
  assert.deepEqual(await pingHook(fake({}).call, 'o/r', 7), { ok: false, gone: true, text: 'Not Found' })
})

test('scopes: repo or a hook scope may make webhooks; a token that names none says nothing', () => {
  assert.equal(scopesAllowHooks(['admin:repo_hook']), true)
  assert.equal(scopesAllowHooks(['repo', 'read:org']), true)
  assert.equal(scopesAllowHooks(['read:org', 'gist']), false)
  assert.equal(scopesAllowHooks([]), false)
  assert.equal(scopesAllowHooks(undefined), undefined) // fine-grained: its Webhooks permission decides
})

test("gh's device sign-in: the code and where to enter it, from what it prints (login and refresh alike)", () => {
  const refresh = '! First copy your one-time code: 1A2B-3C4D\nOpen this URL to continue in your web browser: https://github.com/login/device\n'
  assert.deepEqual(deviceCode(refresh), { code: '1A2B-3C4D', url: 'https://github.com/login/device' })
  const tty = '! First copy your one-time code: ABCD-0123\nPress Enter to open https://github.com/login/device in your browser... '
  assert.deepEqual(deviceCode(tty), { code: 'ABCD-0123', url: 'https://github.com/login/device' })
  assert.equal(deviceCode('! First copy your one-time code: ABCD-0123\n'), undefined) // the link not yet printed
  assert.equal(deviceCode('error refreshing credentials: not attached to a terminal'), undefined)
})
