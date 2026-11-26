import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// a fake `claude` on PATH: prints a short stream-json run (init, a tool call, a refusal, its result) and exits
const dir = mkdtempSync(join(tmpdir(), 'rd-agent-'))
process.env.XDG_STATE_HOME = dir
const bin = join(dir, 'bin')
const lines = [
  { type: 'system', subtype: 'init', mcp_servers: [{ name: 'claude.ai Linear', status: 'failed' }] },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { description: 'List the worktree' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'The following part requires approval: ls /x' }] } },
  { type: 'result', result: 'All done.', num_turns: 4, total_cost_usd: 0.12, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'ls /x' } }] },
]
writeFileSync(join(dir, 'stream.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
await import('node:fs').then((fs) => fs.mkdirSync(bin, { recursive: true }))
writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat ${join(dir, 'stream.jsonl')}\necho "a warning" >&2\n`)
chmodSync(join(bin, 'claude'), 0o755)
process.env.PATH = `${bin}:${process.env.PATH}`

const { runAgent, loadActivity, tell, children } = await import('./runner.ts')
const { LOG_DIR } = await import('./store.ts')

test('one agent run end to end: its log, its result, the feed, and how it ended', async () => {
  let result: any
  const ended = await new Promise<any>((resolve, reject) => runAgent({
    key: 'a/b#9', label: 'Review #9', cwd: dir, args: ['-p', 'go'],
    onResult: (r) => { result = r }, onEnd: resolve, onError: reject,
  }))
  assert.equal(result.total_cost_usd, 0.12)
  assert.equal(ended.resulted, true); assert.equal(ended.turns, 4); assert.equal(ended.code, 0); assert.equal(ended.cancelled, false)
  assert.match(ended.stderr, /a warning/)
  // every line went to the log, stamped with when it arrived
  // (the log is a stream: its last line can still be on its way when the run ends, so wait for it whole)
  let text = ''
  for (let i = 0; i < 100; i++) { text = readFileSync(join(LOG_DIR, 'a_b_9.jsonl'), 'utf8'); if (text.endsWith('\n') && text.trim().split('\n').length >= 4) break; await new Promise((r) => setTimeout(r, 20)) }
  const log = text.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(log.length, 4); assert.ok(log.every((l) => l.timestamp))
  // the feed: the failed connector, the tool, the refusal where it happened, the result
  const feed = (await loadActivity('a/b#9')).map((a) => a.kind)
  assert.deepEqual(feed, ['event', 'tool', 'denied', 'result'])
})

test('steering never stops a run: it goes in on stdin, or waits for the run to end', () => {
  assert.equal(tell('x#1', 'hi', () => {}), 'idle')
  const got: string[] = []
  children.set('x#1', { kill: () => true, stdin: { writable: true, write: (l: string) => got.push(l) } as any })
  assert.equal(tell('x#1', 'look at the tests too', () => {}), 'now')
  assert.equal(JSON.parse(got[0]).message.content.startsWith('look at the tests too'), true)
  children.set('x#1', { kill: () => assert.fail('stopped a run'), stdin: { writable: false } as any })
  assert.equal(tell('x#1', 'later', () => {}), 'after')
  children.delete('x#1')
})
