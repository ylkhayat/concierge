import {
  Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowUpRight, Boxes, Briefcase, Cpu, Folder, LoaderCircle, Map as MapIcon, Minimize2, Search, UserRound, X, ZoomIn,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Codebase as Data } from '../../server/explain.ts'
import { api, flowControls, useIsDark, type Health } from '../lib.ts'
import { edgeTypes, layoutTree, nodeTypes, SYSTEM_ICON, viewportFor, type Card, type Link, type TNode } from './Explain.tsx'
import { ago } from '../time.ts'

type Plan = { folders: number; known: number; toMap: number; systems?: boolean; estimateUsd: number; complete: boolean; mapped: boolean }

const MAX_KIDS = 12 // folders shown per open box, busiest first; the rest fold into "+N more"
const MAX_EDGES = 12
const cache = new Map<string, Data>()
const openCache = new Map<string, Set<string>>()

const under = (p: string, root: string) => p === root || p.startsWith(root + '/')

/** The repo as boxes: systems at the top (folders no system owns sit beside them), each opening into its folders. */
function buildTree(d: Data, open: Set<string>): { roots: TNode[]; links: Link[]; parent: Map<string, string> } {
  const parent = new Map<string, string>()
  const kidsOf = (owner: string, path: string): Pick<TNode, 'kids' | 'links'> => {
    const all = [...d.folders[path].children].sort((a, b) => d.folders[b].files - d.folders[a].files)
    const shown = all.slice(0, MAX_KIDS)
    const kids: TNode[] = shown.map((p) => folderNode(p, path, owner))
    if (all.length > shown.length) {
      const id = `${path}#more`
      parent.set(id, owner)
      kids.push({ card: { id, kind: 'more', icon: Boxes, name: `${all.length - shown.length} more`, summary: 'Smaller folders', more: all.length - shown.length } })
    }
    const ids = new Set(shown)
    const links = (d.edges[path] ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)).slice(0, MAX_EDGES)
      .map((e) => ({ from: e.from, to: e.to, label: e.count > 1 ? String(e.count) : undefined, weight: e.count }))
    return { kids, links }
  }
  const folderNode = (p: string, within: string, owner: string): TNode => {
    const f = d.folders[p]
    parent.set(p, owner)
    const canOpen = f.children.length > 0
    const isOpen = canOpen && open.has(p)
    const card: Card = {
      id: p, kind: 'dir', icon: Folder, name: p.slice(within ? within.length + 1 : 0), sub: `${f.files} files`, summary: f.summary, plain: true, path: p, unmapped: !f.summary,
      expandPath: canOpen ? p : undefined, expanded: isOpen,
      ...(!isOpen && canOpen && { inner: [...f.children].sort((a, b) => d.folders[b].files - d.folders[a].files).slice(0, 3).map((c) => ({ name: c.slice(p.length + 1), count: d.folders[c].files, mark: 'contains' as const })) }),
    }
    return isOpen ? { card, ...kidsOf(p, p) } : { card }
  }

  const systems = d.skeleton?.systems ?? []
  const roots: TNode[] = systems.map((s) => {
    const entry = s.paths.find((p) => d.folders[p])
    const isOpen = !!entry && open.has(s.id)
    const files = s.paths.reduce((n, p) => n + (d.folders[p]?.files ?? 0), 0)
    const card: Card = {
      id: s.id, kind: 'system', icon: SYSTEM_ICON[s.kind] ?? Boxes, name: s.name, sub: s.paths.join(' · '), summary: s.summary, plain: true,
      path: entry, expandPath: entry && d.folders[entry].children.length ? entry : undefined, expanded: isOpen, files,
      ...(!isOpen && entry && { inner: [...d.folders[entry].children].sort((a, b) => d.folders[b].files - d.folders[a].files).slice(0, 3).map((c) => ({ name: c.slice(entry.length + 1), count: d.folders[c].files, mark: 'contains' as const })) }),
    }
    return isOpen ? { card, ...kidsOf(s.id, entry!) } : { card }
  })
  // top-level folders no system claims (docs, scripts…) still belong on the map
  const owned = systems.flatMap((s) => s.paths)
  for (const p of d.folders[''].children) {
    if (owned.some((o) => under(o, p) || under(p, o))) continue
    const f = d.folders[p]
    if (f.children.length || f.files >= 10) roots.push(folderNode(p, '', ''))
  }
  // system wiring: the skeleton's runtime links, plus import counts between systems
  const sysOf = (p: string) => systems.find((s) => s.paths.some((sp) => under(p, sp)))?.id
  const links = new Map<string, Link>()
  for (const e of d.skeleton?.edges ?? []) if (systems.some((s) => s.id === e.from) && systems.some((s) => s.id === e.to)) links.set(`${e.from}>${e.to}`, { from: e.from, to: e.to, label: e.label, weight: 2 })
  for (const e of d.systemEdges) {
    const a = sysOf(e.from), b = sysOf(e.to)
    if (!a || !b || a === b) continue
    const k = `${a}>${b}`
    links.set(k, { from: a, to: b, label: links.get(k)?.label ?? `${e.count} imports`, weight: (links.get(k)?.weight ?? 0) + e.count })
  }
  return { roots, links: [...links.values()], parent }
}

