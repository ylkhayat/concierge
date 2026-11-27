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

export function putOff(key: string, until: number) {
  const now = Date.now()
  write(LATER, Object.fromEntries([...Object.entries(read<Record<string, number>>(LATER, {})).filter(([, t]) => t > now), [key, until]]))
}

// --- the focus block: one topic, a set time, the rest quiet
export type Block = { key: string; endsAt: number }
export const focusBlock = (now = Date.now()): Block | undefined => { const b = read<Block | null>(FOCUS, null); return b && b.endsAt > now ? b : undefined }
