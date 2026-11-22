// Your workspaces: the organizations Concierge works with (Settings → Workspaces), each with the repositories you
// watch in it. Everything acts on these (compliance, plans, Ship's teams), never on every organization your GitHub
// account happens to belong to (those are only offered when you add a workspace). And where each one manages its
// work: Linear, or GitHub Projects. Planning offers an organization's projects from there, and Ship maps
// Linear teams only to repositories of the organizations that use Linear. Set per organization (Settings, or where
// it is offered); until then guessed: Linear when a Linear team already works in one of its repositories.
import { config, saveConfig } from './config.ts'
import { getMe, gh, graphql } from './github.ts'
import { profileFor, type Compliance } from './readiness.ts'

export type Tracker = 'linear' | 'github'
export type Org = { owner: string; personal: boolean; tracker: Tracker; guessed: boolean; repos: string[] }

// the GitHub organizations you belong to and the Linear workspace your key is for: asked once an hour
let known: { at: number; orgs: string[]; linear?: string[] } | undefined
async function lookAround() {
  if (known && Date.now() - known.at < 3600_000) return known
  const [mine, linear] = await Promise.all([
    gh<{ login: string }[]>('/user/orgs?per_page=100').then((l) => l.map((o) => o.login), () => [] as string[]),
    !process.env.LINEAR_API_KEY ? undefined : fetch('https://api.linear.app/graphql', { method: 'POST', headers: { authorization: process.env.LINEAR_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ organization { name urlKey } }' }), signal: AbortSignal.timeout(10_000) })
      .then((r) => r.json() as Promise<{ data?: { organization?: { name?: string; urlKey?: string } } }>).then((j) => [j.data?.organization?.urlKey, j.data?.organization?.name].filter((x): x is string => !!x).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')), () => undefined),
  ])
  known = { at: Date.now(), orgs: mine, linear }
  return known
}

/** The workspaces: owners of watched repositories, and the organizations added as one (none of its repositories yet). */
export const workspaceOwners = () => [...new Set([...Object.keys(config.repos).map((r) => r.split('/')[0]), ...Object.entries(config.orgs ?? {}).filter(([, o]) => o.workspace).map(([k]) => k)])]

export async function orgs(): Promise<Org[]> {
  const me = (await getMe().catch(() => undefined))?.login
  const repos = Object.keys(config.repos)
  const around = await lookAround()
  const owners = workspaceOwners()
  const onLinear = new Set(Object.values(config.exec?.repoByPrefix ?? {}).map((r) => r.split('/')[0].toLowerCase()))
  // the Linear workspace's name or URL key read in the organization's name (Bliro in bliroio): it uses Linear
  const named = (owner: string) => { const o = owner.toLowerCase().replace(/[^a-z0-9]/g, ''); return !!around.linear?.some((l) => l.length >= 3 && (o.startsWith(l) || l.startsWith(o))) }
  return owners.map((owner): Org => {
    const set = config.orgs?.[owner]?.tracker
    const personal = !!me && owner.toLowerCase() === me.toLowerCase()
    return { owner, personal, tracker: set ?? (!personal && (onLinear.has(owner.toLowerCase()) || named(owner)) ? 'linear' : 'github'), guessed: !set, repos: repos.filter((r) => r.split('/')[0] === owner) }
  }).sort((a, b) => Number(a.personal) - Number(b.personal) || Number(b.tracker === 'linear') - Number(a.tracker === 'linear') || a.owner.localeCompare(b.owner))
}

/** What to offer when adding a workspace: you and the GitHub organizations you belong to, not yet workspaces. */
export async function workspaceOffers(): Promise<{ owner: string; personal: boolean }[]> {
  const me = (await getMe().catch(() => undefined))?.login
  const have = new Set(workspaceOwners().map((o) => o.toLowerCase()))
  return [...(me ? [{ owner: me, personal: true }] : []), ...(await lookAround()).orgs.map((owner) => ({ owner, personal: false }))].filter((o) => !have.has(o.owner.toLowerCase()))
}

/** Add an organization as a workspace, or take it away (its repositories stop being watched with it). */
export function setWorkspace(owner: string, on: boolean) {
  const { workspace: _, ...rest } = config.orgs?.[owner] ?? {}
  saveConfig({
    orgs: { ...(config.orgs ?? {}), [owner]: { ...rest, ...(on && { workspace: true }) } },
    ...(!on && { repos: Object.fromEntries(Object.entries(config.repos).filter(([r]) => r.split('/')[0] !== owner)) }),
  })
}

export type OwnerRepo = { repo: string; description?: string; private: boolean; pushedAt?: string }
/** A workspace's repositories on GitHub (yours: the ones you own), the most recently pushed first; archived left out. */
export async function ownerRepos(owner: string): Promise<OwnerRepo[]> {
  const me = (await getMe().catch(() => undefined))?.login
  const mine = !!me && me.toLowerCase() === owner.toLowerCase()
  type R = { full_name: string; description: string | null; private: boolean; archived: boolean; pushed_at?: string }
  const out: R[] = []
  for (let page = 1; page <= 5; page++) {
    const got = await gh<R[]>(mine ? `/user/repos?affiliation=owner&sort=pushed&per_page=100&page=${page}` : `/orgs/${encodeURIComponent(owner)}/repos?sort=pushed&per_page=100&page=${page}`)
    out.push(...got)
    if (got.length < 100) break
  }
  return out.filter((r) => !r.archived).map((r) => ({ repo: r.full_name, description: r.description ?? undefined, private: r.private, pushedAt: r.pushed_at }))
}

export function setTracker(owner: string, tracker: Tracker) {
  saveConfig({ orgs: { ...(config.orgs ?? {}), [owner]: { ...config.orgs?.[owner], tracker } } })
}

/** An organization's own compliance profile (null: back to the shared one, or off for your personal one). */
export function setCompliance(owner: string, compliance: Compliance | null) {
  const { compliance: _, ...rest } = config.orgs?.[owner] ?? {}
  saveConfig({ orgs: { ...(config.orgs ?? {}), [owner]: { ...rest, ...(compliance && { compliance }) } } })
}

/**
 * Which organization a plan is for: the one it was made in; else, planned into a Linear project, the organization
 * that manages its work in Linear; else (a plan of your own, no company project) you.
 */
export async function planOrg(p: { org?: string; project?: unknown }): Promise<string | undefined> {
  if (p.org) return p.org
  const all = await orgs().catch(() => [] as Org[])
  if (p.project) return all.find((o) => !o.personal && o.tracker === 'linear')?.owner
  return all.find((o) => o.personal)?.owner
}

/** What a plan of `owner` is checked against (readiness.ts profileFor). */
export async function complianceFor(owner: string | undefined): Promise<Compliance | undefined> {
  const me = (await getMe().catch(() => undefined))?.login
  return profileFor(owner ? config.orgs?.[owner]?.compliance : undefined, config.compliance, !!owner && !!me && owner.toLowerCase() === me.toLowerCase())
}

export type GithubProject = { id: string; name: string; url: string; description?: string; number: number }
/** An organization's (or your own) open GitHub Projects, most recently changed first. Needs read:project. */
export async function githubProjects(owner: string, personal: boolean): Promise<GithubProject[]> {
  const who = personal ? 'user' : 'organization'
  type Nodes = { projectsV2: { nodes: { id: string; title: string; number: number; url: string; closed: boolean; shortDescription?: string }[] } }
  try {
    const r = await graphql<Record<string, Nodes | null>>(`query($o: String!) { ${who}(login: $o) { projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id title number url closed shortDescription } } } }`, { o: owner })
    return (r[who]?.projectsV2.nodes ?? []).filter((x) => !x.closed).map((x) => ({ id: x.id, name: x.title, url: x.url, number: x.number, description: x.shortDescription || undefined }))
  } catch (e) {
    if (/read:project|scope/i.test((e as Error).message)) throw new Error('GitHub needs your permission to read Projects: sign in to GitHub again (Settings → Machines → GitHub token → Sign in)')
    throw e
  }
}
