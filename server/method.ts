// How Concierge does each thing it writes for you (explains a change, briefs a ticket, writes the standup…) is a
// skill you pick, not text in Concierge: it brings the facts and the output format its page reads back, the skill
// brings the method. Settings → Skills sets which skill each one uses; the defaults are the names in the skill source
// (config.skillSource, github.com/ylkhayat/skills unless you pick another).
import { readFile } from 'node:fs/promises'
import { config } from './config.ts'
import { pluginSkill, skillFile } from './setup.ts'
import { every } from './every.ts'

export const FEATURES = {
  everyRun: { skill: 'work-from-concierge', label: 'Every run', hint: 'Ground rules added to every agent run' },
  explainChange: { skill: 'explain-change', label: 'Explain a PR', hint: 'The map and the guided tour of a pull request' },
  explainCodebase: { skill: 'explain-codebase', label: 'Map a codebase', hint: 'One entry per folder of the default branch' },
  explainDomain: { skill: 'explain-domain', label: 'Business lens', hint: 'A change in the language of the business' },
  stackTour: { skill: 'stack-tour', label: 'Stack tour', hint: 'How a stack of PRs fits together' },
  stackPlan: { skill: 'simplify-stack-steps', label: 'Stack answer', hint: 'Boiling down what a stack\'s agents wait on into a few decisions and steps' },
  stackCheck: { skill: 'check-stack', label: 'Stack check', hint: 'Whether the PRs of a stack agree with each other' },
  turns: { skill: 'pr-turns', label: 'PR turns', hint: 'How a PR changed direction with a push' },
  intent: { skill: 'settle-intent', label: 'Intent', hint: 'Settling what AI-built work is meant to do' },
  understanding: { skill: 'check-understanding', label: 'Understanding', hint: 'Making sure you understand a change' },
  brief: { skill: 'brief-ticket', label: 'Briefs', hint: 'A ticket and its PRs in two or three sentences' },
  standup: { skill: 'write-standup', label: 'Standup', hint: 'Your daily update' },
  stacks: { skill: 'plan-stacks', label: 'Stacking tickets', hint: 'Which tickets ship together, before a run of several' },
  plan: { skill: 'plan-project', label: 'Plans', hint: 'Breaking a brief down into a project' },
  skills: { skill: 'improve-skills', label: 'Skill reviews', hint: 'Judging your skills from their runs' },
  // Design (visuals.ts): without the skill on a machine, Concierge's own words for it are used
  visuals: { skill: 'capture-visuals', label: 'Visuals', hint: 'A pull request\'s screens, before and after: the changed components in focus, where they show' },
  blueprint: { skill: 'draw-blueprint', label: 'Blueprint', hint: 'The map of a project: its screens by domain and step, every component marked' },
  storybook: { skill: 'set-up-storybook', label: 'Storybook setup', hint: 'Giving a repository its Storybook, as a pull request' },
} as const
export type Feature = keyof typeof FEATURES

/** The skill a feature uses: yours from Settings, else its default. */
export const skillFor = (f: Feature) => config.skills?.[f]?.trim() || FEATURES[f].skill

/** Where a skill's file is: yours (~/.claude/skills, commands), else a plugin's (`plugin:name` or a bare name). */
export async function skillPath(name: string) {
  const bare = name.replace(/^\//, '')
  return (await skillFile(bare).catch(() => undefined)) ?? (await pluginSkill(bare.split(':').pop()!).catch(() => undefined))
}

/** A skill's instructions, without its frontmatter. */
export async function skillBody(name: string) {
  const file = await skillPath(name)
  if (!file) throw new Error(`The skill "${name}" isn't installed: install it, or pick another in Settings → Skills`)
  return (await readFile(file, 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

/** The method for a feature: its skill's instructions, then the output format Concierge reads back (`format`). */
export async function method(f: Feature, format = '') {
  return `${await skillBody(skillFor(f))}${format ? `\n\n${format}` : ''}`
}

// for what is built without waiting (a run's arguments, a discussion's turn): read in the background, at start and then
// every minute; undefined until read, or while its skill is missing
const SYNC: Feature[] = ['everyRun', 'intent', 'understanding']
const kept = new Map<Feature, string | undefined>()
/** A feature's method as last read; undefined while its skill is missing (or not read yet). */
export const keptBody = (f: Feature) => kept.get(f)
/** The ground rules for a run, as last read; '' while missing (the run goes ahead without them). */
export const keptMethod = (f: Feature) => (kept.get(f) ? `\n\n${kept.get(f)}` : '')
export const missing = (f: Feature) => `${FEATURES[f].label} needs the skill "${skillFor(f)}", which isn't installed: install it, or pick another in Settings → Skills`
async function keep() { for (const f of SYNC) kept.set(f, await skillBody(skillFor(f)).catch(() => undefined)) }
void keep(); every('method', () => keep(), 60_000)
/** Read again now (after Settings changed a skill). */
export const rereadMethods = () => keep()
