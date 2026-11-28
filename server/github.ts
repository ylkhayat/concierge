import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config, save, state, type Pr, type StackRef } from './store.ts'
import { judge, settled, verdictOf } from './judge.ts'
import { Lru } from './lru.ts'
import { readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATE_DIR } from './paths.ts'
import { mine as ownFile } from './perMachine.ts'

let token = process.env.GITHUB_TOKEN ?? ''
/** The shared GitHub token changed (sharedEnv.ts): use it from the next call. */
export const tokenChanged = () => { token = process.env.GITHUB_TOKEN ?? ''; scopes = { known: false } }
async function getToken() {
  if (!token) token = (await promisify(execFile)('gh', ['auth', 'token'])).stdout.trim()
  return token
}

const etags = new Lru<string, { etag: string; body: unknown }>(3000) // whole answers, by path: one not here is fetched again
// Kept across restarts, in a file of this machine's own (a cache: never sent to another machine). Without it every
// restart (an update, a handover: dozens a day) read every PR again in full; with it GitHub answers "not changed" and
// the answer kept is used, which costs none of the hourly quota.
const ETAG_FILE = ownFile(join(STATE_DIR, 'github-cache.json'))
const KEEP_BYTES = 12 * 1024 * 1024
try { for (const [k, v] of JSON.parse(readFileSync(ETAG_FILE, 'utf8')) as [string, { etag: string; body: unknown }][]) etags.set(k, v) } catch { /* none yet, or unreadable: fetched again */ }
let etagsDirty = false
setInterval(() => {
  if (!etagsDirty) return
  etagsDirty = false
  // the ones used last, up to a size: written beside the state, then moved into place
  const out: [string, unknown][] = []; let bytes = 0
  for (const e of [...etags].reverse()) { const j = JSON.stringify(e); if ((bytes += j.length) > KEEP_BYTES) break; out.unshift(e) }
  void writeFile(`${ETAG_FILE}.tmp`, JSON.stringify(out), { mode: 0o600 }).then(() => rename(`${ETAG_FILE}.tmp`, ETAG_FILE)).catch(() => {})
}, 60_000).unref()

// GitHub's secondary limits punish bursts (many requests at once, or too many a minute), whatever the hourly quota
// says: every call to GitHub goes through one gate, a few at a time, and once GitHub says slow down nothing asks it
// again until the wait it gave (or a growing one: 1, 2, 4… up to 15 minutes) is over, or the limit only gets longer.
const AT_ONCE = 4
let running = 0
const queue: (() => void)[] = []
async function gate<T>(f: () => Promise<T>): Promise<T> {
  if (running >= AT_ONCE) await new Promise<void>((r) => queue.push(r))
  running++
  count()
  try { return await f() } finally { running--; queue.shift()?.() }
}
const cool = { until: 0, strikes: 0 }
export const slowedUntil = () => (Date.now() < cool.until ? cool.until : 0)
// search has a limit of its own (about 30 a minute for the account, your agents' gh searches included): a refused
// search pauses searching only, with its last answer kept, while everything else syncs on
const searchCool = { until: 0, strikes: 0 }
const isSearch = (path: string) => path.startsWith('/search/')
const slowNotice = () => `GitHub asked Concierge to slow down (too many requests at once): it syncs again at ${new Date(cool.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
// what Concierge asked GitHub, minute by minute, and what GitHub refused last: its secondary limit counts every client of
// the account (your agents' gh too), so this says whether Concierge's own share is what tripped it
const asked: number[] = []
let refused: { at: string; what: string; status: number; text: string } | undefined
const prune = () => { while (asked.length && Date.now() - asked[0] > 60_000) asked.shift() }
const count = () => { asked.push(Date.now()); prune() }
export const githubTraffic = () => (prune(), { lastMinute: asked.length, refused, slowedUntil: slowedUntil() || undefined })
function slowDown(retryAfter: string | null, what = '', status = 0, text = '') {
  refused = { at: new Date().toISOString(), what, status, text: text.slice(0, 200) }
  console.warn(`github: refused ${what} (${status}), ${asked.length} requests in the last minute: ${text.slice(0, 160)}`)
  const c = isSearch(what.replace(/^GET /, '')) ? searchCool : cool
  c.strikes = Math.min(c.strikes + 1, 5)
  const wait = Math.max(Number(retryAfter) * 1000 || 0, Math.min(15 * 60_000, 60_000 * 2 ** (c.strikes - 1)))
  c.until = Date.now() + wait
  console.warn(`github: secondary rate limit, waiting ${Math.round(wait / 1000)}s`)
}
const secondary = (status: number, text: string, retryAfter: string | null) => (status === 403 || status === 429) && (/secondary rate limit|abuse/i.test(text) || !!retryAfter)

// REST's own hourly quota (GraphQL keeps ghBudget): read from every response. Spent, calls fail at once until it
// resets instead of asking GitHub again, which would keep it spent.
const rest = { remaining: Infinity, resetAt: 0 }
export const restBudget = () => ({ ...rest })

// What the token may do, as GitHub says on every REST answer (x-oauth-scopes): only a classic token or an OAuth one
// (gh's sign-in) says it. A fine-grained token or an app's says nothing: undefined then, known: false.
let scopes: { list?: string[]; known: boolean } = { known: false }
function noteScopes(h: Headers) {
  const v = h.get('x-oauth-scopes')
  if (v !== null) scopes = { known: true, list: v.split(',').map((x) => x.trim()).filter(Boolean) } // a new token: tokenChanged forgets the old
}
/** The token's scopes as GitHub last reported them, or undefined when it doesn't report any (a fine-grained token). */
export const tokenScopes = (): string[] | undefined => (scopes.known ? scopes.list : undefined)
/** Read the scopes again now (after a new sign-in): /rate_limit costs no quota. */
export async function readScopes(): Promise<string[] | undefined> {
  scopes = { known: false }
  const res = await fetch('https://api.github.com/rate_limit', { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  if (res) noteScopes(res.headers)
  return tokenScopes()
}

/** A REST call that keeps GitHub's status (the webhook setup tells "no admin" from "no scope"), through the same gate. */
export async function ghCall<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; json: T & { message?: string } }> {
  if (slowedUntil()) throw new Error(slowNotice())
  const res = await gate(async () => fetch(`https://api.github.com${path}`, {
    method, ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    signal: AbortSignal.timeout(20_000),
  }))
  noteScopes(res.headers)
  const text = await res.text()
  if (!res.ok && secondary(res.status, text, res.headers.get('retry-after'))) { slowDown(res.headers.get('retry-after'), `${method} ${path}`, res.status, text); throw new Error(slowNotice()) }
  let json = {} as T & { message?: string }
  try { if (text) json = JSON.parse(text) } catch { /* a 204, or not JSON */ }
  return { status: res.status, json }
}

