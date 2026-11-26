import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeFunnel, connectRepo, funnelBlocker, funnelError, funnelOffArgs, funnelOnArgs, funnelOnIn, openFunnel, pingHook, removeHook, scopesAllowHooks, type Call, type Run } from './hookSetup.ts'
import { deviceCode } from './githubLogin.ts'

const self = { DNSName: 'box.tail123.ts.net.', Capabilities: ['https', 'funnel', 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000'] }
const status = JSON.stringify({
  TCP: { 8443: { HTTPS: true } },
  Web: { 'box.tail123.ts.net:8443': { Handlers: { '/hooks/github': { Proxy: 'http://127.0.0.1:8790/hooks/github' } } } },
  AllowFunnel: { 'box.tail123.ts.net:8443': true },
})

test('the funnel opens only the hook path, on its own port', () => {
  assert.deepEqual(funnelOnArgs(8790), ['funnel', '--bg', '--yes', '--https=8443', '--set-path=/hooks/github', 'http://127.0.0.1:8790/hooks/github'])
  assert.deepEqual(funnelOffArgs(), ['funnel', '--yes', '--https=8443', '--set-path=/hooks/github', 'off'])
  assert.equal(funnelOnIn(status, 'box.tail123.ts.net.', 8790), true)
  assert.equal(funnelOnIn(status, 'box.tail123.ts.net', 8791), false) // another listener
  assert.equal(funnelOnIn(JSON.stringify({ ...JSON.parse(status), AllowFunnel: {} }), 'box.tail123.ts.net', 8790), false) // served on the tailnet only
  assert.equal(funnelOnIn('{}', 'box.tail123.ts.net', 8790), false)
  assert.equal(funnelOnIn('No serve config', 'box.tail123.ts.net', 8790), false)
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

test('opening the funnel runs the command, then checks it took', async () => {
  const calls: string[][] = []
  const run = (answers: Record<string, { code: number; out: string }>): Run => async (args) => { calls.push(args); return answers[args[1]] ?? answers.default }
  assert.equal(await openFunnel(run({ status: { code: 0, out: status }, default: { code: 0, out: 'Available on the internet:\nhttps://box.tail123.ts.net:8443/hooks/github' } }), self, 8790), 'https://box.tail123.ts.net:8443/hooks/github')
  assert.deepEqual(calls.map((c) => c[1]), ['--bg', 'status'])
  await assert.rejects(openFunnel(run({ default: { code: 1, out: 'Funnel is not enabled on your tailnet.\nTo enable, visit:\nhttps://login.tailscale.com/f/funnel?node=abc' } }), self, 8790), /login\.tailscale\.com\/f\/funnel/)
  await assert.rejects(openFunnel(run({ status: { code: 0, out: '{}' }, default: { code: 0, out: '' } }), self, 8790), /didn't take/)
  calls.length = 0
  await assert.rejects(openFunnel(run({ default: { code: 0, out: '' } }), { ...self, Capabilities: ['https'] }, 8790), /node attribute/)
  assert.equal(calls.length, 0) // nothing run when its status already says no
  await closeFunnel(run({ default: { code: 0, out: '' } }))
  await closeFunnel(run({ default: { code: 1, out: 'error: handler does not exist' } })) // already off
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
