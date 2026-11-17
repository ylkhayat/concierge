import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, Clock, Layers, GitPullRequest, Play, Sparkles, Ticket as TicketIcon, Timer, Undo2 } from 'lucide-react'
import { askLine } from '../../server/reply.ts'
import { StackNav } from './StackNav.tsx'
import { useEffect, useState, type ReactNode } from 'react'
import type { Unit } from '../desk.ts'
import { api, enc, isTyping, type PrView, type TicketView } from '../lib.ts'
import { statusMeta } from './StatusBadge.tsx'
import { groupOf } from './ExecList.tsx'
import { bringBack, focusBlock, laterToday, offUntil, putOff, startFocus, stopFocus, tomorrowMorning, useDeskTime } from '../deskTime.ts'

const KIND = { stack: { icon: Layers, label: 'Stack' }, ticket: { icon: TicketIcon, label: 'Task' }, pr: { icon: GitPullRequest, label: 'PR' } }
const BEFORE = 1, AFTER = 4 // cards shown around the one on stage

// a set kept for this tab: what the desk already queued (each PR once), and the units you asked to go through
const kept = (name: string) => {
  const s = (() => { try { return new Set<string>(JSON.parse(sessionStorage.getItem(name) ?? '[]')) } catch { return new Set<string>() } })()
  return { has: (k: string) => s.has(k), add: (k: string) => { s.add(k); try { sessionStorage.setItem(name, JSON.stringify([...s])) } catch { /* private window */ } } }
}
const queued = kept('desk-queued'), going = kept('desk-going')
// the order you go through units in: fixed for the tab once a unit has a place, new ones join at the end, so a card
// never jumps and forward always means the same next one
const loadOrder = (): string[] => { try { return JSON.parse(sessionStorage.getItem('desk-order') ?? '[]') } catch { return [] } }

/**
 * The desk as a stage: the unit you work on in the middle, the ones before and after it as cards at the side, in one
 * fixed order (the one on stage marked in its place). A click jumps; n / p, or the arrows, move forward and back.
 * On stage: the unit's parts, bottom to top, and the PR or ticket you stand on. Nothing runs on opening;
 * "Review bottom up" goes through its new PRs.
 */
