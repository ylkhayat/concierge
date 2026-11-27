// The plan as a stream: time runs left to right (weeks, today marked), each epic is a stream that flows into the goal,
// as thick as the work in it, and its tickets are pebbles along it at the time they would be worked on (planStream.ts):
// done ones solid, the one going on glowing, what lies past the appetite faded. The streams draw themselves in, and
// pebbles glide when the plan changes. Hover a pebble: what it is, when, and what it waits for; click: open it.
// Listing tickets (the default level), names sit in a column on the left, one row per ticket, its bar on the timeline
// at its time: always whole, aligned, never over another (inside the bars they were crushed or spilled onto the next).
// A pebble (the streams level) shows its points (~ when guessed) and its name only when it fits inside, who picked
// it up, and is hatched while it still needs refining. Below the
// streams, the angles the plan hasn't explored yet flow faintly toward the goal: click one to have the planner take it on.
// Moves (onMove): drag a pebble earlier or later, onto another stream, or down into Later to cut it; each is a move of
// the scenario being tried. With a scenario, `base` is the plan before it: what moved leaves a dashed outline where it
// was, with a line to where it is. The critical path (what sets the end date) is underlined.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LATER, type Because, type Gap, type Op, type Plan } from '../../server/planOps.ts'
import { areaOf, initials } from '../planLook.tsx'
import { planStream, ranksOf, sizeFor, type Slot } from '../planStream.ts'

const DAY = 86_400_000, WEEK = 7 * DAY
const fmt = (w: number) => new Date(Date.now() + w * WEEK).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
// each stream its own calm hue, around the wheel
const hue = (i: number) => (200 + i * 53) % 360
const col = (h: number, a = 1) => `oklch(0.72 0.12 ${h} / ${a})`

