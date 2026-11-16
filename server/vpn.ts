// Which VPNs are up, checked by reaching an address that only exists on each. Concierge can't switch a VPN for you
// (it runs in a container, the VPN apps on the Mac), so it says which one a run needs and sees when you've connected.
import { connect } from 'node:net'
import { config } from './store.ts'

export type Vpn = { name: string; probe: string; for?: string[] } // probe: "host:port" reachable only on it; for: environments or words it is needed for
export type VpnState = Vpn & { up: boolean; unknown?: boolean } // unknown: no probe address yet, so its state can't be told

const reach = (probe: string) => new Promise<boolean>((resolve) => {
  const [host, port] = probe.split(':')
  const s = connect({ host, port: Number(port) || 443, timeout: 2500 }, () => { s.destroy(); resolve(true) })
  s.on('timeout', () => { s.destroy(); resolve(false) })
  s.on('error', () => resolve(false))
})

let cache: { at: number; list: VpnState[] } | undefined
export async function vpns(fresh = false): Promise<VpnState[]> {
  if (!fresh && cache && Date.now() - cache.at < 5_000) return cache.list
  const list = await Promise.all((config.vpns ?? []).map(async (v) => {
    if (v.probe) return { ...v, up: await reach(v.probe) }
    return { ...v, up: false, unknown: true }
  }))
  cache = { at: Date.now(), list }
  return list
}

export { soundsUnreachable } from './unreachable.ts'
