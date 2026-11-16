// Reading an exec run (e.g. /my-exec) from its stream: per-ticket outcomes, PR links, and the live phase.
// Pure functions: the runner feeds them lines, the tests feed them samples.

export type Outcome = { outcome: 'shipped' | 'ready' | 'refined' | 'failed'; branch?: string; sha?: string; reason?: string }
export type Phase = 'picked' | 'evidence' | 'implementing' | 'checking' | 'self-review' | 'opening-pr' | 'done'
export const PHASES: Phase[] = ['picked', 'evidence', 'implementing', 'checking', 'self-review', 'opening-pr', 'done']

const ID = '[A-Z][A-Z0-9]*-\\d+'

/** The fan-out agents' one-line verdicts: "<id> <branch> <sha> shipped" | "<id> refined" | "<id> failed: <why>". */
/**
 * A run with several tickets ends only when all of them do. One that already has its outcome in it (written as its agent
 * returned) is out of it for you: 'parked' (refined or failed: it waits on you), 'shipped', or undefined (still worked).
 */
export function settledIn(run: { state: string; outcomes: Record<string, Outcome> } | undefined, id: string): 'parked' | 'shipped' | undefined {
  const o = (run?.state === 'running' || run?.state === 'queued') ? run.outcomes[id]?.outcome : undefined
  return o === 'shipped' || o === 'ready' ? 'shipped' : o ? 'parked' : undefined
}

/**
 * Tickets picked together: a batch. Every ticket is built at the same time, each in its own run; when they share
 * something (a decision, a type, a schema) a short prep run settles that first and hands its brief and branch to them.
 * A stack of several tickets is submitted only once all of them are ready, in order, by one small submit run; a ticket
 * alone ships itself.
 */
export type Batch = {
  id: string
  at: string
  stacks: string[][] // submit order per stack, bottom first
  said?: string // your direction, for every run of it
  prep?: { ids: string[]; task: string; branch?: string; brief?: string }
  submitted: Record<string, string> // a stack's first ticket → its submit run
}
type GateRun = { batch?: string; role?: string; state: string; ids: string[]; queuedAt: string; outcomes: Record<string, Outcome> }

/** Where a stack stands at the submit gate, from each ticket's latest work run in the batch: all ready (go), or who isn't. */
export function gate(stack: string[], runs: GateRun[], batch: string):
  { go: { id: string; branch: string; sha?: string }[] } | { ready: string[]; waiting: string[] } {
  const go: { id: string; branch: string; sha?: string }[] = [], waiting: string[] = []
  for (const id of stack) {
    const r = runs.filter((x) => x.batch === batch && !x.role && x.ids.includes(id)).sort((x, y) => y.queuedAt.localeCompare(x.queuedAt))[0]
    const o = r?.state === 'done' ? r.outcomes[id] : undefined
    if (o?.branch && (o.outcome === 'ready' || o.outcome === 'shipped')) go.push({ id, branch: o.branch, sha: o.sha }); else waiting.push(id)
  }
  return waiting.length ? { ready: go.map((g) => g.id), waiting } : { go }
}

/** The prep run's last line: `PREP <branch>` or `PREP none`. Undefined: it didn't finish (it asked you, or failed). */
export function prepOf(text: string): { branch?: string } | undefined {
  const m = text.match(/^\s*`?PREP\s+(\S+?)`?\s*$/m)
  return m ? (m[1].toLowerCase() === 'none' ? {} : { branch: m[1] }) : undefined
}

export const prepPrompt = (p: { ids: string[]; task: string }, said?: string) => `You prepare shared ground for ${p.ids.join(', ')}. Right after you, a separate agent builds each of them, all at the same time. Settle only what they share: ${p.task}
${said ? `\nMy direction for these tickets: ${said}\n` : ''}
- Read the tickets on Linear and the code they touch. Make the decisions they share. One that needs me: ask on Linear the way the exec command does, and stop.
- Shared code (a type, an interface, a schema, a migration, a helper): write only that, in a new worktree on a branch \`prep/${p.ids[0].toLowerCase()}-shared\` off the up-to-date base branch, run the checks that cover it, commit (conventional commit) and push the branch. No PR. Don't implement any ticket.
- Be quick: this is minutes of work, not a ticket of its own.
End your final message with the brief the ticket agents get: the decisions, what is on the branch and how to use it, and what each ticket should and shouldn't touch so they don't collide. Its very last line: \`PREP <branch>\`, or \`PREP none\` when no code was needed.`

/** What a ticket's own run in a batch adds to the exec command: the prep's brief, and in a stack, the submit gate. */
export function workNote(b: Batch, id: string): string {
  const stack = b.stacks.find((s) => s.includes(id)) ?? [id]
  let out = ''
  if (b.prep?.brief && b.prep.ids.includes(id)) out += `\n\nShared ground was prepared for ${b.prep.ids.join(', ')} before you.${b.prep.branch ? ` Branch off \`${b.prep.branch}\`, not the base branch: its commits come along in the stack.` : ''} The brief:\n<brief>\n${b.prep.brief}\n</brief>`
  if (stack.length > 1) out += `\n\n${id} ships in one stack with ${stack.filter((x) => x !== id).join(', ')} (bottom to top: ${stack.join(' → ')}), each built by its own agent right now. `
    + `Don't open a PR and don't run gh stack submit. Do everything else (fix, checks, self-review, commit), push your branch, and end with \`${id} <branch> <sha> ready\` instead of shipped. `
    + 'Concierge stacks the branches in order and opens the PRs once all of them are ready. Never wait for the others.'
  return out
}

