// The plans routes, out of server/index.ts: mounted on the API there.
import { type Context } from 'hono'
import { addToProject as addPlanToProject, applyScenario as applyPlanScenario, applyVision, create as createPlan, setScenario as setPlanScenario, addToScenario, edit as editPlan, linearProjects, linearTeams, linkProject, syncProject, newPlan, planOf, plans as allPlans, removePlan, setPlan, talk as talkPlan, undoRedo as undoRedoPlan, withHistory, type Op as PlanOp } from '../plans.ts'
import { complianceFor, githubProjects, orgs, ownerRepos, planOrg, setTracker, setWorkspace, workspaceOffers } from '../orgs.ts'
import type { Hono as App } from 'hono'

export function plansRoutes(app: App) {
  const planErr = (c: Context, e: unknown) => c.json({ error: (e as Error).message }, 400)
  app.get('/plans', (c) => c.json({ plans: allPlans().map(({ id, title, method, nodes, busy, creating, at }) => ({ id, title, method, count: nodes.length, made: nodes.filter((n) => n.created).length, busy, creating, at })) }))
  app.post('/plans', async (c) => { const b = await c.req.json<{ title?: string; brief?: string; method?: 'agile' | 'waterfall'; appetite?: number; org?: string }>(); return c.json(newPlan(b.title ?? '', b.brief ?? '', b.method, b.appetite, b.org)) })
  // which organization a plan is for, and the compliance profile it is checked against (its own, the shared one, or off)
  app.get('/plans/:id/checks', async (c) => {
    const p = planOf(c.req.param('id'))
    if (!p) return c.json({ error: 'No such plan' }, 404)
    const org = await planOrg(p), o = (await orgs().catch(() => [])).find((x) => x.owner === org)
    // where its tickets go: the organization's tracker (Linear, or GitHub issues in its first watched repository)
    return c.json({ org, tracker: o?.tracker ?? 'linear', repo: o?.tracker === 'github' ? o.repos[0] : undefined, profile: (await complianceFor(org)) ?? {} })
  })
  app.get('/plans/teams', async (c) => { try { return c.json({ teams: await linearTeams() }) } catch (e) { return planErr(c, e) } })
  // an organization's projects, from where it manages its work: Linear's, or its GitHub Projects (orgs.ts). No organization
  // given: Linear's, as before
  app.get('/plans/projects', async (c) => {
    try {
      const owner = c.req.query('org'), o = owner ? (await orgs()).find((x) => x.owner === owner) : undefined
      if (o?.tracker === 'github') return c.json({ source: 'github', projects: (await githubProjects(o.owner, o.personal)).map((p) => ({ ...p, mine: false })) })
      return c.json({ source: 'linear', projects: await linearProjects() })
    } catch (e) { return planErr(c, e) }
  })
  app.get('/orgs', async (c) => c.json(await orgs()))
  // workspaces (Settings → Workspaces): what to offer when adding one, adding or taking one away, and a workspace's
  // repositories on GitHub to pick from
  app.get('/workspaces/offers', async (c) => c.json(await workspaceOffers()))
  app.post('/workspaces', async (c) => {
    const { owner, on } = await c.req.json<{ owner?: string; on?: boolean }>()
    if (!owner || !/^[\w.-]{1,100}$/.test(owner)) return c.json({ error: 'Which organization' }, 400)
    setWorkspace(owner, on !== false)
    return c.json(await orgs())
  })
  app.get('/workspaces/:owner/repos', async (c) => {
    const owner = c.req.param('owner')
    if (!/^[\w.-]{1,100}$/.test(owner)) return c.json({ error: 'Which organization' }, 400)
    try { return c.json(await ownerRepos(owner)) } catch (e) { return c.json({ error: `GitHub didn't list ${owner}'s repositories: ${(e as Error).message}` }, 502) }
  })
  app.post('/orgs', async (c) => {
    const { owner, tracker } = await c.req.json<{ owner?: string; tracker?: string }>()
    if (!owner || !/^[\w.-]+$/.test(owner) || (tracker !== 'linear' && tracker !== 'github')) return c.json({ error: 'An organization and linear or github' }, 400)
    setTracker(owner, tracker)
    return c.json(await orgs())
  })
  app.post('/plans/:id/project', async (c) => { try { const { project } = await c.req.json<{ project?: string }>().catch(() => ({ project: undefined })); if (!project) return c.json({ error: 'Which project?' }, 400); return c.json(withHistory(await linkProject(c.req.param('id'), project))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/sync', async (c) => { try { return c.json(withHistory(await syncProject(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/vision', async (c) => { try { return c.json(withHistory(await applyVision(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
  app.get('/plans/:id', (c) => { const p = planOf(c.req.param('id')); return p ? c.json(withHistory(p)) : c.json({ error: 'No such plan' }, 404) })
  app.post('/plans/:id', async (c) => { try { return c.json(withHistory(setPlan(c.req.param('id'), await c.req.json()))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/say', async (c) => { try { await talkPlan(c.req.param('id'), (await c.req.json<{ text: string }>()).text); return c.json(withHistory(planOf(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/scenario', async (c) => { try { return c.json(withHistory(setPlanScenario(c.req.param('id'), (await c.req.json<{ ops: PlanOp[] }>()).ops ?? []))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/scenario/add', async (c) => { try { return c.json(withHistory(addToScenario(c.req.param('id'), (await c.req.json<{ ops: PlanOp[] }>()).ops ?? []))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/scenario/apply', async (c) => { try { return c.json(await applyPlanScenario(c.req.param('id'))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/edit', async (c) => { try { return c.json(withHistory(editPlan(c.req.param('id'), (await c.req.json<{ ops: PlanOp[] }>()).ops))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/create', async (c) => { try { return c.json(withHistory(await createPlan(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/github-project', async (c) => { try { return c.json(withHistory(await addPlanToProject(c.req.param('id')))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/undo', (c) => { try { return c.json(withHistory(undoRedoPlan(c.req.param('id'), true))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/redo', (c) => { try { return c.json(withHistory(undoRedoPlan(c.req.param('id'), false))) } catch (e) { return planErr(c, e) } })
  app.post('/plans/:id/remove', (c) => { removePlan(c.req.param('id')); return c.json({ ok: true }) })
}
