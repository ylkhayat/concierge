// Over the panel, always in sight: the three things a PR or ticket stands on, live. Shipping (what the work waits on), Intent
// (is what it should do agreed) and Understanding (do you know what it does). Each is a borderless box of living
// colour that says what is going on now and changes as the chat goes on; under the pointer (or the keyboard's focus) it
// opens, inside itself, on what is settled, what it has for the agent and what to ask next. One not assessed yet is
// pale: point at it and it offers to start, with the question that fits where the conversation stands.
import { ArrowLeft, CheckCircle2, Copy, Compass, LoaderCircle, RotateCcw, Rocket, Send } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Action, Diagram, Discussion as D, Stage, Topic } from '../../server/discussions.ts'
import { CardDiagram } from './CardDiagram.tsx'
import { api, type Activity } from '../lib.ts'
import { ago } from '../time.ts'
import { Md } from '../components/Md.tsx'
import { Tabs } from '../components/Tabs.tsx'
import { usePhone } from '../components/NextPanel.tsx'
import { TOPIC, type Discussions, type View } from './Discussion.tsx'
import type { Tone } from '../ui/Thread.tsx'

// what starting a discussion asks, from where the conversation stands (the discussion's agent reads the PR or ticket,
// its description and the conversation so far)
const START: Record<Topic, string> = {
  intent: 'From the conversation so far and what was asked: is what is being built what was meant? Say what is agreed, what is still open, and ask me the one question that matters most next.',
  understanding: 'From the conversation so far: walk me through what this change does, business first, then tell me the one part I should check before trusting it.',
}
type Toast = (m: string, tone?: 'ok' | 'error') => void
const STEP: Record<Stage, number> = { new: 0, open: 1, converging: 2, concluded: 3 }

// the boards (ChangeMap: React Flow, ELK) are their own chunk, fetched once and early (the page settling, a pointer on
// the row) and kept here, so a board renders at once instead of suspending: one lazy per board suspended on each first
// switch, and its spinner showed between the two
type MapModule = typeof import('./ChangeMap.tsx')
let mapModule: MapModule | undefined, mapLoading: Promise<MapModule> | undefined
const loadMap = () => (mapLoading ??= import('./ChangeMap.tsx').then((m) => (mapModule = m), (e) => { mapLoading = undefined; throw e }))
const Spinner = () => <div className="flex h-full items-center justify-center"><LoaderCircle className="size-5 animate-spin text-fg-4" /></div>
/** Intent's or Understanding's board; the boards' own spinner while their chunk is still on its way. */
function Board({ topic, prId, path, fork, toast }: { topic: Topic; prId: string; path?: string; fork?: Extract<Diagram, { kind: 'fork' }>; toast: Toast }) {
  const [m, setM] = useState(mapModule)
  useEffect(() => { if (!m) loadMap().then(setM, () => toast('Could not load the board: reload the page', 'error')) }, [m])
  if (!m) return <Spinner />
  return topic === 'understanding' ? <m.UnderstandingMap prId={prId} path={path} toast={toast} /> : <m.IntentFlow prId={prId} path={path} fork={fork} toast={toast} />
}

/** A vital: a quiet card that always names itself (its colour dot and name), says in one line what is going on now,
 *  and shows how far along it is on a hairline at its foot. A faint tint of its colour drifts across it, faster while
 *  something works on it. Under the pointer (or the focus) its line gives way to the one thing worth knowing or doing;
 *  the name and the hairline stay. A click opens what it holds, under the row. */
