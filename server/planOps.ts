// A plan's shape and the changes made to it (op lines from the planner, your edits, the moves of a scenario): pure, no
// node, so the page applies a scenario's moves to a copy for the what-if view exactly as the server applies them.
export type Kind = 'goal' | 'milestone' | 'epic' | 'ticket'
export type PlanNode = {
  id: string; kind: Kind; title: string; description?: string
  parent?: string // the node it sits under
  priority?: 1 | 2 | 3 | 4 // Linear's: urgent, high, medium, low
  estimate?: number // points
  by?: 'agent' | 'you' // who made it or last changed it
  created?: { id: string; identifier?: string; url: string } // made in Linear (a goal: a project; a milestone: a project milestone)
  state?: { name: string; type: string } // in Linear: its workflow state (type: backlog, unstarted, started, completed, canceled)
  assignee?: string
  target?: string // a milestone's target date
  refine?: string // what it still needs before someone can pick it up (an open question, a missing decision)
  rank?: number // its place in the order of work (lower first); unset: by priority, then where it sits
  assigneeId?: string // in Linear: who it is assigned to (assignee: their name)
  cutFrom?: string // cut to Later: the node it sat under, to put it back
  // the planning best practices the planner fills: how much it is worth (RICE, effort being the estimate), what kind of
  // must it is (MoSCoW), and when it belongs (now, next, later)
  rice?: { reach: number; impact: number; confidence: number }
  moscow?: 'must' | 'should' | 'could' | 'wont'
  horizon?: 'now' | 'next' | 'later'
  covers?: string[] // the company obligations it covers (readiness.ts: dpia, security-review…)
  risk?: { likelihood: 1 | 2 | 3; impact: 1 | 2 | 3; note: string } // a risk it carries or mitigates, for the register
}
// an angle the plan hasn't covered yet (compliance, security, constraints, the clients it touches…): drawn faint on the
// map where it would go, for the product manager to explore with a click
export type Gap = { id: string; area: string; title: string; why: string; under?: string }
export type Link = { from: string; to: string } // `from` has to be done before `to` (Linear: from blocks to)
export type Said = { who: 'you' | 'agent'; text: string; at: string }
export type Plan = {
  id: string; title: string; brief: string; method: 'agile' | 'waterfall'; skill?: string; team?: string
  nodes: PlanNode[]; links: Link[]; messages: Said[]
  busy?: boolean; live?: string // the reply as it streams
  creating?: boolean; error?: string; sessionId?: string; costUsd: number; at: string
  related?: string[] // the links made in Linear ("from>to")
  // an existing Linear project the plan contributes to: its vision and timeline, and whether you lead it (then the
  // plan may rewrite its vision; otherwise it only adds tickets)
  project?: { id: string; name: string; url: string; lead: boolean; leadName?: string; vision: string; startDate?: string; targetDate?: string; members: number; syncedAt: string }
  vision?: string // a new vision the agent proposes (only for a project you lead), for you to apply
  // what the agent needs from you, each with options and its pick (answered with a click), and what you could do next:
  // both from its last reply
  asks?: { q: string; options: string[]; pick?: number }[]
  suggest?: string[]
  gaps?: Gap[]
  people?: number; pace?: number // the forecast's: people on it, and points each finishes a week
  appetite?: { weeks: number; from: string } // how much time the work is worth (Shape Up): the plan fits its scope into it
  members?: { id: string; name: string }[] // the project's people in Linear, to assign work to
  // moves being tried: applied to a copy for the what-if view, and to the plan (and Linear) only on Apply
  scenario?: { ops: Op[]; at: string; why?: string }
}
export type Op =
  | { op: 'add'; id: string; kind: Kind; title: string; parent?: string; description?: string; priority?: 1 | 2 | 3 | 4; estimate?: number; refine?: string } & Best
  | { op: 'update'; id: string; title?: string; parent?: string; description?: string; priority?: 1 | 2 | 3 | 4; estimate?: number; kind?: Kind; refine?: string } & Best
  | { op: 'remove'; id: string }
  | { op: 'link' | 'unlink'; from: string; to: string }
  | { op: 'vision'; text: string } // a new vision for the project (only when you lead it)
  | { op: 'ask'; q: string; options: string[]; pick?: number } // a question for the product manager, with its options
  | { op: 'next'; items: string[] } // what the product manager could do next
  | { op: 'gaps'; items: Omit<Gap, 'id'>[] } // the angles not covered yet (the whole list, each reply)
  // a strategic move: where it sits in the order, under which epic, how urgent, who works it, or cut to Later (and
  // back). Unlike update it also moves what is already in Linear (Apply writes it there)
  // a scenario the planner proposes: moves for the product manager to try (never applied by it)
  | { op: 'propose'; ops: Op[]; why?: string }
  | { op: 'move'; id: string; rank?: number; parent?: string; priority?: 1 | 2 | 3 | 4; assignee?: string | null; assigneeId?: string | null; cut?: boolean }

