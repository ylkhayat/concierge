import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { alignChain, rebaseChain, reviewed, stackLink } from './actions.ts'

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
const commit = (cwd: string, file: string, body: string) => { writeFileSync(join(cwd, file), body); git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', file) }

/** origin with develop ← a ← b, then develop moves on. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'rd-rebase-'))
  const origin = join(root, 'origin.git'), work = join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin)
  git(root, 'clone', '-q', origin, work)
  git(work, 'checkout', '-q', '-b', 'develop'); commit(work, 'base.txt', 'base\n'); git(work, 'push', '-q', 'origin', 'develop')
  git(work, 'checkout', '-q', '-b', 'a'); commit(work, 'a.txt', 'a\n'); git(work, 'push', '-q', 'origin', 'a')
  git(work, 'checkout', '-q', '-b', 'b'); commit(work, 'b.txt', 'b\n'); git(work, 'push', '-q', 'origin', 'b')
  git(work, 'checkout', '-q', 'develop')
  return { root, work }
}
const chain = [{ number: 1, base: 'develop', head: 'a' }, { number: 2, base: 'a', head: 'b' }]

test('smart rebase cascades a stack onto the moved base and pushes each branch once', async () => {
  const { root, work } = setup()
  commit(work, 'd.txt', 'd\n'); git(work, 'push', '-q', 'origin', 'develop')
  const out = await rebaseChain(work, join(root, 'wt'), chain, () => { throw new Error('no conflict expected') })
  assert.match(out, /^rebased and pushed #1 \(was [0-9a-f]{9}\), #2 \(was [0-9a-f]{9}\)$/) // where each was, to go back
  git(work, 'fetch', '-q', 'origin')
  assert.equal(git(work, 'merge-base', 'origin/a', 'origin/develop'), git(work, 'rev-parse', 'origin/develop'))
  assert.equal(git(work, 'rev-parse', 'origin/b~1'), git(work, 'rev-parse', 'origin/a')) // b keeps only its own commit, on the new a
  // your own copies of the branches follow, so your checkout and GitHub agree
  assert.equal(git(work, 'rev-parse', 'a'), git(work, 'rev-parse', 'origin/a'))
  assert.equal(git(work, 'rev-parse', 'b'), git(work, 'rev-parse', 'origin/b'))
  assert.equal(await rebaseChain(work, join(root, 'wt'), chain, async () => {}), 'already up to date')
})

test('a conflict goes to the resolver, and the resolved result is pushed', async () => {
  const { root, work } = setup()
  commit(work, 'a.txt', 'develop wrote this\n'); git(work, 'push', '-q', 'origin', 'develop')
  const wt = join(root, 'wt')
  const hit: number[] = []
  await rebaseChain(work, wt, chain.slice(0, 1), async (n) => {
    hit.push(n)
    writeFileSync(join(wt, 'a.txt'), 'both\n'); git(wt, 'add', 'a.txt')
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'rebase', '--continue'], { cwd: wt, env: { ...process.env, GIT_EDITOR: 'true' } })
  })
  assert.deepEqual(hit, [1])
  assert.equal(git(work, 'show', 'origin/a:a.txt'), 'both')
})

test('after a rebase, your own branch follows only when nothing of yours is lost', async () => {
  const { localMove } = await import('./actions.ts')
  assert.equal(localMove({ exists: false, atOld: false, behindOld: false, checkedOut: false }), 'none')
  assert.equal(localMove({ exists: true, atOld: true, behindOld: true, checkedOut: false }), 'ref')
  assert.equal(localMove({ exists: true, atOld: false, behindOld: true, checkedOut: true }), 'checkout')
  assert.equal(localMove({ exists: true, atOld: false, behindOld: false, checkedOut: false }), 'keep') // unpushed commits
})

test('a local branch with commits never pushed is left alone by the rebase', async () => {
  const { root, work } = setup()
  git(work, 'checkout', '-q', 'b'); commit(work, 'mine.txt', 'unpushed\n'); git(work, 'checkout', '-q', 'develop')
  const mine = git(work, 'rev-parse', 'b')
  commit(work, 'd.txt', 'd\n'); git(work, 'push', '-q', 'origin', 'develop')
  await rebaseChain(work, join(root, 'wt'), chain, () => { throw new Error('no conflict expected') })
  assert.equal(git(work, 'rev-parse', 'b'), mine)
  assert.equal(git(work, 'rev-parse', 'a'), git(work, 'rev-parse', 'origin/a')) // a had nothing of its own: it follows
})

test('a local branch left at the tip of an earlier rebase follows too: GitHub had every commit on it', async () => {
  const { root, work } = setup()
  commit(work, 'd.txt', 'd\n'); git(work, 'push', '-q', 'origin', 'develop')
  await rebaseChain(work, join(root, 'wt'), chain, () => { throw new Error('no conflict expected') })
  git(work, 'update-ref', 'refs/heads/b', git(work, 'rev-parse', 'origin/b@{1}')) // b back at the first rebase's tip
  git(work, 'checkout', '-q', 'develop'); commit(work, 'e.txt', 'e\n'); git(work, 'push', '-q', 'origin', 'develop')
  await rebaseChain(work, join(root, 'wt'), chain, () => { throw new Error('no conflict expected') })
  assert.equal(git(work, 'rev-parse', 'b'), git(work, 'rev-parse', 'origin/b'))
})

test('gh stack\'s record follows the rebase, and a stale checkout follows even when nothing moves now', async () => {
  const { root, work } = setup()
  const stale = { a: git(work, 'rev-parse', 'a'), b: git(work, 'rev-parse', 'b') }
  writeFileSync(join(work, '.git', 'gh-stack'), JSON.stringify({ stacks: [{ branches: [{ branch: 'a', head: stale.a, base: 'old' }, { branch: 'b', head: stale.b, base: stale.a }] }] }))
  writeFileSync(join(work, '.git', 'gh-stack-operation.lock'), '') // gh stack leaves its (empty) lock files on disk
  commit(work, 'd.txt', 'd\n'); git(work, 'push', '-q', 'origin', 'develop')
  await rebaseChain(work, join(root, 'wt'), chain, () => { throw new Error('no conflict expected') })
  const rec = JSON.parse(readFileSync(join(work, '.git', 'gh-stack'), 'utf8')).stacks[0].branches
  assert.deepEqual(rec.map((b: { head: string }) => b.head), [git(work, 'rev-parse', 'origin/a'), git(work, 'rev-parse', 'origin/b')])
  assert.equal(rec[0].base, git(work, 'rev-parse', 'origin/develop'))
  assert.equal(rec[1].base, git(work, 'rev-parse', 'origin/a'))
  // a checkout left behind by an earlier rebase: the next run has nothing to rebase, yet it catches up
  git(work, 'update-ref', 'refs/heads/a', stale.a)
  assert.equal(await rebaseChain(work, join(root, 'wt'), chain, () => { throw new Error('no conflict expected') }), 'already up to date')
  assert.equal(git(work, 'rev-parse', 'a'), git(work, 'rev-parse', 'origin/a'))
})

test('a push into the middle of a stack: the reviewed PR above merges it in, the unreviewed one is rebased', async () => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 't'; process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@t'
  const { root, work } = setup()
  git(work, 'checkout', '-q', 'b'); git(work, 'checkout', '-q', '-b', 'c'); commit(work, 'c.txt', 'c\n'); git(work, 'push', '-q', 'origin', 'c')
  // an agent pushes a fix onto a, plainly, the way the revise skill does
  git(work, 'checkout', '-q', 'a'); commit(work, 'fix.txt', 'fix\n'); git(work, 'push', '-q', 'origin', 'a'); git(work, 'checkout', '-q', 'develop')
  const oldB = git(work, 'rev-parse', 'origin/b')
  const stack = [{ number: 1, base: 'develop', head: 'a', merge: true }, { number: 2, base: 'a', head: 'b', merge: true }, { number: 3, base: 'b', head: 'c', merge: false }]
  assert.equal(await alignChain(work, join(root, 'wt'), stack, () => { throw new Error('no conflict expected') }), '#2, #3 now have the branch below')
  git(work, 'fetch', '-q', 'origin')
  // b kept its history: a merge whose first parent is the b reviewers saw
  assert.equal(git(work, 'rev-parse', 'origin/b^1'), oldB)
  assert.equal(git(work, 'rev-parse', 'origin/b^2'), git(work, 'rev-parse', 'origin/a'))
  // c, never reviewed, is its own commit on the new b
  assert.equal(git(work, 'rev-parse', 'origin/c~1'), git(work, 'rev-parse', 'origin/b'))
  assert.equal(git(work, 'log', '-1', '--format=%s', 'origin/c'), 'c.txt')
  // your checkout follows
  assert.equal(git(work, 'rev-parse', 'c'), git(work, 'rev-parse', 'origin/c'))
  assert.equal(await alignChain(work, join(root, 'wt'), stack, () => { throw new Error('nothing to do') }), 'already aligned')
})

test("the repo's commit hooks don't run on Concierge's own merges: a worktree never has their install", async () => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 't'; process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@t'
  const { root, work } = setup()
  git(work, 'checkout', '-q', 'a'); commit(work, 'fix.txt', 'fix\n'); git(work, 'push', '-q', 'origin', 'a'); git(work, 'checkout', '-q', 'develop')
  // then a pre-commit hook that fails, the way husky's does where it was never installed
  const hooks = join(root, 'hooks'); execFileSync('mkdir', ['-p', hooks])
  for (const h of ['pre-commit', 'pre-merge-commit']) { writeFileSync(join(hooks, h), '#!/bin/sh\nexit 1\n'); execFileSync('chmod', ['+x', join(hooks, h)]) }
  git(work, 'config', 'core.hooksPath', hooks)
  const stack = [{ number: 1, base: 'develop', head: 'a', merge: true }, { number: 2, base: 'a', head: 'b', merge: true }]
  assert.equal(await alignChain(work, join(root, 'wt'), stack, () => { throw new Error('the hook stopped the merge') }), '#2 now has the branch below')
})

test('a PR counts as reviewed once someone reviewed it', () => {
  assert.equal(reviewed({ seenReviews: [], reviewDecision: 'REVIEW_REQUIRED' }), false)
  assert.equal(reviewed({ seenReviews: ['1'], reviewDecision: null }), true)
  assert.equal(reviewed({ reviewDecision: 'APPROVED' }), true)
})

test('a chain of your PRs is linked into one GitHub stack only when that is clear-cut', () => {
  const s = (number: number) => ({ ghStack: { number, position: 1, size: 2 } }), none = { ghStack: null }
  assert.equal(stackLink([s(7), s(7)], true), 'ok')
  assert.equal(stackLink([s(7), none], true), 'link') // the top one never made it into the stack below
  assert.equal(stackLink([none, none], true), 'link') // no stack yet: link creates one
  assert.equal(stackLink([s(7), none], false), 'ask') // someone else's PR in the chain
  assert.equal(stackLink([s(7), none, s(9)], true), 'ask') // two stacks: not ours to merge
  assert.equal(stackLink([s(7), s(9)], true), 'ask')
  assert.equal(stackLink([s(7), {}], true), 'wait') // not read yet
})

test('two unreviewed PRs in a row: the second carries only its own commits, not the old copies of the one below', async () => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 't'; process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 't@t'
  const { root, work } = setup()
  git(work, 'checkout', '-q', 'b'); git(work, 'checkout', '-q', '-b', 'c'); commit(work, 'c.txt', 'c\n'); git(work, 'push', '-q', 'origin', 'c')
  // a is amended and force-pushed: its old commit is gone, a new one in its place (both touch the same file)
  git(work, 'checkout', '-q', 'a'); writeFileSync(join(work, 'a.txt'), 'a, amended\n'); git(work, 'commit', '-qam', 'a.txt'.concat(' (amended)'), '--amend'); git(work, 'push', '-q', '-f', 'origin', 'a'); git(work, 'checkout', '-q', 'develop')
  git(work, 'fetch', '-q', 'origin')
  const stack = [{ number: 1, base: 'develop', head: 'a', merge: false }, { number: 2, base: 'a', head: 'b', merge: false }, { number: 3, base: 'b', head: 'c', merge: false }]
  assert.equal(await alignChain(work, join(root, 'wt'), stack, () => { throw new Error('no conflict expected: only each branch\'s own commits move') }), '#2, #3 now have the branch below')
  git(work, 'fetch', '-q', 'origin')
  assert.equal(git(work, 'rev-parse', 'origin/b~1'), git(work, 'rev-parse', 'origin/a'))
  assert.equal(git(work, 'rev-parse', 'origin/c~1'), git(work, 'rev-parse', 'origin/b'))
  assert.deepEqual(git(work, 'log', '--format=%s', 'origin/develop..origin/c').split('\n'), ['c.txt', 'b.txt', 'a.txt (amended)'])
})
