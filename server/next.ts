// What a finished agent run is waiting on, so the dashboard can offer the decisions and next moves as buttons instead
// of "go to the terminal". The agent says it itself: its final message ends with a deck-next block (DECIDE_NOTE asks
// for it), read by fromAgent(). Only when that block is missing does a tiny tool-less call read them from the prose.
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { providerFor, spawnAgent, tokensOf, type ProviderId } from './providers.ts'
import { watchesCi, type Step } from './reply.ts'
import { overBudget } from './store.ts'

export type Decision = {
  topic: string; question: string
  why?: string // what depends on it
  blocking?: boolean // the agent can't go on without it: answered first
  options: { label: string; reply: string; recommended?: boolean }[]
}
export type NextSteps = {
  steps: Step[] // the checklist the Next panel shows (decisions and actions below are the same, for older readers)
  decisions: Decision[]
  actions: { label: string; reply: string; kind: 'go' | 'publish' | 'stop' | 'other' }[]
  for: string // hash of the message these were read from
  provider?: ProviderId // who read it (none: Claude)
  tokens?: { input: number; output: number }
  costUsd: number
  source?: 'agent' | 'read' // the agent's own block, or read from its prose
}

/** Appended to every run's system prompt: end with the decisions as data, not only as prose. */
export const DECIDE_NOTE = `

When you end your turn, close your final message with one fenced block tagged deck-next holding JSON. Concierge
hides it from the message and shows it as a checklist the user ticks, so keep the prose complete on its own too:
\`\`\`deck-next
{"steps":[
  {"text":"Fix the null check Lee flagged in loader.ts","kind":"do","checked":true},
  {"text":"Push the 2 fix commits","kind":"publish","checked":true},
  {"text":"Post the 3 drafted replies","kind":"publish","checked":false,"why":"the reviewer's thread may change after the push"},
  {"text":"Lookup timeout","kind":"decide","blocking":true,"options":[{"label":"Keep 30 s","recommended":true},{"label":"Lower to 10 s"}]}]}
\`\`\`
- One step per line, each one thing: never "push and post" or "reply to both" as one step.
- kind: do (work you'd do next: fix, edit, investigate, run), publish (anything that pushes, posts, comments or submits),
  decide (a choice only the user can make; its options are the concrete alternatives, your own pick recommended).
- checked: whether you recommend doing it now. The user unticks what they don't want.
- why (optional): one line, when it isn't obvious. blocking: a decision you can't go on without.
- Every do and publish step is one YOU carry out when the user ticks it. Never list what only the user can do in a
  browser (reply in crit, click Finish Review, merge on GitHub): Concierge offers those itself. Offer instead what you
  can do for them: "Post the 2 findings as review comments", "Drop f2 before posting", "Reword f1", or a decide step
  ("Post f1 and f2?", "Approve with or without the findings?").
- Never offer a step whose work is waiting for something outside you to happen ("Read test (rest) once it reports"):
  ticked, it comes straight back. And never offer one already done or handed over earlier in this conversation.
- Never wait on, watch or poll CI (no \`gh pr checks --watch\`, no sleep loops), on any PR: Concierge watches CI and
  tells the user when a check goes red. A step that would wait for CI ("submit once CI is green") is done now, on the
  head as it is: say which checks were still running. If the head moved since you verified it, read the new commits;
  if they touch what you verified or flagged, ask first with a blocking decide step ("Approve on the new head?").
- Nothing needed from the user: {"steps":[]}.`

const BLOCK = /\n?```deck-next[^\n]*\n([\s\S]*?)\n```\s*$/
const s = (x: unknown, n = 400) => (typeof x === 'string' ? x.trim().slice(0, n) : '')
const KINDS = new Set(['go', 'publish', 'stop', 'other'])

/** A final message without its deck-next block: what the feed and the summary show. */
export const proseOf = (message: string) => message.replace(BLOCK, '').trimEnd()

/**
 * Split a final message into its prose and the decisions block it ends with. steps is undefined when there is no
 * block or it doesn't parse (then the prose is read the old way); `for` is left to the caller, who hashes what it keeps.
 */
