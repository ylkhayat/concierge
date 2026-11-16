import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verdict } from './worktrees.ts'

test('worktree cleanup never takes work, and takes what is idle', () => {
  const w = { path: '/x', gone: false, dirty: 0, unpushed: 0, touchedAgo: 3600_000, crit: false }
  const v = (o: object) => { const r = verdict({ ...w, ...o }); return `${r.remove ? 'remove' : 'keep'}: ${r.why}` }
  assert.equal(v({}), 'remove: clean, pushed and idle')
  assert.equal(v({ gone: true, dirty: 3 }), 'remove: its folder is already gone')
  assert.equal(v({ dirty: 1 }), 'keep: 1 uncommitted change')
  assert.equal(v({ unpushed: 2 }), 'keep: 2 commits not on GitHub')
  assert.equal(v({ touchedAgo: 60_000 }), 'keep: in use in the last 15 minutes')
  assert.equal(v({ crit: true }), 'keep: crit is running in it')
  assert.equal(v({ openReviewOf: 4243 }), 'keep: the crit review of open PR #4243')
  assert.equal(v({ own: { base: true, prOpen: false } }), 'keep: the codebase map')
  assert.equal(v({ own: { base: false, prOpen: true } }), 'keep: Explain for an open PR')
  assert.equal(v({ own: { base: false, prOpen: false } }), 'remove: clean, pushed and idle')
})

test("a PR's own worktrees: its Explain copy, its review folder, and its branch, nothing else", async () => {
  const { belongsTo } = await import('./worktrees.ts')
  const { config } = await import('./store.ts')
  config.repos['o/r'] = '/code/r'
  config.agent.worktree = '{repoPath}/.claude/worktrees/review-pr-{number}'
  const pr = { id: 'o/r#7', repo: 'o/r', number: 7, head: 'fix-7' }
  const { STATE_DIR } = await import('./paths.ts')
  const own = `${STATE_DIR}/worktrees/o-r-7`
  assert.ok(belongsTo({ repo: 'o/r', path: own }, pr))
  assert.ok(belongsTo({ repo: 'o/r', path: '/code/r/.claude/worktrees/review-pr-7' }, pr))
  assert.ok(belongsTo({ repo: 'o/r', path: '/anywhere', branch: 'fix-7' }, pr))
  assert.ok(!belongsTo({ repo: 'o/r', path: '/code/r/.claude/worktrees/review-pr-8' }, pr))
  assert.ok(!belongsTo({ repo: 'o/other', path: '/anywhere', branch: 'fix-7' }, pr))
})

test('the nightly sweep runs once a night, and catches up after the PC was off', async () => {
  const { sweepDue } = await import('./worktrees.ts')
  const at = (s: string) => new Date(s) // local time
  assert.ok(sweepDue(undefined, at('2026-10-20T09:00')))                              // never ran
  assert.ok(sweepDue('2026-10-19T03:05', at('2026-10-20T09:00')))                     // off at 03:00 today: catch up at boot
  assert.ok(!sweepDue('2026-10-20T03:01', at('2026-10-20T09:00')))                    // already swept tonight
  assert.ok(!sweepDue('2026-10-19T22:00', at('2026-10-20T02:00')))                    // before 03:00: last night's still counts
  assert.ok(sweepDue('2026-10-19T02:00', at('2026-10-20T02:00')))                     // but not the night before's
})
