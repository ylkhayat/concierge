// Setting the webhooks up, from Settings (never by itself): Tailscale Funnel opens only the hook listener's path to the
// internet, on a port of its own (the app on 443 stays tailnet-only), and each repository gets a webhook pointing
// there. Concierge records the hooks it made, so Turn off removes exactly those. GitHub calls come in as functions, so
// tests run them against fakes.
//
// Tailscale is the fleet's, not the app's (the app has no tailscale command, only a read-only look at the link's
// status): the app says whether it wants the door (hooks-funnel.ask, beside update-asked) and the fleet's standby,
// which runs the link, opens or closes it on the control plane and says how it went (hooks-funnel.<machine>.answer).
// Not in hosts/, where every .json is a machine's heartbeat.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVENTS, HOOK_PATH } from './hooks.ts'

export const FUNNEL_PORT = 8443 // Funnel allows 443, 8443 and 10000; 443 is the app's (tailnet only)

/** The door as the app wants it, for the fleet's standby to apply: `at` tells this ask from the last. */
export function askDoor(dir: string, on: boolean, port: number, at = Date.now()): number {
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, '.hooks-funnel.tmp')
  writeFileSync(tmp, JSON.stringify({ on, port, at }))
  renameSync(tmp, join(dir, 'hooks-funnel.ask'))
  return at
}
export type DoorResult = { on: boolean; ok: boolean; asked: number; at: number; error?: string | null }
/** What the standby on `machine` last did with the door, if anything. */
export function doorResult(dir: string, machine: string | undefined): DoorResult | undefined {
  if (!machine) return undefined
  try { return JSON.parse(readFileSync(join(dir, `hooks-funnel.${machine}.answer`), 'utf8')) as DoorResult } catch { return undefined }
}
/** The standby's answer to the ask made at `at` (it looks every 10 seconds), or undefined after `ms`. */
export async function doorAnswer(dir: string, machine: string | undefined, at: number, ms = 45_000, step = 1000): Promise<DoorResult | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, step))) {
    const r = doorResult(dir, machine)
    if (r && r.asked >= at) return r
  }
  return undefined
}

const ACLS = 'https://login.tailscale.com/admin/acls'
const DNS = 'https://login.tailscale.com/admin/dns'
export type Self = { DNSName?: string; Capabilities?: string[]; CapMap?: Record<string, unknown> }
const caps = (s: Self) => new Set([...(s.Capabilities ?? []), ...Object.keys(s.CapMap ?? {})])

/** What stops Funnel on this machine before trying, from its status: no name, no HTTPS certificates, Funnel not allowed. */
export function funnelBlocker(self: Self | undefined): string | undefined {
  if (!self?.DNSName) return 'Tailscale isn\'t running or signed in on this machine.'
  const c = caps(self)
  if (!c.has('https')) return `HTTPS certificates are off for your tailnet: turn on HTTPS under DNS in the Tailscale admin console (${DNS}).`
  if (!c.has('funnel')) return `Funnel isn't allowed for this machine. In the Tailscale admin console (${ACLS}), add the "funnel" node attribute for it to your policy, then try again.`
  return undefined
}

/** The public address of the hook path on this machine. */
export const hookUrl = (self: Self) => `https://${self.DNSName!.replace(/\.$/, '')}:${FUNNEL_PORT}${HOOK_PATH}`

/** A failed funnel command (the standby passes Tailscale's own words on), said plainly: what Tailscale refused, and where to fix it. */
export function funnelError(out: string): string {
  const link = out.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0]
  if (/funnel/i.test(out) && /not (enabled|allowed|available)|requires|attribute|policy|denied/i.test(out)) {
    return `Funnel isn't allowed for this machine yet. ${link ? `Tailscale says to enable it here: ${link}` : `Add the "funnel" node attribute for it in your Tailscale policy (${ACLS})`}, then try again.`
  }
  if (/https|cert/i.test(out) && /not (enabled|available)|disabled|enable/i.test(out)) return `HTTPS certificates are off for your tailnet: turn on HTTPS under DNS (${DNS}), then try again.`
  if (/port/i.test(out) && /in use|already|conflict/i.test(out)) return `Port ${FUNNEL_PORT} is already served by something else on this machine: \`tailscale funnel status\` shows what.`
  const last = out.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  return `Tailscale refused: ${last?.slice(0, 240) ?? 'no reason given'}`
}

