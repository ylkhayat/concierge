// The Understanding and Intent cards, opened: the whole height of the chat, a picture of the change instead of text.
// Understanding is the solution (what the change is, purpose down to code); Intent is how it was fixed.
// Understanding: the parts of the system the PR touches (one box each, its changes counted and its new behaviour in a
// line), wired by how those parts call each other, laid out like Explain's map but flat. Intent: the PR's story as a
// flow (why it was needed → what was done → before against after), with what was set aside and what is still open.
// Both read the PR's explanation (Explain); without one they offer to write it.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { elk } from '../elk.ts'
import { ArrowRight, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Diagram } from '../../server/discussions.ts'
import type { Overlay, Touched } from '../../server/explain.ts'
import { api, enc } from '../lib.ts'
import { stepsOf } from './flowSteps.ts'
import { Glossary, LaneBoard, LevelsBoard, STORY_ICONS, type Lane } from './LevelsBoard.tsx'
import { SearchCheck as ListChecksIcon } from 'lucide-react'
import { keepSame, useApi } from '../query.ts'

type Explained = { overlay?: Overlay; stale?: boolean; task?: { state: string } }

/** The PR's explanation, or a way to have it written. */
function useExplained(prId: string, path?: string) {
  // the same read as Explain and Overview (explainPath), so the picture opens at once when they already have it
  return useApi<Explained>(path ?? `/prs/${enc(prId)}/explain`, { staleTime: 60_000, placeholderData: keepSame(`/prs/${enc(prId)}/explain`) })
}

// opening the card is asking for it: the explanation starts by itself (once per PR on this page), no second click
const started = new Set<string>()
function Missing({ prId, busy, toast }: { prId: string; busy: boolean; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [asked, setAsked] = useState(busy || started.has(prId))
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    if (busy || started.has(prId)) return
    started.add(prId); setAsked(true)
    api(`/prs/${enc(prId)}/explain`, {}).catch((e: Error) => { started.delete(prId); setAsked(false); setFailed(e.message) })
  }, [prId, busy])
  const working = busy || asked
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-10 items-center justify-center rounded-card bg-accent-soft"><Sparkles className="size-5 text-accent-text" /></span>
      <p className="max-w-sm text-small text-fg-2">{working ? 'Explaining the change: the picture appears here when it is ready.' : failed ?? 'This picture is drawn from the PR’s explanation, which isn’t written yet.'}</p>
      {working ? <LoaderCircle className="size-4 animate-spin text-fg-3" />
        : <button onClick={() => api(`/prs/${enc(prId)}/explain`, {}).then(() => { started.add(prId); setAsked(true); toast('Explaining the change') }, (e: Error) => toast(e.message, 'error'))} className="btn-primary btn-sm">Try again</button>}
    </div>
  )
}

