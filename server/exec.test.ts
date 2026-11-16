import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execCommand, furthest, gate, outcomesIn, prepOf, settledIn, workNote, type Outcome, phaseOf, prLinksIn, repoFor, stackLinesIn, stackOrder, ticketStacks } from './exec.ts'
import { bucketOf, handedBack, type Ticket } from './linear.ts'

test('outcome lines, including markdown wrapping', () => {
  const text = [
    'Done.',
    'AC-1234 ac-1234-fix-the-thing 3f9a1c2d shipped',
    '- `AC-77 refined`',
    '**AC-890 failed: rebase conflict with AC-889**',
    'BLI-1 is not a verdict line',
  ].join('\n')
  assert.deepEqual(outcomesIn(text), {
    'AC-1234': { outcome: 'shipped', branch: 'ac-1234-fix-the-thing', sha: '3f9a1c2d' },
    'AC-77': { outcome: 'refined' },
    'AC-890': { outcome: 'failed', reason: 'rebase conflict with AC-889' },
  })
})

test('PR links and stack lines', () => {
  const text = 'Opened https://github.com/acme/api/pull/12 and https://github.com/acme/api/pull/13.\nstack #12: #12 → #13'
  assert.deepEqual(prLinksIn(text).map((p) => p.number), [12, 13])
  assert.deepEqual(stackLinesIn(text), ['stack #12: #12 → #13'])
})

test('phases from tool calls only move forward', () => {
  assert.equal(phaseOf('Bash', 'git worktree add ../worktrees/api/x develop'), 'implementing')
  assert.equal(phaseOf('Bash', 'npx nx affected -t typecheck build test --base=abc'), 'checking')
  assert.equal(phaseOf('Bash', "claude -p '/revise origin/develop --autonomous'"), 'self-review')
  assert.equal(phaseOf('Bash', 'gh stack submit --auto --open'), 'opening-pr')
  assert.equal(phaseOf('Bash', 'ls'), undefined)
  assert.equal(furthest('checking', 'implementing'), 'checking')
  assert.equal(furthest(undefined, 'evidence'), 'evidence')
})

test('repo by prefix and the command line', () => {
  const map = { BLI: 'acme/mono', DA: 'acme/desktop' }
  assert.equal(repoFor('BLI-9', map), 'acme/mono')
  assert.equal(repoFor('XX-9', map), undefined)
  assert.equal(execCommand('/my-exec {ids} --unattended', ['ENG-1', 'ENG-2']), '/my-exec ENG-1 ENG-2 --unattended')
})

test('buckets mirror the exec pick order', () => {
  const t = (over: Partial<Ticket>): Ticket => ({ id: 'BLI-1', title: '', url: '', description: '', state: 'Todo', stateType: 'unstarted', priority: 2, labels: [], team: 'BLI', branch: '', updatedAt: new Date().toISOString(), createdAt: '', agentWaiting: false, prs: [], ...over })
  assert.equal(bucketOf(t({ agentWaiting: true, state: 'In Progress', stateType: 'started' })), 'needs-you')
  assert.equal(bucketOf(t({ state: 'In Review', stateType: 'started' }), { actionable: true }), 'tend')
  // someone else's now, or closed: never on your plate, whatever else it says
  assert.equal(bucketOf(t({ handedTo: 'Nick', agentWaiting: true, state: 'In Progress', stateType: 'started' })), 'handed')
  assert.equal(bucketOf(t({ closed: true, handedTo: 'Nick', state: 'Done', stateType: 'completed' })), 'closed')
  assert.equal(bucketOf(t({ state: 'Backlog', stateType: 'backlog' })), 'backlog')
  assert.equal(bucketOf(t({ state: 'In Review', stateType: 'started' }), { actionable: false }), 'shipped')
  assert.equal(bucketOf(t({ state: 'In Progress', stateType: 'started', updatedAt: '2020-01-01T00:00:00Z' })), 'stalled')
  assert.equal(bucketOf(t({ state: 'In Progress', stateType: 'started' })), 'in-progress')
  assert.equal(bucketOf(t({})), 'todo')
  assert.equal(bucketOf(t({ state: 'Triage', stateType: 'triage' })), 'triage')
})


