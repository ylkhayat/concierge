// Plans, the product manager's workspace: a brief, broken down with an agent while you watch. The chat on the left; on
// the right one map of the project (PlanStream): where it stands, what is done, going on, still to refine, and the
// angles not explored yet, faint, one click from the planner. Not another Linear: the tickets themselves live there.
import { ArrowRight, ArrowUp, Check, CheckCircle2, Zap, ExternalLink, Flag, GitBranch, LoaderCircle, Plus, RefreshCw, Redo2, Send, Sparkles, Target, Trash2, Undo2, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Kind, Op, Plan, PlanNode } from '../../server/plans.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { api } from '../lib.ts'
import { refresh, remember, useApi } from '../query.ts'
import { Skeleton } from './Connections.tsx'
import { Md } from './Md.tsx'
import { Pick, PickPill } from '../ui/Pick.tsx'
import { Tabs } from './Tabs.tsx'
import { ActivityFeed } from './ActivityFeed.tsx'
import type { Activity } from '../../server/runner.ts'
import { MOSCOW_HUE, PlanStream, type ColorBy, type Move } from './PlanStream.tsx'
import { playsFor } from '../planPlays.ts'
import { AREAS, coverage, obligations, resources, type Compliance, type Obligation } from '../../server/readiness.ts'
import type { SetupView } from '../../server/index.ts'
import { applyAll, LATER } from '../../server/planOps.ts'
import { impact } from '../planDiff.ts'
import { orderOf, planStream, ranksOf } from '../planStream.ts'
import { areaOf, explore, refineOf } from '../planLook.tsx'

type Toast = (m: string, tone?: 'ok' | 'error') => void
// a change to a plan's own fields (its appetite in weeks; none: null)
type SetPlan = (v: Omit<Partial<Plan>, 'appetite'> & { appetite?: number | null }) => Promise<unknown>
type Summary = { id: string; title: string; method: Plan['method']; count: number; made: number; busy?: boolean; creating?: boolean; at: string }

const KIND: Record<Kind, { label: string; cls: string; w: number; h: number }> = {
  goal: { label: 'Goal', cls: 'bg-accent text-on-accent', w: 260, h: 64 },
  milestone: { label: 'Phase', cls: 'bg-run/15 text-run-text ring-1 ring-run/30', w: 230, h: 56 },
  epic: { label: 'Epic', cls: 'bg-accent/15 text-accent-text ring-1 ring-accent/30', w: 230, h: 56 },
  ticket: { label: 'Ticket', cls: 'bg-surface-1 text-fg-1 ring-1 ring-line shadow-e1', w: 220, h: 52 },
}
const PRIORITY = ['', 'Urgent', 'High', 'Medium', 'Low']
const PRIORITY_DOT = ['', 'bg-fail', 'bg-wait', 'bg-run', 'bg-fg-4']

// --- choosing, in the app's own look: a row of chips for a few options, an inline list for many -------------------
/** A few options in a row; the chosen one filled: the app's one picker (ui/Pick.tsx). */
const Chips = <T extends string | number>({ value, options, onChange, label }: { value: T | undefined; options: [T, string][]; onChange: (v: T) => void; label: string }) =>
  <Pick label={label} value={value} options={options.map(([v, l]) => ({ value: v, label: l }))} onChange={onChange} />
