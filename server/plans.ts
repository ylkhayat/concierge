// Plans: a product manager's brief, broken down with an agent into a project of epics and tickets, drawn live as a map
// while the agent works, edited by hand, then created in Linear with its parents, dependencies and priorities.
// The agent changes the map with op lines in its reply ("@op {json}", one per line); each is applied the moment its
// line is complete, so the map grows while it writes. What it says between them is its reply, streamed too.
// How it breaks a brief down is a skill: the one picked in Settings → Skills (plan-project by default), or another per plan.
import { skillBody } from './method.ts'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { gql } from './linear.ts'
import { providerFor, spawnAgent } from './providers.ts'
import { slot } from './roles.ts'
import { save as persist, state } from './store.ts'
import { stale } from './live.ts'
// kept, and every open page showing it reads it again (live.ts)
const save = () => { persist(); stale('/plans') }

import { apply, applyAll, becauseOf, BOARD, type Op, type Plan, type PlanNode } from './planOps.ts'
import { bankArgs } from './bank.ts'
import { impact } from '../src/planDiff.ts'
import { config } from './config.ts'
import { coverage, obligations } from './readiness.ts'
import { complianceFor, orgs, planOrg, type Org } from './orgs.ts'
import { getMe, gh, ghSend, graphql } from './github.ts'
export * from './planOps.ts'

const all = () => (state.plans ??= {})
export const plans = () => Object.values(all()).sort((a, b) => b.at.localeCompare(a.at))
export const planOf = (id: string) => all()[id]

export function newPlan(title: string, brief: string, method: Plan['method'] = 'agile', appetite?: number, org?: string): Plan {
  const p: Plan = { id: randomUUID().slice(0, 8), title: title || 'New plan', brief, method, nodes: [], links: [], messages: [], costUsd: 0, at: new Date().toISOString(), ...(appetite && appetite > 0 && { appetite: { weeks: Math.min(52, appetite), from: new Date().toISOString() } }), ...(org && /^[\w.-]{1,100}$/.test(org) && { org }) }
  all()[p.id] = p; save()
  return p
}
export function setPlan(id: string, v: Partial<Pick<Plan, 'title' | 'brief' | 'method' | 'skill' | 'team' | 'people' | 'pace' | 'vision' | 'org'>> & { appetite?: number | null }) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  if (v.org !== undefined && !/^[\w.-]{1,100}$/.test(v.org)) throw new Error('Not an organization')
  // an appetite in weeks, counted from when it is set; none (0 or null) takes it away
  if (v.appetite !== undefined) { const w = Number(v.appetite); p.appetite = w > 0 ? { weeks: Math.min(52, w), from: p.appetite?.weeks === w ? p.appetite.from : new Date().toISOString() } : undefined; delete v.appetite }
  Object.assign(p, v, { at: new Date().toISOString() }); save()
  return p
}
export function removePlan(id: string) { delete all()[id]; hist.delete(id); save() }

// Undo and redo: the board before each change (an edit of yours, a scenario move, a whole planner turn), in memory and
// per plan. What reaches Linear (apply, create, sync) can't be taken back there, so it ends the history.
// ponytail: 50 whole snapshots of nodes and links; diffs if a big project makes that heavy
type Snap = Pick<Plan, 'nodes' | 'links' | 'scenario'>
const hist = new Map<string, { past: Snap[]; future: Snap[] }>()
const snapOf = (p: Plan): Snap => structuredClone({ nodes: p.nodes, links: p.links, scenario: p.scenario })
const histOf = (id: string) => { let h = hist.get(id); if (!h) hist.set(id, h = { past: [], future: [] }); return h }
function step(p: Plan) { const h = histOf(p.id); h.past.push(snapOf(p)); if (h.past.length > 50) h.past.shift(); h.future = [] }
const forget = (id: string) => hist.delete(id)
/** The plan as the page gets it: with how many steps there are to undo and redo. */
export const withHistory = <T extends Plan | undefined>(p: T) => p && { ...p, undo: hist.get(p.id)?.past.length ?? 0, redo: hist.get(p.id)?.future.length ?? 0 }
export function undoRedo(id: string, back: boolean) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  if (p.busy || p.creating) throw new Error('Wait for it to finish')
  const h = histOf(id), from = back ? h.past : h.future, to = back ? h.future : h.past
  const s = from.pop(); if (!s) throw new Error(back ? 'Nothing to undo' : 'Nothing to redo')
  to.push(snapOf(p)); Object.assign(p, s, { at: new Date().toISOString() }); save()
  return p
}

/**
 * One change the planner drafts: kept in the scenario (tried, not applied), with its turn and its evidence, when it
 * makes sense on the map as drafted so far (a change that does nothing, like removing what Linear owns, is dropped).
 */
