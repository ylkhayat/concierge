import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-bg-'))
const { watch, openTasks, newRun } = await import('./background.ts')
const { state } = await import('./store.ts')

const use = (id: string, name: string, input: object) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
const answer = (id: string, text: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })

test('a background shell is kept with its id and where its output goes, and the agent stopping it is seen', () => {
  watch('o/app#1', use('t1', 'Bash', { command: 'pnpm dev --port 5173', run_in_background: true }))
  watch('o/app#1', answer('t1', 'Command running in background with ID: bash_7. Output is being written to: /tmp/claude/tasks/bash_7.output'))
  const [t] = state.background!['o/app#1']
  assert.equal(t.kind, 'shell')
  assert.equal(t.shell, 'bash_7')
  assert.equal(t.output, '/tmp/claude/tasks/bash_7.output')
  assert.equal(openTasks('o/app#1'), 1)
  watch('o/app#1', use('t2', 'KillShell', { shell_id: 'bash_7' }))
  assert.ok(state.background!['o/app#1'][0].stoppedAt)
  assert.equal(openTasks('o/app#1'), 0)
  newRun('o/app#1') // stopped: history once the next run starts
  assert.deepEqual(state.background!['o/app#1'], [])
})

test('commands detached by hand count; && and 2>&1 do not', () => {
  watch('o/app#2', use('a', 'Bash', { command: 'nohup python3 serve.py > /tmp/serve.log 2>&1 &' }))
  watch('o/app#2', use('b', 'Bash', { command: 'pnpm build && pnpm test 2>&1 | tail -5' }))
  watch('o/app#2', use('c', 'Bash', { command: 'sleep 100 &' }))
  watch('o/app#2', use('d', 'Agent', { description: 'scan the repo', prompt: '…', run_in_background: true }))
  const l = state.background!['o/app#2']
  assert.deepEqual(l.map((t) => `${t.id}:${t.kind}`), ['a:detached', 'c:detached', 'd:agent'])
  assert.equal(l[0].output, '/tmp/serve.log') // its own redirect
})
