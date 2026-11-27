import { Check, Circle, LoaderCircle, Square } from 'lucide-react'
import { useContext } from 'react'
import type { Activity } from '../lib.ts'
import { StopAbove } from '../ui/Thread.tsx'
import { BgNow, turnOver } from './Background.tsx'
import { brief } from '../../server/brief.ts'
import { plain } from './ActivityFeed.tsx'

/** What the agent is doing right now: its latest step in this run (a tool, or what it said), newest last. */
function doing(feed: Activity[]) {
  const since = feed.findLastIndex((a) => a.kind === 'section')
  return feed.slice(since + 1).filter((a) => a.kind === 'tool' || a.kind === 'text').slice(-3)
}

/**
 * The panel while an agent works: no actions to take, only where it is and a quiet Stop. Its decisions come when it
 * hands back.
 */
export function Working({ why, feed, onStop, bg, toast }: { why?: string; feed: Activity[]; onStop: () => void; bg?: { base: string; count: number }; toast?: (m: string, tone?: 'ok' | 'error') => void }) {
  const steps = doing(feed), stopAbove = useContext(StopAbove)
  const parked = turnOver(feed)
  // its own plan (the latest TodoWrite of this run), kept as a ledger: done, the one it is on, what comes
  const since = feed.findLastIndex((a) => a.kind === 'section')
  const plan = feed.slice(since + 1).findLast((a) => a.todos?.length)?.todos
  const done = plan?.filter((t) => t.state === 'completed').length ?? 0
  return (
    <div className="space-y-2.5">
      {why && <p className="flex items-center gap-2 text-body text-fg-2"><LoaderCircle className="size-4 shrink-0 animate-spin text-run-text" />{why}</p>}
      {bg && <BgNow base={bg.base} count={bg.count} parked={parked} open toast={toast} />}
      {plan ? (
        <div>
          <p className="mb-1.5 flex items-center gap-2 text-small text-fg-3">Its plan<span className="tabular-nums text-fg-4">{done} of {plan.length}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-hover"><span className="block h-full rounded-full bg-run transition-[width] duration-500" style={{ width: `${(done / plan.length) * 100}%` }} /></span></p>
          <ol className="space-y-1">
            {plan.map((t, i) => (
              <li key={i} className={`flex items-start gap-2 text-small ${t.state === 'completed' ? 'text-fg-4' : t.state === 'in_progress' ? 'font-medium text-fg-1' : 'text-fg-3'}`}>
                <span className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center">
                  {t.state === 'completed' ? <Check className="size-3.5 text-ok-text" strokeWidth={3} /> : t.state === 'in_progress' ? <LoaderCircle className="size-3.5 animate-spin text-run-text" /> : <Circle className="size-3 text-fg-4" />}
                </span>
                <span className="min-w-0">{t.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : steps.length > 0 && (
        <ol className="space-y-1 border-l-2 border-run/30 pl-3 text-small text-fg-3">
          {steps.map((a, i) => (
            <li key={`${a.at}${i}`} className={`truncate ${i === steps.length - 1 ? 'text-fg-2' : ''}`} title={a.kind === 'tool' ? a.text : plain(a.text)}>
              {a.kind === 'tool' && <span className="mr-1 font-mono text-meta text-run-text">{a.tool}</span>}{a.kind === 'tool' ? (a.tool === 'Bash' ? brief(a.text) : a.text) : plain(a.text)}
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="flex-1 text-meta text-fg-4">Its decisions show here when it hands back.</span>
        {!stopAbove && <button onClick={onStop} className="btn-outline btn-sm inline-flex items-center gap-1.5 hover:text-fail-text">
          <Square className="size-3 fill-current" />Stop
        </button>}
      </div>
    </div>
  )
}
