// The direction a stack follows: a few lines every agent working on one of its PRs holds to ("the tool list lives at
// the top level, not inside the Workbench"). Each PR's agent only ever saw its own PR, so without it two of them settle
// the same question two ways. Written by the stack's agreement check (stackCheck.ts) from what the PRs show, yours to
// edit, and from then on handed to every run on a PR of that stack and to the read that boils its steps down.
// Kept with the PRs it was written for, and found from any of them: a stack that is restacked keeps it as long as one
// of those PRs is still in it.
import { save, state, type Pr, type StackRef } from './store.ts'

export type Direction = { repo: string; numbers: number[]; text: string; at: string; by: 'check' | 'you' }
const all = () => (state.stackDirections ??= {})
const keyOf = (repo: string, number: number) => Object.keys(all()).find((k) => all()[k].repo === repo && all()[k].numbers.includes(number))

/** The direction of the stack this PR is in, if one was written. */
export const directionOf = (pr: Pick<Pr, 'repo' | 'number'>): Direction | undefined => { const k = keyOf(pr.repo, pr.number); return k ? all()[k] : undefined }
/** Write (or, with no text, drop) the direction for the stack these PRs form. */
export function setDirection(chain: Pick<StackRef, 'repo' | 'number'>[], text: string, by: Direction['by']) {
  if (!chain.length) return
  const { repo } = chain[0], numbers = chain.map((s) => s.number)
  for (const n of numbers) { const k = keyOf(repo, n); if (k) delete all()[k] } // one direction per stack: an older one for any of its PRs goes
  if (text.trim()) all()[`${repo}#${numbers[0]}`] = { repo, numbers, text: text.trim().slice(0, 4000), at: new Date().toISOString(), by }
  save()
}
/** For a run on this PR: the stack's direction as part of what the agent is told, '' when there is none. */
export const directionNote = (pr: Pick<Pr, 'repo' | 'number'>) => {
  const d = directionOf(pr)
  return d ? `\n\nThis PR is one of a stack (${d.numbers.map((n) => `#${n}`).join(', ')}), and the stack follows this direction. Hold to it in what you change and what you propose; where this PR can't, say so plainly instead of going another way quietly:\n${d.text}` : ''
}
