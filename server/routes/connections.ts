// The connections routes, out of server/index.ts: mounted on the API there.
import { ended as bgEnded, stop as bgStop, view as bgView } from '../background.ts'
import { type Ticket } from '../linear.ts'
import { sentryRef } from '../envOf.ts'
import { ask } from '../machines.ts'
import { children, bus } from '../runner.ts'
import { azureLoginState, azureStatus, startAzureLogin } from '../azure.ts'
import { checkClaudeAuth } from '../claudeLogin.ts'
import { readSecrets, saveSecrets, scrub } from '../scrub.ts'
import { addCustom, customName, ownServers, removeCustom, connect, connectSentry, connections, recheck, finishLogin, loginState, reconnect, removeFix, startLogin, accountConnections } from '../connections.ts'
import { saveConfig, userConfig } from '../config.ts'
import { accounts, envOf as accountEnv } from '../providers.ts'
import { config, save, state } from '../store.ts'
import { bankView, writeBank } from '../bank.ts'
import { agentHomesReady } from '../agentHome.ts'
import type { Hono as App } from 'hono'

// what these routes use that lives in index.ts
type Deps = { execBoard: { tickets: Ticket[] }; pushConnectors: () => void }
export function connectionsRoutes(app: App, { execBoard, pushConnectors }: Deps) {
  // connectors the agents can use, and the one-click fixes for those they can't
  // connectors you don't use: listed folded, out of the way (names, for every account)
  app.get('/connections/muted', (c) => c.json(state.mutedConnectors ?? []))
  app.post('/connections/muted', async (c) => {
    const { name, on } = await c.req.json<{ name?: string; on?: boolean }>()
    if (!name || name.length > 200) return c.json({ error: 'name required' }, 400)
    const s = new Set(state.mutedConnectors); if (on) s.add(name); else s.delete(name)
    state.mutedConnectors = [...s]; save()
    return c.json(state.mutedConnectors)
  })
  // a connector that isn't listed: added by its address, and taken out again
  // a change to the connectors here reaches every other machine (pushConnectors, below)
  app.use('/connections/*', async (c, next) => { await next(); if (c.req.method === 'POST' && c.res.status < 300 && !c.req.path.endsWith('/muted')) pushConnectors() })
  app.get('/connections/custom', (c) => c.json(Object.keys(state.customConnectors ?? {})))
  app.post('/connections/custom', async (c) => {
    const { name, url, remove } = await c.req.json<{ name?: string; url?: string; remove?: boolean }>()
    if (typeof name !== 'string' || !customName(name)) return c.json({ error: 'Name: letters, digits, - and _' }, 400)
    try {
      if (remove) { await removeCustom(name); return c.json((await connections(false, Infinity)).map(({ target: _, ...x }) => x)) }
      const u = String(url ?? '').trim()
      // claude.ai's own connectors (its directory) come through your claude.ai login, not by address
      if (/^https:\/\/claude\.ai\//.test(u)) return c.json({ error: "That's claude.ai's page for it, not an MCP address. Connect it at claude.ai/settings/connectors: it then shows here as claude.ai <name>" }, 400)
      await addCustom(name, u)
      const list = await recheck(name)
      // an address that doesn't answer as an MCP server: taken out again, or every run reports it didn't start
      if (list.find((x) => x.name === name)?.status === 'failed') {
        await removeCustom(name)
        return c.json({ error: `${u} didn't answer as an MCP server; nothing was added. Check the address in the service's MCP docs` }, 400)
      }
      return c.json(list.map(({ target: _, ...x }) => x))
    } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })
  app.get('/connections', async (c) => c.json((await connections(c.req.query('fresh') === '1')).map(({ target: _, ...c }) => c)))
  app.post('/connections/connect', async (c) => {
    const { fix } = await c.req.json<{ fix?: string }>()
    if (fix !== 'linear-key' && fix !== 'sentry-token') return c.json({ error: 'Unknown fix' }, 400)
    try { await connect(fix); return c.json((await connections(true)).map(({ target: _, ...x }) => x)) } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0] }, 500) }
  })
  app.post('/connections/sentry', async (c) => {
    const { token, org } = await c.req.json<{ token?: string; org?: string }>()
    // any token without spaces: Sentry's newer ones are base64 and can hold + / = as well
    if (typeof token !== 'string' || !/^\S{20,1000}$/.test(token.trim())) { console.warn(`sentry connect: refused before asking Sentry (${typeof token === 'string' ? `${token.trim().length} chars, has spaces: ${/\s/.test(token.trim())}` : 'no token'})`); return c.json({ error: 'That does not look like a Sentry token (no spaces, at least 20 characters)' }, 400) }
    try {
      // the organization: as typed, else the one in your tickets' Sentry links
      const fromTickets = execBoard.tickets.map((t) => sentryRef(`${t.description} ${t.lastComment?.body ?? ''}`)?.org).filter((x): x is string => !!x)
      const r = await connectSentry(token.trim(), [org?.trim(), ...fromTickets].filter((x): x is string => !!x))
      console.log(`sentry connect: ok, ${r.orgs.join(', ')} on ${r.host}`)
      return c.json({ ...r, list: (await connections(true)).map(({ target: _, ...x }) => x) })
    } catch (e) {
      const msg = scrub((e as Error).message.split('\n')[0])
      console.warn(`sentry connect: ${msg}`) // what each address answered, never the token
      return c.json({ error: msg }, 400)
    }
  })
  // --- what agents started in the background: each with its state and last output, and a way to stop it -----------
  const agentPid = (key: string) => (children.get(key) as { pid?: number } | undefined)?.pid
  app.get('/prs/:id/background', async (c) => c.json(await bgView(c.req.param('id'), agentPid(c.req.param('id')))))
  app.post('/prs/:id/background/stop', async (c) => {
    const id = c.req.param('id'), b = await c.req.json<{ task?: string; pid?: number }>()
    try { const r = await bgStop(id, b, agentPid(id)); bus.emit('change'); return c.json(r) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })
  /** A run another machine hosts (machines.ts): its background lives there, and that machine is asked. */
  const hostedOn = (key: string) => { const ch = children.get(key) as { machine?: string; remoteId?: string } | undefined; return ch?.machine && ch.remoteId ? { machine: ch.machine, id: ch.remoteId } : undefined }
  app.get('/exec/:run/background', async (c) => {
    const key = `exec:${c.req.param('run')}`, there = hostedOn(key)
    if (!there) return c.json(await bgView(key, agentPid(key)))
    const list = (state.background?.[key] ?? []).slice(-20)
    const [[, r]] = await ask<Awaited<ReturnType<typeof bgView>>>('bg', { id: there.id, tasks: list }, there.machine)
    if (!r) return c.json({ tasks: [], procs: [] })
    bgEnded(list, r.tasks)
    return c.json(r)
  })
  app.post('/exec/:run/background/stop', async (c) => {
    const key = `exec:${c.req.param('run')}`, b = await c.req.json<{ task?: string; pid?: number }>(), there = hostedOn(key)
    try {
      let r: unknown
      if (there) {
        const t = b.task ? (state.background?.[key] ?? []).find((x) => x.id === b.task) : undefined
        ;[[, r]] = await ask('bgStop', { id: there.id, task: t, pid: b.pid }, there.machine)
        if (!r) throw new Error(`${there.machine} didn't answer`)
        if (t) { t.stoppedAt = new Date().toISOString(); save() }
      } else r = await bgStop(key, b, agentPid(key))
      bus.emit('exec'); return c.json(r)
    } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })

  void azureStatus()
  app.get('/azure', async (c) => c.json({ ...(await azureStatus()), login: azureLoginState() }))
  app.post('/azure/login', async (c) => { try { return c.json(await startAzureLogin()) } catch (e) { return c.json({ error: (e as Error).message }, 400) } })
  // browser logins for connectors that only offer them: start, (from another device) finish, and watch
  // the row's name → the connector actually logged in (Sentry's plugin logs in as the plain `sentry`)
  const loginOf = (name: string) => (name === 'plugin:sentry:sentry' ? 'sentry' : name)
  app.post('/connections/login', async (c) => {
    const { name, account: who } = await c.req.json<{ name?: string; account?: string }>()
    // another Claude account's own connector: logged in in its own folder (Llama's are the first account's)
    const a = accounts().find((x) => x.id === who)
    if (a && a.id !== 'claude' && a.kind === 'claude') {
      const theirs = (await accountConnections(a.id, a.kind, accountEnv(a.id))).find((x) => x.name === name && x.status !== 'connected' && x.via === 'claude code')
      if (!theirs) return c.json({ error: 'No connector by that name needs a login on that account' }, 400)
      try { return c.json({ url: await startLogin(theirs.name, a.id, accountEnv(a.id)) }) } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0] }, 400) }
    }
    // any list already in hand will do to know the row: not a fresh check of all ~40 before the login page opens
    const known = (await connections(false, Infinity)).find((x) => x.name === name && x.status !== 'connected')
    if (!known) return c.json({ error: 'No connector by that name needs a login' }, 400)
    try {
      // Sentry's plugin address can't log in (see sentry-login): register the plain one, remembered across rebuilds, and log that in
      if (known.name === 'plugin:sentry:sentry') { await connect('sentry-login'); return c.json({ url: await startLogin('sentry') }) }
      return c.json({ url: await startLogin(known.name) })
    } catch (e) { return c.json({ error: (e as Error).message.split('\n')[0] }, 400) }
  })
  app.post('/connections/remove', async (c) => {
    const { fix } = await c.req.json<{ fix?: string }>()
    if (fix !== 'sentry-token' && fix !== 'linear-key') return c.json({ error: 'Unknown connector' }, 400)
    await removeFix(fix)
    return c.json((await connections(true)).map(({ target: _, ...x }) => x))
  })
  app.post('/connections/login/finish', async (c) => {
    const { name, redirect, account: who } = await c.req.json<{ name?: string; redirect?: string; account?: string }>()
    const own = who && who !== 'claude' && accounts().find((x) => x.id === who)?.kind === 'claude'
    try { finishLogin(own ? String(name) : loginOf(String(name)), String(redirect ?? ''), own ? who : 'claude'); return c.json({ ok: true }) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })
  app.get('/connections/login/:name', async (c) => {
    const who = c.req.query('account'), a = who && who !== 'claude' ? accounts().find((x) => x.id === who && x.kind === 'claude') : undefined
    if (a) {
      const st = loginState(c.req.param('name'), a.id)
      return c.json({ ...st, list: st?.done ? await accountConnections(a.id, a.kind, accountEnv(a.id), true) : undefined })
    }
    const st = loginState(loginOf(c.req.param('name')))
    return c.json({ ...st, list: st?.done ? (await recheck(loginOf(c.req.param('name')))).map(({ target: _, ...x }) => x) : undefined })
  })
  // this machine's own sign-in decides which connectors it adds (the saved choice may be another machine's), and the
  // plugins are in place first: both write Claude Code's config
  void Promise.all([checkClaudeAuth(), agentHomesReady()]).then(() => reconnect())
  // the connection bank, written where each account's runs are pointed at: at start, and kept in step (a key set, a
  // connector added, the sign-in changed, another account)
  const bankNow = () => writeBank(accounts().map((a) => a.id)).catch((e) => console.warn('bank:', (e as Error).message))
  void bankNow(); setInterval(() => void bankNow(), 30_000).unref()
  app.get('/bank', (c) => c.json(bankView()))
  // a connection of your own in the bank: a name, its MCP address, and its key when it has one (kept with the secrets)
  app.post('/bank/add', async (c) => {
    const b = await c.req.json<{ name?: string; url?: string; key?: string; command?: string; env?: Record<string, string>; was?: string }>()
    const name = String(b.name ?? '').trim()
    if (!customName(name)) return c.json({ error: 'A name: letters, digits, - and _' }, 400)
    if (ownServers().some((s) => s.name === name && !s.mine)) return c.json({ error: `${name} is already in the bank` }, 400)
    // editing one of yours (`was`: its name before): a key or a value left empty keeps the one kept, so nothing has to be pasted again
    const before = b.was ? readSecrets().bank?.[b.was] : undefined
    if (b.was && !before) return c.json({ error: `${b.was} isn't in the bank any more` }, 400)
    if (b.was !== name && readSecrets().bank?.[name]) return c.json({ error: `${name} is already in the bank${b.was ? '' : ': edit it instead'}` }, 400)
    let entry: { url?: string; key?: string; open?: boolean; command?: string[]; env?: Record<string, string> }
    if (b.command !== undefined) {
      // a command Concierge starts (an MCP server over stdio): split like a shell would, without one (no pipes, no $), and its
      // values handed to it as it starts (bin/bank-env.mjs), never on its command line
      const command = (String(b.command).match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^(["'])(.*)\1$/, '$2'))
      const env = Object.fromEntries(Object.entries(b.env ?? {}).map(([k, v]) => [k.trim(), String(v) || before?.env?.[k.trim()] || '']).filter(([k, v]) => k && v))
      if (!command.length) return c.json({ error: 'The command that starts it' }, 400)
      if (Object.keys(env).some((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) return c.json({ error: 'Each value needs a name like MDB_MCP_CONNECTION_STRING' }, 400)
      entry = { command, env }
    } else {
      const url = String(b.url ?? '').trim(), key = String(b.key ?? '').trim() || before?.key || ''
      if (!/^https:\/\/\S+$/.test(url)) return c.json({ error: 'An https:// address' }, 400)
      // without a key: a public one, open to anyone (Twilio's docs). One that wants a browser sign-in can't be shared between
      // tools: add it on claude.ai instead (Connectors below)
      entry = key ? { url, key } : { url, open: true }
    }
    const { [b.was ?? name]: _, ...rest } = readSecrets().bank ?? {}
    saveSecrets({ bank: { ...rest, [name]: entry } })
    if (b.was && b.was !== name) saveConfig({ exec: { allowedTools: config.exec.allowedTools.filter((t) => t !== `mcp__${b.was}`) } })
    const tools = `mcp__${name}`
    if (!config.exec.allowedTools.includes(tools)) saveConfig({ exec: { allowedTools: [...config.exec.allowedTools, tools] } })
    await bankNow()
    return c.json(bankView())
  })
  app.post('/bank/remove', async (c) => {
    const { name } = await c.req.json<{ name?: string }>()
    const { [String(name)]: _, ...rest } = readSecrets().bank ?? {}
    saveSecrets({ bank: rest })
    saveConfig({ exec: { allowedTools: config.exec.allowedTools.filter((t) => t !== `mcp__${name}`) } })
    await bankNow()
    return c.json(bankView())
  })
  app.post('/repos/start-in', async (c) => {
    const { repo, folder } = await c.req.json<{ repo: string; folder?: string }>()
    const f = (folder ?? '').trim().replace(/^\/+|\/+$/g, '')
    if (f.split('/').includes('..')) return c.json({ error: 'A folder inside the repository' }, 400)
    const { [repo]: _, ...rest } = userConfig().startIn ?? {}
    saveConfig({ startIn: f ? { ...rest, [repo]: f } : rest })
    return c.json({ ok: true })
  })
  app.post('/connections/scope', async (c) => {
    const { name, owners } = await c.req.json<{ name: string; owners: string[] }>()
    const { [name]: _, ...rest } = userConfig().connections?.scope ?? {}
    saveConfig({ connections: { ...userConfig().connections, scope: owners.length ? { ...rest, [name]: owners } : rest } })
    return c.json({ ok: true })
  })
  app.post('/bank', async (c) => {
    const { only } = await c.req.json<{ only?: boolean }>()
    saveConfig({ connections: { ...userConfig().connections, bankOnly: !!only } })
    await bankNow()
    return c.json(bankView())
  })
}
