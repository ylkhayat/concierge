// The hooks routes, out of server/index.ts: mounted on the API there.
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { type Context } from 'hono'
import { tokenChanged, getMe, ghCall, readScopes, tokenScopes } from '../github.ts'
import { hookStats, listening, newSecret } from '../hooks.ts'
import { askDoor, connectRepo, doorAnswer, doorResult, funnelBlocker, funnelError, FUNNEL_PORT, hookUrl, pingHook, removeHook, scopesAllowHooks, type Self } from '../hookSetup.ts'
import { behind as standbyBehind, fleetCode, infraView } from '../infra.ts'
import { fleet } from '../fleet.ts'
import { local as localKeys, sharedNow, type SharedKey } from '../sharedEnv.ts'
import { readSecrets, saveSecrets } from '../scrub.ts'
import { config, save, state, STATE_DIR } from '../store.ts'
import { githubLoginState, startGithubLogin } from '../githubLogin.ts'
import { tsStatus } from '../tailscale.ts'
import type { Hono as App } from 'hono'

// what these routes use that lives in index.ts
type Deps = {
  hookPort: () => number; hooked: (repo: string) => boolean; keepKey: (k: SharedKey, v: string | null) => unknown; startHooks: () => unknown
  whoseKey: (k: SharedKey, v: string) => Promise<{ who?: string; error?: string }>
}
/** What Settings → Machines shows of the webhooks (GET /hooks). */
export type HooksView = Awaited<ReturnType<ReturnType<typeof hooksRoutes>['hooksView']>>
export function hooksRoutes(app: App, { hookPort, hooked, keepKey, startHooks, whoseKey }: Deps) {
  // tailnet-only like every other route; each acts on the control plane (a worker hands the POSTs there, and FLEET_VIEW
  // shows the control plane's view), where the funnel, the listener and the token are
  const tokenSource = (): 'shared' | 'env' | 'gh' => (sharedNow().GITHUB_TOKEN ? 'shared' : localKeys.GITHUB_TOKEN ? 'env' : 'gh')
  const hookRepos = () => [...new Set([...Object.keys(config.repos), ...Object.values(state.prs).filter((p) => !p.closed && !p.dismissed).map((p) => p.repo)])].sort()
  const REPO_NAME = /^[\w.-]+\/[\w.-]+$/
  let hookSignIn = false // the sign-in running is the webhooks' (its state is shown in their section)
  async function hooksView() {
    const self = (await tsStatus())?.Self as Self | undefined
    const h = state.hooks, stats = hookStats()
    // the door as the fleet's standby last said it stands on this machine (it runs Tailscale, the app doesn't)
    const door = doorResult(DOOR_DIR, fleet.machine), on = !!h?.url && !!door?.on
    const scopes = tokenScopes() ?? await readScopes().catch(() => undefined)
    return {
      control: !fleet.elsewhere(), machine: fleet.machine, listening: listening(), port: hookPort(), funnelPort: FUNNEL_PORT,
      funnel: { on, url: h?.url ?? (self?.DNSName ? hookUrl(self) : undefined), blocker: funnelBlocker(self), fleet: !!fleet.machine, error: door && !door.ok && door.error ? funnelError(door.error) : undefined },
      token: { source: tokenSource(), scopes, canHook: scopesAllowHooks(scopes) },
      signIn: hookSignIn ? githubLoginState() : undefined,
      repos: hookRepos().map((repo) => ({ repo, watched: repo in config.repos, id: h?.repos[repo]?.id, live: hooked(repo), lastAt: stats.byRepo[repo], problem: h?.problems?.[repo] })),
      lastAt: stats.lastAt, today: stats.today, bad: stats.bad,
    }
  }
  // the door's ask and answer sit beside update-asked: not in hosts/, where every .json is a machine's heartbeat
  const DOOR_DIR = STATE_DIR
  try { unlinkSync(join(STATE_DIR, 'hosts', 'hooks-funnel.json')) } catch { /* v299 put it there: it read as a machine */ }
  /** Ask the fleet to open or close the webhook door here, and wait for its standby to say it did (Tailscale is the
   *  fleet's: a machine without the fleet has no door to open). */
  async function door(on: boolean) {
    if (!fleet.machine) throw new Error('Live updates need the fleet: Tailscale, which opens the door, runs there (fleet/README.md)')
    const r = await doorAnswer(DOOR_DIR, fleet.machine, askDoor(DOOR_DIR, on, hookPort()))
    if (!r) {
      // most often a standby still on a script from before the door: bin/update restarts it once the new one is 3 minutes old
      const [{ beats }, code] = await Promise.all([infraView(), fleetCode()]), mine = beats.find((b) => b.name === fleet.machine)
      if (mine && standbyBehind(mine, code)) throw new Error(`This machine's standby still runs an older bin/standby: the next update restarts it (within a few minutes), then try again.`)
      throw new Error('The fleet hasn\'t answered yet: its standby runs Tailscale and looks every 10 seconds. Is it running on this machine?')
    }
    if (!r.ok) throw new Error(funnelError(r.error ?? ''))
    if (r.on !== on) throw new Error(on ? 'Funnel didn\'t take' : 'Funnel stayed on')
  }
  // the door follows the control plane: each start says what is wanted now (open, or closed if it was turned off on
  // another machine meanwhile), and the standby opens it only where this machine runs Concierge, closing it anywhere else
  if (fleet.machine) askDoor(DOOR_DIR, !!state.hooks?.url, hookPort())
  const hookFail = (c: Context, e: unknown) => c.json({ error: (e as Error).message }, 400)
  app.get('/hooks', async (c) => c.json(await hooksView()))
  // Step 1: the funnel, for the hook path only (a secret made the first time, the listener started)
  app.post('/hooks/funnel', async (c) => {
    const { on } = await c.req.json<{ on?: boolean }>().catch(() => ({ on: undefined }))
    try {
      if (on) {
        const self = (await tsStatus())?.Self as Self | undefined, why = funnelBlocker(self)
        if (why) throw new Error(why)
        if (!readSecrets().webhookSecret) saveSecrets({ webhookSecret: newSecret() })
        await startHooks()
        await door(true)
        state.hooks = { repos: {}, ...state.hooks, url: hookUrl(self!) }
        console.log(`hooks: funnel open at ${state.hooks.url}`)
      } else {
        await door(false)
        if (state.hooks) delete state.hooks.url
        console.log('hooks: funnel closed')
      }
      save()
      return c.json(await hooksView())
    } catch (e) { return hookFail(c, e) }
  })
  // Step 2: a webhook on each repository chosen (one already pointing here is updated, never doubled)
  app.post('/hooks/connect', async (c) => {
    const { repos } = await c.req.json<{ repos?: unknown }>().catch(() => ({ repos: [] }))
    const url = state.hooks?.url, secret = readSecrets().webhookSecret
    if (!url || !secret) return c.json({ error: 'Open the webhook door first (step 1)' }, 400)
    const known = new Set(hookRepos())
    const list = (Array.isArray(repos) ? repos : []).filter((r): r is string => typeof r === 'string' && REPO_NAME.test(r) && known.has(r)).slice(0, 100)
    const h = state.hooks!
    const results = []
    for (const repo of list) {
      const r = await connectRepo(ghCall, repo, url, secret)
      results.push(r)
      if (r.ok) {
        h.repos[repo] = { id: r.id, at: new Date().toISOString() }
        if (h.problems) delete h.problems[repo]
        if (r.reused) void pingHook(ghCall, repo, r.id).catch(() => {}) // a new hook gets GitHub's own ping; an updated one is asked for it
      } else (h.problems ??= {})[repo] = { problem: r.problem, text: r.text, at: new Date().toISOString() }
    }
    save()
    console.log(`hooks: connected ${results.filter((r) => r.ok).length} of ${results.length} repositories`)
    return c.json({ results, view: await hooksView() })
  })
  app.post('/hooks/disconnect', async (c) => {
    const { repo } = await c.req.json<{ repo?: string }>().catch(() => ({ repo: undefined }))
    const rec = repo ? state.hooks?.repos[repo] : undefined
    if (!repo || !rec) return c.json({ error: 'No webhook of Concierge\'s there' }, 400)
    try { if (!await removeHook(ghCall, repo, rec.id)) throw new Error('GitHub didn\'t remove it') } catch (e) { return hookFail(c, e) }
    delete state.hooks!.repos[repo]; save()
    return c.json(await hooksView())
  })
  // a ping to each hook (or one): GitHub sends it through the funnel, so its arrival proves the whole way works
  app.post('/hooks/test', async (c) => {
    const { repo } = await c.req.json<{ repo?: string }>().catch(() => ({ repo: undefined }))
    const hooks = Object.entries(state.hooks?.repos ?? {}).filter(([r]) => !repo || r === repo)
    if (!hooks.length) return c.json({ error: 'No repository is connected yet' }, 400)
    const sent = await Promise.all(hooks.map(async ([r, { id }]) => ({ repo: r, ...await pingHook(ghCall, r, id).catch((e: Error) => ({ ok: false, text: e.message })) })))
    return c.json({ sent })
  })
  // Turn off: the hooks Concierge made go, then the funnel; polling goes back to every minute
  app.post('/hooks/off', async (c) => {
    const left: string[] = []
    for (const [repo, { id }] of Object.entries(state.hooks?.repos ?? {})) {
      const ok = await removeHook(ghCall, repo, id).catch(() => false)
      if (ok) delete state.hooks!.repos[repo]; else left.push(repo)
    }
    try { await door(false) } catch (e) { save(); return hookFail(c, e) }
    if (!left.length) state.hooks = undefined; else delete state.hooks!.url
    save()
    return c.json({ left, view: await hooksView() })
  })
  // a token that may not manage webhooks: sign in to GitHub again, asking for admin:repo_hook. Your own gh login in use
  // (no GITHUB_TOKEN): gh adds the scope to it (gh auth refresh); else, or when that can't start, Concierge's own sign-in
  // (as in Settings → Machines), whose token replaces the shared one for every machine
  app.post('/hooks/signin', async (c) => {
    const more = ['admin:repo_hook']
    const afterwards = async () => { await readScopes().catch(() => undefined); return (await getMe().catch(() => undefined))?.login }
    const shared = async (token: string) => { const w = await whoseKey('GITHUB_TOKEN', token); if (w.error) throw new Error(w.error); keepKey('GITHUB_TOKEN', token); await afterwards(); return w.who }
    hookSignIn = true
    try {
      if (tokenSource() === 'gh') {
        try { return c.json({ ...await startGithubLogin(async () => { tokenChanged(); return afterwards() }, { more, refresh: true }), via: 'gh' }) } catch (e) { console.warn('hooks: gh auth refresh did not start:', (e as Error).message) }
      }
      return c.json({ ...await startGithubLogin(shared, { more }), via: 'concierge' })
    } catch (e) { return hookFail(c, e) }
  })
  return { hooksView }
}
