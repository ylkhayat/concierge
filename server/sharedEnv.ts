// One set of keys for every machine: set once in Settings → Machines, kept in secrets.json (readable only by you, in the
// config folder every machine syncs), and applied here before anything else reads its environment. A key set there
// wins over the one in this machine's own .env; until it is set, the .env one is used as before. Re-read every 30s
// (index.ts), so a key changed on one machine reaches the others without a restart. Never shown back: the page only
// learns whether a key is set, and since when.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from './paths.ts'

export const SHARED_KEYS = ['GITHUB_TOKEN', 'LINEAR_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] as const
export type SharedKey = typeof SHARED_KEYS[number]
export type Shared = Partial<Record<SharedKey, { value: string; at: string; from?: string }>> // from: the machine whose .env it came from

const FILE = join(CONFIG_DIR, 'secrets.json')
/** What this machine's own environment (.env) had at start: the fallback, and how the page tells the two apart. */
export const local: Partial<Record<SharedKey, string>> = Object.fromEntries(SHARED_KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]))
// each Claude account you added: its own setup token (claude setup-token, a year long), what its runs use on a machine
// where its claude.ai login stopped working (claudeLogin.ts), so its work never stops on a lapsed login
export type AccountTokens = Record<string, { value: string; at: string }>
let seen = -1, shared: Shared = {}, tokens: AccountTokens = {}, loginOn = false
/** Agents use the full claude.ai login (claudeLogin.ts): the Claude token stays out of the environment. */
export const claudeTokenOff = (on: boolean) => { loginOn = on }
export const sharedNow = () => shared
/** The Claude token to use when agents run on a token (claudeLogin.ts): the shared one, else this machine's. */
export const claudeToken = () => shared.CLAUDE_CODE_OAUTH_TOKEN?.value ?? local.CLAUDE_CODE_OAUTH_TOKEN
/** An added Claude account's fallback token, and since when it is set (never shown back, only whether). */
export const accountToken = (id: string) => tokens[id]?.value
export const accountTokenAt = (id: string) => tokens[id]?.at
/** For a test: the fallback tokens as if read from the file. */
export const setAccountTokensForTest = (t: AccountTokens) => { tokens = t }

/** Read the shared keys if the file changed, and put them in this process's environment. Returns the keys that changed. */
export function applyShared(force = false): SharedKey[] {
  try {
    const m = statSync(FILE).mtimeMs
    if (m === seen && !force) return []
    seen = m
    const j = JSON.parse(readFileSync(FILE, 'utf8')) as { shared?: Shared; accountTokens?: AccountTokens }
    shared = j.shared ?? {}; tokens = j.accountTokens ?? {}
  } catch { return [] }
  const changed: SharedKey[] = []
  for (const k of SHARED_KEYS) {
    const v = shared[k]?.value ?? local[k]
    // the Claude token is out of the environment while agents use the full claude.ai login: left out then
    if (k === 'CLAUDE_CODE_OAUTH_TOKEN' && loginOn) continue
    if (v && process.env[k] !== v) { process.env[k] = v; changed.push(k) }
  }
  if (process.env.GITHUB_TOKEN) process.env.GH_TOKEN = process.env.GITHUB_TOKEN // gh reads this one
  return changed
}
applyShared(true)
