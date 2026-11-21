// The Understanding and Intent cards, opened: the whole height of the chat, a picture of the change instead of text.
// Understanding: the parts of the system the PR touches (one box each, its changes counted and its new behaviour in a
// line), wired by how those parts call each other, laid out like Explain's map but flat. Intent: the PR's story as a
// flow (why it was needed → what was done → before against after), with what was set aside and what is still open.
// Both read the PR's explanation (Explain); without one they offer to write it.
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ElkBundled from 'elkjs/lib/elk.bundled.js'
import { ArrowDown, ArrowRight, Check, CircleDashed, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Diagram } from '../../server/discussions.ts'
import type { Overlay, Shape, Touched } from '../../server/explain.ts'
import { api, enc } from '../lib.ts'
import { useApi } from '../query.ts'

type Explained = { overlay?: Overlay; stale?: boolean; task?: { state: string } }
const ELK = ElkBundled as unknown as typeof ElkBundled.default
const elk = new ELK()

/** The PR's explanation, or a way to have it written. */
function useExplained(prId: string) {
  return useApi<Explained>(`/prs/${enc(prId)}/explain`, { staleTime: 60_000 })
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

// --- Understanding: the change map -----------------------------------------------------------------------------

type Area = { id: string; name: string; touched: Touched[]; impact: number }
type AreaData = { area: Area; on: boolean }
const KIND = { added: 'text-ok-text', modified: 'text-accent-text', removed: 'text-fail-text' } as const

function AreaNode({ data }: NodeProps<Node<AreaData>>) {
  const { area: a, on } = data
  const n = (k: Touched['change']) => a.touched.filter((t) => t.change === k).length
  return (
    <div className={`w-[230px] cursor-pointer rounded-card bg-surface-1 p-3 text-left transition-shadow duration-150 ${on ? 'shadow-[0_0_0_2px_var(--lane),var(--e2)]' : 'shadow-[var(--e1)] ring-1 ring-line hover:ring-line-strong'}`}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-fg-4" />
      <p className="truncate font-mono text-meta font-semibold text-fg-1" title={a.id}>{a.name}</p>
      <p className="mt-0.5 flex gap-2 text-micro tabular-nums">
        {n('added') > 0 && <span className={KIND.added}>+{n('added')} new</span>}
        {n('modified') > 0 && <span className={KIND.modified}>~{n('modified')} changed</span>}
        {n('removed') > 0 && <span className={KIND.removed}>−{n('removed')} gone</span>}
        {a.impact > 0 && <span className="text-wait-text">{a.impact} affected</span>}
      </p>
      {a.touched[0] && <p className="mt-1.5 line-clamp-2 text-small leading-snug text-fg-2">{a.touched[0].after}</p>}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-fg-4" />
    </div>
  )
}
const nodeTypes = { area: AreaNode }

/** Each touched path into the system root it lives under (the longest one), else its first two folders. */
function areasOf(o: Overlay): Area[] {
  const roots = [...o.facts.roots].sort((a, b) => b.length - a.length)
  const rootOf = (p: string) => roots.find((r) => p === r || p.startsWith(`${r}/`)) ?? p.split('/').slice(0, Math.min(2, p.split('/').length - 1) || 1).join('/')
  const by = new Map<string, Area>()
  for (const t of o.touched) { const id = rootOf(t.path); const a = by.get(id) ?? { id, name: id.split('/').slice(-2).join('/'), touched: [], impact: 0 }; a.touched.push(t); by.set(id, a) }
  for (const i of o.impact) { const a = by.get(rootOf(i.path)); if (a) a.impact++ }
  return [...by.values()].sort((a, b) => b.touched.length - a.touched.length).slice(0, 12)
}

function Story({ o }: { o: Overlay }) {
  const s = o.tour?.story, f = o.flows[0]
  const before = s?.before.caption ?? f?.before, after = s?.after.caption ?? f?.after
  return (
    <div className="shrink-0 space-y-2">
      <p className="text-reading font-semibold leading-snug text-fg-1">{o.business.headline}</p>
      {(before || after) && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 text-small">
          <div className="rounded-ctl bg-fill px-3 py-2"><p className="label mb-0.5 text-fg-4">Before</p><p className="leading-snug text-fg-2">{before ?? '—'}</p></div>
          <ArrowRight className="size-4 self-center text-fg-4" />
          <div className="rounded-ctl bg-[color-mix(in_oklch,var(--lane)_12%,transparent)] px-3 py-2 ring-1 ring-[color-mix(in_oklch,var(--lane)_35%,transparent)]"><p className="label mb-0.5 text-[var(--lane)]">Now</p><p className="leading-snug text-fg-1">{after ?? '—'}</p></div>
        </div>
      )}
    </div>
  )
}

