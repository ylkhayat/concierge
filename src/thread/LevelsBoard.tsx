// The Understanding and Intent boards, drawn like the Standup pipeline: lanes down the board, each named at its left
// (Understanding: the dimension a change is to; Intent: why → what was decided → before and now → what to watch), its
// cards in a row beside the name, a hairline between lanes. One card, one border: nothing framed inside anything.
// A dimension the PR leaves alone isn't drawn: one quiet line over the board names them ("Unchanged: Data · Wiring").
// Every link is routed here, in the board's own coordinates (out of a card, along the gaps between cards and lanes, into
// the next): it never depends on where the browser measured a card, so it sits right at any window size and zoom.
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BookOpen, Check, Cloud, Cpu, Database, ExternalLink, Lightbulb, ListChecks, MessageCircleQuestion, Radio, ShieldAlert, TriangleAlert, UserRound, X, type LucideIcon } from 'lucide-react'
import { createContext, Fragment, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DIMS, linksAt, type Dim, type Levels, type Term } from '../../server/levels.ts'
import { edgeTypes } from '../components/Explain.tsx'
import { api, enc, calm } from '../lib.ts'

/** A card on a board: a change said in words. strong: the one the lane is about; faded: set aside. */
export type Card = { id: string; title: string; line?: string; before?: string; why?: string; tone?: 'strong' | 'faded' | 'ok' | 'wait' | 'bad'; more?: string[]; story?: string; href?: string; mono?: boolean
  who?: string; when?: string; deeper?: { title: string; line?: string }[]; files?: { title: string; path: string }[] } // story: its example, written with the board; href: where to check it (a file at the PR's head)
export type Lane = { id: string; label: string; hint: string; icon: LucideIcon; cards: Card[]; skip?: boolean } // skip: left out when empty, unnamed

const W = 260, H = 124, GAP = 24, LABEL_W = 168, LANE_GAP = 28, COLS = 4
const said = (x?: string) => x?.replace(/`([^`]+)`/g, '$1')
type Pt = { x: number; y: number }

// --- the glossary: a project word, underlined with dots wherever it shows, its plain meaning on hover or focus ----------
export const Glossary = createContext<Term[]>([])
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Text with its project words marked (the first time each shows in it); without a glossary, the text as it is. */
export function Termed({ text }: { text?: string }) {
  const terms = useContext(Glossary)
  const t = said(text) ?? ''
  if (!terms.length || !t) return <>{t}</>
  const sorted = [...terms].filter((x) => x.term.trim()).sort((a, b) => b.term.length - a.term.length)
  const re = new RegExp(`(?<![\\w-])(${sorted.map((x) => esc(x.term)).join('|')})(?![\\w-])`, 'gi')
  const seen = new Set<string>()
  return <>{t.split(re).map((part, i) => {
    const m = i % 2 ? sorted.find((x) => x.term.toLowerCase() === part.toLowerCase()) : undefined
    if (!m || seen.has(m.term)) return <Fragment key={i}>{part}</Fragment>
    seen.add(m.term)
    return <TermTip key={i} t={m} shown={part} />
  })}</>
}
function TermTip({ t, shown }: { t: Term; shown: string }) {
  const name = '--t' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const tip = useRef<HTMLSpanElement>(null)
  const show = (on: boolean) => { try { if (on) tip.current?.showPopover(); else tip.current?.hidePopover() } catch { /* already so */ } }
  return (
    <>
      <span tabIndex={0} onMouseEnter={() => show(true)} onMouseLeave={() => show(false)} onFocus={() => show(true)} onBlur={() => show(false)} style={{ anchorName: name } as CSSProperties}
            className="nodrag cursor-help underline decoration-fg-4 decoration-dotted underline-offset-[3px] outline-none focus-visible:decoration-accent">{shown}</span>
      <span ref={tip} popover="manual" role="tooltip" style={{ positionAnchor: name, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-block, flip-inline', inset: 'auto' } as CSSProperties}
            className="pointer-events-none m-0 mt-1 w-[260px] rounded-card border-0 bg-surface-1 px-3 py-2 text-left shadow-[var(--e2)] ring-1 ring-line-strong">
        <span className="block text-small font-semibold text-fg-1">{t.term}</span>
        <span className="mt-0.5 block text-small leading-snug text-fg-2">{t.means}</span>
      </span>
    </>
  )
}

const In = () => <Handle type="target" position={Position.Left} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const Out = () => <Handle type="source" position={Position.Right} className="!size-0 !min-h-0 !min-w-0 !border-0 !opacity-0" isConnectable={false} />
const TONE = { ok: 'bg-ok', wait: 'bg-wait', bad: 'bg-fail' } as const

function CardNode({ data: { c, on } }: NodeProps<Node<{ c: Card; on: boolean }>>) {
  return (
    <div style={{ width: W, height: H }} className={`card flex flex-col px-3 py-2.5 text-left transition-colors ${c.tone === 'strong' ? 'bg-accent-soft' : ''} ${c.tone === 'faded' ? 'opacity-55' : ''} ${on ? 'outline outline-2 outline-accent' : 'hover:bg-hover'}`}>
      <In /><Out />
      <p className="flex min-w-0 items-start gap-1.5">
        {c.tone && c.tone in TONE && <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TONE[c.tone as keyof typeof TONE]}`} />}
        <span className={`line-clamp-2 text-small font-semibold leading-snug text-fg-1 ${c.mono ? 'font-mono' : ''} ${c.tone === 'faded' ? 'line-through decoration-fg-4/50' : ''}`}>{c.mono ? said(c.title) : <Termed text={c.title} />}</span>
      </p>
      {c.line && <p className="mt-1 line-clamp-2 text-meta leading-snug text-fg-2"><Termed text={c.line} /></p>}
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
  // one right under the other (an assumption over its check): straight down, bottom to top
  if (Math.abs(a.x - b.x) < 1 && b.y > a.y + H) return [{ x: a.x + W / 2, y: a.y + H }, { x: b.x + W / 2, y: b.y }]
  const s = { x: a.x + W, y: a.y + H / 2 }, t = { x: b.x, y: b.y + H / 2 }
  if (Math.abs(s.y - t.y) < 1 && t.x > s.x && t.x - s.x <= GAP + 1) return [s, t] // side by side
  const x1 = s.x + GAP / 2, x2 = t.x - GAP / 2
  const y = gapY ?? a.y - GAP / 2 // the same lane: the gap over the source's row
  return [s, { x: x1, y: s.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: t.y }, t]
}

