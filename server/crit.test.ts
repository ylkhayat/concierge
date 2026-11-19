import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// Point crit.ts at fixtures before it loads.
const root = mkdtempSync(join(tmpdir(), 'review-deck-'))
process.env.CRIT_DIR = join(root, 'crit')
const { critFor, refreshCrit, statusOf } = await import('./crit.ts')
// critFor reads a snapshot that refreshes in the background: ask for a key, refresh, then read
const fresh = async (seen: Parameters<typeof critFor>[0], wt?: string) => { critFor(seen, wt); await refreshCrit(); return critFor(seen, wt) }

const key = 'abc123'
mkdirSync(join(root, 'crit/sessions'), { recursive: true })
mkdirSync(join(root, 'crit/reviews', key), { recursive: true })
mkdirSync(join(root, 'crit/finish'), { recursive: true })

test('counts comments by the last key seen, with no live daemon', async () => {
  writeFileSync(join(root, 'crit/reviews', key, 'review.json'), JSON.stringify({
    review_comments: [{ author: 'Claude Code', resolved: false }],
    files: { 'a.ts': { comments: [
      { author: 'Claude Code', resolved: true, replies: [{ author: 'alice' }] },
      { author: 'alice', resolved: false },
    ] } },
  }))
  const c = await fresh({ port: 40007, key })
  assert.deepEqual([c.port, c.live, c.aiComments, c.myComments, c.unresolved, c.finishes], [40007, false, 2, 2, 2, 0])
})

test('live session wins and finish log is parsed', async () => {
  writeFileSync(join(root, 'crit/sessions', `${key}.json`), JSON.stringify({ pid: process.pid, port: 40011, cwd: '/repo/.worktrees/pr-7' }))
  writeFileSync(join(root, 'crit/finish', `${key}.log`), '2026-01-01T00:00:00Z\tabc123\tapproved=false\tunresolved=3\tmode=diff\n')
  const c = await fresh({ port: 40011 })
  assert.equal(c.port, 40011)
  assert.equal(c.live, true)
  assert.deepEqual(c.lastFinish, { at: '2026-01-01T00:00:00Z', approved: false, unresolved: 3 })
})

test('status machine', () => {
  const base = { closed: false, headSha: 'h2' } as any
  const crit = { finishes: 0, myComments: 0 } as any
  const job = (state: string, headSha = 'h2', kind = 'review') => ({ state, headSha, kind, reviewDone: state === 'done' })
  assert.equal(statusOf(base, crit, true), 'new')
  assert.equal(statusOf(base, crit, false), 'no-checkout')
  assert.equal(statusOf({ ...base, job: job('running') }, crit, true), 'preparing')
  assert.equal(statusOf({ ...base, job: job('done') }, crit, true), 'ready')
  assert.equal(statusOf({ ...base, job: job('done') }, { finishes: 1, myComments: 0 } as any, true), 'in-review')
  assert.equal(statusOf({ ...base, job: job('done', 'h1') }, crit, true), 'new') // pushed since the run
  assert.equal(statusOf({ ...base, myReview: { commitId: 'h2', state: 'APPROVED' } }, crit, true), 'reviewed')
  assert.equal(statusOf({ ...base, myReview: { commitId: 'h1' } }, crit, true), 'new') // re-review
  assert.equal(statusOf({ ...base, closed: true }, crit, true), 'closed')
  assert.equal(statusOf(base, { ...crit, live: true }, true), 'ready') // started by hand
  assert.equal(statusOf({ ...base, job: job('running', 'h2', 'post') }, crit, true), 'posting')
  // a failed post is failed (the pipeline offers the retry); the review itself is kept for it
  assert.equal(statusOf({ ...base, job: { ...job('failed', 'h2', 'post'), reviewDone: true } }, crit, true), 'failed')
  assert.equal(statusOf({ ...base, job: job('failed') }, crit, true), 'failed')
  // your own PRs
  const mine = { ...base, mine: true, unresolved: 0, reviewDecision: 'REVIEW_REQUIRED' }
  assert.equal(statusOf(mine, crit, true), 'clear')
  // approved on GitHub reads as approved, even with crit open from a revise
  assert.equal(statusOf({ ...mine, reviewDecision: 'APPROVED', unresolved: 2, job: job('done', 'h2', 'revise') }, crit, true), 'approved')
  assert.equal(statusOf({ ...mine, unresolved: 2 }, crit, true), 'new')
  assert.equal(statusOf({ ...mine, reviewDecision: 'CHANGES_REQUESTED' }, crit, true), 'new')
  assert.equal(statusOf({ ...mine, unresolved: 2, job: job('running', 'h2', 'revise') }, crit, true), 'preparing')
  assert.equal(statusOf({ ...mine, unresolved: 2, job: job('done', 'h2', 'revise') }, crit, true), 'ready')
  assert.equal(statusOf({ ...mine, job: job('running', 'h2', 'publish') }, crit, true), 'posting')
  assert.equal(statusOf({ ...mine, myReview: { commitId: 'h2' } }, crit, true), 'clear') // never "reviewed"
})

