import { ArrowUpRight, ChevronRight, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import type { TicketView } from '../lib.ts'
import { chainsOf, titleParts } from '../stack.ts'

type P = TicketView['prs'][number]

export const ciTone = (p: P) => p.merged ? 'bg-accent ring-accent/25' : p.state === 'CLOSED' ? 'bg-fill-strong ring-zinc-300/20' : p.ci === 'failure' ? 'bg-fail ring-fail/25' : p.ci === 'success' ? 'bg-ok ring-ok/25' : p.ci === 'pending' ? 'bg-wait ring-wait/25' : 'bg-fill-strong ring-zinc-300/30'
export const ciLabel = (p: P) => p.merged ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.ci === 'failure' ? 'CI failing' : p.ci === 'success' ? 'CI green' : p.ci === 'pending' ? 'CI running' : 'CI not known'

/** A ticket's PRs as stacks: each chain drawn as a rail, bottom first, with CI, type, title and open threads. */
export function PrStack({ prs, closed = [], dense }: { prs: P[]; closed?: P[]; dense?: boolean }) {
  // stacks first, then every PR that stands alone together in one card (no rail between them)
  const chains = chainsOf(prs)
  const stacks = chains.filter((c) => c.length > 1)
  const alone = chains.filter((c) => c.length === 1).flat()
  const groups = [
    ...stacks.map((c) => ({ rail: true, items: c, label: `Stack · ${c.length} PRs`, gone: false })),
    ...(alone.length ? [{ rail: false, items: alone, label: stacks.length ? 'Not stacked' : '', gone: false }] : []),
  ]
  // closed and merged: one line ("5 merged earlier") under everything still open, opened when you want them
  const [past, setPast] = useState(false)
  const merged = closed.filter((p) => p.merged).length
  const earlier = [merged && `${merged} merged`, closed.length - merged && `${closed.length - merged} closed`].filter(Boolean).join(', ')
  if (closed.length && past) groups.push({ rail: false, items: closed, label: '', gone: true })
  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.items[0].url} className={`overflow-hidden rounded-xl ring-1 ${g.gone ? 'bg-fill/60 ring-zinc-200/60 dark:ring-zinc-800/60' : 'bg-surface-1 ring-line '}`}>
          {groups.length > 1 && g.label && !g.gone && (
            <p className="border-b border-line px-3 py-1.5 label text-fg-3 ">{g.label}</p>
          )}
          <ol className={g.rail ? '' : 'divide-y divide-line'}>
            {g.items.map((p, i, chain) => {
              const t = titleParts(p.title)
              return (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noreferrer" title={`${p.title ?? ''} · ${ciLabel(p)}`}
                     className={`group/pr relative flex items-center gap-3 px-3 transition-colors hover:bg-hover ${dense || g.gone ? 'py-1.5' : 'py-2.5'}`}>
                    {/* the rail: a line through the chain, a dot per PR coloured by its CI */}
                    <span className="relative flex w-3 shrink-0 justify-center self-stretch">
                      {g.rail && i > 0 && <span className="absolute top-0 h-1/2 w-px bg-fill-strong" />}
                      {g.rail && i < chain.length - 1 && <span className="absolute bottom-0 h-1/2 w-px bg-fill-strong" />}
                      <span className={`relative my-auto size-2.5 rounded-full ring-4 transition-transform duration-200 group-hover/pr:scale-125 ${ciTone(p)}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-meta text-fg-3">#{p.number}</span>
                        {t.type && <span className="rounded-md bg-fill px-1.5 py-px font-mono text-micro text-fg-2 ">{t.type}{t.scope ? `·${t.scope}` : ''}</span>}
                        {p.merged ? <span className="rounded-md bg-accent/10 px-1.5 py-px text-micro font-medium text-accent-text">merged</span>
                          : p.state === 'CLOSED' && <span className="rounded-md bg-fill/70 px-1.5 py-px text-micro font-medium text-fg-2">closed</span>}
                      </span>
                      <span className={`mt-0.5 block text-small leading-snug ${g.gone ? (p.merged ? 'text-fg-3' : 'text-fg-4 line-through decoration-fg-4') : 'text-fg-2 '} ${dense || g.gone ? 'truncate' : 'line-clamp-2'}`}>{t.text || p.repo}</span>
                    </span>
                    {!!p.openThreads && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-wait/10 px-1.5 py-0.5 text-meta font-medium tabular-nums text-wait-text" title={`${p.openThreads} open thread${p.openThreads === 1 ? '' : 's'}`}>
                        <MessageSquare className="size-3" />{p.openThreads}
                      </span>
                    )}
                    <ArrowUpRight className="size-3.5 shrink-0 text-fg-4 transition-all duration-200 group-hover/pr:-translate-y-px group-hover/pr:translate-x-px group-hover/pr:text-fg-3" />
                  </a>
                </li>
              )
            })}
          </ol>
        </div>
      ))}
      {closed.length > 0 && (
        <button type="button" onClick={() => setPast(!past)} aria-expanded={past}
                className="flex items-center gap-1.5 px-1 text-meta font-medium text-fg-3 transition-colors hover:text-fg-1">
          <ChevronRight className={`size-3.5 transition-transform ${past ? 'rotate-90' : ''}`} />{earlier} earlier
        </button>
      )}
    </div>
  )
}
