import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATE_DIR } from './paths.ts'

/** A norm the reviewer chose to depart from in a repo: later reviews of that repo don't file it again. */
export type Exception = { norm: string; source: string; why: string; pr: number; at: string }

const FILE = join(STATE_DIR, 'norms.json')
let byRepo: Record<string, Exception[]> = {}
// read once at start, kept in memory: the review prompt is built synchronously
void readFile(FILE, 'utf8').then((t) => { byRepo = JSON.parse(t) }, () => {})

export const exceptionsOf = (repo: string) => byRepo[repo] ?? []

export async function addException(repo: string, e: Exception) {
  byRepo = { ...byRepo, [repo]: [...exceptionsOf(repo).filter((x) => x.norm !== e.norm), e] }
  await writeFile(FILE, JSON.stringify(byRepo, null, 2))
}

/** The repo's deliberate exceptions, for the review prompt (norms-lens.md: listed ones are not filed). */
export function normsNote(repo: string): string {
  const xs = exceptionsOf(repo)
  return xs.length ? `\n\nDeliberate exceptions in ${repo}: the reviewer departs from these norms on purpose. Do not file them as NORM:\n`
    + xs.map((x) => `- ${x.norm} (${x.source}): ${x.why}`).join('\n') : ''
}
