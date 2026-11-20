import {
  ArrowUpRight, Bot, Check, CircleAlert, Copy, Layers, DollarSign, EyeOff, FileDiff, GitPullRequest,
  Hourglass, LoaderCircle, MessageSquare, MessagesSquare, Play, Radio, RotateCcw, ShieldAlert, Square, SquareTerminal, Timer,
  TriangleAlert, Send, CheckCheck, X, Upload, Wand, Sparkles, type LucideIcon, Scale } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PinButton } from './PinButton.tsx'
import { ago, api, critUrl, duration, enc, focusWanted, isTyping, param, setParam, setReading, wantFocus, type Activity, type PrView, resumed } from '../lib.ts'
import { useDraft } from '../draft.ts'
import { useApi } from '../query.ts'
import { Chip } from './Chip.tsx'
import { ArmBar, ArmLabel, armedCls, useArm } from '../arm.tsx'
import { Working } from './Working.tsx'
import { type Sync } from './NextPanel.tsx'

// the graph libraries (React Flow, ELK, Mermaid) load only when the tab opens
import { Avatar } from './PrList.tsx'
import { StatusField, type StatusTone } from './DetailHeader.tsx'
import { LinkedPills } from './Linked.tsx'
import { StackNav, type NavItem } from './StackNav.tsx'
import type { Linked } from '../../server/index.ts'
import { statusMeta } from './StatusBadge.tsx'
import { Missing, missingTitle } from './Missing.tsx'
import type { FlowAction } from '../../server/flow.ts'

export const btn = 'group/btn inline-flex items-center gap-1.5 rounded-ctl px-3.5 py-2 text-body font-medium outline-none transition-[background-color,color,box-shadow,filter] duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40'
export const primary = 'group/btn inline-flex items-center gap-1.5 btn-primary btn-lg'
export const secondary = 'group/btn inline-flex items-center gap-1.5 btn-quiet btn-lg'
export const mini = 'inline-flex items-center gap-1 btn-ghost btn-sm'
export const ghost = 'group/btn inline-flex items-center gap-1.5 btn-ghost btn-lg'
const green = `${btn} bg-ok text-white shadow-e1 hover:bg-ok`

/** Marks the button that is the next step in the flow. */
export const NextTag = ({ tone = 'violet' }: { tone?: 'violet' | 'emerald' | 'zinc' }) => (
  <span aria-label="next step" className={`pointer-events-none absolute -right-1.5 -top-2 rounded-full px-1.5 text-micro font-bold uppercase leading-4 tracking-wider text-white shadow-sm ring-2 ring-white dark:ring-zinc-950 ${{ violet: 'bg-accent', emerald: 'bg-ok', zinc: 'bg-zinc-700' }[tone]}`}>next</span>
)

export const Kbd = ({ k, light }: { k: string; light?: boolean }) => (
  <kbd className={`ml-1 hidden rounded-md px-1.5 font-mono text-micro transition-opacity sm:inline ${light ? 'bg-white/20 text-white/90' : 'bg-fill text-fg-3'}`}>{k}</kbd>
)

