import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Me } from '../server/github.ts'
import type { ExecView, Health, PrView, TicketView } from '../server/index.ts'
import type { Activity } from '../server/runner.ts'
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

/** Live dashboard state over one SSE connection (EventSource reconnects on its own). */
export function useDeck(selected: string | undefined) {
  const [me, setMe] = useState<Me>()
  const [prs, setPrs] = useState<PrView[]>()
  const [health, setHealth] = useState<Health>()
  const [connected, setConnected] = useState(false)
  const [feed, setFeed] = useState<Activity[]>([])
  const [exec, setExec] = useState<ExecView>()
  const [alerts, setAlerts] = useState<Alert[]>([])

  useEffect(() => { api('/me').then((m: Me) => { reach = m.reach; setMe(m) }).catch(() => {}) }, [])

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.addEventListener('prs', (e) => setPrs(JSON.parse(e.data))) // the whole list, when this page connects
    // then only what changed: the PRs that did, the ones that went, and the list's order
    es.addEventListener('prs-patch', (e) => {
      const { set, del, order } = JSON.parse(e.data) as { set: PrView[]; del: string[]; order: string[] }
      setPrs((prev) => {
        const byId = new Map((prev ?? []).map((p) => [p.id, p]))
        for (const id of del) byId.delete(id)
        for (const p of set) byId.set(p.id, p)
        return order.map((id) => byId.get(id)).filter((p): p is PrView => !!p)
      })
    })
    es.addEventListener('health', (e) => setHealth(JSON.parse(e.data)))
    es.addEventListener('exec', (e) => setExec(JSON.parse(e.data)))
    es.addEventListener('alerts', (e) => setAlerts(JSON.parse(e.data)))
    es.addEventListener('activity', (e) => {
      const { id, a } = JSON.parse(e.data)
      feedCache.set(id, [...(feedCache.get(id) ?? []).slice(-2999), a])
      if (id === selectedRef.current) setFeed((f) => [...f.slice(-2999), a])
    })
    return () => es.close()
  }, [])

  // the SSE listener above outlives renders, so it reads the selection through a ref
  selectedRef.current = selected
  useEffect(() => {
    setFeed(selected ? feedCache.get(selected) ?? [] : [])
    // "ticket:<id>" is a ticket's whole timeline, "exec:<run>" one run's feed; anything else is a PR's
    const url = selected?.startsWith('ticket:') ? `/exec/tickets/${selected.slice(7)}/activity`
      : selected?.startsWith('exec:') ? `/exec/${selected.slice(5)}/activity` : `/prs/${enc(selected ?? '')}/activity`
    if (selected) api(url).then((f: Activity[]) => { feedCache.set(selected, f); if (selectedRef.current === selected) setFeed(f) }).catch(() => {})
  }, [selected])

  return { me, prs, health, connected, feed, exec, alerts }
}
const selectedRef: { current?: string } = {}
const feedCache = new Map<string, Activity[]>() // per PR, so switching back shows the feed instantly

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
