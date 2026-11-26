// GitHub webhooks: changes arrive the moment they happen, and the minute poll becomes a safety net (index.ts doPoll).
// A listener of its own, apart from the app: its own HTTP server on 127.0.0.1 that answers ONE thing, POST
// /hooks/github, and nothing else (no app routes, no files). Tailscale Funnel (hookSetup.ts) opens only that path to
// the internet, on its own port, so the app stays tailnet-only. Every delivery must carry GitHub's signature
// (X-Hub-Signature-256, HMAC-SHA256 with a secret only Concierge and GitHub know); anything else is refused with no
// word on why, and a sender that keeps failing it is cut off for a minute. A good delivery is answered 202 at once and
// handled after: each PR it names is read again (coalesced: a burst of events is one read) through the same path a
// poll takes, so its Activity, alerts and the page update exactly as with polling. Only the control plane acts on
// them; the funnel lives there.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export const HOOK_PATH = '/hooks/github'
export const MAX_BODY = 1 << 20 // 1 MB: GitHub caps a payload at 25 MB, but nothing Concierge reads is near this
export const EVENTS = ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'issue_comment', 'check_suite', 'check_run', 'status', 'push'] as const

/** A new secret for the hooks: 32 random bytes, hex. */
export const newSecret = () => randomBytes(32).toString('hex')

