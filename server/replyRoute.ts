// Your words to a PR's agent, sent the cheapest way that still does the work (reply runs were most of the spend):
// - answer: a question the agent's last report already answers is answered by the small model from that report, with
//   no agent started at all;
// - edit: a small, clear change goes to the mid-size model, capped;
// - change: everything else, the large model as before, capped.
// One small-model call both sorts the message and, when it can, answers it. An edit that fails or hits its cap continues
// once on the large model, in the same conversation, so nothing is redone.
// A reply also starts a fresh, short conversation from the agent's last report instead of replaying a long one, unless
// that conversation is still small or was used a moment ago (its prompt cache is still warm, so continuing is cheap).
import { haiku } from './next.ts'
import { providerFor } from './providers.ts'
import { config, type Job, type Pr } from './store.ts'

export type Route = 'answer' | 'edit' | 'change'
/** Most one reply run may spend, per route (config.replyCaps overrides). */
export const capOf = (r: Route) => ({ answer: 0.05, edit: 0.5, change: 2, ...config.replyCaps })[r]
/** The model per route on a Claude account (undefined: the account's own default, the large one). */
export const modelOf = (r: Route) => (r === 'edit' ? 'sonnet' : undefined)
/** Seconds a new reply waits for more of your messages, so they go to one run. */
export const GATHER_S = 20

// a session this small is cheap to continue whatever its age; past it, only while its cache is warm
const SMALL_SESSION_USD = 1.5, WARM_MS = 5 * 60_000
/** Continue the PR's conversation (true) or start a short one from its last report (false). */
export function keepSession(job: Pick<Job, 'sessionCostBefore' | 'lastEndedAt'>, now = Date.now()) {
  if ((job.sessionCostBefore ?? 0) < SMALL_SESSION_USD) return true
  return !!job.lastEndedAt && now - Date.parse(job.lastEndedAt) < WARM_MS
}

/** What a fresh conversation is handed instead of the old one: the last report and what it waited on. */
export function brief(pr: Pr, job: Pick<Job, 'lastWords' | 'lastSteps'>) {
  const last = (job.lastWords ?? pr.lastSaid?.summary ?? '').trim()
  return `(A fresh conversation on ${pr.url} ("${pr.title}", branch ${pr.head} into ${pr.base}), to keep it short: your earlier one on this PR is summed up by what you last reported.`
    + (last ? `\n\nYour last report:\n${last.slice(-5000)}` : '')
    + (job.lastSteps?.length ? `\n\nThe steps it left for me (my message below answers them):\n${job.lastSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '')
    + '\n\nRead only what this message needs (git log, the diff of the files it names, gh for threads); don\'t re-review the PR.)'
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['route'], properties: {
  route: { type: 'string', enum: ['answer', 'edit', 'change'] },
  answer: { type: 'string' },
} }
const SYSTEM = `You sort a person's message to the coding agent working on one pull request, given the agent's last report.
- answer: the message only asks something (why, what, whether, status) AND the report fully answers it. Then write the answer in "answer": short, plain, from the report only. If the report doesn't settle it, it is not "answer".
- edit: a small, clear change or action: rename, move, drop or reword something, pick an option the report offered, answer or resolve a review thread, push, rebase, re-run checks.
- change: anything else: new behaviour, a bug to find, a design decision to carry out, several files of real work, or unclear.
Return only the structured output.`

/** Sort one message (and answer it when the last report can). Any failure: the full agent, as before. */
export async function routeReply(pr: Pr, said: string, job: Pick<Job, 'lastWords' | 'lastSteps'>): Promise<{ route: Route; answer?: string; costUsd: number }> {
  const last = (job.lastWords ?? pr.lastSaid?.summary ?? '').trim()
  const prompt = `PR #${pr.number}: ${pr.title}\n\nThe agent's last report:\n${last.slice(-4000) || '(none yet)'}`
    + (job.lastSteps?.length ? `\n\nThe steps it asked about:\n${job.lastSteps.join('\n')}` : '')
    + `\n\nThe person's message:\n${said.slice(0, 3000)}`
  try {
    const { out, costUsd } = await haiku<{ route: Route; answer?: string }>(prompt, SCHEMA, SYSTEM, 0.05, 'haiku', providerFor('small', pr.repo))
    const route = out.route === 'answer' && !out.answer?.trim() ? 'edit' : out.route
    return { route, ...(route === 'answer' && { answer: out.answer!.trim() }), costUsd }
  } catch { return { route: 'change', costUsd: 0 } }
}
