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

test('a stack is found from any of its PRs, as it is now; a PR in no stack is a stack of one', async () => {
  const { stackAt } = await import('./desk.ts')
  const pr = (number: number, stack?: number[], closed = false) => ({ id: `o/r#${number}`, repo: 'o/r', number, title: `t${number}`, closed, stack: stack?.map((n) => ({ repo: 'o/r', number: n, title: `t${n}` })) }) as never
  const prs = [pr(1, [1, 2, 3]), pr(2, [1, 2, 3]), pr(9)] // #3 isn't tracked here
  const tickets = [{ id: 'T-1', prs: [{ repo: 'o/r', number: 2 }] }, { id: 'T-2', prs: [{ repo: 'o/r', number: 9 }] }] as never
  const s = stackAt(prs, tickets, 'o/r#2')!
  assert.deepEqual([s.key, s.all.map((x) => x.number), s.members.map((m) => m.number), s.tickets.map((t) => t.id)], ['stack:o/r#1', [1, 2, 3], [1, 2], ['T-1']])
  assert.equal(stackAt(prs, tickets, 'o/r#1')!.key, s.key) // any member finds the same stack
  const one = stackAt(prs, tickets, 'o/r#9')!
  assert.deepEqual([one.all.length, one.members.length, one.tickets.map((t) => t.id)], [1, 1, ['T-2']])
  assert.equal(stackAt(prs, tickets, 'o/r#404'), undefined)
})

test('a stack is found from a ticket too: the tickets that ship together, with whatever PRs they have so far', async () => {
  const { stackAt } = await import('./desk.ts')
  const pr = (number: number, stack?: number[]) => ({ id: `o/r#${number}`, repo: 'o/r', number, title: `t${number}`, closed: false, stack: stack?.map((n) => ({ repo: 'o/r', number: n, title: `t${n}` })) }) as never
  const t = (id: string, ids: string[], prs: number[] = []) => ({ id, title: `title ${id}`, repo: 'o/r', stack: { ids }, prs: prs.map((number) => ({ repo: 'o/r', number })) })
  const tickets = [t('A-1', ['A-1', 'A-2']), t('A-2', ['A-1', 'A-2']), t('B-1', ['B-1', 'B-2'], [1]), t('B-2', ['B-1', 'B-2'])] as never
  const none = stackAt([pr(1, [1, 2]), pr(2, [1, 2])], tickets, 'ticket:A-2')!
  assert.deepEqual([none.key, none.members.length, none.tickets.map((x) => x.id), none.title], ['stack:ticket:A-1', 0, ['A-1', 'A-2'], 'title A-1']) // no PR yet: the tickets alone
  const some = stackAt([pr(1, [1, 2]), pr(2, [1, 2])], tickets, 'ticket:B-2')!
  assert.deepEqual([some.key, some.members.map((m) => m.number), some.tickets.map((x) => x.id)], ['stack:o/r#1', [1, 2], ['B-1', 'B-2']]) // the same stack as from its PRs
  assert.deepEqual(stackAt([pr(1, [1, 2]), pr(2, [1, 2])], tickets, 'o/r#2')!.tickets.map((x) => x.id), ['B-1', 'B-2']) // B-2 has no PR yet and still belongs
})

test('PRs built on the same one are one stack: found from any of them, read so nothing comes before what it is built on', async () => {
  const { stackAt, treeOf } = await import('./desk.ts')
  const ref = (n: number, head: string, base: string) => ({ repo: 'o/r', number: n, title: `t${n}`, head, base })
  const R = { 1: ref(1, 'a', 'main'), 2: ref(2, 'b', 'a'), 3: ref(3, 'c', 'a'), 5: ref(5, 'e', 'b') }
  const pr = (n: keyof typeof R, line: (keyof typeof R)[]) => ({ id: `o/r#${n}`, repo: 'o/r', number: n, title: `t${n}`, head: R[n].head, base: R[n].base, closed: false, stack: line.map((x) => R[x]) }) as never
  // #1 with #2 → #5 on it, and #3 straight on #1: each PR carries its own line
  const prs = [pr(3, [1, 3]), pr(5, [1, 2, 5]), pr(1, [1, 2, 5]), pr(2, [1, 2, 5])]
  assert.deepEqual(treeOf(prs).map((x) => [x.number, x.depth]), [[1, 0], [2, 1], [5, 2], [3, 1]])
  const fromSide = stackAt(prs, [] as never, 'o/r#3')!, fromTop = stackAt(prs, [] as never, 'o/r#5')!
  assert.deepEqual(fromSide.members.map((m) => m.number), [1, 2, 5, 3])
  assert.deepEqual([fromTop.key, fromTop.members.map((m) => m.number)], [fromSide.key, [1, 2, 5, 3]]) // the same stack from either branch
})