/** Explained before the levels existed: asked for once (only the levels are written), the old map shown meanwhile. */
function Leveling({ prId, busy }: { prId: string; busy: boolean }) {
  useEffect(() => { if (busy || started.has(`lv:${prId}`)) return; started.add(`lv:${prId}`); api(`/prs/${enc(prId)}/explain`, {}).catch(() => started.delete(`lv:${prId}`)) }, [prId, busy])
  return <p className="flex items-center gap-1.5 text-micro text-fg-3"><LoaderCircle className="size-3 animate-spin" />Rewriting it for someone new to it, from what this is at all down to the code: it updates by itself.</p>
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
const heightOf = (n: MNode) => n.kind === 'root' ? 120 : n.plain ? 120 : 58 + (n.line ? 34 : 0) + Math.min(ROWS, n.kind === 'flows' ? n.flows!.length : n.touched.length) * (n.kind === 'flows' ? 64 : 46) + ((n.kind === 'area' && n.touched.length > ROWS) ? 22 : 0)

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
      <p className="text-small font-semibold leading-snug text-fg-1">{words(n.title)}</p>
      {n.line && <p className="mt-1 line-clamp-3 text-meta leading-snug text-fg-2">{words(n.line)}</p>}
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
            <span className="mt-0.5 block"><Chain steps={stepsOf(f.after).slice(0, 4)} />{stepsOf(f.after).length > 4 && <span className="ml-1 text-micro text-fg-4">+{stepsOf(f.after).length - 4} more</span>}</span>
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
/** A flow's steps as pills with arrows between them, wrapping onto more lines. */
const Chain = ({ steps, faded }: { steps: string[]; faded?: boolean }) => (
  <span className={`flex flex-wrap items-center gap-1 ${faded ? 'opacity-60' : ''}`}>
    {steps.map((x, i) => <span key={i} className="contents">{i > 0 && <ArrowRight className="size-3 shrink-0 text-fg-4" aria-hidden />}<span className="rounded-full bg-fill px-2 py-0.5 text-micro text-fg-1">{x}</span></span>)}
  </span>
)
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
                {f.before && <><p className="label text-fg-4">Before</p><Chain steps={stepsOf(f.before)} faded /></>}
                <p className="label pt-1 text-fg-4">{f.before ? 'Now' : 'How it goes'}</p><Chain steps={stepsOf(f.after)} />
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
        {q.data?.stale && <p className="text-micro text-wait-text">Drawn for an earlier push: Explain catches it up.</p>}
        {o.levels ? <>{(o.levels.v ?? 0) < 3 && <Leveling prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} />}<LevelsBoard prId={prId} levels={o.levels} /></> : <><Story o={o} /><Leveling prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} /><MapCanvas o={o} /></>}
      </div>
    </ReactFlowProvider>
  )
}

// --- Intent: the story as a flow -------------------------------------------------------------------------------