export function Desk({ unit, all, later = [], selected, onSelect, onUnit, toast, children }: {
  unit: Unit; all: Unit[]; selected: string
  later?: Unit[] // put off for now: out of the order until their time comes
  onSelect: (id: string) => void; onUnit: (u: Unit) => void
  toast: (m: string, tone?: 'ok' | 'error') => void
  children: ReactNode // the open PR or ticket
}) {
  const byKey = new Map(all.map((u) => [u.key, u]))
  // the units in your order: the ones with a place keep it (gone ones drop out), new ones join at the end in the
  // desk's ranking
  const [saved] = useState(loadOrder)
  const keys = [...saved.filter((k) => byKey.has(k)), ...all.map((u) => u.key).filter((k) => !saved.includes(k))]
  useEffect(() => { try { sessionStorage.setItem('desk-order', JSON.stringify(keys)) } catch { /* private window */ } }, [keys.join()])
  const order = keys.map((k) => byKey.get(k)!)
  const at = Math.max(0, keys.indexOf(unit.key))
  const prev = order[at - 1], next = order[at + 1]
  const shown = order.slice(Math.max(0, at - BEFORE), at + AFTER + 1)

  // n / p: forward and back through the order
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      const u = e.key === 'n' ? next : e.key === 'p' ? prev : undefined
      if (u) { e.preventDefault(); onUnit(u) }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })

  // opening a unit starts nothing. Once you ask, it goes bottom up, one at a time: the lowest PR no agent has looked
  // at, once nothing else in the unit is at work, so each reviews on top of what is below it
  const [go, setGo] = useState(() => going.has(unit.key))
  useEffect(() => setGo(going.has(unit.key)), [unit.key])
  const start = () => { going.add(unit.key); setGo(true) }
  const nextUp = go && !unit.working ? unit.fresh.find((p) => !queued.has(p.id)) : undefined
  useEffect(() => {
    if (!nextUp) return
    queued.add(nextUp.id)
    const left = unit.fresh.length - 1
    api(`/prs/${enc(nextUp.id)}/run`, {}).then(
      () => toast(`Queued #${nextUp.number}${left ? `; ${left} more after it, bottom up` : ''}`),
      (e: Error) => toast(`#${nextUp.number}: ${e.message}`, 'error'))
  }, [nextUp?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const K = KIND[unit.kind]
  useDeskTime()
  const block = focusBlock()
  // the ticket pane, open or folded ([), remembered for this browser
  const [paneOpen, setPaneState] = useState(() => { try { return localStorage.getItem('desk-ticket-pane') !== 'closed' } catch { return true } })
  const setPane = (on: boolean) => { setPaneState(on); try { localStorage.setItem('desk-ticket-pane', on ? 'open' : 'closed') } catch { /* private window */ } }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '[' && !isTyping(e) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setPane(!paneOpen) } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })
  // the focus block ending: said once, here and (in the background) as a notification
  useEffect(() => {
    if (!block) return
    const t = setTimeout(() => {
      stopFocus(); toast('Focus block done. Take a breath, then n for the next topic')
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Focus block done', { body: unit.title })
    }, block.endsAt - Date.now())
    return () => clearTimeout(t)
  }, [block?.endsAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = !unit.needs && !unit.working && !unit.fresh.length
  const parts = [...(unit.ticket ? [{ id: unit.ticket.id, ref: unit.ticket.id, title: unit.ticket.title, ...ticketState(unit.ticket) }] : []),
    ...unit.members.map((p) => ({ id: p.id, ref: `#${p.number}`, title: p.title, ...prState(p) }))]

  return (
    <div className="flex h-full min-h-0">
      {/* the side of the stage: cards leaning in, flat and lifted when you point at one */}
      <aside aria-label="Your work, in order" className="hidden w-[208px] shrink-0 flex-col gap-3 overflow-y-auto py-5 pl-4 pr-2 [perspective:900px] lg:flex 2xl:w-[232px]">
        {at > BEFORE && <p className="px-1 text-meta text-fg-3">{at - BEFORE} before</p>}
        {shown.map((u) => <span key={u.key} className={`transition-opacity ${block && u.key !== block.key ? 'opacity-30 hover:opacity-100' : ''}`}><Card u={u} n={keys.indexOf(u.key) + 1} on={u.key === unit.key} onOpen={() => onUnit(u)} /></span>)}
        {order.length > at + AFTER + 1 && <p className="px-1 text-meta text-fg-3">{order.length - at - AFTER - 1} more after</p>}
        {later.length > 0 && (
          <details className="mt-1 px-1 text-meta text-fg-3">
            <summary className="cursor-pointer select-none">{later.length} put off</summary>
            <ul className="mt-1 space-y-1">{later.map((u) => (
              <li key={u.key} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate" title={u.title}>{u.title}</span>
                <span className="shrink-0 tabular-nums text-fg-3">{when(offUntil(u.key))}</span>
                <button onClick={() => { bringBack(u.key); onUnit(u) }} title="Bring it back now" aria-label={`Bring back ${u.title}`} className="shrink-0 rounded p-0.5 hover:text-fg-1"><Undo2 className="size-3" /></button>
              </li>
            ))}</ul>
          </details>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col p-1.5 sm:py-2 sm:pl-0 sm:pr-2 lg:py-3 lg:pr-3">
        {/* the stage itself: one raised surface holding the unit */}
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-bg-app ring-1 ring-line`}>
          {/* one slim row: what the unit is, the way through its parts (the ticket, then its PRs bottom to top), where you are
              in the order and the way on */}
          <div className="flex shrink-0 items-center gap-3 px-3 pt-2.5 sm:px-5 lg:px-7">
            {/* the unit as one thing: its stack view (every PR at a glance, one answer, the whole-stack actions) */}
            <button disabled={!unit.members.length} onClick={() => onSelect(`stack:${unit.members[0].id}`)} title={unit.members.length ? `${unit.title}\nOpen the stack view` : unit.title}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md text-small font-semibold text-accent-text enabled:hover:underline">
              <K.icon className="size-3.5" />{K.label}{parts.length > 1 ? ` · ${parts.length}` : ''}
            </button>
            {parts.length > 1 ? (
              <span className="flex min-w-0 flex-1">
                <StackNav keys noun="part" items={parts.map((x) => ({ id: x.id, kind: x.id === unit.ticket?.id ? 'ticket' as const : 'pr' as const, ref: x.ref, title: x.title, dot: x.dot, state: x.label }))}
                          current={selected} onOpen={(x) => onSelect(x.id)} />
              </span>
            ) : <h1 className="min-w-0 flex-1 truncate text-body font-medium text-fg-2 ">{unit.title}</h1>}
            {done
              ? <span className="hidden shrink-0 items-center gap-1 text-meta font-medium text-ok-text sm:inline-flex"><CircleCheck className="size-3.5" />Nothing waits</span>
              : unit.fresh.length > 0 && !go
                ? <button onClick={start} title={`Review ${unit.fresh.map((p) => `#${p.number}`).join(', ')}, the lowest first, one at a time`}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-meta font-medium text-on-accent transition-all hover:bg-accent">
                    <Play className="size-3 fill-current" />{unit.fresh.length === 1 ? `Review #${unit.fresh[0].number}` : `Review ${unit.fresh.length} bottom up`}
                  </button>
                : <span className="hidden shrink-0 text-meta text-fg-3 sm:inline">{unit.needs ? `${unit.needs} wait${unit.needs === 1 ? 's' : ''} on you` : unit.working ? `${unit.working} agent${unit.working === 1 ? '' : 's'} at work` : `${unit.fresh.length} left, bottom up`}</span>}
            {/* where you are in the order, and the way forward */}
            <span className="flex shrink-0 items-center gap-0.5">
              <button onClick={() => prev && onUnit(prev)} disabled={!prev} title="Back (p)" aria-label="Back"
                      className="rounded-lg p-1 text-fg-3 transition-colors hov hover:text-fg-1 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
              <span className="font-mono text-meta tabular-nums text-fg-3">{at + 1}/{order.length}</span>
              <button onClick={() => next && onUnit(next)} disabled={!next} title="Forward (n)"
                      className={`inline-flex items-center gap-0.5 rounded-lg py-1 pl-2 pr-1 text-small font-medium transition-colors disabled:opacity-30 ${done && next ? 'bg-accent text-on-accent hover:bg-accent' : 'text-fg-2 hov hover:text-fg-1'}`}>
                Next<ChevronRight className="size-4" />
              </button>
            </span>
          </div>
          <Brief unit={unit} block={block} onFocus={() => { startFocus(unit.key); toast('Focus: 25 minutes on this topic. The other topics and alerts stay quiet until then') }}
                 onLater={(until, label) => { putOff(unit.key, until); toast(`${label}: it leaves the desk until then`); if (next ?? prev) onUnit((next ?? prev)!) }} />
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1">{children}</div>
          </div>
          <NextBar unit={unit} selected={selected} onSelect={onSelect}
                   onDone={() => { putOff(unit.key, tomorrowMorning()); toast('Done for today: back tomorrow morning'); if (next ?? prev) onUnit((next ?? prev)!) }} />
        </div>
      </section>
    </div>
  )
}

/** A unit waiting at the side: what it is, where its parts stand (a dot each), and whether it needs you. */
function Card({ u, n, on, onOpen }: { u: Unit; n: number; on: boolean; onOpen: () => void }) {
  const K = KIND[u.kind]
  const dots = [...(u.ticket ? [ticketState(u.ticket)] : []), ...u.members.map(prState)]
  const tone = u.needs ? 'text-wait-text' : u.working ? 'text-run-text' : 'text-fg-3'
  // what it waits on you for, by name: the queue says it, so you know before you open it
  const idle = (j?: { state: string }) => !!j && j.state !== 'running' && j.state !== 'queued'
  const asks = (u.ticket && !u.ticket.busy && idle(u.ticket.run) ? askLine(u.ticket.run?.next) : undefined) ?? u.members.map((p) => (idle(p.job) ? askLine(p.job?.next) : undefined)).find(Boolean)
  return (
    <button onClick={onOpen} title={u.title} aria-current={on}
            className={`group relative w-full shrink-0 origin-left rounded-2xl bg-surface-1 p-3 text-left ring-1 transition-all duration-300 ease-[var(--ease-snappy)] ${on
              ? 'shadow-md ring-2 ring-accent/60'
              : ' ring-line [transform:rotateY(16deg)_scale(0.96)] hover:[transform:rotateY(0deg)_scale(1)] focus-visible:[transform:rotateY(0deg)] '}`}>
      <span className="flex items-center gap-1.5 text-small font-semibold text-fg-3">
        <K.icon className="size-3" />{K.label}{u.members.length > 1 ? ` · ${u.members.length}` : ''}
        <span className={`ml-auto font-mono text-micro tabular-nums ${on ? 'text-accent-text' : 'text-fg-3'}`}>{on ? 'on stage · ' : ''}{n}</span>
      </span>
      <span className="mt-1 line-clamp-2 text-small font-medium leading-snug text-fg-1 ">{u.title}</span>
      <span className="mt-2 flex flex-wrap gap-1">{dots.slice(0, 14).map((d, i) => <span key={i} title={d.label} className={`h-1.5 w-3 rounded-full ${d.dot}`} />)}</span>
      <span className={`mt-1.5 block text-meta font-medium ${tone}`}>
        {u.needs && asks ? <span className="line-clamp-2" title={asks}>Asks: {asks}</span> : u.needs ? `${u.needs} wait${u.needs === 1 ? 's' : ''} on you` : u.working ? 'Agent at work' : u.fresh.length ? `${u.fresh.length} to start` : 'Done'}
      </span>
    </button>
  )
}

const prState = (p: PrView) => { const m = statusMeta(p.status, p.mine); return { label: m.label, dot: m.dot, spin: !!m.spin } }
const ticketState = (t: TicketView) => { const g = groupOf(t); return { label: t.busy ? 'Agent at work' : g.title, dot: t.busy ? 'bg-run' : ['needs-you', 'tend'].includes(g.id) ? 'bg-wait' : 'bg-fg-4', spin: t.busy } }

const when = (t?: number) => {
  if (!t) return ''
  const d = new Date(t), today = new Date()
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { weekday: 'short' })
}

/**
 * The topic in two or three sentences (written by a small model from what is known, kept until that changes), with the
 * focus block and Later beside it.
 */
function Brief({ unit, block, onFocus, onLater }: { unit: Unit; block?: { key: string; endsAt: number }; onFocus: () => void; onLater: (until: number, label: string) => void }) {
  const [b, setB] = useState<{ for: string; text?: string; stale?: boolean }>()
  // what the brief depends on: asked again when any part moves
  const facts = [unit.ticket?.id, unit.ticket?.bucket, ...unit.members.map((p) => `${p.id}:${p.status}:${p.awaiting ?? 0}`)].join('|')
  useEffect(() => {
    let live = true
    setB((x) => (x?.for === unit.key ? x : undefined))
    api('/desk/brief', { key: unit.key, ticket: unit.ticket?.id, prs: unit.members.map((p) => p.id) })
      .then((r: { text?: string; stale?: boolean }) => live && setB({ for: unit.key, ...r }), () => live && setB({ for: unit.key }))
    return () => { live = false }
  }, [unit.key, facts]) // eslint-disable-line react-hooks/exhaustive-deps
  const mine = block?.key === unit.key
  const [, tick] = useState(0)
  useEffect(() => { if (!mine) return; const t = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(t) }, [mine])
  const left = mine ? Math.max(1, Math.ceil((block!.endsAt - Date.now()) / 60_000)) : 0
  const quiet = 'inline-flex items-center gap-1 btn-outline btn-sm'
  return (
    <div className="mx-3 mt-2 flex items-start gap-3 rounded-xl bg-accent/5 px-3 py-2 ring-1 ring-accent/15 sm:mx-5 lg:mx-7">
      <Sparkles className={`mt-0.5 size-3.5 shrink-0 text-accent ${b?.for === unit.key && !b.stale ? '' : 'animate-pulse'}`} />
      <p className="min-w-0 flex-1 text-small leading-relaxed text-fg-2">
        {b?.for === unit.key && b.text ? b.text : b?.for === unit.key ? <span className="text-fg-3">No brief for this one yet.</span> : <span className="text-fg-3">Reading up on this topic…</span>}
      </p>
      <span className="flex shrink-0 items-center gap-1.5">
        {mine
          ? <button onClick={stopFocus} title="End the focus block" className={`${quiet} !text-accent-text ring-accent/30`}><Timer className="size-3.5" />{left}m left</button>
          : <button onClick={onFocus} title="25 minutes on this topic only: the other topics fade and alerts stay quiet" className={quiet}><Timer className="size-3.5" />Focus 25m</button>}
        <LaterMenu onLater={onLater} quiet={quiet} />
      </span>
    </div>
  )
}

function LaterMenu({ onLater, quiet }: { onLater: (until: number, label: string) => void; quiet: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} title="Put this topic off" className={quiet}><Clock className="size-3.5" />Later</button>
      {open && (
        <span className="absolute right-0 top-full z-30 mt-1 flex w-40 flex-col rounded-xl bg-surface-1 p-1 text-small shadow-lg ring-1 ring-line" onMouseLeave={() => setOpen(false)}>
          {([['Later today', laterToday], ['Tomorrow', tomorrowMorning]] as const).map(([label, until]) => (
            <button key={label} onClick={() => { setOpen(false); onLater(until(), label) }} className="rounded-lg px-2.5 py-1.5 text-left hover:bg-fg-3/10">{label}</button>
          ))}
        </span>
      )}
    </span>
  )
}


