import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bankFor, forCodex } from './bank.ts'
import type { McpServer } from './connections.ts'

const linear: McpServer = { name: 'linear-key', service: 'Linear', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer K' }, coveredByClaudeAi: true }
const sentry: McpServer = { name: 'sentry-token', service: 'Sentry', command: 'npx', args: ['-y', '@sentry/mcp-server@latest'], env: { SENTRY_ACCESS_TOKEN: 'T' }, coveredByClaudeAi: true }
const mine: McpServer = { name: 'wiki', service: 'wiki', url: 'https://wiki.example/mcp', login: true }
const all = [linear, sentry, mine], names = (x: { servers: McpServer[] }) => x.servers.map((s) => s.name)

test('the bank fills gaps: each run gets what its account does not already have its own way', () => {
  assert.deepEqual(names(bankFor(all, 'claude', true, false, true)), ['wiki']) // the first Claude account: its login brings Linear and Sentry; the rest is added
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

test("the first Claude account gets what neither its login nor its own configuration brings; a command connection reaches every tool", () => {
  const cmd: McpServer = { name: 'mongo', service: 'mongo', command: 'node', args: ['bank-env.mjs', 'secrets.json', 'mongo', '--', 'npx', '-y', 'mongodb-mcp-server'], mine: true }
  const added: McpServer = { ...mine, inAccount: true }
  assert.deepEqual(names(bankFor([linear, sentry, added, cmd], 'claude', true, false, true)), ['mongo'])
  assert.equal(bankFor([linear, sentry, added], 'claude', true, false, true).set, 'none')
  assert.deepEqual(names(bankFor([linear, cmd], 'copilot', false, false, true)), ['linear-key', 'mongo'])
  const { conf, env } = forCodex([cmd])
  assert.deepEqual([conf, env], [['mcp_servers.mongo.command="node"', 'mcp_servers.mongo.args=["bank-env.mjs","secrets.json","mongo","--","npx","-y","mongodb-mcp-server"]'], {}]) // no value on its command line
})

test("a connection names its secrets as ${NAME}: read from this machine's mcp.env, a default after :-, and what is missing said", async () => {
  const { expand, missingIn, parseEnv } = await import('./localEnv.ts')
  const vals = parseEnv('# my values\nMONGO_DEV_URI="mongodb+srv://u:p@h/db?x=1"\nexport TOKEN=abc # a comment\nEMPTY=\n')
  assert.deepEqual(vals, { MONGO_DEV_URI: 'mongodb+srv://u:p@h/db?x=1', TOKEN: 'abc', EMPTY: '' })
  assert.equal(expand('Bearer ${TOKEN}', vals), 'Bearer abc')
  assert.equal(expand('${MODE:-read}', vals), 'read')
  assert.deepEqual(missingIn(['${MONGO_DEV_URI}', '${MONGO_PROD_URI}', '${MODE:-x}', 'plain'], vals), ['MONGO_PROD_URI'])
})
