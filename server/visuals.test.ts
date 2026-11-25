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
  assert.match(p, /Storybook/); assert.match(p, /Playwright/); assert.match(p, /before-<name>-<viewport>\.png and after-<name>-<viewport>\.png/)
  assert.match(p, /storybook-stories skill/); assert.match(p, /parameters\.capture\.viewports/); assert.match(p, /phone \(375 wide\) and laptop \(1280 wide\)/)
  assert.match(p, /\/s\/visuals\/x\/bbbbbbbcccc/); assert.match(p, /src\/components\/Course\.tsx/); assert.match(p, /also at phone width/)
  assert.match(p, /Never push/)
  assert.match(capturePrompt({ pr, out: '/o', files: [], said: 'the empty state', again: true }), /^the empty state[\s\S]*Capture again/)
})

test('what a file is: a route page a screen, a layout or shell a layout, anything else a component', async () => {
  const { kindOf } = await import('./visuals.ts')
  assert.equal(kindOf('apps/rumanna/app/(app)/board/page.tsx'), 'screen')
  assert.equal(kindOf('apps/buffehgi/app/(app)/layout.tsx'), 'layout')
  assert.equal(kindOf('apps/rumanna/components/layout/AppShell.tsx'), 'layout')
  assert.equal(kindOf('src/screens/Course.tsx'), 'screen')
  assert.equal(kindOf('apps/rumanna/components/board/BoardRail.tsx'), 'component')
})

test('the impact an agent reports is kept to repository paths, and an affected part only with a changed one that reaches it', async () => {
  const { impactOf } = await import('./visuals.ts')
  const im = impactOf({
    changed: [{ name: 'LevelChip', file: 'apps/rumanna/components/LevelChip.tsx' }, { name: 'Evil', file: '../../etc/passwd' }],
    affected: [
      { name: 'CourseCard', file: 'apps/rumanna/components/CourseCard.tsx', via: ['LevelChip'], depth: 1 },
      { name: 'Board', file: 'apps/rumanna/app/(app)/board/page.tsx', via: ['LevelChip', 'Nope'], depth: 9 },
      { name: 'Orphan', file: 'apps/x/Orphan.tsx', via: ['Nope'] },
    ],
  })!
  assert.deepEqual(im.changed.map((c) => [c.name, c.kind]), [['LevelChip', 'component']]) // the path out of the repo is dropped
  assert.deepEqual(im.affected.map((a) => [a.name, a.kind, a.via, a.depth]), [['CourseCard', 'component', ['LevelChip'], 1], ['Board', 'screen', ['LevelChip'], 3]])
  assert.equal(impactOf({ affected: [] }), undefined)
})