/**
 * The topic's next steps in one bar, most pressing first, across the ticket and every PR: each goes to the part it is
 * about. Done for today puts the topic off until tomorrow and moves on.
 */
function NextBar({ unit, selected, onSelect, onDone }: { unit: Unit; selected: string; onSelect: (id: string) => void; onDone: () => void }) {
  const rank = { wait: 0, fail: 0, run: 2 } as Record<string, number>
  const steps = [
    ...(unit.ticket && ['needs-you', 'tend'].includes(groupOf(unit.ticket).id) ? [{ id: unit.ticket.id, ref: unit.ticket.id, text: groupOf(unit.ticket).id === 'needs-you' ? 'the agent asked you on Linear' : 'red CI or open threads', r: 0 }] : []),
    ...unit.members.map((p) => { const m = statusMeta(p.status, p.mine); return { id: p.id, ref: `#${p.number}`, text: p.flow.why.replace(/\.$/, ''), r: rank[m.kind] ?? 3 } }),
  ].filter((x) => x.r < 3).sort((a, b) => a.r - b.r)
  const [first, ...rest] = steps
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2 sm:px-5 lg:px-7">
      <span className="shrink-0 text-meta font-semibold uppercase tracking-labelr text-fg-3">Next</span>
      {first ? (
        <>
          <button onClick={() => onSelect(first.id)} disabled={first.id === selected} title={first.id === selected ? 'You are on it' : `Go to ${first.ref}`}
                  className="inline-flex min-w-0 items-center gap-1.5 btn-primary btn-sm transition-colors hover:bg-accent disabled:bg-accent/15 disabled:text-accent-text">
            <span className="shrink-0 font-mono">{first.ref}</span><span className="truncate">{first.text}</span>{first.id !== selected && <ArrowRight className="size-3.5 shrink-0" />}
          </button>
          <span className="flex min-w-0 gap-1.5 overflow-hidden">
            {rest.slice(0, 4).map((x) => (
              <button key={x.id} onClick={() => onSelect(x.id)} title={x.text} className={`shrink-0 truncate rounded-lg px-2 py-1 text-meta ring-1 transition-colors ${x.id === selected ? 'text-accent-text ring-accent/40' : 'text-fg-2 ring-line hover:text-fg-1'}`}>
                <span className="font-mono">{x.ref}</span> {x.text.length > 40 ? `${x.text.slice(0, 40)}…` : x.text}
              </button>
            ))}
          </span>
        </>
      ) : <span className="text-small text-fg-3">Nothing waits on you here.</span>}
      <button onClick={onDone} title="Put this topic away until tomorrow morning and go to the next" className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-small font-medium text-fg-3 ring-1 ring-line transition-colors hover:text-fg-1">
        <CircleCheck className="size-3.5" />Done for today
      </button>
    </div>
  )
}
