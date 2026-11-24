import assert from 'node:assert/strict'
import { test } from 'node:test'
import { flowOf, type FlowIn } from './flow.ts'

const base: FlowIn = { mine: true, closed: false, hasCheckout: true, headSha: 'h1', awaiting: 0, unresolved: 0, reviewers: 1, reviewed: false }
const job = (kind: string, extra: object = {}) => ({ kind, state: 'done', headSha: 'h1', reviewDone: true, roundAt: '2026-10-19T10:00:00Z', asks: false, ...extra }) as FlowIn['job']
const at = (f: Partial<FlowIn>) => { const r = flowOf({ ...base, ...f }); return `${r.state}:${r.next ?? '-'}` }

test('your PR: one state per situation, first rule wins', () => {
  const table: [string, Partial<FlowIn>, string][] = [
    ['closed', { closed: true }, 'closed:-'],
    ['a run is going', { job: job('revise', { state: 'running' }) }, 'working:cancel'],
    ['the last run failed', { job: job('publish', { state: 'failed' }) }, 'failed:retry'],
    ['the agent asks', { awaiting: 2, job: job('revise', { asks: true }) }, 'asks:answer'],
    ['approved, nothing open', { reviewDecision: 'APPROVED' }, 'ready-to-merge:merge'],
    ['all answered, reviewer to resolve', { unresolved: 2 }, 'answered:rerequest'],
    ['changes asked in the review itself, no thread', { reviewDecision: 'CHANGES_REQUESTED' }, 'feedback:run'],
    ['changes requested, every thread answered', { reviewDecision: 'CHANGES_REQUESTED', unresolved: 2 }, 'answered:rerequest'],
    ['nothing at all', { reviewers: 0 }, 'waiting:-'],
    ['a review with comments in its body, answered: ask them again', {}, 'answered:rerequest'],
    ['new feedback, never revised', { awaiting: 2, feedbackAt: '2026-10-19T11:00:00Z' }, 'feedback:run'],
    ['approved but threads wait', { awaiting: 2, reviewDecision: 'APPROVED', feedbackAt: '2026-10-19T11:00:00Z' }, 'feedback:finalize'],
    ['feedback newer than the round', { awaiting: 2, feedbackAt: '2026-10-19T11:00:00Z', job: job('revise') }, 'feedback:run'],
    ['prepared, crit up', { awaiting: 2, feedbackAt: '2026-10-19T09:00:00Z', job: job('revise'), crit: { live: true, finishes: 0, known: true } }, 'in-crit:crit'],
    ['prepared, crit down', { awaiting: 2, feedbackAt: '2026-10-19T09:00:00Z', job: job('revise'), crit: { live: false, finishes: 0, known: true } }, 'needs-fix:fix'],
    ['a run already saw every waiting comment and found nothing to do: no Fix again', { awaiting: 3, feedbackAt: '2026-10-19T09:00:00Z', job: job('publish'), settled: true }, 'answered:read'],
    ['…until a new comment arrives', { awaiting: 3, feedbackAt: '2026-10-19T09:00:00Z', job: job('publish'), settled: false }, 'needs-fix:fix'],
    ['a push that sent nothing', { awaiting: 2, feedbackAt: '2026-10-19T09:00:00Z', job: job('publish') }, 'needs-fix:fix'],
    ['fix round done', { awaiting: 2, feedbackAt: '2026-10-19T09:00:00Z', job: job('reply') }, 'fixed:publish'],
    ['finished in crit', { awaiting: 2, feedbackAt: '2026-10-19T09:00:00Z', job: job('revise'), crit: { live: true, finishes: 1, known: true } }, 'fixed:publish'],
    // a reply you cancelled fixed nothing: it must not read as fixes committed and ready to publish
    ['a reply that was cancelled', { awaiting: 2, feedbackAt: '2026-10-19T09:00:00Z', job: job('reply', { state: 'cancelled' }) }, 'needs-fix:fix'],
    // #4317: the agent pushed and replied (head moved), GitHub now shows nothing waiting on you
    ['pushed and replied, approved', { reviewDecision: 'APPROVED', headSha: 'h2', job: job('reply') }, 'ready-to-merge:merge'],
    ['a smart rebase is running', { op: { label: 'Smart rebase', state: 'running' } }, 'tool-running:-'],
    ['a smart rebase failed', { op: { label: 'Smart rebase', state: 'failed', result: 'nothing was pushed' } }, 'tool-failed:retry-op'],
    ['a tool run that worked changes nothing', { op: { label: 'Smart rebase', state: 'done' }, reviewDecision: 'APPROVED' }, 'ready-to-merge:merge'],
  ]
  for (const [name, f, want] of table) assert.equal(at(f), want, name)
})

test('a PR you review', () => {
  const t = (f: Partial<FlowIn>) => at({ mine: false, ...f })
  assert.equal(t({}), 'to-review:run')
  assert.equal(t({ job: job('review', { headSha: 'old' }) }), 'to-review:run') // new push since
  // with crit open the findings are still the decision: post them, approve with or without them, or crit first
  assert.equal(t({ job: job('review'), crit: { live: true, finishes: 0, known: true } }), 'ready-to-post:post')
  const why = (f: Partial<FlowIn>) => flowOf({ ...base, mine: false, job: job('review'), ...f }).why
  // the findings and the three ways to post them; which one is yours (or the review skill's next steps), never Concierge's
  assert.match(why({ crit: { live: true, finishes: 0, known: true, findings: 2, open: 3, blocking: 1 } }), /left 2 findings, 1 blocking \(3 unresolved\)\. Post them as comments, approve, or approve without them\./)
  assert.match(why({ crit: { live: true, finishes: 0, known: true, findings: 0 } }), /found nothing to flag\./)
  assert.equal('suggest' in flowOf({ ...base, mine: false, job: job('review'), crit: { live: true, finishes: 0, known: true, findings: 3, open: 3, blocking: 1 } }), false)
  assert.deepEqual(flowOf({ ...base, mine: false, job: job('review'), crit: { live: true, finishes: 0, known: true } }).also, ['crit'])
  assert.equal(t({ job: job('review') }), 'ready-to-post:post')
  assert.equal(t({ job: job('review'), reviewed: true }), 'reviewed:-')
  assert.equal(t({ job: job('review', { asks: true }), reviewed: true }), 'reviewed:-') // its question is moot once you reviewed
  assert.equal(t({ job: job('review', { asks: true }) }), 'asks:answer')
})

test('a failed tool run keeps the PR\'s own step and next move one click away', () => {
  const f = flowOf({ ...base, reviewDecision: 'APPROVED', op: { label: 'Smart rebase', state: 'failed', result: 'x' } })
  assert.equal(f.step, 4)
  assert.deepEqual(f.also, ['dismiss-op', 'merge'])
})
