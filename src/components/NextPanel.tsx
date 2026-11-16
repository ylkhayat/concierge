import { ChevronDown, ChevronsLeft, ChevronsRight, Maximize2, Minimize2, RefreshCw, Wrench, type LucideIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** How fresh the data behind the panel is: when it last synced, whether a sync runs now, and a way to sync. */
export type Sync = { at?: string; syncing: boolean; onSync: () => void }
import { param, setParam, useReading } from '../lib.ts'
import { ago, stamp } from '../time.ts'

/**
 * Everything pending on a PR or ticket, in one place on the right: the next step, what the agent asks, and a box
 * to steer it. The middle keeps the work (Activity, Explain). Collapses to a strip with a count; kept in the URL.
 */
export function NextPanel({ count, children, footer, sync }: { count: number; children: ReactNode; footer?: ReactNode; sync?: Sync }) {
  // closed (a strip), normal or wide; and whether the actions list is folded: all kept in the URL
  // on a narrow screen it starts folded, and opens over the page (a drawer) instead of squeezing it
  const narrow = useNarrow(), phone = usePhone()
  const [mode, setModeState] = useState<'open' | 'closed' | 'wide'>(() => (param('panel') as 'closed' | 'wide') ?? (matchMedia('(max-width: 1179px)').matches ? 'closed' : 'open'))
  const setMode = (m: 'open' | 'closed' | 'wide') => { setModeState(m); setParam('panel', m === 'open' ? null : m) }
  // focus mode folds the panel to its strip; clicking the strip opens it for a look without leaving focus
  const reading = useReading()
  const [peek, setPeek] = useState(false)
  useEffect(() => { if (!reading) setPeek(false) }, [reading])
  const open = mode !== 'closed' && (!reading || peek)
  const setOpen = (v: boolean) => (reading && mode !== 'closed' ? setPeek(v) : setMode(v ? 'open' : 'closed'))
  // folded by default: the next step comes first; every action is one click away
  const [actions, setActionsState] = useState(() => param('actions') === 'open')
  const setActions = (v: boolean) => { setActionsState(v); setParam('actions', v ? 'open' : null) }
  if (!open && (phone || narrow)) {
    // no room for a strip: a button floating above the tab bar (a phone) or the status bar
    return (
      <button onClick={() => setOpen(true)} aria-label="Show the Next panel"
              className={`fixed ${phone ? 'bottom-[calc(70px+env(safe-area-inset-bottom))]' : 'bottom-10'} right-4 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-body font-semibold text-on-accent transition-transform active:scale-95`}>
        Next{count > 0 && <span className="rounded-full bg-white/25 px-1.5 text-meta tabular-nums leading-4">{count}</span>}
      </button>
    )
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Show what is next" aria-label="Show the Next panel"
              className="group flex w-11 shrink-0 flex-col items-center gap-2 border-l border-line bg-white/40 py-4 text-fg-3 transition-colors hover:bg-surface-1 hover:text-fg-1 dark:bg-zinc-900/20">
        <ChevronsLeft className="size-4" />
        <span className="text-meta font-semibold uppercase tracking-labelr [writing-mode:vertical-rl]">Next</span>
        {count > 0 && <span className="rounded-full bg-accent px-1.5 text-micro font-semibold tabular-nums leading-4 text-on-accent">{count}</span>}
      </button>
    )
  }
  return (
    <>
    {narrow && <button aria-label="Close the Next panel" onClick={() => setOpen(false)} className="fixed inset-0 z-30 animate-[fade-in_200ms] bg-black/30 backdrop-blur-[2px]" />}
    <aside aria-label="Next" className={`flex shrink-0 flex-col border-l border-line transition-[width] duration-300 ease-[var(--ease-snappy)] ${phone
      // a sheet from the bottom, the page dimmed behind it
      ? 'fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] animate-[sheet-in_280ms_var(--ease-snappy)] rounded-t-3xl border-l-0 bg-surface-1 pb-[env(safe-area-inset-bottom)] shadow-2xl'
      : narrow
      ? 'fixed inset-y-0 right-0 z-40 w-[min(400px,calc(100vw/var(--z)-24px))] animate-[drawer-in_260ms_var(--ease-snappy)] bg-surface-1 shadow-2xl'
      : `bg-surface-1 ${mode === 'wide' ? 'w-[min(600px,calc(45vw/var(--z)))]' : 'w-[340px] 2xl:w-[380px]'}`}`}>
      {phone && <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-fill-strong" />}
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
        <h2 className="text-body font-semibold text-fg-1">Next</h2>
        {count > 0 && <span className="rounded-full bg-accent px-1.5 text-micro font-semibold tabular-nums leading-4 text-on-accent">{count}</span>}
        {!phone && <button onClick={() => setMode(mode === 'wide' ? 'open' : 'wide')} title={mode === 'wide' ? 'Narrower' : 'Wider'} aria-label={mode === 'wide' ? 'Make the panel narrower' : 'Make the panel wider'}
                className="ml-auto rounded-lg p-1 text-fg-3 transition-colors hov hover:text-fg-2">{mode === 'wide' ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>}
        <button onClick={() => setOpen(false)} title="Hide" aria-label="Hide the Next panel" className="rounded-lg p-1 text-fg-3 transition-colors hov hover:text-fg-2"><ChevronsRight className="size-4" /></button>
      </header>
      {sync && <Freshness sync={sync} />}
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 pb-4">{children}</div>
      {/* every action there is, always at the bottom */}
      {footer && (
        <div className={`flex shrink-0 flex-col border-t border-line ${actions ? 'max-h-[50%]' : ''}`}>
          <button onClick={() => setActions(!actions)} aria-expanded={actions}
                  className="flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-small font-medium text-fg-3 transition-colors hover:text-fg-1">
            <Wrench className="size-3.5 text-fg-3" />All actions<ChevronDown className={`ml-auto size-3.5 transition-transform duration-200 ${actions ? '' : '-rotate-90'}`} />
          </button>
          {actions && <div className="min-h-0 overflow-y-auto px-4 pb-3">{footer}</div>}
        </div>
      )}
    </aside>
    </>
  )
}

/** A phone (narrower than 768px): the panel becomes a sheet from the bottom. */
export function usePhone() {
  const q = '(max-width: 767px)'
  const [n, setN] = useState(() => matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return n
}

/** Narrower than 1180px: the panel becomes a drawer. */
function useNarrow() {
  const q = '(max-width: 1179px)'
  const [n, setN] = useState(() => matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return n
}

/** Off inside a card that already says what its section is (the new design's next step). */
export const SectionHeadings = createContext(true)

export function PanelSection({ title, icon: Icon, tone = 'text-fg-3', children }: { title: string; icon: LucideIcon; tone?: string; children: ReactNode }) {
  const headings = useContext(SectionHeadings)
  return (
    <section className="space-y-2.5">
      {headings && <h3 className="flex items-center gap-1.5 text-small font-medium text-fg-3"><Icon className={`size-3.5 ${tone}`} />{title}</h3>}
      {children}
    </section>
  )
}

const STALE = 5 * 60_000 // older than this, the panel says so before you act on it

/** "Synced 3 minutes ago", re-read every 15s; amber once stale; "Syncing…" while GitHub and Linear are read again. */
export function Freshness({ sync }: { sync: Sync }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t) }, [])
  const at = sync.at ? new Date(sync.at) : undefined
  const stale = !sync.syncing && (!at || now - at.getTime() > STALE)
  const text = sync.syncing ? 'Syncing…' : at ? `Synced ${ago(at.toISOString(), now)}` : 'Not synced yet'
  return (
    <div className={`mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-meta transition-colors ${stale ? 'bg-wait/8 text-wait-text ring-1 ring-wait/20' : 'text-fg-3'}`}
         title={at ? stamp(at) : undefined}>
      {sync.syncing ? <span className="size-1.5 animate-pulse rounded-full bg-run" /> : <span className={`size-1.5 rounded-full ${stale ? 'bg-wait' : 'bg-ok'}`} />}
      <span className="min-w-0 flex-1 truncate">{text}{stale && at ? '. Sync before acting on it.' : ''}</span>
      <button onClick={sync.onSync} disabled={sync.syncing} aria-label="Sync now" title="Sync now"
              className="rounded-md p-0.5 transition-colors hover:bg-hover hover:text-fg-1 disabled:opacity-50">
        <RefreshCw className={`size-3.5 ${sync.syncing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}
