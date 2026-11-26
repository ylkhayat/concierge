// A ticket hands over to its PRs. Once its run has produced them, the PR's own agent works on from there (reviews,
// fixes, replies) and the ticket's last next steps go stale: they were written before any of that. So from then on
// the PR side owns the next steps, the ticket shows whose they are and what that agent asks, and the steps the ticket
// had left open go to that agent once (with the next word it gets), not lost. New words on the ticket are routed:
// into that PR, through its agent, or into a new PR stacked on it, when they are another piece of work or the PR
// shouldn't grow any more.
import type { Step } from './reply.ts'
import { stepHash } from './next.ts'

export type PrRef = { repo: string; number: number }
/** A ticket that handed over to its PRs (state.handed, by ticket id). */
export type TicketHandover = {
  to: PrRef[] // the PRs that own its next steps now, bottom of the stack first
  at: string
  run: string // the ticket's run whose next steps went stale then
  why: 'opened' | 'pr-agent' | 'has-pr' // its run ended with the PR open, the PR's agent ran after it, or it simply has PRs (no run of its own, or one that ended without naming them)
  carry?: string[] // the ticket's steps left open then, for the PR's agent
  carriedAt?: string // when they went to it (once)
}

type RunIn = { id: string; state: string; queuedAt: string; endedAt?: string; prs: PrRef[]; role?: string; outcome?: string }
export type PrIn = PrRef & { open: boolean; agentAt?: string } // agentAt: when its PR-side agent was last started
const busy = (s: string) => s === 'queued' || s === 'running'
const same = (a: PrRef, b: PrRef) => a.repo === b.repo && a.number === b.number

/** The handover in force for a ticket whose latest run is `run`: none once a newer run took the ticket up again. */
export function activeHandover(was: TicketHandover | undefined, run: Pick<RunIn, 'id' | 'queuedAt' | 'state'> | undefined) {
  if (!was) return undefined
  if (!run || run.id === was.run) return was
  // a run started since (a new stacked PR, an action you ran): its own words are fresh, until it hands over in turn
  return run.queuedAt <= was.at && !busy(run.state) ? was : undefined
}

/**
 * Whether the ticket hands over now, and to which PRs. The rule, on the ticket's latest run and its PRs:
 * - never while that run is queued or running, nor for a batch's prep (it opens no PR), nor with no PR at all;
 * - (opened) the run ended done having opened or named its PR (or said shipped), unless its last words hold a
 *   blocking decision: that is the ticket's to answer first, and the reply run it starts is judged in turn;
 * - (pr-agent) any of its PRs had its own agent started after the run ended: a review, a fix, your words on the PR.
 *   From then on whatever the ticket said is older than what the PR's agent knows.
 * The PRs it goes to are its open ones, or all of them when none is open (merged: new words start a new PR).
 * Returns the record to keep, or undefined when nothing changes (already handed for this run, to the same PRs).
 */
export function handoverDue(x: { run?: RunIn; prs: PrIn[]; steps?: Step[] | null; was?: TicketHandover; now?: string }): Omit<TicketHandover, 'carry' | 'carriedAt'> | undefined {
  const { run, prs, was } = x
  if (!prs.length || (run && (busy(run.state) || run.role === 'prep'))) return undefined
  const open = prs.filter((p) => p.open), to = (open.length ? open : prs).map(({ repo, number }) => ({ repo, number }))
  const id = run?.id ?? '' // no run of its own: '' (a run started later is newer, and takes the ticket back)
  if (was?.run === id) {
    // handed already: only its PRs can change (one more opened in the stack, one merged)
    return to.length === was.to.length && to.every((p) => was.to.some((q) => same(p, q))) ? undefined : { ...was, to }
  }
  const at = x.now ?? new Date().toISOString()
  // PRs and no run here (opened by hand, or by someone else): nothing on the ticket side to recommend, the PRs lead
  if (!run) return { to, at, run: id, why: 'has-pr' }
  const end = run.endedAt ?? run.queuedAt
  // the one hold: its run's last words wait on your decision, answered on the ticket (the reply run is judged in turn)
  const blocked = !!x.steps?.some((s) => s.kind === 'decide' && s.blocking)
  const agent = prs.some((p) => !!p.agentAt && p.agentAt > end)
  if (agent) return { to, at, run: id, why: 'pr-agent' }
  if (blocked) return undefined
  const opened = run.state === 'done' && (run.prs.length > 0 || run.outcome === 'shipped')
  // ended any other way (done without naming them, failed, cancelled) while its PRs exist: they lead from here
  return { to, at, run: id, why: opened ? 'opened' : 'has-pr' }
}

/** The PR a handed ticket's words go to: the top of its open stack (the newest work), else its last. */
export const mainOf = (h: Pick<TicketHandover, 'to'>, open: (p: PrRef) => boolean) => [...h.to].reverse().find(open) ?? h.to.at(-1)

/**
 * The ticket's steps still open when it handed over, as lines for the PR's agent: what the PR's agent already lists
 * (or already handed elsewhere) is left out, by wording, so it isn't told twice.
 */
export function carryOf(steps: Step[] | null | undefined, theirs: string[] = []): string[] {
  const known = new Set(theirs.map(stepHash))
  return (steps ?? []).filter((s) => !known.has(stepHash(s.text))).map((s) => s.kind === 'decide'
    ? `- Decide: ${s.text}${s.options?.length ? ` (${s.options.map((o) => o.label + (o.recommended ? ', recommended' : '')).join(' / ')})` : ''}`
    : `- ${s.text}${s.checked ? '' : ' (optional)'}`).slice(0, 12)
}