// GET with ETag caching: a 304 costs no rate limit and returns the cached body.
/**
 * Whether a PR a run's words link to is the run's own: open, and opened since the run began or on a branch named for one
 * of its tickets. A run links to other PRs while it investigates (an old revert, a related fix); those are never its own.
 */
export async function runOwns(run: { ids: string[]; startedAt?: string; queuedAt: string }, p: { repo: string; number: number }): Promise<boolean> {
  try {
    const r = await gh<{ state: string; created_at: string; head: { ref: string } }>(`/repos/${p.repo}/pulls/${p.number}`)
    if (r.state !== 'open') return false
    const ref = r.head.ref.toLowerCase()
    return Date.parse(r.created_at) >= Date.parse(run.startedAt ?? run.queuedAt) - 60_000 || run.ids.some((id) => ref.includes(id.toLowerCase()))
  } catch { return false } // can't tell: not claimed (a missed link shows up again once the PR is tracked)
}

export async function gh<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
  const cached = etags.get(path)
  if (rest.remaining <= 0 && Date.now() < rest.resetAt) {
    if (cached) return cached.body as T // what it said last is better than nothing
    throw new Error(`GitHub REST quota spent: resets at ${new Date(rest.resetAt).toISOString().slice(11, 16)} UTC`)
  }
  if (slowedUntil() || (isSearch(path) && Date.now() < searchCool.until)) {
    if (cached) return cached.body as T
    throw new Error(isSearch(path) && !slowedUntil() ? `GitHub's search is paused until ${new Date(searchCool.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (too many searches)` : slowNotice())
  }
  const res = await gate(async () => fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(cached && { 'If-None-Match': cached.etag }),
    },
    signal: AbortSignal.timeout(30_000), // a call GitHub never answers must not hold the gate's place forever
  }))
  noteScopes(res.headers)
  const left = Number(res.headers.get('x-ratelimit-remaining')), reset = Number(res.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(left) && Number.isFinite(reset) && reset > 0) Object.assign(rest, { remaining: left, resetAt: reset * 1000 })
  if ((res.status === 403 || res.status === 429) && (left === 0 || res.headers.get('retry-after'))) {
    Object.assign(rest, { remaining: 0, resetAt: reset ? reset * 1000 : Date.now() + Number(res.headers.get('retry-after') ?? 60) * 1000 })
  }
  if (res.status === 304 && cached) { (isSearch(path) ? searchCool : cool).strikes = 0; return cached.body as T }
  if (res.status === 401) token = '' // re-read gh's token next time
  if (!res.ok) {
    const text = await res.text()
    if (secondary(res.status, text, res.headers.get('retry-after'))) {
      slowDown(res.headers.get('retry-after'), `GET ${path}`, res.status, text)
      if (cached) return cached.body as T
      throw new Error(isSearch(path) ? `GitHub's search is paused until ${new Date(searchCool.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (too many searches)` : slowNotice())
    }
    throw new Error(`GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`)
  }
  ;(isSearch(path) ? searchCool : cool).strikes = 0
  const body = await res.json()
  const etag = res.headers.get('etag')
  if (etag) { etags.set(path, { etag, body }); etagsDirty = true }
  return body as T
}

export type Me = {
  login: string; name: string | null; avatar: string; machine?: string; reach?: { from: string; to: string }
  // who opens the page and from where: this machine itself, or a device on your tailnet through the link (as Tailscale names it)
  viewer?: { here: boolean; device?: string; os?: string; ip?: string; login?: string }
  // the machine answering: its role in the fleet, the build it runs, and whether it holds the lease (saves, runs agents)
  serving?: { role?: string; version?: string; control: boolean }
}
let me: Me | undefined
// who you are, kept: a restart while GitHub refuses (its quota spent, offline) still knows you
export async function getMe(): Promise<Me> {
  if (!me) {
    try {
      const u = await gh<{ login: string; name: string | null; avatar_url: string }>('/user')
      me = { login: u.login, name: u.name, avatar: u.avatar_url }
      if (state.me?.login !== me.login || state.me.avatar !== me.avatar || state.me.name !== me.name) { state.me = me; save() }
    } catch (e) {
      if (!state.me) throw e
      return state.me
    }
  }
  return me
}

type SearchItem = { number: number; repository_url: string }
type PullJson = {
  number: number; title: string; body: string | null; body_html?: string; html_url: string; draft: boolean
  state: string; merged_at: string | null; closed_at?: string | null; created_at: string; updated_at: string
  user: { login: string; avatar_url: string }
  base: { ref: string }; head: { ref: string; sha: string }
  additions: number; deletions: number; changed_files: number
}
type ReviewJson = { id: number; user: { login: string } | null; state: string; commit_id: string; submitted_at: string }

/**
 * A PR's fresh fields from GitHub, written onto the PR object already in state, never a new one: a request handler
 * that holds a PR across an await (reading its body, then setting its job) would otherwise write to an orphan.
 */
function upsertPr(id: string, fields: Partial<Pr> & Pick<Pr, 'id' | 'repo' | 'number'>) {
  return state.prs[id] ? Object.assign(state.prs[id], fields) : (state.prs[id] = fields as Pr)
}