export const submitPrompt = (go: { id: string; branch: string }[], command: string) => `Submit these ticket branches as one stack, bottom to top: ${go.map((g) => `${g.id} \`${g.branch}\``).join(' → ')}. Each was built on its own by another agent, and is checked, self-reviewed and pushed.
- Load the commit-with-stack skill if you have it. Fetch, then rebase each branch onto the one below it (the first onto the up-to-date base branch), moving only its own commits. A conflict: resolve it keeping both tickets' intent, and re-run the checks that cover what it touched.
- Push the moved branches (--force-with-lease), then submit them as one stack with gh stack, opening each PR the way \`${command}\` does (title, body, links, Linear state). A branch that already has a PR keeps it.
- Never merge one branch into another.
End with one line per ticket: \`<ID> <branch> <sha> shipped\`, or \`<ID> failed: <why>\`.`

/** For a run of several tickets: none waits on another, and each one's outcome is said the moment it is known. */
export const MULTI_NOTE = `

This run holds several tickets. Don't let one hold up the others:
- The moment a ticket's agent returns, write its outcome line in your message (\`<ID> <branch> <sha> shipped\`,
  \`<ID> refined\` or \`<ID> failed: <reason>\`), on its own line, without waiting for the rest.
- A ticket blocked on a decision is refined: ask on Linear, write its line, and stop waiting on it. Never poll, sleep or
  wait for my answer inside this run; I answer it later and it gets its own run.
- A ticket cancelled on Linear, or no longer assigned to me: stop its agent and write \`<ID> failed: cancelled\`.
- End the run as soon as no ticket is still being worked.`

export function outcomesIn(text: string): Record<string, Outcome> {
  const out: Record<string, Outcome> = {}
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s>*`-]+|[\s`*]+$/g, '')
    let m = line.match(new RegExp(`^(${ID}) (\\S+) ([0-9a-f]{7,40}) (shipped|ready)$`))
    if (m) { out[m[1]] = { outcome: m[4] as 'shipped' | 'ready', branch: m[2], sha: m[3] }; continue }
    m = line.match(new RegExp(`^(${ID}) refined$`))
    if (m) { out[m[1]] = { outcome: 'refined' }; continue }
    m = line.match(new RegExp(`^(${ID}) failed: (.+)$`))
    if (m) out[m[1]] = { outcome: 'failed', reason: m[2] }
  }
  return out
}

export type Handover = { id: string; brief: string }
/**
 * "HANDOVER <id>: <what to do there>": work that belongs to another ticket, for a run of its own. The brief runs on
 * over the following lines until a blank one. A run's own tickets are never handed to.
 */