function businessTree(d: Data): { roots: TNode[]; links: Link[] } {
  const systems = d.skeleton?.systems ?? []
  const roots: TNode[] = [
    ...(d.skeleton?.actors ?? []).map((a) => ({ card: { id: a.id, kind: 'actor' as const, icon: UserRound, name: a.name, summary: a.description, plain: true } })),
    ...systems.map((s) => ({ card: { id: s.id, kind: 'system' as const, icon: SYSTEM_ICON[s.kind] ?? Boxes, name: s.name, summary: s.businessRole || s.summary, plain: true, path: s.paths[0] } })),
  ]
  const ids = new Set(roots.map((r) => r.card.id))
  return { roots, links: (d.skeleton?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to, label: e.label, weight: 1 })) }
}

function Map_({ repo, repos, onRepo, health, toast }: {
  repo: string; repos: string[]; onRepo: (r: string) => void; health?: Health; toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const [d, setD] = useState<Data | null | undefined>(() => cache.get(repo))
  const [business, setBusiness] = useState(false)
  const [open, setOpenState] = useState<Set<string>>(() => openCache.get(repo) ?? new Set())
  const setOpen = (fn: (p: Set<string>) => Set<string>) => setOpenState((p) => { const n = fn(p); openCache.set(repo, n); return n })
  const [selected, setSelected] = useState<string>()
  const [query, setQuery] = useState('')
  const [nodes, setNodes] = useState<Node<Card>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [ready, setReady] = useState(false)
  const rf = useReactFlow()
  const dark = useIsDark()
  const canvas = useRef<HTMLDivElement>(null)
  const focus = useRef<string>(undefined)
  const first = useRef(true)
  const task = health?.base?.[repo]
  const mapping = task?.state === 'running' || task?.state === 'queued'

  // refetch as each batch of 40 lands, so the map fills in while you watch
  const batch = Math.floor((task?.done ?? 0) / 40)
  useEffect(() => {
    api(`/codebase?repo=${encodeURIComponent(repo)}`).then((x: Data) => { cache.set(repo, x); setD(x) }, () => setD(null))
  }, [repo, batch, task?.endedAt])
  const [plan, setPlan] = useState<Plan>()
  useEffect(() => {
    if (!mapping) api(`/base/plan?repo=${encodeURIComponent(repo)}`).then(setPlan).catch(() => {})
  }, [repo, mapping, task?.endedAt])
  const startMap = (under?: string) => api('/base', { repo, action: 'start', ...(under && { under }) }).then(
    () => toast(under ? `Mapping deeper into ${under}` : `Mapping ${repo}`), (e: Error) => toast(e.message, 'error'))
  const stopMap = () => api('/base', { repo, action: 'cancel' }).then(() => toast('Mapping stopped; finished folders are kept'))

  const tree = useMemo(() => (d ? (business ? { ...businessTree(d), parent: new Map<string, string>() } : buildTree(d, open)) : undefined), [d, open, business])

  useEffect(() => {
    if (!tree) return
    let live = true
    layoutTree(tree.roots, tree.links).then(({ nodes, edges: links, routes }) => {
      if (!live) return
      setNodes(nodes)
      const ids = new Set(nodes.map((n) => n.id))
      setEdges(links.filter((l) => ids.has(l.from) && ids.has(l.to)).map((l) => {
        const route = routes.get(`${l.from}>${l.to}`)
        return {
          id: `${l.from}>${l.to}`, source: l.from, target: l.to, label: l.label, zIndex: 5,
          ...(route ? { type: 'elk', data: { points: route.points, label: route.label } } : { type: 'smoothstep' }),
          style: { stroke: 'rgb(139 92 246 / 0.55)', strokeWidth: Math.min(1 + Math.log2(l.weight + 1) / 2, 2.5) },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgb(139 92 246 / 0.7)' },
        }
      }))
      requestAnimationFrame(() => {
        if (!canvas.current || !nodes.length) return
        rf.setViewport(viewportFor(nodes, canvas.current, { focus: focus.current }), { duration: first.current ? 0 : 420 })
        focus.current = undefined
        if (first.current) { first.current = false; requestAnimationFrame(() => setReady(true)) }
      })
    })
    return () => { live = false }
  }, [tree, rf])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id); for (const k of [...next]) for (let p = tree?.parent.get(k); p; p = tree?.parent.get(p)) if (p === id) { next.delete(k); break } }
      else { next.add(id); focus.current = id }
      return next
    })
  }, [tree]) // eslint-disable-line react-hooks/exhaustive-deps

  // jump to a folder: open every box on the way down, then select it
  const reveal = (path: string) => {
    if (!d) return
    const sys = d.skeleton?.systems.find((s) => s.paths.some((p) => under(path, p)))
    const entry = sys?.paths.find((p) => d.folders[p])
    const chain: string[] = []
    for (let p = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; p && (!entry || p.length > entry.length); p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') if (d.folders[p]) chain.push(p)
    setBusiness(false)
    setOpen((prev) => new Set([...prev, ...(sys && entry && path !== entry ? [sys.id] : []), ...chain]))
    focus.current = path === entry && sys ? sys.id : path
    setSelected(path === entry && sys ? sys.id : path)
    setQuery('')
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!d || q.length < 2) return []
    return Object.entries(d.folders).filter(([p, f]) => p && (p.toLowerCase().includes(q) || f.summary?.toLowerCase().includes(q)))
      .sort((a, b) => Number(b[0].toLowerCase().includes(q)) - Number(a[0].toLowerCase().includes(q)) || a[0].length - b[0].length).slice(0, 8)
  }, [d, query])

  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const card = nodes.find((n) => n.id === selected)?.data
  const info = card?.path ? d?.folders[card.path] : undefined
  const sha = d?.meta.sha

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-5 pb-5 pt-5 lg:px-7 lg:pb-6 lg:pt-6 2xl:px-10 2xl:pb-8 2xl:pt-8">
      {/* heading, like a PR's: what you are looking at, and at which commit */}
      <header className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-body text-fg-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-meta font-medium text-accent-text ring-1 ring-inset ring-accent/20"><MapIcon className="size-3" />Codebase map</span>
          {d && <span className="font-mono text-small">{d.meta.branch} @ {d.meta.sha.slice(0, 7)}</span>}
          {d && <span className="text-small">· {d.meta.folders} folders · mapped {ago(d.meta.mappedAt)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold tracking-tight text-fg-1 2xl:text-[26px] ">{repo}</h1>
        </div>
      </header>

      {/* the map lives in a card, like a PR's tabs */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-surface-1 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-line ">
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-3 py-2 ">
        {d && (
          <div className="relative grid grid-cols-2 rounded-xl bg-fill p-1">
            <span className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-surface-1 shadow-sm transition-transform duration-300 ease-[var(--ease-snappy)]" style={{ transform: business ? undefined : 'translateX(100%)' }} />
            {([[true, Briefcase, 'Business'], [false, Cpu, 'Technical']] as const).map(([b, Icon, label]) => (
              <button key={label} onClick={() => { setBusiness(b); setSelected(undefined) }}
                      className={`relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1 text-small font-semibold transition-colors ${business === b ? 'text-fg-1 ' : 'text-fg-3 hover:text-fg-1'}`}>
                <Icon className={`size-3.5 ${business === b ? 'text-accent' : ''}`} />{label}
              </button>
            ))}
          </div>
        )}
        {d && !business && open.size > 0 && (
          <button onClick={() => setOpen(() => new Set())} title="Close every box" className="rounded-lg p-1.5 text-fg-3 transition-colors hov hover:text-fg-1"><Minimize2 className="size-4" /></button>
        )}
        <span className="flex-1" />
        {d && (
          <div className="relative">
            <label className="flex w-72 items-center gap-2 rounded-xl bg-fill/60 px-3 py-1.5 text-body ring-1 ring-line transition-all hover:ring-line-strong focus-within:ring-2 focus-within:ring-accent/60 ">
              <Search className="size-3.5 text-fg-3" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a folder or what it does" className="w-full bg-transparent outline-none placeholder:text-fg-3"
                     onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) reveal(results[0][0]); if (e.key === 'Escape') setQuery('') }} />
            </label>
            {results.length > 0 && (
              <div className="absolute right-0 top-full z-30 mt-1.5 w-96 overflow-hidden rounded-xl bg-surface-1 shadow-xl ring-1 ring-line ">
                {results.map(([p, f]) => (
                  <button key={p} onClick={() => reveal(p)} className="block w-full px-3 py-2 text-left transition-colors hover:bg-hover">
                    <div className="truncate font-mono text-small">{p}</div>
                    {f.summary && <div className="truncate text-meta text-fg-3">{f.summary}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>
      {d && (mapping || (plan && (plan.toMap > 0 || plan.systems))) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-accent/4 px-4 py-2 text-small text-fg-2 ">
          <MapIcon className="size-3.5 shrink-0 text-accent" />
          {mapping ? (
            <>
              <span className="shrink-0 font-medium">{task?.under ? `Mapping deeper into ${task.under}` : 'Mapping the codebase'}</span>
              <span className="min-w-0 truncate text-fg-3">{task?.step}</span>
              <span className="flex min-w-28 max-w-64 flex-1 items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill-strong">
                  <span className="block h-full rounded-full bg-accent transition-all duration-700 ease-[var(--ease-snappy)]" style={{ width: `${task?.total ? Math.max(3, Math.round(((task.done ?? 0) / task.total) * 100)) : 3}%` }} />
                </span>
                <span className="shrink-0 font-mono text-micro tabular-nums text-fg-3">{task?.total ? `${task.done}/${task.total}` : '…'}</span>
              </span>
              <span className="font-mono text-micro text-fg-3">${(task?.costUsd ?? 0).toFixed(2)}</span>
              <button onClick={stopMap} className="ml-auto font-medium text-fg-3 underline-offset-2 hover:text-fail-text hover:underline">Stop</button>
            </>
          ) : plan && (
            <>
              <span>{!plan.toMap
                ? <><span className="font-medium">The system map needs redrawing:</span> it groups this repo's apps and libraries too coarsely.</>
                : plan.complete
                ? <><span className="font-medium">{plan.toMap} folder{plan.toMap === 1 ? '' : 's'} changed</span> on {d.meta.branch} since this map.</>
                : <><span className="font-medium">Partly mapped:</span> {plan.known} of {plan.folders} folders, {plan.toMap} to go.</>}</span>
              <button onClick={() => startMap()} className="ml-auto rounded-lg bg-accent px-2.5 py-1 font-medium text-on-accent transition-all hover:bg-accent">
                {!plan.toMap ? 'Redraw systems' : plan.complete ? 'Update' : 'Finish mapping'} · ~${plan.estimateUsd.toFixed(2)}
              </button>
            </>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div ref={canvas} className="relative min-w-0 flex-1">
          {d === undefined ? (
            <div className="flex h-full items-center justify-center gap-2 text-body text-fg-3"><LoaderCircle className="size-4 animate-spin text-accent" />Loading the map…</div>
          ) : d === null ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent text-white shadow-lg shadow-accent/30"><MapIcon className="size-7" /></span>
              <div>
                <p className="font-semibold">{mapping ? 'Mapping this codebase' : `${repo} isn’t mapped yet`}</p>
                <p className="mt-1 max-w-sm text-body text-fg-3">{mapping ? (task?.step ?? 'Getting started') + (task?.total ? ` · ${task.done}/${task.total} folders` : '') : 'Map its default branch once to browse every system and folder, and to explain PRs against the whole picture.'}</p>
              </div>
              {!mapping && (
                <button onClick={() => api('/base', { repo, action: 'start' }).then(() => toast(`Mapping ${repo}`), (e: Error) => toast(e.message, 'error'))}
                        className="inline-flex items-center gap-1.5 btn-primary btn-lg shadow-sm transition-all">
                  <MapIcon className="size-4" />Map the codebase
                </button>
              )}
            </div>
          ) : (
            <ReactFlow
              style={{ opacity: ready ? 1 : 0, transition: 'opacity 220ms ease-out' }}
              nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodeClick={(_, n) => { clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => setSelected(n.id), 220) }}
              onNodeDoubleClick={(e, n) => { e.stopPropagation(); clearTimeout(clickTimer.current); if (!business && n.data.expandPath) toggle(n.id) }}
              onPaneClick={() => { clearTimeout(clickTimer.current); setSelected(undefined) }}
              zoomOnDoubleClick={false} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
              colorMode={dark ? 'dark' : 'light'}
              minZoom={0.6} maxZoom={1.5} proOptions={{ hideAttribution: true }} className="!bg-transparent">
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="!bg-transparent opacity-60" />
              <Controls showInteractive={false} className={flowControls} />
            </ReactFlow>
          )}
          {d && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-8rem)] -translate-x-1/2 truncate whitespace-nowrap rounded-full bg-white/90 px-3 py-1 text-micro text-fg-3 shadow-sm ring-1 ring-line backdrop-blur dark:bg-zinc-900/90 ">
              {business ? 'who uses what · click a box for its role' : 'double-click a box to open it in place · search to jump to any folder'}
            </div>
          )}
        </div>

        {card && card.kind !== 'more' && (
          <aside className="flex w-[320px] shrink-0 animate-[toast-in_200ms_var(--ease-snappy)] flex-col overflow-hidden border-l border-line bg-white/90 backdrop-blur dark:bg-zinc-900/80">
            <header className="flex items-start gap-2 border-b border-line p-4 ">
              <card.icon className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-reading font-semibold">{card.name}</h3>
                <p className="truncate font-mono text-micro text-fg-3">{card.kind === 'system' ? card.sub : card.path}</p>
              </div>
              <button onClick={() => setSelected(undefined)} className="rounded-md p-1 text-fg-3 transition-colors hov hover:text-fg-2 " aria-label="Close"><X className="size-3.5" /></button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-body leading-relaxed">
              <p className="text-fg-2 ">{card.summary ?? <span className="italic text-fg-3">Not mapped yet</span>}</p>
              {(info?.businessRole || (card.kind === 'system' && d?.skeleton?.systems.find((s) => s.id === card.id)?.businessRole)) && (
                <p className="flex gap-1.5 text-fg-3"><Briefcase className="mt-0.5 size-3.5 shrink-0" />{info?.businessRole ?? d?.skeleton?.systems.find((s) => s.id === card.id)?.businessRole}</p>
              )}
              {!!info?.responsibilities?.length && (
                <section className="space-y-1.5">
                  <h4 className="labelr text-fg-3">Responsibilities</h4>
                  <ul className="list-disc space-y-0.5 pl-4 text-fg-2">{info.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>
                </section>
              )}
              {info && info.deeper > 0 && !business && (
                <DeeperCard repo={repo} path={card.path!} count={info.deeper} busy={mapping} active={mapping && task?.under === card.path} onMap={() => startMap(card.path)} />
              )}
              {info && (
                <dl className="grid grid-cols-2 gap-2 text-small">
                  <div className="rounded-xl bg-fill/60 p-2.5"><dt className="text-fg-3">Files</dt><dd className="text-reading font-semibold tabular-nums">{info.files}</dd></div>
                  <div className="rounded-xl bg-fill/60 p-2.5"><dt className="text-fg-3">Folders</dt><dd className="text-reading font-semibold tabular-nums">{info.children.length}</dd></div>
                </dl>
              )}
            </div>
            <footer className="flex gap-2 border-t border-line p-3 ">
              {!business && card.expandPath && (
                <button onClick={() => toggle(card.id)} className="flex flex-1 items-center justify-center gap-1.5 btn-primary transition-all hover:bg-accent">
                  {card.expanded ? <><Minimize2 className="size-3.5" />Close box</> : <><ZoomIn className="size-3.5" />Open box</>}
                </button>
              )}
              {card.path && sha && (
                <a href={`https://github.com/${repo}/tree/${sha}/${card.path}`} target="_blank" rel="noreferrer"
                   className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-small font-medium text-fg-2 ring-1 ring-line-strong transition-all hover:text-fg-1">GitHub<ArrowUpRight className="size-3.5" /></a>
              )}
            </footer>
          </aside>
        )}
      </div>
      </section>
    </div>
  )
}

/** Folders below this one that the map doesn't cover yet, and what mapping them would cost. */
function DeeperCard({ repo, path, count, busy, active, onMap }: { repo: string; path: string; count: number; busy: boolean; active: boolean; onMap: () => void }) {
  const [est, setEst] = useState<number>()
  useEffect(() => {
    api(`/base/plan?repo=${encodeURIComponent(repo)}&under=${encodeURIComponent(path)}`).then((p: Plan) => setEst(p.estimateUsd)).catch(() => {})
  }, [repo, path])
  return (
    <section className="space-y-2 rounded-xl border border-dashed border-accent/40 bg-accent/4 p-3">
      <p className="text-small text-fg-2 ">
        <span className="font-semibold text-fg-1 ">{count} subfolder{count === 1 ? '' : 's'}</span> below this one aren’t mapped yet.
      </p>
      {active ? (
        <p className="flex items-center gap-1.5 text-small text-accent-text"><LoaderCircle className="size-3.5 animate-spin" />Mapping them now…</p>
      ) : (
        <button onClick={onMap} disabled={busy} title={busy ? 'Another map is running; this one can start after it' : undefined}
                className="inline-flex items-center gap-1.5 btn-primary btn-sm transition-all hover:bg-accent disabled:pointer-events-none disabled:opacity-40">
          <MapIcon className="size-3.5" />Map deeper{est != null && ` · ~$${est.toFixed(2)}`}
        </button>
      )}
    </section>
  )
}

export default function CodebaseView(props: { repo: string; repos: string[]; onRepo: (r: string) => void; health?: Health; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  return <ReactFlowProvider><Map_ key={props.repo} {...props} /></ReactFlowProvider>
}
