// Linked work between a Linear ticket and its PRs: which PR's agent the ticket's next step belongs to.
import { config } from './config.ts'

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
type Areas = Record<string, string[]> // settings → areas: an area of your code, and the words that point to it
/** A PR's area, from its title's scope (`feat(backend): …`), else from its branch naming an area or one of its words. */
export function areaOf(title: string, branch = '', areas: Areas = config.areas ?? {}): string {
  const scope = title.match(/^\w+\(([^)]+)\)/)?.[1]
  if (scope) return scope.toLowerCase()
  return Object.entries(areas).find(([a, words]) => new RegExp(`(${[a, ...words].map(esc).join('|')})`, 'i').test(branch))?.[0] ?? ''
}
/**
 * Which linked PR's agent should take the work next: the one the ticket agent's latest report is about (its number,
 * its area's words, its paths). Pure, so it is tested; nothing is suggested when no PR clearly stands out.
 */
export function suggestPr(text: string, prs: { number: number; area: string }[], areas: Areas = config.areas ?? {}): { number: number; why: string } | undefined {
  const low = text.toLowerCase()
  const count = (w: string) => low.split(w).length - 1
  const scored = prs.map((p) => {
    const words = p.area ? [p.area, ...(areas[p.area] ?? [])] : []
    const hits = words.reduce((n, w) => n + count(w), 0)
    const score = count(`#${p.number}`) * 5 + (p.area ? count(`apps/${p.area}`) * 3 : 0) + hits * 2
    return { ...p, score }
  }).sort((a, b) => b.score - a.score)
  const [top, next] = scored
  if (!top || top.score < 2 || (next && next.score * 1.5 > top.score)) return undefined
  return { number: top.number, why: top.area ? `its last report is mostly about ${top.area}` : `its last report names #${top.number}` }
}
