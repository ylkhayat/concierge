// Several machines, all working: the one holding the lease (fleet.ts) is the control plane (the page, the polling, the
// queue) and every other one runs agents for it. Here are both sides of that: a small server each machine runs
// (`serveWorker`), which starts an agent the control plane asks for and streams its output back, and the control
// plane's end (`remoteAgent`), which looks to the runner like any local agent process.
//
// The wire: POST /run with what to start, answered by a stream of NDJSON frames ({o: stdout} | {e: stderr} |
// {x: [code, signal]}) until the agent ends. Its stdin and a kill are separate calls by the run's id. The stream
// dropping (the control plane restarted, the network went) stops the agent: the control plane continues it, as it
// does a run a restart stopped. Every call carries a token both machines share (a file in the synced state); only
// loopback and tailnet addresses may call at all.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, request, type ClientRequest, type IncomingMessage, type RequestOptions, type Server } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { AgentProcess } from './providers.ts'

// untrusted: it reads someone else's work (their PR): the worker fences its tools and keeps its secrets to what it needs,
// as the control plane does for one it runs itself (untrusted.ts)
export type Spawn = { provider: string; args: string[]; cwd: string; stdin?: boolean; untrusted?: boolean }
export type WorkerStatus = { name: string; role?: string; slots: number; running: number; freeMb: number; cores?: number; mb?: number; cpu?: number; usedMb?: number; can?: string[]; repos?: string[]
  who?: Record<string, string> // each account's login there (providers.ts identityOf): one account is one login on every machine
  crit?: { key: string; port?: number }[] // the crit sessions running there, so the page finds a review's crit on the machine that ran it
  takes?: string[] // what it runs beyond Ship runs: 'review' (fences someone else's PR, reports its crit). Older versions say nothing
  lapsed?: string[] // the added Claude accounts whose login stopped working there (claudeLogin.ts): a notice, and a Sign in button
} // cpu, usedMb: what its agents use; can: the accounts it can run

/** The token both machines share: made by the first that needs it, in a folder the sync carries to the other. */
export function tokenIn(dir: string): string {
  const f = join(dir, 'worker-token')
  try { const t = readFileSync(f, 'utf8').trim(); if (t.length >= 32) return t } catch { /* none yet */ }
  const t = randomBytes(32).toString('hex')
  writeFileSync(f, t + '\n', { mode: 0o600 })
  return t
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
/** Loopback, or Tailscale's addresses (100.64.0.0/10, fd7a:115c:a1e0::/48): nothing from a LAN or the internet. */
export function allowed(ip = ''): boolean {
  const v4 = ip.replace(/^::ffff:/, '')
  if (v4 === '127.0.0.1' || ip === '::1') return true
  const m = v4.match(/^100\.(\d+)\./)
  if (m) return +m[1] >= 64 && +m[1] <= 127
  return /^fd7a:115c:a1e0:/i.test(ip)
}
const body = (req: IncomingMessage) => new Promise<any>((ok, no) => {
  let s = ''
  req.on('data', (c) => { s += c; if (s.length > 4_000_000) req.destroy() })
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}) } catch (e) { no(e) } })
  req.on('error', no)
})

