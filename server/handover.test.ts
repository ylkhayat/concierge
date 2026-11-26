import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeHandover, carryNote, carryOf, handoverDue, mainOf, routeFallback, routeInstruction, stackedPrompt, type TicketHandover } from './handover.ts'
import type { Step } from './reply.ts'

const R = 'o/app'
const run = (x: Partial<Parameters<typeof handoverDue>[0]['run']> = {}) => ({ id: 'r1', state: 'done', queuedAt: '2026-11-20T10:00:00Z', endedAt: '2026-11-20T10:30:00Z', prs: [], ...x })
const pr = (number: number, x: { open?: boolean; agentAt?: string } = {}) => ({ repo: R, number, open: x.open ?? true, ...(x.agentAt && { agentAt: x.agentAt }) })
const NOW = '2026-11-20T11:00:00Z'

test('a run that ended with its PR open hands the ticket over to it', () => {
  const h = handoverDue({ run: run({ prs: [{ repo: R, number: 12 }] }), prs: [pr(12)], now: NOW })
  assert.deepEqual(h, { to: [{ repo: R, number: 12 }], at: NOW, run: 'r1', why: 'opened' })
  // said shipped without naming the URL (the PR is linked on Linear): the same
  assert.equal(handoverDue({ run: run({ outcome: 'shipped' }), prs: [pr(12)], now: NOW })?.why, 'opened')
})

test('no handover while the run works, for a prep, or with no PR', () => {
  assert.equal(handoverDue({ run: run({ state: 'running', prs: [{ repo: R, number: 12 }] }), prs: [pr(12)] }), undefined)
  assert.equal(handoverDue({ run: run({ state: 'queued' }), prs: [pr(12, { agentAt: NOW })] }), undefined)
  assert.equal(handoverDue({ run: run({ role: 'prep', prs: [{ repo: R, number: 12 }] }), prs: [pr(12)] }), undefined)
  assert.equal(handoverDue({ run: run({ outcome: 'shipped' }), prs: [] }), undefined)
})

test('a ticket with PRs and no run of its own, or a run that ended without naming them, hands over too', () => {
  assert.deepEqual(handoverDue({ run: undefined, prs: [pr(12)], now: NOW }), { to: [{ repo: R, number: 12 }], at: NOW, run: '', why: 'has-pr' })
  assert.equal(handoverDue({ run: undefined, prs: [pr(12)], was: { to: [{ repo: R, number: 12 }], at: NOW, run: '', why: 'has-pr' } }), undefined) // once
  assert.equal(handoverDue({ run: run(), prs: [pr(12)], now: NOW })?.why, 'has-pr') // done, PR linked on Linear only
  assert.equal(handoverDue({ run: run({ state: 'failed' }), prs: [pr(12)], now: NOW })?.why, 'has-pr')
  assert.equal(handoverDue({ run: run({ state: 'cancelled' }), prs: [pr(12)], now: NOW })?.why, 'has-pr')
  assert.equal(handoverDue({ run: undefined, prs: [] }), undefined)
})

test('a blocking decision keeps the ticket until it is answered', () => {
  const steps: Step[] = [{ text: 'Open as draft?', kind: 'decide', blocking: true, options: [{ label: 'Draft' }, { label: 'Ready' }] }]
  assert.equal(handoverDue({ run: run({ prs: [{ repo: R, number: 12 }] }), prs: [pr(12)], steps }), undefined)
  // a non-blocking one is carried over instead
  assert.equal(handoverDue({ run: run({ prs: [{ repo: R, number: 12 }] }), prs: [pr(12)], steps: [{ ...steps[0], blocking: false }] })?.why, 'opened')
})

test("the PR's agent started after the run ended hands it over, even from a run that opened nothing", () => {
  assert.equal(handoverDue({ run: run({ state: 'failed' }), prs: [pr(12, { agentAt: '2026-11-20T10:45:00Z' })], now: NOW })?.why, 'pr-agent')
  // one started before the run ended is older than the ticket's words: it still has its PR, so it hands over as such
  assert.equal(handoverDue({ run: run({ state: 'failed' }), prs: [pr(12, { agentAt: '2026-11-20T10:15:00Z' })] })?.why, 'has-pr')
})

test('it goes to the open PRs, or every one when none is open; again only when they change', () => {
  const h = handoverDue({ run: run({ prs: [{ repo: R, number: 11 }, { repo: R, number: 12 }] }), prs: [pr(11, { open: false }), pr(12)], now: NOW })!
  assert.deepEqual(h.to, [{ repo: R, number: 12 }])
  assert.deepEqual(handoverDue({ run: run({ outcome: 'shipped' }), prs: [pr(11, { open: false })] })?.to, [{ repo: R, number: 11 }])
  const was: TicketHandover = { ...h, carry: ['- x'] }
  assert.equal(handoverDue({ run: run(), prs: [pr(11, { open: false }), pr(12)], was }), undefined)
  const more = handoverDue({ run: run(), prs: [pr(12), pr(13)], was })!
  assert.deepEqual(more.to.map((p) => p.number), [12, 13])
  assert.equal(more.at, was.at)
})

