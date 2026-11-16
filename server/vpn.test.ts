import assert from 'node:assert/strict'
import { test } from 'node:test'
import { soundsUnreachable } from './vpn.ts'

test('a run that failed on the network, not on the code', () => {
  for (const t of ["the tool config and Azure logs weren't reachable from here", 'Connect to the VPN first', 'connect ETIMEDOUT 10.0.101.10:443', "I couldn't reach the Key Vault", 'Connection is not an approved private link'])
    assert.ok(soundsUnreachable(t), t)
  for (const t of ['I fixed the timeout in the retry loop', 'All tests pass', 'The PR is reachable at the link below'])
    assert.ok(!soundsUnreachable(t), t)
})