/** This machine's side: start agents others ask for. `start` is spawnAgent; `status` says how much room is left. */
export function serveWorker(o: { port: number; host: string; token: () => string | string[]; start: (s: Spawn) => AgentProcess; status: () => WorkerStatus; busy: (pid?: number) => Promise<boolean>; logs?: () => string[]; extra?: Record<string, (input: any) => Promise<unknown>>
  // what a machine without the key may ask (join.ts): who this is, and to join; still the tailnet only
  open?: { hello: () => unknown; ask: (body: any, ip: string) => Promise<unknown>; status: (id: string, ip: string, wait?: number) => Promise<unknown> } }): { server: Server; hosted: Map<string, { label: string; child: AgentProcess }> } {
  const hosted = new Map<string, { label: string; child: AgentProcess }>()
  const server = createServer(async (req, res) => {
    const send = (code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
    const given = String(req.headers.authorization ?? '')
    const url = new URL(req.url ?? '/', 'http://x'), [, what, id, verb] = url.pathname.split('/')
    if (!allowed(req.socket.remoteAddress)) return send(403, { error: 'not allowed' })
    // without the key: who this is, and a join (a new machine has no key yet)
    if (o.open && what === 'hello' && req.method === 'GET') return send(200, o.open.hello())
    if (o.open && what === 'join') {
      try {
        if (req.method === 'POST' && !id) return send(200, await o.open.ask(await body(req), req.socket.remoteAddress ?? ''))
        if (req.method === 'GET' && id) return send(200, await o.open.status(id, req.socket.remoteAddress ?? '', Number(url.searchParams.get('wait')) || 0))
      } catch (e) { return send(400, { error: (e as Error).message }) }
    }
    if (![o.token()].flat().some((t) => same(given, `Bearer ${t}`))) return send(403, { error: 'not allowed' })
    try {
      if (req.method === 'GET' && what === 'status') return send(200, o.status())
      // the few named things a control plane may ask besides runs (machines.ts): nothing else is reachable
      if (req.method === 'POST' && what === 'x' && id && o.extra && Object.hasOwn(o.extra, id)) return send(200, (await o.extra[id](await body(req))) ?? { ok: true })
      if (req.method === 'GET' && what === 'logs' && o.logs) return send(200, { lines: o.logs() })
      if (req.method === 'POST' && what === 'run' && !id) {
        const s = await body(req) as Spawn & { id: string; label?: string }
        if (!s.id || !Array.isArray(s.args) || typeof s.cwd !== 'string') return send(400, { error: 'bad run' })
        const st = o.status()
        if (st.running >= st.slots) return send(409, { error: `${st.name} is full` })
        const child = o.start(s)
        hosted.set(s.id, { label: s.label ?? s.id, child })
        res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.flushHeaders() // started: its stdin may come now
        const frame = (f: unknown) => res.write(JSON.stringify(f) + '\n')
        child.stdout.on('data', (c: Buffer) => frame({ o: c.toString() }))
        child.stderr.on('data', (c: Buffer) => frame({ e: c.toString() }))
        child.on('error', (e: Error) => frame({ err: e.message }))
        child.on('close', (code: number | null, signal: string | null) => { hosted.delete(s.id); frame({ x: [code, signal] }); res.end() })
        // the control plane went away: so does its agent (it is continued from there, as after a restart)
        res.on('close', () => { if (hosted.has(s.id)) child.kill('SIGTERM') })
        return
      }
      const h = id ? hosted.get(id) : undefined
      if (what === 'run' && !h) return send(404, { error: 'no such run here' })
      if (req.method === 'POST' && verb === 'stdin') {
        const { data, end } = await body(req) as { data?: string; end?: boolean }
        if (data) h!.child.stdin?.write(data)
        if (end) h!.child.stdin?.end()
        return send(200, { ok: true })
      }
      if (req.method === 'POST' && verb === 'kill') { h!.child.kill(((await body(req)).signal ?? 'SIGTERM') as NodeJS.Signals); return send(200, { ok: true }) }
      if (req.method === 'GET' && verb === 'busy') return send(200, { busy: await o.busy(h!.child.pid) })
      send(404, { error: 'unknown' })
    } catch (e) { if (!res.headersSent) send(500, { error: (e as Error).message }) }
  })
  server.listen(o.port, o.host)
  return { server, hosted }
}

// --- reaching another machine. Its address is on the tailnet; a machine whose only Tailscale is the fleet's link
// container (Tailscale in Docker Compose, none of its own) can't route there itself, so the link offers a local proxy
// (fleet/compose.fleet.yml: TAILNET_PROXY). Used while it answers; a machine with Tailscale of its own, or whose link is
// stopped (a standby), goes direct as before.
const TAILNET = /^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[?fd7a:115c:a1e0:.*|.+\.ts\.net)$/i
const PROXY = process.env.TAILNET_PROXY ? new URL(process.env.TAILNET_PROXY) : undefined
let proxyUp = false
if (PROXY) {
  const probe = () => {
    const s = connect(Number(PROXY.port) || 80, PROXY.hostname)
    s.setTimeout(2000, () => s.destroy())
    s.on('connect', () => { proxyUp = true; s.destroy() }).on('error', () => { proxyUp = false })
  }
  probe(); setInterval(probe, 15_000).unref()
}
/** A request to another machine at `url`: through the link's proxy when this machine reaches the tailnet only that way. */
export function machineRequest(url: string, opts: RequestOptions, cb: (res: IncomingMessage) => void): ClientRequest {
  const u = new URL(url)
  if (PROXY && proxyUp && TAILNET.test(u.hostname)) return request({ ...opts, host: PROXY.hostname, port: PROXY.port || 80, path: url, headers: { ...opts.headers, host: u.host } }, cb)
  return request(url, opts, cb)
}

/** Ask a worker something: JSON in, JSON out. */
export function call<T>(base: string, token: string, method: string, path: string, payload?: unknown, timeout = 10_000): Promise<T> {
  return new Promise((ok, no) => {
    const req = machineRequest(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, timeout }, (res) => {
      let s = ''
      res.on('data', (c) => { s += c })
      res.on('end', () => { try { const v = JSON.parse(s); (res.statusCode ?? 500) < 300 ? ok(v) : no(new Error(v.error ?? `HTTP ${res.statusCode}`)) } catch (e) { no(e) } })
    })
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', no)
    req.end(payload === undefined ? undefined : JSON.stringify(payload))
  })
}

