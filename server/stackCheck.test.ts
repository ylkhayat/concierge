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

test("the boiled-down plan never loses or invents: only real items and options, each item once, the rest back as it was", async () => {
  const { settle } = await import('./stackPlan.ts')
  const items = [
    { id: '1:0', pr: 1, kind: 'decide' as const, text: 'Where do tools live?', options: ['top-level', 'in the state'], recommended: 0 },
    { id: '2:0', pr: 2, kind: 'decide' as const, text: 'Tools inside the state?', options: ['yes', 'no'] },
    { id: '1:1', pr: 1, kind: 'do' as const, text: 'Rebase #2' }, { id: '2:1', pr: 2, kind: 'do' as const, text: 'Rebase onto #1' },
    { id: '2:2', pr: 2, kind: 'publish' as const, text: 'Push' }, { id: '3:0', pr: 3, kind: 'do' as const, text: 'Forgotten by the model' },
    { id: '3:1', pr: 3, kind: 'decide' as const, text: 'Also forgotten', options: ['a', 'b'], recommended: 1 },
  ]
  const p = settle(items, {
    summary: 's',
    decisions: [{ question: 'Where do the tools live?', why: 'w', suggested: 0, options: [
      { label: 'Top level', picks: [{ id: '1:0', option: 0 }, { id: '2:0', option: 1 }, { id: '9:9', option: 0 }] },
      { label: 'In the state', picks: [{ id: '1:0', option: 1 }, { id: '2:0', option: 0 }] }] },
      { question: 'made up', why: '', suggested: 5, options: [{ label: 'x', picks: [{ id: '2:0', option: 7 }] }, { label: 'y', picks: [] }] }],
    steps: [{ text: 'Rebase #2 onto #1', why: '', items: ['1:1', '2:1', 'nope'], public: false, on: true }, { text: 'Push #2', why: '', items: ['2:2', '1:1'], public: false, on: true }],
    skipped: [],
  })
  assert.deepEqual(p.decisions[0].options.map((o) => o.picks.map((x) => `${x.id}=${x.option}`)), [['1:0=0', '2:0=1'], ['1:0=1', '2:0=0']]) // the made-up id is gone
  assert.equal(p.decisions.length, 2) // the made-up decision is gone; the forgotten one came back as its own
  assert.deepEqual([p.decisions[1].question, p.decisions[1].suggested, p.decisions[1].options.map((o) => o.label)], ['#3: Also forgotten', 1, ['a', 'b']])
  assert.deepEqual(p.steps.map((s) => [s.items, s.public]), [[['1:1', '2:1'], false], [['2:2'], true], [['3:0'], false]]) // an item is in one step only; a publish makes its step public
})

test("a stack's direction is found from any of its PRs, replaces an older one, and is what a run on it is told", async () => {
  const { directionNote, directionOf, setDirection } = await import('./stackDirection.ts')
  const chain = [{ repo: 'o/r', number: 1 }, { repo: 'o/r', number: 2 }]
  setDirection(chain, '- Tools live at the top level', 'check')
  assert.equal(directionOf({ repo: 'o/r', number: 2 })?.text, '- Tools live at the top level')
  assert.match(directionNote({ repo: 'o/r', number: 1 }), /stack \(#1, #2\)[\s\S]*Tools live at the top level/)
  setDirection([{ repo: 'o/r', number: 2 }, { repo: 'o/r', number: 3 }], '- Yours', 'you') // restacked: #2 now sits with #3
  assert.equal(directionOf({ repo: 'o/r', number: 3 })?.by, 'you')
  assert.equal(directionOf({ repo: 'o/r', number: 1 }), undefined) // one direction per stack: the older one went with #2
  assert.equal(directionNote({ repo: 'o/r', number: 9 }), '')
  setDirection([{ repo: 'o/r', number: 3 }], '', 'you')
  assert.equal(directionOf({ repo: 'o/r', number: 2 }), undefined)
})
