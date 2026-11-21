// Tailscale, as this machine's Concierge sees it: the fleet's link container (its tailscaled, through the socket it
// shares: fleet/compose.fleet.yml), else a tailscale command here. Read-only: a link started without an auth key waits
// for an interactive sign-in and says where in its status (AuthURL), which onboarding shows as a button. No key in .env.
import { execFile } from 'node:child_process'
import { get as httpGet } from 'node:http'

export type TsPeer = { HostName?: string; DNSName?: string; OS?: string; Online?: boolean; Tags?: string[]; TailscaleIPs?: string[]; LastSeen?: string }
export type TsStatus = { BackendState?: string; AuthURL?: string; Self?: TsPeer; Peer?: Record<string, TsPeer>; MagicDNSSuffix?: string; CurrentTailnet?: { Name?: string } }

/** The raw status, or null when no Tailscale answers here. */
export async function tsStatus(): Promise<TsStatus | null> {
  const sock = process.env.TAILSCALE_SOCKET ?? '/var/run/tailscale/tailscaled.sock'
  const out = await new Promise<string | null>((resolve) => {
    const req = httpGet({ socketPath: sock, path: '/localapi/v0/status', headers: { Host: 'local-tailscaled.sock' }, timeout: 5000 }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (d) => { body += d }); res.on('end', () => resolve(res.statusCode === 200 ? body : null))
    })
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null) })
  }) ?? await new Promise<string | null>((resolve) => execFile('tailscale', ['status', '--json'], { timeout: 5000, maxBuffer: 4 << 20 }, (e, o) => resolve(e ? null : o)))
  if (!out) return null
  try { return JSON.parse(out) as TsStatus } catch { return null }
}

export type TailscaleView = { running: boolean; signedIn: boolean; state?: string; authUrl?: string; tailnet?: string; name?: string }

/** What onboarding needs: is it there, is it signed in, and if not, where to sign it in. */
export async function tailscaleView(): Promise<TailscaleView> {
  const s = await tsStatus()
  if (!s) return { running: false, signedIn: false }
  const signedIn = s.BackendState === 'Running'
  return {
    running: true, signedIn, state: s.BackendState, authUrl: signedIn ? undefined : s.AuthURL || undefined,
    tailnet: s.CurrentTailnet?.Name, name: s.Self?.DNSName?.replace(/\.$/, '') ?? s.Self?.HostName,
  }
}
