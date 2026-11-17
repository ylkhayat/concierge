// The desk: your work as units you take one at a time — a stack of PRs (bottom to top), a ticket with its PRs, or a
// single PR — instead of one list sorted by status, where a stack's PRs sit in different groups. Pure, so it is
// tested on its own (desk.test.ts); the list's own rules (what waits on you, a ticket's bucket) come in as `rules`.
import type { PrView, TicketView } from '../server/index.ts'

export type Unit = {
  key: string // stack:<repo>#<bottom>, ticket:<id>, pr:<id>
  kind: 'stack' | 'ticket' | 'pr'
  title: string
  members: PrView[] // the PRs you work through, bottom to top
  ticket?: TicketView
  needs: number // members (and the ticket) waiting on you
  working: number // agents at work on it
  fresh: PrView[] // members no agent has looked at yet: queued on the desk, bottom up
  firstAt: string // since when it waits: its oldest member
}
export type Rules = { waiting: (p: PrView) => boolean; ticketGroup: (t: TicketView) => string }

const busy = (p: PrView) => p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'
const pos = (p: PrView) => (p.stack ? p.stack.findIndex((s) => s.number === p.number) : 0)
const ASKS = ['needs-you', 'tend']

/** Your open work as units, the one to do first first: waiting on you, then agents at work, then not started. */
export function units(prs: PrView[], tickets: TicketView[], rules: Rules): Unit[] {
  const open = prs.filter((p) => !p.closed)
  const byId = new Map(open.map((p) => [p.id, p]))
  const stackOf = (p: PrView) => (p.stack ? `${p.repo}#${p.stack[0].number}` : undefined)
  const claimed = new Set<string>() // PRs a ticket unit holds
  const out: Unit[] = []
  const unit = (key: string, kind: Unit['kind'], title: string, members: PrView[], ticket?: TicketView): Unit => {
    members = [...members].sort((a, b) => pos(a) - pos(b) || a.number - b.number)
    const tAsks = ticket && ASKS.includes(rules.ticketGroup(ticket)) ? 1 : 0
    return {
      key, kind, title, members, ticket,
      needs: members.filter(rules.waiting).length + tAsks,
      working: members.filter(busy).length + (ticket?.busy ? 1 : 0),
      fresh: members.filter((p) => p.flow.next === 'run' && !p.job && !p.missing.length),
      firstAt: [...members.map((p) => p.firstSeenAt), ticket?.updatedAt].filter((x): x is string => !!x).sort()[0] ?? '',
    }
  }
  // a ticket and its PRs (whole stacks: a stack belongs with the ticket that holds any of it)
  for (const t of tickets) {
    const mine = t.prs.map((x) => byId.get(`${x.repo}#${x.number}`)).filter((p): p is PrView => !!p)
    const stacks = new Set(mine.map(stackOf).filter(Boolean))
    const members = open.filter((p) => mine.includes(p) || (stackOf(p) && stacks.has(stackOf(p))))
    if (!members.length && !t.busy && !ASKS.includes(rules.ticketGroup(t))) continue
    members.forEach((p) => claimed.add(p.id))
    out.push(unit(`ticket:${t.id}`, 'ticket', `${t.id} ${t.title}`, members, t))
  }
  const stacks = new Map<string, PrView[]>()
  for (const p of open) {
    if (claimed.has(p.id)) continue
    const k = stackOf(p)
    if (k) stacks.set(k, [...(stacks.get(k) ?? []), p])
    else out.push(unit(`pr:${p.id}`, 'pr', p.title, [p]))
  }
  for (const [k, members] of stacks) {
    const bottom = [...members].sort((a, b) => pos(a) - pos(b))[0]
    out.push(unit(`stack:${k}`, 'stack', bottom.stack![0].title, members))
  }
  const rank = (u: Unit) => (u.needs ? 0 : u.working ? 1 : u.fresh.length ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b) || a.firstAt.localeCompare(b.firstAt))
}

/** Nothing left to do on it: nothing waits on you, no agent works on it, nothing new to start. */
export const finished = (u: Unit) => !u.needs && !u.working && !u.fresh.length

/** Where to stand in a unit: the lowest PR waiting on you, else the ticket asking, else the lowest one at work. */
export function current(u: Unit, rules: Rules): string {
  const first = (f: (p: PrView) => boolean) => u.members.find(f)?.id
  const tAsks = u.ticket && ASKS.includes(rules.ticketGroup(u.ticket))
  return first(rules.waiting) ?? (tAsks ? u.ticket!.id : undefined) ?? first(busy) ?? (u.ticket?.busy ? u.ticket.id : undefined)
    ?? first((p) => u.fresh.includes(p)) ?? u.members[0]?.id ?? u.ticket!.id
}

/**
 * The unit an open PR or ticket belongs to. Stacked tickets share PRs, so one PR can sit in several units: the one you
 * opened (`prefer`, its key) wins while it holds the PR, else the first.
 */
export function unitOf(all: Unit[], id: string, prefer?: string) {
  const holds = (u: Unit) => u.ticket?.id === id || u.members.some((p) => p.id === id)
  return all.find((u) => u.key === prefer && holds(u)) ?? all.find(holds)
}

/** A stack as it is now, found from any of its PRs (so a link to it survives restacking). A PR in no stack is a stack of one. */
export type StackView = { key: string; all: { repo: string; number: number; title?: string }[]; members: PrView[]; tickets: TicketView[] }
export function stackAt(prs: PrView[], tickets: TicketView[], id: string): StackView | undefined {
  const p = prs.find((x) => x.id === id)
  if (!p) return undefined
  const all = p.stack?.length ? p.stack.map((s) => ({ repo: p.repo, number: s.number, title: s.title })) : [{ repo: p.repo, number: p.number, title: p.title }]
  const members = all.map((s) => prs.find((x) => x.repo === s.repo && x.number === s.number && !x.closed)).filter((x): x is PrView => !!x)
  const has = new Set(members.map((m) => `${m.repo}#${m.number}`))
  return { key: `stack:${members[0]?.id ?? p.id}`, all, members, tickets: tickets.filter((t) => t.prs.some((x) => has.has(`${x.repo}#${x.number}`))) }
}
