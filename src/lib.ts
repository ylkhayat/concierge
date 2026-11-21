import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Me } from '../server/github.ts'
import type { ExecView, Health, PrView, TicketView } from '../server/index.ts'
import type { Activity } from '../server/runner.ts'
import { staleNow } from './query.ts' // used only inside the stream's handlers, so the two modules may import each other
import type { Alert } from '../server/alerts.ts'
import { reachable, reachableIn, serverHost, type Reach } from './hosts.ts'

export type { Activity, ExecView, Health, Me, PrView, TicketView }

// the role this page reads as (role.ts): what a request starts runs that role's commands
const roleHeader = (): Record<string, string> => { try { const r = localStorage.getItem('role'); return r ? { 'x-concierge-role': r } : {} } catch { return {} } }
export const api = (path: string, body?: unknown) =>
  fetch(`/api${path}`, body === undefined ? { headers: roleHeader() } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...roleHeader() }, body: JSON.stringify(body),
  }).then(async (r) => {
    // an answer that isn't JSON (a proxy's error page, a server that fell over) is said as it is, not as a parse error
    const text = await r.text()
    let json: any
    try { json = text ? JSON.parse(text) : {} } catch { throw new Error(r.ok ? `Unreadable answer from ${path}` : `${r.status} ${text.slice(0, 200) || r.statusText}`) }
    if (!r.ok) throw new Error(json.error ?? r.statusText)
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
function liveEvents(): Pick<EventSource, 'addEventListener' | 'close'> & { onopen: (() => void) | null; onerror: (() => void) | null } {
  if (typeof SharedWorker === 'undefined') return new EventSource('/api/events') as never
  const t = Object.assign(new EventTarget(), { onopen: null as (() => void) | null, onerror: null as (() => void) | null, close: () => {} })
  let w: SharedWorker
  try { w = new SharedWorker(new URL('./liveWorker.ts', import.meta.url), { type: 'module', name: 'concierge-live' }) } catch { return new EventSource('/api/events') as never }
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

/** Live dashboard state over one SSE connection (EventSource reconnects on its own). */
export function useDeck(selected: string | undefined) {
  const [me, setMe] = useState<Me>()
  const [prs, setPrs] = useState<PrView[]>()
  const [health, setHealth] = useState<Health>()
  const [connected, setConnected] = useState(false)
  const [feed, setFeed] = useState<Activity[]>([])
  const [feedFor, setFeedFor] = useState<string>() // whose feed `feed` is
  const [exec, setExec] = useState<ExecView>()
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => { api('/me').then((m: Me) => { reach = m.reach; setMe(m) }).catch(() => {}) }, [])

  useEffect(() => {
    const es = liveEvents()
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
        for (const [id, add] of by) { const had = feedCache.get(id); if (had) cacheFeed(id, [...had, ...add].slice(-3000)) }
        const mine = selectedRef.current && by.get(selectedRef.current)
        if (mine) setFeed((f) => [...f, ...mine].slice(-3000))
      }, 200)
    })
    // back after a drop (a restart, a slow server): what it missed comes in again, the open feed included
    es.addEventListener('open', () => { const id = selectedRef.current; if (id) api(feedUrl(id)).then((f: Activity[]) => { cacheFeed(id, f); if (selectedRef.current === id) setFeed(f) }).catch(() => {}) })
    return () => { es.close(); if (flush) clearTimeout(flush) }
  }, [])

  // the SSE listener above outlives renders, so it reads the selection through a ref
  selectedRef.current = selected
  useEffect(() => {
    setFeed(selected ? feedCache.get(selected) ?? [] : []); setFeedFor(selected)
    if (selected) { if (!feedCache.has(selected)) loadingFeed(selected, true); api(feedUrl(selected)).then((f: Activity[]) => { cacheFeed(selected, f); if (selectedRef.current === selected) setFeed(f) }).catch(() => {}).finally(() => loadingFeed(selected, false)) }
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
const feedUrl = (key: string) => key.startsWith('ticket:') ? `/exec/tickets/${key.slice(7)}/activity`
  : key.startsWith('exec:') ? `/exec/${key.slice(5)}/activity` : `/prs/${enc(key)}/activity`
const prefetching = new Set<string>()
/** An item's feed into the cache before it opens (a pointer resting on its row), so it opens whole instead of blank
 * for the time the fetch takes. Opening still fetches it fresh. */
export function prefetchFeed(key: string) {
  if (feedCache.has(key) || prefetching.has(key)) return
  prefetching.add(key)
  api(feedUrl(key)).then((f: Activity[]) => { if (!feedCache.has(key)) cacheFeed(key, f) }).catch(() => {}).finally(() => prefetching.delete(key))
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
export const critUrl = (pr: PrView) => (pr.crit?.live && pr.crit.port ? `http://${serverHost(location.hostname, reach)}:${pr.crit.port}` : undefined)
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

/** A surface over the whole app (index.css, "Textures"): the touch of paper, film or a drafting table. */
export const TEXTURES = [
  { id: '', label: 'None', hint: 'Clean surfaces' },
  { id: 'grain', label: 'Grain', hint: 'Film grain, barely there' },
  { id: 'paper', label: 'Paper', hint: 'Fibres, warm and quiet' },
  { id: 'dots', label: 'Dots', hint: 'A dotted notebook' },
  { id: 'grid', label: 'Grid', hint: 'A drafting table' },
  { id: 'contours', label: 'Contours', hint: 'A topographic map' },
  { id: 'aurora', label: 'Aurora', hint: 'Soft light in the workspace colour' },
] as const
export type Texture = (typeof TEXTURES)[number]['id']
export const textureNow = (): Texture => { try { return (localStorage.getItem('texture') ?? '') as Texture } catch { return '' } }
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
export const flowControls = '!m-3 !overflow-hidden !rounded-xl !border-0 !shadow-sm ring-1 ring-line-strong '
  + '[&_button]:!size-7 [&_button]:!border-zinc-100 [&_button]:!bg-white [&_button]:!text-zinc-500 [&_button:hover]:!bg-zinc-50 [&_button:hover]:!text-zinc-900 [&_button_svg]:!fill-current [&_button_svg]:!max-h-3 [&_button_svg]:!max-w-3 '
  + 'dark:[&_button]:!border-zinc-800 dark:[&_button]:!bg-zinc-900 dark:[&_button]:!text-zinc-400 dark:[&_button:hover]:!bg-zinc-800 dark:[&_button:hover]:!text-zinc-100'

/** True when a key press is going into a field (input, textarea, select, contenteditable): shortcuts must not take it. */
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

// focus mode: while you read Explain, the sidebars step back (html[data-reading], styled with the `reading:` variant)
// only where the room is short: from 1536px wide the list stays open beside the page, as on the landing page
let reading = false, asked = false, wide = 1536
const readers = new Set<() => void>()
const apply = () => {
  const on = asked && innerWidth < wide
  if (on === reading) return
  reading = on
  document.documentElement.toggleAttribute('data-reading', on)
  readers.forEach((f) => f())
}
/** `below`: the window width under which the list steps back (the new design's three columns need more room). */
export function setReading(on: boolean, below = 1536) { asked = on; wide = below; apply() }
addEventListener('resize', apply)
export const useReading = () => useSyncExternalStore((f) => { readers.add(f); return () => readers.delete(f) }, () => reading)
// your choice to keep the sidebars while reading, per browser
export const focusWanted = () => { try { return localStorage.getItem('focus-mode') !== 'off' } catch { return true } }
export const wantFocus = (on: boolean) => { try { localStorage.setItem('focus-mode', on ? 'on' : 'off') } catch { /* private window */ } }
