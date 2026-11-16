import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { orgSkills } from './orgSkills.ts'

/** A skill or slash command this setup can run, as Settings → Workflows offers it. */
export type Found = { name: string; invoke: string; description?: string; argumentHint?: string; source: string; kind: 'skill' | 'command' }

/** A skill file's frontmatter: its name, what it is for, and the arguments it takes (`argument-hint`). */
export function parseSkill(text: string): { name?: string; description?: string; argumentHint?: string } {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const field = (k: string) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2') || undefined
  return { name: field('name'), description: field('description')?.slice(0, 400), argumentHint: field('argument-hint') }
}

/** The placeholders a workflow fills in, and the words in an argument hint that mean them. */
export const PLACEHOLDERS: Record<string, { token: string; means: RegExp }[]> = {
  review: [{ token: '{number}', means: /pr|pull|number|^n$|#/i }, { token: '{repo}', means: /repo|owner/i }],
  revise: [{ token: '{repo}#{number}', means: /repo.*#|pr.?ref|ref/i }, { token: '{number}', means: /pr|pull|number|^n$/i }, { token: '{repo}', means: /repo|owner/i }],
  stack: [{ token: '{stack}', means: /stack/i }, { token: '{number}', means: /pr|number/i }],
  exec: [{ token: '{ids}', means: /id|ticket|issue|linear/i }],
}

/**
 * A command for `invoke` from its argument hint: each argument the workflow knows becomes its placeholder, a flag
 * stays as written, and anything else is left for you (an empty slot). "[pr-number] [--fast]" → "/x {number}".
 */
export function commandFor(invoke: string, hint: string | undefined, work: string): { command: string; args: { word: string; token?: string }[] } {
  const words = (hint ?? '').split(/\s+/).filter(Boolean) // "<repo>#<n>" stays one argument
  const left = [...(PLACEHOLDERS[work] ?? [])]
  const args = words.map((raw) => {
    const word = raw.replace(/^[[<(]|[\]>)]$/g, '')
    if (word.startsWith('-')) return { word }
    const i = left.findIndex((p) => p.means.test(word))
    if (i < 0) return { word }
    const token = left.splice(i, 1)[0].token
    // {repo}#{number} already carries {repo} and {number}: neither is filled again
    for (let j = left.length - 1; j >= 0; j--) if (token.includes(left[j].token) || left[j].token.includes(token)) left.splice(j, 1)
    return { word, token }
  })
  const fill = args.filter((a) => a.token).map((a) => a.token)
  // nothing in the hint matched: the workflow's main placeholder still goes in, as every skill here needs its target
  if (!fill.length && PLACEHOLDERS[work]?.[0]) fill.push(PLACEHOLDERS[work][0].token)
  return { command: [invoke, ...fill].join(' '), args }
}

const list = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => [])
async function read(file: string, fallback: string, invoke: (name: string) => string, source: string, kind: Found['kind']): Promise<Found | undefined> {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (text === undefined) return
  const f = parseSkill(text), name = f.name ?? fallback
  return { name, invoke: invoke(name), description: f.description, argumentHint: f.argumentHint, source, kind }
}

let cache: { at: number; found: Promise<Found[]> } | undefined
/** Every skill and command on this setup: yours (~/.claude), each plugin's (its newest version), the org's. Cached a minute. */
export function scanSkills(): Promise<Found[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.found
  const found = (async () => {
    const home = join(homedir(), '.claude'), out: Promise<Found | undefined>[] = []
    for (const d of await list(join(home, 'skills'))) if (!d.name.startsWith('.')) out.push(read(join(home, 'skills', d.name, 'SKILL.md'), d.name, (n) => `/${n}`, 'yours', 'skill'))
    for (const d of await list(join(home, 'commands'))) if (d.name.endsWith('.md')) out.push(read(join(home, 'commands', d.name), d.name.slice(0, -3), (n) => `/${n}`, 'yours', 'command'))
    // plugins: cache/<marketplace>/<plugin>/<version>/{skills/*/SKILL.md, commands/*.md}, newest version only
    const cacheDir = join(home, 'plugins', 'cache')
    for (const m of await list(cacheDir)) for (const p of await list(join(cacheDir, m.name))) {
      const versions = (await list(join(cacheDir, m.name, p.name))).map((v) => v.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      const at = versions.at(-1)
      if (!at) continue
      const base = join(cacheDir, m.name, p.name, at), plug = (n: string) => `/${p.name}:${n}`
      for (const d of await list(join(base, 'skills'))) out.push(read(join(base, 'skills', d.name, 'SKILL.md'), d.name, plug, `plugin ${p.name}`, 'skill'))
      for (const d of await list(join(base, 'commands'))) if (d.name.endsWith('.md')) out.push(read(join(base, 'commands', d.name), d.name.slice(0, -3), plug, `plugin ${p.name}`, 'command'))
    }
    for (const s of orgSkills()) out.push(read(s.file, s.name, (n) => `/${n}`, 'org', 'skill'))
    const all = (await Promise.all(out)).filter((x): x is Found => !!x)
    // the same invocation from two places (a skill synced into ~/.claude from the org): the first wins
    return [...new Map(all.map((x) => [x.invoke, x])).values()].sort((a, b) => a.invoke.localeCompare(b.invoke))
  })()
  cache = { at: Date.now(), found }
  return found
}