test('stackOrder puts each PR after the one it builds on', () => {
  const p = (n: number, base: string, head: string) => ({ n, base, head })
  const got = stackOrder([p(4256, 'b', 'c'), p(4264, 'a', 'b'), p(4262, 'c', 'd'), p(4214, 'main', 'a')]).map((x) => x.n)
  assert.deepEqual(got, [4214, 4264, 4256, 4262])
  assert.deepEqual(stackOrder<{ n: number; base?: string; head?: string }>([{ n: 1 }, { n: 2 }]).map((x) => x.n), [1, 2])
})

test('ticketStacks: a GitHub stack holds its tickets in order, a run holds the rest', () => {
  const pr = (number: number) => ({ repo: 'o/r', number })
  const gh: Record<string, { number: number }[]> = { 'o/r#1': [pr(1), pr(2), pr(3)], 'o/r#2': [pr(1), pr(2), pr(3)], 'o/r#3': [pr(1), pr(2), pr(3)] }
  const run = { id: 'r1', ids: ['C', 'D', 'E'] }
  const got = ticketStacks([
    { id: 'B', prs: [pr(2), pr(3)] }, { id: 'A', prs: [pr(1)] }, // B's two PRs sit above A's
    { id: 'C', prs: [], run }, { id: 'D', prs: [], run }, // E is not in the list (not yours any more)
    { id: 'F', prs: [pr(9)], run: { id: 'r2', ids: ['F'] } },
  ], (k) => gh[k])
  assert.deepEqual(got.get('A'), { key: 'o/r#1', ids: ['A', 'B'] })
  assert.deepEqual(got.get('B'), got.get('A'))
  assert.deepEqual(got.get('C'), { key: 'run:r1', ids: ['C', 'D'] })
  assert.equal(got.get('F'), undefined)
})

test('a handover line names another ticket and carries its brief until a blank line', async () => {
  const { handoversIn } = await import('./exec.ts')
  const text = [
    'Filed AC-1264 for the remaining cases.',
    '',
    'HANDOVER AC-1264: Build it as a PR stacked on #4801 (branch ac-1212-stop-generic-words).',
    'Decided: separate PR; reuse the libpostal dictionaries.',
    '',
    '**HANDOVER AC-1265:** later',
    'HANDOVER AC-1212: never to itself',
  ].join('\n')
  const h = handoversIn(text, ['AC-1212'])
  assert.deepEqual(h.map((x) => x.id), ['AC-1264', 'AC-1265']) // bold is fine; never to itself
  assert.equal(h[1].brief, 'later')
  assert.equal(h[0].brief, 'Build it as a PR stacked on #4801 (branch ac-1212-stop-generic-words).\nDecided: separate PR; reuse the libpostal dictionaries.')
  assert.deepEqual(handoversIn('- `HANDOVER WA-9: do it`', []), [{ id: 'WA-9', brief: 'do it' }])
})

test('a run that handed back decisions waits on you; a busy, closed or handed-over one does not', () => {
  const next = { decisions: [{}], actions: [] }
  assert.equal(handedBack({ state: 'done', next }, 'in-progress'), 'needs-you')
  assert.equal(handedBack({ state: 'done', next: { decisions: [], actions: [] } }, 'in-progress'), 'in-progress')
  assert.equal(handedBack({ state: 'running', next }, 'todo'), 'todo')
  assert.equal(handedBack({ state: 'done', next }, 'closed'), 'closed')
  assert.equal(handedBack(undefined, 'shipped'), 'shipped')
})

