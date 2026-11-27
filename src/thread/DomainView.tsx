// The product lens of a PR (server/domain.ts), drawn the way domain-driven design draws it: the context map, and the
// event-storming notes (orange events, yellow entities, blue steps of the journey, lilac rules, pink open questions).
// Product reads the domain first; Design reads the journey and the screens first. Nothing technical in either.
import { LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { Domain } from '../../server/domain.ts'
import { api } from '../lib.ts'
import { refresh, useApi } from '../query.ts'

type Read = { domain: Domain | null; stale: boolean; writing: boolean; explained: boolean }
const MARK = { added: ['+', 'text-ok-text'], changed: ['~', 'text-wait-text'], removed: ['−', 'text-fail-text line-through'], same: ['', 'text-fg-3'] } as const
// event storming's colours
const NOTE = {
  event: 'bg-wait/20 text-wait-text',
  entity: 'bg-wait/20 text-wait-text',
  step: 'bg-run/20 text-run-text',
  rule: 'bg-accent/20 text-accent-text',
  hot: 'bg-pink-200 text-pink-950 dark:bg-pink-400/20 dark:text-pink-100',
}
const Note = ({ kind, children, sub }: { kind: keyof typeof NOTE; children: ReactNode; sub?: ReactNode }) => (
  <div className={`min-w-[120px] max-w-[220px] rounded-[3px] px-2.5 py-2 text-small leading-snug shadow-[0_1px_0_rgb(0_0_0/0.08),0_6px_14px_-8px_rgb(0_0_0/0.4)] ${NOTE[kind]}`}>
    {children}{sub && <div className="mt-1 text-micro opacity-75">{sub}</div>}
  </div>
)
const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section className="space-y-2.5">
    <h3 className="label text-fg-4">{title}{hint && <span className="ml-2 font-normal normal-case tracking-normal">{hint}</span>}</h3>
    {children}
  </section>
)

