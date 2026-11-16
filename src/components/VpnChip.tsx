// The VPNs in the status bar: which private network the agents can reach right now (prod, dev, feat), checked live on
// the machine that runs them. A glance before an investigation: hover for each one, click for Connections.
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib.ts'

type Vpn = { name: string; up: boolean; unknown?: boolean }
/** "mblnetnetnet (Azure VPN, prod)" → "prod"; else the name itself. */
const short = (n: string) => n.match(/\b(prod|production|dev|develop|feat|staging|sandbox)\b/i)?.[1].toLowerCase() ?? n.replace(/\s*\(.*\)$/, '')

export function VpnChip({ machine, onOpen }: { machine?: string; onOpen: () => void }) {
  const [v, setV] = useState<Vpn[]>()
  useEffect(() => {
    const read = () => { if (!document.hidden) api('/vpn').then(setV, () => {}) }
    read(); const t = setInterval(read, 15_000)
    return () => clearInterval(t)
  }, [])
  if (!v?.length) return null
  const up = v.filter((x) => x.up), blind = v.every((x) => x.unknown)
  return (
    <span className="group/v relative hidden md:inline-flex">
      <button onClick={onOpen} className="inline-flex items-center gap-1.5 rounded-md px-1.5 leading-[18px] text-fg-3 transition-colors duration-150 hover:text-fg-1">
        {up.length ? <ShieldCheck className="size-3.5 text-ok" /> : <ShieldOff className="size-3.5 text-fg-4" />}
        <span>{up.length ? `VPN ${up.map((x) => short(x.name)).join(', ')}` : blind ? 'VPN not checked' : 'VPN off'}</span>
      </button>
      <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden w-72 space-y-1.5 rounded-card bg-surface-1 p-3 text-small text-fg-2 shadow-e2 group-hover/v:block">
        <span className="block text-meta font-medium text-fg-3">VPNs{machine ? ` on ${machine}` : ''}, where the agents run</span>
        {v.map((x) => (
          <span key={x.name} className="flex items-center gap-2">
            <span className={`size-1.5 shrink-0 rounded-full ${x.up ? 'bg-ok' : 'bg-fill-strong'}`} />
            <span className="truncate">{x.name}</span>
            <span className="ml-auto shrink-0 text-meta text-fg-4">{x.unknown ? 'not checked' : x.up ? 'connected' : 'off'}</span>
          </span>
        ))}
        <span className="block text-meta text-fg-4">{blind
          ? 'None has a probe address yet (a private host:port only reachable on it), so Concierge can\'t tell. Set one per VPN under Connections → VPNs.'
          : 'Investigations that need a private database wait for its VPN. Click for Connections.'}</span>
      </span>
    </span>
  )
}
