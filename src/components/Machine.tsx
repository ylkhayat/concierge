import { Apple, Monitor, Server } from 'lucide-react'

const OS: Record<string, { label: string; icon: typeof Monitor; tone: string }> = {
  windows: { label: 'Windows', icon: Monitor, tone: 'bg-run/10 text-run-text ring-run/25' },
  mac: { label: 'Mac', icon: Apple, tone: 'bg-fg-3/10 text-fg-2 ring-zinc-500/25 ' },
}

/** Which machine runs Concierge right now (two machines: the one holding the lease), as a small badge. */
export function Machine({ name, className = '' }: { name?: string; className?: string }) {
  if (!name) return null
  const o = OS[name] ?? { label: name[0].toUpperCase() + name.slice(1), icon: Server, tone: OS.mac.tone }
  return (
    <span title={`Concierge is running on the ${o.label} machine`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-meta font-semibold ring-1 ring-inset ${o.tone} ${className}`}>
      <o.icon className="size-3" />{o.label}
    </span>
  )
}
