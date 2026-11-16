import assert from 'node:assert/strict'
import { test } from 'node:test'
import { guessSkill } from './skillGuess.ts'

const sk = (invoke: string, source = 'yours') => ({ invoke, source, command: `${invoke} {x}` })
const mine = [sk('/review-pr'), sk('/review-stack'), sk('/revise'), sk('/acme-exec'), sk('/concierge-review', 'yours'), sk('/concierge-revise'), sk('/review-exchange'), sk('/pr-review-toolkit:review-pr', 'plugin'), sk('/humanizer')]

test('your own review, revise and ship skills are found by name; never a starter, never the stack one; yours before a plugin\'s', () => {
  assert.equal(guessSkill(mine, 'review')?.invoke, '/review-pr')
  assert.equal(guessSkill(mine, 'revise')?.invoke, '/revise')
  assert.equal(guessSkill(mine, 'exec')?.invoke, '/acme-exec')
  assert.equal(guessSkill([sk('/humanizer')], 'review'), undefined)
})
