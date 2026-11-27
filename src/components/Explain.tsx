import { Tour } from './Tour.tsx'
import { Norms } from './Norms.tsx'
import {
  Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { elk } from '../elk.ts'
import {
  AppWindow, ArrowUpRight, Boxes, Briefcase, ChevronRight, Compass, Cloud, Cpu, FileCode, Folder, GitCommitVertical, Globe,
  LoaderCircle, Maximize2, Minimize2, Eye, EyeOff, Package, RefreshCw, Route, Server, ShieldAlert, Sparkles, TriangleAlert, UserRound,
  Workflow, X, ZoomIn, Map as MapIcon, Check, Radio, type LucideIcon, Scale,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Facts, Mark, Overlay, Skeleton, System } from '../../server/explain.ts'
import { useApi, explainPath, keepSame } from '../query.ts'
import { param, setParam, api, enc, flowControls, isTyping, useIsDark, type PrView, calm } from '../lib.ts'

type NodeInfo = { summary: string; responsibilities: string[]; businessRole?: string }
type Data = { task?: PrView['explain']; overlay?: Overlay; skeleton?: Skeleton; nodes: Record<string, NodeInfo>; stale: boolean }
export type Card = {
  id: string
  kind: 'actor' | 'system' | 'dir' | 'file' | 'more'
  icon: LucideIcon
  name: string
  sub?: string
  summary?: string
  mark?: Mark
  impacted?: boolean
  path?: string
  expandPath?: string // the folder whose modules appear inside this box when it opens
  expanded?: boolean
  code?: boolean // a changed file: has a before/after view
  more?: number // the "+N other modules" box
  plain?: boolean // a neutral box (codebase view): full strength, no change styling
  unmapped?: boolean // the codebase map has no summary for it yet
  files?: number
  inner?: { name: string; count: number; mark: Mark }[] // the changed modules inside, previewed in the box
  innerMore?: number
  [k: string]: unknown
}

export const SYSTEM_ICON: Record<string, LucideIcon> = { app: AppWindow, service: Server, library: Package, infra: Cloud, external: Globe }
const W = 236, H = 100 // H fits a two-line title (name + path) and a two-line summary
// must match CardNode's real layout, or content spills out of the box: base card, then the "Inside" block
const heightOf = (c: Card) => (c.inner?.length ? H + 36 + c.inner.length * 24 : H)

/** The modules inside `root` that this PR changed: changed files grouped by their folder, busiest first. */
function innerOf(root: string, f: Facts): Pick<Card, 'inner' | 'innerMore'> {
  const groups = new Map<string, { count: number; marks: Set<string> }>()
  for (const c of f.changes) {
    if (!under(c.path, root) || c.path === root) continue
    const rel = c.path.slice(root ? root.length + 1 : 0)
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : rel
    const g = groups.get(dir) ?? { count: 0, marks: new Set() }
    g.count++; g.marks.add(c.status); groups.set(dir, g)
  }
  const all = [...groups].sort((a, b) => b[1].count - a[1].count)
    .map(([dir, g]) => ({
      // the path from this box down, trimmed from the left so the distinctive end stays readable
      name: dir.length > 30 ? `…${dir.slice(-29)}` : dir,
      count: g.count, mark: (g.marks.size > 1 ? 'modified' : [...g.marks][0]) as Mark,
    }))
  return all.length ? { inner: all.slice(0, 4), innerMore: Math.max(0, all.length - 4) } : {}
}


// --- data → boxes ---------------------------------------------------------------------------

const under = (p: string, root: string) => p === root || p.startsWith(root + '/')

function systemsOf(d: Data): (System & { synthetic?: boolean })[] {
  const sk = d.skeleton?.systems ?? []
  const roots = d.overlay?.facts.roots ?? []
  // touched roots the skeleton does not cover yet still deserve a box
  const extra = roots.filter((r) => !sk.some((s) => s.paths.some((p) => under(r, p) || under(p, r))))
    .map((r) => ({ id: r, name: r.split('/').pop() || r || 'root', kind: 'app', paths: [r], summary: d.nodes[r]?.summary ?? '', synthetic: true }))
  return [...sk, ...extra]
}

function markOf(paths: string[], f: Facts | undefined): { mark?: Mark; impacted?: boolean } {
  if (!f) return {}
  const touched = f.changes.some((c) => paths.some((p) => under(c.path, p)))
  const impacted = f.dependents.some((dep) => paths.some((p) => under(dep.path, p)))
  return { mark: touched ? 'contains' : undefined, impacted: !touched && impacted ? true : undefined }
}

/** Best place to land when drilling into a system: the view the PR actually touches. */

export type Link = { from: string; to: string; label?: string; weight: number }
export type TNode = { card: Card; kids?: TNode[]; links?: Link[] }

/** The folder to open when a system box expands: the one the PR actually touches. */
function entryPath(s: System, f: Facts | undefined): string | undefined {
  if (!f) return undefined
  const views = Object.keys(f.views)
  for (const p of s.paths) {
    const inside = views.filter((v) => under(v, p)).sort((a, b) => a.length - b.length)[0]
    if (inside !== undefined) return inside
  }
  return undefined
}

export function systemLinks(d: Data, systems: System[]) {
  const f = d.overlay?.facts
  const sysOfPath = (p: string) => systems.filter((s) => s.paths.some((sp) => under(p, sp))).sort((a, b) => Math.max(...b.paths.map((x) => x.length)) - Math.max(...a.paths.map((x) => x.length)))[0]
  const links = new Map<string, Link>()
  for (const e of d.skeleton?.edges ?? []) links.set(`${e.from}>${e.to}`, { from: e.from, to: e.to, label: e.label, weight: 2 })
  for (const e of f?.systemEdges ?? []) {
    const a = sysOfPath(e.from)?.id, b = sysOfPath(e.to)?.id
    if (!a || !b || a === b) continue
    const k = `${a}>${b}`
    links.set(k, { from: a, to: b, label: links.get(k)?.label ?? `${e.count} import${e.count === 1 ? '' : 's'}`, weight: (links.get(k)?.weight ?? 0) + e.count })
  }
  return [...links.values()]
}

/** Business perspective: people and the parts of the product this PR touches, in business words. */
function businessGraph(d: Data): { cards: Card[]; links: Link[] } {
  const f = d.overlay?.facts
  const systems = systemsOf(d)
  const sysCards: Card[] = systems.map((s) => ({
    id: s.id, kind: 'system', icon: SYSTEM_ICON[s.kind] ?? Boxes, name: s.name, summary: s.businessRole || s.summary,
    ...markOf(s.paths, f), path: s.paths[0], expandPath: entryPath(s, f),
  }))
  const actors: Card[] = (d.skeleton?.actors ?? []).map((a) => ({ id: a.id, kind: 'actor', icon: UserRound, name: a.name, summary: a.description }))
  const hot = sysCards.filter((c) => c.mark || c.impacted)
  const ids = new Set([...actors, ...hot].map((c) => c.id))
  const links = systemLinks(d, systems).filter((l) => ids.has(l.from) && ids.has(l.to))
  const linked = actors.filter((a) => links.some((l) => l.from === a.id || l.to === a.id))
  return { cards: [...(linked.length ? linked : actors.slice(0, 3)), ...hot], links }
}

/**
 * Technical perspective as a tree of boxes. An open box holds its modules; only what matters is drawn:
 * changed and impacted modules, plus the ones wired straight to them. The rest fold into one "+N" box.
 */
function techTree(d: Data, open: Set<string>, allFiles: boolean): { roots: TNode[]; links: Link[]; parent: Map<string, string> } {
  const f = d.overlay!.facts
  const parent = new Map<string, string>()
  const touched = new Map(d.overlay!.touched.map((t) => [t.path, t]))

  const impactWhy = (p: string) => d.overlay!.impact.find((i) => i.path === p)?.reason
    ?? (f.dependents.some((x) => x.path === p) ? `Imports ${f.dependents.filter((x) => x.path === p).map((x) => x.imports.split('/').pop()).join(', ')}` : undefined)
  const kidsOf = (owner: string, path: string): { kids: TNode[]; links: Link[] } => {
    const view = f.views[path]
    if (!view) return { kids: [], links: [] }
    const edges = f.edges[path] ?? []
    // changed modules first (busiest first), capped; then only the few context modules most wired to them
    const changesIn = (p: string) => f.changes.filter((ch) => under(ch.path, p)).length
    // tests import everything, so an unchanged test folder being "impacted" says nothing
    const isTest = (c: { name: string }) => /^(tests?|__tests__|specs?|e2e|__mocks__|mocks)$/i.test(c.name)
    const changed = view.children.filter((c) => c.touched).sort((a, b) => changesIn(b.path) - changesIn(a.path))
    const impacted = view.children.filter((c) => !c.touched && c.impacted && !isTest(c))
    const hotAll = [...changed, ...impacted]
    const hotShown = [...changed.slice(0, MAX_CHANGED), ...impacted.slice(0, MAX_IMPACTED)]
    const touchedIds = new Set(changed.map((c) => c.path))
    const hot = new Set(hotShown.map((c) => c.path))
    const weight = new Map<string, number>()
    for (const e of edges) {
      if (hot.has(e.from) && !hot.has(e.to)) weight.set(e.to, (weight.get(e.to) ?? 0) + e.count)
      if (hot.has(e.to) && !hot.has(e.from)) weight.set(e.from, (weight.get(e.from) ?? 0) + e.count)
    }
    const name = (p: string) => p.slice(path ? path.length + 1 : 0)
    const context = new Set([...weight].filter(([p]) => !isTest({ name: name(p) })).sort((a, b) => b[1] - a[1]).slice(0, MAX_CONTEXT).map(([p]) => p))
    const shown = view.children.filter((c) => hot.has(c.path) || (c.type === 'dir' && context.has(c.path)) || (allFiles && c.type === 'file'))
    const kids: TNode[] = shown.map((c) => {
      const key = c.drill ?? c.path
      const canOpen = c.type === 'dir' && !!f.views[key]
      const isOpen = canOpen && open.has(c.path)
      parent.set(c.path, owner)
      const card: Card = {
        id: c.path, kind: c.type, icon: c.type === 'dir' ? Folder : FileCode,
        name: c.drill ? c.drill.slice(path ? path.length + 1 : 0) : c.name,
        summary: touched.get(c.path)?.after ?? d.nodes[key]?.summary ?? d.nodes[c.path]?.summary ?? impactWhy(c.path),
        mark: c.touched, impacted: c.impacted, path: key,
        expandPath: canOpen ? key : undefined, expanded: isOpen,
        code: c.type === 'file' && touched.has(c.path),
        ...(c.type === 'dir' && c.touched && !isOpen ? innerOf(key, f) : {}),
      }
      return isOpen ? { card, ...kidsOf(c.path, key) } : { card }
    })
    const rest = view.children.length - shown.length + view.more
    if (rest > 0) {
      const id = `${path}#more`
      const changedHidden = hotAll.length - hotShown.length
      parent.set(id, owner)
      kids.push({ card: { id, kind: 'more', icon: Boxes, name: `${rest} more`, summary: changedHidden ? `${changedHidden} of them changed` : 'Unchanged', more: rest } })
    }
    const ids = new Set(kids.map((k) => k.card.id))
    // only edges with a changed end, strongest first; everything else is wiring noise at this zoom
    const links = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (touchedIds.has(e.from) || touchedIds.has(e.to)))
      .sort((a, b) => b.count - a.count).slice(0, MAX_EDGES)
      .map((e) => ({ from: e.from, to: e.to, label: e.count > 1 ? String(e.count) : undefined, weight: e.count }))
    return { kids, links }
  }

  const systems = systemsOf(d)
  const all = systemLinks(d, systems)
  const cards = systems.map((s): TNode => {
    const ep = entryPath(s, f)
    const isOpen = !!ep && open.has(s.id)
    const card: Card = {
      id: s.id, kind: 'system', icon: SYSTEM_ICON[s.kind] ?? Boxes, name: s.name, sub: s.paths.join(' · '), summary: s.summary,
      ...markOf(s.paths, f), path: s.paths[0], expandPath: ep, expanded: isOpen,
      ...(!isOpen ? s.paths.map((p) => innerOf(p, f)).find((x) => x.inner) : {}),
    }
    return isOpen ? { card, ...kidsOf(s.id, ep!) } : { card }
  })
  // systems: the changed and impacted ones, plus the few neighbours most wired to them
  const hot = new Set(cards.filter((c) => c.card.mark || c.card.impacted).map((c) => c.card.id))
  const weight = new Map<string, number>()
  for (const l of all) {
    if (hot.has(l.from) && !hot.has(l.to)) weight.set(l.to, (weight.get(l.to) ?? 0) + l.weight)
    if (hot.has(l.to) && !hot.has(l.from)) weight.set(l.from, (weight.get(l.from) ?? 0) + l.weight)
  }
  const keep = new Set([...hot, ...[...weight].sort((a, b) => b[1] - a[1]).slice(0, MAX_CONTEXT).map(([id]) => id)])
  const roots = cards.filter((c) => keep.has(c.card.id))
  return { roots, links: all.filter((l) => keep.has(l.from) && keep.has(l.to) && (hot.has(l.from) || hot.has(l.to))), parent }
}

