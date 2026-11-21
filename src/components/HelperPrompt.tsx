import { Check, Copy, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useApi } from '../query.ts'

/**
 * Asked for the moment you use something that needs this machine's helper (bin/helper): the app runs inside Docker and
 * can't rebuild itself or set the host up, so a small helper does, woken only when the app asks. Says why, and the one
 * command that turns it on. Nothing once it is on.
 */
export function HelperPrompt({ why }: { why: string }) {
  const q = useApi<{ on: boolean }>('/helper')
  const [copied, setCopied] = useState(false)
  if (!q.data || q.data.on) return null
  return (
    <div className="space-y-1.5 rounded-lg bg-wait/7 px-3 py-2.5 text-small ring-1 ring-wait/20">
      <p className="flex items-start gap-2 text-wait-text"><Wrench className="mt-0.5 size-3.5 shrink-0" />
        <span><span className="font-medium">Turn on this machine’s helper.</span> {why} Concierge runs inside Docker and can’t do that on your computer itself; the helper can. It wakes only when Concierge asks, and runs nothing in between.</span></p>
      <div className="flex flex-wrap items-center gap-2 pl-5.5">
        <button onClick={() => void navigator.clipboard?.writeText('bin/helper on').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
                className="group flex items-center gap-1.5 rounded-md bg-surface-1 px-2 py-1 font-mono text-meta text-fg-2 ring-1 ring-line hover:ring-line-strong" title="Copy">
          bin/helper on{copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3 opacity-50 group-hover:opacity-100" />}
        </button>
        <span className="text-meta text-fg-3">in this checkout, once. <code className="font-mono">bin/helper off</code> removes it.</span>
      </div>
    </div>
  )
}