/** Lanes stacked down the board, cards left to right in each; a click opens a card's whole story on the side. */
/** A card as a short user story: written with the board; a card from before that, on its first click (server: /prs/:id/story), and kept. */
const told = new Map<string, string>()
// a board's cards without a sentence yet, asked for together as the board opens (server: /prs/:id/stories)
const asked = new Map<string, Promise<void>>()
function askAll(prId: string, board: 'understanding' | 'intent', cards: Card[]) {
  const missing = cards.filter((c) => !c.story && !told.has(`v3:${prId}:${board}:${c.id}`) && !waiting.has(`v3:${prId}:${board}:${c.id}`))
  if (!missing.length) return
  const k = `${prId}:${board}:${missing.map((c) => c.id).join()}`
  if (asked.has(k)) return
  const all = api(`/prs/${enc(prId)}/stories`, { board, cards: missing.map(({ id, title, line, before, why }) => ({ id, title, line, before, why })) })
    .then((r: { stories: Record<string, string> }) => { for (const [id, t] of Object.entries(r.stories)) told.set(`v2:${prId}:${board}:${id}`, t) }, () => { asked.delete(k); for (const c of missing) waiting.delete(`v3:${prId}:${board}:${c.id}`) })
  asked.set(k, all)
  for (const c of missing) waiting.set(`v3:${prId}:${board}:${c.id}`, all)
}
const waiting = new Map<string, Promise<void>>()
function Story({ prId, board, c }: { prId: string; board: 'understanding' | 'intent'; c: Card }) {
  const key = `v3:${prId}:${board}:${c.id}`
  const [text, setText] = useState(c.story ?? told.get(key)), [failed, setFailed] = useState(false)
  useEffect(() => {
    setText(c.story ?? told.get(key)); setFailed(false)
    if (c.story || told.has(key)) return
    let live = true
    // asked for with the rest of its board: that answer, else on its own
    void (waiting.get(key) ?? Promise.resolve()).then(() => {
    if (!live) return
    if (told.has(key)) return setText(told.get(key))
    api(`/prs/${enc(prId)}/story`, { board, card: { id: c.id, title: c.title, line: c.line, before: c.before, why: c.why } })
      .then((r: { story: string }) => { told.set(key, r.story); if (live) setText(r.story) }, () => { if (live) setFailed(true) })
    })
    return () => { live = false }
  }, [key, c.story]) // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null
  return (
    <div className="rounded-ctl bg-fill px-2.5 py-2">
      <p className="label text-fg-4">Example</p>
      {text ? <p className="mt-0.5 text-small leading-relaxed text-fg-1"><Termed text={text} /></p> : <p className="mt-1 space-y-1"><span className="block h-3 w-full animate-pulse rounded bg-fill-strong" /><span className="block h-3 w-4/5 animate-pulse rounded bg-fill-strong" /></p>}
    </div>
  )
}