export function IntentFlow({ prId, path, fork, toast }: { prId: string; path?: string; fork?: Extract<Diagram, { kind: 'fork' }>; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const q = useExplained(prId, path), o = q.data?.overlay, s = o?.tour?.story
  if (q.isLoading) return <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
  if (q.isError) return <div className="flex h-full items-center justify-center px-6 text-center text-small text-fg-3">This PR isn’t tracked any more (closed, or never opened here), so there is no explanation to draw from.</div>
  if (!o) return <Missing prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} toast={toast} />
  // the reviewer's guide (levels v2): what it promises, how and why this way, what must be true for it to be right, each
  // wired to where in the diff to check it, and its risks. An explanation from before keeps the story board below
  const r = o.levels?.review
  if (r) {
    const repo = prId.split('#')[0]
    const at = (path: string, lines?: string) => { const [a, b] = (lines ?? '').split(/[-–]/).map((x) => Number(x.trim())); return `https://github.com/${repo}/blob/${o.headSha}/${path}${a ? `#L${a}${b ? `-L${b}` : ''}` : ''}` }
    const risk = (l: string) => (l === 'high' ? 'bad' as const : l === 'medium' ? 'wait' as const : 'ok' as const)
    const lanes: Lane[] = [
      { id: 'claim', label: 'Claim', hint: 'what this PR promises', icon: STORY_ICONS.why, cards: [{ id: 'claim', title: 'What it promises', line: r.claim, tone: 'strong' }] },
      { id: 'approach', label: 'Approach', hint: 'how, and why this way over the others', icon: STORY_ICONS.decided, cards: [
        { id: 'approach', title: 'How it does it', line: r.approach, why: r.why, tone: 'strong' },
        ...r.alternatives.map((x, i) => ({ id: `alt:${i}`, title: x.label, line: x.why, tone: 'faded' as const })),
      ] },
      { id: 'assume', label: 'Must be true', hint: 'what it relies on to be right', icon: STORY_ICONS.change, cards: r.assumptions.map((x) => ({ id: `as:${x.id}`, title: x.text })) },
      { id: 'check', label: 'Check here', hint: 'the lines that prove each one', icon: ListChecksIcon, cards: r.assumptions.map((x) => ({ id: `ck:${x.id}`, title: x.look, line: `${x.path.split('/').pop()}${x.lines ? `, lines ${x.lines}` : ''}`, why: x.path, href: at(x.path, x.lines) })) }, // titled by what to verify: in a one-file PR every file name is the same
      { id: 'risks', label: 'Risks', hint: 'what could still go wrong', icon: STORY_ICONS.watch, skip: true, cards: r.risks.map((x, i) => ({ id: `rk:${i}`, title: `${x.level[0].toUpperCase()}${x.level.slice(1)} risk`, line: x.text, tone: risk(x.level) })) },
    ]
    const links: [string, string][] = [['claim', 'approach'], ...r.assumptions.map((x) => [`as:${x.id}`, `ck:${x.id}`] as [string, string])]
    return <ReactFlowProvider><Glossary.Provider value={o.levels?.glossary ?? []}><div className="flex h-full min-h-0 flex-col"><LaneBoard prId={prId} board="intent" lanes={lanes} links={links} /></div></Glossary.Provider></ReactFlowProvider>
  }
  // the same board as Understanding: lanes read top to bottom as the story (why → what was decided → before and now
  // → what to watch → quick answers), the map's cards in them
  // Intent is how it was fixed (Understanding is the solution itself): the problem, the approach taken over the ones set
  // aside, what is true once fixed, and what to watch. Read top to bottom, wired problem → approach → result
  const lanes: Lane[] = [
    { id: 'problem', label: 'Problem', hint: 'what was going wrong, and for whom', icon: STORY_ICONS.why, cards: [
      { id: 'problem', title: s?.ticket ? `The problem (${s.ticket})` : 'The problem', line: fork?.problem || s?.push || o.business.why, story: o.cards?.problem },
      ...(s ? [{ id: 'before', title: 'What people saw', line: s.before.caption, more: s.before.shapes.map((x) => x.label), story: o.cards?.before }] : []),
    ] },
    { id: 'approach', label: 'Approach', hint: 'how it is fixed, and what was set aside', icon: STORY_ICONS.decided, cards: [
      { id: 'approach', title: fork?.chosen.label ?? 'How it is fixed', line: fork ? fork.chosen.why : s?.solution ?? o.business.what, why: fork ? undefined : s?.solution && o.business.what, tone: 'strong', story: fork ? fork.chosen.story : o.cards?.approach },
      ...(fork?.setAside ?? []).map((x, i) => ({ id: `aside:${i}`, title: x.label, line: x.why, tone: 'faded' as const, story: x.story })),
    ] },
    { id: 'result', label: 'Result', hint: s ? 'what is true once it is fixed' : 'who it is for', icon: STORY_ICONS.change, cards: s
      ? [{ id: 'now', title: 'Once fixed', line: s.after.caption, more: s.after.shapes.map((x) => x.label), tone: 'strong', story: o.cards?.result }]
      : [{ id: 'who', title: 'Who it is for', line: o.business.who, story: o.cards?.result }] },
    { id: 'watch', label: 'To watch', hint: 'its risk, and what is still open', icon: STORY_ICONS.watch, cards: [
      { id: 'risk', title: `${o.business.risk[0].toUpperCase()}${o.business.risk.slice(1)} risk`, line: o.business.riskWhy, story: o.cards?.risk, tone: o.business.risk === 'high' ? 'bad' : o.business.risk === 'medium' ? 'wait' : 'ok' },
      ...(fork?.open ?? []).map((x, i) => ({ id: `open:${i}`, title: 'Still open', line: x, tone: 'wait' as const })),
    ] },
    { id: 'answers', label: 'Quick answers', hint: 'what a reviewer asks first', icon: STORY_ICONS.answers, skip: true, cards: (s?.questions ?? []).slice(0, 4).map((x, i) => ({ id: `q:${i}`, title: x.q, line: x.a })) },
  ]
  return <ReactFlowProvider><div className="flex h-full min-h-0 flex-col gap-2"><Leveling prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} /><LaneBoard prId={prId} board="intent" lanes={lanes} links={[['problem', 'approach'], ['approach', s ? 'now' : 'who'], ['before', 'now']]} /></div></ReactFlowProvider>
}