async function refreshPr(repo: string, number: number, requested: boolean, login: string) {
  const id = `${repo}#${number}`
  const [p, reviews] = await Promise.all([
    // full+json adds body_html: GitHub-rendered, GitHub-sanitized markdown
    gh<PullJson>(`/repos/${repo}/pulls/${number}`, 'application/vnd.github.full+json'),
    gh<ReviewJson[]>(`/repos/${repo}/pulls/${number}/reviews?per_page=100`),
  ])
  const mine = reviews.filter((r) => r.user?.login === login && r.state !== 'PENDING').at(-1)
  const prev = state.prs[id] && { ...state.prs[id] }
  upsertPr(id, {
    id, repo, number,
    title: p.title,
    body: p.body ?? '',
    bodyHtml: p.body_html ?? '',
    url: p.html_url,
    author: { login: p.user.login, avatar: p.user.avatar_url },
    draft: p.draft,
    base: p.base.ref,
    head: p.head.ref,
    headSha: p.head.sha,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changed_files,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString(),
    requested,
    closed: p.state !== 'open',
    ...(p.state !== 'open' && { closedAt: prev?.closedAt ?? p.closed_at ?? new Date().toISOString(), merged: !!p.merged_at }),
    // a fresh request on a dismissed PR brings it back
    dismissed: (prev?.dismissed ?? false) && !(requested && !prev?.requested),
    myReview: mine && { state: mine.state, commitId: mine.commit_id, submittedAt: mine.submitted_at },
  })
  const next = state.prs[id]
  if (prev && prev.headSha !== next.headSha) dropStaleNext(next)
  const pusher = prev && prev.headSha !== next.headSha ? await pusherOf(repo, next.headSha) : undefined
  const seen = reviews.filter((r) => r.state !== 'PENDING').map((r) => ({ id: String(r.id), who: r.user?.login, state: r.state, at: r.submitted_at }))
  for (const e of changesOf(prev, next, login, { pusher, reviews: seen })) outside.push({ id, ...e })
  next.seenReviews = seen.map((r) => r.id)
}

/**
 * The PR moved on (a rebase, a push by you or another agent) after its last run ended: that run's suggested next steps
 * were for the code it left, so they go. Kept under the same message hash, so they aren't read again from it.
 * ponytail: a head seen within 2 minutes of the end is taken as the run's own push (the poll is a minute); a rebase
 * that quick keeps the old steps. Record the head at the run's end if that matters.
 */
export function dropStaleNext(p: Pr, now = Date.now()) {
  const j = p.job
  if (!j?.next || j.state !== 'done' || !j.endedAt || now - Date.parse(j.endedAt) < 120_000) return
  j.next = { ...j.next, steps: [], decisions: [], actions: [] }
}

type MineNode = {
  number: number; title: string; body: string; bodyHTML: string; url: string; isDraft: boolean
  createdAt: string; updatedAt: string; baseRefName: string; headRefName: string; headRefOid: string
  additions: number; deletions: number; changedFiles: number; reviewDecision: string | null
  author: { login: string; avatarUrl: string }; repository: { nameWithOwner: string }
  reviewThreads: { nodes: { isResolved: boolean; first: { nodes: { author: { login: string } | null }[] }; comments: { nodes: { id?: string; author: { login: string } | null; body: string; createdAt?: string }[] } }[] }
  reviews: { nodes: { databaseId: number; state: string; submittedAt?: string; body?: string; author: { __typename?: string; login: string } | null }[] }
  comments: { nodes: { id?: string; author: { __typename: string; login: string } | null; body: string; createdAt?: string }[] }
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] }
}

/** A write to GitHub's REST API (create an issue, a milestone, a sub-issue link): its answer, or what GitHub said. */
export async function ghSend<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method, body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  const json = await res.json().catch(() => ({})) as T & { message?: string }
  if (!res.ok) throw new Error(`GitHub: ${json.message ?? res.status}`)
  return json
}

/** GitHub's GraphQL budget as of the last poll (5000 points an hour, shared with your own `gh`). */
export const ghBudget: { remaining?: number; resetAt?: string } = {}
export async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (slowedUntil()) throw new Error(slowNotice())
  const res = await gate(async () => fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(45_000),
  }))
  const json = await res.json().catch(() => ({})) as { data?: T & { rateLimit?: { remaining: number; resetAt: string } }; errors?: { message: string }[] }
  if (!json.data) {
    const msg = json.errors?.[0]?.message ?? (json as { message?: string }).message ?? String(res.status)
    if (secondary(res.status, msg, res.headers.get('retry-after')) || /secondary rate limit/i.test(msg)) { slowDown(res.headers.get('retry-after'), `GraphQL ${query.match(/^\s*(?:query|mutation)?\s*(?:\([^)]*\))?\s*\{\s*(?:rateLimit\{[^}]*\}\s*)?(\w+)/)?.[1] ?? 'query'}`, res.status, msg); throw new Error(slowNotice()) }
    // refused for rate: GitHub's hourly counter can still read high (another limit on the account), so treat it as empty
    if (/rate limit/i.test(msg)) Object.assign(ghBudget, { remaining: 0, resetAt: new Date(Date.now() + 15 * 60_000).toISOString() })
    throw new Error(`GitHub GraphQL: ${msg}`)
  }
  if (json.data.rateLimit) Object.assign(ghBudget, json.data.rateLimit)
  return json.data
}

const MINE_FIELDS = `number title body bodyHTML url isDraft createdAt updatedAt baseRefName headRefName headRefOid
  additions deletions changedFiles reviewDecision author{login avatarUrl} repository{nameWithOwner}
  reviewThreads(first:100){nodes{isResolved first: comments(first:1){nodes{author{login}}} comments(last:1){nodes{id author{login} body createdAt}}}}
  reviewRequests(first:20){nodes{requestedReviewer{... on User{login}}}}
  reviews(last:30){nodes{databaseId state submittedAt body author{__typename login}}}
  comments(last:20){nodes{id author{__typename login} body createdAt}}`
let mineFullAt = 0
// your PRs to read in full on the next sync whatever their updatedAt: replying in a review thread doesn't move it,
// so after the agent pushes or replies the thread counts would otherwise stay stale until the 10-minute full read
const forceMine = new Set<string>()
const FULL_EVERY = 10 * 60_000 // a resolved thread doesn't move a PR's updatedAt: re-read everything this often
const fullDue = (at: number, now = Date.now()) => now - at > FULL_EVERY - 30_000 // a minute tick a few ms early still counts

/**
 * Your own open PRs on the configured repos, with their unresolved thread counts (the /revise picker's filter).
 * Two steps, to stay light on GitHub's budget: a cheap list (about 1 point) every poll, then the full details
 * (threads, reviews: tens of points) only for PRs that changed since the last poll, and for all of them every 10 minutes.
 */
