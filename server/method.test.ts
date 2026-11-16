import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// a home of its own, before anything reads ~/.claude
const home = mkdtempSync(join(tmpdir(), 'rd-method-'))
process.env.HOME = home
const skill = (name: string, body: string) => {
  mkdirSync(join(home, '.claude', 'skills', name), { recursive: true })
  writeFileSync(join(home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n\n${body}\n`)
}
const { method, skillFor, FEATURES } = await import('./method.ts')
const { config } = await import('./config.ts')

test("a feature's method is its skill's instructions, then the format Concierge reads", async () => {
  skill('brief-ticket', 'Brief them plainly.')
  assert.equal(await method('brief', 'The text field holds the brief.'), 'Brief them plainly.\n\nThe text field holds the brief.')
})

test('the skill picked in Settings wins over the default, and an empty pick means the default', async () => {
  skill('my-brief', 'Mine.')
  config.skills = { brief: 'my-brief' }
  assert.equal(skillFor('brief'), 'my-brief')
  assert.equal(await method('brief'), 'Mine.')
  config.skills = { brief: ' ' }
  assert.equal(skillFor('brief'), FEATURES.brief.skill)
  config.skills = undefined
})

test('a missing skill says which one and where to pick another', async () => {
  await assert.rejects(method('standup'), /"write-standup" isn't installed: install it, or pick another in Settings → Skills/)
})
