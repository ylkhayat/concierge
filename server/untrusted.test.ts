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
