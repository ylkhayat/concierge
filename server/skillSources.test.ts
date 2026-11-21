// A skill source gives the agents its skills (skills/<name>/SKILL.md) and its commands (commands/<name>.md), each
// command as a skill of its name; a skill and a command of one name: the skill.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-sources-'))
const { config } = await import('./store.ts')
const { sourceSkills } = await import('./setup.ts')
const { CONCIERGE_SKILLS } = await import('./agentHome.ts')

test('a source gives its skills and its commands, each command as a skill of its name', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'rd-source-repo-'))
  const put = (f: string, t: string) => { mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), t) }
  put('skills/review-stack/SKILL.md', '---\ndescription: a skill\n---\n')
  put('commands/bliro-exec.md', '---\ndescription: a command\n---\nbody')
  put('commands/review-stack.md', 'a command named like the skill')
  for (const a of [['init', '-q'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x']]) execFileSync('git', ['-C', repo, ...a])
  config.skillSources = [repo]
  const got = await sourceSkills()
  assert.deepEqual(got.map((s) => s.name), ['bliro-exec', 'review-stack'])
  assert.ok(got.every((s) => s.source && got[0].source === s.source)) // both from that one source
  assert.match(readFileSync(join(CONCIERGE_SKILLS, 'bliro-exec', 'SKILL.md'), 'utf8'), /a command/)
  assert.match(readFileSync(join(CONCIERGE_SKILLS, 'review-stack', 'SKILL.md'), 'utf8'), /a skill/) // the skill, not the command
})
