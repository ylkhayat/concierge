import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueOf, keyFor, myIssues } from './issues.ts'

const item = (n: number, repo: string, extra = {}) => ({ number: n, title: `Issue ${n}`, body: '', html_url: `https://github.com/${repo}/issues/${n}`,
  repository_url: `https://api.github.com/repos/${repo}`, updated_at: '2026-11-20T00:00:00Z', created_at: '2026-11-19T00:00:00Z', labels: [], comments: 0, ...extra })

test('issues become tickets under a repo key, linked to the PRs that close them', async () => {
  const prs = [{ repo: 'me/elbuffeh', number: 3, url: 'u3', title: 'feat: x', body: 'Fixes #12' }, { repo: 'me/other', number: 4, url: 'u4', title: 't', body: 'Fixes #12' }]
  const got = await myIssues(['me/elbuffeh'], () => false, prs, async () => ({ items: [item(12, 'me/elbuffeh'), item(13, 'me/elbuffeh', { pull_request: {} }), item(9, 'x/untracked')] }))
  assert.deepEqual(got.map((t) => t.id), ['ELBU-12'])
  assert.deepEqual(got[0].prs.map((p) => p.number), [3])
  assert.equal(got[0].stateType, 'started')
  assert.deepEqual(issueOf('ELBU-12'), { repo: 'me/elbuffeh', number: 12 })
  assert.equal(issueOf('AI-12'), undefined)
})

test('a key a Linear team has is not reused', () => {
  assert.equal(keyFor('me/aircore', (k) => k === 'AIRC'), 'AIRA')
})

test("in a repository you own, an issue nobody is assigned to is yours too; elsewhere only your assigned ones", async () => {
  const asked: string[] = []
  const got = await myIssues(['me/elbuffeh', 'acme/api'], () => false, [], async (q) => {
    asked.push(q)
    return q.includes('no:assignee') ? { items: [item(20, 'me/elbuffeh'), item(12, 'me/elbuffeh')] } : { items: [item(12, 'me/elbuffeh'), item(3, 'acme/api')] }
  }, ['me/elbuffeh'])
  assert.deepEqual(got.map((t) => t.url).sort(), ['https://github.com/acme/api/issues/3', 'https://github.com/me/elbuffeh/issues/12', 'https://github.com/me/elbuffeh/issues/20'])
  assert.ok(asked.some((q) => q.includes('no:assignee') && q.includes('repo:me/elbuffeh') && !q.includes('acme/api')))
})
