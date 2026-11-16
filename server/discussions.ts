// Discussions beside a PR's or a ticket's main conversation, one per question that AI work leaves open:
//   intent         what is this meant to do: an agent works through it with you until you agree on it
//   understanding  what does it do: you ask about the change (Explain beside it), and it checks what you've got
// Each is a resumed agent session in the repository, read-only. Every turn it says where you stand (a few words), keeps
// a running summary, and, when the conclusion should change the work, the steer for the main agent; sending it is
// yours to do. Kept in the state, so a discussion survives a restart and shows on both machines.
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { providerFor, spawnAgent } from './providers.ts'
import { save, state } from './store.ts'

export type Topic = 'intent' | 'understanding'
export type Stage = 'new' | 'open' | 'converging' | 'concluded'
export type Said = { who: 'you' | 'agent'; text: string; at: string }
export type Discussion = {
  target: string; topic: Topic
  messages: Said[]
  stage: Stage
  status: string // where you stand, in a few words: "2 open questions", "knows the flow, not the retries"
  summary: string // what is settled so far
  steer?: string // what the main agent should do differently, once it follows from the discussion
  sentAt?: string // when you sent that steer to the main agent
  sessionId?: string; costUsd: number; busy?: boolean; error?: string
  queued?: string[] // said while it was answering: sent as its next turn
  adr?: Adr // intent's goal: the decision, as an architecture decision record
  actions?: Action[] // what it suggests doing next: a tour or view of Explain, a question for the author or the team
  prs?: { repo: string; number: number }[] // a discussion over several PRs (a stack, a ticket's PRs): which
  perPr?: PerPr[] // and what it settled for each of them
}
/** What a discussion over several PRs settled for one of them: the decision as it applies there, and its agent's steer. */
export type PerPr = { number: number; decision: string; steer?: string | null; sentAt?: string }
export type Adr = { title: string; status: 'proposed' | 'accepted'; context: string; decision: string; consequences: string; alternatives?: string }
export type Action = { kind: 'tour' | 'business' | 'technical' | 'norms' | 'ask-author' | 'ask-community' | 'steer'; label: string; text?: string }

const ACTIONS = { type: 'array', items: { type: 'object', properties: {
  kind: { type: 'string', enum: ['tour', 'business', 'technical', 'norms', 'ask-author', 'ask-community', 'steer'] },
  label: { type: 'string' }, text: { type: 'string' },
}, required: ['kind', 'label'] } }
const ADR = { type: 'object', properties: {
  title: { type: 'string' }, status: { type: 'string', enum: ['proposed', 'accepted'] },
  context: { type: 'string' }, decision: { type: 'string' }, consequences: { type: 'string' }, alternatives: { type: 'string' },
}, required: ['title', 'status', 'context', 'decision', 'consequences'] }
const PER_PR = { type: 'array', items: { type: 'object', properties: {
  number: { type: 'number' }, decision: { type: 'string' }, steer: { type: ['string', 'null'] },
}, required: ['number', 'decision'] } }
const schemaOf = (topic: Topic, multi: boolean) => ({ type: 'object', properties: {
  reply: { type: 'string' },
  stage: { type: 'string', enum: ['open', 'converging', 'concluded'] },
  status: { type: 'string' },
  summary: { type: 'string' },
  steer: { type: ['string', 'null'] },
  actions: ACTIONS,
  ...(topic === 'intent' && { adr: ADR }),
  ...(multi && { perPr: PER_PR }),
}, required: ['reply', 'stage', 'status', 'summary', 'actions', ...(topic === 'intent' ? ['adr'] : []), ...(multi ? ['perPr'] : [])] })

// a discussion over several PRs: one decision for all of them, mapped to each
const MULTI = 'This covers several pull requests together (a stack, bottom first, or the PRs one ticket ships as). Settle it for all of them, then map it: perPr has one entry per PR, by its number, saying what the decision (or what was understood) means for that PR, and steer (an instruction for that PR\'s own coding agent, if it has to change, else null). The top-level steer is null; the steers go per PR.'

