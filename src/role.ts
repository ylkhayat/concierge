// Whose eyes you read with: a developer, a product manager or a designer. One person can be all three: the switch is
// one click, kept per browser, and each role keeps its own place (the panel tab it had open). The role decides what
// the panel shows: the code's views for a developer, the domain's (nothing technical) for product and design.
import { Code2, Lightbulb, Palette, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

export type Role = 'developer' | 'product' | 'design'
// rail: the role's own workspaces; another role's are a switch away, never mixed in
// pending: shown as coming soon, never joined or switched to
export const ROLES: Record<Role, { label: string; short: string; icon: LucideIcon; hint: string; rail: string[]; pending?: boolean }> = {
  developer: { label: 'Developer', short: 'Dev', icon: Code2, hint: 'The code: Explain\'s tour, business, technical and norms views, the turns, the tools', rail: ['review', 'exec', 'standup', 'skills'] },
  product: { label: 'Product', short: 'PM', icon: Lightbulb, hint: 'The domain: contexts, entities, rules and the user\'s journey; nothing technical', rail: ['plans', 'skills'] },
  design: { label: 'Design', short: 'Design', icon: Palette, hint: 'The experience: what the pull requests look like before and after, the screens and their states, the words people see', rail: ['design', 'review', 'skills'] },
}
const ORDER = (Object.keys(ROLES) as Role[]).filter((r) => !ROLES[r].pending)
/** The roles you can be in now (not the ones still coming). */
export const ready = (rs: Role[]) => rs.filter((r) => !ROLES[r].pending)
const KEY = 'role', EVENT = 'concierge:role'

/** The role this browser reads as now (before any component asks). */
export const currentRole = (): Role => stored()
const stored = (): Role => {
  try { const r = localStorage.getItem(KEY) as Role; return ORDER.includes(r) ? r : 'developer' } catch { return 'developer' }
}
export function setRole(r: Role) {
  try { localStorage.setItem(KEY, r) } catch {}
  document.documentElement.dataset.role = r
  // the whole app changes hats: a crossfade where the browser has it
  const go = () => dispatchEvent(new CustomEvent(EVENT))
  const doc = document as Document & { startViewTransition?: (f: () => void) => unknown }
  if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(go); else go()
}
document.documentElement.dataset.role = stored()
export const nextRole = (r: Role) => ORDER[(ORDER.indexOf(r) + 1) % ORDER.length]

export function useRole(): Role {
  const [r, setR] = useState(stored)
  useEffect(() => {
    const on = () => setR(stored())
    addEventListener(EVENT, on); addEventListener('storage', on)
    return () => { removeEventListener(EVENT, on); removeEventListener('storage', on) }
  }, [])
  return r
}

/** The roles you joined (server: they follow you to every machine); the one you read as is per browser. */
export type RolesView = { joined: Role[]; setups: Partial<Record<Role, { slots?: Partial<Record<'review' | 'revise' | 'exec' | 'plan', string>> }>>; base: Record<'review' | 'revise' | 'exec' | 'plan', string>; owners: Record<string, Role | 'shared'> }
