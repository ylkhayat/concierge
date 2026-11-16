/** A run's words that point at the network rather than the code: a VPN may be what was missing. (No imports: the page uses it too.) */
export const soundsUnreachable = (text = '') =>
  /\b(vpn|private link|(?:not|\w+n['’]t) reachable|unreachable|(?:could ?n[o']t|can ?n[o']t|unable to) (?:reach|connect)|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timed out connecting)\b/i.test(text)
