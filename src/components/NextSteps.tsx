import { Check, ChevronUp, LoaderCircle, Send, Sparkles, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NextSteps as Steps } from '../../server/next.ts'
import { composeChecklist, type Step } from '../../server/reply.ts'
import { laneOf, type Lane } from '../../server/lanes.ts'
import { api } from '../lib.ts'
import { useDraft } from '../draft.ts'
import { ArmBar, ArmLabel, armedCls, useArm } from '../arm.tsx'
import { useMention, useSlash, type Command } from '../ui/Slash.tsx'
import { refresh, useApi } from '../query.ts'

/**
 * What the agent hands back, as a checklist: each next step on its own line (ticked when the agent recommends it),
 * each decision with the agent's pick selected, publishing steps marked. Untick what you don't want, pick otherwise,
 * add your own words, and one Send tells the agent all of it, including what not to do now.
 */
export function NextSteps({ nextUrl, replyUrl, version, toast, title, placeholder, isNext, inline, draft, self, others, commands, stepper, route, attach }: {
  attach?: import('../thread/Vitals.tsx').Attach // the discussions' suggestions you picked: over the box, sent with your words
  // one box for everything (the new design): you just send; then a small model reads your words with the agent's last
  // reply and routes them (laneModel.ts): an instruction to the agent, scope to Intent, a question to Understanding
  // (read-only, so a question never reaches the agent as an instruction). A line under the box says where it went, and
  // one click sends it elsewhere. `force`: the conversation is filtered to one discussion, so words go there.
  // `context`: what the agent said last, for the reading. `unsettled`: Intent still open, said beside an instruction.
  route?: { send: (lane: Exclude<Lane, 'ship'>, text: string) => Promise<unknown>; force?: Exclude<Lane, 'ship'>; context?: () => string | undefined; unsettled?: string }
  commands?: Command[] // what `/` in the box lists and runs (the new design); none: `/` is just text
  stepper?: boolean // the new design's dock: every decision and step at once, compact, answered with one Send
  self?: number; others?: number[] // this PR's number and the other open PRs': a step naming one goes to that PR's agent
  nextUrl?: string // the agent's last message to read the checklist from; none: just your words
  replyUrl: string; version: string // changes when a new run finishes, to re-read
  draft?: string // whose draft the box keeps (a PR or ticket, shared with its Steer box); else the reply URL's
  title?: string; placeholder?: string; isNext?: boolean // the page's next step: tagged like the action buttons
  inline?: boolean // always open, in the page (the Next panel), instead of a bar with a sheet
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const [picks, setPicks] = useState<Record<number, number>>({})
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  const [text, setText] = useDraft(draft ?? replyUrl)
  const box = useRef<HTMLTextAreaElement>(null)
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(false)
  const { armed, arm } = useArm()
  const slash = useSlash(commands, text, () => setText(''))
  const mention = useMention(text, setText)
  const [sentTo, setSentTo] = useState<{ lane: Lane; text: string; at: number }>() // where your last words went, to send them elsewhere
  // where your words go: Auto (read to find the lane) or one you picked, kept for this box until you change it
  const [pin, setPinState] = useState<Lane | 'auto'>(() => { try { return (localStorage.getItem('send-lane') as Lane | 'auto' | null) ?? 'auto' } catch { return 'auto' } })
  const setPin = (l: Lane | 'auto') => { setPinState(l); try { localStorage.setItem('send-lane', l) } catch { /* private window */ } }
  const [placing, setPlacing] = useState<string>() // words sent on Auto whose lane is still being found
  useEffect(() => { if (!sentTo) return; const t = setTimeout(() => setSentTo(undefined), 30_000); return () => clearTimeout(t) }, [sentTo])

  // what the agent asks, cached per run (its version): reading it takes a model call the first time, so coming back to
  // the PR or ticket shows it at once
  const q = useApi<{ steps: Steps | null }>(nextUrl ? `${nextUrl}?v=${encodeURIComponent(version)}` : undefined, { staleTime: Infinity })
  // a handover took steps away: the remembered list is forgotten everywhere (not a counter that a redraw resets), so they
  // never come back
  const forget = () => { if (nextUrl) refresh(nextUrl) }
  const steps: Steps | null | undefined = !nextUrl ? null : q.data ? q.data.steps : q.isError ? null : undefined
  const error = q.error ? (q.error as Error).message : undefined
  // the agent's own picks start chosen: you change only what you disagree with
  useEffect(() => {
    setPicks(Object.fromEntries((steps?.steps ?? []).map((x, i) => [i, x.kind === 'decide' ? (x.options ?? []).findIndex((o) => o.recommended) : -1]).filter(([, j]) => j >= 0)))
    setChecked({})
  }, [steps])
  // the box grows with what you write (up to 240px, then it scrolls), and shrinks back once it is sent
  useLayoutEffect(() => { const el = box.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight + 2, 240)}px` }, [text, steps])

  const list: Step[] = steps?.steps ?? []
  const on = (i: number) => checked[i] ?? !!list[i].checked
  const going = list.filter((x, i) => x.kind !== 'decide' && on(i))
  const publishing = going.filter((x) => x.kind === 'publish')
  const decided = list.filter((x, i) => x.kind === 'decide' && picks[i] !== undefined).length
  // a decision the agent can't go on without: nothing goes until it is answered
  const unanswered = list.filter((x, i) => x.kind === 'decide' && x.blocking && picks[i] === undefined)
  // your picks and ticks answer the agent: they go to it; words alone are read and routed once sent
  const asked = list.length ? list.map((x) => x.text + (x.options?.length ? ` (${x.options.map((o) => o.label).join(' / ')})` : '')).join('\n') : undefined
  const routing = !!route && !going.length && !decided
  const extra = attach?.count ?? 0
  const blocked = sending || (!routing && unanswered.length > 0) || (!text.trim() && !going.length && !decided && !extra)
  // where your words go: the filter's discussion; else read with the agent's last reply (a small model), else the rules
  const where = async (words: string): Promise<Lane> => {
    if (route?.force) return route.force
    const context = [route?.context?.(), asked && `It asked:\n${asked}`].filter(Boolean).join('\n\n') || undefined
    try { const r = await api('/lane', { text: words, asked: context }) as { lane: Lane; sure: number }; if (r.sure >= 0.5) return r.lane } catch { /* the rules then */ }
    return laneOf(words, list.length > 0)
  }
  // words to a lane: the agent (as a reply), or a discussion beside it
  const deliver = (lane: Lane, words: string) => (lane === 'ship' ? api(replyUrl, { text: words }) : route!.send(lane, words))
  const send = async () => {
    const words = text.trim()
    // suggestions picked over the box: their steers and your words (and the checklist, if any) go to the agent as one
    // message, and the rest of them (a question copied, a view opened) happen at once
    if (extra) {
      const said = [attach!.words(), words].filter(Boolean).join('\n\n')
      const msg = list.length ? composeChecklist(list, picks, checked, said) : said
      if (publishing.length && armed !== 'send') return arm('send', () => {})
      if (armed) arm(armed, () => {})
      setSending(true)
      try {
        if (msg) { const r = await api(replyUrl, { text: msg }) as { handedOver?: number[] }; if (r?.handedOver?.length) forget() }
        await attach!.run(); attach!.done(); setText('')
        toast(msg ? `Sent to the agent${extra > 1 ? `, with ${extra} suggestions` : ''}` : 'Done')
      } catch (e) { toast((e as Error).message, 'error') } finally { setSending(false) }
      return
    }
    if (routing && words) {
      // a lane you picked: straight there, no reading
      const fixed = route?.force ?? (pin !== 'auto' ? pin : undefined)
      if (fixed) {
        setSending(true)
        try { await deliver(fixed, words); setText(''); setSentTo({ lane: fixed, text: words, at: Date.now() }) } catch (e) { toast((e as Error).message, 'error') } finally { setSending(false) }
        return
      }
      // Auto: the box is yours again at once; where it fits is found in the background, and said when it lands
      setText(''); setSentTo(undefined); setPlacing(words)
      void (async () => {
        try { const lane = await where(words); await deliver(lane, words); setSentTo({ lane, text: words, at: Date.now() }) } catch (e) { toast((e as Error).message, 'error'); setText(words) } finally { setPlacing(undefined) }
      })()
      return
    }
    const msg = composeChecklist(list, picks, checked, text)
    if (!msg) return toast('Tick a step, pick an option or write something first', 'error')
    // a step that pushes or posts asks for a second click on Send, not an alert
    if (publishing.length && armed !== 'send') return arm('send', () => {})
    if (armed) arm(armed, () => {})
    setSending(true)
    api(replyUrl, { text: msg }).then(
      (r: { sent?: string; handedOver?: number[]; askAuthor?: number[]; passedTo?: string[] }) => { toast((r.passedTo?.length ? `${r.passedTo.join(', ')} ${r.passedTo.length === 1 ? 'is' : 'are'} in another run: it got your answer too. ` : '') + (r.handedOver?.length ? `Handed over to ${r.handedOver.map((n) => `#${n}`).join(', ')}'s agent. ` : '') + (r.askAuthor?.length ? `${r.askAuthor.map((n) => `#${n}`).join(', ')} isn't yours: the agent drafts a comment to its author instead. ` : '') + (r.handedOver?.length && !r.sent ? '' : r.sent === 'now' ? 'Sent: the agent reads it between steps' : r.sent === 'after' ? 'Sent: the agent takes it up as this turn ends' : r.sent === 'queued' ? 'Sent: it waits in the queue, and the agent reads it the moment it starts' : 'Sent to the agent')); setText(''); setPicks({}); setChecked({}); setOpen(false); if (r.handedOver?.length) forget() },
      (e: Error) => toast(e.message, 'error')).finally(() => setSending(false))
  }

  const nothing = !list.length
  // nothing to pick: the box is where you go, but focusing it must not scroll the panel past what comes first
  useEffect(() => { if (nothing) box.current?.focus({ preventScroll: true }) }, [nothing])
  const summary = steps === undefined ? 'Reading what the agent needs from you…'
    : nothing ? (error ? 'Couldn’t read the agent’s last message' : nextUrl ? 'Nothing asked' : '')
    : [going.length && `${going.length} to do`, list.some((x) => x.kind === 'decide') && `${decided}/${list.filter((x) => x.kind === 'decide').length} decided`].filter(Boolean).join(' · ')
  const sendLabel = extra ? `Send · ${extra} picked${text.trim() ? ' + your words' : ''}` : !nothing && (going.length || decided) ? `Go ahead · ${[going.length && `${going.length} step${going.length === 1 ? '' : 's'}`, decided && `${decided} decision${decided === 1 ? '' : 's'}`].filter(Boolean).join(', ')}` : 'Send'

  const peerOf = (t: string) => self !== undefined ? [...t.matchAll(/#(\d+)/g)].map((m) => Number(m[1])).find((n) => n !== self && others?.includes(n)) : undefined
  const idxs = list.map((_, i) => i)
  const groups: [string, string, number[]][] = [
    ['Decide', '', idxs.filter((i) => list[i].kind === 'decide')],
    ['Recommended', 'ticked: goes ahead', idxs.filter((i) => list[i].kind !== 'decide' && list[i].checked)],
    ['Also possible', 'tick to include', idxs.filter((i) => list[i].kind !== 'decide' && !list[i].checked)],
  ]
  const row = (x: Step, i: number) => x.kind === 'decide' ? (
                <li key={i} className="rounded-xl px-2.5 py-2 ring-1 ring-line ">
                  <div className="text-small font-medium text-fg-1 ">{x.text}
                    {x.blocking && <span className={`ml-1.5 rounded-full px-1.5 label ${picks[i] === undefined ? 'bg-wait/15 text-wait-text' : 'bg-fg-3/10 text-fg-3'}`}>needed</span>}
                  </div>
                  {x.why && <div className="text-meta text-fg-3">{x.why}</div>}
                  <div role="radiogroup" aria-label={x.text} className="mt-1.5 flex flex-wrap gap-1.5">
                    {(x.options ?? []).map((o, j) => {
                      const sel = picks[i] === j
                      return (
                        <button key={j} role="radio" aria-checked={sel} onClick={() => setPicks((p) => { const n = { ...p }; if (sel) delete n[i]; else n[i] = j; return n })}
                                className={`flex max-w-full items-center gap-1.5 rounded-xl px-3 py-1 text-left text-small font-medium transition-all ${sel ? 'bg-accent text-on-accent shadow-sm' : 'bg-surface-1 text-fg-2 ring-1 ring-line-strong hover:ring-accent'}`}>
                          {sel && <Check className="size-3.5" />}{o.label}
                          {o.recommended && <span className={`shrink-0 whitespace-nowrap rounded-full px-1.5 label ${sel ? 'bg-white/20' : 'bg-accent/10 text-accent-text'}`}>agent’s pick</span>}
                        </button>
                      )
                    })}
                  </div>
                </li>
              ) : (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-hover">
                    <input type="checkbox" checked={on(i)} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))}
                           className="mt-0.5 size-4 shrink-0 accent-accent" />
                    <span className="min-w-0 flex-1">
                      <span className={`text-small ${on(i) ? 'text-fg-1 ' : 'text-fg-3'}`}>{x.text}</span>
                      {peerOf(x.text) && <span className="ml-1.5 inline-flex items-center rounded-full bg-run/10 px-1.5 text-micro font-semibold text-run-text" title={`Sent to #${peerOf(x.text)}'s own agent, as a handover: this agent doesn't change another PR`}>→ #{peerOf(x.text)}&apos;s agent</span>}
                      {x.kind === 'publish' && <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-ok/10 px-1.5 label text-ok-text"><Upload className="size-2.5" />public</span>}
                      {x.why && <span className="block text-meta text-fg-3">{x.why}</span>}
                    </span>
                  </label>
                </li>
              )

  // everything it asks, at once: each decision with its options side by side (the agent's pick already chosen), then
  // its steps (the recommended ones ticked). Change only what you disagree with; one Send answers all of it.
  const decisions = idxs.filter((i) => list[i].kind === 'decide'), rest = idxs.filter((i) => list[i].kind !== 'decide')
  const stepperView = (
    <div className="space-y-3">
      {decisions.map((i) => {
        const x = list[i]
        return (
          <div key={i}>
            <p className="text-small font-medium text-fg-1">{x.text}
              {x.blocking && picks[i] === undefined && <span className="ml-1.5 rounded-full bg-wait/15 px-1.5 label text-wait-text">needed</span>}
              {x.why && <span className="ml-1.5 font-normal text-fg-3">{x.why}</span>}
            </p>
            <div role="radiogroup" aria-label={x.text} className="mt-1.5 flex flex-wrap gap-1.5">
              {(x.options ?? []).map((o, j) => {
                const sel = picks[i] === j
                return (
                  <button key={j} role="radio" aria-checked={sel} onClick={() => setPicks((p) => { const n = { ...p }; if (sel) delete n[i]; else n[i] = j; return n })}
                          title={o.recommended ? 'The agent’s pick' : undefined}
                          className={`flex max-w-full items-start gap-1.5 rounded-ctl px-2.5 py-1 text-left text-small transition-colors ${sel ? 'bg-accent font-medium text-on-accent' : 'bg-fill text-fg-2 hover:bg-fill-strong hover:text-fg-1'}`}>
                    {sel ? <Check className="mt-0.5 size-3.5 shrink-0" /> : o.recommended && <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-text" />}
                    <span className="min-w-0">{o.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {rest.length > 0 && <ol className={`-mx-2.5 space-y-0.5 ${decisions.length ? 'border-t border-line pt-2' : ''}`}>{rest.map((i) => row(list[i], i))}</ol>}
      {decisions.some((i) => list[i].options?.some((o) => o.recommended)) && <p className="flex items-center gap-1.5 text-micro text-fg-4"><Sparkles className="size-3 text-accent-text" />the agent’s pick, already chosen: change only what you disagree with</p>}
    </div>
  )

  return (
    <div className="relative">
      {inline && steps === undefined && <p className="flex items-center gap-2 text-small text-fg-3"><Sparkles className="size-4 animate-pulse text-accent" />Reading what the agent needs…</p>}
      {(open || inline) && steps !== undefined && (
        // the sheet opens over the content, so the tabs keep their full height while closed; inline it simply sits there
        <div className={inline ? 'space-y-3' : 'absolute inset-x-0 bottom-full z-20 mb-2 max-h-[calc(60vh/var(--z))] animate-[rise-in_200ms_var(--ease-snappy)] space-y-3 overflow-y-auto rounded-2xl bg-surface-1 p-4 shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.25)] ring-1 ring-accent/25 '}>
          {stepper && list.length > 0 ? stepperView : list.length > 0 && (
            // in the agent's order of importance: what it needs from you, what it recommends, what else it could do;
            // ticking moves nothing, so a row never jumps from under the pointer
            <div className="space-y-3">
              {groups.map(([label, hint, idx]) => !!idx.length && (
                <div key={label}>
                  <h4 className="mb-1 px-2.5 labelr text-fg-3">{label}<span className="ml-1.5 font-normal normal-case tracking-normal">{hint}</span></h4>
                  <ol className="space-y-1">{idx.map((i) => row(list[i], i))}</ol>
                </div>
              ))}
            </div>
          )}

          {/* the box: docked under the checklist; in steps, under every step, so you can steer whichever decision is on screen */}
          <div className={inline ? 'sticky bottom-0 -mx-1 space-y-2 bg-gradient-to-t from-surface-1 from-80% to-transparent px-1 pb-1 pt-3' : 'space-y-3'}>
          {attach?.chips}
          {route && !route.force && <LanePicker pin={pin} onPin={setPin} />}
          <div className="relative" style={mention.open ? mention.anchor : slash.anchor}>
          {slash.menu}{mention.menu}
          <textarea ref={box} data-composer value={text} onChange={(e) => setText(e.target.value)} rows={stepper ? 2 : 3}
                    onKeyDown={(e) => {
                      if (mention.onKeyDown(e) || slash.onKeyDown(e)) return
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!blocked) send() } }} maxLength={6000}
                    placeholder={`${nothing ? placeholder ?? 'Tell the agent what to do next…' : 'Steer: anything else, or a change of plan (optional)…'}${commands ? '  ( / for actions, @ to link a ticket or PR )' : ''}`}
                    className={`max-h-[240px] w-full resize-none rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 transition-all duration-300 placeholder:text-fg-3 focus:ring-2 ring-line hover:ring-line-strong focus:ring-accent/50`} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {steps?.source === 'read' && <span className="text-micro text-fg-3" title="The agent didn't hand back a checklist; this one was read from its message">read from its message</span>}
            {unanswered.length > 0 && <span className="text-meta text-wait-text">Answer {unanswered.map((x) => x.text).join(', ')}</span>}
            <span className="flex-1" />
            <kbd className="hidden font-sans text-micro text-fg-3 sm:inline">⌘↵</kbd>
            <button disabled={blocked} onClick={send}
                    title={unanswered.length ? `Decide ${unanswered.map((x) => x.text).join(', ')} first` : publishing.length ? `Pushes or posts: ${publishing.map((x) => x.text).join('; ')}` : undefined}
                    className={`relative inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-small font-medium text-white transition-all active:scale-[0.98] disabled:translate-y-0 disabled:bg-fill-strong disabled:text-fg-4 ${publishing.length ? 'bg-ok hover:bg-ok' : 'bg-accent hover:bg-accent'} ${armed === 'send' ? armedCls : ''}`}>
              {sending ? <LoaderCircle className="size-3.5 animate-spin" /> : publishing.length ? <Upload className="size-3.5" /> : <Send className="size-3.5" />}
              {armed === 'send' ? <ArmLabel>{`Confirm: ${publishing.length} public step${publishing.length === 1 ? '' : 's'}`}</ArmLabel> : sendLabel}
              {armed === 'send' && <ArmBar on="color" />}
            </button>
          {placing && <span className="flex min-w-0 items-center gap-1.5 text-micro text-fg-3 animate-[detail-in_200ms_var(--ease-snappy)]"><Sparkles className="size-3 shrink-0 animate-pulse text-accent" /><span className="truncate">Sent · finding where “{placing.slice(0, 60)}{placing.length > 60 ? '…' : ''}” fits best…</span></span>}
          {sentTo && route && <SentTo to={sentTo} unsettled={route.unsettled} onMove={(l) => { const t = sentTo.text; setSentTo(undefined); void deliver(l, t).then(() => setSentTo({ lane: l, text: t, at: Date.now() }), (e: Error) => toast(e.message, 'error')) }} />}
          </div>
          </div>
        </div>
      )}

      {!inline && <button onClick={() => setOpen((o) => !o)} disabled={steps === undefined} aria-expanded={open}
              className={`group/dock relative flex w-full ${isNext && !nothing && !open ? 'ring-2 !ring-accent/60' : ''} items-center gap-2 rounded-2xl px-4 py-2.5 text-left text-small ring-1 transition-all hover:shadow-md ${nothing
                ? 'bg-surface-1 text-fg-2 ring-line '
                : 'bg-accent/6 text-accent-text ring-accent/30'}`}>
        <Sparkles className={`size-4 shrink-0 text-accent ${steps === undefined || (!nothing && !open) ? 'animate-pulse' : ''}`} />
        <span className="shrink-0 font-semibold">{nothing ? title ?? 'Reply to the agent' : 'The agent is waiting on you'}</span>
        <span className="truncate text-fg-3">{summary}</span>
        <span className="flex-1" />
        {isNext && !nothing && <span className="shrink-0 rounded-full bg-accent px-1.5 text-micro font-bold uppercase leading-4 tracking-wider text-on-accent">next · answer here</span>}
        <ChevronUp className={`size-4 shrink-0 text-fg-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>}
    </div>
  )
}

/** Each lane's name and colour: the chip over the box, the box's edge, and the turns in the conversation. */
export const LANE: Record<Lane, { label: string; hint: string; cls: string; bar: string; ring: string; fill: string; text: string }> = {
  ship: { label: 'Build', hint: 'An instruction: the coding agent acts on it', cls: 'bg-accent-soft text-accent-text', bar: 'border-accent', ring: 'ring-accent/40 focus:ring-accent/60', fill: 'bg-accent text-on-accent', text: 'text-accent-text' },
  intent: { label: 'Intent', hint: 'What it is meant to do: a read-only discussion toward a decision record', cls: 'bg-wait/14 text-wait', bar: 'border-wait', ring: 'ring-wait/40 focus:ring-wait/60', fill: 'bg-wait text-white', text: 'text-wait-text' },
  understanding: { label: 'Understanding', hint: 'What it does: a read-only discussion, nothing changes', cls: 'bg-run/12 text-run', bar: 'border-run', ring: 'ring-run/40 focus:ring-run/60', fill: 'bg-run text-white', text: 'text-run-text' },
}
const LANES = Object.keys(LANE) as Lane[]
const WHERE: Record<Lane, string> = { ship: 'the agent', intent: 'Intent', understanding: 'Understanding' }

/** Where your last words went, once sent: the lane in its colour, and the other two a click away if that was wrong. */
function SentTo({ to, unsettled, onMove }: { to: { lane: Lane; text: string }; unsettled?: string; onMove: (l: Lane) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-fg-3 animate-[detail-in_200ms_var(--ease-snappy)]">
      <span className={`rounded-md px-1.5 py-0.5 font-semibold ${LANE[to.lane].cls}`}>Sent to {WHERE[to.lane]}</span>
      {to.lane === 'ship' && unsettled && <span className="text-wait" title="An instruction before the intent is agreed can build the wrong thing">{unsettled}</span>}
      <span>Not right?</span>
      {LANES.filter((l) => l !== to.lane).map((l) => (
        <button key={l} type="button" onClick={() => onMove(l)} className="rounded-md px-1.5 py-0.5 font-medium text-fg-2 ring-1 ring-line transition-colors hover:text-fg-1">Send to {WHERE[l]}</button>
      ))}
    </div>
  )
}

/**
 * Where your words go, before you send: Auto (a small model reads them with the agent's last reply, in the background:
 * the box is yours again at once) or a lane you pick, which sends them straight there. Kept until you change it.
 */
function LanePicker({ pin, onPin }: { pin: Lane | 'auto'; onPin: (l: Lane | 'auto') => void }) {
  const chip = (on: boolean, cls: string) => `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium transition-colors ${on ? cls : 'text-fg-3 ring-1 ring-line hover:text-fg-1'}`
  return (
    <div role="radiogroup" aria-label="Send to" className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-micro text-fg-4">Send to</span>
      <button type="button" role="radio" aria-checked={pin === 'auto'} onClick={() => onPin('auto')} title="Found for you from what you write (it sends at once, and says where it went)" className={chip(pin === 'auto', 'bg-fill-strong text-fg-1')}><Sparkles className="size-3" />Auto</button>
      {LANES.map((l) => <button key={l} type="button" role="radio" aria-checked={pin === l} onClick={() => onPin(l)} title={LANE[l].hint} className={chip(pin === l, LANE[l].fill)}>{LANE[l].label}</button>)}
    </div>
  )
}
