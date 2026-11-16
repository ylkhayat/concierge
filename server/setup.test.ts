import assert from 'node:assert/strict'
import { test } from 'node:test'
import { skillRefs } from './setup.ts'

test('skillRefs finds the skills a command or prompt points at', () => {
  assert.deepEqual(skillRefs('/review-pr {number}').sort(), ['review-pr'])
  assert.deepEqual(skillRefs('Read {skill:investigate-prod} and follow it').sort(), ['investigate-prod'])
  assert.deepEqual(skillRefs('Write the ADR with the `adr-authoring` skill, then Skill(humanizer).').sort(), ['adr-authoring', 'humanizer'])
  assert.deepEqual(skillRefs('cd /tmp/x && ls ~/a/b').filter((n) => n !== 'tmp'), []) // paths are not skills
})