// How much of it you see: `compact` draws every stream as one thin line of progress (the whole project at a glance);
// a stream in `open` lists its tickets under it, each on its own line with its id, name, size, owner and state.
export type Move = Extract<Op, { op: 'move' }>
export type ColorBy = 'epic' | 'owner' | 'moscow'
export const MOSCOW_HUE = { must: 25, should: 70, could: 230, wont: 280 } as const
const nameHue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
export function PlanStream({ p, base, colorBy = 'epic', people, pace, selected, onSelect, onExplore, compact, open, onToggle, legend, onMove, draft = [], fresh, noGaps }: { p: Plan; base?: Plan; draft?: Op[]; fresh?: string; people: number; pace: number; selected?: string; onSelect: (id?: string) => void; onExplore?: (g: Gap) => void; noGaps?: boolean
  compact?: boolean; open?: Set<string>; onToggle?: (id: string) => void; legend?: boolean; onMove?: (m: Move) => void; colorBy?: ColorBy }) {
  const box = useRef<HTMLDivElement>(null)
  // the room the map is drawn in: it fits it, never scrolls (unless every ticket is listed and even packed they don't fit)
  const [w, setW] = useState(0), [room, setRoom] = useState(0)
  useLayoutEffect(() => {
    const o = new ResizeObserver(([e]) => { setW(Math.floor(e.contentRect.width)); setRoom(Math.floor(e.contentRect.height)) })
    if (box.current) o.observe(box.current)
    return () => o.disconnect()
  }, [])
  const s = planStream(p.nodes, p.links, people, pace)
  const before = base ? planStream(base.nodes, base.links, people, pace) : undefined
  const critical = new Set(s.critical)
  // a pebble's colour: its stream's, or who works it, or its MoSCoW (unset: grey)
  const pebbleHue = (sl: Slot, h: number): number | null => { if (colorBy === 'owner') return nameHue(sl.who ?? sl.lane ?? '?'); if (colorBy === 'moscow') { const m = p.nodes.find((n) => n.id === sl.id)?.moscow; return m ? MOSCOW_HUE[m] : null } return h }
  const moved = new Set(base ? p.nodes.filter((n) => { const o = base.nodes.find((x) => x.id === n.id); return !o || o.rank !== n.rank || o.estimate !== n.estimate || o.title !== n.title || o.parent !== n.parent || o.priority !== n.priority || o.assignee !== n.assignee }).map((n) => n.id) : [])
  // what the draft's changes rest on, per item (the planner's lookups); its latest change wins
  const evidence = new Map<string, Because[]>()
  for (const o of draft) if (o.because?.length && 'id' in o) evidence.set(o.id, o.because)
  const appetite = p.appetite ? (Date.parse(p.appetite.from) + p.appetite.weeks * WEEK - Date.now()) / WEEK : undefined
  const due = p.project?.targetDate ? (Date.parse(p.project.targetDate) - Date.now()) / WEEK : undefined
  const [hover, setHover] = useState<{ slot: Slot; x: number; y: number }>()
  // a pebble being dragged: where it was picked up, and where the pointer is (in the map's own coordinates)
  const svgRef = useRef<SVGSVGElement>(null), laterRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; x0: number; y0: number; x: number; y: number; moved: boolean; overLater: boolean }>()
  // a pebble being resized: its width now (its points follow, snapped to the usual sizes)
  const [resize, setResize] = useState<{ id: string; w: number }>()
  // the streams draw in once, as the view opens; later changes glide
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 1400); return () => clearTimeout(t) }, [])

  const goal = p.nodes.find((n) => n.kind === 'goal')
  // listing any stream's tickets: a column on the left for the names (epics and tickets), the timeline after it
  const listing = !compact && s.streams.some((st) => open?.has(st.id))
  const GUTTER = listing && w ? Math.round(Math.min(320, Math.max(190, w * 0.24))) : 0
  const LEFT = 24 + GUTTER, RIGHT = 150, TOP = 46
  const t0 = Math.min(-0.5, ...s.streams.map((x) => x.start)), t1 = Math.max(1, s.end, appetite ?? 0, due ?? 0) + 0.3
  const span = Math.max(1, w - LEFT - RIGHT)
  const x = (t: number) => LEFT + ((t - t0) / (t1 - t0)) * span
  const maxPts = Math.max(1, ...s.streams.map((st) => st.points))
  // a stream's thickness at scale k (the fit below picks k: thinner when the room is short, fuller when there is plenty)
  let k = 1
  const thick = (pts: number) => Math.max(6, (compact ? 10 : 12 + 26 * Math.sqrt(pts / maxPts)) * k)
  let ROW = 26 // a ticket's line in an open stream
  // a pebble tall enough for its name: two lines when the room is short, three when there is room (streams level;
  // compact draws lines, not pebbles)
  const PEB = () => Math.round(Math.max(26, Math.min(46, 34 * k)))
  // each stream keeps its place and its colour while things move: in the plan's own order (the loose tickets last)
  const headAt = (id: string) => { const i = p.nodes.findIndex((n) => n.id === id); return i < 0 ? 1e9 : i }
  const streams = [...s.streams].sort((a, b) => headAt(a.id) - headAt(b.id))
  const headIds = p.nodes.filter((n) => n.kind === 'epic' || n.kind === 'milestone').map((n) => n.id)
  const hueOf = (id: string) => hue(headIds.includes(id) ? headIds.indexOf(id) : headIds.length)
  // rows: each stream's band with its title above it (the angles not explored yet are chips under the map).
  // Laid out for the room: `gap` is the air after each row; `top` centres it when there is room to spare
  const gaps = p.busy ? [] : p.gaps ?? []
  const layout = (gap: number, top: number) => {
    let y = TOP + 18 + top
    const rows = streams.map((st) => {
      // tickets worked at the same time (two people on one epic) stack in sub-rows of the stream, never over each other
      const sub = new Map<string, number>(), ends: number[] = []
      for (const sl of [...st.slots].sort((a, b) => a.start - b.start)) { let j = ends.findIndex((e) => e <= sl.start + 1e-6); if (j < 0) { j = ends.length; ends.push(0) } ends[j] = sl.end; sub.set(sl.id, j) }
      const lanes = Math.max(1, ends.length), lanePh = compact ? Math.min(Math.max(6, thick(st.points) - 8), 22) : PEB()
      const listed = !!open?.has(st.id) && !compact
      const t = compact ? thick(st.points) : listed ? 10 : lanes === 1 ? Math.max(thick(st.points), PEB() + 8) : Math.max(thick(st.points), lanes * (lanePh + 4) + 6)
      const yOf = (id: string) => (lanes === 1 ? 0 : ((sub.get(id) ?? 0) - (lanes - 1) / 2) * (lanePh + 4))
      // with the column the title is in it, level with the band (no line above it); listed, its tickets follow closely
      const cy = y + (listing ? Math.max(12, t / 2) : 16 + t / 2); const isOpen = listed; const listY = cy + Math.max(t / 2, 8) + 8; y = cy + t / 2 + (isOpen ? 10 + st.slots.length * ROW : gap) + (isOpen ? gap / 2 : 0); return { st, t, cy, isOpen, listY, lanes, lanePh, yOf } })
    return { rows, end: y + 10 }
  }
  // the fit: thinner streams and less air until it fits (down to a floor); with room to spare, fuller streams, more air
  // between them, and the whole centred. ponytail: a few tries of a 1-D search, it's cheap at these sizes
  const n = streams.length
  let gap = 22, top = 0, L = layout(gap, 0)
  if (room > 0 && L.end > room) {
    // a listed ticket's row never gets too tight to read: past that, the board scrolls
    for (k = 0.95; k >= 0.7 && L.end > room; k -= 0.05) { gap = Math.max(6, 22 * k); ROW = Math.max(listing ? 24 : 15, 26 * k); L = layout(gap, 0) }
  } else if (room > 0 && !compact) {
    while (k < 1.4) { k += 0.05; if (layout(gap, 0).end > room) { k -= 0.05; break } }
    L = layout(gap, 0)
    gap = Math.min(72, gap + (room - L.end) / Math.max(1, n + 1)); L = layout(gap, 0)
    top = Math.max(0, (room - L.end) / 2); L = layout(gap, top)
  }
  const { rows } = L
  let y = L.end - 10
  const anyOpen = rows.some((r) => r.isOpen)
  const H = Math.max(y + 10, room || 260)
  const gx = w - RIGHT + 64, gy = rows.length ? (rows[0].cy + rows[rows.length - 1].cy) / 2 : H / 2
  const nodeOf = new Map(p.nodes.map((n) => [n.id, n]))
  const title = (id: string) => nodeOf.get(id)?.title ?? id
  // its name on the board: the planner's short one (1 to 4 words), else the title; the whole title is on hover
  const name = (id: string) => nodeOf.get(id)?.short ?? title(id)
  const slotAt = new Map(rows.flatMap((r) => r.st.slots.map((sl, j) => [sl.id, { sl, cy: r.isOpen ? r.listY + j * ROW + ROW / 2 : r.cy + r.yOf(sl.id) }] as const)))
  const weeks = Array.from({ length: Math.max(0, Math.floor(t1) - Math.ceil(t0) + 1) }, (_, i) => Math.ceil(t0) + i)
  const rowOf = new Map(rows.map((r) => [r.st.id, r]))
  const cutNodes = p.nodes.filter((n) => n.kind === 'ticket' && n.parent === LATER)

  // a drop: earlier or later (a rank between the tickets around that time), onto another stream (its epic), or into
  // Later (cut); a press without a drag opens the ticket
  // the pointer in the map's own units: the page may be zoomed (Settings → size), so screen pixels are scaled back by
  // how big the map is drawn on screen against its own width and height
  const local = (e: PointerEvent | React.PointerEvent) => { const b = svgRef.current!.getBoundingClientRect(); return { x: ((e.clientX - b.left) * w) / (b.width || w), y: ((e.clientY - b.top) * H) / (b.height || H) } }
  const inLater = (e: PointerEvent) => { const b = laterRef.current?.getBoundingClientRect(); return !!b && e.clientY >= b.top - 8 && e.clientY <= b.bottom + 8 && e.clientX >= b.left && e.clientX <= b.right }
  const drop = (d: NonNullable<typeof drag>) => {
    if (!onMove) return
    if (d.overLater) return onMove({ op: 'move', id: d.id, cut: true })
    const m: Move = { op: 'move', id: d.id }
    const from = slotAt.get(d.id)
    const row = rows.find((r) => Math.abs(d.y - r.cy) <= r.t / 2 + 18)
    if (row && from && row.st.id !== from.sl.head && row.st.node) m.parent = row.st.node.id
    if (Math.abs(d.x - d.x0) > 10) {
      const t = t0 + ((d.x - LEFT) / span) * (t1 - t0)
      const ranks = ranksOf(p.nodes)
      const order = [...slotAt.values()].map((v) => v.sl).filter((sl) => !sl.done && sl.id !== d.id).sort((a, b) => a.start - b.start)
      const at = order.findLastIndex((sl) => sl.start <= t)
      const rk = (id: string) => ranks.get(id) ?? 0
      m.rank = at < 0 ? (order[0] ? rk(order[0].id) - 1 : 0) : order[at + 1] ? (rk(order[at].id) + rk(order[at + 1].id)) / 2 : rk(order[at].id) + 1
    }
    if (m.parent !== undefined || m.rank !== undefined) onMove(m)
  }
  const press = (e: React.PointerEvent, sl: Slot) => {
    if (e.button !== 0) return
    const a = local(e)
    if (!onMove || sl.done) { onSelect(sl.id); return }
    e.preventDefault()
    let d = { id: sl.id, x0: a.x, y0: a.y, x: a.x, y: a.y, moved: false, overLater: false }
    setDrag(d)
    const move = (ev: PointerEvent) => { const b = local(ev); d = { ...d, x: b.x, y: b.y, moved: d.moved || Math.hypot(b.x - d.x0, b.y - d.y0) > 4, overLater: inLater(ev) }; setDrag(d) }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); setDrag(undefined); if (d.moved) drop(d); else onSelect(sl.id) }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }

  const stretch = (e: React.PointerEvent, sl: Slot, full: number) => {
    if (e.button !== 0 || !onMove) return
    e.preventDefault(); e.stopPropagation()
    const x0 = local(e).x
    let r = { id: sl.id, w: full }
    setResize(r)
    const move = (ev: PointerEvent) => { r = { ...r, w: Math.max(6, full + local(ev).x - x0) }; setResize(r) }
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); setResize(undefined)
      const pts = sizeFor(sl.points, full, r.w)
      if (pts !== sl.points) onMove({ op: 'move', id: sl.id, estimate: pts })
    }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
     <div ref={box} className={`relative min-h-0 flex-1 overflow-x-hidden ${room && H > room + 2 ? 'overflow-y-auto' : 'overflow-hidden'}`}>
      {legend && <Legend />}
      {colorBy !== 'epic' && <ColorKey p={p} colorBy={colorBy} />}
      {w > 0 && (
        <svg ref={svgRef} width={w} height={H} className={`block select-none ${drag?.moved ? 'cursor-grabbing' : ''}`} role="img" aria-label="The plan over time">
          <defs>
            {rows.map((r, i) => (
              <pattern key={i} id={`hatch-${i}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={5} height={5} fill={col(hueOf(r.st.id), 0.22)} /><line x1={0} y1={0} x2={0} y2={5} stroke={col(hueOf(r.st.id), 0.45)} strokeWidth={1.5} />
              </pattern>
            ))}
            <radialGradient id="goal-glow"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
          </defs>
          {/* the weeks */}
          {weeks.map((wk) => (
            <g key={wk} className="text-fg-4">
              <line x1={x(wk)} x2={x(wk)} y1={TOP - 6} y2={H} stroke="currentColor" strokeOpacity={0.12} />
              {wk !== 0 && wk % Math.max(1, Math.ceil(64 / Math.max(1, x(1) - x(0)))) === 0 && Math.abs(x(wk) - x(0)) > 48 && <text x={x(wk) + 4} y={TOP - 12} fontSize={10.5} fill="currentColor">{fmt(wk)}</text>}
            </g>
          ))}
          {appetite !== undefined && appetite > t0 && (
            <g>
              <rect x={x(Math.max(t0, 0))} y={TOP - 4} width={Math.max(0, x(appetite) - x(Math.max(t0, 0)))} height={H - TOP} fill="var(--accent)" fillOpacity={0.04} />
              <line x1={x(appetite)} x2={x(appetite)} y1={TOP - 6} y2={H} stroke="var(--accent)" strokeOpacity={0.55} strokeDasharray="4 5" />
              <text x={x(appetite) + 5} y={TOP + 6} fontSize={10.5} fontWeight={600} fill="var(--accent-text)">Appetite · {fmt(appetite)}</text>
            </g>
          )}
          {due !== undefined && due > t0 && due < t1 && (
            <g><line x1={x(due)} x2={x(due)} y1={TOP - 6} y2={H} stroke="currentColor" className="text-fg-2" strokeOpacity={0.6} strokeDasharray="2 4" /><text x={x(due) + 5} y={TOP + (appetite !== undefined && Math.abs(x(due) - x(appetite)) < 90 ? 20 : 6)} fontSize={10.5} fontWeight={600} className="fill-fg-2">Due · {fmt(due)}</text></g>
          )}
          <line x1={x(0)} x2={x(0)} y1={TOP - 6} y2={H} stroke="currentColor" className="text-fg-2" strokeOpacity={0.5} />
          <text x={x(0) + 5} y={TOP - 12} fontSize={10.5} fontWeight={600} className="fill-fg-1">Today</text>

          {/* the streams, flowing into the goal */}
          {rows.map(({ st, t, cy: rowCy, isOpen, listY, lanes, lanePh, yOf }, i) => {
            const cy = rowCy
            // listed, its band is the span of its tickets (from the first one's start, not from today)
            const h = hueOf(st.id), x0 = x(isOpen && st.slots.length ? Math.min(...st.slots.map((sl) => sl.start)) : st.start), x1 = Math.max(x0 + t, x(st.end))
            const d = `M ${x0} ${cy} L ${x1} ${cy} C ${x1 + (gx - x1) * 0.55} ${cy}, ${gx - (gx - x1) * 0.45} ${gy}, ${gx} ${gy}`
            return (
              <g key={st.id}>
                {/* with tickets listed, the run on to the goal thins out: it passes behind their names */}
                {anyOpen && <path d={`M ${x0} ${cy} L ${x1} ${cy}`} fill="none" stroke={col(h, 0.2)} strokeWidth={t} strokeLinecap="round" />}
                <path d={d} fill="none" stroke={col(h, anyOpen ? 0.14 : 0.2)} strokeWidth={anyOpen ? Math.min(t, 5) : t} strokeLinecap="round" pathLength={1}
                      style={drawn ? undefined : { strokeDasharray: 1, animation: `stream-draw 1100ms var(--ease-out) ${i * 90}ms both` }} />
                {/* open or close its tickets */}
                <g role="button" tabIndex={0} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} the tickets of ${st.title}`} className="cursor-pointer outline-none" onClick={() => onToggle?.(st.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(st.id) } }}>
                  <rect x={(listing ? 8 : x0) - 4} y={(listing ? cy - 9 : cy - t / 2 - 21)} width={18} height={18} rx={5} className="fill-transparent hover:fill-[var(--surface-hover)]" />
                  <path d="M -2.5 -4 L 2.5 0 L -2.5 4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="text-fg-3"
                        style={{ transform: `translate(${(listing ? 8 : x0) + 5}px, ${listing ? cy : cy - t / 2 - 12}px) rotate(${isOpen ? 90 : 0}deg)`, transition: 'transform 200ms var(--ease-snappy)' }} />
                </g>
                {listing ? (
                  <foreignObject x={30} y={cy - 10} width={Math.max(0, GUTTER - 14)} height={20}>
                    <button onClick={() => (st.node ? onSelect(st.node.id) : onToggle?.(st.id))} title={`${st.title}\n${st.slots.length} ticket${st.slots.length === 1 ? '' : 's'} · ${st.points} pt · ~${fmt(st.end)}`}
                            className="block w-full truncate text-left text-small font-semibold leading-5 text-fg-1 hover:underline">{st.node?.short ?? st.title}</button>
                  </foreignObject>
                ) : (
                <text x={x0 + 18} y={cy - t / 2 - 8} fontSize={12} fontWeight={600} className="fill-fg-1" style={{ cursor: 'pointer' }} onClick={() => (st.node ? onSelect(st.node.id) : onToggle?.(st.id))}>
                  {(() => { const t = st.node?.short ?? st.title; return t.length > 60 ? `${t.slice(0, 58)}…` : t })()}
                  <tspan dx={8} fontSize={10.5} fontWeight={400} className="fill-fg-3">{st.slots.length} ticket{st.slots.length === 1 ? '' : 's'} · {st.points} pt{st.slots.some((sl) => sl.done) ? ` · ${Math.round(100 * st.slots.filter((sl) => sl.done).reduce((a, sl) => a + sl.points, 0) / Math.max(1, st.points))}% done` : ''} · ~{fmt(st.end)}</tspan>
                  {st.slots.some((sl) => sl.refine) && <tspan dx={6} fontSize={10.5} fontWeight={500} className="fill-wait">· {st.slots.filter((sl) => sl.refine).length} to refine</tspan>}
                </text>
                )}
                {/* listed: what the stream holds, after its band */}
                {listing && <text x={x1 + 10} y={cy + 3.5} fontSize={10.5} className="fill-fg-3" pointerEvents="none">{st.slots.length} ticket{st.slots.length === 1 ? '' : 's'} · {st.points} pt · ~{fmt(st.end)}{st.slots.some((sl) => sl.refine) ? ` · ${st.slots.filter((sl) => sl.refine).length} to refine` : ''}</text>}
                {/* at a glance: how much of it is done, as a solid run along its line */}
                {compact && (() => { const done = st.slots.filter((sl) => sl.done).reduce((a, sl) => a + sl.points, 0) / Math.max(1, st.points); return done > 0 ? <rect x={x0} y={cy - t / 2} width={Math.max(t, (x1 - x0) * done)} height={t} rx={t / 2} fill={col(h, 0.95)} style={{ transition: 'width 500ms var(--ease-snappy)' }} /> : null })()}
                {/* open: every ticket on its own line, at its time, named */}
                {isOpen && st.slots.map((sl, j) => {
                  const n = nodeOf.get(sl.id), ry = listY + j * ROW + ROW / 2
                  const bx = x(sl.start), bw = Math.max(6, x(sl.end) - x(sl.start) - 2), later = appetite !== undefined && sl.start >= appetite
                  const lit = hover?.slot.id === sl.id || selected === sl.id
                  const id = n?.created?.identifier, state = sl.done ? 'Done' : sl.started ? (n?.state?.name ?? 'In progress') : sl.refine ? 'Needs refining' : n?.state?.name
                  const meta = [`${sl.sized ? '' : '~'}${sl.points} pt`, sl.who, state].filter(Boolean).join(' · ')
                  return (
                    <g key={sl.id} className="cursor-pointer" onClick={() => onSelect(sl.id)} onMouseEnter={() => setHover({ slot: sl, x: bx + bw / 2, y: ry - 8 })} onMouseLeave={() => setHover(undefined)}
                       // reachable without a pointer: Tab lands on a ticket (its card shows), Enter opens it
                       tabIndex={0} role="button" aria-label={`${id ? `${id} ` : ''}${n?.title ?? sl.id}: ${meta}`} onFocus={() => setHover({ slot: sl, x: bx + bw / 2, y: ry - 8 })} onBlur={() => setHover(undefined)}
                       onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sl.id) } }}
                       style={{ animation: `fade-in 260ms ${Math.min(j, 12) * 22}ms both` }}>
                      <rect x={4} y={ry - ROW / 2 + 1} width={Math.max(0, w - 12)} height={ROW - 2} rx={6} fill={lit ? 'var(--surface-hover)' : 'transparent'} />
                      {/* its name, in the column: whole up to the column's width, its id before it */}
                      <foreignObject x={40} y={ry - ROW / 2} width={Math.max(0, GUTTER - 24)} height={ROW} pointerEvents="none">
                        <div className={`flex h-full items-center gap-1.5 text-meta ${sl.done ? 'text-fg-3 line-through' : 'text-fg-1'}`}>
                          {id && <span className="shrink-0 font-mono text-micro text-fg-3">{id}</span>}
                          <span className="min-w-0 truncate font-medium" title={title(sl.id)}>{name(sl.id)}</span>
                        </div>
                      </foreignObject>
                      <rect x={bx} y={ry - 7} width={bw} height={14} rx={7} fill={sl.refine && !later && colorBy === 'epic' ? `url(#hatch-${i})` : pebbleHue(sl, h) === null ? 'var(--fg-4)' : col(pebbleHue(sl, h)!)} fillOpacity={sl.done ? 0.95 : later ? 0.2 : 0.7}
                            stroke={sl.started ? col(h) : later || sl.refine ? col(h, 0.8) : 'none'} strokeWidth={sl.started ? 2 : 1} strokeDasharray={later || sl.refine ? '3 3' : undefined} className={sl.started ? 'animate-pulse' : undefined}
                            onPointerDown={(e) => { e.stopPropagation(); press(e, sl) }} opacity={drag?.moved && drag.id === sl.id ? 0.35 : 1} />
                      {critical.has(sl.id) && !sl.done && <rect x={bx + 2} y={ry + 9} width={Math.max(2, bw - 4)} height={2} rx={1} fill="var(--accent)" pointerEvents="none" />}
                      {/* after its bar: its size, who has it, where it stands */}
                      <text x={bx + bw + 8} y={ry + 3.5} fontSize={10.5} pointerEvents="none" className={sl.refine ? 'fill-wait-text' : 'fill-fg-3'}>{meta}</text>
                    </g>
                  )
                })}
              </g>
            )
          })}
          {/* the pebbles, in one layer: a ticket moved to another stream glides there; its right edge resizes it */}
          {!compact && rows.flatMap(({ st, t, cy: rowCy, lanes, lanePh, yOf, isOpen }, i) => {
            if (isOpen) return [] // listed: each ticket is on its own row below
            const h = hueOf(st.id)
            return st.slots.map((sl, j) => {
              // a pebble never wider than its time: a short ticket is a smaller round one, never over its neighbour
              const later = appetite !== undefined && sl.start >= appetite
              const full = Math.max(5, x(sl.end) - x(sl.start) - 3), sizing = resize?.id === sl.id
              // as tall as its name needs; only a sliver of a ticket (no room for words) is a small round one
              const slotW = sizing ? resize.w : full, tall = lanes > 1 ? lanePh : Math.max(8, t - 8), ph = full < 28 ? Math.min(tall, full) : tall, cy = rowCy + yOf(sl.id)
              const left = x(sl.start) + 1.5, width = slotW, pts = sizing ? sizeFor(sl.points, full, resize.w) : sl.points
              const lit = hover?.slot.id === sl.id || selected === sl.id
              const glide = 'x 500ms var(--ease-snappy), y 500ms var(--ease-snappy), width 500ms var(--ease-snappy)'
              return (
                <g key={sl.id}>
                <rect rx={ph / 2} height={ph}
                      style={{ x: left, y: cy - ph / 2, width, transition: sizing ? 'none' : `${glide}, fill-opacity 200ms`, cursor: 'pointer',
                        ...(drawn ? {} : { animation: `pebble-in 420ms var(--ease-spring) ${i * 90 + 300 + j * 40}ms both` }) } as React.CSSProperties}
                      fill={sl.refine && !later && colorBy === 'epic' ? `url(#hatch-${i})` : pebbleHue(sl, h) === null ? 'var(--fg-4)' : col(pebbleHue(sl, h)!)} fillOpacity={sl.refine && !later ? (lit ? 1 : 0.85) : sl.done ? 0.95 : later ? 0.18 : lit ? 0.9 : 0.6}
                      stroke={sizing ? 'var(--accent)' : sl.started ? col(h) : later || sl.refine ? col(h, 0.8) : 'none'} strokeWidth={sl.started || sizing ? 2.5 : 1.2} strokeDasharray={later || sl.refine ? '3 3' : undefined}
                      className={sl.started ? 'animate-pulse' : undefined}
                      onMouseEnter={() => setHover({ slot: sl, x: left + width / 2, y: cy - ph / 2 })} onMouseLeave={() => setHover(undefined)}
                      onPointerDown={(e) => press(e, sl)} opacity={drag?.moved && drag.id === sl.id ? 0.35 : 1} />
                {/* changed by the draft: ringed, and a dot when it rests on evidence */}
                {moved.has(sl.id) && !sizing && <rect rx={ph / 2 + 3} height={ph + 6} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeOpacity={0.85} pointerEvents="none"
                      style={{ x: left - 3, y: cy - ph / 2 - 3, width: width + 6, transition: glide, animation: 'pebble-in 360ms var(--ease-spring) both' } as React.CSSProperties} />}
                {/* the change that just came in: a glow that fades */}
                {fresh?.startsWith(`${sl.id}:`) && <rect key={fresh} rx={ph / 2 + 6} height={ph + 12} fill="none" stroke="var(--accent)" strokeWidth={3} pointerEvents="none"
                      style={{ x: left - 6, y: cy - ph / 2 - 6, width: width + 12, animation: 'fresh-glow 1400ms var(--ease-out) both' } as React.CSSProperties} />}
                {evidence.has(sl.id) && <circle r={4} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={1.5} pointerEvents="none" style={{ transform: `translate(${left + 2}px, ${cy - ph / 2 - 1}px)`, transition: 'transform 500ms var(--ease-snappy)' }} />}
                {/* on the critical path: what sets the end date */}
                {critical.has(sl.id) && !sl.done && <rect height={2} rx={1} fill="var(--accent)" pointerEvents="none" style={{ x: left + 2, y: cy + ph / 2 + 2, width: Math.max(2, width - 4), transition: sizing ? 'none' : glide } as React.CSSProperties} />}
                {/* its name and size inside it, when there is room for words: two lines at most, its points after */}
                {/* its name inside it, only where it fits (the tickets level lists every name whole) */}
                {!sizing && slotW >= 72 && ph >= 22 && (
                  <foreignObject pointerEvents="none" style={{ x: left + 6, y: cy - ph / 2, width: Math.max(0, width - 12), height: ph, transition: glide } as React.CSSProperties}>
                    <div className="flex h-full items-center gap-1.5 overflow-hidden">
                      <span className={`shrink-0 text-[9.5px] font-semibold tabular-nums ${sl.done ? 'text-[var(--on-accent)]' : 'text-fg-2'}`}>{sl.sized ? '' : '~'}{pts}</span>
                      <span className={`${ph >= 40 ? 'line-clamp-3' : 'line-clamp-2'} min-w-0 flex-1 break-words text-micro font-medium leading-[12px] ${sl.done ? 'text-[var(--on-accent)] line-through' : 'text-fg-1'}`}>{name(sl.id)}</span>
                    </div>
                  </foreignObject>
                )}
                {/* its size alone, on a pebble too short for its name (and while it is being resized) */}
                {((slotW >= 22 && slotW < 72 && ph >= 12) || sizing) && <text y={3.5} textAnchor="middle" fontSize={9.5} fontWeight={600} pointerEvents="none" className={sl.done ? 'fill-[var(--on-accent)]' : 'fill-fg-1'}
                      style={{ transform: `translate(${left + width / 2}px, ${cy}px)`, transition: sizing ? 'none' : 'transform 500ms var(--ease-snappy)' }}>{sl.sized || sizing ? '' : '~'}{pts}</text>}
                {/* who picked it up */}
                {sl.who && (
                  <g pointerEvents="none" style={{ transform: `translate(${left + width - 4}px, ${cy + ph / 2 + 1}px)`, transition: 'transform 500ms var(--ease-snappy)' }}>
                    <circle r={7.5} fill="var(--surface-1)" stroke={col(h)} strokeWidth={1.5} />
                    <text y={3} textAnchor="middle" fontSize={7.5} fontWeight={700} className="fill-fg-1">{initials(sl.who)}</text>
                  </g>
                )}
                {/* drag the right edge: bigger or smaller (its estimate, in the scenario) */}
                {onMove && !sl.done && <rect height={ph + 6} width={8} fill="transparent" className="cursor-ew-resize" aria-label={`Resize ${title(sl.id)}`}
                      style={{ x: left + width - 5, y: cy - ph / 2 - 3, transition: sizing ? 'none' : glide } as React.CSSProperties} onPointerDown={(e) => stretch(e, sl, full)} />}
                </g>
              )
            })
          })}
          {/* the plan before the moves: a dashed outline where each moved ticket was, and a line to where it is now */}
          {before && !compact && before.streams.flatMap((bs) => bs.slots).filter((was) => moved.has(was.id)).map((was) => {
            const now = slotAt.get(was.id), row = rowOf.get(was.head ?? 'loose')
            if (was.done || !row) return null
            const ph = row.lanes > 1 ? row.lanePh : Math.max(8, row.t - 8), wx = x(was.start) + 1.5, ww = Math.max(5, x(was.end) - x(was.start) - 3), wy = row.cy
            const nx = now ? x(now.sl.start) + Math.max(5, x(now.sl.end) - x(now.sl.start) - 3) / 2 : undefined
            return (
              <g key={`was-${was.id}`} pointerEvents="none" className="text-fg-3" style={{ animation: 'fade-in 300ms both' }}>
                <rect x={wx} y={wy - Math.min(ph, ww) / 2} width={ww} height={Math.min(ph, ww)} rx={Math.min(ph, ww) / 2} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeDasharray="3 3" />
                {now && nx !== undefined && <path d={`M ${wx + ww / 2} ${wy} C ${wx + ww / 2} ${(wy + now.cy) / 2}, ${nx} ${(wy + now.cy) / 2}, ${nx} ${now.cy}`} fill="none" stroke="var(--accent)" strokeOpacity={0.7} strokeWidth={1.3} strokeDasharray="3 3" />}
              </g>
            )
          })}
          {drag?.moved && (() => {
            const sl = slotAt.get(drag.id)?.sl
            const wv = sl ? Math.max(18, x(sl.end) - x(sl.start)) : 40
            return <rect x={drag.x - wv / 2} y={drag.y - 9} width={wv} height={18} rx={9} fill={drag.overLater ? 'var(--st-fail)' : 'var(--accent)'} fillOpacity={0.7} pointerEvents="none" />
          })()}
          {/* what the hovered pebble waits for */}
          {hover && p.links.filter((l) => l.to === hover.slot.id).map((l) => {
            const from = slotAt.get(l.from), to = slotAt.get(l.to)
            if (!from || !to) return null
            const ax = x(from.sl.end), ay = from.cy, bx = x(to.sl.start), by = to.cy
            return <path key={l.from} d={`M ${ax} ${ay} C ${ax + 40} ${ay}, ${bx - 40} ${by}, ${bx} ${by}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
          })}
          {/* the goal they flow into */}
          <circle cx={gx} cy={gy} r={46} fill="url(#goal-glow)" />
          <circle cx={gx} cy={gy} r={20} fill="var(--accent)" />
          <circle cx={gx} cy={gy} r={7} fill="none" stroke="var(--on-accent)" strokeWidth={2} />
          <foreignObject x={gx - 70} y={gy + 26} width={140} height={60}>
            <p className="text-center text-micro font-semibold leading-tight text-fg-1" title={goal?.title}>{goal?.short ?? goal?.title ?? 'The goal'}</p>
            <p className="text-center text-micro text-fg-3">lands ~{fmt(s.end)}</p>
          </foreignObject>
        </svg>
      )}
     </div>
      {/* under the map: the angles not explored yet (one click hands one to the planner), and Later, where cut work goes */}
      {/* noGaps: they are listed beside the conversation instead */}
      {gaps.length > 0 && !noGaps && (
        <div className="mx-4 mt-1 flex shrink-0 items-center gap-1.5 overflow-x-auto py-1">
          <span className="label shrink-0 whitespace-nowrap text-fg-4">Not explored</span>
          {gaps.map((g) => { const a = areaOf(g), I = a.icon; return (
            <button key={g.id} onClick={() => onExplore?.(g)} title={`${a.label}: ${g.why}`}
                    className="group/gap inline-flex max-w-[280px] shrink-0 items-center gap-1.5 rounded-full border border-dashed px-2.5 py-0.5 text-meta text-fg-2 transition-colors hover:bg-hover hover:text-fg-1"
                    style={{ borderColor: `oklch(0.7 0.13 ${a.hue} / 0.6)` }}>
              <I className="size-3 shrink-0" style={{ color: `oklch(0.7 0.13 ${a.hue})` }} /><span className="truncate">{g.title}</span>
              <span className="shrink-0 text-accent-text opacity-0 transition-opacity group-hover/gap:opacity-100">+</span>
            </button>
          ) })}
        </div>
      )}
      {onMove && (
        <div ref={laterRef} className={`mx-4 mb-3 mt-1 flex shrink-0 items-center gap-3 overflow-x-auto rounded-card border border-dashed px-3 py-1.5 transition-colors ${drag?.moved ? (drag.overLater ? 'border-fail bg-fail/10' : 'border-fg-4 bg-hover/40') : 'border-line-strong'}`}>
          <p className="label shrink-0 whitespace-nowrap text-fg-4">Later · cut from this plan {cutNodes.length > 0 && <span className="normal-case tracking-normal text-fg-4">· {cutNodes.length}</span>}</p>
          {cutNodes.length ? (
            <div className="flex gap-1.5">
              {cutNodes.map((n) => (
                <span key={n.id} className="group/c inline-flex max-w-[260px] shrink-0 items-center gap-1 rounded-full bg-fill py-0.5 pl-2.5 pr-1 text-meta text-fg-2">
                  <button onClick={() => onSelect(n.id)} className="truncate hover:text-fg-1">{n.created?.identifier ? `${n.created.identifier} ` : ''}{n.title}</button>
                  <button onClick={() => onMove({ op: 'move', id: n.id, cut: false })} title="Bring it back" className="rounded-full px-1.5 py-0.5 text-micro font-medium text-accent-text hover:bg-accent-soft">Restore</button>
                </span>
              ))}
            </div>
          ) : <p className="text-meta text-fg-4">{drag?.moved ? 'Drop here to cut it' : 'Drag a ticket here to cut it from the plan'}</p>}
        </div>
      )}
      {hover && !drag?.moved && (
        <div className="pointer-events-none absolute z-10 w-[240px] -translate-x-1/2 -translate-y-full rounded-ctl bg-surface-1 px-3 py-2 text-small shadow-[var(--e3)] ring-1 ring-line" style={{ left: Math.min(Math.max(hover.x, 130), w - 130), top: hover.y - 8 }}>
          <p className="font-medium leading-snug text-fg-1">{title(hover.slot.id)}</p>
          {hover.slot.refine && <p className="mt-0.5 text-meta font-medium text-wait-text">Needs refining: {hover.slot.refine}</p>}
          {hover.slot.who && <p className="mt-0.5 text-meta text-fg-2">Picked up by {hover.slot.who}</p>}
          <p className="mt-0.5 text-meta text-fg-3">{hover.slot.sized ? '' : '~'}{hover.slot.points} pt · {hover.slot.done ? 'done' : hover.slot.started ? 'going on now' : `${fmt(hover.slot.start)} → ${fmt(hover.slot.end)}`}
            {p.links.some((l) => l.to === hover.slot.id) && ` · waits for ${p.links.filter((l) => l.to === hover.slot.id).map((l) => title(l.from)).join(', ').slice(0, 60)}`}</p>
          {moved.has(hover.slot.id) && <p className="mt-1 text-meta font-medium text-accent-text">{base?.nodes.some((n) => n.id === hover.slot.id) ? 'Changed in the draft' : 'New in the draft'}</p>}
          {evidence.get(hover.slot.id)?.map((b, i) => (
            <p key={i} className="mt-1 flex gap-1.5 text-meta leading-snug text-fg-2"><span className="shrink-0 rounded bg-accent-soft px-1 font-mono text-micro text-accent-text">{b.source}</span><span>{b.text}</span></p>
          ))}
        </div>
      )}
    </div>
  )
}

/** What the colours mean when they aren't the epics': MoSCoW, or who works each ticket. Over the board's top right. */
function ColorKey({ p, colorBy }: { p: Plan; colorBy: ColorBy }) {
  const dot = (hue: number | null) => <span className="size-2 shrink-0 rounded-full" style={{ background: hue === null ? 'var(--fg-4)' : `oklch(0.72 0.12 ${hue})` }} />
  const tickets = p.nodes.filter((n) => n.kind === 'ticket')
  const items: [string, number | null][] = colorBy === 'moscow'
    ? [...(['must', 'should', 'could', 'wont'] as const).map((m): [string, number] => [m === 'wont' ? "won't" : m, MOSCOW_HUE[m]]), ['unset', null]]
    : [...new Set(tickets.map((n) => n.assignee).filter((x): x is string => !!x))].slice(0, 8).map((who): [string, number] => [who, nameHue(who)])
  const unset = colorBy === 'moscow' ? tickets.filter((n) => !n.moscow).length : 0
  return (
    <div className="pointer-events-none absolute right-3 top-2 z-[2] flex max-w-[60%] flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-ctl bg-surface-1/85 px-2.5 py-1 text-micro text-fg-3 shadow-e1 backdrop-blur-sm">
      {items.length ? items.map(([label, hue]) => <span key={label} className="inline-flex items-center gap-1">{dot(hue)}{label}</span>) : <span>No one has picked any up yet</span>}
      {colorBy === 'moscow' && unset === tickets.length && tickets.length > 0 && <span className="text-wait-text">none set yet: ask the planner to prioritise</span>}
    </div>
  )
}

/** What the marks mean. */
function Legend() {
  const item = 'inline-flex items-center gap-1.5'
  return (
    <div className="sticky left-0 top-0 z-[1] flex flex-wrap items-center gap-x-4 gap-y-1 bg-surface-2/80 px-6 pb-1 pt-3 text-meta text-fg-3 backdrop-blur-sm">
      <span className={item}><span className="h-2.5 w-5 rounded-full bg-[oklch(0.72_0.12_200)]" />Done</span>
      <span className={item}><span className="h-2.5 w-5 animate-pulse rounded-full bg-[oklch(0.72_0.12_200/0.6)] ring-2 ring-[oklch(0.72_0.12_200)]" />In progress</span>
      <span className={item}><span className="h-2.5 w-5 rounded-full bg-[oklch(0.72_0.12_200/0.6)]" />To do</span>
      <span className={item}><span className="h-2.5 w-5 rounded-full border border-dashed border-[oklch(0.72_0.12_200)] bg-[repeating-linear-gradient(45deg,oklch(0.72_0.12_200/0.8)_0_2px,transparent_2px_5px)]" />Needs refining</span>
      <span className={item}><span className="h-2.5 w-5 rounded-full border border-dashed border-fg-4 opacity-60" />Past the appetite</span>
      <span className={item}><span className="flex size-4 items-center justify-center rounded-full bg-surface-1 text-[8px] font-bold text-fg-1 ring-1 ring-fg-3">AB</span>Picked up</span>
      <span className={item}><span className="text-fg-2">~3</span>points, ~ guessed</span>
      <span className={item}><span className="h-0.5 w-5 rounded-full bg-accent" />Critical path</span>
      <span className={item}><span className="h-2.5 w-5 rounded-full border border-dashed border-fg-3" />Where it was</span>
    </div>
  )
}
