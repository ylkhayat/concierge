import { Check, Copy, Network } from 'lucide-react'
import { useState } from 'react'
import { useApi } from '../query.ts'
import { ago } from '../time.ts'

type Nearby = { joined: boolean; machine?: string; machines: { name: string; host: string; online: boolean; lastSeen?: string; ours: boolean }[] }

/**
 * The other Concierge machines your tailnet has, read from Tailscale (online or not), before this machine is with them.
 * It joins them as the standby or a worker, never the main one; bin/join finishes that once one of them is online, and
 * waits for it as long as it takes. Nothing while there are none, or once this machine is one of them.
 */
export function NearbyMachines() {
  const q = useApi<Nearby>('/fleet/nearby', { refetchInterval: 15_000 })
  const [copied, setCopied] = useState(false)
  const v = q.data
  if (!v || v.joined || !v.machines.length) return null
  const online = v.machines.filter((m) => m.online)
  const names = (xs: { name: string }[]) => xs.map((m) => m.name).join(' and ')
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill text-fg-1"><Network className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-reading font-semibold">Your other machines</div>
          <p className="text-small text-fg-3">Concierge already runs on {names(v.machines)} on this tailnet. This machine joins them as the standby or a worker: the main one stays the main one, and its settings become this machine's.</p>
        </div>
      </div>
      <div className="divide-y divide-line border-t border-line">
        {v.machines.map((m) => (
          <div key={m.host} className="flex items-center gap-3 px-4 py-2.5 text-small">
            <span className={`size-2 shrink-0 rounded-full ${m.online ? 'bg-ok' : 'bg-fill-strong'}`} />
            <span className="font-medium text-fg-1">{m.name}</span>
            <span className="text-fg-3">{m.online ? 'online' : m.lastSeen ? `offline, last seen ${ago(m.lastSeen)}` : 'offline'}</span>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-line bg-fill/40 p-4">
        <p className="text-small text-fg-2">
          {online.length ? <>{names(online)} {online.length === 1 ? 'is' : 'are'} online: join {online.length === 1 ? 'it' : 'them'} from this machine’s terminal.</>
            : <>None is online now. Start the join anyway: it waits until one is (hours later is fine), then finishes by itself.</>}
        </p>
        <button onClick={() => void navigator.clipboard?.writeText('bin/join').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
                className="group flex items-center gap-1.5 rounded-lg bg-surface-1 px-2.5 py-1.5 font-mono text-meta text-fg-2 ring-1 ring-line hover:ring-line-strong" title="Copy">
          bin/join{copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3 opacity-50 group-hover:opacity-100" />}
        </button>
        <p className="text-meta text-fg-3">Run in this checkout. Until then this machine works on its own, as now.</p>
      </div>
    </div>
  )
}
