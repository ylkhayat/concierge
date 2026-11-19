import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoPath, WORK_DIR } from './config.ts'
import { validate } from './setup.ts'

test('a folder name sits in this machine\'s working directory; an absolute path stays', async () => {
  assert.equal(repoPath('private-app'), join(WORK_DIR, 'private-app'))
  assert.equal(repoPath('/srv/app'), '/srv/app')
  // a folder name that isn't here yet is fine: each machine clones it; a missing absolute path is a typo
  assert.deepEqual(await validate('me/nowhere-yet', 'nowhere-yet-xyz'), { ok: true, clone: true })
  assert.equal((await validate('me/x', '/no/such/folder-xyz')).ok, false)
})