export function LaneBoard({ prId, board, lanes, links, top, children, ask }: { prId: string; board: 'understanding' | 'intent'; lanes: Lane[]; links: [string, string][]; top?: React.ReactNode; children?: React.ReactNode; ask?: Card[] }) {
  const [on, setOn] = useState<string>()
  const drawn = lanes.filter((l) => l.cards.length)
  const every = ask ?? lanes.flatMap((l) => l.cards) // ask: every card at every depth, not only those shown
  useEffect(() => askAll(prId, board, every), [prId, board, every.map((c) => c.id).join()]) // eslint-disable-line react-hooks/exhaustive-deps
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
    const fit = () => { clearTimeout(t); t = setTimeout(() => void rf.fitView({ padding: 0.08, maxZoom: 1, duration: calm() ? 0 : 200 }), 40) }
    fit()
    const o = new ResizeObserver(fit); if (box.current) o.observe(box.current)
    return () => { clearTimeout(t); o.disconnect() }
  }, [shape, rf])
  const sel = lanes.flatMap((l) => l.cards).find((c) => c.id === on)
  return (
    <div className="relative flex min-h-0 flex-1 gap-3">
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
        // a phone has no room beside the board: the card rises over its lower part instead, the board still there above it
        <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden rounded-card bg-surface-1 ring-1 ring-line max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:max-h-[60%] max-md:w-auto max-md:shadow-e3">
          <p className="flex items-center gap-2 border-b border-line px-3 py-2 text-small font-semibold text-fg-1"><span className={`min-w-0 flex-1 ${sel.mono ? 'font-mono' : ''}`}>{sel.mono ? said(sel.title) : <Termed text={sel.title} />}</span>
            <button onClick={() => setOn(undefined)} aria-label="Close" className="text-fg-4 hover:text-fg-1 max-md:-m-2 max-md:p-2.5"><X className="size-3.5" /></button></p>
          <Insights prId={prId} board={board} c={sel} />
        </aside>
      )}
    </div>
  )
}

/**
 * A card, opened: its story in plain terms, as labelled rows (who it's for, when it shows up, before, now, why it
 * matters), a real example, then one level deeper: how it works, and the files it lives in.
 */
