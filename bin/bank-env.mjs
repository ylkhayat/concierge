#!/usr/bin/env node
// Start a command connection from the bank (server/bank.ts) with its environment, and nowhere else: the values are put in
// at the moment it starts, so they are never on a command line (where every process on the machine could read them) or
// in a file the agent is handed. A value is either written in the connection itself, or named as ${NAME} (${NAME:-default})
// and read from this machine's mcp.env (server/localEnv.ts), the way Claude Code's own .mcp.json names its values.
//   bank-env <secrets.json> <mcp.env> <name> -- <command…>
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [file, local, name, sep, ...cmd] = process.argv.slice(2)
if (!file || !local || !name || sep !== '--' || !cmd.length) { console.error('usage: bank-env <secrets.json> <mcp.env> <name> -- <command…>'); process.exit(2) }
const entry = JSON.parse(readFileSync(file, 'utf8')).bank?.[name]
if (!entry) { console.error(`bank-env: ${name} isn't in the bank`); process.exit(1) }
const vals = {}
try {
  for (const raw of readFileSync(local, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) vals[m[1]] = /^(["']).*\1$/.test(m[2]) ? m[2].slice(1, -1) : m[2].replace(/\s+#.*$/, '')
  }
} catch { /* no file on this machine: only written values */ }
const missing = new Set()
// a placeholder left empty counts as missing: a server started with an empty connection string only fails later, less clearly
const expand = (t) => t.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, n, d) => vals[n] || d || (missing.add(n), ''))
const env = { ...process.env }
for (const [k, v] of Object.entries(entry.env ?? {})) if (typeof v === 'string') env[k] = expand(v)
const args = cmd.map(expand)
if (missing.size) { console.error(`bank-env: ${name} needs ${[...missing].join(', ')} in ${local} on this machine`); process.exit(1) }
const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env })
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s))
