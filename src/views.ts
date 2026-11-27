// The views, said once: what the rail lists, what ⌘K offers, what g-then-a-key opens and what the tab is called all
// come from here, for the role you work as. A view added here is on all four; none of them can list one the others don't.
import { ClipboardList, Component, GitPullRequestArrow, Library, Map as MapIcon, Network, Rocket, SwatchBook, type LucideIcon } from 'lucide-react'
import type { DesignView, Mode } from './modes.ts'
import { ROLES, type Role } from './role.ts'

export type View = { key: string; mode: Mode; design?: DesignView; label: string; hint: string; icon: LucideIcon; chord?: string }

export const VIEWS: View[] = [
  { key: 'review', mode: 'review', label: 'Review', hint: 'Review pull requests', icon: GitPullRequestArrow, chord: 'r' },
  { key: 'exec', mode: 'exec', label: 'Ship', hint: 'Ship your Linear tickets', icon: Rocket, chord: 'e' },
  { key: 'standup', mode: 'standup', label: 'Standup', hint: 'What you did and what is next, for the standup', icon: ClipboardList, chord: 's' },
  { key: 'skills', mode: 'skills', label: 'Skills', hint: 'Your skills and the company’s: how much each is used, how well it works, and what to change', icon: Library, chord: 'k' },
  { key: 'plans', mode: 'plans', label: 'Plans', hint: 'Break a brief down into a project with an agent, then create it in Linear', icon: Network, chord: 'p' },
  // Design is the role already: on the rail it is its three views, each its own place
  { key: 'design:map', mode: 'design', design: 'map', label: 'Map', hint: 'The screens of each app, by domain and step, and what each PR changes', icon: MapIcon, chord: 'm' },
  { key: 'design:components', mode: 'design', design: 'components', label: 'Components', hint: 'Every component: its states and where it is used', icon: Component },
  { key: 'design:tokens', mode: 'design', design: 'tokens', label: 'Tokens', hint: 'Each app’s design tokens: colours, type, spacing, radii, shadows', icon: SwatchBook, chord: 't' },
]

/** A role's views, in its rail's order. Review and Ship are also a choice of the setup (`spaces`). */
export const viewsFor = (role: Role, spaces: Mode[]): View[] => {
  const rail = ROLES[role].rail
  return VIEWS.filter((v) => rail.includes(v.mode) && ((v.mode !== 'review' && v.mode !== 'exec') || spaces.includes(v.mode)))
    .map((v, i) => [v, i] as const).sort((a, b) => rail.indexOf(a[0].mode) - rail.indexOf(b[0].mode) || a[1] - b[1]).map(([v]) => v)
}

/** What the tab is called: the view's name. */
export const viewLabel = (mode: Mode, design: DesignView) => VIEWS.find((v) => v.mode === mode && (!v.design || v.design === design))?.label ?? 'Review'
