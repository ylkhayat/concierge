// The Understanding and Intent cards, opened: the whole height of the chat, a picture of the change instead of text.
// Understanding: the parts of the system the PR touches (one box each, its changes counted and its new behaviour in a
// line), wired by how those parts call each other, laid out like Explain's map but flat. Intent: the PR's story as a
// flow (why it was needed → what was done → before against after), with what was set aside and what is still open.
// Both read the PR's explanation (Explain); without one they offer to write it.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { elk } from '../elk.ts'
import { ArrowRight, Check, CircleDashed, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Diagram } from '../../server/discussions.ts'
import type { Overlay, Shape, Touched } from '../../server/explain.ts'
import { api, enc } from '../lib.ts'
import { keepSame, useApi } from '../query.ts'

type Explained = { overlay?: Overlay; stale?: boolean; task?: { state: string } }

/** The PR's explanation, or a way to have it written. */
function useExplained(prId: string, path?: string) {
  // the same read as Explain and Overview (explainPath), so the picture opens at once when they already have it
  return useApi<Explained>(path ?? `/prs/${enc(prId)}/explain`, { staleTime: 60_000, placeholderData: keepSame(`/prs/${enc(prId)}/explain`) })
}

function Missing({ prId, busy, toast }: { prId: string; busy: boolean; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-10 items-center justify-center rounded-2xl bg-accent-soft"><Sparkles className="size-5 text-accent-text" /></span>
      <p className="max-w-sm text-small text-fg-2">{busy ? 'Explaining the change: the picture appears here when it is ready.' : 'This picture is drawn from the PR’s explanation, which isn’t written yet.'}</p>
      {busy ? <LoaderCircle className="size-4 animate-spin text-fg-3" />
        : <button onClick={() => api(`/prs/${enc(prId)}/explain`, {}).then(() => toast('Explaining the change'), (e: Error) => toast(e.message, 'error'))} className="btn-primary btn-sm">Explain this PR</button>}
    </div>
  )
}

// --- Understanding: the change as a mind map -----------------------------------------------------------------
// At the centre what the PR does; around it the parts of the system it touches; around each part its folders (when it
// has many files) and its files, each with its new behaviour; and a branch for the behaviour it changes (its flows).
// Two sides like a hand-drawn mind map (ELK lays out each as a tree); lines run centre to centre, under the boxes.

// plain: a part said in words only (a tour step): its what and a count, its changes one click away, never as rows
type MNode = { id: string; kind: 'root' | 'area' | 'flows'; title: string; line?: string; touched: Touched[]; flows?: Overlay['flows']; plain?: boolean }
type MData = { n: MNode; on?: string; pick: (id: string) => void }
const KIND = { added: 'text-ok-text', modified: 'text-accent-text', removed: 'text-fail-text' } as const
const DOT = { added: 'bg-ok', modified: 'bg-accent', removed: 'bg-fail' } as const
const WORD = { added: 'New', modified: 'Changed', removed: 'Gone' } as const
const ROWS = 6 // file rows shown in a part before "+N more"
const W = { root: 280, area: 270, flows: 270 }
const heightOf = (n: MNode) => n.kind === 'root' ? 120 : n.plain ? 120 : 58 + (n.line ? 34 : 0) + Math.min(ROWS, n.kind === 'flows' ? n.flows!.length : n.touched.length) * 46 + ((n.kind === 'area' && n.touched.length > ROWS) ? 22 : 0)
const mark = (c: Touched['change']) => (c === 'added' ? '+' : c === 'removed' ? '−' : '~')

const Hub = () => <Handle type="source" position={Position.Top} className="!left-1/2 !top-1/2 !size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const HubIn = () => <Handle type="target" position={Position.Top} className="!left-1/2 !top-1/2 !size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />

