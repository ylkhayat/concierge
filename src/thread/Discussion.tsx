// The Intent and Understanding cards of a PR or ticket (server/discussions.ts): asked from the chat's box, answered
// from the card (Vitals.tsx); the question and its answer also show in the chat, in that lane's colour and name.
import { Compass, Target, type LucideIcon } from 'lucide-react'
import type { Discussion as D, Topic } from '../../server/discussions.ts'
import { api, type Activity } from '../lib.ts'
import { remember, useApi } from '../query.ts'
import { useMemo } from 'react'

export type { Topic }
type Toast = (m: string, tone?: 'ok' | 'error') => void
export type Discussions = Record<Topic, D>

export const TOPIC: Record<Topic, { label: string; icon: LucideIcon; question: string; starters: string[] }> = {
  intent: { label: 'Intent', icon: Target, question: 'What is it meant to do, and what was decided?', starters: ['Draft the decision record for this', 'Check it against what was asked: what is missing or extra?', 'Which decisions did nobody make yet?'] },
  understanding: { label: 'Understanding', icon: Compass, question: 'Do you know what it does, from every angle?', starters: ['Walk me through it, business first', 'Which part of the code carries the risk?', 'Quiz me on what matters before I approve'] },
}

/** A target's discussions, kept current: every 2s while one is answering, else every 20s. */
export function useDiscussions(target: string | undefined) {
  const path = target ? `/discussions?target=${encodeURIComponent(target)}` : undefined
  // cached per target (the main chat's summaries and both discussions share it): every 2s while one answers, else 20s
  // the server says when a card changed (live.ts); a slow read covers a missed message
  const q = useApi<Discussions>(path, { refetchInterval: 60_000 })
  return { d: q.data, set: (v: Discussions | undefined) => { if (path) remember(path, v) }, read: () => q.refetch() }
}

/** A target's discussions as turns of the chat, each with its lane: a question routed to Understanding or Intent is
 *  answered where it was asked, not only inside the card (where it could be missed). The card's own writing isn't a turn. */
function laneTurns(d?: Discussions): Activity[] {
  if (!d) return []
  return (Object.values(d) as D[]).flatMap((x) => [
    ...x.messages.map((m): Activity => ({ at: m.at, kind: m.who === 'you' ? 'you' : 'text', text: m.text, lane: x.topic })),
    // answering a question (not only writing its card): said where the answer will appear, just after the question
    // (a fixed time, so it keeps its place and isn't drawn anew on every render)
    ...(x.busy && x.phase !== 'refreshing' && x.messages.at(-1)?.who === 'you' ? [{ at: new Date(Date.parse(x.messages.at(-1)!.at) + 1).toISOString(), kind: 'text' as const, text: x.phase === 'reading' ? '_Reading the code to answer…_' : '_Answering…_', lane: x.topic }] : []),
    ...(x.error && x.messages.at(-1)?.who === 'you' ? [{ at: x.messages.at(-1)!.at, kind: 'text' as const, text: `**Couldn't answer:** ${x.error}`, lane: x.topic }] : []),
  ])
}
/** The conversation and the discussions' questions and answers, in the order they happened. */
export const withTurns = (feed: Activity[], ...ds: (Discussions | undefined)[]) => {
  const turns = ds.flatMap(laneTurns)
  return turns.length ? [...feed, ...turns].sort((a, b) => a.at.localeCompare(b.at)) : feed
}
/** The box's words for a card: answered from the card (written again first if the work moved on); the card lights up. */
export const sayTo = (target: string, set: (d: Discussions) => void) => (topic: Topic, text: string) => {
  dispatchEvent(new CustomEvent('vital-ask', { detail: topic }))
  return api('/discussions/ask', { target, topic, text }).then((r: Discussions) => set(r))
}

export type View = 'tour' | 'business' | 'technical' | 'norms'

/** The Work a PR or ticket is part of (server/work.ts): linked parts share one memory and one pair of cards. */
export type WorkView = { id: string; target: string; members: { key: string; kind: 'pr' | 'ticket'; label: string; title: string }[]; links: [string, string][] }
export const useWork = (member: string) => useApi<WorkView>(`/works?member=${encodeURIComponent(member)}`, { staleTime: 60_000 }).data

/** The parts of this work, on the header's first line (after what it is): each opens its own page; one you linked
 *  (with @) can be unlinked here. It is read after the page is drawn, so it sits where arriving moves nothing: at the
 *  end of a line that is already there, taking what is left of it (never a row of its own, which pushed the cards and
 *  the conversation down each time a PR was opened). */
export function WorkStrip({ work, here, onOpen, toast }: { work?: WorkView; here: string; onOpen: (key: string) => void; toast: Toast }) {
  if (!work || work.members.length < 2) return null
  const pair = (k: string) => work.links.find(([a, b]) => a === k || b === k)
  const unlink = (k: string) => { const p = pair(k)!; api('/works/unlink', { a: p[0] === k ? p[1] : p[0], b: k }).then(() => toast(`Unlinked ${k.replace(/^\w+:/, '')}: it keeps a copy of what was said`), (e: Error) => toast(e.message, 'error')) }
  return (
    <div className="flex min-w-0 flex-[1_1_0] items-center gap-1 overflow-x-auto whitespace-nowrap text-meta [scrollbar-width:none]" aria-label="This work's parts" title="One work: these share one memory, one pair of cards and one chat">
      <span className="mr-1 shrink-0 text-fg-4">Work</span>
      {work.members.map((m) => (
        <span key={m.key} className={`group/m inline-flex shrink-0 items-center rounded-full pl-1.5 ${m.key === here ? 'bg-accent-soft pr-1.5 text-fg-1' : 'pr-0.5 text-fg-3 hover:bg-hover hover:text-fg-1'}`}>
          <button type="button" onClick={() => m.key !== here && onOpen(m.key)} title={`${m.label} ${m.title}`} className={`font-mono ${m.kind === 'ticket' ? 'text-accent-text' : ''}`}>{m.label}</button>
          {m.key !== here && pair(m.key) && <button type="button" onClick={() => unlink(m.key)} title="Unlink: it leaves this work, with a copy of what was said" className="rounded-full px-1 text-fg-4 opacity-0 transition-opacity hover:text-fail-text group-hover/m:opacity-100">×</button>}
        </span>
      ))}
    </div>
  )
}

/** One chat for the whole Work: this part's own conversation and the other parts', in the order things happened, with
 *  a line wherever it moves from one part to another. Alone (no other parts), just its own. */
export function useWorkFeed(member: string, work: WorkView | undefined, own: Activity[]): Activity[] {
  const shared = !!work && work.members.length > 1
  const others = useApi<(Activity & { part?: string })[]>(shared ? `/works/feed?member=${encodeURIComponent(member)}` : undefined, { refetchInterval: 60_000 }).data
  return useMemo(() => {
    if (!shared || !others?.length) return own
    const here = work!.members.find((m) => m.key === member)?.label ?? 'here'
    const all = [...own.map((a) => ({ ...a, part: here })), ...others].sort((a, b) => a.at.localeCompare(b.at))
    const out: Activity[] = []
    let last: string | undefined
    for (const a of all) {
      if (a.part !== last) { out.push({ at: a.at, kind: 'section', text: a.part === here ? `Here, on ${here}` : `On ${a.part}` }); last = a.part }
      out.push(a)
    }
    return out
  }, [own, others, member, shared])
}
