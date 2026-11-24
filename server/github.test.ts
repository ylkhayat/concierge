import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// its own state folder: what the store opens and writes must never reach the real one
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-github-'))
const { dropStaleNext, bodyReviews } = await import('./github.ts')
import type { Pr } from './store.ts'

test('a review that is only text waits on you until you answer or they review again', () => {
  const k = (state: string, at: string, body = 'Why this?') => ({ databaseId: 1, state, submittedAt: at, body, author: { login: 'sam' } })
  const me = (at: string) => ({ databaseId: 2, state: 'COMMENTED', submittedAt: at, body: '', author: { login: 'me' } })
  assert.equal(bodyReviews([k('COMMENTED', '2026-11-04T12:00:00Z')], '', 'me').length, 1)
  assert.equal(bodyReviews([k('CHANGES_REQUESTED', '2026-11-02T10:00:00Z'), me('2026-11-02T11:00:00Z')], '', 'me').length, 0) // answered in threads
  assert.equal(bodyReviews([k('CHANGES_REQUESTED', '2026-11-02T10:00:00Z'), k('APPROVED', '2026-11-02T12:00:00Z', 'ok')], '', 'me').length, 0) // superseded
  assert.equal(bodyReviews([k('COMMENTED', '2026-11-04T12:00:00Z')], '2026-11-04T13:00:00Z', 'me').length, 0) // answered on the PR
})

test("a run's next steps go once the PR moves on after it, not for the run's own push", () => {
  const steps = { steps: [{ text: 'Ask', kind: 'do', checked: true }], decisions: [], actions: [{ label: 'Ask', reply: 'Ask', kind: 'go' }], for: 'h' }
  const pr = (endedAt: string) => ({ job: { state: 'done', endedAt, next: structuredClone(steps) } }) as any
  const end = Date.parse('2026-11-05T22:21:58Z')
  const own = pr('2026-11-05T22:21:58Z'); dropStaleNext(own, end + 60_000)
  assert.equal(own.job.next.steps.length, 1)
  const later = pr('2026-11-05T22:21:58Z'); dropStaleNext(later, end + 3_600_000)
  assert.deepEqual([later.job.next.steps, later.job.next.actions, later.job.next.for], [[], [], 'h'])
})

