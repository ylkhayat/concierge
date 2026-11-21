// The repositories that aren't on this machine (not allowed here in Settings → Repositories, or unticked): their PRs
// and tickets can't be opened here. Set by the app from /setup; read by the lists and the detail pane.
import { useEffect, useState } from 'react'
import { useScope } from './scope.ts'

let away = new Set<string>()
const EVENT = 'concierge:away'
/** The server's list (setup: away, from the rules); an older server sends only the clone states. */
export function setAway(list?: string[], clones: Record<string, string> = {}) {
  away = new Set(list ?? Object.entries(clones).filter(([, v]) => v === 'not-here' || v.startsWith('kept:')).map(([r]) => r))
  dispatchEvent(new CustomEvent(EVENT))
}
const none = new Set<string>()
/** Repositories not on this machine, in the this-machine view; the fleet view has none (its work goes where they are). */
export function useAway(): Set<string> {
  const [a, setA] = useState(away)
  const { scope } = useScope()
  useEffect(() => { const on = () => setA(away); addEventListener(EVENT, on); return () => removeEventListener(EVENT, on) }, [])
  return scope === 'here' ? a : none
}
export const openRepoSettings = () => dispatchEvent(new CustomEvent('concierge:settings', { detail: 'repos' }))
