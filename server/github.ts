import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config, save, state, type Pr, type StackRef } from './store.ts'

let token = process.env.GITHUB_TOKEN ?? ''
/** The shared GitHub token changed (sharedEnv.ts): use it from the next call. */
export const tokenChanged = () => { token = process.env.GITHUB_TOKEN ?? '' }
async function getToken() {
  if (!token) token = (await promisify(execFile)('gh', ['auth', 'token'])).stdout.trim()
  return token
}

const etags = new Map<string, { etag: string; body: unknown }>()

// REST's own hourly quota (GraphQL keeps ghBudget): read from every response. Spent, calls fail at once until it
// resets instead of asking GitHub again, which would keep it spent (and break the lease, which lives there too).
const rest = { remaining: Infinity, resetAt: 0 }
export const restBudget = () => ({ ...rest })

// GET with ETag caching: a 304 costs no rate limit and returns the cached body.
export async function gh<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
  const cached = etags.get(path)
  if (rest.remaining <= 0 && Date.now() < rest.resetAt) {
    if (cached) return cached.body as T // what it said last is better than nothing
    throw new Error(`GitHub REST quota spent: resets at ${new Date(rest.resetAt).toISOString().slice(11, 16)} UTC`)
  }
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(cached && { 'If-None-Match': cached.etag }),
    },
  })
  const left = Number(res.headers.get('x-ratelimit-remaining')), reset = Number(res.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(left) && Number.isFinite(reset) && reset > 0) Object.assign(rest, { remaining: left, resetAt: reset * 1000 })
  if ((res.status === 403 || res.status === 429) && (left === 0 || res.headers.get('retry-after'))) {
    Object.assign(rest, { remaining: 0, resetAt: reset ? reset * 1000 : Date.now() + Number(res.headers.get('retry-after') ?? 60) * 1000 })
  }
  if (res.status === 304 && cached) return cached.body as T
  if (res.status === 401) token = '' // re-read gh's token next time
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  const etag = res.headers.get('etag')
  if (etag) etags.set(path, { etag, body })
  return body as T
}

export type Me = { login: string; name: string | null; avatar: string; machine?: string; reach?: { from: string; to: string } }
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
  reviewThreads: { nodes: { isResolved: boolean; first: { nodes: { author: { login: string } | null }[] }; comments: { nodes: { author: { login: string } | null; body: string; createdAt?: string }[] } }[] }
  reviews: { nodes: { databaseId: number; state: string; submittedAt?: string; body?: string; author: { __typename?: string; login: string } | null }[] }
  comments: { nodes: { author: { __typename: string; login: string } | null; body: string; createdAt?: string }[] }
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] }
}

/** GitHub's GraphQL budget as of the last poll (5000 points an hour, shared with your own `gh`). */
export const ghBudget: { remaining?: number; resetAt?: string } = {}
export async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json() as { data?: T & { rateLimit?: { remaining: number; resetAt: string } }; errors?: { message: string }[] }
  if (!json.data) {
    const msg = json.errors?.[0]?.message ?? String(res.status)
    // refused for rate: GitHub's hourly counter can still read high (another limit on the account), so treat it as empty
    if (/rate limit/i.test(msg)) Object.assign(ghBudget, { remaining: 0, resetAt: new Date(Date.now() + 15 * 60_000).toISOString() })
    throw new Error(`GitHub GraphQL: ${msg}`)
  }
  if (json.data.rateLimit) Object.assign(ghBudget, json.data.rateLimit)
  return json.data
}

const MINE_FIELDS = `number title body bodyHTML url isDraft createdAt updatedAt baseRefName headRefName headRefOid
  additions deletions changedFiles reviewDecision author{login avatarUrl} repository{nameWithOwner}
  reviewThreads(first:100){nodes{isResolved first: comments(first:1){nodes{author{login}}} comments(last:1){nodes{author{login} body createdAt}}}}
  reviewRequests(first:20){nodes{requestedReviewer{... on User{login}}}}
  reviews(last:30){nodes{databaseId state submittedAt body author{__typename login}}}
  comments(last:20){nodes{author{__typename login} body createdAt}}`
let mineFullAt = 0
// your PRs to read in full on the next sync whatever their updatedAt: replying in a review thread doesn't move it,
// so after the agent pushes or replies the thread counts would otherwise stay stale until the 10-minute full read
const forceMine = new Set<string>()
const FULL_EVERY = 10 * 60_000 // a resolved thread doesn't move a PR's updatedAt: re-read everything this often

/**
 * Your own open PRs on the configured repos, with their unresolved thread counts (the /revise picker's filter).
 * Two steps, to stay light on GitHub's budget: a cheap list (about 1 point) every poll, then the full details
 * (threads, reviews: tens of points) only for PRs that changed since the last poll, and for all of them every 10 minutes.
 */
