import assert from 'node:assert/strict'
import { test } from 'node:test'
import { current, finished, unitOf, units, type Rules } from './desk.ts'
import type { PrView, TicketView } from '../server/index.ts'

const rules: Rules = { waiting: (p) => p.status === 'ready', ticketGroup: (t) => (t.busy ? 'running' : t.title.includes('?') ? 'needs-you' : 'todo') }
const ref = (n: number) => ({ repo: 'o/app', number: n, title: `PR ${n}`, url: '', head: `h${n}`, base: `h${n - 1}`, author: 'me', draft: false })
const pr = (n: number, status: string, o: Partial<PrView> = {}) => ({
  id: `o/app#${n}`, repo: 'o/app', number: n, title: `PR ${n}`, status, closed: false, missing: [], firstSeenAt: `2026-10-0${n % 9}`,
  flow: { next: status === 'new' ? 'run' : undefined }, job: status === 'new' ? undefined : { state: 'done' }, ...o,
}) as unknown as PrView
const ticket = (id: string, title: string, prs: number[], busy = false) => ({ id, title, prs: prs.map((n) => ({ repo: 'o/app', number: n, url: '' })), busy, updatedAt: '2026-10-01' }) as unknown as TicketView

test('a stack is one unit, bottom to top, whatever stage each PR is at', () => {
  const stack = [ref(3), ref(4), ref(5)]
  const all = units([pr(5, 'new', { stack }), pr(3, 'reviewed', { stack }), pr(4, 'ready', { stack }), pr(9, 'new')], [], rules)
  assert.deepEqual(all.map((u) => u.key), ['stack:o/app#3', 'pr:o/app#9']) // waits on you first
  const [s] = all
  assert.deepEqual(s.members.map((p) => p.number), [3, 4, 5])
  assert.equal(s.needs, 1)
  assert.deepEqual(s.fresh.map((p) => p.number), [5]) // what the desk queues, bottom up
  assert.equal(current(s, rules), 'o/app#4')
})

test('a ticket takes its PRs, and the whole stack any of them sits in', () => {
  const stack = [ref(3), ref(4)]
  const all = units([pr(3, 'reviewed', { stack }), pr(4, 'reviewed', { stack }), pr(7, 'reviewed')], [ticket('ENG-1', 'Sync', [4]), ticket('ENG-2', 'Idle', [])], rules)
  assert.deepEqual(all.map((u) => u.key).sort(), ['pr:o/app#7', 'ticket:ENG-1']) // ENG-2: nothing open, not asking
  const t = unitOf(all, 'o/app#3')!
  assert.equal(t.key, 'ticket:ENG-1')
  assert.ok(finished(t))
})

test('a ticket that asks is where you stand before the agents at work', () => {
  const [u] = units([pr(4, 'preparing')], [ticket('ENG-3', 'Which API?', [4])], rules)
  assert.equal(u.needs, 1)
  assert.equal(current(u, rules), 'ENG-3')
})

test('closed PRs are not on the desk', () => {
  assert.deepEqual(units([pr(1, 'ready', { closed: true } as Partial<PrView>)], [], rules), [])
})

test('two tickets on one stack: the one you opened keeps a PR they share', () => {
  const stack = [ref(3), ref(4)]
  const all = units([pr(3, 'reviewed', { stack }), pr(4, 'reviewed', { stack })], [ticket('ENG-1', 'Base', [3]), ticket('ENG-5', 'Top', [4])], rules)
  const keys = all.filter((u) => u.members.some((p) => p.id === 'o/app#4')).map((u) => u.key)
  assert.ok(keys.length === 2, `both hold #4: ${keys}`)
  assert.equal(unitOf(all, 'o/app#4', keys[1])?.key, keys[1])
  assert.equal(unitOf(all, 'o/app#4', 'pr:o/app#9')?.key, keys[0]) // a preferred unit that lacks it: the first
})