// --- layout ---------------------------------------------------------------------------------

const SPACING = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '44', 'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '14', 'elk.layered.spacing.edgeNodeBetweenLayers': '28',
  'elk.separateConnectedComponents': 'true', 'elk.spacing.componentComponent': '56', 'elk.aspectRatio': '1.6',
  'elk.edgeLabels.placement': 'CENTER', 'elk.spacing.edgeLabel': '6',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
}
const HEADER = 58 // room for an open box's title bar
// per open box: what is shown before the rest folds into "+N more"
const MAX_CHANGED = 6
const MAX_IMPACTED = 3
const MAX_CONTEXT = 2 // unchanged neighbours, the most wired to the change
const MAX_EDGES = 10

type ElkIn = { id: string; width?: number; height?: number; layoutOptions?: Record<string, string>; children?: ElkIn[]; edges?: { id: string; sources: string[]; targets: string[] }[] }
type Pt = { x: number; y: number }
type ElkOut = {
  id: string; x?: number; y?: number; width?: number; height?: number; children?: ElkOut[]
  edges?: { id: string; sections?: { startPoint: Pt; endPoint: Pt; bendPoints?: Pt[] }[]; labels?: { x?: number; y?: number; width?: number; height?: number }[] }[]
}

type Route = { points: Pt[]; label?: { x: number; y: number; w: number } }
export async function layoutTree(roots: TNode[], links: Link[]): Promise<{ nodes: Node<Card>[]; edges: Link[]; routes: Map<string, Route> }> {
  const byId = new Map<string, TNode>()
  const allLinks: Link[] = [...links]
  // labels are sized up front so ELK leaves room for them between boxes and places them itself
  const labelWidth = (t: string) => Math.min(170, t.length * 6.2 + 12)
  const edgesOf = (ls: Link[], ids: Set<string>) => ls.filter((l) => ids.has(l.from) && ids.has(l.to)).map((l) => ({
    id: `${l.from}>${l.to}`, sources: [l.from], targets: [l.to],
    ...(l.label && { labels: [{ text: l.label, width: labelWidth(l.label), height: 16 }] }),
  }))
  const toElk = (t: TNode): ElkIn => {
    byId.set(t.card.id, t)
    if (!t.kids) return { id: t.card.id, width: W, height: t.card.kind === 'more' ? 52 : heightOf(t.card) }
    allLinks.push(...(t.links ?? []))
    return {
      id: t.card.id,
      layoutOptions: { ...SPACING, 'elk.padding': `[top=${HEADER},left=20,bottom=20,right=20]` },
      children: t.kids.map(toElk),
      edges: edgesOf(t.links ?? [], new Set(t.kids.map((k) => k.card.id))),
    }
  }
  const g = await elk.layout({
    // SEPARATE_CHILDREN: every open box is laid out on its own, so no edge is routed across a box border
    id: 'root', layoutOptions: { ...SPACING, 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' },
    children: roots.map(toElk), edges: edgesOf(links, new Set(roots.map((r) => r.card.id))),
  } as never) as unknown as ElkOut
  const nodes: Node<Card>[] = []
  // ELK routes each edge around the boxes; keep its points (in absolute coordinates) so we draw exactly that
  const routes = new Map<string, Route>()
  const collect = (owner: ElkOut, ox: number, oy: number) => {
    for (const e of owner.edges ?? []) {
      const sec = e.sections?.[0], lb = e.labels?.[0]
      if (sec) routes.set(e.id, {
        points: [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((q) => ({ x: q.x + ox, y: q.y + oy })),
        ...(lb?.x != null && { label: { x: lb.x + ox + (lb.width ?? 0) / 2, y: lb.y! + oy + (lb.height ?? 0) / 2, w: lb.width ?? 120 } }),
      })
    }
    for (const c of owner.children ?? []) if (c.children?.length) collect(c, ox + (c.x ?? 0), oy + (c.y ?? 0))
  }
  collect(g, 0, 0)
  const walk = (n: ElkOut, parentId?: string) => {
    const t = byId.get(n.id)!
    // render exactly the size ELK planned for, so nothing overlaps
    nodes.push({
      id: n.id, type: t.kids ? 'box' : t.card.kind === 'more' ? 'more' : 'card', position: { x: n.x ?? 0, y: n.y ?? 0 }, data: t.card,
      ...(parentId && { parentId }), style: { width: n.width, height: n.height },
      selectable: true, ...(t.kids && { zIndex: 0 }),
    })
    for (const c of n.children ?? []) walk(c, n.id)
  }
  for (const c of g.children ?? []) walk(c)
  return { nodes, edges: allLinks, routes }
}

// --- canvas nodes ---------------------------------------------------------------------------

const MARK: Record<Mark, { label: string; tone: string }> = {
  added: { label: 'added', tone: 'bg-ok text-white' },
  modified: { label: 'modified', tone: 'bg-accent text-on-accent' },
  removed: { label: 'removed', tone: 'bg-fail text-white' },
  contains: { label: 'changed inside', tone: 'bg-accent/15 text-accent-text' },
}

const CardNode = memo(function CardNode({ data, selected }: NodeProps<Node<Card>>) {
  const hot = !!data.mark, warm = !!data.impacted
  return (
    <div className={`group relative h-full w-full animate-[pop-in_260ms_var(--ease-snappy)] overflow-hidden rounded-card bg-surface-1 p-3 text-left ring-1 transition-all duration-200 
      ${hot ? 'shadow-[0_0_0_1px_var(--accent),0_8px_30px_-6px_var(--glow)] ring-accent/60'
        : warm ? 'ring-2 ring-dashed ring-wait/80 [outline:2px_dashed_rgb(251_191_36/0.7)] [outline-offset:3px] ring-transparent'
        : data.unmapped ? 'bg-fill/80 ring-1 ring-dashed ring-line-strong [outline:1.5px_dashed_rgb(161_161_170/0.6)] [outline-offset:-1.5px] ring-transparent'
        : data.plain ? 'ring-line hover:ring-line-strong' : 'opacity-70 ring-line hover:opacity-100 '}
      ${selected ? 'scale-[1.03] ring-2 !ring-accent' : 'hover:-translate-y-0.5 hover:shadow-lg'}`}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-fill-strong" />
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-fill-strong" />
      <div className="flex items-center gap-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-ctl ${hot ? 'bg-accent/15 text-accent-text' : warm ? 'bg-wait/15 text-wait-text' : 'bg-fill text-fg-3'}`}>
          <data.icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-semibold text-fg-1 ">{data.name}</div>
          {data.sub && <div className="truncate font-mono text-micro text-fg-3">{data.sub}</div>}
        </div>
        {data.mark && <span className={`shrink-0 rounded-full px-1.5 py-px label ${MARK[data.mark].tone}`}>{MARK[data.mark].label}</span>}
        {!data.mark && warm && <span className="shrink-0 rounded-full bg-wait/15 px-1.5 py-px label text-wait-text">impacted</span>}
      </div>
      <p className="mt-1.5 line-clamp-2 text-meta leading-snug text-fg-2">{data.summary || <span className="italic text-fg-3">not mapped yet</span>}</p>
      {!!data.inner?.length && (
        <div className="mt-2 space-y-[3px] rounded-ctl bg-fill/60 p-1.5 ring-1 ring-line ">
          <div className="flex items-center justify-between px-1 label text-fg-3">
            <span>Inside</span>{!!data.innerMore && <span>+{data.innerMore} more</span>}
          </div>
          {data.inner.map((m) => (
            <div key={m.name} className="flex items-center gap-1.5 rounded-chip bg-surface-1 px-1.5 py-[2px] text-micro ring-1 ring-zinc-200/60 dark:ring-zinc-800">
              <span className={`size-1.5 shrink-0 rounded-full ${m.mark === 'added' ? 'bg-ok' : m.mark === 'removed' ? 'bg-fail' : 'bg-accent'}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-fg-2 ">{m.name}</span>
              <span className="tabular-nums text-fg-3">{m.count}</span>
            </div>
          ))}
        </div>
      )}
      {data.expandPath && (
        <span className="absolute bottom-1.5 right-2 flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-micro font-medium text-white opacity-0 shadow-md transition-all duration-200 group-hover:opacity-100 dark:bg-white dark:text-zinc-900">
          <ZoomIn className="size-3" />double-click to open
        </span>
      )}
    </div>
  )
})

const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<Node<Card>>) {
  return (
    <div className={`h-full w-full animate-[pop-in_260ms_var(--ease-snappy)] rounded-panel border-2 transition-colors duration-300
      ${data.mark ? 'border-accent/40 bg-accent/4' : data.impacted ? 'border-dashed border-wait/60 bg-wait/3' : 'border-line bg-fg-3/2 '}
      ${selected ? '!border-accent' : ''}`}>
      <div className="flex h-[46px] items-center gap-2 px-4">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-ctl ${data.mark ? 'bg-accent/15 text-accent-text' : 'bg-fill text-fg-3'}`}><data.icon className="size-4" /></span>
        <div className="min-w-0">
          <div className="truncate text-body font-semibold text-fg-1 ">{data.name}</div>
          {data.summary && <div className="truncate text-meta text-fg-3">{data.summary}</div>}
        </div>
        {!data.fixed && (
          <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-micro font-medium text-fg-3 ring-1 ring-line-strong dark:bg-zinc-900/80">
            <Minimize2 className="size-3" />double-click to close
          </span>
        )}
      </div>
    </div>
  )
})

const MoreNode = memo(function MoreNode({ data }: NodeProps<Node<Card>>) {
  return (
    <div className="flex h-full w-full animate-[pop-in_260ms_var(--ease-snappy)] items-center gap-2 rounded-card border border-dashed border-line-strong px-3 text-small text-fg-3">
      <Boxes className="size-4 shrink-0" /><span className="truncate"><span className="font-semibold text-fg-3">+{data.name}</span> · {data.summary?.toLowerCase()}</span>
    </div>
  )
})
/** Polyline through ELK's bend points with rounded corners. */
function roundedPath(pts: Pt[], r = 10) {
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const k1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2), k2 = Math.min(r, Math.hypot(c.x - b.x, c.y - b.y) / 2)
    const p1 = { x: b.x - Math.sign(b.x - a.x) * k1, y: b.y - Math.sign(b.y - a.y) * k1 }
    const p2 = { x: b.x + Math.sign(c.x - b.x) * k2, y: b.y + Math.sign(c.y - b.y) * k2 }
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`
  }
  const z = pts[pts.length - 1]
  return `${d} L ${z.x} ${z.y}`
}

function ElkEdge({ id, data, style, markerEnd, label, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const pts = (data?.points as Pt[] | undefined) ?? [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }]
  const placed = data?.label as { x: number; y: number; w: number } | undefined
  const mid = pts[Math.floor((pts.length - 1) / 2)], next = pts[Math.floor((pts.length - 1) / 2) + 1] ?? mid
  const at = placed ?? { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2, w: 120 }
  return (
    <>
      <BaseEdge id={id} path={roundedPath(pts)} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`, maxWidth: at.w }} title={String(label)}
               className="nodrag nopan absolute truncate rounded bg-white/90 px-1 text-micro text-fg-3 dark:bg-zinc-900/90">{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
export const edgeTypes = { elk: ElkEdge }

// not 'group': React Flow styles its built-in group type with a grey fill
export const nodeTypes = { card: CardNode, box: GroupNode, more: MoreNode }

// --- mermaid --------------------------------------------------------------------------------

let mermaidReady: Promise<typeof import('mermaid').default> | undefined
function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>()
  const [err, setErr] = useState(false)
  const darkTheme = useIsDark()
  useEffect(() => {
    let live = true
    mermaidReady ??= import('mermaid').then((m) => m.default)
    mermaidReady.then(async (mermaid) => {
      mermaid.initialize({ startOnLoad: false, theme: darkTheme ? 'dark' : 'neutral', securityLevel: 'strict', fontFamily: 'inherit' })
      try {
        const { svg } = await mermaid.render(`m${Math.random().toString(36).slice(2)}`, code)
        if (live) setSvg(svg)
      } catch { if (live) setErr(true) }
    })
    return () => { live = false }
  }, [code, darkTheme])
  if (err) return <pre className="whitespace-pre-wrap break-words rounded-ctl bg-fill p-3 font-mono text-meta text-fg-2 ">{code}</pre>
  if (!svg) return <div className="h-24 animate-pulse rounded-ctl bg-fill" />
  // mermaid renders with securityLevel strict, which sanitises labels
  return <div className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
}


// --- main -----------------------------------------------------------------------------------

export const READABLE = 0.6 // never shrink the map below this; pan instead

/**
 * Where to put the camera: the focused box, else the open top-level boxes, else everything. Fit it whole
 * when that stays legible (down to 0.5); otherwise readable size, pinned top-left, and the user pans.
 */
export function viewportFor(all: Node<Card>[], el: HTMLElement, o: { focus?: string; preferOpen?: boolean; left?: number }) {
  const byId = new Map(all.map((n) => [n.id, n]))
  const abs = (n: Node<Card>): { x: number; y: number } => {
    const p = n.parentId ? byId.get(n.parentId) : undefined
    const q = p ? abs(p) : { x: 0, y: 0 }
    return { x: q.x + n.position.x, y: q.y + n.position.y }
  }
  const opened = o.preferOpen ? all.filter((n) => !n.parentId && n.data.expanded) : []
  const target = o.focus && byId.get(o.focus) ? [byId.get(o.focus)!] : opened.length ? opened : all.filter((n) => !n.parentId)
  const pts = target.map((n) => { const a = abs(n); return [a.x, a.y, a.x + Number(n.style?.width ?? W), a.y + Number(n.style?.height ?? H)] })
  const r = { x: Math.min(...pts.map((q) => q[0])), y: Math.min(...pts.map((q) => q[1])), x2: Math.max(...pts.map((q) => q[2])), y2: Math.max(...pts.map((q) => q[3])) }
  const left = o.left ?? 32, pad = 32
  const vw = el.clientWidth - left - pad, vh = el.clientHeight - pad - 56
  const w = r.x2 - r.x, h = r.y2 - r.y
  const fitZ = Math.min(1, vw / w, vh / h)
  const zoom = fitZ >= 0.5 ? fitZ : READABLE
  return {
    zoom,
    x: w * zoom <= vw ? left + (vw - w * zoom) / 2 - r.x * zoom : left - r.x * zoom,
    y: h * zoom <= vh ? pad + (vh - h * zoom) / 2 - r.y * zoom : pad - r.y * zoom,
  }
}
// per PR, so switching back to a PR shows its map at once, with the boxes you had opened
const openCache = new Map<string, Set<string>>()

export type Lens = 'tour' | 'business' | 'technical' | 'norms'
const LENSES: Lens[] = ['tour', 'business', 'technical', 'norms']
function Canvas({ pr, toast, prs = [], onSelect, lenses = LENSES, onTurns }: { pr: PrView; toast: (m: string, tone?: 'ok' | 'error') => void; prs?: PrView[]; onSelect?: (id: string) => void; lenses?: Lens[]; onTurns?: () => void }) {
  // a role sees only its views (Product and Design: the tour and business); one it doesn't see opens as the tour
  const asked = lenses.includes(param('view') as Lens) ? param('view') : null
  // which way you read it (Business, Technical or the Tour) is kept in the URL, so a reload lands on the same one
  // the tour first: it is where a reader starts; the address keeps whichever view you switched to
  const [business, setBusinessState] = useState(() => asked === 'business')
  const [tour, setTourState] = useState(() => !asked || asked === 'tour')
  const [norms, setNormsState] = useState(() => asked === 'norms')
  const setBusiness = (b: boolean) => { setBusinessState(b); setTourState(false); setNormsState(false); setParam('view', b ? 'business' : 'technical') }
  const setTour = (t: boolean) => { setTourState(t); setNormsState(false); setParam('view', t ? null : business ? 'business' : 'technical') }
  const setNorms = () => { setNormsState(true); setTourState(false); setParam('view', 'norms') }
  const [open, setOpenState] = useState<Set<string> | undefined>(() => openCache.get(pr.id))
  const setOpen = useCallback((v: Set<string> | ((p: Set<string> | undefined) => Set<string>)) => setOpenState((prev) => {
    const next = typeof v === 'function' ? v(prev) : v
    openCache.set(pr.id, next)
    return next
  }), [pr.id])
  const [ready, setReady] = useState(false) // fade the map in once it is laid out and framed
  const firstFrame = useRef(true)
  const [allFiles, setAllFiles] = useState(false)
  const [flowsOpen, setFlowsOpen] = useState(false)
  const [codePath, setCodePath] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [full, setFull] = useState(false)
  const [nodes, setNodes] = useState<Node<Card>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const rf = useReactFlow()
  const dark = useIsDark()
  const box = useRef<HTMLDivElement>(null)

  const task = pr.explain
  // cached per PR and per state of its explanation and push: back on a PR it shows at once, a new run or push reads it again
  const q = useApi<Data>(explainPath(pr), { placeholderData: keepSame(`/prs/${enc(pr.id)}/explain`) })
  const d = q.data ?? (q.isError ? { nodes: {}, stale: false } as Data : undefined)

  // start at an intermediate level: the most-changed system is open one level, the rest show previews
  useEffect(() => {
    if (!d?.overlay || open) return // `open` may come back from openCache for a PR you visited
    const f = d.overlay.facts
    const count = (s: System) => f.changes.filter((c) => s.paths.some((p) => under(c.path, p))).length
    const top = systemsOf(d).filter((s) => count(s) > 0).sort((a, b) => count(b) - count(a))[0]
    setOpen(new Set(top ? [top.id] : []))
  }, [d, open])

  const tree = useMemo(() => (d?.overlay && open ? techTree(d, open, allFiles) : undefined), [d, open, allFiles])
  const flat = useMemo(() => (d?.overlay && business ? businessGraph(d) : undefined), [d, business])

  // open and close boxes in place: the rest of the map stays, the box swaps its summary for its modules
  const toggle = useCallback((id: string) => {
    if (!tree) return
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        // closing a box closes everything inside it too
        for (const k of [...next]) { for (let p = tree.parent.get(k); p; p = tree.parent.get(p)) if (p === id) { next.delete(k); break } }
      } else { next.add(id); lastOpened.current = id }
      return next
    })
  }, [tree])

  const openAllChanged = () => {
    if (!d?.overlay) return
    const f = d.overlay.facts
    const ids = new Set(systemsOf(d).filter((s) => markOf(s.paths, f).mark).map((s) => s.id))
    for (const v of Object.values(f.views)) for (const c of v.children) if (c.touched === 'contains' && f.views[c.drill ?? c.path]) ids.add(c.path)
    setOpen(ids)
  }

  const lastOpened = useRef<string>(undefined)
  const canvas = useRef<HTMLDivElement>(null)
  // Frame a box: fit it when it fits at a readable zoom, else pin its top-left (title visible) and let the user pan.
  const frame = useCallback((all: Node<Card>[]) => {
    const el = canvas.current
    if (!el || !all.length) return
    const id = lastOpened.current
    lastOpened.current = undefined
    // the box just opened; else the changed boxes you start with; else everything
    const vp = viewportFor(all, el, { focus: id, preferOpen: true, left: flowsOpen && !business ? 480 : 32 })
    // the first frame lands in place (no camera sweep from the last PR); later ones glide
    rf.setViewport(vp, { duration: firstFrame.current || calm() ? 0 : 420 })
    if (firstFrame.current) { firstFrame.current = false; requestAnimationFrame(() => setReady(true)) }
  }, [rf, flowsOpen, business])
  const fit = useCallback(() => frame(rf.getNodes() as Node<Card>[]), [frame, rf])

  useEffect(() => {
    let live = true
    const run = async () => {
      if (business && flat) {
        const { nodes, routes } = await layoutTree(flat.cards.map((card) => ({ card })), flat.links)
        return { nodes, links: flat.links, routes }
      }
      if (tree) { const r = await layoutTree(tree.roots, tree.links); return { nodes: r.nodes, links: r.edges, routes: r.routes } }
      return { nodes: [], links: [], routes: new Map<string, Route>() }
    }
    run().then(({ nodes, links, routes }) => {
      if (!live) return
      setNodes(nodes)
      const byId = new Map(nodes.map((n) => [n.id, n.data]))
      const hot = (id: string) => !!(byId.get(id)?.mark || byId.get(id)?.impacted)
      setEdges(links.filter((l) => byId.has(l.from) && byId.has(l.to)).map((l) => {
        const lit = hot(l.from) && hot(l.to)
        return {
          id: `${l.from}>${l.to}`, source: l.from, target: l.to, label: l.label, animated: lit, zIndex: 5,
          ...(routes.get(`${l.from}>${l.to}`) ? { type: 'elk', data: { points: routes.get(`${l.from}>${l.to}`)!.points, label: routes.get(`${l.from}>${l.to}`)!.label } } : { type: 'smoothstep' }),
          style: { stroke: lit ? 'var(--accent)' : 'rgb(161 161 170 / 0.7)', strokeWidth: lit ? 2 : 1.25 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: lit ? 'var(--accent)' : 'rgb(161 161 170)' },
          labelStyle: { fontSize: 10, fill: 'rgb(113 113 122)' }, labelBgStyle: { fillOpacity: 0.9 }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4,
        }
      }))
      requestAnimationFrame(() => frame(nodes))
    })
    return () => { live = false }
  }, [tree, flat, business, frame])

  // a single click waits a beat so a double-click (open/close) can cancel it
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onClick = (id: string) => { clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => setSelected(id), 220) }
  const onDouble = (c: Card) => {
    clearTimeout(clickTimer.current)
    if (business) { if (c.expandPath) { setBusiness(false); setOpen((p) => new Set(p).add(c.id)) } return }
    if (c.expandPath) toggle(c.id)
    else if (c.code) setCodePath(c.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || !d?.overlay) return
      // another modal (settings, submit) is above the map: leave Esc and every other key to it
      const top = document.querySelector('dialog[open]')
      if (top && !top.contains(box.current)) return
      const card = nodes.find((n) => n.id === selected)?.data
      let handled = true
      if (codePath && (e.key === 'Escape' || e.key === 'Backspace')) setCodePath(undefined)
      else if ((e.key === 'Enter' || e.key === '+' || e.key === '=') && card) onDouble(card)
      else if ((e.key === '-' || e.key === 'Backspace') && selected && tree) {
        const target = open?.has(selected) ? selected : tree.parent.get(selected)
        if (target) { toggle(target); setSelected(target) } else handled = false
      } else if (e.key === 'Escape' && selected) setSelected(undefined)
      else if (e.key === 'Escape' && full) setFull(false)
      else handled = false
      if (handled) { e.preventDefault(); e.stopImmediatePropagation() }
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  })

  // the codebase map: explanations are much richer once the repo's default branch is mapped
  const map = pr.codebaseMap
  const mapTask = map?.task
  const mappingNow = mapTask?.state === 'running' || mapTask?.state === 'queued'
  const mapped = !!map?.mappedAt
  const waiting = !!pr.explainAfterBase
  const [plan, setPlan] = useState<{ folders: number; toMap: number; estimateUsd: number }>()
  useEffect(() => {
    if (!mapped && !mappingNow && pr.repoPath) api(`/base/plan?repo=${encodeURIComponent(pr.repo)}`).then(setPlan).catch(() => {})
  }, [mapped, mappingNow, pr.repo, pr.repoPath])
  const afterMap = () => api(`/prs/${enc(pr.id)}/explain`, { afterBase: true }).then(
    () => toast(mappingNow ? 'Queued: explains as soon as the map is ready' : 'Mapping the codebase first; this PR is explained right after'), (e: Error) => toast(e.message, 'error'))

  const run = (fresh = false) => api(`/prs/${enc(pr.id)}/explain`, { fresh }).then(() => toast(fresh ? 'Re-explaining from scratch' : 'Explaining the latest push'), (e: Error) => toast(e.message, 'error'))
  const busy = task?.state === 'running' || task?.state === 'queued'
  const o = d?.overlay

  if (!d) {
    return (
      <div className="relative h-full overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle,rgb(161_161_170/0.25)_1px,transparent_1px)] [background-size:18px_18px] opacity-60" />
        <div className="absolute left-1/2 top-1/2 h-48 w-80 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-panel bg-fill/50" />
      </div>
    )
  }

  if (!o) {
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          {busy ? <Generating step={task?.step} /> : task?.state === 'failed' ? (
            <>
              <TriangleAlert className="size-8 text-fail-text" />
              <p className="max-w-md text-reading text-fg-2 ">{task.error}</p>
              <button onClick={() => run()} className="btn-primary btn-lg">Try again</button>
            </>
          ) : (!mapped || mappingNow) && pr.repoPath ? (
            <MapFirst task={mapTask} plan={plan} waiting={waiting} onMapThenExplain={afterMap} onExplainNow={() => run()} />
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-card bg-accent text-white shadow-lg shadow-accent/30"><Sparkles className="size-7" /></span>
              <div>
                <p className="font-semibold">See this PR as a map</p>
                <p className="mt-1 max-w-sm text-body text-fg-3">What it means for the business, and how the system and code change, opening each part down to the file.</p>
              </div>
              <button onClick={() => run()} disabled={!pr.repoPath} className="group inline-flex items-center gap-1.5 btn-primary btn-lg">
                <Sparkles className="size-4 transition-transform group-hover:rotate-12" />Explain this PR
              </button>
            </>
          )}
        </div>
      </Shell>
    )
  }

  const card = nodes.find((n) => n.id === selected)?.data
  const anyOpen = !!open?.size
  const touchedHere = codePath ? o.touched.find((t) => t.path === codePath) : undefined
  const flowsFor = (p: string) => o.flows.filter((fl) => under(fl.scope, p) || under(p, fl.scope))
  const systemCards = businessGraph(d!).cards.filter((c) => c.kind === 'system')
  const ghost = 'flex items-center gap-1 btn-outline btn-sm'
  return (
    <Shell expanded={full} onClose={() => setFull(false)}>
      <div ref={box} className="flex h-full min-h-0 flex-col">
        {/* toolbar: perspective first, then what the technical map shows, then housekeeping */}
        <div className={`flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-3 py-2 ${full ? 'pr-32' : ''}`}>
          <div role="tablist" aria-label="Perspective" style={{ gridTemplateColumns: `repeat(${lenses.length}, minmax(0, 1fr))` }} className="relative grid rounded-ctl bg-fill p-1">
            <span className="absolute inset-y-1 left-1 rounded-ctl bg-surface-1 shadow-sm ring-1 ring-black/5 transition-transform duration-300 ease-[var(--ease-snappy)] dark:ring-white/5"
                  style={{ width: `calc((100% - 8px) / ${lenses.length})`, transform: `translateX(${Math.max(0, lenses.indexOf(norms ? 'norms' : tour ? 'tour' : business ? 'business' : 'technical')) * 100}%)` }} />
            {([['tour', Compass, 'Tour', 'A guided walk through the change, step by step'], ['business', Briefcase, 'Business', 'What it means for users and the company'], ['technical', Cpu, 'Technical', 'How the system and code change'], ['norms', Scale, 'Norms', 'Where it drifts from how its libraries, its language and the house write things down']] as const).filter(([v]) => lenses.includes(v)).map(([v, Icon, label, hint]) => {
              const on = v === (norms ? 'norms' : tour ? 'tour' : business ? 'business' : 'technical')
              return (
                <button key={label} role="tab" aria-selected={on} title={hint} onClick={() => { if (v === 'tour') setTour(true); else if (v === 'norms') setNorms(); else setBusiness(v === 'business'); setSelected(undefined); setCodePath(undefined) }}
                        className={`group relative z-10 flex items-center justify-center gap-1.5 rounded-ctl px-3 py-1 text-small font-semibold transition-colors ${on ? 'text-fg-1 ' : 'text-fg-3 hover:text-fg-1'}`}>
                  <Icon className={`size-3.5 transition-transform group-hover:scale-110 ${on ? 'text-accent' : ''}`} />{label}{v === 'norms' && !!pr.crit?.drift && <span className="rounded-full bg-accent-soft px-1.5 text-micro tabular-nums text-accent-text">{pr.crit.drift}</span>}
                </button>
              )
            })}
          </div>
          {onTurns && <button onClick={onTurns} className={ghost} title="How the PR changed direction, push by push"><GitCommitVertical className="size-3" />Turns</button>}
          {!business && !tour && !norms && !codePath && (
            <>
              <button onClick={openAllChanged} className={ghost} title="Open every box that has changes inside"><Maximize2 className="size-3" /><span className="hidden xl:inline">Open all changes</span></button>
              {anyOpen && <button onClick={() => setOpen(new Set())} className={ghost} title="Close every box"><Minimize2 className="size-3" /><span className="hidden xl:inline">Close all</span></button>}
              <button onClick={() => setAllFiles(!allFiles)} aria-pressed={allFiles} className={ghost} title="Show unchanged files inside open boxes">{allFiles ? <EyeOff className="size-3" /> : <Eye className="size-3" />}<span className="hidden xl:inline">{allFiles ? 'Hide' : 'Show'} unchanged files</span></button>
            </>
          )}
          {codePath && (
            <button onClick={() => setCodePath(undefined)} className={ghost}><ChevronRight className="size-3 rotate-180" />Back to the map</button>
          )}
          <span className="flex-1" />
          {!business && !tour && !norms && !codePath && o.flows.length > 0 && (
            <button onClick={() => { setFlowsOpen(!flowsOpen); setTimeout(fit, 0) }} aria-pressed={flowsOpen} title="Before and after logic diagrams"
                    className={`group flex items-center gap-1.5 rounded-ctl px-2.5 py-1 text-small font-medium transition-all ${flowsOpen ? 'bg-accent/10 text-accent-text ring-1 ring-accent/30' : 'text-fg-3 ring-1 ring-line-strong hover:text-fg-1'}`}>
              <Workflow className="size-3.5 transition-transform group-hover:rotate-12" />Flows<span className="rounded-full bg-fill/70 px-1.5 text-micro tabular-nums">{o.flows.length}</span>
            </button>
          )}
          <button onClick={() => api(`/prs/${enc(pr.id)}/explain-follow`, { on: pr.explainFollow !== true }).catch((e: Error) => toast(e.message, 'error'))}
                  aria-pressed={pr.explainFollow === true}
                  title={pr.explainFollow === true ? 'Follows new commits: every push (yours, a rebase, a resolved conflict, someone else’s) updates it. Click to keep this version' : 'Kept as is: new commits don’t update it. Click to follow them'}
                  className={`inline-flex items-center gap-1 rounded-ctl px-2 py-1 text-meta font-medium transition-colors ${pr.explainFollow === true ? 'text-accent-text hover:bg-accent/10' : 'text-fg-3 hov hover:text-fg-1'}`}>
            <Radio className={`size-3.5 ${pr.explainFollow === true && busy ? 'animate-pulse' : ''}`} />{pr.explainFollow === true ? 'Following commits' : 'Paused'}
          </button>
          <button onClick={() => run()} disabled={busy} aria-label="Explain the latest push"
                  title={`Explain the latest push (only what changed). Version ${o.iteration}: ${o.asked} changed files explained${o.reused ? `, ${o.reused} carried over` : ''}, $${o.costUsd.toFixed(2)}`}
                  className="group rounded-ctl p-1.5 text-fg-3 transition-all hov hover:text-fg-1 disabled:opacity-40">
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : 'transition-transform duration-500 group-hover:rotate-180'}`} />
          </button>
          {!full && (
            <button onClick={() => setFull(true)} title="Full screen" aria-label="Full screen" className="rounded-ctl p-1.5 text-fg-3 transition-all hov hover:text-fg-1">
              <Maximize2 className="size-3.5" />
            </button>
          )}
        </div>

        {/* the technical side keeps the business answer one line away */}
        {!business && !tour && !norms && (
          <button onClick={() => setBusiness(true)}
                  className="group flex shrink-0 items-center gap-2 border-b border-line px-4 py-1.5 text-left text-small transition-colors hover:bg-hover">
            <Briefcase className="size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 truncate font-medium text-fg-2 ">{o.business.headline}</span>
            <span className={`shrink-0 rounded-full px-1.5 py-px label ${RISK[o.business.risk]}`}>{o.business.risk} risk</span>
            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-meta text-fg-3 transition-colors group-hover:text-accent-text">Business side<ChevronRight className="size-3 transition-transform group-hover:translate-x-0.5" /></span>
          </button>
        )}

        {/* what it builds on and the codebase map's news share one line: each a row of its own pushed the tour down */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-fill/60 px-3 py-1.5 text-meta text-fg-3 empty:hidden">
        <BuildsOn pr={pr} prs={prs} onSelect={onSelect} toast={toast} />
        {!busy && pr.repoPath && (mappingNow || !mapped || (mapped && o.createdAt < map!.mappedAt!)) && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-fg-2 ">
            <MapIcon className="size-3.5 shrink-0 text-accent" />
            {mappingNow ? (
              <>
                <span className="shrink-0">Mapping the codebase</span>
                <MapProgress task={mapTask!} className="min-w-24 max-w-56 flex-1" />
                {waiting ? <span className="flex items-center gap-1 text-accent-text"><Check className="size-3.5" />Re-explains when done</span>
                  : <button onClick={afterMap} className="font-semibold text-accent-text underline-offset-2 hover:underline">Re-explain when done</button>}
              </>
            ) : !mapped ? (
              <>
                <span>Explained without a codebase map, so only folders earlier PRs touched were known.</span>
                <button onClick={afterMap} className="font-semibold text-accent-text underline-offset-2 hover:underline">
                  Map the codebase{plan ? ` (~$${plan.estimateUsd.toFixed(2)})` : ''} and re-explain
                </button>
              </>
            ) : (
              <>
                <span>The codebase map is newer than this explanation.</span>
                <button onClick={() => run(true)} className="font-semibold text-accent-text underline-offset-2 hover:underline">Re-explain with the map</button>
              </>
            )}
          </div>
        )}
        </div>

        {(busy || d!.stale) && (
          <div className="flex shrink-0 items-center gap-2 border-b border-accent/15 bg-accent/5 px-3 py-1.5 text-small text-accent-text">
            {busy ? <><LoaderCircle className="size-3.5 shrink-0 animate-spin" /><span className="truncate">{readableStep(task?.step)}… showing iteration #{o.iteration} meanwhile</span></>
              : <><RefreshCw className="size-3.5" />This map is for an older push.<button onClick={() => run()} className="font-semibold underline-offset-2 hover:underline">Update it</button></>}
          </div>
        )}

        {norms ? <div className="min-h-0 flex-1 overflow-y-auto"><Norms pr={pr} toast={toast} /></div> : tour ? <div className="relative min-h-0 flex-1"><Tour pr={pr} o={o} onExplain={() => run()} busy={busy} prs={prs} onSelect={onSelect} toast={toast} /></div> : (
        <div className="relative flex min-h-0 flex-1">
          {business && (
            <aside className="w-[min(400px,42%)] shrink-0 overflow-y-auto border-r border-line ">
              <BusinessBrief o={o} systems={systemCards} />
            </aside>
          )}
          <div ref={canvas} className="relative min-w-0 flex-1">
            {codePath ? (
              <CodeView pr={pr} path={codePath} t={touchedHere} impact={o.impact.filter((i) => o.facts.dependents.some((dep) => dep.path === i.path && dep.imports === codePath))} flows={flowsFor(codePath)} />
            ) : (
              <ReactFlow
                style={{ opacity: ready ? 1 : 0, transition: 'opacity 220ms ease-out' }}
                nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
                onNodeClick={(_, n) => onClick(n.id)}
                onNodeDoubleClick={(e, n) => { e.stopPropagation(); onDouble(n.data) }}
                onPaneClick={() => { clearTimeout(clickTimer.current); setSelected(undefined) }}
                zoomOnDoubleClick={false} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
                colorMode={dark ? 'dark' : 'light'}
                minZoom={0.6} maxZoom={1.5} proOptions={{ hideAttribution: true }}
                className="!bg-transparent">
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="!bg-transparent opacity-60" />
                <Controls showInteractive={false} className={flowControls} />
              </ReactFlow>
            )}
            {flowsOpen && !business && !codePath && <FlowsDrawer flows={o.flows} onClose={() => { setFlowsOpen(false); setTimeout(fit, 0) }} />}
            {!codePath && <Legend business={business} />}
          </div>
          {card && !codePath && card.kind !== 'more' && (
            <Inspector card={card} o={o} d={d!} pr={pr} business={business} onClose={() => setSelected(undefined)}
                       onPrimary={() => (card.code && !card.expandPath ? setCodePath(card.id) : onDouble(card))} />
          )}
        </div>
        )}
      </div>
    </Shell>
  )
}

/** In place, or as a native modal dialog: top layer, so no parent overflow or transform can clip it. */
function Shell({ expanded, onClose, children }: { expanded?: boolean; onClose?: () => void; children: ReactNode }) {
  if (!expanded) return <div className="h-full">{children}</div>
  return (
    <dialog ref={(d) => { if (d && !d.open) d.showModal() }} onClose={onClose}
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
            className="m-auto h-[calc(100dvh/var(--z)-48px)] max-h-none w-[calc(100vw/var(--z)-48px)] max-w-none animate-[toast-in_220ms_var(--ease-snappy)] overflow-hidden rounded-card bg-fill/60 p-0 text-fg-1 shadow-2xl ring-1 ring-line backdrop:bg-zinc-950/50 backdrop:backdrop-blur-sm ">
      <button onClick={onClose} aria-label="Close full screen" title="Close (esc)"
              className="absolute right-3 top-2 z-30 flex items-center gap-1.5 rounded-ctl bg-white/90 px-2.5 py-1.5 text-small font-medium text-fg-2 shadow-sm ring-1 ring-line-strong backdrop-blur transition-all hover:text-fg-1 dark:bg-zinc-900/90">
        <X className="size-3.5" />Close<kbd className="rounded bg-fill px-1 font-mono text-micro text-fg-3">esc</kbd>
      </button>
      {children}
    </dialog>
  )
}

type MapTask = NonNullable<NonNullable<PrView['codebaseMap']>['task']>

function MapProgress({ task, className = '' }: { task: MapTask; className?: string }) {
  const pct = task.total ? Math.round(((task.done ?? 0) / task.total) * 100) : 0
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill-strong">
        {task.total ? <span className="block h-full rounded-full bg-accent transition-all duration-700 ease-[var(--ease-snappy)]" style={{ width: `${Math.max(3, pct)}%` }} />
          : <span className="block h-full w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-accent to-transparent" />}
      </span>
      <span className="shrink-0 font-mono text-micro tabular-nums text-fg-3">{task.total ? `${task.done ?? 0}/${task.total}` : task.state === 'queued' ? 'queued' : '…'}</span>
    </span>
  )
}

/** Before a first explanation: recommend mapping the codebase, show its progress, or explain right away. */
function MapFirst({ task, plan, waiting, onMapThenExplain, onExplainNow }: {
  task?: MapTask; plan?: { folders: number; toMap: number; estimateUsd: number }; waiting: boolean
  onMapThenExplain: () => void; onExplainNow: () => void
}) {
  const running = task?.state === 'running' || task?.state === 'queued'
  return (
    <div className="w-full max-w-md space-y-5">
      <span className="mx-auto flex size-14 items-center justify-center rounded-card bg-accent text-white shadow-lg shadow-accent/30"><MapIcon className="size-7" /></span>
      <div>
        <p className="font-semibold">{running ? 'Mapping the codebase' : 'Map the codebase first'}</p>
        <p className="mt-1 text-body leading-relaxed text-fg-3">
          {running ? (task?.step ?? 'Getting started') : 'A one-time map of the default branch lets every PR be explained against the whole system, not just what earlier PRs touched. It stays fresh on its own.'}
        </p>
      </div>
      {running && task && <MapProgress task={task} />}
      {!running && plan && <p className="text-small text-fg-3">{plan.toMap} of {plan.folders} folders to map · about ${plan.estimateUsd.toFixed(2)}, once</p>}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {waiting ? (
          <span className="inline-flex items-center gap-1.5 rounded-ctl bg-accent/10 px-3.5 py-2 text-body font-medium text-accent-text ring-1 ring-accent/20"><Check className="size-4" />Explains when the map is ready</span>
        ) : (
          <button onClick={onMapThenExplain} className="group inline-flex items-center gap-1.5 btn-primary btn-lg shadow-sm transition-all">
            <MapIcon className="size-4" />{running ? 'Explain when it’s done' : 'Map, then explain'}
          </button>
        )}
        <button onClick={onExplainNow} className="rounded-ctl px-3.5 py-2 text-body font-medium text-fg-3 ring-1 ring-line-strong transition-all hover:text-fg-1">Explain now</button>
      </div>
    </div>
  )
}

function Generating({ step }: { step?: string }) {
  return (
    <>
      <div className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/15 [animation-duration:2s]" />
        <span className="absolute inset-3 animate-pulse rounded-full bg-accent/20" />
        <Route className="relative size-8 text-accent" />
      </div>
      <div>
        <p className="font-semibold">Mapping this PR</p>
        <p className="mt-1 max-w-sm truncate text-body text-fg-3">{step ?? 'Starting'}…</p>
      </div>
    </>
  )
}

const RISK = { low: 'bg-ok/10 text-ok-text', medium: 'bg-wait/10 text-wait-text', high: 'bg-fail/10 text-fail-text' }

function BusinessBrief({ o, systems }: { o: Overlay; systems: Card[] }) {
  const b = o.business
  const changed = systems.filter((s) => s.mark), impacted = systems.filter((s) => s.impacted)
  const Section = ({ label, children }: { label: string; children: ReactNode }) => (
    <section className="space-y-1">
      <h4 className="text-meta font-semibold text-fg-3">{label}</h4>
      <p className="text-body leading-relaxed text-fg-2 ">{children}</p>
    </section>
  )
  return (
    <div className="space-y-5 p-5">
      <header className="space-y-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 label ${RISK[b.risk]}`}><ShieldAlert className="size-3" />{b.risk} risk</span>
        <h3 className="text-balance text-title font-semibold leading-snug tracking-tight">{b.headline}</h3>
      </header>
      <Section label="What changes">{b.what}</Section>
      <Section label="Why">{b.why}</Section>
      <Section label="Who is affected">{b.who}</Section>
      <section className="space-y-1 rounded-ctl bg-fill/60 p-3 ring-1 ring-line ">
        <h4 className="text-meta font-semibold text-fg-3">Risk</h4>
        <p className="text-small leading-relaxed text-fg-2 ">{b.riskWhy}</p>
      </section>
      {(changed.length > 0 || impacted.length > 0) && (
        <section className="space-y-2">
          <h4 className="text-meta font-semibold text-fg-3">Parts of the product involved</h4>
          <div className="flex flex-wrap gap-1.5">
            {changed.map((s) => <span key={s.id} className="rounded-full bg-accent/10 px-2 py-0.5 text-meta font-medium text-accent-text ring-1 ring-accent/20">{s.name}</span>)}
            {impacted.map((s) => <span key={s.id} className="rounded-full px-2 py-0.5 text-meta font-medium text-wait-text ring-1 ring-dashed ring-wait/40">{s.name}</span>)}
          </div>
        </section>
      )}
      <p className="text-meta text-fg-3">Click a box on the map for its role; switch to Technical to see how the code changes.</p>
    </div>
  )
}

