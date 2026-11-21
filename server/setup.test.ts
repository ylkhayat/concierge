import assert from 'node:assert/strict'
import { test } from 'node:test'
import { repoOf, skillRefs } from './setup.ts'

test('skillRefs finds the skills a command or prompt points at', () => {
  assert.deepEqual(skillRefs('/review-pr {number}').sort(), ['review-pr'])
  assert.deepEqual(skillRefs('Read {skill:investigate-prod} and follow it').sort(), ['investigate-prod'])
  assert.deepEqual(skillRefs('Write the ADR with the `adr-authoring` skill, then Skill(humanizer).').sort(), ['adr-authoring', 'humanizer'])
  assert.deepEqual(skillRefs('cd /tmp/x && ls ~/a/b').filter((n) => n !== 'tmp'), []) // paths are not skills
})

test('repoOf reads owner/repo out of a pasted link or the name itself', () => {
  for (const t of ['https://github.com/acme/api', 'https://github.com/acme/api.git', 'git@github.com:acme/api.git', 'github.com/acme/api/pull/12',
    'https://github.com/acme/api/blob/main/src/x.ts', '  acme/api  ', 'acme/api/']) assert.equal(repoOf(t), 'acme/api', t)
  assert.equal(repoOf('https://github.com/my-org/web.app'), 'my-org/web.app')
  for (const t of ['api', 'review tool', 'https://gitlab.com/acme', '']) assert.equal(repoOf(t), undefined, t)
})
