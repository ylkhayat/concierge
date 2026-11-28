// One place every repeating job is started from. A job that throws is logged and runs again next time (a throw inside
// a bare setInterval ended the server); each one is named, counted and timed, so GET /api/debug/timers says what this
// server does at rest and what it costs. Timers never keep the process alive.

type Job = { name: string; ms: number; runs: number; errors: number; lastAt?: number; lastMs?: number; maxMs: number; lastError?: string; busy: boolean; skipped: number }
const jobs = new Map<string, Job>()

/**
 * Run `fn` every `ms`, as setInterval does (same argument order). An async job still running when its next turn comes
 * is skipped that turn, not run beside itself.
 */
export function every(name: string, fn: () => unknown, ms: number): NodeJS.Timeout {
  let n = name
  for (let i = 2; jobs.has(n); i++) n = `${name}#${i}`
  const job: Job = { name: n, ms, runs: 0, errors: 0, maxMs: 0, busy: false, skipped: 0 }
  jobs.set(n, job)
  const failed = (e: unknown) => {
    job.errors++; job.lastError = String((e as Error)?.message ?? e).slice(0, 200)
    if (job.errors === 1 || job.errors % 100 === 0) console.warn(`every ${n}: ${job.lastError}${job.errors > 1 ? ` (${job.errors} times)` : ''}`)
  }
  const done = (t: number) => { const d = performance.now() - t; job.lastMs = Math.round(d); job.maxMs = Math.max(job.maxMs, job.lastMs); job.busy = false }
  return setInterval(() => {
    // (one that never came back is not waited for for ever: after ten of its periods, ten minutes at least, it runs again)
    if (job.busy && Date.now() - (job.lastAt ?? 0) < Math.max(ms * 10, 600_000)) { job.skipped++; return }
    const t = performance.now()
    job.runs++; job.lastAt = Date.now(); job.busy = true
    try {
      const r = fn()
      if (r instanceof Promise) r.catch(failed).finally(() => done(t))
      else done(t)
    } catch (e) { failed(e); done(t) }
  }, ms).unref()
}

/** Every job, the costliest first (by its share of the clock: its last run's time over its period). */
export const timers = () => [...jobs.values()].map(({ busy, ...j }) => ({ ...j, busy: busy || undefined }))
  .sort((a, b) => (b.lastMs ?? 0) / b.ms - (a.lastMs ?? 0) / a.ms)
