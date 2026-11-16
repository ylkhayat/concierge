// Which model does the work, and how it is started. Claude and Llama run through Claude Code (`claude`): Llama by
// pointing it at Ollama, which speaks Anthropic's API, so its runs keep skills, slash commands, mid-run messages and
// resume. OpenAI runs through Codex (`codex exec`), with your ChatGPT sign-in or an API key: callers keep building
// Claude Code's flags and reading its stream, translated for Codex on the way in and out, so every run reads the same.
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { config, state } from './store.ts'
import { orgSkills } from './orgSkills.ts'

export type Kind = 'claude' | 'openai' | 'llama' | 'copilot'
/** An account's id. The first three are their kinds (one of each, as before accounts existed); more can be added. */
export type ProviderId = string
export type Work = 'review' | 'revise' | 'exec' | 'small' // what a run is for; `small`: the quick structured calls
/**
 * Where work runs: a kind, and its own sign-in. A Claude account's lives in its own Claude Code folder
 * (CLAUDE_CONFIG_DIR), an OpenAI account's in its own Codex folder (CODEX_HOME); none: the usual ~/.claude or ~/.codex.
 * A Llama account is an Ollama: this machine's, or another at `host`.
 */
export type Account = { id: string; label: string; kind: Kind; home?: string; host?: string }
const BUILT_IN: Account[] = [{ id: 'claude', label: 'Claude', kind: 'claude' }, { id: 'openai', label: 'OpenAI', kind: 'openai' }, { id: 'llama', label: 'Llama', kind: 'llama' }, { id: 'copilot', label: 'Copilot', kind: 'copilot' }]
export const accounts = (): Account[] => {
  const mine = config.accounts ?? []
  return [...BUILT_IN.map((b) => ({ ...b, ...mine.find((a) => a.id === b.id) })), ...mine.filter((a) => !BUILT_IN.some((b) => b.id === a.id))]
}
export const accountOf = (id: ProviderId): Account => accounts().find((a) => a.id === id) ?? BUILT_IN[0]
export const kindOf = (id: ProviderId): Kind => accountOf(id).kind
export const PROVIDERS = (): ProviderId[] => accounts().map((a) => a.id)

// the models each kind runs, large for agents and small for quick calls (Claude's names are Claude Code's aliases)
const MODELS: Record<Kind, { large?: string; small: string }> = {
  claude: { small: 'haiku' },
  openai: { small: 'gpt-5-mini' },
  llama: { large: 'llama3.1:8b', small: 'llama3.2:3b' },
  copilot: { large: 'auto', small: 'auto' }, // Copilot picks the best model its plan has
}
export const modelOf = (p: ProviderId, size: 'large' | 'small') => config.providers?.models?.[p]?.[size] ?? MODELS[kindOf(p)][size]

// dollars per million tokens, for OpenAI on an API key (a ChatGPT sign-in and Llama cost nothing per token)
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  'gpt-5': { in: 1.25, cached: 0.125, out: 10 }, 'gpt-5-mini': { in: 0.25, cached: 0.025, out: 2 }, 'gpt-5-codex': { in: 1.25, cached: 0.125, out: 10 },
}

export type Usage = { input: number; cached: number; output: number; premium?: number } // premium: Copilot's premium requests
export const costOf = (p: ProviderId, model: string | undefined, u: Usage) => {
  if (kindOf(p) === 'copilot') return (u.premium ?? 0) * COPILOT_PREMIUM_USD
  if (kindOf(p) !== 'openai' || openaiAuth(p) !== 'api-key') return 0
  const price = PRICES[model ?? ''] ?? PRICES['gpt-5']
  return ((u.input - u.cached) * price.in + u.cached * price.cached + u.output * price.out) / 1e6
}

