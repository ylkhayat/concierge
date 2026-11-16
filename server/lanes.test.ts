import assert from 'node:assert/strict'
import { test } from 'node:test'
import { laneOf } from './lanes.ts'

// what people type, and where it should go (the cases the first rules got wrong are marked)
const cases: [string, 'ship' | 'intent' | 'understanding', boolean?][] = [
  ['Add a test for the retry', 'ship'],
  ['please rename it to fetchAll', 'ship'],
  ['can you add a loading state to the button?', 'ship'], // was understanding: a request phrased as a question
  ["let's split this into two PRs", 'ship'], // was understanding
  ['make sure the migration is reversible', 'ship'], // was understanding
  ["don't touch the billing module", 'ship'], // was understanding
  ['ok so also handle the empty list', 'ship'], // was understanding: filler first
  ['we need to cover the 404 path too', 'ship'], // was understanding
  ['yes, go with option 2', 'ship'],
  ['the second one', 'ship', true],
  ['sounds good, but keep the old endpoint working', 'ship', true],
  ['Is this supposed to cover archived users?', 'intent'],
  ['the ticket says only admins, not editors', 'intent'],
  ['should users be able to undo this?', 'intent'], // was understanding
  ['what if the customer has no seats left?', 'intent'], // was understanding
  ['is it ok that we drop the old export?', 'intent'],
  ['do we really need a new table for this', 'intent'],
  ['why does it retry three times?', 'understanding'],
  ['can you explain how the cache is invalidated', 'understanding'], // was ship ("can you" + verb)
  ['walk me through the auth flow', 'understanding'],
  ['how does this function handle timeouts?', 'understanding'],
  ['> const x = 3\n\nwhat is this for', 'understanding'],
  ['what do you mean?', 'understanding', true],
  ['the second one', 'understanding'], // unclear, nobody asked: the safe lane
]

test('laneOf routes what people actually type', () => {
  const wrong = cases.filter(([t, want, answering]) => laneOf(t, !!answering) !== want).map(([t, want, a]) => `${JSON.stringify(t)}: got ${laneOf(t, !!a)}, want ${want}`)
  assert.deepEqual(wrong, [])
})
