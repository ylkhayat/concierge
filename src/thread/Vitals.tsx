// Over the panel, always in sight: the three things a PR or ticket stands on, live. Shipping (what the work waits on), Intent
// (is what it should do agreed) and Understanding (do you know what it does). Each is a borderless box of living
// colour that says what is going on now and changes as the chat goes on; under the pointer (or the keyboard's focus) it
// opens, inside itself, on what is settled, what it has for the agent and what to ask next. One not assessed yet is
// pale: point at it and it offers to start, with the question that fits where the conversation stands.
import { CheckCircle2, Copy, Compass, LoaderCircle, RotateCcw, Rocket, Send } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Action, Discussion as D, Stage, Topic } from '../../server/discussions.ts'
import { api } from '../lib.ts'
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

/** A vital: a quiet card that always names itself (its colour dot and name), says in one line what is going on now,
 *  and shows how far along it is on a hairline at its foot. A faint tint of its colour drifts across it, faster while
 *  something works on it. Under the pointer (or the focus) its line gives way to the one thing worth knowing or doing;
 *  the name and the hairline stay. A click opens what it holds, under the row. */
export function Vital({ name, status, lane, meter, busy, idle, flag, back, open, onOpen }: { icon?: ReactNode; name: string; status: string; lane: string; meter: ReactNode; busy?: boolean; idle?: boolean; flag?: boolean; back?: ReactNode; open?: boolean; onOpen?: () => void }) {
  return (
    <section tabIndex={0} aria-label={`${name}: ${status}`} aria-expanded={onOpen ? open : undefined} style={{ '--lane': lane } as React.CSSProperties}
             onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onOpen?.() }} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen?.() }}
             className={`group/v vital flex h-[68px] min-w-0 flex-col ${onOpen ? 'cursor-pointer' : ''} ${busy ? 'vital-busy' : ''} ${idle ? 'vital-idle' : ''} ${open ? 'vital-open' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className={`size-1.5 shrink-0 rounded-full bg-[var(--lane)] ${busy ? 'animate-pulse' : ''}`} />
        <span className="label truncate !tracking-[0.03em] text-fg-3">{name}</span>
        {flag && <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-micro font-medium text-fg-2" title="It has something for the agent: point at it, or open it, to send"><Send className="size-3" /><span className="sr-only">has something for the agent</span></span>}
      </div>
      {/* what is going on now, and under the pointer the one thing worth knowing or doing (same place, same size) */}
      <div className="relative mt-1 grid min-h-0 flex-1">
        <p key={status} className={`col-start-1 row-start-1 truncate text-small font-medium text-fg-1 transition-opacity duration-200 animate-[detail-in_400ms_var(--ease-out)] ${back ? 'group-hover/v:pointer-events-none group-hover/v:opacity-0 group-focus-within/v:pointer-events-none group-focus-within/v:opacity-0' : ''}`}>{status}</p>
        {back && <div className="pointer-events-none relative z-10 col-start-1 row-start-1 flex min-w-0 items-start gap-2 opacity-0 transition-opacity duration-200 group-hover/v:pointer-events-auto group-hover/v:opacity-100 group-focus-within/v:pointer-events-auto group-focus-within/v:opacity-100">{back}</div>}
      </div>
      <div className="mt-auto">{meter}</div>
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
export function useLaneActions({ d, target, onChange, onSteer, onView, toast }: { d?: Discussions; target: string; onChange: (all: Discussions) => void; onSteer: (text: string) => Promise<unknown>; onView?: (v: View) => void; toast: Toast }): Attach | undefined {
  const [picked, setPicked] = useState<Set<string>>(new Set())
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
      {items.map(({ key, topic, a }) => {
        const on = picked.has(key)
        return (
          <button key={key} type="button" aria-pressed={on} title={a.text ?? a.label} onClick={() => toggle(key)} style={{ '--lane': `var(--vital-${topic})` } as React.CSSProperties}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-left text-small transition-colors ${on ? 'bg-[color-mix(in_oklch,var(--lane)_22%,transparent)] text-fg-1 ring-1 ring-[var(--lane)]' : 'bg-[color-mix(in_oklch,var(--lane)_8%,transparent)] text-fg-2 ring-1 ring-[color-mix(in_oklch,var(--lane)_25%,transparent)] hover:text-fg-1'}`}>
            {on ? <CheckCircle2 className="size-3.5 shrink-0" /> : a.kind === 'steer' ? <Send className="size-3.5 shrink-0" /> : a.kind.startsWith('ask') ? <Copy className="size-3.5 shrink-0" /> : <Compass className="size-3.5 shrink-0" />}
            <span className="truncate">{a.kind === 'steer' ? `For the agent: ${a.label}` : a.label}</span>
          </button>
        )
      })}
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