export function draft(p: Plan, o: Op, turn: string) {
  const ops = p.scenario?.ops ?? []
  // yours win: what you moved in the draft, it no longer changes (it sees your change with the map next time)
  const target = 'id' in o ? o.id : undefined
  if (target && ops.some((x) => !x.turn && 'id' in x && x.id === target)) return
  if (!apply(applyAll(p, ops), o, 'agent')) return
  const because = becauseOf(o.because)
  p.scenario = { ...p.scenario, ops: [...ops, { ...o, turn, because }].slice(-500), at: new Date().toISOString() }
}

/** Your moves, added to what is being tried (also while the planner drafts: its changes keep coming in beside them). */
export function addToScenario(id: string, ops: Op[]) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  const mine = ops.filter((o) => BOARD.has(o.op)).map(({ turn: _, ...o }) => o as Op)
  if (!mine.length) return p
  step(p)
  p.scenario = { ...p.scenario, ops: [...(p.scenario?.ops ?? []), ...mine].slice(-500), at: new Date().toISOString() }
  save(); return p
}

/** The moves being tried: replaced as a whole (the page sends every move so far); none clears it. */
export function setScenario(id: string, ops: Op[]) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  step(p)
  p.scenario = ops.length ? { ops: ops.filter((o) => BOARD.has(o.op)).slice(0, 500), at: new Date().toISOString() } : undefined
  save(); return p
}

const ISSUE_TEAM = `query($id: String!) { issue(id: $id) { team { states(filter: { type: { eq: "backlog" } }) { nodes { id } } } } }`
const ISSUE_UPDATE = `mutation($id: String!, $i: IssueUpdateInput!) { issueUpdate(id: $id, input: $i) { success } }`
/**
 * Apply the scenario: what is in Linear is written there first (its priority, parent, assignee, and Backlog for a cut,
 * as the impact lists them), then every move is made in the plan. One that Linear refuses is said, and the rest go on.
 */
export async function applyScenario(id: string) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  if (!p.scenario?.ops.length) throw new Error('No moves to apply')
  const whatIf = applyAll(p, p.scenario.ops)
  const people = p.people ?? Math.max(1, p.project?.members ?? 1)
  // an organization on GitHub: its tickets are GitHub issues, so the moves change the plan alone (no Linear to write)
  const org = await planOrg(p), onGithub = (await orgs().catch(() => [] as Org[])).find((x) => x.owner === org)?.tracker === 'github'
  const writes = onGithub ? [] : impact(p, whatIf, people, p.pace ?? 5).writes
  const results: { identifier?: string; ok: boolean; error?: string }[] = []
  for (const w of writes) {
    try {
      const input: Record<string, unknown> = {}
      if (w.patch.priority !== undefined) input.priority = w.patch.priority
      if (w.patch.estimate !== undefined) input.estimate = w.patch.estimate
      if (w.patch.parentId !== undefined) input.parentId = w.patch.parentId
      if (w.patch.assigneeId !== undefined) input.assigneeId = w.patch.assigneeId
      if (w.patch.backlog) {
        const t = await gql<{ issue: { team: { states: { nodes: { id: string }[] } } } }>(ISSUE_TEAM, { id: w.issue })
        const backlog = t.issue.team.states.nodes[0]?.id
        if (backlog) input.stateId = backlog
      }
      if (Object.keys(input).length) await gql(ISSUE_UPDATE, { id: w.issue, i: input })
      results.push({ identifier: w.identifier, ok: true })
    } catch (e) { results.push({ identifier: w.identifier, ok: false, error: (e as Error).message.slice(0, 200) }) }
  }
  for (const o of p.scenario.ops) apply(p, o, o.turn ? 'agent' : 'you')
  // a cut issue now sits in Backlog there too
  for (const w of writes) if (w.patch.backlog && results.find((x) => x.identifier === w.identifier)?.ok) { const n = p.nodes.find((x) => x.id === w.id); if (n) n.state = { name: 'Backlog', type: 'backlog' } }
  p.scenario = undefined; p.at = new Date().toISOString(); forget(id); save()
  return { plan: p, results }
}

/** Changes you made on the map. */
export function edit(id: string, ops: Op[]) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  if (p.creating) throw new Error('It is being created in Linear')
  step(p)
  for (const o of ops) apply(p, o, 'you')
  p.at = new Date().toISOString(); save()
  return p
}

/** An "@op {…}" line, read; anything else is undefined. */
export function opOf(line: string): Op | undefined {
  const m = /^\s*@op\s+(\{.*\})\s*$/.exec(line)
  if (!m) return undefined
  try { return JSON.parse(m[1]) as Op } catch { return undefined }
}

