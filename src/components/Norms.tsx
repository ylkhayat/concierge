import { ArrowUpRight, Check, ChevronDown, Scale } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Norm } from '../../server/crit.ts'
import type { Exception } from '../../server/norms.ts'
import { api, enc, type PrView } from '../lib.ts'
import { mini, secondary } from './PrDetail.tsx'

const host = (url: string) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return url } }

/**
 * Where the change drifts from how its libraries, its language and the house write things down: the review's NORM
 * findings, each with the rule, its source and the smallest change that aligns it. Advisory: none of it blocks.
 * "This is deliberate" answers and resolves the finding in crit and keeps the exception for later reviews of the repo.
 */
export function Norms({ pr, toast }: { pr: PrView; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [d, setD] = useState<{ norms: Norm[]; exceptions: Exception[] }>()
  const load = () => api(`/prs/${enc(pr.id)}/norms`).then(setD, () => setD({ norms: [], exceptions: [] }))
  useEffect(() => { void load() }, [pr.id, pr.crit?.drift]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="space-y-2 p-5">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-ctl bg-hover" />)}</div>

  const drift = d.norms.filter((n) => n.state === 'drift'), kept = d.norms.filter((n) => n.state === 'deliberate')
  const reviewed = (pr.crit?.aiComments ?? 0) > 0
  return (
    <div className="mx-auto max-w-[760px] space-y-4 px-5 py-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-reading font-semibold text-fg-1"><Scale className="size-4 text-accent-text" />Norms</h3>
        <p className="text-small text-fg-3">
          {drift.length ? <><span className="font-medium text-fg-1">{drift.length} drift{drift.length === 1 ? '' : 's'}</span></> : 'No drift'}
          {kept.length > 0 && <> · {kept.length} kept on purpose</>}
          <span className="text-fg-4"> · advisory, never blocking</span>
        </p>
      </header>

      {!drift.length && (
        <p className="rounded-ctl bg-hover px-4 py-3 text-body text-fg-2">
          {reviewed ? 'The review found nothing that departs from its libraries’ docs, the language’s conventions or the house’s ADRs.'
            : 'Norms come with the review: anything that departs from its libraries’ docs, the language’s conventions or the house’s ADRs shows up here, with the source that says so.'}
        </p>
      )}

      <ul className="space-y-2">{drift.map((n) => <Drift key={n.id} pr={pr} n={n} toast={toast} onDone={load} />)}</ul>

      {(kept.length > 0 || d.exceptions.length > 0) && (
        <details className="group/kept">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-small font-medium text-fg-3 hover:text-fg-1">
            <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open/kept:rotate-0" />
            Kept on purpose in {pr.repo.split('/')[1]}<span className="text-fg-4">{d.exceptions.length}</span>
          </summary>
          <ul className="mt-2 space-y-1.5 pl-5 text-small">
            {d.exceptions.map((x) => (
              <li key={x.norm} className="text-fg-2">
                <span className="text-fg-1">{x.norm}</span>{x.why && <span className="text-fg-3">: {x.why}</span>}
                <span className="text-fg-4"> · #{x.pr} · </span><a href={x.source} target="_blank" rel="noreferrer" className="text-fg-4 hover:text-accent-text">{host(x.source)}</a>
              </li>
            ))}
          </ul>
          <p className="mt-2 pl-5 text-meta text-fg-4">Later reviews of this repo are told not to file these.</p>
        </details>
      )}
    </div>
  )
}

function Drift({ pr, n, toast, onDone }: { pr: PrView; n: Norm; toast: (m: string, tone?: 'ok' | 'error') => void; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const keep = () => {
    setBusy(true)
    api(`/prs/${enc(pr.id)}/norms/${enc(n.id)}/deliberate`, { why }).then(
      () => { toast('Kept on purpose: resolved in crit, and later reviews won’t file it'); onDone() },
      (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false))
  }
  return (
    <li className="rounded-ctl bg-surface-1 p-3.5 shadow-e1">
      <p className="text-body font-medium text-fg-1">{n.claim}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-small text-fg-2">
        <span className="text-fg-4">Norm</span>{n.norm}
        <a href={n.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-text hover:underline">{host(n.source)}<ArrowUpRight className="size-3" /></a>
      </p>
      {n.fix && <p className="mt-1 text-small text-fg-2"><span className="text-fg-4">Align </span>{n.fix}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {n.path && <span className="min-w-0 truncate font-mono text-meta text-fg-4">{n.path}{n.line ? `:${n.line}` : ''}</span>}
        <span className="flex-1" />
        {!asking && <button onClick={() => setAsking(true)} className={mini}><Check className="size-3.5" />This is deliberate</button>}
      </div>
      {asking && (
        <div className="mt-2 flex items-center gap-2">
          <input autoFocus value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} placeholder="Why, briefly (e.g. ADR-0031)"
                 onKeyDown={(e) => { if (e.key === 'Enter' && !busy) keep(); if (e.key === 'Escape') setAsking(false) }}
                 className="min-w-0 flex-1 rounded-ctl bg-bg-app px-2.5 py-1.5 text-small text-fg-1 outline-none ring-1 ring-line placeholder:text-fg-4 focus:ring-accent/50" />
          <button onClick={keep} disabled={busy} className={`${secondary} py-1.5 text-small`}>{busy ? 'Keeping…' : 'Keep it'}</button>
        </div>
      )}
    </li>
  )
}
