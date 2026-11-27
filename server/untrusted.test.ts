import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UNTRUSTED_ARGS, untrustedEnv } from './untrusted.ts'

test('a run on someone else\'s PR keeps GitHub\'s token and its sign-in, and nothing else secret', () => {
  const env = untrustedEnv({ PATH: '/bin', HOME: '/h', GITHUB_TOKEN: 'g', CLAUDE_CODE_OAUTH_TOKEN: 'c', LINEAR_API_KEY: 'l', CONCIERGE_PASSWORD: 'p', MDB_MCP_CONNECTION_STRING: 'm', SENTRY_AUTH_TOKEN: 's', OPENAI_API_KEY: 'o', AWS_SECRET_ACCESS_KEY: 'a', DECK_NAME: 'mac' })
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'DECK_NAME', 'GITHUB_TOKEN', 'HOME', 'PATH'])
})

test('it can\'t print its environment, hand out the token, or read credential files', () => {
  for (const rule of ['Bash(printenv:*)', 'Bash(gh auth token:*)', 'Bash(gh gist:*)', 'Read(~/.config/gh/**)', 'Read(~/.claude/.credentials.json)', 'Read(**/.env)']) assert.ok(UNTRUSTED_ARGS.includes(rule), rule)
  assert.equal(UNTRUSTED_ARGS[0], '--disallowedTools')
})

test("a review of someone else's PR keeps crit's settings (it won't start without them) and still loses every secret", async () => {
  const { untrustedEnv } = await import('./untrusted.ts')
  const env = untrustedEnv({ CRIT_HOST: '0.0.0.0', CRIT_ALLOW_UNAUTHENTICATED_NETWORK: '1', LINEAR_API_KEY: 'k', BASIC_AUTH: 'x', AUTH_HEADER: 'y', MDB_MCP_CONNECTION_STRING: 'z', PATH: '/bin', GITHUB_TOKEN: 'g' })
  assert.deepEqual(Object.keys(env).sort(), ['CRIT_ALLOW_UNAUTHENTICATED_NETWORK', 'CRIT_HOST', 'GITHUB_TOKEN', 'PATH'])
})

test('a shell command that names where the keys are kept, or calls Concierge itself, is refused too', () => {
  for (const rule of ['Bash(*.config/review-deck*)', 'Bash(*secrets.json*)', 'Bash(*worker-token*)', 'Bash(*claude-home/projects*)', 'Bash(*127.0.0.1:4747*)', 'Bash(*localhost:4748*)']) assert.ok(UNTRUSTED_ARGS.includes(rule), rule)
})
