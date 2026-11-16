// The Intent and Understanding discussions of a PR or ticket (server/discussions.ts): their turns sit in the one chat,
// in their lane's colour (ActivityFeed), and where each stands is a card of the panel's Vitals tab (Vitals.tsx).
import { Compass, Target, type LucideIcon } from 'lucide-react'
import type { Discussion as D, Topic } from '../../server/discussions.ts'
import { api, type Activity } from '../lib.ts'
import { remember, useApi } from '../query.ts'

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
  const q = useApi<Discussions>(path, { refetchInterval: (query) => (query.state.data && Object.values(query.state.data).some((x) => x.busy) ? 2000 : 20_000) })
  return { d: q.data, set: (v: Discussions | undefined) => { if (path) remember(path, v) }, read: () => q.refetch() }
}

/** A target's discussions as turns of the main conversation, each tagged with its lane (merged in by time). */
export function laneTurns(d?: Discussions): Activity[] {
  if (!d) return []
  return (Object.values(d) as D[]).flatMap((x) => [
    ...x.messages.map((m): Activity => ({ at: m.at, kind: m.who === 'you' ? 'you' : 'text', text: m.text, lane: x.topic })),
    ...(x.busy ? [{ at: new Date().toISOString(), kind: 'text' as const, text: '_Thinking it through…_', lane: x.topic }] : []),
    ...(x.error ? [{ at: x.messages.at(-1)?.at ?? new Date().toISOString(), kind: 'text' as const, text: `**Couldn't answer:** ${x.error}`, lane: x.topic }] : []),
  ])
}
/** The conversation and the discussions' turns, in the order they happened. */
export const withTurns = (feed: Activity[], ...ds: (Discussions | undefined)[]) => {
  const turns = ds.flatMap(laneTurns)
  return turns.length ? [...feed, ...turns].sort((a, b) => a.at.localeCompare(b.at)) : feed
}
/** Words the box routed to a discussion. */
export const sayTo = (target: string, set: (d: Discussions) => void) => (topic: Topic, text: string) =>
  api('/discussions/say', { target, topic, text }).then((r: Discussions) => set(r))

export type View = 'tour' | 'business' | 'technical' | 'norms'