/** A box of the map: the centre (what changes), a part of the system with its files as rows, or the flows it changes. */
function MindNode({ data }: NodeProps<Node<MData>>) {
  const { n, on, pick } = data
  const count = (k: Touched['change']) => n.touched.filter((t) => t.change === k).length
  if (n.kind === 'root') return (
    <div style={{ width: W.root }} className="rounded-card bg-[color-mix(in_oklch,var(--lane)_16%,var(--surface-1))] p-3.5 text-left ring-1 ring-[color-mix(in_oklch,var(--lane)_45%,transparent)]">
      <HubIn /><Hub />
      <p className="label mb-1 text-[var(--lane)]">What changes</p>
      <p className="text-small font-semibold leading-snug text-fg-1">{n.title}</p>
      {n.line && <p className="mt-1 line-clamp-3 text-meta leading-snug text-fg-2">{n.line}</p>}
    </div>
  )
  const row = (id: string, active: boolean) => `nodrag flex w-full min-w-0 flex-col rounded-ctl px-2 py-1 text-left transition-colors ${active ? 'bg-[color-mix(in_oklch,var(--lane)_14%,transparent)]' : 'hover:bg-hover'}`
  return (
    <div style={{ width: W[n.kind] }} className={`rounded-card bg-surface-1 p-2 text-left ${on === n.id ? 'shadow-[0_0_0_2px_var(--lane),var(--e2)]' : 'shadow-[var(--e1)] ring-1 ring-line'}`}>
      <HubIn /><Hub />
      <button type="button" onClick={() => pick(n.id)} className="nodrag w-full rounded-ctl px-2 py-1 text-left hover:bg-hover">
        <p className="truncate text-small font-semibold text-fg-1" title={n.title}>{n.title}</p>
        {n.kind === 'area' && n.line && <p className={`mt-0.5 text-meta leading-snug text-fg-2 ${n.plain ? 'line-clamp-3' : 'line-clamp-2'}`}>{n.line}</p>}
        <p className="flex gap-2 text-micro tabular-nums text-fg-3">
          {n.kind === 'flows' ? `${n.flows!.length} flow${n.flows!.length === 1 ? '' : 's'} it changes` : <>
            {count('added') > 0 && <span className={KIND.added}>{count('added')} new</span>}
            {count('modified') > 0 && <span className={KIND.modified}>{count('modified')} changed</span>}
            {count('removed') > 0 && <span className={KIND.removed}>{count('removed')} gone</span>}
          </>}
        </p>
      </button>
      {!n.plain && <div className="mt-0.5 space-y-px">
        {n.kind === 'flows' ? n.flows!.slice(0, ROWS).map((f, k) => (
          <button key={k} type="button" onClick={() => pick(`flow:${k}`)} className={row(`flow:${k}`, on === `flow:${k}`)}>
            <span className="truncate text-meta font-medium text-fg-1">{f.title}</span>
            <span className="truncate text-micro text-fg-3">{f.after}</span>
          </button>
        )) : n.touched.slice(0, ROWS).map((t) => (
          <button key={t.path} type="button" onClick={() => pick(`f:${t.path}`)} className={row(`f:${t.path}`, on === `f:${t.path}`)} title={t.after}>
            <span className="flex min-w-0 items-start gap-1.5"><span className={`mt-[5px] size-1.5 shrink-0 rounded-full ${DOT[t.change]}`} aria-label={WORD[t.change]} />
              <span className="line-clamp-2 text-meta leading-snug text-fg-1">{t.after}</span></span>
          </button>
        ))}
        {n.kind === 'area' && n.touched.length > ROWS && <button type="button" onClick={() => pick(n.id)} className="nodrag px-2 text-micro text-fg-4 hover:text-fg-2">+{n.touched.length - ROWS} more</button>}
      </div>}
    </div>
  )
}
const nodeTypes = { mind: MindNode }