// how a plan is drawn: fixed, whatever skill breaks the brief down
const PROTOCOL = [
  'You draw the plan on a live map the product manager watches while you write.',
  'Change the map only with op lines. Each op line is alone on its line, exactly: @op {json}',
  '  add:    {"op":"add","id":"e1","kind":"goal|milestone|epic|ticket","title":"…","parent":"g","priority":1-4,"estimate":points,"description":"…"}',
  '  update: {"op":"update","id":"t3", any of the fields above}',
  '  names on add or update: "short":"Course setup" for every goal, epic and ticket: 1 to 4 words, a name a person would say, what the board shows (its column is narrow); the title stays the whole outcome. Items on the map without one get it from you (an update with just "short") the next time you reply.',
  '  plan fields on add or update (tickets): "moscow":"must|should|could|wont", "rice":{"reach":users a quarter,"impact":0.25-3,"confidence":0-1}, "horizon":"now|next|later". Set them for every ticket you add or estimate; on items in Linear update only sets these.',
  '  readiness on add or update: "covers":["dpia"] (the obligations a ticket covers, by id), "risk":{"likelihood":1-3,"impact":1-3,"note":"…"} (a risk it carries or mitigates).',
  '  propose: {"op":"propose","why":"…","ops":[{"op":"move",…},…]} (a scenario for the product manager to try: moves only, nothing applied; use it when asked to propose, cut, sequence or re-plan)',
  '  move:   {"op":"move","id":"t3","rank":2.5,"parent":"e2","priority":1,"estimate":5,"cut":true} (its place in the order of work, under which epic, how urgent, how big, or cut to Later and back with cut:false; works on items in Linear too)',
  '  remove: {"op":"remove","id":"t3"} (its children go too)',
  '  link:   {"op":"link","from":"t1","to":"t2"} (t1 has to be done before t2) · unlink: the same with "unlink"',
  '  vision: {"op":"vision","text":"…"} (only when told you may)',
  '  ask:    {"op":"ask","q":"Should a paused member still get product emails?","options":["Yes, all of them","Only billing emails","None"],"pick":1}',
  '  next:   {"op":"next","items":["Fit it to the 6-week appetite","Add acceptance criteria to the billing tickets","Find the riskiest assumption"]}',
  'Be the product manager\'s planning partner, not a form: every reply moves the plan forward. Keep the prose short (they read it beside the map).',
  'Never ask a question in the prose: each question you need answered is an ask op, with 2 to 4 short options a click can answer and the one you recommend as pick. At most 3 per reply.',
  'End every reply with a next op: the 2 to 4 most useful things to do now, as short imperative phrases the product manager can click (they are sent to you as their message). Think about where the plan stands: no epics yet (shape it), epics without tickets (slice them), no estimates or over the appetite (fit it), ready (check the riskiest assumption, add acceptance criteria, order by value, create in Linear).',
  '  gaps:   {"op":"gaps","items":[{"area":"compliance","title":"GDPR assessment for stored recordings","why":"Recordings hold personal data; storing them needs a lawful basis and a retention rule","under":"e2"}]}',
  'Think like a seasoned product lead about every angle a plan can miss: constraints (deadline, budget, legal, technical), the users and their stories, the clients and integrations it touches (other apps, APIs, partners, mobile/desktop), compliance (GDPR, consent, retention, data residency), security (access, roles, abuse), data and analytics (how success is measured), rollout (flags, migration, beta, comms), support and docs, accessibility, localisation, and what needs investigation first (a spike).',
  'After the next op, end every reply with a gaps op: the 2 to 6 angles this plan has not covered yet and should, most important first, each with its area (one of: constraints, stories, clients, compliance, security, data, rollout, support, accessibility, research), a short title, why it matters for this plan in one sentence, and "under": the epic or goal id it belongs to. An angle already covered by the map is not a gap. When the product manager asks to explore one, add it as an epic or tickets.',
  'A ticket you can\'t write well yet (a decision is open, it needs investigation, the size is unknown) gets "refine": what it still needs, in a few words; clear it with "refine":"" once it is settled.',
  'ids are short and stable (g, e1, m2, t7). priority: 1 urgent, 2 high, 3 medium, 4 low. A ticket\'s description is markdown.',
  'The map as it stands comes with every message: the product manager may have changed it by hand. Keep their changes; touch only what the message asks for, and never re-add what is there.',
  'Your changes to the map (add, update, remove, link, unlink, move) are a draft: the product manager sees each one highlighted as you make it, and applies the draft or not. The map you get shows the draft so far, with "draft" listing the ids it changes; build on it, and never apply it yourself.',
  'When a change rests on something you looked up or were told (a metric, a ticket, an incident, a doc, the brief), add evidence to its op: "because":[{"source":"amplitude","text":"Pause clicks 4x since October","url":"https://…"}] (source: the tool or linear:ENG-12, brief, you; text under 15 words). Look things up with your read-only tools when a decision depends on real data; the evidence goes on the change, not in the prose.',
  'Items already in Linear have their identifier as id (e.g. ENG-12) and a state: never remove or rewrite them; add new work under them or beside them instead.',
].join('\n')
/** Your message to the planner; it answers in the background, the map changing as it writes (the page polls). */
export async function talk(id: string, text: string) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  if (p.busy) throw new Error('It is still working')
  const first = !p.sessionId
  step(p) // the whole turn is one step back
  p.messages.push({ who: 'you', text, at: new Date().toISOString() })
  // its last questions and suggestions are answered by this message: the reply brings new ones
  Object.assign(p, { busy: true, live: '', error: undefined, asks: [], suggest: [], gaps: [], at: new Date().toISOString() }); save()
  // the method is the planning skill picked for this plan, else the one in Settings → Skills (method.ts)
  const skill = await skillBody(p.skill || slot('plan')).catch((e: Error) => { Object.assign(p, { busy: false, error: e.message }); save(); throw e })
  // a big project's map: each item short (its description cut), and Linear's own marked by its state
  // the map as drafted so far, and which items the draft changes
  const seen = p.scenario?.ops.length ? applyAll(p, p.scenario.ops) : p
  const drafted = [...new Set((p.scenario?.ops ?? []).map((o) => ('id' in o ? o.id : 'to' in o ? o.to : '')).filter(Boolean))]
  const map = JSON.stringify({ nodes: seen.nodes.map(({ created: _, by: __, description, state, assigneeId: ___, ...n }) => ({ ...n, ...(description && { description: description.slice(0, 200) }), ...(state && { state: state.name }) })), links: seen.links, ...(drafted.length && { draft: drafted }) })
  const proj = p.project && `This plan contributes to the existing Linear project "${p.project.name}"${p.project.targetDate ? `, due ${p.project.targetDate}` : ''}. Its goal node (g) is the project.\nIts vision:\n${p.project.vision.slice(0, 6000) || '(none written)'}\n`
    + (p.project.lead ? 'The product manager leads this project: if the vision should change, propose the whole new text with one op line {"op":"vision","text":"…"}; it is applied only when they accept it.' : 'The product manager does not lead this project: never change its vision or goal; only add tickets (and epics or phases for them) to it.')
  const pace = p.pace ?? 5, people = p.people ?? Math.max(1, p.project?.members ?? 1)
  const appetite = p.appetite && `The appetite (Shape Up): ${p.appetite.weeks} week${p.appetite.weeks === 1 ? '' : 's'} with ${people} ${people === 1 ? 'person' : 'people'}, about ${p.appetite.weeks * people * pace} points (one person finishes about ${pace} a week). Fit the scope into it: estimate every ticket in points, keep what matters most inside it, and put what does not fit under one epic titled "Later: beyond the appetite" with priority 4, so the cut is visible. Say in a sentence what you cut.`
  // its organization's profile (orgs.ts): checks off, no obligations and nothing about them in the prompt
  const company = await complianceFor(await planOrg(p)), obs = obligations(company, p), cov = coverage(p, obs)
  const ready = obs.length ? `Compliance and capacity: ${[company?.regions?.length && `users in ${company.regions.join(', ')}`, company?.certifications?.length && `certified ${company.certifications.join(', ')}`, company?.data?.length && `handles ${company.data.join(', ')}`, company?.reviews?.length && `requires ${company.reviews.join(', ')} reviews`, company?.team?.length && `team ${company.team.map((m) => `${m.name} (${m.role})`).join(', ')}`].filter(Boolean).join('; ') || 'no profile set'}.
What this plan must cover for it (id: title, and the ticket covering it):\n${cov.map((x) => `- ${x.ob.id}: ${x.ob.title} (${x.ob.area})${x.by ? ` · covered by ${x.by.id}` : ' · NOT COVERED'}`).join('\n')}
Mark the ticket that covers one with "covers":["id"]. Uncovered ones belong in your gaps op (area compliance, security, rollout or research), most important first; add tickets for them when asked. Set "risk" on tickets that carry a real risk.` : ''
  const prompt = `${ready ? `${ready}\n\n---\n\n` : ''}${proj ? `${proj}\n---\n\n` : ''}${appetite ? `${appetite}\n\n---\n\n` : ''}${first ? `The brief, "${p.title}":\n${p.brief || '(none yet: ask for one)'}\n\n---\n\n` : ''}The map now: ${map}\n\n---\n\n${text}`
  const sessionId = p.sessionId ?? randomUUID()
  const provider = providerFor('review')
  const lookups = config.agent.allowedTools.filter((t) => t.startsWith('mcp__'))
  const child = spawnAgent(provider, [
    '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--append-system-prompt', `${PROTOCOL}\n\nMethod: ${p.method}${p.method === 'waterfall' ? ' (phases as milestones, in order)' : ' (epics of thin slices)'}. How to break it down, from the planning skill:\n${skill}`,
    // no tools of its own; the connectors in the bank (Linear, Sentry, Amplitude…) to look things up, read-only ones only
    '--tools', '', ...(lookups.length ? [...bankArgs(provider), '--allowedTools', ...lookups] : ['--strict-mcp-config']), '--disable-slash-commands', '--setting-sources', '',
    '--model', 'planner', '--max-budget-usd', '3', // the planner's model (Settings → Models)
    ...(first ? ['--session-id', sessionId] : ['--resume', sessionId]),
  ], { cwd: tmpdir() })
  // the text as it streams: each finished line is an op (applied now) or part of the reply
  let pending = '', reply = '', streamed = false, raw = '', err = '', cost = 0, final = ''
  let saveSoon: NodeJS.Timeout | undefined
  const flush = () => { saveSoon ??= setTimeout(() => { saveSoon = undefined; save() }, 250) }
  const turn = randomUUID().slice(0, 8)
  let drew = false
  const line = (l: string) => { const o = opOf(l); if (o && BOARD.has(o.op)) { draft(p, o, turn); drew = true } else if (o) apply(p, o, 'agent'); else reply += `${l}\n`; p.live = reply.replace(/\n{3,}/g, '\n\n').trim(); flush() }
  const text$ = (t: string) => { pending += t; let i; while ((i = pending.indexOf('\n')) >= 0) { line(pending.slice(0, i)); pending = pending.slice(i + 1) } p.live = (reply + (opOf(pending) || pending.trimStart().startsWith('@op') ? '' : pending)).trim() }
  child.stdout.on('data', (c: Buffer) => {
    raw += c
    let i
    while ((i = raw.indexOf('\n')) >= 0) {
      const l = raw.slice(0, i); raw = raw.slice(i + 1)
      try {
        const m = JSON.parse(l) as { type: string; event?: { type: string; delta?: { type: string; text?: string } }; total_cost_usd?: number; result?: string }
        if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') { streamed = true; text$(m.event.delta.text ?? '') }
        // a new message of the agent's: what was pending is a whole line
        else if (m.type === 'stream_event' && m.event?.type === 'content_block_stop' && pending) { line(pending); pending = '' }
        else if (m.type === 'result') { cost = m.total_cost_usd ?? 0; final = m.result ?? '' }
      } catch { /* not a JSON line */ }
    }
  })
  child.stderr.on('data', (c: Buffer) => { err = (err + c).slice(-400) })
  let done = false
  const finish = (fail?: string) => {
    if (done) return; done = true
    clearTimeout(saveSoon)
    // a provider that doesn't stream: its whole answer, read at once
    if (!streamed && final) for (const l of final.split('\n')) line(l)
    else if (pending) line(pending)
    const said = reply.replace(/\n{3,}/g, '\n\n').trim()
    if (said || drew) p.messages.push({ who: 'agent', text: said, at: new Date().toISOString(), ...(drew && { turn }) })
    Object.assign(p, { busy: false, live: undefined, costUsd: p.costUsd + cost, at: new Date().toISOString(), ...(said && { sessionId }), ...(fail && !said && { error: fail.slice(0, 300) }) })
    save()
  }
  child.on('error', (e) => finish(e.message))
  child.on('close', (code) => finish(code ? (err || `it stopped (${code})`) : undefined))
}

