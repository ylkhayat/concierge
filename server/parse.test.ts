import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-parse-'))
const { parseLine, refusalsOf } = await import('./runner.ts')
const line = (o: object) => JSON.stringify(o)

test('a refused tool call shows in the feed the moment it happens, with what was refused', () => {
  const a = parseLine(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'This Bash command contains multiple operations. The following part requires approval: cd /x && ls' }] } }))
  assert.equal(a.length, 1)
  assert.equal(a[0].kind, 'denied')
  assert.match(a[0].text, /requires approval: cd \/x/)
  const blocked = parseLine(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: "jq in '/a/b.json' was blocked. For security, Claude Code may only process JSON from files in the allowed working directories" }] }] } }))
  assert.equal(blocked[0].kind, 'denied')
})

test('a tool that failed reads as an error, not a success; one that worked adds nothing', () => {
  assert.deepEqual(parseLine(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1\nfatal: not a git repository' }] } })).map((a) => a.kind), ['error'])
  assert.deepEqual(parseLine(line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: false, content: 'ok' }] } })), [])
  // a subagent's own tool results stay with the subagent
  assert.deepEqual(parseLine(line({ type: 'user', parent_tool_use_id: 't1', message: { content: [{ type: 'tool_result', is_error: true, content: 'boom' }] } })), [])
})

test('connectors that failed to start are said at the start of a run', () => {
  const a = parseLine(line({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'linear', status: 'connected' }, { name: 'claude.ai Sentry', status: 'failed' }, { name: 'plugin:productivity:gmail', status: 'failed' }] }))
  // the sentence says what it means, the names come as data the feed lists under it
  assert.equal(a[0].kind, 'event'); assert.equal(a[0].text, "A connector didn't start: the agent can't use it this run.")
  assert.deepEqual(a[0].names, ['claude.ai Sentry']) // not linear (it started), not gmail (no agent may use it: its failing is noise)
  assert.deepEqual(parseLine(line({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'linear', status: 'connected' }] })), [])
})

test('the end-of-run refusals list is not repeated in the feed, but is kept with what each tried', () => {
  const r = { type: 'result', result: 'done', num_turns: 3, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'git diff', description: 'Show the diff' } }] }
  assert.deepEqual(parseLine(line(r)).map((a) => a.kind), ['result'])
  assert.deepEqual(refusalsOf(r), ['Bash: Show the diff'])
})

test('what the agent says keeps its markdown lines; its deck-next block stays out', () => {
  const text = '## Findings\n\n- **cap** missing\n- nit\n\n\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```deck-next\n{"decisions":[],"actions":[]}\n```'
  const [a] = parseLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }))
  assert.equal(a.kind, 'text')
  assert.equal(a.text, '## Findings\n\n- **cap** missing\n- nit\n\n| a | b |\n|---|---|\n| 1 | 2 |')
})
