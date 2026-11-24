import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-takeoff-'))
const { takeOff } = await import('./setup.ts')

test('an unticked checkout goes with its worktrees, what is only here saved to the remote first, never onto a PR branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rd-repo-')), git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe' }).toString().trim()
  const who = ['-c', 'user.email=t@t', '-c', 'user.name=t']
  const origin = join(root, 'origin.git'); execFileSync('git', ['init', '-q', '--bare', origin])
  const seed = join(root, 'seed'); execFileSync('git', ['clone', '-q', origin, seed])
  writeFileSync(join(seed, 'a'), '1'); git(seed, 'add', '.'); git(seed, ...who, 'commit', '-qm', 'a'); git(seed, 'push', '-q', 'origin', 'HEAD')
  const wc = join(root, 'wc'); execFileSync('git', ['clone', '-q', origin, wc])
  // an agent's worktree with a commit not pushed and a change not committed
  const wt = join(root, 'wc-elbu-3'); git(wc, 'worktree', 'add', '-q', '-b', 'elbu-3', wt)
  writeFileSync(join(wt, 'c'), 'committed'); git(wt, 'add', '.'); git(wt, ...who, 'commit', '-qm', 'c')
  writeFileSync(join(wt, 'd'), 'not committed')
  assert.equal(await takeOff(wc, 'mbp'), undefined)
  assert.ok(!existsSync(wc)); assert.ok(!existsSync(wt))
  const saved = git(origin, 'ls-tree', '-r', '--name-only', 'concierge-saved/mbp/elbu-3')
  assert.match(saved, /c/); assert.match(saved, /d/) // both the commit and the uncommitted change reached the remote
  assert.throws(() => git(origin, 'rev-parse', '--verify', 'refs/heads/elbu-3')) // not onto the branch itself
})
