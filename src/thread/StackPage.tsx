// A stack as one thing: its pull requests in a compact table (bottom first), what waits on you across all of them as
// one answer, the actions that make sense for the whole stack, and the tickets it carries. Nothing is stored for a
// stack: every number here is rolled up from its PRs as they are now, so unstacking or restacking just changes what the
// page shows. A single PR is a stack of one. Each PR keeps its own conversation, one click away.
import { ArrowRight, CircleCheck, GitCompareArrows, Layers, LoaderCircle, Play, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { askLine } from '../../server/reply.ts'
import type { StackCheck } from '../../server/stackCheck.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { api, type PrView, type TicketView } from '../lib.ts'
import { remember, useApi } from '../query.ts'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { plain } from '../components/StackNav.tsx'
import type { StackView } from '../desk.ts'
import { useStackNext } from './StackNext.tsx'
import { Pill, ThreadHeader, ThreadLayout, type Tone } from '../ui/Thread.tsx'

// what its agent asks you, once it has finished
const askOf = (p: PrView) => (p.job && p.job.state !== 'running' && p.job.state !== 'queued' ? askLine(p.job.next) : undefined)
const busy = (p: PrView) => p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'
export function StackPage({ stack, prs, waiting, onSelect, onTicket, toast }: {
  stack: StackView; prs: PrView[]; waiting: (p: PrView) => boolean
  onSelect: (id: string) => void; onTicket: (id: string) => void
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const { members, all, tickets } = stack
  const { card } = useStackNext({ stack: all, prs, toast })
  const asks = members.filter((p) => waiting(p) || !!askOf(p)), working = members.filter(busy)
  // no agent has looked at them yet: started bottom first, each after the one below it (it reads what that one found)
  const fresh = members.filter((p) => p.flow.next === 'run' && !p.job && !p.missing.length)
  const [starting, setStarting] = useState(false)
  const run = () => {
    setStarting(true)
    api('/review/run', { stacks: [fresh.map((p) => p.id)] }).then(() => toast(`Started ${fresh.length === 1 ? `#${fresh[0].number}` : `${fresh.length} PRs, bottom first`}`), (e: Error) => toast(e.message, 'error')).finally(() => setStarting(false))
  }
  // your PRs with reviewers' threads waiting: a revise each, bottom first (a fix below may change what is above it)
  const feedback = members.filter((p) => p.mine && (p.awaiting ?? 0) > 0 && !busy(p))
  const revise = () => api('/review/run', { stacks: [feedback.map((p) => p.id)] }).then(() => toast(`Revising ${feedback.length === 1 ? `#${feedback[0].number}` : `${feedback.length} PRs, bottom first`}`), (e: Error) => toast(e.message, 'error'))
  // the actions a PR's own menu offers for "its stack", here where the stack is: each says how many PRs it reaches
  const enc = encodeURIComponent, anchor = members[0]
  type Action = { id: string; label: string; hint: string; confirm?: string; missing: string[]; counts: { stack?: number } }
  const actions = useApi<Action[]>(anchor ? `/prs/${enc(anchor.id)}/actions?v=${members.map((p) => `${p.status}${p.headSha.slice(0, 5)}`).join('')}` : undefined, { placeholderData: (prev) => prev })
  const offered = (actions.data ?? []).filter((a) => (a.counts.stack ?? 0) > 0 && !a.missing.length && !['cancel', 'crit-stop', 'explain', 'rerun'].includes(a.id))
  const { armed, arm } = useArm()
  const act = (a: Action) => { const go = () => api(`/prs/${enc(anchor.id)}/actions`, { action: a.id, scope: 'stack' }).then((r: { label: string; count: number }) => toast(`${r.label}: ${r.count} PR${r.count === 1 ? '' : 's'}`), (e: Error) => toast(e.message, 'error')); return a.confirm ? arm(a.id, go) : go() }
  const add = members.reduce((n, p) => n + p.additions, 0), del = members.reduce((n, p) => n + p.deletions, 0)
  const [tab, setTab] = useState<'check' | 'tickets'>('check')
  const fact = (n: number, label: string, tone: Tone) => <Pill tone={n ? tone : 'quiet'}><span className="mr-1 font-semibold tabular-nums">{n}</span>{label}</Pill>
  const cell = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums'

  return (
    // the chat's own layout, so a stack reads like a PR: its header, the PRs where the conversation is, what waits on
    // you docked under them, and a panel beside. The page itself never scrolls: each part scrolls inside its place
    <ThreadLayout subject={stack.key} tab={tab} onTab={setTab}
      header={<ThreadHeader title={plain(all[0]?.title ?? members[0]?.title ?? stack.title ?? '')}
        crumb={<><Layers className="size-3.5 text-accent-text" /><span className="font-medium text-accent-text">{all.length === 0 ? `Stack · ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}, no pull request yet` : all.length === 1 ? 'A stack of one' : `Stack · ${all.length} pull requests`}</span><span className="font-mono">{(members[0]?.repo ?? tickets[0]?.repo)?.split('/')[1]}</span></>}
        status={<>
          {fact(asks.length, 'waiting on you', 'wait')}{fact(working.length, working.length === 1 ? 'agent working' : 'agents working', 'run')}{fact(fresh.length, 'not started', 'quiet')}
          <span className="text-meta tabular-nums text-fg-3"><span className="text-ok-text">+{add}</span> <span className="text-fail-text">−{del}</span></span>
        </>}
        meta={(fresh.length > 0 || offered.length > 0 || feedback.length > 0) && <>
          <span className="mr-1 text-meta text-fg-3">For the whole stack</span>
          {fresh.length > 0 && (
            <button onClick={run} disabled={starting} className="inline-flex items-center gap-1.5 btn-primary btn-sm" title="Each starts once the one below it is done, so it reads what that one found">
              {starting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{fresh.length === 1 ? `Start #${fresh[0].number}` : `Start the ${fresh.length} not started`}
            </button>
          )}
          {feedback.length > 0 && <button onClick={revise} className="btn-outline btn-sm" title="A revise on each of your PRs with reviewers' threads waiting, bottom first">Revise the {feedback.length} with feedback</button>}
          {offered.map((a) => (
            <button key={a.id} onClick={() => act(a)} title={a.confirm ? a.confirm.replace('{n}', `${a.counts.stack} PRs`) : a.hint} className={`relative btn-outline btn-sm ${armed === a.id ? 'isolate overflow-hidden' : ''}`}>
              {armed === a.id ? <ArmLabel>{`Confirm: ${a.label.toLowerCase()}`}</ArmLabel> : <>{a.label}<span className="ml-1 tabular-nums text-fg-3">{a.counts.stack}</span></>}{armed === a.id && <ArmBar on="plain" />}
            </button>
          ))}
        </>} />}
      next={card ? <section aria-label="The stack waits on you" className="flex max-h-full min-h-0 flex-col overflow-y-auto card p-3">{card}</section>
        : asks.length === 1 ? (
          <button onClick={() => onSelect(asks[0].id)} className="card flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-small transition-colors hover:bg-hover">
            <span className="size-1.5 shrink-0 rounded-full bg-wait" /><span className="min-w-0 flex-1 truncate text-fg-1">Only #{asks[0].number} waits on you: {askOf(asks[0]) ?? asks[0].flow.why}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-accent-text">Open<ArrowRight className="size-3.5" /></span>
          </button>
        ) : undefined}
      tabs={[{ id: 'check' as const, label: 'Agreement', rail: true }, { id: 'tickets' as const, label: 'Tickets', badge: tickets.length ? <span className="ml-1.5 rounded-full bg-fill px-1.5 text-micro font-semibold tabular-nums text-fg-2">{tickets.length}</span> : undefined, rail: true }]}
      pane={tab === 'tickets'
        ? (tickets.length ? <ul className="divide-y divide-line">{tickets.map((t) => <TicketRow key={t.id} t={t} onOpen={() => onTicket(t.id)} />)}</ul> : <p className="p-4 text-small text-fg-3">No ticket of yours is linked to these pull requests.</p>)
        : all.length > 1 && anchor ? <Check path={`/prs/${enc(anchor.id)}/stack-check`} sig={members.map((p) => `${p.headSha.slice(0, 5)}${p.job?.endedAt ?? ''}`).join('')} members={members} onSelect={onSelect} toast={toast} />
        : <p className="p-4 text-small text-fg-3">A stack of one has nothing to compare with.</p>}>
      {/* where the conversation is on a PR's page: the stack's PRs, bottom first, one compact row each */}
      {all.length === 0 && <ul className="divide-y divide-line">{tickets.map((t) => <TicketRow key={t.id} t={t} onOpen={() => onTicket(t.id)} />)}</ul>}
      <table className="w-full text-small">
        <tbody className="divide-y divide-line">
          {all.map((s, i) => {
            const p = members.find((m) => m.number === s.number)
            if (!p) return <tr key={s.number} className="text-fg-4"><td className="w-8 py-1.5 pl-4 tabular-nums">{i + 1}</td><td className="px-2 py-1.5" colSpan={4}><span className="font-mono text-meta">#{s.number}</span> {plain(s.title ?? '')} <span className="text-meta">· not tracked here</span></td></tr>
            const ask = askOf(p), findings = p.crit?.aiComments ?? 0, blocking = p.crit?.blocking ?? 0
            return (
              <tr key={p.id} onClick={() => onSelect(p.id)} title={`${p.title}\n${ask ? `Asks: ${ask}` : p.flow.why}`} className="cursor-pointer transition-colors hover:bg-hover">
                <td className="w-8 py-1.5 pl-4 align-top tabular-nums text-fg-4">{i + 1}</td>
                <td className="max-w-0 px-2 py-1.5">
                  <button onClick={(e) => { e.stopPropagation(); onSelect(p.id) }} className="block w-full truncate text-left"><span className="font-mono text-meta text-fg-3">#{p.number}</span> <span className="font-medium text-fg-1">{plain(p.title)}</span></button>
                  <span className={`block truncate text-meta ${ask ? 'text-wait-text' : 'text-fg-3'}`}>{ask ? `Asks: ${ask}` : p.flow.why}</span>
                </td>
                <td className="w-px whitespace-nowrap px-2 py-1.5 align-top"><StatusBadge status={p.status} mine={p.mine} /></td>
                <td className={`${cell} w-px align-top text-meta`} title="Findings from the review · reviewers' threads open">
                  {findings ? <span className={blocking ? 'text-fail-text' : 'text-fg-2'}>{findings} found{blocking ? `, ${blocking} blocking` : ''}</span> : null}
                  {findings && p.unresolved ? <span className="text-fg-4"> · </span> : null}
                  {p.unresolved ? <span className={p.awaiting ? 'text-wait-text' : 'text-fg-2'}>{p.awaiting ? `${p.awaiting} waiting on you` : `${p.unresolved} open threads`}</span> : null}
                </td>
                <td className={`${cell} w-px pr-4 align-top text-meta`}><span className="text-ok-text">+{p.additions}</span> <span className="text-fail-text">−{p.deletions}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ThreadLayout>
  )
}

function TicketRow({ t, onOpen }: { t: TicketView; onOpen: () => void }) {
  const run = t.run
  const line = t.queued ? `Queued: ${t.queued.why}` : t.busy ? `Agent working${run?.phase ? `: ${run.phase}` : ''}` : t.waitsOn ? `Ready; submitted once ${t.waitsOn} ${t.waitsOn.includes(',') ? 'are' : 'is'} too` : run ? `${run.label ?? 'Ship'} ${run.state}` : 'No run yet'
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-small transition-colors hover:bg-hover">
        <span className="shrink-0 font-mono text-meta text-fg-3">{t.id}</span>
        <span className="min-w-0 flex-1 truncate text-fg-1">{t.title}</span>
        <span className={`shrink-0 text-meta ${t.busy ? 'text-run-text' : run?.state === 'failed' || run?.state === 'interrupted' ? 'text-fail-text' : 'text-fg-3'}`}>{line}</span>
        <span className="shrink-0 rounded-full bg-fill px-1.5 text-micro font-medium text-fg-2">{t.state}</span>
      </button>
    </li>
  )
}

/** Where the stack's PRs disagree with each other: read on demand (each PR was only ever looked at on its own). */
function Check({ path, sig, members, onSelect, toast }: { path: string; sig: string; members: PrView[]; onSelect: (id: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  type Got = { check: (StackCheck & { stale: boolean }) | null; checking?: boolean }
  const q = useApi<Got>(`${path}?v=${sig}`, { placeholderData: (prev) => prev })
  const [busyNow, setBusy] = useState(false)
  const c = q.data?.check, checking = busyNow || !!q.data?.checking
  const finished = members.filter((p) => p.job && p.job.state !== 'running' && p.job.state !== 'queued').length
  const run = () => { setBusy(true); api(path, {}).then((r: Got) => remember(`${path}?v=${sig}`, r), (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false)) }
  const open = (n: number) => { const p = members.find((m) => m.number === n); if (p) onSelect(p.id) }
  return (
    <section>
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2">
        <GitCompareArrows className="size-4 shrink-0 text-accent-text" />
        <h2 className="min-w-0 flex-1 text-small font-semibold text-fg-1">Do the pull requests agree with each other?</h2>
        {c && <span className="text-meta text-fg-3">{c.stale ? 'read before the last push or run' : `${c.read.length} of ${members.length} read`}</span>}
        <button onClick={run} disabled={checking || finished < 2} title={finished < 2 ? 'Needs a finished run on two of its PRs' : 'One read across what each PR’s agent found and decided'} className={`inline-flex items-center gap-1.5 btn-sm ${c && !c.stale ? 'btn-ghost' : 'btn-outline'}`}>
          {checking && <LoaderCircle className="size-3.5 animate-spin" />}{checking ? 'Reading…' : c ? 'Check again' : 'Check'}
        </button>
      </div>
      <div className="px-3.5 py-3 text-small">
        {!c ? <p className="text-fg-3">Each PR was reviewed on its own. This reads what every PR’s agent found and decided, and reports only what crosses PRs: one question decided two ways, a change above that a PR below contradicts, the same fix twice.</p>
          : c.issues.length === 0 ? <p className="flex items-start gap-2 text-fg-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /><span>Nothing crosses PRs. {c.agrees}</span></p>
          : (
            <ul className="space-y-3">
              {c.issues.map((x, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-wait" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg-1">{x.title} <span className="ml-1 inline-flex gap-1 align-middle">{x.prs.map((n) => <button key={n} onClick={() => open(n)} className="rounded-full bg-fill px-1.5 font-mono text-micro text-fg-2 transition-colors hover:bg-accent-soft hover:text-accent-text">#{n}</button>)}</span></p>
                    <p className="mt-0.5 leading-relaxed text-fg-2">{x.why}</p>
                    <p className="mt-0.5 leading-relaxed text-fg-3"><span className="font-medium text-fg-2">Fix:</span> {x.fix}</p>
                  </div>
                </li>
              ))}
              {c.agrees && <li className="border-t border-line pt-2 text-meta text-fg-3">{c.agrees}</li>}
            </ul>
          )}
        {c && c.unread.length > 0 && <p className="mt-2 text-meta text-fg-4">Not checked (no finished run yet): {c.unread.map((n) => `#${n}`).join(', ')}</p>}
      </div>
    </section>
  )
}
