// The Understanding and Intent boards, drawn like the Standup pipeline: lanes down the board, each named at its left
// (Understanding: the dimension a change is to; Intent: why → what was decided → before and now → what to watch), its
// cards in a row beside the name, a hairline between lanes. One card, one border: nothing framed inside anything.
// A dimension the PR leaves alone isn't drawn: one quiet line over the board names them ("Unchanged: Data · Wiring").
// Every link is routed here, in the board's own coordinates (out of a card, along the gaps between cards and lanes, into
// the next): it never depends on where the browser measured a card, so it sits right at any window size and zoom.
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, Cloud, Cpu, Database, Lightbulb, ListChecks, MessageCircleQuestion, Radio, ShieldAlert, TriangleAlert, UserRound, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DIMS, linksAt, visibleAt, type Dim, type Levels } from '../../server/levels.ts'
import { edgeTypes } from '../components/Explain.tsx'
import { Tabs } from '../components/Tabs.tsx'

/** A card on a board: a change said in words. strong: the one the lane is about; faded: set aside. */
export type Card = { id: string; title: string; line?: string; before?: string; why?: string; tone?: 'strong' | 'faded' | 'ok' | 'wait' | 'bad'; more?: string[] }
export type Lane = { id: string; label: string; hint: string; icon: LucideIcon; cards: Card[]; skip?: boolean } // skip: left out when empty, unnamed

const W = 260, H = 124, GAP = 24, LABEL_W = 168, LANE_GAP = 28, COLS = 4
const said = (x?: string) => x?.replace(/`([^`]+)`/g, '$1')
type Pt = { x: number; y: number }

const In = () => <Handle type="target" position={Position.Left} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const Out = () => <Handle type="source" position={Position.Right} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const TONE = { ok: 'bg-ok', wait: 'bg-wait', bad: 'bg-fail' } as const

function CardNode({ data: { c, on } }: NodeProps<Node<{ c: Card; on: boolean }>>) {
  return (
    <div style={{ width: W, height: H }} className={`card flex flex-col px-3 py-2.5 text-left transition-colors ${c.tone === 'strong' ? 'bg-accent-soft' : ''} ${c.tone === 'faded' ? 'opacity-55' : ''} ${on ? 'outline outline-2 outline-accent' : 'hover:bg-hover'}`}>
      <In /><Out />
      <p className="flex min-w-0 items-start gap-1.5">
        {c.tone && c.tone in TONE && <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TONE[c.tone as keyof typeof TONE]}`} />}
        <span className={`line-clamp-2 text-small font-semibold leading-snug text-fg-1 ${c.tone === 'faded' ? 'line-through decoration-fg-4/50' : ''}`}>{said(c.title)}</span>
      </p>
      {c.line && <p className="mt-1 line-clamp-2 text-meta leading-snug text-fg-2">{said(c.line)}</p>}
      {!!c.more?.length && <p className="mt-auto text-micro tabular-nums text-fg-4">{c.more.length} inside</p>}
    </div>
  )
}
/** A lane's name at its left, like a stage's name over Standup's columns. */
function LaneName({ data: { lane } }: NodeProps<Node<{ lane: Lane }>>) {
  return (
    <div style={{ width: LABEL_W }} className="text-left">
      <p className="flex items-center gap-2 text-small font-semibold text-fg-1"><lane.icon className="size-3.5 text-fg-3" />{lane.label}</p>
      <p className="mt-0.5 text-micro leading-snug text-fg-3">{lane.hint}</p>
    </div>
  )
}
const Rule = ({ data }: NodeProps<Node<{ width: number }>>) => <div style={{ width: data.width }} className="h-px bg-line" />
const nodeTypes = { card: CardNode, name: LaneName, rule: Rule }

/** A link's path: out of the source's right side, along the gap beside it, across between the lanes, down the gap before the target, in. */
function route(a: Pt, b: Pt, gapY: number | undefined): Pt[] {
  const s = { x: a.x + W, y: a.y + H / 2 }, t = { x: b.x, y: b.y + H / 2 }
  if (Math.abs(s.y - t.y) < 1 && t.x > s.x && t.x - s.x <= GAP + 1) return [s, t] // side by side
  const x1 = s.x + GAP / 2, x2 = t.x - GAP / 2
  const y = gapY ?? a.y - GAP / 2 // the same lane: the gap over the source's row
  return [s, { x: x1, y: s.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: t.y }, t]
}

