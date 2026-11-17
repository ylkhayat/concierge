import assert from 'node:assert/strict'
import { test } from 'node:test'
import { partOf } from './stackCheck.ts'

test("what the stack check reads on a PR: what it is for, what its agent said, what is open; nothing while it still runs", () => {
  const ref = { repo: 'o/r', number: 7, title: 'rename the field', base: 'main' } as never
  const done = { job: { state: 'done', summary: 'Renamed agenda to plan.', next: { steps: [{ text: 'Push the rename' }] } } } as never
  const a = partOf(ref, 0, done, { headline: 'One name for the plan', what: 'agenda becomes plan' })
  assert.ok(a.has)
  assert.match(a.text, /## 1\. #7 "rename the field" \(into main\)/)
  assert.match(a.text, /What it is for: One name for the plan/)
  assert.match(a.text, /Renamed agenda to plan\./)
  assert.match(a.text, /Still open on it:\n- Push the rename/)
  const running = partOf(ref, 1, { job: { state: 'running', summary: 'half a thought' } } as never)
  assert.equal(running.has, false)
  assert.match(running.text, /no agent has finished on it yet/)
  assert.equal(partOf(ref, 2, undefined).has, false)
})
