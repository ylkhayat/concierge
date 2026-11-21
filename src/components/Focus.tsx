import { ArrowUpRight, BookOpen, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, GitPullRequest, LoaderCircle, MessagesSquare, Play, Send, Sparkles, Upload, Wand } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import type { Overlay } from '../../server/explain.ts'
import type { NextSteps } from '../../server/next.ts'
import { composeReply } from '../../server/reply.ts'
import { cards, type Card } from '../focus.ts'
import type { Rules } from '../desk.ts'
import { api, critUrl, enc, type PrView, type TicketView } from '../lib.ts'
import { useArm } from '../arm.tsx'
import { Pick } from '../ui/Pick.tsx'
import { statusMeta } from './StatusBadge.tsx'

// put off for this session: they go to the back of the line
const later: string[] = (() => { try { return JSON.parse(sessionStorage.getItem('focus-later') ?? '[]') } catch { return [] } })()
const putOff = (k: string) => {
  const i = later.indexOf(k); if (i >= 0) later.splice(i, 1)
  later.push(k)
  try { sessionStorage.setItem('focus-later', JSON.stringify(later)) } catch { /* private window */ }
}
// what the explanation says in a line, fetched once per PR and push
const headlines = new Map<string, { headline: string; risk: string; steps: number } | null>()

const FIX = 'Apply the fixes for the threads you classed as fix, commit them locally, and draft a reply on every open thread (crit if it is running, otherwise in your final message). Do not push and do not post anything to GitHub: that waits for Push & reply.'

/**
 * The phone's home: what needs you, one card at a time. Each card says what it is and why it waits, what its
 * explanation says in a line, and the one step to take (an agent's question answered with its own pick ready,
 * approve, push…), with Later to put it off and the tour a tap away. Swipe between cards. A step that pushes,
 * posts or approves takes a second tap.
 */
