import { Apple, ArrowRight, Monitor, Server } from 'lucide-react'
import { useMachineName } from '../machineNames.ts'
import type { Me } from '../../server/github.ts'

const OS: Record<string, { label: string; icon: typeof Monitor; tone: string }> = {
  windows: { label: 'Windows', icon: Monitor, tone: 'bg-run/10 text-run-text ring-run/25' },
  mac: { label: 'Mac', icon: Apple, tone: 'bg-fg-3/10 text-fg-2 ring-zinc-500/25 ' },
}
const ROLE: Record<string, string> = { primary: 'the main machine', standby: 'the standby', worker: 'a worker' }

/** Where you are and which machine answers: you on this machine itself, or your device on the tailnet → the machine
 *  serving the page. Hover for the details (your device, its address, the serving machine's role and build). */
export function Machine({ me, className = '' }: { me?: Me; className?: string }) {
  const called = useMachineName()
  const name = me?.machine
  if (!name) return null
  const os = OS[name] ?? { label: name[0].toUpperCase() + name.slice(1), icon: Server, tone: OS.mac.tone }
  const serving = called(name) === name ? os.label : called(name)
  const v = me?.viewer, s = me?.serving
  const you = v && !v.here ? called(v.device ?? '') || v.ip || 'another device' : undefined
  return (
    <span className={`group/m relative inline-flex ${className}`}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-meta font-semibold ring-1 ring-inset ${os.tone}`}>
        {you && <><span className="max-w-32 truncate font-medium">{you}</span><ArrowRight className="size-3 opacity-60" /></>}
        <os.icon className="size-3" />{serving}{!you && v?.here && <span className="font-normal opacity-60">here</span>}
      </span>
      <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden w-80 space-y-2 rounded-card bg-surface-1 p-3 text-small text-fg-2 shadow-e2 group-hover/m:block">
        <span className="block">
          <span className="block text-meta font-medium text-fg-3">You</span>
          {!v ? 'Not known' : v.here ? <>On {serving} itself (localhost)</>
            : <>{v.device ? <><b className="font-medium text-fg-1">{you}</b>{v.os && ` (${v.os})`}</> : 'A device Tailscale doesn’t list'}{v.ip && <span className="text-fg-4"> · {v.ip}</span>}
                {v.login && <span className="block text-meta text-fg-3">Signed in to Tailscale as {v.login}</span>}</>}
        </span>
        <span className="block">
          <span className="block text-meta font-medium text-fg-3">Serving this page</span>
          <b className="font-medium text-fg-1">{serving}</b>{s?.role && ROLE[s.role] && `, ${ROLE[s.role]}`}{s?.version && <span className="text-fg-4"> · build {s.version}</span>}
          <span className="block text-meta text-fg-3">{s?.control === false
            ? 'It follows the machine running Concierge: what you do here is not kept until that one answers.'
            : 'It runs Concierge: it saves what you do and hands runs to the machines.'}</span>
        </span>
        {me?.reach && !v?.here && <span className="block text-meta text-fg-4">Through your tailnet link (concierge.…), which goes to {serving}</span>}
      </span>
    </span>
  )
}