// --- into Linear ---------------------------------------------------------------------------------
export async function linearTeams() {
  const r = await gql<{ teams: { nodes: { id: string; key: string; name: string }[] } }>('{ teams(first: 100) { nodes { id key name } } }')
  return r.teams.nodes
}

/** Parents before children: the order things are made in. */
export function topDown(nodes: PlanNode[]): PlanNode[] {
  const out: PlanNode[] = [], seen = new Set<string>()
  const visit = (n: PlanNode) => { if (seen.has(n.id)) return; seen.add(n.id); const parent = nodes.find((x) => x.id === n.parent); if (parent) visit(parent); out.push(n) }
  nodes.forEach(visit)
  return out
}

/**
 * Make the plan in Linear, in the background (the page polls): the goal as a project, phases as its milestones, epics
 * and tickets as issues under their parents, then the dependencies as "blocks" relations. Made ones are skipped, so
 * after a failure it continues where it stopped.
 */
export async function create(id: string) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  // where the plan's organization manages its work (orgs.ts): GitHub issues in its repository, or Linear
  const org = await planOrg(p), o = (await orgs().catch(() => [] as Org[])).find((x) => x.owner === org)
  if (o?.tracker === 'github') return createOnGithub(p, o)
  if (!p.team) throw new Error('Pick a Linear team first')
  if (p.creating || p.busy) throw new Error('Wait for it to finish')
  Object.assign(p, { creating: true, error: undefined }); forget(id); save()
  void (async () => {
    try {
      const goal = p.nodes.find((n) => n.kind === 'goal')
      if (goal && !goal.created) {
        const r = await gql<{ projectCreate: { project: { id: string; url: string } } }>('mutation($i: ProjectCreateInput!) { projectCreate(input: $i) { project { id url } } }',
          { i: { name: goal.title, teamIds: [p.team], description: [goal.description, p.brief].filter(Boolean).join('\n\n') } })
        goal.created = r.projectCreate.project; save()
      }
      const project = goal?.created?.id
      const milestoneOf = (n: PlanNode): string | undefined => { let x: PlanNode | undefined = n; for (let i = 0; x && i < 50; i++) { x = p.nodes.find((y) => y.id === x!.parent); if (x?.kind === 'milestone') return x.created?.id } return undefined }
      const parentIssue = (n: PlanNode) => { const x = p.nodes.find((y) => y.id === n.parent); return x && (x.kind === 'epic' || x.kind === 'ticket') ? x.created?.id : undefined }
      for (const n of topDown(p.nodes)) {
        if (n.created || n.kind === 'goal') continue
        if (n.kind === 'milestone') {
          if (!project) continue // a milestone needs the project: without a goal, its tickets go without one
          const r = await gql<{ projectMilestoneCreate: { projectMilestone: { id: string } } }>('mutation($i: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $i) { projectMilestone { id } } }',
            { i: { projectId: project, name: n.title, description: n.description } })
          n.created = { id: r.projectMilestoneCreate.projectMilestone.id, url: goal!.created!.url }; save(); continue
        }
        const r = await gql<{ issueCreate: { issue: { id: string; identifier: string; url: string } } }>('mutation($i: IssueCreateInput!) { issueCreate(input: $i) { issue { id identifier url } } }', {
          i: {
            teamId: p.team, title: n.title, description: [n.refine ? `**Needs refinement:** ${n.refine}` : '', n.description, n.estimate ? `Estimate: ${n.estimate} points` : ''].filter(Boolean).join('\n\n') || undefined,
            priority: n.priority, parentId: parentIssue(n), projectId: project, projectMilestoneId: milestoneOf(n),
          },
        })
        n.created = r.issueCreate.issue; save()
      }
      // dependencies between issues (one with a milestone or the goal at either end is the order of the phases)
      const issue = (id: string) => { const n = p.nodes.find((x) => x.id === id); return n && (n.kind === 'epic' || n.kind === 'ticket') ? n.created?.id : undefined }
      const made = (p.related ??= [])
      for (const l of p.links) {
        const a = issue(l.from), b = issue(l.to), key = `${l.from}>${l.to}`
        if (!a || !b || made.includes(key)) continue
        await gql('mutation($i: IssueRelationCreateInput!) { issueRelationCreate(input: $i) { success } }', { i: { issueId: a, relatedIssueId: b, type: 'blocks' } })
        made.push(key); save()
      }
    } catch (e) { p.error = (e as Error).message.slice(0, 300) }
    p.creating = false; save()
  })()
  return p
}

