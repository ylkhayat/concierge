import { existsSync, readFileSync } from 'node:fs'
// A made-up API for looking at the UI without a server: node dev/preview/mock.mjs (port 4799). Plans, roles and the few
// reads the app needs to start; anything else answers 404, which the app takes as "not there".
import http from 'node:http'
const day = 864e5, now = Date.now()
const t = (id, title, parent, extra = {}) => ({ id, kind: 'ticket', title, parent, by: 'agent', ...extra })
const plan = {
  id: 'p1', title: 'Seat pausing', method: 'agile', at: new Date().toISOString(), costUsd: 0.04, links: [{ from: 't1', to: 't2' }, { from: 't4', to: 't5' }],
  brief: 'Let team admins pause a member seat instead of removing it: data kept, no sign-in, not billed from the next cycle, resume anytime with prorated billing. Ship in 6 weeks.',
  appetite: { weeks: 3, from: new Date(now - 7 * day).toISOString() },
  gaps: [
    { id: 'gap0', area: 'compliance', title: 'GDPR: what a paused member\'s data may still be used for', why: 'A paused seat keeps personal data without an active contract; retention and deletion requests need a rule', under: 'e1' },
    { id: 'gap1', area: 'clients', title: 'Desktop and mobile apps when a seat is paused mid-session', why: 'Signed-in clients keep a token; they need to learn the seat is paused', under: 'e1' },
    { id: 'gap2', area: 'research', title: 'How the billing provider handles a zero-seat cycle', why: 'Unknown: needs a spike before the billing tickets can be trusted', under: 'e2' },
    { id: 'gap3', area: 'data', title: 'How we know pausing reduced churn', why: 'No success measure yet' },
  ],
  asks: [{ q: 'Should a paused member still get product emails?', options: ['Yes, all of them', 'Only billing emails', 'None'], pick: 1 }, { q: 'Can the owner pause their own seat?', options: ['Yes', 'No'], pick: 1 }],
  suggest: ['Fit it to the 3-week appetite', 'Add acceptance criteria to the billing tickets', 'Find the riskiest assumption'],
  nodes: [
    { id: 'g', kind: 'goal', title: 'Team admins can pause and resume member seats', priority: 1 },
    { id: 'e1', kind: 'epic', title: 'Admins can pause and resume a seat', parent: 'g', priority: 1 },
    t('t1', 'Admin pauses a member from the team page', 'e1', { priority: 1, estimate: 3, state: { name: 'Done', type: 'completed' }, assignee: 'Jonas Weber' }), t('t2', 'Admin resumes a paused member', 'e1', { priority: 1, estimate: 2, state: { name: 'In Progress', type: 'started' }, assignee: 'Mira Okafor' }),
    t('t3', 'Admin filters paused members in the team list', 'e1', { priority: 2, estimate: 2 }),
    { id: 'e2', kind: 'epic', title: 'Billing follows the pause', parent: 'g', priority: 1 },
    t('t4', "Paused seat isn't billed from the next cycle", 'e2', { priority: 1, estimate: 5 }), t('t5', 'Resuming mid-cycle charges a prorated amount', 'e2', { priority: 1, estimate: 5, refine: 'Proration rule not decided' }),
    { id: 'e3', kind: 'epic', title: 'Everyone knows what happened', parent: 'g', priority: 3 },
    t('t6', 'Member is emailed when paused or resumed', 'e3', { priority: 3 }), t('t7', 'Pause and resume show in the activity history', 'e3', { priority: 3, estimate: 1 }),
  ],
  messages: [
    { who: 'you', text: 'Break this down.', at: new Date(now - 60e3).toISOString() },
    { who: 'agent', text: "One goal, three epics: the action itself, billing, and keeping people informed. Billing carries the risk: proration on resume is where I'd look first.\n\nAssumed: a pause has no time limit.", at: new Date(now - 30e3).toISOString() },
    { who: 'you', text: 'Where does it hurt most? Check the data.', at: new Date(now - 20e3).toISOString() },
    { who: 'agent', text: 'Resume is where people stall: I moved proration first and added a spike.', at: new Date(now - 10e3).toISOString(), turn: 'tA' },
  ],
  // a drafted turn: changes the planner made, with what they rest on (MOCK_NODRAFT=1 for none)
  ...(!process.env.MOCK_NODRAFT && { scenario: { at: new Date().toISOString(), ops: [
    { op: 'move', id: 't5', rank: -1, turn: 'tA', because: [{ source: 'amplitude', text: 'Resume clicks drop 38% after the proration screen' }] },
    { op: 'add', id: 't8', kind: 'ticket', title: 'Spike: provider zero-seat cycle', parent: 'e2', estimate: 2, turn: 'tA', because: [{ source: 'linear:BIL-212', text: 'Open question on zero-seat invoices' }] },
    { op: 'move', id: 't6', cut: true, turn: 'tA' },
  ] } }),
}
// a project the size of a real one: five epics with long titles, about 30 tickets, some done, one going on
const epics = ['IT can see and trust that managed settings are applied', 'IT can deploy, configure and remove Acme with any standard management tool', 'Defaults vs. Enforced policy model', 'Customer Success can publish enterprise guidance from our findings', 'Admins can audit every policy change']
const big = { id: 'p2', title: 'Acme for Desktop: Administration', method: 'agile', members: [{ id: 'u1', name: 'Mira Okafor' }, { id: 'u2', name: 'Jonas Weber' }], people: 2, at: new Date().toISOString(), costUsd: 0.2, brief: '', messages: plan.messages, asks: [], suggest: ['Estimate every ticket in points', 'Find the riskiest assumption'],
  links: [{ from: 'b1-0', to: 'b1-2' }, { from: 'b0-1', to: 'b3-0' }],
  nodes: [{ id: 'g', kind: 'goal', title: 'Acme for Desktop: Administration' }, ...epics.flatMap((e, i) => [
    { id: `e${i}`, kind: 'epic', title: e, parent: 'g', priority: (i % 3) + 1 },
    ...Array.from({ length: 4 + (i % 3) * 2 }, (_, j) => t(`b${i}-${j}`, `IT ${['sees', 'pushes', 'checks', 'verifies', 'rolls out', 'removes', 'audits', 'documents'][j % 8]} ${['the managed settings on each machine', 'the policy profile through Intune and Kandji', 'the registry key schema on Windows', 'a fixed download URL for the newest MSI', 'the precedence of policies on both platforms', 'the update channel from a deep link'][j % 6]}`, `e${i}`,
      { priority: ((i + j) % 4) + 1, estimate: [3, 5, 2, 8, undefined, 3][j % 6], ...(i === 0 && j < 2 ? { state: { name: 'Done', type: 'completed' }, created: { id: 'x', identifier: `AC-14${i}${j}`, url: '#' } } : {}), ...(i === 1 && j === 0 ? { state: { name: 'In Progress', type: 'started' }, created: { id: 'y', identifier: 'AC-1473', url: '#' } } : {}) })),
  ])],
}
const setupMock = { configured: true, config: { repos: { 'acme/app': '/code/app' }, workspaces: ['review', 'exec'], linearDesktop: false, exec: { command: '', actions: [] } }, needed: [], commands: {} }
setupMock.config.company = { regions: ['eu'], certifications: ['soc2'], data: ['personal', 'recordings'], reviews: ['security'], team: [{ name: 'Mira Okafor', role: 'engineer', pace: 6 }, { name: 'Jonas Weber', role: 'engineer' }] }
const json = (res, v, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api/, '')
  if (p === '/events') { res.writeHead(204); return res.end() }
  // settings saved: kept in memory (the company profile and the rest of config)
  if (p === '/config' && req.method === 'POST') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { const v = JSON.parse(b || '{}'); Object.assign(setupMock.config, v); json(res, setupMock) }); return }
  // a plan's scenario: kept in memory, so moves can be tried in the preview
  const sc = /^\/plans\/(p\d)\/scenario$/.exec(p)
  if (sc && req.method === 'POST') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { const pl = sc[1] === 'p1' ? plan : big; const ops = JSON.parse(b || '{}').ops ?? []; pl.scenario = ops.length ? { ops, at: new Date().toISOString() } : undefined; json(res, pl) }); return }
  // the gallery's agent asking (src/dev/Gallery.tsx): one decision with long options, and a step
  if (p === '/gallery/next') return json(res, { steps: { source: 'agent', steps: [
    { kind: 'decide', text: 'What to do with AC-1492 now that the export is confirmed saved', blocking: true, options: [
      { label: 'Keep it open until the reporter has been told where the export is, then cancel it as not a desktop bug', recommended: true },
      { label: 'Cancel now as not a desktop bug' }, { label: 'Hand it to the backend team as a separate upload bug' }] },
    { kind: 'go', text: 'Post the investigation summary on the Linear ticket', checked: true },
  ] } })
  // MOCK_FIXTURES: a folder of real answers (providers.json, setup.json, plans_teams.json…) to preview a page with them
  if (process.env.MOCK_FIXTURES) { const fx = `${process.env.MOCK_FIXTURES}/${p.slice(1).replace(/\//g, '_') || 'index'}.json`; if (existsSync(fx)) return json(res, JSON.parse(readFileSync(fx, 'utf8'))) }
  if (p === '/setup') return json(res, setupMock)
  if (p === '/plans') return json(res, { plans: [plan, big].map((x) => ({ id: x.id, title: x.title, method: x.method, count: x.nodes.length, made: 0, at: x.at })) })
  if (p === '/plans/p2') return json(res, big)
  if (p === '/plans/p1') return json(res, plan)
  if (p === '/plans/projects') return json(res, { projects: [{ id: 'a', name: 'Desktop: Administration', mine: true, targetDate: '2026-12-20' }, { id: 'b', name: 'A good MCP', lead: 'Jonas', mine: false }] })
  if (p === '/plans/teams') return json(res, { teams: [{ id: 't1', key: 'WA', name: 'Web App' }] })
  if (p === '/roles') return json(res, { joined: ['developer', 'product'], setups: {}, base: { review: '/concierge-review {number}', revise: '', exec: '', plan: 'concierge-plan' }, owners: {} })
  if (p === '/skills') return json(res, [{ name: 'concierge-plan' }])
  json(res, { error: 'mock' }, 404)
}).listen(4799, () => console.log('mock API on 4799'))
