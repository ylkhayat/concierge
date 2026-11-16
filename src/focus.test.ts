import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cards } from './focus.ts'
import type { Rules } from './desk.ts'
import type { PrView, TicketView } from '../server/index.ts'

const rules: Rules = { waiting: (p) => p.status === 'ready', ticketGroup: (t) => (t.title.includes('?') ? 'needs-you' : 'todo') }
const pr = (n: number, status: string, flow: Partial<PrView['flow']> = {}, o: Partial<PrView> = {}) =>
  ({ id: `o/app#${n}`, number: n, status, closed: false, firstSeenAt: `2026-10-0${n}`, flow: { state: 'reviewed', ...flow }, ...o }) as unknown as PrView
const ticket = (id: string, title: string) => ({ id, title, busy: false }) as unknown as TicketView

test('an agent waiting on you comes first, then what waits on you, a ticket asking, then other steps', () => {
  const list = cards([pr(3, 'ready'), pr(1, 'reviewed', { next: 'merge' }), pr(2, 'reviewed', { state: 'asks' }), pr(4, 'ready')], [ticket('ENG-1', 'Which API?')], rules)
  assert.deepEqual(list.map((c) => c.key), ['o/app#2', 'o/app#3', 'o/app#4', 'ENG-1', 'o/app#1'])
  assert.equal(list[0].kind === 'pr' && list[0].asks, true)
})

test('never a PR an agent works on, a closed one, or one whose only step is starting a run', () => {
  const list = cards([pr(1, 'preparing', { state: 'asks' }), pr(2, 'ready', {}, { closed: true }), pr(3, 'new', { next: 'run' })], [], rules)
  assert.deepEqual(list, [])
})

test('the ones you put off go last, in the order you put them off', () => {
  const list = cards([pr(1, 'ready'), pr(2, 'ready'), pr(3, 'ready')], [], rules, ['o/app#2', 'o/app#1'])
  assert.deepEqual(list.map((c) => c.key), ['o/app#3', 'o/app#2', 'o/app#1'])
})
