// GitHub issues as tickets: for repos that don't track work in Linear. The open issues assigned to you in the repos
// Concierge watches become tickets like Linear's, under a key per repo ("ELBU-12" is elbuffeh's issue #12), so the
// board, the runs and the links treat both the same. Linear-only moves (comment, assign) go through gh here instead.
import { execFile } from 'node:child_process'
import type { Ticket } from './linear.ts'

/** Each repo's issue key and back: filled as issues are read; repoFor (exec.ts) looks here after the Linear prefixes. */
export const issueKeys = new Map<string, string>() // key → owner/repo
const keyOfRepo = new Map<string, string>() // owner/repo → key

/** A repo's key: the first four letters of its name, uppercase ("elbuffeh" → ELBU); one taken (a Linear team's, another repo's) ends in a letter instead. */
export function keyFor(repo: string, taken: (k: string) => boolean): string {
  const had = keyOfRepo.get(repo)
  if (had) return had
  const letters = (repo.split('/')[1] ?? repo).replace(/[^a-z]/gi, '').toUpperCase()
  const base = (letters.length >= 2 ? letters : `GH${letters}`).slice(0, 4)
  let k = base
  for (let i = 0; taken(k) || issueKeys.has(k); i++) k = base.slice(0, 3) + String.fromCharCode(65 + i) // ELBU taken: ELBA, ELBB…
  issueKeys.set(k, repo); keyOfRepo.set(repo, k)
  return k
}

/** The issue behind a ticket id, when it is one. */
export function issueOf(id: string): { repo: string; number: number } | undefined {
  const m = /^([A-Z]+)-(\d+)$/.exec(id)
  const repo = m && issueKeys.get(m[1])
  return repo ? { repo, number: Number(m[2]) } : undefined
}

type SearchItem = {
  number: number; title: string; body: string | null; html_url: string; repository_url: string; updated_at: string; created_at: string
  labels: { name: string }[]; comments: number; pull_request?: unknown
}

/** An issue, as a ticket. Its PRs are the watched ones that close it ("Fixes #12") or name its key. */
export function toTicket(it: SearchItem, repo: string, key: string, prs: { repo: string; number: number; url: string; title: string; body?: string; head?: string }[]): Ticket {
  const id = `${key}-${it.number}`
  const closes = new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${it.number}\\b`, 'i')
  const named = new RegExp(`\\b${id}\\b`, 'i')
  const linked = prs.filter((p) => p.repo === repo && (closes.test(p.body ?? '') || named.test(`${p.title} ${p.head ?? ''}`)))
  const slug = it.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return {
    id, title: it.title, url: it.html_url, description: it.body ?? '',
    state: linked.length ? 'In Review' : 'Open', stateType: linked.length ? 'started' : 'unstarted',
    priority: 0, labels: it.labels.map((l) => l.name), team: key, branch: `${id.toLowerCase()}-${slug}`,
    updatedAt: it.updated_at, createdAt: it.created_at, agentWaiting: false,
    prs: linked.map((p) => ({ repo: p.repo, number: p.number, url: p.url, title: p.title })),
    source: 'github',
  }
}

/** Your open issues in the watched repos, one search for all of them. */
export async function myIssues(
  repos: string[], taken: (k: string) => boolean, prs: Parameters<typeof toTicket>[3],
  search: (q: string) => Promise<{ items: SearchItem[] }>,
): Promise<Ticket[]> {
  if (!repos.length) return []
  const q = `is:issue is:open assignee:@me ${repos.map((r) => `repo:${r}`).join(' ')}`
  const { items } = await search(q)
  return items.filter((it) => !it.pull_request).flatMap((it) => {
    const repo = it.repository_url.split('/repos/')[1]
    return repo && repos.includes(repo) ? [toTicket(it, repo, keyFor(repo, taken), prs)] : []
  })
}

/** What a run on an issue is told: the issue is on GitHub, so it reads and asks there, and its PR closes it. */
export const issueNote = (ids: string[]) => {
  const on = ids.map((id) => ({ id, i: issueOf(id) })).filter((x) => x.i)
  return on.length ? `\n\nThese are GitHub issues, not Linear tickets: ${on.map(({ id, i }) => `${id} is issue #${i!.number} in ${i!.repo}`).join('; ')}. `
    + 'Read each with `gh issue view <n> -R <repo> --comments`. Where your instructions say Linear, use the issue instead: ask a question with '
    + '`gh issue comment` and stop; never look it up in Linear. Name the key in the branch and the PR title, and put `Fixes #<n>` in the PR body.' : ''
}

const run = (args: string[]) => new Promise<string>((ok, no) =>
  execFile('gh', args, { timeout: 30_000 }, (e, out, err) => (e ? no(new Error(String(err || e.message).trim().slice(0, 300))) : ok(out.trim()))))
/** Your words on the issue, as you (Linear's postComment, for an issue). Returns the comment's URL. */
export const commentOnIssue = (id: string, body: string) => { const i = issueOf(id)!; return run(['issue', 'comment', String(i.number), '-R', i.repo, '--body', body]) }
/** Yours (Linear's assignToMe, for an issue). */
export const assignIssue = async (id: string) => { const i = issueOf(id)!; await run(['issue', 'edit', String(i.number), '-R', i.repo, '--add-assignee', '@me']) }

/** A run on issues when no exec command is set: ship it the plain way. */
export const shipIssuesPrompt = (ids: string[]) => `Ship ${ids.join(', ')}. For each: read the issue, find the code it touches, and make the smallest change that fully solves it, `
  + 'in a new worktree on a branch off the up-to-date default branch. Add or update the tests that cover it, run the repo\'s checks for what you changed, '
  + 'commit (conventional commit), push, and open a PR. When something only the issue\'s owner can decide is missing, ask it on the issue and stop. '
  + 'End with one line per issue: `<id> <branch> <sha> shipped`, `<id> refined` (you asked) or `<id> failed: <why>`.'
