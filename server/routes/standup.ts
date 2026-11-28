// The standup routes, out of server/index.ts: mounted on the API there.
import { method } from '../method.ts'
import { runs } from '../lifecycle.ts'
import { tmpdir } from 'node:os'
import { fleet } from '../fleet.ts'
import { factsKey, forTeams, lastWorkday, localDay, standup, startOf, workdayBefore, writeInput } from '../standup.ts'
import { callClaude } from '../explain.ts'
import { type Written, overBudget, save, state, addSpend } from '../store.ts'
import type { Hono as App } from 'hono'
import type { TicketView } from '../index.ts'

// what these routes use that lives in index.ts
type Deps = { ticketViews: () => TicketView[] }
export function standupRoutes(app: App, { ticketViews }: Deps) {
  // standup: since the start of the last working day by default (?since=ISO for another start)
  const standupFacts = async (since: Date) =>
    standup({ since, runs: await runs(Math.ceil((Date.now() - since.getTime()) / 86400_000) + 1), prs: state.prs, tickets: ticketViews(), execs: state.execs })
  const writtenKey = (day: string, teams: string[]) => `${day}|${[...teams].sort().join(',')}`
  const writing = new Map<string, Promise<Written | undefined>>()
  /** Word a day's standup with the model, from the facts as they are now (for these teams), and keep it with them. */
  function writeStandup(day: string, since: Date, teams: string[]) {
    const k = writtenKey(day, teams)
    if (writing.has(k)) return writing.get(k)!
    const p = (async () => {
      const s = await standupFacts(since)
      const did = forTeams(s.did, teams), next = forTeams(s.next, teams), blockers = forTeams(s.blockers, teams), notes = state.standupNotes?.[day] ?? {}
      if (!did.length && !next.length && !blockers.length && !Object.values(notes).some((x) => x?.length)) return undefined
      const { result, cost, provider, tokens } = await callClaude<{ text: string }>(writeInput(did, next, blockers, notes), tmpdir(), undefined, () => {},
        { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, 0.3, await method('standup', 'Keep the ticket IDs exactly as given, so they can be linked. The text field holds the update.'), 'haiku')
      addSpend(cost, provider, tokens)
      const w: Written = { day, teams, since: since.toISOString(), key: factsKey(did, next, blockers, notes), text: result.text.trim(), at: new Date().toISOString(), costUsd: cost, tickets: new Set([...did, ...next].map((x) => x.id)).size }
      // the newest 30 stay: a month of mornings
      state.standups = Object.fromEntries([...Object.entries(state.standups ?? {}), [k, w] as const].sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(-30))
      save()
      return w
    })().finally(() => writing.delete(k))
    writing.set(k, p)
    return p
  }
  // the facts, live, and the written version for that day and those teams, saying whether the facts moved since
  app.get('/standup', async (c) => {
    const q = c.req.query('since'), since = q && !isNaN(Date.parse(q)) ? new Date(q) : lastWorkday()
    const day = c.req.query('day') ?? '', teams = (c.req.query('teams') ?? '').split(',').filter(Boolean)
    const s = await standupFacts(since)
    const written = day ? state.standups?.[writtenKey(day, teams)] : undefined
    const notes = (day && state.standupNotes?.[day]) || {}
    const now = factsKey(forTeams(s.did, teams), forTeams(s.next, teams), forTeams(s.blockers, teams), notes)
    return c.json({ ...s, notes, written: written && { ...written, stale: written.key !== now || written.since !== since.toISOString() } })
  })
  // your own lines for a day's standup, per part (what only you know): kept with the day, said in the copy and the written one
  app.post('/standup/notes', async (c) => {
    const b = await c.req.json<{ day?: string; part?: string; lines?: unknown }>()
    if (!b.day || !/^\d{4}-\d\d-\d\d$/.test(b.day) || !['did', 'blockers', 'next'].includes(b.part ?? '')) return c.json({ error: 'Which day, and which part?' }, 400)
    if (!Array.isArray(b.lines) || b.lines.length > 20 || b.lines.some((x) => typeof x !== 'string' || x.length > 300)) return c.json({ error: 'Up to 20 lines of 300 characters' }, 400)
    const lines = (b.lines as string[]).map((x) => x.trim()).filter(Boolean)
    const all = { ...state.standupNotes }
    all[b.day] = { ...all[b.day], [b.part!]: lines }
    // a month of mornings, like the written ones
    state.standupNotes = Object.fromEntries(Object.entries(all).sort(([a], [z]) => a.localeCompare(z)).slice(-30))
    save()
    return c.json({ ok: true, notes: state.standupNotes[b.day] })
  })
  app.post('/standup/write', async (c) => {
    const b = await c.req.json<{ day?: string; since?: string; teams?: string[] }>()
    if (!b.day || !/^\d{4}-\d\d-\d\d$/.test(b.day) || !b.since || isNaN(Date.parse(b.since))) return c.json({ error: 'Which day, and since when?' }, 400)
    if (overBudget()) return c.json({ error: "Today's budget is spent" }, 400)
    try {
      const w = await writeStandup(b.day, new Date(b.since), (b.teams ?? []).filter((t) => /^[A-Z]{2,5}$/.test(t)))
      return w ? c.json(w) : c.json({ error: 'Nothing to write about for that day' }, 400)
    } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0].slice(0, 200) }, 502) }
  })
  // at 07:00 on a weekday (your time zone, from the page), or as soon as the machine is up after, the morning's standup
  // is written, for every team at once
  let wroteMorning = ''
  setInterval(() => {
    const tz = state.settings.timezone ?? process.env.TZ ?? 'UTC', now = new Date(), day = localDay(now, tz)
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now))
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() % 6 !== 0
    // the machine was off at 07:00: it is written when it comes up. Only a write from this morning counts as done; one
    // from before (Saturday's for Monday, written by hand) is stale by then
    const had = state.standups?.[writtenKey(day, [])]
    const fresh = had && localDay(new Date(had.at), tz) === day && Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(had.at))) >= 7
    if (!weekday || hour < 7 || wroteMorning === day || fleet.elsewhere() || overBudget() || fresh) return
    wroteMorning = day
    // a failed write (no network yet after waking, the model down) is tried again next minute
    writeStandup(day, startOf(workdayBefore(day), tz), []).catch((e) => { wroteMorning = ''; console.error('standup at 07:00:', (e as Error).message) })
  }, 60_000).unref()
  // the standup's calendar: when work happened over the last 60 days (runs that ended, PRs you opened), for its dots.
  // Times, not days: the page buckets them by its own day, which is yours, not the server's
  app.get('/standup/days', async (c) => {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString()
    const at = [...(await runs(60)).filter((r) => r.to === 'done' && (r.entity === 'job' || r.entity === 'exec')).map((r) => r.at),
      ...Object.values(state.prs).filter((p) => p.mine && p.createdAt >= since).map((p) => p.createdAt)]
    return c.json({ at })
  })
}
