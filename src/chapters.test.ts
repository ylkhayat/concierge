import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HANDOVER, once } from './chapters.ts'
import type { Activity } from './lib.ts'

const at = '2026-11-09T10:00:00Z'
test('the last message shows once: the result stays, its copy goes', () => {
  const feed: Activity[] = [{ at, kind: 'text', text: 'Earlier.' }, { at, kind: 'text', text: 'Done: X.\n' }, { at, kind: 'event', text: 'note' }, { at, kind: 'result', text: 'Done: X.' }]
  assert.deepEqual(once(feed).map((a) => a.kind), ['text', 'event', 'result'])
})
test('handovers are told apart from your words', () => {
  assert.equal(HANDOVER.exec('Handed over from the agent on #4953 ("Fix it"): do these here, on this PR.\n- a')?.[1], '#4953')
  assert.equal(HANDOVER.exec('Handover from ticket AC-12')?.[1], 'ticket AC-12')
  assert.equal(HANDOVER.exec('Please fix the tests.\nHandover from me'), null)
})
