import { pendingOf } from './reply.ts'
// Where a PR stands and what comes next, decided in one place from the facts. The rules are checked in order and the
// first that matches wins, so the same facts always give the same answer, and the page, the pipeline and the Next
// panel all read this one answer.
import type { Crit, Status } from './crit.ts'
import { isFollowUp, state, VERDICT_DEFAULT, type Job, type Pr, type Verdict } from './store.ts'

export type FlowState =
  | 'closed' | 'no-checkout' | 'working' | 'failed' | 'asks'
  // your PR
  | 'ready-to-merge' | 'answered' | 'waiting' | 'feedback' | 'in-crit' | 'needs-fix' | 'fixed'
  // someone else's
  | 'to-review' | 'ready-to-post' | 'reviewed'
  // a tool run on it
  | 'tool-running' | 'tool-failed'

export type FlowAction =
  | 'run' | 'finalize' | 'crit' | 'restart-crit' | 'fix' | 'publish' | 'post' | 'merge' | 'rerequest' | 'answer' | 'cancel' | 'retry'
  | 'read' // what waits on you needs no answer (a status note): counted as read, without a run
  | 'retry-op' | 'dismiss-op' // a tool run (Smart rebase, re-run checks…): run it again, or put the failure away

export type Flow = {
  state: FlowState
  step: number // 0–4 in the pipeline (yours: Feedback, Preparing, In crit, Fixing, All clear; theirs: Requested, Preparing, Ready, In review, Reviewed)
  broken?: boolean // the pipeline marks the current step as failed
  why: string // one sentence: what is true right now
  next?: FlowAction
  also: FlowAction[] // other moves that make sense here, quieter
  of?: FlowState // while a tool run shows (tool-running, tool-failed): where the PR itself is
  suggest?: Verdict // a ready review: the verdict to take (Settings → General decides it, by whether a finding blocks)
}

