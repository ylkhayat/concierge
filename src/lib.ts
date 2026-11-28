import { useCallback, useEffect, useRef, useState } from 'react'
import { chosen, useScope } from './scope.ts'
import type { Me } from '../server/github.ts'
import type { ExecView, Health, PrView, TicketView } from '../server/index.ts'
import type { Activity } from '../server/runner.ts'
import { staleNow } from './query.ts' // used only inside the stream's handlers, so the two modules may import each other
import type { Alert } from '../server/alerts.ts'
import { reachable, reachableIn, serverHost, type Reach } from './hosts.ts'

export type { Activity, ExecView, Health, Me, PrView, TicketView }

// the role this page reads as (role.ts): what a request starts runs that role's commands
const roleHeader = (): Record<string, string> => {
  const s = chosen() // this machine or the fleet, when picked in this tab (scope.ts); else the server's default
  try { const r = localStorage.getItem('role'); return { ...(r && { 'x-concierge-role': r }), ...(s && { 'x-concierge-scope': s }) } } catch { return s ? { 'x-concierge-scope': s } : {} }
}
// What every page reads as it starts (the setup in short, your roles, what is held): asked for in one request, and
// each of those reads takes its answer from it the first time.
const BOOT = ['/setup?light=1', '/roles', '/repos/held'] // the quick ones: who you are and the version ask GitHub and git, and must not hold these back
let boot: Promise<Record<string, unknown>> | undefined
const booted = new Set<string>()
const fromBoot = (path: string): Promise<unknown> | undefined => {
  if (!BOOT.includes(path) || booted.has(path)) return undefined
  booted.add(path)
  boot ??= fetch('/api/boot', { headers: roleHeader() }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
  // not in it (an older server, or that read failed there): asked for on its own
  return boot.then((b) => (b && typeof b === 'object' && path in b ? b[path] : api(path)))
}

// the reads under way, numbered in the order they were asked: a page that waits to be shown whole (ui/Settled.tsx)
// knows by them that what it asked for when it opened is in
let readSeq = 0
const underWay = new Set<number>()
export const reads = {
  /** The number of the last read asked: one asked after it is "since" it. */
  mark: () => readSeq,
  /** Whether a read asked after `mark` is still under way. */
  pendingSince: (mark: number) => { for (const n of underWay) if (n > mark) return true; return false },
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api = (path: string, body?: unknown): Promise<any> => {
  if (body !== undefined) return ask(path, body)
  const n = ++readSeq
  underWay.add(n)
  return ask(path).finally(() => { underWay.delete(n); dispatchEvent(new Event('api-read')) })
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = (path: string, body?: unknown): Promise<any> =>
  (body === undefined ? fromBoot(path) : undefined) ?? fetch(`/api${path}`, body === undefined ? { headers: roleHeader() } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...roleHeader() }, body: JSON.stringify(body),
  }).then(async (r) => {
    // an answer that isn't JSON (a proxy's error page, a server that fell over) is said as it is, not as a parse error
    const text = await r.text()
    let json: any
    try { json = text ? JSON.parse(text) : {} } catch { throw new Error(r.ok ? `Unreadable answer from ${path}` : `${r.status} ${text.slice(0, 200) || r.statusText}`) }
    // the sentence to show, with the code and status to decide on (server: every refusal carries a code)
    if (!r.ok) throw Object.assign(new Error(json.error ?? r.statusText), { code: json.code as string | undefined, status: r.status })
    // a read never pays: when what it wants isn't worked out yet, the server says where to ask for it, and that is asked
    if (body === undefined && json?.pending === true && typeof json.ask === 'string') return ask(json.ask, {})
    return json
  })

export const enc = (id: string) => encodeURIComponent(id)

/** UI state that survives a reload: read from the URL query… */
export const param = (k: string): string | undefined => new URLSearchParams(location.search).get(k) ?? undefined
/** …and written back in place (no history entries). Empty clears it. */
export function setParam(k: string, v?: string | number | null) {
  const u = new URL(location.href)
  if (v == null || v === '') u.searchParams.delete(k)
  else u.searchParams.set(k, String(v))
  history.replaceState(history.state, '', u)
}

/**
 * The live event stream, shared by every tab (liveWorker.ts, a SharedWorker): it looks like an EventSource (onopen,
 * onerror, addEventListener, close), so the code below doesn't care. A browser without SharedWorker streams on its own.
 */
function liveEvents(scope?: string): Pick<EventSource, 'addEventListener' | 'close'> & { onopen: (() => void) | null; onerror: (() => void) | null } {
  const url = `/api/events${scope ? `?scope=${scope}` : ''}` // tabs share one stream per scope: the worker's name says which
  if (typeof SharedWorker === 'undefined') return new EventSource(url) as never
  const t = Object.assign(new EventTarget(), { onopen: null as (() => void) | null, onerror: null as (() => void) | null, close: () => {} })
  let w: SharedWorker
  try { w = new SharedWorker(new URL('./liveWorker.ts', import.meta.url), { type: 'module', name: `concierge-live${scope ? `-${scope}` : ''}` }) } catch { return new EventSource(url) as never }
  w.port.onmessage = (m: MessageEvent<{ type: string; data?: string }>) => {
    const { type, data } = m.data
    if (type === 'open') t.onopen?.()
    if (type === 'error') t.onerror?.()
    t.dispatchEvent(new MessageEvent(type, { data }))
  }
  w.port.start()
  t.close = () => { w.port.postMessage('bye'); w.port.close() }
  return t as never
}

/**
 * Live dashboard state over one SSE connection (EventSource reconnects on its own). `key`: whose feed to read; given
 * as a function of the board, it is worked out from the board as it is in this render (a ticket opened is known as one
 * at once, not a render later).
 */
export function useDeck(key: string | undefined | ((exec?: ExecView) => string | undefined)) {
  const [me, setMe] = useState<Me>()
  const scopeNow = useScope().chosen
  const [prs, setPrs] = useState<PrView[]>()
  const [health, setHealth] = useState<Health>()
  const [connected, setConnected] = useState(false)
  const [feed, setFeed] = useState<Activity[]>([])
  const [feedFor, setFeedFor] = useState<string>() // whose feed `feed` is
  const [exec, setExec] = useState<ExecView>()
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => { api('/me').then((m: Me) => { reach = m.reach; setMe(m) }).catch(() => {}) }, [])

  useEffect(() => {
    const es = liveEvents(scopeNow)
    staleNow(['/runs']) // what was read in the other scope
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.addEventListener('prs', (e) => setPrs(JSON.parse(e.data))) // the whole list, when this page connects
    // then only what changed: the PRs that did, the ones that went, and the list's order
    es.addEventListener('prs-patch', (e) => {
      staleNow(['/load', '/runs'])
      const { set, del, order } = JSON.parse(e.data) as { set: PrView[]; del: string[]; order: string[] }
      setPrs((prev) => {
        const byId = new Map((prev ?? []).map((p) => [p.id, p]))
        for (const id of del) byId.delete(id)
        for (const p of set) byId.set(p.id, p)
        return order.map((id) => byId.get(id)).filter((p): p is PrView => !!p)
      })
    })
    // what the stream's own events imply changed elsewhere, and what the server says changed ('stale'): read again now
    es.addEventListener('stale', (e) => staleNow(JSON.parse(e.data)))
    es.addEventListener('health', (e) => { setHealth(JSON.parse(e.data)); staleNow(['/load', '/providers', '/usage/accounts', '/machines', '/infra', '/update']) })
    es.addEventListener('exec', (e) => { setExec(JSON.parse(e.data)); staleNow(['/stacks/drive', '/load', '/runs']) })
    // then only what changed: the tickets that did, the ones that went, their order, and the rest of the board if it moved
    es.addEventListener('exec-patch', (e) => {
      staleNow(['/stacks/drive', '/load', '/runs'])
      const { set, del, order, meta } = JSON.parse(e.data) as { set: TicketView[]; del: string[]; order: string[]; meta?: Omit<ExecView, 'tickets'> }
      setExec((prev) => {
        if (!prev) return prev
        const byId = new Map(prev.tickets.map((t) => [t.id, t]))
        for (const id of del) byId.delete(id)
        for (const t of set) byId.set(t.id, t)
        return { ...prev, ...meta, tickets: order.map((id) => byId.get(id)).filter((t): t is TicketView => !!t) }
      })
    })
    es.addEventListener('alerts', (e) => setAlerts(JSON.parse(e.data)))
    // a run's lines arrive many a second: gathered, and applied a few times a second, so the page renders once for a
    // burst instead of once a line. Only feeds already read are kept (one never opened is read whole when it opens)
    let lines: { id: string; a: Activity }[] = [], flush: ReturnType<typeof setTimeout> | undefined
    const stale = new Set<string>()
    es.addEventListener('activity', (e) => {
      const x = JSON.parse(e.data) as { id: string; a: Activity }
      lines.push(x); stale.add(x.id.startsWith('exec:') ? `/exec/${x.id.slice(5)}/` : `/prs/${encodeURIComponent(x.id)}/background`)
      flush ??= setTimeout(() => {
        flush = undefined
        const got = lines; lines = []
        staleNow([...stale]); stale.clear()
        const by = new Map<string, Activity[]>()
        for (const { id, a } of got) by.set(id, [...(by.get(id) ?? []), a])
        for (const [id, add] of by) { const had = feedCache.get(id); if (had) cacheFeed(id, [...had, ...add].slice(-3000)); reading.get(id)?.push(...add) }
        const mine = selectedRef.current && by.get(selectedRef.current)
        if (mine) setFeed((f) => [...f, ...mine].slice(-3000))
      }, 200)
    })
    // the stream's id (its first word, and again after every drop): the feeds read before it aren't followed on this
    // stream, so the ones kept are forgotten (each is read again, with the id, when opened) and the open one is read now
    es.addEventListener('hello', (e) => {
      streamId = (e as MessageEvent<string>).data
      const id = selectedRef.current
      for (const k of [...feedCache.keys()]) if (k !== id) feedCache.delete(k)
      if (id) readFeed(id).then((f) => { if (selectedRef.current === id) setFeed(f) }).catch(() => {})
    })
    // back after a drop (a restart, a slow server): what it missed comes in again, the open feed included
    es.addEventListener('open', () => {
      const id = selectedRef.current
      // the feeds kept from before the drop missed its lines: forgotten, so each is read whole when it is opened again
      for (const k of [...feedCache.keys()]) if (k !== id) feedCache.delete(k)
      if (id) readFeed(id).then((f) => { if (selectedRef.current === id) setFeed(f) }).catch(() => {})
    })
    return () => { es.close(); if (flush) clearTimeout(flush) }
  }, [scopeNow]) // switching this machine / fleet reconnects with the other lists

  const selected = typeof key === 'function' ? key(exec) : key
  // the SSE listener above outlives renders, so it reads the selection through a ref
  selectedRef.current = selected
  // the earlier part of the open feed was read ("Show earlier"): shown
  useEffect(() => { const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id === selectedRef.current) setFeed(feedCache.get(id) ?? []) }; addEventListener('feed-whole', on); return () => removeEventListener('feed-whole', on) }, [])
  useEffect(() => {
    setFeed(selected ? feedCache.get(selected) ?? [] : []); setFeedFor(selected)
    if (selected) { if (!feedCache.has(selected)) loadingFeed(selected, true); readFeed(selected).then((f) => { if (selectedRef.current === selected) setFeed(f) }).catch(() => {}).finally(() => loadingFeed(selected, false)) }
  }, [selected])

  // one item's feed, right from the render that opens it: `feed` while it is that item's, else what is cached (never
  // the item opened before, which `feed` still holds for a render or two)
  const feedOf = (key: string) => (key === feedFor ? feed : feedCache.get(key) ?? [])
  return { me, prs, health, connected, feed, feedOf, exec, alerts }
}
const selectedRef: { current?: string } = {}
const feedCache = new Map<string, Activity[]>() // per PR, so switching back shows the feed instantly
// the feeds being read for the first time: the page says it is loading instead of "nothing ran yet" until they land
const loadingFeeds = new Set<string>()
function loadingFeed(key: string, on: boolean) { if (on) loadingFeeds.add(key); else loadingFeeds.delete(key); dispatchEvent(new Event('feed-loading')) }
/** Whether an item's feed is still being read for the first time. */
export function useFeedLoading(key: string) {
  const [on, setOn] = useState(() => loadingFeeds.has(key))
  useEffect(() => { const f = () => setOn(loadingFeeds.has(key)); f(); addEventListener('feed-loading', f); return () => removeEventListener('feed-loading', f) }, [key])
  return on
}
/** Into the cache as the newest; the oldest goes past 30, so a long day doesn't keep every feed it ever read. */
function cacheFeed(id: string, f: Activity[]) { feedCache.delete(id); feedCache.set(id, f); if (feedCache.size > 30) feedCache.delete(feedCache.keys().next().value!) }
// "ticket:<id>" is a ticket's whole timeline, "exec:<run>" one run's feed; anything else is a PR's
// "visuals:<pr>" is the conversation about a PR's screens (Design)
const feedUrl = (key: string) => key.startsWith('ticket:') ? `/exec/tickets/${key.slice(7)}/activity`
  : key.startsWith('exec:') ? `/exec/${key.slice(5)}/activity` : key.startsWith('visuals:') ? `/visuals/${enc(key.slice(8))}/activity`
  : key.startsWith('setup:') ? `/visuals/setup/${key.slice(6)}/activity`
  : /^design-(components|tokens):/.test(key) ? `/visuals/chat/${key.slice(7, key.indexOf(':'))}/${key.slice(key.indexOf(':') + 1)}/activity` : `/prs/${enc(key)}/activity`
