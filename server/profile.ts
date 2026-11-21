// A CPU profile of this server, from inside it (node:inspector): where its thread's time went for a few seconds, by
// function, self and total (with what it called). For finding what blocks the thread on a machine you can't attach to.
import { Session } from 'node:inspector/promises'

type Frame = { functionName: string; url: string; lineNumber: number }
type PNode = { id: number; callFrame: Frame; children?: number[] }

let busy = false
export async function profile(seconds: number) {
  if (busy) throw new Error('A profile is already running')
  busy = true
  const s = new Session()
  s.connect()
  try {
    await s.post('Profiler.enable')
    await s.post('Profiler.setSamplingInterval', { interval: 500 })
    await s.post('Profiler.start')
    await new Promise((r) => setTimeout(r, Math.min(30, Math.max(2, seconds)) * 1000))
    const { profile: p } = await s.post('Profiler.stop') as { profile: { nodes: PNode[]; samples: number[]; timeDeltas: number[] } }
    const byId = new Map(p.nodes.map((n) => [n.id, n])), parent = new Map<number, number>()
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
    const name = (f: Frame) => `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/(server|src|node_modules)\//, '$1/')}:${f.lineNumber + 1}`
    const self = new Map<string, number>(), total = new Map<string, number>()
    let all = 0, idle = 0
    p.samples.forEach((id, i) => {
      const ms = p.timeDeltas[i] / 1000; all += ms
      const n = byId.get(id)!
      if (/^\((idle|program)\)$/.test(n.callFrame.functionName)) { idle += ms; return }
      self.set(name(n.callFrame), (self.get(name(n.callFrame)) ?? 0) + ms)
      const seen = new Set<string>()
      for (let x: number | undefined = id; x != null; x = parent.get(x)) { const k = name(byId.get(x)!.callFrame); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) ?? 0) + ms) } }
    })
    const top = (m: Map<string, number>, only?: RegExp) => [...m].filter(([k]) => !only || only.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([fn, ms]) => ({ fn, ms: Math.round(ms) }))
    return { seconds: Math.round(all / 1000), busyPct: Math.round(100 - (idle / all) * 100), self: top(self), totalInServer: top(total, /\sserver\//) }
  } finally { s.disconnect(); busy = false }
}
