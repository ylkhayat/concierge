// The codebase routes, out of server/index.ts: mounted on the API there.
import { defaultBranch } from '../github.ts'
import { cancelBase, enqueueBase } from '../runner.ts'
import { basePlan, codebase, loadBase } from '../explain.ts'
import { config, state } from '../store.ts'
import type { Hono as App } from 'hono'

export function codebaseRoutes(app: App) {
  // --- the codebase map: a summary of each repo's default branch that every PR is explained against ---
  app.get('/base', (c) => c.json(Object.keys(config.repos).map((repo) => ({ repo, meta: loadBase(repo), task: state.base[repo] }))))
  const plans = new Map<string, { at: number; plan: Promise<object> }>()
  app.get('/base/plan', async (c) => {
    const repo = c.req.query('repo') ?? ''
    if (!config.repos[repo]) return c.json({ error: 'unknown repo' }, 404)
    const under = c.req.query('under') || undefined
    const key = `${repo}:${under ?? ''}`
    const cached = plans.get(key)
    if (!cached || Date.now() - cached.at > 120_000) plans.set(key, { at: Date.now(), plan: defaultBranch(repo).then(async (b) => {
      const p = await basePlan(repo, config.repos[repo], b, under)
      // systems: the system map is missing or lumps the repo together, so a map run redraws it (about $0.30)
      return { branch: p.branch, sha: p.sha, folders: p.scope.length, known: p.known, toMap: p.asks.length, systems: p.needSkeleton, estimateUsd: Math.round((p.estimateUsd + (p.needSkeleton ? 0.3 : 0)) * 100) / 100 }
    }) })
    try { return c.json({ ...(await plans.get(key)!.plan), complete: loadBase(repo)?.complete !== false, mapped: !!loadBase(repo) }) } catch (e) { plans.delete(key); return c.json({ error: (e as Error).message }, 500) }
  })
  app.get('/codebase', async (c) => {
    const repo = c.req.query('repo') ?? ''
    if (!config.repos[repo]) return c.json({ error: 'unknown repo' }, 404)
    const data = await codebase(repo, config.repos[repo])
    return data ? c.json(data) : c.json({ error: 'not mapped yet' }, 404)
  })
  app.post('/base', async (c) => {
    const { repo, action, under } = await c.req.json() as { repo: string; action: 'start' | 'cancel'; under?: string }
    if (!config.repos[repo]) return c.json({ error: 'unknown repo' }, 404)
    if (under !== undefined && (typeof under !== 'string' || under.includes('..') || under.startsWith('/'))) return c.json({ error: 'bad folder' }, 400)
    if (action === 'cancel') cancelBase(repo); else { for (const k of plans.keys()) if (k.startsWith(repo + ':')) plans.delete(k); enqueueBase(repo, under || undefined) }
    return c.json({ ok: true })
  })

}