async function pollMine(skip?: (repo: string) => boolean): Promise<string[]> {
  const repos = Object.keys(config.repos).map((r) => `repo:${r}`).join(' ')
  const list = await graphql<{ search: { nodes: { id: string; number: number; updatedAt: string; repository: { nameWithOwner: string } }[] } }>(
    `query($q:String!){ rateLimit{remaining resetAt} search(query:$q, type:ISSUE, first:50){ nodes{ ... on PullRequest { id number updatedAt repository{nameWithOwner} } } } }`,
    { q: `is:pr is:open author:@me archived:false ${repos}` })
  // a light sync (webhooks deliver the hooked repos: poll's comment) reads none of theirs, and none in full
  const full = !skip && fullDue(mineFullAt)
  const stale = list.search.nodes.filter((n) => { const id = `${n.repository.nameWithOwner}#${n.number}`; return forceMine.has(id) || (!skip?.(n.repository.nameWithOwner) && (full || state.prs[id]?.updatedAt !== n.updatedAt)) })
  forceMine.clear() // every one named is in stale, light sync or not
  const nodes: MineNode[] = []
  for (let k = 0; k < stale.length; k += 20) {
    const { nodes: got } = await graphql<{ nodes: MineNode[] }>(`query($ids:[ID!]!){ rateLimit{remaining resetAt} nodes(ids:$ids){ ... on PullRequest { ${MINE_FIELDS} } } }`, { ids: stale.slice(k, k + 20).map((n) => n.id) })
    nodes.push(...got.filter(Boolean))
  }
  if (full) mineFullAt = Date.now()
  const json = { data: { search: { nodes } } }
  const stillOpen = new Set(list.search.nodes.map((n) => `${n.repository.nameWithOwner}#${n.number}`))

  const moreFeedback: string[] = []
  for (const n of json.data.search.nodes) {
    const repo = n.repository.nameWithOwner
    const id = `${repo}#${n.number}`
    const prev = state.prs[id] && { ...state.prs[id] }
    const open_ = n.reviewThreads.nodes.filter((t) => !t.isResolved)
    const unresolved = open_.length
    // your turn: an open thread whose last word is someone else's and isn't them closing it ("fixed", LGTM);
    // one you answered, or one they signed off on, waits on the reviewer to resolve
    // PR-level comments since your last one count the same way (a question on the PR, not on a line); bots don't
    const talk = n.comments.nodes, mineAt = talk.map((c) => c.author?.login).lastIndexOf(n.author.login)
    const human = (c: { author: { login: string; __typename?: string } | null }) => !!c.author && c.author.__typename !== 'Bot' && !/\[bot\]$/i.test(c.author.login)
    // what someone else said last, on each open thread and on the PR since your last word there: judged by meaning,
    // once each (judge.ts), before anything is counted from it
    const lastWords = [...open_.map((t) => t.comments.nodes[0]), ...talk.slice(mineAt + 1)].filter((c) => c && c.id && human(c) && c.author!.login !== n.author.login)
    await judge(lastWords.map((c) => ({ id: c!.id!, body: c!.body ?? '' })))
    const said = talk.slice(mineAt + 1).filter((c) => human(c) && waitsOnYou(c, n.author.login))
    const reviewed = bodyReviews(n.reviews.nodes, mineAt >= 0 ? talk[mineAt].createdAt ?? '' : '', n.author.login)
    // what the agent already read: a push of yours that started after it and ended with nothing left to do (it found
    // nothing to answer: a status note, "holding approval until…"). Only what came after that waits on you
    const seen = prev?.readAt, fresh = (at?: string) => !seen || !at || at > seen // review bodies only: comments go by verdict and id
    // a thread waits on you while its last word is someone else's: an answer would be the last word there, so a run
    // that read past it (and answered other threads) doesn't settle it. Only PR-level comments and review bodies, which
    // have no place to answer in, count as read once a run went past them
    const waitingOn = [...open_.map((t) => t.comments.nodes[0]).filter((c) => waitsOnYou(c, n.author.login)), ...said]
    const awaiting = waitingOn.length + reviewed.filter((r) => fresh(r.submittedAt ?? undefined)).length
    const was = prev?.awaiting ?? prev?.unresolved ?? 0
    if (prev && awaiting > was) moreFeedback.push(id)
    // feedback newer than the last revise round: stamped when threads start (or grow) waiting on you
    const feedbackAt = awaiting > was ? new Date().toISOString() : awaiting ? prev?.feedbackAt : undefined
    upsertPr(id, {
      id, repo, number: n.number, title: n.title, body: n.body, bodyHtml: n.bodyHTML, url: n.url,
      author: { login: n.author.login, avatar: n.author.avatarUrl }, draft: n.isDraft,
      base: n.baseRefName, head: n.headRefName, headSha: n.headRefOid,
      additions: n.additions, deletions: n.deletions, changedFiles: n.changedFiles,
      createdAt: n.createdAt, updatedAt: n.updatedAt, firstSeenAt: prev?.firstSeenAt ?? new Date().toISOString(),
      requested: false, closed: false, dismissed: prev?.dismissed ?? false,
      mine: true, unresolved, awaiting, feedbackAt, reviewDecision: n.reviewDecision,
      waitingIds: waitingOn.map((c) => c?.id).filter((x): x is string => !!x),
    })
    const commenters = [...new Set([...open_.map((t) => t.comments.nodes[0]?.author?.login), ...said.map((c) => c.author?.login)].filter((l): l is string => !!l && l !== n.author.login))]
    if (prev && prev.headSha !== n.headRefOid) dropStaleNext(state.prs[id])
    const pusher = prev && prev.headSha !== n.headRefOid ? await pusherOf(repo, n.headRefOid) : undefined
    // the numeric id, as the REST refresh records it: one name per review, or each path would announce it again
    const reviews = n.reviews.nodes.filter((r) => r.state !== 'PENDING').map((r) => ({ id: String(r.databaseId), who: r.author?.login, state: r.state, at: r.submittedAt }))
    for (const e of changesOf(prev, state.prs[id], n.author.login, { pusher, commenters, reviews })) outside.push({ id, ...e })
    state.prs[id].seenReviews = reviews.map((r) => r.id)
    // every new comment by someone else, whether or not it waits on you (a thank-you, a note, a question on the PR):
    // who and the start of it, once each. The first sight only notes where things stand
    const heard = [...open_.map((t) => ({ c: t.comments.nodes[0], where: 'replied on a thread' })), ...talk.map((c) => ({ c, where: 'commented' }))]
      .filter(({ c }) => c?.createdAt && c.author?.login && c.author.login !== n.author.login && (c.author as { __typename?: string }).__typename !== 'Bot' && !/\[bot\]$/i.test(c.author.login))
    const newest = heard.reduce<string | undefined>((a, { c }) => (!a || c!.createdAt! > a ? c!.createdAt! : a), prev?.heardAt)
    if (prev?.heardAt) for (const { c, where } of heard.filter(({ c }) => c!.createdAt! > prev.heardAt!).sort((a, b) => a.c!.createdAt!.localeCompare(b.c!.createdAt!))) {
      const said = (c!.body ?? '').replace(/\[!\[Generated by[^\]]*\]\([^)]*\)\]\([^)]*\)/gi, '').replace(/\s+/g, ' ').trim()
      outside.push({ id, who: c!.author!.login, at: c!.createdAt, info: true, text: `${where}: “${said.length > 140 ? `${said.slice(0, 137)}…` : said}”` })
    }
    state.prs[id].heardAt = newest
    // whoever started a thread, asked for changes, or wrote a review with comments in its body: once answered, theirs to look again
    const askers = [...open_.map((t) => t.first.nodes[0]?.author?.login), ...reviews.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.who),
      ...n.reviews.nodes.filter((r) => r.state === 'COMMENTED' && r.body?.trim()).map((r) => r.author?.login)]
    // already asked again (a review request is pending), or approved since (their latest verdict, comments aside):
    // nothing more to ask of them
    const pending = new Set(n.reviewRequests.nodes.map((r) => r.requestedReviewer?.login).filter(Boolean))
    const approved = approvedNow(reviews)
    state.prs[id].verdicts = verdictsOf(reviews, pending as Set<string>, n.author.login)
    state.prs[id].reviewers = [...new Set(askers.filter((l): l is string => !!l && l !== n.author.login && !pending.has(l) && !approved.has(l) && !/\[bot\]$|bot$/i.test(l)))]
  }
  // gone from the open search: merged or closed
  for (const p of Object.values(state.prs)) if (p.mine && !stillOpen.has(p.id) && !p.closed) { p.closed = true; p.closedAt ??= new Date().toISOString() }
  return moreFeedback
}

