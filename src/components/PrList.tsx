import { appColor } from '../appColor.ts'
import { askLine } from '../../server/reply.ts'
import { Bookmark, CircleCheck, EyeOff, GitPullRequestDraft, History, Inbox, Layers, LoaderCircle, MessageSquareWarning, Play, Plus, Search, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { api, type PrView } from '../lib.ts'
import { useDragPick } from '../pick.ts'
import { reviewPlan } from '../plan.ts'
import { statusMeta, StatusBadge } from './StatusBadge.tsx'
import { short } from '../time.ts'
import { plain } from './StackNav.tsx'
import { useFlip } from '../flip.ts'
import { recent, takeRecent, useTouch } from '../recent.ts'

export type Tab = 'review' | 'mine'
type Group = { title: string; statuses: PrView['status'][]; recent?: boolean; pinned?: boolean }
const RECENT: Group = { title: 'Recent', statuses: [], recent: true }
const PINNED: Group = { title: 'Bookmarked', statuses: [], pinned: true }

const GROUPS: Record<Tab, Group[]> = {
  review: [
    { title: 'Needs you', statuses: ['ready', 'in-review', 'failed', 'interrupted'] },
    { title: 'Working', statuses: ['preparing', 'posting', 'queued'] },
    { title: 'Not started', statuses: ['new', 'no-checkout'] },
    { title: 'Done', statuses: ['reviewed', 'closed'] },
  ],
  mine: [
    { title: 'Approved · ready to merge', statuses: ['approved'] },
    { title: 'Feedback waiting', statuses: ['new', 'failed', 'interrupted', 'no-checkout'] },
    { title: 'Working', statuses: ['preparing', 'posting', 'queued'] },
    { title: 'In crit', statuses: ['ready', 'in-review'] },
    { title: 'Waiting on reviewers', statuses: ['answered'] },
    { title: 'All clear', statuses: ['clear'] },
    { title: 'Done', statuses: ['closed'] }, // merged or closed in the last few days, then they leave
  ],
}

export const tabOf = (p: PrView): Tab => (p.mine ? 'mine' : 'review')
/** What counts toward a tab's badge: work that is waiting on you. */
export const waiting = (p: PrView) => (p.mine ? p.status === 'new' || p.status === 'approved' : p.status === 'ready' || p.status === 'in-review')

/** "repo#bottom" for PRs in a stack: members share it. */
export const stackKey = (p: PrView) => (p.stack ? `${p.repo}#${p.stack[0].number}` : undefined)
export const stackPos = (p: PrView) => (p.stack ? p.stack.findIndex((s) => s.number === p.number) : -1)

/**
 * One tab's groups, each a list of units: a PR alone, or a stack, bottom to top. A stack stays whole: it sits in the
 * group of its most pressing member, the others ride along (shown quieter, each with its own status).
 */
export function grouped(prs: PrView[], q: string, tab: Tab): { group: Group; units: PrView[][] }[] {
  const needle = q.trim().toLowerCase()
  const gi = (p: PrView) => GROUPS[tab].findIndex((g) => g.statuses.includes(p.status))
  const hits = prs.filter((p) => tabOf(p) === tab && gi(p) >= 0 && (!needle || `${p.title} ${p.repo}#${p.number} ${p.author.login}`.toLowerCase().includes(needle)))
    .sort((a, b) => tab === 'mine'
      ? (b.awaiting ?? b.unresolved ?? 0) - (a.awaiting ?? a.unresolved ?? 0) || b.updatedAt.localeCompare(a.updatedAt) // most waiting on you, then most recent
      : a.firstSeenAt.localeCompare(b.firstSeenAt))
  const units = new Map<string, PrView[]>() // in the order of each unit's first (most pressing) member
  for (const p of hits) { const k = stackKey(p) ?? p.id; units.set(k, [...(units.get(k) ?? []), p]) }
  const every = [...units.values()].map((u) => u.sort((a, b) => stackPos(a) - stackPos(b)))
  // bookmarked ones lead, whatever their state; then what you opened last
  const pinned = every.filter((u) => u.some((p) => p.pinned)), all = every.filter((u) => !pinned.includes(u))
  // what you opened last comes first, except what already leads (the first group stays where it is)
  const lead = all.filter((u) => Math.min(...u.map(gi)) === 0)
  const { recent: rec, rest } = takeRecent(all.filter((u) => !lead.includes(u)), (p) => p.id, recent('review'))
  return [...(pinned.length ? [{ group: PINNED, units: pinned }] : []), ...(rec.length ? [{ group: RECENT, units: rec }] : []), ...GROUPS[tab].map((group, i) => ({ group, units: (i ? rest : lead).filter((u) => Math.min(...u.map(gi)) === i) }))]
}

/** List order for one tab, also used for j/k navigation. */
export const ordered = (prs: PrView[], q: string, tab: Tab): PrView[] => grouped(prs, q, tab).flatMap((g) => g.units.flat())

export function Avatar({ src, className = 'size-8' }: { src: string; className?: string }) {
  return (
    <span className={`${className} block overflow-hidden rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 ring-1 ring-black/5 dark:from-zinc-700 dark:to-zinc-800 dark:ring-white/10`}>
      <img src={src} alt="" loading="lazy" className="size-full object-cover" />
    </span>
  )
}

export function PrList({ prs: given, selected, onSelect, query, onQuery, now, tab, onTab, picked, onPick, toast }: {
  prs: PrView[]; selected?: string; onSelect: (id: string) => void; tab: Tab; onTab: (t: Tab) => void
  query: string; onQuery: (q: string) => void; now: number
  picked: string[]; onPick: (ids: string[]) => void; toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  // a bookmark or hide clicked here shows at once (the row moves or goes); the server's next update agrees
  const [over, setOver] = useState<Record<string, { pinned?: boolean; dismissed?: boolean }>>({})
  useEffect(() => setOver({}), [given])
  const prs = given.map((p) => (over[p.id] ? { ...p, ...over[p.id] } : p)).filter((p) => !p.dismissed)
  const nav = useRef<HTMLElement>(null)
  useFlip(nav)
  const act: Act = (p, what) => {
    const name = `${p.repo.split('/')[1]}#${p.number}`
    if (what === 'hide') {
      setOver((o) => ({ ...o, [p.id]: { ...o[p.id], dismissed: true } }))
      return api(`/prs/${encodeURIComponent(p.id)}/dismiss`, {}).then(() => toast(`${name} hidden until it is requested again`),
        (e: Error) => { setOver((o) => ({ ...o, [p.id]: { ...o[p.id], dismissed: false } })); toast(e.message, 'error') })
    }
    const on = !p.pinned
    setOver((o) => ({ ...o, [p.id]: { ...o[p.id], pinned: on } }))
    api('/pins', { key: `pr:${p.id}`, on }).then(() => toast(on ? `${name} bookmarked: it stays on top` : `${name}: bookmark removed`),
      (e: Error) => { setOver((o) => ({ ...o, [p.id]: { ...o[p.id], pinned: !on } })); toast(e.message, 'error') })
  }
  const groups = grouped(prs, query, tab), list = groups.flatMap((g) => g.units.flat())
  useTouch('review', selected)
  const seen = recent('review', 5, now)
  const byNumber = new Map(prs.map((p) => [`${p.repo}#${p.number}`, p]))
  const tabs: { id: Tab; label: string; icon: typeof Inbox }[] = [
    { id: 'review', label: 'To review', icon: GitPullRequestDraft },
    { id: 'mine', label: 'My PRs', icon: UserRound },
  ]
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [selected])
  // picking, for a planned batch of reviews: the avatar (a stack's node) is the pick box, or drag across rows
  const drag = useDragPick(picked, onPick)
  const pick: Pick = { picked, drag, toggle: (id) => onPick(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]) }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3 reading:hidden">
        <div role="tablist" className="relative grid grid-cols-2 rounded-xl bg-fill/60 p-1">
          <span className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-surface-1 shadow-sm ring-1 ring-black/5 transition-transform duration-300 ease-[var(--ease-snappy)] dark:ring-white/5"
                style={{ transform: tab === 'mine' ? 'translateX(100%)' : undefined }} />
          {tabs.map((t) => {
            const n = prs.filter((p) => tabOf(p) === t.id && waiting(p)).length
            const on = tab === t.id
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => onTab(t.id)}
                      className={`group relative z-10 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-body font-medium transition-colors ${on ? 'text-fg-1 ' : 'text-fg-3 hover:text-fg-1'}`}>
                <t.icon className={`size-3.5 transition-transform duration-200 group-hover:scale-110 ${on ? 'text-accent' : ''}`} />{t.label}
                {n > 0 && <span className={`min-w-4 rounded-full px-1 text-micro font-semibold tabular-nums ${on ? 'bg-accent text-on-accent' : 'bg-fill-strong text-fg-2 '}`}>{n}</span>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="px-3 py-2.5 reading:hidden">
        <label className="group flex items-center gap-2 rounded-xl bg-surface-1 px-3 py-1.5 text-body shadow-sm ring-1 ring-line transition-all duration-200 hover:ring-line-strong focus-within:ring-2 focus-within:ring-accent/60">
          <Search className="size-4 text-fg-3 transition-colors group-focus-within:text-accent" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { if (query) { e.stopPropagation(); onQuery('') } else e.currentTarget.blur() } }}
            placeholder="Filter reviews"
            className="w-full bg-transparent outline-none placeholder:text-fg-3"
          />
          {query
            ? <button onClick={() => onQuery('')} className="rounded-md p-0.5 text-fg-3 transition-colors hov hover:text-fg-2" aria-label="Clear filter"><X className="size-3.5" /></button>
            : <kbd className="rounded-md border border-line-strong px-1.5 font-mono text-micro text-fg-3">/</kbd>}
        </label>
      </div>

      <nav ref={nav} className="relative flex-1 overflow-y-auto px-2 pb-4 reading:px-1.5 reading:pt-3" aria-label="Pull requests">
        {list.length === 0 && (
          <div className="flex animate-[fade-in_240ms] flex-col items-center gap-2 px-6 py-20 text-center">
            <span className={`mb-1 flex size-12 items-center justify-center rounded-2xl ${query ? 'bg-hover' : 'bg-ok/10 ring-1 ring-ok/20'}`}>
              <Inbox className={`size-6 ${query ? 'text-fg-4' : 'text-ok'}`} aria-hidden />
            </span>
            <p className="text-reading font-semibold text-fg-1">{query ? 'Nothing matches' : 'Inbox zero'}</p>
            <p className="max-w-[240px] text-small leading-relaxed text-fg-3">{query ? <>No pull request here has “{query}” in it. <kbd className="rounded bg-hover px-1 font-sans text-meta">Esc</kbd> clears the filter.</> : 'No reviews wait on you. New requests land here, and start on their own with Auto-review on.'}</p>
          </div>
        )}
        {groups.map(({ group: g, units }) => {
          if (!units.length) return null
          return (
            <section key={g.title} className="mb-1.5 reading:mb-0 reading:border-b reading:border-zinc-200/80 reading:py-1 reading:last:border-0 dark:reading:border-zinc-800/80">
              <h2 className="sticky top-0 z-10 flex items-center gap-2 reading:hidden px-2.5 pb-1.5 pt-3 label text-fg-4 backdrop-blur-xl">
                {g.recent && <History className="size-3.5" aria-hidden />}{g.pinned && <Bookmark className="size-3.5 fill-current text-accent" aria-hidden />}{g.title}
                <span className="rounded-full bg-hover px-1.5 py-px text-micro font-medium normal-case tabular-nums tracking-normal text-fg-3">{g.recent || g.pinned ? units.length : units.flat().filter((p) => g.statuses.includes(p.status)).length}</span>
              </h2>
              {units.map((u) => u[0].stack && u.length > 1
                ? <Stack key={stackKey(u[0])} prs={u} here={g.recent || g.pinned ? u.map((p) => p.status) : g.statuses} byNumber={byNumber} selected={selected} onSelect={onSelect} now={now} activeRef={activeRef} pick={pick} act={act} />
                : <Row key={u[0].id} p={u[0]} seen={g.recent ? seen.get(u[0].id) : undefined} active={u[0].id === selected} onSelect={onSelect} now={now} activeRef={activeRef} pick={pick} act={act} />)}
            </section>
          )
        })}
      </nav>
      <ReviewBar prs={prs} picked={picked} onPick={onPick} toast={toast} />
    </div>
  )
}