/** The map's boxes: the centre, each part of the system it touches (its files inside, by folder), and the flows. */
/** A folder as words, for a part with no name of its own: "apps/billing-service" → "Billing service". */
const said = (folder: string) => { const w = (folder.split('/').filter(Boolean).pop() ?? folder).replace(/[-_.]+/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1) }
/** Said as words: code marks (`like this`) dropped, so a line reads as a sentence. */
const words = (x?: string) => x?.replace(/`([^`]+)`/g, '$1')
const STEP_KIND: Record<string, string> = { context: 'Background', core: 'The change itself', supporting: 'What it needs around it', tests: 'How it is checked', cleanup: 'Tidying up' }

export function mindOf(o: Overlay): { nodes: MNode[]; links: [string, string][] } {
  // the guided tour already groups the change into steps, in plain words: those are the parts, no paths to read
  const steps = o.tour?.steps?.filter((st) => st.paths.length) ?? []
  if (steps.length) {
    const nodes: MNode[] = [{ id: 'root', kind: 'root', title: o.business.headline, line: o.business.what, touched: o.touched }]
    steps.slice(0, 10).forEach((st, i) => nodes.push({ id: `a:step${i}`, kind: 'area', plain: true, title: st.title || STEP_KIND[st.kind] || 'Part of the change', line: words(st.what ?? st.narrative), touched: o.touched.filter((t) => st.paths.includes(t.path)) }))
    if (o.flows.length) nodes.push({ id: 'flows', kind: 'flows', title: 'How it behaves', touched: [], flows: o.flows })
    return { nodes, links: nodes.filter((n) => n.id !== 'root').map((n) => ['root', n.id] as [string, string]) }
  }
  const roots = [...o.facts.roots].sort((a, b) => b.length - a.length)
  const rootOf = (p: string) => roots.find((r) => p === r || p.startsWith(`${r}/`)) ?? p.split('/').slice(0, Math.min(2, p.split('/').length - 1) || 1).join('/')
  const nodes: MNode[] = [{ id: 'root', kind: 'root', title: o.business.headline, line: o.business.what, touched: o.touched }]
  const byArea = new Map<string, Touched[]>()
  for (const t of o.touched) { const a = rootOf(t.path); byArea.set(a, [...(byArea.get(a) ?? []), t]) }
  // a PR in one or two parts: a big part splits into its folders, so the map has branches, not one long box
  const split = byArea.size <= 2
  for (const [area, list] of [...byArea].sort((a, b) => b[1].length - a[1].length)) {
    if (!split || list.length <= ROWS) { byArea.set(area, list); continue }
    byArea.delete(area)
    for (const t of list) {
      const rest = t.path.slice(area.length + 1).split('/')
      const box = rest.length > 2 ? `${area}/${rest.slice(0, 2).join('/')}` : rest.length > 1 ? `${area}/${rest[0]}` : area
      byArea.set(box, [...(byArea.get(box) ?? []), t])
    }
  }
  for (const [area, list] of [...byArea].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    nodes.push({ id: `a:${area}`, kind: 'area', title: said(area), touched: [...list].sort((x, y) => x.path.localeCompare(y.path)) })
  }
  if (o.flows.length) nodes.push({ id: 'flows', kind: 'flows', title: 'How it behaves', touched: [], flows: o.flows })
  return { nodes, links: nodes.filter((n) => n.id !== 'root').map((n) => ['root', n.id] as [string, string]) }
}

function Story({ o }: { o: Overlay }) {
  const s = o.tour?.story, f = o.flows[0]
  const before = s?.before.caption ?? f?.before, after = s?.after.caption ?? f?.after
  return (before || after) ? (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-stretch gap-2 text-small">
      <div className="rounded-ctl bg-fill px-3 py-2"><p className="label mb-0.5 text-fg-4">Before</p><p className="leading-snug text-fg-2">{before ?? '—'}</p></div>
      <ArrowRight className="size-4 self-center text-fg-4" />
      <div className="rounded-ctl bg-[color-mix(in_oklch,var(--lane)_12%,transparent)] px-3 py-2 ring-1 ring-[color-mix(in_oklch,var(--lane)_35%,transparent)]"><p className="label mb-0.5 text-[var(--lane)]">Now</p><p className="leading-snug text-fg-1">{after ?? '—'}</p></div>
    </div>
  ) : null
}

function MapCanvas({ o }: { o: Overlay }) {
  const { nodes: mind, links } = useMemo(() => mindOf(o), [o])
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>()
  const [on, setOn] = useState<string>()
  useEffect(() => {
    let live = true
    // a mind map with two sides: the centre in the middle, half the branches growing right, half growing left. Each
    // side is a tree laid out by ELK; the two are joined at the centre
    const kids = links.filter(([a]) => a === 'root').map(([, b]) => b)
    const weight = (id: string): number => 1 + links.filter(([a]) => a === id).reduce((n, [, b]) => n + weight(b), 0)
    const right = new Set<string>(), left = new Set<string>(); let wr = 0, wl = 0
    for (const k of [...kids].sort((a, b) => weight(b) - weight(a))) { if (wr <= wl) { right.add(k); wr += weight(k) } else { left.add(k); wl += weight(k) } }
    const under = (tops: Set<string>) => { const ids = new Set(['root']); const walk = (id: string) => { ids.add(id); for (const [a, b] of links) if (a === id) walk(b) }; tops.forEach(walk); return ids }
    const side = (ids: Set<string>, dir: 'RIGHT' | 'LEFT') => elk.layout({
      id: 'root', layoutOptions: { 'elk.algorithm': 'mrtree', 'elk.direction': dir, 'elk.spacing.nodeNode': '20' },
      children: mind.filter((n) => ids.has(n.id)).map((n) => ({ id: n.id, width: W[n.kind], height: heightOf(n) })),
      edges: links.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => ({ id: `${a}>${b}`, sources: [a], targets: [b] })),
    })
    void Promise.all([side(under(right), 'RIGHT'), left.size ? side(under(left), 'LEFT') : undefined]).then(([r, l]) => {
      if (!live) return
      const at = new Map<string, { x: number; y: number }>()
      const rr = r.children?.find((c) => c.id === 'root')
      for (const c of r.children ?? []) at.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 })
      // the left side, moved so its centre sits on the right side's centre
      const lr = l?.children?.find((c) => c.id === 'root')
      if (l && lr && rr) for (const c of l.children ?? []) if (c.id !== 'root') at.set(c.id, { x: (c.x ?? 0) - (lr.x ?? 0) + (rr.x ?? 0), y: (c.y ?? 0) - (lr.y ?? 0) + (rr.y ?? 0) })
      setPos(at)
    }).catch(() => { if (live) setPos(new Map(mind.map((n, k) => [n.id, { x: (k % 4) * 260, y: Math.floor(k / 4) * 120 }]))) })
    return () => { live = false }
  }, [mind, links])
  const pick = (id: string) => setOn((o) => (o === id ? undefined : id))
  const nodes: Node<MData>[] = mind.map((n) => ({ id: n.id, type: 'mind', position: pos?.get(n.id) ?? { x: 0, y: 0 }, data: { n, on, pick }, draggable: false }))
  const edges: Edge[] = links.map(([a, b]) => ({ id: `${a}>${b}`, source: a, target: b, type: 'straight', style: { stroke: a === 'root' ? 'color-mix(in oklch, var(--lane) 55%, transparent)' : 'var(--line-strong)', strokeWidth: a === 'root' ? 2 : 1.25 } }))
  // what the side panel shows: a part (its files), one file, or one flow
  const sel = !on ? undefined : on.startsWith('f:') ? (() => { const t = o.touched.find((x) => `f:${x.path}` === on); return t && { id: on, kind: 'file' as const, title: mind.find((n) => n.kind === 'area' && n.touched.includes(t))?.title ?? 'This change', touched: [t] } })()
    : on.startsWith('flow:') ? { id: on, kind: 'flow' as const, title: o.flows[Number(on.slice(5))]?.title ?? '', touched: [] as Touched[] }
    : (() => { const n = mind.find((x) => x.id === on); return n && n.kind === 'area' ? { id: on, kind: 'area' as const, title: n.title, touched: n.touched } : undefined })()
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className={`relative min-h-0 flex-1 overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line transition-opacity duration-200 ${pos ? 'opacity-100' : 'opacity-0'}`}>
        {pos && (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.06, maxZoom: 1 }} minZoom={0.6} maxZoom={1.6}
                     nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} onPaneClick={() => setOn(undefined)}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
          </ReactFlow>
        )}
        {!sel && <p className="pointer-events-none absolute bottom-2 left-3 text-micro text-fg-4">Click a part or a change for what it does · scroll to zoom, drag to move</p>}
      </div>
      {sel && (sel.touched.length > 0 || sel.kind === 'flow') && (
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-card bg-surface-1 ring-1 ring-line">
          <p className="flex items-center gap-2 border-b border-line px-3 py-2 text-small font-semibold text-fg-1"><span className="min-w-0 flex-1 truncate" title={sel.title}>{sel.title}</span>
            <button onClick={() => setOn(undefined)} aria-label="Close" className="text-fg-4 hover:text-fg-1"><X className="size-3.5" /></button></p>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {sel.kind === 'flow' ? (() => { const f = o.flows[Number(sel.id.slice(5))]; return (
              <li className="space-y-1.5 px-3 py-2">
                <p className="text-small font-medium text-fg-1">{f.title}</p>
                {f.before && <p className="text-meta leading-snug text-fg-4 line-through decoration-fg-4/40">{f.before}</p>}
                <p className="text-small leading-snug text-fg-1">{f.after}</p>
              </li>
            ) })() : sel.touched.map((t) => (
              <li key={t.path} className="space-y-1 px-3 py-2">
                <p className={`text-micro font-semibold uppercase tracking-wide ${KIND[t.change]}`}>{WORD[t.change]}</p>
                {t.before && <p className="text-meta leading-snug text-fg-4 line-through decoration-fg-4/40">{words(t.before)}</p>}
                <p className="text-small leading-snug text-fg-1">{words(t.after)}</p>
                {t.why && <p className="text-meta leading-snug text-fg-3">{words(t.why)}</p>}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}

export function UnderstandingMap({ prId, path, toast }: { prId: string; path?: string; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const q = useExplained(prId, path), o = q.data?.overlay
  if (q.isLoading) return <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
  if (q.isError) return <div className="flex h-full items-center justify-center px-6 text-center text-small text-fg-3">This PR isn’t tracked any more (closed, or never opened here), so there is no explanation to draw from.</div>
  if (!o) return <Missing prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} toast={toast} />
  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Story o={o} />
        {q.data?.stale && <p className="text-micro text-wait-text">Drawn for an earlier push: Explain catches it up.</p>}
        <MapCanvas o={o} />
      </div>
    </ReactFlowProvider>
  )
}

// --- Intent: the story as a flow -------------------------------------------------------------------------------

const Shapes = ({ shapes }: { shapes: Shape[] }) => (
  <span className="mt-1.5 flex flex-wrap gap-1">
    {shapes.map((x, i) => <span key={i} className={`rounded-full px-2 py-0.5 text-micro ${x.tone === 'ok' ? 'bg-ok/12 text-ok-text' : x.tone === 'bad' ? 'bg-fail/12 text-fail-text' : 'bg-fill text-fg-2'}`}>{x.label}</span>)}
  </span>
)
const Step = ({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) => (
  <div className={`rounded-card px-4 py-3 ${strong ? 'bg-[color-mix(in_oklch,var(--lane)_12%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--lane)_40%,transparent)]' : 'bg-surface-1 ring-1 ring-line'}`}>
    <p className={`label mb-1 ${strong ? 'text-[var(--lane)]' : 'text-fg-4'}`}>{label}</p>
    {children}
  </div>
)

export function IntentFlow({ prId, path, fork, toast }: { prId: string; path?: string; fork?: Extract<Diagram, { kind: 'fork' }>; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const q = useExplained(prId, path), o = q.data?.overlay, s = o?.tour?.story
  if (q.isLoading) return <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
  if (q.isError) return <div className="flex h-full items-center justify-center px-6 text-center text-small text-fg-3">This PR isn’t tracked any more (closed, or never opened here), so there is no explanation to draw from.</div>
  if (!o) return <Missing prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} toast={toast} />
  const Arrow = () => <ArrowRight className="size-4 self-center text-fg-4" aria-hidden />
  return (
    // the whole width, in rows that read left to right: why → what was decided; before → now; what to watch, and answers.
    // Padded inside its scroll, so a card's outline is never cut at the edge
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-1">
      <div className="grid shrink-0 grid-cols-[1fr_auto_1.3fr] items-stretch gap-2">
        <Step label="Why it was needed"><p className="text-small leading-relaxed text-fg-1">{s?.push ?? o.business.why}</p></Step>
        <Arrow />
        <Step label="What was decided" strong>
          <p className="text-small font-medium leading-relaxed text-fg-1">{fork?.chosen.label ?? s?.solution ?? o.business.what}</p>
          {(fork?.chosen.why ?? (fork ? undefined : s?.solution && o.business.what)) && <p className="mt-1 text-meta leading-snug text-fg-2">{fork?.chosen.why ?? o.business.what}</p>}
          {!!fork?.setAside.length && (
            <ul className="mt-2 space-y-1 border-t border-line pt-2">
              {fork.setAside.map((x, i) => <li key={i} className="flex items-start gap-1.5 text-meta"><X className="mt-0.5 size-3 shrink-0 text-fg-4" /><span><span className="text-fg-3 line-through decoration-fg-4/50">{x.label}</span> <span className="text-fg-4">· {x.why}</span></span></li>)}
            </ul>
          )}
        </Step>
      </div>
      {s ? (
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <Step label="Before"><p className="text-small leading-snug text-fg-2">{s.before.caption}</p><Shapes shapes={s.before.shapes} /></Step>
          <Arrow />
          <Step label="Now" strong><p className="text-small leading-snug text-fg-1">{s.after.caption}</p><Shapes shapes={s.after.shapes} /></Step>
        </div>
      ) : <Step label="Who it is for"><p className="text-small text-fg-2">{o.business.who}</p></Step>}
      {(!!fork?.open.length || o.business.risk !== 'low' || !!s?.questions.length) && (
        <div className="grid shrink-0 grid-cols-2 gap-3">
          <div className="space-y-1.5">
            {fork?.open.map((x, i) => <p key={i} className="flex items-center gap-1.5 text-small text-fg-2"><CircleDashed className="size-3.5 shrink-0 text-wait" />Open: {x}</p>)}
            {o.business.risk !== 'low' ? <p className="flex items-start gap-1.5 text-small text-fg-2"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${o.business.risk === 'high' ? 'bg-fail' : 'bg-wait'}`} />{o.business.risk} risk: {o.business.riskWhy}</p>
              : <p className="flex items-start gap-1.5 text-small text-fg-3"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-ok" />low risk{o.business.riskWhy ? `: ${o.business.riskWhy}` : ''}</p>}
          </div>
          {!!s?.questions.length && (
            <div className="space-y-0.5">
              <p className="label text-fg-4">Quick answers</p>
              {s.questions.slice(0, 4).map((x, i) => <details key={i} className="group rounded-ctl px-2 py-1 hover:bg-hover"><summary className="cursor-pointer list-none text-small font-medium text-fg-1"><Check className="mr-1.5 inline size-3 text-[var(--lane)]" />{x.q}</summary><p className="mt-1 pl-[18px] text-small text-fg-2">{x.a}</p></details>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