// --- which account: the one set for this kind of work, unless it is over its budget or limit; then the next one up
const limited = new Map<ProviderId, number>() // an account that said it hit its limit, until when
export const markLimited = (p: ProviderId, until: number) => limited.set(p, until)
export const limitedUntil = (p: ProviderId) => ((limited.get(p) ?? 0) > Date.now() ? limited.get(p) : undefined)
/** When a limit message says to come back ("try again in 2 hours 13 minutes"); an hour when it doesn't say. */
export function limitUntil(text: string, now = Date.now()) {
  const h = Number(text.match(/(\d+)\s*hours?/i)?.[1] ?? 0), m = Number(text.match(/(\d+)\s*min/i)?.[1] ?? 0)
  return now + ((h || m) ? (h * 60 + m + 1) * 60_000 : 60 * 60_000)
}
// a Claude account's plan window, as the runner tracks it (usage.ts): it can't run while its window is spent
let claudeHeld = (_p: ProviderId) => false
export const watchClaudePlan = (held: (p: ProviderId) => boolean) => { claudeHeld = held }
export const spentBy = (p: ProviderId, day: string) => state.spendBy?.[day]?.[p]?.usd ?? 0
const day = () => new Date().toLocaleDateString('en-CA') // local, like the spend it reads
export const available = (p: ProviderId) => {
  const budget = config.providers?.budgets?.[p], kind = kindOf(p)
  return (limited.get(p) ?? 0) < Date.now() && !(budget && spentBy(p, day()) >= budget)
    && (kind !== 'openai' || openaiAuth(p) !== 'none') && !(kind === 'claude' && claudeHeld(p)) && (kind !== 'llama' || llamaReady(p)) && (kind !== 'copilot' || copilotReady())
}

