import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composeReply, optionsOf, pendingOf } from './reply.ts'

test('decisions and free text become one reply', () => {
  assert.equal(
    composeReply([{ topic: 'Touch #4185', label: 'Yes, fix it in #4185', reply: 'yes' }, { topic: 'Filing question', label: 'Option 1', reply: 'option 1' }], ' fix all '),
    'My decisions:\n- Touch #4185: Yes, fix it in #4185 ("yes")\n- Filing question: Option 1\n\nfix all',
  )
  assert.equal(composeReply([], 'push'), 'push')
  assert.equal(composeReply([], '  '), '')
})

test('a checklist becomes one clear message: what to do, each decision, and what not to do now', async () => {
  const { composeChecklist } = await import('./reply.ts')
  const steps = [
    { text: 'Fix the null check', kind: 'do' as const, checked: true },
    { text: 'Push the 2 fix commits', kind: 'publish' as const, checked: true },
    { text: 'Post the 3 drafted replies', kind: 'publish' as const, checked: true },
    { text: 'Lookup timeout', kind: 'decide' as const, options: [{ label: 'Keep 30 s', recommended: true }, { label: 'Lower to 10 s' }] },
  ]
  // you untick posting and pick the other timeout
  assert.equal(composeChecklist(steps, { 3: 1 }, { 2: false }, 'Mind the tests.'),
    'Go ahead with:\n- Fix the null check\n- Push the 2 fix commits\n\nMy decisions:\n- Lookup timeout: Lower to 10 s\n\nNot now (don\'t do these):\n- Post the 3 drafted replies\n\nMind the tests.')
  assert.equal(composeChecklist(steps, {}, { 0: false, 1: false, 2: false }, 'Just a question'), 'Just a question') // nothing ticked: only your words
})

test("the agent's block, old or new, reads as a checklist; old moves come unticked, never folded together", async () => {
  const { fromAgent } = await import('./next.ts')
  const fresh = fromAgent('Done.\n```deck-next\n{"steps":[{"text":"Push","kind":"publish","checked":true},{"text":"Timeout","kind":"decide","blocking":true,"options":[{"label":"30 s","recommended":true}]}]}\n```')
  assert.deepEqual(fresh.steps!.steps.map((x) => [x.kind, x.text, x.checked ?? null]), [['decide', 'Timeout', null], ['publish', 'Push', true]]) // a needed decision first
  assert.equal(fresh.steps!.actions[0].kind, 'publish')
  const old = fromAgent('Done.\n```deck-next\n{"decisions":[],"actions":[{"label":"Push & reply","reply":"push and reply","kind":"publish"},{"label":"Stop","reply":"stop","kind":"stop"}]}\n```')
  assert.deepEqual(old.steps!.steps, [{ text: 'Push & reply', kind: 'publish', checked: false }])
})

test('a hand-back that only says stop asks nothing; decisions and moves count', () => {
  assert.equal(pendingOf({ decisions: [], actions: [{ kind: 'stop' }] }), 0)
  assert.equal(pendingOf({ decisions: [{}], actions: [{ kind: 'go' }, { kind: 'stop' }, { kind: 'publish' }] }), 3)
  assert.equal(pendingOf(undefined), 0)
})

test('optionsOf picks the last list of choices in a question', () => {
  assert.deepEqual(optionsOf('Context:\n- a fact\n- another\n\nWhich way?\n1. **Backend cron** for v1\n2) Client timer\n'), ['Backend cron for v1', 'Client timer'])
  assert.deepEqual(optionsOf('Option A: keep it\nOption B: drop it'), ['keep it', 'drop it'])
  assert.deepEqual(optionsOf('No list here.\n- only one'), [])
})

test('steps for another PR go to that PR, the rest stay', async () => {
  const { splitByPr } = await import('./reply.ts')
  const msg = "Go ahead with:\n- Change buildAgenda in #4934 to send { meetings }\n- Make #4933's old field lenient\n- Fix the ADR typo\n\nNot now (don't do these):\n- Post on #4934"
  const r = splitByPr(msg, 4921, new Set([4933, 4934]))
  assert.equal(r.here, "Go ahead with:\n- Fix the ADR typo\n\nNot now (don't do these):\n- Post on #4934")
  assert.deepEqual([...r.there], [[4934, ['- Change buildAgenda in #4934 to send { meetings }']], [4933, ["- Make #4933's old field lenient"]]])
  const all = splitByPr("Go ahead with:\n- Change #4934\n\nNot now (don't do these):\n- Post it", 4921, new Set([4934]))
  assert.equal(all.here, '')
  assert.equal(splitByPr('Go ahead with:\n- Fix #12 here', 4921, new Set([4934])).here, 'Go ahead with:\n- Fix #12 here')
})

test("a step for someone else's PR isn't handed to an agent: it becomes a comment to ask its author for", async () => {
  const { routeSteps } = await import('./reply.ts')
  const r = routeSteps('Go ahead with:\n- #4244: fence the title\n- Open a PR stacked on #4919\n- Fix the typo', 4953, new Set([4919]))
  assert.deepEqual([...r.there], [[4919, ['- Open a PR stacked on #4919']]])
  assert.deepEqual([...r.foreign], [[4244, ['- #4244: fence the title']]])
  assert.equal(r.here, 'Go ahead with:\n- Fix the typo')
})

test('a step handed over is recognised by the hash of its wording: case, punctuation and spacing aside', async () => {
  const { stepHash: h } = await import('./next.ts')
  assert.equal(h('Force-push #5203 with --force-with-lease.'), h('force push #5203 with `force-with-lease`'))
  assert.notEqual(h('Force-push #5203 with --force-with-lease'), h('Rebase #5203 onto #5224'))
})

test('a list row says what the agent asks: the blocking decision first, then how many more', async () => {
  const { askLine } = await import('./reply.ts')
  assert.equal(askLine({ steps: [{ text: 'Push the fix', kind: 'publish' }, { text: 'Keep 30 s?', kind: 'decide', blocking: true }] }), 'Keep 30 s? (+1)')
  assert.equal(askLine({ steps: [{ text: 'Push the fix', kind: 'publish' }] }), 'Push the fix')
  assert.equal(askLine({ steps: [] }), undefined)
})
