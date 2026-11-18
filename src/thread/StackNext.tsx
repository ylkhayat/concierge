// Every next step and decision a stack's agents wait on, in one card: each PR's own list under its number, bottom of
// the stack first, answered with one Send. Each PR's agent gets exactly what it would get from its own page (its
// checklist and your note, through its reply), so handovers, queued runs and the hashed "already handed over" work the
// same. Shown on a stacked PR's page when two or more of the stack's PRs wait on you.
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check, CopyMinus, Layers, LoaderCircle, RefreshCw, Send, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { PlanItem, StackPlan } from '../../server/stackPlan.ts'
import type { NextSteps as Steps } from '../../server/next.ts'
import { composeChecklist, type Step } from '../../server/reply.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { api, type PrView } from '../lib.ts'
import { refresh } from '../query.ts'

type Member = { pr: PrView; url: string; steps: Step[] }
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
      const path = `/prs/${enc(p.id)}/next?v=${enc(p.job?.endedAt ?? '')}`
      return { queryKey: [path], queryFn: () => api(path) as Promise<{ steps: Steps | null }>, staleTime: Infinity }
    }),
  })
  const waiting: Member[] = members.map((pr, i) => ({ pr, url: `/prs/${enc(pr.id)}`, steps: reads[i].data?.steps?.steps ?? [] })).filter((m) => m.steps.length)
  // read together: the same action proposed twice, and steps that can't both happen (server/stackSteps.ts)
  const items = waiting.flatMap((m) => m.steps.map((s, i) => ({ id: `${m.pr.number}:${i}`, pr: m.pr.number, text: s.text, kind: s.kind, options: s.options?.map((o) => o.label) })))
  const review = useQuery({
    queryKey: ['/stacks/steps-review', items.map((x) => `${x.id}|${x.text}`).join('\n')], enabled: items.length > 1, staleTime: Infinity,
    queryFn: () => api('/stacks/steps-review', { items }) as Promise<{ duplicates: { items: string[]; why: string }[]; conflicts: { items: string[]; why: string }[] }>,
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
  // a new plan sets the answer: its suggested option for each decision (none: you choose), its steps on or off
  useEffect(() => {
    const p = plan.data
    if (!p) return
    const pk: Record<string, number> = {}, ck: Record<string, boolean> = {}
    for (const d of p.decisions) for (const o of d.options) for (const x of o.picks) pk[keyById.get(x.id)!] = -1
    for (const d of p.decisions) if (d.suggested >= 0) for (const x of d.options[d.suggested].picks) pk[keyById.get(x.id)!] = x.option
    for (const st of p.steps) for (const id of st.items) ck[keyById.get(id)!] = st.on
    for (const sk of p.skipped) for (const id of sk.items) ck[keyById.get(id)!] = false
    setPicks(pk); setChecked(ck)
    // the plan kept from before a reload was read with a steer: it is yours, so it is back in the box (and still goes to the agents)
    if (p.steer && !note.trim()) setNote(p.steer)
  }, [plan.data?.sig]) // eslint-disable-line react-hooks/exhaustive-deps

  if (waiting.length < 2) return { card: null, covers: [] }

  const key = (m: Member, i: number) => `${m.pr.id}:${i}`
  const idOf = (m: Member, i: number) => `${m.pr.number}:${i}`
  const label = (id: string) => `#${id.split(':')[0]}'s`
  // the agent's own picks start chosen, its recommended steps ticked: you change only what you disagree with
  const pickOf = (m: Member, i: number) => picks[key(m, i)] ?? (m.steps[i].options ?? []).findIndex((o) => o.recommended)
  const on = (m: Member, i: number) => checked[key(m, i)] ?? (!!m.steps[i].checked && !copyOf.has(idOf(m, i)))
  const all = waiting.flatMap((m) => m.steps.map((s, i) => ({ m, s, i })))
  const unanswered = all.filter(({ m, s, i }) => s.kind === 'decide' && s.blocking && pickOf(m, i) < 0)
  const publishing = all.filter(({ m, s, i }) => s.kind === 'publish' && on(m, i))
  // a conflict still standing: every side of it is still ticked (a step) or chosen (a decision)
  const active = (id: string) => { const x = all.find(({ m, i }) => idOf(m, i) === id); return !!x && (x.s.kind === 'decide' ? pickOf(x.m, x.i) >= 0 : on(x.m, x.i)) }
  const standing = (review.data?.conflicts ?? []).filter((g) => g.items.every(active))

  // the plan's view of the answer: which option of a decision is chosen (the one whose picks are all in place), whether a step is on
  const p = plan.data, showPlan = !!p && !raw
  const chosen = (d: StackPlan['decisions'][number]) => d.options.findIndex((o) => o.picks.length > 0 && o.picks.every((x) => (picks[keyById.get(x.id)!] ?? -1) === x.option))
  const choose = (d: StackPlan['decisions'][number], j: number) => setPicks((cur) => ({ ...cur, ...Object.fromEntries(d.options.flatMap((o) => o.picks.map((x) => [keyById.get(x.id)!, -1]))), ...(chosen(d) === j ? {} : Object.fromEntries(d.options[j].picks.map((x) => [keyById.get(x.id)!, x.option]))) }))
  const stepOn = (st: StackPlan['steps'][number]) => st.items.some((id) => checked[keyById.get(id)!])
  const toggle = (st: StackPlan['steps'][number]) => setChecked((cur) => ({ ...cur, ...Object.fromEntries(st.items.map((id) => [keyById.get(id)!, !stepOn(st)])) }))
  const prsOf = (ids: string[]) => [...new Set(ids.map((id) => Number(id.split(':')[0])))]
  // a conflict still standing, as the plan shows it: the other plan line(s) it is with, and why. Send waits until one
  // side is unticked (or its decision unpicked); "Keep this one" drops the others in one click
  const lineOf = (id: string) => p?.steps.find((st) => st.items.includes(id))?.text ?? p?.decisions.find((d) => d.options.some((o) => o.picks.some((x) => x.id === id)))?.question
  const clashOf = (ids: string[]) => standing.filter((g) => g.items.some((id) => ids.includes(id))).map((g) => ({ why: g.why.replace(/\b(\d{2,6}):\d+\b/g, '#$1'), others: [...new Set(g.items.filter((id) => !ids.includes(id)).map((id) => lineOf(id) ?? `#${id.split(':')[0]}`))], ids: g.items.filter((id) => !ids.includes(id)) }))
  const drop = (ids: string[]) => {
    setChecked((cur) => ({ ...cur, ...Object.fromEntries(ids.filter((id) => all.some(({ m, i }) => idOf(m, i) === id && m.steps[i].kind !== 'decide')).map((id) => [keyById.get(id)!, false])) }))
    setPicks((cur) => ({ ...cur, ...Object.fromEntries(ids.filter((id) => all.some(({ m, i }) => idOf(m, i) === id && m.steps[i].kind === 'decide')).map((id) => [keyById.get(id)!, -1])) }))
  }

  const send = async () => {
    if (publishing.length && armed !== 'send') return arm('send', () => {})
    if (armed) arm(armed, () => {})
    setSending(true)
    let sent = 0, handed = 0
    try {
      // one PR after the other, bottom first: a step handed from one to the next lands in order
      for (const m of waiting) {
        const p = Object.fromEntries(m.steps.map((_, i) => [i, pickOf(m, i)]).filter(([, j]) => (j as number) >= 0))
        const c = Object.fromEntries(m.steps.map((_, i) => [i, on(m, i)]))
        const msg = composeChecklist(m.steps, p, c, note.trim() ? `For the whole stack: ${note.trim()}` : '')
        if (!msg) continue
        const r = await api(`${m.url}/reply`, { text: msg }) as { handedOver?: number[] }
        sent++; handed += r?.handedOver?.length ?? 0
      }
      for (const m of waiting) refresh(`${m.url}/next`)
      setNote(''); setPicks({}); setChecked({})
      toast(`Sent to ${sent} agent${sent === 1 ? '' : 's'} of the stack${handed ? `; ${handed} step${handed === 1 ? '' : 's'} handed to another PR's agent` : ''}`)
    } catch (e) { toast((e as Error).message, 'error') } finally { setSending(false) }
  }

  return { covers: waiting.map((m) => m.pr.id), card: (
    // the list scrolls inside the space under the chat; the note and Send stay in view
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-small font-semibold text-fg-1"><Layers className="size-4 shrink-0 text-accent-text" /><span className="shrink-0">The stack waits on you</span>
          <span className="truncate font-normal text-fg-3">· {waiting.length} PRs, {showPlan ? `${all.length} items boiled down to ${p!.decisions.length + p!.steps.length}` : `${all.length} item${all.length === 1 ? '' : 's'}`}</span></p>
        {(p || raw) && <button onClick={() => setRaw(!raw)} className="shrink-0 text-meta font-medium text-fg-3 hover:text-fg-1">{raw ? 'The short plan' : `Every item (${all.length})`}</button>}
        <button onClick={() => { setRaw(false); setAgain((n) => n + 1) }} disabled={plan.isFetching} title="Read every PR's suggestions together again" className="inline-flex shrink-0 items-center gap-1 btn-ghost btn-sm">
          <RefreshCw className={`size-3.5 ${plan.isFetching ? 'animate-spin' : ''}`} />{plan.isFetching ? 'Reading…' : 'Reanalyze'}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {showPlan && <PlanView p={p!} chosen={chosen} choose={choose} stepOn={stepOn} toggle={toggle} prsOf={prsOf} clashOf={clashOf} drop={drop} />}
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
      <div className="flex items-center gap-2">
        {review.isFetching && <span className="flex items-center gap-1 text-meta text-fg-3"><LoaderCircle className="size-3 animate-spin" />Checking for duplicates and conflicts…</span>}
        {standing.length > 0 && <span className="text-meta text-wait-text" title="Two lines that can't both happen are both ticked: each is marked ⚠ above. Untick one, or press Keep this one on the side you want">{standing.length} conflict{standing.length === 1 ? '' : 's'}: keep one side of each (marked ⚠ above)</span>}
        {unanswered.length > 0 && <span className="text-meta text-wait-text">Decide {unanswered.length} first</span>}
        <span className="flex-1" />
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
function PlanView({ p, chosen, choose, stepOn, toggle, prsOf, clashOf, drop }: {
  p: StackPlan
  chosen: (d: StackPlan['decisions'][number]) => number; choose: (d: StackPlan['decisions'][number], j: number) => void
  stepOn: (s: StackPlan['steps'][number]) => boolean; toggle: (s: StackPlan['steps'][number]) => void
  prsOf: (ids: string[]) => number[]
  clashOf: (ids: string[]) => { why: string; others: string[]; ids: string[] }[]; drop: (ids: string[]) => void
}) {
  const Clash = ({ ids }: { ids: string[] }) => <>{clashOf(ids).map((c, k) => (
    <span key={k} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-wait/10 px-2 py-1 text-meta text-wait-text">
      <TriangleAlert className="size-3 shrink-0" /><span className="min-w-0 flex-1">Can’t happen together with “{c.others.join('”, “')}”: {c.why}</span>
      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); drop(c.ids) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); drop(c.ids) } }} className="shrink-0 cursor-pointer rounded-md px-1.5 font-medium ring-1 ring-wait/30 hover:bg-wait/15">Keep this one</span>
    </span>
  ))}</>
  const Prs = ({ ids }: { ids: string[] }) => <span className="ml-1.5 inline-flex gap-1 align-middle">{prsOf(ids).map((n) => <span key={n} className="rounded-full bg-fill px-1.5 font-mono text-micro text-fg-3">#{n}</span>)}</span>
  const head = 'label text-fg-3'
  const row = (st: StackPlan['steps'][number], i: number) => (
    <li key={i}>
      <button role="checkbox" aria-checked={stepOn(st)} onClick={() => toggle(st)} className="flex w-full items-start gap-2 rounded-ctl px-1 py-0.5 text-left hover:bg-hover">
        <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded ${stepOn(st) ? 'bg-accent text-on-accent' : 'ring-1 ring-line-strong'}`}>{stepOn(st) && <Check className="size-3" strokeWidth={3} />}</span>
        <span className="min-w-0"><span className={`text-small ${stepOn(st) ? 'text-fg-1' : 'text-fg-3'}`}>{st.text}</span><Prs ids={st.items} />{st.why && <span className="block text-meta text-fg-3">{st.why}</span>}{stepOn(st) && <Clash ids={st.items} />}</span>
      </button>
    </li>
  )
  const priv = p.steps.filter((s) => !s.public), pub = p.steps.filter((s) => s.public)
  return (
    <div className="space-y-3">
      {p.summary && <p className="px-1 text-small leading-relaxed text-fg-2">{p.summary}</p>}
      {p.decisions.length > 0 && (
        <section className="rounded-xl bg-wait/6 p-2.5 ring-1 ring-wait/20">
          <p className={`${head} mb-1.5 !text-wait-text`}>Needs your input</p>
          <ul className="space-y-2.5">
            {p.decisions.map((d, i) => (
              <li key={i}>
                <p className="text-small font-medium text-fg-1">{d.question}<Prs ids={d.options.flatMap((o) => o.picks.map((x) => x.id))} />{chosen(d) < 0 && <span className="ml-1.5 rounded-full bg-wait/15 px-1.5 label text-wait-text">needed</span>}</p>
                {d.why && <p className="text-meta text-fg-3">{d.why}</p>}
                {chosen(d) >= 0 && <Clash ids={d.options.flatMap((o) => o.picks.map((x) => x.id))} />}
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
      {priv.length > 0 && <section className="rounded-xl bg-fill/40 p-2.5 ring-1 ring-line"><p className={`${head} mb-1`}>Then, on your machine</p><ul className="space-y-1">{priv.map(row)}</ul></section>}
      {pub.length > 0 && (
        <section className="rounded-xl bg-ok/5 p-2.5 ring-1 ring-ok/20">
          <p className={`${head} mb-1 flex items-center gap-1 !text-ok-text`}><Upload className="size-3" />Public: others will see these</p>
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
