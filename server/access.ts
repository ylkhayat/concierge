// Who may open Concierge through your tailnet link. The link (Tailscale Serve) passes each request on with who sent
// it, as Tailscale vouches (Tailscale-User-Login), and where from (X-Forwarded-For). A request on this machine itself
// (127.0.0.1, no such header) is you, as always. One through the link is let in only for the logins allowed:
// Settings → Machines lists them, CONCIERGE_ALLOW adds more; with none listed yet, the first person to open it becomes
// its owner (and an alert says so). A link that doesn't pass who is calling can't be checked this way: Settings →
// Machines says so, and CONCIERGE_PASSWORD protects it instead. With a password set, it is asked on top.
import { alert } from './alerts.ts'
import { config, saveConfig } from './config.ts'
import { setting } from './paths.ts'

export type Who = { proxied: boolean; login?: string }
/** Who a request comes from, by the headers the link adds. */
export const whoFrom = (h: (name: string) => string | undefined): Who => {
  const login = h('tailscale-user-login')?.trim() || undefined
  return { proxied: !!(login || h('x-forwarded-for') || h('tailscale-headers-info')), login }
}
export const allowed = () => [...new Set([...(config.access?.logins ?? []), ...(setting('ALLOW') ?? '').split(',').map((x) => x.trim()).filter(Boolean)])]

/** May this request open it? Undefined: yes; else why not. The first person through the link becomes the owner. */
export function refuse(w: Who): string | undefined {
  // on this machine, or through a link that doesn't say who is calling (then only a password protects it: Settings
  // → Machines says so): let in, as before
  if (!w.proxied || !w.login) return undefined
  const list = allowed()
  if (!list.length) {
    saveConfig({ access: { logins: [w.login] } })
    alert({ kind: 'system', id: 'access', label: 'Access', title: 'Access' }, `Only ${w.login} can open Concierge through your tailnet now: add others in Settings → Machines.`)
    return undefined
  }
  return list.includes(w.login) ? undefined : `${w.login} may not open this Concierge: its owner adds people in Settings → Machines.`
}
