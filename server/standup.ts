// Standup, in Linear tickets only: what I did on each ticket since my last working day, said the way you'd say it,
// and what I'll do next. A PR counts under the ticket its title names; a PR that names none is left out. Built from
// what Concierge already keeps (the event log, the PRs, the tickets and their runs): nothing is asked of GitHub or
// Linear.
import type { RunEvent } from './lifecycle.ts'
import type { Bucket, Ticket } from './linear.ts'
import type { ExecRun, Pr } from './store.ts'

/** A ticket I worked on, said as one line: `lead` (what happened) then the ticket and its title. */
export type Did = { id: string; title: string; url?: string; lead: string; project?: string; review?: true } // review: only reviewing someone else's PR
/** Something to do next, on a ticket. `count`: open review comments, for `threads`. */
export type Next = { kind: NextKind; id: string; title: string; url?: string; count?: number; project?: string }
/** Something holding a ticket up, said as the reason: an answer owed, CI red, a review not given yet. */
export type Blocker = { id: string; title: string; url?: string; why: string; kind: 'answer' | 'ci' | 'review'; project?: string }
/** Your own lines for a day's standup, per part: what only you know (a call, a wait on design, a plan). */
export type Notes = { did?: string[]; blockers?: string[]; next?: string[] }
export type Standup = { since: string; did: Did[]; blockers: Blocker[]; next: Next[]; text: string }
type NextKind = 'answer' | 'threads' | 'tend' | 'continue' | 'pickup' | 'start' | 'review'
type TicketLike = Pick<Ticket, 'id' | 'title' | 'url' | 'project'> & { priority?: number; closed?: boolean } & { bucket: Bucket; prs: { repo: string; number: number; merged?: boolean }[]; pr?: { number: number; ci?: string; merged?: boolean } }

