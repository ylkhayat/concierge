// What you call each machine (Settings → Machines): its id (DECK_NAME) stays the same everywhere underneath, and every
// place that shows a machine shows this instead. Set by the app from /setup.
import { useEffect, useState } from 'react'

let names: Record<string, string> = {}
const EVENT = 'concierge:machine-names'
export function setMachineNames(n: Record<string, string> = {}) { names = n; dispatchEvent(new CustomEvent(EVENT)) }
/** A function from a machine's id to what you call it. */
export function useMachineName(): (id: string) => string {
  const [n, setN] = useState(names)
  useEffect(() => { const on = () => setN(names); addEventListener(EVENT, on); return () => removeEventListener(EVENT, on) }, [])
  return (id) => n[id] ?? id
}
