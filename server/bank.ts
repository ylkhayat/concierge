// The connection bank: the connections Concierge itself holds, given to every agent run whichever account or tool does
// the work. An account's own connections (what its claude.ai login brings, what you signed in there) differ from
// account to account and can't be copied; the bank is one set, kept with Concierge's secrets, the same for all.
//
//   what is in it   every service Concierge holds a key for (Linear, Sentry), and every connector you added by its address
//   how a run gets it   for that one run: Claude Code's --mcp-config, Copilot's --additional-mcp-config, Codex's
//                   -c mcp_servers.… . Nothing is written into any tool's own configuration
//   which run gets what   by default the bank fills gaps: an account that already has a service through its own sign-in
//                   keeps that one (two connectors on one address hide each other, and the tools' names would change
//                   under running skills). With "bank only" (Settings → Connections) every run gets exactly the bank
//                   and nothing else, so a run's tools no longer depend on where it landed
//   who never gets it   a review of someone else's PR: those runs are kept away from your secrets (untrusted.ts)
//
// The files hold keys: they live in Concierge's state, readable by you alone, one set per machine, rewritten when the
// bank changes. Keys stay off the command line (a file path goes there, or the name of a variable), with one exception:
// Codex takes the variables of a server it starts itself as overrides, which do show in that machine's process list.
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ownServers, type McpServer } from './connections.ts'
import { readSecrets } from './scrub.ts'
import { expand, LOCAL_ENV, localEnv, missingIn } from './localEnv.ts'
import { STATE_DIR } from './paths.ts'
import { accountOf, type ProviderId } from './providers.ts'
import { config, state } from './store.ts'

const DIR = join(STATE_DIR, 'bank')
/** Every run gets exactly the bank, nothing of the account's own (Settings → Connections). */
export const bankOnly = () => !!config.connections?.bankOnly

// an address and its key with this machine's values put in (a command gets them as it starts: bin/bank-env.mjs)
const here = (s: McpServer): McpServer => (s.url ? { ...s, url: expand(s.url, localEnv()), ...(s.headers && { headers: Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k, expand(v, localEnv())])) }) } : s)
const forClaude = (s: McpServer) => (s.url ? { type: 'http', url: s.url, ...(s.headers && { headers: s.headers }) } : { command: s.command, args: s.args ?? [], ...(s.env && { env: s.env }) })
const forCopilot = (s: McpServer) => (s.url ? { type: 'http', url: s.url, tools: ['*'], ...(s.headers && { headers: s.headers }) } : { type: 'local', command: s.command, args: s.args ?? [], tools: ['*'], ...(s.env && { env: s.env }) })
const toml = (v: unknown) => JSON.stringify(v) // strings and arrays of strings read the same in TOML
/** Codex takes a server as config overrides; a bearer key goes in by the name of a variable, set for that run only. */
export function forCodex(servers: McpServer[]): { conf: string[]; env: Record<string, string> } {
  const conf: string[] = [], env: Record<string, string> = {}
  for (const s of servers.map(here)) {
    const at = `mcp_servers.${s.name.replace(/[^A-Za-z0-9_-]/g, '_')}`
    if (s.url) {
      conf.push(`${at}.url=${toml(s.url)}`)
      const bearer = /^Bearer (.+)$/.exec(s.headers?.Authorization ?? '')?.[1]
      if (bearer) { const v = `CONCIERGE_BANK_${s.name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`; env[v] = bearer; conf.push(`${at}.bearer_token_env_var=${toml(v)}`) }
    } else {
      conf.push(`${at}.command=${toml(s.command)}`, `${at}.args=${toml(s.args ?? [])}`)
      for (const [k, v] of Object.entries(s.env ?? {})) conf.push(`${at}.env.${k}=${toml(v)}`)
    }
  }
  return { conf, env }
}

/**
 * Which of the bank a run on this account gets. `set`: the file it is written to.
 *   all    bank only, or a tool that isn't Claude Code on a claude.ai login: everything it can use
 *   extra  another Claude account: what its claude.ai login doesn't already bring (the connectors you added)
 *   none   the first Claude account, which already has all of it its own way
 */