/** How a run ends when the machine it was sent to had no room left: it never started there. */
export const NO_ROOM = 'no room on the machine'

/**
 * The control plane's side: an agent on another machine, shaped like a local one (stdout, stderr, stdin, kill,
 * close), plus `busy` for the hang check (what runs under it is over there) and `machine`.
 */
export function remoteAgent(machine: string, base: string, token: string, s: Spawn & { label?: string }): AgentProcess & { machine: string; remoteId: string; busy: () => Promise<boolean> } {
  const id = randomUUID(), stdout = new PassThrough(), stderr = new PassThrough()
  let started = false, ended = false
  const queue: { data?: string; end?: boolean }[] = []
  let sending = Promise.resolve()
  const push = (m: { data?: string; end?: boolean }) => {
    if (!started) { queue.push(m); return }
    sending = sending.then(() => call(base, token, 'POST', `/run/${id}/stdin`, m).then(() => {}, () => {}))
  }
  const stdin = new Writable({
    write(chunk, _enc, done) { push({ data: chunk.toString() }); done() },
    final(done) { push({ end: true }); done() },
  })
  const proc = Object.assign(new EventEmitter(), {
    stdout, stderr, stdin: s.stdin ? stdin : null, pid: undefined, machine, remoteId: id,
    kill: (signal: NodeJS.Signals | number = 'SIGTERM') => { if (!ended) void call(base, token, 'POST', `/run/${id}/kill`, { signal }).catch(() => req.destroy()); return true },
    busy: () => call<{ busy: boolean }>(base, token, 'GET', `/run/${id}/busy`).then((r) => r.busy, () => true),
  }) as unknown as AgentProcess & { machine: string; remoteId: string; busy: () => Promise<boolean> }
  const finish = (code: number | null, signal: string | null, err?: string) => {
    if (ended) return
    ended = true
    if (err) proc.emit('error', new Error(err))
    stdout.end(); stderr.end()
    setImmediate(() => proc.emit('close', code, signal))
  }
  const req = machineRequest(base + '/run', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
    if (res.statusCode !== 200) {
      let s2 = ''
      res.on('data', (c) => { s2 += c })
      res.on('end', () => {
        let why = `HTTP ${res.statusCode}`; try { why = JSON.parse(s2).error ?? why } catch { /* plain */ }
        // 409: the machine had filled up since it was chosen. Nothing started and nothing was lost: said as that, so
        // the run is placed again, not counted as a dropped connection (three of those end it)
        finish(null, null, res.statusCode === 409 ? `${NO_ROOM}: ${why}` : `lost the connection to ${machine}: ${why}`)
      })
      return
    }
    started = true
    for (const m of queue.splice(0)) push(m)
    let buf = ''
    res.on('data', (c: Buffer) => {
      buf += c
      const lines = buf.split('\n'); buf = lines.pop()!
      for (const l of lines) {
        let f: any
        try { f = JSON.parse(l) } catch { continue }
        if (f.o) stdout.write(f.o)
        if (f.e) stderr.write(f.e)
        if (f.err) proc.emit('error', new Error(f.err))
        if (f.x) finish(f.x[0], f.x[1])
      }
    })
    res.on('end', () => finish(null, null, `lost the connection to ${machine} mid-run`))
    res.on('error', () => finish(null, null, `lost the connection to ${machine} mid-run`))
  })
  req.on('error', (e) => finish(null, null, `lost the connection to ${machine}: ${e.message}`))
  req.end(JSON.stringify({ ...s, id }))
  return proc
}
