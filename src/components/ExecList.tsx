import { useAway } from '../away.ts'
import { useHeld } from '../held.ts'
import type { Prep } from '../../server/plan.ts'
import { askLine } from '../../server/reply.ts'
import { queuedText } from '../time.ts'
import { appColor } from '../appColor.ts'
import { Bookmark, Moon,
  AlertTriangle, Archive, ChevronDown, MessageSquareWarning, Plus, CircleCheck, Inbox, Search, X, CircleDashed, CircleDot, Hourglass, Layers, LoaderCircle, MessageCircleQuestion, Play, Signal, SignalHigh,
  SignalLow, SignalMedium, Wrench, type LucideIcon,
  Users, GitMerge,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api, prefetchFeed, type TicketView, smooth } from '../lib.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { Missing } from './Missing.tsx'
import { ciLabel, ciTone } from './PrStack.tsx'
import { short } from '../time.ts'
import { useDragPick } from '../pick.ts'
import { recent, useTouch } from '../recent.ts'
import { useFlip } from '../flip.ts'
import { ticketOrder } from '../listOrder.ts'
import { pending, shapeKey, useSettled } from '../settle.ts'
import { move, noStacks, oneStack, shapeOf, shift, stacksOf, type Shape } from '../stackEdit.ts'
import { inSettings } from '../copy.ts'
import { PHASES } from '../phases.ts'

export type Group = { id: string; title: string; hint: string; icon: LucideIcon; tone: string; card: string; match: (t: TicketView) => boolean; dot?: string; badge?: string }

// a ticket's state, in the order an agent picks them, plus what is running right now. Each has its own colour
// (its dot in the list, its chip on the page); the list's sections below put them together by who acts next
export const GROUPS: Group[] = [
  { id: 'running', dot: 'bg-run', badge: 'text-run-text bg-run/10 ring-run/30', title: 'Running', hint: 'An agent is working on it', icon: LoaderCircle, tone: 'text-run-text', card: 'bg-run/5 ring-run/15', match: (t) => t.busy },
  { id: 'needs-you', dot: 'bg-wait', badge: 'text-wait-text bg-wait/10 ring-wait/30', title: 'Needs you', hint: 'The agent asked you something: a question on Linear, or decisions it handed back', icon: MessageCircleQuestion, tone: 'text-wait-text', card: 'bg-wait/6 ring-wait/20', match: (t) => t.bucket === 'needs-you' },
  { id: 'tend', dot: 'bg-fail', badge: 'text-fail-text bg-fail/10 ring-fail/30', title: 'Needs fixing', hint: 'In review with red CI or open threads', icon: Wrench, tone: 'text-fail-text', card: 'bg-fail/5 ring-fail/15', match: (t) => t.bucket === 'tend' },
  { id: 'stalled', dot: 'bg-wait', badge: 'text-wait-text bg-wait/10 ring-wait/30', title: 'Stalled', hint: 'In progress, untouched for a day', icon: Hourglass, tone: 'text-wait-text', card: 'bg-wait/5 ring-wait/15', match: (t) => t.bucket === 'stalled' },
  { id: 'in-progress', dot: 'bg-accent', badge: 'text-accent-text bg-accent-soft ring-accent/30', title: 'In progress', hint: 'Moving', icon: CircleDot, tone: 'text-accent-text', card: 'bg-accent/5 ring-accent/15', match: (t) => t.bucket === 'in-progress' },
  { id: 'todo', dot: 'bg-fg-2', badge: 'text-fg-2 bg-fill/60 ring-line-strong', title: 'Ready', hint: 'Ready to pick, by priority', icon: CircleDashed, tone: 'text-fg-2', card: 'bg-fg-3/4 ring-line', match: (t) => t.bucket === 'todo' },
  { id: 'triage', dot: 'bg-fuchsia-500', badge: 'text-fuchsia-700 bg-fuchsia-50 ring-fuchsia-200 dark:text-fuchsia-300 dark:bg-fuchsia-500/10 dark:ring-fuchsia-500/20', title: 'Triage', hint: 'Not triaged yet: never picked on its own, but you can run it by hand', icon: Inbox, tone: 'text-fuchsia-600 dark:text-fuchsia-400', card: 'bg-fuchsia-500/[0.04] ring-fuchsia-500/15', match: (t) => t.bucket === 'triage' },
  { id: 'backlog', dot: 'bg-fg-3', badge: 'text-fg-2 bg-fill/60 ring-line-strong', title: 'Backlog', hint: 'Not planned yet: never picked on its own, but you can run it by hand', icon: Archive, tone: 'text-fg-3', card: 'bg-fg-3/4 ring-zinc-500/15', match: (t) => t.bucket === 'backlog' },
  { id: 'shipped', dot: 'bg-ok', badge: 'text-ok-text bg-ok/10 ring-ok/30', title: 'In review', hint: 'Its PR is open and green: nothing waits on you', icon: CircleCheck, tone: 'text-ok-text', card: 'bg-ok/5 ring-ok/15', match: (t) => t.bucket === 'shipped' },
  { id: 'handed', dot: 'bg-teal-500', badge: 'text-teal-700 bg-teal-50 ring-teal-200 dark:text-teal-300 dark:bg-teal-500/10 dark:ring-teal-500/20', title: 'Handed over', hint: "Someone else has it now: never picked, never waiting on you, but you can still steer or run it", icon: Users, tone: 'text-teal-600 dark:text-teal-400', card: 'bg-teal-500/[0.04] ring-teal-500/15', match: (t) => t.bucket === 'handed' },
  { id: 'closed', dot: 'bg-fg-4', badge: 'text-fg-2 bg-fill/60 ring-line-strong', title: 'Closed', hint: 'Done or cancelled: kept while a standup or a run names it', icon: CircleCheck, tone: 'text-fg-3', card: 'bg-fg-3/4 ring-zinc-500/15', match: (t) => t.bucket === 'closed' },
]
export const groupOf = (t: TicketView) => GROUPS.find((g) => g.match(t))!

/**
 * The list's sections, by who acts next, so its top always says where to look: you, the agents, nobody yet. Each holds
 * some of the groups above (a ticket's colour and the home's counts), in this order.
 */
