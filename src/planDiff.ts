// What a scenario changes, against the plan as it is: when it lands, whether it fits the appetite, what was cut or
// brought back, which tickets now finish later and why, how the critical path moved, and what Apply would write to
// Linear (per issue). Pure, so it is tested on its own (planDiff.test.ts) and the page recomputes it on every move.
import { LATER, type Plan, type PlanNode } from '../server/planOps.ts'
import { planStream } from './planStream.ts'

const WEEK = 7 * 86_400_000
export type LinearWrite = { id: string; issue: string; identifier?: string; changes: string[]; patch: { estimate?: number; priority?: number; parentId?: string | null; assigneeId?: string | null; backlog?: boolean } }
export type Impact = {
  moves: number
  endBefore: number; endAfter: number; days: number // weeks from now, and the change in days (negative: earlier)
  fitsBefore?: boolean; fitsAfter?: boolean // inside the appetite (none set: undefined)
  cut: { id: string; title: string; points: number }[]; back: { id: string; title: string; points: number }[]
  later: { id: string; title: string; days: number; because?: string }[] // finishing later than before
  criticalBefore: string[]; criticalAfter: string[]
  writes: LinearWrite[]
}

const PRIORITY = ['None', 'Urgent', 'High', 'Medium', 'Low']
export function impact(base: Plan, whatIf: Plan, people: number, pace: number, now = Date.now()): Impact {
  const a = planStream(base.nodes, base.links, people, pace), b = planStream(whatIf.nodes, whatIf.links, people, pace)
  const slotA = new Map(a.streams.flatMap((s) => s.slots).map((x) => [x.id, x])), slotB = new Map(b.streams.flatMap((s) => s.slots).map((x) => [x.id, x]))
  const appetite = base.appetite ? (Date.parse(base.appetite.from) + base.appetite.weeks * WEEK - now) / WEEK : undefined
  const byA = new Map(base.nodes.map((n) => [n.id, n])), byB = new Map(whatIf.nodes.map((n) => [n.id, n]))
  const isCut = (n?: PlanNode) => n?.parent === LATER
  const pts = (n: PlanNode) => slotB.get(n.id)?.points ?? slotA.get(n.id)?.points ?? n.estimate ?? 0
  const cut = whatIf.nodes.filter((n) => n.kind === 'ticket' && isCut(n) && !isCut(byA.get(n.id))).map((n) => ({ id: n.id, title: n.title, points: pts(n) }))
  const back = whatIf.nodes.filter((n) => n.kind === 'ticket' && !isCut(n) && isCut(byA.get(n.id))).map((n) => ({ id: n.id, title: n.title, points: pts(n) }))
  // finishing later: by how much, and the blocker that moved, if one did
  const later = [...slotB.values()].flatMap((s) => {
    const was = slotA.get(s.id)
    if (!was || s.done || isCut(byB.get(s.id)) || s.end - was.end < 0.1) return []
    const blocker = whatIf.links.filter((l) => l.to === s.id).find((l) => (slotB.get(l.from)?.end ?? 0) > (slotA.get(l.from)?.end ?? 0) + 0.05)
    return [{ id: s.id, title: byB.get(s.id)?.title ?? s.id, days: Math.round((s.end - was.end) * 7), ...(blocker && { because: byB.get(blocker.from)?.title }) }]
  }).sort((x, y) => y.days - x.days)
  // what Apply writes to Linear: only for issues already there, only what Linear has (order stays in the plan)
  const writes: LinearWrite[] = whatIf.nodes.flatMap((n) => {
    const o = byA.get(n.id)
    if (!o || !n.created || n.kind === 'goal' || n.kind === 'milestone') return []
    const changes: string[] = [], patch: LinearWrite['patch'] = {}
    if (isCut(n) !== isCut(o)) { if (isCut(n)) { changes.push('to Backlog (cut)'); patch.backlog = true } }
    if (n.estimate && n.estimate !== o.estimate) { changes.push(`estimate ${o.estimate ?? '?'} → ${n.estimate}`); patch.estimate = n.estimate }
    if ((n.priority ?? 0) !== (o.priority ?? 0)) { changes.push(`priority ${PRIORITY[o.priority ?? 0]} → ${PRIORITY[n.priority ?? 0]}`); patch.priority = n.priority ?? 0 }
    if (n.parent !== o.parent && !isCut(n)) {
      const p = n.parent ? byB.get(n.parent) : undefined
      // a parent issue in Linear (an epic made there); a plan-only one can't be written, a goal or milestone means none
      if (p?.created && p.kind !== 'goal' && p.kind !== 'milestone') { changes.push(`under ${p.created.identifier ?? p.title}`); patch.parentId = p.created.id }
      else if (!p || p.kind === 'goal') { changes.push('no parent'); patch.parentId = null }
    }
    if ((n.assigneeId ?? n.assignee) !== (o.assigneeId ?? o.assignee)) {
      if (!n.assignee) { changes.push('unassigned'); patch.assigneeId = null }
      else if (n.assigneeId) { changes.push(`assigned to ${n.assignee}`); patch.assigneeId = n.assigneeId }
    }
    return changes.length ? [{ id: n.id, issue: n.created.id, identifier: n.created.identifier, changes, patch }] : []
  })
  return {
    moves: whatIf === base ? 0 : (base.scenario?.ops.length ?? 0),
    endBefore: a.end, endAfter: b.end, days: Math.round((b.end - a.end) * 7),
    ...(appetite !== undefined && { fitsBefore: a.end <= appetite + 1e-9, fitsAfter: b.end <= appetite + 1e-9 }),
    cut, back, later, criticalBefore: a.critical, criticalAfter: b.critical, writes,
  }
}
