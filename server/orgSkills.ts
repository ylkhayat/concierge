// The organization's skills (claude.ai syncs them into ~/.claude/skills/synced/<org>/): mirrored into the shared
// state so every machine runs the newest, offered to every agent run, and counted when a run loads one.
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fleet } from './fleet.ts'
import { save, state, STATE_DIR } from './store.ts'

export type Mode = 'auto' | 'always' | 'off'
type Meta = { name: string; description: string; company: boolean; updatedAt: string }
export type OrgSkill = Meta & {
  file: string // its SKILL.md: this machine's synced copy when it is current, else the mirror's
  mode: Mode
  machines: Record<string, 'current' | 'mirror'> // which machines have it from claude.ai ('mirror': only through Concierge)
  used?: { count: number; lastAt: string; lastFor: string }
}

const SYNCED = join(homedir(), '.claude', 'skills', 'synced')
const MIRROR = join(STATE_DIR, 'org-skills')
const me = () => fleet.machine || 'this machine'

/** What claude.ai synced to this machine: every org's manifest, the newest copy of each skill. */
async function local(): Promise<Map<string, Meta & { dir: string }>> {
  const out = new Map<string, Meta & { dir: string }>()
  for (const org of await readdir(SYNCED).catch(() => [] as string[])) {
    if (org.startsWith('.')) continue
    const m = JSON.parse(await readFile(join(SYNCED, org, 'manifest.json'), 'utf8').catch(() => '{}')) as { skills?: { name: string; description?: string; creatorType?: string | null; source?: string; updatedAt?: string }[] }
    for (const s of m.skills ?? []) {
      const had = out.get(s.name)
      if (had && had.updatedAt >= (s.updatedAt ?? '')) continue
      // made in the company (an admin's upload or a plugin of ours), not one of Anthropic's examples
      out.set(s.name, { name: s.name, description: s.description ?? '', company: s.creatorType === 'user' || s.source === 'custom', updatedAt: s.updatedAt ?? '', dir: join(SYNCED, org, s.name) })
    }
  }
  return out
}

let catalog: OrgSkill[] = []
/** The skills as last synced (no disk reads: run starts are synchronous). */
export const orgSkills = () => catalog

/**
 * Bring the mirror up to date with this machine, say what this machine has, and rebuild the catalog. A skill newer
 * here is copied into the mirror (the shared state carries it to the others); one newer in the mirror is run from there.
 */
export async function syncOrgSkills() {
  const here = await local()
  await mkdir(join(MIRROR, 'skills'), { recursive: true })
  await mkdir(join(MIRROR, 'machines'), { recursive: true })
  const metaOf = async (name: string) => JSON.parse(await readFile(join(MIRROR, 'skills', name, '.deck.json'), 'utf8').catch(() => 'null')) as Meta | null
  for (const s of here.values()) {
    const m = await metaOf(s.name)
    if (m && m.updatedAt >= s.updatedAt) continue
    await cp(s.dir, join(MIRROR, 'skills', s.name), { recursive: true, force: true })
    const { dir: _, ...meta } = s
    await writeFile(join(MIRROR, 'skills', s.name, '.deck.json'), JSON.stringify(meta))
  }
  await writeFile(join(MIRROR, 'machines', `${me()}.json`), JSON.stringify({ at: new Date().toISOString(), skills: Object.fromEntries([...here.values()].map((s) => [s.name, s.updatedAt])) }))

  const machines = await Promise.all((await readdir(join(MIRROR, 'machines')).catch(() => [] as string[])).filter((f) => f.endsWith('.json') && !f.includes('sync-conflict'))
    .map(async (f) => [f.slice(0, -5), JSON.parse(await readFile(join(MIRROR, 'machines', f), 'utf8').catch(() => '{}')).skills ?? {}] as [string, Record<string, string>]))
  const next: OrgSkill[] = []
  for (const name of await readdir(join(MIRROR, 'skills')).catch(() => [] as string[])) {
    const m = await metaOf(name)
    if (!m) continue
    const mine = here.get(name)
    next.push({
      ...m,
      file: mine && mine.updatedAt >= m.updatedAt ? join(mine.dir, 'SKILL.md') : join(MIRROR, 'skills', name, 'SKILL.md'),
      mode: state.skillModes?.[name] ?? (m.company ? 'auto' : 'off'),
      machines: Object.fromEntries(machines.map(([host, has]) => [host, has[name] && has[name] >= m.updatedAt ? 'current' : 'mirror'])),
      used: state.skillUse?.[name],
    })
  }
  catalog = next.sort((a, b) => Number(b.company) - Number(a.company) || a.name.localeCompare(b.name))
}

export function setMode(name: string, mode: Mode) {
  state.skillModes = { ...state.skillModes, [name]: mode }
  save()
  for (const s of catalog) if (s.name === name) s.mode = mode
}

/** For a run's system prompt: the skills it loads every time, and the ones it picks from by fit. */
export function skillsNote(): string {
  const always = catalog.filter((s) => s.mode === 'always'), auto = catalog.filter((s) => s.mode === 'auto')
  if (!always.length && !auto.length) return ''
  return '\n\nCompany skills (your organization\'s, kept in sync by Concierge). Load one with the Skill tool by its name; '
    + 'if that cannot find it, Read its file and follow it.'
    + (always.length ? `\nLoad these before you start, on every run: ${always.map((s) => `${s.name} (${s.file})`).join(', ')}.` : '')
    + (auto.length ? `\nBefore you start, read this list and load each skill whose description fits this task; skip the rest. If the work later turns to something one of them covers (say, adding a feature flag), load it then, before that step:\n${auto.map((s) => `- ${s.name} (${s.file}): ${s.description.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')}` : '')
}

/** The company skills a stream message loads: a Skill call by name, or a Read of its SKILL.md. */
export function skillsIn(m: any): string[] {
  if (m?.type !== 'assistant') return []
  const known = new Set(catalog.map((s) => s.name))
  const out: string[] = []
  for (const c of m.message?.content ?? []) {
    if (c.type !== 'tool_use') continue
    const name = c.name === 'Skill' ? String(c.input?.skill ?? c.input?.name ?? '').split(':').pop()
      : c.name === 'Read' ? String(c.input?.file_path ?? '').match(/\/(?:skills\/synced\/[^/]+|org-skills\/skills)\/([^/]+)\/SKILL\.md$/)?.[1] : undefined
    if (name && known.has(name)) out.push(name)
  }
  return out
}

/** A run loaded one: count it, for the Skills page. */
export function markUsed(name: string, label: string) {
  const was = state.skillUse?.[name]
  const used = { count: (was?.count ?? 0) + 1, lastAt: new Date().toISOString(), lastFor: label }
  state.skillUse = { ...state.skillUse, [name]: used }
  for (const s of catalog) if (s.name === name) s.used = used
  save()
}