function Stat({ icon: Icon, label, value, accent }: { icon: LucideIcon; label: string; value: number; accent: string }) {
  return (
    <div className="group/stat card px-3 py-2.5 transition-all duration-200 hover:shadow-md hover:ring-line-strong">
      <div className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-label text-fg-3">
        <Icon className={`size-3.5 opacity-60 transition-opacity duration-200 group-hover/stat:opacity-100 ${accent}`} aria-hidden />{label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight transition-transform duration-200 group-hover/stat:translate-x-0.5 ${value ? accent : 'text-fg-4'}`}>{value}</div>
    </div>
  )
}

const STEPS = ['Requested', 'Preparing', 'Ready', 'In review', 'Reviewed']
const STEPS_MINE = ['Feedback', 'Preparing', 'In crit', 'Fixing', 'All clear']

/** The pipeline: where the flow (server/flow.ts) says this PR is. The last step reached means every step is done. */


type Tab = 'explain' | 'turns' | 'activity' | 'description'
let lastTab: Tab | undefined

/** The PR's description, fetched when you open it (the live list leaves it out), again when the PR changes. */
export function Description({ pr }: { pr: PrView }) {
  // cached per PR and update: read again only when the PR changed
  const { data: b } = useApi<{ body: string; bodyHtml: string }>(pr.hasBody ? `/prs/${enc(pr.id)}/body?at=${pr.updatedAt}` : undefined, { staleTime: Infinity })
  if (!pr.hasBody) return <p className="px-5 py-10 text-center text-sm text-fg-3">No description.</p>
  if (!b) return <div className="flex justify-center py-10"><Timer className="size-5 animate-spin text-fg-3" /></div>
  // body_html is rendered and sanitized by GitHub, same as on github.com
  return b.bodyHtml
    ? <div className="prose px-5 py-4" dangerouslySetInnerHTML={{ __html: b.bodyHtml }} />
    : <p className="whitespace-pre-wrap break-words px-5 py-4 text-body leading-relaxed text-fg-2 ">{b.body}</p>
}

export type PrThreadProps = {
  ticket?: import('../lib.ts').TicketView // on the desk: the ticket this PR ships (the new design shows it as a tab)
  sync?: Sync
  compact?: boolean // on the desk: its row above already shows the stack
  onOpenLinked: (l: Linked) => void // the linked ticket, in Exec
  pr: PrView; feed: Activity[]; now: number; onBack: () => void; toast: (msg: string, tone?: 'ok' | 'error') => void
  prs: PrView[]; onSelect: (id: string) => void
}

/** Everything the PR page knows and can do, for either design to lay out: the flow's next step and its actions,
 *  the status chips, the agent's questions, the tabs' content and the dialogs. */
export function usePrThread({ pr, feed, now, onBack, toast: toastIn, prs, onSelect, sync, onOpenLinked, compact }: PrThreadProps) {
  const [copied, setCopied] = useState(false)
  // the Next button you just clicked: a spinner at once, until the PR's state moves (or it failed, or 20s passed)
  const [pending, setPending] = useState<FlowAction>()
  const toast = (msg: string, tone?: 'ok' | 'error') => { if (tone === 'error') setPending(undefined); toastIn(msg, tone) }
  const moved = `${pr.flow.state}|${pr.job?.state}|${pr.job?.queuedAt}|${pr.op?.state}|${pr.op?.at}`
  useEffect(() => setPending(undefined), [moved])
  useEffect(() => { if (!pending) return; const t = setTimeout(() => setPending(undefined), 20_000); return () => clearTimeout(t) }, [pending])
    const act = (path: string, ok: string) => api(`/prs/${enc(pr.id)}/${path}`, {}).then(resumed(ok, toast), (e: Error) => toast(e.message, 'error'))

  const url = critUrl(pr)
  const job = pr.job
  const crit = pr.crit
  const busy = pr.status === 'preparing' || pr.status === 'queued' || pr.status === 'posting'
  // a finished run whose crit session is no longer running: still mid-review, so offer the restart
  const critDown = !!job?.reviewDone && !busy && !!crit?.port && !!crit.sessionKey && !crit.live && pr.status !== 'reviewed' && pr.status !== 'clear'
  const [restarting, setRestarting] = useState(false)
  const restartCrit = () => {
    setRestarting(true)
    api(`/prs/${enc(pr.id)}/crit-restart`, {}).then(() => toast(`crit is back on :${crit!.port}`), (e: Error) => toast(e.message, 'error')).finally(() => setRestarting(false))
  }
  const [submit, setSubmit] = useState<{ event: 'COMMENT' | 'APPROVE'; drop?: boolean }>()
  // where this PR stands and what comes next: decided once, on the server (server/flow.ts), from the facts
  const flow = pr.flow
  const next = flow.next
  const asks = flow.state === 'asks'
  // its question is the next step: it leads the panel instead of a Do next that only points at it
  const askFirst = asks && !busy && next === 'answer'
  const waiting = pr.awaiting ?? pr.unresolved ?? 0
  // the fix round, in the same session: what the threads were classed as decides what gets done
  const fixThreads = () => api(`/prs/${enc(pr.id)}/reply`, {
    text: 'Apply the fixes for the threads you classed as fix, commit them locally, and draft a reply on every open thread (crit if it is running, otherwise in your final message). Do not push and do not post anything to GitHub: that waits for Push & reply.',
  }).then(() => toast('Fix round started'), (e: Error) => toast(e.message, 'error'))
  const resumeCmd = job && pr.repoPath ? `cd ${pr.repoPath} && claude --resume ${job.sessionId}` : undefined

  // the tab you were on carries over to the next PR
  const [tab, setTabState] = useState<Tab>(() => (param('tab') as Tab) ?? lastTab ?? (pr.explain ? 'explain' : job ? 'activity' : 'description'))
  const setTab = (t: Tab) => { lastTab = t; setTabState(t); setParam('tab', t) }
  // focus mode: reading Explain, the sidebars step back; any other tab (or leaving the PR) brings them back
  const [focus, setFocus] = useState(focusWanted)
  useEffect(() => { setReading(tab === 'explain' && focus); return () => setReading(false) }, [tab, focus])
  const toggleFocus = () => { wantFocus(!focus); setFocus(!focus) }
  // f: focus on and off; from another tab it opens Explain in focus
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'f' || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      e.preventDefault()
      if (tab !== 'explain') { setTab('explain'); if (!focus) toggleFocus() } else toggleFocus()
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })
  const tabBtn = (t: typeof tab, label: string, count?: number) => (
    <button onClick={() => setTab(t)} aria-selected={tab === t} role="tab"
            className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1 text-body font-medium transition-[color,background-color,box-shadow] duration-200 ${tab === t ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>
      {label}
      {count != null && <span className="rounded-full bg-hover px-1.5 text-micro tabular-nums text-fg-3">{count}</span>}
    </button>
  )

  const KIND = { review: 'Review', revise: 'Revise', approve: 'Approve', post: 'Post review', publish: 'Push & reply', reply: 'Your reply' }
  // status at a glance; each chip opens its details, so the content keeps the full width
  // stacked on a PR that moved: rebase onto it first (the one rewrite you approve), then push
  const below = pr.stack && pr.stack[pr.stack.findIndex((s) => s.number === pr.number) - 1]
  // the stack above this one is outdated after a push below: a smart rebase brings it up (the whole stack when it is all yours)
  const smartRebase = () => api(`/prs/${enc(pr.id)}/actions`, { action: 'smart-rebase', scope: pr.stack?.every((s) => s.author === pr.author.login) ? 'stack' : 'this' })
    .then(() => toast('Smart rebase started'), (e: Error) => toast(e.message, 'error'))
  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* what the agent left running on its own: first, so it is never missed */}
      {pr.behindBase && below && (
        <button onClick={smartRebase} title={`#${below.number} below moved past this branch since it was last rebased. Nothing was pushed here; a smart rebase brings it up.`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-wait/10 px-2.5 py-1 text-small font-medium text-wait-text ring-1 ring-wait/25 transition-colors hover:bg-wait/15">
          <Layers className="size-3.5" />Outdated: behind #{below.number} · Smart rebase
        </button>
      )}
      {/* crit, once it is part of this PR's flow: "not started" on an untouched PR says nothing */}
      {(crit?.port || crit?.live || job) && (
      <Chip icon={critDown ? CircleAlert : Radio} pulse={crit?.live} tone={crit?.live ? 'emerald' : critDown ? 'amber' : 'zinc'}
            label={crit?.live ? <>crit :{crit.port}{crit.unresolved ? ` · ${crit.unresolved} unresolved` : ''}</> : critDown ? 'crit' : crit?.port ? 'crit stopped' : 'crit not started'}>
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={Bot} label="AI findings" value={crit?.aiComments ?? 0} accent="text-accent-text" />
          <Stat icon={MessageSquare} label="Your notes" value={crit?.myComments ?? 0} accent="text-run-text" />
          <Stat icon={Hourglass} label="Unresolved" value={crit?.unresolved ?? 0} accent="text-wait-text" />
          <Stat icon={Check} label="Finishes" value={crit?.finishes ?? 0} accent="text-ok-text" />
        </div>
        {crit?.lastFinish && (
          <p className="mt-3 text-small text-fg-3">
            Last Finish Review {ago(crit.lastFinish.at, now)} · {crit.lastFinish.approved ? 'approved' : `${crit.lastFinish.unresolved} unresolved`}
          </p>
        )}
        {/* crit went down while the review still needs it: the header shows one glyph, and the way back is here */}
        {critDown && <>
          <p className="mt-3 text-small text-fg-3">crit stopped while the review still needs it. Your comments are kept.</p>
          <button onClick={restartCrit} disabled={restarting} className="mt-2.5 inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-small font-medium text-wait-text ring-1 ring-wait/30 transition-colors hover:bg-wait/10 disabled:opacity-50">
            {restarting ? <Timer className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{restarting ? 'Starting…' : 'Restart crit'}
          </button>
        </>}
      </Chip>
      )}

      {job && (
        <Chip icon={job.error ? TriangleAlert : job.denials?.length ? ShieldAlert : Bot} tone={job.error ? 'rose' : job.denials?.length ? 'amber' : 'zinc'}
              label={<>{KIND[job.kind]} · {job.state}{job.endedAt ? ` · ${duration(job.startedAt, job.endedAt)}` : ''}{job.costUsd != null ? ` · $${job.costUsd.toFixed(2)}` : ''}</>}>
          <dl className="space-y-2 text-small">
            <Meta label="Last action">{KIND[job.kind]} · {job.state}</Meta>
            <Meta label="Duration"><span className="flex items-center gap-1 font-mono tabular-nums"><Timer className="size-3.5 text-fg-3" />{duration(job.startedAt, job.endedAt) || '–'}</span></Meta>
            {job.costUsd != null && <Meta label="Cost"><span className="flex items-center gap-0.5 font-mono tabular-nums"><DollarSign className="size-3.5 text-fg-3" />{job.costUsd.toFixed(2)}</span></Meta>}
            <Meta label="Session">
              <button onClick={() => resumeCmd && navigator.clipboard.writeText(resumeCmd).then(() => { setCopied(true); toast('Resume command copied'); setTimeout(() => setCopied(false), 1500) })}
                      className="group/sid flex items-center gap-1 font-mono text-fg-2 transition-colors hover:text-accent-text" title="Copy resume command">
                {job.sessionId.slice(0, 8)}{copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 opacity-0 transition-opacity group-hover/sid:opacity-100" />}
              </button>
            </Meta>
          </dl>
          {job.error && <p className="mt-3 flex items-start gap-2 rounded-xl bg-fail/10 px-3 py-2 text-small text-fail-text ring-1 ring-fail/30"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{job.error}</p>}
          {!!job.denials?.length && (
            <p title={job.refused?.join('\n')} className="mt-3 flex items-start gap-2 rounded-xl bg-wait/10 px-3 py-2 text-small text-wait-text ring-1 ring-wait/30">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>Denied {job.denials.length}×: {[...new Set(job.denials)].join(', ')}{job.refused?.[0] && <> (first: <code className="font-mono text-meta">{job.refused[0].slice(0, 120)}</code>)</>}. The Activity tab shows each one where it happened; add what's needed to the allowlist in Settings.</span>
            </p>
          )}
        </Chip>
      )}

      {pr.op && (
        <Chip icon={pr.op.state === 'running' ? LoaderCircle : pr.op.state === 'failed' ? TriangleAlert : Check} pulse={pr.op.state === 'running'}
              tone={pr.op.state === 'failed' ? 'rose' : pr.op.state === 'done' ? 'emerald' : 'zinc'}
              label={<>{pr.op.label.replace(/ \(.*\)$/, '')} · {pr.op.state === 'running' ? 'running' : pr.op.state === 'done' ? (pr.op.result && pr.op.result.length <= 28 ? pr.op.result : 'done') : 'failed'}</>}>
          <p className="text-small font-medium">{pr.op.label}</p>
          <p className="mt-1 text-small text-fg-3">{pr.op.state === 'running' ? `Started ${ago(pr.op.at, now)}. The Activity tab follows it.` : `${pr.op.result} · ${ago(pr.op.endedAt, now)}`}</p>
        </Chip>
      )}
      {/* an explanation being written is visible wherever you are, not only in the Explain tab */}
      {(pr.explain?.state === 'running' || pr.explain?.state === 'queued') && (
        <Chip icon={Sparkles} pulse tone="zinc" label={pr.explain.state === 'queued' ? 'Explain · queued' : `Explaining · ${/^Running\b|[/~]\w/.test(pr.explain.step ?? '') ? 'reading the code' : (pr.explain.step ?? 'working').toLowerCase()}`}>
          <p className="text-small text-fg-2 ">{pr.explain.state === 'queued' ? 'Waiting its turn (a PR below it in the stack goes first, or the parallel limit is reached).' : 'The explanation is being written; the Explain tab shows the previous one meanwhile.'}</p>
          <button onClick={() => setTab('explain')} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-small font-medium text-accent-text ring-1 ring-accent/30 hover:bg-accent/10">Open Explain</button>
        </Chip>
      )}
      {/* NORM findings (review-exchange): where it departs from a written convention; advisory, never blocking */}
      {!!pr.crit?.drift && (
        <Chip icon={Scale} tone="zinc" label={`${pr.crit.drift} drift${pr.crit.drift === 1 ? '' : 's'}`}>
          <p className="text-small text-fg-2">The review found {pr.crit.drift === 1 ? 'a place' : `${pr.crit.drift} places`} where this departs from how its libraries, its language or the house write things down. Advisory: none of it blocks.</p>
          <button onClick={() => { setParam('view', 'norms'); setTab('explain') }} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-small font-medium text-accent-text ring-1 ring-accent/30 hov">Open Norms</button>
        </Chip>
      )}
      <Chip icon={FileDiff} tone={pr.mine && (pr.awaiting ?? pr.unresolved) ? 'amber' : 'zinc'}
            label={<>{pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'} <span className="text-ok-text">+{pr.additions}</span> <span className="text-fail-text">−{pr.deletions}</span>{pr.mine && pr.unresolved ? ` · ${pr.awaiting ?? pr.unresolved} to answer${pr.awaiting != null && pr.awaiting < pr.unresolved ? ` of ${pr.unresolved} open` : ''}` : ''}</>}>
        <dl className="space-y-2 text-small">
          <Meta label="Author">
            <a href={`https://github.com/${pr.author.login}`} target="_blank" rel="noreferrer" className="group/author flex items-center gap-1.5">
              <Avatar src={pr.author.avatar} className="size-4.5 transition-transform group-hover/author:scale-110" />
              <span className="font-medium transition-colors group-hover/author:text-accent-text">{pr.author.login}</span>
            </a>
          </Meta>
          <Meta label="Opened">{ago(pr.createdAt, now)}</Meta>
          <Meta label="Updated">{ago(pr.updatedAt, now)}</Meta>
          <Meta label="Base"><span className="rounded-md bg-fill px-1.5 py-0.5 font-mono">{pr.base}</span></Meta>
          <Meta label="Head"><span className="block max-w-[180px] truncate rounded-md bg-fill px-1.5 py-0.5 font-mono" title={pr.head}>{pr.head}</span></Meta>
          {pr.mine ? (
            <>
              <Meta label="Unresolved threads"><span className={pr.unresolved ? 'font-semibold text-wait-text' : ''}>{pr.unresolved ?? 0}</span></Meta>
              <Meta label="Decision">{pr.reviewDecision ? pr.reviewDecision.toLowerCase().replace(/_/g, ' ') : 'no reviews yet'}</Meta>
            </>
          ) : (
            <>
              <Meta label="Your review">{pr.myReview ? `${pr.myReview.state.toLowerCase().replace('_', ' ')} ${ago(pr.myReview.submittedAt, now)}` : 'none yet'}</Meta>
              <Meta label="Request">{pr.requested ? 'pending on you' : 'cleared on GitHub'}</Meta>
            </>
          )}
        </dl>
      </Chip>
    </div>
  )

  const runFinalize = () => act('run', 'Revise queued: it brings the last comments into crit')
  const { armed, arm } = useArm()
  const publish = () => arm('publish', () => act('publish', 'Publishing: the agent is pushing and replying'))
  const publishRebased = () => arm('publish-rebased', () => api(`/prs/${enc(pr.id)}/publish`, { rebaseFirst: true }).then(resumed('Rebasing onto the PR below, then pushing and replying', toast), (e: Error) => toast(e.message, 'error')))
  const big = 'w-full justify-center py-2.5'
  const linkCls = 'hover:text-accent-text'
  // a failed tool run: the same run again (same scope), or put it away
  const retryOp = () => pr.op && api(`/prs/${enc(pr.id)}/actions`, { action: pr.op.action, scope: pr.op.scope ?? 'this' }).then((r: { count?: number }) => toast(r.count === 0 ? 'Already aligned: nothing to do' : `${pr.op!.label}: started again`), (e: Error) => toast(e.message, 'error'))
  const markRead = () => api(`/prs/${enc(pr.id)}/read`, {}).then(() => toast('Nothing waits on you there now'), (e: Error) => toast(e.message, 'error'))
  const dismissOp = () => api(`/prs/${enc(pr.id)}/op/dismiss`, {}).catch(() => {})
  const rerequest = () => arm('rerequest', () => api(`/prs/${enc(pr.id)}/rerequest`, {}).then(() => toast(`Asked ${pr.reviewers!.join(', ')} to review again`), (e: Error) => toast(e.message, 'error')))
  const retry = () => job?.kind === 'publish' ? publish() : job?.kind === 'post' || job?.kind === 'approve' ? setSubmit({ event: job.kind === 'approve' ? 'APPROVE' : 'COMMENT' }) : act('run', pr.mine ? 'Revise queued' : 'Review queued')
  const go = (a: FlowAction, fn: () => unknown) => () => { if (!((a === 'publish' || a === 'rerequest') && armed !== a)) setPending(a); void fn() }
  // each action the flow can name: its main button, and its quiet "Also:" link
  const BIG: Partial<Record<FlowAction, ReactNode>> = {
    cancel: <button className={`${secondary} ${big} hover:text-fail-text`} onClick={() => act('cancel', 'Cancelled')}><Square className="size-3.5 fill-current" />Cancel</button>,
    retry: <button className={`${primary} ${big}`} onClick={go('retry', retry)}><RotateCcw className="size-4" />Try again</button>,
    crit: <a href={url} target="_blank" rel="noreferrer" className={`${primary} ${big}`}><MessagesSquare className="size-4" />{pr.mine ? 'Fix in crit' : 'Review in crit'}</a>,
    fix: <button className={`${primary} ${big}`} onClick={go('fix', fixThreads)}><Wand className="size-4" />Fix the {waiting === 1 ? 'thread' : `${waiting} threads`}</button>,
    publish: <>
      <button className={`${green} ${big} ${armed === 'publish' ? armedCls : ''}`} onClick={go('publish', publish)}><Upload className="size-4" />{armed === 'publish' ? <ArmLabel>Confirm push &amp; reply</ArmLabel> : 'Push & reply'}{armed === 'publish' && <ArmBar />}</button>
      {pr.behindBase && below && (
        <button className={`${secondary} ${big} ${armed === 'publish-rebased' ? armedCls : ''}`} onClick={publishRebased}
                title={`#${below.number} below moved past this branch. Rebase onto it first (a force-push with lease of this branch only), then push and reply.`}>
          <Layers className="size-4" />{armed === 'publish-rebased' ? <ArmLabel>Confirm rebase &amp; push</ArmLabel> : `Rebase on #${below.number}, then push`}{armed === 'publish-rebased' && <ArmBar />}
        </button>
      )}
    </>,
    post: <Findings pr={pr} critUrl={url} onSubmit={(event, drop) => setSubmit({ event, drop })} onRestartCrit={critDown ? restartCrit : undefined} />,
    finalize: <button className={`${primary} ${big}`} onClick={go('finalize', runFinalize)} disabled={!!pr.missing.length} title={pr.missing.length ? missingTitle(pr.missing) : undefined}><Wand className="size-4" />Finish the last {waiting === 1 ? 'comment' : `${waiting} comments`}</button>,
    run: <button className={`${primary} ${big}`} onClick={go('run', () => act('run', pr.mine ? 'Revise queued' : 'Review queued'))} disabled={!!pr.missing.length} title={pr.missing.length ? missingTitle(pr.missing) : undefined}>{pr.mine ? <><Wand className="size-4" />{job ? 'Revise the new feedback' : 'Run revise'}</> : <><Play className="size-4 fill-current" />{job ? 'Review the new push' : 'Run review'}</>}</button>,
    merge: <a href={pr.url} target="_blank" rel="noreferrer" className={`${green} ${big}`}><GitPullRequest className="size-4" />Merge on GitHub</a>,
    rerequest: pr.reviewers?.length ? <button className={`${primary} ${big} ${armed === 'rerequest' ? armedCls : ''}`} onClick={go('rerequest', rerequest)}><Send className="size-4" />{armed === 'rerequest' ? <ArmLabel>{`Confirm: ask ${pr.reviewers.join(', ')}`}</ArmLabel> : `Ask ${pr.reviewers.join(', ')} to re-review`}{armed === 'rerequest' && <ArmBar />}</button> : null,
    'restart-crit': <button className={`${secondary} ${big}`} onClick={go('restart-crit', restartCrit)}><RotateCcw className="size-4" />Restart crit</button>,
    'retry-op': pr.op && <button className={`${primary} ${big}`} onClick={go('retry-op', retryOp)}><RotateCcw className="size-4" />Try {pr.op.label.replace(/ \(.*\)$/, '').toLowerCase()} again</button>,
  }
  // while one is starting, the main button says so (in both the panel and the thread's Next card)
  const STARTING: Partial<Record<FlowAction, string>> = { fix: 'Starting the fix round', run: pr.mine ? 'Starting the revise' : 'Starting the review', finalize: 'Starting', retry: 'Starting again', 'retry-op': 'Starting again', publish: 'Pushing and replying', rerequest: 'Asking them', 'restart-crit': 'Restarting crit' }
  if (pending && next && BIG[next] !== undefined) BIG[next] = <button disabled aria-busy className={`${primary} ${big} cursor-wait opacity-90`}><LoaderCircle className="size-4 animate-spin" />{STARTING[pending] ?? 'Starting'}…</button>
  const LINK: Partial<Record<FlowAction, ReactNode>> = {
    crit: url && <a key="crit" href={url} target="_blank" rel="noreferrer" className={linkCls}>Open crit</a>,
    fix: <button key="fix" className={linkCls} onClick={go('fix', fixThreads)}>Fix the threads</button>,
    publish: <button key="publish" className={armed === 'publish' ? 'font-semibold text-accent-text' : linkCls} onClick={publish}>{armed === 'publish' ? <ArmLabel>Confirm push &amp; reply</ArmLabel> : 'Push & reply'}</button>,
    post: <button key="post" className={linkCls} onClick={() => setSubmit({ event: 'COMMENT' })}>Post review</button>,
    'restart-crit': <button key="rc" className={linkCls} onClick={restartCrit}>Restart crit to go through them yourself</button>,
    'dismiss-op': <button key="dismiss" className={linkCls} onClick={dismissOp}>Dismiss</button>,
    read: <button key="read" className={linkCls} onClick={markRead} title="None of it needs an answer (a status note): it stops waiting on you, without a run">Nothing to answer</button>,
    run: <button key="run" className={linkCls} onClick={go('run', () => act('run', pr.mine ? 'Revise queued' : 'Review queued'))}>{pr.mine ? 'Revise' : 'Review'}</button>,
    finalize: <button key="finalize" className={linkCls} onClick={go('finalize', runFinalize)}>Finish the last comments</button>,
    merge: <a key="merge" href={pr.url} target="_blank" rel="noreferrer" className={linkCls}>Merge on GitHub</a>,
  }
  const also = flow.also.map((a) => LINK[a]).filter(Boolean)
  const alsoLine = also.length > 0 && <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-small text-fg-3"><span className="text-fg-3">Also:</span>{also.flatMap((x, i) => (i ? [<span key={`d${i}`} className="text-fg-4">·</span>, x] : [x]))}</p>
  const doNext = (
    <div className="space-y-2">
      {(next === 'run' || next === 'finalize') && <Missing names={pr.missing} />}
      {next === 'cancel' && <Working why={pr.waiting ? `Waiting for ${pr.waiting.label}: ${pr.waiting.why}${pr.waiting.until ? ` until ${new Date(pr.waiting.until).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Another account takes it if one is set to stand in (Settings → Agents).` : flow.why} feed={feed} onStop={() => act('cancel', 'Stopped')} bg={{ base: `/prs/${enc(pr.id)}`, count: pr.background }} toast={toast} />}
      {next && next !== 'answer' && next !== 'cancel' && BIG[next]}
      {next !== 'cancel' && next !== 'post' && <p className={next === 'answer' || !next ? 'text-body leading-relaxed text-fg-2 ' : 'text-small text-fg-3'}>{flow.why}</p>}
      {alsoLine}
    </div>
  )
  const statusField = (() => {
              const m = statusMeta(pr.status, pr.mine)
              const tone = ({ fail: 'rose', run: 'blue', ok: 'emerald', wait: 'amber', idle: 'zinc' } as const satisfies Record<string, StatusTone>)[m.kind]
              const steps = pr.mine ? STEPS_MINE : STEPS
              return <StatusField label={m.label + (pr.status === 'approved' && pr.awaiting ? ` · ${pr.awaiting} to answer` : '')} icon={m.icon} spin={m.spin} tone={tone}
                                  steps={steps} at={flow.step >= 4 ? steps.length : flow.step} broken={flow.broken} />
            })()
  const parentLinks = <>
              <LinkedPills linked={pr.linked} onOpen={onOpenLinked} />
              <a href={pr.url} target="_blank" rel="noreferrer" title="Open on GitHub (g)" className="group/link inline-flex items-center gap-0.5 font-mono transition-colors hover:text-accent-text">
                {pr.repo.split('/')[1]}#{pr.number}<ArrowUpRight className="size-3.5 -translate-x-0.5 opacity-0 transition-all group-hover/link:translate-x-0 group-hover/link:opacity-100" />
              </a>
              {pr.draft && <span className="rounded-full bg-fill px-2 py-0.5 text-meta font-medium text-fg-2 ">Draft</span>}
            </>
  const stackNav = pr.stack && !compact ? <StackNav keys items={stackItems(pr, prs)} current={pr.id} onOpen={(x) => (x.url && !prs.some((p) => p.id === x.id) ? window.open(x.url, '_blank', 'noreferrer') : onSelect(x.id))} /> : undefined
  const headerActions = <>
                <PinButton pinKey={`pr:${pr.id}`} on={pr.pinned} className={`${mini} px-1.5`} toast={toast} />
                <a href={url} target="_blank" rel="noreferrer" aria-disabled={!url} title={url ? 'Open crit (o)' : 'crit is not running for this PR'}
                   className={`${mini} ${url ? '' : 'pointer-events-none opacity-40'}`}><MessagesSquare className="size-3.5" /><span className="hidden sm:inline">crit</span></a>
                <button className={mini} disabled={!resumeCmd} onClick={() => act('resume-terminal', 'Opened the session in Terminal')}
                        title={resumeCmd ? 'Open the agent session in Terminal (r)' : 'No agent session yet'}><SquareTerminal className="size-3.5" /><span className="hidden sm:inline">Resume</span></button>
                <a href={pr.url} target="_blank" rel="noreferrer" className={mini} title="Open on GitHub (g)"><GitPullRequest className="size-3.5" /><span className="hidden sm:inline">GitHub</span></a>
                <button className={`${mini} px-1.5`} onClick={() => act('dismiss', 'Hidden until requested again')} title="Hide until it is requested again" aria-label="Dismiss"><EyeOff className="size-3.5" /></button>
            </>
  const people = <People pr={pr} />
  return { statusField, parentLinks, stackNav, headerActions, people, pr, feed, now, onBack, toast, prs, onSelect, sync, onOpenLinked, compact, act, copied, setCopied, url, job, crit, busy, critDown, restarting, setRestarting, restartCrit, submit, setSubmit, flow, next, asks, askFirst, waiting, fixThreads, resumeCmd, tab, setTabState, setTab, focus, setFocus, toggleFocus, tabBtn, KIND, below, smartRebase, chips, runFinalize, armed, arm, publish, publishRebased, big, linkCls, retryOp, markRead, dismissOp, rerequest, retry, BIG, LINK, also, alsoLine, doNext }
}


export const Meta = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-3">
    <dt className="shrink-0 text-fg-3">{label}</dt>
    <dd className="min-w-0 text-right text-fg-2 ">{children}</dd>
  </div>
)

/**
 * A review that is ready: what to do with its findings is the decision. One verdict is suggested (by default a blocking
 * finding goes up as comments, else approve; Settings → General changes that) as the button to press, the others
 * offered beside it. Each says what it publishes; the dialog that follows confirms it before anything reaches GitHub.
 */
function Findings({ pr, critUrl, onSubmit, onRestartCrit }: {
  pr: PrView; critUrl?: string; onSubmit: (event: 'COMMENT' | 'APPROVE', drop?: boolean) => void; onRestartCrit?: () => void
}) {
  const k = pr.crit?.aiComments ?? 0, b = pr.crit?.blocking ?? 0
  type Pick = { id: 'comment' | 'approve' | 'approve-quiet'; icon: LucideIcon; title: string; sub: string; go: () => void; tone: string }
  const picks: Pick[] = [
    { id: 'comment', icon: Send, title: k ? `Post ${k === 1 ? 'it' : `the ${k}`} as comments` : 'Post a note', sub: k ? 'A comment review: your note first, each finding on its line. No verdict.' : 'A comment review with your note, no verdict.', go: () => onSubmit('COMMENT', !k), tone: 'text-accent-text' },
    { id: 'approve', icon: CheckCheck, title: k ? 'Approve, with the findings' : 'Approve', sub: k ? 'Approves and posts the findings as comments for the author.' : 'Nothing to flag: approve, with a note if you like.', go: () => onSubmit('APPROVE'), tone: 'text-ok' },
    ...(k ? [{ id: 'approve-quiet' as const, icon: Check, title: 'Approve without them', sub: 'Approves with only your note. The findings stay in crit, unposted.', go: () => onSubmit('APPROVE', true), tone: 'text-fg-3' }] : []),
  ]
  const reason = !k ? 'The review found nothing to flag.' : b ? `${b} of the ${k} ${b === 1 ? 'is' : 'are'} blocking: the author should change ${b === 1 ? 'it' : 'them'} before merge.` : `None of the ${k} is blocking.`
  const row = 'group flex w-full items-center gap-3 rounded-ctl px-3 py-1.5 text-left transition-colors duration-150 hov'
  return (
    <div className="space-y-2">
      {/* what the review found; which of these to take is yours, or the review skill's next steps say */}
      <p className="px-1 text-meta text-fg-3">{reason}</p>
      <div>
        {picks.map((x) => (
          <button key={x.id} onClick={x.go} title={x.sub} className={row}>
            <x.icon className={`size-4 shrink-0 ${x.tone}`} />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-fg-1">{x.title}</span>
          </button>
        ))}
        {k > 0 && (critUrl
          ? <a href={critUrl} target="_blank" rel="noreferrer" title="Resolve, edit or add comments, then come back to post." className={row}><MessagesSquare className="size-4 shrink-0 text-fg-3" /><span className="min-w-0 flex-1 truncate text-body font-medium text-fg-1">Go through them in crit first</span><ArrowUpRight className="size-3.5 shrink-0 text-fg-4" /></a>
          : onRestartCrit && <button onClick={onRestartCrit} title="Your comments are kept." className={row}><RotateCcw className="size-4 shrink-0 text-fg-3" /><span className="min-w-0 flex-1 truncate text-body font-medium text-fg-1">Restart crit to go through them</span></button>)}
      </div>
    </div>
  )
}

const VERDICT = {
  APPROVED: { label: 'approved', badge: 'bg-ok', icon: Check },
  CHANGES_REQUESTED: { label: 'asked for changes', badge: 'bg-fail', icon: X },
  COMMENTED: { label: 'commented', badge: 'bg-fg-4', icon: MessageSquare },
  REQUESTED: { label: 'asked to review, not yet', badge: 'bg-wait', icon: Hourglass },
} as const

/** Who it waits on, as faces: on yours, each reviewer with a badge for their latest word; on theirs, its author. */
export function People({ pr }: { pr: PrView }) {
  const face = (who: string) => `https://github.com/${encodeURIComponent(who)}.png?size=64`
  if (!pr.mine) return (
    <a href={`https://github.com/${pr.author.login}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-small text-fg-3 transition-colors hov hover:text-fg-1" title={`Opened by ${pr.author.login}`}>
      <img src={pr.author.avatar} alt="" className="size-5 rounded-full ring-1 ring-line" />{pr.author.login}
    </a>
  )
  const v = pr.verdicts ?? []
  if (!v.length) return null
  const done = v.filter((x) => x.state === 'APPROVED').length
  return (
    <span className="flex items-center gap-2" title={v.map((x) => `${x.who}: ${VERDICT[x.state].label}`).join('\n')}>
      <span className="flex -space-x-1.5">
        {v.slice(0, 6).map((x) => {
          const m = VERDICT[x.state]
          return (
            <a key={x.who} href={`https://github.com/${x.who}`} target="_blank" rel="noreferrer" className="relative transition-transform duration-150 hover:z-10 hover:-translate-y-0.5">
              <img src={face(x.who)} alt={x.who} className={`size-6 rounded-full ring-2 ring-surface-1 ${x.state === 'REQUESTED' ? 'opacity-60 grayscale' : ''}`} />
              <span className={`absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full ring-2 ring-surface-1 ${m.badge}`}><m.icon className="size-2 text-white" strokeWidth={3.5} /></span>
            </a>
          )
        })}
      </span>
      <span className="text-small tabular-nums text-fg-3">{done}/{v.length} approved</span>
    </span>
  )
}

export function SubmitDialog({ pr, event, drop, onClose, toast }: {
  pr: PrView; event: 'COMMENT' | 'APPROVE'; drop?: boolean; onClose: () => void; toast: (msg: string, tone?: 'ok' | 'error') => void
}) {
  const [note, setNote] = useDraft(`submit:${pr.id}`)
  const [gif, setGif] = useState('')
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)
  const approve = event === 'APPROVE'
  const findings = pr.crit?.aiComments ?? 0
  const send = () => {
    setSending(true)
    api(`/prs/${enc(pr.id)}/submit`, { event, note, gif, findings: drop ? 'drop' : 'post' })
      .then(() => { toast(approve ? 'Approving: the agent is posting it now' : 'Posting: the agent is submitting the review'); onClose() },
            (e: Error) => { toast(e.message, 'error'); setSending(false) })
  }
  const field = 'w-full rounded-xl bg-fill/60 px-3 py-2 text-body outline-none ring-1 ring-line transition-all placeholder:text-fg-3 hover:ring-line-strong focus:bg-surface-1 focus:ring-2 focus:ring-accent/60'

  return (
    <dialog ref={(d) => { ref.current = d; if (d && !d.open) d.showModal() }} onClose={onClose}
            onClick={(e) => e.target === ref.current && ref.current?.close()}
            className="m-auto w-[min(520px,calc(100vw/var(--z)-32px))] animate-[toast-in_200ms_var(--ease-snappy)] rounded-2xl bg-surface-1 p-0 text-fg-1 shadow-2xl ring-1 ring-line backdrop:bg-zinc-950/40 backdrop:backdrop-blur-sm ">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); send() }} className="space-y-4 p-5">
        <header className="flex items-start gap-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${approve ? 'bg-ok/10 text-ok-text' : 'bg-accent/10 text-accent-text'}`}>
            {approve ? <CheckCheck className="size-5" /> : <Send className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{approve ? (drop && findings ? 'Approve without the findings' : 'Approve') : drop ? 'Post a note' : 'Post review'} · #{pr.number}</h2>
            <p className="mt-0.5 text-body text-fg-3">
              {drop || !findings ? <>Only your note goes to GitHub{approve ? ', as an approval' : ', as a comment review'}.{findings > 0 && ` The ${findings} finding${findings === 1 ? '' : 's'} stay in crit.`}</>
                : <>The agent tidies the {findings} crit finding{findings === 1 ? '' : 's'} plus your notes, then submits them to GitHub{approve ? ' as an approval' : ' as a comment review'}.</>}
            </p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg p-1 text-fg-3 transition-colors hov hover:text-fg-2" aria-label="Close"><X className="size-4" /></button>
        </header>
        <label className="block space-y-1.5">
          <span className="text-small font-medium text-fg-2">Your note <span className="font-normal text-fg-3">(optional, opens the review body)</span></span>
          <textarea autoFocus rows={4} maxLength={4000} required={drop && !approve} value={note} onChange={(e) => setNote(e.target.value)} className={`${field} resize-y`}
                    placeholder={approve ? 'Looks good, nice cleanup of the budget section.' : 'A few things to look at before this goes in.'} />
        </label>
        {approve && (
          <label className="block space-y-1.5">
            <span className="text-small font-medium text-fg-2">GIF URL <span className="font-normal text-fg-3">(optional)</span></span>
            <input type="url" pattern="https://.*" value={gif} onChange={(e) => setGif(e.target.value)} className={field} placeholder="https://media.giphy.com/…" />
          </label>
        )}
        <footer className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={() => ref.current?.close()} className={ghost}>Cancel</button>
          <button type="submit" disabled={sending} className={approve
            ? `${btn} bg-ok text-white shadow-sm`
            : primary}>
            {sending ? <LoaderCircle className="size-4 animate-spin" /> : approve ? <CheckCheck className="size-4" /> : <Send className="size-4" />}
            {approve ? 'Approve on GitHub' : 'Post to GitHub'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

/** The stack this PR sits in, bottom to top, as StackNav rows: the tracked ones with how they stand; the rest open GitHub. */
export function stackItems(pr: PrView, prs: PrView[]): NavItem[] {
  const tracked = new Map(prs.map((p) => [`${p.repo}#${p.number}`, p]))
  return pr.stack!.map((s) => {
    const t = tracked.get(`${s.repo}#${s.number}`), m = t && statusMeta(t.status, t.mine)
    return { id: t?.id ?? `${s.repo}#${s.number}`, kind: 'pr' as const, ref: `#${s.number}`, title: s.title, url: s.url,
      dot: m?.dot ?? 'bg-fill-strong', state: m?.label ?? 'not requested from you; opens GitHub', threads: t?.mine ? t.unresolved : undefined }
  })
}

const TURN = {
  changed: { label: 'Changed', tone: 'text-accent-text bg-accent/10' },
  held: { label: 'Held', tone: 'text-wait-text bg-wait/10' },
  dropped: { label: 'Dropped', tone: 'text-fg-2 bg-fg-3/10 ' },
} as const

/** How the PR changed direction, push by push, newest first: a few words a line, and whose ask it answers. */
export function Turns({ pr }: { pr: PrView }) {
  type T = { at: string; to: string; lines: { kind: keyof typeof TURN; text: string; who?: string; url?: string }[] }
  // cached per push: they only change when it does
  const q = useApi<{ turns: T[] }>(`/prs/${enc(pr.id)}/turns?at=${pr.headSha}`, { staleTime: Infinity })
  const turns = q.data?.turns ?? (q.isError ? [] : undefined)
  if (!turns) return null
  if (!turns.length) return <p className="px-5 py-6 text-small text-fg-3">No turns yet. Each push after a review lists here what changed direction, what was held and what was dropped.</p>
  return (
    <ol className="space-y-4 px-5 py-4">
      {turns.map((t) => (
        <li key={t.at}>
          <p className="text-meta text-fg-3"><span className="font-mono">{t.to.slice(0, 7)}</span> · {new Date(t.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          <ul className="mt-1.5 space-y-1">
            {t.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2 text-body text-fg-1 ">
                <span className={`w-[58px] shrink-0 rounded-md px-1.5 py-px text-center text-micro font-semibold ${TURN[l.kind].tone}`}>{TURN[l.kind].label}</span>
                <span className="min-w-0">{l.text}{l.who && <> · {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="text-fg-3 hover:text-accent-text hover:underline">{l.who}</a> : <span className="text-fg-3">{l.who}</span>}</>}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
