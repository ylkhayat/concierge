// The Intent and Understanding cards of a PR or ticket (server/discussions.ts): asked from the chat's box, answered
// inside the card (Vitals.tsx), so the chat stays the work with the agent.
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

/** The chat is the work with the agent: the cards' questions and answers live in the cards (Vitals.tsx), not here. */
export const withTurns = (feed: Activity[], ..._ds: (Discussions | undefined)[]) => feed
/** The box's words for a card: answered from the card (written again first if the work moved on); the card lights up. */
export const sayTo = (target: string, set: (d: Discussions) => void) => (topic: Topic, text: string) => {
  dispatchEvent(new CustomEvent('vital-ask', { detail: topic }))
  return api('/discussions/ask', { target, topic, text }).then((r: Discussions) => set(r))
}

export type View = 'tour' | 'business' | 'technical' | 'norms'
