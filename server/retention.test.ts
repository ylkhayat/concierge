import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { expired, sweep } from './retention.ts'

const DAY = 86_400_000
test('what went untouched past its rule goes, a folder of one PR as one; anything touched since, or without a rule, stays', async () => {
  const state = mkdtempSync(join(tmpdir(), 'rd-ret-s-')), claude = mkdtempSync(join(tmpdir(), 'rd-ret-c-'))
  const now = Date.now()
  const put = (root: string, rel: string, daysOld: number) => {
    const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'x'.repeat(10))
    const t = new Date(now - daysOld * DAY); utimesSync(p, t, t); return p
  }
  const oldLog = put(state, 'logs/old.jsonl', 61), newLog = put(state, 'logs/new.jsonl', 59)
  const oldExplain = put(state, 'explain/a-b-1/sha.json', 91), midExplain = put(state, 'explain/a-b-2/sha.json', 61)
  // a skill's folder: a copy of someone's sources dated years ago, beside what it wrote this week. It is as old as its newest file
  const copied = put(state, 'revise/da-1500/json-3.12.0/LICENSE', 596), written = put(state, 'revise/da-1500/notes.md', 3)
  const deadCopy = put(state, 'revise/da-9/vendor/LICENSE', 596), deadNote = put(state, 'revise/da-9/notes.md', 70)
  // transcripts: each session on its own, though its project's folder is in use every day
  const oldSession = put(claude, 'projects/-code-app/s.jsonl', 31), newSession = put(claude, 'projects/-code-app/t.jsonl', 2)
  const untouched = put(state, 'atlas/repo.json', 400), db = put(state, 'state.mac.db', 400), own = put(claude, 'settings.json', 400)
  // off (as it ships): counted, nothing removed
  assert.deepEqual(await sweep(now, { state, claude }, false), { files: 5, bytes: 50, removed: false })
  for (const p of [oldLog, oldExplain, oldSession, deadCopy, deadNote]) assert.ok(existsSync(p), p)
  const got = await sweep(now, { state, claude }, true)
  assert.deepEqual(got, { files: 5, bytes: 50, removed: true })
  for (const p of [oldLog, oldExplain, oldSession, deadCopy, deadNote]) assert.ok(!existsSync(p), p)
  for (const p of [newLog, midExplain, copied, written, newSession, untouched, db, own]) assert.ok(existsSync(p), p)
  assert.ok(!existsSync(join(state, 'explain/a-b-1')) && !existsSync(join(state, 'revise/da-9')))
})

test('what is past its rule is not taken from another machine either', () => {
  const now = Date.now()
  assert.ok(expired('state', 'logs/x.jsonl', now - 61 * DAY, now, true))
  assert.ok(!expired('state', 'logs/x.jsonl', now - 61 * DAY, now, false)) // off: nothing is refused for its age
  assert.ok(!expired('state', 'logs/x.jsonl', now - 10 * DAY, now, true))
  assert.ok(!expired('state', 'atlas/x.json', now - 900 * DAY, now, true)) // no rule: kept
  assert.ok(!expired('config', 'logs/x.jsonl', now - 900 * DAY, now, true))
  assert.ok(expired('claude', 'projects/p/s.jsonl', now - 31 * DAY, now, true))
  assert.ok(!expired('state', 'revise/da-1500/json/LICENSE', now - 596 * DAY, now, true)) // a copy's date isn't its own: its folder decides, here
})
