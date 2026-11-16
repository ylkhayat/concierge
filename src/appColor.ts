// Each application (repository) gets its own look, so its rows stand out when every app is listed together: a colour
// (the edge, its name) and a faint texture on the row itself (plain, stripes, dots, grid), so two apps differ even at a glance.
// In alphabetical order of the apps you have (the same on every device, no setting); one not known yet falls back to
// a hash of its name. ponytail: a ninth app reuses the first look; add more or an override if that happens
import type { CSSProperties } from 'react'

// neighbours far apart on the colour wheel, so the first few apps never look alike
const PALETTE = [
  { rgb: '14 165 233', bar: 'bg-run', text: 'text-run-text', tile: 'bg-run/15 text-run-text' },
  { rgb: '249 115 22', bar: 'bg-wait', text: 'text-wait-text', tile: 'bg-wait/15 text-wait-text' },
  { rgb: '217 70 239', bar: 'bg-fuchsia-500', text: 'text-fuchsia-700 dark:text-fuchsia-300', tile: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300' },
  { rgb: '132 204 22', bar: 'bg-lime-500', text: 'text-lime-700 dark:text-lime-300', tile: 'bg-lime-500/15 text-lime-700 dark:text-lime-300' },
  { rgb: '99 102 241', bar: 'bg-accent', text: 'text-accent-text', tile: 'bg-accent/15 text-accent-text' },
  { rgb: '245 158 11', bar: 'bg-wait', text: 'text-wait-text', tile: 'bg-wait/15 text-wait-text' },
  { rgb: '20 184 166', bar: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300', tile: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  { rgb: '244 63 94', bar: 'bg-fail', text: 'text-fail-text', tile: 'bg-fail/15 text-fail-text' },
]

// the row's texture, in the app's colour: drawn over the row's own background, so hover and selection still show
const TEXTURE = [
  (c: string) => ({ backgroundImage: `linear-gradient(90deg, rgb(${c} / 0.05), transparent 50%)` }),
  (c: string) => ({ backgroundImage: `repeating-linear-gradient(135deg, rgb(${c} / 0.05) 0 1px, transparent 1px 8px)` }),
  (c: string) => ({ backgroundImage: `radial-gradient(rgb(${c} / 0.11) 0.8px, transparent 1.1px)`, backgroundSize: '9px 9px' }),
  (c: string) => ({ backgroundImage: `linear-gradient(rgb(${c} / 0.045) 1px, transparent 1px), linear-gradient(90deg, rgb(${c} / 0.045) 1px, transparent 1px)`, backgroundSize: '10px 10px' }),
]

let known: string[] = []
/** The apps there are (App calls this as the lists load), so each gets a look of its own. */
export const knowApps = (repos: string[]) => { known = [...new Set(repos)].sort() }
const indexOf = (repo: string) => {
  const i = known.indexOf(repo)
  if (i >= 0) return i
  let h = 0
  for (const c of repo) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
export function appColor(repo: string) {
  const i = indexOf(repo), p = PALETTE[i % PALETTE.length]
  return { ...p, style: TEXTURE[i % TEXTURE.length](p.rgb) as CSSProperties }
}
