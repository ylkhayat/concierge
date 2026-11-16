// Strategic plays: one click proposes a scenario of moves (never applies it), worked out from the plan itself. Each
// answers a question a product manager asks of a roadmap: what do we cut to fit the time, what do we learn first,
// what holds the date, who takes what. Pure, so each is tested (planPlays.test.ts).
import { applyAll, LATER, riceOf, type Op, type Plan, type PlanNode } from '../server/planOps.ts'
import { orderOf, planStream, ranksOf } from './planStream.ts'

type Move = Extract<Op, { op: 'move' }>
export type Play = { id: string; label: string; hint: string; ops: Move[] }
const WEEK = 7 * 86_400_000
const open = (n: PlanNode) => n.kind === 'ticket' && n.parent !== LATER && n.state?.type !== 'completed' && n.state?.type !== 'canceled' && n.state?.type !== 'started'
// what a ticket is worth, low first: a won't, then could; then low priority; then the lowest RICE
const worth = (n: PlanNode) => [({ wont: 0, could: 1, should: 2, must: 3 } as const)[n.moscow ?? 'should'], 5 - (n.priority ?? 3), riceOf(n) ?? 0] as const
const cheaper = (a: PlanNode, b: PlanNode) => { const x = worth(a), y = worth(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }

/** Cut the least valuable work, one ticket at a time, until it lands inside the appetite. None: it already fits, or no appetite. */
export function fitAppetite(p: Plan, people: number, pace: number, now = Date.now()): Move[] {
  if (!p.appetite) return []
  const limit = (Date.parse(p.appetite.from) + p.appetite.weeks * WEEK - now) / WEEK
  const ops: Move[] = []
  let q = p
  for (const n of p.nodes.filter((x) => open(x) && x.moscow !== 'must' && x.priority !== 1).sort(cheaper)) {
    if (planStream(q.nodes, q.links, people, pace).end <= limit + 1e-9) break
    ops.push({ op: 'move', id: n.id, cut: true }); q = applyAll(p, ops)
  }
  return planStream(q.nodes, q.links, people, pace).end <= limit + 1e-9 || ops.length ? ops : []
}

/** What we don't know yet goes first: spikes, tickets that need refining or are unsized, the risky ones. */
export function riskFirst(p: Plan): Move[] {
  const risky = (n: PlanNode) => !!n.refine || !n.estimate || n.state?.type === 'backlog' || n.state?.type === 'triage' || /\b(spike|investigat|research|prototype|proof of concept|poc)\b/i.test(n.title)
  const order = orderOf(p.nodes).filter(open), ranks = ranksOf(p.nodes)
  const first = Math.min(0, ...[...ranks.values()]) - 1
  const lead = order.filter(risky)
  if (!lead.length || order.slice(0, lead.length).every((n) => lead.includes(n))) return []
  return lead.map((n, i) => ({ op: 'move', id: n.id, rank: first - lead.length + i }))
}

/** What sets the end date goes first, in its own order, so nothing else delays it. */
export function criticalFirst(p: Plan, people: number, pace: number): Move[] {
  const crit = planStream(p.nodes, p.links, people, pace).critical.map((id) => p.nodes.find((n) => n.id === id)!).filter((n) => n && open(n))
  const ranks = ranksOf(p.nodes), first = Math.min(0, ...[...ranks.values()]) - 1
  const order = orderOf(p.nodes).filter(open)
  if (!crit.length || order.slice(0, crit.length).every((n, i) => n.id === crit[i].id)) return []
  return crit.map((n, i) => ({ op: 'move', id: n.id, rank: first - crit.length + i }))
}

/** Owners for the unassigned work: each ticket to whoever of the project's people has the least on their plate. */
export function balanceOwners(p: Plan): Move[] {
  const people = p.members ?? []
  if (people.length < 2) return []
  const load = new Map(people.map((m) => [m.name, 0]))
  for (const n of p.nodes) if (open(n) && n.assignee && load.has(n.assignee)) load.set(n.assignee, load.get(n.assignee)! + (n.estimate ?? 2))
  return orderOf(p.nodes).filter((n) => open(n) && !n.assignee).map((n) => {
    const who = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0]
    load.set(who, load.get(who)! + (n.estimate ?? 2))
    return { op: 'move' as const, id: n.id, assignee: who, assigneeId: people.find((m) => m.name === who)?.id }
  })
}

/** The plays that would change something here, each with its moves. */
export function playsFor(p: Plan, people: number, pace: number): Play[] {
  return ([
    ['fit', 'Fit the appetite', 'Cut the least valuable work until it lands inside the time it is worth', fitAppetite(p, people, pace)],
    ['risk', 'Risk first', 'Spikes, unsized and unrefined tickets first: learn early, while there is time to change course', riskFirst(p)],
    ['critical', 'Protect the date', 'The chain that sets the end date first, so nothing else delays it', criticalFirst(p, people, pace)],
    ['owners', 'Balance owners', 'Give the unassigned work to whoever has the least on their plate', balanceOwners(p)],
  ] as const).filter(([, , , ops]) => ops.length).map(([id, label, hint, ops]) => ({ id, label, hint, ops: [...ops] }))
}
