import { ArrowUpRight, GitPullRequest, SquareKanban } from 'lucide-react'
import type { Linked } from '../../server/index.ts'

export const DOT = { working: 'animate-pulse bg-run', asks: 'bg-wait', idle: 'bg-fg-4', none: 'bg-fill-strong' }
export const STATE = { working: 'its agent is working', asks: 'its agent waits on you', idle: 'its agent is idle', none: 'no agent run yet' }
const Icon = ({ l, className }: { l: Linked; className: string }) => (l.kind === 'ticket' ? <SquareKanban className={className} /> : <GitPullRequest className={className} />)
export type Me = { kind: 'pr' | 'ticket'; id: string }

/** In the header: the PR's ticket, or the ticket's PRs. Each is one split pill: its id opens it here, the arrow opens
 *  it where it lives (Linear, GitHub). */
export function LinkedPills({ linked, onOpen }: { linked?: Linked[]; onOpen: (l: Linked) => void }) {
  if (!linked?.length) return null
  const half = 'inline-flex items-center gap-1 py-0.5 transition-colors hover:bg-hover hover:text-accent-text'
  return (
    <>
      {linked.map((l) => (
        <span key={l.id} className={`inline-flex items-stretch overflow-hidden rounded-full bg-surface-1 font-mono text-meta text-fg-2 ring-1 ${l.suggest ? 'ring-accent' : 'ring-line-strong'}`}>
          <button onClick={() => onOpen(l)} title={`${l.title} · ${STATE[l.agent]}`} className={`${half} pl-2 pr-1.5`}>
            <Icon l={l} className="size-3" />{l.label}<span className={`size-1.5 rounded-full ${DOT[l.agent]}`} />
          </button>
          {l.url && (
            <a href={l.url} target="_blank" rel="noreferrer" title={l.kind === 'ticket' ? (/github\.com/.test(l.url) ? 'Open on GitHub' : 'Open in Linear') : 'Open on GitHub'} aria-label={`${l.label} in ${l.kind === 'ticket' && !/github\.com/.test(l.url) ? 'Linear' : 'GitHub'}`}
               className={`${half} border-l border-line-strong pl-1 pr-1.5`}><ArrowUpRight className="size-3" /></a>
          )}
        </span>
      ))}
    </>
  )
}
