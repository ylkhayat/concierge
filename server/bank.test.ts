import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bankFor, forCodex } from './bank.ts'
import type { McpServer } from './connections.ts'

const linear: McpServer = { name: 'linear-key', service: 'Linear', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer K' }, coveredByClaudeAi: true }
const sentry: McpServer = { name: 'sentry-token', service: 'Sentry', command: 'npx', args: ['-y', '@sentry/mcp-server@latest'], env: { SENTRY_ACCESS_TOKEN: 'T' }, coveredByClaudeAi: true }
const mine: McpServer = { name: 'wiki', service: 'wiki', url: 'https://wiki.example/mcp', login: true }
const all = [linear, sentry, mine], names = (x: { servers: McpServer[] }) => x.servers.map((s) => s.name)

test('the bank fills gaps: each run gets what its account does not already have its own way', () => {
  assert.deepEqual(bankFor(all, 'claude', true, false, true).set, 'none') // the first Claude account has all of it already
  assert.deepEqual(names(bankFor(all, 'claude', false, false, true)), ['wiki']) // another Claude login: its claude.ai brings Linear and Sentry
  assert.deepEqual(names(bankFor(all, 'copilot', false, false, true)), ['linear-key', 'sentry-token']) // no way to sign in to a browser-login one
  assert.deepEqual(names(bankFor(all, 'openai', false, false, true)), ['linear-key', 'sentry-token'])
  assert.deepEqual(names(bankFor(all, 'llama', false, false, true)), ['linear-key', 'sentry-token', 'wiki']) // Claude Code itself: it can use the login
})

test('bank only: every run gets exactly the bank, the first account too', () => {
  assert.deepEqual(names(bankFor(all, 'claude', true, true, true)), ['linear-key', 'sentry-token', 'wiki'])
  assert.deepEqual(names(bankFor(all, 'copilot', false, true, true)), ['linear-key', 'sentry-token'])
})

test("Codex takes the bank as overrides, an address's key by the name of a variable", () => {
  const { conf, env } = forCodex([linear, sentry])
  assert.deepEqual(conf, [
    'mcp_servers.linear-key.url="https://mcp.linear.app/mcp"', 'mcp_servers.linear-key.bearer_token_env_var="CONCIERGE_BANK_LINEAR_KEY"',
    'mcp_servers.sentry-token.command="npx"', 'mcp_servers.sentry-token.args=["-y","@sentry/mcp-server@latest"]', 'mcp_servers.sentry-token.env.SENTRY_ACCESS_TOKEN="T"',
  ])
  assert.deepEqual(env, { CONCIERGE_BANK_LINEAR_KEY: 'K' })
  assert.ok(!conf.join(' ').includes('Bearer')) // the address's key itself is only in the environment
})
