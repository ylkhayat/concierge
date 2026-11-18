// Your own file of values for the connections in the bank: `mcp.env` in Concierge's config folder, one NAME=value per
// line, the way an MCP server's own docs say to give it its settings. A bank connection is configured as the MCP
// server expects (its command, its environment, its address) and names a value as ${NAME} (or ${NAME:-default}), as
// Claude Code's own .mcp.json does; the value is read from this file when the connection starts.
//
// It is yours, and it stays on the machine it is on: never copied to another machine (replica.ts skips it), never
// put in Concierge's environment (so agents don't inherit it), never written back by Concierge, and scrubbed from logs.
// Each machine has its own: a value missing on one machine is said on the Connections page.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from './paths.ts'

export const LOCAL_ENV = join(CONFIG_DIR, 'mcp.env')

/** NAME=value lines: blank lines and # comments skipped, `export ` allowed, a value in quotes taken as written. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const v = m[2]
    out[m[1]] = /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v.replace(/\s+#.*$/, '')
  }
  return out
}

let cache: { mtime: number; vals: Record<string, string> } | undefined
/** This machine's values, read again whenever the file changes. */
export function localEnv(): Record<string, string> {
  try {
    const mtime = statSync(LOCAL_ENV).mtimeMs
    if (cache?.mtime !== mtime) cache = { mtime, vals: parseEnv(readFileSync(LOCAL_ENV, 'utf8')) }
    return cache.vals
  } catch { return {} }
}

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g
/** The names a text refers to. */
export const refsIn = (text: string) => [...text.matchAll(REF)].map((m) => m[1])
/** A text with each ${NAME} put in from `vals` (a missing one: its default, else empty). */
export const expand = (text: string, vals: Record<string, string>) => text.replace(REF, (_, n: string, d?: string) => vals[n] ?? d ?? '')
/** The names these texts refer to that this machine's file doesn't have (and that carry no default). */
export function missingIn(texts: string[], vals = localEnv()): string[] {
  const need = texts.flatMap((t) => [...t.matchAll(REF)].filter((m) => m[2] === undefined).map((m) => m[1]))
  return [...new Set(need.filter((n) => vals[n] === undefined))]
}
