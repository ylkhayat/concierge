import { Clock, Coins, GitPullRequestArrow, PanelLeftClose, PanelLeftOpen, Rocket, Settings2, Map as MapIcon, Wallet, LoaderCircle, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Avatar, ordered, PrList, tabOf, waiting, type Tab } from './components/PrList.tsx'
import { AccountNow, Load, LoadRibbon } from './components/Load.tsx'
import { Standup } from './components/Standup.tsx'
import { SkillsWorkspace } from './components/SkillsWorkspace.tsx'
import { PlansWorkspace } from './components/PlansWorkspace.tsx'
import { DesignWorkspace } from './components/DesignWorkspace.tsx'
import { Today } from './components/Today.tsx'
import { Palette } from './components/Palette.tsx'
import { Toaster, toast as sonner } from 'sonner'
import { AlertDock } from './components/Alerts.tsx'
import { usePinNotifications } from './components/PinButton.tsx'
import type { Alert } from '../server/alerts.ts'
import type { Prep } from '../server/plan.ts'
import { label, sha, VERSION } from './version.ts'
import { SettingsDialog, ThemeButton, UpdateChip, type SettingsTab } from './components/Settings.tsx'
import { Onboarding } from './components/Onboarding.tsx'
import { ExecList, groupOf, orderedTickets } from './components/ExecList.tsx'
import { PrThread } from './thread/PrThread.tsx'
import { TicketThread } from './thread/TicketThread.tsx'
import { ROLES, currentRole, setRole, useRole, type Role } from './role.ts'
import { setAway, useAway } from './away.ts'
import { setMachineNames } from './machineNames.ts'
import { scopeDefault } from './scope.ts'
import { AwayRepo, HeldBanner, NotHere } from './components/NotHere.tsx'
import { useHeld } from './held.ts'
import { RoleSwitch } from './components/RoleSwitch.tsx'
import { RepoList } from './components/RepoList.tsx'
import { ExecHome } from './components/ExecHome.tsx'
import { RepoPicker } from './components/RepoPicker.tsx'
import { knowApps } from './appColor.ts'
import { Activity, lazy, Suspense } from 'react'
import { useWebMcp } from './webmcp.ts'
import { Machine, ScopeSwitch } from './components/Machine.tsx'
import { stackAt } from './desk.ts'
import { StackPage } from './thread/StackPage.tsx'
import { focusBlock, useDeskTime } from './deskTime.ts'
import { useNewVersion } from './fresh.ts'
import { deckKey, designOn, designViewOf, readPlace, workspaceFor, type DesignFrom, type DesignView, type Mode, type Place, type Visuals } from './modes.ts'

// the graph libraries load only when the codebase view opens
const CodebaseView = lazy(() => import('./components/Codebase.tsx'))
import { ago, api, critUrl, enc, isTyping, param, prefetchFeed, setParam, useDeck, useNow, useTheme, type PrView, type TicketView } from './lib.ts'
import { inSettings, SAY } from './copy.ts'
import { viewLabel, viewsFor } from './views.ts'
import { shortcuts } from './shortcuts.ts'

const readHash = () => decodeURIComponent(location.hash.slice(1)) || undefined
type Toast = { tone: 'ok' | 'error' }

// a view with a list and what is open beside it (Review, Ship): the same column and the same wait in both
const LIST_COL = 'w-full shrink-0 flex-col border-r border-line lg:flex lg:w-[320px] 2xl:w-[360px]'
const ListSkeleton = () => <div className="space-y-2 p-3 pt-14">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[52px] animate-pulse rounded-ctl bg-fill/50" style={{ animationDelay: `${i * 120}ms` }} />)}</div>

const modeOf = (): Mode => {
  const p = location.pathname
  return p.startsWith('/ship') || p.startsWith('/exec') ? 'exec' : p.startsWith('/standup') ? 'standup' : p.startsWith('/skills') ? 'skills' : p.startsWith('/plans') ? 'plans' : p.startsWith('/design') ? 'design'
    : 'review'
}
// each view keeps its place (the open item, the filter), per browser: back on it, from the rail, another role or a
// bare address, it is as you left it
const placeOf = (key: string): Place => { try { return readPlace(localStorage.getItem(`place:${key}`)) } catch { return {} } }
const keepPlace = (key: string, p: Place) => { try { localStorage.setItem(`place:${key}`, JSON.stringify(p)) } catch { /* private window */ } }
/** The open item a view comes back to (the codebase map is Review's own place, never another view's). */
const backTo = (m: Mode) => { const s = placeOf(m).selected; return s?.startsWith('codebase:') ? undefined : s }
/**
 * The view to open on, agreeing with the role (the rail shows that role's views): a bare address opens the role's own,
 * where you last were in it (its view and its open item); a link to a view of another role (a PR link, /ship, while
 * you read as PM) opens it and takes that role, so the rail and the view never disagree (the rail said PM while Review
 * showed).
 */
const firstMode = (): Mode => {
  const m = modeOf(), r = currentRole(), rail = ROLES[r].rail
  if (location.pathname === '/' && !location.hash) {
    let last: string | null = null; try { last = localStorage.getItem(`mode:${r}`) } catch { /* none kept */ }
    const own = (last && rail.includes(last) ? last : rail[0]) as Mode, sel = backTo(own)
    history.replaceState(history.state, '', PATH[own] + location.search + (sel ? `#${enc(sel)}` : ''))
    return own
  }
  if (rail.includes(m)) return m
  const other = (Object.keys(ROLES) as Role[]).find((x) => !ROLES[x].pending && ROLES[x].rail.includes(m))
  if (other) setRole(other)
  return m
}
// links from before Ship was named (/exec) still open it, and the address bar says /ship
if (location.pathname.startsWith('/exec')) history.replaceState(history.state, '', `/ship${location.pathname.slice(5)}${location.search}${location.hash}`)
// the Desk is gone, and Read and Focus are the phone's (src/mobile): their links open Review, on the PR they named
if (/^\/(read|focus)\b/.test(location.pathname)) history.replaceState(history.state, '', `/review${location.search}${location.hash}`)
if (location.pathname.startsWith('/desk')) history.replaceState(history.state, '', `/review${location.search}${location.hash}`)
const designPath = (v: DesignView) => (v === 'map' ? '/design' : `/design/${v}`)
const PATH: Record<Mode, string> = { review: '/review', exec: '/ship', read: '/read', focus: '/focus', standup: '/standup', skills: '/skills', plans: '/plans', design: '/design' }