export function Focus({ prs, tickets, rules, onRead, onOpenPr, onOpenTicket, toast }: {
  prs: PrView[]; tickets: TicketView[]; rules: Rules
  onRead: (id: string) => void; onOpenPr: (id: string) => void; onOpenTicket: (id: string) => void
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const [, rerender] = useState(0)
  const list = cards(prs, tickets, rules, later)
  const [at, setAt] = useState<string>()
  const [sent, setSent] = useState<string>() // the card you just acted on: a moment of "done" before the next
  const i = Math.max(0, list.findIndex((c) => c.key === at))
  const card = list[i]
  const go = (n: number) => { const c = list[Math.max(0, Math.min(list.length - 1, n))]; if (c) setAt(c.key) }
  const laterOn = () => { if (!card) return; putOff(card.key); setAt(list[i + 1]?.key ?? list[0]?.key); rerender((x) => x + 1) }
  const done = (msg: string) => {
    toast(msg)
    setSent(card?.key)
    setTimeout(() => { setSent(undefined); go(i + 1) }, 900)
  }

  const touch = useRef<{ x: number; y: number } | null>(null)
  const swipe = {
    onTouchStart: (e: TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } },
    onTouchEnd: (e: TouchEvent) => {
      const t0 = touch.current; touch.current = null
      if (!t0 || (e.target as HTMLElement).closest('button, a, textarea')) return
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(i + (dx < 0 ? 1 : -1))
    },
  }

  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-3xl bg-ok/10"><CheckCheck className="size-7 text-ok" /></span>
        <p className="text-title font-semibold">Nothing needs you</p>
        <p className="text-body text-fg-3">New reviews, answers and agents' questions land here as they come.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" {...swipe}>
      {/* where you are in the line */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-3">
        <span className="text-body font-semibold">Focus</span>
        <span className="flex min-w-0 flex-1 items-center gap-1" aria-hidden>
          {list.slice(0, 12).map((c, j) => <span key={c.key} className={`h-1 flex-1 rounded-full transition-colors ${j === i ? 'bg-accent' : j < i ? 'bg-accent/35' : 'bg-fill-strong'}`} />)}
        </span>
        <span className="shrink-0 font-mono text-small tabular-nums text-fg-3">{i + 1}/{list.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-px">
        <article key={card.key} className={`relative flex min-h-full flex-col gap-4 rounded-[28px] bg-surface-1 p-5 ring-1 ring-line animate-[rise-in_260ms_var(--ease-snappy)] ${sent === card.key ? 'opacity-60' : ''}`}>
          {sent === card.key && <span className="absolute inset-0 z-10 flex items-center justify-center"><span className="flex size-16 items-center justify-center rounded-full bg-ok text-white shadow-lg"><Check className="size-8" strokeWidth={3} /></span></span>}
          {card.kind === 'pr' ? <PrCard card={card} onRead={onRead} onOpen={onOpenPr} done={done} toast={toast} /> : <TicketCard t={card.ticket} onOpen={onOpenTicket} />}
        </article>
      </div>

      {/* the way through: back, later, forward; thumb height, clear of the tab bar */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous" className="flex size-12 items-center justify-center rounded-2xl bg-surface-1 text-fg-2 ring-1 ring-line active:scale-95 disabled:opacity-30 "><ChevronLeft className="size-5" /></button>
        <button onClick={laterOn} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-surface-1 text-reading font-medium text-fg-2 ring-1 ring-line active:scale-[0.98] "><Clock className="size-4" />Later</button>
        <button onClick={() => go(i + 1)} disabled={i >= list.length - 1} aria-label="Next" className="flex size-12 items-center justify-center rounded-2xl bg-surface-1 text-fg-2 ring-1 ring-line active:scale-95 disabled:opacity-30 "><ChevronRight className="size-5" /></button>
      </div>
    </div>
  )
}

const big = 'flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-reading font-semibold transition-transform active:scale-[0.98] disabled:opacity-40'
const violet = `${big} bg-accent text-on-accent`
const green = `${big} bg-ok text-white`
const quiet = `${big} bg-fill text-fg-2 `

function PrCard({ card, onRead, onOpen, done, toast }: { card: Extract<Card, { kind: 'pr' }>; onRead: (id: string) => void; onOpen: (id: string) => void; done: (m: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const pr = card.pr
  const m = statusMeta(pr.status, pr.mine)
  const key = `${pr.id}:${pr.explain?.endedAt ?? ''}`
  const [line, setLine] = useState(headlines.get(key))
  useEffect(() => {
    if (headlines.has(key) || pr.explain?.state !== 'done') return
    api(`/prs/${enc(pr.id)}/explain`).then((d: { overlay?: Overlay }) => {
      const o = d.overlay
      const v = o ? { headline: o.business.headline, risk: o.business.risk, steps: (o.tour?.steps.length ?? 0) + (o.tour?.story ? 4 : 1) } : null
      headlines.set(key, v); setLine(v)
    }, () => { headlines.set(key, null); setLine(null) })
  }, [key])
  const post = (path: string, body: object, msg: string) => api(`/prs/${enc(pr.id)}/${path}`, body).then(() => done(msg), (e: Error) => toast(e.message, 'error'))

  return (
    <>
      <header className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-fg-3">
          <span className={`size-2 rounded-full ${m.dot}`} />{m.label}
          <span className="font-mono">{pr.repo.split('/')[1]}#{pr.number}</span>
          {pr.stack && <span>{pr.stack.findIndex((s) => s.number === pr.number) + 1}/{pr.stack.length} in stack</span>}
        </p>
        <h2 className="text-title font-semibold leading-snug tracking-tight text-fg-1 ">{pr.title}</h2>
        <p className="text-reading leading-relaxed text-fg-2 ">{pr.flow.why}</p>
      </header>

      {/* what the explanation says, and the tour a tap away */}
      {pr.explain?.state === 'done' && (
        <button onClick={() => onRead(pr.id)} className="flex items-start gap-3 rounded-2xl bg-accent/6 p-3.5 text-left ring-1 ring-accent/20 active:scale-[0.99]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-reading font-medium leading-snug text-fg-1 ">{line === undefined ? 'Reading the explanation…' : line?.headline ?? 'Its explanation'}</span>
            <span className="mt-1 flex items-center gap-1.5 text-small font-semibold text-accent-text"><BookOpen className="size-3.5" />Read the tour{line ? ` · ${line.steps} steps · ${line.risk} risk` : ''}</span>
          </span>
        </button>
      )}

      <span className="flex-1" />
      {card.asks ? <Answer pr={pr} done={done} toast={toast} /> : <Step pr={pr} post={post} />}
      <button onClick={() => onOpen(pr.id)} className="flex items-center justify-center gap-1.5 text-body font-medium text-fg-3">Open the full PR<ArrowUpRight className="size-3.5" /></button>
    </>
  )
}

/** The agent's questions, its own picks already chosen: one tap sends every answer. */
export function Answer({ pr, done, toast }: { pr: PrView; done: (m: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [steps, setSteps] = useState<NextSteps | null>()
  const [picks, setPicks] = useState<Record<number, number>>({})
  const [sending, setSending] = useState(false)
  const { armed, arm } = useArm()
  useEffect(() => {
    api(`/prs/${enc(pr.id)}/next`).then((r: { steps: NextSteps | null }) => {
      setSteps(r.steps)
      setPicks(Object.fromEntries((r.steps?.decisions ?? []).map((d, i) => [i, d.options.findIndex((o) => o.recommended)]).filter(([, j]) => j >= 0)))
    }, () => setSteps(null))
  }, [pr.id, pr.job?.endedAt])
  if (steps === undefined) return <p className="flex items-center justify-center gap-2 py-3 text-body text-fg-3"><LoaderCircle className="size-4 animate-spin" />Reading what the agent asks…</p>
  if (!steps) return <p className="text-body text-fg-3">Its question couldn't be read here; open the full PR.</p>
  const open = steps.decisions.filter((d, i) => d.blocking && picks[i] === undefined)
  const send = (extra: string, label: string) => {
    const chosen = Object.entries(picks).map(([d, o]) => ({ topic: steps.decisions[Number(d)].topic, label: steps.decisions[Number(d)].options[o].label, reply: steps.decisions[Number(d)].options[o].reply }))
    const text = composeReply(chosen, extra)
    if (!text) return toast('Pick an answer first', 'error')
    setSending(true)
    api(`/prs/${enc(pr.id)}/reply`, { text }).then(() => done(`Sent: ${label.toLowerCase()}`), (e: Error) => toast(e.message, 'error')).finally(() => setSending(false))
  }
  const publish = steps.actions.find((a) => a.kind === 'publish'), goOn = steps.actions.find((a) => a.kind === 'go')
  return (
    <div className="space-y-4">
      {steps.decisions.map((d, i) => (
        <div key={i} className="space-y-2">
          <p className="text-reading font-medium leading-snug text-fg-1 ">{d.question}</p>
          {d.why && <p className="text-small text-fg-3">{d.why}</p>}
          <Pick wrap label={d.question} value={picks[i]} onChange={(j) => setPicks((p) => ({ ...p, [i]: j }))}
                options={d.options.map((o, j) => ({ value: j, hint: o.label, label: <>{o.label}{o.recommended && picks[i] !== j && <span className="ml-1.5 text-micro font-semibold uppercase text-accent-text">pick</span>}</> }))} />
        </div>
      ))}
      {publish ? (
        <button disabled={sending || open.length > 0} onClick={() => arm('publish', () => send(publish.reply, publish.label))} className={green}>
          {sending ? <LoaderCircle className="size-5 animate-spin" /> : <Upload className="size-5" />}{armed === 'publish' ? `Tap again: ${publish.label.toLowerCase()}` : publish.label}
        </button>
      ) : (
        <button disabled={sending || open.length > 0 || (!Object.keys(picks).length && !goOn)} onClick={() => send(goOn?.reply ?? '', goOn?.label ?? 'My answers')} className={violet}>
          {sending ? <LoaderCircle className="size-5 animate-spin" /> : <Send className="size-5" />}{goOn ? goOn.label : steps.decisions.length > 1 ? 'Send my answers' : 'Send my answer'}
        </button>
      )}
      {publish && goOn && <button disabled={sending || open.length > 0} onClick={() => send(goOn.reply, goOn.label)} className={quiet}>{goOn.label}</button>}
    </div>
  )
}

/** The one step this PR waits on, as a big button (a second tap for anything that posts, pushes or approves). */
export function Step({ pr, post }: { pr: PrView; post: (path: string, body: object, msg: string) => Promise<unknown> }) {
  const { armed, arm } = useArm()
  const confirm = (k: string, label: string) => (armed === k ? `Tap again: ${label.toLowerCase()}` : label)
  const url = critUrl(pr)
  const n = pr.awaiting ?? pr.unresolved ?? 0
  const BTN: Record<string, ReactNode> = {
    post: <>
      <button onClick={() => arm('approve', () => post('submit', { event: 'APPROVE' }, 'Approving: the agent submits it'))} className={green}><CheckCheck className="size-5" />{confirm('approve', 'Approve')}</button>
      <button onClick={() => arm('comment', () => post('submit', { event: 'COMMENT' }, 'Posting the review as comments'))} className={quiet}><Send className="size-4" />{confirm('comment', 'Post as comments')}</button>
    </>,
    publish: <button onClick={() => arm('publish', () => post('publish', {}, 'Pushing and replying'))} className={green}><Upload className="size-5" />{confirm('publish', 'Push & reply')}</button>,
    fix: <button onClick={() => post('reply', { text: FIX }, 'Fix round started')} className={violet}><Wand className="size-5" />Fix the {n === 1 ? 'thread' : `${n} threads`}</button>,
    finalize: <button onClick={() => post('run', {}, 'Bringing the last comments into crit')} className={violet}><Wand className="size-5" />Finish the last {n === 1 ? 'comment' : `${n} comments`}</button>,
    retry: <button onClick={() => post('run', {}, pr.mine ? 'Revise queued' : 'Review queued')} className={violet}><Play className="size-5" />Try again</button>,
    rerequest: <button onClick={() => arm('rerequest', () => post('rerequest', {}, 'Asked them to review again'))} className={violet}><Send className="size-5" />{confirm('rerequest', `Ask ${pr.reviewers?.join(', ') || 'them'} to re-review`)}</button>,
    merge: <a href={pr.url} target="_blank" rel="noreferrer" className={green}><GitPullRequest className="size-5" />Merge on GitHub</a>,
    crit: url ? <a href={url} target="_blank" rel="noreferrer" className={violet}><MessagesSquare className="size-5" />{pr.mine ? 'Fix in crit' : 'Review in crit'}</a> : null,
  }
  const b = pr.flow.next && BTN[pr.flow.next]
  return b ? <div className="space-y-2">{b}</div> : null
}

function TicketCard({ t, onOpen }: { t: TicketView; onOpen: (id: string) => void }) {
  return (
    <>
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-small text-fg-3"><span className="size-2 rounded-full bg-wait" />The agent asks you<span className="font-mono">{t.id}</span></p>
        <h2 className="text-title font-semibold leading-snug tracking-tight text-fg-1 ">{t.title}</h2>
        <p className="text-reading leading-relaxed text-fg-2 ">It parked the ticket with a question on Linear, or stopped to ask you something.</p>
      </header>
      <span className="flex-1" />
      <button onClick={() => onOpen(t.id)} className={violet}><Send className="size-5" />Answer it</button>
    </>
  )
}