export const LATER = 'later' // the epic cut work goes under
type Best = { rice?: PlanNode['rice']; moscow?: PlanNode['moscow']; horizon?: PlanNode['horizon']; covers?: string[]; risk?: PlanNode['risk'] }
/** RICE: reach × impact × confidence over effort (the estimate; 1 when unsized). Higher is worth more. */
export const riceOf = (n: PlanNode) => (n.rice ? (n.rice.reach * n.rice.impact * n.rice.confidence) / Math.max(1, n.estimate ?? 1) : undefined)
const best = (o: Best): Best => ({
  ...(o.rice && [o.rice.reach, o.rice.impact, o.rice.confidence].every((v) => Number.isFinite(Number(v))) && { rice: { reach: Number(o.rice.reach), impact: Number(o.rice.impact), confidence: Math.min(1, Math.max(0, Number(o.rice.confidence))) } }),
  ...(o.moscow && ['must', 'should', 'could', 'wont'].includes(o.moscow) && { moscow: o.moscow }),
  ...(o.horizon && ['now', 'next', 'later'].includes(o.horizon) && { horizon: o.horizon }),
  ...(Array.isArray(o.covers) && { covers: o.covers.map(String).filter((x) => /^[a-z0-9-]{2,40}$/.test(x)).slice(0, 8) }),
  ...(o.risk && [1, 2, 3].includes(Number(o.risk.likelihood)) && [1, 2, 3].includes(Number(o.risk.impact)) && { risk: { likelihood: Number(o.risk.likelihood) as 1, impact: Number(o.risk.impact) as 1, note: String(o.risk.note ?? '').slice(0, 200) } }),
})