test('the capture maps the impact first, then shoots changed components in focus and affected screens whole', async () => {
  const { capturePrompt } = await import('./visuals.ts')
  const p = capturePrompt({ pr: { id: 'a/b#1', number: 1, title: 't', base: 'main', head: 'x', headSha: 'abcdef1234' }, out: '/o', files: [] })
  assert.match(p, /First, the impact/); assert.match(p, /up to three imports away/); assert.match(p, /Changed, in focus/); assert.match(p, /Affected, for context/)
  assert.match(p, /locator screenshot/); assert.match(p, /"lens":"changed"\|"affected"/); assert.match(p, /"impact":\{"changed"/)
})

test('annotations are kept to boxes inside the image, a dozen at most, each naming its part', async () => {
  const { marksOf } = await import('./visuals.ts')
  const m = marksOf([
    { x: 10, y: 20, w: 30, h: 10, part: 'LevelChip', label: 'chips instead of text', side: 'after' },
    { x: 90, y: 95, w: 40, h: 40, part: 'Rail' }, // runs off the edge: cut to the image
    { x: 50, y: 50, w: 0, h: 10 }, // nothing to outline
    { x: 'a', y: null, w: 5, h: 5, side: 'sideways' },
  ])!
  assert.deepEqual(m[0], { x: 10, y: 20, w: 30, h: 10, part: 'LevelChip', label: 'chips instead of text', side: 'after' })
  assert.deepEqual(m[1], { x: 90, y: 95, w: 10, h: 5, part: 'Rail' })
  assert.deepEqual(m[2], { x: 0, y: 0, w: 5, h: 5 }) // the side it named isn't one: dropped
  assert.equal(m.length, 3)
  assert.equal(marksOf('nope'), undefined)
  assert.equal(marksOf(Array.from({ length: 30 }, () => ({ x: 1, y: 1, w: 5, h: 5 })))!.length, 12)
})

test('setting a Storybook up goes through the three skills, as a PR, and ends with the first shot of every story', async () => {
  const { setupPrompt, baselineId, slugOf } = await import('./visuals.ts')
  const p = setupPrompt({ repo: 'ylkhayat/elbuffeh', dir: '/s/visuals/repo-ylkhayat-elbuffeh', said: 'start with rumanna' })
  for (const skill of ['storybook-architecture', 'storybook-stories', 'design-docs']) assert.match(p, new RegExp(`${skill} skill`))
  assert.match(p, /storybook\/setup/); assert.match(p, /open the PR/); assert.match(p, /there is no before: this is the baseline/)
  assert.match(p, /start with rumanna/); assert.match(p, /PR <url>/)
  assert.equal(slugOf(baselineId('ylkhayat/elbuffeh')), 'repo-ylkhayat-elbuffeh')
})

test('with Storybook, the capture reads its components manifest and tests the stories it writes; the setup installs the agent tooling', async () => {
  const { capturePrompt, setupPrompt } = await import('./visuals.ts')
  const c = capturePrompt({ pr: { id: 'a/b#1', number: 1, title: 't', base: 'main', head: 'x', headSha: 'abcdef1234' }, out: '/o', files: [] })
  assert.match(c, /\/manifests\/components\.json/); assert.match(c, /iframe\.html\?id=<story id>/); assert.match(c, /vitest --project=storybook/)
  const s = setupPrompt({ repo: 'a/b', dir: '/d' })
  for (const x of ['@storybook/addon-mcp', '@storybook/addon-vitest', 'features.componentsManifest', '@summary', 'prop combinations in controls']) assert.ok(s.includes(x), x)
})

test('the baseline carries the board: screens by domain and step, each with every component on it', async () => {
  const { setupPrompt, setsOf, shotsDir, baselineId } = await import('./visuals.ts')
  const p = setupPrompt({ repo: 'a/b', dir: '/d' })
  assert.match(p, /as a storyline/); assert.match(p, /The blueprint is a map of the project/); assert.match(p, /"domain":"<Domain>","variant"/); assert.match(p, /one mark per component instance/)
  const id = baselineId('ylkhayat/elbuffeh'), dir = shotsDir(id, 'ccccccc')
  mkdirSync(dir, { recursive: true })
  const marks = Array.from({ length: 70 }, (_, i) => ({ x: i, y: 1, w: 1, h: 5, part: 'Chip' }))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ head: 'ccccccc', at: '2026-11-25T10:00:00Z', source: 'storybook', shots: [
    { name: 'Courses · empty', domain: 'Courses', variant: 'empty', after: 'after-board-a.png', marks },
    { name: 'Chip · default', lens: 'changed', part: 'Chip', after: 'after-chip.png', marks },
  ] }))
  const [set] = await setsOf(id)
  assert.deepEqual([set.shots[0].domain, set.shots[0].variant, set.shots[0].marks!.length], ['Courses', 'empty', 60]) // a screen keeps many marks
  assert.deepEqual([set.shots[1].domain, set.shots[1].marks!.length], [undefined, 12]) // a capture, its few
})