function FlowsDrawer({ flows, onClose }: { flows: Overlay['flows']; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [side, setSide] = useState<'after' | 'before'>('after')
  const fl = flows[Math.min(i, flows.length - 1)]
  return (
    <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-24px)] w-[min(460px,calc(100%-24px))] animate-[toast-in_240ms_var(--ease-snappy)] flex-col overflow-hidden rounded-card bg-white/95 shadow-xl ring-1 ring-line backdrop-blur dark:bg-zinc-900/95 ">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line p-1.5 ">
        <button onClick={onClose} className="order-last ml-auto shrink-0 rounded-chip p-1 text-fg-3 transition-colors hov hover:text-fg-2 " aria-label="Close flows"><X className="size-3.5" /></button>
        {flows.map((f, k) => (
          <button key={k} onClick={() => setI(k)} className={`shrink-0 rounded-ctl px-2 py-1 text-meta font-medium transition-colors ${k === i ? 'bg-accent/10 text-accent-text' : 'text-fg-3 hov '}`}>
            <Workflow className="mr-1 inline size-3 -translate-y-px" />{f.title}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <span className="truncate font-mono text-micro text-fg-3">{fl.scope}</span>
        <span className="flex-1" />
        {fl.before && (
          <div className="flex rounded-chip bg-fill p-0.5 text-micro font-medium">
            {(['before', 'after'] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)} className={`rounded px-2 py-0.5 capitalize transition-colors ${side === s ? 'sel text-fg-1 ' : 'text-fg-3'}`}>{s}</button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 overflow-auto p-3"><Mermaid code={side === 'before' && fl.before ? fl.before : fl.after} /></div>
    </div>
  )
}

function Inspector({ card, o, d, pr, business, onPrimary, onClose }: { card: Card; o: Overlay; d: Data; pr: PrView; business: boolean; onPrimary: () => void; onClose: () => void }) {
  const info = card.path ? d.nodes[card.path] : undefined
  const t = o.touched.find((x) => x.path === card.id)
  const impacts = o.impact.filter((i) => card.kind === 'system' ? false : under(i.path, card.id))
  const changesInside = o.facts.changes.filter((c) => card.kind === 'system' ? (d.skeleton?.systems.find((s) => s.id === card.id)?.paths ?? [card.path ?? '']).some((p) => under(c.path, p)) : under(c.path, card.id))
  const ghUrl = card.kind === 'file' ? `https://github.com/${pr.repo}/blob/${pr.headSha}/${card.id}` : undefined
  return (
    <aside className="z-10 flex w-[320px] shrink-0 animate-[toast-in_200ms_var(--ease-snappy)] flex-col overflow-hidden border-l border-line bg-white/90 backdrop-blur dark:bg-zinc-900/80">
      <header className="flex items-start gap-2 border-b border-line p-3 ">
        <card.icon className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold">{card.name}</h3>
          <p className="truncate font-mono text-micro text-fg-3">{card.kind === 'system' ? card.sub : card.id}</p>
        </div>
        <button onClick={onClose} className="rounded-chip p-1 text-fg-3 transition-colors hov hover:text-fg-2 " aria-label="Close"><X className="size-3.5" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-small leading-relaxed">
        {t && (
          <section className="space-y-2 rounded-ctl bg-accent/5 p-3 ring-1 ring-accent/15">
            <h4 className="text-meta font-semibold text-accent-text">This PR · {t.change}</h4>
            {t.before && <p><span className="font-semibold text-fg-3">Before. </span>{t.before}</p>}
            <p><span className="font-semibold text-fg-1 ">After. </span>{t.after}</p>
            <p className="text-fg-2"><span className="font-semibold">Why. </span>{t.why}</p>
          </section>
        )}
        {(info || card.summary) && !t && (
          <section className="space-y-1.5">
            <h4 className="text-meta font-semibold text-fg-3">What it is</h4>
            <p className="text-fg-2 ">{info?.summary ?? card.summary}</p>
            {info?.businessRole && <p className="text-fg-3"><Briefcase className="mr-1 inline size-3 -translate-y-px" />{info.businessRole}</p>}
            {business && card.kind === 'system' && d.skeleton?.systems.find((x) => x.id === card.id)?.businessRole && (
              <p className="text-fg-3"><Briefcase className="mr-1 inline size-3 -translate-y-px" />{d.skeleton.systems.find((x) => x.id === card.id)!.businessRole}</p>
            )}
            {!!info?.responsibilities?.length && <ul className="list-disc space-y-0.5 pl-4 text-fg-2">{info.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>}
          </section>
        )}
        {changesInside.length > 0 && !t && (
          <section className="space-y-1.5">
            <h4 className="text-meta font-semibold text-fg-3">Changed inside · {changesInside.length}</h4>
            <ul className="space-y-1">{changesInside.slice(0, 12).map((c) => (
              <li key={c.path} className="flex items-center gap-1.5 font-mono text-meta">
                <span className={`size-1.5 shrink-0 rounded-full ${c.status === 'added' ? 'bg-ok' : c.status === 'removed' ? 'bg-fail' : 'bg-accent'}`} />
                <span className="truncate text-fg-2 " title={c.path}>{c.path.slice(card.kind === 'system' ? 0 : card.id.length + 1)}</span>
              </li>
            ))}</ul>
          </section>
        )}
        {impacts.length > 0 && (
          <section className="space-y-1.5">
            <h4 className="text-meta font-semibold text-wait-text">Impact</h4>
            {impacts.slice(0, 6).map((i) => <p key={i.path} className="text-fg-2"><span className="font-mono text-meta text-fg-2 ">{i.path.split('/').pop()}</span> {i.reason}</p>)}
          </section>
        )}
      </div>
      <footer className="flex gap-2 border-t border-line p-3 ">
        {(card.expandPath || card.code) && (
          <button onClick={onPrimary} className="flex flex-1 items-center justify-center gap-1.5 btn-primary">
            {business ? <><Cpu className="size-3.5" />See it technically</> : card.expandPath ? (card.expanded ? <><Minimize2 className="size-3.5" />Close box</> : <><ZoomIn className="size-3.5" />Open box</>) : <><Workflow className="size-3.5" />Before &amp; after</>}
          </button>
        )}
        {ghUrl && <a href={ghUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-ctl px-3 py-1.5 text-small font-medium text-fg-2 ring-1 ring-line-strong transition-all hover:text-fg-1">File<ArrowUpRight className="size-3.5" /></a>}
      </footer>
    </aside>
  )
}

function CodeView({ pr, path, t, impact, flows }: { pr: PrView; path: string; t?: Overlay['touched'][number]; impact: Overlay['impact']; flows: Overlay['flows'] }) {
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-2">
          <FileCode className="size-5 text-accent" />
          <h3 className="min-w-0 flex-1 truncate font-mono text-reading font-semibold">{path}</h3>
          <a href={`https://github.com/${pr.repo}/blob/${pr.headSha}/${path}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-ctl px-2.5 py-1 text-small text-fg-3 ring-1 ring-line-strong transition-all hover:text-fg-1">GitHub<ArrowUpRight className="size-3.5" /></a>
        </div>
        {t && (
          <div className="grid gap-3 md:grid-cols-2">
            {t.before && <div className="card p-4 "><h4 className="mb-1.5 text-meta font-semibold text-fg-3">Before</h4><p className="text-body leading-relaxed text-fg-2 ">{t.before}</p></div>}
            <div className={`rounded-card bg-accent/5 p-4 ring-1 ring-accent/20 ${t.before ? '' : 'md:col-span-2'}`}><h4 className="mb-1.5 text-meta font-semibold text-accent-text">After · {t.change}</h4><p className="text-body leading-relaxed text-fg-1 ">{t.after}</p></div>
            <p className="text-small text-fg-2 md:col-span-2"><span className="font-semibold text-fg-1 ">Why. </span>{t.why}</p>
          </div>
        )}
        {impact.length > 0 && (
          <div className="rounded-card bg-wait/5 p-4 ring-1 ring-wait/20">
            <h4 className="mb-2 text-meta font-semibold text-wait-text">Who depends on this</h4>
            {impact.map((i) => <p key={i.path} className="text-small text-fg-2 "><span className="font-mono text-meta text-fg-1 ">{i.path}</span>: {i.reason}</p>)}
          </div>
        )}
        {flows.map((f) => (
          <div key={f.title} className="space-y-2 card p-4 ">
            <h4 className="flex items-center gap-1.5 text-body font-semibold"><Workflow className="size-4 text-accent" />{f.title}</h4>
            <div className={`grid gap-3 ${f.before ? 'lg:grid-cols-2' : ''}`}>
              {f.before && <div><p className="mb-1 text-meta font-semibold text-fg-3">Before</p><Mermaid code={f.before} /></div>}
              <div><p className="mb-1 text-meta font-semibold text-accent">After</p><Mermaid code={f.after} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Legend({ business }: { business?: boolean }) {
  return (
    // one line whatever the width: the keys never shrink, the hint ellipsizes, and it stays clear of the zoom buttons
    <div className="pointer-events-none absolute bottom-3 left-1/2 flex max-w-[calc(100%-8rem)] -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-white/90 px-3 py-1 text-micro text-fg-3 shadow-sm ring-1 ring-line backdrop-blur dark:bg-zinc-900/90 ">
      <span className="flex shrink-0 items-center gap-1"><span className="size-2 rounded-full bg-accent" />changed</span>
      <span className="flex shrink-0 items-center gap-1"><span className="size-2 rounded-full border border-dashed border-wait" />impacted</span>
      <span className="flex shrink-0 items-center gap-1"><span className="size-2 rounded-full bg-fill-strong" />context</span>
      <span className="hidden min-w-0 truncate 2xl:inline">{business ? 'click a box for its role · double-click for the technical view' : 'double-click a box to open it in place · again to close'}</span>
    </div>
  )
}

export default function Explain(props: { pr: PrView; toast: (m: string, tone?: 'ok' | 'error') => void; prs?: PrView[]; onSelect?: (id: string) => void; lenses?: Lens[]; onTurns?: () => void }) {
  return <ReactFlowProvider><Canvas key={props.pr.id} {...props} /></ReactFlowProvider>
}

/**
 * A stacked PR's explanation builds on the ones below it (it reads them). Shows each with where its explanation
 * stands, and explains the missing or outdated ones bottom up in one click.
 */
function BuildsOn({ pr, prs, onSelect, toast }: { pr: PrView; prs: PrView[]; onSelect?: (id: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const i = pr.stack?.findIndex((s) => s.number === pr.number) ?? -1
  if (i <= 0) return null
  const below = pr.stack!.slice(0, i).map((s) => ({ s, p: prs.find((x) => x.repo === s.repo && x.number === s.number) }))
  const state = (p?: PrView) => !p ? 'untracked' : p.explain?.state === 'running' || p.explain?.state === 'queued' ? 'writing'
    : p.explain?.state === 'done' ? (p.explain.headSha === p.headSha ? 'ok' : 'outdated') : 'none'
  const TONE = { ok: 'bg-ok', writing: 'animate-pulse bg-run', outdated: 'bg-wait', none: 'bg-fill-strong', untracked: 'bg-fill-strong' }
  const LABEL = { ok: 'explained', writing: 'being explained', outdated: 'explained for an older push', none: 'not explained yet', untracked: 'not tracked here' }
  const todo = below.filter(({ p }) => p && state(p) !== 'ok' && state(p) !== 'writing').length
  const go = () => api(`/prs/${enc(pr.id)}/explain-stack`, {}).then(() => toast('Explaining the stack bottom up; this one follows'), (e: Error) => toast(e.message, 'error'))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex shrink-0 items-center gap-1 font-medium text-fg-2 "><Boxes className="size-3.5 text-accent" />Builds on</span>
      {below.map(({ s, p }, n) => (
        <span key={s.number} className="flex shrink-0 items-center gap-1">
          {n > 0 && <ChevronRight className="size-3 text-fg-4" />}
          <button onClick={() => p && onSelect?.(p.id)} disabled={!p} title={`#${s.number} ${s.title}: ${LABEL[state(p)]}`}
                  className="flex items-center gap-1.5 rounded-full bg-surface-1 px-2 py-0.5 font-mono ring-1 ring-line transition-colors hover:text-accent-text disabled:opacity-60">
            <span className={`size-1.5 rounded-full ${TONE[state(p)]}`} />#{s.number}
          </button>
        </span>
      ))}
      {todo > 0 && (
        <button onClick={go} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 font-medium text-accent-text transition-colors hover:bg-accent/15">
          <Sparkles className="size-3" />Explain {todo === 1 ? 'it' : `these ${todo}`} first
        </button>
      )}
    </div>
  )
}

/** The runner's progress line, minus raw shell commands: "Running cd /Users/…" reads as "Reading the code". */
function readableStep(step?: string) {
  if (!step) return 'Updating the explanation'
  return /^Running\b/.test(step) || /[/~]\w/.test(step) ? 'Reading the code' : step
}
