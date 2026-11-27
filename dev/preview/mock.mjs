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
// the setup as the server gives it, enough of it for every page of Settings to draw
const setupMock = { configured: true, configFile: '/Users/me/.config/review-deck/config.json', reviewIn: 'concierge', critInstalled: true, skills: [], skillSources: [], features: [], needed: [], commands: { review: '/review-pr {number}', revise: '/revise {number}' },
  config: { repos: { 'acme/app': '/code/app' }, workspaces: ['review', 'exec'], linearDesktop: false, terminal: 'Terminal', review: '/review-pr {number}', revise: '/revise {number}', stack: '', explainBudgetUsd: 1, mergeOnGreen: [], skillSources: [],
    exec: { command: '/ship-tickets {id}', actions: [], allowedTools: ['Read', 'Edit', 'Bash(npm:*)', 'mcp__linear-key'] } } }
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
    ...SCREENS.map((sc) => ({ name: `${sc.domain} · ${sc.variant}`, lens: 'affected', domain: sc.domain, variant: sc.variant, viewport: 'laptop', width: 1280, note: 'What a learner does here', after: `board-${sc.id}.png`, thumb: `board-${sc.id}.png`, book: sc.domain === 'Settings' ? 'buffehgi' : 'rumanna', story: sc.id, height: 800, marks: sc.boxes.map(([part, x, y, w, h]) => ({ x, y, w, h, part })) })),
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
// MOCK_LIST=n: a busy day for timing the lists (switching items): n PRs and n tickets over the event stream, each
// with a feed of MOCK_FEED entries (default 300, in runs of MOCK_RUN: 50) that answers after MOCK_FEED_MS (default 60)
const LIST = Number(process.env.MOCK_LIST) || 0, FEED = Number(process.env.MOCK_FEED) || 300, RUN = Number(process.env.MOCK_RUN) || 50, FEED_MS = Number(process.env.MOCK_FEED_MS ?? 60)
const words = 'the agent read the diff and checked how billing handles a paused seat before it changes the proration path'.split(' ')
const say = (i, n) => Array.from({ length: n }, (_, j) => words[(i * 7 + j) % words.length]).join(' ')
const feedOf = (seed) => Array.from({ length: FEED }, (_, i) => {
  const at = new Date(now - (FEED - i) * 20e3).toISOString()
  if (i % RUN === 0) return { at, kind: 'section', text: i ? 'Revise' : 'Review' }
  if (i % RUN === RUN - 1) return { at, kind: 'result', text: `## Done (${seed})\n\n- ${say(i, 9)}\n- ${say(i + 1, 11)}\n\n\`\`\`ts\nconst x = ${i}\n\`\`\``, costUsd: i / 100 }
  if (i % 5 === 0) return { at, kind: 'text', text: `**${say(i, 4)}**: ${say(i + 2, 24)}. See \`server/billing.ts\` and [the ticket](https://linear.app/x/issue/AC-${i}).` }
  return { at, kind: 'tool', tool: ['Bash', 'Read', 'Grep', 'Edit'][i % 4], text: i % 4 === 0 ? `git log --oneline -n ${i} -- server/billing.ts` : `server/${say(i, 1)}/${say(i + 3, 1)}.ts` }
})
const STATUSES = ['ready', 'in-review', 'new', 'preparing', 'reviewed', 'new', 'no-checkout']
const listPrs = Array.from({ length: LIST }, (_, i) => {
  const mine = i % 4 === 3, status = mine ? ['new', 'answered', 'clear', 'approved'][i % 4] : STATUSES[i % STATUSES.length]
  return { id: `acme/app#${100 + i}`, repo: 'acme/app', number: 100 + i, title: `${['feat', 'fix', 'chore'][i % 3]}(billing): ${say(i, 6 + (i % 5))}`, url: `https://github.com/acme/app/pull/${100 + i}`,
    author: { login: `dev${i % 6}`, avatar: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, draft: false, base: 'main', head: `b${i}`, headSha: `sha${i}`, additions: 10 + i * 3, deletions: i, changedFiles: 1 + (i % 9),
    createdAt: new Date(now - i * 3600e3).toISOString(), updatedAt: new Date(now - i * 600e3).toISOString(), firstSeenAt: new Date(now - i * 3600e3).toISOString(),
    requested: !mine, mine, closed: false, dismissed: false, hasBody: false, background: 0, status, missing: [], linked: [],
    flow: { state: mine ? 'feedback' : 'to-review', step: 0, why: 'Requested from you', next: 'run', also: [] } }
})
const listTickets = Array.from({ length: LIST }, (_, i) => ({ id: `AC-${200 + i}`, title: `${say(i + 3, 5 + (i % 6))}`, url: `https://linear.app/acme/issue/AC-${200 + i}`, description: say(i, 40),
  state: 'Todo', stateType: 'unstarted', priority: 1 + (i % 4), labels: [], team: 'AC', branch: `ac-${200 + i}`, updatedAt: new Date(now - i * 600e3).toISOString(), createdAt: new Date(now - i * 3600e3).toISOString(),
  agentWaiting: false, prs: [], closedPrs: [], bucket: ['needs-you', 'tend', 'in-progress', 'todo', 'todo'][i % 5], repo: 'acme/app', busy: false, env: { env: 'unknown', source: 'none', detail: '' }, linked: [], background: 0 }))
const feedJson = (res, seed) => setTimeout(() => json(res, feedOf(seed)), FEED_MS)
const json = (res, v, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api/, '')
  if (LIST && p === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const ev = (name, v) => res.write(`event: ${name}\ndata: ${JSON.stringify(v)}\n\n`)
    ev('prs', listPrs); ev('exec', { actions: [], missing: [], tickets: listTickets, at: new Date().toISOString(), polling: false, configured: true, hasKey: true }); ev('alerts', [])
    return
  }
  if (LIST && p === '/me') return json(res, { login: 'me', name: 'Me', avatar: '' })
  if (LIST && /^\/(prs\/[^/]+|exec\/tickets\/[^/]+)\/activity$/.test(p)) return feedJson(res, p)
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
  // MOCK_BG=1: what the gallery's running chat (/?gallery=chat&live) left in the background: a shell with output, a
  // subagent, and a long-named process under the agent
  if (p === '/gallery/run/background' && process.env.MOCK_BG) return json(res, { tasks: [
    { id: 'b1', kind: 'shell', alive: true, outlived: false, pids: [101], cpu: 88, mb: 412, at: new Date(now - 38 * 60e3).toISOString(), cmd: 'npm run test:exports -- --bucket staging-exports-eu-west-1 --retries 3 --reporter verbose > /tmp/exports-suite-with-a-very-long-name.log 2>&1',
      tail: Array.from({ length: 12 }, (_, i) => `  ✓ export ${i + 1} of 240 (retry ${i % 3}) uploaded to s3://staging-exports-eu-west-1/reporters/long/path/segment-${i}.zip in ${(i * 1.7).toFixed(1)}s`).join('\n') },
    { id: 'b2', kind: 'agent', alive: true, outlived: false, pids: [], cpu: 0, mb: 0, at: new Date(now - 37 * 60e3).toISOString(), cmd: 'Read the upload service logs for the last 30 days and list every export that was retried until it timed out' },
  ], procs: [{ pid: 202, cmd: 'node /code/app/node_modules/.bin/vitest run --project exports --reporter=verbose --pool=forks --poolOptions.forks.singleFork', cpu: 41, mb: 230 }] })
  // MOCK_FIXTURES: a folder of real answers (providers.json, setup.json, plans_teams.json…) to preview a page with them
  if (process.env.MOCK_FIXTURES) { const fx = `${process.env.MOCK_FIXTURES}/${p.slice(1).replace(/\//g, '_') || 'index'}.json`; if (existsSync(fx)) return json(res, JSON.parse(readFileSync(fx, 'utf8'))) }
  // MOCK_REAL: a real baseline's folder (…/visuals/repo-<owner>-<name>/<sha>): its map, its built Storybooks and kept screens
  if (process.env.MOCK_REAL) {
    const R = process.env.MOCK_REAL, sha = R.replace(/\/$/, '').split('/').pop(), sb = /^\/visuals\/sb\/[^/]+\/[0-9a-f]+\/(.+)$/.exec(p)
    if (p === '/visuals/repos/ylkhayat/elbuffeh') { const m = JSON.parse(readFileSync(`${R}/manifest.json`, 'utf8')); return json(res, { repo: 'ylkhayat/elbuffeh', mode: 'auto', sets: [{ ...m, sha }], task: { state: 'done' } }) }
    // the Tokens draft, in memory: a message "drafts" the first colour, warmer
    if (p === '/visuals/tokens/ylkhayat/elbuffeh/draft') {
      globalThis.draft ??= { changes: [], turns: [] }
      const d = globalThis.draft
      if (req.method !== 'POST') return json(res, d)
      let b = ''; req.on('data', (c) => { b += c }); req.on('end', async () => {
        const j = JSON.parse(b || '{}')
        if (j.set) { d.changes = d.changes.filter((x) => !(x.book === j.set.book && x.name === j.set.name && x.theme === j.set.theme)); if (j.set.value !== j.set.was) d.changes.push(j.set) }
        if (j.discard) d.changes = []
        if (j.confirm) { d.sent = { at: new Date().toISOString(), changes: d.changes }; d.changes = []; d.turns.push({ who: 'agent', text: 'Making the PR with the changes.', at: d.sent.at }) }
        if (j.say) {
          d.turns.push({ who: 'you', text: j.say, at: new Date().toISOString() })
          const { booksIn } = await import('../../server/tokens.ts'), books = await booksIn(`${R}/storybook`)
          const b0 = books[0], t = b0.tokens.find((x) => x.kind === 'color' && /accent|primary/.test(x.name)) ?? b0.tokens.find((x) => x.kind === 'color')
          await new Promise((r) => setTimeout(r, 900))
          for (const th of Object.keys(t.values)) d.changes.push({ book: b0.book, name: t.name, theme: th, value: t.rgb ? '214 92 48' : '#d65c30', was: t.values[th] })
          d.turns.push({ who: 'agent', text: `Warmer: ${t.name} is now an orange-red in ${b0.book}.`, at: new Date().toISOString() })
        }
        json(res, d)
      }); return
    }
    if (p === '/visuals/tokens/ylkhayat/elbuffeh') { const { booksIn } = await import('../../server/tokens.ts'); return json(res, { repo: 'ylkhayat/elbuffeh', sha, books: await booksIn(`${R}/storybook`) }) }
    if (p === '/mockServiceWorker.js') { const b = /\/visuals\/sb\/[^/]+\/[0-9a-f]+\/([^/]+)\//.exec(req.headers.referer ?? '')?.[1] ?? 'rumanna'; res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(readFileSync(`${R}/storybook/${b}/mockServiceWorker.js`)) }
    if (/^\/visuals\/snaps\//.test(p) && req.method === 'POST') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', async () => { const j = JSON.parse(b), fs = await import('node:fs'); fs.mkdirSync(`${R}/storybook/${j.book}/__snap__`, { recursive: true }); fs.writeFileSync(`${R}/storybook/${j.book}/__snap__/${j.story}.html`, j.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')); json(res, { ok: true }) }); return }
    if (/^\/visuals\/snaps\//.test(p)) { const fs = await import('node:fs'), out = []; for (const b of fs.readdirSync(`${R}/storybook`)) for (const f of (fs.existsSync(`${R}/storybook/${b}/__snap__`) ? fs.readdirSync(`${R}/storybook/${b}/__snap__`) : [])) out.push(`${b}/${f.slice(0, -5)}`); return json(res, out) }
    if (sb) {
      const f = `${R}/storybook/${decodeURIComponent(sb[1])}`, ext = f.split('.').pop(), T = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' }
      if (!existsSync(f)) { res.writeHead(404); return res.end() }
      if (f.includes('/__snap__/')) { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'none'" }); return res.end(readFileSync(f)) }
      const SW = `(function(){var w=console.warn;console.warn=function(){if(!/Runtime config is deprecated/.test(String(arguments[0])))w.apply(console,arguments)}})();(function(){var c=navigator.serviceWorker;if(!c)return;var r=c.register.bind(c),base=location.pathname.replace(/[^/]*$/,'');c.register=function(u,o){try{if(/mockServiceWorker\\.js$/.test(new URL(u,location.href).pathname))o=Object.assign({},o,{scope:base})}catch(e){}return r(u,o)};var g=c.getRegistrations.bind(c),at=location.origin+base;c.getRegistrations=function(){return g().then(function(l){return l.filter(function(x){return x.scope===at})})}})()`
      res.writeHead(200, { 'content-type': T[ext] ?? 'application/octet-stream' }); return res.end(ext === 'html' ? readFileSync(f, 'utf8').replace(/<head[^>]*>/i, (h) => `${h}<script>${SW}</script>`) : readFileSync(f))
    }
  }
  // Design: the list, a repository's baseline, a PR's capture, and the made-up screens themselves
  // Standup: three projects, one that skips "blocked" (its line crosses the empty stage), one with something in each
  if (p === '/standup') return json(res, { since: new Date(Date.now() - 86_400_000).toISOString(), text: '', notes: { did: ['Call with billing about proration'] },
    did: [{ id: 'AC-200', title: 'Read the diff and checked how billing handles a paused seat', lead: 'Opened the PR for', project: 'Seat pausing' }, { id: 'AC-201', title: 'Proration path before it changes', lead: 'Merged', project: 'Seat pausing' },
      { id: 'AC-310', title: 'Desktop: admin view of members', lead: 'Reviewed', project: 'Acme for Desktop', review: true }, { id: 'AC-405', title: 'Flaky checkout test', lead: 'Fixed' }],
    blockers: [{ id: 'AC-205', title: 'Paused member still gets product emails?', why: 'An answer is owed on Linear', kind: 'answer', project: 'Seat pausing' }],
    next: [{ kind: 'continue', id: 'AC-206', title: 'Owner pauses their own seat', project: 'Seat pausing' }, { kind: 'pickup', id: 'AC-311', title: 'Desktop: invite flow', project: 'Acme for Desktop' }, { kind: 'review', id: 'AC-312', title: 'Desktop: settings page', project: 'Acme for Desktop' }] })
  if (p === '/standup/days') return json(res, { at: [] })
  if (p === '/visuals') return json(res, { joined: true, repos: [{ repo: 'ylkhayat/elbuffeh', mode: 'auto', baseline: { sha: baseline.sha, at: baseline.at, count: PARTS.length, thumb: 'board-s1.png', screens: SCREENS.length, domains: 3 }, fromApp: false }], prs: [{ ...prView, latest: { sha: prSet.sha, at: prSet.at, summary: prSet.summary, count: prSet.shots.length, thumb: 'board-s1.png' } }], tickets: [{ id: 'ELBU-3', title: 'Learner creates a course with a language and level', labels: ['design'], url: '#', prs: [prView.id] }] })
  // MOCK_MAP: the blueprint's page before its map: none (nothing set up), stories (its components, no screens), running (the map being made)
  if (p === '/visuals/repos/ylkhayat/elbuffeh') {
    const m = process.env.MOCK_MAP, stories = { ...baseline, shots: baseline.shots.filter((x) => !x.domain) }
    return json(res, { repo: 'ylkhayat/elbuffeh', mode: 'auto', sets: m === 'none' ? [] : m ? [stories] : [baseline],
      task: m === 'none' ? undefined : m === 'running' ? { state: 'running', board: true, machine: 'macbookpro', prUrl: 'https://github.com/ylkhayat/elbuffeh/pull/22' } : { state: 'done', prUrl: 'https://github.com/ylkhayat/elbuffeh/pull/22' } })
  }
  if (p === '/visuals/setup/ylkhayat/elbuffeh/activity' && process.env.MOCK_MAP === 'running') return json(res, [{ at: new Date().toISOString(), kind: 'text', text: 'Steps 1–3 are done: the stories are committed and pushed at c6343c9, and both Storybooks are built into the visuals folder. Checking that the branch is still current, then re-writing the board capture script.' }])
  if (decodeURIComponent(p) === `/prs/${prView.id}/visuals`) return json(res, { ...prView, sets: [prSet] })
  if (p.startsWith('/visuals/') && p.endsWith('/activity')) return json(res, [])
  // a baseline's Storybook, made up: each story's page drawn live from the same boxes (a dot blinks: it is a page)
  if (/^\/visuals\/sb\/.+\/iframe\.html$/.test(p)) {
    const sc = SCREENS.find((x) => x.id === new URL(req.url, 'http://x').searchParams.get('id'))
    res.writeHead(sc ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(sc ? `<!doctype html><body style="margin:0;background:#fbfbfc;font:13px system-ui;position:relative;width:1280px;height:800px;overflow:hidden">${sc.boxes.filter(([n]) => n !== 'AppShell').map(([n, x, y, w, h]) =>
      `<div style="position:absolute;left:${x}%;top:${y}%;width:${w}%;height:${h}%;box-sizing:border-box;border-radius:10px;border:1px solid hsl(${HUE[n] ?? 0} 35% 78%);background:hsl(${HUE[n] ?? 0} 60% ${n === 'Button' ? 62 : 94}%);padding:10px;color:hsl(${HUE[n] ?? 0} 30% 35%);overflow:hidden">${w > 12 ? n : ''}</div>`).join('')}<b style="position:absolute;left:16%;bottom:14px;font:600 26px system-ui;color:#e0338a">LIVE PAGE · ${sc.domain} · ${sc.variant}</b><p style="position:absolute;left:33%;top:46%;margin:0;font:12px system-ui;color:#555">Small print, to see how sharp it stays when enlarged.</p><style>@keyframes b{to{opacity:.2}}</style></body>` : '')
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
