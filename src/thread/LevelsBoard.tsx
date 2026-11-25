// The Understanding and Intent boards, drawn the same way: lanes across the board (Understanding: the dimension a change
// is to; Intent: why → what was decided → before and now → what to watch), the map's cards in them, wired by cause.
// Understanding has a meter: the PR at one of five depths (server/levels.ts), from its purpose to each file; it opens at 3.
// A lane the PR leaves alone stays as a thin band saying so: knowing what didn't change is half of feeling safe.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DIMS, linksAt, visibleAt, type Dim, type Levels } from '../../server/levels.ts'

/** A card on a board: a change said in words. strong: the one the lane is about; faded: set aside. */
export type Card = { id: string; title: string; line?: string; before?: string; why?: string; tone?: 'strong' | 'faded' | 'ok' | 'wait' | 'bad'; more?: string[] }
export type Lane = { id: string; label: string; hint: string; hue: number; cards: Card[]; skip?: boolean } // skip: an empty lane isn't drawn

const W = 270, H = 104, GAP = 20, PAD = 14, HEAD = 30, THIN = 34
const said = (x?: string) => x?.replace(/`([^`]+)`/g, '$1')
const laneTint = (hue: number, pct: number) => `color-mix(in oklch, oklch(0.7 0.12 ${hue}) ${pct}%, transparent)`

const In = () => <Handle type="target" position={Position.Left} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const Out = () => <Handle type="source" position={Position.Right} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />

type CardData = { c: Card; hue: number; on: boolean; pick: (id: string) => void }
/** The map's card: a title, a line of what is true now, and what the tone says (new, changed, set aside). */
function CardNode({ data: { c, hue, on, pick } }: NodeProps<Node<CardData>>) {
  const strong = c.tone === 'strong'
  return (
    <button type="button" onClick={() => pick(c.id)} style={{ width: W, height: H, ...(strong && { backgroundColor: `color-mix(in oklch, oklch(0.7 0.12 ${hue}) 14%, var(--surface-1))` }) }}
            className={`nodrag flex flex-col rounded-card p-3 text-left transition-shadow ${strong ? '' : 'bg-surface-1'} ${c.tone === 'faded' ? 'opacity-55' : ''} ${on ? 'shadow-[0_0_0_2px_var(--lane),var(--e2)]' : 'shadow-[var(--e1)] ring-1 ring-line hover:ring-line-strong'}`}>
      <In /><Out />
      <p className="flex min-w-0 items-center gap-1.5">
        {c.tone && c.tone !== 'strong' && c.tone !== 'faded' && <span className={`size-1.5 shrink-0 rounded-full ${c.tone === 'ok' ? 'bg-ok' : c.tone === 'wait' ? 'bg-wait' : 'bg-fail'}`} />}
        <span className={`truncate text-small font-semibold text-fg-1 ${c.tone === 'faded' ? 'line-through decoration-fg-4/50' : ''}`} title={said(c.title)}>{said(c.title)}</span>
      </p>
      {c.line && <p className="mt-1 line-clamp-3 text-meta leading-snug text-fg-2">{said(c.line)}</p>}
      {!!c.more?.length && <p className="mt-auto text-micro tabular-nums text-fg-4">{c.more.length} inside</p>}
    </button>
  )
}
/** A lane: a band across the board, its name and what it holds at its head; empty, a thin band saying so. */
function LaneNode({ data: { lane, width, none } }: NodeProps<Node<{ lane: Lane; width: number; none: boolean }>>) {
  return (
    <div style={{ width, height: none ? THIN : HEAD + H + 2 * PAD, backgroundColor: laneTint(lane.hue, none ? 3 : 7), borderColor: laneTint(lane.hue, none ? 14 : 28) }}
         className={`rounded-card border ${none ? 'border-dashed' : ''}`}>
      <p className="flex h-[30px] items-center gap-2 px-3">
        <span className="size-2 rounded-full" style={{ backgroundColor: `oklch(0.7 0.12 ${lane.hue})` }} />
        <span className="label text-fg-2">{lane.label}</span>
        <span className="truncate text-micro text-fg-4">{none ? 'unchanged' : lane.hint}</span>
      </p>
    </div>
  )
}
const nodeTypes = { card: CardNode, lane: LaneNode }

/** Lanes stacked down the board, cards left to right in each; a click opens a card's whole story on the side. */
export function LaneBoard({ lanes, links, children }: { lanes: Lane[]; links: [string, string][]; children?: React.ReactNode }) {
  const [on, setOn] = useState<string>()
  const pick = (id: string) => setOn((o) => (o === id ? undefined : id))
  const { nodes, edges } = useMemo(() => {
    const width = Math.max(3, ...lanes.map((l) => l.cards.length)) * (W + GAP) - GAP + 2 * PAD
    const out: Node[] = []
    let y = 0
    for (const lane of lanes.filter((l) => !(l.skip && !l.cards.length))) {
      const none = !lane.cards.length
      out.push({ id: `lane:${lane.id}`, type: 'lane', position: { x: 0, y }, data: { lane, width, none }, draggable: false, selectable: false, zIndex: -1 })
      lane.cards.forEach((c, k) => out.push({ id: c.id, type: 'card', position: { x: PAD + k * (W + GAP), y: y + HEAD + PAD }, data: { c, hue: lane.hue, on: on === c.id, pick }, draggable: false }))
      y += (none ? THIN : HEAD + H + 2 * PAD) + 12
    }
    // room under the last lane for what floats over the board's foot (the meter)
    if (children) out.push({ id: 'foot', type: 'lane', position: { x: 0, y: y + 50 }, data: { lane: lanes[0], width: 1, none: true }, style: { opacity: 0 }, draggable: false, selectable: false })
    const ids = new Set(lanes.flatMap((l) => l.cards.map((c) => c.id)))
    const edges: Edge[] = links.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => ({ id: `${a}>${b}`, source: a, target: b, type: 'smoothstep', animated: true, zIndex: 1, style: { stroke: 'color-mix(in oklch, var(--lane) 55%, transparent)', strokeWidth: 1.5 } }))
    return { nodes: out, edges }
  }, [lanes, links, on]) // eslint-disable-line react-hooks/exhaustive-deps
  const rf = useReactFlow()
  const shape = lanes.map((l) => `${l.id}:${l.cards.map((c) => c.id).join()}`).join('|')
  useEffect(() => { const t = setTimeout(() => void rf.fitView({ padding: 0.06, maxZoom: 1, duration: 250 }), 30); return () => clearTimeout(t) }, [shape, rf])
  const sel = lanes.flatMap((l) => l.cards).find((c) => c.id === on)
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.06, maxZoom: 1 }} minZoom={0.5} maxZoom={1.6}
                   nodesConnectable={false} elementsSelectable={false} onNodeClick={() => {}} onPaneClick={() => setOn(undefined)} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
        </ReactFlow>
        {children}
      </div>
      {sel && (
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-card bg-surface-1 ring-1 ring-line">
          <p className="flex items-center gap-2 border-b border-line px-3 py-2 text-small font-semibold text-fg-1"><span className="min-w-0 flex-1">{said(sel.title)}</span>
            <button onClick={() => setOn(undefined)} aria-label="Close" className="text-fg-4 hover:text-fg-1"><X className="size-3.5" /></button></p>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
            {sel.before && <div><p className="label text-fg-4">Before</p><p className="text-small leading-snug text-fg-3">{said(sel.before)}</p></div>}
            {sel.line && <div><p className="label text-[var(--lane)]">{sel.before ? 'Now' : 'What'}</p><p className="text-small leading-snug text-fg-1">{said(sel.line)}</p></div>}
            {sel.why && <div><p className="label text-fg-4">Why</p><p className="text-small leading-snug text-fg-2">{said(sel.why)}</p></div>}
            {!!sel.more?.length && <div><p className="label text-fg-4">Inside, one level deeper</p><ul className="mt-0.5 space-y-0.5">{sel.more.map((m) => <li key={m} className="text-small text-fg-2">{said(m)}</li>)}</ul></div>}
          </div>
        </aside>
      )}
    </div>
  )
}

// --- Understanding: the levels ----------------------------------------------------------------------------------

const STOPS = [['Purpose', 'what it is for'], ['Capabilities', 'what it makes possible'], ['Parts', 'what changed'], ['Mechanics', 'how it works'], ['Code', 'each file']] as const
const DIM: Record<Dim, { label: string; hint: string; hue: number }> = {
  behaviour: { label: 'Behaviour', hint: 'what a user or caller notices', hue: 250 },
  data: { label: 'Data', hint: 'what is stored or sent', hue: 160 },
  contract: { label: 'Contract', hint: 'APIs and messages between parts', hue: 300 },
  logic: { label: 'Logic', hint: 'rules and decisions', hue: 210 },
  wiring: { label: 'Wiring', hint: 'config, dependencies, environments', hue: 60 },
  security: { label: 'Security', hint: 'access, secrets, privacy', hue: 20 },
  safety: { label: 'Safety net', hint: 'tests and checks', hue: 120 },
}
const remembered = (prId: string) => { try { const v = Number(localStorage.getItem(`levels:${prId}`)); return v >= 1 && v <= 5 ? v : 3 } catch { return 3 } }
/** A file's card is titled by what it is, never its name: the model's words, else the start of what it does now. */
const titleOf = (n: Levels['nodes'][number]) => n.path && (!n.title || n.title.includes('.') || n.title === n.path.split('/').pop()) ? (said(n.after) ?? '').split(/[.:;,(]/)[0].split(' ').slice(0, 6).join(' ') : n.title

/** The meter: five stops on a track, how deep the board goes; floats over the board's foot. */
function Meter({ level, set }: { level: number; set: (l: number) => void }) {
  return (
    <div role="radiogroup" aria-label="How deep to explain" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-card bg-surface-1/95 px-4 py-2.5 shadow-[var(--e2)] ring-1 ring-line backdrop-blur">
      <span className="label text-fg-4">General</span>
      <div className="relative flex items-start">
        <span className="absolute left-[14px] right-[14px] top-[9px] h-0.5 rounded-full bg-line" />
        <span className="absolute left-[14px] top-[9px] h-0.5 rounded-full bg-[var(--lane)] transition-all duration-300" style={{ width: `calc((100% - 28px) * ${(level - 1) / 4})` }} />
        {STOPS.map(([name, hint], k) => {
          const at = level === k + 1, past = level > k + 1
          return (
            <button key={name} role="radio" aria-checked={at} onClick={() => set(k + 1)} title={hint} className="group relative flex w-[84px] flex-col items-center gap-1">
              <span className={`flex size-5 items-center justify-center rounded-full text-micro font-semibold tabular-nums transition-all ${at ? 'scale-110 bg-[var(--lane)] text-white shadow-[0_0_0_4px_color-mix(in_oklch,var(--lane)_22%,transparent)]' : past ? 'bg-[var(--lane)] text-white' : 'bg-surface-1 text-fg-3 ring-1 ring-line-strong group-hover:ring-[var(--lane)]'}`}>{k + 1}</span>
              <span className={`text-micro ${at ? 'font-semibold text-fg-1' : 'text-fg-3 group-hover:text-fg-1'}`}>{name}</span>
            </button>
          )
        })}
      </div>
      <span className="label text-fg-4">Detailed</span>
    </div>
  )
}

export function LevelsBoard({ prId, levels }: { prId: string; levels: Levels }) {
  const [level, setLevel] = useState(() => remembered(prId))
  const set = (l: number) => { setLevel(l); try { localStorage.setItem(`levels:${prId}`, String(l)) } catch { /* not kept */ } }
  const { lanes, links } = useMemo(() => {
    const shown = visibleAt(levels, level)
    const kids = (id: string) => levels.nodes.filter((n) => n.parent === id).map(titleOf)
    const order = new Map(levels.nodes.map((n, k) => [n.id, k]))
    const rank = (n: Levels['nodes'][number]) => (n.path ? (order.get(n.parent ?? '') ?? 0) + order.get(n.id)! / 1e4 : order.get(n.id)!)
    const lanes: Lane[] = DIMS.map((d) => ({ id: d, ...DIM[d], cards: shown.filter((n) => n.dim === d).sort((a, b) => rank(a) - rank(b)).map((n) => ({
      id: n.id, title: titleOf(n), line: n.after, before: n.before, why: n.why, more: kids(n.id), tone: n.level === 1 ? 'strong' as const : undefined,
    })) }))
    return { lanes, links: linksAt(levels, level) }
  }, [levels, level])
  return <LaneBoard lanes={lanes} links={links}><Meter level={level} set={set} /></LaneBoard>
}