/**
 * The plan as GitHub issues, for an organization that manages its work there: the goal (and each milestone) a GitHub
 * milestone, each epic and ticket an issue in the organization's first watched repository, a ticket a sub-issue of its epic, and its estimate and what it still needs said in its body.
 */
/**
 * The plan's issues in a GitHub Project (the board GitHub shows on the repository's Projects tab): one made for it,
 * named after its goal and owned where the repository is (you, or the organization), linked to the repository, and
 * each epic and ticket added once. A sign-in without GitHub's project permission can't: said in words.
 */
async function intoProject(p: Plan, repo: string, title: string) {
  const [owner, name] = repo.split('/')
  try {
    if (!p.ghProject) {
      const r = await graphql<{ repository: { id: string; owner: { id: string } } }>('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id owner { id } } }', { o: owner, n: name })
      const made = await graphql<{ createProjectV2: { projectV2: { id: string; url: string } } }>('mutation($i: CreateProjectV2Input!) { createProjectV2(input: $i) { projectV2 { id url } } }',
        { i: { ownerId: r.repository.owner.id, title: title.slice(0, 120), repositoryId: r.repository.id } })
      p.ghProject = { ...made.createProjectV2.projectV2, added: [] }; save()
    }
    for (const n of p.nodes) {
      if ((n.kind !== 'epic' && n.kind !== 'ticket') || !n.created?.identifier?.startsWith('#') || p.ghProject.added.includes(n.id)) continue
      // made before its GitHub id was kept: asked for it by its number
      if (!n.created.node) { n.created.node = (await gh<{ node_id: string }>(`/repos/${repo}/issues/${n.created.identifier.slice(1)}`)).node_id; save() }
      await graphql('mutation($i: AddProjectV2ItemByIdInput!) { addProjectV2ItemById(input: $i) { item { id } } }', { i: { projectId: p.ghProject.id, contentId: n.created.node } })
      p.ghProject.added.push(n.id); save()
    }
  } catch (e) {
    const m = (e as Error).message
    throw new Error(/scope|permission|not accessible|resource not accessible/i.test(m)
      ? `The issues are made, but GitHub didn't let Concierge make the project: its GitHub sign-in needs the "project" permission. Sign in again (the new sign-in asks for it), then Add to a GitHub project`
      : `The issues are made, but not the project: ${m}`)
  }
}

