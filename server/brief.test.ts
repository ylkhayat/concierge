import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brief } from './brief.ts'

test('a background command in a few words', () => {
  assert.equal(brief('B=/home/x/wt/AC-1336; cd $B && pnpm nx test ai-core > /tmp/t.log 2>&1'), 'pnpm nx test ai-core')
  assert.equal(brief('cd libs/x && PYTHONPATH=. uv run pytest -q tests/eval 2>&1 | tee e.log'), 'uv run pytest -q tests/eval')
  assert.equal(brief('nohup pnpm dev &'), 'pnpm dev')
  assert.equal(brief('sleep 600'), 'sleep 600')
  assert.equal(brief('B=/x; until grep -q passed $B/validate.log && grep -q ok $B/eval-en.log; do sleep 15; done; echo UNIT'), 'waits for validate.log, eval-en.log to finish')
  assert.equal(brief('B=/home/x/AI-1; setsid nohup env -u NODE_ENV npx nx run backend:typecheck > $B/tsc.log 2>&1 < /dev/null &'), 'npx nx run backend:typecheck')
})
