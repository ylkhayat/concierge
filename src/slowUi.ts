// The page's own slow moments, reported to the server's log (where Settings → Machines → logs shows them): frames the
// page's thread blocked for over 200 ms, and clicks or keys that took over 200 ms to answer. Like a performance
// monitor, without sending anything off your machines.
const seen: string[] = []
const where = () => `${location.pathname}${location.hash ? ' #…' : ''}`
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration > 200) seen.push(`blocked ${Math.round(e.duration)}ms on ${where()}`) }).observe({ type: 'longtask', buffered: true })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as PerformanceEventTiming[]) {
      const t = e.target as HTMLElement | null
      seen.push(`${e.name} answered in ${Math.round(e.duration)}ms on ${where()}${t ? ` (${t.tagName.toLowerCase()}${t.getAttribute('aria-label') ? ` "${t.getAttribute('aria-label')!.slice(0, 40)}"` : ''})` : ''}`)
    }
  }).observe({ type: 'event', durationThreshold: 200, buffered: true } as PerformanceObserverInit)
} catch { /* a browser without these entry types: nothing to report */ }
// at most every 15 seconds, at most 20 at a time
setInterval(() => {
  if (!seen.length) return
  const lines = seen.splice(0).slice(-20)
  void fetch('/api/debug/ui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines }), keepalive: true }).catch(() => {})
}, 15_000)