// --- a Llama account takes work once its Ollama is up and has both its models; one it lacks is downloaded here
const ollamaSeen = new Map<ProviderId, { up: boolean; models: string[] }>(), pulling = new Map<string, number>()
const has = (models: string[], m?: string) => !!m && models.some((x) => x === m || x === `${m}:latest`)
const llamaReady = (p: ProviderId) => { const s = ollamaSeen.get(p); return !!s?.up && has(s.models, modelOf(p, 'large')) && has(s.models, modelOf(p, 'small')) }
export const llamaPulling = (p: ProviderId) => [modelOf(p, 'large'), modelOf(p, 'small')].filter((m): m is string => !!m && pulling.has(`${ollamaOf(p)} ${m}`))
/** Download a model, reading Ollama's progress as it goes (one quiet answer at the end would time out on a big one). */
async function pull(host: string, model: string): Promise<boolean> {
  try {
    const r = await fetch(`${host}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) })
    let last = ''
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) last = Buffer.from(chunk).toString().trim().split('\n').pop() ?? last
    return /"status":"success"/.test(last)
  } catch (e) { console.warn(`ollama: ${model}: ${(e as Error).message}`); return false }
}
export async function watchOllamas() {
  for (const a of accounts().filter((x) => x.kind === 'llama')) {
    const s = await ollamaState(a.id)
    ollamaSeen.set(a.id, s)
    if (!s.up) continue
    for (const m of [modelOf(a.id, 'large'), modelOf(a.id, 'small')]) {
      const key = `${ollamaOf(a.id)} ${m}`
      if (!m || has(s.models, m) || pulling.has(key)) continue
      pulling.set(key, Date.now())
      console.log(`ollama: downloading ${m} for ${a.label}`)
      void pull(ollamaOf(a.id), m).then((ok) => {
        console.log(`ollama: ${m}: ${ok ? 'downloaded' : 'failed; tried again in 10 minutes'}`)
        if (ok) pulling.delete(key); else setTimeout(() => pulling.delete(key), 10 * 60_000)
      })
    }
  }
}
// who each Claude account is signed in as ("login:<email>|<org>", "token:<hash>"), as last read (claude auth status).
// Plan windows and limits belong to a sign-in, not to an account's name: a new sign-in (another claude.ai account, a
// replaced token, a login instead of the token) starts clean. A change of sign-in drops the account's limit.
const identities = new Map<ProviderId, string>()
export const identityOf = (p: ProviderId) => identities.get(p)
export function setIdentity(p: ProviderId, who: string) {
  const was = identities.get(p)
  identities.set(p, who)
  if (was && was !== who) { limited.delete(p); console.log(`accounts: ${accountOf(p).label} is signed in as someone else now; its plan and limits start over`) }
}

// how much of its plan a Claude account has used (0–1, the fuller of its two windows), as the runner tracks it
let planUsed = (_p: ProviderId) => 0
export const watchPlanUse = (used: (p: ProviderId) => number) => { planUsed = used }
/**
 * The account for this work now: the chosen one, or the first available in the fallback order after it. Several
 * Claude plans share the work: of the chosen one and the Claude accounts in the fallback order, the one with the most
 * of its plan left takes it (the chosen one on a tie), so a second plan is used, not kept for when the first runs out.
 */
/** How far through a plan window the chosen account may get before fresh work spills over to another Claude plan. */
export const SPILL = 0.85
export function providerFor(work: Work): ProviderId {
  const chosen = config.providers?.use?.[work] ?? 'claude'
  const order = config.providers?.fallback ?? []
  if (available(chosen)) {
    // the chosen one keeps the work; only once it nears the end of a plan window does fresh work spill over to the
    // Claude plan with the most left (a plan never seen counts as unused, so it must not win while the chosen one has room)
    if (kindOf(chosen) !== 'claude' || planUsed(chosen) < SPILL) return chosen
    const plans = [chosen, ...order.filter((p) => p !== chosen && kindOf(p) === 'claude' && available(p))]
    return plans.reduce((a, b) => (planUsed(b) < planUsed(a) ? b : a))
  }
  return order.find((p) => p !== chosen && available(p)) ?? chosen
}

// --- each account's environment: its own sign-in folder, or its own Ollama
const OLLAMA_HERE = process.env.OLLAMA_HOST?.replace(/\/$/, '') || 'http://127.0.0.1:11434'
export const ollamaOf = (p: ProviderId) => accountOf(p).host?.replace(/\/$/, '') || OLLAMA_HERE
export function envOf(p: ProviderId, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const a = accountOf(p)
  if (a.kind === 'claude' && a.home) { const env: NodeJS.ProcessEnv = { ...base, CLAUDE_CONFIG_DIR: a.home }; delete env.CLAUDE_CODE_OAUTH_TOKEN; return env }
  if (a.kind === 'openai' && a.home) return { ...base, CODEX_HOME: a.home }
  return base
}

// --- OpenAI's sign-in per account, as Codex has it (a ChatGPT login or an API key), read now and then
const auths = new Map<ProviderId, 'chatgpt' | 'api-key' | 'none'>()
export const openaiAuth = (p: ProviderId = 'openai') => auths.get(p) ?? 'none'
export const readOpenaiAuth = () => Promise.all(accounts().filter((a) => a.kind === 'openai').map((a) => new Promise<void>((resolve) =>
  execFile('codex', ['login', 'status'], { timeout: 20_000, env: envOf(a.id) }, (e, out, err) => {
    const t = `${out}${err}`
    auths.set(a.id, e ? 'none' : /ChatGPT/i.test(t) ? 'chatgpt' : /API key/i.test(t) ? 'api-key' : 'none')
    resolve()
  })))).then(() => {})

// --- a slash command is a Claude Code thing: for Codex it becomes "follow this skill's file"
const SKILL_DIRS = () => [join(homedir(), '.claude', 'skills'), join(homedir(), '.claude', 'commands')]
function skillPath(name: string): string | undefined {
  const bare = name.split(':').pop()!
  for (const d of SKILL_DIRS()) for (const f of [join(d, bare, 'SKILL.md'), join(d, `${bare}.md`)]) if (existsSync(f)) return f
  const org = orgSkills().find((s) => s.name === bare)
  if (org) return org.file
  // a plugin's skill: ~/.claude/plugins/**/skills/<name>/SKILL.md, a few levels down
  const walk = (d: string, depth: number): string | undefined => {
    if (depth < 0) return undefined
    for (const e of (() => { try { return readdirSync(d, { withFileTypes: true }) } catch { return [] } })()) {
      if (!e.isDirectory()) continue
      const f = join(d, e.name, 'skills', bare, 'SKILL.md')
      if (existsSync(f)) return f
      const deeper = walk(join(d, e.name), depth - 1)
      if (deeper) return deeper
    }
    return undefined
  }
  return walk(join(homedir(), '.claude', 'plugins'), 4)
}
export function forCodex(prompt: string, instructions?: string): string {
  const [first, ...rest] = prompt.split('\n')
  const cmd = first.match(/^\/([\w:.-]+)\s*(.*)$/)
  let body = prompt
  if (cmd) {
    const file = skillPath(cmd[1])
    body = (file ? `Follow the skill \`${cmd[1]}\`: its instructions are in ${file}. Read the whole file first, then do what it says` : `Run the workflow named /${cmd[1]}`)
      + (cmd[2] ? ` with these arguments: ${cmd[2]}` : '') + '.' + (rest.length ? `\n${rest.join('\n')}` : '')
  }
  return instructions ? `<instructions>\n${instructions}\n</instructions>\n\n${body}` : body
}

