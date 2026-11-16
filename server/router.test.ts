import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'deck-router-'))
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'deck-router-config-'))

test('clear tickets are planned by rule: an agent session, a bug in production or development', async () => {
  const { byRules } = await import('./router.ts')
  const rules = [
    { match: '\\b[0-9a-f]{24}\\b|\\bsession[ _-]?id\\b', unless: '\\bfeat\\b', skill: 'session-investigator', why: 'the ticket names an agent session' },
    { match: '^(?=[\\s\\S]*\\bfeat\\b)[\\s\\S]*(\\b[0-9a-f]{24}\\b|\\bsession[ _-]?id\\b)', skill: 'session-investigator-feat', why: 'an agent session on the feature environment' },
    { bug: true, env: 'prod' as const, skill: 'investigate-prod', why: 'a problem in production' },
    { bug: true, env: 'dev' as const, skill: 'investigate-dev', why: 'a problem in development' },
  ]
  const have = new Set(['session-investigator', 'session-investigator-feat', 'investigate-prod', 'investigate-dev'])
  const names = (p?: { skills: { name: string }[] }) => p?.skills.map((s) => s.name)
  assert.deepEqual(names(byRules({ id: 'ENG-1', title: 'The assistant ignored the calendar', description: 'session 66f1c2e9a4b5c6d7e8f90a1b' }, have, rules)), ['session-investigator'])
  assert.deepEqual(names(byRules({ id: 'ENG-2', title: 'Agent loops on feat', description: 'session_id 66f1c2e9a4b5c6d7e8f90a1b on feat' }, have, rules)), ['session-investigator-feat'])
  const prod = byRules({ id: 'APP-3', title: 'User Feedback: meeting detection broken on Windows', env: 'prod' }, have, rules)
  assert.deepEqual(names(prod), ['investigate-prod']); assert.equal(prod?.env, 'prod'); assert.equal(prod?.by, 'rules')
  assert.equal(byRules({ id: 'ENG-4', title: 'Add a dark mode toggle' }, have, rules), undefined) // a feature, no signal: the model decides
  assert.equal(byRules({ id: 'ENG-5', title: 'Crash on login', env: 'prod' }, new Set(), rules), undefined) // the skill isn't there: nothing by rule
  assert.equal(byRules({ id: 'ENG-6', title: 'Crash on login', env: 'prod' }, have, []), undefined) // no rules set: nothing by rule
})
