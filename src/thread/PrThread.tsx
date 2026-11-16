// The PR page in the new design: the same features as the classic one (usePrThread), laid out as a conversation with
// its next step, and beside it what to check before trusting the work.
import { queuedText } from '../time.ts'
import { ArrowLeft, ArrowRight, CheckCheck, LoaderCircle, MessageCircleQuestion, Send, Upload, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { FlowAction } from '../../server/flow.ts'
import { ActivityFeed, FeedMode } from '../components/ActivityFeed.tsx'
import { Missing } from '../components/Missing.tsx'
import { Md } from '../components/Md.tsx'
import { NextSteps } from '../components/NextSteps.tsx'
import { Description, ghost, SubmitDialog, Turns, usePrThread, type PrThreadProps } from '../components/PrDetail.tsx'
import { api, enc, param, setParam } from '../lib.ts'
import { appendDraft } from '../draft.ts'
import { Composer, NextCard, ThreadHeader, ThreadLayout, WorkingBar } from '../ui/Thread.tsx'
import { sayTo, useDiscussions, withTurns, type View } from './Discussion.tsx'
import { ShippingVital, useLaneActions, Vitals } from './Vitals.tsx'
import { useToolCommands, type Command } from '../ui/Slash.tsx'
import { useRole, type Role } from '../role.ts'
import { DomainView } from './DomainView.tsx'

const Explain = lazy(() => import('../components/Explain.tsx'))

type Pane = 'explain' | 'description' | 'turns' | 'ticket' | 'domain'
// the panel's tab carries over to the next PR, per role (each role keeps its place), and sits in the URL
const lastPane: Partial<Record<Role, Pane>> = {}
const PANES: Pane[] = ['explain', 'description', 'turns', 'ticket', 'domain']
// what each role's panel has: the code's views for a developer; the domain first for product and design, and of
// Explain only what isn't technical
// (the vitals sit over the panel, always; how it changed direction opens from Explain; the tools are the box's / commands)
const ROLE_PANES: Record<Role, Pane[]> = { developer: ['explain', 'description'], product: ['domain', 'explain', 'description'], design: ['domain', 'explain', 'description'] }
let lastWhole = false
// how far along shipping is, by what comes next (of 4): a run, going through it, publishing, merging
const STEP: Partial<Record<FlowAction, number>> = { run: 1, retry: 1, finalize: 1, answer: 1, read: 1, crit: 2, 'restart-crit': 2, fix: 2, 'retry-op': 2, 'dismiss-op': 2, publish: 3, post: 3, rerequest: 3, merge: 4 }

// the next step's headline, by what the flow says comes next
const TITLE: Partial<Record<FlowAction, (mine: boolean) => string>> = {
  run: (m) => (m ? 'Have the agent work through the feedback' : 'Have the agent review it'),
  finalize: () => 'Finish the last comments',
  crit: (m) => (m ? 'Go through the fixes in crit' : 'Go through the review in crit'),
  'restart-crit': () => 'Restart crit',
  fix: () => 'Fix the threads',
  publish: () => 'Push the fixes and reply',
  post: () => 'Decide on the review',
  merge: () => 'Merge it',
  rerequest: () => 'Ask for another review',
  answer: () => 'Answer the agent',
  retry: () => 'Try again',
  read: () => 'Nothing to answer?',
  'retry-op': () => 'Run the tool again',
  'dismiss-op': () => 'Put the failure away',
}
const TAB: Record<Pane, string> = { explain: 'Explain', description: 'Description', turns: 'Turns', ticket: 'Ticket', domain: 'Domain' }
const ICON: Partial<Record<FlowAction, LucideIcon>> = { post: Send, publish: Upload, merge: CheckCheck, answer: MessageCircleQuestion }

export function PrThread(props: PrThreadProps) {
  const x = usePrThread(props)
  const { pr, feed, toast, prs, onBack, job, busy, next, flow, asks, askFirst, act, url, resumeCmd, critDown, restartCrit, fixThreads, smartRebase, below, markRead, runFinalize, BIG, alsoLine, doNext, chips, statusField, parentLinks, stackNav, headerActions, people, submit, setSubmit } = x
  const role = useRole(), panes = ROLE_PANES[role]
  const [paneState, setPaneState] = useState<Pane>(() => (PANES.find((p) => p === param('pane')) ?? (props.ticket ? 'ticket' : lastPane[role] ?? panes[0])))
  // a tab this role doesn't have: its own last one, or its first
  const pane: Pane = paneState === 'ticket' || paneState === 'turns' || panes.includes(paneState) ? paneState : lastPane[role] ?? panes[0]
  const setPane = (p: Pane) => { lastPane[role] = p; setPaneState(p); setParam('pane', p === panes[0] ? null : p) }
  // another role: back where that role was
  const was = useRef(role)
  useEffect(() => { if (was.current !== role) { was.current = role; const p = lastPane[role] ?? panes[0]; setPaneState(p); setParam('pane', p === panes[0] ? null : p) } }, [role])
  const setRead = (r: Pane) => setPane(r)
  // the chat: the main conversation, or a discussion beside it; opening one puts what it is about in the panel
  // a PR in a stack can talk about itself or the whole stack: one decision, mapped to each PR
  const stack = pr.stack && pr.stack.length > 1 ? pr.stack : undefined
  const stackTarget = stack && `stack:${stack[0].repo}#${stack[0].number}`
  const [wholeState, setWhole] = useState(() => lastWhole)
  const whole = !!stack && wholeState
  const prTalks = useDiscussions(`pr:${pr.id}`), stackTalks = useDiscussions(stackTarget)
  const target = whole ? stackTarget! : `pr:${pr.id}`
  const talks = whole ? stackTalks : prTalks
  // a steer for one PR of the stack goes to that PR's own agent
  const steerPr = (n: number, text: string) => {
    const p = prs.find((x) => x.repo === pr.repo && x.number === n)
    if (!p) return Promise.reject(new Error(`#${n} isn't tracked here: open it on GitHub to ask its author`))
    const working = p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'
    return api(`/prs/${enc(p.id)}/${working ? 'steer' : 'reply'}`, { text })
  }
  // a view the discussion points to: Explain opens on it beside the chat (Explain reads its view as it opens)
  const [explainKey, setExplainKey] = useState(0)
  const openView = (v: View) => { setParam('view', v === 'tour' ? null : v); setExplainKey((k) => k + 1); setPane('explain') }
  const steerMain = (text: string) => api(`/prs/${enc(pr.id)}/${busy ? 'steer' : 'reply'}`, { text })
  // the discussions' suggestions: picked over the box, sent with your words in one go
  const lane = useLaneActions({ d: talks.d, target, onChange: talks.set, onSteer: steerMain, onView: openView, toast })
  // one conversation: the agent's work, and the discussions' turns in their lane's colour
  const all = withTurns(feed, prTalks.d, stack ? stackTalks.d : undefined)
  const count = all.filter((a) => a.kind !== 'section').length
  const intent = talks.d?.intent
  // the box: words are read once sent, with the agent's last reply, and routed to the agent, Intent or Understanding
  const lastWords = () => [...feed].reverse().find((a) => (a.kind === 'result' || a.kind === 'text') && !a.lane)?.text.slice(-1500)
  const route = { send: sayTo(target, talks.set), context: lastWords,
    unsettled: intent?.messages.length && intent.stage !== 'concluded' ? `Intent still open: ${intent.status}` : undefined }
  const live = pr.status === 'preparing' || pr.status === 'posting'

  // what `/` in the box offers: the flow's steps, the views, and every tool (the Tools menu's list)
  const tools = useToolCommands(`/prs/${enc(pr.id)}`, `${pr.headSha}:${pr.status}:${job?.state}`, toast, 'PR')
  const commands: Command[] = [
    ...(busy ? [{ id: 'cancel', group: 'Next', label: 'Stop the agent', run: () => act('cancel', 'Cancelled') }] : [
      { id: 'run', group: 'Next', label: pr.mine ? 'Revise: work through the feedback' : 'Review it', hint: 'Starts an agent run', run: () => act('run', pr.mine ? 'Revise queued' : 'Review queued') },
      ...(pr.mine && (pr.awaiting ?? pr.unresolved) ? [{ id: 'fix', group: 'Next', label: 'Fix the threads', hint: 'Fixes, commits locally and drafts replies; pushes nothing', run: fixThreads }] : []),
      ...(pr.mine && pr.awaiting ? [{ id: 'finalize', group: 'Next', label: 'Finish the last comments', run: runFinalize }] : []),
      ...(pr.mine && job ? [{ id: 'publish', group: 'Next', label: 'Push and reply', hint: 'Pushes the fixes and posts the replies', confirm: true, run: () => act('publish', 'Publishing: the agent is pushing and replying') }] : []),
      ...(!pr.mine && job?.reviewDone ? [
        { id: 'post', group: 'Next', label: 'Post the review', hint: 'Opens the dialog: your note, then the findings as comments', run: () => setSubmit({ event: 'COMMENT' }) },
        { id: 'approve', group: 'Next', label: 'Approve', hint: 'Opens the dialog before anything reaches GitHub', run: () => setSubmit({ event: 'APPROVE' }) },
      ] : []),
      ...(pr.behindBase && below ? [{ id: 'rebase', group: 'Next', label: `Smart rebase onto #${below.number}`, run: smartRebase }] : []),
      ...(pr.mine && pr.awaiting ? [{ id: 'read', group: 'Next', label: 'Nothing to answer', hint: 'It stops waiting on you, without a run', run: markRead }] : []),
    ]),
    { id: 'explain', group: 'Read', label: 'Explain', hint: 'What changes for users, and which parts of the code', run: () => setRead('explain') },
    { id: 'description', group: 'Read', label: 'Description', run: () => setRead('description') },
    { id: 'turns', group: 'Read', label: 'How it changed direction', run: () => setRead('turns') },
    ...(url ? [{ id: 'crit', group: 'Open', label: 'Open crit', run: () => open(url, '_blank', 'noreferrer') }] : []),
    ...(critDown ? [{ id: 'restart-crit', group: 'Open', label: 'Restart crit', hint: 'Your comments are kept', run: restartCrit }] : []),
    ...(resumeCmd ? [{ id: 'resume', group: 'Open', label: 'Resume the session in Terminal', run: () => act('resume-terminal', 'Opened the session in Terminal') }] : []),
    { id: 'github', group: 'Open', label: 'Open on GitHub', run: () => open(pr.url, '_blank', 'noreferrer') },
    { id: 'dismiss', group: 'Open', label: 'Hide until requested again', run: () => act('dismiss', 'Hidden until requested again') },
    ...tools,
  ]
  // the box to steer the agent: when it asks you something (its decisions and steps), the whole box is a card in the
  // conversation, since your picks and your words go out as one answer; otherwise a plain box docked at the bottom
  const steer = (
    job ? (
            <NextSteps attach={lane} route={route} commands={commands} stepper inline nextUrl={busy ? undefined : `/prs/${enc(pr.id)}/next`} replyUrl={`/prs/${enc(pr.id)}/reply`} self={pr.number}
                       others={prs.filter((p) => p.repo === pr.repo && !p.closed && p.id !== pr.id).map((p) => p.number)} draft={`pr:${pr.id}`} version={job.endedAt ?? ''} toast={toast}
                       placeholder={busy ? 'Tell it something while it works: it reads it between steps, without stopping' : 'Tell the agent what to change, answer, or do next…'} />
    ) : (
            <NextSteps attach={lane} route={route} commands={commands} stepper inline replyUrl={`/prs/${enc(pr.id)}/reply`} draft={`pr:${pr.id}`} version="" toast={toast} placeholder="Ask an agent to do something on this PR: it starts a run with your words" />
    )
  )
  const asking = asks && !busy
  const shipTitle = busy && !pr.waiting ? (pr.status === 'queued' ? 'Queued' : pr.status === 'posting' ? 'Posting' : 'The agent is working') : pr.waiting ? 'Waiting for an account'
    : askFirst ? 'The agent asks you' : next ? TITLE[next]?.(!!pr.mine) ?? 'Next' : 'All clear'
  const shipTone = busy ? 'run' as const : askFirst || next === 'answer' ? 'wait' as const : next === 'retry' || next === 'retry-op' ? 'fail' as const : next ? 'run' as const : 'ok' as const
  const nextCard = busy && !pr.waiting ? (
    // working: one line (its background runs and Stop), the details folded; the conversation shows the work itself
    <WorkingBar title={pr.status === 'queued' ? 'Queued' : pr.status === 'posting' ? 'Posting' : 'The agent is working'} sub={pr.status === 'queued' ? queuedText(pr.queued) : pr.background ? `${pr.background} running in the background` : undefined}
                stop={() => act('cancel', 'Cancelled')}>{doNext}</WorkingBar>
  ) : pr.waiting ? (
    <NextCard icon={LoaderCircle} tone="run" title="Waiting for an account" actions={doNext} />
  ) : askFirst ? (
    <NextCard icon={MessageCircleQuestion} tone="wait" title="The agent asks you" actions={steer} also={alsoLine} />
  ) : !next ? undefined /* nothing waits on you: no card, the panel takes its room (the header says all clear) */ : (
    <NextCard icon={(next && ICON[next]) ?? ArrowRight} tone={next ? 'run' : 'ok'}
              title={next ? TITLE[next]?.(!!pr.mine) ?? 'Next' : 'Nothing waits on you'}
              why={next === 'post' ? undefined : flow.why}
              details={(next === 'run' || next === 'finalize') && pr.missing.length ? <Missing names={pr.missing} /> : undefined} detailsLabel="What it needs first"
              actions={next && next !== 'answer' ? BIG[next] : undefined} also={alsoLine} />
  )

  return (
    <>
      <ThreadLayout
        subject={pr.id}
        follow={`${pr.id}:${count}:${pr.status}:${next}`}
        header={<ThreadHeader crumb={parentLinks} title={pr.title} status={<>{statusField}{people}</>} meta={chips} links={stackNav} actions={headerActions}
                              back={<button onClick={onBack} className={`${ghost} -ml-2.5 lg:hidden`}><ArrowLeft className="size-4" />All reviews</button>} />}
        next={nextCard || (asking && !askFirst) ? <>{nextCard}{asking && !askFirst && <NextCard icon={MessageCircleQuestion} tone="wait" title="The agent also asks you" actions={steer} />}</> : undefined}
        composer={!asking && <Composer>{steer}</Composer>}
        tabs={[...(props.ticket ? [{ id: 'ticket' as const, label: props.ticket.id }] : []), ...panes.map((p) => ({ id: p, label: p === 'domain' && role === 'design' ? 'Experience' : TAB[p], fill: p === 'explain' }))]}
        tab={pane === 'turns' ? 'explain' : pane} onTab={setPane}
        onAsk={(q) => appendDraft(`pr:${pr.id}`, q)}
        vitals={(
            <Vitals key={target} scope={stack && { size: stack.length, stack: whole, set: (v) => { lastWhole = v; setWhole(v) } }}
                    shipping={<ShippingVital title={shipTitle} tone={shipTone} busy={busy && !pr.waiting} at={next ? STEP[next] ?? 1 : busy ? 1 : 4} why={pr.status === 'queued' ? queuedText(pr.queued) : next && next !== 'post' ? flow.why : !next && !busy ? 'Nothing waits on you here.' : undefined} />}
                    topics={{ target, d: talks.d, onChange: talks.set, onSteer: steerMain, onSteerPr: steerPr, onView: openView, toast, here: pr.number }} />
        )}
        pane={pane === 'explain' ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>}>
              <Explain key={`${explainKey}:${role}`} pr={pr} toast={toast} prs={prs} onSelect={props.onSelect} lenses={role === 'developer' ? undefined : ['tour', 'business']} onTurns={role === 'developer' ? () => setPane('turns') : undefined} />
            </Suspense>
          ) : pane === 'ticket' && props.ticket ? <div className="space-y-3 p-5"><p className="text-body font-semibold text-fg-1">{props.ticket.title}</p>{props.ticket.description.trim() ? <Md text={props.ticket.description} /> : <p className="text-small text-fg-3">No description.</p>}</div>
          : pane === 'domain' ? <DomainView path={`/prs/${enc(pr.id)}/domain`} focus={role === 'design' ? 'design' : 'product'} />
          : pane === 'turns' ? <div><button onClick={() => setPane('explain')} className={`${ghost} m-2`}><ArrowLeft className="size-4" />Back to Explain</button><Turns pr={pr} /></div>
          : <Description pr={pr} />}
      >
        <div className="flex items-center justify-between gap-3">
          {live ? <span className="flex items-center gap-1.5 text-meta text-run"><span className="size-1.5 animate-pulse rounded-full bg-run" />live</span> : <span />}
          {count > 0 && <FeedMode />}
        </div>
        {count > 0
          ? <ActivityFeed feed={all} live={live || Object.values(talks.d ?? {}).some((x) => x.busy)} bg={{ base: `/prs/${enc(pr.id)}`, count: pr.background }} toast={toast} />
          : <p className="py-6 text-center text-body text-fg-3">{pr.mine ? 'Nothing has run on this PR yet.' : 'No agent has looked at this PR yet.'}</p>}
      </ThreadLayout>
      {submit && <SubmitDialog pr={pr} event={submit.event} drop={submit.drop} onClose={() => setSubmit(undefined)} toast={toast} />}
    </>
  )
}
