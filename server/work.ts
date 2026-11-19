// A Work: everything linked together, the tickets and the pull requests (and so the stacks) that ship one piece of
// work. Linked when a PR names a ticket (title, branch, description), when PRs share a stack, and when you link them
// yourself (@ in the chat). Many to many: a ticket with several PRs, a PR for several tickets, a stack of both.
//
// A Work shares one memory, not one conversation: what you said and decided on any of its members, in order. Every
// run on any member reads it (with what each member's agent last reported), so a decision made on the ticket holds
// for its PRs and their stack, and nothing is decided twice. Each run stays short and cheap; a conversation that
// grows with every turn of every member would cost more each time, and let only one member work at a time.
//
// A member is a key: `pr:owner/repo#12` or `ticket:AI-1418`. The Work's id is stable: when two Works become linked
// they merge into the older one, memories together; one that comes apart keeps the memory with each part.
import { randomUUID } from 'node:crypto'

export type Said = { text: string; at: string; on: string } // your words, and the member you said them on
export type WorkMemory = { id: string; at: string; said: Said[]; links: [string, string][] }
export type WorkStore = { works: Record<string, WorkMemory>; workOf: Record<string, string> }

/** Every member linked to `start`, itself first. */
export function component(start: string, edges: (k: string) => string[]): string[] {
  const seen = new Set([start]), todo = [start]
  while (todo.length) for (const n of edges(todo.pop()!)) if (!seen.has(n)) { seen.add(n); todo.push(n) }
  return [...seen]
}

/** The Work these members form: theirs if they have one, the oldest when they had several (the others merge into it). */
export function workFor(s: WorkStore, members: string[], now = new Date().toISOString()): WorkMemory {
  const ids = [...new Set(members.map((m) => s.workOf[m]).filter((x): x is string => !!x && !!s.works[x]))]
  const all = ids.map((id) => s.works[id]).sort((a, b) => a.at.localeCompare(b.at))
  let w = all[0]
  if (!w) { const id = randomUUID().slice(0, 8); w = s.works[id] = { id, at: now, said: [], links: [] } }
  for (const o of all.slice(1)) {
    w.said = [...w.said, ...o.said].sort((a, b) => a.at.localeCompare(b.at)).slice(-200)
    w.links = [...w.links, ...o.links]
    delete s.works[o.id]
  }
  for (const m of members) s.workOf[m] = w.id
  return w
}

/** Your words on a member, kept in its Work's memory (the last 200). */
export function remember(w: WorkMemory, on: string, text: string, now = new Date().toISOString()) {
  const t = text.trim()
  if (!t) return
  w.said = [...w.said, { text: t.slice(0, 2000), at: now, on }].slice(-200)
}

/** What every run on a member is given: the Work's members, and what you said across them, newest last. */
export function brief(w: WorkMemory, members: { key: string; label: string; title: string }[], here: string): string {
  if (members.length < 2 && !w.said.some((x) => x.on !== here)) return ''
  const label = (k: string) => members.find((m) => m.key === k)?.label ?? k.replace(/^\w+:/, '')
  const lines = [
    `\n\nThis is one piece of work with ${members.length} parts, sharing one memory: ${members.map((m) => `${m.label} "${m.title}"`).join('; ')}. You are on ${label(here)}.`,
    'What the developer said and decided across all of them holds for every part, here too: follow it, and never ask again what it already settles.',
  ]
  const said = w.said.slice(-25)
  if (said.length) lines.push('What the developer said, oldest first:', ...said.map((x) => `- on ${label(x.on)} (${x.at.slice(0, 16).replace('T', ' ')}): ${x.text.replace(/\s+/g, ' ').slice(0, 500)}`))
  return lines.join('\n')
}
