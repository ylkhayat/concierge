// The ticket page in the new design: the same features as the classic one (useTicketThread), laid out as a
// conversation with its next step, and beside it what to check before trusting what was built.
import { TicketOverview } from './Overview.tsx'
import { queuedText } from '../time.ts'
import { ArrowRight, LoaderCircle, MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { ActivityFeed, FeedMode } from '../components/ActivityFeed.tsx'
import { useTicketThread, type TicketThreadProps } from '../components/ExecDetail.tsx'
import { StackNav } from '../components/StackNav.tsx'
import { NextSteps } from '../components/NextSteps.tsx'
import { SectionHeadings } from '../components/NextPanel.tsx'
import { PHASE_LABEL } from '../components/ExecList.tsx'
import { api, param, setParam, type TicketView } from '../lib.ts'
import { appendDraft } from '../draft.ts'
import { Composer, NextCard, ThreadHeader, ThreadLayout, WorkingBar } from '../ui/Thread.tsx'
import { sayTo, useDiscussions, useWork, useWorkFeed, withTurns, WorkStrip } from './Discussion.tsx'
import { ShippingVital, useLaneActions, Vitals } from './Vitals.tsx'
import { useRole } from '../role.ts'
import { DomainView } from './DomainView.tsx'
import { useToolCommands, type Command } from '../ui/Slash.tsx'

// the next step's headline, by what the ticket waits on
const TITLE: Record<'run' | 'pr' | 'tend' | 'dock', (t: TicketView) => string> = {
  run: (t) => (t.run ? 'Run it again' : 'Run it'),
  pr: (t) => (t.prs.length > 1 ? 'Review its PRs' : 'Review the PR'),
  tend: () => 'Its PR needs you',
  dock: (t) => (t.agentWaiting ? 'Answer the agent on Linear' : 'Tell the agent what next'),
}

type Pane = 'overview' | 'ticket' | 'domain'
const PANES: Pane[] = ['overview', 'ticket', 'domain']
let lastPane: Pane | undefined

export function TicketThread(props: TicketThreadProps) {
  const { t, feed, toast, run, siblings, prItems, onOpenLinked, runIt, act, missing, chips, openPr, statusField, parentLinks, stackNav, headerActions, panelBody, ticketBody, asking, runAsks, next } = useTicketThread(props)
  // product and design read the ticket's domain beside the ticket; the tools are a developer's
  const role = useRole(), panes: Pane[] = role === 'developer' ? ['overview', 'ticket'] : ['overview', 'ticket', 'domain']
  const [paneState, setPaneState] = useState<Pane>(() => (PANES.find((p) => p === param('tpane')) ?? lastPane ?? 'overview'))
  const pane: Pane = panes.includes(paneState) ? paneState : 'overview'
  const setPane = (p: Pane) => { lastPane = p; setPaneState(p); setParam('tpane', p === 'overview' ? null : p) }
  // the chat: the main conversation, or a discussion beside it, with the ticket in the panel
  // its PRs (and theirs, and their stack) are one Work with it: the same cards on every part
  const work = useWork(`ticket:${t.id}`)
  const target = work && work.members.length > 1 ? work.target : `ticket:${t.id}`
  const talks = useDiscussions(target)
  const all = useWorkFeed(`ticket:${t.id}`, work, withTurns(feed, talks.d)) // one conversation: the run's work and the discussions' turns
  const count = all.filter((a) => a.kind !== 'section').length
  const intent = talks.d?.intent
  // the box: words are read once sent, with the agent's last reply, and routed; filtered to a discussion, they go there
  const lastWords = () => [...feed].reverse().find((a) => (a.kind === 'result' || a.kind === 'text') && !a.lane)?.text.slice(-1500)
  const route = { send: sayTo(target, talks.set), context: lastWords,
    unsettled: intent?.messages.length && intent.stage !== 'concluded' ? `Intent still open: ${intent.status}` : undefined }
  // what `/` in the box offers: its next steps, the ticket and its PRs, and every tool (the Tools menu's list)
  const tools = useToolCommands(`/exec/tickets/${t.id}`, `${t.busy}:${run?.id}:${run?.state}`, toast, 'ticket')
  const commands: Command[] = [
    ...(t.busy ? [{ id: 'cancel', group: 'Next', label: 'Stop the run', run: () => act('cancel', 'Run stopped') }]
      : t.repo && !missing.length ? [{ id: 'run', group: 'Next', label: run ? 'Run it again' : 'Run it', hint: `Starts the exec command on ${t.id}`, run: runIt }] : []),
    { id: 'ticket', group: 'Read', label: `Read ${t.id}`, run: () => setPane('ticket') },
    ...prItems.map((x) => ({ id: `pr:${x.id}`, group: 'Open', label: `Open ${x.ref} in Review`, hint: x.title, run: () => onOpenLinked(x.linked ?? { kind: 'pr', id: x.id, label: x.ref, title: x.title, agent: 'none' }) })),
    ...(run ? [{ id: 'resume', group: 'Open', label: 'Resume the session in Terminal', run: () => act('resume-terminal', 'Opened the session in Terminal') }] : []),
    { id: 'linear', group: 'Open', label: 'Open in Linear', run: () => open(t.url, '_blank', 'noreferrer') },
    ...tools,
  ]
  // the box to steer it: the agent's decisions once it hands back (a card in the conversation, since your picks and
  // words go out as one answer), else words for a run that works or hasn't started (docked at the bottom); none while
  // it waits on a Linear question, which the next step answers
  // a ticket that ships as several PRs: a steer for one goes to that PR's own agent
  const steerPr = (n: number, text: string) => { const x = t.prs.find((y) => y.number === n); return x ? api(`/prs/${encodeURIComponent(`${x.repo}#${x.number}`)}/reply`, { text }) : Promise.reject(new Error(`#${n} isn't one of ${t.id}'s PRs`)) }
  const steerMain = (text: string) => api(t.busy || !run || !(run.state === 'done' || run.state === 'failed') ? `/exec/tickets/${t.id}/steer` : `/exec/${run.id}/reply`, { text })
  // the discussions' suggestions: picked over the box, sent with your words in one go
  const lane = useLaneActions({ d: talks.d, target, onChange: talks.set, onSteer: steerMain, toast })
  const handedBack = !!run && !t.busy && (run.state === 'done' || run.state === 'failed')
  const steer = handedBack
    ? <NextSteps attach={lane} route={route} commands={commands} stepper inline nextUrl={`/exec/${run.id}/next`} replyUrl={`/exec/${run.id}/reply`} draft={`ticket:${t.id}`} version={run.endedAt ?? ''} toast={toast} placeholder="Tell the agent what to change, answer, or do next…" />
    : <NextSteps attach={lane} route={route} commands={commands} stepper inline replyUrl={`/exec/tickets/${t.id}/steer`} draft={`ticket:${t.id}`} version={`${t.id}:${t.busy}`} toast={toast}
                 placeholder={t.busy ? 'Tell it something while it works: it reads it between steps, without stopping' : `What should ${t.id}’s implementation do differently?`} />

  return (
    <ThreadLayout
      subject={t.id}
      follow={`${t.id}:${count}:${t.busy}:${next}`}
      header={<ThreadHeader crumb={parentLinks} title={t.title} status={statusField} meta={chips} links={<>{stackNav}{siblings && prItems.length > 0 && <StackNav items={prItems} onOpen={(x) => onOpenLinked(x.linked ?? { kind: 'pr', id: x.id, label: x.ref, title: x.title, agent: 'none' })} me={{ kind: 'ticket', id: t.id }} toast={toast} />}</>} actions={headerActions} />}
      next={runAsks && next === 'dock' ? (
        // it handed back with questions: answering them is the next step, and the plan is under Understanding
        <NextCard icon={MessageCircleQuestion} tone="wait" title="The agent asks you" actions={steer} />
      ) : t.busy ? (
        <WorkingBar title={t.queued ? 'Queued' : 'The agent is working'} sub={t.queued ? queuedText(t.queued) : [run?.phase && (PHASE_LABEL[run.phase] ?? run.phase), t.background ? `${t.background} running in the background` : ''].filter(Boolean).join(' · ') || undefined}
                    stop={() => act('cancel', 'Run stopped')}><SectionHeadings.Provider value={false}><div className="space-y-3">{panelBody}</div></SectionHeadings.Provider></WorkingBar>
      ) : (
        <NextCard icon={t.busy ? LoaderCircle : asking ? MessageCircleQuestion : ArrowRight} tone={t.busy ? 'run' : asking ? 'wait' : 'run'}
                  title={t.busy ? 'The agent is working' : next ? TITLE[next](t) : 'Nothing waits on you'}
                  actions={<SectionHeadings.Provider value={false}><div className="space-y-3">{panelBody}</div></SectionHeadings.Provider>} />
      )}
      composer={!asking && !runAsks && <Composer>{steer}</Composer>}
      tabs={panes.map((p) => ({ id: p, label: p === 'overview' ? 'Overview' : p === 'ticket' ? 'Ticket' : role === 'design' ? 'Experience' : 'Domain', rail: p === 'overview' }))}
      tab={pane} onTab={setPane}
      onAsk={(q) => appendDraft(`ticket:${t.id}`, q)}
      vitals={(<>
          <WorkStrip work={work} here={`ticket:${t.id}`} toast={toast} onOpen={(k) => onOpenLinked(k.startsWith('pr:') ? { kind: 'pr', id: k.slice(3), label: work?.members.find((m) => m.key === k)?.label ?? k, title: work?.members.find((m) => m.key === k)?.title ?? '', agent: 'none' } : { kind: 'ticket', id: k.slice(7), label: k.slice(7), title: '', agent: 'none' })} />
          <Vitals shipping={<ShippingVital title={t.queued ? 'Queued' : t.busy ? 'The agent is working' : runAsks ? 'The agent asks you' : next ? TITLE[next](t) : 'All clear'} tone={t.busy ? 'run' : runAsks || asking ? 'wait' : next ? 'run' : 'ok'} busy={t.busy}
                                           at={t.busy ? 1 : next === 'run' ? (run ? 2 : 1) : next === 'dock' ? 2 : next ? 3 : 4}
                                           why={t.queued ? queuedText(t.queued) : t.busy ? [run?.phase && (PHASE_LABEL[run.phase] ?? run.phase), t.background ? `${t.background} running in the background` : ''].filter(Boolean).join(' · ') || undefined : !next ? 'Nothing waits on you here.' : undefined} />}
                  topics={{ target, d: talks.d, onChange: talks.set, onSteer: steerMain, onSteerPr: t.prs.length > 1 ? steerPr : undefined, toast }} />
      </>)}
      pane={pane === 'overview' ? <TicketOverview t={t} why={!t.busy && next ? TITLE[next](t) : undefined} onPr={openPr} onOpen={() => setPane('ticket')} onStack={props.onSelect} /> : pane === 'domain' ? <DomainView path={`/exec/tickets/${encodeURIComponent(t.id)}/domain`} focus={role === 'design' ? 'design' : 'product'} />
        : ticketBody}
    >
      <div className="flex items-center justify-between gap-3">
        {t.busy ? <span className="flex items-center gap-1.5 text-meta text-run"><span className="size-1.5 animate-pulse rounded-full bg-run" />live</span> : <span />}
        {count > 0 && <FeedMode />}
      </div>
      {siblings && <p className="rounded-xl bg-hover px-3 py-2 text-small text-fg-3">One run works {siblings.join(' → ')} together, so their activity is the same. A reply here goes to that run too.</p>}
      {run || all.length
        ? <ActivityFeed feed={all} live={t.busy} bg={run && { base: `/exec/${run.id}`, count: t.background }} toast={toast} />
        : <p className="py-6 text-center text-body text-fg-3">No run yet. Run starts the exec command on {t.id}, unattended.</p>}
    </ThreadLayout>
  )
}
