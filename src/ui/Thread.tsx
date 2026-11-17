// The parts the new design builds a PR or a ticket from. A thread: a pinned header; the chat (the conversation with its
// next step as the latest message, and the composer) in a column that never moves; and beside it a panel of tabs for
// everything else (its vitals: shipping, intent, understanding; Explain; the description). Switching tabs changes only
// the panel, and a passage selected in it can be quoted into the composer, to ask the agent about that point.
import { ChevronRight, LoaderCircle, MessageSquareQuote, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type Tone = 'ok' | 'wait' | 'fail' | 'run' | 'quiet'
const TONE: Record<Tone, string> = {
  ok: 'bg-ok/12 text-ok', wait: 'bg-wait/14 text-wait', fail: 'bg-fail/12 text-fail', run: 'bg-run/12 text-run', quiet: 'bg-hover text-fg-3',
}
export const toneCls = (t: Tone) => TONE[t]

/** A short status, coloured by what it means. */
export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-meta font-medium ${TONE[tone]}`}>{children}</span>
)

export type PaneTab<Id extends string = string> = {
  id: Id; label: string
  badge?: ReactNode // a count or a status beside the name
  rail?: boolean // a rail of summaries beside the chat: the panel takes about a third
  fill?: boolean // its content scrolls itself (a graph, a column of its own); else the panel scrolls it
}

// how much of the width the chat history takes, by the chat you are in: the conversation reads, Intent weighs both,
// Understanding is mostly Explain. Dragged widths are kept per chat; a double-click on the handle forgets them.
const SPLIT: Record<string, number> = { main: 0.58, 'main:fill': 0.42, 'main:rail': 0.62 } // rail: a supporting pane, about a third
const MIN = 360 // px, for either column
const savedSplits = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem('thread-split') ?? '{}') } catch { return {} } }

export function ThreadLayout<Id extends string>({ header, children, next, composer, follow, tabs, tab, onTab, pane, onAsk, subject, vitals }: {
  subject?: string // the PR or ticket shown: opening another one shows it at once, with nothing animating in
  header: ReactNode
  vitals?: ReactNode // its vitals (shipping, intent, understanding): always in sight, over the panel (narrow: over the chat, smaller)
  children: ReactNode // the conversation
  next?: ReactNode // its latest message: what comes next (under both columns, with the composer)
  composer?: ReactNode // the open chat's box: under both columns
  follow?: unknown // changes as the conversation grows: it stays at the newest unless you scrolled up
  tabs: PaneTab<Id>[]; tab: Id; onTab: (t: Id) => void
  pane: ReactNode // the open tab's content
  onAsk?: (quote: string) => void // a passage selected in the panel, quoted into the composer
}) {
  // another PR or ticket: everything in it simply appears (no fades, no sliding split) for a moment; changes made while
  // it is open (a new message, a filter, a tab) still animate
  const [still, setStill] = useState(true)
  useLayoutEffect(() => { setStill(true); const t = setTimeout(() => setStill(false), 500); return () => clearTimeout(t) }, [subject])
  // narrow: the chat takes the width and the panel slides over it while a tab is open; wide: both, side by side
  const [open, setOpen] = useState(false)
  const pick = (t: Id) => { onTab(t); setOpen(true) }
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]
  const ask = onAsk && ((q: string) => { onAsk(q); setOpen(false) })

  // the split: the body's width, the chat's share of it for the chat you are in, and a handle to drag it
  const body = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // measured before the first paint, so the split starts where it belongs instead of sliding there from 50%
  useLayoutEffect(() => { if (body.current) setWidth(body.current.getBoundingClientRect().width) }, [])
  useEffect(() => {
    const o = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    if (body.current) o.observe(body.current)
    return () => o.disconnect()
  }, [])
  // per chat, and per kind of tab: one that fills the panel (Explain's map) gets the larger share; each kept as dragged
  const key = `main${current.fill ? ':fill' : current.rail ? ':rail' : ''}`
  const [splits, setSplits] = useState(savedSplits)
  const [dragging, setDragging] = useState(false)
  const share = splits[key] ?? SPLIT[key] ?? 0.55
  const px = width ? Math.round(Math.min(Math.max(share * width, MIN), width - MIN)) : undefined
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const left = body.current!.getBoundingClientRect().left
    setDragging(true)
    let last = share
    const move = (m: PointerEvent) => { last = Math.min(Math.max((m.clientX - left) / width, MIN / width), 1 - MIN / width); setSplits((x) => ({ ...x, [key]: last })) }
    const up = () => {
      setDragging(false); removeEventListener('pointermove', move); removeEventListener('pointerup', up)
      try { localStorage.setItem('thread-split', JSON.stringify({ ...savedSplits(), [key]: last })) } catch { /* private window */ }
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  // the bottom row: the box under the chat, the next step under the panel; with no box the next step takes the chat's place
  const nextShown = next || undefined
  const left = composer || nextShown, under = composer ? nextShown : undefined
  const reset = () => { const { [key]: _, ...rest } = savedSplits(); setSplits(rest); try { localStorage.setItem('thread-split', JSON.stringify(rest)) } catch { /* private window */ } }

  return (
    <div data-still={still ? '' : undefined} className="@container/thread flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line">{header}</div>
      {/* narrow: the vitals in a slim row, then the tabs above the chat; picking one opens the panel over it */}
      {vitals && <div className="relative z-30 shrink-0 border-b border-line @[1100px]/thread:hidden">{vitals}</div>}
      <div className="shrink-0 border-b border-line px-3 @[1100px]/thread:hidden sm:px-5">
        <TabBar tabs={tabs} tab={open ? tab : undefined} onTab={pick} chat onChat={() => setOpen(false)} />
      </div>
      {/* wide: a grid, the chat and the panel side by side and under each its own part of the bottom row (the box under
          the chat, the next step under the panel); the panel runs to the bottom when nothing sits under it. Narrow: one
          column, the panel over the chat while a tab is open, the bottom row stacked */}
      <div ref={body} style={{ '--split': px ? `${px}px` : '50%' } as React.CSSProperties}
           className={`relative flex min-h-0 flex-1 flex-col @[1100px]/thread:grid @[1100px]/thread:[grid-template-columns:var(--split)_1px_minmax(0,1fr)] @[1100px]/thread:[grid-template-rows:minmax(0,1fr)_auto] ${dragging ? '' : 'transition-[grid-template-columns] duration-300 ease-[var(--ease-snappy)]'}`}>
        {/* the chat's own column, top to bottom: the conversation, then its box on the floor. One piece, so the height of
            what sits under the panel (the next step can be tall) never pushes the box up or takes room from the chat */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col @[1100px]/thread:col-start-1 @[1100px]/thread:row-span-2 @[1100px]/thread:row-start-1">
          <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Transcript follow={follow}>{children}</Transcript>
          </section>
          {/* its box, or (no box: the agent asks) the next step: at most about half the height, scrolling inside */}
          {left && <div className="flex max-h-[min(46vh,560px)] min-h-0 shrink-0 flex-col justify-end border-t border-line bg-bg-app px-3 pb-3 pt-2 sm:px-5 sm:pb-4">{left}</div>}
        </div>
        {/* the handle between the two: drag to share the width, double-click to go back to this chat's own split */}
        <div role="separator" aria-orientation="vertical" aria-label="Resize the chat and the panel" title="Drag to resize · double-click to reset"
             onPointerDown={drag} onDoubleClick={reset}
             className={`group relative hidden w-px cursor-col-resize bg-line @[1100px]/thread:col-start-2 @[1100px]/thread:row-span-2 @[1100px]/thread:row-start-1 @[1100px]/thread:block ${dragging ? 'bg-accent' : ''}`}>
          <span className="absolute inset-y-0 -left-1.5 -right-1.5 group-hover:bg-accent/20" />
        </div>
        <section aria-label={current.label} className={`${open ? 'flex' : 'hidden'} absolute inset-0 z-20 min-h-0 min-w-0 flex-col bg-bg-app @[1100px]/thread:static @[1100px]/thread:z-auto @[1100px]/thread:col-start-3 @[1100px]/thread:row-start-1 @[1100px]/thread:flex @[1100px]/thread:bg-surface-2/40 ${under ? '' : '@[1100px]/thread:row-span-2'}`}>
          {vitals && <div className="relative z-30 hidden shrink-0 border-b border-line @[1100px]/thread:block">{vitals}</div>}
          <div className="hidden shrink-0 border-b border-line px-4 @[1100px]/thread:block"><TabBar tabs={tabs} tab={tab} onTab={onTab} /></div>
          <Quotable onAsk={ask} fill={current.fill} key={current.id}>{pane}</Quotable>
        </section>
                {/* under the panel: the next step, beside the box */}
        {under && <div className="flex max-h-[min(46vh,560px)] min-h-0 shrink-0 flex-col justify-end border-t border-line bg-bg-app px-3 pb-3 pt-2 sm:px-4 sm:pb-4 @[1100px]/thread:col-start-3 @[1100px]/thread:row-start-2">{under}</div>}
      </div>
    </div>
  )
}

/** The panel's tabs; narrow, "Chat" first, which closes the panel. */
function TabBar<Id extends string>({ tabs, tab, onTab, chat, onChat }: { tabs: PaneTab<Id>[]; tab?: Id; onTab: (t: Id) => void; chat?: boolean; onChat?: () => void }) {
  const cls = (on: boolean) => `flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-small font-medium transition-colors duration-150 ${on ? 'border-accent text-fg-1' : 'border-transparent text-fg-3 hover:text-fg-1'}`
  return (
    <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
      {chat && <button role="tab" aria-selected={tab === undefined} onClick={onChat} className={cls(tab === undefined)}>Chat</button>}
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)} className={cls(tab === t.id)}>{t.label}{t.badge}</button>
      ))}
    </div>
  )
}

/** The open tab's content, faded in; select a passage in it and a button quotes it into the composer. */
function Quotable({ children, onAsk, fill }: { children: ReactNode; onAsk?: (q: string) => void; fill?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<{ text: string; top: number; left: number }>()
  const read = () => {
    const s = getSelection(), el = ref.current
    const text = s && !s.isCollapsed ? s.toString().trim() : ''
    if (!onAsk || !el || !text || !s!.rangeCount || !el.contains(s!.anchorNode)) return setSel(undefined)
    const r = s!.getRangeAt(0).getBoundingClientRect(), box = el.getBoundingClientRect()
    setSel({ text: text.slice(0, 1200), top: r.bottom - box.top + 6, left: Math.min(Math.max(r.left - box.left, 8), box.width - 200) })
  }
  const quote = () => {
    onAsk!(`${sel!.text.split('\n').map((l) => `> ${l}`).join('\n')}\n\n`)
    getSelection()?.removeAllRanges(); setSel(undefined)
    requestAnimationFrame(() => (document.querySelector('textarea[data-composer]') as HTMLTextAreaElement | null)?.focus())
  }
  return (
    <div ref={ref} onMouseUp={read} onKeyUp={read} className={`relative min-h-0 flex-1 animate-[detail-in_180ms_var(--ease-snappy)] ${fill ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
      {children}
      {sel && (
        <button onMouseDown={(e) => e.preventDefault()} onClick={quote} style={{ top: sel.top, left: sel.left }}
                className="absolute z-30 flex items-center gap-1.5 btn-primary btn-sm shadow-[var(--e3)]">
          <MessageSquareQuote aria-hidden className="size-3.5" />Ask the agent about this
        </button>
      )}
    </div>
  )
}

