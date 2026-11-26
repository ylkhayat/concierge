// Setting the webhooks up, from Settings (never by itself): Tailscale Funnel opens only the hook listener's path to the
// internet, on a port of its own (the app on 443 stays tailnet-only), and each repository gets a webhook pointing
// there. Concierge records the hooks it made, so Turn off removes exactly those. The commands and GitHub calls come in
// as functions, so tests run them against fakes.
import { execFile } from 'node:child_process'
import { EVENTS, HOOK_PATH } from './hooks.ts'

export const FUNNEL_PORT = 8443 // Funnel allows 443, 8443 and 10000; 443 is the app's (tailnet only)
export type Run = (args: string[], timeoutMs: number) => Promise<{ code: number; out: string }>

/** The tailscale command, through the fleet link's socket when there is one (tailscale.ts reads it the same way). */
export const tailscale: Run = (args, timeoutMs) => new Promise((resolve) => {
  const sock = process.env.TAILSCALE_SOCKET
  execFile('tailscale', [...(sock ? [`--socket=${sock}`] : []), ...args], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (e, stdout, stderr) =>
    resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: `${stdout ?? ''}${stderr ?? ''}` }))
})

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
export const target = (port: number) => `http://127.0.0.1:${port}${HOOK_PATH}`

/** Is the funnel on for the hook path, from `tailscale funnel status --json` (a ServeConfig)? */
export function funnelOnIn(json: string, host: string, port: number): boolean {
  try {
    const c = JSON.parse(json) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>; AllowFunnel?: Record<string, boolean> }
    const key = `${host.replace(/\.$/, '')}:${FUNNEL_PORT}`
    return !!c.AllowFunnel?.[key] && c.Web?.[key]?.Handlers?.[HOOK_PATH]?.Proxy === target(port)
  } catch { return false }
}

/** A failed funnel command, said plainly: what Tailscale refused, and where to fix it. */
export function funnelError(out: string): string {
  const link = out.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0]
  if (/funnel/i.test(out) && /not (enabled|allowed|available)|requires|attribute|policy|denied/i.test(out)) {
    return `Funnel isn't allowed for this machine yet. ${link ? `Tailscale says to enable it here: ${link}` : `Add the "funnel" node attribute for it in your Tailscale policy (${ACLS})`}, then try again.`
  }
  if (/https|cert/i.test(out) && /not (enabled|available)|disabled|enable/i.test(out)) return `HTTPS certificates are off for your tailnet: turn on HTTPS under DNS (${DNS}), then try again.`
  if (/port/i.test(out) && /in use|already|conflict/i.test(out)) return `Port ${FUNNEL_PORT} is already served by something else on this machine: \`tailscale funnel status\` shows what.`
  if (/ENOENT|not found|no such file/i.test(out)) return 'The tailscale command isn\'t on this machine.'
  const last = out.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  return `Tailscale refused: ${last?.slice(0, 240) ?? 'no reason given'}`
}

export const funnelOnArgs = (port: number) => ['funnel', '--bg', '--yes', `--https=${FUNNEL_PORT}`, `--set-path=${HOOK_PATH}`, target(port)]
export const funnelOffArgs = () => ['funnel', '--yes', `--https=${FUNNEL_PORT}`, `--set-path=${HOOK_PATH}`, 'off']

/** Open the funnel for the hook path only. Resolves to the public URL, or throws why not. */
export async function openFunnel(run: Run, self: Self | undefined, port: number): Promise<string> {
  const why = funnelBlocker(self)
  if (why) throw new Error(why)
  // --bg returns at once once it is set; one waiting on Funnel to be enabled prints a link and waits: cut off, the link said
  const r = await run(funnelOnArgs(port), 30_000)
  if (r.code !== 0 || /https:\/\/login\.tailscale\.com/.test(r.out)) throw new Error(funnelError(r.out))
  const st = await run(['funnel', 'status', '--json'], 10_000)
  if (!funnelOnIn(st.out, self!.DNSName!, port)) throw new Error(funnelError(r.out || 'Funnel didn\'t take: tailscale funnel status doesn\'t show the hook path'))
  return hookUrl(self!)
}
export async function closeFunnel(run: Run): Promise<void> {
  const r = await run(funnelOffArgs(), 15_000)
  // already off: nothing to remove, which is fine
  if (r.code !== 0 && !/not found|no (serve|funnel)|does not exist|nothing/i.test(r.out)) throw new Error(funnelError(r.out))
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