/** Issues made before projects (or before the permission): put them in one now. */
export async function addToProject(id: string) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  const org = await planOrg(p), o = (await orgs().catch(() => [] as Org[])).find((x) => x.owner === org)
  if (o?.tracker !== 'github' || !o.repos[0]) throw new Error('This plan is not on GitHub')
  if (p.creating || p.busy) throw new Error('Wait for it to finish')
  Object.assign(p, { creating: true, error: undefined }); save()
  void intoProject(p, o.repos[0], p.nodes.find((n) => n.kind === 'goal')?.title ?? p.title).catch((e: Error) => { p.error = e.message.slice(0, 300) }).finally(() => { p.creating = false; save() })
  return p
}

async function createOnGithub(p: Plan, o: Org) {
  const repo = o.repos[0] // ponytail: the organization's first watched repository; a pick per plan when an organization's work spans several
  if (!repo) throw new Error(`${o.owner} has no repository here to put the issues in: add one in Settings → Workspaces`)
  if (p.creating || p.busy) throw new Error('Wait for it to finish')
  Object.assign(p, { creating: true, error: undefined }); forget(p.id); save()
  void (async () => {
    try {
      const milestone = async (n: PlanNode, extra = '') => {
        const r = await ghSend<{ number: number; html_url: string }>('POST', `/repos/${repo}/milestones`, { title: n.title.slice(0, 250), description: [n.description, extra].filter(Boolean).join('\n\n').slice(0, 2000) || undefined, ...(n.target && { due_on: new Date(n.target).toISOString() }) })
        n.created = { id: String(r.number), url: r.html_url }; save()
      }
      const me = (await getMe().catch(() => undefined))?.login // assigned to you: Ship lists them as your tickets
      const goal = p.nodes.find((n) => n.kind === 'goal')
      if (goal && !goal.created) await milestone(goal, p.brief)
      const milestoneOf = (n: PlanNode): number | undefined => { let x: PlanNode | undefined = n; for (let i = 0; x && i < 50; i++) { x = p.nodes.find((y) => y.id === x!.parent); if (x?.kind === 'milestone' && x.created) return Number(x.created.id) } return goal?.created ? Number(goal.created.id) : undefined }
      for (const n of topDown(p.nodes)) {
        if (n.created || n.kind === 'goal') continue
        if (n.kind === 'milestone') { await milestone(n); continue }
        const body = [n.refine ? `**Needs refinement:** ${n.refine}` : '', n.description, n.estimate ? `Estimate: ${n.estimate} points` : ''].filter(Boolean).join('\n\n')
        const r = await ghSend<{ id: number; node_id: string; number: number; html_url: string }>('POST', `/repos/${repo}/issues`, { title: n.title.slice(0, 250), ...(body && { body }), ...(milestoneOf(n) && { milestone: milestoneOf(n) }), ...(me && { assignees: [me] }) })
        n.created = { id: String(r.id), identifier: `#${r.number}`, url: r.html_url, node: r.node_id }; save()
        // under its epic (or the ticket it splits): GitHub's sub-issues
        const up = p.nodes.find((y) => y.id === n.parent)
        if (up && (up.kind === 'epic' || up.kind === 'ticket') && up.created?.identifier) {
          await ghSend('POST', `/repos/${repo}/issues/${up.created.identifier.slice(1)}/sub_issues`, { sub_issue_id: r.id }).catch((e: Error) => console.warn(`plan ${p.id}: sub-issue ${r.number} under ${up.created!.identifier}: ${e.message}`))
        }
      }
      await intoProject(p, repo, goal?.title ?? p.title)
    } catch (e) { p.error = (e as Error).message.slice(0, 300) }
    p.creating = false; save()
  })()
  return p
}

