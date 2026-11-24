// Secrets never leave Concierge through what it stores or shows: every line an agent produces is scrubbed of each
// key and connection string the app knows, before it reaches a log, the Activity feed or a summary.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONFIG_FILE } from './config.ts'
import { localEnv } from './localEnv.ts'

// keys you hand over in the app (a Sentry token, MongoDB strings): next to the settings, readable only by you
export const SECRETS_FILE = join(dirname(CONFIG_FILE), 'secrets.json')
export type Secrets = {
  sentryToken?: string; sentryHost?: string
  bank?: Record<string, { url?: string; key?: string; command?: string[]; env?: Record<string, string> }> // connections you put in the bank yourself: an address and its key, or a command and its environment, handed to it as it starts (bin/bank-env.mjs) (bank.ts)
  shared?: import('./sharedEnv.ts').Shared // the keys every machine uses (sharedEnv.ts)
  accountTokens?: import('./sharedEnv.ts').AccountTokens // each added Claude account's fallback token (sharedEnv.ts)
}
// read once, then kept in memory: only this app writes the file (saveSecrets), and reading it on every call
// would block the server on the Mac's file sharing
let secrets: Secrets | undefined
export const readSecrets = (): Secrets => {
  if (!secrets) { try { secrets = existsSync(SECRETS_FILE) ? JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) : {} } catch { secrets = {} } }
  return secrets!
}

/** Read the file again next time: another machine changed it (it syncs). */
export const rereadSecrets = () => { secrets = undefined; forgetSecretCache() }

export function saveSecrets(patch: Secrets) {
  secrets = { ...readSecrets(), ...patch }
  writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 })
  chmodSync(SECRETS_FILE, 0o600)
  forgetSecretCache()
}
// secrets that live only in memory (temporary passwords, access tokens): scrubbed too
const extra = new Set<string>()
export const addSecret = (v: string) => { if (v && v.length >= 8) { extra.add(v); extra.add(encodeURIComponent(v)); forgetSecretCache() } }

const ENV_KEYS = ['LINEAR_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CONCIERGE_PASSWORD', 'REVIEW_DECK_PASSWORD']
let values: { at: number; list: string[] } | undefined
/** Every secret value known right now (env keys, stored tokens, connection strings and their passwords); cached a minute. */
function secretValues(): string[] {
  if (values && Date.now() - values.at < 60_000) return values.list
  const s = readSecrets()
  const list = [...ENV_KEYS.map((k) => process.env[k]), s.sentryToken, ...Object.values(s.bank ?? {}).flatMap((x) => [x.key, ...Object.values(x.env ?? {})]), ...Object.values(localEnv()), ...Object.values(s.shared ?? {}).map((x) => x?.value), ...Object.values(s.accountTokens ?? {}).map((x) => x?.value), ...extra]
    .filter((x): x is string => !!x && x.length >= 8).sort((a, b) => b.length - a.length) // longest first: a string before the password inside it
  values = { at: Date.now(), list }
  return list
}
/** After a secret is added or changed, so the next scrub knows it. */
export const forgetSecretCache = () => { values = undefined }

/** `text` with every known secret replaced by ***. */
export function scrub(text: string): string {
  if (!text) return text
  let out = text
  for (const v of secretValues()) if (out.includes(v)) out = out.split(v).join('***')
  return out
}