/** Does `signature` (the X-Hub-Signature-256 header) sign `body` with `secret`? Constant time; a missing or malformed one is no. */
export function verify(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false
  const want = createHmac('sha256', secret).update(body).digest()
  const got = Buffer.from(signature.slice(7), 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}

export type Tracked = { id: string; repo: string; head?: string; headSha?: string; closed?: boolean }
export type Target = { id: string; requested?: boolean; mine?: boolean }
type Payload = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Which PRs a delivery is about. `requested`: a review request for you came (true) or went (false); `mine`: yours, so
 * a new one of yours joins. Check runs and statuses name their PRs, or only a commit: then the tracked PRs whose head
 * it is. A push names a branch: the tracked open PRs with that head. A comment on an issue that isn't a PR: none.
 */
export function targetsOf(event: string, p: Payload, ctx: { me?: string; tracked: Tracked[] }): { repo?: string; targets: Target[] } {
  const repo: string | undefined = p?.repository?.full_name
  if (!repo) return { targets: [] }
  const id = (n: unknown) => `${repo}#${Number(n)}`
  const ofRepo = ctx.tracked.filter((t) => t.repo === repo && !t.closed)
  const bySha = (sha?: string) => (sha ? ofRepo.filter((t) => t.headSha === sha).map((t) => t.id) : [])
  const nums = (prs: unknown) => (Array.isArray(prs) ? prs.map((x) => x?.number).filter((n) => Number.isInteger(n)).map(id) : [])
  const one = (ids: string[]): Target[] => [...new Set(ids)].map((x) => ({ id: x }))
  switch (event) {
    case 'pull_request': {
      const pr = p.pull_request
      if (!Number.isInteger(pr?.number)) return { repo, targets: [] }
      const t: Target = { id: id(pr.number) }
      const forMe = !!ctx.me && p.requested_reviewer?.login === ctx.me
      if (p.action === 'review_requested' && forMe) t.requested = true
      if (p.action === 'review_request_removed' && forMe) t.requested = false
      if (ctx.me && pr.user?.login === ctx.me) t.mine = true
      return { repo, targets: [t] }
    }
    case 'pull_request_review': case 'pull_request_review_comment': case 'pull_request_review_thread':
      return { repo, targets: Number.isInteger(p.pull_request?.number) ? [{ id: id(p.pull_request.number) }] : [] }
    case 'issue_comment':
      return { repo, targets: p.issue?.pull_request && Number.isInteger(p.issue.number) ? [{ id: id(p.issue.number) }] : [] }
    // CI: only once it settles (a run starting changes nothing Concierge shows), else a busy workflow is a read a second
    case 'check_suite': case 'check_run': {
      const c = p[event]
      if (p.action !== 'completed' || !c) return { repo, targets: [] }
      return { repo, targets: one([...nums(c.pull_requests), ...bySha(c.head_sha)]) }
    }
    case 'status':
      return { repo, targets: p.state === 'pending' ? [] : one(bySha(p.sha)) }
    case 'push': {
      const branch = typeof p.ref === 'string' && p.ref.startsWith('refs/heads/') ? p.ref.slice(11) : undefined
      return { repo, targets: one(branch ? ofRepo.filter((t) => t.head === branch).map((t) => t.id) : []) }
    }
    default: return { repo, targets: [] }
  }
}

/** Bad signatures: more than LIMIT a minute from one sender (or 4×LIMIT from everyone) and it is cut off till the minute ends. */
export function badGate(limit = 10, now = () => Date.now()) {
  let windowAt = 0, all = 0
  const by = new Map<string, number>()
  const roll = () => { if (now() - windowAt >= 60_000) { windowAt = now(); all = 0; by.clear() } }
  return {
    blocked(who: string) { roll(); return (by.get(who) ?? 0) >= limit || all >= limit * 4 },
    bad(who: string) { roll(); all++; if (by.size < 10_000) by.set(who, (by.get(who) ?? 0) + 1) },
  }
}

/**
 * Coalesce: each PR is read once a burst settles (`wait` after its last event), and not more often than every `gap`
 * (a busy PR: one read then, the rest in one more after). `run` gets the PRs due together.
 */
export function coalescer(run: (due: Target[]) => Promise<void> | void, wait = 2_000, gap = 10_000, now = () => Date.now()) {
  const pending = new Map<string, Target & { at: number }>(), lastRun = new Map<string, number>()
  let timer: NodeJS.Timeout | undefined
  const arm = () => {
    clearTimeout(timer)
    if (!pending.size) return
    const next = Math.min(...[...pending.values()].map((t) => Math.max(t.at + wait, (lastRun.get(t.id) ?? 0) + gap)))
    timer = setTimeout(flush, Math.max(0, next - now()))
    timer.unref?.()
  }
  const flush = () => {
    const t = now(), due: Target[] = []
    for (const [id, x] of pending) if (t >= Math.max(x.at + wait, (lastRun.get(id) ?? 0) + gap)) {
      pending.delete(id); lastRun.set(id, t); const { at: _at, ...rest } = x; due.push(rest)
    }
    if (lastRun.size > 5_000) for (const [id, at] of lastRun) if (t - at > gap) lastRun.delete(id)
    if (due.length) void Promise.resolve(run(due)).catch((e) => console.error('hooks: sync failed:', (e as Error).message))
    arm()
  }
  return {
    add(x: Target) {
      const was = pending.get(x.id)
      // what the newest delivery says about a review request wins; mine stays once said
      pending.set(x.id, { ...was, ...x, requested: x.requested ?? was?.requested, mine: x.mine || was?.mine, at: now() })
      arm()
    },
    flush, size: () => pending.size,
  }
}

// --- what has come in, for Settings: when, how many today, per repository ---------------------------------------------
const stats = { lastAt: 0, day: '', today: 0, total: 0, bad: 0, byRepo: new Map<string, number>() }
const LIVE_FOR = 15 * 60_000
const today = () => new Date().toLocaleDateString('en-CA')
export function noteDelivery(repo: string | undefined, now = Date.now()) {
  if (stats.day !== today()) { stats.day = today(); stats.today = 0 }
  stats.lastAt = now; stats.today++; stats.total++
  if (repo) stats.byRepo.set(repo, now)
}
export const hookStats = () => ({ lastAt: stats.lastAt || undefined, today: stats.day === today() ? stats.today : 0, total: stats.total, bad: stats.bad, byRepo: Object.fromEntries(stats.byRepo) })
/** Did this repository's hook deliver (an event, or a ping) in the last 15 minutes: does its webhook carry it now? */
export const hookLive = (repo: string, now = Date.now()) => now - (stats.byRepo.get(repo) ?? 0) < LIVE_FOR
/** For a test: forget what came in. */
export const resetStats = () => { Object.assign(stats, { lastAt: 0, day: '', today: 0, total: 0, bad: 0 }); stats.byRepo.clear() }

// --- the listener -----------------------------------------------------------------------------------------------------
export type Handler = { secret: () => string | undefined; active: () => boolean; deliver: (event: string, payload: Payload) => void }

/** The request handler, apart from the server (tests call it with a fake request). */
export function handlerFor(h: Handler, gate = badGate()) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const end = (status: number) => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'text/plain', connection: 'close' }); res.end() } }
    const path = (req.url ?? '').split('?')[0]
    if (path !== HOOK_PATH || req.method !== 'POST') { req.resume(); return end(404) }
    // through the funnel, the sender is in X-Forwarded-For; on this machine itself, the socket's
    const who = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim()
    if (gate.blocked(who)) { req.resume(); return end(429) }
    const secret = h.secret()
    if (!secret) { req.resume(); return end(404) }
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { req.destroy(); return end(413) }
    const chunks: Buffer[] = []
    let size = 0, over = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { over = true; end(413); req.destroy(); return }
      chunks.push(c)
    })
    req.on('error', () => end(400))
    req.on('end', () => {
      if (over) return
      const body = Buffer.concat(chunks)
      const sig = req.headers['x-hub-signature-256']
      if (!verify(secret, body, Array.isArray(sig) ? sig[0] : sig)) {
        gate.bad(who); stats.bad++
        if (stats.bad % 20 === 1) console.warn(`hooks: refused a delivery with a bad signature (${stats.bad} so far)`)
        return end(401)
      }
      const event = String(req.headers['x-github-event'] ?? '')
      let payload: Payload
      try { payload = JSON.parse(body.toString('utf8')) } catch { return end(400) }
      end(202) // GitHub waits 10 seconds at most: answered now, handled after
      if (!h.active()) return // a worker: the control plane handles them
      noteDelivery(payload?.repository?.full_name)
      if (event === 'ping') return
      try { h.deliver(event, payload) } catch (e) { console.error('hooks:', (e as Error).message) }
    })
  }
}

let server: Server | undefined
/** Start the listener on 127.0.0.1:`port` (once; again after it failed). */
export function listen(port: number, h: Handler): Promise<void> {
  if (server?.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = createServer(handlerFor(h))
    s.requestTimeout = 15_000; s.headersTimeout = 10_000; s.keepAliveTimeout = 1_000; s.maxHeadersCount = 50
    s.once('error', (e) => { server = undefined; console.error(`hooks: can't listen on 127.0.0.1:${port}: ${e.message}`); reject(e) })
    s.listen(port, '127.0.0.1', () => { server = s; console.log(`hooks: listening on 127.0.0.1:${port}${HOOK_PATH}`); resolve() })
  })
}
export const listening = () => !!server?.listening
