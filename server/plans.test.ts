import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, opOf, topDown, type Plan } from './plans.ts'

const blank = (): Plan => ({ id: 'x', title: 't', brief: '', method: 'agile', nodes: [], links: [], messages: [], costUsd: 0, at: '' })

test('op lines are read, other lines are not', () => {
  assert.deepEqual(opOf('@op {"op":"link","from":"a","to":"b"}'), { op: 'link', from: 'a', to: 'b' })
  assert.equal(opOf('Adding the epics now.'), undefined)
  assert.equal(opOf('@op {broken'), undefined)
})

test('the map: adds, parents, links without loops, removal takes children', () => {
  const p = blank()
  apply(p, { op: 'add', id: 'g', kind: 'goal', title: 'Goal' }, 'agent')
  apply(p, { op: 'add', id: 'e1', kind: 'epic', title: 'E1', parent: 'g' }, 'agent')
  apply(p, { op: 'add', id: 't1', kind: 'ticket', title: 'T1', parent: 'e1', priority: 2 }, 'agent')
  apply(p, { op: 'add', id: 't2', kind: 'ticket', title: 'T2', parent: 'nope' }, 'agent')
  assert.equal(p.nodes.find((n) => n.id === 't2')!.parent, undefined) // an unknown parent is dropped
  assert.ok(apply(p, { op: 'link', from: 't1', to: 't2' }, 'agent'))
  assert.ok(!apply(p, { op: 'link', from: 't2', to: 't1' }, 'agent')) // a loop
  apply(p, { op: 'update', id: 'e1', parent: 't1' }, 'you') // under its own child: refused
  assert.equal(p.nodes.find((n) => n.id === 'e1')!.parent, 'g')
  apply(p, { op: 'add', id: 't1', kind: 'ticket', title: 'T1 renamed' }, 'agent') // add again: an update
  assert.equal(p.nodes.filter((n) => n.id === 't1').length, 1)
  assert.equal(p.nodes.find((n) => n.id === 't1')!.title, 'T1 renamed')
  apply(p, { op: 'remove', id: 'e1' }, 'you')
  assert.deepEqual(p.nodes.map((n) => n.id), ['g', 't2'])
  assert.equal(p.links.length, 0)
})

test('parents come before their children', () => {
  const order = topDown([{ id: 't', kind: 'ticket', title: '', parent: 'e' }, { id: 'e', kind: 'epic', title: '', parent: 'g' }, { id: 'g', kind: 'goal', title: '' }]).map((n) => n.id)
  assert.deepEqual(order, ['g', 'e', 't'])
})

test('an existing project comes in as the map: milestones, epics, tickets, blocks; Linear items stay as Linear has them', async () => {
  const { mergeProject } = await import('./plans.ts')
  const p = blank()
  const issue = (id: string, identifier: string, extra: object = {}) => ({ id, identifier, title: identifier, url: `u/${identifier}`, state: { name: 'Todo', type: 'unstarted' }, relations: { nodes: [] }, ...extra })
  const pr = {
    id: 'P', name: 'Seats', url: 'u/P', content: 'Vision', lead: { id: 'me', name: 'Me' }, members: { nodes: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }] }, teams: { nodes: [{ id: 'T' }] },
    projectMilestones: { nodes: [{ id: 'M1xxxxx', name: 'Beta' }] },
    issues: { nodes: [issue('E', 'ENG-1'), issue('A', 'ENG-2', { parent: { id: 'E' }, relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'B' } }] } }), issue('B', 'ENG-3', { projectMilestone: { id: 'M1xxxxx' } })] },
  }
  mergeProject(p, pr, 'me')
  assert.equal(p.project!.lead, true)
  assert.equal(p.team, 'T')
  const get = (id: string) => p.nodes.find((n) => n.id === id)!
  assert.equal(get('ENG-1').kind, 'epic')
  assert.equal(get('ENG-2').parent, 'ENG-1')
  assert.equal(get('ENG-3').parent, 'm:M1xxxx')
  assert.equal(get('ENG-1').parent, 'g')
  assert.deepEqual(p.links, [{ from: 'ENG-2', to: 'ENG-3' }])
  assert.ok(!apply(p, { op: 'update', id: 'ENG-2', title: 'x' }, 'you')) // in Linear: changed there
  assert.ok(!apply(p, { op: 'remove', id: 'ENG-2' }, 'agent'))
  mergeProject(p, pr, 'me') // again: nothing doubles
  assert.equal(p.nodes.length, 5)
  assert.equal(p.links.length, 1)
  mergeProject(p, { ...pr, lead: { id: 'someone', name: 'Sam' } }, 'me')
  assert.ok(!apply(p, { op: 'vision', text: 'new' }, 'agent')) // not the lead: no vision
})

