// Who may be answered at all, by the name the request was sent to. A web page anywhere can make your browser call
// http://127.0.0.1:4747 under a name of its own (DNS rebinding: evil.example, answered once with its real address and
// then with 127.0.0.1), and the browser treats that as the page's own site: it reads the answers, and its POSTs are
// "same-origin". The request still says the name it used, in Host. Concierge is only ever opened by a name of this
// machine or of your tailnet, so any other name is refused.
const LOCAL_SUFFIX = ['.ts.net', '.localhost', '.local', '.lan', '.internal', '.home.arpa']

/** A Host or an Origin's host, without its port, lower case; IPv6 keeps its brackets. */
const nameOf = (host: string) => host.trim().toLowerCase().replace(/:\d+$/, '')

/**
 * May a request sent to this name be answered? Yes for an address (a name is what rebinding needs), a name without a
 * dot (localhost, a tailnet machine's short name: no public name is one), a tailnet or home-network name, and the
 * names you added (CONCIERGE_HOSTS, comma separated; `*` turns the check off). No Host at all: a script, not a browser.
 */
export function hostOk(host: string | undefined, extra: string[] = []): boolean {
  if (!host) return true
  if (extra.includes('*')) return true
  const h = nameOf(host)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h)) return true
  if (!h.includes('.')) return true
  return LOCAL_SUFFIX.some((s) => h.endsWith(s)) || extra.map(nameOf).includes(h)
}

/** May a request that changes something be taken from the page at this Origin? The same rule: a page of yours. */
export function originOk(origin: string | undefined, extra: string[] = []): boolean {
  if (!origin || origin === 'null') return !origin // none: a script or another machine. "null": a sandboxed frame, refused
  try { return hostOk(new URL(origin).host, extra) } catch { return false }
}
