// Focus, the phone's home: what needs you, one card at a time. Pure, so it is tested on its own (focus.test.ts);
// the list's own rules (what waits on you, a ticket's bucket) come in as `rules`.
import type { PrView, TicketView } from '../server/index.ts'
import type { Rules } from './desk.ts'

export type Card = { key: string; kind: 'pr'; pr: PrView; asks: boolean } | { key: string; kind: 'ticket'; ticket: TicketView }

const busy = (p: PrView) => p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'
// a step you can take from a phone: the rest (crit, a restart, a tool run's retry) opens the PR
const ACT = new Set(['post', 'publish', 'fix', 'run', 'merge', 'rerequest', 'retry', 'finalize', 'crit'])

/**
 * The cards, the one to do first first: an agent waiting on your answer, then PRs waiting on you, then a ticket
 * asking, then anything else with a step you can take. Never a PR an agent works on (nothing to do yet). `later`:
 * the ones you put off this session, last, in the order you put them off.
 */
export function cards(prs: PrView[], tickets: TicketView[], rules: Rules, later: string[] = []): Card[] {
  const open = prs.filter((p) => !p.closed && !busy(p))
  const asks = open.filter((p) => p.flow.state === 'asks')
  const waiting = open.filter((p) => !asks.includes(p) && rules.waiting(p))
  const rest = open.filter((p) => !asks.includes(p) && !waiting.includes(p) && p.flow.next && ACT.has(p.flow.next) && p.flow.next !== 'run')
  const byAge = (a: PrView, b: PrView) => a.firstSeenAt.localeCompare(b.firstSeenAt)
  const all: Card[] = [
    ...asks.sort(byAge).map((pr) => ({ key: pr.id, kind: 'pr' as const, pr, asks: true })),
    ...waiting.sort(byAge).map((pr) => ({ key: pr.id, kind: 'pr' as const, pr, asks: false })),
    ...tickets.filter((t) => !t.busy && rules.ticketGroup(t) === 'needs-you').map((ticket) => ({ key: ticket.id, kind: 'ticket' as const, ticket })),
    ...rest.sort(byAge).map((pr) => ({ key: pr.id, kind: 'pr' as const, pr, asks: false })),
  ]
  const put = all.filter((c) => !later.includes(c.key))
  return [...put, ...later.map((k) => all.find((c) => c.key === k)).filter((c): c is Card => !!c)]
}