test('the agent asks with options and suggests what is next: kept for the page, malformed ones dropped', () => {
  const p = blank()
  assert.ok(apply(p, { op: 'ask', q: 'Emails while paused?', options: ['All', 'Billing only', 'None'], pick: 1 }, 'agent'))
  assert.ok(!apply(p, { op: 'ask', q: 'One option only', options: ['Yes'] }, 'agent'))
  assert.ok(apply(p, { op: 'next', items: ['Fit it to 6 weeks', 'Add acceptance criteria', 'a', 'b', 'too many'] }, 'agent'))
  assert.deepEqual(p.asks, [{ q: 'Emails while paused?', options: ['All', 'Billing only', 'None'], pick: 1 }])
  assert.equal(p.suggest!.length, 4)
})

test('the angles not explored yet: the whole list each reply, under a node only when it exists; a ticket carries what it still needs', () => {
  const p = { nodes: [], links: [] } as unknown as Plan
  apply(p, { op: 'add', id: 'g', kind: 'goal', title: 'G' }, 'agent')
  apply(p, { op: 'add', id: 't1', kind: 'ticket', title: 'T', parent: 'g', refine: 'pick the provider' }, 'agent')
  assert.equal(p.nodes[1].refine, 'pick the provider')
  apply(p, { op: 'update', id: 't1', refine: '' }, 'you')
  assert.equal(p.nodes[1].refine, undefined)
  assert.ok(apply(p, { op: 'gaps', items: [{ area: 'Compliance', title: 'GDPR assessment', why: 'personal data', under: 'g' }, { area: 'security', title: 'Roles', why: 'who sees what', under: 'nope' }, { area: 'x', title: '', why: '' }] }, 'agent'))
  assert.deepEqual(p.gaps, [{ id: 'gap0', area: 'compliance', title: 'GDPR assessment', why: 'personal data', under: 'g' }, { id: 'gap1', area: 'security', title: 'Roles', why: 'who sees what' }])
  apply(p, { op: 'gaps', items: [] }, 'agent')
  assert.deepEqual(p.gaps, [])
})

test('a scenario is kept until applied; Apply makes its moves in the plan and clears it (nothing in Linear: no writes)', async () => {
  const { newPlan, edit, setScenario, applyScenario, planOf } = await import('./plans.ts')
  const p = newPlan('S', 'brief')
  edit(p.id, [{ op: 'add', id: 'g', kind: 'goal', title: 'G' }, { op: 'add', id: 'e', kind: 'epic', title: 'E', parent: 'g' }, { op: 'add', id: 'a', kind: 'ticket', title: 'A', parent: 'e', estimate: 3 }])
  setScenario(p.id, [{ op: 'move', id: 'a', cut: true }, { op: 'update', id: 'a', title: 'A2' }, { op: 'next', items: ['x'] } as never])
  assert.equal(planOf(p.id).scenario?.ops.length, 2) // changes to the map are kept, reply ops are not
  assert.equal(planOf(p.id).nodes.find((n) => n.id === 'a')!.parent, 'e') // not applied yet
  const r = await applyScenario(p.id)
  assert.deepEqual(r.results, [])
  assert.equal(planOf(p.id).nodes.find((n) => n.id === 'a')!.parent, 'later')
  assert.equal(planOf(p.id).nodes.find((n) => n.id === 'a')!.title, 'A2')
  assert.equal(planOf(p.id).scenario, undefined)
})

