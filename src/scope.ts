// What the page shows: this machine (opened on its localhost) or the whole fleet (opened through the tailnet link).
// This machine: only the repositories allowed on it, and its own runs; the fleet: everything, every machine. A chip in
// the status bar switches; the choice is kept for this tab only, so each way in opens on its own default.
import { useEffect, useState } from 'react'

export type Scope = 'here' | 'fleet'
let scope: Scope = 'fleet', several = false
const EVENT = 'concierge:scope'
const kept = (): Scope | undefined => { try { const v = sessionStorage.getItem('scope'); return v === 'here' || v === 'fleet' ? v : undefined } catch { return undefined } }
/** Set once the page knows how it was opened (localhost or the link) and whether there are several machines. */
export function scopeDefault(here: boolean, many: boolean) {
  several = many
  scope = !many ? 'fleet' : kept() ?? (here ? 'here' : 'fleet')
  dispatchEvent(new CustomEvent(EVENT))
}
/** The scope you picked in this tab, as the server names it (self | fleet); none: the server's default, by how the page was opened. */
export const chosen = (): 'self' | 'fleet' | undefined => { const k = kept(); return k === 'here' ? 'self' : k }
export function setScope(s: Scope) { scope = s; try { sessionStorage.setItem('scope', s) } catch { /* private window */ } dispatchEvent(new CustomEvent(EVENT)) }
/** The scope, and whether there is a choice at all (one machine: always the fleet, which is this machine). */
export function useScope(): { scope: Scope; several: boolean; chosen?: 'self' | 'fleet' } {
  const [, tick] = useState(0)
  useEffect(() => { const on = () => tick((n) => n + 1); addEventListener(EVENT, on); return () => removeEventListener(EVENT, on) }, [])
  return { scope, several, chosen: chosen() }
}
