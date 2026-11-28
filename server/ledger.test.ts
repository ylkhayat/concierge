import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alreadyDid, didNote } from './ledger.ts'

const bash = (text: string) => ({ kind: 'tool', tool: 'Bash', text })
test('a continued run is told what it already sent out, from its own log', () => {
  const feed = [
    bash('git push origin old-run'), { kind: 'section', text: 'Revise #12' }, // an earlier run's: not this one's
    bash('npm test'), bash('git   push --force-with-lease origin feat/x'), { kind: 'tool', tool: 'Read', text: 'git push notes.md' },
    bash('gh pr comment 12 --body "fixed"'), bash('gh pr view 12'), bash('gh api repos/o/r/pulls/12/comments -X POST -f body=hi'),
    bash('gh pr comment 12 --body "fixed"'), { kind: 'text', text: 'I will git push now' },
  ]
  assert.deepEqual(alreadyDid(feed), ['git push --force-with-lease origin feat/x', 'gh pr comment 12 --body "fixed"', 'gh api repos/o/r/pulls/12/comments -X POST -f body=hi'])
  assert.match(didNote(feed), /do not run it again:\n- git push --force-with-lease origin feat\/x\n- gh pr comment/)
  assert.equal(didNote([bash('npm test'), bash('gh pr view 12')]), '')
})