export function App() {
  // each window keeps its own mode: /exec is Exec, everything else Review
  const [mode, setModeState] = useState<Mode>(firstMode)
  const [selected, setSelected] = useState(readHash)
  const [picked, setPicked] = useState<string[]>([])
  const [pickedPrs, setPickedPrs] = useState<string[]>([]) // Review's picks, for a planned batch of reviews
  const [query, setQueryState] = useState(() => param('q') ?? '')
  const setQuery = (q: string) => { setQueryState(q); setParam('q', q) }
  const [refreshing, setRefreshing] = useState(false)
  // Design's view (its map, its components, its tokens), from the address
  const [designView, setDesignView] = useState<DesignView>(() => designViewOf(location.pathname))
  // the open item's feed, known from this render's board (modes.ts)
  const { me, prs: allPrs, health, connected, feedOf, exec, alerts } = useDeck((b) => deckKey(mode, selected, (id) => !!b?.tickets.some((t) => t.id === id), designView))
  const now = useNow()
  const [theme, setTheme] = useTheme()
  const role = useRole()
  // another role: its own workspaces, back where you were in them. Before paint: in an effect, one frame showed the
  // new role's rail over the old role's view
  const roleWas = useRef(role)
  useLayoutEffect(() => {
    if (roleWas.current === role) return
    roleWas.current = role
    let last: string | null = null; try { last = localStorage.getItem(`mode:${role}`) } catch {}
    const rail = ROLES[role].rail
    setMode((last && rail.includes(last) ? last : rail[0]) as Mode)
  }, [role]) // eslint-disable-line react-hooks/exhaustive-deps
  const PrPage = PrThread, TicketPage = TicketThread
  // first run (nothing configured) shows onboarding; Settings can reopen it later
  // set up before: draw the app at once instead of waiting on /setup (it is checked again right after)
  const [configured, setConfigured] = useState<boolean | undefined>(() => { try { return localStorage.getItem('configured') === '1' || undefined } catch { return undefined } })
  useEffect(() => { try { if (configured !== undefined) localStorage.setItem('configured', configured ? '1' : '0') } catch {} }, [configured])
  const [setupOpen, setSetupOpen] = useState(false)
  // false when closed, else the tab to open on
  const [settingsOpen, setSettingsOpenState] = useState<SettingsTab | false>(() => (param('settings') as SettingsTab) ?? false)
  const setSettingsOpen = (t: SettingsTab | false) => { setSettingsOpenState(t); setParam('settings', t || null) }
  // anything can open Settings at a tab (the Next panel's "Change what's suggested")
  useEffect(() => { const f = (e: Event) => setSettingsOpen((e as CustomEvent<SettingsTab>).detail); addEventListener('concierge:settings', f); return () => removeEventListener('concierge:settings', f) }, [])
  const [repos, setRepos] = useState<string[]>([])
  const [visuals, setVisuals] = useState<Visuals>() // where Design is on (Settings → Repositories)
  const [spaces, setSpaces] = useState<Mode[]>(['review', 'exec'])
  const views = viewsFor(role, spaces) // this role's views: the rail, ⌘K and the g keys all read it
  const [linearApp, setLinearApp] = useState(false)
  const [missing, setMissing] = useState<string[]>([]) // skills the settings run that this machine lacks
  const [machines, setMachines] = useState(0)
  // opened on this machine's localhost: its own view; through the tailnet link: the whole fleet (scope.ts)
  useEffect(() => { if (me && machines) scopeDefault(!!me.viewer?.here, machines > 1) }, [me, machines])
  useEffect(() => { api('/setup?light=1').then((s) => { setConfigured(s.configured); setAway(s.away, s.clones); setMachineNames(s.machineNames); setMachines(s.machines?.length ?? 0); setRepos(Object.keys(s.config.repos)); setVisuals(s.config.visuals ?? {}); setSpaces(s.config.workspaces); setLinearApp(s.config.linearDesktop); setMissing(s.needed.filter((x: { found: boolean }) => !x.found).map((x: { name: string }) => x.name)) }, () => setConfigured(true)) }, [configured, setupOpen, settingsOpen])
  // Linear links open in the desktop app: linear://<same path>. One listener covers every link on the page.
  useEffect(() => {
    if (!linearApp) return
    const open = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href^="https://linear.app/"]') as HTMLAnchorElement | null
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return // modified clicks keep the browser
      e.preventDefault()
      location.href = a.href.replace(/^https:\/\/linear\.app\//, 'linear://')
    }
    addEventListener('click', open, true)
    return () => removeEventListener('click', open, true)
  }, [linearApp])

  // quick confirmations ("Copied", "Run queued"): sonner, like the alerts
  const toast = (msg: string, tone: Toast['tone'] = 'ok') => { if (tone === 'ok') sonner.success(msg); else sonner.error(msg) }

  const away = useAway() // this machine's view: repositories not on it, whose PRs and tickets aren't listed or opened here
  const held = useHeld() // repositories no machine can work on now, and why
  const prs = away.size && allPrs ? allPrs.filter((p) => !away.has(p.repo) || p.id === selected) : allPrs
  const select = (id?: string) => {
    if (id === selected) return
    // switching items: at once, in the frame of the click. A crossfade (a view transition on the detail pane) waited
    // a frame for its snapshot and then held the new page under a ~300ms fade; the row lit before the page did
    setSelected(id)
    // the query (tabs, view, focus…) stays; a tour step belongs to the PR it was on
    const u = new URL(location.href); u.searchParams.delete('step'); u.hash = id ? enc(id) : ''
    history.replaceState(null, '', u)
  }
  useEffect(() => { const f = () => { setTab(undefined); setSelected(readHash()) }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])

  // the place is kept as it changes, whichever way you leave (the rail, a link to a PR or ticket, Back), not only
  // from the rail: going back finds the item you last had open, not an older one
  const codebaseNow = mode === 'review' && selected?.startsWith('codebase:')
  useEffect(() => { keepPlace(codebaseNow ? 'codebase' : mode, { selected, query }) }, [mode, codebaseNow, selected, query])
  const setMode = (m: Mode, view?: DesignView) => {
    try { localStorage.setItem(`mode:${role}`, m) } catch {}
    // Design's views share its place (the project open), each its own address
    if (m === 'design' && view && view !== designView) {
      setDesignView(view)
      if (m === mode) { history.pushState(null, '', designPath(view) + location.search + location.hash); return }
    }
    if (m === mode && !codebaseRepo) return
    const back = placeOf(m), sel = backTo(m)
    history.pushState(null, '', (m === 'design' ? designPath(view ?? designView) : PATH[m]) + location.search + (sel ? `#${enc(sel)}` : ''))
    // at once, in one render: the view, its item and its filter together. A crossfade (a view transition) held the
    // old view on screen while the new one drew; the new view has its own entrance (below)
    setModeState(m); setSelected(sel); setQuery(back.query ?? '')
  }
  useEffect(() => { const f = () => { setModeState(modeOf()); setDesignView(designViewOf(location.pathname)); setSelected(readHash()) }; addEventListener('popstate', f); return () => removeEventListener('popstate', f) }, [])

  // exec mode: the selected ticket and the feed of its latest run
  const tickets = (exec?.tickets ?? []).filter((t) => !t.repo || !away.has(t.repo) || t.id === selected)
  const ticket = mode !== 'review' ? tickets.find((t) => t.id === selected) : undefined // its feed: its whole timeline, every run a chapter
  // the last pages opened, kept alive hidden (Activity, below): back on one, it is there as you left it (ponytail: 4)
  const [recentT, setRecentT] = useState<string[]>([])
  useEffect(() => { if (ticket) setRecentT((r) => [ticket.id, ...r.filter((x) => x !== ticket.id)].slice(0, 4)) }, [ticket?.id])
  const recentTickets = recentT.map((id) => tickets.find((t) => t.id === id)).filter((t): t is TicketView => !!t)
  // the focus: which application you are working on, shared by every workspace (Review, Ship, Codebase); per browser
  const [focus, setFocusState] = useState<string | undefined>(() => { try { return param('focus') || localStorage.getItem('focus') || localStorage.getItem('exec-repo') || undefined } catch { return param('focus') } })
  const setFocus = (r?: string) => { setFocusState(r); setParam('focus', r); try { if (r) localStorage.setItem('focus', r); else localStorage.removeItem('focus') } catch { /* private window */ } }
  const focusRepos = [...new Set([...repos, ...tickets.map((t) => t.repo).filter(Boolean) as string[]])]
  // Design shows where it is on: arriving on a workspace where it is off moves to one where it is on, leaving goes back
  // (modes.ts). Before paint, so the view never draws in the workspace it is leaving
  const shownIn = useRef<Mode>(undefined)
  useLayoutEffect(() => {
    if (!visuals) return // known once /setup answers
    const cameFrom = shownIn.current; shownIn.current = mode
    let kept: DesignFrom | undefined
    try { const k = JSON.parse(localStorage.getItem('design-from') ?? 'null'); if (typeof k?.picked === 'string') kept = k } catch { /* none kept */ }
    const next = workspaceFor(mode, cameFrom, focus, repos, visuals, kept)
    try { if (next.from) localStorage.setItem('design-from', JSON.stringify(next.from)); else localStorage.removeItem('design-from') } catch { /* private window */ }
    if (next.focus !== focus) setFocus(next.focus)
  }, [mode, visuals]) // eslint-disable-line react-hooks/exhaustive-deps
  // in Design the picker offers the workspaces it is on in (and the one you are in)
  const pickable = mode === 'design' && focusRepos.some((r) => designOn(visuals, r)) ? focusRepos.filter((r) => designOn(visuals, r) || r === focus) : focusRepos
  knowApps(focusRepos) // each app its own colour in the lists
  // the focused repo's tickets; the open one always stays listed, even from a link into another repo
  const scoped = focus ? tickets.filter((t) => t.repo === focus || t.id === selected) : tickets
  const execList = mode === 'exec' ? orderedTickets(scoped, query) : []
  const execWaiting = tickets.filter((t) => !t.dimmed && !t.aside && ['needs-you', 'tend'].includes(groupOf(t).id)).length // dimmed or set aside: not now
  const runPicked = (stacks?: string[][], note?: string, prep?: Prep, mode?: 'one-pr') =>
    api('/exec', { ids: picked, stacks, note, prep, mode }).then((r: { stacks: string[][]; prep?: Prep; merge?: boolean }) => {
      toast(mode ? `One agent works ${picked.length} together into one PR${r.merge ? ', merged once checks pass' : ''}` : r.prep ? `A short prep for ${r.prep.ids.join(', ')} first, then all ${picked.length} at once` : picked.length > 1 ? `Running all ${picked.length} at once: ${r.stacks.map((s) => s.join(' → ')).join('  ·  ')}` : `Running ${picked[0]}`)
      select(picked[0]); setPicked([])
    }, (e: Error) => toast(e.message, 'error'))


  const [pickedTab, setTabState] = useState<Tab | undefined>(() => { const l = param('list'); return l === 'review' || l === 'mine' ? l : undefined }) // a link with another value falls back, it never breaks the page
  const setTab = (t?: Tab) => { setTabState(t); setParam('list', t) }
  const pr = mode !== 'exec' ? prs?.find((p) => p.id === selected) : undefined
  const [recentP, setRecentP] = useState<string[]>([])
  useEffect(() => { if (pr) setRecentP((r) => [pr.id, ...r.filter((x) => x !== pr.id)].slice(0, 4)) }, [pr?.id])
  const recentPrs = recentP.map((id) => prs?.find((p) => p.id === id)).filter((p): p is PrView => !!p)
  // "codebase:owner/repo" selects the codebase view instead of a PR
  const codebaseRepo = mode === 'review' && selected?.startsWith('codebase:') ? selected.slice('codebase:'.length) : undefined
  // "stack:<any of its PRs>" selects the stack itself: found from that PR as the stack is now, so a link survives restacking
  const stack = selected?.startsWith('stack:') && prs ? stackAt(prs, tickets, selected.slice('stack:'.length)) : undefined
  const stackPage = stack && <Detail key={stack.key}><StackPage stack={stack} prs={prs ?? []} waiting={waiting} onSelect={(id) => goPr(id)} onTicket={(id) => goTicket(id)} toast={toast} /></Detail>
  const detailOpen = !!pr || !!codebaseRepo || !!ticket || !!stack
  // the list follows the open PR (link, notification, hash) until you pick a tab yourself
  const tab = pickedTab ?? (pr ? tabOf(pr) : stack?.members[0] ? tabOf(stack.members[0]) : 'review')
  // Review under the focus: its PRs (the open one stays listed, even from a link into another repo)
  const focusedPrs = prs && focus ? prs.filter((p) => p.repo === focus || p.id === selected || stack?.members.includes(p)) : prs
  const list = focusedPrs ? ordered(focusedPrs, query, tab) : []
  const needsYou = prs?.filter(waiting).length ?? 0
  // the items either side of the open one, read ahead once the page is idle: j / k (or the next row down) opens them
  // whole instead of empty for the time the fetch takes (a row the pointer rests on is read ahead by its list)
  const listIds = mode === 'exec' ? execList.map((t) => t.id) : mode === 'review' ? list.map((p) => p.id) : []
  const at = listIds.indexOf(selected ?? '')
  const around = at < 0 ? '' : [listIds[at - 1], listIds[at + 1]].filter(Boolean).join(' ')
  useEffect(() => {
    if (!around) return
    const go = () => { for (const id of around.split(' ')) prefetchFeed(mode === 'exec' ? `ticket:${id}` : id) }
    if (typeof requestIdleCallback === 'undefined') { const t = setTimeout(go, 300); return () => clearTimeout(t) }
    const t = requestIdleCallback(go, { timeout: 1000 })
    return () => cancelIdleCallback(t)
  }, [around, mode])
  // the desk: one unit (a stack, a ticket with its PRs, a lone PR) at a time, under the same focus
  const newer = useNewVersion()
  // once per build: say what you're on now, so you know an update reached you
  useEffect(() => {
    try {
      const was = localStorage.getItem('deck-version')
      if (was && was !== VERSION && VERSION !== 'dev') toast(`Updated to ${label(VERSION)}`)
      localStorage.setItem('deck-version', VERSION)
    } catch { /* no storage: nothing to compare */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useDeskTime() // a topic put off, a focus block started or over
  // explanations on PRs waiting on you: what Read's badge counts
  useEffect(() => { if ((mode === 'review' || mode === 'exec') && !spaces.includes(mode)) setMode(spaces[0]) }, [spaces.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // re-themes the whole page, dialogs and popovers too: each workspace has its accent hue (index.css)
  useEffect(() => { document.documentElement.dataset.mode = codebaseRepo ? 'codebase' : mode }, [mode, codebaseRepo])
  useEffect(() => {
    const n = mode === 'exec' ? execWaiting : needsYou
    document.title = `${n ? `(${n}) ` : ''}${codebaseRepo ? 'Codebase' : viewLabel(mode, designView)} · Concierge`
  }, [needsYou, execWaiting, mode, designView, codebaseRepo])

  // g then r / e / s / c: to a view; g then h: the open PR on GitHub
  const chord = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('dialog[open]')) return // a modal is up: Esc closes it, list keys wait
      if (isTyping(e)) { if (e.key === 'Escape') (e.target as HTMLElement).blur(); return }
      // the list keys belong to the views that have a list: elsewhere they would open a PR behind the view
      const listed = (mode === 'review' && !codebaseRepo) || mode === 'exec'
      const ids = mode === 'exec' ? execList.map((t) => t.id) : list.map((p) => p.id)
      const i = ids.indexOf(selected ?? '')
      const filter = document.querySelector<HTMLInputElement>('input[data-filter]')
      if (listed && ids.length && (e.key === 'j' || e.key === 'ArrowDown')) select(ids[Math.min(i + 1, ids.length - 1)])
      else if (listed && ids.length && (e.key === 'k' || e.key === 'ArrowUp')) select(ids[Math.max(i - 1, 0)])
      else if (e.key === '/' && filter) filter.focus()
      else if (pr && e.key === 'o') { const u = critUrl(pr); if (u) open(u, '_blank') }
      else if (chord.current && Date.now() - chord.current < 900 && (e.key === 'h' || e.key === 'c' || views.some((v) => v.chord === e.key))) {
        // g then a view's key: only the views this role has (views.ts), so the rail always shows where you are
        chord.current = 0
        const to = views.find((v) => v.chord === e.key)
        if (e.key === 'h') { if (pr?.url) open(pr.url, '_blank') } else if (e.key === 'c') { if (role === 'developer') goCodebase() } else if (to) setMode(to.mode, to.design)
      }
      else if (e.key === 'g') chord.current = Date.now()
      else if (pr?.job && e.key === 'r') api(`/prs/${enc(pr.id)}/resume-terminal`, {}).then(() => toast('Opened the session in Terminal'))
      else if (e.key === 'Escape' && !document.querySelector(':popover-open')) select(undefined)
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const refresh = () => { setRefreshing(true); api('/poll', {}).finally(() => setRefreshing(false)) }

  const openSettings = () => setSettingsOpen(mode === 'exec' ? 'exec' : 'general')
  const goCodebase = (repo = (focus && repos.includes(focus) ? focus : undefined) ?? codebaseRepo ?? repos[0]) => {
    if (mode !== 'review') { history.pushState(null, '', '/' + location.search); setModeState('review') }
    setSelected(`codebase:${repo}`); history.replaceState(null, '', `#${enc(`codebase:${repo}`)}`)
  }
  const goTicket = (id: string) => { history.pushState(null, '', `/ship${location.search}#${enc(id)}`); setModeState('exec'); setSelected(id) }
  const goPr = (id: string) => { history.pushState(null, '', `/${location.search}#${enc(id)}`); setModeState('review'); setSelected(id) }
  useWebMcp({ prs, tickets, openPr: goPr, openTicket: goTicket }) // the agent in the browser (Gemini in Chrome) can use Concierge
  const openAlert = (a: Alert) => (a.kind === 'pr' ? goPr(a.target) : a.kind === 'ticket' ? goTicket(a.target) : undefined)
  usePinNotifications(alerts, openAlert)
  const waitingBadge = (n: number) => n > 0 && (
    <span className="flex items-center gap-1.5 rounded-full bg-wait/10 px-2.5 py-1 text-meta font-semibold text-wait-text ring-1 ring-wait/20">
      <span className="size-1.5 rounded-full bg-wait" />
      {n} waiting on you
    </span>
  )
  const paused = !!health?.traffic?.slowedUntil && health.traffic.slowedUntil > Date.now()
  const syncState = (
    // a phone: its icon or dot alone (the words for the screen reader), never a word cut in half
    <span className="flex min-w-0 items-center gap-1.5 truncate" title={paused ? `${health?.pollError ?? 'GitHub asked Concierge to slow down'}. GitHub counts every client of your account (your agents' gh too); Concierge asked it ${health?.traffic?.lastMinute ?? 0} times in the last minute${health?.traffic?.refused ? `, and it refused ${health.traffic.refused.what}` : ''}.` : health?.pollError}>
      {!connected ? <><WifiOff className="size-3.5 shrink-0 text-fail-text" /><span className="max-sm:sr-only">reconnecting</span></>
        // GitHub asked to slow down: a pause that ends by itself, not a failure
        : paused ? <><Clock className="size-3.5 shrink-0 text-wait-text" /><span className="max-sm:sr-only">GitHub paused until {new Date(health!.traffic!.slowedUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></>
        : health?.pollError ? <><TriangleAlert className="size-3.5 shrink-0 text-fail-text" /><span className="max-sm:sr-only">GitHub sync failed</span></>
        : health?.polling ? <><LoaderCircle className="size-3.5 shrink-0 animate-spin" /><span className="max-sm:sr-only">syncing</span></>
        : <><span className="size-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_rgb(16_185_129/0.15)]" /><span className="max-sm:sr-only">synced {ago(mode === 'exec' ? exec?.at : health?.lastPollAt, now)}</span></>}
    </span>
  )
  const refreshBtn = (
    <button onClick={mode === 'exec' ? () => { setRefreshing(true); api('/exec/poll', {}).finally(() => setRefreshing(false)) } : refresh} title={mode === 'exec' ? 'Refresh from Linear' : 'Refresh from GitHub'} aria-label="Refresh" className="group rounded-chip p-1 transition-colors hover:bg-hover hover:text-fg-1">
      <RefreshCw className={`size-3.5 transition-transform duration-500 ${refreshing ? 'animate-spin' : 'group-hover:rotate-90'}`} />
    </button>
  )

  // the two workspaces: Review reads and judges (list + detail), Exec ships (board + console)
  // what the focus picker counts: the current workspace's work in each application
  // which application the open item is in: switching to another one closes it, so the new one's list (empty or not) is what shows
  // (Design's too: a blueprint is `repo:<repo>`, a ticket `ticket:<id>`)
  const repoOfSelected = () => selected?.startsWith('codebase:') ? selected.slice(9) : selected?.startsWith('repo:') ? selected.slice(5)
    : (prs ?? []).find((p) => p.id === selected?.replace(/^stack:/, ''))?.repo ?? tickets.find((t) => t.id === selected?.replace(/^ticket:/, ''))?.repo
  // what HeldBanner says: in the workspaces that show an application's work, the open item's application, else the
  // focused one, else every one held (a repository away from this machine has its own page instead)
  const heldInView = (): [string, string][] => {
    if (!['review', 'exec', 'focus', 'read'].includes(mode)) return []
    const r = repoOfSelected() ?? focus
    const list = r ? (held[r] ? [r] : []) : Object.keys(held)
    return list.filter((x) => !away.has(x) && (!focusRepos.length || focusRepos.includes(x))).map((x) => [x, held[x]])
  }
  const focusCounts = pickable.map((r) => mode === 'exec'
    ? { repo: r, tickets: tickets.filter((t) => t.repo === r).length, waiting: tickets.filter((t) => t.repo === r && ['needs-you', 'tend'].includes(groupOf(t).id)).length, away: away.has(r), held: held[r] }
    : { repo: r, tickets: (prs ?? []).filter((p) => p.repo === r).length, waiting: (prs ?? []).filter((p) => p.repo === r && waiting(p)).length, away: away.has(r), held: held[r] })
  // the rail's pill sits behind the active workspace (its icon and its name), and glides to the next one on a switch;
  // measured again whenever the rail's contents move (the focus picker loading, a badge, a resize)
  const railRef = useRef<HTMLElement>(null), pillRef = useRef<HTMLSpanElement>(null)
  // the sidebar: icons only, or wide with names (kept per browser); either way the role, then the application, then
  // the role's workspaces
  // the rail: icons only, or open with the modes, the application and the workspaces by name (its toggle sits at the
  // top, beside the mode); kept per browser
  const [wide, setWideState] = useState(() => { try { return localStorage.getItem('rail-wide') === '1' } catch { return false } })
  const setWide = (w: boolean) => { setWideState(w); try { localStorage.setItem('rail-wide', w ? '1' : '0') } catch {} }
  const W = (narrow: string, w: string) => (wide ? w : narrow)
  const Head = ({ children }: { children: string }) => wide ? <span className="hidden px-2.5 pb-0.5 pt-2 label text-fg-4 md:block">{children}</span> : null
  const [pill, setPill] = useState<{ top: number; height: number }>()
  const measurePill = () => {
    // layout pixels (offsetTop), not the screen's: the page is scaled with CSS zoom, which getBoundingClientRect includes
    const on = railRef.current?.querySelector<HTMLElement>('[data-rail="on"]')
    const next = on && on.offsetParent === railRef.current ? { top: on.offsetTop, height: on.offsetHeight } : undefined
    setPill((p) => (p?.top === next?.top && p?.height === next?.height ? p : next))
  }
  useLayoutEffect(measurePill)
  useEffect(() => { const t = setTimeout(measurePill, 320); return () => clearTimeout(t) }, [wide]) // after the width settles
  useEffect(() => {
    if (!railRef.current) return
    const o = new ResizeObserver(measurePill)
    o.observe(railRef.current)
    for (const c of railRef.current.children) o.observe(c)
    return () => o.disconnect()
  }, [])
  const rail = (
    // on a phone: a tab bar along the bottom, clear of the home bar; from md up the rail on the left
    <nav ref={railRef} aria-label="Views" style={{ viewTransitionName: 'rail' }}
         className={`fixed inset-x-0 bottom-0 z-40 flex h-[calc(58px+env(safe-area-inset-bottom))] items-stretch justify-around border-t border-line bg-surface-2/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:relative md:h-auto md:shrink-0 md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:bg-bg-rail md:py-3 md:backdrop-blur-none md:transition-[width] md:duration-300 md:ease-[var(--ease-snappy)] ${W('md:w-[60px] md:items-center md:px-0', 'md:w-[232px] md:items-stretch md:px-2')}`}>
      {/* the role heads the rail: the workspaces below are that role's own */}
      <span className="hidden md:contents"><RoleSwitch wide={wide} onJoin={() => setSettingsOpen('roles')} /><span className={`my-1.5 hidden h-px bg-line md:block ${W('w-10', 'mx-2')}`} /></span>
      {/* then the focus (which application); the workspaces below are what you do in it */}
      {focusRepos.length > 1 && (
        <span className="hidden md:contents">
          <Head>Repositories</Head>
          <RepoPicker wide={wide} value={focus} repos={focusCounts} total={mode === 'exec' ? tickets.length : prs?.length ?? 0} unit={mode === 'exec' ? 'ticket' : 'PR'}
                      onChange={(r) => { setFocus(r); if (codebaseRepo && r) select(`codebase:${r}`); else if (r && selected && repoOfSelected() !== r) select(undefined) }} />
          <span className={`my-2 hidden h-px bg-line md:block ${W('w-10', 'mx-2')}`} />
        </span>
      )}
      <Head>Views</Head>
      {/* the role's views (views.ts); one accent pill slides to the active one (railPill) */}
      <span ref={pillRef} aria-hidden className={`pointer-events-none absolute hidden sel rounded-ctl ${W('left-1/2 w-10 -translate-x-1/2', 'inset-x-2')} transition-[top,height,opacity] duration-300 ease-[var(--ease-spring)] md:block`} style={{ top: pill?.top, height: pill?.height, opacity: pill ? 1 : 0 }} />
      {views.map((v) => ({ m: v.mode, Icon: v.icon, label: v.label, hint: v.hint, view: v.design, chord: v.chord, n: v.mode === 'review' ? needsYou : v.mode === 'exec' ? execWaiting : 0 }))
        .map(({ m, Icon, label, n, hint, view, chord }) => {
        const on = mode === m && !(m === 'review' && codebaseRepo) && (!view || view === designView)
        return (
          <button key={view ? `design:${view}` : m} data-rail={on ? 'on' : undefined} onClick={() => { setMode(m, view); if (m === 'review' && codebaseRepo) select(undefined) }} title={`${label} · ${hint}${chord ? ` (g ${chord})` : ''}`} aria-current={on}
                  className={`group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-ctl py-1 transition-[background-color,scale] duration-150 active:scale-[0.96] md:flex-none md:py-0 ${W('md:size-10', 'md:h-9 md:w-full md:flex-row md:justify-start md:gap-2.5 md:px-1')} ${on ? '' : 'md:hover:bg-hover'}`}>
            <span data-rail-icon className={`relative flex size-8 items-center justify-center transition-colors duration-150 ${on ? 'text-accent-text' : 'text-fg-3 group-hover:text-fg-1'}`}>
              <Icon className="size-[18px]" />
              {n > 0 && !wide && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-wait px-1 text-center text-micro font-semibold tabular-nums leading-4 text-white ring-2 ring-[var(--bg-rail)]">{n}</span>}
            </span>
            {/* named on a phone's tab bar; on the rail the icon alone, its name in the tooltip (the landing page's rail) */}
            <span className={`text-micro font-medium transition-colors duration-150 ${W('md:sr-only', 'md:flex-1 md:text-left md:text-small')} ${on ? 'text-accent-text' : 'text-fg-3 group-hover:text-fg-1'}`}>{label}</span>
            {n > 0 && wide && <span className="hidden rounded-full bg-wait px-1.5 text-micro font-semibold tabular-nums leading-4 text-white md:inline">{n}</span>}
          </button>
        )
      })}
      {repos.length > 0 && role === 'developer' && (
        <span className="hidden md:contents">
        <button data-rail={codebaseRepo ? 'on' : undefined} onClick={() => goCodebase()} title="Codebase map (g c)" aria-current={!!codebaseRepo} className={`group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-ctl py-1 transition-[background-color,scale] duration-150 active:scale-[0.96] md:flex-none md:py-0 ${W('md:size-10', 'md:h-9 md:w-full md:flex-row md:justify-start md:gap-2.5 md:px-1')} ${codebaseRepo ? '' : 'md:hover:bg-hover'}`}>
          <span data-rail-icon className={`flex size-8 items-center justify-center transition-colors duration-150 ${codebaseRepo ? 'text-accent-text' : 'text-fg-3 group-hover:text-fg-1'}`}>
            <MapIcon className="size-[18px]" />
          </span>
          <span className={`text-micro font-medium transition-colors duration-150 ${W('md:sr-only', 'md:text-small')} ${codebaseRepo ? 'text-accent-text' : 'text-fg-3 group-hover:text-fg-1'}`}>Codebase</span>
        </button>
        </span>
      )}
      <span className="hidden md:block md:flex-1" />
      {/* the foot: every tool in one group, one size each (the machine's load, the theme, Settings, and
          the rail's own toggle last); then you. On a phone the ribbon has the load and Settings the theme */}
      <span className={`hidden md:flex md:items-center md:gap-0.5 ${W('md:flex-col', 'md:flex-row md:px-0.5')} [&>button]:flex [&>button]:size-9 [&>button]:shrink-0 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-ctl [&>button]:p-0`}>
        <Load toast={toast} onOpen={(t) => (t.kind === 'pr' ? goPr(t.id) : t.kind === 'ticket' ? goTicket(t.id) : goCodebase(t.id))} />
        <ThemeButton theme={theme} onTheme={setTheme} />
        <button onClick={openSettings} title="Settings" aria-label="Settings" className="group text-fg-3 transition-colors hov hover:text-fg-1">
          <Settings2 className="size-4 transition-transform duration-500 group-hover:rotate-90" />
        </button>
        <button onClick={() => setWide(!wide)} title={wide ? 'Close the sidebar: icons only' : 'Open the sidebar: roles and views by name'} aria-label={wide ? 'Close the sidebar' : 'Open the sidebar'}
                className={`text-fg-4 transition-colors hov hover:text-fg-1 ${W('', 'md:ml-auto')}`}>{wide ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}</button>
      </span>
      {/* Settings on a phone's tab bar */}
      <button onClick={openSettings} aria-label="Settings" className="flex flex-1 items-center justify-center rounded-ctl p-2 text-fg-3 active:scale-95 md:hidden"><Settings2 className="size-4" /></button>
      {me && (
        <a href={`https://github.com/${me.login}`} target="_blank" rel="noreferrer" title={`${me.name ?? me.login} · Concierge ${label(VERSION)}${sha(VERSION) ? ` (commit ${sha(VERSION)})` : ''}`}
           className={`mt-1 hidden items-center gap-2.5 rounded-ctl border-t border-line pt-2.5 md:flex ${W('justify-center', 'mx-0.5 px-1.5')}`}>
          <Avatar src={me.avatar} className="size-7 shrink-0" />
          {wide && <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-fg-1">{me.name ?? me.login}</span><span className="block font-mono text-micro tabular-nums text-fg-4">Concierge {label(VERSION)}</span></span>}
        </a>
      )}
      {!me && <span title={`This tab runs Concierge ${label(VERSION)}${sha(VERSION) ? ` (commit ${sha(VERSION)})` : ''}`} className={`hidden pb-1 pt-1 font-mono text-micro tabular-nums text-fg-4 md:block ${W('text-center', 'md:px-2.5')}`}>{wide ? `Concierge ${label(VERSION)}` : label(VERSION)}</span>}
    </nav>
  )

  const reviewFrame = (
    <div className="relative flex min-h-0 flex-1">
      <aside className={`${LIST_COL} ${detailOpen ? 'hidden' : 'flex'}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-1 pt-4">
          <a href="#" onClick={(e) => { e.preventDefault(); select(undefined) }} className="text-title font-semibold tracking-tight">{codebaseRepo ? 'Codebase' : 'Review'}</a>
          {!codebaseRepo && waitingBadge(needsYou)}
        </div>
        <div className="min-h-0 flex-1">
          {/* in Codebase the left column picks the repository; elsewhere it is the PR list */}
          {codebaseRepo ? <RepoList selected={codebaseRepo} onSelect={(r) => { setFocus(r); select(`codebase:${r}`) }} now={now} version={health?.lastPollAt} />
            : focusedPrs ? <PrList prs={focusedPrs} selected={selected} onSelect={select} query={query} onQuery={setQuery} now={now} tab={tab} onTab={setTab} picked={pickedPrs} onPick={setPickedPrs} toast={toast} />
            : <ListSkeleton />}
        </div>
      </aside>
      <main data-detail className={`min-w-0 flex-1 overflow-hidden lg:block ${detailOpen ? 'block' : 'hidden'}`}>
        {codebaseRepo ? (
          <div key="codebase" className="h-full animate-[detail-in_180ms_var(--ease-snappy)]">
            <Suspense fallback={<div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-3" /></div>}>
              <CodebaseView repo={codebaseRepo} repos={repos} onRepo={(r) => select(`codebase:${r}`)} health={health} toast={toast} />
            </Suspense>
          </div>
        ) : stackPage ? stackPage : pr ? null : (
          <Today missing={missing} onSkills={() => setSettingsOpen('skills')} me={me?.name ?? me?.login} prs={focusedPrs ?? []} tickets={scoped} focus={focus} health={health} now={now} onPr={select} onTicket={goTicket} />
        )}
        {/* the last PRs opened stay alive, hidden (Activity): back on one, it is there at once, as you left it */}
        {recentPrs.map((p) => (
          <Activity key={p.id} mode={!codebaseRepo && !stackPage && p.id === pr?.id ? 'visible' : 'hidden'}>
          <Detail>
              {away.has(p.repo) ? <NotHere repo={p.repo} what="pull request" /> : <PrPage pr={p} feed={feedOf(p.id)} now={now} onBack={() => select(undefined)} toast={toast} prs={prs ?? []} onSelect={select} onOpenLinked={(l) => (l.kind === 'ticket' ? goTicket(l.id) : select(l.id))} sync={{ at: health?.lastPollAt, syncing: !!health?.polling || refreshing, onSync: refresh }} />}
          </Detail>
          </Activity>
        ))}
      </main>
    </div>
  )

  // Exec has Review's shape: tickets on the left, the open one on the right; the accent and the work differ
  const execFrame = (
    <div className="relative flex min-h-0 flex-1">
      <aside className={`${LIST_COL} ${ticket ? 'hidden' : 'flex'}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-1 pt-4">
          <a href="/ship" onClick={(e) => { e.preventDefault(); select(undefined) }} className="text-title font-semibold tracking-tight">Ship</a>
          {waitingBadge(execWaiting)}
        </div>
        <div className="min-h-0 flex-1">
          {exec && !exec.configured ? <ExecSetupHint onOpen={() => setSettingsOpen('exec')} hasKey={exec.hasKey} />
            : exec?.at ? <ExecList tickets={scoped} selected={selected} onSelect={select} picked={picked} onPick={setPicked} onRun={runPicked} missing={exec?.missing} query={query} onQuery={setQuery} now={now} toast={toast}
                          elsewhere={focus ? execWaiting - scoped.filter((t) => !t.dimmed && ['needs-you', 'tend'].includes(groupOf(t).id)).length : 0} onAllApps={() => setFocus(undefined)} />
            : <ListSkeleton />}
        </div>
      </aside>
      <main data-detail className={`@container min-w-0 flex-1 overflow-hidden lg:block ${ticket || stack ? 'block' : 'hidden'}`}>
        {stackPage ? stackPage : ticket ? null : (
          <ExecHome repo={focus} tickets={scoped} prs={prs ?? []} now={now} onTicket={select} onPr={goPr} onMap={focus && repos.includes(focus) ? () => goCodebase(focus) : undefined} />
        )}
        {recentTickets.map((t) => (
          <Activity key={t.id} mode={!stackPage && t.id === ticket?.id ? 'visible' : 'hidden'}>
          <Detail>
              {t.repo && away.has(t.repo) ? <NotHere repo={t.repo} what="ticket" /> : <TicketPage t={t} actions={exec?.actions ?? []} missing={exec?.missing} feed={feedOf(`ticket:${t.id}`)} onSelect={select} toast={toast} onOpenLinked={(l) => (l.kind === 'pr' ? goPr(l.id) : select(l.id))} sync={{ at: exec?.at, syncing: !!exec?.polling, onSync: () => void api('/exec/poll', {}).catch(() => {}) }} />}
          </Detail>
          </Activity>
        ))}
      </main>
    </div>
  )

  // after every hook: a hook below an early return changes their count between renders and crashes the page
  // until the setup is known: the page's background, not the app, so a first run never flashes the app before its onboarding
  if (configured === undefined) return <Boot />
  if (configured === false || setupOpen) {
    return (
      <>
        <Onboarding health={health} theme={theme} onTheme={setTheme} toast={toast}
                    onDone={() => { setConfigured(true); setSetupOpen(false) }}
                    onClose={configured ? () => setSetupOpen(false) : undefined} />
        <Toaster position="bottom-right" theme={theme} closeButton gap={8} visibleToasts={5} toastOptions={{ className: 'font-sans' }} />
      </>
    )
  }

  return (
    // on a phone the page stops above the tab bar and below the notch
    <div className="grain flex h-[calc(100dvh/var(--z))] bg-bg-app pb-[calc(58px+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] text-fg-1 antialiased md:pb-0">
      {rail}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* soft glow in the workspace's accent */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklch,var(--color-violet-500)_9%,transparent),transparent)]" />
        {newer !== undefined && (
          <button onClick={() => location.reload()} className="relative z-20 flex items-center gap-2.5 border-b border-accent/20 bg-accent/10 px-4 py-2 text-left text-body text-accent-text transition-colors hover:bg-accent/15">
            <RefreshCw className="size-4 shrink-0" />{newer ? `${label(newer)} is live` : 'A newer version is live'}: this tab still runs {label(VERSION)}.<span className="ml-auto font-semibold">Reload</span>
          </button>
        )}
        {/* no machine can work on what is in view: the open item's application, else the focused one, else every one held */}
        <HeldBanner held={heldInView()} />
        {health?.overBudget && (
          <div className="relative z-20 flex items-center gap-2.5 border-b border-wait/20 bg-wait/10 px-4 py-2 text-body text-wait-text">
            <Wallet className="size-4 shrink-0" />
            <span>Daily budget reached: ${health.spentToday.toFixed(2)} of ${health.settings.dailyBudgetUsd}. Queued runs wait until tomorrow or a higher cap.</span>
            <button onClick={() => setSettingsOpen('usage')} className="ml-auto rounded-ctl px-2.5 py-1 font-medium transition-colors hover:bg-wait/15">Adjust</button>
          </div>
        )}
        {/* one view at a time, drawn afresh on a switch (its entrance a short fade-in, never the old view fading out
            over it); Review and Ship share a shape, so without the key one was patched into the other */}
        <div key={mode} className="relative flex min-h-0 min-w-0 flex-1 flex-col animate-[fade-in_160ms_var(--ease-out)]">
        {focus && away.has(focus) && ['review', 'exec', 'focus', 'read'].includes(mode) ? <AwayRepo repo={focus} onAllApps={() => setFocus(undefined)} />
          : mode === 'exec' ? execFrame : mode === 'standup' ? <Standup onOpenTicket={goTicket} toast={toast} tickets={tickets} /> : mode === 'skills' ? <SkillsWorkspace toast={toast} /> : mode === 'plans' ? <PlansWorkspace toast={toast} /> : mode === 'design' ? <DesignWorkspace view={designView} selected={selected} onSelect={select} feedOf={(id) => feedOf(deckKey('design', id, () => false, designView) ?? '')} focus={focus} ticketRepo={(id) => tickets.find((t) => t.id === id)?.repo} toast={toast} /> : reviewFrame}
        </div>
        {/* the status bar: which machine, the sync, the account and spend, the load, what happened, auto; each opens upward */}
        {/* narrow, what doesn't fit slides sideways instead of being cut off */}
        <footer className="relative z-30 flex h-7 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap border-t border-line bg-bg-rail px-2 text-meta text-fg-3 max-md:overflow-x-auto max-md:[scrollbar-width:none]">
          <Machine me={me} /><ScopeSwitch />
          {syncState}{refreshBtn}
          <span className="flex-1" />
          {health && <SpendChip health={health} onOpen={() => setSettingsOpen('usage')} />}
          {/* the machine's load needs the width: below 1280 it is one click away in the rail's gauge */}
          <span className="hidden xl:contents"><LoadRibbon /></span>
          {/* a system alert (GitHub sync, memory, the Claude login) is about Concierge itself: nothing to open */}
          {/* in a focus block the alerts wait, faded, until it ends */}
          <span className={focusBlock() ? 'pointer-events-none opacity-30' : 'contents'}><AlertDock alerts={alerts} now={now} onOpen={openAlert} /></span>
          <UpdateChip onOpen={() => setSettingsOpen('machines')} />
        </footer>
      </div>

      <SettingsDialog open={!!settingsOpen} tab={settingsOpen || 'general'} onTab={(t) => setParam('settings', t)} onClose={() => setSettingsOpen(false)} health={health} theme={theme} onTheme={setTheme} toast={toast}
                      onSetup={() => setSetupOpen(true)} />
      <Palette prs={prs ?? []} tickets={tickets} onPr={goPr} onTicket={goTicket} keys={shortcuts(views, role === 'developer' && repos.length > 0)} commands={[
        ...views.map((v) => ({ id: v.key, label: `Go to ${v.label}`, hint: v.hint, run: () => setMode(v.mode, v.design) })),
        ...(role === 'developer' ? repos.map((r) => ({ id: `map:${r}`, label: `Codebase map: ${r}`, run: () => goCodebase(r) })) : []),
        { id: 'today', label: 'Today', hint: 'what waits on you', run: () => { goPr(''); select(undefined) } },
        { id: 'sync', label: SAY.refresh, hint: 'GitHub and Linear', run: refresh },
        { id: 'running', label: 'What is running', hint: 'agents, crit servers', run: () => document.getElementById('load')?.showPopover() },
        { id: 'settings', label: 'Settings', run: openSettings },
        { id: 'theme', label: `Switch to ${document.documentElement.classList.contains('dark') ? 'light' : 'dark'} theme`, run: () => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark') },
      ]} />
      <Toaster position="bottom-right" offset={{ bottom: 40, right: 16 }} theme={theme} closeButton gap={8} visibleToasts={5} toastOptions={{ className: 'font-sans' }} />
    </div>
  )
}

/** The status bar's spend: the account in use and today's spend; the full meter opens above it. */
function SpendChip({ health, onOpen }: { health: NonNullable<ReturnType<typeof useDeck>['health']>; onOpen: () => void }) {
  const cap = health.settings?.dailyBudgetUsd ?? null, today = health.spentToday
  const tone = cap != null && today >= cap ? 'text-fail-text' : cap != null && today >= cap * 0.75 ? 'text-wait-text' : 'text-fg-2'
  return (
    <>
      <button popoverTarget="spend" style={{ anchorName: '--spend' } as CSSProperties} title={health.now?.standingInFor ? `${health.now.label} takes new work in place of ${health.now.standingInFor}${health.now.why ? `: ${health.now.why}` : ''}` : 'AI spend and the account in use'}
              className="inline-flex items-center gap-1 rounded-chip px-1.5 leading-[18px] text-fg-3 transition-colors duration-150 hov hover:text-fg-1">
        {health.now && <span className={`hidden max-w-52 truncate sm:inline ${health.now.standingInFor ? 'text-wait-text' : ''}`}>{health.now.label}{health.now.standingInFor ? ` for ${health.now.standingInFor}` : ''} ·</span>}
        <span className={`tabular-nums ${tone}`}>${today.toFixed(2)}</span><span className="text-fg-4">today</span>
      </button>
      <div id="spend" popover="auto" style={{ positionAnchor: '--spend', positionArea: 'top span-left', inset: 'auto' } as CSSProperties}
           className="m-0 mb-1.5 w-72 rounded-card border-0 bg-surface-1 p-1.5 text-fg-2 shadow-e2">
        <SpendMeter health={health} onOpen={() => { document.getElementById('spend')?.hidePopover(); onOpen() }} />
      </div>
    </>
  )
}

/** AI spend at a glance: today against the daily budget, and the last 7 days. Click to set the budget. */
function SpendMeter({ health, onOpen }: { health: NonNullable<ReturnType<typeof useDeck>['health']>; onOpen: () => void }) {
  const today = health.spentToday
  const cap = health.settings?.dailyBudgetUsd ?? null
  const days = health.spendDays ?? []
  const week = days.reduce((n, d) => n + d.usd, 0)
  const pct = cap ? Math.min(100, (today / cap) * 100) : 0
  const tone = pct >= 100 ? 'bg-fail' : pct >= 75 ? 'bg-wait' : 'bg-accent'
  const peak = Math.max(...days.map((d) => d.usd), cap ?? 0, 0.01)
  return (
    <button onClick={onOpen} title={cap ? `$${today.toFixed(2)} of a $${cap} daily budget · $${week.toFixed(2)} over 7 days` : 'No daily budget: click to set one'}
            className="group w-full rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-hover">
      <div className="flex items-baseline gap-1.5 text-meta">
        <Coins className={`size-3.5 shrink-0 self-center ${pct >= 100 ? 'text-fail-text' : pct >= 75 ? 'text-wait-text' : 'text-fg-3'}`} />
        <span className="font-medium text-fg-2 ">AI spend today</span>
        <span className="ml-auto font-mono text-small font-semibold tabular-nums text-fg-1 ">${today.toFixed(2)}</span>
        <span className="font-mono text-micro tabular-nums text-fg-3">{cap != null ? `/ $${cap}` : 'no cap'}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        {cap != null ? (
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill-strong">
            <span className={`block h-full rounded-full transition-all duration-700 ease-[var(--ease-snappy)] ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
        ) : <span className="flex-1 text-micro text-fg-3 group-hover:text-accent-text">Set a daily budget</span>}
        <span className="flex h-4 shrink-0 items-end gap-[2px]" aria-hidden>
          {days.map((d, i) => (
            <span key={d.day} className={`w-1.5 rounded-sm ${i === days.length - 1 ? tone : 'bg-fill-strong'}`}
                  style={{ height: `${Math.max(12, (d.usd / peak) * 100)}%` }} title={`${d.day}: $${d.usd.toFixed(2)}`} />
          ))}
        </span>
        <span className="shrink-0 font-mono text-micro tabular-nums text-fg-3">${week.toFixed(2)} 7d</span>
      </div>
      <AccountNow now={health.now} routing={health.routing} />
    </button>
  )
}

function ExecSetupHint({ onOpen, hasKey }: { onOpen: () => void; hasKey: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-card bg-accent/10"><Rocket className="size-6 text-accent" /></span>
      <p className="text-body font-medium">Ship your Linear tickets from here</p>
      <p className="text-small text-fg-3">{hasKey ? 'Pick the command that ships a ticket (ship-tickets works out of the box) and the repository each Linear team maps to.' : `Connect Linear with your API key (${inSettings('machines')}), then pick the command that ships a ticket.`}</p>
      <button onClick={onOpen} className="btn-primary">Open Ship settings</button>
    </div>
  )
}

/** The first load, before the setup check answers: the logo, as index.html draws it before any script runs. */
const Boot = () => (
  <div className="grain flex h-dvh items-center justify-center bg-bg-app">
    <span className="flex size-11 animate-pulse items-center justify-center rounded-ctl bg-accent text-on-accent"><GitPullRequestArrow className="size-6" /></span>
  </div>
)

/** An opened PR, stack or ticket: shown at once, no entrance (switching items is instant). What it holds (the chat's
 *  turns, the vitals) would fade in as its data lands; for the page's first moments that is held back (.fresh,
 *  index.css), so it just shows. What comes in after that still fades in. */
function Detail({ children }: { children: React.ReactNode }) {
  const [fresh, setFresh] = useState(true)
  useEffect(() => { const t = setTimeout(() => setFresh(false), 1200); return () => clearTimeout(t) }, [])
  return <div className={`h-full ${fresh ? 'fresh' : ''}`}>{children}</div>
}
