// The Understanding board with its meter: the PR at one of five depths (server/levels.ts), its boxes sorted into rows by
// the dimension they change. 1 is one box (its purpose), 5 is the files; it opens at 3. A dimension the PR leaves alone
// stays as a thin row saying so: knowing what didn't change is half of feeling safe about a PR.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useState } from 'react'
import { DIMS, linksAt, visibleAt, type Dim, type LevelNode, type Levels } from '../../server/levels.ts'

const STOPS = ['Purpose', 'Capabilities', 'Parts', 'Mechanics', 'Code'] as const
const DIM: Record<Dim, { label: string; hint: string; hue: number }> = {
  behaviour: { label: 'Behaviour', hint: 'what a user or caller notices', hue: 250 },
  data: { label: 'Data', hint: 'what is stored or sent', hue: 160 },
  contract: { label: 'Contract', hint: 'APIs and messages between parts', hue: 300 },
  logic: { label: 'Logic', hint: 'rules and decisions', hue: 210 },
  wiring: { label: 'Wiring', hint: 'config, dependencies, environments', hue: 60 },
  security: { label: 'Security', hint: 'access, secrets, privacy', hue: 20 },
  safety: { label: 'Safety net', hint: 'tests and checks', hue: 120 },
}
const tint = (d: Dim, l = 0.7) => `oklch(${l} 0.12 ${DIM[d].hue})`
const W = 290, H = 148, GAP = 28, LABEL_W = 150, THIN = 34

const In = () => <Handle type="target" position={Position.Left} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const Out = () => <Handle type="source" position={Position.Right} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />

/** A box: a change, said at its level. Deep levels say before → after; the top ones just what is true now. */
function BoxNode({ data: n }: NodeProps<Node<LevelNode>>) {
  const said = [n.before && `Before: ${n.before}`, `Now: ${n.after}`, n.why && `Why: ${n.why}`].filter(Boolean).join('\n')
  return (
    <div title={said} style={{ width: W, height: H, borderColor: tint(n.dim, 0.6) }} className="card flex flex-col gap-1 overflow-hidden border-l-[3px] px-3 py-2.5 text-left">
      <In /><Out />
      <p className={`line-clamp-2 font-semibold leading-snug text-fg-1 ${n.level === 1 ? 'text-body' : 'text-small'} ${n.path ? 'font-mono' : ''}`}>{n.title}</p>
      {n.level >= 3 && n.before && <p className="line-clamp-1 text-meta leading-snug text-fg-4 line-through decoration-fg-4/40">{n.before}</p>}
      <p className={`text-small leading-snug text-fg-2 ${n.level >= 3 ? 'line-clamp-2' : 'line-clamp-4'}`}>{n.after}</p>
      {n.level >= 3 && n.why && <p className="mt-auto line-clamp-1 text-meta text-fg-3">{n.why}</p>}
    </div>
  )
}
/** A dimension's name at the start of its row; a dimension left alone says so. */
function RowNode({ data }: NodeProps<Node<{ dim: Dim; none: boolean }>>) {
  const d = DIM[data.dim]
  return (
    <div style={{ width: LABEL_W }} className={`text-left ${data.none ? 'opacity-50' : ''}`}>
      <p className="flex items-center gap-1.5 text-small font-semibold text-fg-1"><span className="size-2 rounded-full" style={{ backgroundColor: tint(data.dim) }} />{d.label}</p>
      <p className="text-micro leading-snug text-fg-3">{data.none ? 'unchanged' : d.hint}</p>
    </div>
  )
}
const nodeTypes = { box: BoxNode, row: RowNode }

const remembered = (prId: string) => { try { const v = Number(localStorage.getItem(`levels:${prId}`)); return v >= 1 && v <= 5 ? v : 3 } catch { return 3 } }

export function LevelsBoard({ prId, levels }: { prId: string; levels: Levels }) {
  const [level, setLevel] = useState(() => remembered(prId))
  const set = (l: number) => { setLevel(l); try { localStorage.setItem(`levels:${prId}`, String(l)) } catch { /* not kept */ } }
  const { nodes, edges } = useMemo(() => {
    const shown = visibleAt(levels, level)
    // a box's place in its row: the model's order, a file kept next to its siblings under the same parent
    const order = new Map(levels.nodes.map((n, k) => [n.id, k]))
    const rank = (n: LevelNode) => (n.path ? (order.get(n.parent ?? '') ?? 0) + order.get(n.id)! / 1e4 : order.get(n.id)!)
    const out: Node[] = []
    let y = 0
    for (const dim of DIMS) {
      const row = shown.filter((n) => n.dim === dim).sort((a, b) => rank(a) - rank(b))
      out.push({ id: `row:${dim}`, type: 'row', position: { x: -LABEL_W - GAP, y: row.length ? H / 2 - 18 + y : y }, data: { dim, none: !row.length }, draggable: false, selectable: false })
      row.forEach((n, k) => out.push({ id: n.id, type: 'box', position: { x: k * (W + GAP), y }, data: n, draggable: false }))
      y += row.length ? H + GAP : THIN
    }
    const edges: Edge[] = linksAt(levels, level).map(([a, b]) => ({ id: `${a}>${b}`, source: a, target: b, type: 'smoothstep', animated: true, style: { stroke: 'var(--line-strong)', strokeWidth: 1.5 } }))
    return { nodes: out, edges }
  }, [levels, level])
  const rf = useReactFlow()
  useEffect(() => { const t = setTimeout(() => void rf.fitView({ padding: 0.08, maxZoom: 1, duration: 250 }), 30); return () => clearTimeout(t) }, [level, rf])
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08, maxZoom: 1 }} minZoom={0.5} maxZoom={1.6}
                 nodesConnectable={false} elementsSelectable={false} onNodeClick={() => {}} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
      </ReactFlow>
      {/* the meter: how deep the board goes, from what it is for to the files */}
      <div role="radiogroup" aria-label="How deep to explain" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface-1 p-1 shadow-[var(--e2)] ring-1 ring-line-strong">
        <span className="px-2 text-micro text-fg-4">General</span>
        {STOPS.map((s, k) => (
          <button key={s} role="radio" aria-checked={level === k + 1} onClick={() => set(k + 1)}
                  className={`rounded-full px-3 py-1 text-small transition-colors ${level === k + 1 ? 'bg-accent font-medium text-[var(--on-accent,white)]' : 'text-fg-3 hover:bg-hover hover:text-fg-1'}`}>
            <span className="mr-1 tabular-nums opacity-60">{k + 1}</span>{s}
          </button>
        ))}
        <span className="px-2 text-micro text-fg-4">Detailed</span>
      </div>
    </div>
  )
}
