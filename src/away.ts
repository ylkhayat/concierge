// The repositories that aren't on this machine (not allowed here in Settings → Repositories, or unticked): their PRs
// and tickets can't be opened here. Set by the app from /setup; read by the lists and the detail pane.
import { useEffect, useState } from 'react'

let away = new Set<string>()
const EVENT = 'concierge:away'
export function setAway(clones: Record<string, string> = {}) {
  away = new Set(Object.entries(clones).filter(([, v]) => v === 'not-here' || v.startsWith('kept:')).map(([r]) => r))
  dispatchEvent(new CustomEvent(EVENT))
}
export function useAway(): Set<string> {
  const [a, setA] = useState(away)
  useEffect(() => { const on = () => setA(away); addEventListener(EVENT, on); return () => removeEventListener(EVENT, on) }, [])
  return a
}
export const openRepoSettings = () => dispatchEvent(new CustomEvent('concierge:settings', { detail: 'repos' }))