const prefetching = new Set<string>()
// the lines that came over the live stream while a feed was being read: the answer was made before them, so they are
// put back after it (they were lost: the answer replaced the feed, and the run's newest lines vanished until the next)
const reading = new Map<string, Activity[]>()
const lineKey = (a: Activity) => `${a.at}|${a.kind}|${(a.text ?? '').slice(0, 80)}`
const TAIL = 600 // an item opens with about its last 600 lines (whole runs); "Show earlier" reads the rest
// this page's live stream, by the id the server gave it: a feed read with it is one the stream then keeps up to date
// (the server sends a run's lines only to the pages that read its feed)
let streamId: string | undefined
const followed = (url: string, id: string) => (streamId ? `${url}${url.includes('?') ? '&' : '?'}sid=${streamId}&watch=${encodeURIComponent(id)}` : url)
const tailed = (id: string) => followed(id.startsWith('ticket:') || id.startsWith('exec:') || !/^[a-z-]+:/.test(id) ? `${feedUrl(id)}?tail=${TAIL}` : feedUrl(id), id)
/** The whole of a feed, when its earlier part is asked for (ActivityFeed's "Show earlier"). */
export function wholeFeed(id: string) {
  return api(followed(feedUrl(id), id)).then((f: Activity[]) => { cacheFeed(id, f); dispatchEvent(new CustomEvent('feed-whole', { detail: id })); return f })
}
/** Read a feed's newest part, into the cache, keeping what arrived live meanwhile. */
function readFeed(id: string): Promise<Activity[]> {
  const since: Activity[] = reading.get(id) ?? []
  reading.set(id, since)
  return api(tailed(id)).then((got: Activity[]) => {
    // the line that says how many came before knows which feed it is of, for the click that asks for them
    const f = got[0]?.earlier ? [{ ...got[0], feedId: id }, ...got.slice(1)] : got
    const has = new Set(f.slice(-400).map(lineKey))
    const whole = [...f, ...since.filter((a) => !has.has(lineKey(a)))].slice(-3000)
    cacheFeed(id, whole)
    return whole
  }).finally(() => { if (reading.get(id) === since) reading.delete(id) })
}
/** An item's feed into the cache before it opens (a pointer resting on its row), so it opens whole instead of blank
 * for the time the fetch takes. Opening still fetches it fresh. */
