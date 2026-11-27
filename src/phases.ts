// A ticket run's steps, said once: the progress bar on its page, the line on its row in the list and "Where it stands"
// all read these, so a step has one name wherever it shows (a short one for the bar, what the agent is doing for a line).
export const PHASES = [
  { id: 'picked', step: 'Picked', doing: 'Picked' },
  { id: 'evidence', step: 'Evidence', doing: 'Gathering evidence' },
  { id: 'implementing', step: 'Implement', doing: 'Implementing' },
  { id: 'checking', step: 'Checks', doing: 'Running checks' },
  { id: 'self-review', step: 'Self-review', doing: 'Reviewing its own work' },
  { id: 'opening-pr', step: 'PR', doing: 'Opening the PR' },
  { id: 'done', step: 'Done', doing: 'Done' },
] as const

/** What the agent is doing in a phase, in words; a phase the list doesn't know reads as it came. */
export const phaseDoing = (id?: string) => PHASES.find((p) => p.id === id)?.doing ?? id ?? ''
