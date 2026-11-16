// The server's own recent lines (what it prints), kept in memory so Settings → Machines can show any machine's log
// without a shell on it. Scrubbed when read, never written anywhere.
const lines: string[] = []
const MAX = 400
for (const level of ['log', 'warn', 'error'] as const) {
  const orig = console[level].bind(console)
  console[level] = (...a: unknown[]) => {
    orig(...a)
    const text = a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.message : (() => { try { return JSON.stringify(x) } catch { return String(x) } })())).join(' ')
    lines.push(`${new Date().toISOString().slice(11, 19)} ${level === 'log' ? '' : `${level}: `}${text}`.slice(0, 2000))
    if (lines.length > MAX) lines.splice(0, lines.length - MAX)
  }
}
export const recentLines = (n = 200) => lines.slice(-n)