export function prefetchFeed(key: string) {
  if (feedCache.has(key) || prefetching.has(key)) return
  prefetching.add(key)
  readFeed(key).catch(() => {}).finally(() => prefetching.delete(key))
}

/** One function for the component's whole life that always runs the newest `f`: a list's rows, memoized on their props,
 *  don't all draw again because the parent made a new closure (a click re-renders the two rows it changes, not 40). */
export function useStable<A extends unknown[], R>(f: (...a: A) => R): (...a: A) => R {
  const at = useRef(f)
  at.current = f
  return useCallback((...a: A) => at.current(...a), [])
}

// dates and times live in time.ts (date-fns); re-exported here for the callers that import them from lib
export { ago, duration } from './time.ts'

/** Re-render every `ms` so relative times stay fresh. */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// crit runs where the server does: the machine running Concierge, as reached from this page (it must listen
// there, CRIT_HOST). See hosts.ts, also for the localhost links agents print.
let reach: Reach | undefined
// a review another machine ran has its crit there: that machine's tailnet address (several machines), else this server's
export const critUrl = (pr: PrView) => (pr.crit?.live && pr.crit.port ? `http://${pr.crit.host ?? serverHost(location.hostname, reach)}:${pr.crit.port}` : undefined)
export const here = (url: string) => reachable(url, location.hostname, reach)
export const hereIn = (text: string) => reachableIn(text, location.hostname, reach)

