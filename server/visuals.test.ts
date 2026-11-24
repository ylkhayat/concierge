// Design's visuals: which PRs change what people see, whether a PR is captured (its own choice, its repository's, its
// workspace's), and the captures as saved: read back safely, newest first, never a file outside their folder.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-visuals-state-'))
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'rd-visuals-config-'))
const { uiChange, wanted, modeOf, setsOf, imagePath, shotsDir, capturePrompt } = await import('./visuals.ts')
const { config } = await import('./store.ts')

test('a PR changes what people see when its markup, components or styles change, or its ticket is marked design', () => {
  const ui = uiChange(['apps/web/src/components/Course.tsx', 'apps/web/src/styles/app.css', 'supabase/migrations/1.sql'], [], 'abc1234')
  assert.equal(ui.is, true); assert.deepEqual(ui.files, ['apps/web/src/components/Course.tsx', 'apps/web/src/styles/app.css'])
  assert.match(ui.why, /2 files people see/)
  // servers, tests, migrations and config don't count
  assert.equal(uiChange(['server/api/course.ts', 'apps/web/src/components/Course.test.tsx', 'apps/web/vite.config.ts', 'supabase/migrations/2.sql'], [], 'x').is, false)
  // a plain .ts counts only where screens live
  assert.equal(uiChange(['apps/web/src/components/useCourse.ts'], [], 'x').is, true)
  assert.equal(uiChange(['packages/lexicon/lookup.ts'], [], 'x').is, false)
  // the ticket says so
  const marked = uiChange(['packages/lexicon/lookup.ts'], ['Feature', 'Design'], 'x')
  assert.equal(marked.is, true); assert.match(marked.why, /marked Design/)
})

test('whether a PR is captured: its own choice first, then its repository, then its workspace; off unless turned on', () => {
  const ui = uiChange(['src/components/A.tsx'], [], 'x'), notUi = uiChange(['server/a.ts'], [], 'x')
  config.visuals = { orgs: { ylkhayat: 'auto' }, repos: { 'ylkhayat/docs': 'always', 'ylkhayat/quiet': 'off' } }
  assert.equal(modeOf('ylkhayat/elbuffeh'), 'auto') // its workspace's
  assert.equal(modeOf('ylkhayat/docs'), 'always'); assert.equal(modeOf('ylkhayat/quiet'), 'off') // its own, over the workspace
  assert.equal(modeOf('bliroio/app'), 'off') // nothing said: off
  assert.equal(wanted('auto', undefined, ui), true); assert.equal(wanted('auto', undefined, notUi), false)
  assert.equal(wanted('always', undefined, notUi), true); assert.equal(wanted('off', undefined, ui), false)
  assert.equal(wanted('off', 'on', notUi), true); assert.equal(wanted('always', 'off', ui), false) // the PR's own choice wins
  delete config.visuals
})

test('captures read back newest first, each image a plain file of its own folder', async () => {
  const pr = 'ylkhayat/elbuffeh#40'
  const old = shotsDir(pr, 'aaaaaaa'), now = shotsDir(pr, 'bbbbbbb')
  for (const d of [old, now]) mkdirSync(d, { recursive: true })
  writeFileSync(join(old, 'manifest.json'), JSON.stringify({ head: 'aaaaaaa', at: '2026-11-24T10:00:00Z', source: 'app', shots: [{ name: 'Course', after: 'after-course.png' }] }))
  writeFileSync(join(now, 'manifest.json'), JSON.stringify({ head: 'bbbbbbb', at: '2026-11-25T10:00:00Z', source: 'storybook', summary: 'Levels as chips', shots: [{ name: 'Course', before: 'before-course.png', after: 'after-course.png' }, { name: 'Sneaky', after: '../../../etc/passwd' }] }))
  writeFileSync(join(now, 'after-course.png'), 'png')
  const sets = await setsOf(pr)
  assert.deepEqual(sets.map((s) => s.sha), ['bbbbbbb', 'aaaaaaa'])
  assert.equal(sets[0].source, 'storybook'); assert.equal(sets[0].summary, 'Levels as chips')
  assert.equal(sets[0].shots[1].after, undefined) // a path out of the folder is dropped
  assert.ok(await imagePath(pr, 'bbbbbbb', 'after-course.png'))
  assert.equal(await imagePath(pr, 'bbbbbbb', '../manifest.json'), undefined)
  assert.equal(await imagePath(pr, 'not-a-sha', 'after-course.png'), undefined)
  assert.equal(await imagePath(pr, 'bbbbbbb', 'before-course.png'), undefined) // named, but not there
})

test('the capture asks for before and after, from stories when there are any, into the PR commit\'s own folder', () => {
  const pr = { id: 'ylkhayat/elbuffeh#40', number: 40, title: 'Levels as chips', base: 'main', head: 'elbu-3', headSha: 'bbbbbbbcccc' }
  const p = capturePrompt({ pr, out: '/s/visuals/x/bbbbbbbcccc', files: ['src/components/Course.tsx'], said: 'also at phone width' })
  assert.match(p, /Storybook/); assert.match(p, /Playwright/); assert.match(p, /before-<screen>\.png and after-<screen>\.png/)
  assert.match(p, /\/s\/visuals\/x\/bbbbbbbcccc/); assert.match(p, /src\/components\/Course\.tsx/); assert.match(p, /also at phone width/)
  assert.match(p, /Never push/)
  assert.match(capturePrompt({ pr, out: '/o', files: [], said: 'the empty state', again: true }), /^the empty state[\s\S]*Capture again/)
})