/** Apply one change to the map; one that doesn't fit (an unknown node, a loop) is skipped. Created nodes keep their link to Linear. */
export function apply(p: Plan, o: Op, by: 'agent' | 'you'): boolean {
  if (o.op === 'ask') {
    const options = Array.isArray(o.options) ? o.options.map(String).filter(Boolean).slice(0, 4) : []
    if (!o.q || options.length < 2) return false
    ;(p.asks ??= []).push({ q: String(o.q).slice(0, 300), options: options.map((x) => x.slice(0, 120)), ...(Number.isInteger(o.pick) && o.pick! < options.length && { pick: o.pick }) })
    return true
  }
  if (o.op === 'next') { p.suggest = (Array.isArray(o.items) ? o.items : []).map(String).filter(Boolean).slice(0, 4).map((x) => x.slice(0, 90)); return true }
  if (o.op === 'gaps') {
    const items = Array.isArray(o.items) ? o.items : []
    p.gaps = items.filter((g) => g?.title).slice(0, 8).map((g, i) => ({ id: `gap${i}`, area: String(g.area ?? 'other').slice(0, 30).toLowerCase(), title: String(g.title).slice(0, 90), why: String(g.why ?? '').slice(0, 240),
      ...(g.under && p.nodes.some((n) => n.id === g.under) && { under: g.under }) }))
    return true
  }
  if (o.op === 'propose') {
    // only moves, only of what exists: added to whatever is being tried
    const moves = (Array.isArray(o.ops) ? o.ops : []).filter((x): x is Extract<Op, { op: 'move' }> => x?.op === 'move' && p.nodes.some((n) => n.id === x.id)).slice(0, 100)
    if (!moves.length) return false
    p.scenario = { ops: [...(p.scenario?.ops ?? []), ...moves], at: new Date().toISOString(), ...(o.why && { why: String(o.why).slice(0, 300) }) }
    return true
  }
  if (o.op === 'vision') { if (!p.project || p.project.lead) { p.vision = String(o.text ?? '').slice(0, 20_000); return true } return false }
  const has = (id?: string) => !!id && p.nodes.some((n) => n.id === id)
  const under = (id: string, anc: string): boolean => { let n = p.nodes.find((x) => x.id === id); for (let i = 0; n && i < 50; i++) { if (n.parent === anc) return true; n = p.nodes.find((x) => x.id === n!.parent) } return false }
  switch (o.op) {
    case 'add': {
      if (!o.id || !o.title) return false
      if (has(o.id)) return apply(p, { ...o, op: 'update' }, by)
      if (p.project && o.kind === 'goal' && p.nodes.some((n) => n.kind === 'goal')) return false // the project is the goal
      p.nodes.push({ id: o.id, kind: o.kind ?? 'ticket', title: o.title, ...(has(o.parent) && { parent: o.parent }), description: o.description, priority: o.priority, estimate: o.estimate, ...(o.refine && { refine: String(o.refine).slice(0, 200) }), ...best(o), by })
      return true
    }
    case 'update': {
      const n = p.nodes.find((x) => x.id === o.id); if (!n) return false
      // in Linear: its words change there (and sync back); only the planning fields, which live here, change here
      if (n.created) { const b = best(o); if (!Object.keys(b).length) return false; Object.assign(n, b); return true }
      const { op: _, id: __, parent, rice: _r, moscow: _m, horizon: _h, covers: _c, risk: _k, ...rest } = o
      Object.assign(n, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), best(o), { by })
      if (n.refine === '') delete n.refine
      if (parent !== undefined) { if (!parent) delete n.parent; else if (has(parent) && parent !== n.id && !under(parent, n.id)) n.parent = parent }
      return true
    }
    case 'remove': {
      if (!has(o.id) || p.nodes.find((x) => x.id === o.id)!.created) return false
      const gone = new Set([o.id]); let grew = true
      while (grew) { grew = false; for (const n of p.nodes) if (n.parent && gone.has(n.parent) && !gone.has(n.id)) { gone.add(n.id); grew = true } }
      p.nodes = p.nodes.filter((n) => !gone.has(n.id)); p.links = p.links.filter((l) => !gone.has(l.from) && !gone.has(l.to))
      return true
    }
    case 'link': {
      if (!has(o.from) || !has(o.to) || o.from === o.to || p.links.some((l) => l.from === o.from && l.to === o.to)) return false
      // no loops: `to` must not already lead to `from`
      const leads = (a: string, b: string, seen = new Set<string>()): boolean => a === b || (!seen.has(a) && (seen.add(a), p.links.some((l) => l.from === a && leads(l.to, b, seen))))
      if (leads(o.to, o.from)) return false
      p.links.push({ from: o.from, to: o.to }); return true
    }
    case 'unlink': { const n = p.links.length; p.links = p.links.filter((l) => !(l.from === o.from && l.to === o.to)); return p.links.length < n }
    case 'move': {
      const n = p.nodes.find((x) => x.id === o.id); if (!n || n.kind === 'goal') return false
      if (o.cut === true && !n.cutFrom) {
        // under one Later epic, at the lowest priority: the cut stays visible, and comes back with cut: false
        let later = p.nodes.find((x) => x.id === LATER)
        if (!later) { later = { id: LATER, kind: 'epic', title: 'Later: beyond the appetite', priority: 4, by }; const g = p.nodes.find((x) => x.kind === 'goal'); if (g) later.parent = g.id; p.nodes.push(later) }
        n.cutFrom = n.parent ?? ''; n.parent = LATER; n.priority = 4
      } else if (o.cut === false && n.cutFrom !== undefined) {
        if (n.cutFrom && has(n.cutFrom)) n.parent = n.cutFrom; else delete n.parent
        delete n.cutFrom
      }
      if (o.parent !== undefined && o.parent !== n.parent && has(o.parent) && o.parent !== n.id && !under(o.parent, n.id)) { n.parent = o.parent; delete n.cutFrom }
      if (o.rank !== undefined && Number.isFinite(o.rank)) n.rank = o.rank
      if (o.priority !== undefined && [1, 2, 3, 4].includes(o.priority)) n.priority = o.priority
      if (o.assignee !== undefined) { if (o.assignee) { n.assignee = o.assignee; if (o.assigneeId) n.assigneeId = o.assigneeId } else { delete n.assignee; delete n.assigneeId } }
      n.by = by
      return true
    }
  }
  return false
}

/** A copy of the plan with these changes made: the what-if of a scenario. */
export function applyAll(p: Plan, ops: Op[], by: 'agent' | 'you' = 'you'): Plan {
  const q = structuredClone({ ...p, scenario: undefined })
  for (const o of ops) apply(q, o, by)
  return q
}
