import { Check, ChevronLeft, ChevronRight, Copy, LoaderCircle, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { asHtml, asText, forTeams, linkWritten, standupDay, workdayBefore, type Blocker, type Did, type Next, type Notes, type Standup as StandupT } from '../../server/standup.ts'
import type { Written } from '../../server/store.ts'
import { ago } from '../time.ts'
import { api, param, setParam, type TicketView } from '../lib.ts'
import { IdBadge, PRIORITY } from './ExecList.tsx'
import { StandupFlow, type Lane } from './StandupFlow.tsx'
import { Pick } from '../ui/Pick.tsx'

// days as YYYY-MM-DD in your own time zone: "did" counts from the start of one of them
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayOf = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d) }
const today = () => key(new Date())
// the standup to prepare (today, or Monday's on a weekend) and where it counts from (the working day before)
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const nextStandup = () => standupDay(new Date(), tz)
const lastWorkday = () => workdayBefore(nextStandup())
const dayName = (k: string) => dayOf(k).toLocaleDateString('en-GB', { weekday: 'long' })

/**
 * The standup as it is said: what I did, what blocks me, what I'll do. Each part lists what Concierge knows (your
 * tickets since the last working day) as sentences you can read out, plus your own lines (what only you know). Copy
 * gives the same three parts as a message; the written version beside it says them in the model's words.
 */