/** `path`: the lens's address, a PR's (/prs/<id>/domain) or a ticket's (/exec/tickets/<id>/domain). */
export function DomainView({ path, focus }: { path: string; focus: 'product' | 'design' }) {
  const q = useApi<Read>(path, { refetchInterval: (x) => (x.state.data?.writing ? 2000 : false) })
  const write = () => api(path, {}).then(() => refresh(path))
  // nothing yet: it writes itself on first look (a few cents), once
  const asked = useRef(false)
  useEffect(() => { if (q.data && !q.data.domain && !q.data.writing && !asked.current) { asked.current = true; void write() } }, [q.data])
  const r = q.data, d = r?.domain
  if (!d) return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {r?.writing || !r ? <LoaderCircle className="size-5 animate-spin text-accent-text" /> : <Sparkles className="size-5 text-accent-text" />}
      <p className="text-body font-medium text-fg-1">{r?.writing || !r ? 'Reading it in the business’s own words…' : 'Not written yet'}</p>
      {r && !r.explained && <p className="max-w-sm text-small text-fg-3">Explain hasn’t run on it yet, so this reads only the description and the tickets.</p>}
      {r && !r.writing && <button onClick={write} className="btn-primary">Write it</button>}
    </div>
  )

  const touched = d.contexts.filter((c) => c.touched), around = d.contexts.filter((c) => !c.touched)
  const contextMap = (
    <Section title="Areas it touches" hint="the parts of the business this change reaches">
      <div className="flex flex-wrap gap-3">
        {touched.map((c) => (
          <div key={c.name} className="min-w-[220px] flex-1 rounded-panel border-2 border-dashed border-accent/50 bg-accent-soft/40 p-3">
            <p className="text-small font-semibold text-fg-1">{c.name}</p>
            <p className="text-meta text-fg-3">{c.meaning}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {d.entities.filter((e) => e.context === c.name).map((e) => (
                <Note key={e.name} kind="entity" sub={e.meaning}><span className={`mr-1 font-mono font-bold ${MARK[e.change][1].split(' ')[0]}`}>{MARK[e.change][0]}</span><b className={e.change === 'removed' ? 'line-through' : ''}>{e.name}</b></Note>
              ))}
            </div>
          </div>
        ))}
        {around.map((c) => (
          <div key={c.name} title={c.meaning} className="rounded-panel border-2 border-dashed border-line px-3 py-2 text-small text-fg-3"><b className="font-medium text-fg-2">{c.name}</b><span className="block text-micro">next to it</span></div>
        ))}
      </div>
      {/* an entity the model placed outside the contexts it named still shows */}
      {d.entities.some((e) => !touched.some((c) => c.name === e.context)) && (
        <div className="flex flex-wrap gap-2">{d.entities.filter((e) => !touched.some((c) => c.name === e.context)).map((e) => <Note key={e.name} kind="entity" sub={`${e.context} · ${e.meaning}`}><b>{e.name}</b> <span className="opacity-70">{e.change}</span></Note>)}</div>
      )}
    </Section>
  )
  const journey = !!d.journey.length && (
    <Section title="The journey" hint="as it is after this change">
      <ol className="flex flex-wrap items-stretch gap-2">
        {d.journey.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-fg-4">→</span>}
            <div className={s.change === 'same' ? 'opacity-60' : s.change === 'removed' ? 'opacity-70 line-through' : ''}>
              <Note kind="step" sub={<>{s.actor}{s.change !== 'same' && <b className="ml-1.5 uppercase">{s.change}</b>}</>}>{s.step}</Note>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  )
  const events = !!d.events.length && (
    <Section title="What happens">
      <div className="flex flex-wrap gap-2">{d.events.map((e) => <Note key={e.name} kind="event" sub={e.when}><b>{e.name}</b></Note>)}</div>
    </Section>
  )
  const rules = !!d.rules.length && (
    <Section title="Rules">
      <div className="flex flex-wrap gap-2">{d.rules.map((x, i) => <Note key={i} kind="rule" sub={x.change}><span className={x.change === 'removed' ? 'line-through' : ''}>{x.rule}</span></Note>)}</div>
    </Section>
  )
  const screens = !!d.screens.length && (
    <Section title="What people see" hint="screens, words and states">
      <ul className="divide-y divide-line overflow-hidden rounded-ctl ring-1 ring-line">
        {d.screens.map((s) => <li key={s.name} className="px-3 py-2"><p className="text-small font-semibold text-fg-1">{s.name}</p><p className="text-small text-fg-2">{s.change}</p>{s.states && <p className="mt-0.5 text-meta text-fg-3">States: {s.states}</p>}</li>)}
      </ul>
    </Section>
  )
  const glossary = !!d.glossary.length && (
    <Section title="Words it uses" hint="what each one means here">
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
        {d.glossary.map((g) => <div key={g.term} className="contents"><dt className="text-small font-semibold text-fg-1">{g.term}</dt><dd className="text-small text-fg-2">{g.meaning}</dd></div>)}
      </dl>
    </Section>
  )
  const questions = !!d.questions.length && (
    <Section title={focus === 'design' ? 'For design to decide' : 'For product to decide'}>
      <div className="flex flex-wrap gap-2">{d.questions.map((x, i) => <Note key={i} kind="hot">{x}</Note>)}</div>
    </Section>
  )

  return (
    <div className="space-y-6 p-5">
      <header className="space-y-1.5">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-reading font-semibold leading-snug text-fg-1">{d.headline}</p>
          <button onClick={write} disabled={r!.writing} title="Write it again" className="shrink-0 rounded-ctl p-1.5 text-fg-3 hov hover:text-fg-1 disabled:opacity-50">
            {r!.writing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
        </div>
        <p className="text-body text-fg-2">{d.outcome}</p>
        {r!.stale && <p className="text-meta text-wait-text">Written for an earlier push: the refresh button reads the latest.</p>}
      </header>
      {focus === 'design'
        ? <>{journey}{screens}{glossary}{questions}{contextMap}{events}{rules}</>
        : <>{contextMap}{journey}{rules}{events}{glossary}{questions}{screens}</>}
    </div>
  )
}
