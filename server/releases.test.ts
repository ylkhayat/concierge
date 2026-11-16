import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pick, plan, ticketsOf } from './releases.ts'

test('a PR is for the ticket its branch starts with and its title names first; later ids are mentions', () => {
  assert.deepEqual(ticketsOf('fix: AC-1230 keep the export settings', 'ac-1230-export-settings-throws'), ['AC-1230'])
  assert.deepEqual(ticketsOf('perf(patch): AC-1231 lazy-load the locales', 'ac-1231-pageload-p95-regressed-after-ac-1162-fix-was'), ['AC-1231'])
  assert.deepEqual(ticketsOf('chore: back-sync 1.13.1 to beta', 'sync/1.13.1/main-to-beta'), [])
  assert.deepEqual(ticketsOf('fix: keep the window narrow', 'yk/ac-77-narrow'), ['AC-77'])
})

test('the stage means the oldest release still in it', () => {
  const rel = (id: string, createdAt: string, name: string, type = 'started') => ({ id, name: id, createdAt, stage: { name, type } })
  assert.equal(pick([rel('1.13.3', '2026-10-09', 'In Progress'), rel('1.13.2', '2026-10-07', 'In Progress'), rel('1.13.1', '2026-08-16', 'Released', 'completed')], 'In Progress')?.id, '1.13.2')
  assert.equal(pick([rel('1.13.2', '2026-10-07', 'In Progress')], 'Beta'), undefined)
})

test('moving a ticket: into the target, out of the pipeline’s other unshipped releases, released ones kept', () => {
  const r = (id: string, pipeline: string, stageType: string) => ({ id, name: id, pipeline, stageType })
  const p = plan([r('1.13.2', 'desktop-release', 'started'), r('1.13.1', 'desktop-release', 'completed'), r('ios-3', 'mobile-ios', 'started')], { id: 'beta' }, 'desktop-release')
  assert.equal(p.add, true)
  assert.deepEqual(p.remove.map((x) => x.id), ['1.13.2'])
  assert.deepEqual(plan([r('beta', 'desktop-release', 'started')], { id: 'beta' }, 'desktop-release'), { add: false, remove: [] })
})
