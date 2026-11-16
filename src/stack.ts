// Reading a ticket's PRs as stacks: pure helpers for PrStack (kept out of .tsx so tests can load them).

/** "feat(web-app): AC-1064 set the daily call time" → { type: 'feat', scope: 'web-app', text: 'set the daily call time' } */
export function titleParts(title = '') {
  const m = title.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(?:[A-Z][A-Z0-9]*-\d+\s+)?(.*)$/)
  return m ? { type: m[1], scope: m[2], text: m[3] } : { text: title }
}

/** Split the PRs (already bottom of the stack first) into chains: a PR joins the one above it when it is built on it. */
export function chainsOf<P extends { base?: string; head?: string }>(prs: P[]): P[][] {
  const out: P[][] = []
  for (const p of prs) {
    const last = out.at(-1)?.at(-1)
    if (last && p.base && last.head && p.base === last.head) out.at(-1)!.push(p)
    else out.push([p])
  }
  return out
}

