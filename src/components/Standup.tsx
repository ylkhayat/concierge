import { Check, ChevronLeft, ChevronRight, Copy, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { asHtml, asText, forTeams, linkWritten, standupDay, workdayBefore, type Did, type Next, type Standup as StandupT } from '../../server/standup.ts'
import type { Written } from '../../server/store.ts'
import { ago } from '../time.ts'
import { api, param, setParam, type TicketView } from '../lib.ts'
import { IdBadge, PRIORITY } from './ExecList.tsx'

// days as YYYY-MM-DD in your own time zone: "did" counts from the start of one of them
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayOf = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d) }
const today = () => key(new Date())
// the standup to prepare (today, or Monday's on a weekend) and where it counts from (the working day before)
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const nextStandup = () => standupDay(new Date(), tz)
const lastWorkday = () => workdayBefore(nextStandup())
const dayName = (k: string) => dayOf(k).toLocaleDateString('en-GB', { weekday: 'long' })

/** What I did and what I'll do, in Linear tickets, for the standup: read it out, or copy it (for some teams) as a message. */
export function Standup({ onOpenTicket, toast, tickets = [] }: { onOpenTicket: (id: string) => void; toast: (m: string, tone?: 'ok' | 'error') => void; tickets?: TicketView[] }) {
  // the day "did" counts from: the last working day unless you pick another (in the URL)
  const [from, setFromState] = useState(() => /^\d{4}-\d\d-\d\d$/.test(param('since') ?? '') ? param('since')! : lastWorkday())
  const setFrom = (k: string) => { setFromState(k); setParam('since', k === lastWorkday() ? null : k) }
  // the teams to speak for: none picked is all of them; kept in the URL
  const [picked, setPickedState] = useState<string[]>(() => (param('teams') ?? '').split(',').filter(Boolean))
  const setPicked = (ts: string[]) => { setPickedState(ts); setParam('teams', ts.length ? ts.join(',') : null) }
  const toggle = (t: string) => setPicked(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t].sort())
  const day = nextStandup()
  const [s, setS] = useState<StandupT & { written?: Written & { stale: boolean } }>()
  const [copied, setCopied] = useState(false)
  // the written version or the facts: written when there is one (kept in the URL)
  const [view, setViewState] = useState<'written' | 'agenda'>(() => (param('view') === 'written' ? 'written' : 'agenda'))
  const setView = (v: 'written' | 'agenda') => { setViewState(v); setParam('view', v === 'agenda' ? null : v) }
  const [writing, setWriting] = useState(false)
  const read = () => api(`/standup?since=${encodeURIComponent(dayOf(from).toISOString())}&day=${day}&teams=${picked.join(',')}`).then(setS, () => {})
  useEffect(() => {
    read()
    const t = setInterval(read, 60_000)
    return () => clearInterval(t)
  }, [from, picked.join(), day]) // eslint-disable-line react-hooks/exhaustive-deps
  // the server writes the morning's standup at 07:00 in your time zone: it learns which one from here
  useEffect(() => { api('/settings', { timezone: tz }).catch(() => {}) }, [])
  const write = () => {
    setWriting(true)
    api('/standup/write', { day, since: dayOf(from).toISOString(), teams: picked }).then(() => { setView('written'); return read() }, (e: Error) => toast(e.message, 'error')).finally(() => setWriting(false))
  }
  // when work happened, for the calendar's dots: counted per day of yours
  const [busy, setBusy] = useState<Record<string, number>>({})
  useEffect(() => { api('/standup/days').then((r: { at: string[] }) => { const n: Record<string, number> = {}; for (const a of r.at) n[key(new Date(a))] = (n[key(new Date(a))] ?? 0) + 1; setBusy(n) }, () => {}) }, [])
  const teams = s ? [...new Set([...s.did, ...s.next].map((x) => x.id.split('-')[0]))].sort() : []
  const did = forTeams(s?.did ?? [], picked), next = forTeams(s?.next ?? [], picked)
  // rich text where it pastes as rich text (ticket ids as links), Markdown links where only plain text lands; the
  // written version when that is what you look at, else the facts
  const urls = Object.fromEntries([...(s?.did ?? []), ...(s?.next ?? [])].map((x) => [x.id, x.url]))
  const shown = view === 'written' && s?.written ? linkWritten(s.written.text, urls) : { md: asText(did, next), html: asHtml(did, next) }
  const copy = () => s && (typeof ClipboardItem === 'undefined' ? navigator.clipboard.writeText(shown.md)
    : navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([shown.md], { type: 'text/plain' }), 'text/html': new Blob([shown.html], { type: 'text/html' }) })])).then(() => {
    setCopied(true); toast(picked.length ? `Standup for ${picked.join(', ')} copied` : 'Standup copied'); setTimeout(() => setCopied(false), 1500)
  })
  const since = s && new Date(s.since).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
  const chip = (on: boolean) => `rounded-md px-2.5 py-1 font-medium transition-colors ${on ? 'sel text-fg-1 ' : 'text-fg-3 hover:text-fg-1'}`
  const titles = new Map([...(s?.did ?? []), ...(s?.next ?? [])].map((x) => [x.id, x.title]))
  const byId = new Map(tickets.map((t) => [t.id, t]))
  // each side by priority (urgent first, none last), then by what it is: the server already lists the plan by action
  const prio = (id: string) => byId.get(id)?.priority || 9
  const done = [...did].sort((a, b) => prio(a.id) - prio(b.id) || leadRank(a.lead) - leadRank(b.lead))
  const plan = [...next].sort((a, b) => prio(a.id) - prio(b.id))

  return (
    // the page fits the window: a long column folds, and one that still runs long scrolls on its own
    <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col px-4 pb-4 pt-6 md:px-8">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-display font-semibold tracking-tight">Standup</h1>
            <p className="text-small text-fg-3">{since ? `${day === key(new Date()) ? "Today's" : `${dayName(day)}'s`} standup: your Linear tickets since ${since}, and what is next` : 'Gathering what you did…'}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Since" className="flex rounded-xl bg-fill p-0.5 text-small">
              {([[lastWorkday(), day === today() ? 'Last workday' : `For ${dayName(day)}`], [today(), 'Today']] as const).map(([k, label]) => <button key={label} role="tab" aria-selected={from === k} onClick={() => setFrom(k)} className={chip(from === k)}>{label}</button>)}
            </div>
            <div role="tablist" aria-label="View" className="flex rounded-xl bg-fill p-0.5 text-small">
              {(['agenda', 'written'] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={chip(view === v)}>{v === 'written' ? 'Written' : 'Agenda'}</button>)}
            </div>
            <button onClick={copy} disabled={!s} title={picked.length ? `Copy the standup for ${picked.join(', ')}` : 'Copy as a message'}
                    className="inline-flex items-center gap-1.5 btn-primary transition-all hover:bg-accent disabled:opacity-40">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}Copy{picked.length > 0 && ` ${picked.join(', ')}`}
            </button>
          </div>
        </header>
        {teams.length > 1 && s && <TeamPills teams={teams} picked={picked} onToggle={toggle} onClear={() => setPicked([])} count={(t) => [...s.did, ...s.next].filter((x) => x.id.startsWith(`${t}-`)).length} />}
        {!s ? <div className="flex justify-center py-20"><LoaderCircle className="size-5 animate-spin text-fg-3" /></div> : (
          <div className="relative mt-5 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-x-8">
            {/* the day is a supporting pane: beside what you read, on the right */}
            <div className="lg:order-last"><Calendar from={from} onPick={setFrom} busy={busy} /></div>
            {view === 'written' ? <WrittenPanel w={s.written} day={day} writing={writing} onWrite={write} onOpen={onOpenTicket} titles={titles} empty={!did.length && !next.length} />
              : <Board did={done} next={plan} byId={byId} onOpen={onOpenTicket} />}
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
  answer: "Answer the agent's question", threads: `Answer ${n.count ?? ''} review thread${n.count === 1 ? '' : 's'}`.replace('  ', ' '), tend: 'Get its PR green',
  continue: 'Keep going', pickup: 'Pick it back up', start: 'Start it', review: 'Review its PR',
})[n.kind]

/** Where a ticket stands, in a word or two, and whether something holds it up. */
function statusOf(t?: TicketView): { label: string; blocked: boolean } | undefined {
  if (!t) return undefined
  const pr = t.pr
  if (t.closed) return { label: t.state, blocked: false }
  if (t.handedTo) return { label: `With ${t.handedTo.split(' ')[0]}`, blocked: false }
  if (t.bucket === 'needs-you') return { label: 'Blocked: the agent asked on Linear', blocked: true }
  if (pr?.ci === 'failure') return { label: `Blocked: CI red on #${pr.number}`, blocked: true }
  if (pr?.openThreads) return { label: `${pr.openThreads} thread${pr.openThreads === 1 ? '' : 's'} to answer`, blocked: true }
  if (t.bucket === 'shipped') return { label: 'In review', blocked: false }
  if (t.bucket === 'stalled') return { label: 'Untouched for a day', blocked: false }
  if (t.busy) return { label: 'Agent on it', blocked: false }
  return { label: t.state, blocked: false }
}

// the order of what moved, most telling first, for cards of the same priority
const LEADS = ['Merged', 'Got approval', 'Approved', 'Opened', 'Worked in the review', 'Closed', 'Reviewed', 'Progress']
const leadRank = (lead: string) => ((i) => (i < 0 ? LEADS.length - 1 : i))(LEADS.findIndex((l) => lead.startsWith(l)))

// a side quest's kind, from its labels or title: the tag on its row
const KINDS: [RegExp, string, string][] = [
  [/^bug$/i, 'Bug', 'bg-fail/10 text-fail-text'], [/^security$/i, 'Security', 'bg-wait/10 text-wait-text'],
  [/^tech debt$/i, 'Tech debt', 'bg-fg-3/10 text-fg-2'], [/^improvement$/i, 'Improvement', 'bg-run/10 text-run-text'],
]
const kindOf = (t?: TicketView, title = '') => /^user feedback/i.test(title) ? ['Feedback', 'bg-wait/10 text-wait-text'] as const
  : (t && KINDS.find(([re]) => t.labels.some((l) => re.test(l)))?.slice(1) as [string, string] | undefined)

// columns that share the width by how many there are, none narrower than this (then they wrap)

type BoardRow = { id: string; title: string; project?: string; did?: string; next?: string; rank: number }

/**
 * The standup as cards that fit the page: one per product project, in its own colour, and one for the side quests (no
 * project: bugs, tech debt, feedback), each ticket once with what moved and what comes next side by side. Product first:
 * it's what the standup is about.
 */
function Board({ did, next, byId, onOpen }: { did: Did[]; next: Next[]; byId: Map<string, TicketView>; onOpen: (id: string) => void }) {
  const rows = new Map<string, BoardRow>()
  did.forEach((d, i) => rows.set(d.id, { id: d.id, title: d.title, project: d.project, did: progressOf(d), rank: i }))
  next.forEach((n, i) => { const r = rows.get(n.id); rows.set(n.id, { ...(r ?? { id: n.id, title: n.title, project: n.project, rank: did.length + i }), next: planOf(n) }) })
  const by = new Map<string, BoardRow[]>()
  for (const r of rows.values()) by.set(r.project ?? '', [...(by.get(r.project ?? '') ?? []), r])
  const projects = [...by].filter(([p]) => p).sort((a, b) => b[1].length - a[1].length)
  const side = by.get('') ?? []
  if (!rows.size) return <p className="text-small text-fg-3">Nothing on your tickets for this standup.</p>
  // the overview first: what moved, what is next, and what is blocked, said once (not on every ticket it holds up)
  const all = [...rows.values()]
  const blocked = new Map<string, string[]>()
  for (const r of all) { const st = statusOf(byId.get(r.id)); if (st?.blocked) blocked.set(st.label, [...(blocked.get(st.label) ?? []), r.id]) }
  const nBlocked = [...blocked.values()].reduce((n, ids) => n + ids.length, 0)
  return (
    <div className="min-h-0 overflow-y-auto pb-2">
      <div className="mx-auto max-w-[920px] space-y-5">
        <p className="text-small text-fg-2"><b className="font-semibold text-fg-1">{all.filter((r) => r.did).length}</b> moved · <b className="font-semibold text-fg-1">{all.filter((r) => r.next).length}</b> next{nBlocked > 0 && <> · <b className="font-semibold text-wait-text">{nBlocked} blocked</b></>} · {projects.length} project{projects.length === 1 ? '' : 's'}{side.length > 0 && `, ${side.length} side quest${side.length === 1 ? '' : 's'}`}</p>
        {blocked.size > 0 && (
          <section className="card px-4 py-3">
            <h2 className="mb-1.5 flex items-center gap-2 text-small font-semibold text-wait-text"><span className="size-1.5 rounded-full bg-wait" />Blocked</h2>
            {[...blocked].map(([why, ids]) => (
              <div key={why} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1 text-small">
                <span className="text-fg-1">{why.replace(/^Blocked:\s*/i, '').replace(/^./, (c) => c.toUpperCase())}</span>
                <span className="flex flex-wrap gap-1">{ids.map((id) => <button key={id} onClick={() => onOpen(id)} title={byId.get(id)?.title} className="rounded bg-fill px-1.5 font-mono text-meta text-fg-2 hover:text-fg-1">{id}</button>)}</span>
              </div>
            ))}
          </section>
        )}
        {projects.map(([p, rs]) => <Theme key={p} name={p} rows={rs} byId={byId} onOpen={onOpen} />)}
        {side.length > 0 && <Theme rows={side} byId={byId} onOpen={onOpen} />}
      </div>
    </div>
  )
}

/** A project (or the side quests) as a list you read down: one aligned row per ticket, its title whole. */
function Theme({ name, rows, byId, onOpen }: { name?: string; rows: BoardRow[]; byId: Map<string, TicketView>; onOpen: (id: string) => void }) {
  const h = name ? hue(name) : 0
  const sorted = [...rows].sort((a, b) => (byId.get(a.id)?.priority || 9) - (byId.get(b.id)?.priority || 9) || a.rank - b.rank)
  const moved = rows.filter((r) => r.did).length, ahead = rows.filter((r) => r.next).length
  return (
    <section>
      <div className="mb-1 flex items-baseline gap-2 border-b border-line pb-1.5">
        {name && <span className="size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ backgroundColor: `hsl(${h} 70% 50%)` }} />}
        <h3 className="min-w-0 text-body font-semibold text-fg-1">{name ?? 'Side quests'}</h3>
        {!name && <span className="text-meta text-fg-3">bugs, tech debt and feedback outside a project</span>}
        <span className="ml-auto shrink-0 text-meta tabular-nums text-fg-3">{[moved && `${moved} moved`, ahead && `${ahead} next`].filter(Boolean).join(' · ')}</span>
      </div>
      <ul>
        {sorted.map((r) => {
          const t = byId.get(r.id), st = statusOf(t), kind = name ? undefined : kindOf(t, r.title), P = t && PRIORITY[t.priority]
          return (
            <li key={r.id}>
              <button onClick={() => onOpen(r.id)} title={st?.blocked ? st.label : undefined}
                      className="grid w-full grid-cols-[6rem_minmax(0,1fr)_minmax(0,11rem)_minmax(0,13rem)] items-baseline gap-x-3 rounded-ctl px-1.5 py-1.5 text-left transition-colors hover:bg-hover">
                <span className="flex items-center gap-1">
                  <IdBadge id={r.id} team={r.id.split('-')[0]} />
                  {P && t!.priority > 0 && <P.icon className={`size-3 shrink-0 ${P.tone}`} aria-label={P.label} />}
                </span>
                <span className="min-w-0 text-small text-fg-1">
                  {st?.blocked && <span className="mr-1.5 inline-block size-1.5 translate-y-[-1px] rounded-full bg-wait" aria-label="Blocked" />}
                  {r.title || r.id}{kind && <span className={`ml-1.5 rounded px-1.5 text-micro font-medium ${kind[1]}`}>{kind[0]}</span>}
                </span>
                <span className="min-w-0 truncate text-meta text-ok-text" title={r.did}>{r.did ? `✓ ${r.did}` : ''}</span>
                <span className="min-w-0 truncate text-meta text-accent-text" title={r.next}>{r.next ? `→ ${r.next}` : ''}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A steady hue per team, from its key: AI is always the same colour, without a table to keep. */
const hue = (team: string) => [...team].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** The teams to speak for, as pills you toggle: none picked is every team. */
function TeamPills({ teams, picked, count, onToggle, onClear }: { teams: string[]; picked: string[]; count: (t: string) => number; onToggle: (t: string) => void; onClear: () => void }) {
  return (
    <div role="group" aria-label="Teams" className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-small font-semibold text-fg-3">Teams</span>
      {teams.map((t) => {
        const on = picked.includes(t), h = hue(t)
        return (
          <button key={t} onClick={() => onToggle(t)} aria-pressed={on} title={on ? `Leave ${t} out` : `Only ${picked.length ? 'these teams' : t}`}
                  style={on ? { backgroundColor: `hsl(${h} 85% 55% / 0.12)`, boxShadow: `inset 0 0 0 1px hsl(${h} 70% 50% / 0.45)` } : undefined}
                  className={`group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-small font-medium transition-all duration-200 ${on ? 'text-fg-1 ' : 'text-fg-2 ring-1 ring-line hover:ring-line-strong'}`}>
            {on ? <Check className="size-3" style={{ color: `hsl(${h} 70% 45%)` }} /> : <span className="size-2 rounded-full" style={{ backgroundColor: `hsl(${h} 70% 55%)` }} />}
            {t}
            <span className={`tabular-nums text-micro ${on ? 'text-fg-3' : 'text-fg-3'}`}>{count(t)}</span>
          </button>
        )
      })}
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
    <section className="self-start card p-3 md:col-span-2 lg:col-span-1 ">
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
function WrittenPanel({ w, day, writing, onWrite, onOpen, titles, empty }: { w?: Written & { stale: boolean }; day: string; writing: boolean; onWrite: () => void; onOpen: (id: string) => void; titles: Map<string, string>; empty: boolean }) {
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-small font-medium transition-all disabled:opacity-40'
  return (
    <section className="min-h-0 min-w-0 overflow-y-auto card p-4 md:col-span-2 ">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-small font-semibold text-fg-3">Written</h2>
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
        <p className="mt-3 text-small text-fg-3">{empty ? 'Nothing on your tickets for this standup yet.' : `Not written yet. It's written at 07:00 on weekdays, or now with Write it. Until then, Agenda has it all.`}</p>
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