function MapCanvas({ o }: { o: Overlay }) {
  const areas = useMemo(() => areasOf(o), [o])
  const links = useMemo(() => {
    const ids = new Set(areas.map((a) => a.id))
    const root = (p: string) => areas.find((a) => p === a.id || p.startsWith(`${a.id}/`))?.id
    const seen = new Set<string>()
    return o.facts.systemEdges.flatMap((e) => { const a = root(e.from), b = root(e.to); const k = `${a}>${b}`; return a && b && a !== b && ids.has(a) && ids.has(b) && !seen.has(k) && seen.add(k) ? [{ from: a, to: b, count: e.count }] : [] })
  }, [areas, o])
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>()
  const [on, setOn] = useState<string>()
  useEffect(() => {
    let live = true
    void elk.layout({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '64', 'elk.separateConnectedComponents': 'true', 'elk.spacing.componentComponent': '28', 'elk.aspectRatio': '1.3' },
      children: areas.map((a) => ({ id: a.id, width: 230, height: 104 })), edges: links.map((l) => ({ id: `${l.from}>${l.to}`, sources: [l.from], targets: [l.to] })) })
      .then((g) => { if (live) setPos(new Map((g.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))) })
    return () => { live = false }
  }, [areas, links])
  const nodes: Node<AreaData>[] = areas.map((a) => ({ id: a.id, type: 'area', position: pos?.get(a.id) ?? { x: 0, y: 0 }, data: { area: a, on: a.id === on }, draggable: false }))
  const edges: Edge[] = links.map((l) => ({ id: `${l.from}>${l.to}`, source: l.from, target: l.to, type: 'smoothstep', style: { stroke: 'var(--line-strong)', strokeWidth: Math.min(3, 1 + l.count / 4) }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--line-strong)' } }))
  const sel = areas.find((a) => a.id === on)
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className={`relative min-h-0 flex-1 overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line transition-opacity duration-200 ${pos ? 'opacity-100' : 'opacity-0'}`}>
        {pos && (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.3} maxZoom={1.5}
                     nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => setOn(on === n.id ? undefined : n.id)} onPaneClick={() => setOn(undefined)}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
          </ReactFlow>
        )}
        {!sel && <p className="pointer-events-none absolute bottom-2 left-3 text-micro text-fg-4">Click a part for what changed in it</p>}
      </div>
      {sel && (
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-card bg-surface-1 ring-1 ring-line">
          <p className="flex items-center gap-2 border-b border-line px-3 py-2 font-mono text-meta font-semibold text-fg-1"><span className="min-w-0 flex-1 truncate" title={sel.id}>{sel.id}</span>
            <button onClick={() => setOn(undefined)} aria-label="Close" className="text-fg-4 hover:text-fg-1"><X className="size-3.5" /></button></p>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
            {sel.touched.map((t) => (
              <li key={t.path} className="space-y-1 px-3 py-2">
                <p className="flex items-center gap-1.5 font-mono text-micro"><span className={KIND[t.change]}>{t.change === 'added' ? '+' : t.change === 'removed' ? '−' : '~'}</span><span className="truncate text-fg-2" title={t.path}>{t.path.split('/').pop()}</span></p>
                {t.before && <p className="text-meta leading-snug text-fg-4 line-through decoration-fg-4/40">{t.before}</p>}
                <p className="text-small leading-snug text-fg-1">{t.after}</p>
                {t.why && <p className="text-meta leading-snug text-fg-3">{t.why}</p>}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}

export function UnderstandingMap({ prId, toast }: { prId: string; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const q = useExplained(prId), o = q.data?.overlay
  if (q.isLoading) return <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
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
const Down = () => <ArrowDown className="mx-auto my-1 size-4 text-fg-4" aria-hidden />

export function IntentFlow({ prId, fork, toast }: { prId: string; fork?: Extract<Diagram, { kind: 'fork' }>; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const q = useExplained(prId), o = q.data?.overlay, s = o?.tour?.story
  if (q.isLoading) return <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
  if (!o) return <Missing prId={prId} busy={q.data?.task?.state === 'running' || q.data?.task?.state === 'queued'} toast={toast} />
  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto pr-1">
      <Step label="Why it was needed"><p className="text-body leading-relaxed text-fg-1">{s?.push ?? o.business.why}</p></Step>
      <Down />
      <Step label="What was decided" strong>
        <p className="text-body font-medium leading-relaxed text-fg-1">{fork?.chosen.label ?? s?.solution ?? o.business.what}</p>
        {(fork?.chosen.why ?? (fork ? undefined : s?.solution && o.business.what)) && <p className="mt-1 text-small leading-snug text-fg-2">{fork?.chosen.why ?? o.business.what}</p>}
        {!!fork?.setAside.length && (
          <ul className="mt-2.5 space-y-1 border-t border-line pt-2">
            {fork.setAside.map((x, i) => <li key={i} className="flex items-start gap-1.5 text-small"><X className="mt-0.5 size-3.5 shrink-0 text-fg-4" /><span><span className="text-fg-3 line-through decoration-fg-4/50">{x.label}</span> <span className="text-fg-4">· {x.why}</span></span></li>)}
          </ul>
        )}
      </Step>
      <Down />
      {s ? (
        <div className="grid grid-cols-2 gap-2">
          <Step label="Before"><p className="text-small leading-snug text-fg-2">{s.before.caption}</p><Shapes shapes={s.before.shapes} /></Step>
          <Step label="Now" strong><p className="text-small leading-snug text-fg-1">{s.after.caption}</p><Shapes shapes={s.after.shapes} /></Step>
        </div>
      ) : <Step label="Who it is for"><p className="text-small text-fg-2">{o.business.who}</p></Step>}
      {(!!fork?.open.length || o.business.risk !== 'low') && (
        <div className="mt-3 space-y-1.5">
          {fork?.open.map((x, i) => <p key={i} className="flex items-center gap-1.5 text-small text-fg-2"><CircleDashed className="size-3.5 shrink-0 text-wait" />Open: {x}</p>)}
          {o.business.risk !== 'low' && <p className="flex items-start gap-1.5 text-small text-fg-2"><span className={`mt-1 size-2 shrink-0 rounded-full ${o.business.risk === 'high' ? 'bg-fail' : 'bg-wait'}`} />{o.business.risk} risk: {o.business.riskWhy}</p>}
        </div>
      )}
      {!!s?.questions.length && (
        <div className="mt-4 space-y-1">
          <p className="label text-fg-4">Quick answers</p>
          {s.questions.slice(0, 4).map((x, i) => <details key={i} className="group rounded-ctl px-2 py-1 hover:bg-hover"><summary className="cursor-pointer list-none text-small font-medium text-fg-1"><Check className="mr-1.5 inline size-3 text-[var(--lane)]" />{x.q}</summary><p className="mt-1 pl-[18px] text-small text-fg-2">{x.a}</p></details>)}
        </div>
      )}
    </div>
  )
}