export function fromAgent(message: string): { text: string; steps?: Omit<NextSteps, 'for'> } {
  const m = message.match(BLOCK)
  if (!m) return { text: message }
  const text = message.slice(0, m.index).trimEnd()
  try {
    const raw = JSON.parse(m[1]) as { steps?: unknown; decisions?: unknown; actions?: unknown }
    if (Array.isArray(raw.steps)) return { text, steps: { ...fromSteps(raw.steps), costUsd: 0, source: 'agent' } }
    const decisions = (Array.isArray(raw.decisions) ? raw.decisions : []).flatMap((d: any): Decision[] => {
      const options = (Array.isArray(d?.options) ? d.options : []).flatMap((o: any) => s(o?.label, 200)
        ? [{ label: s(o.label, 200), reply: s(o.reply, 2000) || s(o.label, 200), ...(o.recommended === true && { recommended: true }) }] : [])
      return s(d?.question) && options.length
        ? [{ topic: s(d.topic, 60) || 'Decision', question: s(d.question), ...(s(d.why) && { why: s(d.why) }), ...(d.blocking === true && { blocking: true }), options }] : []
    }).sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking))
    const actions = (Array.isArray(raw.actions) ? raw.actions : []).flatMap((a: any) => s(a?.label, 80)
      ? [{ label: s(a.label, 80), reply: s(a.reply, 2000) || s(a.label, 80), kind: (KINDS.has(a.kind) ? a.kind : 'other') as NextSteps['actions'][number]['kind'] }] : [])
    return { text, steps: { steps: toSteps(decisions, actions), decisions, actions, costUsd: 0, source: 'agent' } }
  } catch { return { text } }
}

/** A checklist from the agent's (or the reader's) steps, with the older decisions and actions filled from it. */
export function fromSteps(raw: unknown[]): Pick<NextSteps, 'steps' | 'decisions' | 'actions'> {
  const steps = raw.flatMap((x: any): Step[] => {
    const text = s(x?.text, 300), kind = x?.kind === 'publish' || x?.kind === 'decide' ? x.kind : 'do'
    if (!text) return []
    if (kind === 'decide') {
      const options = (Array.isArray(x.options) ? x.options : []).flatMap((o: any) => s(o?.label, 200)
        ? [{ label: s(o.label, 200), ...(s(o.reply, 2000) && { reply: s(o.reply, 2000) }), ...(o.recommended === true && { recommended: true }) }] : [])
      return options.length ? [{ text, kind, options, ...(s(x.why) && { why: s(x.why) }), ...(x.blocking === true && { blocking: true }) }] : []
    }
    return [{ text, kind, checked: x.checked === true, ...(s(x.why) && { why: s(x.why) }) }]
  }).sort((a, b) => Number(b.kind === 'decide' && !!b.blocking) - Number(a.kind === 'decide' && !!a.blocking))
  return {
    steps,
    decisions: steps.filter((x) => x.kind === 'decide').map((x) => ({ topic: x.text.slice(0, 60), question: x.text, ...(x.why && { why: x.why }), ...(x.blocking && { blocking: true }), options: x.options!.map((o) => ({ label: o.label, reply: o.reply ?? o.label, ...(o.recommended && { recommended: true }) })) })),
    actions: steps.filter((x) => x.kind !== 'decide').map((x) => ({ label: x.text.slice(0, 80), reply: x.text, kind: x.kind === 'publish' ? 'publish' as const : 'go' as const })),
  }
}
/** An older hand-back as a checklist: its moves unticked (they were alternatives), its decisions as they were. */
export function toSteps(decisions: Decision[], actions: NextSteps['actions']): Step[] {
  return [
    ...decisions.map((d): Step => ({ text: d.question || d.topic, kind: 'decide', options: d.options, ...(d.why && { why: d.why }), ...(d.blocking && { blocking: true }) })),
    ...actions.filter((a) => a.kind !== 'stop').map((a): Step => ({ text: a.label, kind: a.kind === 'publish' ? 'publish' : 'do', checked: false })),
  ]
}

const str = { type: 'string' }
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['steps'],
  properties: {
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'kind'], properties: {
      text: str, kind: { enum: ['do', 'publish', 'decide'] }, checked: { type: 'boolean' }, why: str, blocking: { type: 'boolean' },
      options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: str, reply: str, recommended: { type: 'boolean' } } } },
    } } },
  },
}

