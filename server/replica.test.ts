// Two machines in two processes, each with its own state folder, over the real worker link: the follower ends up with
// the holder's state (changes and deletions), its files (whole, and a log that grew), and never a sign-in.
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const here = new URL('.', import.meta.url).pathname
type Machine = { p: ChildProcess; state: string; config: string; ask: () => Promise<any>; set: (key: string, value: unknown) => void }

function machine(name: string, port: number, peerPort: number, peer: string, token: string, holderFile?: string): Promise<Machine> {
  const root = mkdtempSync(join(tmpdir(), `rd-replica-${name}-`))
  const state = join(root, 'state', 'concierge'), config = join(root, 'config', 'concierge')
  mkdirSync(join(state, 'hosts'), { recursive: true }); mkdirSync(config, { recursive: true })
  writeFileSync(join(state, 'worker-token'), token + '\n')
  writeFileSync(join(state, 'hosts', `${peer}.json`), JSON.stringify({ worker: `http://127.0.0.1:${peerPort}` }))
  const p = spawn(process.execPath, [join(here, 'testdata', 'replica-machine.ts')], {
    env: { ...process.env, XDG_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config'), HOME: root, CONCIERGE_FLEET: join(here, 'testdata', 'fleet-test.mjs'),
      DECK_NAME: name, HOLDER: 'win', ...(holderFile && { HOLDER_FILE: holderFile }), DECK_WORKER_PORT: String(port), DECK_WORKER_HOST: '127.0.0.1', DECK_REPLICA_MS: '200', DECK_REPLICA_FILES_MS: '400', LINEAR_API_KEY: '', GITHUB_TOKEN: '' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let out = '', waiters: ((v: any) => void)[] = []
  p.stdout!.setEncoding('utf8')
  p.stdout!.on('data', (c: string) => {
    out += c
    let i
    while ((i = out.indexOf('\n')) >= 0) { const l = out.slice(0, i); out = out.slice(i + 1); if (l.startsWith('{')) waiters.shift()?.(JSON.parse(l)) }
  })
  const next = () => new Promise<any>((ok) => waiters.push(ok))
  return next().then(() => ({ p, state, config, ask: () => { const n = next(); p.stdin!.write(JSON.stringify({ op: 'status' }) + '\n'); return n }, set: (key: string, value: unknown) => p.stdin!.write(JSON.stringify({ op: 'set', key, value }) + '\n') }))
}
const until = async (f: () => Promise<boolean>, ms = 15_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return; await new Promise((r) => setTimeout(r, 150)) } throw new Error('timed out') }

test('the follower takes the holder\'s state and files over the machines\' link', { timeout: 60_000 }, async () => {
  const token = 'k'.repeat(64)
  const win = await machine('win', 47811, 47812, 'mac', token)
  const mac = await machine('mac', 47812, 47811, 'win', token)
  try {
    const set = (key: string, value: unknown) => win.p.stdin!.write(JSON.stringify({ op: 'set', key, value }) + '\n')
    set('o/r#1', { title: 'one' }); set('o/r#2', { title: 'two' })
    await until(async () => (await mac.ask()).prs['o/r#2']?.title === 'two')
    // a change and a deletion follow as changes, not the whole state
    set('o/r#1', { title: 'one, edited' }); win.p.stdin!.write(JSON.stringify({ op: 'del', key: 'o/r#2' }) + '\n')
    await until(async () => { const s = await mac.ask(); return s.prs['o/r#1']?.title === 'one, edited' && !s.prs['o/r#2'] })
    const st = (await mac.ask()).status
    assert.equal(st.following, 'win')
    assert.equal(st.applied, st.sourceHead)

    // files: a log comes whole, then only what it grew by; a sign-in never travels; a checkout never does
    mkdirSync(join(win.state, 'logs'), { recursive: true }); writeFileSync(join(win.state, 'logs', 'run.jsonl'), '{"a":1}\n')
    mkdirSync(join(win.config, 'accounts', 'x', 'claude'), { recursive: true })
    writeFileSync(join(win.config, 'accounts', 'x', 'claude', '.credentials.json'), 'secret'); writeFileSync(join(win.config, 'config.json'), '{"port":1}')
    mkdirSync(join(win.state, 'revise', '9', 'wt', '.git'), { recursive: true }); writeFileSync(join(win.state, 'revise', '9', 'notes.md'), 'notes')
    mkdirSync(join(win.state, 'revise', '9', 'checkout'), { recursive: true }); writeFileSync(join(win.state, 'revise', '9', 'checkout', '.git'), 'gitdir: x'); writeFileSync(join(win.state, 'revise', '9', 'checkout', 'big.ts'), 'x')
    // a folder linked in (an account's skills, pointing at that machine's own): never followed, never copied
    const { symlinkSync } = await import('node:fs')
    mkdirSync(join(win.config, 'elsewhere', 'skill-x'), { recursive: true }); writeFileSync(join(win.config, 'elsewhere', 'skill-x', 'SKILL.md'), 'x')
    mkdirSync(join(win.config, 'accounts', 'x', 'claude'), { recursive: true }); symlinkSync(join(win.config, 'elsewhere'), join(win.config, 'accounts', 'x', 'claude', 'skills'))
    await until(async () => existsSync(join(mac.state, 'logs', 'run.jsonl')) && existsSync(join(mac.config, 'config.json')) && existsSync(join(mac.state, 'revise', '9', 'notes.md')))
    appendFileSync(join(win.state, 'logs', 'run.jsonl'), '{"a":2}\n')
    await until(async () => readFileSync(join(mac.state, 'logs', 'run.jsonl'), 'utf8') === '{"a":1}\n{"a":2}\n')
    assert.ok(!existsSync(join(mac.config, 'accounts', 'x', 'claude', '.credentials.json')), 'a sign-in stays on its machine')
    assert.ok(!existsSync(join(mac.state, 'revise', '9', 'checkout', 'big.ts')), 'a checkout stays on its machine')
    assert.ok(!existsSync(join(mac.config, 'accounts', 'x', 'claude', 'skills')), 'a linked folder stays on its machine')
    // and back: a file the follower's agents wrote reaches the holder
    mkdirSync(join(mac.state, 'review-pr'), { recursive: true }); writeFileSync(join(mac.state, 'review-pr', 'o-r-3.json'), '{"findings":[]}')
    await until(async () => existsSync(join(win.state, 'review-pr', 'o-r-3.json')))
  } finally { win.p.kill(); mac.p.kill() }
})

test('the lease moves: the new holder goes on from the same state, and the old one follows it', { timeout: 60_000 }, async () => {
  const token = 'h'.repeat(64), lease = join(mkdtempSync(join(tmpdir(), 'rd-lease-')), 'holder')
  writeFileSync(lease, 'win')
  const win = await machine('win', 47821, 47822, 'mac', token, lease)
  const mac = await machine('mac', 47822, 47821, 'win', token, lease)
  try {
    win.set('o/r#1', { title: 'from win' })
    await until(async () => (await mac.ask()).prs['o/r#1']?.title === 'from win')
    // Windows goes to sleep: the Mac takes the lease, changes things, and Windows (back, now following) gets them
    writeFileSync(lease, 'mac')
    mac.set('o/r#1', { title: 'edited on mac' }); mac.set('o/r#4', { title: 'new on mac' })
    await until(async () => { const s = await win.ask(); return s.prs['o/r#1']?.title === 'edited on mac' && s.prs['o/r#4']?.title === 'new on mac' })
    const st = (await win.ask()).status
    assert.equal(st.following, 'mac')
    assert.ok(st.caughtUp || st.applied === st.sourceHead)
    // and back to Windows: nothing lost either way
    writeFileSync(lease, 'win')
    win.set('o/r#5', { title: 'win again' })
    await until(async () => { const s = await mac.ask(); return s.prs['o/r#5']?.title === 'win again' && s.prs['o/r#4']?.title === 'new on mac' })
  } finally { win.p.kill(); mac.p.kill() }
})