const DONE_DAYS = 3 // as the server keeps them (linear.ts)
export type Tier = { id: string; title: string; hint: string; icon: LucideIcon; tone: string; groups: string[] }
const PINNED: Tier = { id: 'pinned', title: 'Bookmarked', hint: 'Tickets you bookmarked: kept on top until they are done, and every change of their state is an alert', icon: Bookmark, tone: 'text-accent fill-current', groups: [] }
// what you set aside: out of the sections and the counts, one folded section at the foot until you bring it back
const ASIDE: Tier = { id: 'aside', title: 'Set aside', hint: 'Tickets and stacks you set aside for now: out of the way until you bring them back', icon: Archive, tone: 'text-fg-3', groups: [] }
export const TIERS: Tier[] = [
  { id: 'you', title: 'Waiting on you', hint: 'Your move: the agent asked you something, or a PR has red CI or open threads', icon: MessageCircleQuestion, tone: 'text-wait-text', groups: ['needs-you', 'tend'] },
  { id: 'running', title: 'Running', hint: 'An agent is working on it', icon: LoaderCircle, tone: 'text-run-text', groups: ['running'] },
  { id: 'review', title: 'In review', hint: 'Its PR is open and green: nothing waits on you', icon: CircleCheck, tone: 'text-ok-text', groups: ['shipped'] },
  { id: 'flight', title: 'In progress', hint: 'Started; the ones untouched for a day first', icon: CircleDot, tone: 'text-accent-text', groups: ['stalled', 'in-progress'] },
  { id: 'next', title: 'Ready', hint: 'Ready to pick, by priority', icon: CircleDashed, tone: 'text-fg-2', groups: ['todo'] },
  { id: 'later', title: 'Later', hint: 'Triage and backlog: never picked on their own, but you can run one by hand', icon: Archive, tone: 'text-fg-3', groups: ['triage', 'backlog'] },
  { id: 'handed', title: 'Handed over', hint: 'Someone else has it now: never waiting on you; open one to steer it', icon: Users, tone: 'text-teal-600 dark:text-teal-400', groups: ['handed'] },
  { id: 'done', title: 'Done', hint: `Done or cancelled in the last ${DONE_DAYS} days, newest first`, icon: CircleCheck, tone: 'text-fg-3', groups: ['closed'] },
]
const ORDER = TIERS.flatMap((x) => x.groups)
/** Done or cancelled lately: shown under Done, faded, until DONE_DAYS have passed. */
export const isDone = (t: TicketView) => t.bucket === 'closed' && !!t.doneAt && Date.now() - Date.parse(t.doneAt) < DONE_DAYS * 86_400_000
const inTier = (t: TicketView, x: Tier) => x.groups.includes(groupOf(t).id)
/** The section a ticket is listed under: the list and the home's counts both go by it. */
export const tierOf = (t: TicketView) => TIERS.find((x) => inTier(t, x))!

/** The tickets that ship together: their PRs stacked on GitHub, or one run's (see ticketStacks). */
export const runKey = (t: TicketView) => t.stack?.key

/**
 * The sections, each a list of units: a ticket alone, or the tickets that ship as one stack, bottom first. A stack stays
 * whole, in the section of its most pressing ticket; inside one: its groups in order, priority (urgent first, none
 * last), then oldest.
 */
export function groupedTickets(tickets: TicketView[], q: string): { tier: Tier; units: TicketView[][] }[] {
  const needle = q.trim().toLowerCase()
  const hit = (t: TicketView) => (!needle || `${t.id} ${t.title} ${t.labels.join(' ')}`.toLowerCase().includes(needle))
    // a closed one only while it's freshly done (else it's kept just for what names it), or while a run works on it (a
    // handover to a ticket that was already Done: it shows under Agents on it, never hidden)
    && (t.bucket !== 'closed' || isDone(t) || t.busy)
  const gi = (t: TicketView) => ORDER.indexOf(groupOf(t).id)
  const units = new Map<string, TicketView[]>()
  for (const t of tickets.filter(hit).sort((a, b) => gi(a) - gi(b) || ticketOrder(a, b))) {
    const k = runKey(t) ?? t.id
    units.set(k, [...(units.get(k) ?? []), t])
  }
  const all = [...units.values()].map((u) => u.sort((a, b) => a.stack!.ids.indexOf(a.id) - b.stack!.ids.indexOf(b.id)))
  const tierAt = (u: TicketView[]) => TIERS.findIndex((x) => x.groups.includes(ORDER[Math.min(...u.map(gi))]))
  // bookmarked ones lead, whatever their state
  const aside = all.filter((u) => u.some((t) => t.aside)), live = all.filter((u) => !aside.includes(u))
  const pinned = live.filter((u) => u.some((t) => t.pinned)), open = live.filter((u) => !pinned.includes(u))
  // dimmed ones sink to the end of their group
  const dim = (u: TicketView[]) => (u.every((t) => t.dimmed) ? 1 : 0)
  const doneAt = (u: TicketView[]) => u[0].doneAt ?? ''
  const tiers = TIERS.map((tier, i) => ({ tier, units: open.filter((u) => tierAt(u) === i).sort((a, b) => tier.id === 'done' ? doneAt(b).localeCompare(doneAt(a)) : dim(a) - dim(b)) }))
  return [...(pinned.length ? [{ tier: PINNED, units: pinned }] : []), ...tiers, ...(aside.length ? [{ tier: ASIDE, units: aside }] : [])]
}

const ticketId = (t: TicketView) => t.id, tierId = (g: { tier: Tier }) => g.tier.id

/** List order, also used for j/k. */
export const orderedTickets = (tickets: TicketView[], q: string): TicketView[] => groupedTickets(tickets, q).flatMap((g) => g.units.flat())

export const PRIORITY: Record<number, { icon: LucideIcon; label: string; tone: string }> = {
  0: { icon: Signal, label: 'No priority', tone: 'text-fg-4' },
  1: { icon: AlertTriangle, label: 'Urgent', tone: 'text-fail-text' },
  2: { icon: SignalHigh, label: 'High', tone: 'text-wait-text' },
  3: { icon: SignalMedium, label: 'Medium', tone: 'text-fg-3' },
  4: { icon: SignalLow, label: 'Low', tone: 'text-fg-3' },
}

