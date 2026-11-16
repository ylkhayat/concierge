// A tour of a whole stack: how its PRs play together, bottom to top. Built from each PR's own explanation
// (or its title and description when it has none) by one lean Haiku call, cached until a PR in the stack moves.
import { method } from './method.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { providerFor, spawnAgent, tokensOf } from './providers.ts'
import { join } from 'node:path'
import { loadOverlay } from './explain.ts'
import { state, STATE_DIR, type Pr, type StackRef } from './store.ts'

export type StackTour = {
  sig: string // which heads and explanations it was written from
  provider?: import('./providers.ts').ProviderId // who wrote it (none: Claude)
  tokens?: { input: number; output: number }
  story: string // the stack's purpose, end to end
  order: string // why it is cut in this order, or how to review it
  parts: { number: number; role: string; buildsOn: string }[]
  watch: string[] // what to keep an eye on across PRs
  costUsd: number
}

const file = (chain: StackRef[]) => join(STATE_DIR, 'explain', `stack-${chain[0].repo.replace('/', '-')}-${chain[0].number}.json`)
const tracked = (s: StackRef): Pr | undefined => state.prs[`${s.repo}#${s.number}`]
/** Changes whenever a PR in the stack gets a new head or a new explanation. */
export const signature = (chain: StackRef[]) => chain.map((s) => { const p = tracked(s); return `${s.number}:${p?.headSha?.slice(0, 7) ?? '?'}:${p ? loadOverlay(p)?.iteration ?? 0 : 0}` }).join(',')

export function cachedStackTour(chain: StackRef[]): StackTour | undefined {
  const f = file(chain)
  if (!existsSync(f)) return undefined
  try { const t = JSON.parse(readFileSync(f, 'utf8')) as StackTour; return t.sig === signature(chain) ? t : { ...t, sig: `stale:${t.sig}` } } catch { return undefined }
}

const schema = {
  type: 'object', additionalProperties: false, required: ['story', 'order', 'parts', 'watch'],
  properties: {
    story: { type: 'string' }, order: { type: 'string' }, watch: { type: 'array', items: { type: 'string' } },
    parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['number', 'role', 'buildsOn'], properties: { number: { type: 'number' }, role: { type: 'string' }, buildsOn: { type: 'string' } } } },
  },
}

const inflight = new Map<string, Promise<StackTour>>()

/** A tour of this stack is being written now (asked from any of its PRs). */
export const writingStackTour = (chain: StackRef[]) => inflight.has(file(chain))

export function makeStackTour(chain: StackRef[]) {
  const key = file(chain)
  if (!inflight.has(key)) inflight.set(key, write(chain).finally(() => inflight.delete(key)))
  return inflight.get(key)!
}

async function write(chain: StackRef[]): Promise<StackTour> {
  const sig = signature(chain)
  const prs = chain.map((s, i) => {
    const p = tracked(s), o = p && loadOverlay(p)
    return [`## ${i + 1}. #${s.number} "${s.title}" (into ${s.base})`,
      o ? `Headline: ${o.business.headline}\nWhat: ${o.business.what}\nWhy: ${o.business.why}${o.tour?.focus ? `\nRead first: ${o.tour.focus}` : ''}\nFiles: ${o.facts.changes.length}`
        : `(not explained yet) ${(p?.body ?? '').slice(0, 600)}`].join('\n')
  })
  const system = await method('stackTour', 'Return only the structured output.')
  const prompt = ['These pull requests form one stack, bottom (merges first) to top. Explain how they play together, for a reviewer about to read them.',
    'Fields: story, order, parts (one per PR, by number: role and buildsOn), watch (an empty array if nothing).',
    '', ...prs].join('\n')
  const p = providerFor('small')
  return new Promise((resolve, reject) => {
    const child = spawnAgent(p, ['-p', prompt, '--json-schema', JSON.stringify(schema), '--output-format', 'json', '--model', 'haiku', '--max-budget-usd', '0.2',
      '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence',
      '--system-prompt', system], { cwd: tmpdir() })
    let out = ''
    child.stdout.on('data', (c: Buffer) => { out += c })
    child.on('error', reject)
    child.on('close', () => {
      try {
        const r = JSON.parse(out)
        if (!r.structured_output) throw new Error(String(r.result ?? 'no answer'))
        const t: StackTour = { sig, ...r.structured_output, costUsd: r.total_cost_usd ?? 0, provider: p, tokens: tokensOf(r) }
        mkdirSync(join(STATE_DIR, 'explain'), { recursive: true })
        writeFileSync(file(chain), JSON.stringify(t))
        resolve(t)
      } catch (e) { reject(e) }
    })
  })
}
