import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'rd-access-'))
const { refuse, whoFrom, allowed } = await import('./access.ts')

const h = (o: Record<string, string>) => (n: string) => o[n]
test('on this machine anyone; through the link the first person becomes the owner, and others are refused', () => {
  assert.equal(refuse(whoFrom(h({}))), undefined) // 127.0.0.1, no link headers
  assert.match(refuse(whoFrom(h({ 'x-forwarded-for': '100.1.2.3' })))!, /doesn’t say who/) // a link that doesn't say who, and no password: refused
  process.env.CONCIERGE_PASSWORD = 'x'
  assert.equal(refuse(whoFrom(h({ 'x-forwarded-for': '100.1.2.3' }))), undefined) // with a password, that is what protects it
  delete process.env.CONCIERGE_PASSWORD
  assert.equal(refuse(whoFrom(h({ 'tailscale-user-login': 'me@example.com', 'x-forwarded-for': '100.1.2.3' }))), undefined)
  assert.deepEqual(allowed(), ['me@example.com'])
  assert.match(refuse(whoFrom(h({ 'tailscale-user-login': 'them@example.com' })))!, /may not open/)
  assert.equal(refuse(whoFrom(h({ 'tailscale-user-login': 'me@example.com' }))), undefined)
})
