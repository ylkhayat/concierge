// A plan in time, for its Stream view: when each ticket would be worked on, from now, if the people on it pick up the
// most valuable ticket whose dependencies are done, one at a time each, at their pace. Weeks from now; done tickets
// sit before 0. Pure, so it is tested on its own (planStream.test.ts).
import { LATER, type Link, type PlanNode } from '../server/planOps.ts'

export type Slot = { id: string; head?: string; start: number; end: number; done: boolean; started: boolean; points: number; sized: boolean; refine?: string; who?: string; lane?: string }
export type Stream = { id: string; node?: PlanNode; title: string; slots: Slot[]; start: number; end: number; points: number }

const HEADS = new Set(['epic', 'milestone'])
/** The order work is taken in: what is going on first, then each ticket's rank (unranked: by priority, then where it sits). */
export function orderOf(nodes: PlanNode[]): PlanNode[] {
  const tickets = nodes.filter((n) => n.kind === 'ticket')
  const byDefault = [...tickets].sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || nodes.indexOf(a) - nodes.indexOf(b))
  const key = new Map(byDefault.map((n, i) => [n.id, n.rank ?? i]))
  return [...tickets].sort((a, b) => Number(b.state?.type === 'started') - Number(a.state?.type === 'started') || key.get(a.id)! - key.get(b.id)! || byDefault.indexOf(a) - byDefault.indexOf(b))
}
/** Each ticket's place in that order, as a number a move can fall between (its rank, else where it sits by default). */
export function ranksOf(nodes: PlanNode[]): Map<string, number> {
  const byDefault = nodes.filter((n) => n.kind === 'ticket').sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || nodes.indexOf(a) - nodes.indexOf(b))
  return new Map(byDefault.map((n, i) => [n.id, n.rank ?? i]))
}

