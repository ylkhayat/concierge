// The standup as a pipeline: three stages left to right (what I did → what blocks me
// → what I'll do), one lane per project in its own colour (side quests last, grey), and in each lane a box per stage
// with its tickets as rows. A project's boxes are wired across the stages, so its day reads as one line.
import { Fragment, useId, useRef, type CSSProperties } from 'react'

export type Stage = 'did' | 'blockers' | 'next'
// review: someone else's PR, not my own work. facts: what the hover card says besides the title (state, PR, priority…)
export type Row = { id: string; title: string; lead: string; review?: boolean; facts?: [string, string][] }
export type Lane = { name?: string; rows: Record<Stage, Row[]> }
type Box = { lane: Lane; stage: Stage; hue?: number; onOpen: (id: string) => void }

const STAGES: { id: Stage; label: string; tone: string }[] = [
  { id: 'did', label: 'Did', tone: 'text-ok-text' },
  { id: 'blockers', label: 'Blocked', tone: 'text-wait-text' },
  { id: 'next', label: 'Next', tone: 'text-accent-text' },
]
const ROWS = 6 // a box shows this many tickets, then says how many more
/** A steady hue per project, from its name: the same colour every day, without a table to keep. */
// Lanes take one of a few hues far apart on the wheel, kept away from the two row marks (violet: my work, amber:
// reviews), so no two projects and no project and a mark read alike. A project keeps its hue every day (from its name).
// (hue and lightness both differ: every pair, marks included, is at least 18 apart in OKLab ×100, past the floor of 15)
const LANES: [number, number][] = [[180, 0.6], [20, 0.6], [230, 0.8], [350, 0.8], [100, 0.6], [150, 0.8]] // [hue, lightness]
export const hueOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) % LANES.length // an index into LANES
const laneColour = (lane?: number) => (lane === undefined ? 'var(--fg-3)' : `oklch(${LANES[lane][1]} 0.15 ${LANES[lane][0]})`)
// the row marks: my own work, and reviews of someone else's PR, in colours no theme accent or lane takes
const MINE = 'oklch(0.66 0.22 295)', REVIEW = 'oklch(0.8 0.16 75)'

function BoxNode({ lane, stage, hue, onOpen }: Box) {
  const rows = lane.rows[stage]
  return (
    <div className="card relative text-left">
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
              style={{ anchorName: name } as CSSProperties} className="flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-hover">
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
/** A lane's line across a gap: from the box before to the box after, at the height of their headers, in the lane's colour. */
const Wire = ({ hue, moving, className }: { hue?: number; moving?: boolean; className: string }) => (
  <span aria-hidden className={`pointer-events-none absolute top-[18px] h-0.5 ${className}`}
        style={{ background: `repeating-linear-gradient(90deg, color-mix(in oklch, ${laneColour(hue)} 60%, transparent) 0 ${moving ? '5px' : '100%'}, transparent ${moving ? '5px 9px' : '100%'})` }} />
)

/**
 * The pipeline: three columns (did, blocked, next), a row per project (most to say first, side quests last), a box where
 * a project has something in a stage, and its boxes joined across the row. It is the page's own layout, not a canvas:
 * it scrolls like the page, every ticket is a Tab away, and on a narrow window the columns keep a readable width and
 * scroll sideways together.
 */
export function StandupFlow({ lanes, counts, onOpen }: { lanes: Lane[]; counts: Record<Stage, number>; onOpen: (id: string) => void }) {
  const shown = lanes.filter((l) => STAGES.some((s) => l.rows[s.id].length))
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-[var(--bg-app)] ring-1 ring-line">
      {shown.length ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid min-w-[760px] grid-cols-3 gap-x-10 gap-y-5 p-4 pt-0">
            {STAGES.map((stage, k) => (
              <p key={stage.id} className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-[var(--bg-app)] px-1 pb-1 pt-3.5 text-body font-semibold">
                <span className={`flex size-6 items-center justify-center rounded-full bg-fill text-meta ${stage.tone}`}>{k + 1}</span>
                <span className="text-fg-1">{stage.label}</span><span className="text-small tabular-nums text-fg-3">{counts[stage.id]}</span>
                {/* what the row marks mean, once, over the last column */}
                {k === 2 && <span className="ml-auto flex items-center gap-3 text-micro font-normal text-fg-3">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full" style={{ backgroundColor: MINE }} />My work</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded-full" style={{ backgroundColor: REVIEW }} />Reviews</span>
                </span>}
              </p>
            ))}
            {shown.map((lane, i) => {
              const hue = lane.name ? hueOf(lane.name) : undefined
              const has = STAGES.map((s) => lane.rows[s.id].length > 0)
              return STAGES.map((s, k) => {
                const before = has.slice(0, k).some(Boolean), after = has.slice(k + 1).some(Boolean)
                return (
                  <div key={`${i}:${s.id}`} className="relative min-w-0">
                    {/* the line into this box from the one before it; an empty stage between two boxes carries it across */}
                    {has[k] && before && <Wire hue={hue} moving={s.id === 'next'} className="-left-10 w-10" />}
                    {!has[k] && before && after && <Wire hue={hue} moving={STAGES.slice(k + 1).find((x, j) => has[k + 1 + j])?.id === 'next'} className="-left-10 -right-0 w-[calc(100%+2.5rem)]" />}
                    {has[k] && <BoxNode lane={lane} stage={s.id} hue={hue} onOpen={onOpen} />}
                  </div>
                )
              })
            })}
          </div>
        </div>
      ) : <p className="p-6 text-small text-fg-3">Nothing on your tickets for this standup.</p>}
    </div>
  )
}
