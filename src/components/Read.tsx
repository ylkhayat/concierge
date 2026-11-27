import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, Layers, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Overlay } from '../../server/explain.ts'
import { units, type Rules, type Unit } from '../desk.ts'
import { api, enc, type PrView, type TicketView } from '../lib.ts'
import { statusMeta } from './StatusBadge.tsx'
import { Tour } from './Tour.tsx'

/** A PR whose explanation is there to read (done, for its current push or an earlier one). */
const readable = (p: PrView) => !p.closed && !!p.explain && p.explain.state === 'done'

/** The PRs to read, unit by unit in the desk's order (what waits on you first), each unit bottom to top. */
export function readingList(prs: PrView[], tickets: TicketView[], rules: Rules): { unit: Unit; prs: PrView[] }[] {
  return units(prs, tickets, rules).map((unit) => ({ unit, prs: unit.members.filter(readable) })).filter((g) => g.prs.length)
}

/**
 * Reading the explanations, made for a phone: the PRs that have one, grouped by stack or task, what waits on you
 * first; tapping one opens its guided tour full screen, swipe or tap through its steps, and its last step leads to
 * the next PR. Nothing here acts on a PR: it is for reading.
 */
export function Read({ prs, tickets, rules, selected, onSelect, toast }: {
  prs: PrView[]; tickets: TicketView[]; rules: Rules
  selected?: string; onSelect: (id?: string) => void
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const groups = readingList(prs, tickets, rules)
  const order = groups.flatMap((g) => g.prs)
  const pr = selected ? prs.find((p) => p.id === selected) : undefined
  if (pr) {
    const next = order[order.findIndex((p) => p.id === pr.id) + 1]
    return <Reader key={pr.id} pr={pr} prs={prs} next={next} onSelect={onSelect} toast={toast} />
  }
  const unread = order.filter(rules.waiting).length
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        <header>
          <h1 className="flex items-center gap-2 text-display font-semibold tracking-tight"><BookOpen className="size-5 text-accent" />Read</h1>
          <p className="mt-1 text-body text-fg-3">{order.length ? `${order.length} explanation${order.length === 1 ? '' : 's'} to go through${unread ? `, ${unread} on PRs waiting on you` : ''}` : 'No explanations yet. They appear here once a PR has been explained.'}</p>
        </header>
        {groups.map(({ unit, prs: list }) => (
          <section key={unit.key} className="space-y-1.5">
            {unit.kind !== 'pr' && (
              <h2 className="flex items-center gap-1.5 px-1 text-small font-semibold text-fg-3">
                <Layers className="size-3.5 text-accent" /><span className="truncate">{unit.title}</span><span className="ml-auto shrink-0 tabular-nums">{list.length}/{unit.members.length}</span>
              </h2>
            )}
            <ol className="overflow-hidden card ">
              {list.map((p, i) => {
                const m = statusMeta(p.status, p.mine)
                const stale = p.explain?.headSha && p.explain.headSha !== p.headSha
                return (
                  <li key={p.id} className={i ? 'border-t border-line ' : ''}>
                    <button onClick={() => onSelect(p.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-hover">
                      <span className={`size-2.5 shrink-0 rounded-full ${m.dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-reading font-medium leading-snug text-fg-1 ">{p.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-fg-3">
                          <span className="font-mono">#{p.number}</span>
                          {p.stack && <span>{p.stack.findIndex((s) => s.number === p.number) + 1}/{p.stack.length} in its stack</span>}
                          <span>{m.label}</span>
                          {stale && <span className="text-wait-text">explained for an earlier push</span>}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-fg-3" />
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}

/** One PR's explanation full screen: a slim header, then its guided tour; its end leads on to the next PR. */
function Reader({ pr, prs, next, onSelect, toast }: { pr: PrView; prs: PrView[]; next?: PrView; onSelect: (id?: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [o, setO] = useState<Overlay | null>()
  useEffect(() => {
    api(`/prs/${enc(pr.id)}/explain`).then((d: { overlay?: Overlay }) => setO(d.overlay ?? null), () => setO(null))
  }, [pr.id, pr.explain?.endedAt])
  const busy = pr.explain?.state === 'running' || pr.explain?.state === 'queued'
  const explain = () => api(`/prs/${enc(pr.id)}/explain`, {}).then(() => toast('Explaining the latest push'), (e: Error) => toast(e.message, 'error'))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2 ">
        <button onClick={() => onSelect(undefined)} aria-label="All explanations" className="rounded-ctl p-2 text-fg-3 active:bg-hover"><ArrowLeft className="size-5" /></button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-reading font-semibold leading-tight">{pr.title}</span>
          <span className="block truncate font-mono text-meta text-fg-3">{pr.repo}#{pr.number}{pr.stack ? ` · ${pr.stack.findIndex((s) => s.number === pr.number) + 1}/${pr.stack.length}` : ''}</span>
        </span>
        <a href={pr.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="rounded-ctl p-2 text-fg-3 active:bg-hover"><ArrowUpRight className="size-5" /></a>
      </header>
      <div className="min-h-0 flex-1">
        {o === undefined ? <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-3" /></div>
          : o === null ? <p className="px-6 py-16 text-center text-reading text-fg-3">This explanation could not be loaded.</p>
          : <Tour pr={pr} o={o} onExplain={explain} busy={busy} prs={prs} onSelect={(id) => onSelect(id)} toast={toast}
                  onFinish={next ? { label: `Next: #${next.number}`, go: () => onSelect(next.id) } : { label: 'All explanations', go: () => onSelect(undefined) }} />}
      </div>
    </div>
  )
}

