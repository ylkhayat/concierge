import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advise, scoreSkills, type Run } from './skills.ts'

const run = (o: Partial<Run>): Run => ({ at: '2026-11-10T10:00:00Z', entity: 'job', id: 'acme/api#1', run: o.at ?? 'r', to: 'done', cause: 'result', restarts: 0, ...o } as Run)

test('a skill scores from how its runs went, and advice follows from it', () => {
  const good = Array.from({ length: 4 }, (_, i) => run({ id: `acme/api#${i}`, at: `2026-11-0${i + 1}T10:00:00Z`, skills: ['review-pr'] }))
  const bad = [
    run({ id: 'ENG-1', entity: 'exec', at: '2026-11-01T10:00:00Z', to: 'failed', skills: ['investigate'], steers: 3, refused: 2 }),
    run({ id: 'ENG-1', entity: 'exec', at: '2026-11-01T12:00:00Z', queuedAt: '2026-11-01T11:00:00Z', skills: ['investigate'], steers: 4 }), // ran again within two hours
    run({ id: 'ENG-2', entity: 'exec', at: '2026-11-02T10:00:00Z', to: 'failed', skills: ['investigate'], steers: 2 }),
  ]
  const rows = scoreSkills([...good, ...bad, run({ to: 'running', skills: ['review-pr'] })]) // a run still going isn't counted
  const r = rows.find((s) => s.name === 'review-pr')!, i = rows.find((s) => s.name === 'investigate')!
  assert.equal(r.runs, 4)
  assert.equal(r.score, 100)
  assert.equal(r.verdict, 'good')
  assert.equal(i.runs, 3); assert.equal(i.failed, 2); assert.equal(i.followed, 1)
  assert.equal(i.verdict, 'fix')
  assert.ok(i.reasons.some((x) => /failed/.test(x)) && i.reasons.some((x) => /stepped in/.test(x)))

  const advice = advise(rows, ['review-pr', 'investigate', 'old-one'], { runs: 4, steers: 6, kinds: { exec: 3, review: 1 } }, 30)
  assert.ok(advice.some((a) => a.kind === 'modify' && a.skill === 'investigate'))
  assert.deepEqual(advice.find((a) => a.kind === 'remove' && !a.skill)?.evidence, ['old-one'])
  assert.match(advice.find((a) => a.kind === 'new')!.why, /mostly on tickets/)
})
