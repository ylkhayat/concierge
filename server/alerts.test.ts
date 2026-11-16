import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-alerts-'))
const { alert, alerts, seeAlerts } = await import('./alerts.ts')

test('one alert per item holds its updates; a repeat is one update; seen marks it', () => {
  const pr = { kind: 'pr' as const, id: 'o/r#1', label: '#1', title: 'Fix' }
  alert(pr, 'Review started'); alert(pr, 'Review finished', 'ok'); alert(pr, 'Review finished', 'ok')
  alert({ kind: 'ticket', id: 'AI-1', label: 'AI-1', title: 'T' }, 'Exec failed', 'warn')
  const a = alerts().find((x) => x.key === 'pr:o/r#1')!
  assert.deepEqual(a.updates.map((u) => u.text), ['Review started', 'Review finished'])
  assert.equal(alerts().length, 2)
  seeAlerts(['pr:o/r#1'])
  assert.ok(alerts().find((x) => x.key === 'pr:o/r#1')!.seen)
  assert.ok(!alerts().find((x) => x.key === 'ticket:AI-1')!.seen)
})
