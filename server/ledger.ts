// What a run already did that the outside world saw: a push, a review or comment posted, a PR opened, a ticket moved.
// Read from its own log (the commands it ran), for a run that is continued after a restart: it is told "never do it
// twice", and this is the list of what "it" was, instead of leaving it to remember.
type Line = { kind: string; tool?: string; text: string }

// a command that leaves the machine: each is worth saying once
const OUTWARD = [
  /\bgit\s+push\b/,
  /\bgh\s+pr\s+(review|comment|create|merge|ready|close|edit)\b/,
  /\bgh\s+issue\s+(comment|create|close|edit)\b/,
  /\bgh\s+api\b.*(-X|--method)\s*(POST|PATCH|PUT|DELETE)\b/i,
  /\bgh\s+release\s+create\b/,
  /\bcrit\s+(share|push|submit)\b/,
  /api\.linear\.app.*mutation/i,
]

/** The outward commands of the run's last part (after its last section line), each once, shortened; the newest last. */
export function alreadyDid(feed: Line[], max = 12): string[] {
  const from = feed.findLastIndex((a) => a.kind === 'section')
  const seen = new Set<string>(), out: string[] = []
  for (const a of feed.slice(from + 1)) {
    if (a.kind !== 'tool' || a.tool !== 'Bash') continue
    const cmd = a.text.replace(/\s+/g, ' ').trim()
    if (!OUTWARD.some((r) => r.test(cmd))) continue
    const short = cmd.length > 160 ? `${cmd.slice(0, 157)}…` : cmd
    if (!seen.has(short)) { seen.add(short); out.push(short) }
  }
  return out.slice(-max)
}

/** The same, as a paragraph for the run's prompt ('' when it did nothing outward). */
export const didNote = (feed: Line[]) => {
  const did = alreadyDid(feed)
  return did.length ? `\nFrom your own log, these already ran before the stop. Each reached GitHub, Linear or the remote, so check its effect and do not run it again:\n${did.map((c) => `- ${c}`).join('\n')}\n` : ''
}