/** Shipping: what the work waits on, from its flow. `at` of `of`: how far along it is. */
export function ShippingVital({ title, tone, why, at, of = 4, busy }: { title: string; tone: Tone; why?: ReactNode; at: number; of?: number; busy?: boolean }) {
  return (
    <Vital name="Shipping" icon={<Rocket className="size-3.5 text-[var(--vital-ship)]" />} status={title} lane="var(--vital-ship)" busy={busy}
           meter={<Meter of={of} at={at} color={tone === 'ok' ? 'var(--st-ok)' : tone === 'fail' ? 'var(--st-fail)' : 'var(--vital-ship)'} pulse={busy} />}
           back={why ? <p className="truncate text-meta leading-snug text-fg-2" title={typeof why === "string" ? why : undefined}>{why}</p> : undefined} />
  )
}

/** Intent or Understanding: where the discussion stands, what it settled, and what it has for the agent. */
export function topicVital({ target, topic, d, onChange, onSteer, onSteerPr, onView, toast, here, open, onOpen }: {
  target: string; topic: Topic; d?: D; onChange: (all: Discussions) => void; onSteer: (text: string) => Promise<unknown>
  onSteerPr?: (number: number, text: string) => Promise<unknown>; onView?: (v: View) => void; toast: Toast; here?: number
  open?: boolean; onOpen?: () => void
}): { tile: ReactNode; details: ReactNode } {

  const t = TOPIC[topic], started = !!d?.messages.length
  const fail = (e: Error) => toast(e.message, 'error')
  const say = (text: string) => api('/discussions/say', { target, topic, text }).then(onChange, fail)
  const sendSteer = () => d?.steer && onSteer(d.steer).then(() => api('/discussions/sent', { target, topic }).then(onChange)).then(() => toast('Sent to the agent'), fail)
  const sendPr = (n: number, text: string) => onSteerPr?.(n, text).then(() => api('/discussions/sent', { target, topic, number: n }).then(onChange)).then(() => toast(`Sent to #${n}'s agent`), fail)
  const act = (a: Action) => { onOpen && open && onOpen(); return actOn(a, { target, topic, onChange, onSteer, onView, toast }) }
  const chip = 'inline-flex max-w-full items-center gap-1.5 rounded-ctl bg-fill px-2.5 py-1 text-left text-small text-fg-2 transition-colors hover:bg-fill-strong hover:text-fg-1'
  const status = d?.busy ? 'Thinking it through…' : !started ? 'Not assessed yet' : d!.status || (d!.stage === 'concluded' ? (topic === 'intent' ? 'Agreed' : 'Understood') : 'Open')
  const lane = d?.stage === 'concluded' ? 'var(--st-ok)' : `var(--vital-${topic})`
  const unsent = !!d?.steer && !d.sentAt
  const act1 = 'ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-meta font-semibold text-fg-1 bg-[color-mix(in_oklch,var(--lane)_18%,transparent)] hover:bg-[color-mix(in_oklch,var(--lane)_28%,transparent)]'
  const tile = (
    <Vital name={t.label} icon={<t.icon className="size-3.5" style={{ color: lane }} />} status={status} lane={lane} busy={d?.busy} idle={!started && !d?.busy} flag={unsent}
           open={open && started} onOpen={started ? onOpen : d?.busy ? undefined : () => say(START[topic])}
           meter={<Meter of={3} at={started ? STEP[d!.stage] : 0} color={lane} pulse={d?.busy} />}
           back={!started ? (
             // not assessed: one click (anywhere on it) starts it from where the conversation stands
             <><p className="min-w-0 flex-1 truncate text-meta leading-snug text-fg-2">{t.question}</p><span className={act1}>Start</span></>
           ) : unsent ? (
             <><p className="min-w-0 flex-1 truncate text-meta leading-snug text-fg-2">{d!.steer}</p><button onClick={sendSteer} className={act1}><Send className="size-3" />Send</button></>
           ) : (
             <p className="min-w-0 flex-1 truncate text-meta leading-snug text-fg-2">{d!.adr ? `${d!.adr.title}. ${d!.adr.decision}` : d!.summary || status}</p>
           )} />
  )
  // everything it holds, under the row, when its box is clicked
  const details = open && started ? (
    <div className="card space-y-2.5 p-3.5 animate-[detail-in_200ms_var(--ease-snappy)]" style={{ '--lane': lane } as React.CSSProperties}>
      <p className="flex items-center gap-2 text-small font-semibold text-fg-1"><t.icon className="size-4" style={{ color: lane }} />{t.label}<span className="font-normal text-fg-3">· {status}</span></p>
      {d!.error && <p className="rounded-ctl bg-fail/10 px-2.5 py-1.5 text-small text-fail-text">{d!.error}</p>}
      {d!.adr ? (
        <dl className="space-y-1.5 text-small">
          <div><dt className="label text-fg-4">Decision · {d!.adr.status}</dt><dd className="text-fg-1"><b className="font-medium">{d!.adr.title}.</b> {d!.adr.decision}</dd></div>
          <div><dt className="label text-fg-4">Context</dt><dd className="text-fg-2">{d!.adr.context}</dd></div>
          <div><dt className="label text-fg-4">Consequences</dt><dd className="text-fg-2">{d!.adr.consequences}</dd></div>
          {d!.adr.alternatives && <div><dt className="label text-fg-4">Set aside</dt><dd className="text-fg-2">{d!.adr.alternatives}</dd></div>}
        </dl>
      ) : d!.summary && <p className="text-small leading-relaxed text-fg-2">{d!.summary}</p>}
      {d!.steer && (
        <div className="flex items-start gap-2 rounded-ctl bg-fill px-2.5 py-2">
          <span className="min-w-0 flex-1 text-small text-fg-1"><b className="font-semibold">For the agent:</b> {d!.steer}</span>
          {d!.sentAt ? <span className="inline-flex shrink-0 items-center gap-1 text-meta text-fg-3"><CheckCircle2 className="size-3.5 text-ok" />Sent</span> : <button onClick={sendSteer} className="btn-primary btn-sm inline-flex shrink-0 items-center gap-1.5"><Send className="size-3.5" />Send</button>}
        </div>
      )}
      {!!d!.perPr?.length && (
        <ul className="divide-y divide-line overflow-hidden rounded-ctl ring-1 ring-line">
          {d!.perPr!.map((x) => (
            <li key={x.number} className={`flex items-start gap-2.5 px-2.5 py-1.5 text-small ${x.number === here ? 'bg-accent-soft' : ''}`}>
              <span className="shrink-0 font-mono font-medium text-fg-1">#{x.number}</span>
              <span className="min-w-0 flex-1 text-fg-2">{x.decision}{x.steer && <span className="mt-0.5 block text-meta text-fg-3"><b className="font-medium text-fg-1">Its agent:</b> {x.steer}</span>}</span>
              {x.steer && (x.sentAt ? <span className="shrink-0 text-meta text-fg-4">Sent</span> : <button onClick={() => sendPr(x.number, x.steer!)} className="shrink-0 rounded-md px-2 py-0.5 text-meta font-medium text-accent-text ring-1 ring-accent/30 hover:bg-accent-soft">Send</button>)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {(d!.actions ?? []).map((a, i) => (
          <button key={i} onClick={() => act(a)} title={a.text} className={chip}>
            {a.kind === 'steer' ? <Send className="size-3.5 shrink-0" /> : a.kind.startsWith('ask') ? <Copy className="size-3.5 shrink-0" /> : <Compass className="size-3.5 shrink-0" />}<span className="truncate">{a.label}</span>
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-3 text-meta text-fg-3">
          {d!.costUsd > 0 && <span className="tabular-nums text-fg-4">${d!.costUsd.toFixed(2)}</span>}
          <button onClick={() => api('/discussions/reset', { target, topic }).then(onChange, fail)} className="inline-flex items-center gap-1 hover:text-fg-1"><RotateCcw className="size-3" />Start over</button>
        </span>
      </div>
    </div>
  ) : null
  return { tile, details }
}

type TopicProps = Omit<Parameters<typeof topicVital>[0], 'topic' | 'd' | 'open' | 'onOpen'> & { d?: Discussions }
/** The row over the panel: the three boxes; under them what a clicked one holds, and (a PR in a stack) whether Intent
 *  and Understanding are about this PR or all of them. A click on one not assessed yet starts it. */
export function Vitals({ shipping, topics, scope, inline }: { shipping: ReactNode; topics: TopicProps; scope?: { size: number; stack: boolean; set: (stack: boolean) => void }; inline?: boolean }) {
  const [open, setOpen] = useState<Topic>()
  // the floating details close on Esc or a click anywhere else
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || inline) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(undefined) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(undefined) }
    addEventListener('pointerdown', away); addEventListener('keydown', esc)
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc) }
  }, [open, inline])
  const { d, ...rest } = topics
  const v = (['intent', 'understanding'] as const).map((tp) => topicVital({ ...rest, topic: tp, d: d?.[tp], open: open === tp, onOpen: () => setOpen(open === tp ? undefined : tp) }))
  return (
    <div ref={box} className={`relative space-y-2.5 ${inline ? '' : 'p-3'}`}>
      <div className="grid grid-cols-3 gap-2">{shipping}{v[0].tile}{v[1].tile}</div>
      {scope && (
        <div className="flex items-center gap-2 px-1 text-small">
          <span className="text-fg-3">Intent and Understanding of</span>
          <div role="radiogroup" aria-label="Scope" className="inline-flex rounded-ctl bg-fill p-0.5">
            {([[false, 'This PR'], [true, `The stack (${scope.size})`]] as const).map(([val, l]) => (
              <button key={l} role="radio" aria-checked={scope.stack === val} onClick={() => scope.set(val)} className={`rounded-lg px-2.5 py-0.5 font-medium ${scope.stack === val ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {/* what a clicked one holds: floating over the panel under the row, so nothing below it moves */}
      {(v[0].details || v[1].details) && (
        <div className={inline ? '' : 'absolute inset-x-3 top-full z-30 -mt-1 max-h-[min(55vh,480px)] overflow-y-auto rounded-card shadow-[var(--e3)]'}>{v[0].details}{v[1].details}</div>
      )}
    </div>
  )
}
