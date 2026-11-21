import { Check, CircleAlert, Copy, LoaderCircle, Network, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib.ts'
import { refresh, useApi } from '../query.ts'
import { HelperPrompt } from './HelperPrompt.tsx'
import { ago } from '../time.ts'

type Nearby = { joined: boolean; machine?: string; asked: boolean; helper: boolean; machines: { name: string; host: string; online: boolean; lastSeen?: string; ours: boolean }[] }

/**
 * The other Concierge machines your tailnet has, read from Tailscale (online or not), before this machine is with them.
 * It joins them as the standby or a worker, never the main one; bin/join finishes that once one of them is online, and
 * waits for it as long as it takes. Nothing while there are none, or once this machine is one of them.
 */
export function NearbyMachines() {
  const q = useApi<Nearby>('/fleet/nearby') // read again when Tailscale says the tailnet changed (the server's 'stale' push)
  const [copied, setCopied] = useState(false)
  const v = q.data
  const ask = (on: boolean) => api('/fleet/join', { on }).then(() => refresh('/fleet/nearby'), () => {})
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
        {v.asked ? (
          <div className="flex flex-wrap items-center gap-2 text-small">
            <span className="flex items-center gap-1.5 text-fg-2"><LoaderCircle className="size-3.5 animate-spin text-accent" />
              {online.length ? `Joining ${names(online)} now.` : 'Joins them as soon as one is online, however long that takes.'}</span>
            <button onClick={() => void ask(false)} className="ml-auto rounded-md px-2 py-0.5 text-meta text-fg-3 ring-1 ring-line hover:text-fg-1">Don’t join</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void ask(true)} className="inline-flex items-center gap-1.5 btn-primary">Join them once one is online</button>
            <span className="text-meta text-fg-3">{online.length ? `${names(online)} ${online.length === 1 ? 'is' : 'are'} online now.` : 'None is online now: it waits, then joins by itself.'}</span>
          </div>
        )}
        {v.asked && <HelperPrompt why="Joining sets this computer up as one of your machines (its settings file, the services that keep them in step) the moment one of them comes online." />}
        <p className="text-meta text-fg-3">By hand, in this checkout (it waits the same way):</p>
        <button onClick={() => void navigator.clipboard?.writeText('bin/join').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
                className="group flex items-center gap-1.5 rounded-lg bg-surface-1 px-2.5 py-1.5 font-mono text-meta text-fg-2 ring-1 ring-line hover:ring-line-strong" title="Copy">
          bin/join{copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3 opacity-50 group-hover:opacity-100" />}
        </button>
        <p className="text-meta text-fg-3">Until it joins, this machine works on its own, as now.</p>
      </div>
    </div>
  )
}

type AlignView = { at?: string; asked: string[]; items: { machine: string; what: string; state: 'fixing' | 'needs-you'; fix?: string }[] }
/**
 * Where your machines still differ: what each one fixed by itself as it came online (clones, skill sources) is gone from
 * here; what is under way says so; what only you can do (a sign-in, a clone that failed) says how. Updated when a
 * machine comes online or something every machine must agree on changes (pushed, never polled).
 */
export function Alignment() {
  const q = useApi<AlignView>('/fleet/alignment')
  const [busy, setBusy] = useState(false)
  const v = q.data
  if (!v) return null
  const now = () => { setBusy(true); void api('/fleet/align', {}).then(() => refresh('/fleet/alignment'), () => {}).finally(() => setBusy(false)) }
  const machines = [...new Set(v.items.map((x) => x.machine))]
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-body font-semibold">Alignment</div>
          <div className="text-meta text-fg-3">{!v.at ? 'Checked when a machine comes online, or something they must agree on changes.' : v.items.length ? `As of ${ago(v.at)}: what still differs between your machines.` : `Every online machine agrees: repositories, skills, accounts and logins (checked ${ago(v.at)}).`}</div>
        </div>
        <button onClick={now} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 btn-outline"><RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />Align now</button>
      </div>
      {machines.map((m) => (
        <div key={m} className="border-t border-line px-4 py-2.5">
          <div className="mb-1 text-small font-medium text-fg-1">{m}</div>
          {v.items.filter((x) => x.machine === m).map((x, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5 text-small">
              {x.state === 'fixing' ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-fg-3" /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-wait" />}
              <span className="min-w-0"><span className={x.state === 'fixing' ? 'text-fg-3' : 'text-fg-1'}>{x.what}</span>{x.fix && <span className="block text-meta text-fg-3">{x.fix}</span>}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