export function Vital({ name, status, lane, meter, foot, busy, idle, flag, back, open, onOpen, peek, glow, stale }: { icon?: ReactNode; name: string; status: string; lane: string; meter?: ReactNode; foot?: ReactNode; busy?: boolean; idle?: boolean; flag?: boolean; back?: ReactNode; open?: boolean; onOpen?: () => void; peek?: ReactNode; glow?: boolean; stale?: boolean }) {
  // its status fades in when it changes, not when the page opens or its data first lands
  const settled = useRef(0)
  useEffect(() => { settled.current = Date.now() }, [])
  return (
    <section tabIndex={0} aria-label={`${name}: ${status}`} aria-expanded={onOpen ? open : undefined} style={{ '--lane': lane } as React.CSSProperties}
             onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onOpen?.() }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen?.() }}
             className={`group/v vital relative flex h-[68px] min-w-0 flex-col transition-[transform,box-shadow] duration-300 ease-[var(--ease-snappy)] ${onOpen ? 'cursor-pointer hover:-translate-y-px' : ''} ${busy ? 'vital-busy' : ''} ${idle ? 'vital-idle' : ''} ${open ? 'vital-open' : ''} ${glow ? 'shadow-[0_0_0_1.5px_var(--lane),0_0_28px_-6px_var(--lane)]' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className={`size-1.5 shrink-0 rounded-full bg-[var(--lane)] ${busy ? 'animate-pulse' : ''}`} />
        {/* a phone's three tiles are narrow: the name in its own case fits where the small caps were cut off */}
        <span className="label truncate !tracking-[0.03em] text-fg-3 max-sm:normal-case max-sm:!tracking-normal">{name}</span>
        {stale && !busy && <span className="ml-auto rounded-full bg-wait/12 px-1.5 text-micro font-medium text-wait-text" title="The work moved on since this card was written: it catches up the next time you ask it (or click Refresh)">new push</span>}
        {flag && <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-micro font-medium text-fg-2" title="It has something for the agent: point at it, or open it, to send"><Send className="size-3" /><span className="sr-only">has something for the agent</span></span>}
      </div>
      {/* what is going on now, and under the pointer the one thing worth knowing or doing (same place, same size) */}
      <div className="relative mt-1 grid min-h-0 flex-1">
        <p key={status} className={`col-start-1 row-start-1 truncate text-small font-medium text-fg-1 transition-opacity duration-200 ${settled.current && Date.now() - settled.current > 1500 ? 'animate-[detail-in_400ms_var(--ease-out)]' : ''} ${back ? 'group-hover/v:pointer-events-none group-hover/v:opacity-0 group-focus-within/v:pointer-events-none group-focus-within/v:opacity-0' : ''}`}>{status}</p>
        {back && <div className="pointer-events-none relative z-10 col-start-1 row-start-1 flex min-w-0 items-start gap-2 opacity-0 transition-opacity duration-200 group-hover/v:pointer-events-auto group-hover/v:opacity-100 group-focus-within/v:pointer-events-auto group-focus-within/v:opacity-100">{back}</div>}
      </div>
      <div className="mt-auto min-w-0">{meter ?? foot}</div>
      {/* under the pointer: its gist, floating, so a glance is enough (closed while its full card is open) */}
      {peek && !open && (
        <div role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-40 mt-2 w-[min(380px,85vw)] translate-y-1 rounded-card bg-surface-1 p-3 text-left opacity-0 shadow-[var(--e3)] ring-1 ring-[color-mix(in_oklch,var(--lane)_35%,transparent)] transition-all delay-150 duration-200 group-hover/v:visible group-hover/v:translate-y-0 group-hover/v:opacity-100">
          {peek}
        </div>
      )}
    </section>
  )
}
export const Meter = ({ of, at, color, pulse }: { of: number; at: number; color: string; pulse?: boolean }) => (
  <div className="flex gap-0.5" aria-hidden>{Array.from({ length: of }, (_, i) => <span key={i} style={i < at ? { background: color } : undefined} className={`h-[3px] flex-1 rounded-full transition-colors duration-500 ${i < at ? '' : 'bg-fg-1/8'} ${pulse && i === at - 1 ? 'animate-pulse' : ''}`} />)}</div>
)

/** What a discussion's suggestion does, whatever shows it (its floating card, the chips in the chat): a steer goes to
 *  the coding agent, a question for someone is copied, a part of Explain opens (or, where there is no Explain, is asked
 *  for in words). Each says what it did. */
export function actOn(a: Action, { target, topic, onChange, onSteer, onView, toast }: { target: string; topic: Topic; onChange: (all: Discussions) => void; onSteer: (text: string) => Promise<unknown>; onView?: (v: View) => void; toast: Toast }) {
  const fail = (e: Error) => toast(e.message, 'error')
  if (a.kind === 'steer') return a.text && onSteer(a.text).then(() => toast('Sent to the agent'), fail)
  if (a.kind === 'ask-author' || a.kind === 'ask-community') return navigator.clipboard.writeText(a.text ?? a.label).then(() => toast(`Copied: paste it to ${a.kind === 'ask-author' ? 'the author' : 'your team'}`), fail)
  if (onView) { onView(a.kind); toast(`Opened ${a.kind === 'tour' ? 'the tour' : `the ${a.kind} view`} in Explain`); return }
  return api('/discussions/say', { target, topic, text: a.label }).then(onChange, fail)
}

/** What the box sends along with your words (NextSteps' `attach`): the suggestions you picked. */
export type Attach = { count: number; chips: ReactNode; words: () => string; run: () => Promise<unknown>; done: () => void }

/**
 * The discussions' suggestions, as chips over the box in their lane's colour: pick any number of them, write your own
 * words too, and one Send does all of it. Steers for the agent go in your message to it; a question for someone is
 * copied; a part of Explain opens (where there is none, it is asked for in words).
 */
const SHOWN = 3
export function useLaneActions({ d, target, onChange, onSteer, onView, toast }: { d?: Discussions; target: string; onChange: (all: Discussions) => void; onSteer: (text: string) => Promise<unknown>; onView?: (v: View) => void; toast: Toast }): Attach | undefined {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const items = (['intent', 'understanding'] as const).flatMap((topic) => {
    const x = d?.[topic]
    if (!x || x.busy || !x.messages.length) return []
    const steer = x.steer && !x.sentAt ? [{ key: `${topic}:steer`, topic, a: { kind: 'steer' as const, label: x.steer, text: x.steer }, own: true }] : []
    return [...steer, ...(x.actions ?? []).filter((a) => !(a.kind === 'steer' && a.text === x.steer)).map((a, i) => ({ key: `${topic}:${i}:${a.label}`, topic, a, own: false }))]
  })
  const chosen = items.filter((x) => picked.has(x.key))
  if (!items.length) return undefined
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (!n.delete(k)) n.add(k); return n })
  const chips = (
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Suggested: pick any, then Send">
      {/* three at most, the agent's own steer first: more of them crowded out the box; the rest one click away (a picked one always shows) */}
      {items.filter((x, i) => more || i < SHOWN || picked.has(x.key)).map(({ key, topic, a }) => {
        const on = picked.has(key)
        return (
          <button key={key} type="button" aria-pressed={on} title={a.text ?? a.label} onClick={() => toggle(key)} style={{ '--lane': `var(--vital-${topic})` } as React.CSSProperties}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-left text-small transition-colors ${on ? 'bg-[color-mix(in_oklch,var(--lane)_22%,transparent)] text-fg-1 ring-1 ring-[var(--lane)]' : 'bg-[color-mix(in_oklch,var(--lane)_8%,transparent)] text-fg-2 ring-1 ring-[color-mix(in_oklch,var(--lane)_25%,transparent)] hover:text-fg-1'}`}>
            {on ? <CheckCircle2 className="size-3.5 shrink-0" /> : a.kind === 'steer' ? <Send className="size-3.5 shrink-0" /> : a.kind.startsWith('ask') ? <Copy className="size-3.5 shrink-0" /> : <Compass className="size-3.5 shrink-0" />}
            <span className="truncate">{a.kind === 'steer' ? `For the agent: ${a.label}` : a.label}</span>
          </button>
        )
      })}
      {items.length > SHOWN && (
        <button type="button" onClick={() => setMore(!more)} className="rounded-full px-2.5 py-1 text-small font-medium text-fg-3 transition-colors hover:text-fg-1">
          {more ? 'Fewer' : `+${items.length - SHOWN} more`}
        </button>
      )}
    </div>
  )
  return {
    count: chosen.length, chips,
    words: () => chosen.filter((x) => x.a.kind === 'steer').map((x) => x.a.text!).join('\n\n'),
    run: async () => {
      const fail = (e: Error) => toast(e.message, 'error')
      // the steers went in the message: the discussions they came from mark theirs sent
      for (const tp of new Set(chosen.filter((x) => x.own).map((x) => x.topic))) await api('/discussions/sent', { target, topic: tp }).then(onChange, fail)
      const asks = chosen.filter((x) => x.a.kind.startsWith('ask'))
      if (asks.length) await navigator.clipboard.writeText(asks.map((x) => x.a.text ?? x.a.label).join('\n\n')).then(() => toast(`Copied ${asks.length === 1 ? 'the question' : `${asks.length} questions`} to paste to whom they are for`), fail)
      for (const x of chosen.filter((y) => y.a.kind !== 'steer' && !y.a.kind.startsWith('ask'))) await actOn(x.a, { target, topic: x.topic, onChange, onSteer, onView, toast })
    },
    done: () => setPicked(new Set()),
  }
}

