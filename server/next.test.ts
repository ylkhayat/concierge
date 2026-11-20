import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromAgent, proseOf } from './next.ts'

const block = (json: string) => `Reviewed #12: two findings in crit.\n\n\`\`\`deck-next\n${json}\n\`\`\`\n`

test('the decisions block is split off the prose and read as data', () => {
  const { text, steps } = fromAgent(block(JSON.stringify({
    decisions: [
      { topic: 'Retry cap', question: 'Keep the cap at 3?', options: [{ label: 'Keep 3', reply: 'keep it', recommended: true }, { label: 'Raise' }] },
      { topic: 'Post as', question: 'Comments or approve?', why: 'decides what lands on GitHub', blocking: true, options: [{ label: 'Comments', reply: 'post as comments' }] },
    ],
    actions: [{ label: 'Push & reply', reply: 'push', kind: 'publish' }, { label: 'Odd', kind: 'launch' }],
  })))
  assert.equal(text, 'Reviewed #12: two findings in crit.')
  assert.equal(steps?.source, 'agent')
  assert.equal(steps?.costUsd, 0)
  // blocking first; a missing reply falls back to the label
  assert.deepEqual(steps?.decisions.map((d) => d.topic), ['Post as', 'Retry cap'])
  assert.equal(steps?.decisions[0].why, 'decides what lands on GitHub')
  assert.deepEqual(steps?.decisions[1].options[1], { label: 'Raise', reply: 'Raise' })
  // an unknown kind is kept, as other
  assert.deepEqual(steps?.actions.map((a) => a.kind), ['publish', 'other'])
})

test('nothing asked is an answer too: no small-model read afterwards', () => {
  const { steps } = fromAgent(block('{"decisions":[],"actions":[]}'))
  assert.deepEqual(steps, { steps: [], decisions: [], actions: [], costUsd: 0, source: 'agent' })
  assert.deepEqual(fromAgent(block('{"steps":[]}')).steps, { steps: [], decisions: [], actions: [], costUsd: 0, source: 'agent' })
})

test('no block, or one that does not parse: the prose is read the old way', () => {
  assert.equal(fromAgent('Done, nothing else.').steps, undefined)
  const bad = fromAgent(block('{"decisions": ['))
  assert.equal(bad.steps, undefined)
  assert.equal(bad.text, 'Reviewed #12: two findings in crit.') // the broken block still stays out of the summary
  // a block that is not at the end is part of the message, not its hand-back
  assert.equal(fromAgent(`${block('{}')}\nOne more thing.`).steps, undefined)
})

test('decisions without a question or options are dropped', () => {
  const { steps } = fromAgent(block('{"decisions":[{"topic":"x","question":"","options":[{"label":"a"}]},{"topic":"y","question":"q?","options":[]}],"actions":[]}'))
  assert.deepEqual(steps?.decisions, [])
})

test('the feed shows the prose only', () => {
  assert.equal(proseOf(block('{"decisions":[],"actions":[]}')), 'Reviewed #12: two findings in crit.')
  assert.equal(proseOf('plain'), 'plain')
})

test('a step that only watches CI is not one for you', async () => {
  const { watchesCi } = await import('./next.ts')
  assert.equal(watchesCi("Read #5456's CI once it finishes and fix anything red"), true)
  assert.equal(watchesCi('Move DA-1292 to In Review once CI is green'), false)
  assert.equal(watchesCi('Force-push the rebased branch'), false)
})