/** Lanes stacked down the board, cards left to right in each; a click opens a card's whole story on the side. */
export function LaneBoard({ lanes, links, top, children }: { lanes: Lane[]; links: [string, string][]; top?: React.ReactNode; children?: React.ReactNode }) {
  const [on, setOn] = useState<string>()
  const drawn = lanes.filter((l) => l.cards.length)
  const { nodes, edges } = useMemo(() => {
    const x0 = LABEL_W + GAP
    const width = x0 + Math.min(COLS, Math.max(...drawn.map((l) => l.cards.length), 1)) * (W + GAP) - GAP
    const out: Node[] = [], at = new Map<string, Pt & { lane: number }>(), bands: { top: number; bottom: number }[] = []
    let y = 0
    drawn.forEach((lane, li) => {
      if (li) out.push({ id: `rule:${lane.id}`, type: 'rule', position: { x: 0, y: y - LANE_GAP / 2 }, data: { width }, draggable: false, selectable: false, zIndex: -1 })
      out.push({ id: `name:${lane.id}`, type: 'name', position: { x: 0, y: y + 4 }, data: { lane }, draggable: false, selectable: false })
      lane.cards.forEach((c, k) => {
        const p = { x: x0 + (k % COLS) * (W + GAP), y: y + Math.floor(k / COLS) * (H + GAP) }
        at.set(c.id, { ...p, lane: li })
        out.push({ id: c.id, type: 'card', position: p, data: { c, on: on === c.id }, draggable: false })
      })
      const h = Math.ceil(lane.cards.length / COLS) * (H + GAP) - GAP
      bands.push({ top: y, bottom: y + h }); y += h + LANE_GAP
    })
    const edges: Edge[] = links.flatMap(([a, b]) => {
      const p = at.get(a), q = at.get(b)
      if (!p || !q) return []
      // between lanes: along the hairline next to the target's lane, on the side the link comes from
      const gapY = p.lane === q.lane ? undefined : q.lane > p.lane ? bands[q.lane].top - LANE_GAP / 2 : bands[q.lane].bottom + LANE_GAP / 2
      return [{ id: `${a}>${b}`, source: a, target: b, type: 'elk', data: { points: route(p, q, gapY) }, zIndex: 5,
        style: { stroke: 'var(--accent)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: 'var(--accent)' } }]
    })
    // room under the last lane for the meter floating over the board's foot
    if (children) out.push({ id: 'foot', type: 'rule', position: { x: 0, y: y + 36 }, data: { width: 1 }, style: { opacity: 0 }, draggable: false, selectable: false })
    return { nodes: out, edges }
  }, [drawn.map((l) => l.id + l.cards.map((c) => c.id).join()).join('|'), links, on, !!children]) // eslint-disable-line react-hooks/exhaustive-deps
  const rf = useReactFlow()
  const shape = drawn.map((l) => `${l.id}:${l.cards.map((c) => c.id).join()}`).join('|')
  const box = useRef<HTMLDivElement>(null)
  // fitted again whenever the board's own size changes (the side panel opening, the window, the meter's level)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const fit = () => { clearTimeout(t); t = setTimeout(() => void rf.fitView({ padding: 0.08, maxZoom: 1, duration: 200 }), 40) }
    fit()
    const o = new ResizeObserver(fit); if (box.current) o.observe(box.current)
    return () => { clearTimeout(t); o.disconnect() }
  }, [shape, rf])
  const sel = lanes.flatMap((l) => l.cards).find((c) => c.id === on)
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {top}
        <div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.08, maxZoom: 1 }} minZoom={0.5} maxZoom={1.6}
                     nodesConnectable={false} elementsSelectable={false} onNodeClick={(_, n) => { if (n.type === 'card') setOn((o) => (o === n.id ? undefined : n.id)) }}
                     onPaneClick={() => setOn(undefined)} proOptions={{ hideAttribution: true }}>
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
          </ReactFlow>
          {children}
        </div>
      </div>
      {sel && (
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-card bg-surface-1 ring-1 ring-line">
          <p className="flex items-center gap-2 border-b border-line px-3 py-2 text-small font-semibold text-fg-1"><span className="min-w-0 flex-1">{said(sel.title)}</span>
            <button onClick={() => setOn(undefined)} aria-label="Close" className="text-fg-4 hover:text-fg-1"><X className="size-3.5" /></button></p>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
            {sel.before && <div><p className="label text-fg-4">Before</p><p className="text-small leading-snug text-fg-3">{said(sel.before)}</p></div>}
            {sel.line && <div><p className="label text-accent-text">{sel.before ? 'Now' : 'What'}</p><p className="text-small leading-snug text-fg-1">{said(sel.line)}</p></div>}
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

/** The meter: the app's own segmented control, floating at the board's foot; how deep the board goes. */
function Meter({ level, set }: { level: number; set: (l: number) => void }) {
  return (
    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-surface-1 px-2 py-1 shadow-[var(--e2)]">
      <span className="pl-1 text-micro text-fg-4">General</span>
      <Tabs label="How deep to explain" value={String(level)} onChange={(v) => set(Number(v))}
            options={STOPS.map(([name, hint], k) => ({ id: String(k + 1), label: name, title: hint }))} />
      <span className="pr-1 text-micro text-fg-4">Detailed</span>
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
  const unchanged = lanes.filter((l) => !l.cards.length).map((l) => l.label)
  const top = unchanged.length ? <p className="px-1 text-meta text-fg-3"><span className="text-fg-4">Unchanged:</span> {unchanged.join(' · ')}</p> : undefined
  return <LaneBoard lanes={lanes} links={links} top={top}><Meter level={level} set={set} /></LaneBoard>
}