async function pollMine(): Promise<string[]> {
  const repos = Object.keys(config.repos).map((r) => `repo:${r}`).join(' ')
  const list = await graphql<{ search: { nodes: { id: string; number: number; updatedAt: string; repository: { nameWithOwner: string } }[] } }>(
    `query($q:String!){ rateLimit{remaining resetAt} search(query:$q, type:ISSUE, first:50){ nodes{ ... on PullRequest { id number updatedAt repository{nameWithOwner} } } } }`,
    { q: `is:pr is:open author:@me archived:false ${repos}` })
  const full = Date.now() - mineFullAt > FULL_EVERY
  const stale = list.search.nodes.filter((n) => { const id = `${n.repository.nameWithOwner}#${n.number}`; return full || forceMine.has(id) || state.prs[id]?.updatedAt !== n.updatedAt })
  forceMine.clear()
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
    const said = talk.slice(mineAt + 1).filter((c) => c.author?.__typename !== 'Bot' && !/\[bot\]$/i.test(c.author?.login ?? '') && waitsOnYou(c, n.author.login))
    const reviewed = bodyReviews(n.reviews.nodes, mineAt >= 0 ? talk[mineAt].createdAt ?? '' : '', n.author.login)
    // what the agent already read: a push of yours that started after it and ended with nothing left to do (it found
    // nothing to answer: a status note, "holding approval until…"). Only what came after that waits on you
    const seen = [readBy(prev?.job), prev?.readAt].reduce<string | undefined>((a, b) => (b && (!a || b > a) ? b : a), undefined), fresh = (at?: string) => !seen || !at || at > seen
    const awaiting = open_.filter((t) => waitsOnYou(t.comments.nodes[0], n.author.login) && fresh(t.comments.nodes[0]?.createdAt)).length
      + said.filter((c) => fresh(c.createdAt)).length + reviewed.filter((r) => fresh(r.submittedAt ?? undefined)).length
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
    })
    const commenters = [...new Set([...open_.map((t) => t.comments.nodes[0]?.author?.login), ...said.map((c) => c.author?.login)].filter((l): l is string => !!l && l !== n.author.login))]
    if (prev && prev.headSha !== n.headRefOid) dropStaleNext(state.prs[id])
    const pusher = prev && prev.headSha !== n.headRefOid ? await pusherOf(repo, n.headRefOid) : undefined
    // the numeric id, as the REST refresh records it: one name per review, or each path would announce it again
    const reviews = n.reviews.nodes.filter((r) => r.state !== 'PENDING').map((r) => ({ id: String(r.databaseId), who: r.author?.login, state: r.state, at: r.submittedAt }))
    for (const e of changesOf(prev, state.prs[id], n.author.login, { pusher, commenters, reviews })) outside.push({ id, ...e })
    state.prs[id].seenReviews = reviews.map((r) => r.id)
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
 * When a finished push or fix round read everything waiting and, by its own checklist, left nothing to do: its start.
 * (A fix round with work left says so: "Push the 2 fix commits", "Post the 3 drafted replies".)
 */
export function readBy(j: Pr['job']): string | undefined {
  return (j?.kind === 'publish' || j?.kind === 'reply') && j.state === 'done' && j.leftNothing ? j.queuedAt : undefined
}

