// The desk's sense of time: topics put off until later, and the focus block you're in. Kept per browser (localStorage):
// it's about your attention on this screen. ponytail: the phone keeps its own; move to the server if they should share.
import { useSyncExternalStore } from 'react'

const LATER = 'desk-later', FOCUS = 'desk-focus'
const read = <T,>(k: string, none: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T } catch { return none } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } bump() }

let version = 0
const subs = new Set<() => void>()
const bump = () => { version++; subs.forEach((f) => f()) }
if (typeof window !== 'undefined') addEventListener('storage', (e) => { if (e.key === LATER || e.key === FOCUS) bump() }) // another tab
/** Re-render when a topic is put off or a focus block starts or ends. */
export const useDeskTime = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => version)

// --- later
/** Until when a topic is put off (ms), if it still is. */
export const offUntil = (key: string, now = Date.now()) => { const t = read<Record<string, number>>(LATER, {})[key]; return t && t > now ? t : undefined }
export function putOff(key: string, until: number) {
  const now = Date.now()
  write(LATER, Object.fromEntries([...Object.entries(read<Record<string, number>>(LATER, {})).filter(([, t]) => t > now), [key, until]]))
}
export const bringBack = (key: string) => write(LATER, Object.fromEntries(Object.entries(read<Record<string, number>>(LATER, {})).filter(([k]) => k !== key)))
/** In three hours: back after lunch, say. */
export const laterToday = () => Date.now() + 3 * 3600_000
/** Tomorrow at 08:00 (Monday's, from a Friday or the weekend): done for today. */
export function tomorrowMorning(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.getTime()
}

// --- the focus block: one topic, a set time, the rest quiet
export type Block = { key: string; endsAt: number }
export const focusBlock = (now = Date.now()): Block | undefined => { const b = read<Block | null>(FOCUS, null); return b && b.endsAt > now ? b : undefined }
export const startFocus = (key: string, minutes = 25) => write(FOCUS, { key, endsAt: Date.now() + minutes * 60_000 })
export const stopFocus = () => write(FOCUS, null)
