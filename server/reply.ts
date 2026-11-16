// Shared by server tests and the browser: no Node imports here.

/** One message to the agent from what you picked: each decision as "topic: choice", then your own words. */
export function composeReply(picks: { topic: string; label: string; reply: string }[], text: string): string {
  const lines = picks.map((p) => `- ${p.topic}: ${p.label}${p.reply && p.reply.toLowerCase() !== p.label.toLowerCase() ? ` ("${p.reply}")` : ''}`)
  return [lines.length ? `My decisions:\n${lines.join('\n')}` : '', text.trim()].filter(Boolean).join('\n\n')
}

/**
 * What an agent hands back, as a checklist: each thing it can do next on its own line (ticked when it recommends doing
 * it), each choice it needs as a decision with its own pick selected. Publishing steps (push, post, submit) are marked,
 * and never folded into another: "push and post" is two lines.
 */
export type Step = {
  text: string
  kind: 'do' | 'publish' | 'decide'
  checked?: boolean // do / publish: the agent recommends doing it now
  why?: string
  blocking?: boolean // decide: it can't go on without this
  options?: { label: string; reply?: string; recommended?: boolean }[] // decide
}

/**
 * One message to the agent from the checklist: what to do now, each decision, what not to do now (so an unticked
 * "post" is a clear no), then your own words.
 */
export function composeChecklist(steps: Step[], picks: Record<number, number>, checked: Record<number, boolean>, text: string): string {
  const go: string[] = [], not: string[] = [], decided: string[] = []
  steps.forEach((s, i) => {
    if (s.kind === 'decide') {
      const o = s.options?.[picks[i] ?? -1]
      if (o) decided.push(`- ${s.text}: ${o.label}${o.reply && o.reply.toLowerCase() !== o.label.toLowerCase() ? ` ("${o.reply}")` : ''}`)
    } else (checked[i] ?? s.checked ? go : not).push(`- ${s.text}`)
  })
  return [
    go.length ? `Go ahead with:\n${go.join('\n')}` : '',
    decided.length ? `My decisions:\n${decided.join('\n')}` : '',
    not.length && (go.length || decided.length) ? `Not now (don't do these):\n${not.join('\n')}` : '',
    text.trim(),
  ].filter(Boolean).join('\n\n')
}

/** How many things a hand-back asks of you: its decisions and its moves; "stop here" alone asks nothing. */
export const pendingOf = (n?: { decisions: unknown[]; actions: { kind: string }[]; steps?: unknown[] }) =>
  (!n ? 0 : n.steps ? n.steps.length : n.decisions.length + n.actions.filter((a) => a.kind !== 'stop').length) // what the panel lists

/** The choices an agent's question lists ("1. …", "- …", "Option A: …"): the last run of two to six, so they can be picked with a tap. */
export function optionsOf(q: string): string[] {
  const runs: string[][] = [[]]
  for (const line of q.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)]|\(?[a-fA-F][.)]|\**option\s+[\w]+\**\s*[:.)-])\s*(.+)$/i)
    if (m) runs.at(-1)!.push(m[1].replace(/\*\*|__|`/g, '').trim())
    else if (line.trim()) runs.push([])
  }
  return runs.filter((r) => r.length >= 2 && r.length <= 6).at(-1) ?? []
}

/**
 * The steps you said go ahead with that name another PR (#N, one of `others`): they go to that PR's own agent, as a
 * handover, instead of this agent changing another PR's branch. Returns what stays here ('' if nothing does) and the
 * lines per PR number. ponytail: a line naming several PRs goes to the first other one it names.
 */
export function splitByPr(msg: string, self: number, others: Set<number>): { here: string; there: Map<number, string[]> } {
  const there = new Map<number, string[]>()
  const blocks = msg.split(/\n\n+/).map((b) => {
    if (!b.startsWith('Go ahead with:')) return b
    const [head, ...lines] = b.split('\n')
    const keep = lines.filter((l) => {
      const n = [...l.matchAll(/#(\d+)/g)].map((m) => Number(m[1])).find((x) => x !== self && others.has(x))
      if (n === undefined) return true
      there.set(n, [...(there.get(n) ?? []), l])
      return false
    })
    return keep.length ? [head, ...keep].join('\n') : ''
  }).filter(Boolean)
  // only a "don't do these" left: nothing to tell this agent
  const here = blocks.every((b) => b.startsWith('Not now')) ? '' : blocks.join('\n\n')
  return { here, there }
}

/**
 * Where each step you said go ahead with goes: to another of my PRs' agents (`there`), as a comment its author is asked
 * for when the PR named isn't mine (`foreign`: no agent of mine can take it), or stays with this agent (`here`).
 */
export function routeSteps(msg: string, self: number, mine: Set<number>) {
  const split = splitByPr(msg, self, mine)
  const named = new Set([...split.here.matchAll(/#(\d+)/g)].map((m) => Number(m[1])).filter((n) => n !== self && !mine.has(n)))
  const foreign = splitByPr(split.here, self, named)
  return { here: foreign.here, there: split.there, foreign: foreign.there }
}
