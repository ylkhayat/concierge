// A review read in Concierge (no crit): the file the agent writes where crit keeps reviews is read like crit's own.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

process.env.CRIT_DIR = mkdtempSync(join(tmpdir(), 'rd-crit-'))

test("a review written without crit counts its findings, and a dropped one isn't open", async () => {
  const { critFor, ownReviewFile, ownReviewKey, refreshCrit } = await import('./crit.ts')
  const key = ownReviewKey({ repo: 'o/r', number: 7 })
  assert.equal(key, 'cc-o-r-7')
  const file = ownReviewFile(key)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    files: { 'a.ts': { comments: [
      { id: 'c_1', start_line: '3', end_line: '3', body: '![blocking](x) null deref', author: 'Claude Code', resolved: false },
      { id: 'c_2', start_line: '9', end_line: '9', body: 'nit', author: 'Claude Code', resolved: true },
    ] } },
    review_comments: [{ id: 'c_3', body: 'overall', author: 'Claude Code', resolved: false }],
  }))
  critFor({ key }) // asks for it: the next read includes it
  await refreshCrit()
  const c = critFor({ key })
  assert.equal(c.aiComments, 3)
  assert.equal(c.unresolved, 2) // c_2 dropped
  assert.equal(c.blocking, 1)
  assert.equal(c.live, false) // no daemon: nothing to open or restart
})
