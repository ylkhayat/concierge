// How a plan's items read on both views (Stream and Tree): what still needs refining, who picked it up, and the angles
// the plan hasn't covered yet, each with its own mark.
import { Accessibility, BarChart3, FlaskConical, Globe, LifeBuoy, Lock, Plug, Rocket, Scale, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import type { Gap } from '../server/plans.ts'
export { refineOf } from './planStream.ts'

export const initials = (name: string) => name.split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

export const AREA: Record<string, { label: string; icon: LucideIcon; hue: number }> = {
  constraints: { label: 'Constraints', icon: Scale, hue: 60 },
  stories: { label: 'User stories', icon: Users, hue: 250 },
  clients: { label: 'Clients & integrations', icon: Plug, hue: 200 },
  compliance: { label: 'Compliance', icon: ShieldCheck, hue: 150 },
  security: { label: 'Security', icon: Lock, hue: 20 },
  data: { label: 'Data & success', icon: BarChart3, hue: 280 },
  rollout: { label: 'Rollout', icon: Rocket, hue: 320 },
  support: { label: 'Support & docs', icon: LifeBuoy, hue: 100 },
  accessibility: { label: 'Accessibility', icon: Accessibility, hue: 230 },
  localisation: { label: 'Localisation', icon: Globe, hue: 180 },
  research: { label: 'Needs investigation', icon: FlaskConical, hue: 40 },
}
export const areaOf = (g: Gap) => AREA[g.area] ?? { label: g.area || 'Other', icon: FlaskConical, hue: 0 }
/** What exploring an angle asks the planner. */
export const explore = (g: Gap) => `Explore the ${areaOf(g).label.toLowerCase()} angle and add it to the plan: ${g.title}. ${g.why}`
