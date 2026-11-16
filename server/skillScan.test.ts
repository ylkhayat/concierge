import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandFor, parseSkill } from './skillScan.ts'

test('a skill file gives its name, description and argument hint', () => {
  const f = parseSkill('---\nname: review-pr\ndescription: "Review a PR: findings in crit"\nargument-hint: <pr-number> [--fast]\n---\n# body')
  assert.deepEqual(f, { name: 'review-pr', description: 'Review a PR: findings in crit', argumentHint: '<pr-number> [--fast]' })
  assert.deepEqual(parseSkill('# no frontmatter'), { name: undefined, description: undefined, argumentHint: undefined })
})

test('a command is built from the argument hint, with the workflow’s placeholders', () => {
  assert.equal(commandFor('/review-pr', '<pr-number> [--fast]', 'review').command, '/review-pr {number}')
  assert.equal(commandFor('/revise', '<repo>#<n>', 'revise').command, '/revise {repo}#{number}')
  assert.equal(commandFor('/my-exec', '[ticket-ids...] [--unattended]', 'exec').command, '/my-exec {ids}')
  assert.equal(commandFor('/revise', '[base ref | pr refs: 123 #123 owner/repo#123 url] [--autonomous]', 'revise').command, '/revise {repo}#{number}', 'a combined placeholder uses up its parts')
  assert.equal(commandFor('/x', undefined, 'review').command, '/x {number}', 'no hint: the main placeholder still goes in')
  assert.deepEqual(commandFor('/x', '<pr> <why>', 'review').args, [{ word: 'pr', token: '{number}' }, { word: 'why' }])
})
