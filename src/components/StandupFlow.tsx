// The standup as a pipeline, drawn like the Understanding map: three stages left to right (what I did → what blocks me
// → what I'll do), one lane per project in its own colour (side quests last, grey), and in each lane a box per stage
// with its tickets as rows. A project's boxes are wired across the stages, so its day reads as one line.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useRef, type CSSProperties } from 'react'

export type Stage = 'did' | 'blockers' | 'next'
export type Row = { id: string; title: string; lead: string; review?: boolean } // review: someone else's PR, not my own work
export type Lane = { name?: string; rows: Record<Stage, Row[]> }
type Box = { lane: Lane; stage: Stage; hue?: number; onOpen: (id: string) => void }
type Label = { stage: (typeof STAGES)[number]; n: number; count: number }

const STAGES: { id: Stage; label: string; tone: string }[] = [
  { id: 'did', label: 'What I did', tone: 'text-ok-text' },
  { id: 'blockers', label: 'Blockers', tone: 'text-wait-text' },
  { id: 'next', label: "What I'll do", tone: 'text-accent-text' },
]
const W = 300, GAP_X = 70, GAP_Y = 22, ROWS = 6
const heightOf = (n: number) => 44 + Math.min(ROWS, n) * 44 + (n > ROWS ? 20 : 0)
/** A steady hue per project, from its name: the same colour every day, without a table to keep. */
export const hueOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const laneColour = (hue?: number) => (hue === undefined ? 'var(--fg-3)' : `oklch(0.7 0.17 ${hue})`)

const In = () => <Handle type="target" position={Position.Left} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const Out = () => <Handle type="source" position={Position.Right} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />

function BoxNode({ data }: NodeProps<Node<Box>>) {
  const { lane, stage, hue, onOpen } = data
  const rows = lane.rows[stage]
  return (
    <div style={{ width: W, '--lane': laneColour(hue) } as CSSProperties}
         className="rounded-card border-l-[3px] border-[var(--lane)] bg-[color-mix(in_oklch,var(--lane)_12%,var(--surface-1))] p-2 text-left ring-1 ring-[color-mix(in_oklch,var(--lane)_35%,transparent)]">
      <In /><Out />
      <p className="flex items-center gap-1.5 px-2 pb-1 pt-0.5">
        <span className="size-2 shrink-0 rounded-full bg-[var(--lane)]" />
        <span className="min-w-0 flex-1 truncate text-meta font-semibold text-fg-1" title={lane.name}>{lane.name ?? 'Side quests'}</span>
        <span className="text-micro tabular-nums text-fg-3">{rows.length}</span>
      </p>
      <div className="space-y-px">
        {rows.slice(0, ROWS).map((r) => (
          <button key={r.id} type="button" onClick={() => onOpen(r.id)} title={`${r.id} · ${r.title}`}
                  className="nodrag flex w-full min-w-0 flex-col rounded-ctl px-2 py-1 text-left transition-colors hover:bg-[color-mix(in_oklch,var(--lane)_14%,transparent)]">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-meta font-medium text-fg-1">
              <span className={`h-3 w-1 shrink-0 rounded-full ${r.review ? 'bg-run' : 'bg-accent'}`} aria-label={r.review ? 'Review of someone else\'s PR' : 'My work'} />
              <span className="font-mono text-micro text-fg-3">{r.id}</span>{r.lead}
            </span>
            <span className="truncate text-micro text-fg-3">{r.title}</span>
          </button>
        ))}
        {rows.length > ROWS && <p className="px-2 pt-0.5 text-micro text-fg-4">+{rows.length - ROWS} more</p>}
      </div>
    </div>
  )
}
/** A stage's name over its column: on the canvas, so it stays over its boxes as you zoom and pan. */
function LabelNode({ data }: NodeProps<Node<Label>>) {
  const { stage, n, count } = data
  return (
    <p style={{ width: W }} className="flex items-center gap-2 px-1 text-body font-semibold">
      <span className={`flex size-6 items-center justify-center rounded-full bg-fill text-meta ${stage.tone}`}>{n}</span>
      <span className="text-fg-1">{stage.label}</span><span className="text-small tabular-nums text-fg-3">{count}</span>
    </p>
  )
}
const nodeTypes = { box: BoxNode, label: LabelNode }

/** The pipeline: lanes by project (most to say first, side quests last), a box where a lane has something in a stage. */
export function StandupFlow({ lanes, counts, onOpen }: { lanes: Lane[]; counts: Record<Stage, number>; onOpen: (id: string) => void }) {
  const nodes: Node<Box | Label>[] = STAGES.map((stage, k) => ({ id: `label:${stage.id}`, type: 'label', position: { x: k * (W + GAP_X), y: -44 }, data: { stage, n: k + 1, count: counts[stage.id] }, draggable: false }))
  const edges: Edge[] = []
  let y = 0
  for (const [i, lane] of lanes.entries()) {
    const hue = lane.name ? hueOf(lane.name) : undefined
    const here = STAGES.filter((s) => lane.rows[s.id].length)
    if (!here.length) continue
    here.forEach((s) => nodes.push({ id: `${i}:${s.id}`, type: 'box', position: { x: STAGES.indexOf(s) * (W + GAP_X), y }, data: { lane, stage: s.id, hue, onOpen }, draggable: false }))
    for (let k = 1; k < here.length; k++) edges.push({
      id: `${i}:${here[k - 1].id}>${here[k].id}`, source: `${i}:${here[k - 1].id}`, target: `${i}:${here[k].id}`, type: 'smoothstep', animated: here[k].id === 'next',
      style: { stroke: `color-mix(in oklch, ${laneColour(hue)} 60%, transparent)`, strokeWidth: 2 },
    })
    y += Math.max(...here.map((s) => heightOf(lane.rows[s.id].length))) + GAP_Y
  }
  // fitted to the width (the three stages fill it, readable), from the top; taller than the window, it scrolls down
  const box = useRef<HTMLDivElement>(null), rf = useRef<ReactFlowInstance<Node<Box | Label>, Edge>>(undefined)
  const span = 3 * W + 2 * GAP_X, pad = 24
  const fit = () => { const w = box.current?.clientWidth; if (w && rf.current) { const z = Math.min(1.15, Math.max(0.45, (w - 2 * pad) / span)); void rf.current.setViewport({ x: (w - span * z) / 2, y: 52 * z + 8, zoom: z }) } }
  useEffect(() => { if (!box.current) return; const o = new ResizeObserver(fit); o.observe(box.current); return () => o.disconnect() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
      <div className="relative min-h-0 flex-1">
        {nodes.length > STAGES.length ? (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={(i) => { rf.current = i; fit() }} minZoom={0.3} maxZoom={1.6}
                     nodesConnectable={false} elementsSelectable={false} panOnScroll proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
          </ReactFlow>
        ) : null}
        {/* what the row marks mean */}
        {nodes.length > STAGES.length ? (
          <p className="pointer-events-none absolute right-3 top-2.5 flex items-center gap-3 text-micro text-fg-3">
            <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full bg-accent" />My work</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full bg-run" />Reviews</span>
          </p>
        ) : <p className="p-6 text-small text-fg-3">Nothing on your tickets for this standup.</p>}
      </div>
    </div>
  )
}