test('a ticket whose outcome is in leaves the running run', () => {
  const run = { state: 'running', outcomes: { 'AI-1': { outcome: 'refined' as const }, 'AI-2': { outcome: 'shipped' as const } } }
  assert.equal(settledIn(run, 'AI-1'), 'parked')
  assert.equal(settledIn(run, 'AI-2'), 'shipped')
  assert.equal(settledIn(run, 'AI-3'), undefined)
  assert.equal(settledIn({ ...run, state: 'done' }, 'AI-1'), undefined) // an ended run: handedBack's job
})

test('a stack is submitted once every ticket in it is ready, each by its latest run in the batch', () => {
  const r = (ids: string[], o: Record<string, Outcome>, extra = {}) => ({ batch: 'b1', state: 'done', ids, queuedAt: '2026-11-10T08:00:00Z', outcomes: o, ...extra })
  const a = r(['AI-1'], { 'AI-1': { outcome: 'ready', branch: 'ai-1', sha: 'abc1234' } })
  const asked = r(['AI-2'], { 'AI-2': { outcome: 'refined' } })
  assert.deepEqual(gate(['AI-1', 'AI-2'], [a, asked], 'b1'), { ready: ['AI-1'], waiting: ['AI-2'] })
  const answered = r(['AI-2'], { 'AI-2': { outcome: 'ready', branch: 'ai-2', sha: 'def5678' } }, { queuedAt: '2026-11-10T09:00:00Z' })
  assert.deepEqual(gate(['AI-1', 'AI-2'], [a, asked, answered], 'b1'), { go: [{ id: 'AI-1', branch: 'ai-1', sha: 'abc1234' }, { id: 'AI-2', branch: 'ai-2', sha: 'def5678' }] })
  // another batch's run, a prep run, or one still running don't count
  assert.ok('waiting' in gate(['AI-1', 'AI-2'], [a, { ...answered, batch: 'b2' }], 'b1'))
  assert.ok('waiting' in gate(['AI-1', 'AI-2'], [a, { ...answered, role: 'prep' }], 'b1'))
  assert.ok('waiting' in gate(['AI-1', 'AI-2'], [a, { ...answered, state: 'running' }], 'b1'))
  assert.deepEqual(outcomesIn('AI-3 ai-3-x 1234567 ready'), { 'AI-3': { outcome: 'ready', branch: 'ai-3-x', sha: '1234567' } })
})

test('the prep says its branch on its last line, and the ticket runs get its brief and the gate', () => {
  assert.deepEqual(prepOf('Decided X.\nPREP prep/ai-1-shared'), { branch: 'prep/ai-1-shared' })
  assert.deepEqual(prepOf('Only decisions.\n`PREP none`'), {})
  assert.equal(prepOf('I asked on Linear.'), undefined)
  const b = { id: 'b1', at: '', stacks: [['AI-1', 'AI-2'], ['AI-3']], prep: { ids: ['AI-1', 'AI-2'], task: 't', branch: 'prep/x', brief: 'use Foo' }, submitted: {} }
  assert.match(workNote(b, 'AI-2'), /Branch off `prep\/x`[\s\S]*use Foo[\s\S]*AI-2 <branch> <sha> ready/)
  assert.equal(workNote(b, 'AI-3'), '') // alone and not in the prep: it ships itself, as always
})

test("a Ship run's goal is a prompt Stop hook naming every ticket, or the prep line for a prep", async () => {
  const { goalSettings } = await import('./exec.ts')
  const h = JSON.parse(goalSettings(['AC-1', 'AC-2'])).hooks.Stop[0].hooks[0]
  assert.equal(h.type, 'prompt')
  assert.match(h.prompt, /\$ARGUMENTS/)
  assert.match(h.prompt, /AC-1, AC-2/)
  assert.match(JSON.parse(goalSettings(['AC-1'], 'prep')).hooks.Stop[0].hooks[0].prompt, /PREP <branch>/)
})