export function Standup({ onOpenTicket, toast, tickets = [] }: { onOpenTicket: (id: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void; tickets?: TicketView[] }) {
  // the day "did" counts from: the last working day unless you pick another (in the URL)
  const [from, setFromState] = useState(() => /^\d{4}-\d\d-\d\d$/.test(param('since') ?? '') ? param('since')! : lastWorkday())
  const setFrom = (k: string) => { setFromState(k); setParam('since', k === lastWorkday() ? null : k) }
  // the teams to speak for: none picked is all of them; kept in the URL
  const [picked, setPickedState] = useState<string[]>(() => (param('teams') ?? '').split(',').filter(Boolean))
  const setPicked = (ts: string[]) => { setPickedState(ts); setParam('teams', ts.length ? ts.join(',') : null) }
  const toggle = (t: string) => setPicked(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t].sort())
  const day = nextStandup()
  const [s, setS] = useState<StandupT & { notes?: Notes; written?: Written & { stale: boolean } }>()
  const [copied, setCopied] = useState(false)
  const [writing, setWriting] = useState(false)
  const read = () => api(`/standup?since=${encodeURIComponent(dayOf(from).toISOString())}&day=${day}&teams=${picked.join(',')}`).then((x: StandupT) => setS({ ...x, blockers: x.blockers ?? [] }), () => {}) // an older server has no blockers yet
  useEffect(() => {
    read()
    const t = setInterval(read, 60_000)
    return () => clearInterval(t)
  }, [from, picked.join(), day]) // eslint-disable-line react-hooks/exhaustive-deps
  // the server writes the morning's standup at 07:00 in your time zone: it learns which one from here
  useEffect(() => { api('/settings', { timezone: tz }).catch(() => {}) }, [])
  const write = () => {
    setWriting(true)
    api('/standup/write', { day, since: dayOf(from).toISOString(), teams: picked }).then(() => read(), (e: Error) => toast(e.message, 'error')).finally(() => setWriting(false))
  }
  // your own lines, per part: saved with the day as you add or remove one
  const notes: Notes = s?.notes ?? {}
  const setNotes = (part: keyof Notes, lines: string[]) => {
    setS((x) => x && { ...x, notes: { ...x.notes, [part]: lines } })
    api('/standup/notes', { day, part, lines }).catch((e: Error) => toast(e.message, 'error'))
  }
  // when work happened, for the calendar's dots: counted per day of yours
  const [busy, setBusy] = useState<Record<string, number>>({})
  useEffect(() => { api('/standup/days').then((r: { at: string[] }) => { const n: Record<string, number> = {}; for (const a of r.at) n[key(new Date(a))] = (n[key(new Date(a))] ?? 0) + 1; setBusy(n) }, () => {}) }, [])
  const teams = s ? [...new Set([...s.did, ...s.blockers, ...s.next].map((x) => x.id.split('-')[0]))].sort() : []
  const did = forTeams(s?.did ?? [], picked), blockers = forTeams(s?.blockers ?? [], picked), next = forTeams(s?.next ?? [], picked)
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const prio = (id: string) => byId.get(id)?.priority || 9
  const done = [...did].sort((a, b) => prio(a.id) - prio(b.id) || leadRank(a.lead) - leadRank(b.lead))
  const plan = [...next].sort((a, b) => prio(a.id) - prio(b.id))
  const titles = new Map([...(s?.did ?? []), ...(s?.blockers ?? []), ...(s?.next ?? [])].map((x) => [x.id, x.title]))
  const urls = Object.fromEntries([...(s?.did ?? []), ...(s?.blockers ?? []), ...(s?.next ?? [])].map((x) => [x.id, x.url]))
  // rich text where it pastes as rich text (ticket ids as links), Markdown links where only plain text lands
  const copyOut = (md: string, html: string, what: string) => (typeof ClipboardItem === 'undefined' ? navigator.clipboard.writeText(md)
    : navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([md], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])).then(() => {
    setCopied(true); toast(what); setTimeout(() => setCopied(false), 1500)
  })
  const copy = () => s && copyOut(asText(done, plan, blockers, notes), asHtml(done, plan, blockers, notes), picked.length ? `Standup for ${picked.join(', ')} copied` : 'Standup copied')
  const copyWritten = () => s?.written && (({ md, html }) => copyOut(md, html, 'Written standup copied'))(linkWritten(s.written.text, urls))
  const since = s && new Date(s.since).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
  const empty = !did.length && !next.length && !blockers.length && !Object.values(notes).some((x) => x?.length)

  return (
    // the page fits the window: the three parts scroll on their own, the side rail stays
    <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="mx-auto flex h-full max-w-[1280px] flex-col px-4 pb-4 pt-6 md:px-8">
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <h1 className="text-display font-semibold tracking-tight">Standup</h1>
            <p className="text-small text-fg-3">{since ? `${day === key(new Date()) ? 'Today' : dayName(day)} · since ${since}` : 'Gathering what you did…'}</p>
          </div>
          <button onClick={copy} disabled={!s} title={picked.length ? `Copy the standup for ${picked.join(', ')}` : 'Copy the three parts as a message'}
                  className="ml-auto inline-flex items-center gap-1.5 btn-primary disabled:opacity-40">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}Copy{picked.length > 0 && ` ${picked.join(', ')}`}
          </button>
        </header>
        {teams.length > 1 && s && <TeamPills teams={teams} picked={picked} onToggle={toggle} onClear={() => setPicked([])} count={(t) => [...s.did, ...s.blockers, ...s.next].filter((x) => x.id.startsWith(`${t}-`)).length} />}
        {!s ? <div className="flex justify-center py-20"><LoaderCircle className="size-5 animate-spin text-fg-3" /></div> : (
          <div className="mt-5 grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-8">
            <div className="flex min-h-0 flex-col gap-3">
              <StandupFlow lanes={lanesOf(done, blockers, plan, byId)} counts={{ did: done.length + (notes.did?.length ?? 0), blockers: blockers.length + (notes.blockers?.length ?? 0), next: plan.length + (notes.next?.length ?? 0) }} onOpen={onOpenTicket} />
              <div className="grid shrink-0 gap-3 md:grid-cols-3">
                <Own title="Did" own={notes.did} onOwn={(l) => setNotes('did', l)} placeholder="Something you did (a call, a spike)" />
                <Own title="Blocked by" own={notes.blockers} onOwn={(l) => setNotes('blockers', l)} placeholder="A blocker (design, an answer, access)" />
                <Own title="Will do" own={notes.next} onOwn={(l) => setNotes('next', l)} placeholder="A plan for today" />
              </div>
            </div>
            <aside className="min-h-0 space-y-4 overflow-y-auto pb-2">
              <WrittenPanel w={s.written} day={day} writing={writing} onWrite={write} onCopy={copyWritten} onOpen={onOpenTicket} titles={titles} empty={empty} />
              <Calendar from={from} onPick={setFrom} busy={busy} />
            </aside>
          </div>
        )}
      </div>
    </main>
  )
}