export function handoversIn(text: string, own: string[]): Handover[] {
  const out: Handover[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].replace(/^[\s>*`-]+/, '').match(new RegExp(`^HANDOVER (${ID}):\\s*(.*)$`))
    if (!m || own.includes(m[1])) continue
    const more: string[] = []
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^\W*HANDOVER /.test(lines[i + 1])) more.push(lines[++i].trim())
    out.push({ id: m[1], brief: [m[2], ...more].map((x) => x.replace(/^[`*\s]+|[`*\s]+$/g, '')).filter(Boolean).join('\n') })
  }
  return out
}

/** GitHub PR links mentioned in a message. */
export const prLinksIn = (text: string) =>
  [...new Set([...text.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)].map((m) => `${m[1]}#${m[2]}`))]
    .map((k) => { const [repo, n] = k.split('#'); return { repo, number: Number(n), url: `https://github.com/${repo}/pull/${n}` } })

/** "stack #4109: #4109 → #4110 → #4111" style lines. */
export const stackLinesIn = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => /^stack\s*#?\d*\s*:/i.test(l) || /#\d+\s*(→|->)\s*#\d+/.test(l))

/** Which phase a tool call means. Phases only move forward; the caller keeps the furthest one. */
export function phaseOf(tool: string, input: string): Phase | undefined {
  const s = `${tool} ${input}`
  if (/gh stack (submit|init)|gh pr create/.test(s)) return 'opening-pr'
  if (/claude -p ['"]?\/revise/.test(s)) return 'self-review'
  if (/pnpm (fix:all|lint|check:all|typecheck|test)|nx affected|\bmake (test|lint|check)|uv run pytest/.test(s)) return 'checking'
  if (/git worktree add/.test(s)) return 'implementing'
  if (/sentry|list_issues|get_issue|log analytics|mongodb|attachment/i.test(s)) return 'evidence'
  return undefined
}

export const furthest = (a: Phase | undefined, b: Phase | undefined): Phase | undefined =>
  !a ? b : !b ? a : PHASES.indexOf(b) > PHASES.indexOf(a) ? b : a

/** Which watched repo a ticket's code lives in, from its prefix ("AC-12" → repoByPrefix.BLI). */
export const repoFor = (id: string, repoByPrefix: Record<string, string>) => repoByPrefix[id.split('-')[0]]

/** One exec command line: the template with {ids} filled in order. */
export const execCommand = (template: string, ids: string[]) => template.replace('{ids}', ids.join(' '))


export type TicketStack = { key: string; ids: string[] }
/**
 * Which tickets ship as one stack: the ones whose PRs sit in the same GitHub stack, in its order (bottom first), so it
 * holds across re-runs; failing that, the tickets one run worked together (before their PRs are up). `stackOf` gives
 * a PR's GitHub stack, bottom to top, by "repo#number".
 */
export function ticketStacks(tickets: { id: string; prs: { repo: string; number: number }[]; run?: { id: string; ids: string[] } }[],
  stackOf: (key: string) => { number: number }[] | undefined): Map<string, TicketStack> {
  const owner = new Map(tickets.flatMap((t) => t.prs.map((p) => [`${p.repo}#${p.number}`, t.id] as const)))
  const out = new Map<string, TicketStack>()
  for (const t of tickets) for (const p of t.prs) {
    const s = stackOf(`${p.repo}#${p.number}`)
    const ids = [...new Set(s?.map((x) => owner.get(`${p.repo}#${x.number}`)).filter((x) => x !== undefined))]
    if (s && ids.length > 1) { out.set(t.id, { key: `${p.repo}#${s[0].number}`, ids }); break }
  }
  // a run's tickets, less the ones a GitHub stack already holds
  const here = new Set(tickets.map((t) => t.id))
  for (const t of tickets) {
    if (out.has(t.id) || !t.run) continue
    const ids = t.run.ids.filter((id) => here.has(id) && !out.has(id))
    if (ids.length > 1) out.set(t.id, { key: `run:${t.run.id}`, ids })
  }
  return out
}

/** A ticket's PRs bottom of the stack first: each PR whose base is another's head goes right after it. Unknown branches keep their order. */
export function stackOrder<T extends { base?: string; head?: string }>(prs: T[]): T[] {
  const heads = new Set(prs.map((p) => p.head).filter(Boolean))
  const out: T[] = []
  const walk = (p: T) => { if (out.includes(p)) return; out.push(p); prs.filter((q) => q.head && q.base === p.head).forEach(walk) }
  prs.filter((p) => !p.base || !heads.has(p.base)).forEach(walk)
  return [...out, ...prs.filter((p) => !out.includes(p))]
}

/**
 * The goal of an unattended Ship run, checked after each turn by a small model: a prompt Stop hook, which is what
 * Claude Code's /goal is, passed with --settings so the run keeps its own command. It may stop once every ticket has
 * its outcome line and nothing it started still runs, or when it can't go on without the person; otherwise it is sent
 * back with what is missing. (Claude Code ends it anyway after 8 sends back with no tool used in between.)
 */
export function goalSettings(ids: string[], role?: string): string {
  return stopHook(shipDone(ids, role), true)
}

/**
 * The goal of a review or a revise Concierge starts: not to finish, but to reach you. It may stop once you have
 * something to act on: the crit link printed, its findings or drafted replies there, and next steps or decisions for you.
 */
export function handGoalSettings(kind: 'review' | 'revise'): string {
  return stopHook(`the line \`crit is at http://localhost:<port>\` printed in this run (or its message says the ${kind === 'review' ? 'findings' : 'drafted replies'} are ready in crit), and a closing deck-next block giving the person steps or decisions to act on`, false) // crit stays up in the background, waiting for the person: that is the point
}

function shipDone(ids: string[], role?: string) {
  return role === 'prep' ? 'a line `PREP <branch>` or `PREP none`'
    : `for every ticket (${ids.join(', ')}) its outcome line: \`<ID> <branch> <sha> shipped\`, \`<ID> <branch> <sha> ready\` (inside a stack), \`<ID> refined\` (it asked on the ticket) or \`<ID> failed: <reason>\``
}

function stopHook(done: string, settled: boolean): string {
  const prompt = [
    'An unattended coding agent wants to end its turn. Decide whether it may. The hook input, as JSON: $ARGUMENTS',
    'It may stop (ok true) when any of these holds:',
    `1. Its last message (last_assistant_message) has ${done}${settled ? ', and background_tasks is empty' : ''}.`,
    '2. Its last message asks the person a decision it cannot go on without (in a deck-next block, or on the ticket).',
    'If stop_hook_active is true and its last message says what blocks it, answer impossible with that as the reason.',
    `Otherwise answer ok false, and in reason name exactly what is missing from 1${settled ? ' (and which background task still runs: wait for it, then finish; or that its checks have not run)' : ''}.`,
    'Reply with JSON only: {"ok": true}, {"ok": false, "reason": "..."} or {"ok": false, "reason": "...", "impossible": true}.',
  ].join('\n')
  return JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt, timeout: 60 }] }] } })
}