/** Many options, as rows to pick from in place: a search box once it is long. */
function InlineList({ value, options, onPick, empty = 'Nothing to pick' }: { value?: string; options: { value: string; label: string; hint?: string }[]; onPick: (v: string) => void; empty?: string }) {
  const [q, setQ] = useState('')
  const shown = options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="space-y-1 animate-[detail-in_160ms_var(--ease-snappy)]">
      {options.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Find" className="w-full rounded-lg bg-hover px-2.5 py-1 text-small text-fg-1 outline-none placeholder:text-fg-4 focus:ring-1 focus:ring-accent/40" />}
      <div className="max-h-[220px] space-y-0.5 overflow-y-auto">
        {shown.map((o) => (
          <button key={o.value} onClick={() => onPick(o.value)} aria-current={o.value === value}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${o.value === value ? 'bg-accent-soft' : 'hover:bg-hover'}`}>
            <span className="flex size-3.5 shrink-0 items-center justify-center">{o.value === value && <Check className="size-3.5 text-accent-text" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-small text-fg-1">{o.label}</span>{o.hint && <span className="block truncate text-micro text-fg-3">{o.hint}</span>}</span>
          </button>
        ))}
        {!shown.length && <p className="px-2 py-1.5 text-small text-fg-3">{empty}</p>}
      </div>
    </div>
  )
}

// --- a box, changed by hand -------------------------------------------------------------------------------------------
function Inspector({ p, id, onOps, onMove, onClose }: { p: Plan; id: string; onOps: (ops: Op[]) => void; onMove: (m: Move) => void; onClose: () => void }) {
  const n = p.nodes.find((x) => x.id === id)
  const [title, setTitle] = useState(n?.title ?? ''), [desc, setDesc] = useState(n?.description ?? '')
  const [openList, setOpenList] = useState<'under' | 'wait'>()
  useEffect(() => { setTitle(n?.title ?? ''); setDesc(n?.description ?? '') }, [id, n?.title, n?.description])
  if (!n) return null
  const set = (v: Partial<PlanNode>) => onOps([{ op: 'update', id, ...v } as Op])
  const fixed = !!n.created // in Linear: changed there (Sync brings it back), so here it only takes dependencies and new work
  const waitsOn = p.links.filter((l) => l.to === id), blocks = p.links.filter((l) => l.from === id)
  const name = (x: string) => p.nodes.find((y) => y.id === x)?.title ?? x
  const childKind: Kind = n.kind === 'goal' ? (p.method === 'waterfall' ? 'milestone' : 'epic') : 'ticket'
  const addChild = () => { const nid = `${childKind[0]}${Date.now().toString(36).slice(-4)}`; onOps([{ op: 'add', id: nid, kind: childKind, title: `New ${KIND[childKind].label.toLowerCase()}`, parent: id }]) }
  const field = 'w-full rounded-lg bg-hover/60 px-2.5 py-1.5 text-small text-fg-1 outline-none ring-1 ring-transparent focus:ring-accent/40'
  return (
    <aside className="absolute inset-y-3 right-3 z-10 flex w-[320px] max-w-[calc(100%-24px)] animate-[drawer-in_200ms_var(--ease-snappy)] flex-col overflow-hidden rounded-2xl bg-surface-1 shadow-[var(--e3)] ring-1 ring-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className={`rounded-md px-1.5 py-0.5 text-micro font-semibold ${KIND[n.kind].cls}`}>{KIND[n.kind].label}</span>
        {n.created && <a href={n.created.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-meta text-ok hover:underline">{n.created.identifier ?? 'In Linear'}<ExternalLink className="size-3" /></a>}
        <button onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1 text-fg-3 hov hover:text-fg-1"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {fixed && <p className="rounded-lg bg-hover/60 px-2.5 py-1.5 text-meta text-fg-3">In Linear{n.state ? ` · ${n.state.name}` : ''}{n.assignee ? ` · ${n.assignee}` : ''}. Its words change there; Sync brings them here. Moves above (order, epic, priority, owner, cut) are tried here and written to Linear on Apply.</p>}
        {refineOf(n) && (
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-wait/50 bg-wait/10 px-2.5 py-1.5 text-meta">
            <span className="min-w-0 flex-1 text-fg-2"><b className="font-semibold text-wait">Needs refining</b> · {refineOf(n)}</span>
            {n.refine && !fixed && <button onClick={() => set({ refine: '' })} className="shrink-0 font-medium text-accent-text hover:underline">Settled</button>}
          </div>
        )}
        {n.kind === 'ticket' && <MoveControls p={p} n={n} onMove={onMove} />}
        <fieldset disabled={fixed} className="space-y-3 disabled:opacity-70">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== n.title && set({ title })} className={`${field} font-semibold`} aria-label="Title" />
        <div className="space-y-2.5">
          <div><p className="mb-1 label text-fg-4">Priority</p>
            <Chips label="Priority" value={n.priority ?? 0} options={PRIORITY.map((l, i) => [i, l || 'None'] as [number, string])} onChange={(v) => set({ priority: (v || undefined) as PlanNode['priority'] })} /></div>
          <div><p className="mb-1 label text-fg-4">Estimate</p>
            <Chips label="Estimate" value={n.estimate ?? 0} options={[[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [5, '5'], [8, '8'], [13, '13']]} onChange={(v) => set({ estimate: v || undefined })} /></div>
          <div><p className="mb-1 label text-fg-4">Kind</p>
            <Chips label="Kind" value={n.kind} options={(Object.keys(KIND) as Kind[]).map((k) => [k, KIND[k].label] as [Kind, string])} onChange={(v) => set({ kind: v })} /></div>
          <div><button onClick={() => setOpenList(openList === 'under' ? undefined : 'under')} className="flex w-full items-center gap-1 text-left">
              <span className="label text-fg-4">Under</span><span className="ml-1 min-w-0 flex-1 truncate text-small text-fg-1">{n.parent ? name(n.parent) : 'Nothing'}</span><span className="text-meta text-accent-text">{openList === 'under' ? 'Done' : 'Change'}</span></button>
            {openList === 'under' && <InlineList value={n.parent ?? ''} options={[{ value: '', label: 'Nothing' }, ...p.nodes.filter((x) => x.id !== id && x.kind !== 'ticket').map((x) => ({ value: x.id, label: x.title, hint: KIND[x.kind].label }))]} onPick={(v) => { set({ parent: v }); setOpenList(undefined) }} />}
          </div>
        </div>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (n.description ?? '') && set({ description: desc })} rows={6} placeholder="Why it matters, and the acceptance criteria" className={`${field} resize-y`} />
        </fieldset>
        <div className="space-y-1 text-small">
          <p className="label text-fg-4">Waits on</p>
          {waitsOn.length ? waitsOn.map((l) => <Dep key={l.from} label={name(l.from)} onRemove={() => onOps([{ op: 'unlink', from: l.from, to: id }])} />) : <p className="text-meta text-fg-4">Nothing</p>}
          <button onClick={() => setOpenList(openList === 'wait' ? undefined : 'wait')} className="text-meta font-medium text-accent-text hover:underline">{openList === 'wait' ? 'Done' : '+ Has to wait for…'}</button>
          {openList === 'wait' && <InlineList options={p.nodes.filter((x) => x.id !== id && !waitsOn.some((l) => l.from === x.id)).map((x) => ({ value: x.id, label: x.title, hint: x.created?.identifier ?? KIND[x.kind].label }))} onPick={(v) => onOps([{ op: 'link', from: v, to: id }])} />}
          {blocks.length > 0 && <p className="pt-1 text-meta text-fg-3">Holds up: {blocks.map((l) => name(l.to)).join(', ')}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        {n.kind !== 'ticket' && <button onClick={addChild} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-small font-medium text-accent-text hover:bg-accent-soft"><Plus className="size-3.5" />{KIND[childKind].label}</button>}
        {!fixed && <button onClick={() => { onOps([{ op: 'remove', id }]); onClose() }} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-small text-fg-3 hover:text-fail"><Trash2 className="size-3.5" />Remove{p.nodes.some((x) => x.parent === id) ? ' with what’s under it' : ''}</button>}
      </div>
    </aside>
  )
}
const Dep = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <div className="flex items-center gap-1.5 rounded-lg bg-hover/50 px-2 py-1"><GitBranch className="size-3 shrink-0 text-accent-text" /><span className="min-w-0 flex-1 truncate">{label}</span><button onClick={onRemove} aria-label="Remove" className="text-fg-4 hover:text-fail"><X className="size-3.5" /></button></div>
)

// --- where the plan stands: brief, shape, slice, fit, Linear -----------------------------------------------------------
type Stage = { id: string; label: string; done: boolean; ask?: string; hint: string }
function stagesOf(p: Plan, fits: boolean | undefined): Stage[] {
  const heads = p.nodes.filter((n) => n.kind === 'epic' || n.kind === 'milestone'), tickets = p.nodes.filter((n) => n.kind === 'ticket')
  const sliced = !!tickets.length && heads.every((h) => tickets.some((t) => t.parent === h.id))
  const estimated = tickets.length > 0 && tickets.filter((t) => t.estimate).length / tickets.length >= 0.8
  const items = p.nodes.filter((n) => n.kind !== 'goal')
  return [
    { id: 'brief', label: 'Brief', done: !!(p.brief.trim() || p.project?.vision), hint: 'What the project is for, who it serves, by when' },
    { id: 'shape', label: 'Shape', done: heads.length > 0, ask: p.method === 'waterfall' ? 'Shape this into phases, in order' : 'Shape this into epics: outcomes a user would notice', hint: p.method === 'waterfall' ? 'Phases in order' : 'Epics: outcomes a user would notice' },
    { id: 'slice', label: 'Slice', done: sliced, ask: 'Slice every epic into thin tickets, each a few days at most, with acceptance criteria', hint: 'Thin tickets under each epic' },
    { id: 'fit', label: 'Fit', done: fits === undefined ? estimated : fits && estimated, ask: p.appetite ? `Estimate every ticket and fit the plan to the ${p.appetite.weeks}-week appetite: move what doesn't fit under Later` : 'Estimate every ticket in points', hint: p.appetite ? `Within the ${p.appetite.weeks}-week appetite` : 'Estimated, and within the time it is worth' },
    { id: 'linear', label: 'Linear', done: items.length > 0 && items.every((n) => n.created), hint: 'Created in Linear' },
  ]
}
function StageBar({ stages, onStep }: { stages: Stage[]; onStep: (s: Stage) => void }) {
  const current = stages.findIndex((s) => !s.done)
  return (
    <ol aria-label="Where the plan stands" className="flex items-center gap-1">
      {stages.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className={`h-px w-4 ${stages[i - 1].done ? 'bg-accent/60' : 'bg-line'}`} />}
          <button onClick={() => onStep(s)} title={s.hint} aria-current={i === current ? 'step' : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium transition-colors ${i === current ? 'bg-accent text-on-accent shadow-[0_6px_16px_-8px_var(--accent)]' : s.done ? 'text-accent-text hover:bg-accent-soft' : 'text-fg-3 hover:bg-hover hover:text-fg-1'}`}>
            <span className={`flex size-4 items-center justify-center rounded-full text-micro ${i === current ? 'bg-white/25' : s.done ? 'bg-accent-soft' : 'ring-1 ring-fg-4/40'}`}>{s.done ? <Check className="size-3" /> : i + 1}</span>
            {s.label}
          </button>
        </li>
      ))}
    </ol>
  )
}

// --- the chat: the planning partner, its questions as cards and what to do next one click away ------------------------
function Chat({ p, toast, stage, settings, onSelect, onReplay }: { p: Plan; toast: Toast; stage?: Stage; settings: ReactNode; onSelect?: (id: string) => void; onReplay?: (from: number) => void }) {
  const [text, setText] = useState('')
  const [picks, setPicks] = useState<Record<number, number>>({})
  const scroll = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  // pinned to the newest line, also as replies render and grow; scrolling up unpins, back down pins again
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroll.current, c = inner.current
    if (!el || !c) return
    let stick = true
    const on = () => { stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const ro = new ResizeObserver(() => { if (stick) el.scrollTop = el.scrollHeight })
    el.addEventListener('scroll', on, { passive: true }); ro.observe(c)
    return () => { el.removeEventListener('scroll', on); ro.disconnect() }
  }, [])
  useLayoutEffect(() => { const el = box.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight + 2, 200)}px` }, [text])
  // the agent's picks start chosen: you change only what you disagree with
  useEffect(() => { setPicks(Object.fromEntries((p.asks ?? []).map((a, i) => [i, a.pick ?? -1]).filter(([, j]) => (j as number) >= 0))) }, [p.asks])
  const send = (words: string) => {
    if (!words.trim() || p.busy) return
    api(`/plans/${p.id}/say`, { text: words }).then((r: Plan) => { remember(`/plans/${p.id}`, r); setText(''); setPicks({}) }, (e: Error) => toast(e.message, 'error'))
  }
  const asks = p.busy ? [] : p.asks ?? []
  const gaps = p.busy ? [] : p.gaps ?? []
  const feed: Activity[] = [
    ...p.messages.map((m): Activity => (m.who === 'you' ? { at: m.at, kind: 'you', text: m.text } : { at: m.at, kind: 'text', text: m.text || 'Changed the board.', turn: m.turn })),
    ...(p.busy && p.live ? [{ at: p.at, kind: 'text' as const, text: p.live }] : []),
  ]
  const answers = asks.map((a, i) => (picks[i] !== undefined ? `${a.q} ${a.options[picks[i]]}` : undefined)).filter(Boolean) as string[]
  const answer = () => send([...answers, text.trim()].filter(Boolean).join('\n'))
  // what to do next: the agent's suggestions, else the step the plan is at
  // (creating in Linear is the header's button, not something to ask the agent)
  const suggest = p.busy ? [] : p.suggest?.filter((x) => !/linear/i.test(x)).length ? p.suggest.filter((x) => !/linear/i.test(x)) : stage?.ask ? [stage.ask] : p.nodes.length ? ['Find the riskiest assumption', 'Add acceptance criteria where they are missing', 'Order the tickets by value'] : ['Break this down']
  const placeholder = asks.length ? 'Anything to add to your answers (optional)…' : stage?.id === 'brief' ? 'Tell it about the project: the problem, who has it, the deadline…'
    : stage?.id === 'shape' ? 'Ask it to shape the plan, or say how you see the parts…' : stage?.id === 'slice' ? 'Ask for tickets, or how small they should be…'
    : stage?.id === 'fit' ? 'Ask it to fit the time, cut scope, or order by value…' : 'Ask for changes: split an epic, add a milestone, move something first…'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {settings}
      <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
       <div ref={inner} className="px-[max(0px,calc((100%-860px)/2))]">
        <div className="flex flex-col gap-4 px-4 pt-4">
          <details className="group/brief rounded-xl bg-hover/50 px-3 py-2 text-small">
            <summary className="cursor-pointer list-none font-medium text-fg-2"><span className="mr-1 inline-block transition-transform group-open/brief:rotate-90">›</span>The brief</summary>
            <p className="mt-1.5 whitespace-pre-wrap text-fg-2">{p.brief || p.project?.vision || 'No brief yet: tell it below what the project is for.'}</p>
          </details>
        </div>
        {/* the conversation, as the Dev chat shows a run's: your words, its replies, each reply's changes to the map
            (straight in the scroller: the feed keeps itself pinned to the newest line) */}
        {feed.length > 0 && <ActivityFeed feed={feed} live={!!p.busy} toast={toast} pin={false} after={(a) => a.turn && <TurnChanges id={p.id} turn={a.turn} onSelect={onSelect} onReplay={onReplay} />} />}
        <div className="flex flex-col gap-4 px-4 pb-4">
          {p.busy && <p className="flex items-center gap-2 text-small text-accent-text"><Sparkles className="size-4 animate-pulse" />Drafting on the board…</p>}
          {p.error && <p className="rounded-xl bg-fail/10 px-3 py-2 text-small text-fail">{p.error}</p>}
          {/* its questions: answered with a click, its pick chosen */}
          {asks.length > 0 && (
            <div className="space-y-2.5 rounded-2xl bg-surface-1 p-3 shadow-e1 ring-1 ring-accent/20">
              <p className="label text-accent-text">{asks.length === 1 ? 'A question' : `${asks.length} questions`}</p>
              {asks.map((a, i) => (
                <div key={i} className="space-y-1.5">
                  <p className="text-small font-medium text-fg-1">{a.q}</p>
                  <Pick wrap label={a.q} value={picks[i]} onChange={(j) => setPicks((x) => ({ ...x, [i]: j }))}
                        options={a.options.map((o, j) => ({ value: j, label: <>{o}{a.pick === j && <span className="ml-1 text-micro opacity-70">its pick</span>}</> }))} />
                </div>
              ))}
              <button onClick={answer} disabled={!answers.length} className="inline-flex items-center gap-1.5 btn-primary disabled:opacity-40"><Send className="size-3.5" />Answer{answers.length > 1 ? ` all ${answers.length}` : ''}</button>
            </div>
          )}
        </div>
       </div>
      </div>
      <div className="mx-auto w-full max-w-[860px] space-y-2 px-3 pb-3 pt-1">
        {suggest.length > 0 && !asks.length && (
          <div className="flex flex-wrap gap-1.5" aria-label="What to do next">
            {suggest.map((x) => (
              <button key={x} onClick={() => send(x)} className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-surface-1 px-3 py-1.5 text-left text-small text-fg-2 shadow-e1 transition-colors hover:text-fg-1">
                <Sparkles className="size-3.5 shrink-0 text-accent-text" /><span className="truncate">{x}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl bg-surface-1 p-2 shadow-e1 ring-1 ring-line focus-within:ring-accent/40">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={placeholder}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (asks.length) answer(); else send(text) } }}
                    className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-body outline-none placeholder:text-fg-4" />
          <button onClick={() => (asks.length ? answer() : send(text))} disabled={(!text.trim() && !answers.length) || p.busy} aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent disabled:opacity-40">{p.busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button>
        </div>
      </div>
    </div>
  )
}

// --- one plan: where it stands on top, the chat on the left, the plan on the right ------------------------------------
/** A ticket's moves, tried in the scenario: earlier or later, under which epic, how urgent, who works it, or cut. */
function MoveControls({ p, n, onMove }: { p: Plan; n: PlanNode; onMove: (m: Move) => void }) {
  const ranks = ranksOf(p.nodes), order = orderOf(p.nodes).filter((x) => x.state?.type !== 'completed' && x.parent !== LATER)
  const at = order.findIndex((x) => x.id === n.id)
  const rk = (x?: PlanNode) => (x ? ranks.get(x.id) ?? 0 : 0)
  const heads = p.nodes.filter((x) => (x.kind === 'epic' || x.kind === 'milestone') && x.id !== LATER)
  const people = [...new Set([...(p.members ?? []).map((m) => m.name), ...p.nodes.map((x) => x.assignee).filter((x): x is string => !!x)])]
  const cut = n.parent === LATER
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-meta transition-colors ${on ? 'bg-accent-soft font-medium text-accent-text ring-1 ring-accent/40' : 'bg-fill text-fg-2 hover:bg-fill-strong hover:text-fg-1'}`
  return (
    <div className="space-y-2.5 rounded-xl bg-accent-soft/40 p-2.5 ring-1 ring-accent/15">
      <p className="label text-accent-text">Try a move</p>
      {!cut && at >= 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-meta">
          <span className="w-14 text-fg-3">Order</span>
          <button disabled={at === 0} onClick={() => onMove({ op: 'move', id: n.id, rank: rk(order[0]) - 1 })} className={chip(false)}>First</button>
          <button disabled={at === 0} onClick={() => onMove({ op: 'move', id: n.id, rank: at > 1 ? (rk(order[at - 2]) + rk(order[at - 1])) / 2 : rk(order[0]) - 1 })} className={chip(false)}>Earlier</button>
          <button disabled={at === order.length - 1} onClick={() => onMove({ op: 'move', id: n.id, rank: at + 2 < order.length ? (rk(order[at + 1]) + rk(order[at + 2])) / 2 : rk(order[at + 1]) + 1 })} className={chip(false)}>Later</button>
          <span className="text-fg-4">{at + 1} of {order.length}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-meta">
        <span className="w-14 text-fg-3">Priority</span>
        {([1, 2, 3, 4] as const).map((v) => <button key={v} onClick={() => n.priority !== v && onMove({ op: 'move', id: n.id, priority: v })} className={chip(n.priority === v)}>{PRIORITY[v]}</button>)}
      </div>
      {heads.length > 1 && !cut && (
        <div className="flex flex-wrap items-center gap-1.5 text-meta">
          <span className="w-14 text-fg-3">Under</span>
          {heads.map((h) => <button key={h.id} onClick={() => n.parent !== h.id && onMove({ op: 'move', id: n.id, parent: h.id })} title={h.title} className={`${chip(n.parent === h.id)} max-w-40 truncate`}>{h.title}</button>)}
        </div>
      )}
      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-meta">
          <span className="w-14 text-fg-3">Owner</span>
          {people.map((name) => { const m = p.members?.find((x) => x.name === name); return <button key={name} onClick={() => onMove({ op: 'move', id: n.id, assignee: n.assignee === name ? null : name, assigneeId: n.assignee === name ? null : m?.id ?? null })} className={chip(n.assignee === name)}>{name}</button> })}
        </div>
      )}
      <button onClick={() => onMove({ op: 'move', id: n.id, cut: !cut })} className={`w-full rounded-lg px-2.5 py-1.5 text-small font-medium transition-colors ${cut ? 'bg-surface-1 text-accent-text ring-1 ring-accent/30 hover:bg-accent-soft' : 'bg-surface-1 text-fg-2 ring-1 ring-line hover:text-fail-text'}`}>
        {cut ? 'Restore it to the plan' : 'Cut it to Later'}
      </button>
    </div>
  )
}

/**
 * The scenario being tried, over the map: how many moves, when the plan lands now and by how much that changed,
 * whether it fits the appetite, what was cut, and what Linear would get. Details opens the full impact; Undo takes
 * the last move back, Discard all of them, Apply makes them (and, armed, writes Linear).
 */
/**
 * Strategic plays: each proposes moves for the scenario (Apply still decides). Pointing at one says what it would do
 * to the date and the scope before it is tried; the planner's own plays ask it to propose a scenario. Then how the
 * pebbles are coloured: by epic, by who works them, or by MoSCoW.
 */
function Plays({ p, whatIf, people, pace, busy, onTry, onAsk, colorBy, onColorBy }: { p: Plan; whatIf: Plan; people: number; pace: number; busy?: boolean; onTry: (ops: Op[]) => void; onAsk: (text: string) => void; colorBy: ColorBy; onColorBy: (c: ColorBy) => void }) {
  const [hover, setHover] = useState<string>()
  const plays = playsFor(whatIf, people, pace)
  const preview = (ops: Op[]) => {
    const i = impact(whatIf, applyAll(whatIf, ops), people, pace)
    return [i.days ? `lands ${Math.abs(i.days)} day${Math.abs(i.days) === 1 ? '' : 's'} ${i.days < 0 ? 'earlier' : 'later'}` : 'the same date',
      i.cut.length && `cuts ${i.cut.length} (${i.cut.reduce((a, x) => a + x.points, 0)} pt)`, i.fitsAfter !== undefined && (i.fitsAfter ? 'fits the appetite' : 'still over the appetite'),
      `${ops.length} move${ops.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  }
  const ASK: [string, string, string][] = [
    ['mvp', 'MVP slice', 'Propose a scenario (one propose op, moves only, apply nothing): the smallest slice that still proves the goal for its users. Rank it first and cut the rest to Later. Say in two sentences what the MVP proves and what waits.'],
    ['value', 'Sequence by value', 'Propose a scenario (one propose op, moves only, apply nothing): order the work by value to users and risk reduced per point (RICE), so every week delivers something usable. Say in two sentences how you ordered it.'],
  ]
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-fill px-2.5 py-1 text-meta font-medium text-fg-2 transition-colors hover:bg-accent-soft hover:text-accent-text disabled:opacity-40'
  const shown = hover && plays.find((x) => x.id === hover)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-small">
      <span className="label text-fg-4">Plays</span>
      {plays.map((x) => <button key={x.id} title={x.hint} onMouseEnter={() => setHover(x.id)} onMouseLeave={() => setHover(undefined)} onFocus={() => setHover(x.id)} onBlur={() => setHover(undefined)} onClick={() => onTry(x.ops)} className={chip}><Zap className="size-3" />{x.label}</button>)}
      {ASK.map(([id, label, text]) => <button key={id} disabled={busy} title="The planner proposes it as a scenario to try" onClick={() => onAsk(text)} className={chip}><Sparkles className="size-3" />{label}</button>)}
      {shown && <span className="text-meta text-fg-3 animate-[detail-in_160ms_var(--ease-out)]">{preview(shown.ops)}</span>}
      <span className="inline-flex items-center gap-1.5">
        <span className="label text-fg-4">Colour</span>
        <Tabs size="sm" label="Colour the tickets by" value={colorBy} onChange={onColorBy} options={[{ id: 'epic', label: 'Epic' }, { id: 'owner', label: 'Owner' }, { id: 'moscow', label: 'MoSCoW' }]} />
        {colorBy === 'moscow' && <span className="inline-flex items-center gap-2 text-micro text-fg-3">{(['must', 'should', 'could', 'wont'] as const).map((m) => <span key={m} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `oklch(0.72 0.12 ${MOSCOW_HUE[m]})` }} />{m === 'wont' ? "won't" : m}</span>)}<span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-fg-4" />unset</span></span>}
      </span>
    </div>
  )
}

/**
 * Readiness: what this plan must cover (Settings → Compliance), area by area, and whether the team and
 * the time hold the work. Each tile says where it stands; a click lists what it holds: what is covered and by which
 * ticket, and for what isn't, a ticket to add or the planner to ask. Then the risks, highest first.
 */
function Readiness({ whatIf, company, teamKey, people, pace, points, onAsk, onAdd, onSelect }: { whatIf: Plan; company?: Compliance; teamKey?: string; people: number; pace: number; points: number; onAsk: (t: string) => void; onAdd: (ob: Obligation) => void; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState<string>()
  const obs = obligations(company, whatIf), cov = coverage(whatIf, obs)
  const res = resources(whatIf, company, people, pace, points, obs, teamKey)
  const risks = whatIf.nodes.filter((n) => n.risk && n.parent !== LATER).sort((a, b) => b.risk!.likelihood * b.risk!.impact - a.risk!.likelihood * a.risk!.impact)
  const areas = AREAS.map((a) => ({ ...a, items: cov.filter((x) => x.ob.area === a.id) })).filter((a) => a.items.length)
  if (!areas.length && !risks.length && !company) return null
  const lane = (h: number) => `oklch(0.66 0.14 ${h})`
  const over = res.capacity !== undefined && res.demand > res.capacity
  const high = risks.filter((n) => n.risk!.likelihood * n.risk!.impact >= 6).length
  const pills = [
    ...areas.map((a) => { const done = a.items.filter((x) => x.by).length, all = done === a.items.length
      return { id: a.id, name: a.label, status: `${done}/${a.items.length}`, color: all ? 'var(--st-ok)' : lane(a.hue), hint: all ? 'Every obligation has its ticket' : `Missing: ${a.items.filter((x) => !x.by).map((x) => x.ob.title).join(', ')}` } }),
    { id: 'resources', name: 'Resources', status: res.capacity !== undefined ? `${res.demand}/${res.capacity} pt` : `${res.demand} pt`, color: over ? 'var(--st-fail)' : res.missing.length ? 'var(--st-wait)' : lane(70), hint: res.missing.length ? `No ${res.missing.join(', ')} on the team` : over ? `${res.demand - res.capacity!} pt more than the appetite holds` : 'The team holds the work' },
    { id: 'risks', name: 'Risks', status: risks.length ? `${risks.length}${high ? ` · ${high} high` : ''}` : 'none', color: high ? 'var(--st-fail)' : lane(25), hint: risks[0] ? risks[0].risk!.note || risks[0].title : 'Ask the planner for the riskiest assumptions' },
  ]
  return (
    <div className="relative">
      {/* one line: each area with how much is covered; a click opens what it misses (over the map, under the bar) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label mr-1 text-fg-4">Readiness</span>
        {pills.map((x) => (
          <button key={x.id} onClick={() => setOpen(open === x.id ? undefined : x.id)} aria-expanded={open === x.id} title={x.hint}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-meta transition-colors ${open === x.id ? 'bg-accent-soft text-fg-1 ring-1 ring-accent/30' : 'bg-fill text-fg-2 hover:bg-fill-strong hover:text-fg-1'}`}>
            <span className="size-1.5 rounded-full" style={{ background: x.color }} />{x.name}<span className="font-medium tabular-nums text-fg-1">{x.status}</span>
          </button>
        ))}

      </div>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 max-h-72 w-[min(560px,80vw)] overflow-y-auto rounded-card bg-surface-1 p-3 shadow-e3 ring-1 ring-line animate-[detail-in_180ms_var(--ease-out)]">
          {open === 'resources' ? (
            <div className="space-y-1.5 text-small text-fg-2">
              <p>In scope: <b className="text-fg-1">{res.demand} pt</b>. The team finishes about <b className="text-fg-1">{res.weekly} pt a week</b>{res.capacity !== undefined && <>, <b className="text-fg-1">{res.capacity} pt</b> inside the appetite</>}.</p>
              {res.people.length ? <p className="text-meta text-fg-3">{whatIf.members?.length ? 'The project’s people' : teamKey ? `The ${teamKey} team` : 'Everyone in the profile'}: {res.people.map(({ m, share }) => `${m.name} (${m.role}, ${m.pace ?? pace}/wk${share < 1 ? `, ${Math.round(share * 100)}% here: also on ${(m.teams ?? []).filter((t) => t !== teamKey).join(', ')}` : ''})`).join(' · ')}</p>
                : <p className="text-meta text-fg-3">No one under Capacity in Settings → Compliance: counted as {people} at {pace} pt a week.</p>}
              {res.missing.length > 0 && <p className="text-wait-text">The work needs {res.missing.join(', ')}, and nobody on the team has that role or review.</p>}
            </div>
          ) : open === 'risks' ? (
            risks.length ? <ul className="space-y-1">{risks.map((n) => <li key={n.id}><button onClick={() => onSelect(n.id)} className="flex w-full items-start gap-2 rounded-ctl px-1.5 py-1 text-left text-small hover:bg-hover">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 text-micro font-semibold ${n.risk!.likelihood * n.risk!.impact >= 6 ? 'bg-fail/15 text-fail-text' : 'bg-wait/15 text-wait-text'}`}>{n.risk!.likelihood}×{n.risk!.impact}</span>
              <span className="min-w-0 flex-1"><span className="block text-fg-1">{n.risk!.note || n.title}</span><span className="block text-meta text-fg-3">{n.title}</span></span></button></li>)}</ul>
              : <div className="flex items-center gap-2 text-small text-fg-3">No risks logged yet.<button onClick={() => onAsk('List the riskiest assumptions in this plan: set "risk" (likelihood, impact, note) on the tickets that carry them, and add a mitigation ticket for each high one.')} className="btn-quiet btn-sm">Ask the planner</button></div>
          ) : (
            <ul className="space-y-1">{cov.filter((x) => x.ob.area === open).map(({ ob, by }) => (
              <li key={ob.id} className="flex items-start gap-2 text-small">
                {by ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <span className="mt-1 size-3 shrink-0 rounded-full border border-dashed border-wait" />}
                <span className="min-w-0 flex-1"><span className="block font-medium text-fg-1">{ob.title}</span><span className="block text-meta text-fg-3">{by ? <>Covered by <button onClick={() => onSelect(by.id)} className="text-accent-text hover:underline">{by.created?.identifier ?? by.title}</button></> : ob.why}</span></span>
                {!by && <span className="inline-flex shrink-0 gap-1"><button onClick={() => onAdd(ob)} className="btn-quiet btn-sm">Add a ticket</button><button onClick={() => onAsk(`Cover "${ob.title}" (${ob.id}) in the plan: ${ob.why}. Add the tickets it needs where they belong, mark them covers:["${ob.id}"], estimate them, and say in a sentence what you added.`)} className="btn-quiet btn-sm">Ask the planner</button></span>}
              </li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The draft's changes as the board shows them: what is there when it opens at once, then each new one of the planner's
 * about a third of a second after the last (yours at once). replayFrom(i) plays them again from the i-th.
 */
function usePaced(ops: Op[] = []): [Op[], (i: number) => void] {
  const [n, setN] = useState(ops.length)
  useEffect(() => {
    if (n > ops.length) { setN(ops.length); return }
    if (n === ops.length) return
    const t = setTimeout(() => setN(n + 1), ops[n]?.turn ? 320 : 0)
    return () => clearTimeout(t)
  }, [n, ops])
  return [ops.slice(0, n), (i) => i >= 0 && setN(i)]
}

/**
 * A reply's changes to the map, while they are in the draft: one chip each, which opens it on the map; Replay plays them
 * again on the board, Discard takes them out of the draft. Reads the plan itself: the feed around it redraws only for new lines.
 */
function TurnChanges({ id, turn, onSelect, onReplay }: { id: string; turn: string; onSelect?: (id: string) => void; onReplay?: (from: number) => void }) {
  const p = useApi<Plan>(`/plans/${id}`).data
  const all = p?.scenario?.ops ?? [], ops = all.filter((o) => o.turn === turn)
  if (!p || !ops.length) return null
  const whatIf = applyAll(p, all)
  const name = (x: string) => whatIf.nodes.find((n) => n.id === x)?.title ?? p.nodes.find((n) => n.id === x)?.title ?? x
  const verb = (o: Op) => o.op === 'add' ? '+' : o.op === 'remove' ? '−' : o.op === 'move' ? (o.cut ? '✂' : '↔') : o.op === 'link' ? '→' : '✎'
  const ids = new Map<string, Op>(); for (const o of ops) { const x = 'id' in o ? o.id : 'to' in o ? o.to : ''; if (x) ids.set(x, o) }
  const discard = () => { const rest = all.filter((o) => o.turn !== turn); remember(`/plans/${id}`, { ...p, scenario: rest.length ? { ...p.scenario!, ops: rest } : undefined }); void api(`/plans/${id}/scenario`, { ops: rest }).then((r: Plan) => remember(`/plans/${id}`, r)) }
  const btn = 'rounded-full px-1.5 py-0.5 text-meta text-fg-3 hover:bg-hover'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {[...ids].slice(0, 12).map(([x, o]) => (
        <button key={x} onClick={() => onSelect?.(x)} title={o.because?.map((b) => `${b.source}: ${b.text}`).join('\n') || undefined}
                className="inline-flex max-w-[240px] items-center gap-1 rounded-full bg-accent-soft/70 px-2 py-0.5 text-meta text-fg-1 ring-1 ring-accent/20 transition-colors hover:bg-accent-soft">
          <span className="font-mono text-accent-text">{verb(o)}</span><span className="truncate">{name(x)}</span>{o.because?.length ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        </button>
      ))}
      {ids.size > 12 && <span className="px-1 text-meta text-fg-3">+{ids.size - 12} more</span>}
      {!p.busy && <>
        <button onClick={() => onReplay?.(all.findIndex((o) => o.turn === turn))} title="Watch these changes again on the board" className={`${btn} hover:text-fg-1`}>Replay</button>
        <button onClick={discard} title="Take this reply's changes out of the draft (⌘Z brings them back)" className={`${btn} hover:text-fail-text`}>Discard</button>
      </>}
    </div>
  )
}

/** Undo and redo on the board: every edit, scenario move and planner turn is a step; ⌘Z and ⇧⌘Z (or ⌘Y) outside a text box. */
function History({ p, onBack }: { p: Plan; onBack: (undo: boolean) => unknown }) {
  const now = useRef({ p, onBack }); now.current = { p, onBack }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      const k = e.key.toLowerCase(), undo = k === 'z' && !e.shiftKey, redo = (k === 'z' && e.shiftKey) || k === 'y'
      if (!undo && !redo) return
      e.preventDefault()
      const { p: x } = now.current
      if (!x.busy && !x.creating && (undo ? x.undo : x.redo)) now.current.onBack(undo)
    }
    addEventListener('keydown', key); return () => removeEventListener('keydown', key)
  }, [])
  const off = p.busy || p.creating
  const btn = 'rounded-lg p-1.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg-1 disabled:pointer-events-none disabled:opacity-30'
  return (
    <span className="inline-flex items-center">
      <button disabled={off || !p.undo} onClick={() => onBack(true)} title={`Undo (⌘Z)${p.undo ? ` · ${p.undo} step${p.undo === 1 ? '' : 's'}` : ''}`} aria-label="Undo" className={btn}><Undo2 className="size-4" /></button>
      <button disabled={off || !p.redo} onClick={() => onBack(false)} title="Redo (⇧⌘Z)" aria-label="Redo" className={btn}><Redo2 className="size-4" /></button>
    </span>
  )
}

function ScenarioBar({ p, whatIf, people, pace, toast, onSet }: { p: Plan; whatIf: Plan; people: number; pace: number; toast: Toast; onSet: (ops: Op[]) => Promise<unknown> }) {
  const ops = p.scenario?.ops ?? []
  const i = impact(p, whatIf, people, pace)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const { armed, arm } = useArm()
  const apply = () => {
    setBusy(true)
    api(`/plans/${p.id}/scenario/apply`, {}).then((r: { plan: Plan; results: { identifier?: string; ok: boolean; error?: string }[] }) => {
      remember(`/plans/${p.id}`, r.plan)
      const bad = r.results.filter((x) => !x.ok)
      toast(bad.length ? `Applied; Linear refused ${bad.map((x) => `${x.identifier}: ${x.error}`).join('; ')}` : `Applied${r.results.length ? `: ${r.results.length} Linear issue${r.results.length === 1 ? '' : 's'} updated` : ''}`, bad.length ? 'error' : 'ok')
    }, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false))
  }
  const days = i.days, d = Math.abs(days)
  // a first draft: there is no plan yet to be earlier or later than, only when it would land
  const first = !p.nodes.some((n) => n.kind !== 'goal')
  const landing = new Date(Date.now() + i.endAfter * 7 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const when = first ? 'lands' : days === 0 ? 'lands the same day' : `lands ${d} day${d === 1 ? '' : 's'} ${days < 0 ? 'earlier' : 'later'}`
  return (
    <div className="border-b border-line bg-accent-soft/50 px-4 py-2 text-small animate-[detail-in_200ms_var(--ease-out)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 font-semibold text-accent-text" title={p.scenario?.why}><Sparkles className="size-3.5" />{ops.some((o) => o.turn) ? 'Draft' : 'Trying'}: {ops.length} change{ops.length === 1 ? '' : 's'}</span>
        <span className={first ? 'text-fg-2' : days < 0 ? 'font-medium text-ok-text' : days > 0 ? 'font-medium text-wait-text' : 'text-fg-2'}>{first ? `lands ~${landing}` : `${when} (~${landing})`}</span>
        {first && <span className="basis-full text-fg-2 sm:basis-auto">A first draft, drawn on the board: nothing is in the plan until you Apply. Ask below for changes first if you like; Linear only gets it when you Create in Linear.</span>}
        {i.fitsAfter !== undefined && <span className={i.fitsAfter ? 'text-ok-text' : 'text-fail-text'}>{i.fitsAfter ? (i.fitsBefore ? 'fits the appetite' : 'now fits the appetite') : 'over the appetite'}</span>}
        {i.cut.length > 0 && <span className="text-fg-2">{i.cut.length} cut ({i.cut.reduce((a, x) => a + x.points, 0)} pt)</span>}
        {i.later.length > 0 && <span className="text-wait-text">{i.later.length} finish later</span>}
        {i.writes.length > 0 && <span className="text-fg-2">{i.writes.length} Linear change{i.writes.length === 1 ? '' : 's'}</span>}
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-meta font-medium text-accent-text hover:underline">{open ? 'Hide details' : 'Details'}</button>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <button onClick={() => void onSet([])} className="rounded-lg px-2 py-1 text-meta font-medium text-fg-2 hover:bg-hover hover:text-fail-text">Discard</button>
          <button disabled={busy || p.busy} title={p.busy ? 'It is still drafting' : undefined} onClick={() => (i.writes.length ? arm('apply', apply) : apply())} className="btn-primary btn-sm relative inline-flex items-center gap-1.5 overflow-hidden">
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {armed === 'apply' ? <><ArmLabel>{`Confirm: write ${i.writes.length} to Linear`}</ArmLabel><ArmBar on="color" /></> : 'Apply'}
          </button>
        </span>
      </div>
      {open && (
        <div className="mt-2 grid gap-3 border-t border-accent/15 pt-2 text-meta md:grid-cols-3">
          <div><p className="label mb-1 text-fg-4">Finishing later</p>{i.later.length ? <ul className="space-y-0.5">{i.later.slice(0, 8).map((x) => <li key={x.id} className="text-fg-2"><b className="font-medium text-fg-1">{x.title}</b> +{x.days}d{x.because && <span className="text-fg-3"> · waits for {x.because}</span>}</li>)}</ul> : <p className="text-fg-3">Nothing</p>}</div>
          <div><p className="label mb-1 text-fg-4">Cut and back</p>{i.cut.length || i.back.length ? <ul className="space-y-0.5">{i.cut.map((x) => <li key={x.id} className="text-fg-2">− {x.title} <span className="text-fg-4">{x.points} pt</span></li>)}{i.back.map((x) => <li key={x.id} className="text-fg-2">+ {x.title} <span className="text-fg-4">{x.points} pt</span></li>)}</ul> : <p className="text-fg-3">Nothing</p>}</div>
          <div><p className="label mb-1 text-fg-4">In Linear, on Apply</p>{i.writes.length ? <ul className="space-y-0.5">{i.writes.map((x) => <li key={x.id} className="text-fg-2"><span className="font-mono text-fg-1">{x.identifier}</span> {x.changes.join(', ')}</li>)}</ul> : <p className="text-fg-3">Nothing: these are only in the plan</p>}</div>
        </div>
      )}
    </div>
  )
}

/** The plan with the obligations it doesn't cover yet among its unexplored angles (the planner's own first). */
const OB_AREA = { compliance: 'compliance', security: 'security', operations: 'rollout', quality: 'accessibility' } as const
function withObligations(p: Plan, company?: Compliance): Plan {
  const open = coverage(p, obligations(company, p)).filter((x) => !x.by).map(({ ob }) => ({ id: `ob:${ob.id}`, area: OB_AREA[ob.area], title: ob.title, why: ob.why }))
  const mine = p.gaps ?? []
  return open.length ? { ...p, gaps: [...mine, ...open.filter((o) => !mine.some((g) => g.title.toLowerCase().includes(o.title.toLowerCase().split(' ')[0])))].slice(0, 10) } : p
}

// the conversation's height under the board, as you dragged it (this browser only); none: its default share
const DOCK_KEY = 'concierge:plan-dock'
const savedDock = () => { try { const v = Number(localStorage.getItem(DOCK_KEY)); return v > 0 ? v : undefined } catch { return undefined } }
const keepDock = (v?: number) => { try { if (v) localStorage.setItem(DOCK_KEY, String(Math.round(v))); else localStorage.removeItem(DOCK_KEY) } catch { /* not kept */ } }

function PlanView({ id, toast }: { id: string; toast: Toast }) {
  const path = `/plans/${id}`
  const q = useApi<Plan>(path, { refetchInterval: (x) => (x.state.data?.busy || x.state.data?.creating ? 400 : false) })
  const p = q.data
  const [selected, setSelected] = useState<string>()
  const skills = useApi<{ name: string }[]>('/skills', { staleTime: 5 * 60_000 })
  const [teamsOn, setTeamsOn] = useState(false)
  const teams = useApi<{ teams: { id: string; key: string; name: string }[] }>(teamsOn || p?.team ? '/plans/teams' : undefined, { staleTime: 10 * 60_000 })
  const { armed, arm } = useArm()
  const [cfg, setCfg] = useState<'open' | 'skill' | 'team'>()
  // how much of the plan you see: every stream as one line (overview), its tickets as pebbles (streams), or listed by
  // name (tickets); any single stream opens and closes on its own
  const [compact, setCompact] = useState(false), [open, setOpen] = useState<Set<string>>(new Set()), [legend, setLegend] = useState(false)
  const [colorBy, setColorBy] = useState<ColorBy>('epic')
  // the board and the conversation share the height: drag the line between them (double-click: back to the default)
  const [dock, setDock] = useState<number | undefined>(savedDock)
  const split = useRef<HTMLDivElement>(null)
  const dragDock = (e: React.PointerEvent) => {
    e.preventDefault()
    const box = split.current?.getBoundingClientRect()
    if (!box) return
    let last = dock
    const move = (m: PointerEvent) => { last = Math.round(Math.min(Math.max(box.bottom - m.clientY, 180), box.height - 160)); setDock(last) }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); keepDock(last) }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const setup = useApi<SetupView>('/setup', { staleTime: 60_000 })
  // the draft as the board shows it: the planner's changes one at a time as they come in (yours at once), so each is seen
  const [paced, replayFrom] = usePaced(p?.scenario?.ops)
  // a link can open it at a level (?detail=overview or tickets)
  const wanted = useRef(new URLSearchParams(location.search).get('detail'))
  useEffect(() => {
    if (!p?.nodes.length || !wanted.current) return
    const l = wanted.current; wanted.current = null
    if (l === 'overview') setCompact(true)
    if (l === 'tickets') setOpen(new Set(planStream(p.nodes, p.links).streams.map((x) => x.id)))
  }, [p?.nodes.length]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <div className="flex flex-1 items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
  const ops = (o: Op[]) => api(`${path}/edit`, { ops: o }).then((r: Plan) => remember(path, r), (e: Error) => toast(e.message, 'error'))
  // the scenario: the moves being tried, shown on a copy of the plan (whatIf) until Apply; each move is kept at once
  const tried = p.scenario?.ops ?? []
  const whatIf = tried.length ? applyAll(p, tried) : p
  const setTried = (next: Op[]) => {
    remember(path, { ...p, scenario: next.length ? { ops: next, at: new Date().toISOString() } : undefined })
    return api(`${path}/scenario`, { ops: next }).then((r: Plan) => remember(path, r), (e: Error) => toast(e.message, 'error'))
  }
  // yours, added on the server to what is there (the planner's changes may be coming in meanwhile)
  const addTried = (more: Op[]) => {
    remember(path, { ...p, scenario: { ops: [...tried, ...more], at: new Date().toISOString() } })
    return api(`${path}/scenario/add`, { ops: more }).then((r: Plan) => remember(path, r), (e: Error) => toast(e.message, 'error'))
  }
  const move = (m: Move) => void addTried([m])
  const shown = paced.length < tried.length ? applyAll(p, paced) : whatIf
  const fresh = paced.length < tried.length || paced.length === tried.length ? paced.at(-1) : undefined
  const set: SetPlan = (v) => api(path, v).then((r: Plan) => { remember(path, r); refresh('/plans') }, (e: Error) => toast(e.message, 'error'))
  const say = (text: string) => api(`${path}/say`, { text }).then((r: Plan) => remember(path, r), (e: Error) => toast(e.message, 'error'))
  const items = p.nodes.filter((n) => n.kind !== 'goal'), made = p.nodes.filter((n) => n.created).length
  const back = (undo: boolean) => api(`${path}/${undo ? 'undo' : 'redo'}`, {}).then((r: Plan) => remember(path, r), (e: Error) => toast(e.message, 'error'))
  const create = () => api(`${path}/create`, {}).then((r: Plan) => remember(path, r), (e: Error) => toast(e.message, 'error'))
  const teamName = teams.data?.teams.find((t) => t.id === p.team)?.name
  // the fit: what the appetite holds, and whether the work left lands within it
  const people = p.people ?? Math.max(1, p.project?.members ?? 1), pace = p.pace ?? 5
  const f = forecast(whatIf.nodes, people, pace, Date.now(), whatIf.links)
  const capacity = p.appetite ? p.appetite.weeks * people * pace : undefined
  const appetiteEnd = p.appetite ? Date.parse(p.appetite.from) + p.appetite.weeks * 7 * DAY : undefined
  const fits = appetiteEnd ? f.at <= appetiteEnd : undefined
  const refining = whatIf.nodes.filter((n) => n.kind === 'ticket' && refineOf(n)).length
  const streamIds = planStream(p.nodes, p.links, people, pace).streams.map((x) => x.id)
  const level: Level | undefined = open.size === 0 ? (compact ? 'overview' : 'streams') : streamIds.every((x) => open.has(x)) ? 'tickets' : undefined
  const setLevel = (l: Level) => { setCompact(l === 'overview'); setOpen(new Set(l === 'tickets' ? streamIds : [])) }
  const toggle = (sid: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(sid)) n.add(sid); return n })
  const stages = stagesOf(p, fits), stage = stages.find((s) => !s.done)
  const step = (s: Stage) => {
    if (s.id === 'linear') return p.team ? arm('create', create) : (setTeamsOn(true), setCfg('team'))
    if (s.ask && !p.busy) void say(s.ask)
  }
  const settings = (
    <div className="border-b border-line px-4 py-2 text-meta text-fg-3">
      <button onClick={() => setCfg(cfg ? undefined : 'open')} className="flex w-full items-center gap-1.5 text-left hover:text-fg-1">
        <span className="min-w-0 flex-1 truncate"><span className="capitalize">{p.method}</span> · {p.skill || 'Your planning skill'} · {p.project ? p.project.name : teamName ?? 'no Linear team yet'}</span>
        <span className="text-accent-text">{cfg ? 'Done' : 'Change'}</span>
      </button>
      {cfg && (
        <div className="space-y-2.5 pb-1 pt-2.5">
          <Chips label="Method" value={p.method} options={[['agile', 'Agile: epics of thin slices'], ['waterfall', 'Waterfall: phases in order']]} onChange={(m) => void set({ method: m })} />
          <div><p className="mb-1 font-semibold uppercase tracking-label text-fg-4">Planning skill</p>
            <InlineList value={p.skill ?? ''} options={[{ value: '', label: 'The one in Settings', hint: 'Settings → Workflows → What each feature runs' }, ...(skills.data ?? []).map((x) => ({ value: x.name, label: x.name }))]} onPick={(v) => void set({ skill: v })} /></div>
          {!p.project && <div onFocus={() => setTeamsOn(true)} onMouseEnter={() => setTeamsOn(true)}><p className="mb-1 font-semibold uppercase tracking-label text-fg-4">Linear team</p>
            <InlineList value={p.team} empty={teams.isLoading || !teams.data ? 'Reading your Linear teams…' : 'No teams'} options={(teams.data?.teams ?? []).map((t) => ({ value: t.id, label: t.name, hint: t.key }))} onPick={(v) => { void set({ team: v }); if (cfg === 'team') setCfg(undefined) }} /></div>}
        </div>
      )}
    </div>
  )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <input defaultValue={p.title} key={p.id} onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && set({ title: e.target.value })} aria-label="Plan name"
               className="min-w-[140px] flex-1 bg-transparent text-title font-semibold tracking-tight text-fg-1 outline-none" />
        <History p={p} onBack={back} />
        <StageBar stages={stages} onStep={step} />
        {p.creating ? <span className="inline-flex items-center gap-1.5 text-small text-run"><LoaderCircle className="size-3.5 animate-spin" />Creating {made}/{p.nodes.length}…</span>
          : made === p.nodes.length && made > 0 ? <span className="inline-flex items-center gap-1 text-small font-medium text-ok"><Check className="size-4" />In Linear</span>
          : <button disabled={!items.length || p.busy} title={!p.team && !p.project ? 'Pick the Linear team first' : undefined}
                    onClick={() => (p.team ? arm('create', create) : (setTeamsOn(true), setCfg('team')))}
                    className="relative inline-flex items-center gap-1.5 overflow-hidden rounded-lg px-3 py-1.5 text-small font-semibold text-fg-1 ring-1 ring-line transition-colors hover:bg-hover disabled:opacity-40">
              <Flag className="size-3.5" />{armed === 'create' ? <><ArmLabel>{`Confirm: ${p.nodes.length - made} in Linear`}</ArmLabel><ArmBar on="plain" /></> : made ? `Create the other ${p.nodes.length - made}` : 'Create in Linear'}
            </button>}
      </header>
      {/* the board on top, the conversation docked under it (on a phone: the conversation alone) */}
      <div ref={split} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <section aria-label="The plan" className="relative hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-2/40 lg:flex">
          {whatIf.nodes.length > 0 && <PlanBar p={whatIf} set={set} toast={toast} say={say} refining={refining} level={level} onLevel={setLevel} legend={legend} onLegend={() => setLegend(!legend)}
                                     status={<Readiness whatIf={whatIf} company={setup.data?.config.compliance} teamKey={teams.data?.teams.find((t) => t.id === p.team)?.key} people={people} pace={pace} points={f.points} onAsk={(t) => void say(t)} onSelect={setSelected}
                                                onAdd={(ob) => void ops([{ op: 'add', id: `r-${ob.id}`, kind: 'ticket', title: ob.title, description: ob.why, parent: p.nodes.find((n) => n.kind === 'goal')?.id, covers: [ob.id], moscow: 'must' }])} />}
                                     tools={<Plays p={p} whatIf={whatIf} people={people} pace={pace} busy={p.busy} onTry={(o) => void addTried(o)} onAsk={(t) => void say(t)} colorBy={colorBy} onColorBy={setColorBy} />} />}
          {tried.length > 0 && <ScenarioBar p={p} whatIf={whatIf} people={people} pace={pace} toast={toast} onSet={setTried} />}
          <div className="relative min-h-0 flex-1">
            {/* the plan, or the draft on top of it: a first draft (nothing applied yet) is drawn too, not only once applied */}
            {!shown.nodes.length ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Sparkles className="size-7 text-accent-text" />
                <p className="text-body font-semibold text-fg-1">{p.busy || tried.length ? 'Drawing the plan…' : 'The plan draws itself here'}</p>
                <p className="max-w-sm text-small text-fg-3">Each epic a stream flowing into the goal, its tickets along it when they would be worked on, and the time it is worth marked.</p>
              </div>
            ) : <PlanStream p={withObligations(shown, setup.data?.config.compliance)} base={tried.length ? p : undefined} draft={paced} fresh={fresh?.turn && 'id' in fresh ? `${fresh.id}:${paced.length}` : undefined} onMove={p.creating ? undefined : move} colorBy={colorBy} people={people} pace={pace} selected={selected} onSelect={setSelected} onExplore={(g) => !p.busy && void say(explore(g))} compact={compact} open={open} onToggle={toggle} legend={legend} />}
            {selected && <Inspector p={whatIf} id={selected} onOps={ops} onMove={move} onClose={() => setSelected(undefined)} />}
          </div>
        </section>
        <div role="separator" aria-orientation="horizontal" aria-label="Resize the board and the conversation" title="Drag to resize · double-click to reset"
             onPointerDown={dragDock} onDoubleClick={() => { setDock(undefined); keepDock() }}
             className="group relative hidden h-px shrink-0 cursor-row-resize bg-line lg:block">
          <span className="absolute inset-x-0 -bottom-1.5 -top-1.5 group-hover:bg-accent/20" />
        </div>
        <section aria-label="Chat" style={dock ? ({ '--dock': `${dock}px` } as React.CSSProperties) : undefined}
                 className={`flex min-h-0 flex-1 flex-col bg-surface-1/60 lg:flex-none ${dock ? 'lg:h-[var(--dock)]' : 'lg:h-[clamp(300px,42%,560px)]'}`}>
          {p.vision && <VisionCard p={p} set={set} toast={toast} />}
          <Chat p={p} toast={toast} stage={stage} settings={settings} onSelect={setSelected} onReplay={replayFrom} />
        </section>
      </div>
    </div>
  )
}

// --- a Linear project the plan contributes to: its vision, its timeline, and when it would land ------------------------
const DAY = 86_400_000
const fmt = (d: number | string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
/** When the work left would be done: what's left in points over what the people on it finish a week. */
export function forecast(nodes: PlanNode[], people: number, pace: number, now = Date.now(), links: Plan['links'] = []) {
  // what is in scope (cut work under Later is not), and when it lands by the schedule (the people, their pace, the order
  // and the dependencies), as the map draws it
  const inPlan = new Set(planStream(nodes, links, people, pace).streams.flatMap((s) => s.slots.map((x) => x.id)))
  const tickets = nodes.filter((n) => n.kind === 'ticket' && inPlan.has(n.id))
  const left = tickets.filter((n) => n.state?.type !== 'completed')
  const known = tickets.filter((n) => n.estimate).map((n) => n.estimate!)
  const guess = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 2 // unestimated: the average of the rest
  const points = left.reduce((sum, n) => sum + (n.estimate ?? guess), 0)
  const weeks = planStream(nodes, links, people, pace).end
  return { done: tickets.length - left.length, total: tickets.length, points: Math.round(points), guessed: left.filter((n) => !n.estimate).length, weeks, at: now + weeks * 7 * DAY }
}
/**
 * Where the plan stands in time: the project it adds to (its vision, its lead), the timeline (start, today, the
 * appetite, the milestones, the due date, and when the work left lands), and the knobs of the forecast.
 */
type Level = 'overview' | 'streams' | 'tickets'
/** The plan's one bar: where it stands and the verdict, how much of it to show, and the three numbers the forecast
 *  rests on (people, pace, appetite), all in reach. */
function PlanBar({ p, set, toast, say, refining, level, onLevel, legend, onLegend, status, tools }: { p: Plan; set: SetPlan; toast: Toast; say: (t: string) => unknown; refining: number; level?: Level; onLevel: (l: Level) => void; legend: boolean; onLegend: () => void; status?: ReactNode; tools?: ReactNode }) {
  const pr = p.project
  const [syncing, setSyncing] = useState(false)
  const sync = () => { setSyncing(true); api(`/plans/${p.id}/sync`, {}).then((r: Plan) => remember(`/plans/${p.id}`, r), (e: Error) => toast(e.message, 'error')).finally(() => setSyncing(false)) }
  const people = p.people ?? Math.max(1, pr?.members ?? 1), pace = p.pace ?? 5
  const f = forecast(p.nodes, people, pace, Date.now(), p.links)
  const target = Date.parse(pr?.targetDate ?? '') || undefined
  const appetiteEnd = p.appetite ? Date.parse(p.appetite.from) + p.appetite.weeks * 7 * DAY : undefined
  // how far over, in days (exact: a day over is over), said in weeks once it is more than one
  const late = target ? Math.ceil((f.at - target) / DAY) : undefined
  const over = appetiteEnd ? Math.ceil((f.at - appetiteEnd) / DAY) : undefined
  const span = (d: number) => (d >= 10 ? `${Math.round(d / 7)} weeks` : `${d} day${d === 1 ? '' : 's'}`)
  const bad = (over ?? late ?? 0) > 0, known = over !== undefined || late !== undefined
  const verdict = over !== undefined ? (over > 0 ? `${span(over)} over the ${p.appetite!.weeks}-week appetite` : `Fits the ${p.appetite!.weeks}-week appetite`)
    : late !== undefined ? (late > 0 ? `${span(late)} late` : 'On track') : `About ${Math.ceil(f.weeks)} week${Math.ceil(f.weeks) === 1 ? '' : 's'} of work left`
  const pct = f.total ? Math.round((100 * f.done) / f.total) : 0
  const stepper = (v: number, on: (n: number) => void, label: string, unit: string) => (
    <span className="inline-flex items-center gap-1.5 text-fg-3">{label}
      <span className="inline-flex items-center rounded-ctl bg-fill">
        <button onClick={() => on(Math.max(1, v - 1))} aria-label={`Fewer ${unit}`} className="rounded-l-ctl px-2 py-1 text-fg-3 hover:bg-fill-strong hover:text-fg-1">−</button>
        <b className="min-w-5 text-center font-semibold tabular-nums text-fg-1">{v}</b>
        <button onClick={() => on(v + 1)} aria-label={`More ${unit}`} className="rounded-r-ctl px-2 py-1 text-fg-3 hover:bg-fill-strong hover:text-fg-1">+</button>
      </span>
    </span>
  )
  return (
    <div className="relative z-20 space-y-1.5 border-b border-line px-4 py-2 text-small">
      {/* where it stands, and how ready (compliance, resources, risks) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${!known ? 'bg-fill text-fg-1' : bad ? 'bg-fail/10 text-fail-text' : 'bg-ok/10 text-ok-text'}`}>
          <span className={`size-1.5 rounded-full ${!known ? 'bg-fg-3' : bad ? 'bg-fail' : 'bg-ok'}`} />{verdict}
        </span>
        <span className="inline-flex items-center gap-2 text-fg-2" title={`${f.done} of ${f.total} tickets done`}>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-fill-strong"><span className="block h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${pct}%` }} /></span>
          <span><b className="font-semibold text-fg-1">{pct}%</b> done</span>
        </span>
        <span className="text-fg-3"><b className="font-semibold text-fg-1">{f.points}</b> pt left{f.guessed ? ` (${f.guessed} guessed)` : ''} · lands <b className="font-semibold text-fg-1">~{fmt(f.at)}</b>{target ? ` · due ${fmt(target)}` : ''}</span>
        {refining > 0 && <span className="rounded-full bg-wait/10 px-2 py-0.5 text-meta font-medium text-wait-text">{refining} to refine</span>}
        {status && <span className="ml-auto">{status}</span>}
        {pr && (
          <span className="ml-auto inline-flex items-center gap-2 text-meta text-fg-3">
            <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-fg-2 hover:text-fg-1" title={pr.lead ? 'You lead it: the plan may propose a new vision, applied when you accept it' : `Led by ${pr.leadName ?? 'someone else'}: the plan only adds tickets to it`}>{pr.lead ? 'You lead it' : 'Adds tickets only'}<ExternalLink className="size-3" /></a>
            <button onClick={sync} disabled={syncing} title={`Synced ${new Date(pr.syncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-fg-2 hover:bg-hover disabled:opacity-50">{syncing ? <LoaderCircle className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}Sync</button>
          </span>
        )}
      </div>
      {/* how much to show, and what the forecast rests on */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Tabs size="sm" as="tab" label="How much to show" value={level ?? 'streams'} onChange={onLevel}
              options={[{ id: 'overview', label: 'Overview', title: 'Every stream as one line of progress' }, { id: 'streams', label: 'Streams', title: 'Each stream with its tickets along it' }, { id: 'tickets', label: 'Tickets', title: 'Every ticket by name' }]} />
        {stepper(people, (n) => void set({ people: n }), 'People', 'people')}
        <span title="Points one person finishes a week">{stepper(pace, (n) => void set({ pace: n }), 'Pace', 'points a week')}</span>
        <span className="inline-flex items-center gap-1.5 text-fg-3" title="How much time the work is worth: the plan fits its scope into it">Appetite
          <Chips label="Appetite" value={p.appetite?.weeks ?? 0} options={[[0, 'None'] as [number, string], ...[...new Set([2, 4, 6, 12, p.appetite?.weeks ?? 2])].sort((a, b) => a - b).map((w, i) => [w, i ? String(w) : `${w} wk`] as [number, string])]} onChange={(w) => void set({ appetite: w || null })} />
        </span>
        <PickPill on={legend} onClick={onLegend} title="What the marks on the map mean">Key</PickPill>
        {tools && <span className="ml-auto">{tools}</span>}
      </div>
    </div>
  )
}

/** A new vision the agent proposes for a project you lead: yours to apply to Linear, or to drop. */
function VisionCard({ p, set, toast }: { p: Plan; set: SetPlan; toast: Toast }) {
  const { armed, arm } = useArm()
  const apply = () => api(`/plans/${p.id}/vision`, {}).then((r: Plan) => { remember(`/plans/${p.id}`, r); toast('The project’s vision is updated in Linear') }, (e: Error) => toast(e.message, 'error'))
  return (
    <div className="m-3 mb-0 space-y-2 rounded-2xl bg-accent-soft/60 p-3 ring-1 ring-accent/20">
      <p className="text-small font-semibold text-fg-1">A new vision for {p.project?.name ?? 'the project'}</p>
      <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-1 px-3 py-2"><Md text={p.vision!} className="!text-small" /></div>
      <div className="flex items-center gap-2">
        {p.project?.lead && <button onClick={() => arm('vision', apply)} className="relative overflow-hidden btn-primary btn-sm">{armed === 'vision' ? <><ArmLabel>Confirm: update it in Linear</ArmLabel><ArmBar on="color" /></> : 'Update it in Linear'}</button>}
        <button onClick={() => set({ vision: '' })} className="rounded-lg px-2.5 py-1 text-small text-fg-3 hover:text-fg-1">Discard</button>
      </div>
    </div>
  )
}

type LinearProject = { id: string; name: string; targetDate?: string; lead?: string; mine: boolean; url?: string; description?: string }
type Org = import('../../server/orgs.ts').Org

/**
 * Starting a plan: pitch a new project on the left (its name, the brief, the method), or pick one of your Linear
 * projects in the list on the right to plan into it (yours to lead: it may also reshape the vision; else tickets only).
 */
function NewPlan({ onMade, toast }: { onMade: (id: string) => void; toast: Toast }) {
  const [title, setTitle] = useState(''), [brief, setBrief] = useState(''), [method, setMethod] = useState<Plan['method']>('agile')
  const [appetite, setAppetite] = useState(0) // weeks the work is worth; 0: none set
  const [busy, setBusy] = useState<string>() // 'new', or the project being planned into
  const start = (key: string, body: object, link: string | undefined, first: string) => {
    setBusy(key)
    api('/plans', body)
      .then((p: Plan) => (link ? api(`/plans/${p.id}/project`, { project: link }) : Promise.resolve(p)))
      .then((p: Plan) => api(`/plans/${p.id}/say`, { text: first }).then(() => { refresh('/plans'); onMade(p.id) }))
      .catch((e: Error) => toast(e.message, 'error')).finally(() => setBusy(undefined))
  }
  const pitch = () => start('new', { title, brief, method, appetite }, undefined, 'Break this down.')
  const field = 'w-full rounded-xl bg-surface-1 px-3 py-2 text-body text-fg-1 outline-none ring-1 ring-line transition-shadow placeholder:text-fg-4 focus:ring-2 focus:ring-accent/40'
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[620px] px-5 py-10">
          <div className="space-y-4 card p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text"><Sparkles className="size-5" /></span>
              <div><h2 className="text-title font-semibold tracking-tight text-fg-1">Pitch a new project</h2>
                <p className="text-small text-fg-3">Write the brief. An agent breaks it down into a map while you watch; you shape it together, and it goes to Linear when you say so.</p></div>
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Its name: Seat pausing" className={`${field} font-semibold`} />
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={8} placeholder="The problem, who has it, what success looks like, the constraints and the deadline." className={`${field} resize-y`} />
            <div className="space-y-1.5">
              <p className="text-small font-medium text-fg-1">Appetite <span className="font-normal text-fg-3">· how much time it is worth; the plan fits its scope into it</span></p>
              <Chips label="Appetite" value={appetite} options={[[0, 'Not set'], [1, '1 week'], [2, '2 weeks'], [4, '4 weeks'], [6, '6 weeks'], [12, 'A quarter']]} onChange={setAppetite} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Tabs label="Method" value={method} onChange={setMethod} options={[{ id: 'agile', label: 'Agile' }, { id: 'waterfall', label: 'Waterfall' }]} />
              <button onClick={pitch} disabled={!!busy || !brief.trim()} className="ml-auto inline-flex items-center gap-2 btn-primary btn-lg shadow-[0_8px_24px_-10px_var(--accent)] transition-transform active:scale-[0.98] disabled:opacity-40 disabled:shadow-none">
                {busy === 'new' ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Break it down
              </button>
            </div>
          </div>
        </div>
      </div>
      <ProjectList busy={busy} onPlan={(x, ask, source) => source === 'github'
        // a GitHub Project: the plan reads it as context (planning into it, tickets and all, is Linear's for now)
        ? start(x.id, { title: x.name, brief: [x.description, ask].filter(Boolean).join('\n\n'), method, appetite }, undefined, `This plan is for the GitHub Project "${x.name}" (${x.url}).${ask.trim() ? `\n${ask}` : ' Break it down.'}`)
        : start(x.id, { title: x.name, brief: ask, method, appetite }, x.id, ask.trim() ? `Plan this into the project:\n${ask}` : 'Read the project against its vision: what is missing to reach it? Propose the tickets.')} />
    </div>
  )
}

/**
 * An organization's projects, from where it manages its work: Linear (the ones you lead first) or its GitHub Projects.
 * Pick the organization first (yours, or one whose repositories you watch): your personal work never lists a company's
 * Linear projects. Pick a project to plan into it.
 */
function ProjectList({ busy, onPlan }: { busy?: string; onPlan: (x: LinearProject, ask: string, source: 'linear' | 'github') => void }) {
  const orgsQ = useApi<Org[]>('/orgs', { staleTime: 10 * 60_000 })
  const [org, setOrg] = useState<string>()
  const o = orgsQ.data?.find((x) => x.owner === org) ?? orgsQ.data?.[0]
  const q = useApi<{ source: 'linear' | 'github'; projects: LinearProject[] }>(o ? `/plans/projects?org=${encodeURIComponent(o.owner)}` : undefined, { staleTime: 5 * 60_000 })
  const setTracker = (tracker: 'linear' | 'github') => o && api('/orgs', { owner: o.owner, tracker }).then(() => { refresh('/orgs'); refresh('/plans/projects') }, () => {})
  const where = q.data?.source === 'github' ? 'GitHub Projects' : 'Linear'
  const [find, setFind] = useState(''), [open, setOpen] = useState<string>(), [ask, setAsk] = useState('')
  const list = (q.data?.projects ?? []).filter((x) => x.name.toLowerCase().includes(find.trim().toLowerCase())).sort((a, b) => Number(b.mine) - Number(a.mine))
  return (
    <aside aria-label="Your Linear projects" className="hidden w-[360px] shrink-0 flex-col border-l border-line lg:flex">
      <div className="space-y-2 px-4 pb-2 pt-5">
        <h3 className="text-body font-semibold text-fg-1">Or plan into a project</h3>
        {(orgsQ.data?.length ?? 0) > 1 && o && (
          <Pick label="Organization" value={o.owner} onChange={(v) => { setOrg(v); setFind(''); setOpen(undefined) }}
                options={orgsQ.data!.map((x) => ({ value: x.owner, label: x.owner, hint: x.personal ? 'You' : x.tracker === 'linear' ? 'Linear' : 'GitHub Projects' }))} />
        )}
        {o && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-fg-3">
            <span>{o.personal ? 'You manage' : `${o.owner} manages`} its work in</span>
            <Tabs size="sm" label={`Where ${o.owner} manages its work`} value={o.tracker} onChange={(t) => void setTracker(t)} options={[{ id: 'linear', label: 'Linear' }, { id: 'github', label: 'GitHub Projects' }]} />
            {o.guessed && <span className="text-fg-4">(a guess: change it if not)</span>}
          </div>
        )}
        <p className="text-meta text-fg-3">{q.data?.source === 'github' ? 'Its description comes in as the plan’s context.' : 'Its vision, tickets and timeline come in. If you lead it, the plan may reshape its vision; otherwise it only adds tickets.'}</p>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find a project in ${where}`} className="w-full rounded-lg bg-hover px-2.5 py-1.5 text-small text-fg-1 outline-none placeholder:text-fg-4 focus:ring-1 focus:ring-accent/40" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {q.isLoading ? <div className="px-2"><Skeleton rows={7} /></div>
          : q.error ? <p className="px-3 py-2 text-small text-fail">{(q.error as Error).message}</p>
          : !list.length ? <p className="px-3 py-2 text-small text-fg-3">{find ? 'No project matches.' : `No open projects in ${where}${o ? ` for ${o.owner}` : ''}.`}</p>
          : list.map((x, i) => (
            <div key={x.id} className="animate-[rise-in_220ms_var(--ease-snappy)_both]" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button onClick={() => { setOpen(open === x.id ? undefined : x.id); setAsk('') }} aria-expanded={open === x.id}
                      className={`flex w-full items-start gap-2.5 rounded-ctl px-2.5 py-2 text-left transition-colors ${open === x.id ? 'sel' : 'hover:bg-hover/60'}`}>
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${x.mine ? 'bg-accent' : 'bg-fg-4/40'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small font-medium text-fg-1">{x.name}</span>
                  <span className="block truncate text-micro text-fg-3">{q.data?.source === 'github' ? (x.description ?? 'GitHub Project') : <>{x.mine ? 'You lead it' : `Led by ${x.lead ?? 'no one'}`}{x.targetDate ? ` · due ${fmt(x.targetDate)}` : ''}</>}</span>
                </span>
                {x.mine && <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-micro font-medium text-accent-text">Yours</span>}
              </button>
              {open === x.id && (
                <div className="mx-2 mb-2 mt-1 space-y-2 animate-[detail-in_160ms_var(--ease-snappy)]">
                  <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={3} placeholder="What to add (optional): leave empty and it finds what is missing to reach the vision"
                            className="w-full resize-none rounded-lg bg-surface-1 px-2.5 py-1.5 text-small text-fg-1 outline-none ring-1 ring-line placeholder:text-fg-4 focus:ring-accent/40" />
                  <button onClick={() => onPlan(x, ask, q.data?.source ?? 'linear')} disabled={!!busy} className="inline-flex w-full items-center justify-center gap-1.5 btn-primary disabled:opacity-50">
                    {busy === x.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}{q.data?.source === 'github' ? 'Plan for it' : `Plan into ${x.mine ? 'your project' : 'it: tickets only'}`}
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
    </aside>
  )
}

export function PlansWorkspace({ toast }: { toast: Toast }) {
  const list = useApi<{ plans: Summary[] }>('/plans', { refetchInterval: 60_000 }) // a saved plan refreshes it at once (live.ts)
  const [open, setOpen] = useState<string | 'new' | undefined>(() => new URLSearchParams(location.search).get('plan') ?? undefined)
  const plans = useMemo(() => list.data?.plans ?? [], [list.data])
  const current = open ?? (list.data ? (plans[0]?.id ?? 'new') : undefined)
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Plans" className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-2 md:flex">
        <button onClick={() => setOpen('new')} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-small font-medium ${current === 'new' ? 'sel' : 'text-accent-text hover:bg-hover'}`}><Plus className="size-4" />New plan</button>
        {plans.map((x) => (
          <button key={x.id} onClick={() => setOpen(x.id)} className={`rounded-lg px-2.5 py-2 text-left ${current === x.id ? 'sel' : 'hover:bg-hover'}`}>
            <span className="flex items-center gap-1.5 text-small font-medium text-fg-1">{(x.busy || x.creating) && <LoaderCircle className="size-3 animate-spin text-run" />}<span className="truncate">{x.title}</span></span>
            <span className="block text-micro text-fg-3">{x.count} items{x.made ? ` · ${x.made} in Linear` : ''} · {x.method}</span>
          </button>
        ))}
      </nav>
      {current === 'new' ? <NewPlan onMade={setOpen} toast={toast} /> : current ? <PlanView key={current} id={current} toast={toast} /> : null}
    </div>
  )
}
