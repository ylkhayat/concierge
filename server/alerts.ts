// In-app alerts: one per item (a PR or a ticket), holding its latest updates, so the page can toast what happened
// and keep a short inbox of it. "you" updates need you (an agent asks, a run failed, feedback came in) and stay.
import { save, state } from './store.ts'

export type AlertTone = 'info' | 'ok' | 'warn' | 'you'
// system: Concierge itself (GitHub sync, releases, the Claude login, the queue held): it clears itself once fixed
export type AlertKind = 'pr' | 'ticket' | 'system'
export type Alert = {
  key: string; kind: AlertKind; target: string; label: string; title: string
  updates: { at: string; text: string; tone: AlertTone; pin?: boolean }[] // pin: about a bookmarked item (a system notification too)
  at: string // the latest update
  seen?: string // when you last looked at it (dismissed or opened)
}

const MAX_UPDATES = 12, MAX_ALERTS = 80
let changed: () => void = () => {}
/** Told when alerts change (the server pushes them to the page). */
export const whenAlerts = (f: () => void) => { changed = f }

/** Add an update to an item's alert (made on its first update). */
export function alert(target: { kind: AlertKind; id: string; label: string; title: string }, text: string, tone: AlertTone = 'info', pin = false) {
  const all = (state.alerts ??= {})
  const key = `${target.kind}:${target.id}`
  const at = new Date().toISOString()
  const a = all[key] ?? { key, kind: target.kind, target: target.id, label: target.label, title: target.title, updates: [], at }
  // the same words twice in a row (a re-sync) are one update
  if (a.updates.at(-1)?.text !== text) a.updates = [...a.updates, { at, text, tone, ...(pin && { pin }) }].slice(-MAX_UPDATES)
  Object.assign(a, { title: target.title, at })
  all[key] = a
  // keep the newest; the ones you have seen go first
  const keys = Object.values(all).sort((x, y) => Number(!x.seen) - Number(!y.seen) || y.at.localeCompare(x.at)).map((x) => x.key)
  for (const k of keys.slice(MAX_ALERTS)) delete all[k]
  save(); changed()
}

/**
 * A condition of Concierge itself, on or off: raised once when it starts ("GitHub sync is failing: …"), and resolved
 * (an ok update, marked seen) once it's gone. Calling it every poll is fine: nothing repeats while nothing changes.
 */
export function condition(id: string, label: string, problem: string | undefined) {
  const key = `system:${id}`, a = state.alerts?.[key]
  const open = !!a && a.updates.at(-1)?.tone === 'warn'
  if (problem && (!open || a!.updates.at(-1)!.text !== problem)) alert({ kind: 'system', id, label, title: label }, problem, 'warn')
  else if (!problem && open) { alert({ kind: 'system', id, label, title: label }, 'Back to normal', 'ok'); seeAlerts([key]) }
}

/** Newest first. */
export const alerts = (): Alert[] => Object.values(state.alerts ?? {}).sort((a, b) => b.at.localeCompare(a.at))

/** You looked at these (or at all of them). */
export function seeAlerts(keys?: string[]) {
  const at = new Date().toISOString()
  for (const a of alerts()) if (!keys || keys.includes(a.key)) a.seen = at
  save(); changed()
}
