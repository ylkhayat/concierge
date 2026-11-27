// Why a run ended, as a code. The agents' own tools (Claude Code, Codex, Copilot) and the network say what went wrong
// in words; those words are read here, once, and everything that decides what happens next (place it again, continue
// it in a minute, start it over on another account) goes by the code. A new wording is added in this one place.
import { authFailed, cantPay } from './claudeLogin.ts'
import { NO_ROOM } from './worker.ts'

export type Why =
  | 'no-room'      // the machine it was sent to had filled up: it never started
  | 'network'      // the connection to the AI or to the machine dropped, or the agent hung with nothing running
  | 'shut-out'     // its account couldn't sign in or couldn't be paid
  | 'session-gone' // the conversation it was to continue is no longer there
  | 'other'        // it failed for a reason of its own (the error says)

const NETWORK = /agent hung|lost the connection to|Can't reach the API server|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|socket hang up/i
const SESSION_GONE = /No conversation found|session .* not found/i

/** Read how a run ended: its error (what it is left with) and what its tool printed on the way out. None: it didn't fail. */
export function whyEnded(error?: string, stderr = ''): Why | undefined {
  if (error?.startsWith(NO_ROOM)) return 'no-room'
  if (error && NETWORK.test(error)) return 'network'
  if (error && (authFailed(error) || cantPay(error))) return 'shut-out'
  if (SESSION_GONE.test(stderr)) return 'session-gone'
  return error ? 'other' : undefined
}
