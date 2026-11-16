// Put tickets in the right Linear release when their PR merges: a merge into develop goes to the release
// in progress, a merge into beta to the beta release (whatever the rules in config map each branch to).
import { config } from './config.ts'
import { gh } from './github.ts'
import { gql } from './linear.ts'

type IssueRelease = { id: string; name: string; pipeline: string; stageType: string }
export type ReleaseMove = { at: string; pr: string; ticket: string; release: string; removed: string[]; dryRun?: boolean; note?: string }

/**
 * The tickets a PR is for, by its own name: the id a branch starts with (Linear's "ac-1230-some-slug") and the first
 * id in its title ("fix: AC-1230 …"). Ids further along are mentions, e.g. a slug saying "after-ac-1162-fix".
 */
export function ticketsOf(title: string, branch: string): string[] {
  const id = (m?: RegExpMatchArray | null) => (m ? [`${m[1]}-${m[2]}`.toUpperCase()] : [])
  const branchName = branch.split('/').pop() ?? ''
  return [...new Set([...id(branchName.match(/^([a-z][a-z0-9]{1,5})-(\d{1,6})(?:-|$)/i)), ...id(title.match(/\b([a-z][a-z0-9]{1,5})-(\d{1,6})\b/i))])]
}

/**
 * What to change on one issue: add it to `target` unless it is already there, and take it out of the pipeline's
 * other releases that have not shipped (a ticket is in one upcoming release; released ones stay as history).
 */
export function plan(current: IssueRelease[], target: { id: string }, pipeline: string) {
  if (current.some((r) => r.id === target.id)) return { add: false, remove: [] as IssueRelease[] }
  return { add: true, remove: current.filter((r) => r.pipeline === pipeline && r.id !== target.id && r.stageType !== 'completed' && r.stageType !== 'canceled') }
}

/** The release a stage stands for: the oldest unshipped release of the pipeline in that stage ("the next one in progress"). */
export function pick(releases: { id: string; name: string; createdAt: string; stage: { name: string; type: string } }[], stage: string) {
  return releases.filter((r) => r.stage.name.toLowerCase() === stage.toLowerCase() && r.stage.type !== 'completed' && r.stage.type !== 'canceled')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
}

async function pipelineReleases(pipeline: string) {
  const d = await gql<{ releasePipeline: { releases: { nodes: { id: string; name: string; createdAt: string; stage: { name: string; type: string } }[] } } }>(
    'query($p: String!) { releasePipeline(id: $p) { releases(first: 30) { nodes { id name createdAt stage { name type } } } } }', { p: pipeline })
  return d.releasePipeline.releases.nodes
}

async function issueOf(identifier: string) {
  const d = await gql<{ issue: { id: string; identifier: string; releases: { nodes: { id: string; name: string; stage: { type: string }; pipeline: { slugId: string } }[] } } | null }>(
    'query($id: String!) { issue(id: $id) { id identifier releases(first: 10) { nodes { id name stage { type } pipeline { slugId } } } } }', { id: identifier }).catch(() => ({ issue: null }))
  const i = d.issue
  return i && { id: i.id, identifier: i.identifier, releases: i.releases.nodes.map((r) => ({ id: r.id, name: r.name, pipeline: r.pipeline.slugId, stageType: r.stage.type })) }
}

async function linkedTickets(prUrl: string) {
  const d = await gql<{ attachmentsForURL: { nodes: { issue: { identifier: string } | null }[] } }>(
    'query($u: String!) { attachmentsForURL(url: $u, first: 10) { nodes { issue { identifier } } } }', { u: prUrl }).catch(() => ({ attachmentsForURL: { nodes: [] } }))
  return d.attachmentsForURL.nodes.flatMap((n) => (n.issue ? [n.issue.identifier] : []))
}

type Pull = { number: number; title: string; html_url: string; merged_at: string | null; head: { ref: string } }

/**
 * Every PR merged into a ruled branch after `since[repo:branch]`: its tickets go to the branch's release.
 * Returns what it did (or would do, with dryRun) and the new watermarks.
 */
export async function syncReleases(since: Record<string, string>, dryRun = false) {
  const moves: ReleaseMove[] = []
  const marks = { ...since }
  for (const rule of config.releases ?? []) {
    const releases = await pipelineReleases(rule.pipeline)
    for (const [branch, stage] of Object.entries(rule.branches)) {
      const key = `${rule.repo}:${branch}`
      const after = marks[key] ?? new Date().toISOString() // first sight: start from now, never backfill on its own
      const pulls = (await gh<Pull[]>(`/repos/${rule.repo}/pulls?state=closed&base=${encodeURIComponent(branch)}&sort=updated&direction=desc&per_page=50`))
        .filter((p) => p.merged_at && p.merged_at > after).sort((a, b) => a.merged_at!.localeCompare(b.merged_at!))
      const target = pick(releases, stage)
      for (const p of pulls) {
        const ids = [...new Set([...await linkedTickets(p.html_url), ...ticketsOf(p.title, p.head.ref)])]
        for (const id of ids) {
          const issue = await issueOf(id)
          if (!issue) continue // a word that looks like an id, or another workspace's
          const base = { at: p.merged_at!, pr: `${rule.repo.split('/')[1]}#${p.number}`, ticket: issue.identifier, release: target?.name ?? `no “${stage}” release`, removed: [] as string[], dryRun }
          if (!target) { moves.push({ ...base, note: `nothing in stage ${stage}` }); continue }
          const todo = plan(issue.releases, target, rule.pipeline)
          if (!todo.add) continue
          if (!dryRun) {
            for (const r of todo.remove) await gql('mutation($i: String!, $r: String!) { issueToReleaseDeleteByIssueAndRelease(issueId: $i, releaseId: $r) { success } }', { i: issue.id, r: r.id })
            await gql('mutation($i: String!, $r: String!) { issueToReleaseCreate(input: { issueId: $i, releaseId: $r }) { success } }', { i: issue.id, r: target.id })
          }
          moves.push({ ...base, removed: todo.remove.map((r) => r.name) })
        }
        marks[key] = p.merged_at!
      }
      marks[key] ??= after
    }
  }
  return { moves, marks }
}
