// The Understanding and Intent boards, drawn like the Explain tab: its boxes, in lanes across the board (Understanding:
// the dimension a change is to; Intent: why → what was decided → before and now → what to watch), wired by cause.
// Understanding has a meter: the PR at one of five depths (server/levels.ts), from its purpose to each file; it opens at 3.
// A lane the PR leaves alone stays as a thin band saying so: knowing what didn't change is half of feeling safe.
// Every link is routed here, in the board's own coordinates (out of a box, along the gaps between boxes and lanes, into
// the next): it never depends on where the browser measured a box, so it sits right at any window size and zoom.
import { Background, BackgroundVariant, MarkerType, ReactFlow, useReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, Cloud, Cpu, Database, Lightbulb, ListChecks, MessageCircleQuestion, Radio, ShieldAlert, TriangleAlert, UserRound, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DIMS, linksAt, visibleAt, type Dim, type Levels } from '../../server/levels.ts'
import { edgeTypes, nodeTypes, type Card as Box } from '../components/Explain.tsx'

/** A card on a board: a change said in words. strong: the one the lane is about; faded: set aside. */
export type Card = { id: string; title: string; line?: string; before?: string; why?: string; tone?: 'strong' | 'faded' | 'ok' | 'wait' | 'bad'; more?: string[] }
export type Lane = { id: string; label: string; hint: string; icon: LucideIcon; cards: Card[]; skip?: boolean } // skip: an empty lane isn't drawn

const W = 236, H = 100, GAP = 28, PAD = 20, HEAD = 46, THIN = 46, LANE_GAP = 18, COLS = 4 // W, H: the Explain tab's box; COLS: a lane wraps after
const said = (x?: string) => x?.replace(/`([^`]+)`/g, '$1')
type Pt = { x: number; y: number }

/** A link's path: out of the source's right side, along the gap beside it, across between the lanes, down the gap before the target, in. */
function route(a: Pt, b: Pt, gapY: number | undefined): Pt[] {
  const s = { x: a.x + W, y: a.y + H / 2 }, t = { x: b.x, y: b.y + H / 2 }
  if (gapY === undefined && t.x > s.x && t.x - s.x <= GAP + 1) return [s, t] // side by side
  const x1 = s.x + GAP / 2, x2 = t.x - GAP / 2
  const y = gapY ?? a.y - GAP / 2 // the same lane: the gap over the source's row
  return [s, { x: x1, y: s.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: t.y }, t]
}

/** Lanes stacked down the board, boxes left to right in each; a click opens a card's whole story on the side. */
export function LaneBoard({ lanes, links, children }: { lanes: Lane[]; links: [string, string][]; children?: React.ReactNode }) {
  const [on, setOn] = useState<string>()
  const { nodes, edges } = useMemo(() => {
    const drawn = lanes.filter((l) => !(l.skip && !l.cards.length))
    const width = Math.min(COLS, Math.max(3, ...drawn.map((l) => l.cards.length))) * (W + GAP) - GAP + 2 * PAD
    const out: Node[] = [], at = new Map<string, Pt & { lane: number }>(), bands: { top: number; bottom: number }[] = []
    let y = 0
    drawn.forEach((lane, li) => {
      const rows = Math.ceil(lane.cards.length / COLS), none = !rows, h = none ? THIN : HEAD + rows * (H + GAP) - GAP + PAD
      const frame: Box = { id: `lane:${lane.id}`, kind: 'system', icon: lane.icon, name: lane.label, summary: none ? 'unchanged' : lane.hint, fixed: true }
      out.push({ id: frame.id, type: 'box', position: { x: 0, y }, data: frame, style: { width, height: h, opacity: none ? 0.5 : 1 }, draggable: false, selectable: false, zIndex: -1 })
      lane.cards.forEach((c, k) => {
        const p = { x: PAD + (k % COLS) * (W + GAP), y: y + HEAD + Math.floor(k / COLS) * (H + GAP) }
        at.set(c.id, { ...p, lane: li })
        const box: Box = { id: c.id, kind: 'system', icon: lane.icon, name: said(c.title) ?? '', summary: said(c.line), ...(c.tone !== 'faded' && { plain: true }), ...(c.more?.length && { sub: `${c.more.length} inside` }) }
        out.push({ id: c.id, type: 'card', position: p, data: box, style: { width: W, height: H }, selected: on === c.id, draggable: false })
      })
      bands.push({ top: y, bottom: y + h }); y += h + LANE_GAP
    })
    const edges: Edge[] = links.flatMap(([a, b]) => {
      const p = at.get(a), q = at.get(b)
      if (!p || !q) return []
      // between lanes: the gap next to the target's lane, on the side the link comes from
      const gapY = p.lane === q.lane ? undefined : q.lane > p.lane ? bands[q.lane].top - LANE_GAP / 2 : bands[q.lane].bottom + LANE_GAP / 2
      return [{ id: `${a}>${b}`, source: a, target: b, type: 'elk', data: { points: route(p, q, gapY) }, animated: true, zIndex: 5,
        style: { stroke: 'rgb(139 92 246)', strokeWidth: 1.75 }, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'rgb(139 92 246)' } }]
    })
    // room under the last lane for what floats over the board's foot (the meter)
    if (children) out.push({ id: 'foot', type: 'more', position: { x: 0, y: y + 40 }, data: { id: 'foot', kind: 'more', icon: Check, name: '' }, style: { width: 1, height: 1, opacity: 0 }, draggable: false, selectable: false })
    return { nodes: out, edges }
  }, [lanes, links, on, children])
  const rf = useReactFlow()
  const shape = lanes.map((l) => `${l.id}:${l.cards.map((c) => c.id).join()}`).join('|')
  useEffect(() => { const t = setTimeout(() => void rf.fitView({ padding: 0.06, maxZoom: 1, duration: 250 }), 30); return () => clearTimeout(t) }, [shape, rf])
  const sel = lanes.flatMap((l) => l.cards).find((c) => c.id === on)
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.06, maxZoom: 1 }} minZoom={0.5} maxZoom={1.6}
                   nodesConnectable={false} onNodeClick={(_, n) => { if (!n.id.startsWith('lane:') && n.id !== 'foot') setOn((o) => (o === n.id ? undefined : n.id)) }}
                   onPaneClick={() => setOn(undefined)} proOptions={{ hideAttribution: true }}>
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

/** The lanes' icons, for Intent's story (ChangeMap.tsx). */
export const STORY_ICONS = { why: Lightbulb, decided: ListChecks, change: Radio, watch: TriangleAlert, answers: MessageCircleQuestion }

// --- Understanding: the levels ----------------------------------------------------------------------------------

const STOPS = [['Purpose', 'what it is for'], ['Capabilities', 'what it makes possible'], ['Parts', 'what changed'], ['Mechanics', 'how it works'], ['Code', 'each file']] as const
const DIM: Record<Dim, { label: string; hint: string; icon: LucideIcon }> = {
  behaviour: { label: 'Behaviour', hint: 'what a user or caller notices', icon: UserRound },
  data: { label: 'Data', hint: 'what is stored or sent', icon: Database },
  contract: { label: 'Contract', hint: 'APIs and messages between parts', icon: Radio },
  logic: { label: 'Logic', hint: 'rules and decisions', icon: Cpu },
  wiring: { label: 'Wiring', hint: 'config, dependencies, environments', icon: Cloud },
  security: { label: 'Security', hint: 'access, secrets, privacy', icon: ShieldAlert },
  safety: { label: 'Safety net', hint: 'tests and checks', icon: Check },
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