test('undo and redo: each edit and scenario change is a step; Linear ends the history', async () => {
  const { newPlan, edit, setScenario, undoRedo, withHistory } = await import('./plans.ts')
  const p = newPlan('h', '')
  edit(p.id, [{ op: 'add', id: 't1', kind: 'ticket', title: 'One' }])
  edit(p.id, [{ op: 'update', id: 't1', title: 'Two' }])
  setScenario(p.id, [{ op: 'move', id: 't1', cut: true }])
  assert.equal(withHistory(p)!.undo, 3)
  undoRedo(p.id, true); assert.equal(p.scenario, undefined)
  undoRedo(p.id, true); assert.equal(p.nodes[0].title, 'One')
  undoRedo(p.id, false); assert.equal(p.nodes[0].title, 'Two')
  assert.deepEqual([withHistory(p)!.undo, withHistory(p)!.redo], [2, 1])
  edit(p.id, [{ op: 'update', id: 't1', title: 'Three' }]) // a new change drops the redo
  assert.equal(withHistory(p)!.redo, 0)
  assert.throws(() => undoRedo(p.id, false), /Nothing to redo/)
})

test('a move resizes: the estimate changes in the plan and is a Linear write for an issue there', async () => {
  const { impact } = await import('../src/planDiff.ts')
  const { applyAll } = await import('./planOps.ts')
  const { sizeFor } = await import('../src/planStream.ts')
  const p = blank()
  apply(p, { op: 'add', id: 't1', kind: 'ticket', title: 'T1', estimate: 3 }, 'agent')
  p.nodes[0].created = { id: 'lin1', identifier: 'ENG-1', url: '' }
  const w = applyAll(p, [{ op: 'move', id: 't1', estimate: 8 }])
  assert.equal(w.nodes[0].estimate, 8); assert.equal(p.nodes[0].estimate, 3)
  assert.deepEqual(impact(p, w, 1, 5).writes[0].patch, { estimate: 8 })
  assert.equal(sizeFor(3, 30, 60), 5); assert.equal(sizeFor(3, 30, 5), 1)
})

test('evidence is kept short, three at most, and a link only when it is a web one', async () => {
  const { becauseOf } = await import('./planOps.ts')
  assert.equal(becauseOf(undefined), undefined)
  const b = becauseOf([{ source: 'amplitude', text: 'x', url: 'javascript:alert(1)' }, { source: 's', text: 't', url: 'https://a.b' }, { text: 'no source' }, {}, { source: 'a', text: 'b' }, { source: 'c', text: 'd' }])!
  assert.equal(b.length, 3); assert.equal(b[0].url, undefined); assert.equal(b[1].url, 'https://a.b')
})

test('a draft: the planner changes come in with their turn; yours, added meanwhile, win over its later ones', async () => {
  const { newPlan, edit, addToScenario, draft, planOf } = await import('./plans.ts')
  const p = newPlan('D', '')
  edit(p.id, [{ op: 'add', id: 'e', kind: 'epic', title: 'E' }, { op: 'add', id: 'a', kind: 'ticket', title: 'A', parent: 'e' }])
  draft(p, { op: 'add', id: 'b', kind: 'ticket', title: 'B', parent: 'e', because: [{ source: 'amplitude', text: 'x' }] }, 't1')
  addToScenario(p.id, [{ op: 'move', id: 'a', estimate: 8, turn: 'forged' } as never])
  draft(p, { op: 'move', id: 'a', estimate: 1 }, 't1') // you moved it: dropped
  draft(p, { op: 'remove', id: 'nope' }, 't1') // does nothing: dropped
  const ops = planOf(p.id).scenario!.ops
  assert.deepEqual(ops.map((o) => [o.op, o.turn]), [['add', 't1'], ['move', undefined]])
  assert.equal(planOf(p.id).nodes.length, 2) // nothing applied yet
})
