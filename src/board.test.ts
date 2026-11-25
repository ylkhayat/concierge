import assert from 'node:assert/strict'
import { test } from 'node:test'
import { partAt } from './board.ts'

test('the component under the pointer is the smallest one there: a chip in a card in the shell', () => {
  const marks = [{ x: 0, y: 0, w: 100, h: 100, part: 'AppShell' }, { x: 18, y: 16, w: 24, h: 32, part: 'CourseCard' }, { x: 20, y: 40, w: 7, h: 4, part: 'LevelChip' }, { x: 50, y: 50, w: 10, h: 10 }]
  assert.equal(partAt(marks, 22, 42), 'LevelChip')
  assert.equal(partAt(marks, 30, 20), 'CourseCard')
  assert.equal(partAt(marks, 90, 90), 'AppShell')
  assert.equal(partAt(marks, 55, 55), 'AppShell') // a mark that names no component is no way in
  assert.equal(partAt([], 10, 10), undefined)
})

test('the board groups screens by application, then domain, keeping the order they were shot in', async () => {
  const { layout, byApp, bare, appOfPart } = await import('./board.ts')
  const sh = (domain: string, variant: string, book?: string, parts: string[] = []) => ({ name: `${domain} · ${variant}`, domain, variant, book, marks: parts.map((part) => ({ x: 0, y: 0, w: 5, h: 5, part })) })
  const screens = [sh('Inbox', 'empty', 'buffehgi'), sh('Inbox', 'full', 'buffehgi'), sh('Vocabulary', 'empty', 'rumanna'), sh('Users', 'all', 'buffehgi'), sh('Rumanna · Rules', 'empty', undefined, ['RuleCard (Rumanna)', 'Pager (Rumanna)'])]
  const g = layout(screens, [])
  assert.deepEqual(g.map((x) => [x.app, x.domains.map((d) => `${d.name}:${d.screens.length}`)]), [['Buffehgi', ['Inbox:2', 'Users:1']], ['Rumanna', ['Vocabulary:1', 'Rules:1']]])
  assert.equal(bare('Pager (Rumanna)'), 'Pager'); assert.equal(appOfPart('Pager', 'apps/buffehgi/components/Pager.tsx'), 'Buffehgi'); assert.equal(appOfPart('Button'), undefined)
  const lists = byApp(['Pager (Rumanna)', 'Pager (Buffehgi)', 'RuleCard (Rumanna)', 'Logo'], [], (n) => (n.startsWith('Rule') ? 5 : 1))
  assert.deepEqual(lists.map((x) => [x.app, x.names]), [['Buffehgi', ['Pager (Buffehgi)']], ['Rumanna', ['RuleCard (Rumanna)', 'Pager (Rumanna)']], [undefined, ['Logo']]])
})

test('zooming to a component centres it, fills about three quarters of the view, and never shows past the screen', async () => {
  const { focusOn } = await import('./board.ts')
  assert.deepEqual(focusOn({ x: 0, y: 0, w: 100, h: 100 }), { s: 1, tx: 0, ty: 0 }) // the whole screen: as it is
  const chip = focusOn({ x: 40, y: 40, w: 10, h: 10 })
  assert.equal(chip.s, 4) // small: as close as it goes
  assert.deepEqual([chip.tx, chip.ty], [50 - 45 * 4, 50 - 45 * 4]) // its middle in the middle
  const corner = focusOn({ x: 0, y: 0, w: 25, h: 25 })
  assert.deepEqual([corner.s, corner.tx, corner.ty], [3, 0, 0]) // at the edge: the screen's edge stays put
})