// --- days, as YYYY-MM-DD in your time zone: which standup comes next, and where it counts from
/** The day it is in a time zone. */
export const localDay = (now: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** The standup to prepare: today on a weekday; on a Saturday or Sunday, Monday's. */
export const standupDay = (now: Date, tz: string) => { const d = localDay(now, tz), w = weekday(d); return w === 6 ? addDays(d, 2) : w === 0 ? addDays(d, 1) : d }
/** The working day before a day: what its standup counts from (Friday, for a Monday). */
export const workdayBefore = (day: string) => { let d = addDays(day, -1); while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1); return d }
/** Midnight of a day in a time zone, as an instant. */
export function startOf(day: string, tz: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`)
  // the zone's offset at that moment: its wall clock read as if it were UTC, minus the moment itself
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(guess)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]))
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return new Date(guess - (wall - guess))
}

/** Midnight (local) of the last working day before `now`: yesterday, or Friday from a Saturday, Sunday or Monday. */
export function lastWorkday(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6)
  return d
}

const TICKET = /\b[A-Z]{2,5}-\d+\b/
const ticketOf = (p: Pr) => TICKET.exec(p.title)?.[0]
/** A PR title as a plain sentence: without its conventional-commit prefix or ticket id, first letter up. */
const plain = (t: string) => {
  const x = t.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(new RegExp(`^${TICKET.source}\\s+`), '')
  return x.charAt(0).toUpperCase() + x.slice(1)
}
/** "AI-1", "AI-1 and AI-2", "AI-1, AI-2 and AI-3" */
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

// what an agent run on the ticket came to, in my words
const OUTCOME: Record<string, string> = { shipped: 'Shipped', refined: 'Asked a question to settle the approach on', failed: 'Hit a wall on' }
// what comes next, in the order it gets said: what waits on me first, then my tickets in pick order, then reviews
const NEXT_ORDER: NextKind[] = ['answer', 'threads', 'tend', 'continue', 'pickup', 'start', 'review']
// (Todo tickets stay out: the plan is what is already moving; a stalled one is a question of whether it still matters)
const BUCKET_NEXT: Partial<Record<Bucket, NextKind>> = { 'needs-you': 'answer', tend: 'tend', 'in-progress': 'continue', stalled: 'pickup' }

export function standup(o: { since: Date; runs: RunEvent[]; prs: Record<string, Pr>; tickets: TicketLike[]; execs: Record<string, ExecRun> }): Standup {
  const since = o.since.toISOString()
  const ended = o.runs.filter((r) => r.at >= since && r.to === 'done').sort((a, b) => a.at.localeCompare(b.at))
  const all = Object.values(o.prs)
  const ticket = (id: string) => o.tickets.find((t) => t.id === id)
  // a ticket that left my open list (done, someone else's) is named by the first PR that carries its id
  // (without leading tags like "[agent]": they read badly out loud)
  // every ticket gets its Linear link: its own, or one made from the workspace's address (linear.app/<org>/issue/<id>)
  const org = o.tickets.map((t) => /linear\.app\/([^/]+)\//.exec(t.url)?.[1]).find(Boolean)
  const urlOf = (id: string) => ticket(id)?.url ?? (org ? `https://linear.app/${org}/issue/${id}` : undefined)
  const titleOf = (id: string) => (ticket(id)?.title ?? plain(all.find((p) => ticketOf(p) === id)?.title ?? '')).replace(/^(\[[^\]]*\]\s*)+/, '')

  // --- what I did: per ticket, what happened to its PRs, counted
  type Tally = { outcome?: string; opened: Set<string>; revised: Set<string>; replied: Set<string>; merged: Set<string>; closed: Set<string>; approved: Set<string>; reviewed: Set<string>; approvedTheirs: Set<string> }
  const tallies = new Map<string, Tally>()
  const tally = (id: string) => {
    if (!tallies.has(id)) tallies.set(id, { opened: new Set(), revised: new Set(), replied: new Set(), merged: new Set(), closed: new Set(), approved: new Set(), reviewed: new Set(), approvedTheirs: new Set() })
    return tallies.get(id)!
  }
  for (const r of ended.filter((r) => r.entity === 'exec')) {
    const run = o.execs[r.run]
    for (const id of run?.ids ?? r.id.split(' → ')) { const t = tally(id); t.outcome = run?.outcomes[id]?.outcome ?? t.outcome ?? 'worked' }
  }
  for (const p of all) {
    const id = ticketOf(p)
    if (!id || !p.mine) continue
    if (p.createdAt >= since) tally(id).opened.add(p.id)
    // merged when its ticket says so, or when it closed approved (a ticket that left my list can't say)
    const merged = p.reviewDecision === 'APPROVED' || o.tickets.some((t) => t.prs.some((x) => x.repo === p.repo && x.number === p.number && x.merged))
    if (p.closed && p.updatedAt >= since) tally(id)[merged ? 'merged' : 'closed'].add(p.id)
    if (p.reviewDecision === 'APPROVED' && p.updatedAt >= since) tally(id).approved.add(p.id)
  }
  for (const r of ended.filter((r) => r.entity === 'job')) {
    const p = o.prs[r.id], id = p && ticketOf(p)
    if (!id) continue
    if (p.mine && (r.kind === 'revise' || r.kind === 'publish')) tally(id).revised.add(p.id)
    if (p.mine && r.kind === 'reply') tally(id).replied.add(p.id)
    if (!p.mine && (r.kind === 'review' || r.kind === 'post')) tally(id).reviewed.add(p.id)
    if (!p.mine && r.kind === 'approve') tally(id).approvedTheirs.add(p.id)
  }
  // one line per ticket, led by what happened: the one thing that did, or "Progress on" when several did
  const did: Did[] = [...tallies].map(([id, t]) => {
    const replied = [...t.replied].filter((x) => !t.revised.has(x)) // a revised PR has had its comments answered already
    const kinds = {
      outcome: t.outcome && t.outcome !== 'worked', opened: t.opened.size > 0, feedback: t.revised.size + replied.length > 0, approved: t.approved.size > 0,
      merged: t.merged.size > 0, closed: t.closed.size > 0, reviewed: t.reviewed.size + t.approvedTheirs.size > 0,
    }
    const only = (k: keyof typeof kinds) => kinds[k] && Object.entries(kinds).every(([x, on]) => x === k || !on)
    const lead = kinds.merged ? 'Merged'
      : only('reviewed') ? (t.approvedTheirs.size ? 'Approved' : 'Reviewed')
      : only('opened') ? (t.opened.size === 1 ? 'Opened a pull request for' : 'Opened pull requests for')
      : only('feedback') ? 'Worked in the review feedback on'
      : only('approved') ? 'Got approval on'
      : only('closed') ? 'Closed the pull request for'
      : only('outcome') ? OUTCOME[t.outcome!]
      : 'Progress on'
    return { id, title: titleOf(id), url: urlOf(id), lead, ...(only('reviewed') && { review: true as const }), ...(ticket(id)?.project && { project: ticket(id)!.project }) }
  })

  // --- what I'll do: each ticket once, under the most pressing thing it needs
  const next = new Map<string, Next>()
  const want = (kind: NextKind, id: string, count?: number) => {
    const had = next.get(id)
    if (!had || NEXT_ORDER.indexOf(kind) < NEXT_ORDER.indexOf(had.kind)) next.set(id, { kind, id, title: titleOf(id), url: urlOf(id), count, ...(ticket(id)?.project && { project: ticket(id)!.project }) })
  }
  const open = all.filter((p) => !p.closed && !p.dismissed)
  for (const p of open.filter((p) => p.mine && (p.unresolved ?? 0) > 0)) { const id = ticketOf(p); if (id) want('threads', id, (next.get(id)?.count ?? 0) + p.unresolved!) }
  // ponytail: tickets to pick back up or start are the top 3 by Linear priority, so the plan stays a plan; a setting if 3 is wrong
  const byPriority = (a: TicketLike, b: TicketLike) => (a.priority || 9) - (b.priority || 9)
  for (const t of [...o.tickets].sort(byPriority)) {
    const k = BUCKET_NEXT[t.bucket]
    if (k && !((k === 'pickup' || k === 'start') && [...next.values()].filter((x) => x.kind === k).length >= 3)) want(k, t.id)
  }
  for (const p of open.filter((p) => !p.mine && p.requested && !p.job?.reviewDone)) { const id = ticketOf(p); if (id) want('review', id) }
  const n = [...next.values()].sort((a, b) => NEXT_ORDER.indexOf(a.kind) - NEXT_ORDER.indexOf(b.kind))

  // --- what holds my tickets up now, one reason each, the one that matters most
  const blockers: Blocker[] = []
  for (const t of [...o.tickets].sort(byPriority)) {
    if (t.closed) continue
    const why: [Blocker['kind'], string] | undefined = t.bucket === 'needs-you' ? ['answer', 'Waiting on my answer: the agent asked a question']
      : t.pr?.ci === 'failure' ? ['ci', `CI is red on #${t.pr.number}`]
      : t.bucket === 'shipped' && t.pr && !t.pr.merged ? ['review', `Waiting for review on #${t.pr.number}`] : undefined
    if (why) blockers.push({ id: t.id, title: titleOf(t.id), url: urlOf(t.id), kind: why[0], why: why[1], ...(t.project && { project: t.project }) })
  }
  const order: Blocker['kind'][] = ['answer', 'ci', 'review']
  blockers.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))

  return { since, did, blockers, next: n, text: asText(did, n, blockers) }
}