export function planStream(nodes: PlanNode[], links: Link[], people = 1, pace = 5): { streams: Stream[]; end: number; guess: number; critical: string[]; lanes: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const headOf = (n: PlanNode): string | undefined => { let x = n.parent ? byId.get(n.parent) : undefined; for (let i = 0; x && i < 20; i++) { if (HEADS.has(x.kind)) return x.id; x = x.parent ? byId.get(x.parent) : undefined } return undefined }
  // cut work (under the Later epic) is out of the schedule: the map shows it apart, as what was cut
  const isCut = (n: PlanNode) => { let x: PlanNode | undefined = n; for (let i = 0; x && i < 20; i++) { if (x.id === LATER) return true; x = x.parent ? byId.get(x.parent) : undefined } return false }
  const tickets = nodes.filter((n) => n.kind === 'ticket' && n.state?.type !== 'canceled' && !isCut(n))
  const known = tickets.filter((t) => t.estimate).map((t) => t.estimate!)
  const guess = known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 2
  const pts = (t: PlanNode) => t.estimate ?? guess
  const weeks = (t: PlanNode) => Math.max(0.2, pts(t) / Math.max(0.1, pace))
  const slots = new Map<string, Slot>()
  // what is done: before now, back to back per stream, so it still shows as the stream's start
  const doneBack = new Map<string | undefined, number>()
  for (const t of tickets.filter((x) => x.state?.type === 'completed')) {
    const h = headOf(t), back = doneBack.get(h) ?? 0, w = weeks(t)
    slots.set(t.id, { id: t.id, head: h, start: -back - w, end: back ? -back : 0, done: true, started: false, points: pts(t), sized: !!t.estimate, who: t.assignee })
    doneBack.set(h, back + w)
  }
  // the rest: the people on it, named ones first (an assigned ticket waits for its own person), then as many unnamed
  // as the plan's people count leaves; whoever is free first takes the most valuable ticket that is ready for them
  const left = orderOf(tickets).filter((t) => t.state?.type !== 'completed' && t.state?.type !== 'canceled')
  const named = [...new Set(left.map((t) => t.assignee).filter((x): x is string => !!x))]
  const lanes = [...named, ...Array.from({ length: Math.max(named.length ? 0 : 1, Math.round(people) - named.length) }, (_, i) => `Person ${named.length + i + 1}`)]
  const free = new Map(lanes.map((l) => [l, 0]))
  const waits = (t: PlanNode) => links.filter((l) => l.to === t.id && left.some((x) => x.id === l.from)).map((l) => l.from)
  const after = (t: PlanNode) => Math.max(0, ...waits(t).map((w) => slots.get(w)?.end ?? 0))
  const fits = (t: PlanNode, lane: string) => !t.assignee || t.assignee === lane
  const todo = [...left]
  for (let guard = 0; todo.length && guard < 10_000; guard++) {
    const ready = todo.filter((t) => waits(t).every((w) => slots.has(w)))
    // each person's next ticket: the most valuable they can start when free, else the one they can start soonest;
    // whoever starts soonest takes theirs (a loop of dependencies is broken by taking the first anyway)
    let best: { t: PlanNode; lane: string; start: number } | undefined
    for (const lane of lanes) {
      const now = free.get(lane)!, mine = ready.filter((t) => fits(t, lane))
      const t = mine.find((x) => after(x) <= now) ?? [...mine].sort((a, b) => after(a) - after(b))[0]
      if (!t) continue
      const start = Math.max(now, after(t))
      if (!best || start < best.start - 1e-9 || (Math.abs(start - best.start) < 1e-9 && todo.indexOf(t) < todo.indexOf(best.t))) best = { t, lane, start }
    }
    if (!best) { const t = todo[0]; const lane = lanes.find((l) => fits(t, l)) ?? lanes[0]; best = { t, lane, start: Math.max(free.get(lane)!, after(t)) } }
    const { t, lane, start } = best
    todo.splice(todo.indexOf(t), 1)
    slots.set(t.id, { id: t.id, head: headOf(t), start, end: start + weeks(t), done: false, started: t.state?.type === 'started', points: pts(t), sized: !!t.estimate, refine: refineOf(t), who: t.assignee, lane })
    free.set(lane, start + weeks(t))
  }
  // the critical path: from what ends last, back through whatever it waited for (a blocker, or its person's previous
  // ticket) to now; moving any of these moves the end
  const critical: string[] = []
  const open = [...slots.values()].filter((x) => !x.done)
  let at = open.sort((a, b) => b.end - a.end)[0]
  for (let i = 0; at && i < 500; i++) {
    critical.unshift(at.id)
    if (at.start <= 1e-9) break
    const cur: Slot = at
    const by = links.filter((l) => l.to === cur.id).map((l) => slots.get(l.from)).find((x) => x && !x.done && Math.abs(x.end - cur.start) < 1e-6)
      ?? open.find((x) => x.lane === cur.lane && x.id !== cur.id && Math.abs(x.end - cur.start) < 1e-6)
    at = by!
  }
  const heads = nodes.filter((n) => HEADS.has(n.kind) && n.id !== LATER)
  const make = (id: string, node: PlanNode | undefined, title: string): Stream | undefined => {
    const mine = [...slots.values()].filter((s) => (s.head ?? 'loose') === id).sort((a, b) => a.start - b.start)
    if (!mine.length && !node) return undefined
    return { id, node, title, slots: mine, start: Math.min(0, ...mine.map((s) => s.start)), end: Math.max(0, ...mine.map((s) => s.end)), points: mine.reduce((a, s) => a + s.points, 0) }
  }
  const streams = [...heads.map((h) => make(h.id, h, h.title)), make('loose', undefined, heads.length ? 'Not in an epic yet' : 'Tickets')].filter((s): s is Stream => !!s)
    .sort((a, b) => a.start - b.start || b.points - a.points)
  return { streams, end: Math.max(0, ...streams.map((s) => s.end)), guess, critical, lanes }
}

/** Why an item isn't ready to pick up: the agent's note, a Linear backlog or triage state, or a ticket with no size. */
export function refineOf(n: PlanNode): string | undefined {
  if (n.state?.type === 'completed' || n.state?.type === 'canceled' || n.state?.type === 'started') return undefined
  if (n.refine) return n.refine
  if (n.state?.type === 'backlog' || n.state?.type === 'triage') return `In ${n.state.name}: not refined yet`
  if (n.kind === 'ticket' && !n.estimate) return 'No estimate yet'
  return undefined
}

// points for a pebble stretched from one width to another, snapped to the sizes teams estimate in
const SIZES = [1, 2, 3, 5, 8, 13, 21]
export const sizeFor = (pts: number, from: number, to: number) => { const want = Math.max(1, pts) * (to / Math.max(1, from)); return SIZES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) }