export const TEAM_TONE: Record<string, string> = {
  BLI: 'bg-accent/10 text-accent-text ring-accent/20',
  WA: 'bg-run/10 text-run-text ring-run/20',
  AI: 'bg-fuchsia-500/10 text-fuchsia-700 ring-fuchsia-500/20 dark:text-fuchsia-300',
  DA: 'bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300',
}
// the team's mark where the Review list shows an avatar
export const TEAM_MARK: Record<string, string> = {
  BLI: 'from-accent to-accent', WA: 'from-run to-run', AI: 'from-fuchsia-400 to-fuchsia-600', DA: 'from-teal-400 to-teal-600',
}

export { short } from '../time.ts'

/** A run's phase in words (phases.ts), by its id. */
export const PHASE_LABEL: Record<string, string> = Object.fromEntries(PHASES.map((p) => [p.id, p.doing]))

export function ExecList({ tickets: given, selected, onSelect, picked, onPick, onRun, missing, query, onQuery, now, toast, elsewhere = 0, onAllApps }: {
  elsewhere?: number; onAllApps?: () => void // waiting on you in apps outside the focus
  missing?: string[]; toast: (m: string, tone?: 'ok' | 'error') => void
  tickets: TicketView[]; selected?: string; onSelect: (id: string) => void
  picked: string[]; onPick: (ids: string[]) => void; onRun: (stacks?: string[][], note?: string) => Promise<unknown>
  query: string; onQuery: (q: string) => void; now: number
}) {
  const away = useAway() // repositories not on this machine: their tickets are shown, not opened
  const held = useHeld() // no machine can work on their application now: dimmed, opened to read, not picked
  // a bookmark or dim clicked here shows at once (the row moves to where it now belongs), and stays until the server
  // agrees (settle.ts)
  const [over, setOver] = useState<Record<string, { pinned?: boolean; dimmed?: boolean; aside?: boolean }>>({})
  useEffect(() => setOver((o) => pending(o, given)), [given])
  const tickets = given.map((t) => (over[t.id] ? { ...t, ...over[t.id] } : t))
  const nav = useRef<HTMLElement>(null)
  // set aside: a ticket, or its whole stack (bringing one back brings back whatever set it aside)
  const setAside = (t: TicketView, whole: boolean) => {
    const on = !t.aside, ids = whole && t.stack ? t.stack.ids : [t.id]
    setOver((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, { ...o[id], aside: on }])) }))
    const keys = on ? [whole && t.stack ? `stack:ticket:${t.stack.key}` : `ticket:${t.id}`] : [...ids.map((id) => `ticket:${id}`), ...(t.stack ? [`stack:ticket:${t.stack.key}`] : [])]
    Promise.all(keys.map((key) => api('/aside', { key, on }))).then(() => toast(on ? `${whole && t.stack ? `The stack ${t.stack.ids.join(' → ')}` : t.id} set aside: it waits at the foot of the list` : `${whole && t.stack ? 'The stack' : t.id} is back`),
      (e: Error) => { setOver((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, { ...o[id], aside: !on }])) })); toast(e.message, 'error') })
  }
  const quick = (t: TicketView, what: 'pinned' | 'dimmed') => {
    const on = !t[what]
    setOver((o) => ({ ...o, [t.id]: { ...o[t.id], [what]: on } }))
    const done = what === 'pinned'
      ? api('/pins', { key: `ticket:${t.id}`, on }).then(() => toast(on ? `${t.id} bookmarked: it stays on top` : `${t.id}: bookmark removed`))
      : api(`/exec/tickets/${encodeURIComponent(t.id)}/dim`, { on }).then(() => toast(on ? `${t.id} dimmed until its state changes` : `${t.id} back to normal`))
    done.catch((e: Error) => { setOver((o) => ({ ...o, [t.id]: { ...o[t.id], [what]: !on } })); toast(e.message, 'error') })
  }
  // a burst of updates moves rows once, when it settles (settle.ts); the filter and your clicks at once
  const groups = useSettled(groupedTickets(tickets, query), ticketId, tierId, `${query}|${JSON.stringify(over)}`), list = groups.flatMap((g) => g.units.flat())
  useFlip(nav, shapeKey(groups, ticketId, tierId), tickets.map(ticketId))
  useTouch('exec', selected)
  const seen = recent('exec', 5, now)
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const activeRef = useRef<HTMLDivElement>(null)
  // the section the open ticket shows in (as shown: once a burst has settled, so it glows once, where it landed)
  const openTier = groups.find((g) => g.units.some((u) => u.some((t) => t.id === selected)))?.tier.id
  const was = useRef('')
  const [moved, setMoved] = useState(false)
  // whether the open ticket was in sight before this render: a move follows it only if you were looking at it (else
  // every move of it pulled the list away from where you were reading)
  const inSight = useRef(false), sawIt = useRef(false)
  const sight = () => { const r = activeRef.current?.getBoundingClientRect(), b = nav.current?.getBoundingClientRect(); return !!r && !!b && r.bottom > b.top && r.top < b.bottom }
  useLayoutEffect(() => { sawIt.current = inSight.current; inSight.current = sight() })
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', behavior: smooth() }) }, [selected])
  useEffect(() => {
    // same ticket, another section: a sync or a run moved it; show where it went
    const [id, g] = was.current.split('|')
    was.current = `${selected}|${openTier ?? ''}`
    if (id !== selected || !g || !openTier || g === openTier) return
    setMoved(true)
    if (sawIt.current) activeRef.current?.scrollIntoView({ block: 'nearest', behavior: smooth() })
    const t = setTimeout(() => setMoved(false), 1600)
    return () => { clearTimeout(t); setMoved(false) }
  }, [selected, openTier])
  // folded sections, per browser (stored as flips of the default: Later and Handed over start folded); a filter shows everything,
  // and a folded section still shows the open ticket
  const [folded, setFolded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('exec-folded-tiers') ?? '[]') } catch { return [] } })
  const fold = (id: string) => {
    const next = folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id]
    setFolded(next)
    try { localStorage.setItem('exec-folded-tiers', JSON.stringify(next)) } catch { /* private window */ }
  }
  const toggle = (id: string) => onPick(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  const drag = useDragPick(picked, onPick)

  // one ticket's row; inside a stack card it sits on the card's rail, and quieter when its own group is not this one
  const row = (t: TicketView, { up = false, down = false, quiet = false, at = undefined as number | undefined } = {}) => {
    const g = groupOf(t)
    const active = t.id === selected
    const on = picked.includes(t.id)
    const P = PRIORITY[t.priority] ?? PRIORITY[0]
    const outcome = t.run?.outcomes[t.id]?.outcome
    const phase = t.busy ? (t.run?.phases[t.id] ?? t.run?.phase) : undefined
    const pickable = !t.busy && !!t.repo && !held[t.repo]
    // what its agent waits on you for: said on the row, so the list is the overview
    const asks = !t.busy && t.run?.state === 'done' ? askLine(t.run.next) : undefined
    const pr = t.prs[0] ?? t.pr
    const mine = g.id === 'needs-you' || g.id === 'tend' // waiting on you: the whole title, it's what you came for
    const done = isDone(t)
    return (
      <div key={t.id} data-flip={t.id} ref={active ? activeRef : undefined} onClick={() => !(t.repo && away.has(t.repo)) && onSelect(t.id)} data-away={(t.repo && away.has(t.repo)) || undefined} data-held={(!!t.repo && !!held[t.repo] && !away.has(t.repo)) || undefined} title={t.repo && held[t.repo] ? `Actions off: ${held[t.repo]}` : undefined} aria-disabled={(t.repo && away.has(t.repo)) || undefined} onMouseEnter={() => prefetchFeed(`ticket:${t.id}`)} {...drag(t.id, pickable)} role="button" tabIndex={0} aria-current={active} style={t.repo ? appColor(t.repo).style : undefined}
           onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && !(t.repo && away.has(t.repo))) { e.preventDefault(); onSelect(t.id) } }}
           className={`group relative ${up || down ? '' : 'mb-0.5'} flex w-full cursor-pointer ${active && moved ? 'animate-[moved_1.6s_ease-out]' : ''} items-center gap-2.5 overflow-hidden rounded-ctl px-2.5 py-2 text-left -outline-offset-2 transition-[background-color,box-shadow] duration-[120ms] ${
             active ? 'sel-row' : on ? 'bg-accent/6 ring-1 ring-accent/25' : 'hov'}`}>
        {up && <span className="absolute left-[22px] top-0 h-1/2 w-px bg-fill-strong" aria-hidden />}
        {down && <span className="absolute bottom-0 left-[22px] h-1/2 w-px bg-fill-strong" aria-hidden />}
        {t.busy && <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-run/10"><span className="block h-full w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-run to-transparent" /></span>}
        {/* the team's mark, like the Review list's avatar; it turns into the pick box on hover (or once anything is picked) */}
        <button onClick={(e) => { e.stopPropagation(); if (pickable) toggle(t.id) }} disabled={!pickable} aria-pressed={on}
                aria-label={on ? `Take ${t.id} out of the next run` : `Add ${t.id} to the next run`}
                title={!t.repo ? 'No repository mapped for this team' : held[t.repo] ? `Can't run now: ${held[t.repo]}` : t.busy ? 'Already running' : on ? `Picked #${picked.indexOf(t.id) + 1}` : 'Add to the next run'}
                className="relative z-10 size-6 shrink-0 rounded-full transition-transform duration-200 group-hover:scale-105">
          {on
            ? <span className="flex size-full items-center justify-center rounded-full bg-accent text-micro font-semibold text-on-accent">{picked.indexOf(t.id) + 1}</span>
            : <>
                <span className={`flex size-full items-center justify-center rounded-full bg-gradient-to-br text-micro font-bold tracking-tight text-white ring-1 ring-black/5 transition-opacity dark:ring-white/10 ${TEAM_MARK[t.team] ?? 'from-zinc-400 to-zinc-600'} ${pickable ? (picked.length ? 'opacity-0' : 'group-hover:opacity-0') : ''}`}>{t.team.slice(0, 3)}</span>
                {pickable && <span className={`absolute inset-0 flex items-center justify-center rounded-full ring-1 ring-accent/70 transition-opacity ${picked.length ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}><Plus className="size-3.5 text-accent-text" /></span>}
                <span role="img" aria-label={g.title} title={g.title} className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-line ${g.dot ?? 'bg-fg-4'} ${t.busy ? 'animate-pulse' : ''}`} />
              </>}
        </button>
        <span className={`min-w-0 flex-1 transition-opacity ${(t.dimmed || done) && !active ? 'opacity-45 group-hover:opacity-100' : quiet && !active ? 'opacity-60 group-hover:opacity-100' : ''}`}>
          <span className={`${mine ? 'line-clamp-2' : 'block truncate'} text-body ${quiet || done ? '' : 'font-medium'} ${done ? 'line-through decoration-fg-4/60' : ''} leading-snug transition-colors ${active ? 'text-fg-1 ' : 'text-fg-2 group-hover:text-fg-1'}`}>{t.title}</span>
          <span className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-meta text-fg-3">
            <span className="flex shrink-0 items-center gap-1 font-mono"><P.icon className={`size-3 ${P.tone}`} aria-label={P.label} />{t.id}</span>
            {done ? <span className="flex shrink-0 items-center gap-1 font-medium text-ok-text"><CircleCheck className="size-3" />{t.state}</span>
              : t.queued ? <span className="truncate text-fg-3" title={queuedText(t.queued)}>Queued · {t.queued.why}</span>
              : phase ? <span className="truncate text-run-text">{PHASE_LABEL[phase] ?? phase}</span>
              : g.id === 'stalled' ? <><span className="shrink-0 text-wait-text">Gone quiet</span>{pr ? <span className="shrink-0 font-mono">#{pr.number}</span> : <span className="truncate">{t.state}</span>}</>
              : outcome && !pr ? <span className={`truncate ${outcome === 'shipped' || outcome === 'ready' ? 'text-ok-text' : outcome === 'refined' ? 'text-wait-text' : 'text-fail-text'}`}>{outcome}</span>
              : asks ? <span className="truncate font-medium text-wait-text" title={asks}>Asks: {asks}</span>
              : pr ? <>
                  <span className="shrink-0 font-mono">#{pr.number}</span>
                  {t.prs.length > 1 && <PrStrip prs={t.prs} />}
                  {t.pr?.ci === 'failure' && <span className="shrink-0 rounded-full bg-fail/10 px-1.5 font-medium text-fail-text">CI red</span>}
                  {!!t.pr?.openThreads && <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-wait/10 px-1.5 font-medium text-wait-text" title={`${t.pr.openThreads} open threads`}><MessageSquareWarning className="size-3" />{t.pr.openThreads}</span>}
                </>
              : g.id === 'needs-you' ? <span className="truncate font-medium text-wait-text">Asked you on Linear</span>
              : t.waitsOn ? <span className="truncate text-accent-text" title={`Done and pushed. Its stack is submitted in order once ${t.waitsOn} ${t.waitsOn.includes(',') ? 'are' : 'is'} ready too`}>Ready · waits on {t.waitsOn}</span>
              : <span className="truncate">{t.state}</span>}
            {!!t.background && <span className="flex shrink-0 items-center gap-1 rounded-full bg-ok/10 px-1.5 font-medium text-ok-text" title={`${t.background} running in the background (open it to see what)`}><span className="size-1.5 animate-pulse rounded-full bg-ok" />{t.background} bg</span>}
            {/* its time, swapped on hover for the quick actions in the same place: what's on stays lit, a click shows at once */}
            <span className="ml-auto grid shrink-0 items-center [&>*]:col-start-1 [&>*]:row-start-1">
              {at ? <span className="text-right tabular-nums group-hover:invisible group-focus-within:invisible" title="When you last opened it">{short(new Date(at).toISOString(), now)} ago</span> : <span className="text-right tabular-nums group-hover:invisible group-focus-within:invisible">{short(done ? t.doneAt! : t.updatedAt, now)}</span>}
              <span className="invisible -my-1 flex justify-end gap-0.5 group-hover:visible group-focus-within:visible">
                {([['pinned', Bookmark, t.pinned ? 'Remove the bookmark' : 'Bookmark: keep it on top, and alert me when its state changes'],
                   // dimming is gone (Set aside does it): a ticket dimmed before keeps the way back
                   ...(t.dimmed ? [['dimmed', Moon, 'Undim: back to normal in the list'] as const] : [])] as const).map(([what, Icon, label]) => (
                  <button key={what} onClick={(e) => { e.stopPropagation(); quick(t, what) }} title={label} aria-label={label} aria-pressed={!!t[what]}
                          className={`-my-0.5 rounded-chip p-1.5 transition-colors ${t[what] ? 'text-accent' : 'text-fg-3 hover:bg-fg-3/10 hover:text-fg-1'}`}>
                    <Icon className={`size-3.5 ${t[what] ? 'fill-current' : ''}`} />
                  </button>
                ))}
                {!t.stack && <button onClick={(e) => { e.stopPropagation(); setAside(t, false) }} title={t.aside ? 'Bring it back into the list' : 'Set aside: out of the way until you bring it back'}
                                     aria-label={t.aside ? 'Bring it back into the list' : 'Set aside'} aria-pressed={!!t.aside}
                                     className={`-my-0.5 rounded-chip p-1.5 transition-colors ${t.aside ? 'text-accent' : 'text-fg-3 hover:bg-fg-3/10 hover:text-fg-1'}`}><Archive className="size-3.5" /></button>}
              </span>
            </span>
          </span>
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2.5">
        <label className="group flex items-center gap-2 rounded-ctl bg-surface-1 px-3 py-1.5 text-body shadow-sm ring-1 ring-line transition-all duration-200 hover:ring-line-strong focus-within:ring-2 focus-within:ring-accent/60">
          <Search className="size-4 text-fg-3 transition-colors group-focus-within:text-accent" aria-hidden />
          <input data-filter value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { if (query) { e.stopPropagation(); onQuery('') } else e.currentTarget.blur() } }} placeholder="Filter tickets" className="w-full bg-transparent outline-none placeholder:text-fg-3" />
          {query
            ? <button onClick={() => onQuery('')} className="rounded-chip p-0.5 text-fg-3 transition-colors hov hover:text-fg-2" aria-label="Clear filter"><X className="size-3.5" /></button>
            : <kbd className="rounded-chip border border-line-strong px-1.5 font-mono text-micro text-fg-3">/</kbd>}
        </label>
      </div>

      <nav ref={nav} onScroll={() => { inSight.current = sight() }} className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Tickets">
        {list.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <span className="flex size-12 items-center justify-center rounded-card bg-fill"><Inbox className="size-6 text-fg-3" aria-hidden /></span>
            <p className="text-reading text-fg-3">{query ? 'Nothing matches that filter.' : 'No tickets assigned to you.'}</p>
          </div>
        )}
        {groups.map(({ tier: x, units }) => {
          const you = x.id === 'you'
          // the first section is always there, so the top of the list always answers "anything for me?"
          if (!units.length) return you && list.length && !query
            ? elsewhere > 0
              ? <button key={x.id} onClick={onAllApps} className="mb-2 mt-1 flex w-full items-center gap-2 rounded-ctl bg-wait/7 px-2.5 py-2 text-left text-small font-medium text-wait-text ring-1 ring-wait/25 transition-colors hover:bg-wait/12">
                  <MessageCircleQuestion className="size-3.5 shrink-0 text-wait-text" />Nothing here, but {elsewhere} wait{elsewhere === 1 ? 's' : ''} on you in other apps<span className="ml-auto shrink-0 text-meta text-wait-text/80">Show all</span>
                </button>
              : <p key={x.id} className="mb-2 mt-1 flex items-center gap-2 px-2.5 py-2 text-small text-fg-3"><CircleCheck className="size-3.5 text-ok-text" />Nothing waits on you</p>
            : null
          const n = x.id === 'recent' || x.id === 'pinned' || x.id === 'aside' ? units.length : units.flat().filter((t) => inTier(t, x)).length
          const shut = folded.includes(x.id) !== (x.id === 'later' || x.id === 'handed' || x.id === 'aside') && !query
          return (
            <section key={x.id} className={you ? 'mb-2' : 'mb-1.5'}>
              <h2 className="sticky top-0 z-10 backdrop-blur-xl" title={x.hint}>
                <button onClick={() => fold(x.id)} aria-expanded={!shut} className={`group/fold flex w-full items-center gap-2 px-2.5 pb-1.5 pt-3 label transition-colors ${you ? 'text-wait-text' : 'text-fg-4 hover:text-fg-1'}`}>
                  <x.icon className={`size-3.5 ${x.tone} ${x.id === 'running' ? 'animate-spin' : ''}`} />{x.title}
                  <span className={`rounded-full px-1.5 py-px text-micro font-medium normal-case tabular-nums tracking-normal ${you ? 'bg-wait text-white' : 'bg-hover text-fg-3'}`}>{n}</span>
                  <ChevronDown className={`ml-auto size-3.5 text-fg-3 transition-all duration-200 ${shut ? '-rotate-90' : 'opacity-0 group-hover/fold:opacity-100'}`} />
                </button>
              </h2>
              {(shut ? units.filter((u) => u.some((t) => t.id === selected)) : units).map((u) => u.length > 1
                ? <StackCard key={runKey(u[0])} ids={u[0].stack!.ids} byId={byId} here={x} onOpen={onSelect} aside={u.some((t) => t.aside)} onAside={() => setAside(u[0], true)}
                             onPickAll={() => onPick([...new Set([...picked, ...u[0].stack!.ids.filter((id) => { const t = byId.get(id); return !!t && !t.busy && !!t.repo })])])}>{u.map((t, i) => row(t, { up: i > 0, down: i < u.length - 1, quiet: x.id !== 'recent' && x.id !== 'pinned' && !inTier(t, x) }))}</StackCard>
                : row(u[0], { at: x.id === 'recent' ? seen.get(u[0].id) : undefined }))}
            </section>
          )
        })}
      </nav>

      <RunBar tickets={tickets} picked={picked} onPick={onPick} onRun={onRun} missing={missing} />
    </div>
  )
}