/** The scrolling conversation: oldest at the top, following what arrives while you are at the bottom. */
function Transcript({ children, follow }: { children: ReactNode; follow?: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const onScroll = () => { const el = ref.current!; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
  const end = () => { const el = ref.current; if (el && pinned.current) el.scrollTop = el.scrollHeight }
  useLayoutEffect(end, [follow])
  // what renders late (markdown, a folded chapter opening) grows it after the fact: still at the newest, it follows
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const o = new ResizeObserver(end)
    if (inner.current) o.observe(inner.current)
    return () => o.disconnect()
  }, [])
  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div ref={inner} className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-3 py-5 sm:px-5">{children}</div>
    </div>
  )
}

/** What it is, where it stands, and what it is linked to; its tools sit top right. */
export function ThreadHeader({ crumb, title, status, meta, links, nav, actions, back }: {
  crumb: ReactNode; title: string; status?: ReactNode; meta?: ReactNode; links?: ReactNode; nav?: ReactNode; actions?: ReactNode; back?: ReactNode
}) {
  return (
    <header className="space-y-2 px-3 pb-3 pt-3 sm:px-5 sm:pt-4 lg:px-7">
      {back}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-fg-3">{crumb}</div>
          <h1 className="mt-0.5 text-title font-semibold tracking-tight text-fg-1 [overflow-wrap:anywhere]">{title}</h1>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {status && <div className="flex flex-wrap items-center gap-2">{status}</div>}
      {meta && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
      {(links || nav) && <div className="flex flex-wrap items-center gap-2">{links}{nav}</div>}
    </header>
  )
}

/**
 * The next step, docked under the panel: its headline, why, the action, and everything else you could do instead, all
 * in sight (nothing folded, nothing behind a click); it scrolls within the dock's height when it is long.
 */
export function NextCard({ title, why, details, detailsLabel, actions, also, more, icon: Icon, tone = 'run' }: {
  title: string; why?: ReactNode; details?: ReactNode; detailsLabel?: string; actions?: ReactNode; also?: ReactNode; more?: ReactNode
  icon: LucideIcon; tone?: Tone
}) {
  return (
    <section aria-label="Next step" className="flex max-h-full min-h-0 flex-col overflow-y-auto rounded-card bg-surface-1 shadow-[var(--e1),0_16px_40px_-24px_rgb(0_0_0/0.45)]">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3">
        <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-ctl ${TONE[tone]}`}><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block label text-fg-4">Next</span>
          <span className="block truncate text-body font-semibold text-fg-1">{title}</span>
        </span>
      </div>
      {why && <div className="px-4 pt-2 text-small leading-relaxed text-fg-2">{why}</div>}
      {details && <div className="px-4 pt-2"><p className="label mb-1 text-fg-4">{detailsLabel ?? 'Details'}</p>{details}</div>}
      <div className="space-y-2 px-4 pb-3 pt-3">{actions}{also}{more}</div>
    </section>
  )
}

/**
 * While the agent works: one line under the chat (what it is doing, what runs in the background, Stop), its details
 * unfolded only when you ask. The conversation already shows the work as it happens.
 */
export function WorkingBar({ title, sub, stop, children }: { title: string; sub?: ReactNode; stop?: () => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="The agent is working" className="flex max-h-full min-h-0 flex-col card">
      <div className="flex shrink-0 items-center gap-3 px-4 py-2">
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-run" />
        <span className="min-w-0 flex-1 truncate text-small"><span className="font-semibold text-fg-1">{title}</span>{sub && <span className="text-fg-3"> · {sub}</span>}</span>
        {stop && <button onClick={stop} className="rounded-lg px-2.5 py-1 text-small font-medium text-fg-2 hov hover:text-fail">Stop</button>}
        {children && (
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide the details' : 'Show the details'} className="rounded-lg p-1 text-fg-3 hov hover:text-fg-1">
            <ChevronRight className={`size-4 transition-transform duration-200 ${open ? 'rotate-90' : '-rotate-90'}`} />
          </button>
        )}
      </div>
      {open && children && <div className="min-h-0 overflow-y-auto border-t border-line px-4 py-3">{children}</div>}
    </section>
  )
}

/** The composer's frame: the box to steer the agent, docked under the conversation. */
export const Composer = ({ children }: { children: ReactNode }) => (
  <div className="max-h-[45vh] overflow-y-auto rounded-2xl bg-surface-1 p-3 shadow-[var(--e1),0_12px_40px_-16px_rgb(0_0_0/0.35)]">{children}</div>
)