export function waitsOnYou(last: { author: { login: string } | null; body?: string } | undefined, me: string): boolean {
  if (!last || last.author?.login === me) return false
  const text = (last.body ?? '').replace(/\[!\[Generated by[^\]]*\]\([^)]*\)\]\([^)]*\)/gi, '').trim().slice(0, 400)
  if (/^!\[(fixed|already fixed|won't fix|withdrawn)\]/i.test(text)) return false
  const lead = text.replace(/^[^a-z0-9👍✅]+/i, '')
  if (/^(lgtm|looks good|thanks|thank you|resolved|done|👍|✅)\b/i.test(lead)) return false
  // an acknowledgement that asks for nothing more: no question, no new finding (a severity badge or "**[MEDIUM]")
  const asks = text.includes('?') || /\*\*\[(high|medium|low|nit)\b|!\[(high|medium|low|blocking|needs your call)\]/i.test(text)
  if (!asks && /^(confirmed|agreed|verified|makes sense|sounds good|fair enough|works for me|fine by me|ok(ay)?,|got it)\b/i.test(lead)) return false
  return true
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
export const outside: { id: string; text: string; who?: string; at?: string }[] = []
const pusherOf = (repo: string, sha: string) => gh<{ author: { login: string } | null }>(`/repos/${repo}/commits/${sha}`).then((c) => c.author?.login, () => undefined)

export async function poll(): Promise<{ fresh: string[]; feedback: string[] }> {
  const { login } = await getMe()
  const t0 = Date.now(), lap: string[] = []
  const mark = (what: string) => lap.push(`${what} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const q = encodeURIComponent('is:open is:pr archived:false review-requested:@me')
  const { items } = await gh<{ items: SearchItem[] }>(`/search/issues?q=${q}&per_page=100`)
  const requested = new Set(items.map((i) => `${i.repository_url.split('/repos/')[1]}#${i.number}`))
  const fresh = [...requested].filter((id) => !state.prs[id]?.requested)

  // Requested PRs plus anything still open that we track (GitHub drops the request once you review).
  const ids = new Set([...requested, ...Object.values(state.prs).filter((p) => !p.closed && !p.mine).map((p) => p.id)])
  await Promise.all([...ids].map((id) => {
    const [repo, n] = id.split('#')
    return refreshPr(repo, Number(n), requested.has(id), login).catch((e) => console.error(id, e.message))
  }))
  mark('to-review')
  const feedback = await pollMine().catch((e) => { console.error('my PRs:', e.message); return [] })
  mark('mine')
  // stacks change rarely and take the longest: they fill in after the sync, which doesn't wait for them
  if (!stacking) stacking = refreshStacks().catch((e) => console.error('stacks:', e.message)).finally(() => { stacking = undefined; save(); onStacks() })
  // a slow sync says where its time went
  if (Date.now() - t0 > 15_000) console.warn(`sync took ${((Date.now() - t0) / 1000).toFixed(0)}s: ${lap.join(', ')}`)
  save()
  return { fresh, feedback }
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

/** The repo's default branch (develop, main…), the one the codebase map follows. */
// a repo's default branch practically never changes: asked once per repo per run of the server
const trunks = new Map<string, Promise<string>>()
export function defaultBranch(repo: string): Promise<string> {
  if (!trunks.has(repo)) trunks.set(repo, gh<{ default_branch: string }>(`/repos/${repo}`).then((r) => r.default_branch).catch((e) => { trunks.delete(repo); throw e }))
  return trunks.get(repo)!
}

// --- stacked PRs: each PR's base is the head branch of the PR below it ----------------------

type OpenPull = { number: number; title: string; html_url: string; draft: boolean; user: { login: string }; head: { ref: string }; base: { ref: string } }
const ref = (repo: string, p: OpenPull): StackRef => ({ repo, number: p.number, title: p.title, url: p.html_url, head: p.head.ref, base: p.base.ref, author: p.user.login, draft: p.draft })
const STACK_EVERY = 10 * 60_000
const MAX_DEPTH = 12

/**
 * For each tracked open PR, walk down (the PR whose head is our base) and up (PRs based on our head)
 * through open PRs. ETag caching makes unchanged lookups free; recomputed every 10 minutes per PR.
 */
let stacking: Promise<void> | undefined
// when each PR's stack was last worked out, and at which head: kept in memory, not in the state, so a check that finds
// nothing new doesn't rewrite (and sync) the state file. A restart works every stack out once.
const stacked = new Map<string, { at: number; sha?: string }>()
export const restack = (id: string) => stacked.delete(id)
let onStacks = () => {}
/** Called when stacks finish refreshing after a sync (the server re-sends the PR list). */
export const setOnStacks = (f: () => void) => { onStacks = f }

async function refreshStacks() {
  // due: never worked out since the server started, its head moved, or older than STACK_EVERY
  const due = Object.values(state.prs).filter((pr) => { const s = stacked.get(pr.id); return !pr.closed && !(s && s.sha === pr.headSha && Date.now() - s.at < STACK_EVERY) })
  // six PRs at a time: each walks its chain with a few calls, one after another
  const queue = [...due]
  await Promise.all(Array.from({ length: 6 }, async () => { for (let pr; (pr = queue.shift());) await stackOf(pr).catch((e) => console.error('stack', pr.id, e.message)) }))
}

async function stackOf(pr: Pr) {
  {
    const [owner] = pr.repo.split('/')
    const trunk = await defaultBranch(pr.repo).catch(() => 'main')
    const self: StackRef = { repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, head: pr.head, base: pr.base, author: pr.author.login, draft: pr.draft }
    const below: StackRef[] = []
    for (let base = pr.base, i = 0; base !== trunk && i < MAX_DEPTH; i++) {
      const [p] = await gh<OpenPull[]>(`/repos/${pr.repo}/pulls?state=open&head=${owner}:${encodeURIComponent(base)}&per_page=5`)
      if (!p) break
      below.unshift(ref(pr.repo, p))
      base = p.base.ref
    }
    const above: StackRef[] = []
    for (let head = pr.head, i = 0; i < MAX_DEPTH; i++) {
      // ponytail: a branch with several PRs on top follows the oldest; real trees are rare in practice
      const kids = await gh<OpenPull[]>(`/repos/${pr.repo}/pulls?state=open&base=${encodeURIComponent(head)}&sort=created&direction=asc&per_page=5`)
      if (!kids.length) break
      above.push(ref(pr.repo, kids[0]))
      head = kids[0].head.ref
    }
    const chain = [...below, self, ...above]
    pr.stack = chain.length > 1 ? chain : undefined
    // yours: which stack GitHub itself lists it in, so one built on another PR but never linked can be put in its stack
    if (pr.mine && pr.stack) {
      const s = (await gh<{ stack?: { number: number; position: number; size: number } }>(`/repos/${pr.repo}/pulls/${pr.number}`)).stack
      pr.ghStack = s ? { number: s.number, position: s.position, size: s.size } : null
    }
    stacked.set(pr.id, { at: Date.now(), sha: pr.headSha })
  }
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
