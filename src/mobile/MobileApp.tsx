import {
  Activity as ActivityIcon, ArrowUpRight, BookOpen, Bot, CheckCheck, ChevronDown, ChevronRight, GitPullRequest, LoaderCircle,
  MessagesSquare, Moon, MoreHorizontal, Play, RefreshCw, Monitor, Sparkles, Square, Sun, Ticket as TicketIcon, Zap,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Toaster, toast as sonner } from 'sonner'
import type { Overlay } from '../../server/explain.ts'
import type { RunEvent } from '../../server/lifecycle.ts'
import { ago, api, critUrl, enc, useDeck, useNow, useTheme, type Activity, type PrView, type TicketView } from '../lib.ts'
import { useArm } from '../arm.tsx'
import { groupOf, GROUPS } from '../components/ExecList.tsx'
import { waiting } from '../components/PrList.tsx'
import { Read, readingList } from '../components/Read.tsx'
import type { Rules } from '../desk.ts'
import { statusMeta } from '../components/StatusBadge.tsx'
import { Md } from '../components/Md.tsx'
import { NextSteps } from '../components/NextSteps.tsx'
import { Tour } from '../components/Tour.tsx'
import { Answer, Step } from '../components/Focus.tsx'
import { plain } from '../components/ActivityFeed.tsx'
import { Sheet } from './Sheet.tsx'
import { ShippingVital, useLaneActions, Vitals } from '../thread/Vitals.tsx'
import { useDiscussions } from '../thread/Discussion.tsx'
import { List as BackgroundList, useBackground } from '../components/Background.tsx'

type Tab = 'tickets' | 'prs' | 'read' | 'agents'
type Open = { kind: 'pr' | 'ticket'; id: string }
const kept = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d } catch { return d } }
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }
const RULES: Rules = { waiting, ticketGroup: (t) => groupOf(t).id }
const busyPr = (p: PrView) => p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'

/**
 * Concierge on a phone: its own app, not the desktop one squeezed. Four tabs, Tickets (by team and repo), PRs
 * (to review and yours), Read (the explanations, one PR after another) and Agents (what they are doing and what they did); a tap opens a bottom sheet with what
 * it is, what it waits on and the one step to take; explanations read in a sheet of their own. The page scrolls
 * like any page; swipe sideways between tabs.
 */