test('the handover holds until a newer run takes the ticket up, and comes back once that one hands over', () => {
  const was: TicketHandover = { to: [{ repo: R, number: 12 }], at: NOW, run: 'r1', why: 'opened' }
  assert.equal(activeHandover(was, { id: 'r1', queuedAt: '2026-11-20T10:00:00Z', state: 'done' }), was)
  assert.equal(activeHandover(was, { id: 'r2', queuedAt: '2026-11-20T12:00:00Z', state: 'running' }), undefined)
  assert.equal(activeHandover(was, { id: 'r2', queuedAt: '2026-11-20T12:00:00Z', state: 'done' }), undefined)
  // the newer run (a stacked PR) ends with its PR: handed over again, now to both
  const again = handoverDue({ run: run({ id: 'r2', queuedAt: '2026-11-20T12:00:00Z', endedAt: '2026-11-20T12:40:00Z', prs: [{ repo: R, number: 13 }] }), prs: [pr(12), pr(13)], was, now: '2026-11-20T12:41:00Z' })!
  assert.equal(again.run, 'r2')
  assert.deepEqual(again.to.map((p) => p.number), [12, 13])
  assert.equal(mainOf(again, () => true)?.number, 13)
  assert.equal(mainOf(again, (p) => p.number === 12)?.number, 12)
})

test("the ticket's open steps are carried once, minus what the PR's agent already lists", () => {
  const steps: Step[] = [
    { text: 'Push the 2 fix commits', kind: 'publish', checked: true },
    { text: 'Add a test for the loader', kind: 'do', checked: false },
    { text: 'Lookup timeout', kind: 'decide', options: [{ label: 'Keep 30 s', recommended: true }, { label: '10 s' }] },
  ]
  const lines = carryOf(steps, ['push the 2 fix commits.'])
  assert.deepEqual(lines, ['- Add a test for the loader (optional)', '- Decide: Lookup timeout (Keep 30 s, recommended / 10 s)'])
  assert.match(carryNote('AI-12', lines), /AI-12 handed over to this PR[\s\S]*- Add a test/)
  assert.equal(carryNote('AI-12', []), '')
  assert.deepEqual(carryOf(null), [])
})

test('routing by rule: merged or closed, approved, and your own words decide it; otherwise the same PR', () => {
  const open = { number: 12, state: 'open' as const }
  assert.deepEqual([routeFallback('also handle empty files', { number: 12, state: 'merged' })].map((r) => [r.to, r.fixed, r.sure]), [['stack', true, true]])
  assert.equal(routeFallback('x', { number: 12, state: 'closed' }).to, 'stack')
  assert.deepEqual([routeFallback('rename the flag', { ...open, agent: false })].map((r) => [r.to, r.fixed]), [['stack', true]])
  assert.equal(routeFallback('rename the flag', { ...open, approved: true }).to, 'stack')
  assert.equal(routeFallback('do the export in a separate PR', open).to, 'stack')
  assert.equal(routeFallback('stack it on top of the current one', open).to, 'stack')
  assert.equal(routeFallback('put it in the same PR', { ...open, approved: true }).to, 'pr')
  const plain = routeFallback('rename the flag', open)
  assert.equal(plain.to, 'pr'); assert.equal(plain.sure, false)
})

test('the small model decides only what the rule leaves open, and its failure falls back to the same PR', async () => {
  const open = { number: 12, state: 'open' as const }
  let asked = 0
  const model = async () => { asked++; return { route: 'new' as const, why: 'a separate export feature' } }
  assert.deepEqual(await routeInstruction('add CSV export', open, model), { to: 'stack', pr: 12, why: 'a separate export feature', by: 'model' })
  assert.equal((await routeInstruction('add CSV export', { number: 12, state: 'merged' }, model)).by, 'rule')
  assert.equal(asked, 1)
  const failed = await routeInstruction('add CSV export', open, async () => { throw new Error('no model') })
  assert.deepEqual([failed.to, failed.by], ['pr', 'rule'])
})

test("a stacked PR's prompt builds on the PR's branch, or the base once it is merged, and never pushes to it", () => {
  const p = { number: 12, url: 'u12', head: 'feat/a', base: 'main', merged: false }
  const s = stackedPrompt({ ticket: 'AI-12', title: 't', url: 'u', text: 'add export', pr: p })
  assert.match(s, /branch off feat\/a, and open the PR with base feat\/a/)
  assert.match(s, /Never commit to or push feat\/a/)
  assert.match(stackedPrompt({ ticket: 'AI-12', title: 't', url: 'u', text: 'x', pr: { ...p, merged: true } }), /merged: branch off the up-to-date main/)
})