export type Theme = 'system' | 'light' | 'dark'
/** The palettes (design/tokens.css): each tints the neutrals and sets how deep they go, in light and in dark. `swatch`
 *  is its look in a picker: page, card, tint, as [lightness, chroma, hue] for light and for dark. */
export const PALETTES = [
  { id: '', label: 'Concierge', hint: 'The default: a quiet violet grey', swatch: { h: 265, c: 0.013, d: 0.225, l: 0.975 } },
  { id: 'midnight', label: 'Midnight', hint: 'Deep blue-black, for late hours', swatch: { h: 262, c: 0.022, d: 0.175, l: 0.975 } },
  { id: 'paper', label: 'Paper', hint: 'Warm cream and sepia: for long reading', swatch: { h: 80, c: 0.02, d: 0.235, l: 0.965 } },
] as const
export type Palette = (typeof PALETTES)[number]['id']
// one saved before the list was cut to three falls back to the default
export const paletteNow = (): Palette => { try { const p = localStorage.getItem('palette') ?? ''; return (PALETTES.some((x) => x.id === p) ? p : '') as Palette } catch { return '' } }
export function setPalette(p: Palette) {
  const root = document.documentElement
  root.classList.add('theming')
  if (p) root.dataset.palette = p; else delete root.dataset.palette
  try { localStorage.setItem('palette', p) } catch { /* private window */ }
  setTimeout(() => root.classList.remove('theming'), 300)
}
if (paletteNow()) document.documentElement.dataset.palette = paletteNow() // before the first paint