test('a baseline serves its built Storybook, and nothing else: no PR capture, no path out of its folder', async () => {
  const { storybookFile, shotsDir, baselineId, slugOf, setsOf } = await import('./visuals.ts')
  const id = baselineId('ylkhayat/live'), slug = slugOf(id), dir = join(shotsDir(id, 'ddddddd'), 'storybook', 'rumanna')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'iframe.html'), '<html></html>'); writeFileSync(join(dir, 'assets', 'a-B1.js'), '1')
  assert.ok(await storybookFile(slug, 'ddddddd', 'rumanna/iframe.html'))
  assert.ok(await storybookFile(slug, 'ddddddd', 'rumanna/assets/a-B1.js'))
  assert.equal(await storybookFile(slug, 'ddddddd', 'rumanna/../../manifest.json'), undefined)
  assert.equal(await storybookFile(slug, 'ddddddd', 'rumanna/.env'), undefined)
  assert.equal(await storybookFile('ylkhayat-elbuffeh-40', 'ddddddd', 'rumanna/iframe.html'), undefined) // a PR's capture: never a page
  writeFileSync(join(shotsDir(id, 'ddddddd'), 'manifest.json'), JSON.stringify({ head: 'ddddddd', at: '2026-11-25T10:00:00Z', source: 'storybook', shots: [
    { name: 'A', domain: 'Courses', variant: 'empty', after: 'a.png', book: 'rumanna', story: 'screens-courses--empty', height: 1400 },
    { name: 'B', domain: 'Courses', variant: 'x', after: 'b.png', book: '../up', story: 'bad id!', height: -3 },
  ] }))
  const [set] = await setsOf(id)
  assert.deepEqual([set.shots[0].book, set.shots[0].story, set.shots[0].height], ['rumanna', 'screens-courses--empty', 1400])
  assert.deepEqual([set.shots[1].book, set.shots[1].story, set.shots[1].height], [undefined, undefined, undefined])
})

test('the board alone, for a baseline set up before it: screens, the built Storybook, marks, the earlier shots kept', async () => {
  const { boardPrompt } = await import('./visuals.ts')
  const p = boardPrompt({ repo: 'ylkhayat/elbuffeh', dir: '/d', last: '84ff594', said: 'rumanna first' })
  assert.match(p, /needs its screens/); assert.match(p, /Save into \/d\//); assert.match(p, /the manifest of \/d\/84ff594\/ as it is \(copy its images too\)/)
  assert.match(p, /"book":"<package name>","story":"<story-id>"/); assert.match(p, /one mark per component instance/); assert.match(p, /rumanna first/)
})

test('the method is a skill of yours when a machine has it: its words take the built-in ones\' place, the ask and the format stay Concierge\'s', async () => {
  const { capturePrompt, boardPrompt, setupPrompt, METHODS } = await import('./visuals.ts')
  const pr = { id: 'a/b#1', number: 1, title: 't', base: 'main', head: 'x', headSha: 'abcdef1234' }
  const mine = capturePrompt({ pr, out: '/o', files: [], how: 'MY WAY OF CAPTURING' })
  assert.match(mine, /MY WAY OF CAPTURING/); assert.ok(!mine.includes(METHODS.capture.slice(0, 60))) // the skill's, not the built-in
  assert.match(mine, /pull request #1/); assert.match(mine, /Save into \/o/); assert.match(mine, /"impact":\{"changed"/) // the ask and the format, as ever
  assert.ok(capturePrompt({ pr, out: '/o', files: [] }).includes(METHODS.capture)) // no skill here: Concierge's own words
  const b = boardPrompt({ repo: 'a/b', dir: '/d', how: 'MY WAY OF DRAWING' })
  assert.match(b, /MY WAY OF DRAWING/); assert.ok(!b.includes('as a storyline')); assert.match(b, /"domain":"<Domain>"/)
  const s = setupPrompt({ repo: 'a/b', dir: '/d', how: 'MY SETUP', map: 'MY MAP' })
  assert.match(s, /MY SETUP/); assert.match(s, /MY MAP/); assert.match(s, /PR <url>/)
})
