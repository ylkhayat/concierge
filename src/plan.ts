import type { PrView } from '../server/index.ts'

/**
 * The picked PRs as review runs: the ones in one GitHub stack go together, bottom first (each waits for the review
 * below it), every other PR on its own; the runs in the order first picked.
 */
export function reviewPlan(picked: string[], prs: PrView[]): string[][] {
  const byId = new Map(prs.map((p) => [p.id, p]))
  const runs = new Map<string, string[]>()
  for (const id of picked) {
    const p = byId.get(id)
    if (!p) continue
    const k = p.stack ? `${p.repo}#${p.stack[0].number}` : id
    runs.set(k, [...(runs.get(k) ?? []), id])
  }
  const at = (id: string) => { const p = byId.get(id)!; return p.stack?.findIndex((s) => s.number === p.number) ?? 0 }
  return [...runs.values()].map((r) => r.sort((a, b) => at(a) - at(b)))
}
