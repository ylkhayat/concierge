import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepsOf } from './flowSteps.ts'

test('a flowchart is its boxes in order, code names said as words', () => {
  assert.deepEqual(stepsOf('flowchart TD\n  A[Call prepared] --> B[build_session_start]\n  B --> C{German?}\n  C -->|yes| D(juni voice)\n  C --> A'), ['Call prepared', 'build session start', 'German?', 'juni voice'])
})
test('a sequence is its messages', () => {
  assert.deepEqual(stepsOf('sequenceDiagram\n  Phone->>Server: asks for a voice\n  Server-->>Phone: sends juni'), ['asks for a voice', 'sends juni'])
})
test('text that is no diagram stays as it is', () => {
  assert.deepEqual(stepsOf('It now picks the voice by language'), ['It now picks the voice by language'])
})
