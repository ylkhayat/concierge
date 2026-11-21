// The placement matrix with several machines: a repository's work goes to the main server when it may have it, else
// the machine you work on, else the others by name; only where the checkout is, there is room, and the account is
// signed in as its own login.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-placement-'))
process.env.CONCIERGE_FLEET = new URL('./testdata/fleet-test.mjs', import.meta.url).pathname
process.env.DECK_NAME = 'main'; process.env.HOLDER = 'main'
const { machines, place, route, loginOk, whyNowhere } = await import('./machines.ts')
const { config, state } = await import('./store.ts')
const { setIdentity } = await import('./providers.ts')

const add = (name: string, repos: string[], o: { slots?: number; running?: number; can?: string[]; who?: Record<string, string> } = {}) =>
  machines.set(name, { name, base: `http://${name}:4748`, seen: 0, status: { name, slots: o.slots ?? 2, running: o.running ?? 0, freeMb: 8000, repos, can: o.can, who: o.who } })
const idle = { running: 0, slots: 2, freeMb: 9000 }

test('a repository allowed on the main server runs there; one that is not goes to the work machine, then the others', () => {
  config.repos = { 'acme/api': '/code/api', 'acme/web': '/code/web', 'bliro/app': '/code/app' }
  config.cloneOn = { 'acme/*': ['main', 'mac', 'win'], 'bliro/app': ['mac', 'win'] }
  state.settings.workMachine = 'win'
  add('mac', ['acme/api', 'acme/web', 'bliro/app']); add('win', ['acme/api', 'acme/web', 'bliro/app'])
  assert.deepEqual(route('acme/api').order, ['main', 'win', 'mac'])
  assert.equal(place(undefined, idle, new Map(), 'claude', 'acme/api'), 'main')
  assert.deepEqual(route('bliro/app').order, ['win', 'mac']) // not allowed on the main server
  assert.equal(place(undefined, idle, new Map(), 'claude', 'bliro/app'), 'win')
  assert.equal(place('mac', idle, new Map(), 'claude', 'bliro/app'), 'mac') // back where its session is
  assert.equal(place(undefined, idle, new Map([['win', 2]]), 'claude', 'bliro/app'), 'mac') // the work machine is full
  assert.equal(place(undefined, { ...idle, running: 2 }, new Map(), 'claude', 'acme/api'), 'win') // the main server is full
  delete state.settings.workMachine
  machines.clear()
})

test('a repository allowed nowhere, or only on a machine that is offline, says why and runs nowhere', () => {
  config.repos = { 'bliro/app': '/code/app' }
  config.cloneOn = {}
  assert.equal(place(undefined, idle, new Map(), 'claude', 'bliro/app'), undefined)
  assert.match(whyNowhere('bliro/app', 'claude')!, /isn't allowed on any machine/)
  config.cloneOn = { 'bliro/app': ['mac'] }
  machines.set('mac', { name: 'mac', base: 'http://mac:4748', seen: 0 }) // no status: offline
  assert.match(whyNowhere('bliro/app', 'claude')!, /only allowed on mac, which isn't online/)
  machines.clear()
})

test('an account is one login: a machine signed in as someone else under its name takes none of its work', () => {
  config.repos = { 'acme/api': '/code/api' }
  config.cloneOn = { 'acme/api': ['mac', 'win'] }
  config.accounts = [{ id: 'claude', label: 'Claude', kind: 'claude', login: 'login:me@work.com|Work' }]
  add('mac', ['acme/api'], { who: { claude: 'login:me@home.com|?' } }); add('win', ['acme/api'], { who: { claude: 'login:me@work.com|Work' } })
  assert.equal(loginOk('mac', 'claude'), false)
  assert.equal(loginOk('win', 'claude'), true)
  assert.equal(place(undefined, idle, new Map(), 'claude', 'acme/api'), 'win')
  add('win', ['acme/api'], { who: { claude: 'login:me@home.com|?' } })
  assert.equal(place(undefined, idle, new Map(), 'claude', 'acme/api'), undefined)
  assert.match(whyNowhere('acme/api', 'claude')!, /signed in as someone other than me@work.com \(Work\)/)
  setIdentity('claude', 'login:me@home.com|?') // this machine too: it doesn't run it either
  assert.equal(loginOk(undefined, 'claude'), false)
  delete config.accounts
  machines.clear()
})
