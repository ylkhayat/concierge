import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copilotArgs, copilotTranslator } from './providers.ts'

// events as Copilot CLI 1.0.112 wrote them (--output-format json), trimmed to the fields that matter
const RUN = [
  { type: 'session.start', data: { sessionId: 's-1', selectedModel: 'auto' } },
  { type: 'session.auto_mode_resolved', data: { chosenModel: 'gpt-5.6-luna' } },
  { type: 'assistant.message', data: { content: '', toolRequests: [{ toolCallId: 'c1', name: 'view' }] } },
  { type: 'tool.execution_start', data: { toolCallId: 'c1', toolName: 'view', arguments: { path: '/x/a.txt' } } },
  { type: 'tool.execution_complete', data: { toolCallId: 'c1', success: true, result: { content: 'hello world' } } },
  { type: 'assistant.turn_end', data: { turnId: '0' } },
  { type: 'assistant.message', data: { content: 'hello' } },
  { type: 'assistant.turn_end', data: { turnId: '1' } },
  { type: 'session.usage_checkpoint', data: { totalPremiumRequests: 1 } },
  { type: 'result', data: {} },
].map((e) => JSON.stringify(e))

test("Copilot's events read as Claude Code's stream", () => {
  const t = copilotTranslator('copilot', 'auto', false)
  const lines = RUN.flatMap(t.line).map((l) => JSON.parse(l))
  assert.equal(lines[0].subtype, 'init'); assert.equal(lines[0].session_id, 's-1')
  assert.deepEqual(lines[1].message.content[0], { type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: '/x/a.txt' } })
  assert.equal(lines[2].message.content[0].content, 'hello world')
  assert.equal(lines[3].message.content[0].text, 'hello')
  const r = JSON.parse(t.end()[0])
  assert.equal(r.result, 'hello'); assert.equal(r.num_turns, 2); assert.equal(r.model, 'gpt-5.6-luna'); assert.equal(r.session_id, 's-1')
  assert.equal(r.total_cost_usd, 0.04)
})

test('a structured call asks for JSON in words, and reads it back from a fenced answer', () => {
  const a = copilotArgs('copilot', ['-p', 'Decide', '--json-schema', '{"type":"object"}', '--tools', '', '--output-format', 'json'])
  assert.match(a.args[a.args.indexOf('-p') + 1], /matching this JSON schema/)
  assert.ok(a.args.includes('--allow-tool=read') && !a.args.includes('--allow-all'))
  const t = copilotTranslator('copilot', 'auto', true)
  t.line(JSON.stringify({ type: 'assistant.message', data: { content: 'Here:\n```json\n{"ok": true}\n```' } }))
  assert.deepEqual(JSON.parse(t.end()[0]).structured_output, { ok: true })
})

test('a run resumes its own session, a new one pins the id it was given', () => {
  assert.deepEqual(copilotArgs('copilot', ['-p', 'go', '--resume', 'abc']).args.slice(-2), ['--resume', 'abc'])
  assert.deepEqual(copilotArgs('copilot', ['-p', 'go', '--session-id', 'u-1']).args.slice(-2), ['--session-id', 'u-1'])
})
