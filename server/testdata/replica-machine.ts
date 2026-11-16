// One machine for replica.test.ts, in its own process: its own state folder (XDG_STATE_HOME), its own fleet (the
// holder is HOLDER), its worker on DECK_WORKER_PORT. The holder changes its state when told on stdin; every machine
// prints its replica status and a digest of its state whenever asked.
const { serve } = await import('../machines.ts')
const { replicaExtras, replicaStatus } = await import('../replica.ts')
const { state, save, saveNow } = await import('../store.ts')
serve(() => 1, async () => ({ cpu: 0, mb: 0 }), replicaExtras, () => [])
process.stdin.setEncoding('utf8')
let buf = ''
process.stdin.on('data', (c: string) => {
  buf += c
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    const m = JSON.parse(line) as { op: string; key?: string; value?: unknown }
    if (m.op === 'set') { (state.prs as Record<string, unknown>)[m.key!] = m.value; saveNow() }
    if (m.op === 'del') { delete (state.prs as Record<string, unknown>)[m.key!]; saveNow() }
    if (m.op === 'status') process.stdout.write(JSON.stringify({ status: replicaStatus(), prs: state.prs }) + '\n')
  }
})
void save
process.stdout.write(JSON.stringify({ ready: true }) + '\n')
