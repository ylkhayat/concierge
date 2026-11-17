// Which connectors (MCP servers) the agents' Claude Code can use, and one-click fixes for the ones it can't.
// In a container, browser logins kept in the Mac's Keychain never arrive, so a service with an API key the app
// already holds is connected with that key instead.
import { execFile, spawn as spawnChild } from 'node:child_process'
import { promisify } from 'node:util'
import { saveConfig } from './config.ts'
import { readSecrets, rereadSecrets, saveSecrets, scrub } from './scrub.ts'
import { config, save, state } from './store.ts'

const run = promisify(execFile)
export type Connection = { name: string; target?: string; status: 'connected' | 'needs-auth' | 'failed'; fix?: Fix; needsKey?: boolean; coveredBy?: string }
export type Fix = 'linear-key' | 'sentry-token' | 'sentry-login'

const secrets = readSecrets

/** "plugin:linear:linear: https://mcp.linear.app/mcp (HTTP) - ! Needs authentication" → a Connection. */
export function parseMcpList(out: string): Connection[] {
  return out.split('\n').flatMap((l) => {
    const m = l.match(/^(.+?): (.+) - (✔|!|✘|✗)\s*(.+)$/)
    if (!m) return []
    const status = m[3] === '✔' ? 'connected' : /auth/i.test(m[4]) ? 'needs-auth' : 'failed'
    return [{ name: m[1], target: m[2].trim(), status }]
  })
}

// the fixes this app can apply by itself: a service, the key it holds for it, and how to add it
// `aliases`: allowlist prefixes of the same service's tools elsewhere; each allowed tool there is allowed here too
type FixDef = { service: RegExp; key: () => string | undefined; name: string; add: (key: string) => string[]; tools: string; aliases: string[]; askKey?: boolean; loginOnly?: boolean }

const FIXES: Record<Fix, FixDef> = {
  'linear-key': {
    service: /linear/i, key: () => process.env.LINEAR_API_KEY, name: 'linear-key', tools: 'mcp__linear-key',
    add: (key) => ['--transport', 'http', 'linear-key', 'https://mcp.linear.app/mcp', '--header', `Authorization: Bearer ${key}`],
    aliases: ['mcp__claude_ai_Linear', 'mcp__plugin_productivity_linear', 'mcp__plugin_linear_linear'],
  },
  'sentry-token': {
    service: /sentry/i, key: () => secrets().sentryToken, name: 'sentry-token', tools: 'mcp__sentry-token', askKey: true,
    add: (key) => ['sentry-token', '-e', `SENTRY_ACCESS_TOKEN=${key}`, '-e', `SENTRY_HOST=${secrets().sentryHost ?? 'sentry.io'}`, '--', 'npx', '-y', '@sentry/mcp-server@latest'],
    aliases: ['mcp__claude_ai_Sentry', 'mcp__plugin_sentry_sentry'],
  },
  // Sentry's plugin registers https://mcp.sentry.dev/mcp?utm_source=plugin, and Sentry refuses a login for that
  // address (invalid_target: the resource parameter doesn't match). The plain address logs in; no key, a browser login.
  'sentry-login': {
    service: /^$/, key: () => 'browser login', name: 'sentry', tools: 'mcp__sentry', loginOnly: true,
    add: () => ['--transport', 'http', 'sentry', 'https://mcp.sentry.dev/mcp'],
    aliases: ['mcp__claude_ai_Sentry', 'mcp__plugin_sentry_sentry', 'mcp__sentry-token'],
  },
} as Record<Fix, FixDef>

