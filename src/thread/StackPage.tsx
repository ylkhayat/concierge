// A stack as one thing: its pull requests in a compact table (bottom first), what waits on you across all of them as
// one answer, the actions that make sense for the whole stack, and the tickets it carries. Nothing is stored for a
// stack: every number here is rolled up from its PRs as they are now, so unstacking or restacking just changes what the
// page shows. A single PR is a stack of one. Each PR keeps its own conversation, one click away.
import { ArrowRight, ChevronRight, CircleCheck, Compass, GitCompareArrows, Layers, LoaderCircle, Pencil, Play, RefreshCw, Send, TriangleAlert } from 'lucide-react'
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
import { Composer, Pill, ThreadHeader, ThreadLayout, type Tone } from '../ui/Thread.tsx'

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
  // the panel opens on what waits on you, when anything does; you move between them, never both at once
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
  const offered = (actions.data ?? []).filter((a) => (a.counts.stack ?? 0) > 0 && !a.missing.length && // only the ones whose count is exact: whether a check failed isn't known here, and the terminal one needs your own machine
    !['cancel', 'crit-stop', 'explain', 'rerun', 'rerun-ci', 'fix-ci', 'review-stack'].includes(a.id))
  const { armed, arm } = useArm()
  const act = (a: Action) => { const go = () => api(`/prs/${enc(anchor.id)}/actions`, { action: a.id, scope: 'stack' }).then((r: { label: string; count: number }) => toast(`${r.label}: ${r.count} PR${r.count === 1 ? '' : 's'}`), (e: Error) => toast(e.message, 'error')); return a.confirm ? arm(a.id, go) : go() }
  const add = members.reduce((n, p) => n + p.additions, 0), del = members.reduce((n, p) => n + p.deletions, 0)
  const [tabPicked, setTab] = useState<'answer' | 'check' | 'tickets'>()
  const tab = tabPicked === 'answer' && !card ? 'check' : tabPicked ?? (card ? 'answer' : 'check')
  // the stack's own chat: one message, sent to each PR's agent in its own conversation (each told it is one of several).
  // What was said and what came back is read from the PRs themselves, so there is nothing to keep for the stack
  const [words, setWords] = useState('')
  const [skip, setSkip] = useState<string[]>([]) // the PRs left out of the next message
  const [sending, setSending] = useState(false)
  const [justSent, setJustSent] = useState<{ words: string; at: string; n: number }[]>([]) // shown at once; an agent at work only shows it as its own once it gets to it
  const to = members.filter((p) => !skip.includes(p.id))
  const say = () => {
    if (!words.trim() || !to.length || sending) return
    setSending(true)
    api('/stacks/say', { ids: to.map((p) => p.id), text: words }).then((r: { sent: { number: number }[] }) => { toast(`Sent to ${r.sent.length === 1 ? `#${r.sent[0].number}` : `${r.sent.length} agents`}`); setJustSent((x) => [...x, { words: words.trim(), at: new Date().toISOString(), n: r.sent.length }]); setWords('') }, (e: Error) => toast(e.message, 'error')).finally(() => setSending(false))
  }
  const MARK = '\n\n(To the whole stack'
  const talks = new Map<string, { words: string; at: string; to: PrView[] }>()
  for (const p of members) {
    const said = p.job?.said
    if (!said?.includes(MARK)) continue
    const w = said.slice(0, said.indexOf(MARK)), t = talks.get(w) ?? { words: w, at: p.job!.queuedAt, to: [] }
    talks.set(w, { ...t, at: t.at < p.job!.queuedAt ? t.at : p.job!.queuedAt, to: [...t.to, p] })
  }
  const chat = [...talks.values()].sort((a, b) => a.at.localeCompare(b.at))
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
      next={card ? undefined
        : asks.length === 1 ? (
          <button onClick={() => onSelect(asks[0].id)} className="card flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-small transition-colors hover:bg-hover">
            <span className="size-1.5 shrink-0 rounded-full bg-wait" /><span className="min-w-0 flex-1 truncate text-fg-1">Only #{asks[0].number} waits on you: {askOf(asks[0]) ?? asks[0].flow.why}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-accent-text">Open<ArrowRight className="size-3.5" /></span>
          </button>
        ) : undefined}
      composer={members.length > 0 && (
        <Composer>
          <div className="flex flex-wrap items-center gap-1 pb-1.5 text-meta text-fg-3">
            <span className="mr-0.5">To</span>
            {members.map((p) => { const on = !skip.includes(p.id); return (
              <button key={p.id} role="checkbox" aria-checked={on} onClick={() => setSkip(on ? [...skip, p.id] : skip.filter((x) => x !== p.id))} title={`${on ? 'Leave out' : 'Include'} #${p.number}: ${p.title}`}
                      className={`rounded-full px-1.5 font-mono text-micro transition-colors ${on ? 'bg-accent-soft text-accent-text' : 'bg-fill text-fg-4 line-through'}`}>#{p.number}</button>
            ) })}
          </div>
          <div className="flex items-end gap-2">
            <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={2} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); say() } }}
                      placeholder={`Tell the whole stack: each of the ${to.length} agents does its PR's part…`} aria-label="A message to the whole stack"
                      className="max-h-40 min-h-[52px] flex-1 resize-none rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 ring-line placeholder:text-fg-4 focus:ring-accent/50" />
            <button onClick={say} disabled={!words.trim() || !to.length || sending} className="inline-flex items-center gap-1.5 btn-primary" title="Send (⌘↵)">{sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}Send</button>
          </div>
        </Composer>
      )}
      tabs={[...(card ? [{ id: 'answer' as const, label: 'Waits on you', badge: <span className="ml-1.5 rounded-full bg-wait/15 px-1.5 text-micro font-semibold tabular-nums text-wait-text">{asks.length}</span> }] : []), { id: 'check' as const, label: 'Agreement', rail: true }, { id: 'tickets' as const, label: 'Tickets', badge: tickets.length ? <span className="ml-1.5 rounded-full bg-fill px-1.5 text-micro font-semibold tabular-nums text-fg-2">{tickets.length}</span> : undefined, rail: true }]}
      pane={tab === 'answer' && card ? <div className="flex h-full min-h-0 flex-col p-3.5">{card}</div> : tab === 'tickets'
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
                <td className="max-w-0 px-2 py-1.5" style={{ paddingLeft: 8 + s.depth * 14 }} title={s.depth ? `Built on #${p.below ?? '?'}` : 'On the base branch'}>
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
      {/* the stack's conversation: what you told all of it, and where each agent is with that */}
      {chat.map((m) => (
        <div key={m.at + m.words} className="border-t border-line px-4 py-3 text-small">
          <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent-soft/70 px-3 py-1.5 text-fg-1">{m.words}</p>
          <ul className="mt-2 space-y-1">
            {m.to.map((p) => { const j = p.job!, going = j.state === 'running' || j.state === 'queued'; return (
              <li key={p.id}>
                <button onClick={() => onSelect(p.id)} className="flex w-full items-baseline gap-2 rounded-ctl px-1.5 py-0.5 text-left transition-colors hover:bg-hover">
                  <span className="shrink-0 font-mono text-meta text-fg-3">#{p.number}</span>
                  <span className={`min-w-0 flex-1 truncate ${going ? 'text-run-text' : j.state === 'done' ? 'text-fg-2' : 'text-fail-text'}`}>{j.state === 'queued' ? 'Queued' : j.state === 'running' ? 'Working on it…' : j.state === 'done' ? (j.summary ?? 'Done').replace(/\s+/g, ' ').slice(0, 220) : `${j.state}${j.error ? `: ${j.error}` : ''}`}</span>
                </button>
              </li>
            ) })}
          </ul>
        </div>
      ))}
      {justSent.filter((m) => !talks.has(m.words)).map((m) => (
        <div key={m.at} className="border-t border-line px-4 py-3 text-small">
          <p className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl bg-accent-soft/70 px-3 py-1.5 text-fg-1">{m.words}</p>
          <p className="mt-1 text-right text-meta text-fg-3">Delivered to {m.n} agent{m.n === 1 ? '' : 's'}: each reads it between its steps, or the moment it starts</p>
        </div>
      ))}
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
  type Dir = { text: string; by: 'check' | 'you'; at: string }
  type Got = { check: (StackCheck & { stale: boolean }) | null; checking?: boolean; direction?: Dir | null }
  const q = useApi<Got>(`${path}?v=${sig}`, { placeholderData: (prev) => prev })
  const [busyNow, setBusy] = useState(false)
  const c = q.data?.check, checking = busyNow || !!q.data?.checking
  const finished = members.filter((p) => p.job && p.job.state !== 'running' && p.job.state !== 'queued').length
  const run = () => { setBusy(true); api(path, {}).then((r: Got) => remember(`${path}?v=${sig}`, { ...r, direction: r.direction ?? q.data?.direction }), (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false)) }
  const open = (n: number) => { const p = members.find((m) => m.number === n); if (p) onSelect(p.id) }
  // the direction the stack follows: written by the check, yours to change, given to every agent on these PRs
  const dir = q.data?.direction
  const [draft, setDraft] = useState<string>()
  // an inconsistency is fixed by the agents of the PRs it crosses: each is told what was found and the fix, and does its PR's part
  const [fixing, setFixing] = useState<string[]>([])
  const fix = (issues: StackCheck['issues']) => {
    const ids = [...new Set(issues.flatMap((x) => x.prs))].map((n) => members.find((m) => m.number === n)?.id).filter((x): x is string => !!x)
    if (!ids.length) return toast('None of its PRs is tracked here', 'error')
    const text = `The stack's agreement check found ${issues.length === 1 ? 'this' : 'these'} across its pull requests. Fix what belongs to your PR, and say what you changed.\n\n${issues.map((x) => `- ${x.title} (${x.prs.map((n) => `#${n}`).join(', ')}): ${x.why}\n  Fix: ${x.fix}`).join('\n')}`
    setFixing((f) => [...f, ...issues.map((x) => x.title)])
    api('/stacks/say', { ids, text }).then((r: { sent: { number: number }[] }) => toast(`Sent to the agent${r.sent.length === 1 ? '' : 's'} of ${r.sent.map((x) => `#${x.number}`).join(', ')}`), (e: Error) => { toast(e.message, 'error'); setFixing((f) => f.filter((t) => !issues.some((x) => x.title === t))) })
  }
  const saveDir = () => api(path.replace(/stack-check$/, 'stack-direction'), { text: draft ?? '' }).then((r: { direction: Dir | null }) => { remember(`${path}?v=${sig}`, { ...q.data, direction: r.direction } as Got); setDraft(undefined); toast(r.direction ? 'The stack follows this direction now' : 'Direction dropped') }, (e: Error) => toast(e.message, 'error'))
  const [openIssue, setOpenIssue] = useState<number>()
  const state = !c ? { label: 'Not checked yet', cls: 'bg-fill text-fg-3' } : c.issues.length ? { label: `${c.issues.length} disagreement${c.issues.length === 1 ? '' : 's'}`, cls: 'bg-wait/15 text-wait-text' } : { label: 'They agree', cls: 'bg-ok/12 text-ok-text' }
  return (
    <section className="space-y-3 p-3.5 text-small">
      {/* where the stack stands: one line, the check's state and how fresh it is, and the way to read it again */}
      <div className="flex items-center gap-2">
        <GitCompareArrows className="size-4 shrink-0 text-accent-text" />
        <span className={`rounded-full px-2 py-0.5 text-meta font-medium ${state.cls}`}>{state.label}</span>
        {c && <span className="min-w-0 truncate text-meta text-fg-4" title={c.stale ? 'Read before the last push or run: check again to read what changed' : undefined}>{c.stale ? 'out of date' : `${c.read.length} of ${members.length} PRs read`}</span>}
        <span className="flex-1" />
        <button onClick={run} disabled={checking || finished < 2} title={finished < 2 ? 'Needs a finished run on two of its PRs' : 'Read across what each PR’s agent found and decided'} className={`inline-flex shrink-0 items-center gap-1.5 btn-sm ${c && !c.stale ? 'btn-ghost' : 'btn-outline'}`}>
          {checking ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{checking ? 'Reading…' : c ? 'Check again' : 'Check'}
        </button>
      </div>

      {/* the direction: a callout of its own, since every agent on these PRs holds to it */}
      <div className="rounded-xl bg-accent-soft/40 px-3 py-2.5 ring-1 ring-accent/20">
        <div className="flex items-center gap-2">
          <Compass className="size-3.5 shrink-0 text-accent-text" />
          <h3 className="label text-accent-text" title="Every agent on these PRs is told to hold to it, and the stack’s answer is read against it">Direction</h3>
          {dir && <span className="text-micro text-fg-4">{dir.by === 'you' ? 'yours' : 'from the check'}</span>}
          <span className="flex-1" />
          {draft === undefined ? <button onClick={() => setDraft(dir?.text ?? '')} title={dir ? 'Edit the direction' : 'Write the direction'} aria-label={dir ? 'Edit the direction' : 'Write the direction'} className="rounded-md p-1 text-fg-3 transition-colors hover:bg-hover hover:text-fg-1"><Pencil className="size-3.5" /></button>
            : <span className="flex gap-1"><button onClick={() => setDraft(undefined)} className="btn-ghost btn-sm">Cancel</button><button onClick={() => void saveDir()} className="btn-primary btn-sm">Save</button></span>}
        </div>
        {draft !== undefined ? <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} placeholder={'- one rule or decision per line, that every PR of the stack holds to'} className="field mt-2 w-full resize-y font-mono text-meta leading-relaxed" />
          : dir ? <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-fg-1">{dir.text}</p>
          : <p className="mt-1.5 text-fg-3">None yet. The check writes one from what the PRs show, or write it yourself.</p>}
      </div>

      {!c ? <p className="px-0.5 text-fg-3">Each PR was reviewed on its own. The check reads what every PR’s agent found and decided, and reports only what crosses PRs: one question decided two ways, a change above that a PR below contradicts, the same fix twice.</p>
        : c.issues.length === 0 ? <p className="flex items-start gap-2 px-0.5 text-fg-2"><CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /><span>Nothing crosses PRs. {c.agrees}</span></p>
        : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 px-0.5">
              <h3 className="label flex-1 text-fg-3">Where they disagree</h3>
              {c.issues.length > 1 && <button onClick={() => fix(c.issues)} disabled={c.issues.every((x) => fixing.includes(x.title))} className="btn-outline btn-sm">Have the agents fix all {c.issues.length}</button>}
            </div>
            {/* one row each, folded to its claim; open for why and the fix */}
            {c.issues.map((x, i) => {
              const isOpen = openIssue === i, sent = fixing.includes(x.title)
              return (
                <div key={i} className="overflow-hidden rounded-xl ring-1 ring-line">
                  <button onClick={() => setOpenIssue(isOpen ? undefined : i)} aria-expanded={isOpen} className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-hover">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-wait" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-fg-1">{x.title}</span>
                      {!isOpen && <span className="mt-0.5 block truncate text-meta text-fg-3">{x.why}</span>}
                    </span>
                    <span className="flex shrink-0 gap-1">{x.prs.map((n) => <span key={n} className="rounded-full bg-fill px-1.5 font-mono text-micro text-fg-3">#{n}</span>)}</span>
                    <ChevronRight className={`mt-0.5 size-3.5 shrink-0 text-fg-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 border-t border-line px-3 py-2.5 pl-8">
                      <p className="leading-relaxed text-fg-2">{x.why}</p>
                      <p className="leading-relaxed text-fg-2"><span className="font-medium text-fg-1">Fix: </span>{x.fix}</p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <button onClick={() => fix([x])} disabled={sent} className="btn-primary btn-sm">{sent ? 'Sent to the agents' : `Have the agent${x.prs.length === 1 ? '' : 's'} fix it`}</button>
                        {x.prs.map((n) => <button key={n} onClick={() => open(n)} className="btn-ghost btn-sm">Open #{n}</button>)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {c.agrees && <p className="px-0.5 pt-1 text-meta text-fg-3">{c.agrees}</p>}
          </div>
        )}
      {c && c.unread.length > 0 && <p className="px-0.5 text-meta text-fg-4">Not checked (no finished run yet): {c.unread.map((n) => `#${n}`).join(', ')}</p>}
    </section>
  )
}