/** A grain over the whole app (index.css, "Textures"): the touch of film. */
export const TEXTURES = [
  { id: '', label: 'None', hint: 'Clean surfaces' },
  { id: 'grain', label: 'Grain', hint: 'Fine film grain, barely there' },
  { id: 'film', label: 'Film', hint: 'Coarser, warmer grain' },
] as const
export type Texture = (typeof TEXTURES)[number]['id']
export const textureNow = (): Texture => { try { const t = localStorage.getItem('texture') ?? ''; return (TEXTURES.some((x) => x.id === t) ? t : '') as Texture } catch { return '' } }
export function setTexture(t: Texture) {
  const root = document.documentElement
  if (t) root.dataset.texture = t; else delete root.dataset.texture
  try { localStorage.setItem('texture', t) } catch { /* private window */ }
}
if (textureNow()) document.documentElement.dataset.texture = textureNow() // before the first paint
const dark = matchMedia('(prefers-color-scheme: dark)')

/** Per-browser preference, so localStorage (guarded: it can throw in private windows). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => { try { return (localStorage.getItem('theme') as Theme) || 'system' } catch { return 'system' } })
  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && dark.matches))
    apply()
    try { localStorage.setItem('theme', theme) } catch {}
    if (theme !== 'system') return
    dark.addEventListener('change', apply)
    return () => dark.removeEventListener('change', apply)
  }, [theme])
  const change = (t: Theme) => {
    const root = document.documentElement
    root.classList.add('theming')
    setTheme(t)
    setTimeout(() => root.classList.remove('theming'), 300)
  }
  return [theme, change] as const
}

/** True while the page is in dark mode; follows theme switches live (the canvases need it as a prop). */
export function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => o.disconnect()
  }, [])
  return dark
}

/** React Flow's zoom controls, restyled to match the app's quiet rounded buttons in both themes. */
export const flowControls = '!m-3 !overflow-hidden !rounded-ctl !border-0 !shadow-sm ring-1 ring-line-strong '
  + '[&_button]:!size-7 [&_button]:!border-zinc-100 [&_button]:!bg-white [&_button]:!text-zinc-500 [&_button:hover]:!bg-zinc-50 [&_button:hover]:!text-zinc-900 [&_button_svg]:!fill-current [&_button_svg]:!max-h-3 [&_button_svg]:!max-w-3 '
  + 'dark:[&_button]:!border-zinc-800 dark:[&_button]:!bg-zinc-900 dark:[&_button]:!text-zinc-400 dark:[&_button:hover]:!bg-zinc-800 dark:[&_button:hover]:!text-zinc-100'

/** True when a key press is going into a field (input, textarea, select, contenteditable): shortcuts must not take it. */
/** Motion asked to be reduced (the system's setting): scripted motion (a smooth scroll, a map gliding) is then a jump. */
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches
export const smooth = (): ScrollBehavior => (calm() ? 'auto' : 'smooth')

/**
 * The key that sends, the same in every box you write to an agent in: Enter (Shift+Enter is a new line; ⌘/Ctrl+Enter
 * sends too). On a touch keyboard, which has no Shift+Enter, Enter is a new line and the button sends.
 */
export const sendKey = (e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; nativeEvent?: { isComposing?: boolean } }) =>
  e.key === 'Enter' && !e.nativeEvent?.isComposing && (e.metaKey || e.ctrlKey || (!e.shiftKey && !matchMedia('(pointer: coarse)').matches))

export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable)
}

/** Resume on a server you are not sitting at: the server hands back the command; copy it (or show it). */
export const resumed = (ok: string, toast: (m: string, tone?: 'ok' | 'error') => void) => (r?: { opened?: boolean; command?: string }) => {
  if (!r?.command || r.opened) return toast(ok)
  navigator.clipboard?.writeText(r.command).then(
    () => toast('Copied the resume command. Run it in a terminal on the server (over SSH from here).'),
    () => toast(r.command!),
  ) ?? toast(r.command)
}

