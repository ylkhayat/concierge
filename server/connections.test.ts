import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMcpList } from './connections.ts'

test('reads claude mcp list: connected, needs a login, failed', () => {
  const out = `Checking MCP server health…

plugin:linear:linear: https://mcp.linear.app/mcp (HTTP) - ! Needs authentication
plugin:nx:nx-mcp: npx nx-mcp@latest --minimal - ✔ Connected
broken: npx nope - ✘ Failed to connect
SessionEnd hook [x] failed: not found`
  assert.deepEqual(parseMcpList(out).map((c) => `${c.name}=${c.status}`), ['plugin:linear:linear=needs-auth', 'plugin:nx:nx-mcp=connected', 'broken=failed'])
})

test("a connector by key is allowed exactly where the service's tools were allowed before", async () => {
  const { withAliases } = await import('./connections.ts')
  // exec runs: the whole service → the whole new connector
  assert.deepEqual(withAliases(['Read', 'mcp__claude_ai_Sentry'], ['mcp__claude_ai_Sentry'], 'mcp__sentry-token'), ['Read', 'mcp__claude_ai_Sentry', 'mcp__sentry-token'])
  // a read-only action: only the same read tools, never the rest (update_issue stays out)
  assert.deepEqual(withAliases(['mcp__claude_ai_Sentry__search_issues', 'mcp__claude_ai_Sentry__get_sentry_resource'], ['mcp__claude_ai_Sentry'], 'mcp__sentry-token'),
    ['mcp__claude_ai_Sentry__search_issues', 'mcp__claude_ai_Sentry__get_sentry_resource', 'mcp__sentry-token__search_issues', 'mcp__sentry-token__get_sentry_resource'])
  // a look-alike prefix is not the service
  assert.deepEqual(withAliases(['mcp__claude_ai_SentryX__a'], ['mcp__claude_ai_Sentry'], 'mcp__sentry-token'), ['mcp__claude_ai_SentryX__a'])
})

test('claude mcp add gets the connector name before its -e options (they would swallow it)', async () => {
  const { addArgsFor } = await import('./connections.ts')
  for (const fix of ['sentry-token'] as const) {
    const args = addArgsFor(fix, 'x'.repeat(30))
    assert.ok(!args[0].startsWith('-'), `${fix}: name first, got ${args[0]}`)
    assert.ok(args.indexOf('--') > args.lastIndexOf('-e'), `${fix}: options before the command`)
  }
})

test('a login address is cut where the terminal link escape closes it', () => {
  const raw = '\u001b]8;;https://mcp.sentry.dev/oauth/authorize?resource=https%3A%2F%2Fmcp.sentry.dev%2Fmcp\u0007https://mcp.sentry.dev/oauth/authorize?resource=x\u001b]8;;\u0007'
  const m = raw.match(/https:\/\/\S+authoriz\S+/)!
  assert.equal(m[0].split(/[\u0007\u001b]/)[0], 'https://mcp.sentry.dev/oauth/authorize?resource=https%3A%2F%2Fmcp.sentry.dev%2Fmcp')
})