const SYSTEM: Record<Topic, string> = {
  intent: [
    'You help a developer settle the intent of AI-built work (a PR, or a ticket being shipped), before they trust it.',
    'The goal is a decision record, like an ADR: the context, the decision (what it is meant to do, and not do), its consequences, and the alternatives set aside. Each of them one or two short sentences.',
    'Compare what was asked (the ticket, the PR description, the conversation) with what is built. Find the gaps, the ambiguities and the decisions nobody made. Read the code when it settles a question.',
    'Ask one sharp question at a time, with your recommended answer. Draft the record early as proposed, and refine it as you go. Be brief.',
    'When the developer agrees with the record, set its status to accepted and the stage to concluded.',
    'actions: what to do next, when it helps: ask-author (text: the question for the PR author or ticket reporter), ask-community (text: the question for the team), steer (text: what the coding agent should change). Empty when nothing fits.',
    'Return: reply (markdown, at most 60 words, no headings, at most 3 bullets: the developer reads every reply in a busy chat; detail belongs in the record); stage; status (at most 6 words on where the developer stands, e.g. "2 open questions", "record agreed"); summary (1 or 2 plain sentences); steer (the instruction for the coding agent if the decision changes the work, else null); actions; adr.',
  ].join('\n'),
  understanding: [
    'You help a developer understand a code change made or reviewed by an AI agent, from every angle the Explain view shows: the business view (what changes for users and the company), the technical view (which parts of the code, how they connect), the norms (where it departs from conventions), and the guided tour.',
    'Answer precisely, citing files and lines. Read the diff and the code; do not guess. Use the explanation you are given.',
    'Point to the part of Explain that answers best: actions tour (take the guided tour), business, technical or norms (open that view; label says what to look at there). Now and then check their grasp with one short question about what matters most.',
    'Other actions when they help: ask-author or ask-community (text: the question to ask), steer (text: a change for the coding agent, such as a missing test).',
    'Return: reply (markdown, at most 60 words, no headings, at most 3 bullets: the developer reads every reply in a busy chat; detail belongs in the record); stage (concluded once they understand what matters); status (at most 6 words on their grasp, e.g. "knows the flow, not the retries"); summary (what they understand and what is still unclear, 1 to 3 sentences); steer (the changes collected for the coding agent, as one instruction, else null); actions.',
  ].join('\n'),
}

const keyOf = (target: string, topic: Topic) => `${target}|${topic}`
const all = () => (state.discussions ??= {})

/** A target's discussions, as they stand: one per topic, empty when not started. */
export function discussionsOf(target: string): Record<Topic, Discussion> {
  const blank = (topic: Topic): Discussion => ({ target, topic, messages: [], stage: 'new', status: 'not discussed', summary: '', costUsd: 0 })
  return { intent: all()[keyOf(target, 'intent')] ?? blank('intent'), understanding: all()[keyOf(target, 'understanding')] ?? blank('understanding') }
}

/**
 * Your words to a discussion; the agent answers in the background (the page polls). `context` (what the work is: the
 * ticket, the PR, the main agent's last word) goes with the first message, and again when it changed since.
 */