type Verdict = NonNullable<import('./store.ts').Pr['verdicts']>[number]
/** Each reviewer's latest word (a verdict outranks a later plain comment), a pending request over an older verdict; no bots. */
export function verdictsOf(reviews: { who?: string; state: string }[], pending: Set<string>, author: string): Verdict[] {
  const latest = new Map<string, Verdict['state']>()
  for (const r of reviews) {
    if (!r.who || r.who === author || /\[bot\]$|bot$/i.test(r.who)) continue
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') latest.set(r.who, r.state)
    else if (r.state === 'DISMISSED') latest.delete(r.who)
    else if (r.state === 'COMMENTED' && !latest.has(r.who)) latest.set(r.who, 'COMMENTED')
  }
  for (const who of pending) if (who !== author) latest.set(who, 'REQUESTED')
  const rank = { CHANGES_REQUESTED: 0, REQUESTED: 1, COMMENTED: 2, APPROVED: 3 }
  return [...latest].map(([who, state]) => ({ who, state })).sort((a, b) => rank[a.state] - rank[b.state])
}

/** Who approved, by their latest verdict (oldest review first; a comment alone changes nothing). */
export function approvedNow(reviews: { who?: string; state: string }[]): Set<string> {
  const latest = new Map<string, string>()
  for (const r of reviews) if (r.who && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED')) latest.set(r.who, r.state)
  return new Set([...latest].filter(([, st]) => st === 'APPROVED').map(([who]) => who))
}

/** Sync tracked PRs with GitHub. Returns ids that newly entered review-requested, and own PRs with new feedback. */
/**
 * Is an open thread's last comment your turn? Not when it is yours, and not when the reviewer closes it: a verdict
 * badge from the review-exchange vocabulary (fixed, already fixed, won't fix) or a withdrawn point, a plain sign-off (LGTM, looks good), or
 * an acknowledgement ("Confirmed in bb87487: …", "Agreed, that's a fair trade…") that asks nothing: no question mark,
 * no new finding. Closing it is the reviewer's (review-exchange: the reviewer resolves). Anything else is your turn.
 */
/**
 * Reviews whose feedback is only in their own text (no line threads) wait on you too: each reviewer's latest review,
 * if it says something, isn't an approval, and nothing of yours came after it (a PR comment, or a thread reply, which
 * GitHub files as a review of yours). A later review by the same person (an approval) replaces it.
 */
export function bodyReviews(reviews: MineNode['reviews']['nodes'], lastComment: string, me: string) {
  const after = [lastComment, ...reviews.filter((r) => r.author?.login === me).map((r) => r.submittedAt ?? '')].reduce((a, b) => (b > a ? b : a), '')
  const latest = new Map<string, MineNode['reviews']['nodes'][number]>()
  for (const r of reviews) if (r.author && r.author.login !== me && r.state !== 'PENDING' && r.state !== 'DISMISSED') latest.set(r.author.login, r)
  return [...latest.values()].filter((r) => (r.state === 'COMMENTED' || r.state === 'CHANGES_REQUESTED') && (r.submittedAt ?? '') > after
    && r.author?.__typename !== 'Bot' && !/\[bot\]$/i.test(r.author?.login ?? '') && !!r.body?.trim() && waitsOnYou(r, me))
}


/**
 * Does someone's comment wait on you? Facts, not phrases: yours or nobody's, no; the review skills' own verdict badges
 * (![fixed], ![won't fix]: a fixed protocol), no; marked as needing no answer, no; else its verdict by meaning (judge.ts),
 * and a comment not judged (yet, or the judging failed) waits: nothing is hidden by a guess.
 */
export function waitsOnYou(last: { id?: string; author: { login: string } | null; body?: string } | undefined, me: string): boolean {
  if (!last || !last.author || last.author.login === me) return false
  if (/(^|\n)\s*!\[(fixed|already fixed|won't fix|withdrawn)\]/i.test(last.body ?? '')) return false
  if (last.id && settled(last.id)) return false
  return !last.id || verdictOf(last.id) !== false
}

/** What happened to a PR from outside since the last sync: someone else's push, comments waiting on you, a new verdict. */
export function changesOf(prev: Pr | undefined, next: Pr, me: string, ctx: { pusher?: string; commenters?: string[]; reviews?: { id: string; who?: string; state: string; at?: string }[] } = {}): { text: string; who?: string; at?: string }[] {
  if (!prev) return []
  const out: { text: string; who?: string; at?: string }[] = []
  if (prev.headSha && prev.headSha !== next.headSha && ctx.pusher !== me) out.push({ who: ctx.pusher, text: `pushed ${next.headSha.slice(0, 7)}` })
  const was = prev.awaiting ?? prev.unresolved ?? 0, now = next.awaiting ?? next.unresolved ?? 0
  if (next.mine && now > was) out.push({ who: ctx.commenters?.join(', '), text: `left ${now - was} new comment${now - was === 1 ? '' : 's'} waiting on you` })
  // each new review by someone else, with who and what (the first sight only records what is there)
  const VERB: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'reviewed with comments' }
  // a list in the old GraphQL-id format can't be compared: this round records what is there without announcing it
  if (prev.seenReviews && !prev.seenReviews.some((x) => x.startsWith('PRR_'))) for (const r of ctx.reviews ?? []) if (r.who !== me && VERB[r.state] && !prev.seenReviews.includes(r.id)) out.push({ who: r.who, text: VERB[r.state], ...(r.at && { at: r.at }) }) // when it was submitted, not when we noticed
  // a PR you already reviewed asks for you again
  if (!next.mine && !prev.requested && next.requested && prev.myReview) out.push({ text: 'asked for your review again' })
  if (!prev.closed && next.closed) out.push({ text: 'merged or closed the PR' })
  return out
}
/** Outside events found by the last sync, for the server to put in each PR's Activity. */
export const outside: { id: string; text: string; who?: string; at?: string; info?: true }[] = [] // info: worth knowing, not waiting on you
const pusherOf = (repo: string, sha: string) => gh<{ author: { login: string } | null }>(`/repos/${repo}/commits/${sha}`).then((c) => c.author?.login, () => undefined)

const readAt = new Map<string, number>() // when each review PR was last read in full
/**
 * The tracked PRs worth reading in full this sync: those whose updatedAt moved since the last read (50 a GraphQL
 * query, about a point each), the ones never read, those `also` names, and any not read for FULL_EVERY. If the cheap
 * read fails, all of them (as before), unless GitHub asked to slow down.
 */
async function changedOf(ids: string[], also: (id: string) => boolean): Promise<string[]> {
  const now = Date.now(), moved = new Map<string, string>()
  try {
    for (let k = 0; k < ids.length; k += 50) {
      const part = ids.slice(k, k + 50)
      const q = part.map((id, i) => { const [repo, n] = id.split('#'), [owner, name] = repo.split('/'); return `p${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){pullRequest(number:${Number(n)}){updatedAt}}` }).join(' ')
      const d = await graphql<Record<string, { pullRequest?: { updatedAt: string } } | null>>(`query{ rateLimit{remaining resetAt} ${q} }`, {})
      part.forEach((id, i) => { const u = d[`p${i}`]?.pullRequest?.updatedAt; if (u) moved.set(id, u) })
    }
  } catch (e) {
    if (slowedUntil()) return []
    console.warn('sync: change check failed, reading every PR:', (e as Error).message)
    return ids
  }
  const due = ids.filter((id) => {
    const p = state.prs[id], at = readAt.get(id)
    return !p || !at || fullDue(at, now) || also(id) || !moved.has(id) || moved.get(id) !== p.updatedAt
  })
  for (const id of due) readAt.set(id, now)
  return due
}

/**
 * `skip`: a light sync, between full ones, while webhooks deliver (index.ts doPoll). The rule: a repository whose hook
 * delivered lately (hooks.ts hookLive) is left to its webhook; everything else is read as every minute before. So the
 * review-request search still runs (one call: requests on repositories without a hook, and requests to a team), PRs
 * on unhooked repositories still get the cheap change check, and your PRs there still get theirs. A full sync every
 * 10 minutes reads everything, hooked or not: the safety net for a delivery that never came.
 */
export async function poll(o: { skip?: (repo: string) => boolean } = {}): Promise<{ fresh: string[]; feedback: string[] }> {
  const { skip } = o
  const { login } = await getMe()
  const t0 = Date.now(), lap: string[] = []
  const mark = (what: string) => lap.push(`${what} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const q = encodeURIComponent('is:open is:pr archived:false review-requested:@me')
  // GitHub's search can be paused for the account (its small allowance is shared with your agents' gh): then the PRs
  // already known to wait on your review stand in, and the rest of the sync goes on instead of failing whole
  const items = await gh<{ items: SearchItem[] }>(`/search/issues?q=${q}&per_page=100`).then((r) => r.items, (e: Error) => {
    if (!/search is paused/.test(e.message)) throw e
    console.warn(`sync: ${e.message}; using the review requests already known`)
    return undefined
  })
  const requested = new Set(items ? items.map((i) => `${i.repository_url.split('/repos/')[1]}#${i.number}`) : Object.values(state.prs).filter((p) => p.requested && !p.closed).map((p) => p.id))
  const fresh = [...requested].filter((id) => !state.prs[id]?.requested)

  // Requested PRs plus anything still open that we track (GitHub drops the request once you review).
  const ids = new Set([...requested, ...Object.values(state.prs).filter((p) => !p.closed && !p.mine).map((p) => p.id)])
  // only what changed is read in full (GitHub's advice: fetch what changed, not everything every minute): one cheap
  // GraphQL read gives every tracked PR's updatedAt, and a PR is read again when that moved, it is new, its request
  // came or went, or it hasn't been read for 10 minutes (a few things don't move updatedAt)
  const flipped = (id: string) => requested.has(id) !== !!state.prs[id]?.requested
  const due = await changedOf([...ids].filter((id) => !skip || flipped(id) || !skip(id.slice(0, id.lastIndexOf('#')))), flipped)
  await Promise.all(due.map((id) => { // gate() keeps it to a few at a time
    const [repo, n] = id.split('#')
    return refreshPr(repo, Number(n), requested.has(id), login).catch((e) => console.error(id, e.message))
  }))
  mark(`to-review (${due.length} of ${ids.size} read)`)
  // every watched repository hooked: nothing of yours to read until the full sync (the webhooks bring it)
  const allHooked = !!skip && Object.keys(config.repos).every(skip)
  const feedback = allHooked ? [] : await pollMine(skip).catch((e) => { console.error('my PRs:', e.message); return [] })
  mark('mine')
  kickStacks()
  // a slow sync says where its time went
  if (Date.now() - t0 > 15_000) console.warn(`sync took ${((Date.now() - t0) / 1000).toFixed(0)}s: ${lap.join(', ')}`)
  save()
  return { fresh, feedback }
}

// stacks change rarely and take the longest: they fill in after the sync, which doesn't wait for them
function kickStacks() {
  if (!stacking) stacking = refreshStacks().catch((e) => console.error('stacks:', e.message)).finally(() => { stacking = undefined; save(); onStacks() })
}

/**
 * Read these PRs now, as a sync would (a webhook said they changed: hooks.ts). `requested`: what the delivery said
 * about a review request for you (true: asked, false: withdrawn); else what is known. A PR not tracked is read only
 * when it asks for you (it joins, as a poll would add it) or is yours on a watched repository (your-PRs read).
 * Returns the ids that newly entered review-requested, like poll().
 */
export async function pollPrs(targets: { id: string; requested?: boolean; mine?: boolean }[]): Promise<{ fresh: string[] }> {
  const { login } = await getMe()
  const fresh: string[] = []
  let mineToo = false
  await Promise.all(targets.map(async (t) => {
    const p = state.prs[t.id], [repo, n] = [t.id.slice(0, t.id.lastIndexOf('#')), Number(t.id.slice(t.id.lastIndexOf('#') + 1))]
    if (p?.mine || (!p && t.mine && repo in config.repos)) { forceMine.add(t.id); mineToo = true; return }
    if (!p && t.requested !== true) return
    const requested = t.requested ?? p!.requested
    if (requested && !p?.requested) fresh.push(t.id)
    await refreshPr(repo, n, requested, login).catch((e) => console.error(t.id, e.message))
    readAt.set(t.id, Date.now())
  }))
  if (mineToo) await pollMine(() => true).catch((e) => console.error('my PRs:', e.message)) // only the ones named (forceMine)
  kickStacks()
  save()
  return { fresh }
}

/** Repos you were involved in (author, reviewer, mentioned) on PRs in the last 90 days, with PR counts. */
export async function searchRepos(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
  const q = encodeURIComponent(`is:pr involves:@me updated:>${since}`)
  const { items } = await gh<{ items: SearchItem[] }>(`/search/issues?q=${q}&per_page=100`)
  const counts = new Map<string, number>()
  for (const i of items) { const r = i.repository_url.split('/repos/')[1]; counts.set(r, (counts.get(r) ?? 0) + 1) }
  return counts
}

export type RepoHit = { repo: string; private: boolean; description?: string; pushedAt?: string }
type ApiRepo = { full_name: string; private: boolean; description: string | null; pushed_at: string | null; archived?: boolean }
const hit = (r: ApiRepo): RepoHit => ({ repo: r.full_name, private: r.private, description: r.description ?? undefined, pushedAt: r.pushed_at ?? undefined })
let mine: { at: number; list: Promise<RepoHit[]> } | undefined
/** Every repository your account reaches (yours, as a collaborator, your organisations'), most recently pushed first:
 *  read once and kept 10 minutes, so searching it is instant. Up to 1000. */
export function myRepos(): Promise<RepoHit[]> {
  if (mine && Date.now() - mine.at < 10 * 60_000) return mine.list
  const list = (async () => {
    const out: RepoHit[] = []
    for (let page = 1; page <= 10; page++) {
      const batch = await gh<ApiRepo[]>(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`)
      out.push(...batch.filter((r) => !r.archived).map(hit))
      if (batch.length < 100) break
    }
    return out
  })()
  mine = { at: Date.now(), list }
  list.catch(() => { mine = undefined })
  return list
}
/** One repository by name, any you can read (a public one outside your account too), or undefined. */
export const repoByName = (repo: string): Promise<RepoHit | undefined> => gh<ApiRepo>(`/repos/${repo}`).then(hit, () => undefined)

/** The repo's default branch (develop, main…), the one the codebase map follows. */
// a repo's default branch practically never changes: asked once per repo per run of the server
const trunks = new Map<string, Promise<string>>()
export function defaultBranch(repo: string): Promise<string> {
  if (!trunks.has(repo)) trunks.set(repo, gh<{ default_branch: string }>(`/repos/${repo}`).then((r) => r.default_branch).catch((e) => { trunks.delete(repo); throw e }))
  return trunks.get(repo)!
}

// --- stacked PRs: each PR's base is the head branch of the PR below it ----------------------

type OpenPull = { number: number; title: string; html_url: string; draft: boolean; user: { login: string }; head: { ref: string; repo?: { full_name?: string } | null }; base: { ref: string } }
const ref = (repo: string, p: OpenPull): StackRef => ({ repo, number: p.number, title: p.title, url: p.html_url, head: p.head.ref, base: p.base.ref, author: p.user.login, draft: p.draft })
const STACK_EVERY = 10 * 60_000
const MAX_DEPTH = 12

/**
 * How a repository's open PRs sit on each other, from ONE list of them: a PR is built on the PR whose head branch is
 * its base. That relation is a tree (several PRs can sit on the same one), so every PR gets:
 *   below  the PR it is built on (none: it sits on the default branch, or on a branch with no open PR)
 *   line   its own line through the tree, bottom to top: everything below it, itself, then up along the oldest PR
 *          built on each (a line needs one way up; the others built on the same PR have lines of their own)
 * Worked out for all of them from the same list, so the PRs of one tree always agree on what is below and above them.
 */
export function stacksFrom(repo: string, pulls: OpenPull[], trunk: string) {
  // only branches of this repository stack: a fork's branch of the same name is another branch
  const own = pulls.filter((p) => !p.head.repo?.full_name || p.head.repo.full_name === repo)
  const byHead = new Map(own.map((p) => [p.head.ref, p]))
  const kids = new Map<string, OpenPull[]>()
  for (const p of [...pulls].sort((a, b) => a.number - b.number)) kids.set(p.base.ref, [...(kids.get(p.base.ref) ?? []), p])
  const out = new Map<number, { below?: number; line: StackRef[] }>()
  for (const p of pulls) {
    const below: OpenPull[] = [], seen = new Set([p.number])
    for (let base = p.base.ref, i = 0; base !== trunk && i < MAX_DEPTH; i++) {
      const b = byHead.get(base)
      if (!b || seen.has(b.number)) break // nothing open there, or branches based on each other in a circle
      seen.add(b.number); below.unshift(b); base = b.base.ref
    }
    const above: OpenPull[] = []
    for (let head = p.head.ref, i = 0; i < MAX_DEPTH && byHead.get(head)?.number === (above.at(-1) ?? p).number; i++) {
      const k = kids.get(head)?.find((x) => !seen.has(x.number))
      if (!k) break
      seen.add(k.number); above.push(k); head = k.head.ref
    }
    out.set(p.number, { below: below.at(-1)?.number, line: [...below, p, ...above].map((x) => ref(repo, x)) })
  }
  return out
}

let stacking: Promise<void> | undefined
// when each repository's stacks were last worked out, and from which heads: kept in memory, not in the state, so a
// check that finds nothing new doesn't rewrite (and sync) the state. A restart works them out once.
const stacked = new Map<string, { at: number; sig: string }>()
/** Work this PR's stack out again at the next sync (after something changed how it sits: a rebase, a link). */
export const restack = (id: string) => stacked.delete(id.slice(0, id.lastIndexOf('#')))
let onStacks = () => {}
/** Called when stacks finish refreshing after a sync (the server re-sends the PR list). */
export const setOnStacks = (f: () => void) => { onStacks = f }

async function refreshStacks() {
  const byRepo = new Map<string, Pr[]>()
  for (const pr of Object.values(state.prs)) if (!pr.closed) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr])
  await Promise.all([...byRepo].map(async ([repo, prs]) => {
    // due: never worked out since the server started, a tracked PR's head or base moved (or one came or went), or older than STACK_EVERY
    const sig = prs.map((p) => `${p.number}:${p.headSha}:${p.base}`).sort().join(','), was = stacked.get(repo)
    if (was && was.sig === sig && Date.now() - was.at < STACK_EVERY) return
    try {
      const pulls: OpenPull[] = []
      for (let page = 1; page <= 10; page++) { // 1000 open PRs: past that the rest count as not stacked
        const got = await gh<OpenPull[]>(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`)
        pulls.push(...got)
        if (got.length < 100) break
      }
      const found = stacksFrom(repo, pulls, await defaultBranch(repo).catch(() => 'main'))
      await Promise.all(prs.map(async (pr) => {
        const f = found.get(pr.number)
        if (!f) return // not in the list of open ones (just merged or closed): the next sync settles it
        pr.stack = f.line.length > 1 ? f.line : undefined
        pr.below = f.below
        // yours: which stack GitHub itself lists it in, so one built on another PR but never linked can be put in its stack
        if (pr.mine && pr.stack) {
          const s = (await gh<{ stack?: { number: number; position: number; size: number } }>(`/repos/${repo}/pulls/${pr.number}`)).stack
          pr.ghStack = s ? { number: s.number, position: s.position, size: s.size } : null
        }
      }))
      stacked.set(repo, { at: Date.now(), sig })
    } catch (e) { console.error('stacks', repo, (e as Error).message) }
  }))
}

/** Refresh one tracked PR right away (after a post or approve, so the new review shows without waiting for a poll). */
export async function refreshOne(id: string) {
  const pr = state.prs[id]
  if (!pr) return
  // your own PR: its threads and reviews come from the your-PRs read, in full
  if (pr.mine) { forceMine.add(id); await pollMine(); save(); return }
  const { login } = await getMe()
  await refreshPr(pr.repo, pr.number, pr.requested, login)
  save()
}

export type PrHealth = { ci: 'success' | 'failure' | 'pending' | 'none'; openThreads: number; actionable: boolean; state: string; merged: boolean; base: string; head: string }
const HEALTH_FIELDS = `state merged author{login} baseRefName headRefName
        commits(last:1){nodes{commit{statusCheckRollup{state}}}}
        reviewThreads(first:100){nodes{isResolved comments(last:1){nodes{author{login}}}}}`
function healthOf(pr: any): PrHealth {
  const rollup: string | undefined = pr.commits.nodes[0]?.commit.statusCheckRollup?.state
  const ci = !rollup ? 'none' : rollup === 'SUCCESS' ? 'success' : rollup === 'FAILURE' || rollup === 'ERROR' ? 'failure' : 'pending'
  const openThreads = pr.reviewThreads.nodes.filter((t: any) => !t.isResolved && t.comments.nodes[0]?.author?.login !== pr.author?.login).length
  return { ci, openThreads, actionable: ci === 'failure' || openThreads > 0, state: pr.state, merged: pr.merged, base: pr.baseRefName, head: pr.headRefName }
}
/**
 * Many PRs' health in a few GraphQL reads (20 a query, one after another): a read per PR, all at once, is the burst
 * GitHub's secondary limit punishes. A PR it can't see is left out of the answer.
 */
export async function prHealthMany(prs: { repo: string; number: number }[]): Promise<Map<string, PrHealth>> {
  const out = new Map<string, PrHealth>()
  for (let k = 0; k < prs.length; k += 20) {
    const part = prs.slice(k, k + 20)
    const q = part.map((p, i) => { const [owner, name] = p.repo.split('/'); return `p${i}: repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){pullRequest(number:${Number(p.number)}){ ${HEALTH_FIELDS} }}` }).join(' ')
    const d = await graphql<Record<string, { pullRequest?: any } | null>>(`query{ rateLimit{remaining resetAt} ${q} }`, {})
    part.forEach((p, i) => { const pr = d[`p${i}`]?.pullRequest; if (pr) out.set(`${p.repo}#${p.number}`, healthOf(pr)) })
  }
  return out
}

/** Does this PR need its author? Red CI, or an unresolved thread whose last comment isn't the author's. */
export async function prHealth(repo: string, number: number): Promise<{ ci: 'success' | 'failure' | 'pending' | 'none'; openThreads: number; actionable: boolean; state: string; merged: boolean; base: string; head: string }> {
  const [owner, name] = repo.split('/')
  const d = await graphql<{ repository?: { pullRequest?: any } }>(`query($owner:String!,$name:String!,$number:Int!){ rateLimit{remaining resetAt} repository(owner:$owner,name:$name){ pullRequest(number:$number){
        state merged author{login} baseRefName headRefName
        commits(last:1){nodes{commit{statusCheckRollup{state}}}}
        reviewThreads(first:100){nodes{isResolved comments(last:1){nodes{author{login}}}}} }}}`, { owner, name, number })
  const pr = d.repository?.pullRequest
  if (!pr) throw new Error(`no PR ${repo}#${number}`)
  const rollup: string | undefined = pr.commits.nodes[0]?.commit.statusCheckRollup?.state
  const ci = !rollup ? 'none' : rollup === 'SUCCESS' ? 'success' : rollup === 'FAILURE' || rollup === 'ERROR' ? 'failure' : 'pending'
  const openThreads = pr.reviewThreads.nodes.filter((t: any) => !t.isResolved && t.comments.nodes[0]?.author?.login !== pr.author.login).length
  return { ci, openThreads, actionable: ci === 'failure' || openThreads > 0, state: pr.state, merged: pr.merged, base: pr.baseRefName, head: pr.headRefName }
}
