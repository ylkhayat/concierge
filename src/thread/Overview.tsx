// The panel's first view: the PR at a glance, as a rail of cards beside the conversation (a supporting pane: about a
// third of the width, meaningful only next to the chat). Everything here is a summary with its depth one click away
// (the tour, the description, the stack's own PRs): never a second reading surface competing with the conversation.
import { ArrowRight, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Overlay } from '../../server/explain.ts'
import { api, type PrView, type TicketView } from '../lib.ts'
import { ciLabel, ciTone } from '../components/PrStack.tsx'
import { useApi } from '../query.ts'
import { StatusBadge } from '../components/StatusBadge.tsx'
import { Md } from '../components/Md.tsx'

const enc = encodeURIComponent
const Panel = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="card">
    <div className="flex items-center gap-2 border-b border-line px-3.5 py-2"><h3 className="min-w-0 flex-1 truncate text-small font-semibold text-fg-1">{title}</h3>{aside}</div>
    <div className="px-3.5 py-3">{children}</div>
  </section>
)
const Fact = ({ k, tone, children }: { k: string; tone: 'ok' | 'wait' | 'fail' | 'idle'; children: ReactNode }) => (
  <p className="flex items-baseline gap-2.5 py-1 text-small">
    <span className="w-20 shrink-0 text-fg-3">{k}</span>
    <span className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${tone === 'ok' ? 'bg-ok' : tone === 'wait' ? 'bg-wait' : tone === 'fail' ? 'bg-fail' : 'bg-fg-4'}`} />
    <span className="min-w-0 flex-1 text-fg-1">{children}</span>
  </p>
)
const more = 'inline-flex items-center gap-1 text-meta font-medium text-accent-text hover:underline'

export function Overview({ pr, prs, onSelect, onOpen, toast }: {
  pr: PrView; prs: PrView[]; onSelect: (id: string) => void
  onOpen: (tab: 'explain' | 'description' | 'stack') => void // the depth behind a card
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  // the same read as the Explain tab (so it is already there when you open the tour)
  const task = pr.explain
  const q = useApi<{ overlay?: Overlay; stale: boolean }>(`/prs/${enc(pr.id)}/explain?v=${task?.state ?? ''}:${task?.endedAt ?? ''}:${pr.headSha}`, { placeholderData: (prev) => prev })
  const b = q.data?.overlay?.business
  const writing = task?.state === 'running' || task?.state === 'queued'
  const explain = () => api(`/prs/${enc(pr.id)}/explain`, {}).then(() => toast('Explaining this PR'), (e: Error) => toast(e.message, 'error'))

  const approved = (pr.verdicts ?? []).filter((v) => v.state === 'APPROVED').length, asked = (pr.verdicts ?? []).length
  const changes = (pr.verdicts ?? []).filter((v) => v.state === 'CHANGES_REQUESTED').map((v) => v.who)
  const findings = pr.crit?.aiComments ?? 0, blocking = pr.crit?.blocking ?? 0
  const stack = pr.stack && pr.stack.length > 1 ? pr.stack : undefined

  return (
    <div className="space-y-3 p-3.5">
      <Panel title="Where it stands" aside={<StatusBadge status={pr.status} mine={pr.mine} />}>
        <p className="mb-1.5 text-small leading-snug text-fg-2">{pr.flow.why}</p>
        {pr.mine ? <>
          <Fact k="Review" tone={changes.length ? 'fail' : asked && approved === asked ? 'ok' : asked ? 'wait' : 'idle'}>{changes.length ? `${changes.join(', ')} asked for changes` : asked ? `${approved} of ${asked} approved` : 'No reviewer yet'}</Fact>
          <Fact k="Threads" tone={pr.awaiting ? 'wait' : pr.unresolved ? 'idle' : 'ok'}>{pr.unresolved ? `${pr.unresolved} open${pr.awaiting ? `, ${pr.awaiting} waiting on you` : ', none waiting on you'}` : 'None open'}</Fact>
        </> : <Fact k="Findings" tone={blocking ? 'fail' : findings ? 'wait' : 'idle'}>{findings ? `${findings} from the review${blocking ? `, ${blocking} blocking` : ', none blocking'}` : pr.job ? 'Nothing flagged' : 'Not reviewed yet'}</Fact>}
        {pr.behindBase && <Fact k="Base" tone="wait">Behind the PR below it: needs a rebase</Fact>}
        <Fact k="Change" tone="idle"><span className="tabular-nums">{pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'} · <span className="text-ok-text">+{pr.additions}</span> <span className="text-fail-text">−{pr.deletions}</span></span> </Fact>
        <Fact k="Into" tone="idle"><span className="block truncate font-mono text-meta" title={pr.base}>{pr.base}</span></Fact>
      </Panel>

      <Panel title="In one minute" aside={b && <span className={`rounded-full px-1.5 text-micro font-semibold ${b.risk === 'high' ? 'bg-fail/12 text-fail-text' : b.risk === 'medium' ? 'bg-wait/14 text-wait-text' : 'bg-ok/12 text-ok-text'}`}>{b.risk} risk</span>}>
        {b ? <>
          <p className="text-body font-semibold leading-snug tracking-tight text-fg-1">{b.headline}</p>
          <div className="mt-1.5 space-y-1.5 text-small leading-relaxed text-fg-2"><Md text={b.what} /><Md text={b.why} /></div>
          {b.riskWhy && <p className="mt-1.5 text-meta text-fg-3">{b.riskWhy}</p>}
          <div className="mt-2.5 flex items-center gap-3">
            <button onClick={() => onOpen('explain')} className={more}>Take the tour<ArrowRight className="size-3.5" /></button>
            {q.data?.stale && <span className="text-meta text-fg-4">written for an older push</span>}
          </div>
        </> : (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-small text-fg-3">{writing ? 'Being explained now…' : 'Not explained yet: what it means, and a tour of the change.'}</p>
            {!writing && <button onClick={explain} className="inline-flex shrink-0 items-center gap-1.5 btn-primary btn-sm"><Sparkles className="size-3.5" />Explain</button>}
          </div>
        )}
        <button onClick={() => onOpen('description')} className={`${more} mt-2 ${b ? '' : 'block'}`}>The author’s description<ArrowRight className="size-3.5" /></button>
      </Panel>

      {stack && (
        <Panel title="The stack" aside={<span className="text-meta text-fg-3">{stack.length} PRs · bottom first</span>}>
          <ul className="-mx-1.5">
            {stack.map((s) => {
              const p = prs.find((x) => x.repo === s.repo && x.number === s.number), here = s.number === pr.number
              return (
                <li key={s.number}>
                  <button onClick={() => p && !here && onSelect(p.id)} disabled={!p || here} aria-current={here}
                          className={`flex w-full items-center gap-2 rounded-ctl px-1.5 py-1 text-left text-small transition-colors ${here ? 'bg-accent-soft/60' : 'enabled:hover:bg-hover'}`}>
                    <span className="shrink-0 font-mono text-meta text-fg-3">#{s.number}</span>
                    <span className={`min-w-0 flex-1 truncate ${here ? 'font-medium text-fg-1' : 'text-fg-2'}`}>{s.title}</span>
                    {p ? <StatusBadge status={p.status} mine={p.mine} compact /> : <span className="text-meta text-fg-4">not tracked</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}
    </div>
  )
}

/** The ticket at a glance, beside its conversation: where it stands, its pull requests, and what it asks for. */
export function TicketOverview({ t, why, onPr, onOpen }: {
  t: TicketView; why?: string // the status line the page already shows (what happens next)
  onPr: (p: { repo: string; number: number; title?: string }) => void; onOpen: () => void // the whole ticket
}) {
  const run = t.run
  const said = t.lastComment
  return (
    <div className="space-y-3 p-3.5">
      <Panel title="Where it stands" aside={<span className="rounded-full bg-fill px-1.5 text-micro font-medium text-fg-2">{t.state}</span>}>
        {why && <p className="mb-1.5 text-small leading-snug text-fg-2">{why}</p>}
        <Fact k="Agent" tone={t.queued ? 'idle' : t.busy ? 'wait' : run?.state === 'failed' ? 'fail' : run?.state === 'done' ? 'ok' : 'idle'}>
          {t.queued ? `Queued: ${t.queued.why}` : t.busy ? `Working${run?.phase ? `: ${run.phase}` : ''}` : run ? `${run.label ?? 'Ship'} ${run.state}${run.costUsd ? ` · $${run.costUsd.toFixed(2)}` : ''}` : 'No run yet'}
        </Fact>
        {t.waitsOn && <Fact k="Stack" tone="wait">Ready; submitted once {t.waitsOn} {t.waitsOn.includes(',') ? 'are' : 'is'} too</Fact>}
        <Fact k="Linear" tone={t.agentWaiting ? 'wait' : 'idle'}>{t.agentWaiting ? 'The agent asked on the ticket' : said ? `${said.by} commented last` : 'No comments'}</Fact>
      </Panel>

      {t.prs.length > 0 && (
        <Panel title={t.prs.length > 1 ? 'Its pull requests' : 'Its pull request'} aside={t.prs.length > 1 ? <span className="text-meta text-fg-3">bottom first</span> : undefined}>
          <ul className="-mx-1.5">
            {t.prs.map((p) => (
              <li key={`${p.repo}#${p.number}`}>
                <button onClick={() => onPr(p)} className="flex w-full items-center gap-2 rounded-ctl px-1.5 py-1 text-left text-small transition-colors hover:bg-hover">
                  <span className="shrink-0 font-mono text-meta text-fg-3">#{p.number}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-1">{p.title ?? `${p.repo.split('/').pop()}#${p.number}`}</span>
                  {!!p.openThreads && <span className="shrink-0 text-meta text-wait-text">{p.openThreads} thread{p.openThreads === 1 ? '' : 's'}</span>}
                  <span title={ciLabel(p)} className={`size-2 shrink-0 rounded-full ring-2 ${ciTone(p)}`} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="The ticket">
        {t.description.trim() ? <div className="max-h-56 overflow-hidden text-small leading-relaxed text-fg-2 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"><Md text={t.description} /></div> : <p className="text-small text-fg-3">No description.</p>}
        <button onClick={onOpen} className={`${more} mt-2`}>Read the whole ticket<ArrowRight className="size-3.5" /></button>
      </Panel>
    </div>
  )
}
