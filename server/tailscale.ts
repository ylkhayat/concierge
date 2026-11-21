// Tailscale, as this machine's Concierge sees it: the fleet's link container (its tailscaled, through the socket it
// shares: fleet/compose.fleet.yml), else a tailscale command here. Read-only: a link started without an auth key waits
// for an interactive sign-in and says where in its status (AuthURL), which onboarding shows as a button. No key in .env.
import { execFile } from 'node:child_process'
import { get as httpGet } from 'node:http'

export type TsPeer = { HostName?: string; DNSName?: string; OS?: string; Online?: boolean; Tags?: string[]; TailscaleIPs?: string[]; LastSeen?: string; UserID?: number; ID?: string }
export type TsStatus = { BackendState?: string; AuthURL?: string; Self?: TsPeer; Peer?: Record<string, TsPeer>; MagicDNSSuffix?: string; CurrentTailnet?: { Name?: string }; User?: Record<string, { LoginName?: string }> }

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

/**
 * Whose tailnet this is: the one login every person's device on it is signed in as (the link itself is a tagged
 * device, which belongs to nobody). Several people on the tailnet, or none seen yet: undefined, nothing is guessed.
 */
export async function tailnetOwner(): Promise<string | undefined> {
  const s = await tsStatus()
  if (!s || s.BackendState !== 'Running') return undefined
  const people = new Set([s.Self, ...Object.values(s.Peer ?? {})].filter((d): d is TsPeer => !!d && !d.Tags?.length && d.UserID != null)
    .map((d) => s.User?.[String(d.UserID)]?.LoginName).filter((l): l is string => !!l && l !== 'tagged-devices'))
  return people.size === 1 ? [...people][0] : undefined
}

export type Nearby = { name: string; host: string; online: boolean; lastSeen?: string; ip?: string }
/**
 * The other Concierge machines on the tailnet, online or not: each one's link is a device tagged tag:concierge, named
 * concierge-<machine>. What setup shows before this machine joins them, and while it waits for one to be online.
 */
export async function nearbyMachines(): Promise<Nearby[]> {
  const s = await tsStatus()
  if (!s || s.BackendState !== 'Running') return []
  const me = s.Self?.HostName
  return Object.values(s.Peer ?? {})
    .filter((p) => p.HostName && p.HostName !== me && (p.Tags?.includes('tag:concierge') || /^concierge-/.test(p.HostName)))
    .map((p) => ({ name: p.HostName!.replace(/^concierge-/, ''), host: p.HostName!, online: !!p.Online, lastSeen: p.LastSeen && !p.LastSeen.startsWith('0001') ? p.LastSeen : undefined, ip: p.TailscaleIPs?.find((a) => a.includes('.')) }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
}

/**
 * Tailscale pushes every change of the tailnet (its watch-ipn-bus: peers added, removed, coming online or going away):
 * `onChange` gets the Concierge machines on it each time that list or one's online state changes. Nothing is polled:
 * one idle connection, read again only when Tailscale says something changed. It reconnects when the stream ends (the
 * link restarted), waiting longer each time it can't (up to five minutes).
 */
export function watchTailnet(onChange: (now: Nearby[], before: Nearby[]) => void) {
  const sock = process.env.TAILSCALE_SOCKET ?? '/var/run/tailscale/tailscaled.sock'
  // NoPrivateKeys, InitialStatus, and the peer changes and patches (online, last seen): what tells us a machine came back
  const MASK = (1 << 4) | (1 << 12) | (1 << 13) | (1 << 14)
  let last: Nearby[] = [], key = '', settle: NodeJS.Timeout | undefined, wait = 5_000
  const reread = () => void nearbyMachines().then((now) => {
    const k = JSON.stringify(now.map((m) => [m.name, m.online]))
    if (k === key) return
    const before = last
    last = now; key = k
    onChange(now, before)
  }, () => {})
  const open = () => {
    const req = httpGet({ socketPath: sock, path: `/localapi/v0/watch-ipn-bus?mask=${MASK}`, headers: { Host: 'local-tailscaled.sock' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return again() }
      if (wait !== 5_000 || !said) console.log('tailnet: watching for your other machines (Tailscale says when one comes or goes)')
      said = true; wait = 5_000
      res.setEncoding('utf8')
      res.on('data', () => { clearTimeout(settle); settle = setTimeout(reread, 2_000) }) // a burst of changes: read once
      res.on('end', again)
    })
    req.on('error', again)
  }
  let pending = false, said = false
  const again = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; open() }, wait).unref(); wait = Math.min(wait * 2, 300_000) }
  open()
}