// --- an existing Linear project ------------------------------------------------------------------
type LProject = {
  id: string; name: string; url: string; description?: string; content?: string; startDate?: string; targetDate?: string
  lead?: { id: string; name: string }; members: { nodes: { id: string; name: string }[] }; teams: { nodes: { id: string }[] }
  projectMilestones: { nodes: { id: string; name: string; targetDate?: string; description?: string }[] }
  issues: { nodes: { id: string; identifier: string; title: string; description?: string; priority?: number; estimate?: number; url: string
    state: { name: string; type: string }; assignee?: { id: string; name: string }; parent?: { id: string }; projectMilestone?: { id: string }
    relations: { nodes: { type: string; relatedIssue: { id: string } }[] } }[] }
}
/** Projects to contribute to: the latest first, and whether you lead each. */
export async function linearProjects() {
  const r = await gql<{ viewer: { id: string }; projects: { nodes: { id: string; name: string; state: string; targetDate?: string; lead?: { id: string; name: string } }[] } }>(
    '{ viewer { id } projects(first: 100, orderBy: updatedAt) { nodes { id name state targetDate lead { id name } } } }')
  return r.projects.nodes.filter((x) => x.state !== 'completed' && x.state !== 'canceled').map((x) => ({ id: x.id, name: x.name, targetDate: x.targetDate, lead: x.lead?.name, mine: x.lead?.id === r.viewer.id }))
}
const PROJECT = `query($id: String!) { viewer { id } project(id: $id) {
  id name url description content startDate targetDate lead { id name } members { nodes { id name } } teams { nodes { id } }
  projectMilestones { nodes { id name targetDate description } } } }`
// its issues, a page at a time (all of them in one query is more than Linear allows)
const ISSUES = `query($id: String!, $after: String) { project(id: $id) { issues(first: 50, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes { id identifier title description priority estimate url state { name type } assignee { id name } parent { id } projectMilestone { id }
    relations(first: 20) { nodes { type relatedIssue { id } } } } } } }`
