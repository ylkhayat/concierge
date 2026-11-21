// Fill the compliance profile for you (Settings → Compliance): from Linear, its teams and who is on each
// (a person on several teams keeps all of them), a role guessed from the teams they work in, and each person's pace
// from the points they finished in the last six weeks; from your code (every watched repository), what it shows of
// where its users are, what it is certified for, the data it handles and the reviews it requires, each with the
// evidence it was read from. Suggestions only: Settings shows them, and you take what fits.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { config } from './config.ts'
import { gql, hasKey } from './linear.ts'
import type { Member } from './readiness.ts'

const run = promisify(execFile)
export type Evidence = { id: string; files: string[]; hits: number }
export type ComplianceSuggestion = {
  team: (Member & { done6w: number })[]
  regions: Evidence[]; certifications: Evidence[]; data: Evidence[]; reviews: Evidence[]
  teams: { key: string; name: string }[]
  scanned: string[] // the repositories read
  error?: string
}

// what in the code points to each choice (case-insensitive whole words, extended regex for git grep)
const SIGNALS: Record<'regions' | 'certifications' | 'data' | 'reviews', [string, string][]> = {
  regions: [['eu', 'gdpr|dsgvo|eu-central-1|eu-west-[0-9]|europe-west[0-9]|germanywestcentral|westeurope|data processing agreement'], ['uk', 'uk gdpr|information commissioner'], ['us', 'ccpa|cpra|california consumer'],
    ['ch', 'nfadp|revdsg|swiss data'], ['ca', 'pipeda'], ['br', 'lgpd']],
  certifications: [['soc2', 'soc ?2|vanta|drata|secureframe'], ['iso27001', 'iso ?27001'], ['hipaa', 'hipaa'], ['pci', 'pci[ -]?dss']],
  data: [['personal', 'first_?name|last_?name|phone_?number|date_?of_?birth|email_?address'], ['recordings', 'recordings?|transcripts?|transcription|speech[-_ ]to[-_ ]text'],
    ['health', 'patients?|diagnosis|medical records?|ehr|hipaa'], ['payments', 'stripe|paddle|braintree|chargebee|checkout_session|invoices?'], ['children', 'coppa|parental consent'],
    ['credentials', 'refresh_token|access_token|client_secret|oauth2?']],
  reviews: [['design', 'figma.com'], ['qa', 'playwright|cypress|qa sign']],
}
/** Each choice the code shows, with the files it was read from (at most a few), across the watched repositories. */
async function scanCode(paths = config.repos): Promise<{ found: Record<keyof typeof SIGNALS, Evidence[]>; scanned: string[] }> {
  const repos = Object.entries(paths).filter(([, path]) => existsSync(path))
  const found = { regions: [], certifications: [], data: [], reviews: [] } as Record<keyof typeof SIGNALS, Evidence[]>
  for (const [k, list] of Object.entries(SIGNALS) as [keyof typeof SIGNALS, [string, string][]][]) {
    for (const [id, re] of list) {
      const files: string[] = []
      for (const [repo, path] of repos) {
        // tracked text files only, never vendored code or lockfiles: a few files are enough evidence
        const r = await run('git', ['-C', path, 'grep', '-I', '-i', '-w', '-l', '-E', re, '--', '.', ':!*.lock', ':!*lock.json', ':!*lock.yaml', ':!*.svg', ':!*.snap', ':!*.min.*', ':!**/node_modules/**', ':!**/vendor/**', ':!**/dist/**'], { maxBuffer: 4 << 20, timeout: 20_000 }).catch((e) => ({ stdout: (e as { stdout?: string }).stdout ?? '' }))
        files.push(...String(r.stdout).split('\n').filter(Boolean).map((f) => `${repo.split('/')[1]}/${f}`))
      }
      if (files.length) found[k].push({ id, files: files.slice(0, 5), hits: files.length })
    }
  }
  // a security policy or security owners: changes get a security review
  const sec = repos.flatMap(([repo, path]) => ['SECURITY.md', '.github/SECURITY.md', 'CODEOWNERS', '.github/CODEOWNERS'].filter((f) => existsSync(join(path, f)) && (!/CODEOWNERS/.test(f) || /security/i.test(readFileSync(join(path, f), 'utf8')))).map((f) => `${repo.split('/')[1]}/${f}`))
  if (sec.length) found.reviews.unshift({ id: 'security', files: sec, hits: sec.length })
  return { found, scanned: repos.map(([r]) => r) }
}