// --- Claude Code's flags, as Codex's
type Parsed = { prompt?: string; system?: string; append?: string; resume?: string; session?: string; model?: string; schema?: string; addDirs: string[]; json: boolean; readOnly: boolean }
function parse(args: string[]): Parsed {
  const o: Parsed = { addDirs: [], json: false, readOnly: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i], v = args[i + 1]
    if (a === '-p') { o.prompt = v; i++ }
    else if (a === '--system-prompt') { o.system = v; i++ }
    else if (a === '--append-system-prompt') { o.append = v; i++ }
    else if (a === '--resume') { o.resume = v; i++ }
    else if (a === '--model') { o.model = v; i++ }
    else if (a === '--json-schema') { o.schema = v; i++ }
    else if (a === '--add-dir') { o.addDirs.push(v); i++ }
    else if (a === '--output-format') { o.json = v === 'json'; i++ }
    else if (a === '--tools') { // `--tools ''`: a quick call with no tools; a list with no Edit or Write: it only reads
      const tools: string[] = []
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) tools.push(args[++i])
      o.readOnly = !tools.some((t) => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t))
    }
    else if (a === '--allowedTools') { while (args[i + 1] && !args[i + 1].startsWith('--')) i++ }
    else if (a === '--session-id') { o.session = v; i++ }
    else if (['--max-budget-usd', '--input-format', '--setting-sources', '--permission-mode', '--mcp-config'].includes(a)) i++
  }
  return o
}

export function codexArgs(p: ProviderId, claudeArgs: string[]): { args: string[]; stdin: string; json: boolean } {
  const o = parse(claudeArgs)
  const small = !!o.schema || o.readOnly || o.model === 'haiku'
  const model = modelOf(p, small ? 'small' : 'large')
  const conf = [
    `approval_policy="never"`,
    // runs push branches and read GitHub: the network is on; quick calls need neither files nor shell
    o.readOnly ? `sandbox_mode="read-only"` : `sandbox_mode="workspace-write"`, `sandbox_workspace_write.network_access=true`,
    ...(o.addDirs.length ? [`sandbox_workspace_write.writable_roots=${JSON.stringify(o.addDirs)}`] : []),
  ].flatMap((c) => ['-c', c])
  let schemaFile: string[] = []
  if (o.schema) {
    const f = join(tmpdir(), `concierge-schema-${process.pid}-${Date.now()}.json`)
    writeFileSync(f, o.schema)
    schemaFile = ['--output-schema', f]
  }
  const common = ['--json', '--skip-git-repo-check', ...(model ? ['-m', model] : []), ...conf, ...schemaFile, ...(small ? ['--ephemeral'] : [])]
  const args = o.resume ? ['exec', 'resume', o.resume, ...common, '-'] : ['exec', ...common, '-']
  return { args, stdin: forCodex(o.prompt ?? '', [o.system, o.append].filter(Boolean).join('\n\n') || undefined), json: o.json }
}

/**
 * Codex's events as Claude Code's stream lines: a session start, tool calls and their results, what it says, and one
 * result with its tokens and cost. `json`: only that result, as one object at the end (Claude's --output-format json).
 */
export function translator(p: ProviderId, model: string | undefined, json: boolean) {
  let session: string | undefined, last = '', error = '', turns = 0
  const usage: Usage = { input: 0, cached: 0, output: 0 }
  const started = new Set<string>()
  const toolUse = (id: string, name: string, input: object) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
  const toolResult = (id: string, content: string, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: content.slice(0, 4000), is_error: isError }] } })
  const result = () => {
    const r = {
      type: 'result', subtype: error && !last ? 'error_during_execution' : 'success', is_error: !!error && !last, result: last || error,
      num_turns: turns, session_id: session, provider: p, model,
      usage: { input_tokens: usage.input, cache_read_input_tokens: usage.cached, output_tokens: usage.output },
      total_cost_usd: costOf(p, model, usage), structured_output: undefined as unknown,
    }
    try { r.structured_output = JSON.parse(last) } catch { /* not JSON: a plain answer */ }
    return r
  }
  const one = (e: any): object[] => {
    const it = e.item ?? {}
    if (e.type === 'thread.started') { session = e.thread_id; return [{ type: 'system', subtype: 'init', session_id: session, model, provider: p }] }
    if (e.type === 'item.started' && it.type === 'command_execution') { started.add(it.id); return [toolUse(it.id, 'Bash', { command: it.command })] }
    if (e.type === 'item.started' && it.type === 'mcp_tool_call') { started.add(it.id); return [toolUse(it.id, `mcp__${it.server}__${it.tool}`, it.arguments ?? {})] }
    if (e.type === 'item.completed') {
      if (it.type === 'agent_message') { last = String(it.text ?? ''); return [{ type: 'assistant', message: { content: [{ type: 'text', text: last }] } }] }
      if (it.type === 'command_execution') return [...(started.has(it.id) ? [] : [toolUse(it.id, 'Bash', { command: it.command })]), toolResult(it.id, String(it.aggregated_output ?? ''), it.exit_code != null && it.exit_code !== 0)]
      if (it.type === 'mcp_tool_call') return [...(started.has(it.id) ? [] : [toolUse(it.id, `mcp__${it.server}__${it.tool}`, it.arguments ?? {})]), toolResult(it.id, JSON.stringify(it.result ?? it.error ?? '').slice(0, 4000), it.status === 'failed')]
      if (it.type === 'file_change') return (it.changes ?? []).flatMap((c: any, i: number) => [toolUse(`${it.id}-${i}`, c.kind === 'add' ? 'Write' : 'Edit', { file_path: c.path }), toolResult(`${it.id}-${i}`, 'done')])
      if (it.type === 'web_search') return [toolUse(it.id, 'WebSearch', { query: it.query })]
      return []
    }
    if (e.type === 'turn.completed') {
      turns++
      usage.input += e.usage?.input_tokens ?? 0; usage.cached += e.usage?.cached_input_tokens ?? 0; usage.output += (e.usage?.output_tokens ?? 0) + (e.usage?.reasoning_output_tokens ?? 0)
      return []
    }
    if (e.type === 'turn.failed') { error = String(e.error?.message ?? 'the turn failed'); return [] }
    if (e.type === 'error' && !/^Reconnecting/.test(String(e.message))) { error = String(e.message); return [] }
    return []
  }
  return {
    line: (raw: string): string[] => {
      let e: any
      try { e = JSON.parse(raw) } catch { return [] }
      const out = one(e)
      return json ? [] : out.map((m) => JSON.stringify(m))
    },
    end: (): string[] => [JSON.stringify(result())],
    usage, get session() { return session },
  }
}

