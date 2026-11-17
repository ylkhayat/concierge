// The Claude plan's own limits are the referee: a 5-hour session window and a 7-day one, each used 0–1 and starting
// over at its reset. Every agent's stream reports them (rate_limit_event), so nothing is asked for: the latest report
// is kept, and work stops near the end of a window and picks up after it resets.

/** One window: how much of it is used (0–1) and when it starts over (epoch seconds). */
export type Window = { used: number; resetsAt: number }
export type Usage = { five?: Window; seven?: Window; at: string; who?: string; overage?: boolean } // overage: past a window, on paid extra usage, and allowed // who: the sign-in they were reported under (providers.ts identityOf)

// the default level for both windows; Settings → Accounts changes it (config.providers.stopAt)
export const STOP_AT = 0.95

/** The windows after one rate_limit_event's rate_limit_info; a window it doesn't mention keeps what was known. */
export function windowsOf(info: any, prev: Usage | undefined, now = Date.now()): Usage {
  const w = info?.unifiedWindows ?? {}
  const pick = (k: 'five_hour' | 'seven_day', old?: Window): Window | undefined => {
    const x = w[k] ?? (info?.rateLimitType === k ? info : undefined)
    if (!x?.resetsAt) return old
    // refused: that window is used up, whatever number came with it
    const used = info.status === 'rejected' && info.rateLimitType === k ? 1 : x.utilization
    return used == null ? (old?.resetsAt === x.resetsAt ? old : undefined) : { used, resetsAt: x.resetsAt }
  }
  // past a window but still served, on extra usage you pay for: the plan can take work whatever the window says
  const overage = info?.isUsingOverage === true && info.status !== 'rejected'
  return { five: pick('five_hour', prev?.five), seven: pick('seven_day', prev?.seven), at: new Date(now).toISOString(), ...(overage && { overage }) }
}

/** The window that is (nearly) used up and hasn't reset yet, or nothing: while there is one, no agent works. */
export function spentWindow(u: Usage | undefined, now = Date.now(), stopAt = STOP_AT): { which: '5-hour' | '7-day'; w: Window } | undefined {
  if (u?.overage) return undefined // served past its window (extra usage): Claude's own answer is the referee
  for (const [which, w] of [['5-hour', u?.five], ['7-day', u?.seven]] as const)
    if (w && w.used >= stopAt && now < w.resetsAt * 1000) return { which, w }
}

/** A run's error that is Claude refusing for the plan's limit ("Claude AI usage limit reached", "You've hit your limit"). */
export const limitHit = (text?: string) => !!text && /usage limit reached|hit your (session |weekly |usage )?limit|out of extra usage/i.test(text)

/** "the 5-hour window is 96% used; it resets at 17:30" */
export function spentText(s: NonNullable<ReturnType<typeof spentWindow>>, now = Date.now()) {
  const at = new Date(s.w.resetsAt * 1000)
  const when = at.getTime() - now < 20 * 3600_000 ? at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : at.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return `the Claude plan's ${s.which} window is ${Math.round(s.w.used * 100)}% used; it resets at ${when}`
}
