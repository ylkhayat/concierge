#!/usr/bin/env node
// Start a command connection from the bank (server/bank.ts) with its environment, and nowhere else: the values come
// from Concierge's secrets file at the moment it starts, so they are never on a command line (where every process on
// the machine could read them) or in a file the agent reads. How you get a value there is yours: Concierge only keeps it.
//   bank-env <secrets.json> <name> -- <command…>
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const [file, name, sep, ...cmd] = process.argv.slice(2)
if (!file || !name || sep !== '--' || !cmd.length) { console.error('usage: bank-env <secrets.json> <name> -- <command…>'); process.exit(2) }
const entry = JSON.parse(readFileSync(file, 'utf8')).bank?.[name]
if (!entry) { console.error(`bank-env: ${name} isn't in the bank`); process.exit(1) }
const env = { ...process.env }
for (const [k, v] of Object.entries(entry.env ?? {})) if (typeof v === 'string') env[k] = v
const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env })
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s))