// --- GitHub Copilot: its CLI (`copilot -p`), with Claude Code's flags translated and its events read back as Claude's
const COPILOT_PREMIUM_USD = 0.04 // a premium request past the plan's allowance: what the budget counts each one as
// whether Copilot's CLI answers here (it signs in with the GitHub token, or its own `copilot login`): asked at first,
// and again every 5 minutes while it doesn't, so one failed check (a slow start) never leaves it unusable until a
// restart; why not, in a few words, for the page
let copilotThere: boolean | undefined, copilotAt = 0, copilotWhy: string | undefined, copilotChecking = false
// (a slow machine takes its time to start it: the check waits 2 minutes, and anything that ran on it and ended well
// counts as proof too, so a check that timed out never keeps a working Copilot out)
const checkCopilot = () => {
  if (copilotThere || copilotChecking || Date.now() - copilotAt < 5 * 60_000) return
  copilotAt = Date.now(); copilotChecking = true
  execFile('copilot', ['--version'], { timeout: 120_000 }, (e, _out, err) => {
    copilotChecking = false
    if (copilotThere) return
    copilotThere = !e
    copilotWhy = !e ? undefined : (e as NodeJS.ErrnoException).code === 'ENOENT' ? "its CLI isn't in this image: rebuild it (bin/update --force)" : `its CLI didn't answer (${(err || e.message).trim().split('\n')[0].slice(0, 120)})`
  })
}
export const copilotReady = () => { checkCopilot(); return !!copilotThere }
export const copilotProblem = () => { checkCopilot(); return copilotThere ? undefined : copilotChecking ? 'checking its CLI (a minute or two after a restart)' : copilotWhy ?? 'checking its CLI' }
/** Copilot just did some work: it is there, whatever the check said. */
const copilotWorked = () => { copilotThere = true; copilotWhy = undefined }
setTimeout(checkCopilot, 3_000).unref() // at start, not only when something asks

export function copilotArgs(p: ProviderId, claudeArgs: string[]): { args: string[]; json: boolean; model: string; session?: string } {
  const o = parse(claudeArgs)
  const small = !!o.schema || o.readOnly || o.model === 'haiku'
  const model = modelOf(p, small ? 'small' : 'large') ?? 'auto'
  // no slash commands and no schema flag: the skill goes in as its text, the schema as an instruction
  const prompt = forCodex(o.prompt ?? '', [o.system, o.append].filter(Boolean).join('\n\n') || undefined)
    + (o.schema ? `\n\nAnswer with only one JSON object, nothing before or after it, matching this JSON schema:\n${o.schema}` : '')
  const args = ['-p', prompt, '--output-format', 'json', '--no-ask-user', '--no-color', '--model', model,
    // what it does before it answers, cut to what a run needs: no update check or telemetry at every start, and for a
    // quick call (no tools to speak of) no built-in GitHub servers to connect to, no instruction files (a reasoning effort fails with the auto model)
    '--no-auto-update', '--disable-client-telemetry',
    ...(small ? ['--disable-builtin-mcps', '--no-custom-instructions'] : []),
    ...(o.readOnly ? ['--allow-tool=read'] : ['--allow-all-tools']),
    ...o.addDirs.flatMap((d) => ['--add-dir', d]),
    ...(o.resume ? ['--resume', o.resume] : o.session ? ['--session-id', o.session] : [])]
  return { args, json: o.json, model, session: o.resume ?? o.session }
}

