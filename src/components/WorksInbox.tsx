// The Works inbox: what you do next, one row per Work (server/work.ts: a ticket, its PRs, their stack, and what you
// linked with @), ordered by what waits on you across all its parts. Opening a row opens the part that needs you, in
// the Work's one shared chat. Put off a Work and it leaves the order until its time comes.
import { Clock, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import type { Rules } from '../desk.ts'
import { bringBack, laterToday, offUntil, putOff, tomorrowMorning, useDeskTime } from '../deskTime.ts'
import type { PrView, TicketView } from '../lib.ts'
import { useApi } from '../query.ts'
import { ago } from '../time.ts'

const ASKS = ['needs-you', 'tend']
const busy = (p: PrView) => p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'

export type WorkRow = {
  key: string // work:<id>
  title: string
  parts: { id: string; kind: 'pr' | 'ticket'; label: string; title: string; needs: boolean; working: boolean }[]
  needs: number; working: number
  lead: string // the part to open: the first that needs you, else the first
  at: string // its latest change
  later?: number // put off until
}

/** The inbox's rows, from the server's Works and the PRs and tickets the page already has. */
export function useWorkRows(prs: PrView[] | undefined, tickets: TicketView[], rules: Rules): WorkRow[] {
  const works = useApi<{ id: string; members: string[] }[]>('/works/all', { refetchInterval: 120_000 }).data
  useDeskTime() // a Work put off, or back
  return useMemo(() => {
    if (!works || !prs) return []
    const byPr = new Map(prs.map((p) => [`pr:${p.id}`, p])), byTicket = new Map(tickets.map((t) => [`ticket:${t.id}`, t]))
    const rows = works.flatMap((w): WorkRow[] => {
      const parts = w.members.flatMap((k): WorkRow['parts'] => {
        const p = byPr.get(k)
        if (p) return [{ id: p.id, kind: 'pr', label: `#${p.number}`, title: p.title, needs: rules.waiting(p), working: busy(p) }]
        const t = byTicket.get(k)
        return t ? [{ id: t.id, kind: 'ticket', label: t.id, title: t.title, needs: ASKS.includes(rules.ticketGroup(t)), working: !!t.busy }] : []
      })
      if (!parts.length) return []
      const ticket = parts.find((x) => x.kind === 'ticket'), lead = parts.find((x) => x.needs) ?? parts.find((x) => x.working) ?? parts[0]
      const at = w.members.map((k) => byPr.get(k)?.updatedAt ?? byTicket.get(k)?.updatedAt ?? '').sort().at(-1) ?? ''
      return [{ key: `work:${w.id}`, title: (ticket ?? parts[0]).title, parts, needs: parts.filter((x) => x.needs).length, working: parts.filter((x) => x.working).length, lead: lead.id, at, later: offUntil(`work:${w.id}`) }]
    })
    // what needs you first, then what an agent is working on, then the rest; newest first within each
    const rank = (r: WorkRow) => (r.later ? 3 : r.needs ? 0 : r.working ? 1 : 2)
    return rows.sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at))
  }, [works, prs, tickets, rules])
}

export function WorksInbox({ rows, selected, onOpen }: { rows: WorkRow[]; selected?: string; onOpen: (id: string) => void }) {
  const now = rows.filter((r) => !r.later), later = rows.filter((r) => r.later)
  const row = (r: WorkRow) => {
    const here = r.parts.some((p) => p.id === selected)
    return (
      <li key={r.key} className={`group/w rounded-xl px-3 py-2.5 transition-colors ${here ? 'bg-active ring-1 ring-accent/25' : 'hover:bg-hover'}`}>
        <button type="button" onClick={() => onOpen(r.lead)} className="block w-full text-left">
          <span className="line-clamp-2 text-body font-medium leading-snug text-fg-1">{r.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1 text-meta">
            {r.parts.map((p) => (
              <span key={p.id} title={p.title} className={`rounded-md px-1 font-mono ${p.needs ? 'bg-wait/12 text-wait-text' : p.working ? 'bg-run/10 text-run-text' : p.kind === 'ticket' ? 'text-accent-text' : 'text-fg-3'}`}>{p.label}</span>
            ))}
          </span>
        </button>
        <span className="mt-1 flex items-center gap-2 text-micro text-fg-3">
          <span className={r.needs ? 'font-medium text-wait-text' : r.working ? 'text-run-text' : ''}>{r.needs ? `${r.needs} wait${r.needs === 1 ? 's' : ''} on you` : r.working ? 'an agent is working' : 'nothing waits on you'}</span>
          {r.at && <span className="text-fg-4">· {ago(r.at)}</span>}
          <span className="flex-1" />
          {r.later ? (
            <button type="button" onClick={() => bringBack(r.key)} className="inline-flex items-center gap-1 hover:text-fg-1"><Undo2 className="size-3" />Bring back</button>
          ) : (
            <span className="hidden items-center gap-2 group-hover/w:inline-flex">
              <button type="button" onClick={() => putOff(r.key, laterToday())} className="inline-flex items-center gap-1 hover:text-fg-1" title="Out of the order for 3 hours"><Clock className="size-3" />Later</button>
              <button type="button" onClick={() => putOff(r.key, tomorrowMorning())} className="hover:text-fg-1" title="Out of the order until tomorrow morning">Tomorrow</button>
            </span>
          )}
        </span>
      </li>
    )
  }
  return (
    <nav aria-label="Works" className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-r border-line p-2">
      <p className="px-2 pb-2 pt-1 label text-fg-4">Work · {now.filter((r) => r.needs).length} need you</p>
      <ul className="space-y-1">{now.map(row)}</ul>
      {later.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer px-2 py-1 label text-fg-4">Later · {later.length}</summary>
          <ul className="mt-1 space-y-1 opacity-70">{later.map(row)}</ul>
        </details>
      )}
    </nav>
  )
}
