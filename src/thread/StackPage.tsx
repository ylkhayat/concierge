// A stack as one thing: its pull requests in a compact table (bottom first), what waits on you across all of them as
// one answer, the actions that make sense for the whole stack, and the tickets it carries. Nothing is stored for a
// stack: every number here is rolled up from its PRs as they are now, so unstacking or restacking just changes what the
// page shows. A single PR is a stack of one. Each PR keeps its own conversation, one click away.
import { ArrowRight, Layers, LoaderCircle, Play } from 'lucide-react'
import { useState } from 'react'
import { askLine } from '../../server/reply.ts'
import { api, type PrView, type TicketView } from '../lib.ts'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { plain } from '../components/StackNav.tsx'
import type { StackView } from '../desk.ts'
import { useStackNext } from './StackNext.tsx'

// what its agent asks you, once it has finished
const askOf = (p: PrView) => (p.job && p.job.state !== 'running' && p.job.state !== 'queued' ? askLine(p.job.next) : undefined)
const busy = (p: PrView) => p.status === 'preparing' || p.status === 'queued' || p.status === 'posting'
const Count = ({ n, label, tone }: { n: number; label: string; tone: string }) => (
  <span className="flex items-baseline gap-1.5"><span className={`text-title font-semibold tabular-nums ${n ? tone : 'text-fg-4'}`}>{n}</span><span className="text-meta text-fg-3">{label}</span></span>
)

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
  const add = members.reduce((n, p) => n + p.additions, 0), del = members.reduce((n, p) => n + p.deletions, 0)
  const th = 'whitespace-nowrap px-2 py-1.5 text-left text-micro font-medium uppercase tracking-wide text-fg-3'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <header>
          <p className="flex items-center gap-1.5 text-meta font-medium text-accent-text"><Layers className="size-3.5" />{all.length === 1 ? 'A stack of one' : `Stack · ${all.length} pull requests`}<span className="font-mono text-fg-3">{members[0]?.repo.split('/')[1]}</span></p>
          <h1 className="mt-1 text-title font-semibold tracking-tight text-fg-1">{plain(all[0].title ?? members[0]?.title ?? '')}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Count n={asks.length} label="waiting on you" tone="text-wait-text" />
            <Count n={working.length} label={working.length === 1 ? 'agent working' : 'agents working'} tone="text-run-text" />
            <Count n={fresh.length} label="not started" tone="text-fg-1" />
            <span className="text-meta tabular-nums text-fg-3"><span className="text-ok-text">+{add}</span> <span className="text-fail-text">−{del}</span></span>
            {fresh.length > 0 && (
              <button onClick={run} disabled={starting} className="ml-auto inline-flex items-center gap-1.5 btn-primary btn-sm" title="Each starts once the one below it is done, so it reads what that one found">
                {starting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}{fresh.length === 1 ? `Start #${fresh[0].number}` : `Start the ${fresh.length} not started, bottom first`}
              </button>
            )}
          </div>
        </header>

        {/* what the whole stack waits on, answered once: the same card as a PR's Stack tab (with two or more asking) */}
        {card ? <section className="card p-3.5">{card}</section>
          : asks.length === 1 ? (
            <button onClick={() => onSelect(asks[0].id)} className="card flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-small transition-colors hover:bg-hover">
              <span className="size-1.5 shrink-0 rounded-full bg-wait" /><span className="min-w-0 flex-1 truncate text-fg-1">Only #{asks[0].number} waits on you: {askOf(asks[0]) ?? asks[0].flow.why}</span>
              <span className="inline-flex shrink-0 items-center gap-1 font-medium text-accent-text">Open<ArrowRight className="size-3.5" /></span>
            </button>
          ) : null}

        <section className="card overflow-hidden">
          <table className="w-full text-small">
            <thead className="border-b border-line bg-fill/40"><tr><th className={`${th} w-8 pl-3.5`} /><th className={th}>Pull request, bottom first</th><th className={th}>Where it stands</th><th className={`${th} text-right`}>Findings</th><th className={`${th} text-right`}>Threads</th><th className={`${th} pr-3.5 text-right`}>Change</th></tr></thead>
            <tbody className="divide-y divide-line">
              {all.map((s, i) => {
                const p = members.find((m) => m.number === s.number)
                if (!p) return <tr key={s.number} className="text-fg-4"><td className="pl-3.5 tabular-nums">{i + 1}</td><td className="px-2 py-2" colSpan={5}><span className="font-mono text-meta">#{s.number}</span> {plain(s.title ?? '')} <span className="text-meta">· not tracked here</span></td></tr>
                const ask = askOf(p)
                const findings = p.crit?.aiComments ?? 0, blocking = p.crit?.blocking ?? 0
                return (
                  <tr key={p.id} onClick={() => onSelect(p.id)} className="cursor-pointer align-top transition-colors hover:bg-hover">
                    <td className="py-2 pl-3.5 tabular-nums text-fg-4">{i + 1}</td>
                    <td className="px-2 py-2">
                      <button onClick={(e) => { e.stopPropagation(); onSelect(p.id) }} className="block text-left"><span className="font-mono text-meta text-fg-3">#{p.number}</span> <span className="font-medium text-fg-1">{plain(p.title)}</span></button>
                      <span className={`mt-0.5 block text-meta ${ask ? 'text-wait-text' : 'text-fg-3'}`}>{ask ? `Asks: ${ask}` : p.flow.why}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2"><StatusBadge status={p.status} mine={p.mine} /></td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{findings ? <span className={blocking ? 'text-fail-text' : 'text-fg-2'}>{findings}{blocking ? ` · ${blocking} blocking` : ''}</span> : <span className="text-fg-4">–</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{p.unresolved ? <span className={p.awaiting ? 'text-wait-text' : 'text-fg-2'}>{p.unresolved}{p.awaiting ? ` · ${p.awaiting} on you` : ''}</span> : <span className="text-fg-4">–</span>}</td>
                    <td className="whitespace-nowrap py-2 pl-2 pr-3.5 text-right tabular-nums text-meta"><span className="text-ok-text">+{p.additions}</span> <span className="text-fail-text">−{p.deletions}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {tickets.length > 0 && (
          <section className="card">
            <h2 className="border-b border-line px-3.5 py-2 text-small font-semibold text-fg-1">{tickets.length === 1 ? 'Its ticket' : `Its ${tickets.length} tickets`}</h2>
            <ul className="divide-y divide-line">{tickets.map((t) => <TicketRow key={t.id} t={t} onOpen={() => onTicket(t.id)} />)}</ul>
          </section>
        )}
      </div>
    </div>
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
