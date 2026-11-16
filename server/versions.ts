// Which commit each machine runs, against the latest on GitHub: so a machine whose update didn't land (a failed pull,
// a build that never got swapped in, a machine that was asleep) shows, instead of quietly running old code.
// bin/update builds the image with the commits it built (DECK_VERSION, DECK_FLEET) and the repos they came from
// (DECK_REPOS: "owner/app owner/fleet"); the control plane reads the latest commit of each from GitHub.

export type Running = { version?: string; fleet?: string } // version: "<build number>-<short sha>"; fleet: the extension's short sha
export const runningHere = (): Running => ({ version: process.env.DECK_VERSION || undefined, fleet: process.env.DECK_FLEET || undefined })

type Head = { sha: string; at: string } // the latest commit on the default branch, and when it was committed
let latest: { app?: Head; fleet?: Head; readAt?: number } = {}
export const latestHeads = () => latest

async function head(repo: string): Promise<Head | undefined> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, {
    headers: { Accept: 'application/vnd.github+json', ...(token && { Authorization: `Bearer ${token}` }) }, signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`${repo}: GitHub said ${r.status}`)
  const c = await r.json() as { sha: string; commit: { committer: { date: string } } }
  return { sha: c.sha, at: c.commit.committer.date }
}
/** Read the latest commits again (the control plane, every few minutes). */
export async function readLatest() {
  const [app, fleet] = (process.env.DECK_REPOS ?? '').split(/\s+/).filter(Boolean)
  if (!app) return
  latest = { app: await head(app), fleet: fleet ? await head(fleet) : undefined, readAt: Date.now() }
}

const shaOf = (v?: string) => v?.split('-').pop()
const same = (short: string | undefined, h: Head | undefined) => !h || (!!short && h.sha.startsWith(short))
/** What a machine lacks of the latest: [] when it is current (or the latest isn't known). */
export function behind(r: Running): ('app' | 'fleet')[] {
  return [...(same(shaOf(r.version), latest.app) ? [] : ['app' as const]), ...(same(r.fleet, latest.fleet) ? [] : ['fleet' as const])]
}
/** Behind for longer than an update takes (bin/update runs every few minutes, and waits up to 2h for agents to finish). */
export function overdue(r: Running, now = Date.now(), grace = 150 * 60_000): boolean {
  const lacks = behind(r)
  return lacks.some((k) => { const h = latest[k]; return !!h && now - Date.parse(h.at) > grace })
}
