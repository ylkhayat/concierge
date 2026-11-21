import { optionsOf, pendingOf } from '../../server/reply.ts'
import {
  LoaderCircle, ListChecks, Moon,  MessageSquare,  ArrowRight,  ArrowUpRight, Bot, Check, Copy, DollarSign, GitPullRequest,
  ChevronDown, ChevronUp, Database, FileText, SearchCheck, MessageCircleQuestion, Play, Reply, Wand, RotateCcw, ShieldAlert, SquareTerminal, Timer, TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { PinButton } from './PinButton.tsx'
import { api, duration, param, setParam, type Activity, type ExecView, type TicketView, resumed } from '../lib.ts'
import { useDraft } from '../draft.ts'
import { Md } from './Md.tsx'
import { Pick } from '../ui/Pick.tsx'
import { Chip } from './Chip.tsx'
import { NextSteps } from './NextSteps.tsx'
import { Working } from './Working.tsx'
import { ArmBar, ArmLabel, armedCls, useArm } from '../arm.tsx'
import { PanelSection, type Sync } from './NextPanel.tsx'
import { groupOf, PHASE_LABEL, PRIORITY } from './ExecList.tsx'
import { Meta, mini, primary, secondary } from './PrDetail.tsx'
import { Missing, missingTitle } from './Missing.tsx'
import { ciLabel, ciTone, PrStack } from './PrStack.tsx'
import { StackNav, type NavItem } from './StackNav.tsx'
import { stamp } from '../time.ts'
import { ConnectCard } from './ConnectCard.tsx'
import { VpnCard } from './VpnCard.tsx'
import { StatusField, type StatusTone } from './DetailHeader.tsx'
import type { Linked } from '../../server/index.ts'

const STEPS = ['picked', 'evidence', 'implementing', 'checking', 'self-review', 'opening-pr', 'done'] as const
const STEP_LABEL: Record<string, string> = { picked: 'Picked', evidence: 'Evidence', implementing: 'Implement', checking: 'Checks', 'self-review': 'Self-review', 'opening-pr': 'PR', done: 'Done' }

/** Where a ticket stands in the exec steps: the step it is at (past the end: done), and whether it is stuck there. */
function stageOf(t: TicketView): { at: number; broken: boolean } {
  const run = t.run
  const out = run?.outcomes[t.id]?.outcome
  // its own phase, else the run's, else what Linear says
  const raw = run?.phases[t.id] ?? (run && (run.state === 'running' || run.state === 'done') ? run.phase : undefined)
  // an action run (an investigation…) ending isn't the ticket being done: it stays at evidence
  const phase = run?.label && raw === 'done' && out !== 'shipped' ? 'evidence' : raw
  // tend: the PR is open but needs its author (red CI or open threads), so it stops at PR, flagged
  const tend = t.bucket === 'tend' && !t.busy
  const at = tend ? STEPS.indexOf('opening-pr')
    : out === 'shipped' || t.bucket === 'shipped' ? STEPS.length
    : phase ? (phase === 'done' ? STEPS.length : STEPS.indexOf(phase as typeof STEPS[number])) : t.busy ? 0 : 0
  return { at, broken: tend || out === 'failed' || out === 'refined' || run?.state === 'failed' }
}
const GROUP_TONE: Record<string, StatusTone> = { running: 'blue', 'needs-you': 'amber', tend: 'rose', stalled: 'amber', 'in-progress': 'violet', shipped: 'emerald' }


type Tab = 'activity' | 'ticket'
let lastTab: Tab | undefined

type Action = ExecView['actions'][number]

const RUN_OUTCOME: Record<string, { dot: string; state: string }> = {
  shipped: { dot: 'bg-ok', state: 'shipped' }, ready: { dot: 'bg-ok', state: 'ready, waits for its stack' }, failed: { dot: 'bg-fail', state: 'failed' }, refined: { dot: 'bg-wait', state: 'asked a question' },
}

export type TicketThreadProps = {
  sync?: Sync
  compact?: boolean // on the desk, under its own row
  onOpenLinked: (l: Linked) => void // a linked PR, in Review
  missing?: string[] // skills the exec command needs that this machine lacks
  t: TicketView; actions: Action[]; feed: Activity[]; onSelect: (id: string) => void
  toast: (m: string, tone?: 'ok' | 'error') => void
}

/** Everything the ticket page knows and can do, for either design to lay out. */
export function useTicketThread({ t, actions, missing = [], feed, onSelect, toast, sync, onOpenLinked, compact }: TicketThreadProps) {
  const run = t.run
  // opening a ticket reads its environment from Sentry once (cached), so Investigate goes to the right data
  useEffect(() => { api(`/exec/tickets/${t.id}/env`).catch(() => {}) }, [t.id])
  const [tab, setTabState] = useState<Tab>(() => (['activity', 'ticket'].includes(param('ttab') ?? '') ? param('ttab') as Tab : undefined) ?? lastTab ?? (run ? 'activity' : 'ticket'))
  const setTab = (x: Tab) => { lastTab = x; setTabState(x); setParam('ttab', x) }
  const [copied, setCopied] = useState(false)
  const g = groupOf(t)
  const P = PRIORITY[t.priority] ?? PRIORITY[0]
  const prs = t.prs, pr = t.pr // every PR the ticket ships as (a stack, in order), and the one that needs you most
  const ci = prs.some((p) => p.ci === 'failure') ? 'failure' : prs.every((p) => p.ci === 'success') ? 'success' : prs.find((p) => p.ci)?.ci
  const threads = prs.reduce((n, p) => n + (p.openThreads ?? 0), 0)
  const dot = (p: (typeof prs)[number]) => <span className={`size-1.5 shrink-0 rounded-full ${p.ci === 'failure' ? 'bg-fail' : p.ci === 'success' ? 'bg-ok' : 'bg-fill-strong'}`} title={p.ci ? `CI ${p.ci}` : 'CI unknown'} />
  const resumeCmd = run && `claude --resume ${run.sessionId}`
  // a ticket parked on a question is skipped by a plain exec run: "run again" repeats the last action you ran on it
  // (Investigate in prod…), so new access (a login, a VPN) gets used
  const lastAction = (t.agentWaiting || run?.outcomes[t.id]?.outcome === 'refined')
    ? actions.find((a) => a.label === [...feed].reverse().find((x) => x.kind === 'you' && actions.some((b) => b.label === x.text))?.text) : undefined
  const runIt = () => (lastAction ? api('/exec/action', { id: t.id, action: lastAction.id }) : api('/exec', { ids: [t.id] }))
    .then(() => toast(`Running ${lastAction ? `${lastAction.label} on ` : ''}${t.id}`), (e: Error) => toast(e.message, 'error'))
  const act = (path: string, ok: string) => run && api(`/exec/${run.id}/${path}`, {}).then(resumed(ok, toast), (e: Error) => toast(e.message, 'error'))
  const siblings = run && run.ids.length > 1 ? run.ids : undefined
  // this ticket's PRs (open, then closed), as rows of the stack list, each with its agent for the hand-over card
  const prItems: NavItem[] = [...prs, ...t.closedPrs].map((p) => {
    const id = `${p.repo}#${p.number}`
    return { id, kind: 'pr', ref: `#${p.number}`, title: p.title ?? '', url: p.url, dot: ciTone(p), state: ciLabel(p), threads: p.openThreads, linked: t.linked.find((l) => l.kind === 'pr' && l.id === id) }
  })
  // parked on Linear: the action card is the one place to answer, so the dock stays out of the way
  // the next step gets the emphasis: answering (the dock), the shipped PR, or a (re-)run; the rest go quiet
  // a run you started after the agent's Linear question (Investigate…) answers to you first, with its own next steps
  const newer = !!run?.label && !!run.endedAt && !!t.lastComment && run.endedAt > t.lastComment.at
  const asking = !t.busy && !newer && (t.agentWaiting || run?.outcomes[t.id]?.outcome === 'refined')
  const shipped = run?.outcomes[t.id]?.outcome === 'shipped' || t.bucket === 'shipped' || t.bucket === 'tend'
  // the run's last message asks something ("submit the PR?"): answering comes before anything else
  const runAsks = !!run && !t.busy && run.state === 'done' && pendingOf(run.next) > 0
  // in review with red CI or open threads (why the list says it waits on you): that PR is the next step, not "shipped"
  const tending = t.bucket === 'tend' ? prs.find((p) => p.ci === 'failure') ?? prs.find((p) => p.openThreads) : undefined
  const next: 'run' | 'pr' | 'tend' | 'dock' | undefined = t.busy ? undefined : asking || runAsks ? 'dock' : tending ? 'tend' : shipped && pr ? 'pr' : (!run || run.state === 'failed' || run.state === 'cancelled') ? 'run' : 'dock'
  const openPr = (p: { repo: string; number: number; title?: string }) => {
    const id = `${p.repo}#${p.number}`
    onOpenLinked(t.linked.find((l) => l.kind === 'pr' && l.id === id) ?? { kind: 'pr', id, label: `#${p.number}`, title: p.title ?? '', agent: 'none' })
  }

  const tabBtn = (x: Tab, label: string, count?: number) => (
    <button onClick={() => setTab(x)} aria-selected={tab === x} role="tab"
            className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1 text-body font-medium transition-[color,background-color,box-shadow] duration-200 ${tab === x ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>
      {label}
      {count != null && <span className="rounded-full bg-hover px-1.5 text-micro tabular-nums text-fg-3">{count}</span>}
    </button>
  )

  // status at a glance; each chip opens its details, so the content keeps the full width
  const chips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {run && (
        <Chip icon={run.error ? TriangleAlert : run.denials?.length ? ShieldAlert : Bot} tone={run.error ? 'rose' : run.denials?.length ? 'amber' : 'zinc'} pulse={t.busy}
              label={<>{run.label ?? 'Ship'}{t.busy ? ` running${run.phase ? ` · ${PHASE_LABEL[run.phase] ?? run.phase}` : ''}` : run.state === 'done' ? '' : ` · ${run.state}`}{run.endedAt ? ` · ${duration(run.startedAt, run.endedAt)}` : ''}{run.costUsd != null ? ` · $${run.costUsd.toFixed(2)}` : ''}</>}>
          <dl className="space-y-2 text-small">
            <Meta label="Run"><span className="font-mono">{run.id}</span></Meta>
            <Meta label="State">{run.state}{run.auto ? ' · auto' : ''}</Meta>
            {run.phase && <Meta label="Phase">{PHASE_LABEL[run.phase] ?? run.phase}</Meta>}
            <Meta label="Duration"><span className="flex items-center gap-1 font-mono tabular-nums"><Timer className="size-3.5 text-fg-3" />{duration(run.startedAt, run.endedAt) || '–'}</span></Meta>
            {run.costUsd != null && <Meta label="Cost"><span className="flex items-center gap-0.5 font-mono tabular-nums"><DollarSign className="size-3.5 text-fg-3" />{run.costUsd.toFixed(2)}</span></Meta>}
            <Meta label="Session">
              <button onClick={() => resumeCmd && navigator.clipboard.writeText(resumeCmd).then(() => { setCopied(true); toast('Resume command copied'); setTimeout(() => setCopied(false), 1500) })}
                      className="group/sid flex items-center gap-1 font-mono text-fg-2 transition-colors hover:text-accent-text" title="Copy resume command">
                {run.sessionId.slice(0, 8)}{copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 opacity-0 transition-opacity group-hover/sid:opacity-100" />}
              </button>
            </Meta>
          </dl>
          {run.error && <p className="mt-3 flex items-start gap-2 rounded-xl bg-fail/10 px-3 py-2 text-small text-fail-text ring-1 ring-fail/30"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{run.error}</p>}
          {!!run.denials?.length && (
            <p title={run.refused?.join('\n')} className="mt-3 flex items-start gap-2 rounded-xl bg-wait/10 px-3 py-2 text-small text-wait-text ring-1 ring-wait/30">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>Denied {run.denials.length}×: {[...new Set(run.denials)].join(', ')}{run.refused?.[0] && <> (first: <code className="font-mono text-meta">{run.refused[0].slice(0, 120)}</code>)</>}. The Activity tab shows each one where it happened; add what's needed in Settings → Exec.</span>
            </p>
          )}
        </Chip>
      )}
      {/* the environment, once known (or being worked out): "unknown" says nothing */}
      {(t.env.env !== 'unknown' || t.env.asking) && (
      <Chip icon={Database} pulse={t.env.asking} tone={t.env.env === 'prod' ? 'amber' : 'zinc'}
            label={t.env.env === 'prod' ? 'Production' : t.env.env === 'dev' ? 'Dev / sandbox' : 'Reading Sentry…'}>
        <p className="text-small font-medium">{t.env.env === 'prod' ? 'Production' : t.env.env === 'dev' ? 'Dev / sandbox' : 'Not known'}</p>
        <p className="mt-1 text-small text-fg-3">{t.env.detail}{t.env.source === 'text' ? '. A Sentry link, when the ticket has one, overrides this.' : ''}</p>
        <p className="mt-2 text-meta text-fg-3">Investigate offers only the matching environment once this is known.</p>
      </Chip>
      )}
      <Chip icon={P.icon} tone={ci === 'failure' ? 'rose' : threads ? 'amber' : 'zinc'}
            label={<>Linear · {t.state}{ci === 'failure' ? ' · CI red' : ''}{threads ? ` · ${threads} open thread${threads === 1 ? '' : 's'}` : ''}</>}>
        <dl className="space-y-2 text-small">
          <Meta label="State">{t.state}</Meta>
          <Meta label="Priority"><span className="flex items-center gap-1"><P.icon className={`size-3.5 ${P.tone}`} />{P.label}</span></Meta>
          <Meta label="Repository">{t.repo ?? <span className="text-wait-text">not mapped</span>}</Meta>
          <Meta label="Branch"><span className="block max-w-[180px] truncate rounded-md bg-fill px-1.5 py-0.5 font-mono" title={t.branch}>{t.branch}</span></Meta>
          {ci && <Meta label="CI"><span className={ci === 'failure' ? 'font-semibold text-fail-text' : ci === 'success' ? 'text-ok-text' : ''}>{ci}</span></Meta>}
          {prs.some((p) => p.openThreads != null) && <Meta label="Open threads"><span className={threads ? 'font-semibold text-wait-text' : ''}>{threads}</span></Meta>}
          {t.labels.length > 0 && <Meta label="Labels"><span className="flex flex-wrap justify-end gap-1">{t.labels.map((l) => <span key={l} className="rounded-full bg-fill px-1.5 py-px text-micro">{l}</span>)}</span></Meta>}
        </dl>
      </Chip>
    </div>
  )
  const statusField = <StatusField label={g.title} icon={g.icon} spin={g.id === 'running'} tone={GROUP_TONE[g.id] ?? 'zinc'} steps={STEPS.map((x) => STEP_LABEL[x])} {...stageOf(t)} />
  const parentLinks = <span className="inline-flex items-center gap-1 font-mono text-fg-2 ">{t.priority ? <P.icon className={`size-3.5 ${P.tone}`} aria-label={P.label} /> : null}<a href={t.url} target="_blank" rel="noreferrer" title="Open in Linear" className="group/link inline-flex items-center gap-0.5 transition-colors hover:text-accent-text">{t.id}<ArrowUpRight className="size-3.5 opacity-50 transition-opacity group-hover/link:opacity-100" /></a></span>
  const stackNav = siblings ? <StackNav keys noun="ticket" current={t.id} onOpen={(x) => onSelect(x.id)}
                                      items={siblings.map((id) => ({ id, kind: 'ticket', ref: id, title: id === t.id ? t.title : `${id} in this run`, ...RUN_OUTCOME[run!.outcomes[id]?.outcome ?? ''] ?? { dot: 'bg-fill-strong', state: 'not done yet' } }))} />
              : prItems.length > 0 ? <StackNav items={prItems} onOpen={(x) => onOpenLinked(x.linked ?? { kind: 'pr', id: x.id, label: x.ref, title: x.title, agent: 'none' })} me={{ kind: 'ticket', id: t.id }} toast={toast} /> : undefined
  const headerActions = <>
            <PinButton pinKey={`ticket:${t.id}`} on={t.pinned} className={`${mini} px-1.5`} toast={toast} />
            <button className={`${mini} px-1.5`} aria-pressed={!!t.dimmed} aria-label={t.dimmed ? 'Undim' : 'Dim for now'}
                    title={t.dimmed ? 'Undim: back to normal in the list' : "Dim for now: it stays listed, faded and last in its group, and leaves the waiting count until its state changes"}
                    onClick={() => api(`/exec/tickets/${encodeURIComponent(t.id)}/dim`, { on: !t.dimmed }).then(() => toast(t.dimmed ? 'Back to normal' : 'Dimmed until its state changes'), (e: Error) => toast(e.message, 'error'))}>
              <Moon className={`size-3.5 ${t.dimmed ? 'fill-current text-accent' : ''}`} />
            </button>
            <button className={mini} disabled={!run} onClick={() => act('resume-terminal', 'Opened the session in Terminal')} title={run ? 'Continue this run’s agent session in your terminal' : 'Not run yet'}>
              <SquareTerminal className="size-3.5" /><span className="hidden sm:inline">Resume</span>
            </button>
            {prs.length === 1 && !t.closedPrs.length && (
              <a href={prs[0].url} target="_blank" rel="noreferrer" className={mini} title={`#${prs[0].number} on GitHub: ${prs[0].title}`}>
                <GitPullRequest className="size-3.5" /><span className="hidden sm:inline">GitHub</span>{dot(prs[0])}
              </a>
            )}
            </>
  // the Next panel's content (the next step, the run's plan, its question), the box to steer it, and the ticket itself
  const panelBody = <>
        {!t.busy && <ConnectCard compact onRun={t.repo ? runIt : undefined} toast={toast} />}
        {!t.busy && <VpnCard env={t.env.env !== 'unknown' ? t.env.env : actions.find((a) => a.label === run?.label)?.env ?? t.env.env} lastResult={[...feed].reverse().find((x) => x.kind === 'result' || x.kind === 'error')?.text} onRun={t.repo ? runIt : undefined} />}
        {!t.busy && asking && <ActionCard inline t={t} actions={actions} toast={toast} />}
        {!(!t.busy && next === 'dock' && asking) && <PanelSection title={t.busy ? 'The agent is working' : 'Do next'} icon={t.busy ? LoaderCircle : ArrowRight} tone={t.busy ? 'text-run' : 'text-accent'}>
          <div className="space-y-2">
            {t.busy ? (
              <Working why={run?.phase ? `${PHASE_LABEL[run.phase] ?? run.phase}.` : undefined} feed={feed} onStop={() => act('cancel', 'Run stopped')} bg={run ? { base: `/exec/${run.id}`, count: t.background } : undefined} toast={toast} />
            ) : next === 'dock' && asking ? (
              <p className="text-body leading-relaxed text-fg-2 ">The agent parked {t.id} with a question on Linear. <span className="font-semibold">Answer it below</span>, or pick a way past it.</p>
            ) : next === 'dock' && runAsks ? (
              <p className="text-body leading-relaxed text-fg-2 ">The agent stopped to ask you something. <span className="font-semibold">Answer it below</span>; it acts on your answer in the same session.</p>
            ) : next === 'tend' && tending ? (
              <>
                <p className="text-body leading-relaxed text-fg-2 ">
                  <span className="font-semibold">#{tending.number} {tending.ci === 'failure' ? 'has failing CI' : `has ${tending.openThreads} open review thread${tending.openThreads === 1 ? '' : 's'}`}</span>: that is what waits on you.
                </p>
                <button onClick={() => openPr(tending)} className={`${primary} w-full justify-center py-2.5`}><GitPullRequest className="size-4" />{tending.ci === 'failure' ? `Open #${tending.number} to fix CI` : `Open #${tending.number} to answer them`}</button>
                {prs.length + t.closedPrs.length > 1 && <PrStack prs={prs} closed={t.closedPrs} dense />}
              </>
            ) : next === 'pr' && pr ? (
              <>
                {prs.length + t.closedPrs.length > 1 ? <PrStack prs={prs} closed={t.closedPrs} dense /> : <a href={pr.url} target="_blank" rel="noreferrer" className={`${primary} w-full justify-center py-2.5`}><GitPullRequest className="size-4" />Review PR #{pr.number}</a>}
                <p className="text-small text-fg-3">Shipped. Steer below if it should change.</p>
              </>
            ) : next === 'run' ? (
              <>
                <button onClick={runIt} disabled={!t.repo || !!missing.length} className={`${primary} w-full justify-center py-2.5`} title={missing.length ? missingTitle(missing) : t.repo ? `Run the exec command on ${t.id}` : 'No repository mapped for this team'}>
                  {run ? <><RotateCcw className="size-4" />Run again</> : <><Play className="size-4 fill-current" />Run</>}
                </button>
                <Missing names={missing} />
              </>
            ) : (
              <p className="text-body text-fg-3">The run finished. Reply or steer below if anything should change.</p>
            )}
            {!t.busy && (next !== 'run' && t.repo || (next !== 'pr' && prs.length === 1)) && (
              <p className="flex flex-wrap gap-x-2 pt-1 text-small text-fg-3"><span className="text-fg-3">Also:</span>
                {/* several PRs: the header's list has them */}
                {next !== 'pr' && prs.length === 1 && <a href={prs[0].url} target="_blank" rel="noreferrer" className="hover:text-accent-text">PR #{prs[0].number}</a>}
                {next !== 'run' && t.repo && !missing.length && <button onClick={runIt} className="hover:text-accent-text">{run ? 'Run again' : 'Run'}</button>}
              </p>
            )}
          </div>
        </PanelSection>}
        {/* what the run was planned to use: its skills (and why), the environment it reads, the steps */}
        {(run?.planning || run?.plan) && (
          run.planning ? <p className="flex items-center gap-1.5 text-small text-fg-3"><LoaderCircle className="size-3.5 animate-spin text-accent" />Picking the skills and setup that fit {t.id}…</p> : run.plan && (
            <details className="group/plan rounded-xl px-2.5 py-1.5 ring-1 ring-line [&[open]]:pb-2.5">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-small text-fg-3 hover:text-fg-1">
                <ListChecks className="size-3.5 shrink-0 text-accent" /><span className="font-medium">Plan</span>
                <span className="min-w-0 truncate text-fg-4">{run.plan.steps.length} steps{run.plan.skills[0] ? ` · ${run.plan.skills[0].name}` : ''}{run.plan.env ? ` · ${run.plan.env === 'prod' ? 'production' : 'development'} data` : ''}</span>
                <ChevronDown className="ml-auto size-3.5 shrink-0 transition-transform group-open/plan:rotate-180" />
              </summary>
              <div className="space-y-2 pt-2 text-small">
                <div className="flex flex-wrap gap-1.5">
                  {run.plan.skills.map((sk) => <span key={sk.name} title={sk.why} className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-meta text-accent-text">{sk.name}</span>)}
                  {!run.plan.skills.length && <span className="text-fg-3">No skill fits especially.</span>}
                  {run.plan.env && <span className="rounded-md bg-wait/10 px-1.5 py-0.5 text-meta font-medium text-wait-text">{run.plan.env === 'prod' ? 'production' : 'development'} data</span>}
                </div>
                {run.plan.skills.length > 0 && <ul className="space-y-0.5 text-meta text-fg-3">{run.plan.skills.map((sk) => <li key={sk.name}><span className="font-medium text-fg-2 ">{sk.name}</span>: {sk.why}</li>)}</ul>}
                <ol className="list-inside list-decimal space-y-0.5 text-fg-2 ">{run.plan.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
                <p className="text-meta text-fg-3">{run.plan.by === 'rules' ? 'Picked by rule from the ticket.' : 'Picked by a small model from the ticket and the skills there.'} The agent adapts if the ticket needs something else.</p>
              </div>
            </details>
          )
        )}
  </>
  const steerSection = <>
        {/* once it hands back: its Linear question, its decisions, or your own words */}
        {asking ? null : run && !t.busy && (run.state === 'done' || run.state === 'failed') ? (
          <PanelSection title={runAsks ? 'Decide' : 'Tell the agent'} icon={MessageSquare} tone={runAsks ? 'text-accent' : undefined}>
            <NextSteps inline nextUrl={`/exec/${run.id}/next`} replyUrl={`/exec/${run.id}/reply`} draft={`ticket:${t.id}`} version={run.endedAt ?? ''} toast={toast} placeholder="Tell the agent what to change, answer, or do next…" />
          </PanelSection>
        ) : (
          <PanelSection title="Tell the agent" icon={MessageSquare}>
            <NextSteps inline replyUrl={`/exec/tickets/${t.id}/steer`} draft={`ticket:${t.id}`} version={`${t.id}:${t.busy}`} toast={toast}
                       placeholder={t.busy ? 'Tell it something while it works: it reads it between steps, without stopping' : `What should ${t.id}’s implementation do differently?`} />
          </PanelSection>
        )}
  </>
  const ticketBody = (
                <div className="space-y-4 px-5 py-4">
                  {t.agentWaiting && t.lastComment && (
                    <div className="rounded-xl bg-wait/6 p-3.5 ring-1 ring-wait/25">
                      <h4 className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold uppercase tracking-labelr text-wait-text"><MessageCircleQuestion className="size-3.5" />The agent is waiting on you</h4>
                      <Md text={t.lastComment.body} className="!text-body" />
                      <p className="mt-2 text-small text-fg-3">Answer on Linear, then Run again; or Resume to answer in the terminal.</p>
                    </div>
                  )}
                  {t.description.trim() ? <Md text={t.description} /> : <p className="py-6 text-center text-sm text-fg-3">No description.</p>}
                </div>
  )
  return { panelBody, steerSection, ticketBody, statusField, parentLinks, stackNav, headerActions, t, actions, missing, feed, onSelect, toast, sync, onOpenLinked, compact, pr, run, tab, setTabState, setTab, copied, setCopied, g, P, prs, ci, threads, dot, resumeCmd, lastAction, runIt, act, siblings, prItems, newer, asking, shipped, runAsks, tending, next, openPr, tabBtn, chips }
}


/** Linear markdown, lightly: headings become headings, everything else keeps its lines with inline links, code and bold. */
const ACTION_ICON = { play: Play, file: FileText, reply: Reply, wand: Wand, search: SearchCheck }

/** The agent stopped to ask you something: answer it, or decide for it. */
function ActionCard({ t, actions, toast, inline }: { t: TicketView; actions: Action[]; toast: (m: string, tone?: 'ok' | 'error') => void; inline?: boolean }) {
  const [note, setNote] = useDraft(`answer:${t.id}`)
  const [busy, setBusy] = useState<string>()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const { armed, arm } = useArm()
  const q = t.lastComment?.body.replace(/^_Generated by Claude Code_\s*/i, '').trim()
  const opts = q ? optionsOf(q) : []
  const go = (action: string, label: string, confirmText?: string) => {
    if (confirmText && armed !== action) return arm(action, () => {})
    if (armed) arm(armed, () => {})
    setBusy(action)
    api('/exec/action', { id: t.id, action, note }).then(
      () => { toast(action === 'reply' ? 'Answer posted on Linear; running again' : `${label}: started`); setNote(''); setSheet(false) },
      (e: Error) => toast(e.message, 'error')).finally(() => setBusy(undefined))
  }
  return (
    <div className="relative">
    {(sheet || inline) && (
    <section className={inline ? 'overflow-hidden rounded-2xl bg-surface-1 ring-1 ring-wait/30 ' : 'absolute inset-x-0 bottom-full z-20 mb-2 max-h-[calc(65vh/var(--z))] animate-[rise-in_200ms_var(--ease-snappy)] overflow-y-auto rounded-2xl bg-surface-1 shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.25)] ring-1 ring-wait/30 '}>
      <header className="flex items-center gap-2 px-3.5 pt-3">
        <MessageCircleQuestion className="size-4 animate-pulse text-wait-text" />
        <h3 className="text-body font-semibold text-wait-text">The agent asks you</h3>
        {t.lastComment && <span className="ml-auto text-meta text-fg-3">{stamp(t.lastComment.at)}</span>}
      </header>
      {q && (
        <div className="relative px-3.5 pt-1.5">
          <div className={open ? '' : 'max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]'}><Md text={q} className="!text-body" /></div>
          {q.length > 320 && <button onClick={() => setOpen(!open)} className="mt-1 text-small font-medium text-wait-text hover:underline">{open ? 'Show less' : 'Show all'}</button>}
        </div>
      )}
      <div className="space-y-2 p-3.5 pt-2.5">
        {/* the choices it listed: a tap answers with that one, a second tap clears it */}
        {opts.length > 0 && (
          <Pick wrap label="Its choices" value={note} onChange={(o) => setNote(note === o ? '' : o)}
                options={opts.map((o, i) => ({ value: o, hint: o, label: <><span className="mr-1.5 font-mono text-micro text-fg-4">{i + 1}</span>{o}</> }))} />
        )}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && note.trim() && !busy) go('reply', 'Reply') }}
                  title="Goes along with whichever you pick: posted as your reply, or handed to the run as guidance"
                  placeholder={opts.length ? 'Or write your own answer… (⌘↵ posts it)' : 'Your answer or guidance… (⌘↵ posts it)'}
                  className="max-h-48 min-h-11 w-full resize-none [field-sizing:content] rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 ring-line transition-all placeholder:text-fg-3 hover:ring-line-strong focus:ring-2 focus:ring-wait/50 " />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => go('reply', 'Reply')} disabled={!note.trim() || !!busy} title="Post this on the Linear ticket as you, then run again"
                  className={secondary}><Reply className="size-4" />{busy === 'reply' ? 'Posting…' : 'Reply on Linear & run'}</button>
          {actions.filter((a) => !a.env || t.env.env === 'unknown' || a.env === t.env.env).map((a) => {
            const Icon = ACTION_ICON[a.icon ?? 'wand']
            return (
              <button key={a.id} onClick={() => go(a.id, a.label, a.confirm)} disabled={!!busy || !!a.missing.length} title={a.missing.length ? missingTitle(a.missing) : a.hint}
                      className={`${a.id === 'proceed' ? primary : secondary} ${armed === a.id ? armedCls : ''}`}>
                <Icon className="size-4" />{busy === a.id ? 'Starting…' : armed === a.id ? <ArmLabel>{`Confirm ${a.label.toLowerCase()}`}</ArmLabel> : a.label}{armed === a.id && <ArmBar on={a.id === 'proceed' ? 'color' : 'plain'} />}
              </button>
            )
          })}
        </div>
        {[...new Set(actions.filter((a) => !a.env || t.env.env === 'unknown' || a.env === t.env.env).flatMap((a) => a.missing))].length > 0 && <Missing names={[...new Set(actions.filter((a) => !a.env || t.env.env === 'unknown' || a.env === t.env.env).flatMap((a) => a.missing))]} />}
      </div>
    </section>
    )}
    {!inline && <button onClick={() => setSheet((x) => !x)} aria-expanded={sheet}
            className="group/dock flex w-full items-center gap-2 rounded-2xl bg-wait/7 px-4 py-2.5 text-left text-small text-wait-text ring-1 ring-wait/30 transition-all hover:shadow-md">
      <MessageCircleQuestion className={`size-4 shrink-0 text-wait-text ${sheet ? '' : 'animate-pulse'}`} />
      <span className="shrink-0 font-semibold">The agent is waiting on you</span>
      {q && <span className="min-w-0 truncate text-fg-3">{q.split('\n')[0]}</span>}
      <span className="flex-1" />
      <ChevronUp className={`size-4 shrink-0 text-fg-3 transition-transform duration-200 ${sheet ? 'rotate-180' : ''}`} />
    </button>}
    </div>
  )
}

