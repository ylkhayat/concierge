import { ArrowRight, GitMerge, GitPullRequest, Upload } from 'lucide-react'
import type { NextSteps as Steps } from '../../server/next.ts'
import type { TicketView } from '../lib.ts'
import { useApi } from '../query.ts'
import { ago } from '../time.ts'
import { primary } from './PrDetail.tsx'

type Handed = NonNullable<TicketView['handed']>
const STATE: Record<Handed['to'][number]['prState'], string> = { open: '', merged: 'merged', closed: 'closed' }

/**
 * A ticket handed over to its PRs (handover.ts): which ones, that their agent owns the next steps now, and what that
 * agent asks, read-only (answered on the PR, the one place they are answered). The ticket's own steps from before are
 * not offered: what it left open went, or goes, to that agent.
 */
export function HandedPanel({ h, onOpen }: { h: Handed; onOpen: (p: { repo: string; number: number; title?: string }) => void }) {
  const main = h.to.find((p) => p.number === h.main) ?? h.to.at(-1)!
  const q = useApi<{ steps: Steps | null }>(main.tracked ? `/prs/${encodeURIComponent(h.mainId)}/next` : undefined)
  const theirs = q.data?.steps?.steps ?? []
  return (
    <div className="space-y-3">
      <p className="text-body leading-relaxed text-fg-2">
        Handed over to{' '}
        {h.to.map((p, i) => (
          <span key={p.number}>{i > 0 && ' → '}
            <button type="button" onClick={() => onOpen(p)} className="font-semibold text-accent-text hover:underline" title={p.title}>#{p.number}</button>
            {STATE[p.prState] && <span className="ml-1 rounded-full bg-fill px-1.5 text-micro text-fg-3">{STATE[p.prState]}</span>}
          </span>
        ))}
        {h.to.length > 1 && ' (its stack)'}{' '}
        <span className="text-fg-3">{ago(h.at)}, {h.why === 'opened' ? 'when its run opened it' : h.why === 'pr-agent' ? 'once its agent worked on it' : 'as it has pull requests'}.</span>{' '}
        Its agent owns the next steps now; this ticket’s own were written before that, so they are no longer offered.
      </p>
      <button type="button" onClick={() => onOpen(main)} className={`${primary} w-full justify-center py-2.5`}>
        {main.prState === 'merged' ? <GitMerge className="size-4" /> : <GitPullRequest className="size-4" />}Open #{main.number}{main.prState === 'open' ? ' and its agent' : ''}
      </button>
      {main.tracked && main.prState === 'open' && (
        <div>
          <h4 className="mb-1 labelr text-fg-3">#{main.number}’s agent asks<span className="ml-1.5 font-normal normal-case tracking-normal">answered on #{main.number}</span></h4>
          {q.data === undefined ? <p className="text-small text-fg-4">Reading…</p>
            : !theirs.length ? <p className="text-small text-fg-3">Nothing: it isn’t waiting on you.</p>
            : <ol className="space-y-0.5">{theirs.map((x, i) => (
                <li key={i} className="flex items-start gap-1.5 text-small text-fg-2">
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-fg-4" />
                  <span className="min-w-0">{x.kind === 'decide' ? <span className="font-medium">Decide: </span> : null}{x.text}
                    {x.kind === 'publish' && <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-ok/10 px-1.5 label text-ok-text"><Upload className="size-2.5" />public</span>}
                  </span>
                </li>))}</ol>}
        </div>
      )}
      {!!h.carry?.length && (
        <details className="rounded-xl px-2.5 py-1.5 text-small ring-1 ring-line">
          <summary className="cursor-pointer list-none text-fg-3 hover:text-fg-1">
            {h.carry.length} step{h.carry.length === 1 ? '' : 's'} left open here {h.carriedAt ? `went to #${h.main}’s agent ${ago(h.carriedAt)}` : `go to #${h.main}’s agent with the next word it gets`}
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-meta text-fg-3">{h.carry.map((l, i) => <li key={i}>{l.replace(/^- /, '')}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

/** The box's hint on a handed ticket: where new words go. */
export const handedPlaceholder = (h: Handed) => h.mainState === 'open'
  ? `New work for this ticket: it goes to #${h.main}’s agent, or into a new PR stacked on it when it is a separate change`
  : `New work for this ticket: #${h.main} is ${h.mainState}, so it starts a new PR`
