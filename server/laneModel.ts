// The lane, read by a small model when you pause typing (the box asks; lanes.ts has already answered at once): it reads
// the message the way a person would, with what the agent last asked, and either confirms the rules or corrects them.
// About a tenth of a cent each; the same message with the same context is answered from memory.
import { createHash } from 'node:crypto'
import type { Lane } from './lanes.ts'
import { haiku } from './next.ts'

const SYSTEM = [
  'You route one message a developer typed in the box under a pull request or a ticket an AI coding agent works on. Pick its lane:',
  '- ship: the developer wants the coding agent to DO something to the work: change, add, fix, remove, test, push, a constraint on how ("don\'t touch X"), or a reply to what the agent asked ("yes", "the second option", "keep both").',
  '- intent: the message is about what the work SHOULD do: scope, requirements, the product\'s decision, what the ticket asks, edge cases the behaviour must handle, whether something is meant or wanted.',
  '- understanding: the developer wants to KNOW what the work does or why: how the code works, why it is built this way, where something happens. Nothing changes.',
  'A request phrased as a question ("can you add X?") is ship. "Can you explain X" is understanding. When it truly could be either, prefer understanding (it changes nothing). sure: how sure you are, 0 to 1.',
].join('\n')
const SCHEMA = { type: 'object', additionalProperties: false, required: ['lane', 'sure'], properties: { lane: { enum: ['ship', 'intent', 'understanding'] }, sure: { type: 'number' } } }

const memo = new Map<string, { lane: Lane; sure: number }>()
/** `asked`: where the conversation stands: the agent's last words and what it asked (the box sends both). */
export async function laneByModel(text: string, asked?: string): Promise<{ lane: Lane; sure: number; costUsd: number }> {
  const key = createHash('sha1').update(`${asked ?? ''}\n${text}`).digest('hex')
  const was = memo.get(key)
  if (was) return { ...was, costUsd: 0 }
  const prompt = `${asked ? `Where the conversation stands (the coding agent's last words, and what it asked):\n${asked.slice(0, 3000)}\n\n` : 'Nothing said by the agent yet.\n\n'}The developer's message:\n${text.slice(0, 2000)}`
  const { out, costUsd } = await haiku<{ lane: Lane; sure: number }>(prompt, SCHEMA, SYSTEM, 0.05)
  memo.set(key, out)
  if (memo.size > 300) memo.delete(memo.keys().next().value!)
  return { ...out, costUsd }
}
