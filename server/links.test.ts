import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areaOf, suggestPr } from './links.ts'

test('a PR\'s area comes from its title\'s scope, else its branch', () => {
  assert.equal(areaOf('feat(backend): ENG-1064 call pilot users'), 'backend')
  assert.equal(areaOf('fix(worker): ENG-1162 retry'), 'worker')
  const areas = { 'web-app': ['webapp', 'frontend', 'settings page'], worker: ['queue', 'jobs'], backend: ['cron', 'scheduler'] }
  assert.equal(areaOf('Some title', 'eng-1064-web-app-daily-call-setting', areas), 'web-app')
  assert.equal(areaOf('Some title', 'eng-1070-frontend-toggle', areas), 'web-app') // one of its words
  assert.equal(areaOf('Some title', 'eng-1064-web-app', {}), '') // no areas set: no guess
})

test('the next step goes to the PR the report is about, and to none when nothing stands out', () => {
  const areas = { 'web-app': ['webapp', 'frontend', 'settings page'], worker: ['queue', 'jobs'], backend: ['cron', 'scheduler'] }
  const prs = [{ number: 4256, area: 'backend' }, { number: 4262, area: 'web-app' }, { number: 4264, area: 'worker' }]
  assert.equal(suggestPr('The settings page needs the frontend toggle; the web-app row is missing.', prs, areas)?.number, 4262)
  assert.equal(suggestPr('Fix the scheduler in apps/backend and the cron job', prs, areas)?.number, 4256)
  assert.equal(suggestPr('Reply to the review on #4264 about the queue', prs, areas)?.number, 4264)
  assert.equal(suggestPr('Nothing specific here.', prs, areas), undefined)
  assert.equal(suggestPr('backend and frontend both need it', prs, areas), undefined) // a tie: no guess
})
