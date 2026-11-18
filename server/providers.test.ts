import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'deck-prov-'))
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'deck-prov-config-')) // not your own settings (your models, accounts)

// what `codex exec --json` printed for "cat a.txt" on local Llama (trimmed to the fields that matter)
const EVENTS = [
  { type: 'thread.started', thread_id: 'th-1' },
  { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Model metadata for `llama3.2:3b` not found.' } },
  { type: 'turn.started' },
  { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'cat a.txt'", status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'cat a.txt'", aggregated_output: 'hello\n', exit_code: 0 } },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'hello' } },
  { type: 'turn.completed', usage: { input_tokens: 5049, cached_input_tokens: 67, output_tokens: 126, reasoning_output_tokens: 4 } },
].map((e) => JSON.stringify(e))

test("Codex's events read as Claude Code's stream: session, tool call, words, one result with its tokens", async () => {
  const { translator } = await import('./providers.ts')
  const t = translator('llama', 'llama3.2:3b', false)
  const out = [...EVENTS.flatMap(t.line), ...t.end()].map((l) => JSON.parse(l))
  assert.deepEqual(out.map((m) => m.type), ['system', 'assistant', 'user', 'assistant', 'result'])
  assert.equal(out[0].session_id, 'th-1')
  assert.deepEqual(out[1].message.content[0], { type: 'tool_use', id: 'item_1', name: 'Bash', input: { command: "/bin/zsh -lc 'cat a.txt'" } })
  assert.equal(out[2].message.content[0].is_error, false)
  const r = out.at(-1)
  assert.equal(r.result, 'hello'); assert.equal(r.num_turns, 1); assert.equal(r.total_cost_usd, 0) // local: free
  assert.deepEqual(r.usage, { input_tokens: 5049, cache_read_input_tokens: 67, output_tokens: 130 })
  // --output-format json: only the result, at the end, with a JSON answer parsed
  const j = translator('openai', 'gpt-5-mini', true)
  const lines = [...[...EVENTS.slice(0, 5), JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"lines":[]}' } })].flatMap(j.line), ...j.end()]
  assert.equal(lines.length, 1); assert.deepEqual(JSON.parse(lines[0]).structured_output, { lines: [] })
})

test("Claude Code's flags as Codex's (a slash command becomes its skill, resume, quick calls); Llama keeps Claude Code with Ollama's models", async () => {
  const { codexArgs, llamaArgs } = await import('./providers.ts')
  const run = codexArgs('openai', ['-p', '/no-such-skill 12\nmore', '--session-id', 'x', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Read', 'Bash(git:*)', '--add-dir', '/w', '--append-system-prompt', 'Be brief.'])
  assert.deepEqual(run.args.slice(0, 1), ['exec']); assert.equal(run.args.at(-1), '-')
  assert.ok(run.args.includes('sandbox_mode="workspace-write"')); assert.ok(run.args.includes('sandbox_workspace_write.writable_roots=["/w"]'))
  assert.match(run.stdin, /^<instructions>\nBe brief\.\n<\/instructions>\n\nRun the workflow named \/no-such-skill with these arguments: 12\.\nmore$/)
  assert.deepEqual(codexArgs('openai', ['-p', 'go on', '--resume', 'th-1']).args.slice(0, 3), ['exec', 'resume', 'th-1'])
  const quick = codexArgs('openai', ['-p', 'q', '--json-schema', '{}', '--output-format', 'json', '--tools', '', '--model', 'haiku'])
  assert.ok(quick.json && quick.args.includes('sandbox_mode="read-only"') && quick.args.includes('--ephemeral') && quick.args.includes('--output-schema'))
  assert.equal(quick.args[quick.args.indexOf('-m') + 1], 'gpt-5-mini')
  assert.deepEqual(llamaArgs(['-p', 'q', '--model', 'haiku']), ['-p', 'q', '--model', 'llama3.2:3b']) // a quick call: the small model
  assert.deepEqual(llamaArgs(['-p', 'q', '--resume', 's']), ['-p', 'q', '--resume', 's', '--model', 'llama3.1:8b']) // an agent: the large one
})

test('who runs it: the chosen account, else the next in the fallback order that can (signed in, under budget, its models there)', async () => {
  const { providerFor, limitUntil, markLimited, available } = await import('./providers.ts')
  const { config, state, today } = await import('./store.ts')
  assert.equal(limitUntil('try again in 2 hours 13 minutes', 0), (2 * 60 + 13 + 1) * 60_000)
  assert.equal(limitUntil('usage limit reached', 0), 60 * 60_000) // it doesn't say: an hour
  assert.equal(available('llama'), false) // no Ollama with its models seen here
  config.accounts = [{ id: 'b', label: 'Claude (b)', kind: 'claude', home: '/h/b' }]
  config.providers = { use: { review: 'openai' }, fallback: ['llama', 'b', 'claude'], budgets: { b: 1 } }
  assert.equal(providerFor('small'), 'b') // nothing picked for it: the top of the order (Llama) can't, so the next that can
  assert.equal(providerFor('review'), 'b') // OpenAI isn't signed in, Llama lacks its models: the next one
  state.spendBy = { [today()]: { b: { usd: 1, input: 0, output: 0, runs: 1 } } }
  assert.equal(providerFor('review'), 'claude') // b is over its budget
  markLimited('claude', Date.now() + 60_000)
  assert.equal(providerFor('review'), 'openai') // none can: it stays on the chosen one, and waits
  delete config.providers; delete config.accounts; state.spendBy = {}
})

test('work follows the order strictly: the chosen account until it is used up, then the next that can take it', async () => {
  const { providerFor, watchClaudePlan } = await import('./providers.ts')
  const { config } = await import('./store.ts')
  config.accounts = [{ id: 'work', label: 'Claude (work)', kind: 'claude', home: '/h/w' }, { id: 'person', label: 'Claude (Person)', kind: 'claude', home: '/h/p' }, { id: 'third', label: 'Claude (third)', kind: 'claude', home: '/h/t' }]
  config.providers = { use: { exec: 'work' }, fallback: ['work', 'person', 'third'] }
  const held = new Set<string>()
  watchClaudePlan((p) => held.has(p))
  assert.equal(providerFor('exec'), 'work') // however full its plan, short of the pause point it keeps the work
  held.add('work')
  assert.equal(providerFor('exec'), 'person') // used up: the next in the order, not the emptiest
  held.add('person')
  assert.equal(providerFor('exec'), 'third')
  held.delete('work')
  assert.equal(providerFor('exec'), 'work') // room again (a reset, or the pause point raised): back at once
  held.clear()
  config.providers = { fallback: ['person', 'work'] }
  assert.equal(providerFor('exec'), 'person') // nothing picked for this work: the top of the order takes it
  config.providers = { use: { exec: 'work' }, fallback: ['person', 'work'] }
  assert.equal(providerFor('exec'), 'work') // picked for it: that one first, whatever the order
  watchClaudePlan(() => false); delete config.providers; delete config.accounts
})

test('accounts: one you add runs in its own sign-in folder, and takes work like the built-in ones', async () => {
  const { accounts, envOf, kindOf, providerFor, codexArgs } = await import('./providers.ts')
  const { config } = await import('./store.ts')
  config.accounts = [{ id: 'personal', label: 'Claude (personal)', kind: 'claude', home: '/h/personal' }, { id: 'desk', label: 'Llama (desktop)', kind: 'llama', host: 'http://desk:11434/' }]
  assert.deepEqual(accounts().map((a) => a.id), ['claude', 'openai', 'llama', 'copilot', 'personal', 'desk'])
  assert.equal(kindOf('personal'), 'claude'); assert.equal(kindOf('nope'), 'claude') // gone: Claude's
  const env = envOf('personal', { CLAUDE_CODE_OAUTH_TOKEN: 't', PATH: '/bin' })
  assert.equal(env.CLAUDE_CONFIG_DIR, '/h/personal'); assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined) // its own login, not the shared token
  assert.deepEqual(envOf('claude', { PATH: '/bin' }), { PATH: '/bin' }) // the first account: as before
  config.providers = { use: { review: 'openai' }, fallback: ['personal'] }
  assert.equal(providerFor('review'), 'personal') // OpenAI isn't signed in: your other Claude account takes it
  assert.equal(codexArgs('openai', ['-p', 'x']).args[0], 'exec')
  delete config.accounts; delete config.providers
})

test('each kind of work runs on the Claude model picked for it; nothing picked, its default (agents: your own)', async () => {
  const { claudeModels } = await import('./providers.ts')
  const { config } = await import('./store.ts')
  delete config.providers
  assert.deepEqual(claudeModels(['-p', 'x']), ['-p', 'x']) // an agent run: your Claude Code default
  assert.deepEqual(claudeModels(['--model', 'planner']), ['--model', 'opus'])
  assert.deepEqual(claudeModels(['--model', 'sonnet']), ['--model', 'sonnet'])
  config.providers = { tiers: { agents: 'sonnet', planner: 'claude-fable-5-2', quick: 'sonnet' } }
  assert.deepEqual(claudeModels(['-p', 'x']), ['-p', 'x', '--model', 'sonnet'])
  assert.deepEqual(claudeModels(['--model', 'planner']), ['--model', 'claude-fable-5-2'])
  assert.deepEqual(claudeModels(['--model', 'haiku']), ['--model', 'sonnet'])
  assert.deepEqual(claudeModels(['--model', 'claude-opus-5-5']), ['--model', 'claude-opus-5-5']) // a model named outright stays
  delete config.providers
})
