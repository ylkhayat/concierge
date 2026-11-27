import { ArrowUpRight, GitPullRequest, Layers, Map as MapIcon, Rocket } from 'lucide-react'
import { type PrView, type TicketView } from '../lib.ts'
import { short } from '../time.ts'
import { GROUPS, groupOf } from './ExecList.tsx'
import { stackKey, stackPos } from './PrList.tsx'
import { plain } from './StackNav.tsx'
import { statusMeta, StatusBadge } from './StatusBadge.tsx'

/**
 * Exec with no ticket open: the focused repository's workspace. Where its tickets stand, your open PRs in it,
 * and its codebase map, so you pick what to work on next with the repo in view.
 */
export function ExecHome({ repo, tickets, prs, now, onTicket, onPr, onMap }: {
  repo?: string; tickets: TicketView[]; prs: PrView[]; now: number
  onTicket: (id: string) => void; onPr: (id: string) => void; onMap?: () => void
}) {
  const mine = prs.filter((p) => p.mine && !p.closed && (!repo || p.repo === repo))
  // a stack stays together, bottom to top, where its most recently moved PR would sit
  const units = [...mine.reduce((m, p) => m.set(stackKey(p) ?? p.id, [...(m.get(stackKey(p) ?? p.id) ?? []), p]), new Map<string, PrView[]>()).values()]
    .map((u) => u.sort((a, b) => stackPos(a) - stackPos(b)))
  // stacks each a card, then every PR on its own together in one (no rail between them)
  const stacked = (u: PrView[]) => u.length > 1 && !!u[0].stack && u.every((p) => stackKey(p) === stackKey(u[0]))
  const alone = units.filter((u) => u.length === 1).flat()
  const cards = [...units.filter((u) => u.length > 1).slice(0, 6), ...(alone.length ? [alone.slice(0, 12)] : [])]
  const assigned = tickets.filter((t) => !t.handedTo && !t.closed)
  const counts = GROUPS.filter((g) => g.id !== 'closed').map((g) => ({ g, items: tickets.filter((t) => groupOf(t) === g) })).filter((x) => x.items.length)
  return (
    <div className="h-full overflow-y-auto px-6 py-6 lg:px-8 2xl:px-10">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-card bg-accent/10 text-accent-text"><Rocket className="size-5" /></span>
        <div className="min-w-0">
          <h1 className={`text-title font-semibold tracking-tight text-fg-1 ${repo ? 'font-mono' : ''}`}>{repo ?? 'All repositories'}</h1>
          <p className="text-small text-fg-3">{assigned.length} ticket{assigned.length === 1 ? '' : 's'} assigned to you{repo ? ' here' : ''} · pick one, or tick several to run them, stacked where they depend on each other</p>
        </div>
        {repo && onMap && (
          <button onClick={onMap} className="ml-auto inline-flex items-center gap-1.5 rounded-ctl px-3 py-1.5 text-small font-medium text-fg-2 ring-1 ring-line-strong transition-all hover:text-fg-1">
            <MapIcon className="size-4" />Codebase map
          </button>
        )}
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
        {counts.map(({ g, items }) => (
          <button key={g.id} onClick={() => onTicket(items[0].id)} title={`Open the first ${g.title} ticket`}
                  className={`group rounded-ctl p-4 text-left transition-[box-shadow,translate] duration-150 ${g.id === 'needs-you' ? `ring-1 ${g.card}` : 'bg-surface-1 shadow-e1 hover:shadow-e2'}`}>
            <div className="flex items-center gap-1.5 text-small font-semibold text-fg-3">
              <g.icon className={`size-3.5 ${g.tone} ${g.id === 'running' ? 'animate-spin' : ''}`} />{g.title}
            </div>
            <div className="mt-1.5 text-display font-semibold tabular-nums text-fg-1 ">{items.length}</div>
            <div className="mt-1 truncate text-meta text-fg-3">{items[0].id} · {items[0].title}</div>
          </button>
        ))}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-small font-semibold text-fg-3"><GitPullRequest className="size-3.5" />Your open PRs{repo ? ' here' : ''} <span className="tabular-nums text-fg-3">{mine.length}</span></h2>
        {mine.length ? (
          <div className="space-y-2">
            {cards.map((u) => (
              <div key={u[0].id} className="overflow-hidden card ">
                {stacked(u) && (
                  <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-meta text-fg-3 " title={u[0].stack!.map((s) => `#${s.number}`).join(' → ')}>
                    <Layers className="size-3.5 text-accent" /><span className="font-mono">{u[0].repo.split('/')[1]}</span><span className="tabular-nums">{u[0].stack!.length} PRs</span>
                    {/* every PR of the stack, bottom to top, in its status colour */}
                    <span className="ml-auto flex w-24 gap-0.5">{u[0].stack!.map((s) => {
                      const m = mine.find((p) => p.repo === u[0].repo && p.number === s.number)
                      return <span key={s.number} title={`#${s.number} ${m ? statusMeta(m.status, true).label : ''}`} className={`h-1 flex-1 rounded-full ${m ? statusMeta(m.status, true).dot : 'bg-fill-strong'}`} />
                    })}</span>
                  </div>
                )}
                <ul className={stacked(u) ? '' : 'divide-y divide-line'}>
                  {u.map((p, i) => (
                    <li key={p.id}>
                      <button onClick={() => onPr(p.id)} title={`${p.title} · ${statusMeta(p.status, true).label}`} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover">
                        {/* the rail through a stack; a PR alone gets just its dot */}
                        <span className="relative flex w-3 shrink-0 justify-center self-stretch" aria-hidden>
                          {stacked(u) && i > 0 && <span className="absolute -top-2.5 bottom-1/2 w-px bg-fill-strong" />}
                          {stacked(u) && i < u.length - 1 && <span className="absolute -bottom-2.5 top-1/2 w-px bg-fill-strong" />}
                          <span className={`relative my-auto size-2.5 rounded-full ring-4 ring-white dark:ring-zinc-900 ${statusMeta(p.status, true).dot}`} />
                        </span>
                        <span className="font-mono text-small text-fg-3">#{p.number}</span>
                        <span className="min-w-0 flex-1 truncate text-body text-fg-2 ">{stacked(u) ? plain(p.title) : p.title}</span>
                        {!!p.unresolved && <span className="text-meta text-wait-text">{p.unresolved} open threads</span>}
                        <StatusBadge status={p.status} mine compact />
                        <span className="w-8 text-right text-meta tabular-nums text-fg-3">{short(p.updatedAt, now)}</span>
                        <ArrowUpRight className="size-3.5 text-fg-4 transition-colors group-hover:text-fg-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : <p className="text-small text-fg-3">None open.</p>}
      </section>
    </div>
  )
}
