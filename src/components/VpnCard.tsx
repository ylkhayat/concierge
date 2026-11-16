import { RotateCcw, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VpnState } from '../../server/vpn.ts'
import { soundsUnreachable } from '../../server/unreachable.ts'
import { api } from '../lib.ts'

/**
 * Which VPN a ticket's run needs, and whether you're on it. Shown when the last run reads like it couldn't reach
 * something, or when the ticket's environment has a VPN that is off. Turns green the moment you connect.
 */
export function VpnCard({ env, lastResult, onRun }: { env?: string; lastResult?: string; onRun?: () => void }) {
  const [list, setList] = useState<VpnState[]>()
  const sounds = soundsUnreachable(lastResult)
  const forEnv = (v: VpnState) => !!env && !!v.for?.includes(env)
  // the environment's own VPN when it's known; every VPN only when a run couldn't reach something and no environment says which
  const mine = (list ?? []).filter(forEnv)
  const relevant = mine.length ? mine : sounds ? list ?? [] : []
  const watching = sounds || (list ?? []).some((v) => forEnv(v) && !v.up)
  useEffect(() => {
    const read = () => api('/vpn').then(setList, () => setList([]))
    read()
    if (!watching && list) return
    const t = setInterval(read, 4000) // while it matters: the card flips as soon as you connect
    return () => clearInterval(t)
  }, [watching])
  if (!list) return null
  if (!relevant.length) return sounds && !list.length ? (
    <p className="flex items-start gap-2 rounded-xl bg-wait/7 p-3 text-small text-wait-text ring-1 ring-wait/20">
      <Shield className="mt-0.5 size-4 shrink-0" />The last run couldn&apos;t reach something on the network. If it needs a VPN, list it under <code className="font-mono text-meta">vpns</code> in your settings so Concierge can tell you which to connect.
    </p>
  ) : null
  const down = relevant.filter((v) => !v.up && !v.unknown)
  if (!down.length && !sounds) return null
  return (
    <div className={`space-y-2 rounded-xl p-3 text-small ring-1 ${down.length ? 'bg-wait/7 ring-wait/20' : 'bg-ok/7 ring-ok/20'}`}>
      {relevant.map((v) => (
        <p key={v.name} className="flex items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${v.up ? 'bg-ok' : 'animate-pulse bg-wait'}`} />
          <span className={v.up ? 'text-ok-text' : 'text-wait-text'}>
            {v.up ? <>On <b>{v.name}</b>.</> : v.unknown ? <>This needs <b>{v.name}</b>{forEnv(v) ? ` (${env})` : ''}. Concierge can&apos;t tell if it&apos;s on yet; connect it, then run again.</> : <>Connect to <b>{v.name}</b>{forEnv(v) ? ` (${env})` : ''}, then run again.</>}
          </span>
        </p>
      ))}
      {sounds && !down.length && <p className="text-meta text-fg-3">The last run couldn&apos;t reach something; you&apos;re on the VPN now, so a run again may get through.</p>}
      {onRun && sounds && <button onClick={onRun} disabled={!!down.length} className="inline-flex items-center gap-1.5 rounded-lg bg-ok px-2.5 py-1 text-small font-medium text-white hover:bg-ok disabled:opacity-40"><RotateCcw className="size-3.5" />Run again</button>}
    </div>
  )
}