export type FlowIn = {
  mine: boolean
  closed: boolean
  hasCheckout: boolean
  headSha: string
  reviewDecision?: string | null
  awaiting: number // open threads and PR comments whose last word isn't yours
  unresolved: number
  reviewers: number // people you can ask to review again
  feedbackAt?: string
  reviewed: boolean // theirs: you already submitted a review on this head
  job?: Pick<Job, 'kind' | 'state' | 'headSha' | 'reviewDone' | 'roundAt'> & { asks: boolean }
  crit?: { live: boolean; finishes: number; known: boolean; findings?: number; open?: number; blocking?: number } // known: there is a crit session to open or restart; findings: the AI review's comments, open: unresolved
  op?: { label: string; state: 'running' | 'done' | 'failed'; result?: string } // the latest tool run
  verdict?: { blocking: Verdict; clean: Verdict } // what to suggest for a ready review (Settings)
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

export function flowOf(f: FlowIn): Flow {
  const j = f.job
  const running = j && (j.state === 'queued' || j.state === 'running')
  if (f.closed) return { state: 'closed', step: 4, why: 'Merged or closed.', also: [] }
  if (!f.hasCheckout) return { state: 'no-checkout', step: 0, why: 'No local checkout of this repository is configured.', also: [] }
  if (running) return { state: 'working', step: j.kind === 'review' || j.kind === 'revise' ? 1 : 3, why: 'The agent is working. Follow it in Activity.', next: 'cancel', also: [] }
  if (j && (j.state === 'failed' || j.state === 'interrupted')) {
    return { state: 'failed', step: isFollowUp(j.kind) ? 3 : 1, broken: true, why: `The last run ${j.state === 'failed' ? 'failed' : 'was interrupted'}. Activity shows where it stopped.`, next: 'retry', also: [] }
  }
  // what the agent asked is moot once you've reviewed this head yourself
  if (j && j.state === 'done' && j.asks && j.kind !== 'publish' && (f.mine || !f.reviewed)) return { state: 'asks', step: f.mine ? 3 : 2, why: 'The agent stopped to ask you something. Answer it below; it acts on your answer in the same session.', next: 'answer', also: [] }
  const flow = f.mine ? mine(f) : theirs(f)
  // a tool run comes first while it runs, and when it failed; the pipeline still says where the PR itself is
  if (f.op?.state === 'running') return { ...flow, state: 'tool-running', of: flow.state, why: `${f.op.label} is running. Follow it in Activity.`, next: undefined, also: [] }
  if (f.op?.state === 'failed') return { ...flow, state: 'tool-failed', of: flow.state, broken: true, why: `${f.op.label} failed: ${f.op.result ?? 'see Activity'}`, next: 'retry-op', also: ['dismiss-op', ...(flow.next ? [flow.next] : [])] }
  return flow
}

/** The facts flowOf reads, from a PR as state keeps it, its crit, and its latest tool run. */
export function flowInOf(p: Pr, crit: Pick<Crit, 'live' | 'finishes' | 'port' | 'sessionKey'> & Partial<Pick<Crit, 'aiComments' | 'unresolved' | 'blocking'>> | undefined, hasCheckout: boolean, op?: FlowIn['op']): FlowIn {
  return {
    mine: !!p.mine, closed: !!p.closed, hasCheckout, headSha: p.headSha, reviewDecision: p.reviewDecision,
    awaiting: p.awaiting ?? p.unresolved ?? 0, unresolved: p.unresolved ?? 0, reviewers: p.reviewers?.length ?? 0, feedbackAt: p.feedbackAt,
    reviewed: !p.mine && !!p.myReview && p.myReview.commitId === p.headSha,
    job: p.job && { ...p.job, asks: pendingOf(p.job.next) > 0 },
    crit: crit && { live: crit.live, finishes: crit.finishes, known: !!crit.port && !!crit.sessionKey, findings: crit.aiComments, open: crit.unresolved, blocking: crit.blocking },
    op, verdict: state.settings.verdict,
  }
}

/**
 * The list's word for a PR (its badge, its group), read off its flow: one set of rules decides where a PR stands, so
 * the badge, the pipeline and the next move can't disagree. Only what the flow doesn't say is added here: whether a
 * run is queued or posting, and whether you've touched the review in crit yet.
 */
export function statusOfFlow(flow: Flow, p: Pick<Pr, 'mine' | 'reviewDecision' | 'job'>, touched: boolean): Status {
  const j = p.job
  const s = flow.of ?? flow.state
  if (s === 'closed' || s === 'no-checkout') return s
  if (s === 'working') return j && isFollowUp(j.kind) && j.kind !== 'reply' ? 'posting' : j?.state === 'queued' ? 'queued' : 'preparing'
  if (s === 'failed') return j?.state === 'interrupted' ? 'interrupted' : 'failed'
  // approved on GitHub: ready for you to merge, whatever crit or open comments still say
  if (p.mine && p.reviewDecision === 'APPROVED') return 'approved'
  switch (s) {
    case 'ready-to-merge': return 'approved'
    case 'answered': return 'answered'
    case 'waiting': return 'clear'
    case 'feedback': return 'new'
    case 'in-crit': case 'fixed': return 'in-review'
    case 'reviewed': return 'reviewed'
    case 'to-review': return 'new'
    default: return touched ? 'in-review' : 'ready' // asks, needs-fix, ready-to-post
  }
}

function mine(f: FlowIn): Flow {
  const j = f.job
  const critUp = !!f.crit?.live
  const finished = (f.crit?.finishes ?? 0) > 0
  if (f.awaiting === 0) {
    if (f.reviewDecision === 'APPROVED') return { state: 'ready-to-merge', step: 4, why: 'Approved, and nothing waits on you: ready to merge.', next: 'merge', also: [] }
    // changes asked for in the review itself, with no thread to answer: nothing of it is answered yet, so it's yours
    if (f.reviewDecision === 'CHANGES_REQUESTED' && f.unresolved === 0) {
      return { state: 'feedback', step: 0, why: 'Changes were requested in the review itself, with no thread to answer. A revise reads it.', next: 'run', also: [] }
    }
    if (f.unresolved > 0 || f.reviewDecision === 'CHANGES_REQUESTED' || f.reviewers) {
      return { state: 'answered', step: 4, why: f.reviewDecision === 'CHANGES_REQUESTED' ? 'Every thread is answered; the changes-requested verdict stands until they review again.' : f.unresolved ? `Every thread is answered; ${n(f.unresolved, 'thread')} wait for the reviewer to resolve.` : 'You answered their review: ask them to look again.', next: f.reviewers ? 'rerequest' : undefined, also: [] }
    }
    return { state: 'waiting', step: 4, why: 'Nothing waits on you. Reviewers have the next move.', also: [] }
  }
  // threads wait on you: has a revise round run since they arrived? (rounds from before rounds were stamped: same head)
  const prepared = !!j?.reviewDone && (f.feedbackAt ? !!j.roundAt && j.roundAt >= f.feedbackAt : j.headSha === f.headSha || isFollowUp(j.kind))
  const waits = `${n(f.awaiting, 'comment')} ${f.awaiting === 1 ? 'waits' : 'wait'} on you`
  if (!prepared) {
    const approved = f.reviewDecision === 'APPROVED'
    return { state: 'feedback', step: 0, why: `${approved ? 'Approved, but' : f.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes were requested:' : 'New feedback:'} ${waits}. A revise brings ${f.awaiting === 1 ? 'it' : 'them'} into crit.`, next: approved ? 'finalize' : 'run', also: ['read'] }
  }
  // the round has them: fixed by a fix round (or Finish Review in crit), and not pushed since?
  const fixed = j!.kind === 'reply' || (finished && j!.kind === 'revise')
  if (fixed) return { state: 'fixed', step: 3, why: 'The fixes are committed locally and the replies drafted. Nothing is on GitHub yet.', next: 'publish', also: ['fix'] }
  if (critUp && j!.kind === 'revise') return { state: 'in-crit', step: 2, why: `The threads are in crit: ${waits}. Fix or answer them there, then Finish Review.`, next: 'crit', also: ['fix'] }
  return {
    state: 'needs-fix', step: 3,
    why: `${j!.kind === 'publish' ? 'Nothing was fixed yet, so the push sent nothing. ' : f.crit?.known && !critUp ? 'crit is down. ' : ''}${waits}. The agent applies the fixes, commits locally and drafts the replies; nothing is pushed until you click Push & reply.`,
    next: 'fix', also: [...(f.crit?.known && !critUp ? ['restart-crit' as const] : critUp ? ['crit' as const] : []), 'read'],
  }
}

function theirs(f: FlowIn): Flow {
  const j = f.job
  const critUp = !!f.crit?.live
  const finished = (f.crit?.finishes ?? 0) > 0
  if (f.reviewed) return { state: 'reviewed', step: 4, why: 'You reviewed this head. Nothing waits on you until the author pushes again.', also: [] }
  const current = !!j?.reviewDone && j.headSha === f.headSha
  if (!current) return { state: 'to-review', step: 0, why: j ? 'The author pushed since your review. A review of the new head, in the same session.' : 'Your review was requested.', next: 'run', also: [] }
  // the review is ready: what to do with its findings is the decision, so it is the next move whether or not crit is
  // open; one verdict is suggested (by default: a blocking finding goes up as comments, else approve), the rest offered
  const k = f.crit?.findings ?? 0, open = f.crit?.open ?? 0, b = f.crit?.blocking ?? 0
  const rule = f.verdict ?? VERDICT_DEFAULT
  const suggest: Verdict = !k ? (rule.clean === 'comment' ? 'comment' : 'approve') : b ? rule.blocking : rule.clean
  const found = k ? `The AI review left ${n(k, 'finding')}${b ? `, ${b} blocking` : ', none blocking'}${open > b ? ` (${open} unresolved in crit)` : ''}.` : 'The AI review found nothing to flag.'
  const take = { comment: k ? 'Post them as comments' : 'Post a note', approve: k ? 'Approve, with them as comments for the author' : 'Approve', 'approve-quiet': 'Approve without them' }[suggest]
  const why = `${finished ? 'You finished the review in crit. ' : ''}${found} Suggested: ${take.charAt(0).toLowerCase() + take.slice(1)}.`
  return { state: 'ready-to-post', step: critUp && !finished ? 3 : 2, why, next: 'post', suggest, also: k ? [] : critUp ? ['crit'] : f.crit?.known ? ['restart-crit'] : [] } // with findings, crit is one of the choices
}