/** A connection as a tool is told about it: an address (with its key as a header), or a command to start. */
export type McpServer = {
  name: string; service: string // service: what it reaches, for the page ("Linear", or the name you gave it)
  url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string>
  login?: boolean // it signs in in the browser, into one Claude account's own store: no key to hand to another tool
  coveredByClaudeAi?: boolean // a claude.ai login brings the same service itself
}
/** What Concierge itself holds: a service it has the key for, and each connector you added by its address (the bank, bank.ts). */
export function ownServers(): McpServer[] {
  const out: McpServer[] = []
  const linear = process.env.LINEAR_API_KEY
  if (linear) out.push({ name: 'linear-key', service: 'Linear', url: 'https://mcp.linear.app/mcp', headers: { Authorization: `Bearer ${linear}` }, coveredByClaudeAi: true })
  const s = secrets()
  if (s.sentryToken) out.push({ name: 'sentry-token', service: 'Sentry', command: 'npx', args: ['-y', '@sentry/mcp-server@latest'], env: { SENTRY_ACCESS_TOKEN: s.sentryToken, SENTRY_HOST: s.sentryHost ?? 'sentry.io' }, coveredByClaudeAi: true })
  for (const [name, url] of Object.entries(state.customConnectors ?? {})) out.push({ name, service: name, url, login: true })
  return out
}
/** The `claude mcp add` arguments for a fix (tests check their order). */
export const addArgsFor = (fix: Fix, key: string) => FIXES[fix].add(key)

/** Each allowed tool of the service elsewhere (claude.ai, a plugin) is allowed under the new connector too. */
export function withAliases(list: string[], aliases: string[], prefix: string): string[] {
  const extra = list.flatMap((t) => aliases.filter((a) => t === a || t.startsWith(`${a}__`)).map((a) => prefix + t.slice(a.length)))
  return [...new Set([...list, ...extra])]
}

let cache: { at: number; list: Connection[] } | undefined
// `claude mcp list` starts and checks every connector (with claude.ai's, ~40): heavy, so one at a time, shared by all
// callers, and kept 5 minutes (a connect, remove or login clears it)
let checking: Promise<Connection[]> | undefined
export function connections(fresh = false, maxAge = 300_000): Promise<Connection[]> {
  if (!fresh && cache && Date.now() - cache.at < maxAge) return Promise.resolve(cache.list)
  checking ??= check().finally(() => { checking = undefined })
  return checking
}
async function check(): Promise<Connection[]> {
  await ready
  const list_ = () => run('claude', ['mcp', 'list'], { timeout: 120_000, cwd: '/tmp' }).then((r) => parseMcpList(r.stdout), (e) => parseMcpList(String(e.stdout ?? '')))
  // on the claude.ai login, its connectors (Sentry among them) sometimes don't come back, mostly right after a start:
  // that list would show them gone and invite a login that the next start removes again. Ask once more, and if
  // they're still missing keep that list only briefly
  const viaLogin = !!state.claudeLogin, has = (l: Connection[]) => l.some((c) => c.name.startsWith('claude.ai '))
  let list = await list_()
  if (viaLogin && !has(list)) list = await list_()
  annotate(list)
  cache = { at: viaLogin && !has(list) ? Date.now() - 270_000 : Date.now(), list }
  return list
}

/** What each row that doesn't work can lean on: another connector of the same service that does, or a key we hold. */
function annotate(list: Connection[]) {
  for (const c of list) { delete c.coveredBy; delete c.fix; delete c.needsKey }
  // a service that needs a browser login, but the app holds its key: offer the key (unless already connected that way)
  for (const c of list) {
    if (c.status === 'connected') continue
    // a browser-login connector the container can't use, already replaced by a key-based one that works
    const viaClaudeAi = list.find((x) => x.status === 'connected' && x.name.startsWith('claude.ai ') && Object.values(FIXES).some((f) => f.service.test(x.name) && f.service.test(c.name)))
    if (viaClaudeAi) { c.coveredBy = viaClaudeAi.name; continue }
    const cover = Object.values(FIXES).find((f) => (f.service.test(c.name) || (f.loginOnly && c.name === 'plugin:sentry:sentry')) && list.some((x) => x.name === f.name && x.status === 'connected'))
    if (cover) { c.coveredBy = cover.name; continue }
    for (const [id, f] of Object.entries(FIXES) as [Fix, (typeof FIXES)[Fix]][]) {
      const ours = Object.values(FIXES).some((x) => x.name === c.name)
    if (!ours && !f.loginOnly && f.service.test(c.name) && (f.key() || f.askKey) && !list.some((x) => x.name === f.name && x.status === 'connected') && !list.some((x) => x.fix === id)) { c.fix = id; c.needsKey = !f.key() }
    }
  }
}

/**
 * After a login: check only that connector (`claude mcp get`, one server, seconds) and patch the list, instead of
 * `claude mcp list` starting all ~40 again (a minute or two).
 */
