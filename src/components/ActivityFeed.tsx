import {
  ArrowRightLeft, CheckCheck, Copy, GitCommitHorizontal, Hourglass, MessageSquareWarning, PlugZap, Radio,
  Bot, CircleCheck, FilePen, FileText, Search, ShieldAlert, Sparkles, SquareTerminal, TriangleAlert, Users, Wrench,
  ChevronRight, type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { api, here, hereIn, type Activity } from '../lib.ts'
import { Md } from './Md.tsx'
import { LANE } from './NextSteps.tsx'
import { BgNow, turnOver } from './Background.tsx'
import { chaptersOf, HANDOVER, once, type Chapter } from '../chapters.ts'
import { clock, duration, stamp, when } from '../time.ts'

const TOOL_ICON: Record<string, LucideIcon> = {
  Bash: SquareTerminal, Read: FileText, Write: FilePen, Edit: FilePen, Grep: Search, Glob: Search,
  Agent: Users, Skill: Sparkles,
}

function iconFor(a: Activity): [LucideIcon, string] {
  if (a.kind === 'text') return [Bot, 'text-accent']
  if (a.kind === 'result') return [CircleCheck, 'text-ok']
  if (a.kind === 'error') return [TriangleAlert, 'text-fail']
  if (a.kind === 'denied') return [ShieldAlert, 'text-wait']
  return [TOOL_ICON[a.tool ?? ''] ?? Wrench, 'text-fg-3']
}

/** Every row's badge: a small tinted square with its icon (or letter), one size for every kind of row. */
const BADGE = 'relative z-10 flex size-[22px] shrink-0 items-center justify-center rounded-lg'
const TINT = { you: 'bg-accent-soft text-accent-text', agent: 'bg-hover text-fg-2', ok: 'bg-ok/15 text-ok', fail: 'bg-fail/15 text-fail', warn: 'bg-wait/15 text-wait', quiet: 'bg-hover text-fg-4', run: 'bg-run/15 text-run' } as const
/** Every row's time: in its own column on the right, always shown. */
const Time = ({ at }: { at: string }) => <time className="hidden shrink-0 pt-[3px] font-mono text-micro tabular-nums text-fg-4 sm:block" title={stamp(at)}>{clock(at)}</time>

export function ActivityFeed({ feed, live, bg, toast }: { feed: Activity[]; live: boolean; bg?: { base: string; count: number }; toast?: (m: string, tone?: 'ok' | 'error') => void }) {
  const chapters = chaptersOf(once(feed))
  const [details] = useFeedDetails()
  // the newest chapter is open, earlier ones folded; a click flips one from its default
  const [flipped, setFlipped] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setFlipped((s) => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n })
  const open = (ch: Chapter, i: number) => (i === chapters.length - 1) !== flipped.has(ch.key)
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  // pinned to the newest line from the start, through loading and new lines; scrolling up unpins, back down repins
  const pinned = useRef(true)
  useEffect(() => {
    const b = box.current?.parentElement // the panel that scrolls
    if (!b) return
    const on = () => { pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80 }
    b.addEventListener('scroll', on, { passive: true })
    return () => b.removeEventListener('scroll', on)
  }, [feed.length > 0])
  useLayoutEffect(() => {
    if (!pinned.current) return
    // after layout and once more next frame: markdown and code blocks can grow after the first paint
    end.current?.scrollIntoView({ block: 'end' })
    const id = requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' }))
    return () => cancelAnimationFrame(id)
  }, [feed.length, live])

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
          if (a.kind === 'you') return (
            <li key={k} className="flex gap-2.5 rounded-lg px-2 py-1.5">
              <span className={`${BADGE} ${TINT.you} text-micro font-semibold`} aria-hidden>Y</span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-body leading-relaxed text-fg-1"><span className="mr-1.5 font-semibold text-accent-text">You</span>{a.text}</p>
              <Time at={a.at} />
            </li>
          )
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
              <li key={k} className="relative z-10 rounded-lg px-2 py-1">
                <div className={`flex items-start gap-2.5 text-small leading-relaxed ${warn ? 'text-fg-2' : 'text-fg-3'}`}>
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
                  <Time at={a.at} />
                </div>
                {e.items && (
                  <ul className="ml-8 mt-1 max-w-[620px] divide-y divide-line overflow-hidden rounded-ctl bg-surface-1 ring-1 ring-line">
                    {e.items.map((x, i) => (
                      <li key={i} className="group/it px-3 py-2">
                        <p className="text-small font-medium text-fg-1">{x.label}</p>
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
          const [Icon, color] = iconFor(a)
          const prose = a.kind === 'text' || a.kind === 'result' || a.kind === 'error'
          return (
            <li key={k} className="group/ev relative flex gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-hover">
              <span className={`${BADGE} ${a.kind === 'result' ? TINT.ok : a.kind === 'error' ? TINT.fail : a.kind === 'denied' ? TINT.warn : a.kind === 'text' ? TINT.agent : TINT.quiet}`}>
                <Icon className="size-3" aria-hidden />
              </span>
              <div className={`min-w-0 flex-1 text-body leading-relaxed ${a.kind === 'error' ? 'rounded-lg bg-fail/[0.06] px-3 py-2 ring-1 ring-fail/15' : 'pt-0.5'}`}>
                {a.tool && <span className={`mr-2 rounded-md px-1.5 py-px font-mono text-meta ${a.kind === 'denied' ? 'bg-wait/10 text-wait-text' : 'bg-fill text-fg-2 '}`}>{a.kind === 'denied' ? `denied ${a.tool}` : a.tool}</span>}
                {/* what the agent says is markdown (lists, headings, tables, code); errors stay as they came */}
                {a.kind === 'text' || a.kind === 'result'
                  ? <Md text={a.text} className="break-words !text-body !leading-relaxed text-fg-2 [&>*:first-child]:!mt-0 [&>*:last-child]:!mb-0 [&_h1]:!text-reading [&_h2]:!text-body [&_h3]:!text-body [&_pre]:!text-small [&_table]:!text-small" />
                  : <span className={prose ? 'whitespace-pre-wrap break-words text-fg-2 ' : 'break-all font-mono text-small text-fg-3 transition-colors group-hover/ev:text-fg-1'}>{prose ? <Inline text={a.text} /> : a.text}</span>}
              </div>
              <Time at={a.at} />
            </li>
          )
  }

  if (!feed.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-fg-3">
        <Bot className={`size-6 ${live ? 'animate-pulse text-run' : 'text-fg-4'}`} aria-hidden />
        {live ? 'Waiting for the first event…' : 'No agent run yet for this PR.'}
      </div>
    )
  }
  return (
    <div ref={box} className="px-4 py-3">
      <ol className="relative space-y-1">
        {chapters.map((ch, ci) => {
          const isOpen = open(ch, ci)
          return (
            <li key={ch.key} className="list-none">
              {ch.head && <ChapterHead ch={ch} until={chapters[ci + 1]?.head?.at} open={isOpen} live={live && ci === chapters.length - 1} onToggle={() => toggle(ch.key)}
                                       before={chapters.slice(0, ci).flatMap((c) => c.items).findLast((a) => a.costUsd != null)?.costUsd} />}
              {isOpen && (
                <ol className="relative pb-2">
                  {(details ? runs(ch.items) : quiet(ch.items)).map((g, i) => Array.isArray(g)
                    ? <ToolRun key={`${ci}:r${i}`} items={g} render={(a, j) => entry(a, `${ci}:${i}:${j}`)} />
                    : entry(g, `${ci}:${i}`))}
                </ol>
              )}
            </li>
          )
        })}
        {live && (
          <li className="flex items-center gap-2.5 px-2 py-1.5 text-body text-fg-3">
            <span className={`${BADGE} ${TINT.run}`}>
              <span className="absolute size-2 animate-ping rounded-full bg-run/60" />
              <span className="size-2 rounded-full bg-run" />
            </span>
            {/* the step it is on now, replaced by the next one */}
            <span key={feed.length} className="min-w-0 animate-[fade-in_160ms] truncate">
              <span className="text-shimmer">working</span>
              {feed.at(-1)?.kind === 'tool' && <span className="ml-1.5 font-mono text-meta">{feed.at(-1)!.tool} {feed.at(-1)!.text.slice(0, 120)}</span>}
            </span>
          </li>
        )}
      </ol>
      {live && bg && <div className="ml-8 mt-1"><BgNow base={bg.base} count={bg.count} parked={turnOver(feed)} toast={toast} /></div>}
      <div ref={end} />
    </div>
  )
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
              className="rounded-md bg-accent-soft px-1.5 py-px font-medium text-accent-text underline decoration-accent/30 decoration-dotted underline-offset-4 transition-colors duration-150 hover:decoration-accent">
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

/** Consecutive tool steps, three or more, become one group; everything else (what it says, errors, refusals) stays. */
/** What the conversation needs: what it says, what you said, outcomes, errors, its plan, and what came from outside or
 *  went wrong. The rest (its steps, system notes) folds away until you want it. */
const matters = (a: Activity) => a.kind === 'text' || a.kind === 'result' || a.kind === 'error' || a.kind === 'you' || a.kind === 'denied'
  || (a.kind === 'event' && (!!a.who || !!a.plan || /\b(stuck|stopped|couldn't|can't|didn't|failed|no output)\b/i.test(a.text)))
function quiet(items: Activity[]): (Activity | Activity[])[] {
  const out: (Activity | Activity[])[] = []
  let cur: Activity[] = []
  for (const a of items) { if (matters(a)) { if (cur.length) out.push(cur); cur = []; out.push(a) } else cur.push(a) }
  if (cur.length) out.push(cur)
  return out
}

function runs(items: Activity[]): (Activity | Activity[])[] {
  const out: (Activity | Activity[])[] = []
  let cur: Activity[] = []
  const flush = () => { if (cur.length >= 3) out.push(cur); else out.push(...cur); cur = [] }
  for (const a of items) { if (a.kind === 'tool' && a.tool !== 'Skill' && a.tool !== 'Agent') cur.push(a); else { flush(); out.push(a) } }
  flush()
  return out
}

/** "Ran 14 steps · git, gh, Read": one quiet line that opens to every step. */
function ToolRun({ items, render }: { items: Activity[]; render: (a: Activity, i: number) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const count = new Map<string, number>()
  for (const a of items.filter((x) => x.kind === 'tool')) { const n = a.tool === 'Bash' ? a.text.trim().split(/\s+/)[0].replace(/^.*\//, '') : a.tool ?? 'tool'; count.set(n, (count.get(n) ?? 0) + 1) }
  const names = [...count].sort((x, y) => y[1] - x[1]).map(([n]) => n)
  return (
    <li className="list-none">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
              className="group/run relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-small text-fg-3 transition-colors duration-150 hov hover:text-fg-2">
        <span className={`${BADGE} ${TINT.quiet} font-mono text-[10px] font-semibold tabular-nums`} aria-hidden>{Math.min(items.length, 99)}</span>
        <span className="min-w-0 truncate">{((t, e) => [t && `${t} step${t === 1 ? '' : 's'}`, e && `${e} note${e === 1 ? '' : 's'}`].filter(Boolean).join(', '))(items.filter((a) => a.kind === 'tool').length, items.filter((a) => a.kind !== 'tool').length)}
          {names.length > 0 && <span className="text-fg-4"> · {names.slice(0, 4).join(', ')}{names.length > 4 ? ` +${names.length - 4}` : ''}</span>}</span>
        <ChevronRight className={`size-3.5 shrink-0 text-fg-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1" /><Time at={items[0].at} />
      </button>
      {open && <ol className="ml-[18px] animate-[fade-in_160ms] border-l border-line pl-1.5">{items.map(render)}</ol>}
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
    <div role="radiogroup" aria-label="What Activity shows" className="inline-flex rounded-lg bg-hover p-0.5 text-meta">
      {([[false, 'Conversation'], [true, 'Everything']] as const).map(([v, label]) => (
        <button key={label} role="radio" aria-checked={details === v} onClick={() => setDetails(v)}
                className={`rounded-md px-2.5 py-0.5 font-medium transition-[background-color,color,box-shadow] duration-150 ${details === v ? 'sel text-fg-1' : 'text-fg-3 hover:text-fg-1'}`}>{label}</button>
      ))}
    </div>
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


// what a run's time went to, by what it was doing: each step lasts until the next one starts
// one hue, in shades: the strip says where the time went without turning a run into a traffic light
const CAT = {
  read: { label: 'Reading', bar: 'bg-accent/35' }, edit: { label: 'Editing', bar: 'bg-accent' }, run: { label: 'Commands', bar: 'bg-accent/65' },
  think: { label: 'Thinking', bar: 'bg-fg-4/40' }, wait: { label: 'Waiting', bar: 'bg-fg-4/20' }, you: { label: 'You', bar: 'bg-fg-2' },
} as const
type Cat = keyof typeof CAT
const catOf = (a: Activity): Cat => a.kind === 'you' ? 'you' : a.kind === 'event' ? 'wait' : a.kind !== 'tool' ? 'think'
  : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(a.tool ?? '') ? 'edit' : a.tool === 'Bash' ? 'run' : 'read'
function shape(ch: Chapter, end: number): { cat: Cat; ms: number }[] {
  const t0 = Date.parse(ch.head!.at), out: { cat: Cat; ms: number }[] = []
  const add = (cat: Cat, ms: number) => { if (ms <= 0) return; const last = out.at(-1); if (last?.cat === cat) last.ms += ms; else out.push({ cat, ms }) }
  if (ch.items[0]) add('think', Date.parse(ch.items[0].at) - t0)
  ch.items.forEach((a, i) => add(catOf(a), (i + 1 < ch.items.length ? Date.parse(ch.items[i + 1].at) : end) - Date.parse(a.at)))
  return out
}
const span = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`

/** A run, summed up: what it was, how it ended, on which account, what it cost, and how its time went (the strip). */
function ChapterHead({ ch, until, open, live, onToggle, before }: { ch: Chapter; until?: string; open: boolean; live: boolean; onToggle: () => void; before?: number }) {
  const h = ch.head!
  const steps = ch.items.filter((a) => a.kind === 'tool').length
  const ok = ch.outcome?.kind === 'result', bad = ch.outcome?.kind === 'error'
  const end = live ? Date.now() : Date.parse((until && ch.end && until < ch.end ? until : ch.end) ?? h.at)
  // Claude reports the session's running total: this run cost its last total minus the one before it (a new session restarts it)
  const last = ch.items.findLast((a) => a.costUsd != null)?.costUsd
  const cost = last == null ? 0 : before != null && last >= before ? last - before : last
  const account = ch.items.map((a) => a.kind === 'event' && (a.text.match(/^Runs on ([^,.]+)/)?.[1] ?? a.text.match(/^Moved to ([^,.]+)/)?.[1])).filter(Boolean).at(-1) as string | undefined
  const parts = steps >= 2 && end > Date.parse(h.at) ? shape(ch, end) : []
  const total = parts.reduce((n, x) => n + x.ms, 0)
  const sums = (Object.keys(CAT) as Cat[]).map((c) => [c, parts.filter((x) => x.cat === c).reduce((n, x) => n + x.ms, 0)] as const).filter(([, ms]) => ms > 0)
  return (
    <button onClick={onToggle} aria-expanded={open}
            className={`group/ch relative z-10 mb-1 flex w-full items-start gap-2.5 rounded-ctl px-3 py-2.5 text-left transition-colors duration-150 ${open ? 'bg-surface-1 shadow-e1' : 'hov'}`}>
      <ChevronRight className={`mt-0.5 size-3.5 shrink-0 text-fg-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-body font-semibold text-fg-1">{h.text}</span>
          {live ? <span className="flex items-center gap-1 text-meta font-medium text-run"><span className="size-1.5 animate-pulse rounded-full bg-run" />running</span>
            : ok ? <CircleCheck className="size-3.5 text-ok" aria-label="finished" /> : bad ? <TriangleAlert className="size-3.5 text-fail" aria-label="ended with an error" /> : null}
          {account && <span className="text-meta text-fg-3">on {account}</span>}
          <span className="ml-auto flex items-center gap-2 text-meta tabular-nums text-fg-4" title={stamp(h.at)}>
            <span>{when(h.at)}</span>
            {ch.end && !live && <span>{duration(h.at, until && until < ch.end ? until : ch.end)}</span>}
            {cost > 0 && <span className="text-fg-3">${cost.toFixed(2)}</span>}
            {steps > 0 && <span>{steps} step{steps === 1 ? '' : 's'}</span>}
          </span>
        </span>
        {/* how its time went: reading, editing, commands, thinking, waiting, you */}
        {/* only on an open run: closed, a run is its title and how it ended, nothing to decode */}
        {open && total > 0 && (
          <span className="mt-2 flex h-1.5 w-full gap-px overflow-hidden rounded-full" title={sums.map(([c, ms]) => `${CAT[c].label} ${span(ms)}`).join(' · ')}>
            {parts.map((x, i) => <span key={i} className={`${CAT[x.cat].bar} min-w-[2px]`} style={{ flexGrow: x.ms }} />)}
          </span>
        )}
        {/* one line of the same height open or closed (the legend, or the outcome), so a click never shifts the feed */}
        {(open ? sums.length > 1 : ch.outcome) && (
          <span className="mt-1.5 flex h-5 items-center overflow-hidden">
            {open ? sums.length > 1 && (
              <span className="flex gap-x-3 truncate text-micro text-fg-3">
                {sums.map(([c, ms]) => <span key={c} className="flex shrink-0 items-center gap-1"><span className={`size-1.5 rounded-full ${CAT[c].bar}`} />{CAT[c].label} <span className="tabular-nums text-fg-4">{span(ms)}</span></span>)}
              </span>
            ) : ch.outcome && <span className="truncate text-small text-fg-3">{plain(ch.outcome.text)}</span>}
          </span>
        )}
      </span>
    </button>
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
