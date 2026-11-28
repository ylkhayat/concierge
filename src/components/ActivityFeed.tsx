import {
  ArrowRightLeft, CheckCheck, Copy, GitCommitHorizontal, Hourglass, MessageSquareWarning, PlugZap, Radio,
  Bot, CircleCheck, FilePen, FileText, Search, ShieldAlert, Sparkles, SquareTerminal, TriangleAlert, Users, Wrench,
  ChevronRight, type LucideIcon,
} from 'lucide-react'
import { memo, startTransition, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api, here, hereIn, type Activity, wholeFeed } from '../lib.ts'
import { Md } from './Md.tsx'
import { Tabs } from './Tabs.tsx'
import { LANE } from './NextSteps.tsx'
import { BgNow, turnOver } from './Background.tsx'
import { chaptersOf, HANDOVER, once, type Chapter } from '../chapters.ts'
import { clock, stamp, when } from '../time.ts'

const TOOL_ICON: Record<string, LucideIcon> = {
  Bash: SquareTerminal, Read: FileText, Write: FilePen, Edit: FilePen, Grep: Search, Glob: Search,
  Agent: Users, Skill: Sparkles,
}

function iconFor(a: Activity): [LucideIcon, string] {
  if (a.kind === 'text') return [Bot, 'text-accent']
  if (a.kind === 'result') return [CircleCheck, 'text-ok-text']
  if (a.kind === 'error') return [TriangleAlert, 'text-fail-text']
  if (a.kind === 'denied') return [ShieldAlert, 'text-wait-text']
  return [TOOL_ICON[a.tool ?? ''] ?? Wrench, 'text-fg-3']
}

/** Every row's badge: a small tinted square with its icon (or letter), one size for every kind of row. */
const BADGE = 'relative z-10 flex size-[22px] shrink-0 items-center justify-center rounded-ctl'
const TINT = { you: 'bg-accent-soft text-accent-text', agent: 'bg-hover text-fg-2', ok: 'bg-ok/15 text-ok-text', fail: 'bg-fail/15 text-fail-text', warn: 'bg-wait/15 text-wait-text', quiet: 'bg-hover text-fg-4', run: 'bg-run/15 text-run-text' } as const
/** Every row's time: in its own column on the right, always shown. */
const Time = ({ at, seconds }: { at: string; seconds?: boolean }) => <time className="hidden shrink-0 pt-[3px] font-mono text-micro tabular-nums text-fg-4 sm:block" title={stamp(at)}>{clock(at, seconds)}</time>