/** The latest thing that happened in a conversation, for Shipping's foot: an event, your words, a run's start or end. */
export function lastUpdate(feed: Activity[]): { text: string; at: string } | undefined {
  const a = [...feed].reverse().find((x) => x.kind === 'event' || x.kind === 'section' || x.kind === 'result' || x.kind === 'you' || x.kind === 'error')
  if (!a) return undefined
  const line = a.text.replace(/[#*_`>]/g, '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return { at: a.at, text: a.kind === 'you' ? `you: ${line}` : a.kind === 'result' ? `done: ${line}` : line }
}
/** A vital's foot: the latest thing that happened to it, and how long ago. */
function Update({ at, text }: { at?: string; text: string }) {
  return <p className="flex min-w-0 items-center gap-1 text-micro text-fg-3" title={text}>{at && <span className="shrink-0 tabular-nums text-fg-4">{ago(at)}</span>}{at && <span className="text-fg-4">·</span>}<span className="truncate">{text}</span></p>
}

/** Shipping: what the work waits on, from its flow, and the latest thing that happened. */
export function ShippingVital({ title, tone, why, busy, update }: { title: string; tone: Tone; why?: ReactNode; at?: number; of?: number; busy?: boolean; update?: { text: string; at: string } }) {
  return (
    <Vital name="Shipping" icon={<Rocket className="size-3.5 text-[var(--vital-ship)]" />} status={title} lane={tone === 'fail' ? 'var(--st-fail)' : tone === 'ok' ? 'var(--st-ok)' : 'var(--vital-ship)'} busy={busy}
           foot={update && <Update at={update.at} text={update.text} />}
           back={why ? <p className="truncate text-meta leading-snug text-fg-2" title={typeof why === "string" ? why : undefined}>{why}</p> : undefined} />
  )
}

// what a card is doing while busy, in its own words
const PHASE: Record<NonNullable<D['phase']>, string> = { refreshing: 'Catching up on the latest work…', answering: 'Answering from the card…', reading: 'Reading the code for this one…' }

/** Intent or Understanding: a card that knows one side of the work. Its few words on the tile, its gist on hover, the
 *  whole page when clicked; asked from the chat's box (Send to Intent / Understanding), it lights up and answers here. */
export function topicVital({ target, topic, d, onChange, onSteer, onSteerPr, onView, toast, here, open, onOpen, pane = open, prId, explainPath }: {
  target: string; topic: Topic; d?: D; onChange: (all: Discussions) => void; onSteer: (text: string) => Promise<unknown>
  onSteerPr?: (number: number, text: string) => Promise<unknown>; onView?: (v: View) => void; toast: Toast; here?: number; prId?: string; explainPath?: string
  open?: boolean; onOpen?: () => void; pane?: boolean // pane: its card is drawn (open, or fading out under the next one)
}): { tile: ReactNode; details: ReactNode } {
  const t = TOPIC[topic], b = d?.brief, started = !!b || !!d?.messages.length, busy = !!d?.busy
  const asked = (d?.messages ?? []).slice(-6)
  const fail = (e: Error) => toast(e.message, 'error')
  // written (or caught up) without a question: one short call
  const write = () => { if (!open) onOpen?.(); return api('/discussions/ask', { target, topic }).then(onChange, fail) }
  const sendSteer = () => d?.steer && onSteer(d.steer).then(() => api('/discussions/sent', { target, topic }).then(onChange)).then(() => toast('Sent to the agent'), fail)
  const sendPr = (n: number, text: string) => onSteerPr?.(n, text).then(() => api('/discussions/sent', { target, topic, number: n }).then(onChange)).then(() => toast(`Sent to #${n}'s agent`), fail)
  const act = (a: Action) => actOn(a, { target, topic, onChange, onSteer, onView, toast })
  const chip = 'inline-flex max-w-full items-center gap-1.5 rounded-ctl bg-fill px-2.5 py-1 text-left text-small text-fg-2 transition-colors hover:bg-fill-strong hover:text-fg-1'
  const status = busy ? PHASE[d!.phase ?? 'answering'] : b ? b.status : started ? d!.status || 'Open' : 'Not written yet'
  const lane = d?.stage === 'concluded' ? 'var(--st-ok)' : `var(--vital-${topic})`
  const unsent = !!d?.steer && !d.sentAt
  const tile = (
    <Vital name={t.label} icon={<t.icon className="size-3.5" style={{ color: lane }} />} status={status} lane={lane} busy={busy} idle={!started && !busy} flag={unsent}
           glow={busy && d?.phase !== 'refreshing'} stale={d?.stale} open={open} onOpen={started || busy ? onOpen : write}
           foot={busy ? undefined : b ? <Update at={d!.messages.at(-1)?.at && d!.messages.at(-1)!.at > b.at ? d!.messages.at(-1)!.at : b.at} text={d!.messages.at(-1)?.who === 'agent' ? `answered: ${d!.messages.at(-1)!.text.replace(/[#*_`>]/g, '').slice(0, 80)}` : `written${asked.length ? ` · ${asked.filter((m) => m.who === 'you').length} asked` : ''}`} />
             : <p className="truncate text-micro text-fg-4">{started ? 'asked before cards' : 'click to write it'}</p>}
           peek={b ? (
             <>
               <p className="flex items-center gap-1.5 text-meta font-semibold text-fg-1"><t.icon className="size-3.5" style={{ color: lane }} />{t.label} · {b.status}</p>
               <p className="mt-1.5 whitespace-pre-line text-small leading-snug text-fg-1">{b.short}</p>
               <p className="mt-2 text-meta text-fg-3">{d?.stale ? 'New work since: it catches up when you ask. ' : ''}Click for the whole card · ask it from the box (Send to {t.label})</p>
             </>
           ) : !busy ? (
             <>
               <p className="text-small font-medium text-fg-1">{t.question}</p>
               <p className="mt-1 text-meta text-fg-3">{topic === 'intent' ? 'Why it was built this way: the problem, the decision, what was set aside.' : 'What it does now: before and after, the path through the code, what to check.'} Click to write it.</p>
             </>
           ) : undefined} />
  )
  // what it decided for each PR of the work, three to a slide
  const per = d?.perPr ?? [], perPrSlides: Slide[] = []
  for (let k = 0; k < per.length; k += 3) perPrSlides.push({ key: `per${k}`, label: per.length > 3 ? `Each PR · ${k / 3 + 1} of ${Math.ceil(per.length / 3)}` : 'Each PR', body: (
    <ul className="divide-y divide-line overflow-hidden rounded-ctl ring-1 ring-line">
      {per.slice(k, k + 3).map((x) => (
        <li key={x.number} className={`flex items-start gap-2.5 px-2.5 py-1.5 text-small ${x.number === here ? 'bg-accent-soft' : ''}`}>
          <span className="shrink-0 font-mono font-medium text-fg-1">#{x.number}</span>
          <span className="min-w-0 flex-1 text-fg-2"><span className="line-clamp-2">{x.decision}</span>{x.steer && <span className="mt-0.5 line-clamp-1 text-meta text-fg-3"><b className="font-medium text-fg-1">Its agent:</b> {x.steer}</span>}</span>
          {x.steer && (x.sentAt ? <span className="shrink-0 text-meta text-fg-4">Sent</span> : <button onClick={() => sendPr(x.number, x.steer!)} className="shrink-0 rounded-md px-2 py-0.5 text-meta font-medium text-accent-text ring-1 ring-accent/30 hover:bg-accent-soft">Send</button>)}
        </li>
      ))}
    </ul>
  ) })
  // the whole card, under the row, when its tile is clicked: what it knows, then what you asked it
  const details = pane ? (
    <div className={`card flex ${prId ? 'h-full' : ''} flex-col gap-3 p-4 transition-shadow duration-300 ${busy ? 'shadow-[0_0_0_1.5px_var(--lane),0_0_36px_-8px_var(--lane)]' : ''}`} style={{ '--lane': lane } as React.CSSProperties}>
      <div className="flex flex-wrap items-center gap-2">
        <t.icon className="size-4" style={{ color: lane }} />
        <span className="text-small font-semibold text-fg-1">{t.label}</span>
        <span className="text-small text-fg-3">· {status}</span>
        <span className="ml-auto inline-flex items-center gap-3 text-meta text-fg-3">
          {d && d.costUsd > 0 && <span className="tabular-nums text-fg-4" title="What this card has cost so far">${d.costUsd.toFixed(2)}</span>}
          {(d?.stale || !b) && !busy && <button onClick={write} className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"><RotateCcw className="size-3" />{b ? 'Catch up' : 'Write it'}</button>}
          {started && <button onClick={() => api('/discussions/reset', { target, topic }).then(onChange, fail)} className="inline-flex items-center gap-1 hover:text-fg-1" title="Forget this card and what was asked">Start over</button>}
        </span>
      </div>
      {busy && <p className="flex items-center gap-2 text-small text-fg-2"><LoaderCircle className="size-3.5 animate-spin" style={{ color: lane }} />{status}</p>}
      {d?.error && <p className="rounded-ctl bg-fail/10 px-2.5 py-1.5 text-small text-fail-text">{d.error}</p>}
      {/* on a PR: the change as a picture, the whole height (ChangeMap); elsewhere (a ticket), the card's slides */}
      {prId ? (
        <div className="min-h-0 flex-1">
          <Board topic={topic} prId={prId} path={explainPath} fork={b?.diagram?.kind === 'fork' ? b.diagram : undefined} toast={toast} />
        </div>
      ) : b || d?.messages.length ? <Slides slides={[...slidesOf(b, d?.messages ?? []), ...perPrSlides]} /> : !busy && <p className="text-small text-fg-3">{t.question}</p>}
      {prId && (() => { const m = d?.messages.at(-1); return m?.who === 'agent' && <Answered text={m.text.replace(/[#*_`>]/g, '')} /> })()}
      {d?.steer && (
        <div className="flex items-start gap-2 rounded-ctl bg-fill px-2.5 py-2">
          <span className="min-w-0 flex-1 text-small text-fg-1"><b className="font-semibold">For the agent:</b> {d.steer}</span>
          {d.sentAt ? <span className="inline-flex shrink-0 items-center gap-1 text-meta text-fg-3"><CheckCircle2 className="size-3.5 text-ok" />Sent</span> : <button onClick={sendSteer} className="btn-primary btn-sm inline-flex shrink-0 items-center gap-1.5"><Send className="size-3.5" />Send</button>}
        </div>
      )}
      {!!d?.actions?.length && (
        <div className="flex flex-wrap items-center gap-1.5">
          {d.actions.map((a, i) => (
            <button key={i} onClick={() => act(a)} title={a.text} className={chip}>
              {a.kind === 'steer' ? <Send className="size-3.5 shrink-0" /> : a.kind.startsWith('ask') ? <Copy className="size-3.5 shrink-0" /> : <Compass className="size-3.5 shrink-0" />}<span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null
  return { tile, details }
}

type TopicProps = Omit<Parameters<typeof topicVital>[0], 'topic' | 'd' | 'open' | 'onOpen' | 'pane'> & { d?: Discussions }
/** The row over the panel: the three boxes; under them what a clicked one holds, and (a PR in a stack) whether Intent
 *  and Understanding are about this PR or all of them. A click on one not assessed yet starts it. */
export function Vitals({ shipping, topics, scope, inline }: { shipping: ReactNode; topics: TopicProps; scope?: { size: number; stack: boolean; set: (stack: boolean) => void }; inline?: boolean }) {
  const [open, setOpen] = useState<Topic>()
  // a phone: an open card is a screen of its own, over the thread, with a way back (not a box squeezed under the row)
  const phone = usePhone()
  const sheet = phone
  const sheetRef = useRef<HTMLDivElement>(null)
  // asked from the chat's box: that card opens, to light up and answer where you can see it
  useEffect(() => { const on = (e: Event) => setOpen((e as CustomEvent<Topic>).detail); addEventListener('vital-ask', on); return () => removeEventListener('vital-ask', on) }, [])
  // the floating details close on Esc or a click anywhere else
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || inline) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !sheetRef.current?.contains(e.target as Node)) setOpen(undefined) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(undefined) }
    addEventListener('pointerdown', away); addEventListener('keydown', esc)
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc) }
  }, [open, inline])
  // an open card takes the chat's whole height: from under the row to the bottom of the window
  const [room, setRoom] = useState(480)
  useLayoutEffect(() => {
    if (!open || inline) return
    // to the bottom of the chat's own column (measured in the same units as the row: the app zooms on wide screens, and
    // the window's height counts the status bar under it)
    const el = box.current, col = el?.closest('[data-chat-column]')
    const fit = () => { const r = el?.getBoundingClientRect(), c = (col ?? document.body).getBoundingClientRect(); const z = Number(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1; if (r) setRoom(Math.max(280, (c.bottom - r.bottom) / z - 12)) }
    fit()
    const ro = new ResizeObserver(fit); if (col) ro.observe(col)
    addEventListener('resize', fit)
    return () => { ro.disconnect(); removeEventListener('resize', fit) }
  }, [open, inline])
  // one card to the other: the overlay stays and the card it leaves stays drawn (under the new one, still whole) until
  // the new one has faded in, so the chat under it never shows. Set while rendering, so the old card never unmounts
  const [was, setWas] = useState<{ now?: Topic; was?: Topic }>({})
  if (was.now !== open) setWas({ now: open, was: open && was.now ? was.now : undefined })
  useEffect(() => { if (!was.was) return; const t = setTimeout(() => setWas((x) => ({ now: x.now })), 220); return () => clearTimeout(t) }, [was])
  // the boards' chunk: fetched once the page has settled, or at once when a pointer or the focus comes to the row
  const pre = () => { if (topics.prId) loadMap().catch(() => {}) }
  useEffect(() => { if (!topics.prId) return; const t = setTimeout(pre, 1200); return () => clearTimeout(t) }, [topics.prId])
  const { d, ...rest } = topics
  const v = (['intent', 'understanding'] as const).map((tp) => topicVital({ ...rest, topic: tp, d: d?.[tp], open: open === tp, pane: open === tp || was.was === tp, onOpen: () => setOpen(open === tp ? undefined : tp) }))
  return (
    <div ref={box} className={`relative space-y-2.5 ${inline ? '' : 'p-3'}`}>
      <div className="grid grid-cols-3 gap-2" onPointerEnter={pre} onFocus={pre}>{shipping}{v[0].tile}{v[1].tile}</div>
      {scope && (
        <div className="flex items-center gap-2 px-1 text-small">
          <span className="text-fg-3">Intent and Understanding of</span>
          <Tabs size="sm" label="Scope" value={scope.stack ? 'stack' : 'pr'} onChange={(v) => scope.set(v === 'stack')}
                options={[{ id: 'pr', label: 'This PR' }, { id: 'stack', label: `The stack (${scope.size})` }]} />
        </div>
      )}
      {/* what a clicked one holds: floating over the panel under the row, so nothing below it moves. One container for
          both cards: it rises in when one opens and stays while you switch, the two cards stacked in its one cell */}
      {/* on the page's own layer (a portal): over the tab bar and the status bar, whatever holds the row */}
      {open && sheet && createPortal(
        <div ref={sheetRef} role="dialog" aria-label={TOPIC[open].label} className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-bg-app pt-[env(safe-area-inset-top)] animate-[detail-in_200ms_var(--ease-snappy)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
            <button onClick={() => setOpen(undefined)} className="btn-ghost inline-flex min-h-10 items-center gap-1.5"><ArrowLeft className="size-4" />Back</button>
            <span className="min-w-0 flex-1 truncate text-small font-semibold text-fg-1">{TOPIC[open].label}</span>
          </div>
          {/* one scroll for the card; a board (a PR's) takes the height that is left and pans inside itself */}
          <div className={`grid min-h-0 flex-1 p-3 pb-[calc(12px+env(safe-area-inset-bottom))] ${rest.prId ? 'grid-rows-[minmax(0,1fr)]' : 'overflow-y-auto overscroll-contain'}`}>
            {(['intent', 'understanding'] as const).map((tp, i) => v[i].details && (
              <div key={tp} inert={tp !== open} aria-hidden={tp !== open || undefined}
                   className={`col-start-1 row-start-1 min-h-0 min-w-0 ${tp === open ? 'relative z-[1]' : 'pointer-events-none opacity-0'}`}>{v[i].details}</div>
            ))}
          </div>
        </div>, document.body,
      )}
      {open && !sheet && (
        <div className={`grid animate-[detail-in_200ms_var(--ease-snappy)] ${inline ? '' : `absolute inset-x-3 top-full z-30 -mt-1 overflow-hidden rounded-card bg-surface-1 shadow-[var(--e3)] ${rest.prId ? 'grid-rows-[minmax(0,1fr)]' : 'max-h-[min(70vh,560px)] overflow-y-auto'}`}`} style={inline || !rest.prId ? undefined : { height: room }}>
          {(['intent', 'understanding'] as const).map((tp, i) => v[i].details && (
            <div key={tp} inert={tp !== open} aria-hidden={tp !== open || undefined}
                 className={`col-start-1 row-start-1 min-h-0 min-w-0 ${tp === open ? `relative z-[1] ${was.was ? 'animate-[fade-in_180ms_var(--ease-out)]' : ''}` : 'pointer-events-none'}`}>{v[i].details}</div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The card's last answer: two lines (clipped inside the padding, so no line shows half), the whole of it on a click. */
function Answered({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  return (
    <button type="button" onClick={() => setAll(!all)} aria-expanded={all} title={all ? 'Show less' : 'Show the whole answer'}
            className={`shrink-0 rounded-ctl bg-fill px-3 py-1.5 text-left text-small text-fg-2 transition-colors hover:bg-fill-strong ${all ? 'max-h-48 overflow-y-auto' : ''}`}>
      <span className={all ? 'whitespace-pre-line' : 'line-clamp-2'}><b className="font-medium text-fg-1">Answered: </b>{text}</span>
    </button>
  )
}

type Slide = { key: string; label: string; at?: string; body: ReactNode }
/**
 * The card as slides, newest first: each answer to what you asked after the card was written, then the card's parts
 * (its bold-labelled sections, one each), then what was asked before it.
 */
export function slidesOf(b: { long: string; at: string; diagram?: Diagram } | undefined, messages: { who: string; text: string; at: string }[]): Slide[] {
  const qa: { q?: string; a?: string; at: string }[] = []
  for (const m of messages) {
    if (m.who === 'you') qa.push({ q: m.text, at: m.at })
    else if (qa.at(-1) && !qa.at(-1)!.a) qa.at(-1)!.a = m.text
    else qa.push({ a: m.text, at: m.at })
  }
  const asked = (x: (typeof qa)[number], i: number): Slide => ({ key: `qa${i}:${x.at}`, label: 'You asked', at: x.at, body: (
    <>
      {x.q && <p className="mb-2 ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-accent-soft px-3 py-1.5 text-small text-fg-1">{x.q}</p>}
      {x.a ? <Md text={x.a} className="text-small leading-relaxed [&>*:first-child]:!mt-0" /> : <p className="text-small text-fg-4">Answering…</p>}
    </>
  ) })
  // the card's parts: "**Problem** …" up to the next bold label at a line's start
  const parts = b ? [...b.long.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?\*\*([^*\n]+?)\*\*:?\s*([\s\S]*?)(?=\n\s*(?:[-*]\s*)?\*\*[^*\n]+\*\*|$)/g)]
    .map((m, i): Slide => ({ key: `part${i}`, label: m[1].replace(/:$/, ''), at: b.at, body: <Md text={m[2].trim()} className="text-small leading-relaxed [&>*:first-child]:!mt-0" /> })) : []
  const text = parts.length ? parts : b ? [{ key: 'card', label: 'The card', at: b.at, body: <Md text={b.long} className="text-small leading-relaxed" /> }] : []
  // its picture first: the card at a glance, the parts after it for the words
  const card = b?.diagram ? [{ key: 'diagram', label: b.diagram.kind === 'path' ? 'The path' : 'The decision', at: b.at, body: <CardDiagram d={b.diagram} /> }, ...text] : text
  const after = qa.map((x, i) => [x, i] as const).filter(([x]) => !b || x.at > b.at).reverse().map(([x, i]) => asked(x, i))
  const before = qa.map((x, i) => [x, i] as const).filter(([x]) => b && x.at <= b.at).reverse().map(([x, i]) => asked(x, i))
  return [...after, ...card, ...before]
}

/**
 * A vertical carousel on the browser's own scrolling: a flick goes as far as it goes, and it always comes to rest on a
 * slide (scroll-snap). As tall as its tallest slide, up to a cap, so a slide is never cut; dots say where you are.
 */
function Slides({ slides }: { slides: Slide[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const [h, setH] = useState(0)
  const inner = useRef<(HTMLDivElement | null)[]>([])
  // a new first slide (an answer just came in): back to it
  useEffect(() => { box.current?.scrollTo({ top: 0, behavior: 'instant' }); setAt(0) }, [slides[0]?.key])
  // the height of the tallest slide's content, measured as it renders (markdown, wrapping)
  useLayoutEffect(() => {
    const measure = () => setH(Math.min(420, Math.max(96, ...inner.current.filter(Boolean).map((el) => el!.scrollHeight))))
    measure()
    const ro = new ResizeObserver(measure)
    inner.current.forEach((el) => el && ro.observe(el))
    return () => ro.disconnect()
  }, [slides.length])
  const go = (i: number) => box.current?.scrollTo({ top: i * box.current.clientHeight, behavior: 'smooth' })
  // a short nudge (one notch of a wheel) would snap back to where it was: it moves one slide that way instead
  const nudge = useRef({ from: 0, dy: 0, t: 0 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const idx = () => Math.round(el.scrollTop / el.clientHeight)
    const wheel = (e: WheelEvent) => { const n = nudge.current, t = performance.now(); if (t - n.t > 250) { n.from = idx(); n.dy = 0 } n.dy += e.deltaY; n.t = t }
    const end = () => { const n = nudge.current; if (Math.abs(n.dy) > 20 && idx() === n.from) go(n.from + Math.sign(n.dy)); n.dy = 0 }
    el.addEventListener('wheel', wheel, { passive: true }); el.addEventListener('scrollend', end)
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('scrollend', end) }
  }, [])
  return (
    <div className="relative">
      <div ref={box} onScroll={(e) => setAt(Math.round(e.currentTarget.scrollTop / e.currentTarget.clientHeight))} tabIndex={0} aria-roledescription="carousel"
           className="snap-y snap-mandatory overflow-y-auto overscroll-contain pr-6 outline-none [scrollbar-width:none]" style={{ height: h || undefined }}>
        {slides.map((x, i) => (
          <section key={x.key} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}: ${x.label}`} className="h-full snap-start overflow-hidden">
            <div ref={(el) => { inner.current[i] = el }}>
              <p className="mb-1.5 flex items-center gap-1.5 text-micro">
                <span className="font-semibold uppercase tracking-wide text-[var(--lane)]">{x.label}</span>
                {x.at && <span className="text-fg-4">· {ago(x.at)}</span>}
              </p>
              {x.body}
            </div>
          </section>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="absolute right-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1" role="tablist" aria-label="Slides">
          {slides.map((x, i) => (
            <button key={x.key} role="tab" aria-selected={i === at} title={x.label} onClick={() => go(i)}
                    className={`w-1.5 rounded-full transition-[height,background-color] duration-150 ${i === at ? 'h-4 bg-[var(--lane)]' : 'h-1.5 bg-fg-4/40 hover:bg-fg-3'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
