// Every next step and decision a stack's agents wait on, in one card: each PR's own list under its number, bottom of
// the stack first, answered with one Send. Each PR's agent gets exactly what it would get from its own page (its
// checklist and your note, through its reply), so handovers, queued runs and the hashed "already handed over" work the
// same. Shown on a stacked PR's page when two or more of the stack's PRs wait on you.
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check, CircleCheck, CopyMinus, Layers, LoaderCircle, RefreshCw, Send, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { PlanItem, StackPlan } from '../../server/stackPlan.ts'
import type { NextSteps as Steps } from '../../server/next.ts'
import { composeChecklist, type Step } from '../../server/reply.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { api, type PrView } from '../lib.ts'
import { refresh } from '../query.ts'

type Member = { pr: PrView; url: string; steps: Step[] }
// what "and push when done" adds to each agent's answer: this round's go-ahead to publish what it was asked to fix
const PUSH_WHEN_DONE = 'Push when done: once the changes for this answer are made and checked, push them to this PR\'s branch with a plain push (never --force or --force-with-lease: a rebase that needs one still waits for me) and post the replies you drafted for them. This is my go-ahead for this round only; anything I didn\'t ask for, and anything that fails, still waits for me.'
const enc = encodeURIComponent

/**
 * The card, or null when fewer than two of the stack's PRs wait on you (the page then keeps its layout as it was), and
 * which PRs it answers for (the page leaves out its own "asks you" card when this PR is one of them).
 */