export function MobileApp() {
  const [tab, setTabState] = useState<Tab>(() => kept('m-tab', 'tickets'))
  const setTab = (t: Tab) => { setTabState(t); keep('m-tab', t); scrollTo({ top: 0 }) }
  const [open, setOpen] = useState<Open>()
  const [tour, setTour] = useState<string>()
  const [reading, setReading] = useState<string>() // Read: the PR whose explanation is open
  const [menu, setMenu] = useState(false)
  const { me, prs, exec, alerts, health, feed } = useDeck(open?.kind === 'pr' ? open.id : open?.kind === 'ticket' ? `ticket:${open.id}` : undefined)
  const now = useNow()
  const tickets = exec?.tickets ?? []
  const toast = (m: string, tone: 'ok' | 'error' = 'ok') => (tone === 'ok' ? sonner.success(m) : sonner.error(m))

  // swipe sideways between the tabs (not inside a row of chips, and only a clearly sideways swipe)
  const main = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = main.current!
    let t0: { x: number; y: number } | undefined
    const start = (e: TouchEvent) => { t0 = (e.target as HTMLElement).closest('[data-noswipe]') ? undefined : { x: e.touches[0].clientX, y: e.touches[0].clientY } }
    const end = (e: TouchEvent) => {
      if (!t0) return
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y
      t0 = undefined
      if (Math.abs(dx) < 80 || Math.abs(dx) < 2.2 * Math.abs(dy)) return
      const order: Tab[] = ['tickets', 'prs', 'read', 'agents']
      const n = order[order.indexOf(tab) + (dx < 0 ? 1 : -1)]
      if (n) setTab(n)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end)
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchend', end) }
  })

  const pr = open?.kind === 'pr' ? prs?.find((p) => p.id === open.id) : undefined
  const ticket = open?.kind === 'ticket' ? tickets.find((t) => t.id === open.id) : undefined
  const tourPr = tour ? prs?.find((p) => p.id === tour) : undefined
  const ticketsWaiting = tickets.filter((t) => ['needs-you', 'tend'].includes(groupOf(t).id)).length
  const prsWaiting = (prs ?? []).filter((p) => !p.closed && (waiting(p) || p.flow.state === 'asks')).length
  const toRead = prs ? readingList(prs, tickets, RULES).flatMap((g) => g.prs).filter(waiting).length : 0
  const working = (prs ?? []).filter(busyPr).length + tickets.filter((t) => t.busy).length

  return (
    <div className="min-h-dvh bg-fill/60 pb-[calc(68px+env(safe-area-inset-bottom))] text-fg-1 antialiased ">
      <div ref={main}>
        {!prs ? <div className="flex h-dvh items-center justify-center"><LoaderCircle className="size-6 animate-spin text-fg-3" /></div>
          : tab === 'tickets' ? <Tickets tickets={tickets} now={now} onOpen={(id) => setOpen({ kind: 'ticket', id })} onMenu={() => setMenu(true)} machine={me?.machine} />
          : tab === 'prs' ? <Prs prs={prs} now={now} onOpen={(id) => setOpen({ kind: 'pr', id })} onMenu={() => setMenu(true)} machine={me?.machine} />
          // the explanations, one PR after another (the desktop's Read): the list scrolls as a page like the other tabs;
          // a tour fills the screen down to the tabs (pinned to them: a height from 100dvh is off on an iPhone; a grid row, as
          // pinning alone gives the tour no height to fill and it would grow past the screen instead of scrolling)
          : tab === 'read' ? <div data-noswipe={reading ? '' : undefined} className={reading ? 'fixed inset-x-0 top-0 z-30 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-fill/60 pt-[env(safe-area-inset-top)] bottom-[calc(61px+env(safe-area-inset-bottom))]' : ''}><Read prs={prs} tickets={tickets} rules={RULES} selected={reading} onSelect={setReading} toast={toast} /></div>
          : <Agents prs={prs} tickets={tickets} alerts={alerts} now={now} onOpen={setOpen} onMenu={() => setMenu(true)} machine={me?.machine} />}
      </div>

      {/* the tabs: thumb height, clear of the home bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl dark:bg-zinc-950/85">
        {([['tickets', TicketIcon, 'Tickets', ticketsWaiting], ['prs', GitPullRequest, 'Pull requests', prsWaiting], ['read', BookOpen, 'Read', toRead], ['agents', Bot, 'Agents', working]] as const).map(([k, Icon, label, n]) => (
          <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className="group relative flex h-[60px] items-center justify-center">
            <span className={`flex h-[52px] w-[72px] flex-col items-center justify-center gap-0.5 rounded-card transition-[background-color,color,scale] duration-200 group-active:scale-95 ${tab === k ? 'bg-accent/12 text-accent-text' : 'text-fg-3'}`}>
            <span className="relative flex h-7 items-center justify-center">
              <Icon className="size-[22px]" />
              {n > 0 && <span className={`absolute -right-3.5 -top-1 min-w-[18px] rounded-full px-1 text-center text-micro font-bold leading-[18px] text-white ring-2 ring-white dark:ring-zinc-950 ${k === 'agents' ? 'bg-run' : 'bg-wait'}`}>{n}</span>}
            </span>
            <span className="text-micro font-semibold">{label === 'Pull requests' ? 'PRs' : label}</span>
            </span>
          </button>
        ))}
      </nav>

      {pr && <PrSheet key={pr.id} pr={pr} feed={feed} now={now} toast={toast} onClose={() => setOpen(undefined)} onTour={() => setTour(pr.id)} onTicket={(id) => setOpen({ kind: 'ticket', id })} />}
      {ticket && <TicketSheet key={ticket.id} t={ticket} prs={prs ?? []} feed={feed} now={now} toast={toast} onClose={() => setOpen(undefined)} onPr={(id) => setOpen({ kind: 'pr', id })} />}
      {tourPr && <TourSheet pr={tourPr} prs={prs ?? []} toast={toast} onClose={() => setTour(undefined)} />}
      {menu && <Menu health={health} toast={toast} onClose={() => setMenu(false)} />}
      <Toaster position="top-center" theme="system" offset={56} toastOptions={{ className: 'font-sans' }} />
    </div>
  )
}

// --- the shared pieces ------------------------------------------------------------------------------------------------

/** A tab's head: its title (large, folding into a slim glass bar as the page scrolls), what it holds, and its filters. */
function Head({ title, sub, onMenu, machine, children }: { title: string; sub: string; onMenu: () => void; machine?: string; children?: ReactNode }) {
  const [slim, setSlim] = useState(() => scrollY > 36)
  useEffect(() => { const f = () => setSlim(scrollY > 36); addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f) }, [])
  return (
    <header className={`sticky top-0 z-20 pt-[env(safe-area-inset-top)] backdrop-blur-xl transition-[background-color,box-shadow] duration-200 ${slim ? 'bg-fill/80 shadow-[0_1px_0_rgb(0_0_0/0.06)] dark:shadow-[0_1px_0_rgb(255_255_255/0.06)]' : 'bg-fill/60'}`}>
      <div className={`flex items-center gap-3 px-5 transition-[padding] duration-200 ${slim ? 'pb-1.5 pt-1.5' : 'pb-2 pt-3'}`}>
        <div className="min-w-0 flex-1">
          <h1 className={`origin-left truncate font-bold leading-tight tracking-tight transition-[font-size] duration-200 ease-[var(--ease-out)] ${slim ? 'text-title' : 'text-display'}`}>{title}</h1>
          {!slim && <p className="truncate text-body text-fg-3">{sub}{machine && <span className="text-fg-3"> · on {machine[0].toUpperCase() + machine.slice(1)}</span>}</p>}
        </div>
        <button onClick={onMenu} aria-label="More" className={`flex shrink-0 items-center justify-center rounded-full text-fg-2 transition-all active:scale-90 ${slim ? 'size-8' : 'size-10 bg-surface-1 shadow-sm ring-1 ring-line '}`}><MoreHorizontal className="size-5" /></button>
      </div>
      {children}
    </header>
  )
}

type ChipGroup = { value: string; options: { id: string; label: string; n?: number }[]; onChange: (v: string) => void }
/** One row of choices that scrolls sideways under the title, several groups divided by a hairline (the only sideways
 *  scroll, so swipes there stay in it). */
function Chips({ groups }: { groups: ChipGroup[] }) {
  const shown = groups.filter((g) => g.options.length > 2)
  if (!shown.length) return null
  return (
    <div data-noswipe className="-mt-1 flex items-center gap-1.5 overflow-x-auto px-5 pb-2.5 pt-1 [mask-image:linear-gradient(90deg,#000_90%,transparent)] [scrollbar-width:none]">
      {shown.map((g, gi) => [
        gi > 0 && <span key={`d${gi}`} aria-hidden className="mx-1 h-5 w-px shrink-0 bg-fill-strong" />,
        ...g.options.map((o) => (
          <button key={`${gi}:${o.id}`} onClick={() => g.onChange(o.id)} aria-pressed={g.value === o.id}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-body font-medium transition-[background-color,color,scale] duration-150 active:scale-95 ${g.value === o.id ? 'sel text-fg-1' : 'bg-surface-1 text-fg-2 ring-1 ring-line '}`}>
            {o.label}{o.n !== undefined && <span className="tabular-nums opacity-55">{o.n}</span>}
          </button>
        )),
      ])}
    </div>
  )
}

/** A group in a list: its title and count, folded when it is the kind you rarely need. */
function Section({ title, dot, n, folded, children }: { title: string; dot?: string; n: number; folded?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!folded)
  if (!n) return null
  return (
    <section className="px-4 pt-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-1 pb-2 text-left">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        <h2 className="text-reading font-semibold text-fg-2 ">{title}</h2>
        <span className="text-body tabular-nums text-fg-3">{n}</span>
        <ChevronDown className={`ml-auto size-4 text-fg-3 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <ol className="overflow-hidden card ">{children}</ol>}
    </section>
  )
}

function Row({ onClick, dot, top, title, meta, right }: { onClick: () => void; dot: string; top: ReactNode; title: string; meta?: ReactNode; right?: ReactNode }) {
  return (
    <li className="border-b border-line last:border-0 ">
      <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-hover">
        <span className={`size-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-small text-fg-3">{top}</span>
          <span className="mt-0.5 line-clamp-2 text-reading font-medium leading-snug">{title}</span>
          {meta && <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-fg-3">{meta}</span>}
        </span>
        {right}
        <ChevronRight className="size-4 shrink-0 text-fg-4" />
      </button>
    </li>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="px-8 py-16 text-center text-reading text-fg-3">{children}</p>

// --- Tickets: by team and repo ---------------------------------------------------------------------------------------

function Tickets({ tickets: all, now, onOpen, onMenu, machine }: { tickets: TicketView[]; now: number; onOpen: (id: string) => void; onMenu: () => void; machine?: string }) {
  const tickets = all.filter((t) => t.bucket !== 'closed') // kept only so what names them still opens
  const teams = [...new Set(tickets.map((t) => t.team))].sort()
  const [team, setTeamState] = useState<string>(() => kept('m-team', 'all'))
  const setTeam = (v: string) => { setTeamState(v); keep('m-team', v); setRepo('all') }
  const inTeam = team === 'all' ? tickets : tickets.filter((t) => t.team === team)
  const repos = [...new Set(inTeam.map((t) => t.repo).filter((r): r is string => !!r))].sort()
  const [repo, setRepo] = useState('all')
  const list = repo === 'all' ? inTeam : inTeam.filter((t) => t.repo === repo)
  const asks = list.filter((t) => groupOf(t).id === 'needs-you').length
  return (
    <>
      <Head machine={machine} title="Tickets" sub={`${list.length} ticket${list.length === 1 ? '' : 's'}${asks ? ` · ${asks} waiting on you` : ''}`} onMenu={onMenu}>
        <Chips groups={[
          { value: team, onChange: setTeam, options: [{ id: 'all', label: 'All teams', n: tickets.length }, ...teams.map((x) => ({ id: x, label: x, n: tickets.filter((t) => t.team === x).length }))] },
          { value: repo, onChange: setRepo, options: [{ id: 'all', label: 'Every repo' }, ...repos.map((r) => ({ id: r, label: r.split('/')[1] ?? r, n: inTeam.filter((t) => t.repo === r).length }))] },
        ]} />
      </Head>
      {!list.length && <Empty>No tickets here.</Empty>}
      {GROUPS.map((g) => {
        const rows = list.filter((t) => groupOf(t).id === g.id)
        return (
          <Section key={g.id} title={g.title} dot={g.dot} n={rows.length} folded={['backlog', 'shipped', 'triage', 'handed'].includes(g.id)}>
            {rows.map((t) => (
              <Row key={t.id} onClick={() => onOpen(t.id)} dot={g.dot ?? 'bg-fg-4'}
                   top={<><span className="font-mono font-medium">{t.id}</span>{t.repo && <span>{t.repo.split('/')[1]}</span>}</>}
                   title={t.title}
                   meta={<>{t.queued ? <span>Queued · {t.queued.why}</span> : t.busy ? <span className="text-run-text">agent at work{t.run?.phase ? ` · ${t.run.phase}` : ''}</span> : <span>{t.state}</span>}
                     {t.prs.length > 0 && <span>{t.prs.length} PR{t.prs.length === 1 ? '' : 's'}</span>}<span>{ago(t.updatedAt, now)}</span></>} />
            ))}
          </Section>
        )
      })}
    </>
  )
}

function TicketSheet({ t, prs, feed, now, toast, onClose, onPr }: { t: TicketView; prs: PrView[]; feed: Activity[]; now: number; toast: (m: string, tone?: 'ok' | 'error') => void; onClose: () => void; onPr: (id: string) => void }) {
  const g = groupOf(t)
  const run = t.run
  const { armed, arm } = useArm()
  const start = () => arm('run', () => api('/exec', { ids: [t.id] }).then(() => toast(`Running ${t.id}`), (e: Error) => toast(e.message, 'error')))
  const stop = () => run && api(`/exec/${run.id}/cancel`, {}).then(() => toast('Stopped'), (e: Error) => toast(e.message, 'error'))
  const linked = t.prs.map((x) => prs.find((p) => p.id === `${x.repo}#${x.number}`) ?? x)
  const asksOnLinear = g.id === 'needs-you' && t.lastComment
  // its vitals: where shipping stands, and Intent and Understanding, a tap each (a tap on one not assessed starts it)
  const target = `ticket:${t.id}`, talks = useDiscussions(target)
  const steerMain = (text: string) => api(t.busy || !run || !(run.state === 'done' || run.state === 'failed') ? `/exec/tickets/${t.id}/steer` : `/exec/${run.id}/reply`, { text })
  const lane = useLaneActions({ d: talks.d, target, onChange: talks.set, onSteer: steerMain, toast })
  return (
    <Sheet onClose={onClose}
           title={<><p className="flex flex-wrap items-center gap-x-2 text-small text-fg-3"><span className={`size-2 rounded-full ${g.dot}`} />{g.title}<span className="font-mono">{t.id}</span><span>{t.team}</span></p>
             <h2 className="mt-1 text-display font-semibold leading-snug tracking-tight">{t.title}</h2></>}
           footer={t.busy
             ? <button onClick={stop} className="flex h-12 w-full items-center justify-center gap-2 rounded-card bg-fill text-reading font-semibold text-fg-2 "><Square className="size-4 fill-current" />Stop the agent</button>
             : !asksOnLinear && t.repo ? <button onClick={start} className="flex h-12 w-full items-center justify-center gap-2 rounded-card bg-accent text-reading font-semibold text-on-accent"><Play className="size-4 fill-current" />{armed === 'run' ? 'Tap again to start the agent' : run ? 'Run again' : 'Start the agent'}</button>
             : undefined}>
      <div className="space-y-5 pt-1">
        <Vitals inline shipping={<ShippingVital title={t.busy ? 'The agent is working' : g.title} tone={t.busy ? 'run' : g.id === 'needs-you' ? 'wait' : 'run'} busy={t.busy} at={t.busy ? 1 : run ? 2 : 1} />}
                topics={{ target, d: talks.d, onChange: talks.set, onSteer: steerMain, toast }} />
        {t.busy && <Live feed={feed} />}
        {run && <Bg base={`/exec/${run.id}`} count={t.background} live={t.busy} toast={toast} />}
        {asksOnLinear && (
          <div className="space-y-2 rounded-card bg-wait/7 p-4 ring-1 ring-wait/25">
            <p className="text-body font-semibold text-wait-text">It asks on Linear</p>
            <Md text={t.lastComment!.body.slice(0, 1500)} className="!text-reading [&_p]:!my-1" />
            <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-reading font-semibold text-wait-text">Answer on Linear<ArrowUpRight className="size-4" /></a>
          </div>
        )}
        {/* you can always steer it: its next steps once it hands back, otherwise your own words (read between steps while it works, or a new run) */}
        {run && !t.busy && (run.state === 'done' || run.state === 'failed') ? (
          <div className="space-y-2">
            <p className="text-body font-semibold text-fg-3">What the agent needs</p>
            <NextSteps attach={lane} nextUrl={`/exec/${run.id}/next`} replyUrl={`/exec/${run.id}/reply`} draft={`ticket:${t.id}`} version={run.endedAt ?? ''} toast={toast} placeholder="Tell the agent what to do next…" />
          </div>
        ) : t.repo && (
          <div className="space-y-2">
            <p className="text-body font-semibold text-fg-3">Tell the agent</p>
            <NextSteps attach={lane} replyUrl={`/exec/tickets/${t.id}/steer`} draft={`ticket:${t.id}`} version={`${t.id}:${t.busy}`} toast={toast}
                       placeholder={t.busy ? 'Tell it something while it works: it reads it between steps' : `What should ${t.id}’s agent do?`} />
          </div>
        )}
        {run?.summary && !t.busy && <Said text={run.summary} at={run.endedAt} now={now} />}
        {linked.length > 0 && (
          <div className="space-y-2">
            <p className="text-body font-semibold text-fg-3">Pull requests</p>
            <ol className="overflow-hidden rounded-card ring-1 ring-line ">
              {linked.map((p) => 'id' in p
                ? <Row key={p.id} onClick={() => onPr(p.id)} dot={statusMeta(p.status, p.mine).dot} top={<span className="font-mono">#{p.number}</span>} title={p.title} meta={<span>{statusMeta(p.status, p.mine).label}</span>} />
                : <li key={p.url} className="border-b border-line px-4 py-3 last:border-0 "><a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-reading"><span className="font-mono text-fg-3">#{p.number}</span><span className="min-w-0 flex-1 truncate">{p.title ?? p.url}</span><ArrowUpRight className="size-4 text-fg-3" /></a></li>)}
            </ol>
          </div>
        )}
        <a href={t.url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-1 text-reading font-medium text-fg-3">Open on Linear<ArrowUpRight className="size-4" /></a>
      </div>
    </Sheet>
  )
}

// --- Pull requests: to review and yours ---------------------------------------------------------------------------------

function Prs({ prs, now, onOpen, onMenu, machine }: { prs: PrView[]; now: number; onOpen: (id: string) => void; onMenu: () => void; machine?: string }) {
  const [side, setSideState] = useState<'review' | 'mine'>(() => kept('m-side', 'review'))
  const setSide = (v: 'review' | 'mine') => { setSideState(v); keep('m-side', v) }
  const open = prs.filter((p) => !p.closed)
  const mine = side === 'mine'
  const list = open.filter((p) => !!p.mine === mine)
  const asks = list.filter((p) => !busyPr(p) && p.flow.state === 'asks')
  const needs = list.filter((p) => !busyPr(p) && !asks.includes(p) && waiting(p))
  const work = list.filter(busyPr)
  const done = list.filter((p) => !asks.includes(p) && !needs.includes(p) && !work.includes(p) && ['reviewed', 'clear'].includes(p.status))
  const rest = list.filter((p) => ![...asks, ...needs, ...work, ...done].includes(p))
  const row = (p: PrView) => {
    const m = statusMeta(p.status, p.mine)
    return <Row key={p.id} onClick={() => onOpen(p.id)} dot={m.dot}
                top={<><span className="font-mono font-medium">{p.repo.split('/')[1]}#{p.number}</span>{p.stack && <span>{p.stack.findIndex((s) => s.number === p.number) + 1}/{p.stack.length} in stack</span>}</>}
                title={p.title} meta={<><span>{m.label}</span><span className="text-ok-text">+{p.additions}</span><span className="text-fail-text">−{p.deletions}</span><span>{ago(p.updatedAt, now)}</span></>}
                right={p.explain?.state === 'done' ? <Sparkles className="size-4 shrink-0 text-accent" aria-label="explained" /> : undefined} />
  }
  return (
    <>
      <Head machine={machine} title="Pull requests" sub={`${asks.length + needs.length} waiting on you · ${work.length} agent${work.length === 1 ? '' : 's'} at work`} onMenu={onMenu}>
        <div className="px-5 pb-3">
          <div className="grid grid-cols-2 rounded-ctl bg-fill/70 p-1">
            {(['review', 'mine'] as const).map((v) => (
              <button key={v} onClick={() => setSide(v)} className={`h-9 rounded-ctl text-reading font-semibold transition-all ${side === v ? 'sel' : 'text-fg-3'}`}>
                {v === 'review' ? 'To review' : 'Mine'} <span className="tabular-nums opacity-50">{open.filter((p) => !!p.mine === (v === 'mine')).length}</span>
                {/* what waits on you on each side, so the other side's never hides */}
                {((w) => w > 0 && <span className="ml-1.5 inline-block min-w-[18px] rounded-full bg-wait px-1 align-[1px] text-meta font-bold leading-[18px] text-white">{w}</span>)(open.filter((p) => !!p.mine === (v === 'mine') && !busyPr(p) && (p.flow.state === 'asks' || waiting(p))).length)}
              </button>
            ))}
          </div>
        </div>
      </Head>
      {!list.length && <Empty>Nothing here.</Empty>}
      <Section title="The agent asks you" dot="bg-accent" n={asks.length}>{asks.map(row)}</Section>
      <Section title="Waiting on you" dot="bg-wait" n={needs.length}>{needs.map(row)}</Section>
      <Section title="Agents at work" dot="bg-run" n={work.length}>{work.map(row)}</Section>
      <Section title={mine ? 'Waiting on others' : 'Not started'} dot="bg-fg-4" n={rest.length}>{rest.map(row)}</Section>
      <Section title="Done" dot="bg-ok" n={done.length} folded>{done.map(row)}</Section>
    </>
  )
}

const headlines = new Map<string, { headline: string; what: string; risk: string } | null>()

function PrSheet({ pr, feed, now, toast, onClose, onTour, onTicket }: { pr: PrView; feed: Activity[]; now: number; toast: (m: string, tone?: 'ok' | 'error') => void; onClose: () => void; onTour: () => void; onTicket: (id: string) => void }) {
  const m = statusMeta(pr.status, pr.mine)
  const busy = busyPr(pr)
  const key = `${pr.id}:${pr.explain?.endedAt ?? ''}`
  const [line, setLine] = useState(headlines.get(key))
  useEffect(() => {
    if (headlines.has(key) || !pr.explain) return // a rewrite in progress still has the previous one to read
    api(`/prs/${enc(pr.id)}/explain`).then((d: { overlay?: Overlay }) => {
      const v = d.overlay ? { headline: d.overlay.business.headline, what: d.overlay.business.what, risk: d.overlay.business.risk } : null
      headlines.set(key, v); setLine(v)
    }, () => { headlines.set(key, null); setLine(null) })
  }, [key])
  const done = (msg: string) => { toast(msg); history.back() }
  const post = (path: string, body: object, msg: string) => api(`/prs/${enc(pr.id)}/${path}`, body).then(() => done(msg), (e: Error) => toast(e.message, 'error'))
  const crit = critUrl(pr)
  const target = `pr:${pr.id}`, talks = useDiscussions(target)
  const steerMain = (text: string) => api(`/prs/${enc(pr.id)}/${busy ? 'steer' : 'reply'}`, { text })
  const lane = useLaneActions({ d: talks.d, target, onChange: talks.set, onSteer: steerMain, toast })
  return (
    <Sheet onClose={onClose}
           title={<><p className="flex flex-wrap items-center gap-x-2 text-small text-fg-3"><span className={`size-2 rounded-full ${m.dot}`} />{m.label}<span className="font-mono">{pr.repo.split('/')[1]}#{pr.number}</span>{pr.stack && <span>{pr.stack.findIndex((s) => s.number === pr.number) + 1}/{pr.stack.length} in stack</span>}</p>
             <h2 className="mt-1 text-display font-semibold leading-snug tracking-tight">{pr.title}</h2></>}
           footer={busy ? <button onClick={() => api(`/prs/${enc(pr.id)}/cancel`, {}).then(() => toast('Stopped'), (e: Error) => toast(e.message, 'error'))} className="flex h-12 w-full items-center justify-center gap-2 rounded-card bg-fill text-reading font-semibold text-fg-2 "><Square className="size-4 fill-current" />Stop the agent</button> : undefined}>
      <div className="space-y-5 pt-1">
        <Vitals inline shipping={<ShippingVital title={busy ? 'The agent is working' : m.label} tone={busy ? 'run' : pr.flow.state === 'asks' ? 'wait' : 'run'} busy={busy} at={busy ? 1 : 2} why={pr.flow.why} />}
                topics={{ target, d: talks.d, onChange: talks.set, onSteer: steerMain, toast, here: pr.number }} />
        <p className="text-reading leading-relaxed text-fg-2 ">{pr.flow.why}</p>
        {busy && <Live feed={feed} />}
        <Bg base={`/prs/${enc(pr.id)}`} count={pr.background} live={busy} toast={toast} />
        {/* an explanation always has a place: the one there is (while a newer one is written), it being written, or a way to start one */}
        {!line && (
          pr.explain?.state === 'running' || pr.explain?.state === 'queued'
            ? <p className="flex items-center gap-3 rounded-card bg-accent/7 p-4 text-reading text-fg-2 ring-1 ring-accent/25 "><LoaderCircle className="size-5 shrink-0 animate-spin text-accent" />{pr.explain.state === 'queued' ? 'Its explanation waits its turn…' : 'Its explanation is being written…'}</p>
            : line === null || !pr.explain ? <button onClick={() => api(`/prs/${enc(pr.id)}/explain`, {}).then(() => toast('Explaining this PR'), (e: Error) => toast(e.message, 'error'))}
                      className="flex w-full items-center gap-3 rounded-card bg-accent/7 p-4 text-left text-reading font-semibold text-accent-text ring-1 ring-accent/25 active:scale-[0.99]">
                <Sparkles className="size-5 shrink-0" />{pr.explain?.state === 'failed' ? 'Its explanation failed: try again' : 'Explain this PR'}</button>
            : null
        )}
        {line && (
          <button onClick={onTour} className="flex w-full items-start gap-3 rounded-card bg-accent/7 p-4 text-left ring-1 ring-accent/25 active:scale-[0.99]">
            <BookOpen className="mt-0.5 size-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-reading font-semibold leading-snug">{line.headline}</span>
              {(pr.explain?.state === 'running' || pr.explain?.state === 'queued') && <span className="mt-1 flex items-center gap-1.5 text-small text-fg-3"><LoaderCircle className="size-3.5 animate-spin" />A newer one is being written for the latest push</span>}
              {line.what && <span className="mt-1 line-clamp-3 block text-body leading-relaxed text-fg-2 ">{plain(line.what)}</span>}
              <span className="mt-2 inline-flex items-center gap-1 text-body font-semibold text-accent-text">Read the tour · {line.risk} risk<ChevronRight className="size-4" /></span>
            </span>
          </button>
        )}
        {!busy && (pr.flow.state === 'asks' ? <Answer pr={pr} done={done} toast={toast} /> : <Step pr={pr} post={post} />)}
        {/* you can always steer it, whatever the actions offer: while it works it reads this between steps; otherwise it starts a run with your words */}
        {pr.flow.state !== 'asks' && (
          <div className="space-y-2">
            <p className="text-body font-semibold text-fg-3">Tell the agent</p>
            <NextSteps attach={lane} replyUrl={`/prs/${enc(pr.id)}/reply`} draft={`pr:${pr.id}`} version={`${pr.job?.endedAt ?? ''}:${busy}`} toast={toast}
                       placeholder={busy ? 'Tell it something while it works: it reads it between steps' : 'Ask an agent to do something on this PR'} />
          </div>
        )}
        {pr.job?.summary && !busy && <Said text={pr.job.summary} at={pr.job.endedAt} now={now} />}
        {pr.linked?.some((l) => l.kind === 'ticket') && (
          <div className="flex flex-wrap gap-2">{pr.linked.filter((l) => l.kind === 'ticket').map((l) => <button key={l.id} onClick={() => onTicket(l.id)} className="flex h-9 items-center gap-1.5 rounded-full bg-fill px-3 text-body font-medium"><TicketIcon className="size-3.5" />{l.id}</button>)}</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <a href={pr.url} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-card bg-fill text-reading font-medium"><GitPullRequest className="size-4" />GitHub</a>
          {crit ? <a href={crit} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-card bg-fill text-reading font-medium"><MessagesSquare className="size-4" />crit</a>
            : <span className="flex h-11 items-center justify-center rounded-card bg-fill/60 text-body text-fg-3">crit isn't running</span>}
        </div>
      </div>
    </Sheet>
  )
}

/** The guided tour, in a sheet of its own nearly the full height: swipe or tap through its steps. */
function TourSheet({ pr, prs, toast, onClose }: { pr: PrView; prs: PrView[]; toast: (m: string, tone?: 'ok' | 'error') => void; onClose: () => void }) {
  const [o, setO] = useState<Overlay | null>()
  useEffect(() => { api(`/prs/${enc(pr.id)}/explain`).then((d: { overlay?: Overlay }) => setO(d.overlay ?? null), () => setO(null)) }, [pr.id, pr.explain?.endedAt])
  return (
    <Sheet tall onClose={onClose} title={<p className="truncate pt-1 text-reading font-semibold"><span className="font-mono text-fg-3">#{pr.number}</span> {pr.title}</p>}>
      <div data-noswipe className="-mx-5 -mb-5 h-full">
        {o === undefined ? <div className="flex h-40 items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-3" /></div>
          : o === null ? <Empty>This explanation couldn't be loaded.</Empty>
          : <Tour pr={pr} o={o} onExplain={() => api(`/prs/${enc(pr.id)}/explain`, {}).then(() => toast('Explaining the latest push'), (e: Error) => toast(e.message, 'error'))}
                  busy={pr.explain?.state === 'running'} prs={prs} toast={toast} onFinish={{ label: 'Done', go: () => history.back() }} />}
      </div>
    </Sheet>
  )
}

// --- Agents: what they are doing and what they did ----------------------------------------------------------------------

function Agents({ prs, tickets, alerts, now, onOpen, onMenu, machine }: { prs: PrView[]; tickets: TicketView[]; alerts: ReturnType<typeof useDeck>['alerts']; now: number; onOpen: (o: Open) => void; onMenu: () => void; machine?: string }) {
  const [runs, setRuns] = useState<(RunEvent & { startedAt?: string })[]>()
  useEffect(() => {
    const get = () => api('/runs?days=2').then((r: { runs: RunEvent[] }) => setRuns(r.runs.slice(0, 40)), () => setRuns([]))
    void get(); const t = setInterval(get, 30_000); return () => clearInterval(t)
  }, [])
  const workingPrs = prs.filter(busyPr), workingTickets = tickets.filter((t) => t.busy)
  const news = alerts.filter((a) => !a.seen || a.at > a.seen).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20)
  const openAlert = (a: (typeof alerts)[number]) => { if (a.kind === 'pr' || a.kind === 'ticket') onOpen({ kind: a.kind, id: a.target }) }
  const tone = { done: 'bg-ok', failed: 'bg-fail', cancelled: 'bg-fg-4', interrupted: 'bg-wait', running: 'bg-run', queued: 'bg-fg-4' } as const
  return (
    <>
      <Head machine={machine} title="Agents" sub={`${workingPrs.length + workingTickets.length} at work · ${news.length} update${news.length === 1 ? '' : 's'}`} onMenu={onMenu} />
      <Section title="At work now" dot="bg-run" n={workingPrs.length + workingTickets.length}>
        {workingPrs.map((p) => <Row key={p.id} onClick={() => onOpen({ kind: 'pr', id: p.id })} dot="bg-run animate-pulse" top={<><span className="font-mono">#{p.number}</span><span>{p.job?.kind}</span></>} title={p.title} meta={<span>since {ago(p.job?.startedAt ?? p.job?.queuedAt, now)}</span>} />)}
        {workingTickets.map((t) => <Row key={t.id} onClick={() => onOpen({ kind: 'ticket', id: t.id })} dot="bg-run animate-pulse" top={<span className="font-mono">{t.id}</span>} title={t.title} meta={<span>{t.run?.phase ?? 'working'}</span>} />)}
      </Section>
      {!workingPrs.length && !workingTickets.length && <p className="px-5 pt-4 text-reading text-fg-3">No agent is working right now.</p>}
      <Section title="Updates" dot="bg-wait" n={news.length}>
        {news.map((a) => (
          <Row key={a.key} onClick={() => openAlert(a)} dot={a.updates.at(-1)?.tone === 'you' ? 'bg-wait' : a.updates.at(-1)?.tone === 'warn' ? 'bg-fail' : 'bg-ok'}
               top={<span>{ago(a.at, now)}</span>} title={a.title} meta={<span className="line-clamp-2">{a.updates.at(-1)?.text}</span>} />
        ))}
      </Section>
      <Section title="Recent runs" dot="bg-fg-4" n={runs?.length ?? 0}>
        {(runs ?? []).map((r) => (
          <Row key={`${r.entity}${r.id}${r.run}`} onClick={() => { if (r.entity === 'job' || r.entity === 'explain' || r.entity === 'op') onOpen({ kind: 'pr', id: r.id }) }}
               dot={tone[r.to as keyof typeof tone] ?? 'bg-fg-4'} top={<><span className="font-mono">{r.id.split('/').pop()}</span><span>{r.kind ?? r.entity}</span></>}
               title={`${r.to}${r.cause && r.cause !== r.to ? ` · ${r.cause}` : ''}`}
               meta={<><span>{ago(r.at, now)}</span>{r.costUsd ? <span>${r.costUsd.toFixed(2)}</span> : null}{r.refused ? <span className="text-wait-text">{r.refused} refused</span> : null}</>} />
        ))}
      </Section>
      {runs === undefined && <div className="flex justify-center py-8"><LoaderCircle className="size-5 animate-spin text-fg-3" /></div>}
    </>
  )
}

/** What the agent left running in the background, when there is any. */
function Bg({ base, count, live, toast }: { base: string; count: number; live: boolean; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const v = useBackground(base, count, live)
  if (!v || (!v.tasks.length && !v.procs.length)) return null
  return (
    <div className="space-y-2">
      <p className="text-body font-semibold text-fg-3">Running in the background</p>
      <BackgroundList v={v} base={base} toast={toast} />
    </div>
  )
}

/** What an agent is doing right now: its last few steps, the newest at the bottom. */
function Live({ feed }: { feed: Activity[] }) {
  const since = feed.findLastIndex((a) => a.kind === 'section')
  const steps = feed.slice(since + 1).filter((a) => a.kind === 'tool' || a.kind === 'text').slice(-4)
  return (
    <div className="rounded-card bg-run/6 p-4 ring-1 ring-run/20">
      <p className="flex items-center gap-2 text-body font-semibold text-run-text"><ActivityIcon className="size-4 animate-pulse" />The agent is working</p>
      <ol className="mt-2 space-y-1.5">
        {steps.length ? steps.map((a, i) => <li key={i} className={`line-clamp-2 text-body ${i === steps.length - 1 ? 'text-fg-1 ' : 'text-fg-3'}`}>{a.kind === 'tool' && <span className="mr-1.5 font-mono text-small text-run-text">{a.tool}</span>}{a.kind === 'tool' ? a.text : plain(a.text)}</li>)
          : <li className="text-body text-fg-3">Starting…</li>}
      </ol>
    </div>
  )
}

/** The agent's last message, folded to a few lines; a tap shows it all. */
function Said({ text, at, now }: { text: string; at?: string; now: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-card bg-fill/60 p-4 ring-1 ring-line ">
      <p className="mb-1.5 flex items-center gap-2 text-body font-semibold text-fg-3"><Bot className="size-4" />What the agent said<span className="ml-auto font-normal normal-case tracking-normal">{ago(at, now)}</span></p>
      <div className={open ? '' : 'max-h-28 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]'}><Md text={text} className="!text-reading [&_p]:!my-1" /></div>
      <button onClick={() => setOpen(!open)} className="mt-1 text-body font-semibold text-accent-text">{open ? 'Show less' : 'Show all'}</button>
    </div>
  )
}

/** The rest, in one sheet: sync, auto-review, theme, the full desktop view, what today cost. */
function Menu({ health, toast, onClose }: { health: ReturnType<typeof useDeck>['health']; toast: (m: string, tone?: 'ok' | 'error') => void; onClose: () => void }) {
  const [theme, setTheme] = useTheme()
  const item = 'flex h-14 w-full items-center gap-3 px-4 text-left text-reading active:bg-hover'
  return (
    <Sheet onClose={onClose} title={<p className="pt-1 text-title font-semibold">Concierge</p>}>
      <ol className="overflow-hidden rounded-card bg-fill/60 ring-1 ring-line [&>li+li]:border-t [&>li+li]:border-zinc-100 dark:[&>li+li]:border-zinc-800">
        <li><button className={item} onClick={() => api('/poll', {}).then(() => toast('Checking GitHub now'))}><RefreshCw className="size-5 text-fg-3" />Refresh<span className="ml-auto text-body text-fg-3">{health?.lastPollAt ? `synced ${ago(health.lastPollAt, Date.now())}` : ''}</span></button></li>
        <li><button className={item} onClick={() => health && api('/auto-start', { on: !health.autoStart }).then((h: { autoStart: boolean }) => toast(h.autoStart ? 'Auto-review on' : 'Auto-review off'))}><Zap className={`size-5 ${health?.autoStart ? 'fill-accent text-accent' : 'text-fg-3'}`} />Auto-review<span className="ml-auto text-body text-fg-3">{health?.autoStart ? 'on' : 'off'}</span></button></li>
        <li><button className={item} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun className="size-5 text-fg-3" /> : <Moon className="size-5 text-fg-3" />}{theme === 'dark' ? 'Light theme' : 'Dark theme'}</button></li>
        <li><a className={item} href="/?desktop=1"><Monitor className="size-5 text-fg-3" />The full desktop view</a></li>
      </ol>
      {health && <p className="flex items-center gap-2 px-1 pt-4 text-body text-fg-3"><CheckCheck className="size-4" />AI spend today ${health.spentToday.toFixed(2)}{health.settings.dailyBudgetUsd ? ` of $${health.settings.dailyBudgetUsd}` : ''}</p>}
    </Sheet>
  )
}
