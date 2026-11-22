// The standup as a pipeline, drawn like the Understanding map: three stages left to right (what I did → what blocks me
// → what I'll do), one lane per project in its own colour (side quests last, grey), and in each lane a box per stage
// with its tickets as rows. A project's boxes are wired across the stages, so its day reads as one line.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Fragment, useEffect, useId, useRef, type CSSProperties } from 'react'

export type Stage = 'did' | 'blockers' | 'next'
// review: someone else's PR, not my own work. facts: what the hover card says besides the title (state, PR, priority…)
export type Row = { id: string; title: string; lead: string; review?: boolean; facts?: [string, string][] }
export type Lane = { name?: string; rows: Record<Stage, Row[]> }
type Box = { lane: Lane; stage: Stage; hue?: number; onOpen: (id: string) => void }
type Label = { stage: (typeof STAGES)[number]; n: number; count: number }

const STAGES: { id: Stage; label: string; tone: string }[] = [
  { id: 'did', label: 'What I did', tone: 'text-ok-text' },
  { id: 'blockers', label: 'Blockers', tone: 'text-wait-text' },
  { id: 'next', label: "What I'll do", tone: 'text-accent-text' },
]
// a row has a fixed height (two lines of name, one of what happened), so a box's height is known before it is drawn
// and the lanes below it never run into it
const W = 340, GAP_X = 64, GAP_Y = 24, ROWS = 6, ROW_H = 64, HEAD_H = 38, MORE_H = 24, MIN_ZOOM = 0.7
const heightOf = (n: number) => HEAD_H + 12 + Math.min(ROWS, n) * ROW_H + (n > ROWS ? MORE_H : 0)
/** A steady hue per project, from its name: the same colour every day, without a table to keep. */
// Lanes take one of a few hues far apart on the wheel, kept away from the two row marks (violet: my work, amber:
// reviews), so no two projects and no project and a mark read alike. A project keeps its hue every day (from its name).
// (hue and lightness both differ: every pair, marks included, is at least 18 apart in OKLab ×100, past the floor of 15)
const LANES: [number, number][] = [[180, 0.6], [20, 0.6], [230, 0.8], [350, 0.8], [100, 0.6], [150, 0.8]] // [hue, lightness]
export const hueOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) % LANES.length // an index into LANES
const laneColour = (lane?: number) => (lane === undefined ? 'var(--fg-3)' : `oklch(${LANES[lane][1]} 0.15 ${LANES[lane][0]})`)
// the row marks: my own work, and reviews of someone else's PR, in colours no theme accent or lane takes
const MINE = 'oklch(0.66 0.22 295)', REVIEW = 'oklch(0.8 0.16 75)'

const In = () => <Handle type="target" position={Position.Left} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const Out = () => <Handle type="source" position={Position.Right} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />

function BoxNode({ data }: NodeProps<Node<Box>>) {
  const { lane, stage, hue, onOpen } = data
  const rows = lane.rows[stage]
  return (
    <div style={{ width: W }} className="card text-left">
      <In /><Out />
      <p className="flex h-[38px] items-center gap-2 border-b border-line px-3">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: laneColour(hue) }} />
        <span className="min-w-0 flex-1 truncate text-small font-semibold text-fg-1" title={lane.name}>{lane.name ?? 'Side quests'}</span>
        <span className="text-meta tabular-nums text-fg-3">{rows.length}</span>
      </p>
      <div className="p-1.5">
        {rows.slice(0, ROWS).map((r) => <RowItem key={r.id} r={r} onOpen={onOpen} />)}
        {rows.length > ROWS && <p className="flex h-6 items-center px-2 text-meta text-fg-4">+{rows.length - ROWS} more</p>}
      </div>
    </div>
  )
}

/** A ticket in a box: its name first (two lines at most), what happened under it; hover for the whole of it. */
function RowItem({ r, onOpen }: { r: Row; onOpen: (id: string) => void }) {
  const name = '--r' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const card = useRef<HTMLDivElement>(null)
  const show = (on: boolean) => { try { if (on) card.current?.showPopover(); else card.current?.hidePopover() } catch { /* already so */ } }
  return (
    <>
      <button type="button" onClick={() => onOpen(r.id)} onMouseEnter={() => show(true)} onMouseLeave={() => show(false)} onFocus={() => show(true)} onBlur={() => show(false)}
              style={{ anchorName: name } as CSSProperties} className="nodrag flex h-16 w-full min-w-0 items-start gap-2 overflow-hidden rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-hover">
        <span style={{ backgroundColor: r.review ? REVIEW : MINE }} className="mt-1 h-3.5 w-1 shrink-0 rounded-full" aria-label={r.review ? "Review of someone else's PR" : 'My work'} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-small font-medium leading-snug text-fg-1">{r.title || r.id}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-fg-3"><span className="shrink-0 font-mono">{r.id}</span><span className="truncate">{r.lead}</span></span>
        </span>
      </button>
      <div ref={card} popover="manual" role="tooltip" style={{ positionAnchor: name, positionArea: 'right span-bottom', positionTryFallbacks: 'flip-inline, flip-block', inset: 'auto' } as CSSProperties}
           className="pointer-events-none m-0 ml-2 w-[320px] rounded-card border-0 bg-surface-1 p-3 text-left shadow-[var(--e2)] ring-1 ring-line-strong">
        <p className="font-mono text-meta font-semibold text-fg-3">{r.id}</p>
        <p className="mt-0.5 text-small font-semibold leading-snug text-fg-1">{r.title}</p>
        <p className="mt-1.5 text-small text-fg-2">{r.lead}</p>
        {r.facts?.length ? (
          <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-line pt-2 text-meta">
            {r.facts.map(([k, v]) => <Fragment key={k}><dt className="text-fg-3">{k}</dt><dd className="min-w-0 text-fg-1">{v}</dd></Fragment>)}
          </dl>
        ) : null}
      </div>
    </>
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
  const fit = () => { const w = box.current?.clientWidth; if (w && rf.current) { const z = Math.min(1.15, Math.max(MIN_ZOOM, (w - 2 * pad) / span)); void rf.current.setViewport({ x: (w - span * z) / 2, y: 52 * z + 8, zoom: z }) } }
  useEffect(() => { if (!box.current) return; const o = new ResizeObserver(fit); o.observe(box.current); return () => o.disconnect() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
      <div className="relative min-h-0 flex-1">
        {nodes.length > STAGES.length ? (
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={(i) => { rf.current = i; fit() }} minZoom={MIN_ZOOM} maxZoom={1.6}
                     translateExtent={[[-pad - 40, -80], [span + pad + 40, Math.max(y, 200) + 60]]} /* panning stays on the pipeline */
                     onNodeClick={() => {}} /* a node with no handler gets no pointer events: its rows must click and hover */
                     nodesConnectable={false} elementsSelectable={false} panOnScroll proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
          </ReactFlow>
        ) : null}
        {/* what the row marks mean */}
        {nodes.length > STAGES.length ? (
          <p className="pointer-events-none absolute right-3 top-2.5 flex items-center gap-3 text-micro text-fg-3">
            <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full" style={{ backgroundColor: MINE }} />My work</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full" style={{ backgroundColor: REVIEW }} />Reviews</span>
          </p>
        ) : <p className="p-6 text-small text-fg-3">Nothing on your tickets for this standup.</p>}
      </div>
    </div>
  )
}