type Pick = { picked: string[]; toggle: (id: string) => void; drag: ReturnType<typeof useDragPick> }
const pickable = (p: PrView) => !p.closed && p.status !== 'preparing' && p.status !== 'queued' && p.status !== 'posting'
/** Where a row's mark sits (its avatar, or a stack's node): the pick box on hover, or once anything is picked; its number once picked. */
function PickMark({ p, pick, children, small = false }: { p: PrView; pick: Pick; children: ReactNode; small?: boolean }) {
  const at = pick.picked.indexOf(p.id), ok = pickable(p)
  return (
    <span role="checkbox" aria-checked={at >= 0} aria-disabled={!ok} title={!ok ? 'Already running' : at >= 0 ? `Picked #${at + 1}` : 'Add to the next batch of reviews (or drag across rows)'}
          onClick={(e) => { e.stopPropagation(); if (ok) pick.toggle(p.id) }} className="relative flex shrink-0 items-center justify-center">
      {at >= 0 ? <span className={`flex ${small ? 'size-4 text-[9px]' : 'size-6 text-micro'} items-center justify-center rounded-full bg-accent font-semibold text-on-accent`}>{at + 1}</span>
        : <>
            <span className={`contents ${ok ? (pick.picked.length ? '[&>*]:opacity-0' : 'group-hover:[&>*]:opacity-0') : ''}`}>{children}</span>
            {ok && <span className={`absolute inset-0 m-auto flex ${small ? 'size-4' : 'size-6'} items-center justify-center rounded-full bg-surface-1 ring-1 ring-accent/70 transition-opacity ${pick.picked.length ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}><Plus className={`${small ? 'size-3' : 'size-3.5'} text-accent-text`} /></span>}
          </>}
    </span>
  )
}

type RowProps = { p: PrView; seen?: number; active: boolean; onSelect: (id: string) => void; now: number; activeRef: RefObject<HTMLButtonElement | null>; pick: Pick; act: Act }
type Act = (p: PrView, what: 'pin' | 'hide') => void

/** A row's last column: its own facts, swapped on hover for the actions in the same place (nothing else moves or hides). */
export const Trail = ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
  <span className="grid shrink-0 items-center reading:hidden [&>*]:col-start-1 [&>*]:row-start-1">
    <span className="flex items-center justify-end gap-2 group-hover:invisible group-focus-within:invisible">{children}</span>
    {actions}
  </span>
)

/** A row's quick actions, on hover (or keyboard focus): bookmark, and hide for a review; what's on stays lit. Inside the
 * row's button, so spans with a button role (a button can't hold a button). */
function Quick({ p, act }: { p: PrView; act: Act }) {
  const items = [
    { what: 'pin' as const, Icon: Bookmark, on: !!p.pinned, label: p.pinned ? 'Remove the bookmark' : 'Bookmark: keep it on top, and alert me when its state changes' },
    ...(!p.mine && !p.closed ? [{ what: 'hide' as const, Icon: EyeOff, on: false, label: 'Hide until it is requested again' }] : []),
  ]
  return (
    <span className="invisible flex items-center justify-end gap-0.5 group-hover:visible group-focus-within:visible reading:hidden">
      {items.map(({ what, Icon, on, label }) => (
        <span key={what} role="button" tabIndex={0} title={label} aria-label={label} aria-pressed={on}
              onClick={(e) => { e.stopPropagation(); act(p, what) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); act(p, what) } }}
              className={`rounded p-1 transition-colors ${on ? 'text-accent' : 'text-fg-3 hover:bg-fg-3/10 hover:text-fg-1'}`}>
          <Icon className={`size-3.5 ${on ? 'fill-current' : ''}`} />
        </span>
      ))}
    </span>
  )
}

/** A PR on its own: avatar with its status dot, title, and the facts line. */
function Row({ p, seen, active, onSelect, now, activeRef, pick, act }: RowProps) {
  const working = p.status === 'preparing' || p.status === 'posting'
  return (
    <button data-flip={p.id} ref={active ? activeRef : undefined} onClick={() => onSelect(p.id)} {...pick.drag(p.id, pickable(p))} aria-current={active} title={`${p.title}\n${p.repo}#${p.number}`} style={appColor(p.repo).style}
            className={`group relative mb-0.5 flex w-full items-center gap-2.5 overflow-hidden rounded-ctl px-2.5 py-2 text-left reading:flex-col reading:gap-1 reading:px-0 reading:py-1.5 -outline-offset-2 transition-[background-color,box-shadow] duration-[120ms] ${active ? ACTIVE : pick.picked.includes(p.id) ? PICKED : IDLE}`}>
      {working && <Shimmer />}
      <PickMark p={p} pick={pick}>
        <span className="relative shrink-0 transition-all duration-200 group-hover:scale-105">
          <Avatar src={p.author.avatar} className="size-6" />
          <span role="img" aria-label={statusMeta(p.status, p.mine).label} title={statusMeta(p.status, p.mine).label} className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-line transition-colors duration-300 ${statusMeta(p.status, p.mine).dot} ${working ? 'animate-pulse' : ''}`} />
        </span>
      </PickMark>
      <Num p={p} active={active} />
      <span className={`min-w-0 flex-1 reading:hidden ${p.closed && !active ? 'opacity-45 group-hover:opacity-100' : ''}`}>
        <span className={`line-clamp-2 text-body leading-snug transition-colors ${p.closed ? 'line-through decoration-fg-4/60' : 'font-medium'} ${active ? 'text-fg-1 ' : 'text-fg-2 group-hover:text-fg-1'}`}>{p.closed && <CircleCheck className="mr-1 inline size-3.5 align-[-2px] text-ok-text no-underline" aria-label={p.merged ? 'merged' : 'closed'} />}{p.title}</span>
        <Facts p={p} now={now} seen={seen}><span className="flex min-w-0 font-mono"><span className={`truncate ${appColor(p.repo).text}`}>{p.repo.split('/')[1]}</span><span className="shrink-0">#{p.number}</span></span></Facts>
        <Asks p={p} />
      </span>
      {/* the last column: when you opened it and its status, or (on hover) the quick actions in their place */}
      <Trail actions={<Quick p={p} act={act} />}><StatusBadge status={p.status} mine={p.mine} compact /></Trail>
    </button>
  )
}

/**
 * A stack as one card: a header with where it lives and a strip of every member's status, then its PRs bottom to top
 * on a rail, each node its status. The ones that put the stack in this group stand out; the rest stay quiet.
 */
function Stack({ prs, here, byNumber, selected, onSelect, now, activeRef, pick, act }: {
  prs: PrView[]; here: PrView['status'][]; byNumber: Map<string, PrView>; selected?: string; onSelect: (id: string) => void; now: number
  activeRef: RefObject<HTMLButtonElement | null>; pick: Pick; act: Act
}) {
  const all = prs[0].stack!, repo = prs[0].repo
  const authors = [...new Map(prs.map((p) => [p.author.login, p.author])).values()]
  return (
    <div style={appColor(repo).style} className="mb-1.5 rounded-xl bg-white/50 p-1 ring-1 ring-line reading:mb-0 reading:bg-transparent reading:p-0 reading:ring-0 dark:bg-zinc-900/30 ">
      <div className="flex items-center gap-2 px-2 pb-1 pt-1 text-meta text-fg-3 reading:hidden" title={all.map((s) => `#${s.number}`).join(' → ')}>
        <Layers className="size-3.5 shrink-0 text-accent" />
        <span className={`truncate font-mono ${appColor(repo).text}`}>{repo.split('/')[1]}</span>
        <span className="shrink-0 tabular-nums">{all.length} PRs</span>
        <span className="ml-auto flex shrink-0 -space-x-1">{authors.slice(0, 3).map((a) => <Avatar key={a.login} src={a.avatar} className="size-4" />)}</span>
        {/* the whole stack at a glance, bottom to top: a segment per PR in its status colour */}
        <span className="flex w-16 shrink-0 gap-0.5">
          {all.map((s) => {
            const m = byNumber.get(`${repo}#${s.number}`)
            return <span key={s.number} title={`#${s.number} ${m ? statusMeta(m.status, m.mine).label : ''}`} className={`h-1 flex-1 rounded-full ${m ? statusMeta(m.status, m.mine).dot : 'bg-fill-strong'} ${m && !here.includes(m.status) ? 'opacity-35' : ''}`} />
          })}
        </span>
      </div>
      {prs.map((p, i) => {
        const active = p.id === selected, lit = here.includes(p.status)
        const working = p.status === 'preparing' || p.status === 'posting'
        return (
          <button key={p.id} data-flip={p.id} ref={active ? activeRef : undefined} onClick={() => onSelect(p.id)} {...pick.drag(p.id, pickable(p))} aria-current={active} title={`${p.title}\n${p.repo}#${p.number} · ${statusMeta(p.status, p.mine).label}`}
                  className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-ctl py-1.5 pl-2.5 pr-2 text-left reading:flex-col reading:gap-1 reading:px-0 reading:py-1.5 -outline-offset-2 transition-[background-color,box-shadow] duration-[120ms] ${active ? ACTIVE : pick.picked.includes(p.id) ? PICKED : IDLE}`}>
            {working && <Shimmer />}
            {/* the rail: joins this node to the PR below and the one above */}
            <span className="relative flex w-6 shrink-0 justify-center self-stretch reading:hidden" aria-hidden>
              {i > 0 && <span className="absolute -top-1.5 bottom-1/2 w-px bg-fill-strong" />}
              {i < prs.length - 1 && <span className="absolute -bottom-1.5 top-1/2 w-px bg-fill-strong" />}
              <span className="relative my-auto flex"><PickMark p={p} pick={pick} small><span className={`relative rounded-full ring-[3px] ring-white transition-all duration-300 dark:ring-zinc-900 ${statusMeta(p.status, p.mine).dot} ${lit ? 'size-2.5' : 'size-2 opacity-50'} ${working ? 'animate-pulse' : ''}`} /></PickMark></span>
            </span>
            <Num p={p} active={active} />
            <span className={`min-w-0 flex-1 reading:hidden ${lit || active ? '' : 'opacity-60 group-hover:opacity-100'}`}>
              <span className={`line-clamp-2 text-body leading-snug transition-colors ${lit ? 'font-medium' : ''} ${active ? 'text-fg-1 ' : 'text-fg-2 group-hover:text-fg-1'}`}>{plain(p.title)}</span>
              <Facts p={p} now={now}><span className="shrink-0 font-mono">#{p.number}</span></Facts>
              <Asks p={p} />
            </span>
            {/* one trailing thing, only when it matters: it needs you, it failed, or it runs; the dot says the rest */}
            <Trail actions={<Quick p={p} act={act} />}>
              {['wait', 'fail', 'run'].includes(statusMeta(p.status, p.mine).kind) && <StatusBadge status={p.status} mine={p.mine} compact />}
            </Trail>
          </button>
        )
      })}
    </div>
  )
}

const ACTIVE = 'sel'
const PICKED = 'bg-accent/6 ring-1 ring-accent/25'
const IDLE = 'hov'

const Shimmer = () => (
  <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-run/10">
    <span className="block h-full w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-run to-transparent" />
  </span>
)

/** The PR number, the one thing the narrow reading rail shows. */
const Num = ({ p, active }: { p: PrView; active: boolean }) => (
  <span className={`hidden font-mono text-micro font-medium tabular-nums reading:block ${active ? 'text-accent-text' : 'text-fg-3'}`}>#{p.number}</span>
)

/** The line under a title: where (passed in), size, outdated, threads, age. */
function Facts({ p, now, seen, children }: { p: PrView; now: number; seen?: number; children: ReactNode }) {
  return (
    <span className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-meta text-fg-3">
      {children}
      <span className="shrink-0 font-mono tabular-nums"><span className="text-ok-text">+{p.additions}</span> <span className="text-fail-text">−{p.deletions}</span></span>
      {p.behindBase && <span className="shrink-0 rounded-full bg-wait/10 px-1.5 font-medium text-wait-text" title="The PR below moved past this one: needs a smart rebase">outdated</span>}
      {/* threads waiting on you in amber; ones you already answered, quietly */}
      {p.mine && !!(p.awaiting ?? p.unresolved) && (
        <span className="flex items-center gap-0.5 rounded-full bg-wait/10 px-1.5 font-medium text-wait-text" title={`${p.awaiting ?? p.unresolved} waiting on you · ${p.unresolved} open`}>
          <MessageSquareWarning className="size-3" />{p.awaiting ?? p.unresolved}
        </span>
      )}
      {p.mine && p.awaiting === 0 && !!p.unresolved && (
        <span className="flex items-center gap-0.5 rounded-full bg-fill/70 px-1.5 font-medium text-fg-3" title={`${p.unresolved} open, all answered by you`}>
          <MessageSquareWarning className="size-3" />{p.unresolved}
        </span>
      )}
      {!!p.background && <span className="flex shrink-0 items-center gap-1 rounded-full bg-ok/10 px-1.5 font-medium text-ok-text" title={`${p.background} running in the background (open it to see what)`}><span className="size-1.5 animate-pulse rounded-full bg-ok" />{p.background} bg</span>}
      {/* one time: when you last opened it (in Recent), else how old it is */}
      {seen ? <span className="ml-auto shrink-0 tabular-nums text-fg-3" title="When you last opened it">opened {short(new Date(seen).toISOString(), now)} ago</span>
        : <span className="ml-auto shrink-0 tabular-nums">{short(p.mine ? p.updatedAt : p.firstSeenAt, now)}</span>}
    </span>
  )
}

/**
 * Review what you picked, as planned: PRs in one stack go bottom first, each after the review below it (it reads the
 * code under it as already reviewed); everything else side by side, within the parallel limit. Or all at once.
 */
function ReviewBar({ prs, picked, onPick, toast }: { prs: PrView[]; picked: string[]; onPick: (ids: string[]) => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [together, setTogether] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!picked.length) return null
  const plan = reviewPlan(picked, prs), chained = plan.some((s) => s.length > 1)
  const stacks = together ? plan.flat().map((id) => [id]) : plan
  const num = (id: string) => `#${prs.find((p) => p.id === id)?.number ?? '?'}`
  const run = () => {
    setBusy(true)
    api('/review/run', { stacks }).then(() => { toast(`Reviewing ${picked.length === 1 ? num(picked[0]) : `${picked.length} PRs`}`); onPick([]); setTogether(false) }, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false))
  }
  return (
    <div className="shrink-0 animate-[toast-in_200ms_var(--ease-snappy)] border-t border-line bg-white/80 p-2.5 backdrop-blur reading:hidden dark:bg-zinc-900/80">
      {picked.length > 1 && (
        <div className="mb-2 space-y-1.5 rounded-xl bg-accent/6 p-2.5 ring-1 ring-accent/15">
          <p className="text-small font-semibold text-accent-text">{stacks.length === 1 ? 'One stack, bottom first' : `${stacks.length} side by side`}</p>
          <ol className="space-y-1">{stacks.map((s) => (
            <li key={s.join()} className="flex flex-wrap items-center gap-1 font-mono text-meta">
              {s.map((id, i) => <span key={id} className="flex items-center gap-1">{i > 0 && <span className="text-fg-3">→</span>}<span className="rounded-md bg-surface-1 px-1.5 py-px ring-1 ring-line-strong">{num(id)}</span></span>)}
            </li>
          ))}</ol>
          {chained && <p className="text-meta leading-snug text-fg-2 ">{together ? 'All at once: none waits for another.' : 'In a stack each review starts once the one below it is done.'}</p>}
          {chained && <button onClick={() => setTogether(!together)} className="rounded-lg px-2 py-1 text-meta font-medium text-fg-3 ring-1 ring-line-strong transition-colors hover:text-accent-text hover:ring-accent/30">{together ? 'Bottom first instead' : 'All at once instead'}</button>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={run} disabled={busy} className="group flex flex-1 items-center justify-center gap-1.5 btn-primary btn-lg shadow-sm transition-all disabled:pointer-events-none disabled:opacity-40">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}Review {picked.length === 1 ? num(picked[0]) : `${picked.length} PRs`}
        </button>
        <button onClick={() => { onPick([]); setTogether(false) }} className="rounded-xl px-2.5 py-2 text-small font-medium text-fg-3 transition-colors hov hover:text-fg-1">Clear</button>
      </div>
    </div>
  )
}

/** What this PR's agent waits on you for, under its title: the list says it, so you needn't open the PR to know. */
function Asks({ p }: { p: PrView }) {
  const line = p.job && p.job.state !== 'running' && p.job.state !== 'queued' ? askLine(p.job.next) : undefined
  return line ? <span className="mt-0.5 block truncate text-meta text-wait-text" title={line}>Asks: {line}</span> : null
}
