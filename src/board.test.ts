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
