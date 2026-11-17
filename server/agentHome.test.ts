import assert from 'node:assert/strict'
import { mkdtemp, lstat, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { adapted, link, marketplaceSource, sessionDir, wantedSkills } from './agentHome.ts'

test("your settings come over without what only runs on your machine", () => {
  const yours = { hooks: { Stop: [{ hooks: [{ command: '/Users/me/bin/notify' }] }] }, statusLine: { command: '/Users/me/bin/line' }, enabledPlugins: { 'linear@official': true }, permissions: { allow: ['Read'] } }
  assert.deepEqual(adapted(yours), { enabledPlugins: { 'linear@official': true }, permissions: { allow: ['Read'] } })
  assert.ok('hooks' in yours) // yours is not changed
})

test('a marketplace is added the way your settings declare it', () => {
  assert.equal(marketplaceSource({ source: { source: 'github', repo: 'o/r' } }), 'o/r')
  assert.equal(marketplaceSource({ source: { source: 'git', url: 'https://x/y.git' } }), 'https://x/y.git')
  assert.equal(marketplaceSource(undefined), undefined)
  assert.equal(sessionDir('/home/me/code/'), '-home-me-code')
})

test('a link is made once, redone when it points elsewhere, and never replaces a folder of its own', async () => {
  const d = await mkdtemp(join(tmpdir(), 'ch-')), a = join(d, 'a'), b = join(d, 'b'), here = join(d, 'here')
  await writeFile(a, 'A'); await writeFile(b, 'B')
  await link(a, here); assert.equal(await readlink(here), a)
  await link(b, here); assert.equal(await readlink(here), b) // pointed at another machine's path: redone
  await link(join(d, 'missing'), join(d, 'none')); await assert.rejects(lstat(join(d, 'none'))) // nothing to link to
  const file = join(d, 'file'); await writeFile(file, 'copy from another machine')
  await link(a, file); assert.equal(await readFile(file, 'utf8'), 'copy from another machine') // left alone…
  await link(a, file, true); assert.equal(await readlink(file), a) // …unless it is one that must be a link
})

test("the other tools' skills folder: your skills, your commands as skills, then the plugins', the first of a name winning", async () => {
  const d = await mkdtemp(join(tmpdir(), 'sk-')), put = async (p: string) => { await mkdir(join(d, p, '..'), { recursive: true }); await writeFile(join(d, p), 'x') }
  await put('skills/review/SKILL.md'); await put('skills/.removed/old/SKILL.md'); await put('skills/notes.txt')
  await put('commands/ship.md'); await put('commands/review.md') // a command named like a skill: the skill stays
  await put('plugin/skills/crit/SKILL.md'); await put('plugin/skills/ship/SKILL.md')
  const want = await wantedSkills(join(d, 'skills'), join(d, 'commands'), [join(d, 'plugin/skills'), join(d, 'missing')])
  assert.deepEqual([...want], [['review', { dir: join(d, 'skills/review') }], ['ship', { file: join(d, 'commands/ship.md') }], ['crit', { dir: join(d, 'plugin/skills/crit') }]])
})