async function projectOf(id: string): Promise<{ viewer: string; project: LProject }> {
  const r = await gql<{ viewer: { id: string }; project: Omit<LProject, 'issues'> }>(PROJECT, { id })
  const issues: LProject['issues']['nodes'] = []
  for (let after: string | undefined, i = 0; i < 20; i++) {
    const q = await gql<{ project: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: LProject['issues']['nodes'] } } }>(ISSUES, { id, after })
    issues.push(...q.project.issues.nodes)
    if (!q.project.issues.pageInfo.hasNextPage) break
    after = q.project.issues.pageInfo.endCursor
  }
  return { viewer: r.viewer.id, project: { ...r.project, issues: { nodes: issues } } }
}

/** Bring a project into the plan, or bring the plan up to date with it: what is in Linear is the truth for what is there. */
export function mergeProject(p: Plan, pr: LProject, viewer: string) {
  p.project = { id: pr.id, name: pr.name, url: pr.url, lead: pr.lead?.id === viewer, leadName: pr.lead?.name, vision: pr.content || pr.description || '', startDate: pr.startDate, targetDate: pr.targetDate, members: pr.members.nodes.length, syncedAt: new Date().toISOString() }
  p.team ??= pr.teams.nodes[0]?.id
  p.members = pr.members.nodes.map((m) => ({ id: m.id, name: m.name }))
  const byLinear = new Map(p.nodes.filter((n) => n.created).map((n) => [n.created!.id, n]))
  let goal = p.nodes.find((n) => n.kind === 'goal')
  if (!goal) { goal = { id: 'g', kind: 'goal', title: pr.name }; p.nodes.unshift(goal) }
  Object.assign(goal, { title: pr.name, created: { id: pr.id, url: pr.url } })
  const idOf = new Map<string, string>([[pr.id, goal.id]])
  for (const m of pr.projectMilestones.nodes) {
    const n = byLinear.get(m.id) ?? (() => { const x: PlanNode = { id: `m:${m.id.slice(0, 6)}`, kind: 'milestone', title: m.name }; p.nodes.push(x); return x })()
    Object.assign(n, { title: m.name, kind: 'milestone', parent: goal.id, target: m.targetDate, description: m.description, created: { id: m.id, url: pr.url } })
    idOf.set(m.id, n.id)
  }
  const hasKids = new Set(pr.issues.nodes.map((i) => i.parent?.id).filter(Boolean))
  for (const i of pr.issues.nodes) {
    const n = byLinear.get(i.id) ?? (() => { const x: PlanNode = { id: i.identifier, kind: 'ticket', title: i.title }; p.nodes.push(x); return x })()
    Object.assign(n, { title: i.title, kind: hasKids.has(i.id) ? 'epic' : 'ticket', description: i.description, priority: i.priority || undefined, estimate: i.estimate || undefined,
      state: i.state, assignee: i.assignee?.name, assigneeId: i.assignee?.id, created: { id: i.id, identifier: i.identifier, url: i.url } })
    idOf.set(i.id, n.id)
  }
  // parents, once every node has its id: its parent issue, else its milestone, else the project
  for (const i of pr.issues.nodes) {
    const n = p.nodes.find((x) => x.id === idOf.get(i.id))!
    n.parent = (i.parent && idOf.get(i.parent.id)) || (i.projectMilestone && idOf.get(i.projectMilestone.id)) || goal.id
  }
  const made = (p.related ??= [])
  for (const i of pr.issues.nodes) for (const rel of i.relations.nodes) {
    const from = idOf.get(i.id), to = idOf.get(rel.relatedIssue.id)
    if (rel.type !== 'blocks' || !from || !to) continue
    if (!p.links.some((l) => l.from === from && l.to === to)) p.links.push({ from, to })
    if (!made.includes(`${from}>${to}`)) made.push(`${from}>${to}`)
  }
}
export async function linkProject(id: string, projectId: string) {
  const p = planOf(id); if (!p) throw new Error('No such plan')
  const r = await projectOf(projectId)
  mergeProject(p, r.project, r.viewer)
  forget(id); p.at = new Date().toISOString(); save()
  return p
}
export const syncProject = (id: string) => { const p = planOf(id); if (!p?.project) throw new Error('Not linked to a Linear project'); return linkProject(id, p.project.id) }

/** The proposed vision, into the project (only one you lead): its long description in Linear. */
export async function applyVision(id: string) {
  const p = planOf(id); if (!p?.project || !p.vision) throw new Error('No new vision to apply')
  if (!p.project.lead) throw new Error(`Only the project's lead (${p.project.leadName ?? 'someone else'}) changes its vision`)
  await gql('mutation($id: String!, $i: ProjectUpdateInput!) { projectUpdate(id: $id, input: $i) { success } }', { id: p.project.id, i: { content: p.vision } })
  p.project.vision = p.vision; p.vision = undefined; save()
  return p
}