test('a session is found by the printed port, or by the configured worktree', async () => {
  const k = 'rev999'
  writeFileSync(join(root, 'crit/sessions', `${k}.json`), JSON.stringify({ pid: process.pid, port: 41234, cwd: '/somewhere/else' }))
  await refreshCrit()
  assert.equal(critFor({ port: 41234 }).live, true)
  assert.equal(critFor({ port: 41234 }).sessionKey, k)
  assert.equal(critFor({ port: 40000 }).live, false)
  // started by hand: no port known, matched by the review worktree
  assert.equal(critFor({}, '/repo/.worktrees/pr-7').port, 40011)
  assert.equal(critFor({}).live, false)
})

test('your own PR: approved wins, your turn only when the last word is theirs, answered threads wait on reviewers', async () => {
  const { statusOf } = await import('./crit.ts')
  const mine = (o: object) => ({ id: 'a/b#1', mine: true, headSha: 'h', ...o }) as never
  assert.equal(statusOf(mine({ reviewDecision: 'APPROVED', unresolved: 2, awaiting: 2 }), undefined, true), 'approved')
  assert.equal(statusOf(mine({ reviewDecision: 'REVIEW_REQUIRED', unresolved: 2, awaiting: 1 }), undefined, true), 'new')
  assert.equal(statusOf(mine({ reviewDecision: 'REVIEW_REQUIRED', unresolved: 2, awaiting: 0 }), undefined, true), 'answered')
  assert.equal(statusOf(mine({ reviewDecision: 'CHANGES_REQUESTED', unresolved: 0, awaiting: 0 }), undefined, true), 'new') // asked in the review body
  assert.equal(statusOf(mine({ reviewDecision: 'CHANGES_REQUESTED', unresolved: 3, awaiting: 0 }), undefined, true), 'answered') // all answered or signed off
  assert.equal(statusOf(mine({ reviewDecision: null, unresolved: 0, awaiting: 0 }), undefined, true), 'clear')
})

test('a NORM finding is read back from the lines render.py writes', async () => {
  const { normOf } = await import('./crit.ts')
  const body = '![norm](x) ![non--blocking](y) **State derived in an effect renders twice.**\n\nAlign: compute it during render\nNorm: Don\'t use an effect to derive state\nSource: <https://react.dev/learn/you-might-not-need-an-effect>'
  const c = { id: 'c_1', author: 'Claude Code', body, start_line: 42 }
  assert.deepEqual(normOf(c, 'src/Today.tsx'), { id: 'c_1', path: 'src/Today.tsx', line: 42, claim: 'State derived in an effect renders twice.', norm: "Don't use an effect to derive state", source: 'https://react.dev/learn/you-might-not-need-an-effect', fix: 'compute it during render', state: 'drift' })
  assert.equal(normOf({ ...c, resolved: true, replies: [{ body: 'Deliberate: ADR-0031' }] })?.state, 'deliberate')
  assert.equal(normOf({ ...c, resolved: true })?.state, 'resolved')
  assert.equal(normOf({ ...c, author: 'Someone' }), undefined, 'only the AI files findings')
  assert.equal(normOf({ ...c, body: body.replace(/Source:.*/, '') }), undefined, 'no source, no norm')
})
