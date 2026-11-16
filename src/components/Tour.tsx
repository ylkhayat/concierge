import {
  ArrowLeft, ArrowRight, ArrowUpRight, Briefcase, Check, ChevronDown, CircleCheck, CircleX, Coins, Compass, Crosshair, Eye, FileCode, Flag, Layers, ListChecks, LoaderCircle, Lock,
  Map as MapIcon, MessageCircleQuestion, RefreshCw, ShieldCheck, Sparkles, Users, Wrench, type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from 'react'
import type { Overlay, Shape, Tour as TourData } from '../../server/explain.ts'
import type { StackTour } from '../../server/stackTour.ts'
import { api, enc, isTyping, param, setParam, type PrView } from '../lib.ts'
import { Md } from './Md.tsx'

type Step = { key: string; title: string; kicker: string } & (
  | { type: 'overview' } | { type: 'why' } | { type: 'solution' } | { type: 'contrast' } | { type: 'answers' }
  | { type: 'step'; s: TourData['steps'][number] } | { type: 'scope' } | { type: 'done' })

const DIMENSION: Record<NonNullable<TourData['story']>['dimension'], { label: string; icon: LucideIcon; tone: string }> = {
  users: { label: 'Users', icon: Users, tone: 'bg-run/10 text-run-text ring-run/20' },
  business: { label: 'Business', icon: Briefcase, tone: 'bg-accent/10 text-accent-text ring-accent/20' },
  reliability: { label: 'Reliability', icon: ShieldCheck, tone: 'bg-ok/10 text-ok-text ring-ok/20' },
  security: { label: 'Security', icon: Lock, tone: 'bg-fail/10 text-fail-text ring-fail/20' },
  cost: { label: 'Cost', icon: Coins, tone: 'bg-wait/10 text-wait-text ring-wait/20' },
  developers: { label: 'Developers', icon: Wrench, tone: 'bg-fg-3/10 text-fg-2 ring-zinc-500/20 ' },
}

const KIND: Record<TourData['steps'][number]['kind'], { label: string; tone: string }> = {
  context: { label: 'Context', tone: 'bg-run/10 text-run-text' },
  core: { label: 'Core change', tone: 'bg-accent/10 text-accent-text' },
  supporting: { label: 'Supporting', tone: 'bg-accent/10 text-accent-text' },
  tests: { label: 'Tests', tone: 'bg-ok/10 text-ok-text' },
  cleanup: { label: 'Cleanup', tone: 'bg-fg-3/10 text-fg-2 ' },
}
const RISK = { low: 'bg-ok/10 text-ok-text', medium: 'bg-wait/10 text-wait-text', high: 'bg-fail/10 text-fail-text' }
const CHANGE = { added: 'text-ok-text', modified: 'text-wait-text', removed: 'text-fail-text' }
// where you were in each PR's tour, so coming back lands on the same step, and the checks you ticked
const at = new Map<string, { i: number; seen: Set<number> }>()
const ticked = new Map<string, Set<string>>()

/**
 * The PR as a guided walk: what it brings, then its parts in the order that makes them easy to follow (each with
 * what to check and the files, diff inline), then what does not belong to it. Business and Technical stay as they are.
 */
// when the scope last switched: the column's list slides in (this PR's steps from the left, the stack's stops from the right)
let switchedAt = 0
const sliding = () => Date.now() - switchedAt < 600

export function Tour(props: { pr: PrView; o: Overlay; onExplain: () => void; busy: boolean; prs: PrView[]; onSelect?: (id: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void
  onFinish?: { label: string; go: () => void } // where "next" leads after the last step (the reader: the next PR)
}) {
  // a stacked PR can be toured on its own, or the whole stack can (kept in the URL)
  const [scope, setScopeState] = useState<'pr' | 'stack'>(() => (props.pr.stack && param('tour') === 'stack' ? 'stack' : 'pr'))
  const setScope = (v: 'pr' | 'stack') => { switchedAt = Date.now(); setScopeState(v); setParam('tour', v === 'stack' ? 'stack' : null) }
  const switcher = props.pr.stack && (
    <div role="tablist" aria-label="Tour scope" className="mx-3 mt-3 grid grid-cols-2 rounded-lg bg-fill/60 p-0.5 text-meta font-semibold">
      {(['pr', 'stack'] as const).map((v) => (
        <button key={v} role="tab" aria-selected={scope === v} onClick={() => setScope(v)}
                className={`rounded-md py-1 transition-all ${scope === v ? 'sel text-fg-1 ' : 'text-fg-3 hover:text-fg-1'}`}>
          {v === 'pr' ? 'This PR' : `Whole stack · ${props.pr.stack!.length}`}
        </button>
      ))}
    </div>
  )
  return scope === 'stack' && props.pr.stack ? <StackTourView {...props} switcher={switcher} /> : <PrTour {...props} switcher={switcher} onFinish={props.onFinish} />
}

function PrTour({ pr, o, onExplain, busy, switcher, onFinish }: { pr: PrView; o: Overlay; onExplain: () => void; busy: boolean; switcher?: ReactNode; onFinish?: { label: string; go: () => void } }) {
  const t = o.tour
  const [pos, setPos] = useState(() => at.get(pr.id) ?? (() => { const i = Number(param('step')) || 0; return { i, seen: new Set([0, i]) } })())
  const [done, setDone] = useState(() => ticked.get(pr.id) ?? new Set<string>())
  const tick = (k: string) => setDone((d) => { const n = new Set(d); if (n.has(k)) n.delete(k); else n.add(k); ticked.set(pr.id, n); return n })
  const [slide] = useState(sliding)
  // the story first (why, what, before and now, quick answers), then the code; older tours open on the overview
  const steps: Step[] = !t ? [] : [
    ...(t.story ? [
      { key: 'why', type: 'why', title: 'Why this exists', kicker: 'The push' },
      { key: 'solution', type: 'solution', title: 'What was done', kicker: 'The answer' },
      { key: 'contrast', type: 'contrast', title: 'Before → Now', kicker: 'The difference' },
      ...(t.story.questions.length ? [{ key: 'answers', type: 'answers', title: 'Quick answers', kicker: 'Before you read the code' }] : []),
    ] as Step[] : [{ key: 'overview', type: 'overview', title: 'What this PR brings', kicker: 'Start here' } as Step]),
    ...t.steps.map((s, i): Step => ({ key: `s${i}`, type: 'step', s, title: s.title, kicker: KIND[s.kind].label })),
    ...(t.outOfScope.length ? [{ key: 'scope', type: 'scope', title: 'Out of scope', kicker: `${t.outOfScope.length} flagged` } as Step] : []),
    { key: 'done', type: 'done', title: 'You’re through', kicker: 'Wrap up' },
  ]
  const go = (i: number) => {
    const n = Math.max(0, Math.min(steps.length - 1, i))
    const next = { i: n, seen: new Set(pos.seen).add(n) }
    at.set(pr.id, next); setPos(next); setParam('step', n || null)
    document.getElementById('tour-body')?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  // a swipe sideways is a step (mostly sideways and far enough, so scrolling a long step never turns it)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const swipe = {
    onTouchStart: (e: TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } },
    onTouchEnd: (e: TouchEvent) => {
      const t0 = touch.current; touch.current = null
      if (!t0 || (e.target as HTMLElement).closest('pre, input, label')) return
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(pos.i + (dx < 0 ? 1 : -1))
    },
  }
  const [stepsOpen, setStepsOpen] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || document.querySelector('dialog[open]')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); go(pos.i + 1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(pos.i - 1) }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  })

  if (!t) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {switcher && <div className="w-64">{switcher}</div>}
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/10"><Compass className="size-7 text-accent" /></span>
        <h3 className="text-reading font-semibold">A guided tour of this PR</h3>
        <p className="max-w-md text-body text-fg-3">Step by step through what it brings, in the order that makes it easy to follow, with what to check and the diff right there, and anything that does not belong flagged. This explanation was made before tours existed.</p>
        <button onClick={onExplain} disabled={busy} className="inline-flex items-center gap-1.5 btn-primary btn-lg shadow-sm transition-all disabled:opacity-50">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{busy ? 'Explaining…' : 'Explain again to add the tour'}
        </button>
      </div>
    )
  }

  const cur = steps[Math.min(pos.i, steps.length - 1)] // a step from the URL may outrun a shorter tour
  const touched = (p: string) => o.touched.find((x) => x.path === p)
  const change = (p: string) => o.facts.changes.find((c) => c.path === p)?.status
  const covered = new Set(t.steps.flatMap((s) => s.paths))
  const pct = Math.round((pos.seen.size / steps.length) * 100)

  return (
    <div className="relative flex h-full min-h-0 flex-col md:flex-row">
      {/* on a phone: where you are in one slim bar; tapping it opens every stop */}
      <button onClick={() => setStepsOpen(true)} className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2.5 text-left md:hidden ">
        <Compass className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small font-medium text-fg-2 ">{steps[Math.min(pos.i, steps.length - 1)]?.kicker}</span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-fill-strong"><span className="block h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${((pos.i + 1) / Math.max(1, steps.length)) * 100}%` }} /></span>
        </span>
        <span className="shrink-0 font-mono text-meta tabular-nums text-fg-3">{pos.i + 1}/{steps.length}</span>
        <ChevronDown className="size-4 shrink-0 text-fg-3" />
      </button>
      {stepsOpen && <button aria-label="Close the steps" onClick={() => setStepsOpen(false)} className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] md:hidden" />}
      {/* the route: every stop, where you are, what you have seen (a column; on a phone a sheet from the bottom) */}
      <nav aria-label="Tour steps" onClick={(e) => { if ((e.target as HTMLElement).closest('li button')) setStepsOpen(false) }}
           className={`${stepsOpen ? 'fixed inset-x-0 bottom-0 z-40 flex max-h-[75dvh] animate-[sheet-in_260ms_var(--ease-snappy)] rounded-t-3xl bg-fill/60 pb-[env(safe-area-inset-bottom)] shadow-2xl' : 'hidden'} flex-col md:static md:z-auto md:flex md:max-h-none md:w-[264px] md:shrink-0 md:animate-none md:rounded-none md:border-r md:border-line md:bg-fill/60 md:pb-0 md:shadow-none`}>
        {switcher}
        <div className={`flex min-h-0 flex-1 flex-col ${slide ? 'animate-[drawer-in-left_260ms_var(--ease-snappy)]' : ''}`}>
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-2 text-meta font-semibold text-fg-3"><Compass className="size-3.5 text-accent" />Tour<span className="ml-auto tabular-nums">{pos.seen.size}/{steps.length}</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-fill-strong"><div className="h-full rounded-full bg-accent transition-all duration-500 ease-[var(--ease-snappy)]" style={{ width: `${pct}%` }} /></div>
        </div>
        <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {steps.map((s, i) => {
            const on = i === pos.i, seen = pos.seen.has(i)
            return (
              <li key={s.key}>
                <button onClick={() => go(i)} aria-current={on}
                        className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-all ${on ? 'sel ' : 'hover:bg-white/70 dark:hover:bg-zinc-900/50'}`}>
                  <span className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-semibold transition-colors ${on ? 'bg-accent text-on-accent' : seen ? 'bg-accent/15 text-accent-text' : 'bg-fill-strong text-fg-3'}`}>
                    {s.type === 'scope' ? <Flag className="size-3" /> : seen && !on ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-meta font-semibold ${s.type === 'scope' ? 'text-wait-text' : 'text-fg-3'}`}>{s.kicker}</span>
                    <span className={`block text-small leading-snug ${on ? 'font-semibold text-fg-1 ' : 'text-fg-2 '}`}>{s.title}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!t.story && (
          <div className="flex shrink-0 items-center gap-2 border-b border-accent/15 bg-accent/5 px-6 py-1.5 text-small text-accent-text">
            <Sparkles className="size-3.5" />An earlier tour. The new one opens with the story: why it exists, what was done, before and now.
            <button onClick={onExplain} disabled={busy} className="font-semibold underline-offset-2 hover:underline disabled:opacity-50">{busy ? 'Explaining…' : 'Refresh it'}</button>
          </div>
        )}
        <div id="tour-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain" {...swipe}>
          <article key={cur.key} className="mx-auto max-w-3xl animate-[rise-in_260ms_var(--ease-snappy)] space-y-5 px-4 py-5 sm:px-6 sm:py-6">
            <header className="space-y-2">
              <p className="text-meta font-semibold text-fg-3">Step {pos.i + 1} of {steps.length}{cur.type === 'step' && <span className={`ml-2 rounded-full px-2 py-0.5 normal-case tracking-normal ${KIND[cur.s.kind].tone}`}>{KIND[cur.s.kind].label}</span>}</p>
              <h2 className="text-balance text-display font-semibold sm:text-display leading-tight tracking-tight text-fg-1 ">{cur.type === 'overview' || cur.type === 'why' ? o.business.headline : cur.title}</h2>
            </header>

            {t.story && cur.type === 'why' && (() => {
              const D = DIMENSION[t.story.dimension] ?? DIMENSION.business
              return (
                <>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-semibold ring-1 ring-inset ${D.tone}`}><D.icon className="size-3.5" />{D.label}</span>
                    {t.story.ticket && <span className="rounded-full bg-fill px-2.5 py-1 font-mono text-small text-fg-2 ">{t.story.ticket}</span>}
                  </p>
                  <Md text={t.story.push} className="!text-title !leading-relaxed text-fg-1 [&_p]:!m-0" />
                </>
              )
            })()}

            {t.story && cur.type === 'solution' && <Md text={t.story.solution} className="!text-title !leading-relaxed text-fg-1 [&_p]:!m-0" />}

            {t.story && cur.type === 'contrast' && (
              <div className="space-y-4">
                <Lane name="Before" lane={t.story.before} muted />
                <Lane name="Now" lane={t.story.after} delay={t.story.before.shapes.length} />
              </div>
            )}

            {t.story && cur.type === 'answers' && (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {t.story.questions.map((x, i) => (
                    <div key={i} style={{ animationDelay: `${i * 70}ms` }} className="animate-[rise-in_320ms_var(--ease-snappy)_both] card p-4 ">
                      <dt className="flex items-start gap-1.5 text-small font-semibold text-fg-3"><MessageCircleQuestion className="mt-px size-3.5 shrink-0 text-accent" />{x.q}</dt>
                      <dd className="mt-1"><Md text={x.a} className="!text-reading [&_p]:!m-0" /></dd>
                    </div>
                  ))}
                </dl>
                <p className="flex flex-wrap items-center gap-2 text-small text-fg-2 ">
                  <span className={`rounded-full px-2 py-0.5 label ${RISK[o.business.risk]}`}>{o.business.risk} risk</span>{o.business.riskWhy}
                </p>
                {t.focus && (
                  <div className="flex items-start gap-3 rounded-2xl bg-accent/6 p-4 ring-1 ring-accent/25">
                    <Crosshair className="mt-0.5 size-5 shrink-0 text-accent" />
                    <div><h4 className="text-meta font-semibold text-accent-text">In the code, if you read one thing</h4><Md text={t.focus} className="mt-0.5 !text-reading font-medium [&_p]:!m-0" /></div>
                  </div>
                )}
              </>
            )}

            {cur.type === 'overview' && (
              <>
                {t.focus && (
                  <div className="flex items-start gap-3 rounded-2xl bg-accent/6 p-4 ring-1 ring-accent/25">
                    <Crosshair className="mt-0.5 size-5 shrink-0 text-accent" />
                    <div><h4 className="text-meta font-semibold text-accent-text">If you read one thing</h4><Md text={t.focus} className="mt-0.5 !text-reading font-medium [&_p]:!m-0" /></div>
                  </div>
                )}
                {/* a line each: the tour's own overview, or (older tours) the business summary cut short */}
                <dl className="divide-y divide-line overflow-hidden card ">
                  {([['What', t.overview?.what ?? o.business.what], ['Why', t.overview?.why ?? o.business.why], ['Who', t.overview?.who ?? o.business.who]] as const).map(([k, v]) => (
                    <div key={k} className="flex gap-4 px-4 py-2.5" title={t.overview ? undefined : v}>
                      <dt className="w-10 shrink-0 pt-0.5 text-meta font-semibold text-fg-3">{k}</dt>
                      <dd className={`min-w-0 flex-1 ${t.overview ? '' : 'line-clamp-2'}`}><Md text={v} className="!text-body [&_p]:!m-0" /></dd>
                    </div>
                  ))}
                </dl>
                <p className="flex flex-wrap items-center gap-2 text-small text-fg-2 ">
                  <span className={`rounded-full px-2 py-0.5 label ${RISK[o.business.risk]}`}>{o.business.risk} risk</span>{o.business.riskWhy}
                </p>
                <div className="rounded-2xl bg-accent/5 p-4 ring-1 ring-accent/20">
                  <h4 className="mb-2 flex items-center gap-1.5 text-meta font-semibold text-accent-text"><MapIcon className="size-3.5" />The route</h4>
                  <ol className="space-y-1 text-body text-fg-2 ">
                    {t.steps.map((s, i) => <li key={i} className="flex gap-2"><span className="w-5 shrink-0 text-right tabular-nums text-fg-3">{i + 2}.</span><span>{s.title} <span className="text-fg-3">· {s.paths.length} file{s.paths.length === 1 ? '' : 's'}</span></span></li>)}
                  </ol>
                  <p className="mt-2 text-small text-fg-3">{o.facts.changes.length} files changed{t.outOfScope.length ? `, ${t.outOfScope.length} flagged as out of scope` : ', all of them in scope'}.</p>
                </div>
              </>
            )}

            {cur.type === 'step' && (
              <>
                {/* the playbook: what changes, why this way, what to check */}
                {cur.s.what ? (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div className="card p-4 "><dt className="mb-1 text-meta font-semibold text-fg-3">What changes</dt><dd><Md text={cur.s.what} className="!text-body [&_p]:!m-0" /></dd></div>
                    <div className="card p-4 "><dt className="mb-1 text-meta font-semibold text-fg-3">Why this way</dt><dd><Md text={cur.s.why ?? ''} className="!text-body [&_p]:!m-0" /></dd></div>
                  </dl>
                ) : cur.s.narrative && <Md text={cur.s.narrative} className="!text-reading" />}
                {!!(cur.s.check ?? cur.s.lookFor)?.length && (
                  <div className="rounded-2xl bg-wait/6 p-4 ring-1 ring-wait/20">
                    <h4 className="mb-2 flex items-center gap-1.5 text-meta font-semibold text-wait-text"><ListChecks className="size-3.5" />Check while reading</h4>
                    <ul className="space-y-1">
                      {(cur.s.check ?? cur.s.lookFor)!.map((l, i) => {
                        const k = `${cur.key}:${i}`, on = done.has(k)
                        return (
                          <li key={i}>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 text-body transition-colors hover:bg-wait/6">
                              <input type="checkbox" checked={on} onChange={() => tick(k)} className="mt-0.5 size-3.5 shrink-0 accent-accent" />
                              <span className={on ? 'text-fg-3 line-through' : 'text-fg-2 '}><Md text={l} className="!text-body [&_p]:!m-0" /></span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                <div className="space-y-2">{cur.s.paths.map((p) => <FileCard key={p} pr={pr} path={p} status={change(p)} t={touched(p)} />)}</div>
              </>
            )}

            {cur.type === 'scope' && (
              <>
                <p className="text-body leading-relaxed text-fg-2 ">These changes don’t serve what the PR says it does. They may still be fine, but they make it harder to review and to revert: worth asking whether they belong in their own PR.</p>
                <div className="space-y-2">{t.outOfScope.map((x) => <FileCard key={x.path} pr={pr} path={x.path} status={change(x.path)} flag={x.reason} />)}</div>
              </>
            )}

            {cur.type === 'done' && (
              <div className="space-y-4">
                <p className="text-body leading-relaxed text-fg-2 ">That is the whole PR: {t.steps.length} parts, {covered.size} file{covered.size === 1 ? '' : 's'} walked through{t.outOfScope.length ? `, ${t.outOfScope.length} flagged as out of scope` : ''}.</p>
                {(() => {
                  const all = t.steps.flatMap((s, i) => (s.check ?? s.lookFor ?? []).map((q, j) => ({ q, k: `s${i}:${j}`, step: s.title })))
                  const open = all.filter((x) => !done.has(x.k))
                  return all.length > 0 && (
                    <div className="card p-4 ">
                      <h4 className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-fg-3"><ListChecks className="size-3.5" />Checks {all.length - open.length}/{all.length}</h4>
                      {open.length ? <ul className="space-y-1 text-small text-fg-2 ">{open.map((x) => <li key={x.k}><span className="text-fg-3">{x.step}: </span>{x.q}</li>)}</ul>
                        : <p className="text-small text-ok-text">Every check ticked.</p>}
                    </div>
                  )
                })()}
                <a href={`https://github.com/${pr.repo}/pull/${pr.number}/files`} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-body font-medium text-fg-2 ring-1 ring-line-strong transition-all hover:text-fg-1">Files on GitHub<ArrowUpRight className="size-3.5" /></a>
              </div>
            )}
          </article>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5 sm:px-6 sm:py-3 ">
          <button onClick={() => go(pos.i - 1)} disabled={pos.i === 0} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-reading font-medium sm:py-1.5 sm:text-body text-fg-2 transition-colors hov hover:text-fg-1 disabled:opacity-30 "><ArrowLeft className="size-4" />Back</button>
          <span className="hidden flex-1 text-center text-meta text-fg-3 sm:block"><kbd className="rounded bg-fill px-1 font-mono">←</kbd> <kbd className="rounded bg-fill px-1 font-mono">→</kbd> to move</span>
          <span className="flex-1 sm:hidden" />
          {pos.i === steps.length - 1 && onFinish && (
            <button onClick={onFinish.go} className="inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-reading font-medium text-on-accent shadow-sm sm:py-1.5 sm:text-body">
              <span className="truncate">{onFinish.label}</span><ArrowRight className="size-4 shrink-0" />
            </button>
          )}
          {pos.i < steps.length - 1 && (
            <button onClick={() => go(pos.i + 1)} className="group inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-reading sm:py-1.5 sm:text-body font-medium text-on-accent shadow-sm transition-all">
              <span className="truncate">{pos.i === 0 ? 'Start the tour' : `Next: ${steps[pos.i + 1].title}`}</span><ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

/** One file in a step: what changed and why, and its diff on demand. A flagged file says why it is out of scope. */
function FileCard({ pr, path, status, t, flag }: { pr: PrView; path: string; status?: string; t?: Overlay['touched'][number]; flag?: string }) {
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<string>()
  const toggle = () => {
    setOpen(!open)
    if (!diff) api(`/prs/${enc(pr.id)}/diff?path=${encodeURIComponent(path)}`).then((r: { diff: string }) => setDiff(r.diff), (e: Error) => setDiff(`Could not load the diff: ${e.message}`))
  }
  return (
    <div className={`overflow-hidden rounded-2xl bg-surface-1 ring-1 ${flag ? 'ring-wait/30' : 'ring-line '}`}>
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
        <FileCode className={`mt-0.5 size-4 shrink-0 ${status ? CHANGE[status as keyof typeof CHANGE] ?? 'text-fg-3' : 'text-fg-3'}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-small font-medium text-fg-1 ">{path}</span>
            {status && <span className={`shrink-0 text-micro font-semibold uppercase ${CHANGE[status as keyof typeof CHANGE] ?? 'text-fg-3'}`}>{status}</span>}
          </span>
          {flag ? <span className="mt-1 flex items-start gap-1.5 text-small text-wait-text"><Flag className="mt-0.5 size-3 shrink-0" />{flag}</span>
            : t && <span className={`mt-0.5 block text-small leading-relaxed text-fg-2 ${open ? '' : 'line-clamp-1'}`}>{t.after}{open && t.why && <span className="text-fg-3"> · {t.why}</span>}</span>}
        </span>
        <ChevronDown className={`mt-0.5 size-4 shrink-0 text-fg-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-line ">
          {diff === undefined ? <p className="flex items-center gap-2 px-4 py-3 text-small text-fg-3"><LoaderCircle className="size-3.5 animate-spin" />Loading the diff…</p> : <Diff text={diff} />}
          <a href={`https://github.com/${pr.repo}/blob/${pr.headSha}/${path}`} target="_blank" rel="noreferrer" className="flex items-center justify-end gap-1 px-4 py-2 text-meta text-fg-3 hover:text-fg-2">Open on GitHub<ArrowUpRight className="size-3" /></a>
        </div>
      )}
    </div>
  )
}

/** A unified diff, coloured: hunks as separators, file headers dropped. */
function Diff({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l))
  if (!lines.some(Boolean)) return <p className="px-4 py-3 text-small text-fg-3">No text changes (binary, or a pure rename).</p>
  return (
    <pre className="max-h-[420px] overflow-auto bg-fill/60 py-2 font-mono text-meta leading-[1.55]">
      {lines.map((l, i) => (
        <div key={i} className={`whitespace-pre px-4 ${l.startsWith('@@') ? 'mt-1 bg-accent/6 text-accent-text'
          : l.startsWith('+') ? 'bg-ok/10 text-ok-text' : l.startsWith('-') ? 'bg-fail/10 text-fail-text' : 'text-fg-2'}`}>{l || ' '}</div>
      ))}
    </pre>
  )
}

const stackAt = new Map<string, number>() // the slide each stack was left on, for this page's life

/**
 * The whole stack in a few slides: what it achieves and how the work is split, then each PR bottom to top with what it
 * adds and what it relies on below, each a click away from its own tour.
 */
function StackTourView({ pr, prs, onSelect, toast, switcher }: { pr: PrView; prs: PrView[]; onSelect?: (id: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void; switcher?: ReactNode }) {
  const chain = pr.stack!
  const [t, setT] = useState<StackTour | null>()
  const [writing, setWriting] = useState(false)
  // the stack's place, whichever of its PRs it is opened from
  const where = chain.map((x) => `${x.repo}#${x.number}`).join(',')
  const [i, setIState] = useState(() => stackAt.get(where) ?? 0)
  const setI = (f: number | ((x: number) => number)) => setIState((x) => { const n = typeof f === 'function' ? f(x) : f; stackAt.set(where, n); return n })
  const write = () => {
    setWriting(true)
    // being written already (asked from another PR of the stack): this joins it, nothing is written twice
    api(`/prs/${enc(pr.id)}/stack-tour`, {}).then((r: { tour: StackTour }) => { setT(r.tour); setI(0) }, (e: Error) => toast(e.message, 'error')).finally(() => setWriting(false))
  }
  useEffect(() => {
    api(`/prs/${enc(pr.id)}/stack-tour`).then((r: { tour: StackTour | null; writing?: boolean }) => { setT(r.tour); if (r.writing) write() }, () => setT(null))
  }, [pr.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || document.querySelector('dialog[open]') || !t) return
      if (e.key === 'ArrowRight') { e.preventDefault(); setI((x) => Math.min(chain.length, x + 1)) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [t, chain.length])
  const stale = !!t?.sig.startsWith('stale:')
  const slides = ['The stack', ...chain.map((s) => `#${s.number}`)]
  const s = i > 0 ? chain[i - 1] : undefined
  const part = s && t?.parts.find((x) => x.number === s.number)
  const tracked = s && prs.find((p) => p.repo === s.repo && p.number === s.number)
  const openTour = (id: string) => { setParam('tour', null); setParam('view', 'tour'); onSelect?.(id) }

  // where each PR's own explanation stands: the stack tour is written from them
  const explained = (n: number) => {
    const p = prs.find((x) => x.number === n && x.repo === pr.repo)
    return !p ? 'untracked' : p.explain?.state === 'running' || p.explain?.state === 'queued' ? 'writing' : p.explain?.state === 'done' ? (p.explain.headSha === p.headSha ? 'ok' : 'outdated') : 'none'
  }
  const DOT = { ok: 'bg-ok', writing: 'animate-pulse bg-run', outdated: 'bg-wait', none: 'bg-fill-strong', untracked: 'bg-fill-strong' }
  const card = 'card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] '
  const [slide] = useState(sliding)
  const roleOf = (c?: (typeof chain)[number]) => c ? t?.parts.find((x) => x.number === c.number)?.role ?? c.title : 'How it plays together'

  return (
    <div className="relative flex h-full min-h-0 flex-col md:flex-row">
      {/* a big screen: the same column as this PR's tour, the switch on top, the stack's stops sliding in below it */}
      <nav aria-label="Stack parts" className="hidden shrink-0 flex-col border-r border-line bg-fill/60 md:flex md:w-[264px]">
        {switcher}
        <div className={`flex min-h-0 flex-1 flex-col ${slide ? 'animate-[drawer-in_260ms_var(--ease-snappy)]' : ''}`}>
          <div className="px-4 pb-3 pt-4">
            <div className="flex items-center gap-2 text-meta font-semibold text-fg-3"><Layers className="size-3.5 text-accent" />Stack<span className="ml-auto tabular-nums">{i + 1}/{chain.length + 1}</span></div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-fill-strong"><div className="h-full rounded-full bg-accent transition-all duration-500 ease-[var(--ease-snappy)]" style={{ width: `${((i + 1) / (chain.length + 1)) * 100}%` }} /></div>
          </div>
          <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {[undefined, ...chain].map((c, n) => {
              const on = i === n, past = n < i, here = c?.number === pr.number, st = c ? explained(c.number) : 'ok'
              return (
                <li key={c?.number ?? 'stack'}>
                  <button onClick={() => setI(n)} disabled={!t} aria-current={on} title={c ? `#${c.number} ${c.title} · its explanation: ${st}` : 'The whole stack'}
                          className={`group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-all disabled:opacity-50 ${on ? 'sel ' : 'hover:bg-white/70 dark:hover:bg-zinc-900/50'}`}>
                    <span className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full transition-colors ${on ? 'bg-accent' : past ? 'bg-accent/15' : 'bg-fill-strong'}`}>
                      {c ? <span className={`size-1.5 rounded-full ${on ? 'bg-white' : DOT[st]}`} /> : <Layers className={`size-3 ${on ? 'text-white' : 'text-fg-3'}`} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-meta font-semibold text-fg-3"><span className="font-mono normal-case">{c ? `#${c.number}` : 'The stack'}</span>{here && <span className="rounded-full bg-accent/10 px-1 text-micro normal-case tracking-normal text-accent-text">you</span>}</span>
                      <span className={`line-clamp-2 text-small leading-snug ${on ? 'font-semibold text-fg-1 ' : 'text-fg-2 '}`}>{roleOf(c)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* a phone: the stack as a line of stops, bottom to top: where you are, and how far each PR's own explanation is */}
      <nav aria-label="Stack" className="shrink-0 border-b border-line px-6 pb-3 pt-3 md:hidden ">
        {switcher && <div className="mx-auto mb-3 w-72">{switcher}</div>}
        <ol className="relative mx-auto flex max-w-4xl">
          {/* the line, and how far along it you are */}
          <span aria-hidden className="absolute left-[calc(50%/var(--n))] right-[calc(50%/var(--n))] top-[9px] h-px bg-fill-strong" style={{ '--n': chain.length + 1 } as CSSProperties} />
          <span aria-hidden className="absolute left-[calc(50%/var(--n))] top-[9px] h-px bg-accent transition-[width] duration-500 ease-[var(--ease-snappy)]"
                style={{ '--n': chain.length + 1, width: `calc(${(i / (chain.length + 1)) * 100}%)` } as CSSProperties} />
          {[undefined, ...chain].map((c, n) => {
            const on = i === n, past = n < i, here = c?.number === pr.number
            const st = c ? explained(c.number) : 'ok'
            return (
              <li key={c?.number ?? 'stack'} className="relative flex min-w-0 flex-1 flex-col items-center px-1.5 text-center">
                <button onClick={() => setI(n)} disabled={!t} aria-current={on} title={c ? `#${c.number} ${c.title} · its explanation: ${st}` : 'The whole stack'}
                        className="group flex flex-col items-center gap-1.5 disabled:opacity-50">
                  <span className={`relative flex size-[19px] items-center justify-center rounded-full transition-all duration-300 ${on ? 'bg-accent shadow-[0_0_0_5px_rgb(139_92_246/0.15)]' : past ? 'bg-accent/80' : 'bg-surface-1 ring-1 ring-line-strong group-hover:ring-accent'}`}>
                    {c ? <span className={`size-1.5 rounded-full ${on || past ? 'bg-white' : DOT[st]}`} /> : <Layers className={`size-2.5 ${on || past ? 'text-white' : 'text-fg-3'}`} />}
                  </span>
                  {here && <span className="size-1 rounded-full bg-accent" aria-label="you" />}
                </button>
              </li>
            )
          })}
        </ol>
        {/* only the stop you are on is named: a phone has no room for every one's */}
        <p className="mt-2 truncate text-center text-small">
          <span className="font-mono font-semibold text-accent-text">{s ? `#${s.number}` : 'The stack'}</span>
          {s?.number === pr.number && <span className="ml-1 rounded-full bg-accent/10 px-1 text-micro font-semibold text-accent-text">you</span>}
          <span className="ml-1.5 text-fg-2 ">{roleOf(s)}</span>
        </p>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {t === undefined ? <p className="flex items-center gap-2 p-6 text-body text-fg-3"><LoaderCircle className="size-4 animate-spin" />Loading…</p>
          : !t ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-accent/10"><Layers className="size-7 text-accent" /></span>
              <h3 className="text-reading font-semibold">How the {chain.length} PRs fit together</h3>
              <p className="max-w-md text-body text-fg-3">One short story for the stack, then each PR bottom to top: what it adds and what it relies on. Written from each PR’s explanation, in a few seconds, about a cent.</p>
              {(() => {
                // written from each PR's explanation: the missing or outdated ones go first, bottom up
                const lacking = chain.filter((c) => ['none', 'outdated'].includes(explained(c.number)))
                const top = [...chain].reverse().map((c) => prs.find((x) => x.number === c.number && x.repo === pr.repo)).find(Boolean)
                return lacking.length > 0 && top && (
                  <button onClick={() => api(`/prs/${enc(top.id)}/explain-stack`, {}).then(() => toast('Explaining the stack bottom up'), (e: Error) => toast(e.message, 'error'))}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-small font-medium text-accent-text ring-1 ring-accent/30 transition-all hover:bg-accent/10">
                    <Layers className="size-3.5" />{lacking.length} of {chain.length} not explained yet · explain them first
                  </button>
                )
              })()}
              <button onClick={write} disabled={writing} className="inline-flex items-center gap-1.5 btn-primary btn-lg shadow-sm transition-all disabled:opacity-50">
                {writing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{writing ? 'Writing…' : 'Write the stack tour'}
              </button>
            </div>
          ) : (
            <article key={i} className="mx-auto max-w-3xl animate-[rise-in_280ms_var(--ease-snappy)] space-y-6 px-6 py-8">
              {stale && (
                <p className="flex items-center gap-2 rounded-xl bg-accent/5 px-3 py-2 text-small text-accent-text ring-1 ring-accent/15">
                  <RefreshCw className="size-3.5" />A PR in the stack changed since this was written.
                  <button onClick={write} disabled={writing} className="font-semibold underline-offset-2 hover:underline">{writing ? 'Writing…' : 'Refresh it'}</button>
                </p>
              )}
              <p className="text-meta font-semibold uppercase tracking-[0.14em] text-accent-text">{i === 0 ? `A stack of ${chain.length}` : `Part ${i} of ${chain.length} · bottom to top`}</p>
              {i === 0 ? (
                <>
                  <h2 className="text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">How it plays together</h2>
                  <p className="text-title leading-relaxed text-fg-2 ">{t.story}</p>
                  {/* the parts in order; a big screen lists them in the column already */}
                  <ol className="relative space-y-3 border-l border-accent/25 pl-5 md:hidden">
                    {chain.map((c, n) => (
                      <li key={c.number} className="relative">
                        <span className="absolute -left-[26px] top-1 flex size-3 items-center justify-center rounded-full bg-surface-1 ring-2 ring-accent" />
                        <button onClick={() => setI(n + 1)} className="group text-left">
                          <span className="font-mono text-meta text-fg-3">#{c.number}</span>
                          <span className="block text-reading text-fg-2 transition-colors group-hover:text-accent-text">{t.parts.find((x) => x.number === c.number)?.role ?? c.title}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="text-body text-fg-3">{t.order}</p>
                  {t.watch.length > 0 && (
                    <div className="rounded-2xl bg-wait/6 p-4 ring-1 ring-wait/20">
                      <h4 className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-wait-text"><Eye className="size-3.5" />Across the stack</h4>
                      <ul className="space-y-1 text-body text-fg-2 ">{t.watch.map((w, n) => <li key={n} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-wait" />{w}</li>)}</ul>
                    </div>
                  )}
                </>
              ) : s && (
                <>
                  <h2 className="text-balance text-[26px] font-semibold leading-[1.2] tracking-[-0.02em]">{s.title}</h2>
                  {/* what this one stands on: every PR below it */}
                  {i > 1 && (
                    <p className="flex flex-wrap items-center gap-1.5 text-small text-fg-3">
                      <span className="font-medium">Relies on</span>
                      {chain.slice(0, i - 1).map((c) => (
                        <button key={c.number} onClick={() => setI(chain.indexOf(c) + 1)} className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 font-mono transition-colors hover:text-accent-text">
                          <span className={`size-1.5 rounded-full ${DOT[explained(c.number)]}`} />#{c.number}
                        </button>
                      ))}
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className={card}><h4 className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-accent-text"><Sparkles className="size-3.5" />What it adds</h4><p className="text-reading leading-relaxed">{part?.role ?? '—'}</p></div>
                    <div className={card}><h4 className="mb-1.5 flex items-center gap-1.5 text-meta font-semibold text-fg-3"><Layers className="size-3.5" />Builds on</h4><p className="text-reading leading-relaxed">{part?.buildsOn ?? '—'}</p></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tracked && s.number !== pr.number && (
                      <button onClick={() => openTour(tracked.id)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-body font-medium text-accent-text ring-1 ring-accent/30 transition-all hover:bg-accent/10">
                        <Compass className="size-4" />Its tour
                      </button>
                    )}
                    {s.number === pr.number && <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-small text-fg-3 ring-1 ring-line-strong">You are here: switch to “This PR” for its tour</span>}
                    <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-body text-fg-2 ring-1 ring-line-strong transition-all">GitHub<ArrowUpRight className="size-3.5" /></a>
                  </div>
                </>
              )}
            </article>
          )}
      </div>
      {t && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-line px-6 py-3 ">
          <button onClick={() => setI(i - 1)} disabled={i === 0} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-body font-medium text-fg-2 transition-colors hov disabled:opacity-30 "><ArrowLeft className="size-4" />Back</button>
          {/* where you are in the slides */}
          <span className="flex flex-1 items-center justify-center gap-1.5">
            {slides.map((label, n) => <button key={label} onClick={() => setI(n)} aria-label={label} className={`h-1.5 rounded-full transition-all duration-300 ${n === i ? 'w-6 bg-accent' : 'w-1.5 bg-fill-strong hover:bg-fg-4'}`} />)}
          </span>
          {i < chain.length ? (
            <button onClick={() => setI(i + 1)} className="group inline-flex items-center gap-1.5 btn-primary shadow-sm transition-all">
              Next: #{chain[i].number}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          ) : <span className="w-[120px]" />}
        </footer>
      )}
      </div>
    </div>
  )
}

/** One lane of the before/now picture: the flow as shapes, the broken step red, the fixed one green. */
function Lane({ name, lane, muted, delay = 0 }: { name: string; lane: { shapes: Shape[]; caption: string }; muted?: boolean; delay?: number }) {
  const TONE = {
    bad: 'bg-fail/10 text-fail-text ring-fail/35',
    ok: 'bg-ok/10 text-ok-text ring-ok/35',
    neutral: 'bg-surface-1 text-fg-2 ring-line-strong',
  }
  return (
    <section className={`rounded-2xl p-4 ring-1 ${muted ? 'bg-fill/60 ring-line ' : 'bg-accent/4 ring-accent/20'}`}>
      <h4 className={`mb-3 text-meta font-semibold ${muted ? 'text-fg-3' : 'text-accent-text'}`}>{name}</h4>
      <ol className="flex flex-wrap items-center gap-y-2">
        {lane.shapes.map((x, i) => (
          <li key={i} className="flex items-center">
            {i > 0 && <ArrowRight className="mx-1.5 size-4 shrink-0 text-fg-4" />}
            <span style={{ animationDelay: `${(delay + i) * 90}ms` }}
                  className={`inline-flex animate-[rise-in_360ms_var(--ease-snappy)_both] items-center gap-1.5 rounded-xl px-3 py-2 text-body font-medium ring-1 ${TONE[x.tone] ?? TONE.neutral} ${x.tone === 'bad' ? 'shadow-[0_0_0_4px_rgb(244_63_94/0.06)]' : x.tone === 'ok' ? 'shadow-[0_0_0_4px_rgb(16_185_129/0.07)]' : ''}`}>
              {x.tone === 'bad' && <CircleX className="size-3.5 shrink-0" />}{x.tone === 'ok' && <CircleCheck className="size-3.5 shrink-0" />}{x.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-body text-fg-2 ">{lane.caption}</p>
    </section>
  )
}
