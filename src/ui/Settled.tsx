// A page whose parts each read their own data, shown once they are all in.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { reads } from '../lib.ts'

/**
 * Its children, drawn (so they read and take their size) but not shown until they have settled: what they asked the
 * server when they opened is in, none says it is loading (aria-busy), and nothing has been added or removed for a moment. Then the page appears whole. Without it each
 * part arrived when its own read did and pushed everything under it down or up: a placeholder is never the height of
 * what replaces it. A part that takes longer than `most` is not waited for. `quiet`: how long nothing must change.
 */
export function Settled({ children, className = '', most = 1500, quiet = 90, fill }: { children: ReactNode; className?: string; most?: number; quiet?: number; fill?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const since = useRef(reads.mark()) // (taken as it is first drawn: its children's reads are asked after)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let still: ReturnType<typeof setTimeout> | undefined
    const done = () => { mo.disconnect(); removeEventListener('api-read', check); clearTimeout(still); clearTimeout(cap); setReady(true) }
    const calm = () => !reads.pendingSince(since.current) && !el.querySelector('[aria-busy="true"]')
    // (looked at again when the moment is over: a read that leads to another has asked for it by then)
    const check = () => { clearTimeout(still); if (calm()) still = setTimeout(() => { if (calm()) done() }, quiet) }
    addEventListener('api-read', check)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
    const cap = setTimeout(done, most)
    check()
    return () => { mo.disconnect(); removeEventListener('api-read', check); clearTimeout(still); clearTimeout(cap) }
  }, [most, quiet])
  return (
    // fill: a view that takes the height it is given (its own parts scroll), not a page that grows
    <div className={`relative ${fill ? 'flex min-h-0 min-w-0 flex-1 flex-col' : ''}`}>
      <div ref={box} className={`${className} ${fill ? 'flex min-h-0 min-w-0 flex-1 flex-col' : ''} ${ready ? '' : 'invisible'}`} aria-busy={!ready || undefined}>{children}</div>
      {/* only when it takes a while: a page that is there in a moment shows no placeholder at all */}
      {!ready && (
        <div className={`pointer-events-none absolute inset-x-0 top-0 animate-[fade-in_200ms_300ms_both] space-y-3 ${fill ? 'p-6' : ''}`} aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse card" style={{ animationDelay: `${i * 90}ms` }} />)}
        </div>
      )}
    </div>
  )
}