// the teams first, then each one's people (all in one query is more than Linear allows)
const TEAMS = `query { teams(first: 100) { nodes { id key name } } }`
const MEMBERS = `query($id: String!) { team(id: $id) { members(first: 250) { nodes { id name displayName active } } } }`
const DONE = `query($since: DateTimeOrDuration!, $after: String) { issues(first: 100, after: $after, filter: { completedAt: { gte: $since }, estimate: { gt: 0 } }) {
  pageInfo { hasNextPage endCursor } nodes { estimate assignee { id } } } }`
// a role from the teams someone works in: a design team makes a designer, and so on; engineer otherwise
const roleOf = (teams: string[]) => {
  const all = teams.join(' ').toLowerCase()
  const one = (re: RegExp) => teams.length > 0 && teams.every((t) => re.test(t.toLowerCase()))
  return one(/design|ux|ui/) ? 'designer' : one(/\bqa\b|quality|test/) ? 'qa' : one(/data|analytic|\bml\b/) ? 'data' : one(/secur/) ? 'security' : one(/product|\bpm\b/) ? 'pm' : /design/.test(all) && teams.length === 1 ? 'designer' : 'engineer'
}
/** The organization, its teams and their people (each with every team they are on), and each one's pace. */
async function fromLinear(): Promise<Pick<ComplianceSuggestion, 'team' | 'teams'>> {
  const o = await gql<{ teams: { nodes: { id: string; key: string; name: string }[] } }>(TEAMS)
  const people = new Map<string, { id: string; name: string; teams: string[]; teamNames: string[] }>()
  for (const t of o.teams.nodes) for (const m of (await gql<{ team: { members: { nodes: { id: string; name: string; displayName: string; active: boolean }[] } } }>(MEMBERS, { id: t.id })).team.members.nodes.filter((x) => x.active)) {
    // a name, not a login: Linear keeps the email as the name of someone who never set one
    const p = people.get(m.id) ?? { id: m.id, name: (m.name && !m.name.includes('@') ? m.name : m.displayName) || m.name, teams: [], teamNames: [] }
    p.teams.push(t.key); p.teamNames.push(t.name); people.set(m.id, p)
  }
  // pace: estimate points each finished in the last six weeks, a week
  const done = new Map<string, number>()
  const since = new Date(Date.now() - 42 * 86_400_000).toISOString()
  for (let after: string | undefined, i = 0; i < 10; i++) {
    const r = await gql<{ issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { estimate: number; assignee?: { id: string } }[] } }>(DONE, { since, after })
    for (const n of r.issues.nodes) if (n.assignee) done.set(n.assignee.id, (done.get(n.assignee.id) ?? 0) + n.estimate)
    if (!r.issues.pageInfo.hasNextPage) break
    after = r.issues.pageInfo.endCursor
  }
  const team = [...people.values()].map((p) => {
    const pts = done.get(p.id) ?? 0
    return { name: p.name, role: roleOf(p.teamNames), teams: p.teams, linearId: p.id, done6w: pts, ...(pts > 0 && { pace: Math.max(1, Math.round(pts / 6)) }) }
  }).sort((a, b) => b.done6w - a.done6w || a.name.localeCompare(b.name))
  return { team, teams: o.teams.nodes.map((t) => ({ key: t.key, name: t.name })) }
}

let cache: { at: number; v: ComplianceSuggestion } | undefined
/** Everything it can fill, read once every ten minutes at most (a full read of the code takes a while). */
export async function suggestCompliance(fresh = false, paths?: Record<string, string>): Promise<ComplianceSuggestion> {
  if (cache && !fresh && Date.now() - cache.at < 10 * 60_000) return cache.v
  const [lin, code] = await Promise.all([
    hasKey() ? fromLinear().catch((e: Error) => ({ error: e.message })) : Promise.resolve({ error: 'Linear isn\'t connected (Settings → Machines): only your code was read' }),
    scanCode(paths),
  ])
  const v: ComplianceSuggestion = { team: [], teams: [], ...('error' in lin ? { error: lin.error } : lin), ...code.found, scanned: code.scanned }
  cache = { at: Date.now(), v }
  return v
}
