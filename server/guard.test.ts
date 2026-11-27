import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostOk, originOk } from './guard.ts'

test('a request is answered under a name of this machine or the tailnet, and no other', () => {
  for (const h of [undefined, 'localhost:4747', '127.0.0.1:4747', '[::1]:4747', '100.101.102.103:4747', 'concierge', 'concierge-macbookpro:4747', 'concierge.tailfc8c27.ts.net', 'mac.local:4747'])
    assert.ok(hostOk(h), String(h))
  for (const h of ['evil.example', 'evil.example:4747', 'localhost.evil.example', '127.0.0.1.evil.example', 'ts.net.evil.example'])
    assert.ok(!hostOk(h), h)
  assert.ok(hostOk('deck.example.com', ['deck.example.com']))
  assert.ok(hostOk('anything.example', ['*']))
})

test('a change is taken from a page of yours, a script or another machine; not from another site or a sandboxed frame', () => {
  assert.ok(originOk(undefined))
  assert.ok(originOk('http://localhost:5173'))
  assert.ok(originOk('https://concierge.tailfc8c27.ts.net'))
  assert.ok(!originOk('https://evil.example'))
  assert.ok(!originOk('null'))
  assert.ok(!originOk('not a url'))
})