export function ActivityFeed({ feed, live, bg, toast, after, pin = true }: { feed: Activity[]; live: boolean; bg?: { base: string; count: number }; toast?: (m: string, tone?: 'ok' | 'error') => void; after?: (a: Activity) => ReactNode; pin?: boolean }) {
  // the line that stands for what came before the part that was read (lib.ts): a way to it, not an entry
  const earlier = feed.find((a) => a.earlier)
  const [reading, setReading] = useState(false)
  const chapters = chaptersOf(once(earlier ? feed.filter((a) => !a.earlier) : feed))
  const [details] = useFeedDetails()
  // the newest chapter is open, earlier ones folded; a click flips one from its default
  const [flipped, setFlipped] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setFlipped((s) => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n })
  const box = useRef<HTMLDivElement>(null)
  // pinned to the newest line from the start, through loading and new lines; scrolling up unpins, back down repins.
  // The box that scrolls is the nearest one that does: its parent is not (in a thread it is the chat's column), so
  // scrolling up never unpinned, and every new line pulled you back down to the bottom
  const pinned = useRef(true)
  // a new run folds the one before it, unless you are up there reading it: it stays open, so what you read doesn't
  // fold away from under you
  const kept = useRef(new Set<string>()), lastKey = useRef(chapters.at(-1)?.key)
  const newest = chapters.at(-1)?.key
  if (newest !== lastKey.current) { if (lastKey.current && !pinned.current) kept.current.add(lastKey.current); lastKey.current = newest }
  const open = (ch: Chapter, i: number) => (i === chapters.length - 1 || kept.current.has(ch.key)) !== flipped.has(ch.key)
  // a page opening draws the newest lines of its run first (the feed is pinned to them, so they are what's in view),
  // and the rest just after, in a transition a click can interrupt: a run of a few hundred lines drew every message's
  // markdown inside the click that opened it
  const [whole, setWhole] = useState(false)
  useEffect(() => {
    if (whole || !feed.length) return
    // after the first frame has painted (a frame, then a task)
    let t: ReturnType<typeof setTimeout> | undefined
    const f = requestAnimationFrame(() => { t = setTimeout(() => startTransition(() => setWhole(true))) })
    return () => { cancelAnimationFrame(f); clearTimeout(t) }
  }, [whole, feed.length > 0])
  const pane = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const b = pane.current = scroller(box.current)
    if (!b) return
    const on = () => { pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80 }
    b.addEventListener('scroll', on, { passive: true })
    return () => b.removeEventListener('scroll', on)
  }, [feed.length > 0])
  useLayoutEffect(() => {
    if (!pinned.current || !pin) return // pin: off where the page around keeps its own place (more follows the feed)
    // only that box, to its end (scrollIntoView moved every box around it too); after layout and once more next
    // frame: markdown and code blocks can grow after the first paint
    const down = () => { const b = pane.current ?? scroller(box.current); if (b && pinned.current) b.scrollTop = b.scrollHeight }
    down()
    const id = requestAnimationFrame(down)
    return () => cancelAnimationFrame(id)
  }, [feed.length, live, whole])

  const entry = (a: Activity, k: string) => {
          // a turn of Intent or Understanding: a plain message with its lane's rail and name (yours to the right, as yours are)
          if (a.lane) return (
            <li key={k} className={`lane lane-${a.lane} ${a.kind === 'you' ? 'ml-auto max-w-[85%]' : 'max-w-full'}`}>
              <p className="mb-0.5 flex items-center gap-1.5 text-micro">
                <span className={`font-semibold ${LANE[a.lane].text}`}>{LANE[a.lane].label}</span>
                <span className="text-fg-4">{a.kind === 'you' ? 'you asked' : 'answered'}</span><span className="flex-1" /><Time at={a.at} />
              </p>
              {a.kind === 'you' ? <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-fg-1">{a.text}</p>
                : <Md text={a.text} className="break-words !text-body !leading-relaxed text-fg-2 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0 [&_pre]:!text-small" />}
            </li>
          )
          // three voices, three places: the agent on the left, you on the right, the outside world across the middle
          const ho = a.kind === 'you' ? HANDOVER.exec(a.text) : null
          if (ho) return <HandoverCard key={k} a={a} from={ho[1]} />
          // what you said: a row like the rest, its badge in the accent
          if (a.kind === 'you') return <YouSaid key={k} a={a} />
          // the plan made before the run: the skills it will load (each one readable on hover) and the steps
          if (a.kind === 'event' && a.plan) return (
            <li key={k} className="relative z-10 my-2 ml-8 rounded-ctl bg-surface-1 p-3 shadow-e1">
              <p className="flex items-center gap-1.5 text-small font-medium text-fg-3"><Sparkles className="size-3.5 text-accent-text" />Plan for this run
                <span className="text-fg-4">· {a.plan.by === 'rules' ? 'by rule' : 'picked by a small model'}{a.plan.env ? ` · ${a.plan.env === 'prod' ? 'production' : 'development'} data` : ''}</span>
                <time className="ml-auto font-mono text-micro text-fg-4">{clock(a.at)}</time></p>
              {a.plan.skills.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.plan.skills.map((x) => <li key={x.name} className="text-small text-fg-2"><SkillPeek name={x.name} /> <span className="text-fg-3">{x.why}</span></li>)}
                </ul>
              )}
              {a.plan.steps.length > 0 && (
                <ol className="mt-2.5 space-y-0.5 border-t border-line pt-2">
                  {a.plan.steps.map((x, i) => <li key={i} className="flex gap-2 text-small text-fg-2"><span className="w-3 shrink-0 text-right tabular-nums text-fg-4">{i + 1}</span>{x}</li>)}
                </ol>
              )}
            </li>
          )
          if (a.kind === 'event') {
            const e = shapeOf(a)
            const warn = /\b(stuck|stopped|couldn't|can't|didn't|failed|no output)\b/i.test(e.text)
            const E = e.items ? Hourglass : e.names ? PlugZap : e.skill ? Sparkles : /push/.test(e.text) ? GitCommitHorizontal : /comment/.test(e.text) ? MessageSquareWarning
              : /approved/.test(e.text) ? CheckCheck : /\b(mov|takes? (it|over)|stands? in|runs on)\b/i.test(e.text) ? ArrowRightLeft : warn ? TriangleAlert : Radio
            // a note from Concierge, not the agent: one quiet line in the feed's own column, never a banner; a warning
            // keeps its colour so it still stands out among them
            return (
              <li key={k} className="relative z-10 rounded-chip px-1.5 py-0.5">
                <div className={`flex items-start gap-2 text-small leading-relaxed ${warn ? 'text-fg-2' : 'text-fg-3'}`}>
                  <span className={`${BADGE} ${warn ? TINT.warn : TINT.quiet}`}><E className="size-3" aria-hidden /></span>
                  <span className="min-w-0 flex-1 pt-px">
                    {a.who && <span className="font-medium text-fg-2">{a.who} </span>}
                    {e.skill ? <>{e.text.replace(e.skill, '').trim()} <SkillPeek name={e.skill} /></> : e.text}
                    {/* its data, apart from the sentence: tasks with their commands, or names, folded */}
                    {e.names && (
                      <details className="group/names">
                        <summary className="cursor-pointer list-none text-fg-4 hover:text-fg-2">
                          <span className="group-open/names:hidden">Show {e.names.length === 1 ? 'it' : `all ${e.names.length}`}</span><span className="hidden group-open/names:inline">Hide</span>
                        </summary>
                        <span className="mt-1 flex flex-wrap gap-1">{e.names.map((n) => <span key={n} className="rounded bg-hover px-1.5 py-px font-mono text-micro text-fg-2">{n}</span>)}</span>
                      </details>
                    )}
                  </span>
                  <Time at={a.at} seconds />
                </div>
                {e.items && (
                  <ul className="ml-8 mt-1 max-w-[620px] divide-y divide-line overflow-hidden rounded-ctl bg-surface-1 ring-1 ring-line">
                    {e.items.map((x, i) => (
                      <li key={i} className="group/it px-3 py-2">
                        <p className="break-words text-small font-medium text-fg-1">{x.label}</p>
                        {x.detail && (
                          <p className="mt-0.5 flex items-center gap-1.5">
                            <code className="min-w-0 flex-1 truncate font-mono text-meta text-fg-3" title={x.detail}>{x.detail}</code>
                            <button onClick={() => void navigator.clipboard.writeText(x.detail!)} title="Copy the command" aria-label="Copy the command"
                                    className="shrink-0 rounded p-0.5 text-fg-4 opacity-0 transition-opacity hover:text-fg-1 group-hover/it:opacity-100"><Copy className="size-3" /></button>
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          }
          if (a.kind === 'text' || a.kind === 'result') return (
            <li key={k} className="group/msg pt-1">
              <Md text={a.text} className="break-words !text-body !leading-relaxed text-fg-1 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0 [&_h1]:!text-reading [&_h2]:!text-body [&_h3]:!text-body [&_pre]:!text-small [&_table]:!text-small" />
              {after?.(a)}
              {/* its time on hover, on a line of its own under it (as yours is): hung below it, it covered the next row,
                  and under a turn's last message the turn's paint containment (.cv) cut it off */}
              <time className="mt-0.5 block font-mono text-micro leading-none tabular-nums text-fg-4 opacity-0 transition-opacity group-hover/msg:opacity-100" title={stamp(a.at)}>{clock(a.at, true)}</time>
            </li>
          )
          const [Icon] = iconFor(a)
          const prose = a.kind === 'error'
          return (
            <li key={k} className="group/ev relative flex items-start gap-2 rounded-chip px-1.5 py-0.5 transition-colors duration-150 hover:bg-hover">
              <span className={`${BADGE} ${a.kind === 'error' ? TINT.fail : a.kind === 'denied' ? TINT.warn : TINT.quiet} !size-[18px] !rounded-chip`}>
                <Icon className="size-3" aria-hidden />
              </span>
              <div className={`min-w-0 flex-1 text-small leading-relaxed ${a.kind === 'error' ? 'rounded-ctl bg-fail/[0.06] px-3 py-2 ring-1 ring-fail/15' : 'pt-px'}`}>
                {a.tool && <span className={`mr-2 rounded-chip px-1.5 py-px font-mono text-meta ${a.kind === 'denied' ? 'bg-wait/10 text-wait-text' : 'bg-fill text-fg-2 '}`}>{a.kind === 'denied' ? `denied ${a.tool}` : a.tool}</span>}
                {/* what the agent says is markdown (lists, headings, tables, code); errors stay as they came */}
                {<span className={prose ? 'whitespace-pre-wrap break-words text-fg-2 ' : 'break-all font-mono text-small text-fg-3 transition-colors group-hover/ev:text-fg-1'}>{prose ? <Inline text={a.text} /> : a.text}</span>}
              </div>
              <Time at={a.at} seconds />
            </li>
          )
  }

  if (!feed.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-reading text-fg-3">
        <Bot className={`size-6 ${live ? 'animate-pulse text-run-text' : 'text-fg-4'}`} aria-hidden />
        {live ? 'Waiting for the first event…' : 'No agent run yet for this PR.'}
      </div>
    )
  }
  return (
    <div ref={box} className="px-4 py-3">
      {earlier?.feedId && (
        <button onClick={() => { setReading(true); void wholeFeed(earlier.feedId!).catch(() => {}).finally(() => setReading(false)) }} disabled={reading}
                className="btn-ghost btn-sm mb-3 inline-flex items-center gap-1.5">
          {reading ? 'Reading…' : `Show the ${earlier.earlier} earlier lines`}
        </button>
      )}
      <ol className="relative space-y-5">
        {chapters.map((ch, ci) => (
          <Turn key={ch.key} ch={ch} open={open(ch, ci)} live={live && ci === chapters.length - 1} details={details} onToggle={() => toggle(ch.key)} tail={whole ? undefined : TAIL}
                until={chapters[ci + 1]?.head?.at} before={chapters.slice(0, ci).flatMap((c) => c.items).findLast((a) => a.costUsd != null)?.costUsd}
                entry={(a, k) => entry(a, `${ci}:${k}`)} />
        ))}
      </ol>
      {live && bg && <div className="mt-1"><BgNow base={bg.base} count={bg.count} parked={turnOver(feed)} toast={toast} /></div>}
    </div>
  )
}

/** The nearest box around `el` that scrolls. */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n
  return null
}

/** A key for each line that stays its own as lines come and go (the turn's body was keyed by place: a line dropped
 *  or added earlier in it, as a result replacing the message it repeats, gave every line after it another one's key,
 *  so they remounted and their entrances played again in place). */
function keysOf(items: Activity[]): Map<Activity, string> {
  const seen = new Map<string, number>(), out = new Map<Activity, string>()
  for (const a of items) {
    const base = `${a.at}|${a.kind}|${a.tool ?? ''}|${a.lane ?? ''}`, n = seen.get(base) ?? 0
    seen.set(base, n + 1); out.set(a, n ? `${base}#${n}` : base)
  }
  return out
}

type SkillDoc = { name: string; description?: string; body?: string; company?: boolean; missing?: boolean }
const skillDocs = new Map<string, Promise<SkillDoc>>()
const skillDoc = (name: string) => {
  if (!skillDocs.has(name)) skillDocs.set(name, api(`/skills/${encodeURIComponent(name)}`).catch(() => ({ name, missing: true })))
  return skillDocs.get(name)!
}

/** A skill's name that shows what the skill says: on hover (a short pause first), or on a tap. */
export function SkillPeek({ name }: { name: string }) {
  const id = 'skill' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const [doc, setDoc] = useState<SkillDoc>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pop = () => document.getElementById(id)
  const show = (wait: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => { void skillDoc(name).then(setDoc); pop()?.showPopover() }, wait) }
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => pop()?.hidePopover(), 220) }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <>
      <button onMouseEnter={() => show(280)} onMouseLeave={hide} onFocus={() => show(0)} onBlur={hide} onClick={() => show(0)}
              style={{ anchorName: `--${id}` } as CSSProperties}
              className="rounded-chip bg-accent-soft px-1.5 py-px font-medium text-accent-text underline decoration-accent/30 decoration-dotted underline-offset-4 transition-colors duration-150 hover:decoration-accent">
        {name}
      </button>
      <div id={id} popover="auto" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide}
           style={{ positionAnchor: `--${id}`, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-block, flip-inline', inset: 'auto' } as CSSProperties}
           className="m-0 my-1.5 max-h-[min(60vh,560px)] w-[min(540px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-card border-0 bg-surface-1 p-0 text-fg-1 shadow-e2">
        <header className="sticky top-0 border-b border-line bg-surface-1/90 px-4 pb-2.5 pt-3 backdrop-blur">
          <p className="flex items-center gap-1.5 text-body font-semibold"><Sparkles className="size-3.5 text-accent-text" />{name}
            {doc?.company && <span className="rounded-full bg-accent-soft px-1.5 text-micro font-medium text-accent-text">company</span>}</p>
          {doc?.description && <p className="mt-1 line-clamp-3 text-small leading-relaxed text-fg-3">{doc.description}</p>}
        </header>
        <div className="px-4 py-3">
          {!doc ? <p className="text-small text-fg-3">Reading the skill…</p>
            : doc.missing ? <p className="text-small text-fg-3">This skill isn’t on this machine (a plugin’s, or one only the agent’s account has).</p>
            : <Md text={doc.body ?? ''} className="!text-small [&_h1]:!text-reading [&_h2]:!text-body [&_h3]:!text-small [&_pre]:!text-meta" />}
        </div>
      </div>
    </>
  )
}

/** An event's sentence and its data. New ones carry the data apart; older logs said it all in one string, so the same
 *  split is read back from their text. */
function shapeOf(a: Activity): { text: string; items?: { label: string; detail?: string }[]; names?: string[]; skill?: string } {
  if (a.items || a.names || a.skill) return { text: a.text, items: a.items, names: a.names, skill: a.skill }
  const bg = a.text.match(/^(Its turn ended with .*? in the background; it goes on once (?:it finishes|they finish)): (.+)$/)
  if (bg) {
    // each was "what it is" then its command: the command starts at the first path, assignment or shell word
    const items = bg[2].split(' · ').map((x) => {
      const m = x.match(/^(.*?)\s+((?:[~/.]\S*\/|\w+=|sleep |cd |bash |sh |python3? |node |pnpm |npx |uv |make |tail |curl |git ).*)$/)
      return m ? { label: m[1], detail: m[2] } : { label: x }
    })
    return { text: `${bg[1]}.`, items }
  }
  const conn = a.text.match(/^Connectors that didn't start: (.+)$/)
  if (conn) { const names = conn[1].split(', '); return { text: `${names.length === 1 ? 'A connector' : `${names.length} connectors`} didn't start: the agent can't use ${names.length === 1 ? 'it' : 'them'} this run.`, names } }
  const skill = a.text.match(/^Loaded the company skill (\S+)$/)
  if (skill) return { text: a.text, skill: skill[1] }
  return { text: a.text }
}

/** What the conversation needs: what it says, what you said, outcomes, errors, its plan, and what came from outside or
 *  went wrong. The rest (its steps, system notes) folds away until you want it. */
const matters = (a: Activity) => a.kind === 'text' || a.kind === 'result' || a.kind === 'error' || a.kind === 'you' || a.kind === 'denied'
  || (a.kind === 'event' && (!!a.who || !!a.plan || /\b(stuck|stopped|couldn't|can't|didn't|failed|no output)\b/i.test(a.text)))
/** "Worked 47s · 14 steps · git, gh, Read": what the agent did between two things it said, one quiet line that opens
 *  to every step (each with its time to the second). Open from the start under Everything. */
function Worked({ items, until, open: start, live, render }: { items: Activity[]; until?: string; open: boolean; live?: boolean; render: (a: Activity, i: number) => ReactNode }) {
  const [flip, setFlip] = useState(false)
  const open = start !== flip
  const count = new Map<string, number>()
  for (const a of items.filter((x) => x.kind === 'tool')) { const n = a.tool === 'Bash' ? a.text.trim().split(/\s+/)[0].replace(/^.*\//, '') : a.tool ?? 'tool'; count.set(n, (count.get(n) ?? 0) + 1) }
  const names = [...count].sort((x, y) => y[1] - x[1]).map(([n]) => n)
  const steps = items.filter((a) => a.kind === 'tool').length, notes = items.length - steps
  const ms = (until ? Date.parse(until) : live ? Date.now() : Date.parse(items.at(-1)!.at)) - Date.parse(items[0].at)
  const warn = items.some((a) => a.kind === 'denied' || a.kind === 'error')
  return (
    <li className="list-none">
      <button onClick={() => setFlip(!flip)} aria-expanded={open}
              className="group/run flex max-w-full items-center gap-1.5 rounded-chip py-0.5 pr-1.5 text-left text-small text-fg-3 transition-colors duration-150 hover:text-fg-1">
        {live ? <span className="relative flex size-3.5 items-center justify-center"><span className="absolute size-2 animate-ping rounded-full bg-run/50" /><span className="size-1.5 rounded-full bg-run" /></span>
          : <Wrench className={`size-3.5 shrink-0 ${warn ? 'text-wait-text' : 'text-fg-4'}`} aria-hidden />}
        <span className="min-w-0 truncate">
          <span className={live ? 'text-shimmer' : ''}>{live ? 'Working' : 'Worked'}{ms >= 1000 ? ` ${secs(ms)}` : ''}</span>
          <span className="text-fg-4">{[steps && ` · ${steps} step${steps === 1 ? '' : 's'}`, notes && ` · ${notes} note${notes === 1 ? '' : 's'}`].filter(Boolean).join('')}{names.length > 0 && ` · ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`}</span>
        </span>
        <ChevronRight className={`size-3.5 shrink-0 text-fg-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <ol className="ml-[7px] mt-0.5 animate-[fade-in_160ms] border-l border-line pl-2.5">{items.map(render)}</ol>}
    </li>
  )
}

/** Your words: on the right, in a bubble, as in any chat. Long ones fold to five lines. */
function YouSaid({ a, clamp }: { a: Activity; clamp?: boolean }) {
  return (
    <li className="group/you flex list-none flex-col items-end gap-0.5 py-0.5">
      {/* the clamp on the text, not the bubble: on the bubble the next line shows through its padding */}
      <p className="max-w-[85%] rounded-card rounded-br-chip bg-accent-soft px-3.5 py-2 text-body leading-relaxed text-fg-1">
        <span className={`block whitespace-pre-wrap break-words ${clamp ? 'line-clamp-3' : ''}`}>{a.text}</span>
      </p>
      <time className="font-mono text-micro tabular-nums text-fg-4 opacity-0 transition-opacity group-hover/you:opacity-100" title={stamp(a.at)}>{clock(a.at, true)}</time>
    </li>
  )
}

// the conversation by default; every step and note when you want them: kept in this browser, shared by the switch
// in the tab bar and every feed on the page
const DETAILS = 'feed:details'
const readDetails = () => { try { return localStorage.getItem(DETAILS) === '1' } catch { return false } }
export function useFeedDetails(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(readDetails)
  useEffect(() => { const f = () => setOn(readDetails()); addEventListener('feed:details', f); return () => removeEventListener('feed:details', f) }, [])
  return [on, (v) => { try { localStorage.setItem(DETAILS, v ? '1' : '0') } catch { /* private window */ } setOn(v); dispatchEvent(new Event('feed:details')) }]
}
/** Conversation | Everything: what the Activity tab shows. */
export function FeedMode() {
  const [details, setDetails] = useFeedDetails()
  return (
    <Tabs size="sm" label="What Activity shows" value={details ? 'all' : 'talk'} onChange={(v) => setDetails(v === 'all')}
          options={[{ id: 'talk', label: 'Conversation' }, { id: 'all', label: 'Everything' }]} />
  )
}

// URLs, `code` and **bold** in errors and the like; what the agent says renders as full markdown (Md).
const TOKEN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"*])|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g

export function Inline({ text: raw }: { text: string }) {
  const text = hereIn(raw) // localhost links agents print, also inside **bold** and `code`
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const [whole, url, code, bold] = m
    if (url) out.push(<a key={m.index} href={here(url)} target="_blank" rel="noreferrer" className="break-all text-accent-text underline decoration-accent/30 underline-offset-2 transition-colors hover:decoration-current">{here(url)}</a>)
    else if (code) out.push(<code key={m.index} className="rounded bg-fill px-1 py-px font-mono text-[0.88em]">{code}</code>)
    else if (bold) out.push(<strong key={m.index} className="font-semibold text-fg-1 "><Inline text={bold} /></strong>) // a **URL** stays a link
    else out.push(whole)
    last = m.index! + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}


const secs = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s` : `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`

/**
 * One run, as a turn of a chat: what started it (your words on the right, or what it was: Review, Revise…), what the
 * agent said, and what it did between, folded into "Worked 47s · 9 steps" lines. Its facts (when, how long, the cost,
 * the account) sit in one quiet line above it. Folded (an earlier turn), it is what started it and how it ended.
 */
// a run that is over doesn't change: it renders again only when it opens, closes or gets a line (the live one)
const Turn = memo(TurnImpl, (a, b) => a.ch.key === b.ch.key && a.ch.items.length === b.ch.items.length && a.open === b.open && a.live === b.live && a.details === b.details && a.until === b.until && a.before === b.before && a.tail === b.tail)
/** How much of a turn's body a page's first frame draws: its last parts (ActivityFeed's `whole`). */
const TAIL = 16
function TurnImpl({ ch, open, live, details, onToggle, until, before, entry, tail }: {
  ch: Chapter; open: boolean; live: boolean; details: boolean; onToggle: () => void; until?: string; before?: number; entry: (a: Activity, k: string) => ReactNode; tail?: number
}) {
  const h = ch.head!
  const steps = ch.items.filter((a) => a.kind === 'tool').length
  const ok = ch.outcome?.kind === 'result', bad = ch.outcome?.kind === 'error'
  const stop = until && ch.end && until < ch.end ? until : ch.end
  // Claude reports the session's running total: this run cost its last total minus the one before it (a new session restarts it)
  const last = ch.items.findLast((a) => a.costUsd != null)?.costUsd
  const cost = last == null ? 0 : before != null && last >= before ? last - before : last
  const account = ch.items.map((a) => a.kind === 'event' && (a.text.match(/^Runs on ([^,.]+)/)?.[1] ?? a.text.match(/^Moved to ([^,.]+)/)?.[1])).filter(Boolean).at(-1) as string | undefined
  // what started it: your words, when the run opens with them (a handover or a lane's turn is not that)
  const trigger = ch.items.slice(0, 3).find((a) => a.kind === 'you' && !a.lane && !HANDOVER.test(a.text))
  const rest = ch.items.filter((a) => a !== trigger)
  // the turn's body: what matters on its own, and the work between folded
  const body: (Activity | Activity[])[] = []
  // a failed step mid-run (an exit code) is part of the work; only an error that ends the run stands on its own
  for (const a of rest) { if (matters(a) && (a.kind !== 'error' || a === ch.outcome)) body.push(a); else if (Array.isArray(body.at(-1))) (body.at(-1) as Activity[]).push(a); else body.push([a]) }
  const keys = keysOf(ch.items)
  // the first frame: only the last parts, and only of a long run. A shorter one drawn in two steps showed its older
  // parts appearing above the newest a moment later, pushing them down (a flicker on every switch); a long one fills the
  // pane, so what comes in later lands above it, out of sight
  const from = tail && body.length > tail * 4 ? body.length - tail : 0
  const label = h.text === 'Your reply' ? (trigger ? 'You asked' : 'Your reply') : h.text
  return (
    <li className={`list-none ${live ? '' : 'cv'}`}>
      <button onClick={onToggle} aria-expanded={open} title={stamp(h.at)}
              className="group/turn mb-2 flex w-full items-center gap-2 text-left text-micro text-fg-4 transition-colors hover:text-fg-2">
        <span className="h-px w-3 shrink-0 bg-line" />
        <span className="min-w-0 truncate font-semibold uppercase tracking-wide text-fg-3 group-hover/turn:text-fg-1">{label}</span>
        {live ? <span className="flex shrink-0 items-center gap-1 font-medium text-run-text"><span className="size-1.5 animate-pulse rounded-full bg-run" />running</span>
          : ok ? <CircleCheck className="size-3 shrink-0 text-ok-text" aria-label="finished" /> : bad ? <TriangleAlert className="size-3 shrink-0 text-fail-text" aria-label="ended with an error" /> : null}
        <span className="h-px min-w-3 flex-1 bg-line" />
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          <span>{when(h.at)}</span>
          {stop && !live && <><span aria-hidden>·</span><span>{secs(Date.parse(stop) - Date.parse(h.at))}</span></>}
          {cost > 0 && <><span aria-hidden>·</span><span className="text-fg-3">${cost.toFixed(2)}</span></>}
          {account && <span className="hidden max-w-[12rem] truncate md:inline">· {account}</span>}
        </span>
        <ChevronRight className={`size-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <ol className="space-y-1.5">
        {trigger && <YouSaid a={trigger} clamp={!open} />}
        {open ? body.map((g, i) => i < from ? null : Array.isArray(g)
          ? <Worked key={`w:${keys.get(g[0])}`} items={g} open={details} live={live && i === body.length - 1} until={(body[i + 1] as Activity | undefined)?.at ?? (live ? undefined : stop)} render={(a) => entry(a, keys.get(a)!)} />
          : entry(g, keys.get(g)!))
          : (ch.outcome || steps > 0) && (
            <li className="list-none">
              <button onClick={onToggle} className="flex w-full items-start gap-1.5 text-left text-small text-fg-3 transition-colors hover:text-fg-1">
                {bad ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-fail-text" /> : <Bot className="mt-0.5 size-3.5 shrink-0 text-fg-4" />}
                <span className="line-clamp-2">{ch.outcome ? plain(ch.outcome.text) : `Worked through ${steps} step${steps === 1 ? '' : 's'}`}</span>
              </button>
            </li>
          )}
      </ol>
    </li>
  )
}

/** Markdown as one plain line, for previews: no emphasis, code or heading marks. */
export const plain = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/[*`#>|]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()

/** A handover in the timeline: across the middle like other news from outside, from the agent that gave it; its brief folds. */
function HandoverCard({ a, from }: { a: Activity; from: string }) {
  const [open, setOpen] = useState(false)
  const body = a.text.split('\n').slice(1).join('\n').trim()
  return (
    <li className="relative z-10 my-2 ml-8 rounded-ctl bg-teal-500/[0.06] p-3 ring-1 ring-teal-500/20">
      <button onClick={() => body && setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left text-small font-medium text-teal-800 dark:text-teal-200">
        <ArrowRightLeft className="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
        <span className="min-w-0 truncate">Handed over from {from}</span>
        <time className="ml-auto shrink-0 font-mono text-micro text-fg-4">{clock(a.at)}</time>
        {body && <ChevronRight className={`size-3.5 shrink-0 text-fg-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />}
      </button>
      {body && (open
        ? <Md text={body} className="mt-2 border-t border-teal-500/15 pt-2 !text-small text-fg-2" />
        : <p className="mt-1 line-clamp-2 text-small text-fg-3">{body.replace(/\s+/g, ' ')}</p>)}
    </li>
  )
}
