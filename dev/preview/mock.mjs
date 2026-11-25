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
// --- Design: a baseline with its board (the blueprint), and a PR's capture through its lenses -------------------------
// Each screen is drawn from the same boxes its marks name, so what lights up on the board is what is drawn there.
const SCREENS = [
  ['Courses', 'No course yet', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['EmptyState', 34, 30, 46, 36], ['Button', 48, 54, 18, 7]]],
  ['Courses', 'Your courses', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['CourseCard', 18, 16, 24, 32], ['CourseCard', 45, 16, 24, 32], ['CourseCard', 72, 16, 24, 32], ['LevelChip', 20, 40, 7, 4], ['LevelChip', 47, 40, 7, 4], ['LevelChip', 74, 40, 7, 4], ['Button', 82, 5, 14, 6]]],
  ['Courses', 'Creating one', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['LanguagePicker', 30, 18, 44, 22], ['StudyPurposeField', 30, 44, 44, 16], ['LevelChip', 32, 64, 7, 4], ['LevelChip', 41, 64, 7, 4], ['Button', 58, 74, 16, 7]]],
  ['Board', 'Empty day', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['BoardRail', 16, 10, 16, 84], ['EmptyState', 44, 32, 40, 32]]],
  ['Board', 'Writing notes', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['BoardRail', 16, 10, 16, 84], ['DailyNotesPanel', 35, 10, 61, 84], ['ItemNotesEditor', 38, 26, 55, 40], ['Annotation', 44, 38, 22, 5]]],
  ['Board', 'A correction shows', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['BoardRail', 16, 10, 16, 84], ['DailyNotesPanel', 35, 10, 61, 84], ['ItemNotesEditor', 38, 26, 55, 40], ['Annotation', 44, 38, 22, 5], ['Annotation', 50, 48, 28, 5], ['RuleCard', 68, 56, 24, 22], ['LevelChip', 70, 60, 7, 4]]],
  ['Board', 'Offline', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['BoardRail', 16, 10, 16, 84], ['DailyNotesPanel', 35, 10, 61, 84], ['Banner', 35, 10, 61, 7]]],
  ['Settings', 'Profile', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['LanguagePicker', 22, 18, 40, 20], ['StudyPurposeField', 22, 42, 40, 16], ['Button', 22, 64, 14, 7]]],
  ['Settings', 'Corrections off', [['AppShell', 0, 0, 100, 100], ['NavRail', 0, 0, 14, 100], ['Toggle', 22, 22, 10, 5], ['Banner', 22, 32, 56, 8], ['Button', 22, 64, 14, 7]]],
].map(([domain, variant, boxes], i) => ({ id: `s${i}`, domain, variant, boxes }))
const HUE = { AppShell: 0, NavRail: 250, EmptyState: 200, Button: 335, CourseCard: 150, LevelChip: 40, LanguagePicker: 280, StudyPurposeField: 180, BoardRail: 230, DailyNotesPanel: 100, ItemNotesEditor: 60, Annotation: 20, RuleCard: 310, Banner: 85, Toggle: 160 }
const draw = (boxes, w = 1280, h = 800) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fbfbfc"/>${boxes.filter(([n]) => n !== 'AppShell').map(([n, x, y, bw, bh]) =>
  `<rect x="${x * w / 100}" y="${y * h / 100}" width="${bw * w / 100}" height="${bh * h / 100}" rx="10" fill="hsl(${HUE[n] ?? 0} 60% ${n === 'Button' ? 62 : 94}%)" stroke="hsl(${HUE[n] ?? 0} 35% 78%)"/>` +
  (bw > 12 ? `<rect x="${x * w / 100 + 14}" y="${y * h / 100 + 14}" width="${Math.min(bw * w / 100 - 28, 150)}" height="9" rx="4" fill="hsl(${HUE[n] ?? 0} 25% 55%)" opacity=".7"/><rect x="${x * w / 100 + 14}" y="${y * h / 100 + 32}" width="${Math.min(bw * w / 100 - 28, 230)}" height="6" rx="3" fill="hsl(${HUE[n] ?? 0} 15% 70%)" opacity=".6"/>` : '')).join('')}</svg>`
const PARTS = Object.keys(HUE).map((name) => ({ name, file: `apps/rumanna/components/${name === 'AppShell' ? 'layout/' : ''}${name}.tsx`, kind: name === 'AppShell' ? 'layout' : 'component' }))
const baseline = { head: 'c0ffee1', sha: 'c0ffee1', at: new Date(now - 3600e3).toISOString(), source: 'storybook', summary: 'The design system of rumanna: 15 components in four layers, their states in stories, and the app\'s three domains as a storyline.',
  impact: { changed: PARTS, affected: [] },
  shots: [
    ...PARTS.filter((x) => x.name !== 'AppShell').map((x) => ({ name: `${x.name} · Default`, lens: 'changed', part: x.name, viewport: 'laptop', width: 1280, note: 'As most learners see it', after: `part-${x.name}.png` })),
    ...SCREENS.map((sc) => ({ name: `${sc.domain} · ${sc.variant}`, lens: 'affected', domain: sc.domain, variant: sc.variant, viewport: 'laptop', width: 1280, note: 'What a learner does here', after: `board-${sc.id}.png`, thumb: `board-${sc.id}.png`, book: 'rumanna', story: sc.id, height: 800, marks: sc.boxes.map(([part, x, y, w, h]) => ({ x, y, w, h, part })) })),
  ] }
const prSet = { head: 'abc1234', sha: 'abc1234', at: new Date(now - 600e3).toISOString(), source: 'storybook', summary: 'Levels show as chips instead of plain text, on the course card and wherever a rule is explained.',
  impact: { changed: [PARTS.find((x) => x.name === 'LevelChip'), PARTS.find((x) => x.name === 'CourseCard')],
    affected: [{ name: 'RuleCard', file: 'apps/rumanna/components/RuleCard.tsx', kind: 'component', via: ['LevelChip'], depth: 1 }, { name: 'CoursesPage', file: 'apps/rumanna/app/(app)/courses/page.tsx', kind: 'screen', via: ['CourseCard', 'LevelChip'], depth: 2 }, { name: 'AppShell', file: 'apps/rumanna/components/layout/AppShell.tsx', kind: 'layout', via: ['CourseCard'], depth: 3 }] },
  shots: [
    { name: 'LevelChip · B2', lens: 'changed', part: 'LevelChip', viewport: 'laptop', width: 1280, note: 'A chip, where it was plain text', before: 'part-LevelChip.png', after: 'part-LevelChip.png', marks: [{ x: 20, y: 30, w: 60, h: 40, part: 'LevelChip', label: 'now a chip, tinted by level', side: 'after' }] },
    { name: 'CourseCard · Default', lens: 'changed', part: 'CourseCard', viewport: 'laptop', width: 1280, before: 'part-CourseCard.png', after: 'part-CourseCard.png' },
    { name: 'Courses · Your courses', lens: 'affected', part: 'CoursesPage', viewport: 'laptop', width: 1280, note: 'The chips sit under each title', before: 'board-s1.png', after: 'board-s1.png', marks: SCREENS[1].boxes.filter(([n]) => n === 'LevelChip' || n === 'CourseCard').map(([part, x, y, w, h]) => ({ x, y, w, h, part, label: part === 'LevelChip' ? 'chip instead of text' : 'room made for the chip', side: 'after' })) },
  ] }
const vTask = undefined
const prView = { id: 'ylkhayat/elbuffeh#21', repo: 'ylkhayat/elbuffeh', number: 21, title: 'feat(rumanna): courses, fast fitted corrections and learner choices', url: 'https://github.com/ylkhayat/elbuffeh/pull/21', author: 'ylkhayat', mine: true, draft: false, headSha: 'abc1234', mode: 'auto', ui: { is: true, why: '14 files people see: CourseCard.tsx, LevelChip.tsx, page.tsx…', files: [], head: 'abc1234', at: new Date().toISOString() }, wanted: true, task: vTask, tickets: ['ELBU-3'] }
const json = (res, v, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api/, '')
  if (p === '/events') { res.writeHead(204); return res.end() }
  // settings saved: kept in memory (the company profile and the rest of config)
  if (p === '/config' && req.method === 'POST') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { const v = JSON.parse(b || '{}'); Object.assign(setupMock.config, v); json(res, setupMock) }); return }
  // a plan's scenario: kept in memory, so moves can be tried in the preview
  const sc = /^\/plans\/(p\d)\/scenario(\/add)?$/.exec(p)
  if (sc && req.method === 'POST') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { const pl = sc[1] === 'p1' ? plan : big; const ops = [...(sc[2] ? pl.scenario?.ops ?? [] : []), ...(JSON.parse(b || '{}').ops ?? [])]; pl.scenario = ops.length ? { ops, at: new Date().toISOString() } : undefined; json(res, pl) }); return }
  // the gallery's agent asking (src/dev/Gallery.tsx): one decision with long options, and a step
  if (p === '/gallery/next') return json(res, { steps: { source: 'agent', steps: [
    { kind: 'decide', text: 'What to do with AC-1492 now that the export is confirmed saved', blocking: true, options: [
      { label: 'Keep it open until the reporter has been told where the export is, then cancel it as not a desktop bug', recommended: true },
      { label: 'Cancel now as not a desktop bug' }, { label: 'Hand it to the backend team as a separate upload bug' }] },
    { kind: 'go', text: 'Post the investigation summary on the Linear ticket', checked: true },
  ] } })
  // MOCK_FIXTURES: a folder of real answers (providers.json, setup.json, plans_teams.json…) to preview a page with them
  if (process.env.MOCK_FIXTURES) { const fx = `${process.env.MOCK_FIXTURES}/${p.slice(1).replace(/\//g, '_') || 'index'}.json`; if (existsSync(fx)) return json(res, JSON.parse(readFileSync(fx, 'utf8'))) }
  // Design: the list, a repository's baseline, a PR's capture, and the made-up screens themselves
  if (p === '/visuals') return json(res, { joined: true, repos: [{ repo: 'ylkhayat/elbuffeh', mode: 'auto', baseline: { sha: baseline.sha, at: baseline.at, count: PARTS.length, thumb: 'board-s1.png' }, fromApp: false }], prs: [{ ...prView, latest: { sha: prSet.sha, at: prSet.at, summary: prSet.summary, count: prSet.shots.length, thumb: 'board-s1.png' } }], tickets: [{ id: 'ELBU-3', title: 'Learner creates a course with a language and level', labels: ['design'], url: '#', prs: [prView.id] }] })
  if (p === '/visuals/repos/ylkhayat/elbuffeh') return json(res, { repo: 'ylkhayat/elbuffeh', mode: 'auto', task: { state: 'done', prUrl: 'https://github.com/ylkhayat/elbuffeh/pull/22' }, sets: [baseline] })
  if (decodeURIComponent(p) === `/prs/${prView.id}/visuals`) return json(res, { ...prView, sets: [prSet] })
  if (p.startsWith('/visuals/') && p.endsWith('/activity')) return json(res, [])
  // a baseline's Storybook, made up: each story's page drawn live from the same boxes (a dot blinks: it is a page)
  if (/^\/visuals\/sb\/.+\/iframe\.html$/.test(p)) {
    const sc = SCREENS.find((x) => x.id === new URL(req.url, 'http://x').searchParams.get('id'))
    res.writeHead(sc ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(sc ? `<!doctype html><body style="margin:0;background:#fbfbfc;font:13px system-ui;position:relative;width:1280px;height:800px;overflow:hidden">${sc.boxes.filter(([n]) => n !== 'AppShell').map(([n, x, y, w, h]) =>
      `<div style="position:absolute;left:${x}%;top:${y}%;width:${w}%;height:${h}%;box-sizing:border-box;border-radius:10px;border:1px solid hsl(${HUE[n] ?? 0} 35% 78%);background:hsl(${HUE[n] ?? 0} 60% ${n === 'Button' ? 62 : 94}%);padding:10px;color:hsl(${HUE[n] ?? 0} 30% 35%);overflow:hidden">${w > 12 ? n : ''}</div>`).join('')}<b style="position:absolute;left:16%;bottom:14px;font:600 26px system-ui;color:#e0338a;animation:b 1s infinite alternate">LIVE PAGE · ${sc.domain} · ${sc.variant}</b><style>@keyframes b{to{opacity:.2}}</style></body>` : '')
  }
  if (p === '/visuals/image') {
    const f = new URL(req.url, 'http://x').searchParams.get('f') ?? '', sc = SCREENS.find((x) => f === `board-${x.id}.png`), part = /^part-(\w+)\.png$/.exec(f)?.[1]
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' })
    return res.end(sc ? draw(sc.boxes) : draw([[part ?? 'Button', 8, 14, 84, 72]], 640, 360))
  }
  if (p === '/setup') return json(res, setupMock)
  if (p === '/plans') return json(res, { plans: [plan, big].map((x) => ({ id: x.id, title: x.title, method: x.method, count: x.nodes.length, made: 0, at: x.at })) })
  if (p === '/plans/p2') return json(res, big)
  if (p === '/plans/p1') return json(res, plan)
  if (p === '/plans/projects') return json(res, { projects: [{ id: 'a', name: 'Desktop: Administration', mine: true, targetDate: '2026-12-20' }, { id: 'b', name: 'A good MCP', lead: 'Jonas', mine: false }] })
  if (p === '/plans/teams') return json(res, { teams: [{ id: 't1', key: 'WA', name: 'Web App' }] })
  if (p === '/roles') return json(res, { joined: ['developer', 'product', 'design'], setups: {}, base: { review: '/concierge-review {number}', revise: '', exec: '', plan: 'concierge-plan' }, owners: {} })
  if (p === '/skills') return json(res, [{ name: 'concierge-plan' }])
  json(res, { error: 'mock' }, 404)
}).listen(4799, () => console.log('mock API on 4799'))