export function useStackNext({ stack, prs, toast }: { stack: { repo: string; number: number }[]; prs: PrView[]; toast: (m: string, tone?: 'ok' | 'error') => void }): { card: ReactNode; covers: string[] } {
  // the stack's PRs with an agent that finished (one still working asks nothing yet), bottom first
  const members = stack.map((s) => prs.find((p) => p.repo === s.repo && p.number === s.number))
    .filter((p): p is PrView => !!p && !!p.job && p.job.state !== 'running' && p.job.state !== 'queued')
  // the same requests (and cache) as each PR's own panel: an answer there or here clears it in both
  const reads = useQueries({
    queries: members.map((p) => {
      const path = `/prs/${enc(p.id)}/next?v=${enc(`${p.job?.endedAt ?? ''}|${p.stackAnswered ?? ''}`)}`
      return { queryKey: [path], queryFn: () => api(path) as Promise<{ steps: Steps | null }>, staleTime: Infinity }
    }),
  })
  const waiting: Member[] = members.map((pr, i) => ({ pr, url: `/prs/${enc(pr.id)}`, steps: reads[i].data?.steps?.steps ?? [] })).filter((m) => m.steps.length)
  // read together: the same action proposed twice, and steps that can't both happen (server/stackSteps.ts)
  const items = waiting.flatMap((m) => m.steps.map((s, i) => ({ id: `${m.pr.number}:${i}`, pr: m.pr.number, text: s.text, kind: s.kind, options: s.options?.map((o) => o.label) })))
  const review = useQuery({
    queryKey: ['/stacks/steps-review', items.map((x) => `${x.id}|${x.text}`).join('\n')], enabled: items.length > 1, staleTime: Infinity,
    queryFn: () => api('/stacks/steps-review', { items }) as Promise<{ duplicates: { items: string[]; why: string }[]; conflicts: { items: string[]; why: string; title?: string; keep?: string }[] }>,
  })
  // a duplicate is kept where it is the PR's own work (its step names no other PR: no handover needed), else on the first
  // PR it appears on (bottom of the stack first); the other copies start unticked
  const copyOf = new Map<string, { of: string; why: string }>()
  const own = (id: string) => { const x = items.find((y) => y.id === id); return !!x && ![...x.text.matchAll(/#(\d+)/g)].some((m) => Number(m[1]) !== x.pr) }
  for (const g of review.data?.duplicates ?? []) {
    const keep = g.items.find(own) ?? g.items[0]
    for (const id of g.items) if (id !== keep) copyOf.set(id, { of: keep, why: g.why })
  }
  const clashes = new Map<string, { with: string[]; why: string }>()
  for (const g of review.data?.conflicts ?? []) for (const id of g.items) clashes.set(id, { with: g.items.filter((x) => x !== id), why: g.why })
  const [picks, setPicks] = useState<Record<string, number>>({}) // "<pr id>:<step>" → option
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  // this round may go all the way: each agent pushes what it fixes for this answer and posts the replies it drafted for
  // it, instead of stopping to ask. Only for this answer; a force-push and anything not asked still wait
  const [pushDone, setPushDone] = useState(() => { try { return localStorage.getItem('stack-push-done') === '1' } catch { return false } })
  const setPush = (on: boolean) => { setPushDone(on); try { localStorage.setItem('stack-push-done', on ? '1' : '0') } catch { /* private window */ } }
  const [sending, setSending] = useState(false)
  const { armed, arm } = useArm()
  // --- the short plan: the same items read together and boiled down to a few decisions and steps (server/stackPlan.ts).
  // Each line of it still stands for the agents' own items, so choosing here fills in exactly what each PR's agent gets
  const [steer, setSteer] = useState('') // the steer the plan was last read with
  const [again, setAgain] = useState(0)
  const [raw, setRaw] = useState(false) // look at every item as the agents wrote it
  const planItems: PlanItem[] = waiting.flatMap((m) => m.steps.map((s, i) => ({ id: `${m.pr.number}:${i}`, pr: m.pr.number, kind: s.kind, text: s.text, why: s.why, blocking: s.blocking,
    ...(s.options && { options: s.options.map((o) => o.label), recommended: s.options.findIndex((o) => o.recommended) }) })))
  const planSig = planItems.map((x) => `${x.id}|${x.text}`).join('\n')
  const plan = useQuery({
    queryKey: ['/stacks/plan', planSig, steer, again], enabled: waiting.length >= 2 && planItems.length > 1, staleTime: Infinity, retry: false,
    queryFn: () => api('/stacks/plan', { items: planItems, steer, again: again > 0, pr: waiting[0]?.pr.id }) as Promise<StackPlan & { sig: string; steer: string }>,
  })
  const keyById = new Map<string, string>(waiting.flatMap((m) => m.steps.map((_, i) => [`${m.pr.number}:${i}`, `${m.pr.id}:${i}`] as const)))
  // the plan's answer, read on every render: its suggested option for each decision (none: you choose), its steps on or
  // off. `picks` and `checked` hold only what you changed on top of it (copying the plan into them in an effect lost your
  // first click whenever the plan or the items arrived a render apart)
  const planPk: Record<string, number> = {}, planCk: Record<string, boolean> = {}
  if (plan.data) {
    const p = plan.data, k = (id: string) => keyById.get(id) ?? `?${id}`
    for (const d of p.decisions) for (const o of d.options) for (const x of o.picks) planPk[k(x.id)] = -1
    for (const d of p.decisions) if (d.suggested >= 0) for (const x of d.options[d.suggested].picks) planPk[k(x.id)] = x.option
    for (const st of p.steps) for (const id of st.items) planCk[k(id)] = st.on
    for (const sk of p.skipped) for (const id of sk.items) planCk[k(id)] = false
  }
  // a new plan (new items, your steer, Reanalyze) starts from its own answer again
  useEffect(() => {
    if (!plan.data) return
    setPicks({}); setChecked({})
    // the plan kept from before a reload was read with a steer: it is yours, so it is back in the box (and still goes to the agents)
    if (plan.data.steer && !note.trim()) setNote(plan.data.steer)
  }, [plan.data?.sig]) // eslint-disable-line react-hooks/exhaustive-deps
  const pickK = (k: string): number | undefined => picks[k] ?? planPk[k]
  const onK = (k: string): boolean | undefined => checked[k] ?? planCk[k]

  // (every hook above the early return: React needs the same hooks on every render)
  const anchor = waiting[0]?.pr
  const acts = useQuery({ queryKey: ['/actions', anchor?.id, anchor?.headSha], enabled: waiting.length >= 2 && !!anchor, staleTime: 30_000,
    queryFn: () => api(`/prs/${enc(anchor!.id)}/actions`) as Promise<{ id: string; counts: { stack?: number } }[]> })
  // one agent is resolving the stack now: what it was answered is under way, so nothing is asked again until it ends
  const driving = stack.map((s) => prs.find((p) => p.repo === s.repo && p.number === s.number)).find((p) => p?.stackRun)?.stackRun
  if (driving && waiting.length >= 2) return { covers: waiting.map((m) => m.pr.id), card: (
    <section className="flex items-center gap-2 rounded-xl bg-run/5 p-3 text-small text-fg-2 ring-1 ring-run/20">
      <LoaderCircle className="size-4 shrink-0 animate-spin text-run-text" />
      <span>{driving === 'running' ? 'One agent is resolving the stack with your answers, bottom first.' : 'Your answers are queued for the stack\'s agent.'} What it still needs from you comes back here when it ends.</span>
    </section>
  ) }
  if (waiting.length < 2) return { card: null, covers: [] }

  const key = (m: Member, i: number) => `${m.pr.id}:${i}`
  const idOf = (m: Member, i: number) => `${m.pr.number}:${i}`
  const label = (id: string) => `#${id.split(':')[0]}'s`
  // the agent's own picks start chosen, its recommended steps ticked: you change only what you disagree with
  const pickOf = (m: Member, i: number) => pickK(key(m, i)) ?? (m.steps[i].options ?? []).findIndex((o) => o.recommended)
  const on = (m: Member, i: number) => onK(key(m, i)) ?? (!!m.steps[i].checked && !copyOf.has(idOf(m, i)))
  const all = waiting.flatMap((m) => m.steps.map((s, i) => ({ m, s, i })))
  const unanswered = all.filter(({ m, s, i }) => s.kind === 'decide' && s.blocking && pickOf(m, i) < 0)
  const publishing = all.filter(({ m, s, i }) => s.kind === 'publish' && on(m, i))
  // a conflict still standing: every side of it is still ticked (a step) or chosen (a decision)
  const active = (id: string) => { const x = all.find(({ m, i }) => idOf(m, i) === id); return !!x && (x.s.kind === 'decide' ? pickOf(x.m, x.i) >= 0 : on(x.m, x.i)) }
  const standingAll = (review.data?.conflicts ?? []).filter((g) => g.items.every(active))

  // the plan's view of the answer: which option of a decision is chosen (the one whose picks are all in place), whether a step is on
  const p = plan.data, showPlan = !!p && !raw
  // decisions that clash (one agent asks "keep A or B?", another the opposite) are what a merged decision in the plan is
  // for: answered there, every one of them gets the same answer, so they no longer clash. Only clashes the plan didn't
  // merge stand, and only those hold Send back
  const isDecide = (id: string) => all.some(({ m, i, s: st }) => idOf(m, i) === id && st.kind === 'decide')
  const merged = (g: { items: string[] }) => !!p && g.items.every(isDecide) && p.decisions.some((d) => g.items.every((id) => d.options.some((o) => o.picks.some((x) => x.id === id))))
  const standing = standingAll.filter((g) => !merged(g))
  const chosen = (d: StackPlan['decisions'][number]) => d.options.findIndex((o) => o.picks.length > 0 && o.picks.every((x) => (pickK(keyById.get(x.id)!) ?? -1) === x.option))
  const choose = (d: StackPlan['decisions'][number], j: number) => setPicks((cur) => ({ ...cur, ...Object.fromEntries(d.options.flatMap((o) => o.picks.map((x) => [keyById.get(x.id)!, -1]))), ...(chosen(d) === j ? {} : Object.fromEntries(d.options[j].picks.map((x) => [keyById.get(x.id)!, x.option]))) }))
  const stepOn = (st: StackPlan['steps'][number]) => st.items.some((id) => !!onK(keyById.get(id)!))
  const toggle = (st: StackPlan['steps'][number]) => setChecked((cur) => ({ ...cur, ...Object.fromEntries(st.items.map((id) => [keyById.get(id)!, !stepOn(st)])) }))
  const prsOf = (ids: string[]) => [...new Set(ids.map((id) => Number(id.split(':')[0])))]
  // the stack realigned in one go, by Concierge rather than an agent per PR: each PR rebased on the one below it and
  // force-pushed with lease (Smart rebase on the stack). After the pushes have landed; asks for a second click
  const restackable = acts.data?.find((a) => a.id === 'smart-rebase')?.counts.stack ?? 0
  const restack = () => arm('restack', () => void api(`/prs/${enc(anchor!.id)}/actions`, { action: 'smart-rebase', scope: 'stack' }).then((r: { count: number }) => toast(`Restacking ${r.count} PRs: each on the one below, pushed with lease`), (e: Error) => toast(e.message, 'error')))
  // a conflict still standing: Send waits until one side is left out (or its decision unpicked); its card keeps one side in a click
  // a conflict's sides as buttons: each side in its agent's words (a decision: the question and the option chosen now)
  const sideLabel = (id: string) => {
    const x = all.find(({ m, i }) => idOf(m, i) === id)
    if (!x) return `#${id.split(':')[0]}`
    const pick = x.s.kind === 'decide' ? x.s.options?.[pickOf(x.m, x.i)]?.label ?? x.s.options?.find((o) => o.recommended)?.label : undefined
    return pick ? `${x.s.text}: ${pick}` : x.s.text
  }
  const keepSide = (g: { items: string[] }, id: string) => {
    drop(g.items.filter((x) => x !== id))
    const x = all.find(({ m, i }) => idOf(m, i) === id)
    if (x && x.s.kind !== 'decide') setChecked((cur) => ({ ...cur, [key(x.m, x.i)]: true }))
    if (x && x.s.kind === 'decide' && pickOf(x.m, x.i) < 0) { const r = (x.s.options ?? []).findIndex((o) => o.recommended); setPicks((cur) => ({ ...cur, [key(x.m, x.i)]: r >= 0 ? r : 0 })) }
  }
  const drop = (ids: string[]) => {
    setChecked((cur) => ({ ...cur, ...Object.fromEntries(ids.filter((id) => all.some(({ m, i }) => idOf(m, i) === id && m.steps[i].kind !== 'decide')).map((id) => [keyById.get(id)!, false])) }))
    setPicks((cur) => ({ ...cur, ...Object.fromEntries(ids.filter((id) => all.some(({ m, i }) => idOf(m, i) === id && m.steps[i].kind === 'decide')).map((id) => [keyById.get(id)!, -1])) }))
  }

  const send = async () => {
    if (publishing.length && armed !== 'send') return arm('send', () => {})
    if (armed) arm(armed, () => {})
    setSending(true)
    try {
      // one agent for the whole stack (drive-stack): every PR's answers in one message, worked bottom-up in one run
      const parts = waiting.map((m) => {
        const p = Object.fromEntries(m.steps.map((_, i) => [i, pickOf(m, i)]).filter(([, j]) => (j as number) >= 0))
        const c = Object.fromEntries(m.steps.map((_, i) => [i, on(m, i)]))
        const msg = composeChecklist(m.steps, p, c, '')
        return msg ? `## #${m.pr.number}\n${msg}` : ''
      }).filter(Boolean)
      const text = [note.trim() && `For the whole stack: ${note.trim()}`, ...parts].filter(Boolean).join('\n\n')
      if (!text) return
      await api('/stacks/drive', { pr: waiting[0].pr.id, text, push: pushDone })
      refresh(`/stacks/drive?pr=${enc(waiting[0].pr.id)}`)
      for (const m of waiting) refresh(`${m.url}/next`)
      // what you decided (and your steer) becomes part of the stack's direction: every agent on it is told from now on,
      // and the next plan is read against it, so the same question isn't put to you again
      const decided = (p?.decisions ?? []).map((d) => { const j = chosen(d); return j >= 0 ? `- ${d.question.replace(/[?:]+$/, '')}: ${d.options[j].label}` : '' }).filter(Boolean)
      const kept = [...decided, ...(note.trim() ? [`- ${note.trim().replace(/\s+/g, ' ')}`] : [])]
      if (kept.length && waiting[0]) await api(`/prs/${enc(waiting[0].pr.id)}/stack-direction`, { append: kept.join('\n') }).catch(() => {})
      setNote(''); setPicks({}); setChecked({})
      toast('One agent resolves the whole stack now, bottom first')
    } catch (e) { toast((e as Error).message, 'error') } finally { setSending(false) }
  }

  return { covers: waiting.map((m) => m.pr.id), card: (
    // the list scrolls inside the space under the chat; the note and Send stay in view
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Layers className="size-4 shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 leading-tight"><span className="block text-small font-semibold text-fg-1">The stack waits on you</span>
          <span className="block truncate text-meta text-fg-3">{waiting.length} PRs · {showPlan ? `${all.length} items boiled down to ${p!.decisions.length + p!.steps.length}` : `${all.length} item${all.length === 1 ? '' : 's'}`}</span></p>
        {(p || raw) && <button onClick={() => setRaw(!raw)} className="shrink-0 text-meta font-medium text-fg-3 hover:text-fg-1">{raw ? 'The short plan' : `Every item (${all.length})`}</button>}
        <button onClick={() => { setRaw(false); setAgain((n) => n + 1) }} disabled={plan.isFetching} title="Read every PR's suggestions together again" className="inline-flex shrink-0 items-center gap-1 btn-ghost btn-sm">
          <RefreshCw className={`size-3.5 ${plan.isFetching ? 'animate-spin' : ''}`} />{plan.isFetching ? 'Reading…' : 'Reanalyze'}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {showPlan && standing.map((g, k) => (
        // one card per conflict still standing: what it is, why, and each side as a button (the agents' favourite marked)
        <section key={k} className="rounded-xl bg-wait/8 p-2.5 ring-1 ring-wait/25">
          <p className="flex items-center gap-1.5 text-small font-medium text-fg-1"><TriangleAlert className="size-3.5 shrink-0 text-wait" />{g.title?.trim() || 'These can’t both happen'}<span className="ml-1 inline-flex gap-1">{prsOf(g.items).map((n) => <span key={n} className="rounded-full bg-fill px-1.5 font-mono text-micro text-fg-3">#{n}</span>)}</span></p>
          <p className="mt-0.5 text-meta text-fg-3">{g.why.replace(/\b(\d{2,6}):\d+\b/g, '#$1')}</p>
          <div role="radiogroup" aria-label={g.title || 'Keep one'} className="mt-1.5 flex flex-col gap-1">
            {g.items.map((id) => (
              <button key={id} role="radio" aria-checked={false} onClick={() => keepSide(g, id)} title="Keep this one: the other side is left out"
                      className="flex items-start gap-1.5 rounded-ctl bg-surface-1 px-2.5 py-1 text-left text-small text-fg-2 ring-1 ring-line transition-colors hover:bg-fill hover:text-fg-1">
                {g.keep === id ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-text" /> : <span className="mt-0.5 size-3.5 shrink-0" />}
                <span className="min-w-0"><span className="mr-1 font-mono text-micro text-fg-4">#{id.split(':')[0]}</span>{sideLabel(id)}{g.keep === id && <span className="ml-1.5 text-micro font-medium text-accent-text">the agents’ pick</span>}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {showPlan && <PlanView p={p!} chosen={chosen} choose={choose} stepOn={stepOn} toggle={toggle} prsOf={prsOf}
        restack={restackable > 1 ? <button onClick={restack} title="Rebase each PR of the stack on the one below it and push it with lease, in one go (Smart rebase on the stack). Best once the pushes above have landed" className={`relative ml-auto inline-flex items-center gap-1 btn-outline btn-sm ${armed === 'restack' ? 'isolate overflow-hidden' : ''}`}>{armed === 'restack' ? <ArmLabel>{`Confirm: restack ${restackable} PRs`}</ArmLabel> : <><Layers className="size-3.5" />Restack all {restackable}</>}{armed === 'restack' && <ArmBar on="plain" />}</button> : null} />}
      {!showPlan && plan.isFetching && !raw && <p className="flex items-center gap-2 px-1 py-3 text-small text-fg-3"><LoaderCircle className="size-4 animate-spin" />Reading the {all.length} items of {waiting.length} PRs together…</p>}
      {!showPlan && plan.isError && !raw && <p className="px-1 text-meta text-wait-text">Couldn’t boil them down ({(plan.error as Error).message}): here is every item as the agents wrote it.</p>}
      {(raw || (!showPlan && !plan.isFetching)) && waiting.map((m) => (
        <div key={m.pr.id} className="rounded-xl bg-fill/40 p-2.5 ring-1 ring-line">
          <p className="mb-1.5 truncate text-meta text-fg-3"><span className="font-mono font-semibold text-fg-2">#{m.pr.number}</span> {m.pr.title}</p>
          <ul className="space-y-1.5">
            {m.steps.map((s, i) => s.kind === 'decide' ? (
              <li key={i}>
                <Flags id={idOf(m, i)} copyOf={copyOf} clashes={clashes} label={label} />
                <p className="text-small text-fg-1">{s.text}{s.blocking && pickOf(m, i) < 0 && <span className="ml-1.5 rounded-full bg-wait/15 px-1.5 label text-wait-text">needed</span>}</p>
                <div role="radiogroup" aria-label={s.text} className="mt-1 flex flex-wrap gap-1.5">
                  {(s.options ?? []).map((o, j) => {
                    const sel = pickOf(m, i) === j
                    return (
                      <button key={j} role="radio" aria-checked={sel} onClick={() => setPicks((x) => ({ ...x, [key(m, i)]: sel ? -1 : j }))}
                              className={`flex items-start gap-1.5 rounded-ctl px-2.5 py-1 text-left text-small transition-colors ${sel ? 'bg-accent font-medium text-on-accent' : 'bg-fill text-fg-2 hover:bg-fill-strong'}`}>
                        {sel ? <Check className="mt-0.5 size-3.5 shrink-0" /> : o.recommended && <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-text" />}{o.label}
                      </button>
                    )
                  })}
                </div>
              </li>
            ) : (
              <li key={i}>
                <Flags id={idOf(m, i)} copyOf={copyOf} clashes={clashes} label={label} />
                <button role="checkbox" aria-checked={on(m, i)} onClick={() => setChecked((x) => ({ ...x, [key(m, i)]: !on(m, i) }))} className="flex w-full items-start gap-2 rounded-ctl px-1 py-0.5 text-left hover:bg-hover">
                  <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded ${on(m, i) ? 'bg-accent text-on-accent' : 'ring-1 ring-line-strong'}`}>{on(m, i) && <Check className="size-3" strokeWidth={3} />}</span>
                  <span className="min-w-0">
                    <span className={`text-small ${on(m, i) ? 'text-fg-1' : 'text-fg-3'}`}>{s.text}</span>
                    {s.kind === 'publish' && <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-ok/10 px-1.5 label text-ok-text"><Upload className="size-2.5" />public</span>}
                    {s.why && <span className="block text-meta text-fg-3">{s.why}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder="Steer the stack: say which way to go. Reanalyze reads it, and every agent gets it with your answer…"
                className="w-full resize-none rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 ring-line placeholder:text-fg-3 hover:ring-line-strong focus:ring-2 focus:ring-accent/60" />
      {(review.isFetching || standing.length > 0 || unanswered.length > 0) && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {review.isFetching && <span className="flex items-center gap-1 text-meta text-fg-3"><LoaderCircle className="size-3 animate-spin" />Checking for duplicates and conflicts…</span>}
        {standing.length > 0 && <span className="text-meta text-wait-text" title="Two lines that can't both happen are both ticked: each is marked ⚠ above. Untick one, or press Keep this one on the side you want">{standing.length} conflict{standing.length === 1 ? '' : 's'}: keep one side of each (above)</span>}
        {unanswered.length > 0 && <span className="text-meta text-wait-text">Decide {unanswered.length} first</span>}
      </div>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" role="switch" aria-checked={pushDone} onClick={() => setPush(!pushDone)} title="Each agent pushes what it fixes for this answer (a plain push, never a force-push) and posts the replies it drafted for it, instead of stopping to ask. Only for this answer"
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-meta font-medium transition-colors ${pushDone ? 'bg-ok/15 text-ok-text ring-1 ring-ok/30' : 'text-fg-3 ring-1 ring-line hover:text-fg-1'}`}>
          <span className={`flex size-3.5 items-center justify-center rounded ${pushDone ? 'bg-ok text-white' : 'ring-1 ring-line-strong'}`}>{pushDone && <Check className="size-2.5" strokeWidth={3} />}</span>and push when done
        </button>
        {note.trim() && note.trim() !== (plan.data?.steer ?? steer) && <button onClick={() => { setRaw(false); setSteer(note.trim()) }} disabled={plan.isFetching} title="Read the PRs' suggestions again with your steer: it settles what it can and suggests the rest" className="inline-flex items-center gap-1.5 btn-outline btn-sm"><RefreshCw className="size-3.5" />Reanalyze with this steer</button>}
        <button disabled={sending || unanswered.length > 0 || standing.length > 0} onClick={() => void send()}
                title={standing.length ? 'Two ticked lines can’t both happen: keep one side of each (marked ⚠)' : unanswered.length ? `Decide ${unanswered.length} first` : undefined}
                className="relative inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-small font-medium text-on-accent transition-all active:scale-[0.98] disabled:bg-fill-strong disabled:text-fg-3">
          {sending ? <LoaderCircle className="size-3.5 animate-spin" /> : publishing.length ? <Upload className="size-3.5" /> : <Send className="size-3.5" />}
          {armed === 'send' ? <ArmLabel>{`Confirm: ${publishing.length} public step${publishing.length === 1 ? '' : 's'}`}</ArmLabel> : `Answer the stack · ${waiting.length} PRs`}
          {armed === 'send' && <ArmBar on="color" />}
        </button>
      </div>
    </section>
  ) }
}

/** What the stack-wide reading says about one item: a copy of another PR's step, or a conflict with others. */
function Flags({ id, copyOf, clashes, label }: { id: string; copyOf: Map<string, { of: string; why: string }>; clashes: Map<string, { with: string[]; why: string }>; label: (id: string) => string }) {
  const c = copyOf.get(id), x = clashes.get(id)
  // the reading names items by their ids ("5201:2"): said as the PR they belong to
  const tidy = (w: string) => w.replace(/\b(\d{2,6}):\d+\b/g, '#$1')
  if (!c && !x) return null
  return (
    <div className="mb-0.5 flex flex-wrap gap-1.5 pl-1">
      {c && <span title={tidy(c.why)} className="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 text-micro font-medium text-fg-3"><CopyMinus className="size-3" />same as {label(c.of)}: unticked</span>}
      {x && <span title={tidy(x.why)} className="inline-flex items-center gap-1 rounded-full bg-wait/14 px-1.5 text-micro font-medium text-wait-text"><TriangleAlert className="size-3" />conflicts with {x.with.map(label).join(', ')}: {tidy(x.why)}</span>}
    </div>
  )
}

/**
 * The short plan: what needs your input on top (one decision per real question), then what will be done, and at the
 * bottom what becomes public (a push, a posted reply), so the things others will see are read last and on their own.
 */
function PlanView({ p, chosen, choose, stepOn, toggle, prsOf, restack }: {
  p: StackPlan
  chosen: (d: StackPlan['decisions'][number]) => number; choose: (d: StackPlan['decisions'][number], j: number) => void
  stepOn: (s: StackPlan['steps'][number]) => boolean; toggle: (s: StackPlan['steps'][number]) => void
  prsOf: (ids: string[]) => number[]
  restack?: ReactNode // realigning the whole stack in one go, offered with the public steps
}) {
  const Prs = ({ ids }: { ids: string[] }) => <span className="ml-1.5 inline-flex gap-1 align-middle">{prsOf(ids).map((n) => <span key={n} className="rounded-full bg-fill px-1.5 font-mono text-micro text-fg-3">#{n}</span>)}</span>
  const head = 'label text-fg-3'
  const row = (st: StackPlan['steps'][number], i: number) => (
    <li key={i}>
      <button role="checkbox" aria-checked={stepOn(st)} onClick={() => toggle(st)} className="flex w-full items-start gap-2 rounded-ctl px-1 py-0.5 text-left hover:bg-hover">
        <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded ${stepOn(st) ? 'bg-accent text-on-accent' : 'ring-1 ring-line-strong'}`}>{stepOn(st) && <Check className="size-3" strokeWidth={3} />}</span>
        <span className="min-w-0"><span className={`text-small ${stepOn(st) ? 'text-fg-1' : 'text-fg-3'}`}>{st.text}</span><Prs ids={st.items} />{st.why && <span className="block text-meta text-fg-3">{st.why}</span>}</span>
      </button>
    </li>
  )
  const checks = p.steps.filter((s) => !s.public && s.check), priv = p.steps.filter((s) => !s.public && !s.check), pub = p.steps.filter((s) => s.public)
  return (
    <div className="space-y-3">
      {p.summary && <details className="group/sum px-1"><summary className="cursor-pointer list-none text-small leading-relaxed text-fg-2 [&::-webkit-details-marker]:hidden"><span className="line-clamp-2 group-open/sum:line-clamp-none">{p.summary}</span></summary></details>}
      {p.decisions.length > 0 && (
        <section className="rounded-xl bg-wait/6 p-2.5 ring-1 ring-wait/20">
          <p className={`${head} mb-1.5 !text-wait-text`}>Needs your input</p>
          <ul className="space-y-2.5">
            {p.decisions.map((d, i) => (
              <li key={i}>
                <p className="text-small font-medium text-fg-1">{d.question}<Prs ids={d.options.flatMap((o) => o.picks.map((x) => x.id))} />{chosen(d) < 0 && <span className="ml-1.5 rounded-full bg-wait/15 px-1.5 label text-wait-text">needed</span>}</p>
                {d.why && <p className="text-meta text-fg-3">{d.why}</p>}
                <div role="radiogroup" aria-label={d.question} className="mt-1 flex flex-wrap gap-1.5">
                  {d.options.map((o, j) => { const sel = chosen(d) === j; return (
                    <button key={j} role="radio" aria-checked={sel} onClick={() => choose(d, j)} className={`flex items-start gap-1.5 rounded-ctl px-2.5 py-1 text-left text-small transition-colors ${sel ? 'bg-accent font-medium text-on-accent' : 'bg-surface-1 text-fg-2 ring-1 ring-line hover:bg-fill'}`}>
                      {sel ? <Check className="mt-0.5 size-3.5 shrink-0" /> : d.suggested === j && <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-text" />}{o.label}
                    </button>
                  ) })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {checks.length > 0 && <section className="rounded-xl bg-run/5 p-2.5 ring-1 ring-run/20"><p className={`${head} mb-1 flex items-center gap-1 !text-run-text`}><CircleCheck className="size-3" />Checks: the agents confirm these, nothing changes</p><ul className="space-y-1">{checks.map(row)}</ul></section>}
      {priv.length > 0 && <section className="rounded-xl bg-fill/40 p-2.5 ring-1 ring-line"><p className={`${head} mb-1`}>Changes, on your machine</p><ul className="space-y-1">{priv.map(row)}</ul></section>}
      {pub.length > 0 && (
        <section className="rounded-xl bg-ok/5 p-2.5 ring-1 ring-ok/20">
          <p className={`${head} mb-1 flex items-center gap-1 !text-ok-text`}><Upload className="size-3" />Public: others will see these{restack}</p>
          <ul className="space-y-1">{pub.map(row)}</ul>
        </section>
      )}
      {p.skipped.length > 0 && (
        <details className="px-1 text-meta text-fg-3">
          <summary className="cursor-pointer select-none">{p.skipped.reduce((n, s) => n + s.items.length, 0)} left out</summary>
          <ul className="mt-1 space-y-0.5">{p.skipped.map((s, i) => <li key={i}>{prsOf(s.items).map((n) => `#${n}`).join(', ')}: {s.why}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