/** Only these teams' tickets (a team is the id's prefix: AC-1173 is AI's); none picked is every team. */
export const forTeams = <T extends { id: string }>(xs: T[], teams: string[]) => (teams.length ? xs.filter((x) => teams.includes(x.id.split('-')[0])) : xs)

/** The next steps as sentences, tickets that need the same thing said together: "Start on AI-1 and AI-2". */
export function nextLines(next: Next[]): { kind: NextKind; ids: string[]; urls: (string | undefined)[]; text: (ids: string) => string }[] {
  const say: Record<NextKind, (ids: string, n: Next[]) => string> = {
    answer: (ids) => `Answer the open question on ${ids}`,
    threads: (ids, n) => `Work through the review comments on ${ids} (${n.reduce((s, x) => s + (x.count ?? 0), 0)} open)`,
    tend: (ids) => `Get ${ids} through review`,
    continue: (ids) => `Continue the remaining work on ${ids}`,
    pickup: (ids) => `Investigate closing of ${ids}`,
    start: (ids) => `Start on ${ids}`,
    review: (ids) => `Review ${ids}`,
  }
  return NEXT_ORDER.map((kind) => ({ kind, items: next.filter((x) => x.kind === kind) })).filter((g) => g.items.length)
    .map(({ kind, items }) => ({ kind, ids: items.map((x) => x.id), urls: items.map((x) => x.url), text: (ids: string) => say[kind](ids, items) }))
}

/** Product work (a ticket in a Linear project) and side quests (none): said apart, product first. */
export const halves = <T extends { project?: string }>(xs: T[]) => ({ product: xs.filter((x) => x.project), side: xs.filter((x) => !x.project) })

/**
 * One section's lines, product work first then side quests, each under its own small heading when both have some
 * (a standup that is all one kind needs no headings).
 */
function split<T extends { project?: string }>(xs: T[], lines: (xs: T[]) => string[], head: (h: string) => string, none: string): string[] {
  const { product, side } = halves(xs)
  if (!xs.length) return [none]
  if (!product.length || !side.length) return lines(xs)
  return [head('Product'), ...lines(product), head('Side quests'), ...lines(side)]
}

