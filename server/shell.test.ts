import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { shq } from './shell.ts'

test('a quoted value reaches the shell as itself: nothing in it runs', () => {
  for (const v of ['/code/app', '/code/my app', '/code/$(touch /tmp/pwned)', '/code/`id`', "/code/it's", '/code/"x"; rm -rf ~', '$HOME'])
    assert.equal(execFileSync('sh', ['-c', `printf %s ${shq(v)}`]).toString(), v)
})
