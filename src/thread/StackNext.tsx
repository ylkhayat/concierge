// Every next step and decision a stack's agents wait on, in one card: each PR's own list under its number, bottom of
// the stack first, answered with one Send. Each PR's agent gets exactly what it would get from its own page (its
// checklist and your note, through its reply), so handovers, queued runs and the hashed "already handed over" work the
// same. Shown on a stacked PR's page when two or more of the stack's PRs wait on you.
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check, CopyMinus, Layers, LoaderCircle, Send, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
      <p className="flex items-center gap-2 text-small font-semibold text-fg-1"><Layers className="size-4 text-accent-text" />The stack waits on you<span className="font-normal text-fg-3">· {waiting.length} PRs, {all.length} item{all.length === 1 ? '' : 's'}, answered at once</span></p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
      {waiting.map((m) => (
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
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder="A note to every agent of the stack (optional)…"
                className="w-full resize-none rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 ring-line placeholder:text-fg-3 hover:ring-line-strong focus:ring-2 focus:ring-accent/60" />
      <div className="flex items-center gap-2">
        {review.isFetching && <span className="flex items-center gap-1 text-meta text-fg-3"><LoaderCircle className="size-3 animate-spin" />Checking for duplicates and conflicts…</span>}
        {standing.length > 0 && <span className="text-meta text-wait-text">{standing.length} conflict{standing.length === 1 ? '' : 's'}: keep one side</span>}
        {unanswered.length > 0 && <span className="text-meta text-wait-text">Decide {unanswered.length} first</span>}
        <span className="flex-1" />
        <button disabled={sending || unanswered.length > 0 || standing.length > 0} onClick={() => void send()}
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
