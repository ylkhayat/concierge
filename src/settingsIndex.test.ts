import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SETTINGS, type SettingsPage } from './copy.ts'
import { SETTINGS_INDEX } from './settingsIndex.ts'

const src = ['Settings', 'Connections', 'MachinesSettings', 'LiveUpdates', 'ReviewIn'].map((f) => readFileSync(new URL(`./components/${f}.tsx`, import.meta.url), 'utf8')).join('\n')

test('every setting the search offers is titled that way on a page of Settings', () => {
  const gone = SETTINGS_INDEX.filter((x) => !src.includes(x.has)).map((x) => `${x.say} → "${x.has}"`)
  assert.deepEqual(gone, [], 'Renamed or removed: fix its entry in src/settingsIndex.ts')
})

test('every result opens a page there is, and every page can be found', () => {
  const pages = Object.keys(SETTINGS) as SettingsPage[]
  assert.deepEqual(SETTINGS_INDEX.filter((x) => !pages.includes(x.page)).map((x) => x.say), [])
  assert.deepEqual(pages.filter((p) => p !== 'overview' && !SETTINGS_INDEX.some((x) => x.page === p)), [])
})