// what moved on a ticket, as a few words: "Opened a pull request", "Got approval", "Progress"
const progressOf = (d: Did) => d.lead.replace(/\s+(on|for|of|to|in)$/i, '')
// what comes next on it, as a few words
const planOf = (n: Next) => ({
  answer: "Answer the agent's question", threads: `Answer ${n.count ?? ''} review thread${n.count === 1 ? '' : 's'}`.replace('  ', ' '), tend: 'Get its PR through review',
  continue: 'Keep going', pickup: 'Pick it back up', start: 'Start it', review: 'Review its PR',
})[n.kind]

// the order of what moved, most telling first, for lines of the same priority
const LEADS = ['Merged', 'Got approval', 'Approved', 'Opened', 'Worked in the review', 'Closed', 'Reviewed', 'Progress']
const leadRank = (lead: string) => ((i) => (i < 0 ? LEADS.length - 1 : i))(LEADS.findIndex((l) => lead.startsWith(l)))

/** The pipeline's lanes: one per project (most to say first), side quests last; each ticket under the stages it is in. */
/** What a ticket's hover card says: its project, where it stands, its priority, and its pull request. */
function factsOf(t?: TicketView, project?: string): [string, string][] {
  if (!t) return [['Project', project ?? 'Side quest'], ['State', 'Not on your open tickets any more']]
  const pr = t.pr
  const ci = pr?.ci === 'failure' ? 'CI red' : pr?.ci === 'success' ? 'CI green' : pr?.ci === 'pending' ? 'CI running' : ''
  return ([
    ['Project', t.project ?? 'Side quest'],
    ['State', t.handedTo ? `${t.state}, with ${t.handedTo}` : t.state],
    ['Priority', t.priority ? PRIORITY[t.priority]?.label ?? '' : ''],
    ['Pull request', pr ? [`#${pr.number}`, pr.merged ? 'merged' : '', ci, pr.openThreads ? `${pr.openThreads} open thread${pr.openThreads === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : ''],
    ['Labels', t.labels.join(', ')],
  ] as [string, string][]).filter(([, v]) => v)
}

function lanesOf(did: Did[], blockers: Blocker[], next: Next[], byId: Map<string, TicketView>): Lane[] {
  const lanes = new Map<string, Lane>()
  const lane = (p?: string) => { const k = p ?? ''; if (!lanes.has(k)) lanes.set(k, { name: p, rows: { did: [], blockers: [], next: [] } }); return lanes.get(k)! }
  for (const d of did) lane(d.project).rows.did.push({ id: d.id, title: d.title, lead: progressOf(d), review: !!d.review, facts: factsOf(byId.get(d.id), d.project) })
  for (const b of blockers) lane(b.project).rows.blockers.push({ id: b.id, title: b.title, lead: b.why, facts: factsOf(byId.get(b.id), b.project) })
  for (const n of next) lane(n.project).rows.next.push({ id: n.id, title: n.title, lead: planOf(n), review: n.kind === 'review', facts: factsOf(byId.get(n.id), n.project) })
  const size = (l: Lane) => l.rows.did.length + l.rows.blockers.length + l.rows.next.length
  return [...lanes.values()].sort((a, b) => Number(!a.name) - Number(!b.name) || size(b) - size(a))
}

/** Your own lines for one part (what only you know), and a field to add one: said in the copy and the written one. */
function Own({ title, own = [], onOwn, placeholder }: { title: string; own?: string[]; onOwn: (lines: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('')
  const add = () => { const v = draft.trim(); if (v) { onOwn([...own, v]); setDraft('') } }
  return (
    <section className="card px-3 py-2.5">
      <p className="text-meta font-semibold text-fg-3">{title}, in your words</p>
      {own.map((x, i) => (
        <p key={i} className="group mt-1 flex items-baseline gap-2 text-small text-fg-1">
          <span className="min-w-0 flex-1">{x}</span>
          <button onClick={() => onOwn(own.filter((_, j) => j !== i))} aria-label="Remove" className="shrink-0 text-fg-4 opacity-0 transition-opacity hover:text-fg-1 group-hover:opacity-100 focus:opacity-100"><X className="size-3.5" /></button>
        </p>
      ))}
      <div className="mt-1.5 flex items-center gap-2">
        <Plus className="size-3.5 shrink-0 text-fg-4" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} maxLength={300} placeholder={placeholder} aria-label={`${title}: ${placeholder}`}
               className="min-w-0 flex-1 bg-transparent text-small text-fg-1 outline-none placeholder:text-fg-4" />
      </div>
    </section>
  )
}

/** The teams to speak for, as pills you toggle: none picked is every team. */
function TeamPills({ teams, picked, count, onToggle, onClear }: { teams: string[]; picked: string[]; count: (t: string) => number; onToggle: (t: string) => void; onClear: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-small font-semibold text-fg-3">Teams</span>
      <Pick label="Teams" multi value={picked} onChange={(_, t) => onToggle(t)}
            options={teams.map((t) => ({ value: t, hint: picked.includes(t) ? `Leave ${t} out` : `Only ${picked.length ? 'these teams' : t}`,
              label: <>{t}<span className="ml-1.5 tabular-nums text-micro text-fg-3">{count(t)}</span></> }))} />
      {picked.length > 0 && <button onClick={onClear} className="ml-1 text-meta font-medium text-fg-3 transition-colors hover:text-fg-2">Clear</button>}
    </div>
  )
}

/**
 * The month, with the days "did" counts: from the picked day through today, a weekend in it shaded so a Monday's
 * standup shows it spans one. A dot is how much happened that day. Click a day to count from it.
 */
function Calendar({ from, onPick, busy }: { from: string; onPick: (k: string) => void; busy: Record<string, number> }) {
  const [month, setMonth] = useState(() => { const d = dayOf(from); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const now = today()
  const first = (month.getDay() + 6) % 7 // weeks start on Monday
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  const span = Math.round((dayOf(now).getTime() - dayOf(from).getTime()) / 86400_000) + 1
  const weekend = Array.from({ length: Math.max(0, span) }, (_, i) => { const d = dayOf(from); d.setDate(d.getDate() + i); return d.getDay() }).some((x) => x === 0 || x === 6)
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  return (
    <section className="card p-3">
      <div className="flex items-center justify-between px-1">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="rounded-md p-1 text-fg-3 hov hover:text-fg-1"><ChevronLeft className="size-4" /></button>
        <span className="text-small font-semibold">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => shift(1)} disabled={key(month) >= now.slice(0, 8) + '01'} aria-label="Next month" className="rounded-md p-1 text-fg-3 hov hover:text-fg-1 disabled:opacity-30"><ChevronRight className="size-4" /></button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-0.5 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className={`pb-1 text-micro font-semibold ${i > 4 ? 'text-fg-4' : 'text-fg-3'}`}>{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />
          const k = key(d), on = k >= from && k <= now, start = k === from, end = k === now, future = k > now
          const sat = d.getDay() === 6, sun = d.getDay() === 0, n = busy[k] ?? 0
          // the range is one band: rounded at its start and end, and at the week's edges
          const band = on ? `${start || d.getDay() === 1 ? 'rounded-l-lg' : ''} ${end || sun ? 'rounded-r-lg' : ''} ${sat || sun ? 'bg-wait/10' : 'bg-accent/10'}` : ''
          return (
            <span key={k} className={`relative py-0.5 ${band}`}>
              <button onClick={() => onPick(k)} disabled={future} title={`${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${n ? ` · ${n} thing${n === 1 ? '' : 's'} done` : ''}`}
                      className={`mx-auto flex size-7 flex-col items-center justify-center rounded-lg text-small tabular-nums transition-colors disabled:cursor-default disabled:opacity-30
                        ${start ? 'bg-accent font-semibold text-on-accent' : end ? 'font-semibold text-accent-text ring-1 ring-accent/50' : sat || sun ? 'text-fg-3 hov ' : 'text-fg-2 hov '}`}>
                {d.getDate()}
                <span className={`mt-px h-1 w-1 rounded-full ${n ? (n > 6 ? 'bg-accent' : n > 2 ? 'bg-accent/40' : 'bg-accent/40') : 'bg-transparent'} ${start ? 'bg-white/80' : ''}`} />
              </button>
            </span>
          )
        })}
      </div>
      <p className="mt-2.5 px-1 text-meta leading-snug text-fg-3">
        Since {dayOf(from).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}: {span} day{span === 1 ? '' : 's'}{weekend ? ', the weekend included' : ''}.
        {from !== lastWorkday() && <button onClick={() => onPick(lastWorkday())} className="ml-1 font-medium text-accent-text hover:underline">Last workday</button>}
      </p>
    </section>
  )
}

/**
 * The standup in the model's words: written at 07:00 on weekdays, or when you ask. It keeps the facts it was written
 * from, so when they move on (a merge, a new review) it says so and offers to write it again, instead of quietly
 * calling the model on every change.
 */
function WrittenPanel({ w, day, writing, onWrite, onCopy, onOpen, titles, empty }: { w?: Written & { stale: boolean }; day: string; writing: boolean; onWrite: () => void; onCopy: () => void; onOpen: (id: string) => void; titles: Map<string, string>; empty: boolean }) {
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-small font-medium transition-all disabled:opacity-40'
  return (
    <section className="min-w-0 card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-small font-semibold text-fg-3">In your words</h2>
        {w && <button onClick={onCopy} title="Copy this version" className="text-fg-4 transition-colors hover:text-fg-1"><Copy className="size-3.5" /></button>}
        {w && <span className="text-meta text-fg-3">{new Date(w.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {ago(w.at, Date.now())} · from {w.tickets} ticket{w.tickets === 1 ? '' : 's'}</span>}
        <button onClick={onWrite} disabled={writing || empty} title="Write it now from the facts as they are (a small model call)"
                className={`${btn} ml-auto ${w && !w.stale ? 'text-fg-2 ring-1 ring-line-strong hover:text-fg-1' : 'bg-accent text-on-accent hover:bg-accent'}`}>
          {writing ? <LoaderCircle className="size-3.5 animate-spin" /> : w ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}{w ? 'Rewrite' : 'Write it'}
        </button>
      </div>
      {w?.stale && <p className="mt-2 rounded-lg bg-wait/10 px-2.5 py-1.5 text-small text-wait-text">The facts moved on since it was written (a merge, a review, another day picked). Rewrite to bring it up to date.</p>}
      {w ? (
        <div className="mt-3 space-y-1 text-body leading-relaxed text-fg-1 ">
          {w.text.split('\n').map((line, i) => {
            const item = /^\s*[-•]\s+(.*)$/.exec(line)
            // ticket ids open here
            const body = (item ? item[1] : line).split(/(\b[A-Z]{2,5}-\d+\b)/).map((x, j) => (/^[A-Z]{2,5}-\d+$/.test(x)
              ? <TicketId key={j} id={x} title={titles.get(x)} onOpen={onOpen} /> : x))
            return item ? <p key={i} className="flex gap-2 pl-1"><span className="text-fg-4">•</span><span>{body}</span></p>
              : line.trim() ? <p key={i} className="pt-2 font-semibold first:pt-0">{body}</p> : null
          })}
        </div>
      ) : (
        <p className="mt-3 text-small text-fg-3">{empty ? 'Nothing on your tickets for this standup yet.' : `Not written yet. It's written at 07:00 on weekdays, or now with Write it. Until then, the three parts have it all.`}</p>
      )}
    </section>
  )
}

/**
 * A ticket id that opens it here, and shows its name in a card while you hover or focus it (in the top layer, so the
 * scrolling columns don't clip it).
 */
function TicketId({ id, title, onOpen }: { id: string; title?: string; onOpen: (id: string) => void }) {
  const name = '--t' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const card = useRef<HTMLSpanElement>(null)
  const show = (on: boolean) => { try { if (on) card.current?.showPopover(); else card.current?.hidePopover() } catch { /* already so */ } }
  return (
    <>
      <button onClick={() => onOpen(id)} onMouseEnter={() => show(true)} onMouseLeave={() => show(false)} onFocus={() => show(true)} onBlur={() => show(false)}
              style={{ anchorName: name } as CSSProperties} className="font-mono text-small font-semibold text-fg-1 hover:text-accent-text">{id}</button>
      {title && (
        <span ref={card} popover="manual" role="tooltip" style={{ positionAnchor: name, positionArea: 'top span-right', positionTryFallbacks: 'flip-block, flip-inline', inset: 'auto' } as CSSProperties}
              className="pointer-events-none m-0 mb-1.5 max-w-[340px] rounded-xl border-0 bg-surface-1 px-3 py-2 text-left shadow-lg ring-1 ring-line-strong">
          <span className="block font-mono text-micro font-semibold text-fg-3">{id}</span>
          <span className="block text-small font-medium leading-snug text-fg-1 ">{title}</span>
        </span>
      )}
    </>
  )
}