// Copilot's tools by Claude Code's names, so the feed and the refusals read the same
const COPILOT_TOOL: Record<string, (a: any) => [string, object]> = {
  bash: (a) => ['Bash', { command: a.command ?? a.cmd }], shell: (a) => ['Bash', { command: a.command ?? a.cmd }],
  view: (a) => ['Read', { file_path: a.path }], read: (a) => ['Read', { file_path: a.path }],
  edit: (a) => ['Edit', { file_path: a.path }], str_replace: (a) => ['Edit', { file_path: a.path }], create: (a) => ['Write', { file_path: a.path }],
  grep: (a) => ['Grep', { pattern: a.pattern }], glob: (a) => ['Glob', { pattern: a.pattern }],
}

/** Copilot's events as Claude Code's stream lines, and one result at the end (its premium requests as the cost). */
export function copilotTranslator(p: ProviderId, model: string, json: boolean, sessionArg?: string) {
  let session = sessionArg, last = '', error = '', turns = 0, used: string | undefined
  const usage: Usage = { input: 0, cached: 0, output: 0, premium: 0 }
  const toolUse = (id: string, name: string, input: object) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
  const toolResult = (id: string, content: string, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: content.slice(0, 4000), is_error: isError }] } })
  const result = () => {
    const r = {
      type: 'result', subtype: error && !last ? 'error_during_execution' : 'success', is_error: !!error && !last, result: last || error,
      num_turns: turns, session_id: session, provider: p, model: used ?? model,
      usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: costOf(p, model, usage), structured_output: undefined as unknown,
    }
    // a structured answer: the JSON object in its last message (it may come fenced)
    const m = last.match(/\{[\s\S]*\}/)
    try { if (m) r.structured_output = JSON.parse(m[0]) } catch { /* not JSON: a plain answer */ }
    return r
  }
  const one = (e: any): object[] => {
    const d = e.data ?? {}
    switch (e.type) {
      case 'session.start': session = d.sessionId ?? session; return [{ type: 'system', subtype: 'init', session_id: session, model, provider: p }]
      case 'session.resume': return [{ type: 'system', subtype: 'init', session_id: session, model, provider: p }]
      case 'session.auto_mode_resolved': used = d.chosenModel; return []
      case 'tool.execution_start': { const [name, input] = (COPILOT_TOOL[d.toolName] ?? ((a: any): [string, object] => [d.toolName, a ?? {}]))(d.arguments ?? {}); return [toolUse(d.toolCallId, name, input)] }
      case 'tool.execution_complete': return [toolResult(d.toolCallId, String(d.result?.content ?? d.error?.message ?? ''), d.success === false)]
      case 'assistant.message': if (!d.content) return []; last = String(d.content); return [{ type: 'assistant', message: { content: [{ type: 'text', text: last }] } }]
      case 'assistant.turn_end': turns++; return []
      case 'session.usage_checkpoint': usage.premium = d.totalPremiumRequests ?? usage.premium; return []
      case 'session.error': error = String(d.message ?? 'Copilot failed'); return []
      default: return []
    }
  }
  return {
    line: (raw: string): string[] => {
      let e: any
      try { e = JSON.parse(raw) } catch { return [] }
      const out = one(e)
      return json ? [] : out.map((m) => JSON.stringify(m))
    },
    end: (): string[] => [JSON.stringify(result())],
    usage, get session() { return session },
  }
}

