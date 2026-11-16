import { GitPullRequest, LoaderCircle, SquareKanban } from 'lucide-react'
import { useId, useState, type CSSProperties } from 'react'
import type { Linked } from '../../server/index.ts'
import { api, enc } from '../lib.ts'

export const DOT = { working: 'animate-pulse bg-run', asks: 'bg-wait', idle: 'bg-fg-4', none: 'bg-fill-strong' }
export const STATE = { working: 'its agent is working', asks: 'its agent waits on you', idle: 'its agent is idle', none: 'no agent run yet' }
const Icon = ({ l, className }: { l: Linked; className: string }) => (l.kind === 'ticket' ? <SquareKanban className={className} /> : <GitPullRequest className={className} />)
export type Me = { kind: 'pr' | 'ticket'; id: string }
type Toast = (m: string, tone?: 'ok' | 'error') => void

/**
 * One linked item: its agent's state and last word, and what you can do between the two agents: open it, hand
 * the work to it (or start its agent when it never ran), or take the work over from it.
 */
export function LinkedCard({ me, l, onOpen, toast, flat }: { me: Me; l: Linked; onOpen: (l: Linked) => void; toast: Toast; flat?: boolean }) {
  const [busy, setBusy] = useState<string>()
  const hand = (toIt: boolean) => {
    setBusy(String(toIt))
    api('/handoff', toIt ? { from: me, to: { kind: l.kind, id: l.id } } : { from: { kind: l.kind, id: l.id }, to: me })
      .then(() => toast(toIt ? `Handed over to ${l.label}: its agent continues` : `Taken over from ${l.label}: this agent continues`), (e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(undefined))
  }
  // a PR whose agent never ran has no session to hand to: start it instead (it is told about this work as it starts)
  const start = () => {
    setBusy('start')
    api(`/prs/${enc(l.id)}/run`, {}).then(() => toast(`Started ${l.label}'s agent; it knows about this work`), (e: Error) => toast(e.message, 'error')).finally(() => setBusy(undefined))
  }
  const quiet = 'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-meta font-medium ring-1 transition-colors disabled:opacity-40'
  const strong = l.suggest ? 'bg-accent text-on-accent ring-accent hover:bg-accent' : 'text-accent-text ring-accent/30 hover:bg-accent/10'
  return (
    <div className={flat ? '' : `rounded-xl bg-surface-1 p-2.5 ${l.suggest ? ' ring-2 ring-accent/40' : 'ring-1 ring-line '}`}>
      {l.suggest && <p className="mb-1.5 flex items-center gap-1.5 text-meta font-medium text-accent-text"><span className="rounded-full bg-accent px-1.5 py-px label text-on-accent">Suggested</span>{l.suggest}</p>}
      <button onClick={() => onOpen(l)} className="group flex w-full items-start gap-2 text-left">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-text"><Icon l={l} className="size-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 text-small"><span className="font-mono font-semibold">{l.label}</span>{l.area && <span className="rounded-md bg-fill px-1.5 text-micro font-medium text-fg-2 ">{l.area}</span>}<span className={`size-1.5 rounded-full ${DOT[l.agent]}`} /><span className="text-meta text-fg-3">{STATE[l.agent]}</span></span>
          <span className="block truncate text-small text-fg-2 group-hover:text-accent-text">{l.title}</span>
          {l.said && <span className="mt-0.5 line-clamp-2 block text-meta italic text-fg-3">“{l.said}”</span>}
        </span>
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
        <button onClick={() => onOpen(l)} className={`${quiet} text-fg-2 ring-line-strong hover:text-fg-1`}>Open</button>
        {l.kind === 'pr' && l.agent === 'none' ? (
          <button onClick={start} disabled={!!busy} title={`${l.label} has no agent run yet: start one; it is told about this work and its last word`} className={`${quiet} ${strong}`}>
            {busy === 'start' && <LoaderCircle className="size-3 animate-spin" />}Start its agent
          </button>
        ) : (
          <button onClick={() => hand(true)} disabled={!!busy || l.agent === 'working'} title="This agent stops; that one continues from this agent's latest report" className={`${quiet} ${strong}`}>
            {busy === 'true' && <LoaderCircle className="size-3 animate-spin" />}Hand to it
          </button>
        )}
        {/* taking over needs something to take over: an agent that ran there */}
        {l.agent !== 'none' && (
          <button onClick={() => hand(false)} disabled={!!busy || l.agent === 'working'} title="That agent stops; this one continues from its latest report"
                  className={`${quiet} text-fg-2 ring-line-strong hover:text-accent-text`}>
            {busy === 'false' && <LoaderCircle className="size-3 animate-spin" />}Take over
          </button>
        )}
      </div>
    </div>
  )
}

/** In the header: the PR's ticket, or the ticket's PRs, each opening its card (state, last word, handover) in place. */
export function LinkedPills({ me, linked, onOpen, toast }: { me: Me; linked?: Linked[]; onOpen: (l: Linked) => void; toast: Toast }) {
  const base = 'linked' + useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!linked?.length) return null
  return (
    <>
      {linked.map((l, i) => (
        <span key={l.id} className="contents">
          <button popoverTarget={`${base}${i}`} style={{ anchorName: `--${base}${i}` } as CSSProperties} title={`${l.title} · ${STATE[l.agent]}`}
                  className={`inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 font-mono text-meta text-fg-2 ring-1 transition-all hover:text-accent-text ${l.suggest ? 'ring-accent' : 'ring-line-strong hover:ring-accent/30'}`}>
            <Icon l={l} className="size-3" />{l.label}<span className={`size-1.5 rounded-full ${DOT[l.agent]}`} />
          </button>
          <div id={`${base}${i}`} popover="auto" style={{ positionAnchor: `--${base}${i}`, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-inline, flip-block', inset: 'auto' } as CSSProperties}
               className="m-0 mt-1.5 w-[min(340px,calc(100vw/var(--z)-24px))] rounded-2xl border-0 bg-surface-1 p-3 text-fg-2 shadow-xl ring-1 ring-line ">
            <LinkedCard me={me} l={l} onOpen={(x) => { document.getElementById(`${base}${i}`)?.hidePopover(); onOpen(x) }} toast={toast} flat />
          </div>
        </span>
      ))}
    </>
  )
}