export function bankFor(servers: McpServer[], kind: string, first: boolean, only: boolean, viaLogin: boolean): { set: 'all' | 'extra' | 'none'; servers: McpServer[] } {
  // a connector that needs a browser sign-in lives in a Claude account's own login store: no other tool can use it
  const usable = (s: McpServer) => kind === 'claude' || kind === 'llama' || !s.login
  if (only) return { set: 'all', servers: servers.filter(usable) }
  // the first Claude account has your connectors and its claude.ai ones its own way: the bank adds the rest
  if (kind === 'claude' && first) { const extra = servers.filter((s) => !s.coveredByClaudeAi && !s.inAccount); return { set: extra.length ? 'extra' : 'none', servers: extra } }
  if (kind === 'claude' && viaLogin) { const extra = servers.filter((s) => !s.coveredByClaudeAi); return { set: 'extra', servers: extra } }
  return { set: 'all', servers: servers.filter(usable) }
}
const pick = (p: ProviderId) => {
  const a = accountOf(p)
  // the first account runs on its claude.ai login when you chose that; an account you added is always a login
  return bankFor(ownServers(), a.kind, p === 'claude', bankOnly(), p === 'claude' ? !!state.claudeLogin : true)
}

const file = (p: ProviderId, tool: 'claude' | 'copilot') => join(DIR, `${p.replace(/[^\w.-]/g, '_')}.${tool}.json`)
const written = new Map<string, string>()
/** Write each account's part of the bank where its runs are pointed at (at start, and whenever the bank may have changed). */
export async function writeBank(accounts: ProviderId[]) {
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  for (const p of accounts) for (const tool of ['claude', 'copilot'] as const) {
    const { servers } = pick(p)
    const text = JSON.stringify({ mcpServers: Object.fromEntries(servers.map((s) => [s.name, (tool === 'claude' ? forClaude : forCopilot)(here(s))])) })
    const f = file(p, tool)
    if (written.get(f) === text) continue
    await writeFile(f, text, { mode: 0o600 }); await chmod(f, 0o600)
    written.set(f, text)
  }
}

/** Claude Code's flags that hand a run its part of the bank ('' for none): the other tools' forms are made from these (providers.ts). */
export function bankArgs(p: ProviderId): string[] {
  const { set, servers } = pick(p)
  if (set === 'none' || (!servers.length && !bankOnly()) || !written.has(file(p, 'claude'))) return []
  return ['--mcp-config', file(p, 'claude'), ...(bankOnly() && accountOf(p).kind === 'claude' ? ['--strict-mcp-config'] : [])]
}
/** The same file, as Copilot reads it. */
export const copilotBank = (claudeFile: string) => claudeFile.replace(/\.claude\.json$/, '.copilot.json')
/** The servers behind a bank file, for Codex (it takes them as overrides, not a file). */
export const codexBank = (p: ProviderId) => forCodex(pick(p).servers)
/** The names in the bank now, with how each signs in: the Connections page. */
export const bankView = () => {
  const mine = readSecrets().bank ?? {}
  return { only: bankOnly(), file: LOCAL_ENV, servers: ownServers().map((s) => ({ name: s.name, service: s.service, how: s.login ? 'login' as const : 'key' as const, mine: !!s.mine, target: s.shown ?? s.url ?? `${s.command} ${(s.args ?? []).join(' ')}`.trim(),
    // yours, for editing: what it is, never a value (a key or a value left empty keeps the one kept)
    // the ${NAME}s it needs that this machine's mcp.env doesn't have
    ...(s.mine && mine[s.name] && { missing: missingIn([mine[s.name].url ?? '', mine[s.name].key ?? '', ...(mine[s.name].command ?? []), ...Object.values(mine[s.name].env ?? {})]) }),
    ...(s.mine && mine[s.name] && { edit: mine[s.name].command ? { kind: 'command' as const, command: mine[s.name].command!.join(' '), env: Object.keys(mine[s.name].env ?? {}) } : { kind: 'address' as const, url: mine[s.name].url ?? '' } }) })) }
}
