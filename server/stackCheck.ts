// A look across a stack: each PR was reviewed or revised on its own, so nothing has yet asked whether they agree with
// each other (one question decided two ways, a rename a higher PR hasn't followed, the same fix in two PRs). One call
// reads what each PR's agent found and decided and reports only what crosses PRs. Cached until a PR in the stack gets
// a new head or a new run. The method is the check-stack skill; the format it answers in is here.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOverlay } from './explain.ts'
import { method } from './method.ts'
import { providerFor, spawnAgent, tokensOf, type ProviderId } from './providers.ts'
import { state, STATE_DIR, type Pr, type StackRef } from './store.ts'

export type StackIssue = { prs: number[]; title: string; why: string; fix: string }
export type StackCheck = {
  sig: string // the heads and runs it was read from
  issues: StackIssue[]; agrees: string
  direction: string // the direction the stack follows, as the PRs show it: a few lines for every agent on it to hold to
  read: number[]; unread: number[] // the PRs with something to read, and the ones with nothing yet (not checked)
  at: string; costUsd: number; provider?: ProviderId; tokens?: { input: number; output: number }
}

const file = (chain: StackRef[]) => join(STATE_DIR, 'explain', `stack-check-${chain[0].repo.replace('/', '-')}-${chain[0].number}-${chain.length}.json`)
const tracked = (s: StackRef): Pr | undefined => state.prs[`${s.repo}#${s.number}`]
/** Changes whenever a PR in the stack gets a new head or its agent finishes another run. */
export const checkSignature = (chain: StackRef[]) => chain.map((s) => { const p = tracked(s); return `${s.number}:${p?.headSha?.slice(0, 7) ?? '?'}:${p?.job?.endedAt ?? ''}` }).join(',')

export async function cachedStackCheck(chain: StackRef[]): Promise<(StackCheck & { stale: boolean }) | undefined> {
  try { const c = JSON.parse(await readFile(file(chain), 'utf8')) as StackCheck; return { ...c, stale: c.sig !== checkSignature(chain) } } catch { return undefined }
}

const schema = {
  type: 'object', additionalProperties: false, required: ['issues', 'agrees', 'direction'],
  properties: {
    agrees: { type: 'string' }, direction: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['prs', 'title', 'why', 'fix'], properties: { prs: { type: 'array', items: { type: 'number' } }, title: { type: 'string' }, why: { type: 'string' }, fix: { type: 'string' } } } },
  },
}

/** What there is to read on one PR: what it is for, what its agent last said, and what that leaves open. */
export function partOf(s: StackRef, i: number, p: Pr | undefined, about?: { headline: string; what: string }) {
  // what its agent last said when a run ended (kept on the PR: the job's own slot may hold a newer run that said nothing)
  const said = (p?.job && p.job.state !== 'running' && p.job.state !== 'queued' ? p.job.summary?.trim() : undefined) || p?.lastSaid?.summary.trim()
  const open = p?.job?.next?.steps?.map((x) => `- ${x.text}`).join('\n')
  const text = [`## ${i + 1}. #${s.number} "${s.title}" (into ${s.base})`,
    about ? `What it is for: ${about.headline}. ${about.what}` : '',
    said ? `What its agent found and did:\n${said.slice(0, 4000)}` : '(no agent has finished on it yet)',
    open ? `Still open on it:\n${open.slice(0, 1500)}` : ''].filter(Boolean).join('\n')
  return { text, has: !!said }
}

const inflight = new Map<string, Promise<StackCheck>>()
export const checkingStack = (chain: StackRef[]) => inflight.has(file(chain))
export function checkStack(chain: StackRef[], written = '') {
  const key = file(chain)
  if (!inflight.has(key)) inflight.set(key, read(chain, written).finally(() => inflight.delete(key)))
  return inflight.get(key)!
}

async function read(chain: StackRef[], written: string): Promise<StackCheck> {
  const sig = checkSignature(chain)
  const parts = chain.map((s, i) => { const p = tracked(s), o = p && loadOverlay(p); return { n: s.number, ...partOf(s, i, p, o?.business) } })
  const readNums = parts.filter((x) => x.has).map((x) => x.n), unread = parts.filter((x) => !x.has).map((x) => x.n)
  if (readNums.length < 2) throw new Error('Fewer than two PRs of this stack have a finished run: there is nothing to compare yet')
  const system = await method('stackCheck', 'Return only the structured output. Fields: issues (each: prs as PR numbers, title, why, fix; an empty array when the PRs agree), direction (lines separated by a newline, each starting with "- ") and agrees.')
  const prompt = ['These pull requests form one stack. Each is built on the branch it merges into ("into"), so one listed earlier merges first; several can be built on the same one. Below is what there is on each.', ...(written.trim() ? ['', `The direction the person has written for this stack (keep it, add only what is new):\n${written.trim()}`] : []), '', ...parts.map((x) => x.text)].join('\n\n')
  const p = providerFor('small')
  const r = await new Promise<any>((resolve, reject) => {
    const child = spawnAgent(p, ['-p', prompt, '--json-schema', JSON.stringify(schema), '--output-format', 'json', '--model', 'sonnet', '--max-budget-usd', '0.5',
      '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence', '--system-prompt', system], { cwd: tmpdir() })
    let out = ''
    child.stdout.on('data', (c: Buffer) => { out += c })
    child.on('error', reject)
    child.on('close', () => { try { const j = JSON.parse(out); if (!j.structured_output) throw new Error(String(j.result ?? 'no answer')); resolve(j) } catch (e) { reject(e) } })
  })
  const known = new Set(chain.map((s) => s.number))
  const issues = ((r.structured_output.issues ?? []) as StackIssue[]).map((x) => ({ ...x, prs: [...new Set(x.prs)].filter((n) => known.has(n)) })).filter((x) => x.prs.length > 0)
  const c: StackCheck = { sig, issues, direction: String(r.structured_output.direction ?? '').trim(), agrees: String(r.structured_output.agrees ?? ''), read: readNums, unread, at: new Date().toISOString(), costUsd: r.total_cost_usd ?? 0, provider: p, tokens: tokensOf(r) }
  await mkdir(join(STATE_DIR, 'explain'), { recursive: true })
  await writeFile(file(chain), JSON.stringify(c))
  return c
}
