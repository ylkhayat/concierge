import { Bell, CheckCheck, ChevronUp, CircleAlert, CircleCheck, Hand, Info, X } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import type { Alert, AlertTone } from '../../server/alerts.ts'
import { api } from '../lib.ts'
import { short } from '../time.ts'

const TONE: Record<AlertTone, { text: string; icon: typeof Info; label: string }> = {
  you: { text: 'text-wait', icon: Hand, label: 'needs you' },
  warn: { text: 'text-fail', icon: CircleAlert, label: 'failed' },
  ok: { text: 'text-ok', icon: CircleCheck, label: 'done' },
  info: { text: 'text-accent', icon: Info, label: 'update' },
}
const latest = (a: Alert) => a.updates.at(-1)!
const unseen = (a: Alert) => !a.seen || a.seen < a.at

const urgent = (a: Alert) => latest(a).tone === 'you' || latest(a).tone === 'warn'
const SHOWN = { needs: 6, updates: 4 } // per section before "show all"; enough to act on without a wall of rows

/**
 * One alert: what it is about (the item and its title) and what happened, in full: an agent's question reads as the
 * question. A real button, so it takes focus; Enter opens the item, Delete or the x dismisses it.
 */
function Row({ a, now, onOpen, onDismiss }: { a: Alert; now: number; onOpen: () => void; onDismiss: () => void }) {
  const u = latest(a), t = TONE[u.tone] ?? TONE.info
  return (
    <li className="group/a relative">
      <button onClick={onOpen} data-alert onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDismiss() } }}
              className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors hov focus-visible:bg-fill">
        <t.icon className={`mt-0.5 size-3.5 shrink-0 ${t.text}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 pr-5 text-small">
            <span className="shrink-0 font-mono font-semibold text-fg-1 ">{a.label}</span>
            <span className="min-w-0 flex-1 truncate text-fg-3">{a.title}</span>
            <span className="shrink-0 tabular-nums text-micro text-fg-3">{short(u.at, now)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-small leading-snug text-fg-1 ">{u.text}</span>
        </span>
      </button>
      <button onClick={onDismiss} aria-label={`Dismiss ${a.label}`} tabIndex={-1}
              className="absolute right-1.5 top-1.5 rounded-md p-1 text-fg-3 opacity-0 transition-opacity hover:bg-active hover:text-fg-2 group-hover/a:opacity-100 group-focus-within/a:opacity-100"><X className="size-3" /></button>
    </li>
  )
}

/**
 * What happened, in the ribbon: a pill while something is unseen, which opens a panel of its own (not floating rows):
 * what needs you first, then the updates, each saying what happened in full. Arrow keys move between them, Enter opens
 * one, Delete dismisses it, Esc or a click elsewhere closes the panel.
 */
export function AlertDock({ alerts, now, onOpen }: { alerts: Alert[]; now: number; onOpen: (a: Alert) => void }) {
  const fresh = alerts.filter(unseen).sort((a, b) => b.at.localeCompare(a.at))
  const needs = fresh.filter(urgent), updates = fresh.filter((a) => !urgent(a))
  const [all, setAll] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  if (!fresh.length) return null

  const seen = (keys?: string[]) => void api('/alerts/seen', keys ? { keys } : {}).catch(() => {})
  const close = () => panel.current?.hidePopover()
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-alert]') ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
  }
  const section = (title: string, list: Alert[], max: number, tone: string) => list.length > 0 && (
    <section>
      <h3 className={`px-2.5 pb-1 pt-2 label ${tone}`}>{title} <span className="tabular-nums opacity-70">{list.length}</span></h3>
      <ul>{(all ? list : list.slice(0, max)).map((a) => <Row key={a.key} a={a} now={now} onOpen={() => { seen([a.key]); close(); onOpen(a) }} onDismiss={() => seen([a.key])} />)}</ul>
    </section>
  )
  const hidden = all ? 0 : Math.max(0, needs.length - SHOWN.needs) + Math.max(0, updates.length - SHOWN.updates)
  return (
    <>
      <button popoverTarget="alert-panel" style={{ anchorName: '--alert-panel' } as CSSProperties} title="What happened, and what needs you"
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 text-micro font-medium leading-[18px] text-fg-2 transition-colors hov ">
        <Bell className="size-3 text-fg-3" />
        {needs.length > 0 && <span className="inline-flex items-center gap-1 font-semibold text-wait-text"><span className="size-1.5 animate-pulse rounded-full bg-wait" />{needs.length} need{needs.length === 1 ? 's' : ''} you</span>}
        {needs.length > 0 && updates.length > 0 && <span className="text-fg-4">·</span>}
        {updates.length > 0 && <span className="tabular-nums">{updates.length} update{updates.length === 1 ? '' : 's'}</span>}
        <ChevronUp className="size-3 text-fg-3" />
      </button>
      <div ref={panel} id="alert-panel" popover="auto" onKeyDown={move} onToggle={(e) => {
        if ((e as unknown as ToggleEvent).newState === 'open') panel.current?.querySelector<HTMLButtonElement>('[data-alert]')?.focus()
        else setAll(false)
      }} style={{ positionAnchor: '--alert-panel', positionArea: 'top span-left', inset: 'auto' } as CSSProperties}
           className="m-0 mb-1.5 max-h-[calc(100vh/var(--z)-60px)] w-[min(400px,calc(100vw/var(--z)-24px))] overflow-y-auto overscroll-contain rounded-2xl border-0 bg-surface-1 p-1.5 text-fg-2 shadow-2xl ring-1 ring-line ">
        {section('Needs you', needs, SHOWN.needs, 'text-wait-text')}
        {section('Updates', updates, SHOWN.updates, 'text-fg-3')}
        <div className="mt-1 flex items-center gap-2 border-t border-line px-2.5 pb-1 pt-2 text-meta font-medium ">
          {hidden > 0 && <button onClick={() => setAll(true)} className="rounded-md px-1.5 py-0.5 text-fg-2 hov hover:text-fg-1 ">Show {hidden} more</button>}
          <button onClick={() => { seen(); close() }} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-2 hov hover:text-fg-1 "><CheckCheck className="size-3.5" />Mark all seen</button>
        </div>
      </div>
    </>
  )
}
