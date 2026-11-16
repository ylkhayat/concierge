// One box for everything said about a PR or a ticket: each message goes to the lane it belongs to.
//   ship           Build: an instruction for the coding agent (it changes the work), or an answer to what it asked
//   intent         what the work is meant to do: scope, requirements, decisions (a read-only discussion)
//   understanding  what the work does: questions about the code (a read-only discussion)
// Read in two steps: these rules answer at once as you type (weighing what the words ask for, not only the first
// one), and a small model (laneModel.ts) confirms or corrects them when you pause, given what the agent last asked.
// Anything still unclear goes to understanding: a question sent to the agent as an instruction can change code, an
// instruction read as a question costs one reply. You see the lane before sending, and can pick another.
export type Lane = 'ship' | 'intent' | 'understanding'

// what you'd ask an agent to do to the code
const DO = 'add|change|fix|remove|delete|rename|update|use|make|implement|move|refactor|revert|push|write|stop|try|run|retry|drop|split|merge|rebase|bump|replace|extract|inline|handle|cover|test|undo|apply|commit|ship|create|build|introduce|enable|disable|wire|hook|expose|guard|log|upgrade|downgrade|migrate|clean|tidy|simplify|rewrite|port|generate|rework|redo|restore|keep|skip|ignore|reuse|pass|return|throw|catch|validate|check|ensure|limit|cap|raise|lower|increase|decrease|rerun|re-run|resolve|address|reply|answer|post|publish|approve|finish|continue|proceed|go|do|put|set|turn|bring|swap|switch|sort|filter|group|cache|debounce|throttle|memoize|document|comment|format|lint|type'
// what you'd ask to be told
const TELL = 'explain|tell|show|walk|describe|clarify|summari[sz]e|outline|list|trace'
const ASK = '(?:please|pls|can you|could you|would you|will you|i want you to|i need you to|i\'?d like you to|let\'?s|go ahead and|make sure (?:to|that|you)|try to|you should|we need to|need to|just|also)'
const FILLER = /^(?:(?:hey|hi|ok(?:ay)?|so|also|and|but|well|hmm+|right|alright|now|then|btw|@\w+)[,.!]?\s+)+/i

const has = (re: RegExp, t: string) => (re.test(t) ? 1 : 0)
/** Each lane's weight for a message (higher: more likely), by what its words ask for. */
export function laneScores(text: string, answering = false): Record<Lane, number> {
  const t = text.trim().replace(/^(?:>.*\n)+\s*/, '').replace(FILLER, '').toLowerCase()
  const question = /\?\s*$/.test(t)
  const s: Record<Lane, number> = { ship: 0, intent: 0, understanding: 0 }
  // asked to tell: understanding, however politely ("can you explain…")
  if (new RegExp(`^(?:${ASK}\\s+)*(?:${TELL})\\b`).test(t) || /\bhelp me understand\b|\bwalk me through\b/.test(t)) s.understanding += 3
  // asked to do: a verb first, or after a request ("please", "can you", "let's", "make sure to", "we need to")
  // (not "do we…", "can it…": a verb before its subject asks a question)
  else if (new RegExp(`^(?:${ASK}\\s+)*(?:${DO})\\b(?!\\s+(?:we|you|they|i|users?|he|she)\\b)`).test(t)) s.ship += 3
  // a rule for the agent: "don't…", "never…", "avoid…"
  if (/^(?:please\s+)?(?:don'?t|do not|never|avoid|no more|stop)\b/.test(t)) s.ship += 3
  // what it is meant to do: scope, requirements, the product's call
  s.intent += 2 * has(/\b(?:meant to|supposed to|intended|intent|expected to|should(?:n'?t)? (?:it|we|this|that|they|users?|the (?:app|user|product|feature))|do we (?:want|need|really)|what do we want|is (?:it|this|that) (?:ok|fine|right|correct|intended|expected) (?:to|that|for)|requirements?|out of scope|in scope|scope|acceptance criteria|the ticket (?:says|asks|wants)|per the (?:ticket|spec)|spec|product(?: decision)?|decid\w*|decision|trade-?off|what if|edge case|expected behaviou?r|business|customers?)\b/, t)
  // what it does: how and why the code works
  s.understanding += 2 * has(/^(?:why|how|where|which|what(?:'s| is| does| happens| are)|when does|is there|are there|does (?:it|this|that)|do (?:we|they|you)|can (?:it|this)|who calls)\b/, t)
  s.understanding += has(/\b(?:explain|understand|confus\w*|don'?t get|what'?s the point|purpose of|meaning of|how come|under the hood|in this (?:diff|pr|change|file)|this (?:function|file|line|test|hook|class))\b/, t)
  // the agent asked something: a short reply that asks nothing back is its answer
  if (answering && !question) {
    s.ship += t.split(/\s+/).length <= 14 ? 3 : 1
    if (/^(?:yes|yeah|yep|no|nope|ok(?:ay)?|sure|lgtm|sounds good|go(?: ahead| with)?|the (?:first|second|third|last|other) (?:one|option)|option \d|both|neither|either)\b/.test(t)) s.ship += 3
  }
  if (/^(?:yes|no|ok(?:ay)?|lgtm|go ahead|ship it|approve)\b/.test(t) && !question) s.ship += 2
  if (question) s.understanding += 1
  return s
}

/** The lane a message goes to, by these rules alone. `answering`: the agent asked something, so a reply is for it. */
export function laneOf(text: string, answering = false): Lane {
  const t = text.trim()
  if (!t || t.startsWith('/')) return 'ship'
  const s = laneScores(t, answering)
  const best = Math.max(s.ship, s.intent, s.understanding)
  if (!best) return answering ? 'ship' : 'understanding'
  // ties go to the read-only lanes: intent over understanding, either over ship
  return s.intent === best ? 'intent' : s.understanding === best ? 'understanding' : 'ship'
}
