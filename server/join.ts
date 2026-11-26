// Joining a machine: a new one, signed in to the same Tailscale, runs bin/join on its host; it finds Concierge on the
// tailnet (GET /hello on each machine's worker port answers who it is, and nothing else), and asks the main server to
// join (POST /join). The main server asks its own Tailscale who is calling (whois: Tailscale vouches for it):
//
//   your own login   approved at once: it is you on another machine
//   a Concierge link approved at once when the tailnet has one person: a device tagged tag:concierge was signed in by
//                    someone the tailnet lets own that tag, and with nobody else on it that is you (the join a new
//                    machine's standby starts by itself, fleet/bin/standby)
//   anyone else      waits for your approval (Settings → Machines, and an alert), with a code both screens show
//
// Approved, it gets what it needs to set itself up: the machine key, the main server's address and container paths,
// its role (the standby if there is none yet, else a worker), the keys every machine shares, and where the fleet
// extension is. The state, settings and sessions then come over by replication (replica.ts); sign-ins stay per
// machine (Settings → Accounts signs it in).
import { randomInt, randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { alert, seeAlerts } from './alerts.ts'
import { fleet } from './fleet.ts'
import { token } from './machines.ts'
import { STATE_DIR } from './paths.ts'
import { tailnetOwner } from './tailscale.ts'

/** Ask this machine's Tailscale (the link's tailscaled, through the socket it shares), or undefined when there is none. */
export function localApi<T>(path: string): Promise<T | undefined> {
  const socketPath = process.env.TAILSCALE_SOCKET ?? '/var/run/tailscale/tailscaled.sock'
  return new Promise((resolve) => {
    const req = request({ socketPath, path: `/localapi/v0/${path}`, headers: { Host: 'local-tailscaled.sock' }, timeout: 5000 }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (d) => { body += d })
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) as T : undefined) } catch { resolve(undefined) } })
    })
    req.on('error', () => resolve(undefined)); req.on('timeout', () => { req.destroy(); resolve(undefined) })
    req.end()
  })
}
type Status = { Self?: { UserID?: number }; User?: Record<string, { LoginName?: string }> }
type WhoIs = { UserProfile?: { LoginName?: string }; Node?: { Name?: string; Tags?: string[] } }

/** Who is calling from `ip`, by Tailscale, and whether it is the login this machine's Tailscale belongs to. */
export async function whoIs(ip: string): Promise<{ login?: string; mine: boolean; link?: boolean; node?: string }> {
  const addr = ip.replace(/^::ffff:/, '')
  if (!/^100\.|^fd7a:/i.test(addr)) return { mine: false } // through a proxy (127.0.0.1): Tailscale can't say who
  const [w, s] = await Promise.all([localApi<WhoIs>(`whois?addr=${encodeURIComponent(`${addr}:1`)}`), localApi<Status>('status')])
  const login = w?.UserProfile?.LoginName
  const self = s?.Self?.UserID != null ? s.User?.[String(s.Self.UserID)]?.LoginName : undefined
  // a tagged node (a link container) belongs to its tag, not a person: it never counts as yours
  return { login, mine: !!login && !!self && login === self && !w?.Node?.Tags?.length, link: !!w?.Node?.Tags?.includes('tag:concierge'), node: w?.Node?.Name?.split('.')[0] }
}

/** What GET /hello answers, without the machine key: that this is Concierge, and which machine runs the main server. */
export function hello() {
  return { concierge: true, name: fleet.machine, role: process.env.DECK_ROLE, main: fleet.elsewhere() ?? fleet.machine, version: process.env.DECK_VERSION }
}

type Join = { id: string; name: string; ip: string; login?: string; code: string; at: number; state: 'waiting' | 'approved' | 'denied'; rekey?: boolean }
const joins = new Map<string, Join>()
const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/

async function roles() {
  const out: Record<string, string> = {}
  for (const f of await readdir(join(STATE_DIR, 'hosts')).catch(() => [] as string[])) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const b = JSON.parse(await readFile(join(STATE_DIR, 'hosts', f), 'utf8').catch(() => '{}')) as { role?: string }
    out[f.slice(0, -5)] = b.role ?? ''
  }
  return out
}

/** What an approved machine sets itself up with (bin/join): only ever to the one that asked, once approved. */
async function setup(j: Join) {
  const taken = await roles()
  const role = Object.values(taken).includes('standby') || process.env.DECK_ROLE === 'standby' ? 'worker' : 'standby'
  const [, fleetRepo] = (process.env.DECK_REPOS ?? '').split(/\s+/)
  return {
    name: j.name, role, key: token(), main: fleet.machine,
    // the container paths are the same on every machine (state, sessions and worktrees line up): the main server's
    deckHome: process.env.HOME, deckCode: process.env.DECK_CODE || process.env.CODE_DIR, dirName: process.env.CONCIERGE_DIRNAME || 'review-deck',
    fleetRepo: fleetRepo || undefined,
    // the GitHub token, only to clone the private fleet extension there; never written to its .env (bin/join)
    env: Object.fromEntries(['GITHUB_TOKEN'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!])),
  }
}

