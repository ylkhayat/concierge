import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// its own state folder: what the store opens and writes must never reach the real one
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'rd-machines-'))
const { machines, place } = await import('./machines.ts')
const { state } = await import('./store.ts')

test('a run goes back to its machine if it has room, else to the one with the most room; a busy work laptop gets little', () => {
  delete state.settings.workMachine
  const add = (name: string, slots: number, running: number, freeMb = 8000) => machines.set(name, { name, base: `http://${name}:4748`, seen: 0, status: { name, slots, running, freeMb } })
  add('windows', 6, 2); add('mac', 1, 0); add('old', 4, 4)
  const here = { running: 1, slots: 2, freeMb: 9000 } // this machine (the control plane): 1 of 2
  assert.equal(place(undefined, here, new Map()), 'windows') // 4 free beats 1
  assert.equal(place('mac', here, new Map()), 'mac') // its worktree and session are there
  assert.equal(place('old', here, new Map()), 'windows') // full: elsewhere
  assert.equal(place(undefined, here, new Map([['windows', 6]])), '') // what we already sent counts; then here ('' = this machine)
  assert.equal(place(undefined, { running: 2, slots: 2, freeMb: 9000 }, new Map([['windows', 6]])), 'mac')
  add('windows', 6, 0, 500) // low on memory: skipped
  assert.equal(place(undefined, { running: 2, slots: 2, freeMb: 9000 }, new Map()), 'mac')
  machines.clear()
  assert.equal(place(undefined, { running: 3, slots: 3, freeMb: 9000 }, new Map()), undefined) // nowhere has room
})

test('the work machine takes at most its few agents, none at 0', () => {
  machines.set('mac', { name: 'mac', base: 'http://mac:4748', seen: 0, status: { name: 'mac', slots: 4, running: 0, freeMb: 8000 } })
  const full = { running: 2, slots: 2, freeMb: 9000 }
  state.settings.workMachine = 'mac'; state.settings.workSlots = 1
  assert.equal(place(undefined, full, new Map()), 'mac')
  assert.equal(place(undefined, full, new Map([['mac', 1]])), undefined) // its one is taken
  state.settings.workSlots = 0
  assert.equal(place('mac', full, new Map()), undefined) // takes none, even for a run that was there before
  delete state.settings.workMachine; delete state.settings.workSlots
  machines.clear()
})

test('a run only goes where its account works: the Mac without Ollama gets no Llama run', () => {
  machines.set('mac', { name: 'mac', base: 'http://mac:4748', seen: 0, status: { name: 'mac', slots: 4, running: 0, freeMb: 8000, can: ['claude'] } })
  const full = { running: 2, slots: 2, freeMb: 9000 }
  assert.equal(place(undefined, full, new Map(), 'claude'), 'mac')
  assert.equal(place(undefined, full, new Map(), 'llama'), undefined)
  assert.equal(place('mac', full, new Map(), 'llama'), undefined) // not even back where it ran before
  machines.clear()
})
