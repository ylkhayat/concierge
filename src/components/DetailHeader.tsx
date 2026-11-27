import { Check, ChevronDown, TriangleAlert } from 'lucide-react'
import { useId, type CSSProperties } from 'react'

const TONE = {
  violet: 'bg-accent/10 text-accent-text ring-accent/25',
  emerald: 'bg-ok/10 text-ok-text ring-ok/25',
  amber: 'bg-wait/10 text-wait-text ring-wait/30',
  rose: 'bg-fail/10 text-fail-text ring-fail/25',
  blue: 'bg-run/10 text-run-text ring-run/25',
  zinc: 'bg-fill text-fg-2 ring-line-strong',
}
export type StatusTone = keyof typeof TONE

/**
 * Where it stands, as one field: its state, and (on click) every step with the ones done, the one it is at and
 * the ones to come.
 */
export function StatusField({ label, tone = 'violet', icon: Icon, spin, steps, at, broken }: {
  label: string; tone?: StatusTone; icon?: typeof Check; spin?: boolean
  steps: string[]; at: number; broken?: boolean // at: the current step's index; at or past the end means all done
}) {
  const id = 'status' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const allDone = at >= steps.length
  return (
    <>
      <button popoverTarget={id} style={{ anchorName: `--${id}` } as CSSProperties} title="Where it stands"
              className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1.5 text-small font-semibold ring-1 ring-inset transition-all hover:shadow-sm ${TONE[tone]}`}>
        {Icon && <Icon className={`size-3.5 ${spin ? 'animate-spin' : ''}`} />}{label}
        <span className="font-medium tabular-nums opacity-60">{Math.min(Math.max(at, 0) + 1, steps.length)}/{steps.length}</span>
        <ChevronDown className="size-3 opacity-50" />
      </button>
      <div id={id} popover="auto" style={{ positionAnchor: `--${id}`, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-inline, flip-block', inset: 'auto' } as CSSProperties}
           className="m-0 mt-1.5 w-60 rounded-2xl border-0 bg-surface-1 p-3 text-fg-2 shadow-xl ring-1 ring-line ">
        <ol className="relative space-y-2.5">
          <span aria-hidden className="absolute bottom-2 left-[9px] top-2 w-px bg-fill-strong" />
          {steps.map((s, i) => {
            const done = i < at || allDone, current = i === at && !allDone
            return (
              <li key={s} className="relative flex items-center gap-2.5 text-small">
                <span className={`relative flex size-[19px] shrink-0 items-center justify-center rounded-full text-micro font-semibold ${done ? 'bg-accent text-on-accent'
                  : current ? (broken ? 'bg-fail text-white' : 'bg-surface-1 text-accent-text ring-2 ring-accent') : 'bg-fill text-fg-3'}`}>
                  {done ? <Check className="size-2.5" strokeWidth={3.5} /> : current && broken ? <TriangleAlert className="size-2.5" /> : i + 1}
                </span>
                <span className={current ? 'font-semibold text-fg-1 ' : done ? 'text-fg-2 ' : 'text-fg-3'}>{s}</span>
                {current && <span className={`ml-auto text-micro font-medium ${broken ? 'text-fail-text' : 'text-accent-text'}`}>{broken ? 'stuck here' : 'now'}</span>}
              </li>
            )
          })}
        </ol>
      </div>
    </>
  )
}
