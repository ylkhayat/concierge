// Where an update stands, read off what bin/update wrote ("<date>: building …", "built; …", "running …") and the
// files it keeps while it works (its lock, the draining note), so Settings can say what is happening and what it
// waits for, instead of a button that only knows it was pressed.

export type UpdatePhase =
  | 'idle' // nothing asked, nothing going on
  | 'queued' // asked; the updater (bin/standby or cron) picks it up within a minute
  | 'building' // pulling and building the new version while this one keeps running
  | 'draining' // built; no new runs start, waiting for the running agents (30 minutes at most)
  | 'restarting' // swapping the container: the page is gone for a few seconds
  | 'updated' // the new version runs
  | 'current' // nothing new to pull
  | 'failed'
export type UpdateStatus = { phase: UpdatePhase; text: string; at?: string; sha?: string; until?: string; busy: boolean }

const ZONES: Record<string, string> = { UTC: 'GMT', CET: 'GMT+0100', CEST: 'GMT+0200', WET: 'GMT', WEST: 'GMT+0100', EET: 'GMT+0200', EEST: 'GMT+0300', BST: 'GMT+0100', EST: 'GMT-0500', EDT: 'GMT-0400', CST: 'GMT-0600', CDT: 'GMT-0500', PST: 'GMT-0800', PDT: 'GMT-0700' }
const DATED = /^(\w{3}) (\w{3}) +(\d+) ([\d:]+) (\w+) (\d{4}): (.*)$/
/** bin/update's lines with their time ("Wed Nov 11 11:07:41 UTC 2026: running 7205a0d"); others (docker's) are left out. */
export function datedLines(log: string[]): { at: number; text: string }[] {
  return log.flatMap((l) => {
    const m = DATED.exec(l.trim())
    if (!m) return []
    // older lines carry the machine's own zone (CET, CEST…), which Date.parse doesn't know: given as an offset
    const zone = ZONES[m[5]] ?? m[5]
    const at = Date.parse(`${m[2]} ${m[3]} ${m[6]} ${m[4]} ${zone}`)
    return Number.isNaN(at) ? [] : [{ at, text: m[7] }]
  })
}

const clock = (ms: number) => new Date(ms).toISOString()
const DAY = 86400_000

export function updateStatus(log: string[], o: {
  askedAt?: number // an ask this machine hasn't handled yet: when
  locked: boolean // bin/update is working now (its lock, held by a live process)
  lockedAt?: number // when it took the lock (the lock folder's time)
  drainingSince?: number // since when no new runs start (bin/update's draining note)
  running?: string // the version this server runs ("<n>-<sha>")
  agents: number // agents working now
  now?: number
}): UpdateStatus {
  const now = o.now ?? Date.now()
  if (o.askedAt) {
    const mins = Math.floor((now - o.askedAt) / 60_000)
    return { phase: 'queued', busy: true, at: clock(o.askedAt), text: mins >= 3
      ? `Asked ${mins} minutes ago and not picked up yet: the updater on this machine (bin/standby, or the cron line) isn't running`
      : 'Starting: the updater picks it up within a minute' }
  }
  const last = datedLines(log).filter((l) => !/an update is already running/.test(l.text)).at(-1)
  // taken and pulling: bin/update notes the ask as handled, then pulls (up to a minute) before its first line. Read off
  // the last line alone, that minute said the previous run's "up to date" and offered Update now again: the second
  // click people made was only that one
  const pulling: UpdateStatus = { phase: 'building', busy: true, at: o.lockedAt ? clock(o.lockedAt) : undefined, text: 'Pulling the latest Concierge: this version keeps running meanwhile.' }
  const fresh = o.locked && (!o.lockedAt || now - o.lockedAt < 15 * 60_000) // a lock its run left behind doesn't spin for hours
  if (fresh && o.lockedAt && (!last || last.at + 1000 <= o.lockedAt)) return pulling
  if (!last || now - last.at > DAY) return { phase: 'idle', busy: false, text: 'Pulls the latest Concierge and restarts it once no agent is working.' }
  const t = last.text, at = clock(last.at), running = o.running?.split('-').pop()
  let m: RegExpExecArray | null
  if ((m = /^building (\w+) (.*)$/.exec(t))) {
    return o.locked
      ? { phase: 'building', busy: true, at, sha: m[1], text: `Building ${m[1]} (“${m[2].slice(0, 80)}”): about a minute. This version keeps running meanwhile.` }
      : { phase: 'failed', busy: false, at, sha: m[1], text: `Building ${m[1]} stopped before it finished: the update log on this machine says why. Try again.` }
  }
  if (/^built; no new runs start here/.test(t)) {
    if (!o.locked) return { phase: 'failed', busy: false, at, text: 'The update stopped while it waited for the agents. Try again.' }
    const until = clock((o.drainingSince ?? last.at) + 30 * 60_000)
    return { phase: 'draining', busy: true, at, until, text: o.agents
      ? `Built. Waiting for ${o.agents} running agent${o.agents === 1 ? '' : 's'} to finish before restarting (no new ones start); it restarts anyway at ${until.slice(11, 16)} UTC.`
      : 'Built. Restarting in a moment.' }
  }
  if (/^agents still working after 30 minutes/.test(t)) return { phase: 'restarting', busy: true, at, text: 'Restarting now: the agents that were still working continue where they left off.' }
  if ((m = /^running (\w+)/.exec(t))) {
    return running && (m[1].startsWith(running) || running.startsWith(m[1]))
      ? { phase: 'updated', busy: false, at, sha: m[1], text: `Updated to ${m[1]} at ${at.slice(11, 16)} UTC.` }
      // a restart takes seconds: minutes later, a different version runs because it came another way (a later update
      // that left no line here), not because this one is still restarting
      : running && now - last.at > 5 * 60_000 ? { phase: 'updated', busy: false, at, sha: running, text: `Running ${running}.` }
      : { phase: 'restarting', busy: true, at, sha: m[1], text: `Restarting on ${m[1]}: this page reconnects by itself in a few seconds.` }
  }
  if ((m = /^up to date \((\w+)\)/.exec(t))) return { phase: 'current', busy: false, at, sha: m[1], text: `Already on the latest (${m[1]}), checked at ${at.slice(11, 16)} UTC.` }
  if (/pull failed/.test(t)) return { phase: 'failed', busy: false, at, text: `Couldn't pull the latest: ${t.replace(/^pull failed ?/, '').replace(/^\(|\)$/g, '') || 'see the update log'}.` }
  if ((m = /^built (\w+); not running here/.exec(t))) return { phase: 'current', busy: false, at, sha: m[1], text: `Built ${m[1]}; it runs here once this machine takes over.` }
  return fresh ? pulling : { phase: 'idle', busy: false, at, text: t } // a line of its own on the way (a fork's upstream, fleet/)
}
