import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-takeoff-'))
const { takeOff } = await import('./setup.ts')

test('an unticked checkout goes only when nothing would be lost', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rd-repo-')), git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe' })
  const origin = join(root, 'origin.git'); execFileSync('git', ['init', '-q', '--bare', origin])
  const seed = join(root, 'seed'); execFileSync('git', ['clone', '-q', origin, seed])
  writeFileSync(join(seed, 'a'), '1'); git(seed, 'add', '.'); git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a'); git(seed, 'push', '-q', 'origin', 'HEAD')
  const wc = join(root, 'wc'); execFileSync('git', ['clone', '-q', origin, wc])
  writeFileSync(join(wc, 'b'), 'dirty')
  assert.match((await takeOff(wc))!, /uncommitted/)
  git(wc, 'add', '.'); git(wc, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'b')
  assert.match((await takeOff(wc))!, /not pushed/)
  git(wc, 'push', '-q', 'origin', 'HEAD')
  assert.equal(await takeOff(wc), undefined)
  assert.ok(!existsSync(wc))
})