export async function recheck(name: string): Promise<Connection[]> {
  if (!cache) return connections(true)
  const out = await run('claude', ['mcp', 'get', name], { timeout: 60_000, cwd: '/tmp' }).then((r) => r.stdout, (e) => String(e.stdout ?? ''))
  const m = out.match(/Status: (✔|!|✘|✗)\s*(.*)/)
  const status: Connection['status'] = !m ? 'failed' : m[1] === '✔' ? 'connected' : /auth/i.test(m[2]) ? 'needs-auth' : 'failed'
  const list = cache.list.some((c) => c.name === name) ? cache.list.map((c) => (c.name === name ? { ...c, status } : c)) : [...cache.list, { name, target: '', status }]
  annotate(list)
  cache = { at: Date.now(), list }
  return list
}

/** Add the service to the agents' Claude Code with the key, and let exec runs use its tools. */
export async function connect(fix: Fix, remember = true) {
  const f = FIXES[fix]
  const key = f.key()
  if (!key) throw new Error('No key for that service in the environment')
  // a browser-login connector is added once and never removed to re-add it: removing it can drop its stored login
  if (f.loginOnly) {
    if (await run('claude', ['mcp', 'get', f.name], { timeout: 60_000, cwd: '/tmp' }).then(() => true, () => false)) { cache = undefined; return }
  } else await run('claude', ['mcp', 'remove', '--scope', 'user', f.name], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
  // the key goes straight into Claude Code's config; it is never logged or returned
  // a failed command's error repeats the command line, key included: report only what went wrong, scrubbed
  await run('claude', ['mcp', 'add', '--scope', 'user', ...f.add(key)], { timeout: 60_000, cwd: '/tmp' })
    .catch((e: { stderr?: string }) => { throw new Error(`Could not add ${f.name}: ${String(e.stderr ?? 'claude mcp add failed').split(key).join('***').trim().split('\n')[0]}`) })
  // the agents may use it wherever they could use the same service's tools before (exec runs, each action);
  saveConfig({ exec: {
    allowedTools: withAliases(config.exec.allowedTools, f.aliases, f.tools),
    actions: config.exec.actions.map((a) => (a.allowedTools ? { ...a, allowedTools: withAliases(a.allowedTools, f.aliases, f.tools) } : a)),
  } })
  if (remember) state.connected = [...new Set([...(state.connected ?? []), fix])]
  save()
  cache = undefined
}

/** A container forgets its Claude Code settings when rebuilt: put back what was connected before. */
export function reconnect() {
  // signed in with claude.ai, its own Linear and Sentry come along; ours would hide them (Claude Code shows one
  // connector per address), so they go instead of coming back
  const viaClaudeAi = (fix: string) => !!state.claudeLogin && CLAUDE_AI_COVERS.includes(fix as Fix)
  for (const fix of (state.connected ?? []).filter(viaClaudeAi)) allowViaClaudeAi(fix as Fix)
  ready = Promise.allSettled([...Object.entries(state.customConnectors ?? {}).map(([n, u]) => addCustom(n, u).catch((e) => console.error(`reconnect ${n}:`, (e as Error).message))), ...(state.connected ?? []).map((fix) => (viaClaudeAi(fix)
    ? run('claude', ['mcp', 'remove', '--scope', 'user', FIXES[fix as Fix].name], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
    : connect(fix as Fix).catch((e) => console.error(`reconnect ${fix}:`, (e as Error).message))))])
}

/**
 * Make this machine's connectors what the control plane has (machines.ts pushes it after every change, and to a machine
 * that comes back): the ones it no longer has go, the rest are added as at a start. Each machine keeps its own logins.
 */
export async function applyConnectors(custom: Record<string, string>, connected: string[]) {
  rereadSecrets() // a Sentry token set on the control plane is in the synced file, not yet in this machine's memory
  for (const n of Object.keys(state.customConnectors ?? {})) if (!(n in custom)) await run('claude', ['mcp', 'remove', '--scope', 'user', n], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
  for (const f of (state.connected ?? []) as Fix[]) if (!connected.includes(f) && FIXES[f]) await run('claude', ['mcp', 'remove', '--scope', 'user', FIXES[f].name], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
  state.customConnectors = custom
  state.connected = connected
  cache = undefined
  reconnect()
  await ready
}

/** Claude Code turns a server's name into its tools' prefix (mcp__<name>__…): a plain name keeps that predictable. */
export const customName = (n: string) => /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(n)

/**
 * A connector that isn't listed yet, by its address (an HTTP MCP server): added to the agents' Claude Code, its tools
 * allowed for exec runs, and remembered so a rebuilt container gets it back. One that needs a login then shows Log in.
 */
export async function addCustom(name: string, url: string) {
  if (!customName(name) || !/^https:\/\/\S+$/.test(url)) throw new Error('A name (letters, digits, - and _) and an https:// address')
  // already there with that address (a restart, not a rebuild): left alone, since removing it can drop its stored login
  const has = await run('claude', ['mcp', 'get', name], { timeout: 60_000, cwd: '/tmp' }).then((r) => r.stdout.includes(url), () => false)
  if (!has) {
    await run('claude', ['mcp', 'remove', '--scope', 'user', name], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
    await run('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', name, url], { timeout: 60_000, cwd: '/tmp' })
      .catch((e: { stderr?: string }) => { throw new Error(`Could not add ${name}: ${String(e.stderr ?? 'claude mcp add failed').trim().split('\n')[0]}`) })
  }
  const tools = `mcp__${name}`
  if (!config.exec.allowedTools.includes(tools)) saveConfig({ exec: { allowedTools: [...config.exec.allowedTools, tools] } })
  state.customConnectors = { ...state.customConnectors, [name]: url }
  save()
}

/** Undo addCustom. */
export async function removeCustom(name: string) {
  await run('claude', ['mcp', 'remove', '--scope', 'user', name], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
  saveConfig({ exec: { allowedTools: config.exec.allowedTools.filter((t) => t !== `mcp__${name}`) } })
  const { [name]: _, ...rest } = state.customConnectors ?? {}
  state.customConnectors = rest
  save()
  if (cache) cache = { ...cache, list: cache.list.filter((c) => c.name !== name) }
}
const CLAUDE_AI_COVERS: Fix[] = ['linear-key', 'sentry-token', 'sentry-login']
// the same server behind both, so the same tool names: each tool allowed through ours is allowed through claude.ai's
const CLAUDE_AI_PREFIX: Partial<Record<Fix, string>> = { 'linear-key': 'mcp__claude_ai_Linear', 'sentry-token': 'mcp__claude_ai_Sentry', 'sentry-login': 'mcp__claude_ai_Sentry' }
function allowViaClaudeAi(fix: Fix) {
  const from = `${FIXES[fix].tools}__`, to = CLAUDE_AI_PREFIX[fix]
  if (!to) return
  const map = (l: string[]) => [...new Set([...l, ...l.filter((t) => t.startsWith(from)).map((t) => `${to}__${t.slice(from.length)}`)])]
  saveConfig({ exec: { allowedTools: map(config.exec.allowedTools), actions: config.exec.actions.map((a) => (a.allowedTools ? { ...a, allowedTools: map(a.allowedTools) } : a)) } })
}
// until those are back, a check would report them missing (and offer fixes for what is only still starting)
let ready: Promise<unknown> = Promise.resolve()

/** A Sentry token you pasted: checked against Sentry (and its region found), kept, and connected. */
export async function connectSentry(token: string, known: string[] = []) {
  // a person's token can list its organizations; an organization's own token (an internal integration) is tied to one
  // organization and one region, so it is asked about that organization by name, in each region
  const slugs = [...new Set(known.filter((x) => /^[a-z0-9][\w-]*$/.test(x)))]
  const tries: string[] = []
  const get = async (url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined)
    tries.push(`${new URL(url).host}${new URL(url).pathname.replace('/api/0', '')} → ${res?.status ?? 'no answer'}`)
    return res?.ok ? res : undefined
  }
  const keep = async (orgs: string[], region: string) => {
    saveSecrets({ sentryToken: token, sentryHost: region })
    await connect('sentry-token')
    return { orgs, host: region }
  }
  for (const host of ['sentry.io', 'de.sentry.io', 'us.sentry.io']) {
    const res = await get(`https://${host}/api/0/organizations/`)
    if (!res) continue
    const orgs = await res.json() as { slug: string; links?: { regionUrl?: string } }[]
    if (orgs.length) return keep(orgs.map((o) => o.slug), new URL(orgs[0].links?.regionUrl ?? `https://${host}`).host)
  }
  for (const slug of slugs) for (const host of ['de.sentry.io', 'us.sentry.io', `${slug}.sentry.io`]) {
    const res = await get(`https://${host}/api/0/organizations/${slug}/`)
    if (!res) continue
    const o = await res.json() as { slug: string; links?: { regionUrl?: string } }
    return keep([o.slug], new URL(o.links?.regionUrl ?? `https://${host}`).host)
  }
  // nothing accepted it: say exactly what each address answered (never the token)
  throw new Error(`Sentry did not accept that token. ${slugs.length ? '' : 'Name the organization and try again. '}Tried: ${tries.join('; ')}`)
}


// --- browser logins: `claude mcp login <name>` in a terminal of its own; its callback (localhost) reaches the
// container through host networking, so approving in the browser finishes it; from another device, paste the address
type Login = { child: import('node:child_process').ChildProcess; url?: string; done?: boolean; ok?: boolean; out: string }
const logins = new Map<string, Login>()

/** Start a login and return the provider's approval address. One at a time per connector; ten minutes at most. */
/** Log a Claude Code connector in, for an account (its own folder, through `env`; the first account's by default). */
export function startLogin(name: string, account = 'claude', env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (!/^[\w:.-]+$/.test(name)) return Promise.reject(new Error('Unknown connector'))
  const key = `${account}|${name}`
  logins.get(key)?.child.kill()
  // `script` gives it the terminal it insists on; the name is checked above, so the command line is safe
  const child = spawnChild('script', ['-qfec', `claude mcp login ${name} --no-browser`, '/dev/null'], { cwd: '/tmp', env, stdio: ['pipe', 'pipe', 'pipe'] })
  const l: Login = { child, out: '' }
  logins.set(key, l)
  const stop = setTimeout(() => child.kill(), 10 * 60_000)
  child.on('close', (code) => { clearTimeout(stop); l.done = true; l.ok = code === 0 && /authenticat|success|logged in/i.test(l.out); byAccount.delete(account); if (l.ok) allowLoggedIn(name) })
  return new Promise((resolve, reject) => {
    const give = setTimeout(() => reject(new Error(`No login address came back. ${scrub(l.out.split('\n').slice(-2).join(' ')).slice(0, 200)}`)), 25_000)
    const read = (c: Buffer) => {
      l.out = (l.out + c).slice(-20_000)
      const m = l.out.match(/https:\/\/\S+authoriz\S+/)
      // the terminal wraps it in a clickable-link escape (OSC 8): the address ends at the BEL / ESC that closes it
      if (m && !l.url) { l.url = m[0].split(/[\u0007\u001b]/)[0]; clearTimeout(give); resolve(l.url) }
    }
    child.stdout!.on('data', read); child.stderr!.on('data', read)
  })
}

/** From another device the browser can't reach localhost: the address it landed on finishes the login instead. */
export function finishLogin(name: string, redirect: string, account = 'claude') {
  const l = logins.get(`${account}|${name}`)
  if (!l || l.done) throw new Error('That login is not waiting anymore; start it again')
  if (!/^https?:\/\/localhost[:/]/.test(redirect.trim())) throw new Error('Paste the address the browser landed on (it starts with http://localhost)')
  l.child.stdin!.write(redirect.trim() + '\n')
}

export const loginState = (name: string, account = 'claude') => { const l = logins.get(`${account}|${name}`); return l ? { done: !!l.done, ok: !!l.ok } : undefined }

/** Undo a key-based fix: the connector, its stored key, its allowed tools, and re-applying it at start. */
export async function removeFix(fix: Fix) {
  const f = FIXES[fix]
  await run('claude', ['mcp', 'remove', '--scope', 'user', f.name], { timeout: 60_000, cwd: '/tmp' }).catch(() => {})
  if (fix === 'sentry-token') saveSecrets({ sentryToken: undefined, sentryHost: undefined })
  const keep = (t: string) => t !== f.tools && !t.startsWith(`${f.tools}__`)
  saveConfig({ exec: {
    allowedTools: config.exec.allowedTools.filter(keep),
    actions: config.exec.actions.map((a) => (a.allowedTools ? { ...a, allowedTools: a.allowedTools.filter(keep) } : a)),
  } })
  state.connected = (state.connected ?? []).filter((x) => x !== fix)
  save()
  cache = undefined
}

/**
 * After a browser login: the connector's tools (mcp__plugin_<plugin>_<server>__…) are allowed wherever the same
 * service's tools were (claude.ai's, a key-based one's), so the agents can use it at once.
 */
export function allowLoggedIn(name: string) {
  const own = Object.values(FIXES).find((x) => x.loginOnly && x.name === name)
  const m = name.match(/^plugin:([\w-]+):([\w-]+)$/)
  const prefix = own ? own.tools : m ? `mcp__plugin_${m[1]}_${m[2]}` : undefined
  const f = own ?? Object.values(FIXES).find((x) => x.service.test(name))
  if (!prefix || !f) return
  const aliases = [...f.aliases.filter((a) => a !== prefix), f.tools]
  saveConfig({ exec: {
    allowedTools: withAliases(config.exec.allowedTools, aliases, prefix),
    actions: config.exec.actions.map((a) => (a.allowedTools ? { ...a, allowedTools: withAliases(a.allowedTools, aliases, prefix) } : a)),
  } })
}

// --- each account's connectors: which its runs can use. A Claude account's come from its own folder (its claude.ai
// login brings that organization's; its Claude Code ones are its own); Llama's are the first account's Claude Code
// ones (Claude Code turns claude.ai's off when it talks to Ollama); an OpenAI account's are Codex's. Names and status
// only: what a connector runs (its target) never leaves the server
export type AccountConnection = { name: string; status: Connection['status']; via: 'claude.ai' | 'claude code' | 'codex' | 'copilot' }
const byAccount = new Map<string, { at: number; list: AccountConnection[] }>()
const viaOf = (name: string): AccountConnection['via'] => (name.startsWith('claude.ai ') ? 'claude.ai' : 'claude code')
export async function accountConnections(id: string, kind: 'claude' | 'openai' | 'llama' | 'copilot', env: NodeJS.ProcessEnv, fresh = false): Promise<AccountConnection[]> {
  const had = byAccount.get(id)
  if (!fresh && had && Date.now() - had.at < 300_000) return had.list
  let list: AccountConnection[]
  // Copilot brings GitHub's own connector; it reads no Claude or Codex configuration
  if (kind === 'copilot') list = [{ name: 'github', status: 'connected', via: 'copilot' }]
  else if (kind === 'openai') {
    const out = await run('codex', ['mcp', 'list', '--json'], { timeout: 60_000, cwd: '/tmp', env }).then((r) => r.stdout, () => '[]')
    list = (JSON.parse(out || '[]') as { name: string; enabled?: boolean }[]).map((s) => ({ name: s.name, status: s.enabled === false ? 'failed' : 'connected', via: 'codex' }))
  } else if (id === 'claude' || kind === 'llama') {
    const first = (await connections(fresh)).map((c) => ({ name: c.name, status: c.status, via: viaOf(c.name) }))
    list = kind === 'llama' ? first.filter((c) => c.via !== 'claude.ai') : first
  } else {
    const out = await run('claude', ['mcp', 'list'], { timeout: 120_000, cwd: '/tmp', env }).then((r) => r.stdout, (e) => String(e.stdout ?? ''))
    list = parseMcpList(out).map((c) => ({ name: c.name, status: c.status, via: viaOf(c.name) }))
  }
  byAccount.set(id, { at: Date.now(), list })
  return list
}
/** What an account lacks that the first one has (connected there, not here), as last read: for a run on a stand-in. */
export function missingOn(id: string): string[] {
  if (id === 'claude') return []
  const first = byAccount.get('claude')?.list, here = byAccount.get(id)?.list
  if (!first || !here) return []
  const ok = new Set(here.filter((c) => c.status === 'connected').map((c) => c.name.replace(/^claude\.ai /, '')))
  return first.filter((c) => c.status === 'connected' && !ok.has(c.name.replace(/^claude\.ai /, ''))).map((c) => c.name.replace(/^claude\.ai /, ''))
}