/**
 * The stacks before a run, yours to shape: lanes of tickets submitted together (bottom first), and the ones on their
 * own. Click a ticket, then where it goes (or drag it); its arrows move it within its lane. A lane takes one repository.
 * Whatever the shape, every ticket is built by its own agent at once: only how the PRs are opened changes.
 */
export function StackEditor({ shape, onShape, planned, picked, repoOf, oneRepo, why, prep, prepOn, onPrep }: {
  shape: Shape; onShape: (s: Shape) => void; planned: Shape; picked: string[]; repoOf: (id: string) => string | undefined; oneRepo: boolean
  why: string; prep?: Prep; prepOn: boolean; onPrep: (on: boolean) => void
}) {
  const [sel, setSel] = useState<string>()
  const same = (a: Shape, b: Shape) => JSON.stringify(stacksOf(a)) === JSON.stringify(stacksOf(b))
  const fits = (id: string, lane: string[]) => !lane.length || lane.includes(id) || repoOf(lane[0]) === repoOf(id)
  const go = (to: number | 'new' | 'alone', id = sel) => { if (!id) return; if (typeof to === 'number' && !fits(id, shape.lanes[to])) return; onShape(move(shape, id, to)); setSel(undefined) }
  const drop = (to: number | 'new' | 'alone') => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); go(to, e.dataTransfer.getData('text/plain')) },
  })
  const chip = (id: string, lane?: number) => {
    const at = lane == null ? -1 : shape.lanes[lane].indexOf(id), on = sel === id
    return (
      <span key={id} draggable role="button" tabIndex={0} aria-pressed={on} aria-label={`${id}: ${on ? 'picked, now choose where it goes' : 'pick it to move it'}`}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', id)} onClick={(e) => { e.stopPropagation(); setSel(on ? undefined : id) }}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setSel(on ? undefined : id) } }}
            className={`inline-flex cursor-grab items-center gap-0.5 rounded-chip px-1.5 py-px font-mono text-meta transition-shadow active:cursor-grabbing ${on ? 'bg-accent-soft text-accent-text ring-2 ring-accent/60' : 'bg-surface-1 text-fg-1 ring-1 ring-line-strong hover:ring-accent/40'}`}>
        {on && lane != null && at > 0 && <button onClick={(e) => { e.stopPropagation(); onShape(shift(shape, id, -1)) }} aria-label={`${id} one place down`} className="-my-px min-w-5 rounded-chip px-1 text-small text-fg-2 hover:bg-accent/15 hover:text-fg-1">‹</button>}
        {id}
        {on && lane != null && at < shape.lanes[lane].length - 1 && <button onClick={(e) => { e.stopPropagation(); onShape(shift(shape, id, 1)) }} aria-label={`${id} one place up`} className="-my-px min-w-5 rounded-chip px-1 text-small text-fg-2 hover:bg-accent/15 hover:text-fg-1">›</button>}
      </span>
    )
  }
  // a lane is a target while a ticket is picked (and it fits there)
  const target = (ok: boolean) => (sel && ok ? 'cursor-pointer ring-1 ring-dashed ring-accent/50 hover:bg-accent/10' : '')
  const preset = (label: string, s: Shape, show = true) => show && (
    <button key={label} onClick={() => onShape(s)} className={`rounded-chip px-2 py-0.5 text-meta font-medium ${same(shape, s) ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{label}</button>
  )
  const lanes = shape.lanes.length
  return (
    <div className="mb-2 space-y-2 rounded-ctl bg-accent/6 p-2.5 ring-1 ring-accent/15" onClick={() => setSel(undefined)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-small font-semibold text-accent-text">{lanes ? `${lanes} stack${lanes === 1 ? '' : 's'}` : 'No stacks'}{shape.alone.length > 0 && lanes > 0 && <span className="font-normal text-fg-3"> · {shape.alone.length} on their own</span>}</p>
        <div className="ml-auto inline-flex rounded-ctl bg-hover p-0.5">
          {preset('As planned', planned)}{preset('One stack', oneStack(picked), oneRepo)}{preset('No stacks', noStacks(picked))}
        </div>
      </div>
      <p className="text-meta leading-snug text-fg-3">With a plan, every ticket is built by its own agent, all at once. A stack only opens its PRs together, bottom first, once all of it is ready.</p>
      {shape.lanes.map((l, i) => (
        <div key={i} onClick={(e) => { e.stopPropagation(); go(i) }} {...drop(i)} className={`rounded-ctl px-2 py-1.5 ${target(!!sel && fits(sel, l) && !l.includes(sel))}`}>
          <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-label text-fg-4">Stack {i + 1}<span className="font-normal normal-case tracking-normal">· {repoOf(l[0])?.split('/').pop()} · bottom first</span></p>
          <div className="flex flex-wrap items-center gap-1">{l.map((id, j) => <span key={id} className="flex items-center gap-1">{j > 0 && <span className="text-fg-4">→</span>}{chip(id, i)}</span>)}</div>
        </div>
      ))}
      <div onClick={(e) => { e.stopPropagation(); go('alone') }} {...drop('alone')} className={`rounded-ctl px-2 py-1.5 ${target(!!sel && shape.lanes.some((l) => l.includes(sel)))}`}>
        <p className="mb-1 text-micro font-semibold uppercase tracking-label text-fg-4">On their own</p>
        <div className="flex flex-wrap gap-1">{shape.alone.map((id) => chip(id))}{!shape.alone.length && <span className="text-meta text-fg-4">None: every ticket is in a stack</span>}</div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); go('new') }} {...drop('new')} disabled={!sel}
              className="w-full rounded-ctl border border-dashed border-line-strong px-2 py-1 text-meta text-fg-3 transition-colors enabled:hover:border-accent/50 enabled:hover:text-accent-text disabled:opacity-60">
        {sel ? `New stack with ${sel}` : 'Pick a ticket, then a stack, a new one, or "on their own"'}
      </button>
      {prep && (
        <div className="flex items-start gap-2 text-meta leading-snug" onClick={(e) => e.stopPropagation()}>
          <button role="switch" aria-checked={prepOn} onClick={() => onPrep(!prepOn)} className={`shrink-0 rounded-full px-2 py-px font-medium transition-colors ${prepOn ? 'bg-accent text-white' : 'bg-hover text-fg-3 hover:text-fg-1'}`}>{prepOn ? 'Prep on' : 'Prep off'}</button>
          <span className={prepOn ? 'text-fg-2' : 'text-fg-4 line-through decoration-fg-4/50'}><span className="font-medium">A short shared prep first</span> for {prep.ids.join(', ')}: {prep.task}</span>
        </div>
      )}
      {why && same(shape, planned) && <p className="text-meta leading-snug text-fg-3">{why}</p>}
    </div>
  )
}

/**
 * Run what you ticked. Several are planned first and the plan is shown before anything starts: tickets that build
 * on each other stack, the rest run side by side. Run it as planned, as one stack, or all in parallel.
 */
export function RunBar({ tickets, picked, onPick, onRun, missing = [] }: { missing?: string[]; tickets: TicketView[]; picked: string[]; onPick: (ids: string[]) => void; onRun: (stacks?: string[][], note?: string, prep?: Prep, mode?: 'one-pr') => Promise<unknown> }) {
  const [busy, setBusy] = useState<'plan' | 'run' | 'one'>()
  const [plan, setPlan] = useState<{ for: string; note: string; stacks: string[][]; why: string; prep?: Prep; error?: string }>()
  const { armed, arm } = useArm() // one PR, no questions, merged on green where allowed: a second click
  const [note, setNote] = useState('') // your direction for these tickets: shapes the plan, and each run gets it
  // the stacks as you shape them, from the plan's: which PRs are submitted together (each ticket is built on its own anyway)
  const [shape, setShape] = useState<Shape>()
  const [prepOn, setPrepOn] = useState(true)
  useEffect(() => { setShape(plan && !plan.error ? shapeOf(plan.stacks) : undefined); setPrepOn(true) }, [plan])
  if (!picked.length) return null
  const key = picked.join()
  const shown = plan?.for === key ? plan : undefined // a plan is for the picks it was made from
  const repoOf = (id: string) => tickets.find((t) => t.id === id)?.repo
  const oneRepo = new Set(picked.map(repoOf)).size === 1
  const run = (stacks?: string[][]) => { setBusy('run'); onRun(stacks, note.trim() || undefined, prepOn ? shown?.prep : undefined).then(() => { setPlan(undefined); setNote('') }).finally(() => setBusy(undefined)) }
  // Ship as one PR: built side by side, agents deciding on their own, then one PR (merged on green where you allow it)
  const shipOne = () => { setBusy('one'); onRun(undefined, note.trim() || undefined, undefined, 'one-pr').then(() => { setPlan(undefined); setNote('') }).finally(() => setBusy(undefined)) }
  const makePlan = () => {
    setBusy('plan')
    api('/exec/plan', { ids: picked, note: note.trim() || undefined }).then((r: { stacks: string[][]; why: string; prep?: Prep }) => setPlan({ for: key, note: note.trim(), ...r }), (e: Error) => setPlan({ for: key, note: note.trim(), stacks: [], why: '', error: e.message }))
      .finally(() => setBusy(undefined))
  }
  const primaryCls = 'group flex flex-1 items-center justify-center gap-1.5 btn-primary btn-lg shadow-sm transition-all disabled:pointer-events-none disabled:opacity-40'
  const quiet = 'btn-outline btn-sm'
  return (
        <div className="shrink-0 animate-[toast-in_200ms_var(--ease-snappy)] border-t border-line bg-white/80 p-2.5 backdrop-blur dark:bg-zinc-900/80">
          {shown && !shown.error && shape && (
            <StackEditor shape={shape} onShape={setShape} planned={shapeOf(shown.stacks)} picked={picked} repoOf={repoOf} oneRepo={oneRepo}
                         why={shown.why} prep={shown.prep} prepOn={prepOn} onPrep={setPrepOn} />
          )}
          {shown?.error && <p className="mb-2 text-meta text-fail-text">{shown.error}</p>}
          <Missing names={missing} className="mb-2" />
          {/* a plan stays when the direction changes after it: said, with the way to plan again, not thrown away */}
          {shown && !shown.error && shown.note !== note.trim() && (
            <p className="mb-2 flex items-center gap-2 text-meta text-wait-text">The direction changed since this plan.<button onClick={makePlan} disabled={!!busy} className="font-medium underline decoration-wait/40 hover:decoration-current">Plan again</button></p>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={note ? 3 : 1}
                    placeholder={picked.length > 1 ? `Direction for these ${picked.length} (optional): the approach, what to keep in mind…` : `Direction for ${picked[0]} (optional)…`}
                    className="mb-2 w-full resize-y rounded-ctl bg-surface-1 px-2.5 py-1.5 text-small ring-1 ring-line-strong outline-none placeholder:text-fg-3 focus:ring-accent" />
          <div className={`flex items-center gap-2 ${missing.length ? 'pointer-events-none opacity-40' : ''}`}>
            {picked.length === 1
              ? <button onClick={() => run()} disabled={!!busy} className={primaryCls}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}Run {picked[0]}</button>
              : shown && !shown.error
                ? <button onClick={() => run(shape ? stacksOf(shape) : shown.stacks)} disabled={!!busy} className={primaryCls}>{busy === 'run' ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}Run the plan</button>
                : <button onClick={makePlan} disabled={!!busy} className={primaryCls}>{busy === 'plan' ? <><LoaderCircle className="size-4 animate-spin" />Planning…</> : <><Layers className="size-4" />Plan {picked.length} tickets</>}</button>}
            <button onClick={() => { onPick([]); setPlan(undefined) }} className="btn-ghost">Clear</button>
          </div>
          {picked.length > 1 && (
            <button onClick={() => arm('one', shipOne)} disabled={!!busy || !oneRepo} title={oneRepo ? `One agent works them together as one piece of work (one shared memory, shown as one group), deciding on its own (no questions), into one pull request: merged once its checks pass if its repository allows (${inSettings('repos')})` : 'One PR is one repository: pick tickets of one repository'}
                    className={`relative isolate mt-2 flex w-full items-center justify-center gap-1.5 overflow-hidden ${quiet} disabled:opacity-40`}>
              {busy === 'one' ? <LoaderCircle className="size-3.5 animate-spin" /> : <GitMerge className="size-3.5" />}{armed === 'one' ? <><ArmLabel>{`Confirm: ${picked.length} as one PR, no questions, merged when green if allowed`}</ArmLabel><ArmBar on="plain" /></> : `Ship ${picked.length} as one PR`}
            </button>
          )}
          {picked.length > 1 && !shown && <p className="mt-1.5 text-center text-meta text-fg-3">See which build on each other before anything runs.</p>}
        </div>
  )
}

/**
 * The tickets that ship as one stack, as one card: where they ship, how many, and a strip with each one's group colour in
 * the run's order (the ones that put the stack in this section bright, the others faint); the rows go below.
 */
function StackCard({ ids, byId, here, onOpen, onPickAll, aside, onAside, children }: { ids: string[]; byId: Map<string, TicketView>; here: Tier; onOpen: (id: string) => void; onPickAll?: () => void; aside?: boolean; onAside?: () => void; children: ReactNode }) {
  const repo = byId.get(ids.find((id) => byId.get(id)?.repo) ?? '')?.repo
  return (
    <div style={repo ? appColor(repo).style : undefined} className="group/stack relative mb-1.5 rounded-ctl bg-white/50 p-1 ring-1 ring-line dark:bg-zinc-900/30 ">
      {/* the whole group into the next run at once (Ship as one PR, or a plan), its free tickets only */}
      {onPickAll && <button onClick={onPickAll} title="Pick every ticket of this group for the next run" className="absolute right-20 top-1.5 z-10 rounded-chip px-1.5 text-micro font-medium text-accent-text opacity-0 transition-opacity hover:underline group-hover/stack:opacity-100 focus:opacity-100">Pick all</button>}
      <button onClick={() => onOpen(`stack:ticket:${ids.find((id) => byId.has(id)) ?? ids[0]}`)} title={`Open the stack: ${ids.join(' → ')}`}
              className="flex w-full items-center gap-2 rounded-ctl px-2 pb-1 pt-1 text-left text-meta text-fg-3 transition-colors enabled:hover:bg-hover enabled:hover:text-fg-1">
        <Layers className="size-3.5 shrink-0 text-accent" />
        {repo && <span className={`truncate font-mono ${appColor(repo).text}`}>{repo.split('/')[1]}</span>}
        <span className="shrink-0 tabular-nums">{ids.length} tickets</span>
        {onAside && <span role="button" tabIndex={0} title={aside ? 'Bring the stack back into the list' : 'Set the stack aside: out of the way until you bring it back'} aria-label={aside ? 'Bring the stack back' : 'Set the stack aside'} aria-pressed={!!aside}
                          onClick={(e) => { e.stopPropagation(); onAside() }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onAside() } }}
                          className={`ml-auto shrink-0 rounded p-0.5 transition-colors ${aside ? 'text-accent' : 'invisible text-fg-3 hover:bg-hover hover:text-fg-1 group-hover/stack:visible focus-visible:visible'}`}><Archive className="size-3.5" /></span>}
        <span className={`${onAside ? '' : 'ml-auto '}flex w-16 shrink-0 gap-0.5`}>
          {ids.map((id) => {
            const t = byId.get(id), g = t && groupOf(t)
            return <span key={id} title={`${id} ${g?.title ?? 'not yours or gone'}`} className={`h-1 flex-1 rounded-full ${g?.dot ?? 'bg-fill-strong'} ${t && !inTier(t, here) ? 'opacity-35' : ''}`} />
          })}
        </span>
      </button>
      {children}
    </div>
  )
}

/** A ticket's PRs at a glance, bottom of the stack first: a segment each, red CI, amber threads, else its CI colour. */
function PrStrip({ prs }: { prs: TicketView['prs'] }) {
  const tone = (p: TicketView['prs'][number]) => p.ci !== 'failure' && p.openThreads ? 'bg-wait' : ciTone(p).split(' ').filter((c) => !c.includes('ring')).join(' ')
  return (
    <span className="flex shrink-0 items-center gap-1" title={prs.map((p) => `#${p.number} ${ciLabel(p)}${p.openThreads ? ` · ${p.openThreads} open` : ''}`).join('\n')}>
      <Layers className="size-3 text-accent" />
      <span className="flex gap-px" style={{ width: Math.min(prs.length * 7, 56) }}>{prs.map((p) => <span key={p.url} className={`h-1.5 flex-1 rounded-full ${tone(p)}`} />)}</span>
    </span>
  )
}