/** The message to paste, as plain text: one short bullet each (what happened, then the ticket), every ticket id a Markdown link to Linear. */
export function asText(did: Did[], next: Next[], blockers: Blocker[] = [], notes: Notes = {}) {
  const link = (id: string, url?: string) => (url ? `[${id}](${url})` : id)
  const mine = (xs?: string[]) => (xs ?? []).map((x) => `- ${x}`)
  const part = (lines: string[], extra: string[] | undefined, none: string) => (lines.length || extra?.length ? [...lines, ...mine(extra)] : [`- ${none}`])
  return [
    'What I did:',
    ...part(did.length ? split(did, (xs) => xs.map((d) => `- ${d.lead} ${link(d.id, d.url)}`), (h) => `${h}:`, '') : [], notes.did, 'Nothing on my tickets'),
    '',
    'Blockers:',
    ...part(blockers.map((b) => `- ${b.why} (${link(b.id, b.url)})`), notes.blockers, 'None'),
    '',
    'What I will do:',
    ...part(next.length ? split(next, (xs) => nextLines(xs).map((l) => `- ${l.text(list(l.ids.map((id, i) => link(id, l.urls[i]))))}`), (h) => `${h}:`, '') : [], notes.next, 'Nothing waiting on me'),
  ].join('\n')
}

/** The same message as HTML, for pasting where links show as links (Slack, Linear, Docs). */
export function asHtml(did: Did[], next: Next[], blockers: Blocker[] = [], notes: Notes = {}) {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const link = (id: string, url?: string) => (url ? `<a href="${esc(url)}">${esc(id)}</a>` : esc(id))
  const ul = (xs: string[]) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`
  const section = <T extends { project?: string }>(title: string, xs: T[], items: (xs: T[]) => string[], none: string, extra: string[] = []) => {
    const { product, side } = halves(xs)
    const own = extra.map(esc)
    const body = !xs.length ? ul(own.length ? own : [none]) : product.length && side.length
      ? `<p><i>Product</i></p>${ul(items(product))}<p><i>Side quests</i></p>${ul([...items(side), ...own])}` : ul([...items(xs), ...own])
    return `<p>${title}</p>${body}`
  }
  return [
    section('What I did:', did, (xs) => xs.map((d) => `${esc(d.lead)} ${link(d.id, d.url)}`), 'Nothing on my tickets', notes.did),
    section('Blockers:', blockers, (xs) => xs.map((b) => `${esc(b.why)} (${link(b.id, b.url)})`), 'None', notes.blockers),
    // the sentence around a placeholder, so the ids go in as links
    section('What I will do:', next, (xs) => nextLines(xs).map((l) => l.text('\u0000').split('\u0000').map(esc).join(list(l.ids.map((id, i) => link(id, l.urls[i]))))), 'Nothing waiting on me', notes.next),
  ].join('')
}

// --- the written standup: the model words the facts, once at 07:00 on weekdays or when asked, and each version is
// stored with a fingerprint of the facts it was written from, so the page can say when they moved on since

/** A fingerprint of the facts, so a written version knows whether it still says what the facts say. */
export const factsKey = (did: Did[], next: Next[], blockers: Blocker[] = [], notes: Notes = {}) => JSON.stringify({ did: did.map((d) => [d.id, d.lead]), next: next.map((n) => [n.kind, n.id, n.count ?? 0]), blockers: blockers.map((b) => [b.kind, b.id]), notes })

/** What the model gets: the facts, in order, with each ticket's title and project (none: a side quest). */
export function writeInput(did: Did[], next: Next[], blockers: Blocker[] = [], notes: Notes = {}) {
  return JSON.stringify({
    did: did.map((d) => ({ id: d.id, title: d.title, happened: d.lead, project: d.project ?? null })),
    blockers: blockers.map((b) => ({ id: b.id, title: b.title, why: b.why, project: b.project ?? null })),
    myOwnLines: notes, // what the person added themselves, per part: say them as they wrote them
    next: nextLines(next).map((l) => ({ say: l.text(list(l.ids)), tickets: l.ids.map((id) => { const n = next.find((x) => x.id === id); return { id, title: n?.title ?? '', project: n?.project ?? null } }) })),
  }, null, 1)
}


/** The written text with each ticket id a link: Markdown for plain text, and HTML (lists) for pasting as rich text. */
export function linkWritten(text: string, urls: Record<string, string | undefined>) {
  const md = text.replace(new RegExp(TICKET.source, 'g'), (id) => (urls[id] ? `[${id}](${urls[id]})` : id))
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const linked = (x: string) => esc(x).replace(new RegExp(TICKET.source, 'g'), (id) => (urls[id] ? `<a href="${esc(urls[id]!)}">${id}</a>` : id))
  const html: string[] = []
  let open = false
  for (const line of text.split('\n')) {
    const item = /^\s*[-•]\s+(.*)$/.exec(line)
    if (item) { if (!open) { html.push('<ul>'); open = true } html.push(`<li>${linked(item[1])}</li>`); continue }
    if (open) { html.push('</ul>'); open = false }
    if (line.trim()) html.push(`<p>${linked(line.trim())}</p>`)
  }
  if (open) html.push('</ul>')
  return { md, html: html.join('') }
}