// --- Llama: Claude Code on Ollama (its Anthropic-compatible API), with Claude's model names swapped for Ollama's
export function llamaArgs(args: string[], p: ProviderId = 'llama'): string[] {
  const out = [...args], at = out.indexOf('--model')
  const small = at >= 0 && out[at + 1] === 'haiku'
  if (at >= 0) out[at + 1] = modelOf(p, small ? 'small' : 'large')!
  else out.push('--model', modelOf(p, 'large')!)
  return out
}
function llama(p: ProviderId, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }, stdio: ['pipe' | 'ignore', 'pipe', 'pipe']): AgentProcess {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), ANTHROPIC_BASE_URL: ollamaOf(p), ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '',
    // its own quick calls (titles, summaries) go to the small model too, not to a Claude model Ollama doesn't have
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modelOf(p, 'small'), ANTHROPIC_SMALL_FAST_MODEL: modelOf(p, 'small') }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  const child = spawn('claude', llamaArgs(args, p), { cwd: opts.cwd, env, signal: opts.signal, stdio })
  // Claude Code prices every run as if Claude did it: a local model costs nothing
  const out = new PassThrough()
  const proc = Object.assign(new EventEmitter(), { stdout: out, stderr: child.stderr!, stdin: child.stdin, pid: child.pid, kill: child.kill.bind(child) }) as AgentProcess
  let buf = ''
  const fix = (l: string) => {
    if (!l.includes('"type":"result"')) return l
    try { return JSON.stringify({ ...JSON.parse(l), total_cost_usd: 0, provider: p }) } catch { return l }
  }
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk
    const lines = buf.split('\n'); buf = lines.pop()!
    if (lines.length) out.write(lines.map(fix).join('\n') + '\n')
  })
  child.on('error', (e) => proc.emit('error', e))
  child.on('close', (code, signal) => out.end(buf ? fix(buf) + '\n' : '', () => proc.emit('close', code, signal)))
  return proc
}

/** A run's tokens, from its result (Claude's and Codex's alike): what it read, cached reads included, and wrote. */
export const tokensOf = (r: any): { input: number; output: number } | undefined => r?.usage && { input: (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), output: r.usage.output_tokens ?? 0 }

/** A started agent, whichever provider: Claude Code's own process, or Codex's with its output translated. */
export type AgentProcess = Pick<ChildProcess, 'kill' | 'pid'> & EventEmitter & {
  stdout: Readable; stderr: Readable; stdin?: Writable | null
}

/**
 * Start an agent with Claude Code's flags. Claude: `claude` with them as they are. OpenAI or Llama: `codex exec`, with
 * the prompt (a slash command turned into its skill's file, the system prompt in front) on stdin, and its events as
 * Claude's stream lines; `close` comes only after the last of them.
 */
export function spawnAgent(p: ProviderId, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; stdin?: boolean; signal?: AbortSignal }): AgentProcess {
  // stdin stays open only for a run that takes messages mid-way (runAgent): `claude -p` otherwise waits for it to end
  const stdio: ['pipe' | 'ignore', 'pipe', 'pipe'] = [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
  const kind = kindOf(p), env = envOf(p, opts.env)
  if (kind === 'claude') return spawn('claude', args, { cwd: opts.cwd, env, signal: opts.signal, stdio }) as AgentProcess
  if (kind === 'llama') return llama(p, args, { ...opts, env }, stdio)
  if (kind === 'copilot') {
    const c = copilotArgs(p, args)
    const child = spawn('copilot', c.args, { cwd: opts.cwd, env, signal: opts.signal, stdio: ['ignore', 'pipe', 'pipe'] })
    child.on('close', (code) => { if (code === 0) copilotWorked() })
    return translated(child, copilotTranslator(p, c.model, c.json, c.session))
  }
  const c = codexArgs(p, args)
  const model = c.args[c.args.indexOf('-m') + 1]
  const child = spawn('codex', c.args, { cwd: opts.cwd, env, signal: opts.signal, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin!.on('error', () => {})
  child.stdin!.end(c.stdin)
  return translated(child, translator(p, model, c.json))
}

/** Another CLI's process with its output translated to Claude Code's stream: `close` only after the last line. */
function translated(child: ChildProcess, t: { line: (raw: string) => string[]; end: () => string[] }): AgentProcess {
  const out = new PassThrough()
  const proc = Object.assign(new EventEmitter(), { stdout: out, stderr: child.stderr!, stdin: null, pid: child.pid, kill: child.kill.bind(child) }) as AgentProcess
  let buf = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk
    const lines = buf.split('\n'); buf = lines.pop()!
    const outLines = lines.flatMap(t.line)
    if (outLines.length) out.write(outLines.join('\n') + '\n')
  })
  child.on('error', (e) => proc.emit('error', e))
  child.on('close', (code, signal) => {
    if (buf) t.line(buf).forEach((l) => out.write(l + '\n'))
    out.end(t.end().join('\n') + '\n', () => proc.emit('close', code, signal))
  })
  return proc
}

// --- signing in to OpenAI from the page: Codex's device sign-in (a link and a one-time code), so it works from any
// browser, the machine running Concierge included or not
let signin: { child: ChildProcess; url?: string; code?: string; done?: boolean; ok?: boolean } | undefined
export function startOpenaiLogin(p: ProviderId = 'openai'): Promise<{ url: string; code: string }> {
  signin?.child.kill()
  const child = spawn('codex', ['login', '--device-auth'], { stdio: ['ignore', 'pipe', 'pipe'], env: envOf(p) })
  const s: NonNullable<typeof signin> = { child }
  signin = s
  const stop = setTimeout(() => child.kill(), 15 * 60_000) // the code expires in 15 minutes
  child.on('close', async () => { clearTimeout(stop); await readOpenaiAuth(); s.done = true; s.ok = openaiAuth(p) !== 'none' })
  return new Promise((resolve, reject) => {
    let out = ''
    const give = setTimeout(() => reject(new Error('No sign-in code came back')), 30_000)
    const read = (c: Buffer) => {
      out = (out + c).replace(/\u001b\[[0-9;]*m/g, '').slice(-5000)
      const url = out.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0], code = out.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0]
      if (url && code && !s.url) { s.url = url; s.code = code; clearTimeout(give); resolve({ url, code }) }
    }
    child.stdout!.on('data', read); child.stderr!.on('data', read)
  })
}
export const openaiLoginState = () => signin && { done: !!signin.done, ok: !!signin.ok }