const PROMPT = (msg: string) => `Below is the final message an AI coding agent left for its user. Turn what it is waiting on into a checklist of steps.
- One step per line, each one thing: split "push and post" or "reply to both" into separate steps.
- kind: do (work it offers to do next: fix, edit, investigate, run), publish (anything that pushes, posts, comments or submits), decide (a choice only the user can make, with the concrete options it offered as options, its own pick recommended).
- checked: true when the agent recommends doing that step now.
- A yes/no permission it asks for is a do or publish step, not a decision.
Only what the message actually offers or asks; an empty list when it asks nothing.

<message>
${msg.slice(0, 12000)}
</message>`

export const hashOf = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12)
/** A step's wording as a hash: lower case, punctuation and spacing aside, so the same words match however they're set. */
export const stepHash = (text: string) => hashOf(text.toLowerCase().replace(/[^\p{L}\p{N}#]+/gu, ' ').trim())

const inflight = new Map<string, Promise<NextSteps>>()

/** Read the asks out of `message`. Cached per message by the caller via `for`; concurrent calls share one run. */
export function nextSteps(message: string): Promise<NextSteps> {
  const h = hashOf(message)
  if (!inflight.has(h)) {
    inflight.set(h, ask(message).then((r) => ({ ...r, for: h })).finally(() => setTimeout(() => inflight.delete(h), 1000)))
  }
  return inflight.get(h)!
}

function ask(message: string): Promise<Omit<NextSteps, 'for'>> {
  return haiku<{ steps: unknown[] }>(PROMPT(message), SCHEMA, 'You turn what a message asks into a checklist. Return only the structured output.')
    .then(({ out, costUsd, provider, tokens }) => ({ ...fromSteps(out.steps ?? []), costUsd, provider, tokens, source: 'read' as const }))
}

/** One lean, tool-less small-model call that returns structured output: no tools, MCP, skills, hooks or settings. */
// At most four small calls at once: each is a whole agent process, and a page that opens many things at once started
// as many (they don't count against the parallel runs, nor the memory kept free for those).
let going = 0
const queued: (() => void)[] = []
function small<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => { going++; run().then(resolve, reject).finally(() => { going--; queued.shift()?.() }) }
    if (going < 4) start(); else queued.push(start)
  })
}
export function haiku<T>(prompt: string, schema: object, system: string, budget = 0.2, model = 'haiku', provider: ProviderId = providerFor('small')): Promise<{ out: T; costUsd: number; provider: ProviderId; tokens?: { input: number; output: number } }> {
  // the small model of whichever provider does the quick calls (or the one a repository is kept to)
  // today's budget holds for these too: reached, a small call is refused like a run is held (it was never checked)
  if (overBudget()) return Promise.reject(new Error('Today’s budget is reached: this waits until tomorrow or a higher budget'))
  return small(() => new Promise((resolve, reject) => {
    const child = spawnAgent(provider, [
      '-p', prompt, '--json-schema', JSON.stringify(schema), '--output-format', 'stream-json', '--verbose',
      // Haiku: no tools at all. A larger model writing a long answer (a whole skill file) never gets its structured
      // output out with no tools: it keeps its tools, minus everything that changes files or reaches out
      ...(model === 'haiku' ? ['--tools', ''] : ['--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']), '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence',
      '--model', model, '--max-budget-usd', String(budget), '--system-prompt', system,
    ], { cwd: tmpdir() })
    let buf = '', done: { out: T; costUsd: number; provider: ProviderId; tokens?: { input: number; output: number } } | undefined, err = ''
    child.stdout.on('data', (c: Buffer) => {
      buf += c
      const lines = buf.split('\n'); buf = lines.pop()!
      for (const l of lines) {
        if (!l.includes('"type":"result"')) continue
        try {
          const m = JSON.parse(l)
          if (m.structured_output) done = { out: m.structured_output, costUsd: m.total_cost_usd ?? 0, provider, tokens: tokensOf(m) }
          else err = String(m.result ?? m.subtype)
        } catch { /* partial line */ }
      }
    })
    child.stderr.on('data', (c: Buffer) => { err = (err + c).slice(-500) })
    child.on('error', reject)
    child.on('close', () => (done ? resolve(done) : reject(new Error(err || 'the small model returned nothing'))))
  }))
}


export const withoutCiWatch = <T extends { steps?: { text: string }[] } | null | undefined>(n: T): T =>
  n?.steps?.some((x) => watchesCi(x.text)) ? { ...n, steps: n.steps.filter((x) => !watchesCi(x.text)) } : n