/** What the PR's agent is told once, with the next word it gets, about the steps its ticket left open. */
export const carryNote = (ticket: string, lines: string[]) => lines.length
  ? `\n\n(${ticket} handed over to this PR with these of its steps still open. They were written before your latest runs here: do what still applies, say which no longer do, and list what is left as your own next steps.\n${lines.join('\n')})`
  : ''

export type RouteTo = 'pr' | 'stack'
export type Routed = { to: RouteTo; pr: number; why: string; by: 'rule' | 'model'; fixed?: boolean } // fixed: the PR can't take it (merged, closed)
export type RoutePr = { number: number; state: 'open' | 'merged' | 'closed'; approved?: boolean; agent?: boolean } // agent false: not your PR tracked here, so no agent of yours can take words for it

// your words name where it goes: a rule, before any model
const ASK_NEW = /\b(?:new|separate|another|second|follow[- ]?up|own)\s+(?:pr|pull request)\b|\bstack(?:ed)?\s+(?:it\s+|this\s+)?on\b|\bon top of\b/i
const ASK_SAME = /\b(?:same|this|existing|that|the current)\s+(?:pr|pull request)\b|\bamend\b|\bin #\d+/i

/**
 * Where new words on a handed ticket go, by rule alone. A merged or closed PR can't take them: a new PR. An approved
 * one shouldn't grow under its approval: a new PR on top. Your words naming a new or the same PR decide it. Otherwise
 * the same PR, through its agent (the default when the small model can't tell). A PR with no agent of yours here (not
 * yours, or not tracked) can't take them either.
 * `sure`: decided by rule; the model is only asked for the rest.
 */
export function routeFallback(text: string, pr: RoutePr): Routed & { sure: boolean } {
  const n = pr.number
  if (pr.state !== 'open') return { to: 'stack', pr: n, why: `#${n} is ${pr.state}: it can't take more`, by: 'rule', fixed: true, sure: true }
  if (pr.agent === false) return { to: 'stack', pr: n, why: `no agent of yours works on #${n} here`, by: 'rule', fixed: true, sure: true }
  if (ASK_NEW.test(text)) return { to: 'stack', pr: n, why: 'you asked for a new PR', by: 'rule', sure: true }
  if (ASK_SAME.test(text)) return { to: 'pr', pr: n, why: `you asked for #${n} itself`, by: 'rule', sure: true }
  if (pr.approved) return { to: 'stack', pr: n, why: `#${n} is approved: it shouldn't grow under that approval`, by: 'rule', sure: true }
  return { to: 'pr', pr: n, why: `same work: #${n}'s agent takes it`, by: 'rule', sure: false }
}

/** The rule, and for an open PR it doesn't settle, a small model's read of whether the words fit that PR's scope. */
export async function routeInstruction(text: string, pr: RoutePr, classify?: () => Promise<{ route: 'same' | 'new'; why: string }>): Promise<Routed> {
  const { sure, ...r } = routeFallback(text, pr)
  if (sure || !classify) return r
  try {
    const m = await classify()
    return m.route === 'new' ? { to: 'stack', pr: pr.number, why: m.why || 'a separate piece of work', by: 'model' } : { to: 'pr', pr: pr.number, why: m.why || `fits #${pr.number}`, by: 'model' }
  } catch { return r }
}

export const ROUTE_SCHEMA = { type: 'object', additionalProperties: false, required: ['route', 'why'], properties: { route: { enum: ['same', 'new'] }, why: { type: 'string' } } }
export const routePrompt = (x: { ticket: string; text: string; pr: { number: number; title: string; body?: string; said?: string } }) => `A ticket (${x.ticket}) shipped as pull request #${x.pr.number}, whose own agent works on it now. The person sends new words about the ticket. Decide where they go:
- same: they change, fix or finish what #${x.pr.number} already does (a tweak, a bug in it, review feedback, a missing piece of that same change). Its agent does it on its branch.
- new: a separate change, a follow-up, or scope that would make #${x.pr.number} bigger and harder to review. A new PR is built on top of it, by another agent.
When unsure, same. why: one short line, in plain words.

<pr title="${x.pr.title.replace(/"/g, "'")}">
${(x.pr.body ?? '').slice(0, 1500)}
</pr>
${x.pr.said ? `<its-agent-said-last>\n${x.pr.said.slice(-1500)}\n</its-agent-said-last>\n` : ''}
<new-words>
${x.text.slice(0, 3000)}
</new-words>`

/** The prompt for a new PR stacked on the ticket's PR: its own branch on top, never the PR below's. */
export const stackedPrompt = (x: { ticket: string; title: string; url: string; text: string; command?: string; pr: { number: number; url: string; head: string; base: string; merged: boolean } }) => `New work on ${x.ticket} "${x.title}" (${x.url}), which already shipped as ${x.pr.url} (#${x.pr.number}, branch ${x.pr.head}). This goes into a NEW pull request, not into #${x.pr.number}:

${x.text}

- ${x.pr.merged ? `#${x.pr.number} is merged: branch off the up-to-date ${x.pr.base}` : `Stack it on #${x.pr.number}: fetch and branch off ${x.pr.head}, and open the PR with base ${x.pr.head} (and in its stack on GitHub the way the repository stacks PRs, gh stack when it uses it)`}, in a worktree of its own.
- Never commit to or push ${x.pr.head}: #${x.pr.number} has its own agent. What belongs in #${x.pr.number} itself, name as a next step for #${x.pr.number} instead.
- Implement, run the project's checks, push your branch and open the PR the way ${x.command ? `\`${x.command}\`` : 'your exec command'} opens one (title, body, links to ${x.ticket}). End with the new PR's URL.`