function Insights({ prId, board, c }: { prId: string; board: 'understanding' | 'intent'; c: Card }) {
  const rows: [string, string | undefined, string][] = [
    ["Who it's for", c.who, 'text-fg-1'], ['When', c.when, 'text-fg-1'],
    ['Before', c.before, 'text-fg-3'], [c.href ? 'What to check' : c.before ? 'Now' : 'What', c.line, 'text-fg-1'], ['Why it matters', c.why, 'text-fg-2'],
  ]
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        {rows.filter(([, t]) => t).map(([label, t, tone]) => (
          <Fragment key={label}><dt className="label pt-0.5 text-fg-4">{label}</dt><dd className={`text-small leading-snug ${tone}`}><Termed text={t} /></dd></Fragment>
        ))}
      </dl>
      {c.href && <a href={c.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-small font-medium text-accent-text hover:underline">Open these lines on GitHub<ExternalLink className="size-3" /></a>}
      {!c.href && <Story prId={prId} board={board} c={c} />}
      {!!c.deeper?.length && (
        <section>
          <p className="label text-fg-4">How it works</p>
          <ul className="mt-1.5 space-y-2">
            {c.deeper.map((d) => <li key={d.title}><p className="text-small font-medium text-fg-1"><Termed text={d.title} /></p>{d.line && <p className="text-meta leading-snug text-fg-2"><Termed text={d.line} /></p>}</li>)}
          </ul>
        </section>
      )}
      {!!c.files?.length && (
        <section>
          <p className="label text-fg-4">Where it lives</p>
          <ul className="mt-1.5 space-y-1.5">
            {c.files.map((f) => <li key={f.path}><p className="text-small text-fg-1">{said(f.title)}</p><p className="truncate font-mono text-micro text-fg-4" title={f.path}>{f.path}</p></li>)}
          </ul>
        </section>
      )}
      {!c.deeper?.length && !!c.more?.length && (
        <section><p className="label text-fg-4">Inside</p><ul className="mt-1 space-y-0.5">{c.more.map((m) => <li key={m} className="text-small text-fg-2"><Termed text={m} /></li>)}</ul></section>
      )}
    </div>
  )
}

/** The lanes' icons, for Intent's story (ChangeMap.tsx). */
export const STORY_ICONS = { why: Lightbulb, decided: ListChecks, change: Radio, watch: TriangleAlert, answers: MessageCircleQuestion }

// --- Understanding: the levels ----------------------------------------------------------------------------------

const DIM: Record<Dim, { label: string; hint: string; icon: LucideIcon }> = {
  behaviour: { label: 'Behaviour', hint: 'what a user or caller notices', icon: UserRound },
  data: { label: 'Data', hint: 'what is stored or sent', icon: Database },
  contract: { label: 'Contract', hint: 'APIs and messages between parts', icon: Radio },
  logic: { label: 'Logic', hint: 'rules and decisions', icon: Cpu },
  wiring: { label: 'Wiring', hint: 'config, dependencies, environments', icon: Cloud },
  security: { label: 'Security', hint: 'access, secrets, privacy', icon: ShieldAlert },
  safety: { label: 'Safety net', hint: 'tests and checks', icon: Check },
}
/** A file's card is titled by what it is, never its name: the model's words, else the start of what it does now. */
const titleOf = (n: Levels['nodes'][number]) => n.path && (!n.title || n.title.includes('.') || n.title === n.path.split('/').pop()) ? (said(n.after) ?? '').split(/[.:;,(]/)[0].split(' ').slice(0, 6).join(' ') : n.title

/**
 * Understanding, on one board: what this is (Context) and what went wrong (The problem) first, then what changes, in a
 * lane per dimension, wired by cause. A card opens into its story in plain terms, an example, how it works and its files.
 */
export function LevelsBoard({ prId, levels }: { prId: string; levels: Levels }) {
  const { lanes, links, ask } = useMemo(() => {
    const kids = (id: string) => levels.nodes.filter((n) => n.parent === id)
    const card = (n: Levels['nodes'][number]): Card => {
      const deeper = n.level === 3 ? kids(n.id) : []
      const files = deeper.flatMap((d) => kids(d.id)).filter((f) => f.path).map((f) => ({ title: titleOf(f), path: f.path! }))
      return { id: n.id, title: titleOf(n), line: n.after, before: n.before, why: n.why, story: n.story, who: n.who, when: n.when,
        deeper: deeper.filter((d) => !d.path).map((d) => ({ title: titleOf(d), line: d.after })), files, more: deeper.length ? deeper.map(titleOf) : undefined }
    }
    const at = (l: number) => levels.nodes.filter((n) => n.level === l)
    const changes = at(3)
    const lanes: Lane[] = [
      { id: 'context', label: 'Context', hint: 'what this is, for someone new to it', icon: BookOpen, cards: at(1).map((n) => ({ ...card(n), tone: 'strong' as const })) },
      { id: 'problem', label: 'The problem', hint: 'what went wrong, and why it matters', icon: TriangleAlert, cards: at(2).map(card) },
      ...DIMS.map((d) => ({ id: d, ...DIM[d], cards: changes.filter((n) => n.dim === d).map(card) })),
    ]
    return { lanes, links: linksAt(levels, 3), ask: levels.nodes.map((n) => ({ id: n.id, title: titleOf(n), line: n.after, before: n.before, why: n.why, story: n.story })) }
  }, [levels])
  const unchanged = lanes.slice(2).filter((l) => !l.cards.length).map((l) => l.label)
  return (
    <Glossary.Provider value={levels.glossary ?? []}>
      <LaneBoard prId={prId} board="understanding" lanes={lanes} links={links} ask={ask}
                 top={unchanged.length ? <p className="px-2 text-meta text-fg-3"><span className="text-fg-4">Unchanged:</span> {unchanged.join(' · ')}</p> : undefined} />
    </Glossary.Provider>
  )
}