// --- GitHub ---------------------------------------------------------------------------------------------------------
export type Call = <T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<{ status: number; json: T & { message?: string } }>
export type Outcome = { repo: string; ok: true; id: number; reused: boolean } | { repo: string; ok: false; problem: 'no-admin' | 'scope' | 'error'; text: string }

/** What a token needs for repository webhooks: `repo` covers them (GitHub's scope docs), `admin:repo_hook` is the narrow one. */
export const HOOK_SCOPES = ['admin:repo_hook', 'write:repo_hook', 'repo']
/** May this token make webhooks, by its scopes? undefined: it doesn't say (a fine-grained token: its Webhooks permission decides). */
export const scopesAllowHooks = (scopes: string[] | undefined) => (scopes ? scopes.some((s) => HOOK_SCOPES.includes(s)) : undefined)

const hookBody = (url: string, secret: string) => ({ name: 'web', active: true, events: [...EVENTS], config: { url, content_type: 'json', secret, insecure_ssl: '0' } })

/**
 * Make (or update) this repository's webhook: only with admin rights on it (else it keeps polling); one already
 * pointing at `url` is updated, never doubled. A refusal while you are admin is the token's: it lacks the scope.
 */
export async function connectRepo(call: Call, repo: string, url: string, secret: string): Promise<Outcome> {
  try {
    const r = await call<{ permissions?: { admin?: boolean } }>('GET', `/repos/${repo}`)
    if (r.status === 404 || r.status === 403) return { repo, ok: false, problem: 'no-admin', text: 'Needs admin on this repository: it keeps polling' }
    if (r.status >= 400) return { repo, ok: false, problem: 'error', text: `GitHub ${r.status}: ${r.json.message ?? ''}`.trim() }
    if (r.json.permissions && !r.json.permissions.admin) return { repo, ok: false, problem: 'no-admin', text: 'Needs admin on this repository: it keeps polling' }
    const list = await call<{ id: number; config?: { url?: string } }[]>('GET', `/repos/${repo}/hooks?per_page=100`)
    if (list.status === 403 || list.status === 404) return { repo, ok: false, problem: 'scope', text: 'Your GitHub token may not manage webhooks: sign in to GitHub again to allow it' }
    if (list.status >= 400) return { repo, ok: false, problem: 'error', text: `GitHub ${list.status}: ${list.json.message ?? ''}`.trim() }
    const same = (Array.isArray(list.json) ? list.json : []).find((h) => h.config?.url === url)
    const w = same ? await call<{ id: number }>('PATCH', `/repos/${repo}/hooks/${same.id}`, hookBody(url, secret)) : await call<{ id: number }>('POST', `/repos/${repo}/hooks`, hookBody(url, secret))
    if (w.status === 403 || w.status === 404) return { repo, ok: false, problem: 'scope', text: 'Your GitHub token may not manage webhooks: sign in to GitHub again to allow it' }
    if (w.status >= 400 || !w.json.id) return { repo, ok: false, problem: 'error', text: `GitHub ${w.status}: ${w.json.message ?? 'no hook made'}` }
    return { repo, ok: true, id: w.json.id, reused: !!same }
  } catch (e) { return { repo, ok: false, problem: 'error', text: (e as Error).message } }
}

/** Remove a hook Concierge made; one already gone counts as removed. */
export async function removeHook(call: Call, repo: string, id: number): Promise<boolean> {
  const r = await call('DELETE', `/repos/${repo}/hooks/${id}`)
  return r.status === 204 || r.status === 404
}
/** Ask GitHub to send the hook a ping (a test, and the heartbeat that keeps it counted as live). */
export async function pingHook(call: Call, repo: string, id: number): Promise<{ ok: boolean; gone?: boolean; text?: string }> {
  const r = await call('POST', `/repos/${repo}/hooks/${id}/pings`)
  return r.status === 204 ? { ok: true } : { ok: false, gone: r.status === 404, text: r.json.message ?? `GitHub ${r.status}` }
}
