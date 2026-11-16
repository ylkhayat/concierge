import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// a home with one org's synced skills, and a state of its own
const home = mkdtempSync(join(tmpdir(), 'deck-home-'))
process.env.HOME = home
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'deck-state-'))
const org = join(home, '.claude', 'skills', 'synced', 'org1')
for (const n of ['investigate-dev', 'pdf']) { mkdirSync(join(org, n), { recursive: true }); writeFileSync(join(org, n, 'SKILL.md'), `# ${n}`) }
writeFileSync(join(org, 'manifest.json'), JSON.stringify({ skills: [
  { name: 'investigate-dev', description: 'Debug the dev environment', source: 'custom', creatorType: 'user', updatedAt: '2026-09-08T00:00:00Z' },
  { name: 'pdf', description: 'Read PDFs', source: 'anthropic', creatorType: 'anthropic', updatedAt: '2026-07-10T00:00:00Z' },
] }))

test('org skills: mirrored, offered by fit, and counted when a run loads one', async () => {
  const { orgSkills, skillsIn, skillsNote, syncOrgSkills, setMode } = await import('./orgSkills.ts')
  const { STATE_DIR } = await import('./store.ts')
  await syncOrgSkills()
  assert.equal(readFileSync(join(STATE_DIR, 'org-skills', 'skills', 'investigate-dev', 'SKILL.md'), 'utf8'), '# investigate-dev')
  const dev = orgSkills().find((s) => s.name === 'investigate-dev')!
  assert.equal(dev.mode, 'auto') // the company's own: offered
  assert.equal(orgSkills().find((s) => s.name === 'pdf')!.mode, 'off') // Anthropic's examples: not unless asked
  assert.deepEqual(dev.machines, { 'this machine': 'current' }) // one machine: no name to give it
  assert.match(skillsNote(), /investigate-dev .*Debug the dev environment/)
  assert.doesNotMatch(skillsNote(), /pdf/)
  setMode('pdf', 'always')
  assert.match(skillsNote(), /on every run: pdf/)
  const call = (name: string, input: object) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
  assert.deepEqual(skillsIn(call('Skill', { skill: 'anthropic-skills:investigate-dev' })), ['investigate-dev'])
  assert.deepEqual(skillsIn(call('Read', { file_path: `${org}/investigate-dev/SKILL.md` })), ['investigate-dev'])
  assert.deepEqual(skillsIn(call('Skill', { skill: 'revise' })), []) // not an org skill
})