/** Ollama on this machine: up, and the models it has (Llama's agents run on one of them). */
export async function ollamaState(p: ProviderId = 'llama'): Promise<{ up: boolean; models: string[] }> {
  try {
    const r = await fetch(`${ollamaOf(p)}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return { up: r.ok, models: ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [] }
  } catch { return { up: false, models: [] } }
}

/**
 * A new account's sign-in folder: empty but for links to what you set up once in ~/.claude (skills, commands, agents,
 * plugins, settings, CLAUDE.md) or ~/.codex (its config, skills), so every account works the same. Its login is its own.
 */
export async function prepareHome(home: string, kind: 'claude' | 'openai') {
  const { mkdir, symlink, access } = await import('node:fs/promises')
  await mkdir(home, { recursive: true })
  const from = join(homedir(), kind === 'claude' ? '.claude' : '.codex')
  const shared = kind === 'claude' ? ['skills', 'commands', 'agents', 'plugins', 'settings.json', 'CLAUDE.md'] : ['config.toml', 'skills']
  for (const name of shared) {
    const there = join(from, name), here = join(home, name)
    if (await access(there).then(() => true, () => false) && !(await access(here).then(() => true, () => false))) await symlink(there, here).catch(() => {})
  }
}

// --- an OpenAI account's ChatGPT plan windows: Codex writes them into its session files as it works (a 5-hour one
// and a weekly one), read from the newest that has them
const codexWindows = new Map<ProviderId, import('./usage.ts').Usage>()
export const codexWindowsOf = (p: ProviderId) => codexWindows.get(p)
export async function readCodexWindows() {
  const { readdir, readFile, stat } = await import('node:fs/promises')
  for (const a of accounts().filter((x) => x.kind === 'openai')) {
    const root = join(a.home ?? join(homedir(), '.codex'), 'sessions')
    // sessions/<year>/<month>/<day>/rollout-*.jsonl: the newest day first, a few files at most
    const files: { f: string; t: number }[] = []
    const walk = async (d: string, depth: number) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory() && depth > 0) await walk(join(d, e.name), depth - 1)
        else if (e.name.endsWith('.jsonl')) files.push({ f: join(d, e.name), t: (await stat(join(d, e.name)).catch(() => undefined))?.mtimeMs ?? 0 })
      }
    }
    await walk(root, 3)
    for (const { f, t } of files.sort((x, y) => y.t - x.t).slice(0, 5)) {
      const text = await readFile(f, 'utf8').catch(() => '')
      const at = text.lastIndexOf('"rate_limits":{"limit_id"')
      const m = at >= 0 ? text.slice(at, text.indexOf('\n', at)) : ''
      const win = (k: 'primary' | 'secondary') => {
        const x = m.match(new RegExp(`"${k}":(\\{[^}]*\\})`))?.[1]
        if (!x) return undefined
        const o = JSON.parse(x) as { used_percent?: number; resets_at?: number; resets_in_seconds?: number }
        const resetsAt = o.resets_at ?? (o.resets_in_seconds != null ? Math.round(t / 1000) + o.resets_in_seconds : undefined)
        return o.used_percent != null && resetsAt ? { used: o.used_percent / 100, resetsAt } : undefined
      }
      const five = win('primary'), seven = win('secondary')
      if (five || seven) { codexWindows.set(a.id, { five, seven, at: new Date(t).toISOString() }); break }
    }
  }
}