export function say(target: string, topic: Topic, text: string, context: string, cwd?: string, shared = '', prs?: { repo: string; number: number }[], echo = true) {
  const k = keyOf(target, topic)
  const d = all()[k] ?? discussionsOf(target)[topic]
  // still answering: this waits its turn and goes right after (the other discussion is not held up either way)
  if (d.busy) { d.messages.push({ who: 'you', text, at: new Date().toISOString() }); (d.queued ??= []).push(text); all()[k] = d; save(); return }
  const first = !d.sessionId
  const multi = !!prs && prs.length > 1
  if (multi) d.prs = prs
  if (echo) d.messages.push({ who: 'you', text, at: new Date().toISOString() })
  Object.assign(d, { busy: true, error: undefined, stage: d.stage === 'new' ? 'open' : d.stage })
  all()[k] = d; save()
  // what the other discussion settled goes with every message: it may have moved since
  const prompt = `${first ? `${context}\n\n---\n\n` : ''}${shared ? `Settled in the other discussion:\n${shared}\n\n---\n\n` : ''}${text}`
  const sessionId = d.sessionId ?? randomUUID()
  const child = spawnAgent(providerFor('review'), [
    '-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(schemaOf(topic, multi)),
    '--append-system-prompt', multi ? `${SYSTEM[topic]}\n${MULTI}` : SYSTEM[topic],
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git fetch:*)',
    // Sonnet: a discussion is many short turns, and the default (largest) model spends a turn's budget before answering
    '--model', 'sonnet', '--max-budget-usd', '1',
    ...(first ? ['--session-id', sessionId] : ['--resume', sessionId]),
  ], { cwd: cwd ?? tmpdir() })
  let out = '', err = ''
  child.stdout.on('data', (c: Buffer) => { out += c })
  child.stderr.on('data', (c: Buffer) => { err = (err + c).slice(-400) })
  const finish = (fail?: string) => {
    d.busy = false
    if (fail) { d.error = fail; save(); return }
    try {
      const m = JSON.parse(out.trim().split('\n').pop()!) as { structured_output?: { reply: string; stage: Stage; status: string; summary: string; steer?: string | null; actions?: Action[]; adr?: Adr; perPr?: PerPr[] }; total_cost_usd?: number; result?: string }
      const o = m.structured_output
      if (!o) throw new Error(m.result || 'no answer')
      d.messages.push({ who: 'agent', text: o.reply, at: new Date().toISOString() })
      Object.assign(d, { sessionId, stage: o.stage, status: o.status, summary: o.summary, actions: o.actions ?? [], costUsd: d.costUsd + (m.total_cost_usd ?? 0), ...(o.adr && { adr: o.adr }) })
      // a new steer is a new thing to send; the same one already sent stays sent
      if (o.steer && o.steer !== d.steer) Object.assign(d, { steer: o.steer, sentAt: undefined })
      // per PR: a steer that changed is to send again; one sent and unchanged stays sent
      if (o.perPr) d.perPr = o.perPr.map((x) => { const was = d.perPr?.find((y) => y.number === x.number); return { ...x, sentAt: was && was.steer === x.steer ? was.sentAt : undefined } })
    } catch (e) { d.error = `The agent's answer couldn't be read: ${(e as Error).message}`.slice(0, 300) }
    save()
    // what was said while it answered: one turn for all of it, already in the conversation
    const next = d.queued?.splice(0)
    if (next?.length) say(target, topic, next.join('\n\n'), context, cwd, shared, prs, false)
  }
  child.on('error', (e) => finish(e.message))
  child.on('close', (code) => finish(code && !out.trim() ? (err || `it stopped (${code})`) : undefined))
}

/** What a discussion settled, for the other one and the main chat: its summary, and its record once it has one. */
export function settled(d: Discussion): string {
  if (!d.messages.length) return ''
  return `${d.topic === 'intent' ? 'Intent' : 'Understanding'} (${d.status}): ${d.summary}`
    + (d.adr ? `\nDecision record (${d.adr.status}): ${d.adr.title}. Decision: ${d.adr.decision} Consequences: ${d.adr.consequences}` : '')
    + (d.perPr?.length ? `\nFor each PR: ${d.perPr.map((x) => `#${x.number}: ${x.decision}`).join('; ')}` : '')
}

/** You sent its steer to the main agent. */
export function markSent(target: string, topic: Topic, number?: number) {
  const d = all()[keyOf(target, topic)]
  if (!d) return
  const at = new Date().toISOString()
  if (number === undefined) d.sentAt = at
  else { const x = d.perPr?.find((y) => y.number === number); if (x) x.sentAt = at }
  save()
}

/** Start the discussion over: its messages, summary and session go. */
export function reset(target: string, topic: Topic) {
  delete all()[keyOf(target, topic)]; save()
}
