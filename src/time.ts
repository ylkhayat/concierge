// Every date and time the app shows, through date-fns, so they read the same everywhere.
import { differenceInSeconds, format, formatDistanceStrict, isToday, isYesterday } from 'date-fns'

const d = (iso: string | number | Date) => new Date(iso)

/** "just now", "3 minutes ago", "about 2 hours ago", "5 days ago". */
export function ago(iso?: string, now: number = Date.now()) {
  if (!iso) return ''
  const s = differenceInSeconds(now, d(iso))
  if (s < 45) return 'just now'
  return formatDistanceStrict(d(iso), now, { addSuffix: true })
}

/** Compact age for dense lists: "now", "5m", "2h", "3d", "4w". */
export function short(iso: string, now: number = Date.now()) {
  const m = Math.max(0, differenceInSeconds(now, d(iso)) / 60)
  return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 20160 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 10080)}w`
}

/** How long something took: "42s", "3m 05s", "1h 12m". Running (no end): up to now. */
export function duration(from?: string, to?: string) {
  if (!from) return ''
  const s = Math.max(0, differenceInSeconds(to ? d(to) : Date.now(), d(from)))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Wall-clock time: "14:05", or "14:05:09" with seconds. */
export const clock = (iso: string, seconds = false) => format(d(iso), seconds ? 'HH:mm:ss' : 'HH:mm')

/** A moment in a timeline: "14:05" today, "Yesterday 14:05", else "Oct 15, 14:05". */
export function when(iso: string) {
  const x = d(iso)
  return isToday(x) ? format(x, 'HH:mm') : isYesterday(x) ? `Yesterday ${format(x, 'HH:mm')}` : format(x, 'MMM d, HH:mm')
}

/** A full date and time, for tooltips and records: "Oct 19, 2026, 14:05". */
export const stamp = (iso: string | number | Date) => format(d(iso), 'MMM d, yyyy, HH:mm')

/** Short weekday: "Mon". */
export const weekday = (iso: string) => format(d(iso), 'EEE')