/** A machine asks to join (POST /join, no machine key: it has none yet). */
export async function ask(body: { name?: string; rekey?: boolean }, ip: string) {
  if (!fleet.machine || fleet.elsewhere()) throw new Error(`ask the main server${fleet.elsewhere() ? `, ${fleet.elsewhere()}` : ''}`)
  const name = String(body.name ?? '').toLowerCase()
  if (!NAME.test(name)) throw new Error('a machine name is lowercase letters, digits and dashes')
  const taken = await roles()
  if (body.rekey) return rekey(name, taken, ip)
  if (name === fleet.machine || taken[name] !== undefined) throw new Error(`${name} is already a machine here: pick another name`)
  // one open ask per address: asking again replaces it
  for (const [k, j] of joins) if (j.ip === ip && j.state === 'waiting') joins.delete(k)
  const who = await whoIs(ip)
  const owner = who.link && !who.mine ? await tailnetOwner() : undefined // only you on the tailnet: only you could tag it
  const j: Join = { id: randomUUID(), name, ip, login: who.login, code: String(randomInt(1000, 10000)), at: Date.now(), state: who.mine || owner ? 'approved' : 'waiting' }
  joins.set(j.id, j)
  if (who.mine) console.log(`join: ${name} (${who.login}) joins: the same Tailscale login`)
  else if (owner) console.log(`join: ${name} joins: a Concierge link on ${owner}'s tailnet, which nobody else is on`)
  else {
    console.log(`join: ${name} (${who.login ?? ip}) asks to join; waiting for approval`)
    alert({ kind: 'system', id: `join-${j.id}`, label: 'A machine asks to join', title: `${name} asks to join` },
      `${name} (${who.login ?? `from ${ip}`}) asks to join. Approve it in Settings → Machines if its screen shows ${j.code}.`, 'warn', true)
  }
  return { id: j.id, code: j.code, state: j.state, ...(j.state === 'approved' && { setup: await setup(j) }) }
}

/**
 * One of your machines that missed a new machine key (it was off when the key changed) asks for the current one: it can
 * no longer reach the others, nor they it. Granted at once only when Tailscale vouches it is that very machine (its
 * link, concierge-<name>, on a tailnet nobody else is on) or your own login; anyone else waits for your approval.
 */
async function rekey(name: string, taken: Record<string, string>, ip: string) {
  if (taken[name] === undefined || name === fleet.machine) throw new Error(`${name} isn't one of the machines here: join instead`)
  for (const [k, j] of joins) if (j.ip === ip && j.state === 'waiting') joins.delete(k)
  const who = await whoIs(ip)
  const itself = who.link && who.node === `concierge-${name}` && !!(await tailnetOwner())
  const j: Join = { id: randomUUID(), name, ip, login: who.login, code: String(randomInt(1000, 10000)), at: Date.now(), state: who.mine || itself ? 'approved' : 'waiting', rekey: true }
  joins.set(j.id, j)
  if (j.state === 'approved') console.log(`join: ${name} gets the current machine key (${who.mine ? 'your login' : `its link, ${who.node}`})`)
  else alert({ kind: 'system', id: `join-${j.id}`, label: 'A machine asks for the key', title: `${name} asks for the machine key` },
    `${name} (${who.login ?? who.node ?? `from ${ip}`}) lost the machine key and asks for it. Approve it in Settings → Machines if its log shows ${j.code}.`, 'warn', true)
  return { id: j.id, code: j.code, state: j.state, ...(j.state === 'approved' && { setup: { name, key: token(), main: fleet.machine } }) }
}

const decided = new Map<string, (() => void)[]>()
/**
 * The asking machine waits on this (GET /join/<id>): its setup once approved. With `wait` (seconds, up to 55) it is
 * answered when you decide, or then: one open request meanwhile, not one every few seconds.
 */
export async function status(id: string, ip: string, wait = 0) {
  const j = joins.get(id)
  if (!j || j.ip !== ip || Date.now() - j.at > 30 * 60_000) throw new Error('no such ask (asked over 30 minutes ago?)')
  if (j.state === 'waiting' && wait > 0) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(done, Math.min(wait, 55) * 1000)
      function done() { clearTimeout(t); decided.set(id, (decided.get(id) ?? []).filter((f) => f !== done)); resolve() }
      decided.set(id, [...(decided.get(id) ?? []), done])
    })
  }
  return { state: j.state, code: j.code, ...(j.state === 'approved' && { setup: j.rekey ? { name: j.name, key: token(), main: fleet.machine } : await setup(j) }) }
}

/** The asks waiting for you (Settings → Machines). */
export const waiting = () => [...joins.values()].filter((j) => j.state === 'waiting' && Date.now() - j.at < 30 * 60_000).map(({ id, name, ip, login, code, at }) => ({ id, name, ip, login, code, at }))
export function decide(id: string, approve: boolean) {
  const j = joins.get(id)
  if (!j || j.state !== 'waiting') throw new Error('no such ask')
  j.state = approve ? 'approved' : 'denied'
  for (const f of decided.get(id) ?? []) f()
  seeAlerts([`system:join-${id}`])
  console.log(`join: ${j.name} ${approve ? 'approved' : 'denied'}`)
  return j
}
