import { Check, ChevronDown, TriangleAlert } from 'lucide-react'
import { useId, type CSSProperties, type ReactNode } from 'react'

/**
 * The one header every workspace's detail uses, so the same kind of information always sits in the same place, in
 * three lines: where it is (its parent on the left, the way through its stack on the right), the title with what you
 * can do beside it, and how it stands (one status field, then the chips that open the details). Nothing ever scrolls
 * sideways: lines wrap.
 */
export function DetailHeader({ status, id, parent, nav, context, actions, title, chips, extra, compact, people }: {
  status: ReactNode; id?: ReactNode; context?: ReactNode; actions?: ReactNode
  parent?: ReactNode // where it belongs: a PR's ticket and repo, a ticket's id and Linear state
  nav?: ReactNode // the way through its stack (StackNav)
  title: string; chips?: ReactNode; extra?: ReactNode
  compact?: boolean // on the desk, under its own row: the title on one line, everything a little tighter
  people?: ReactNode // who it waits on: reviewers' faces with their verdicts, at the end of the status line
}) {
  return (
    <header className={`relative rounded-card bg-surface-1/85 shadow-e1 backdrop-blur-xl ${compact ? 'px-3.5 py-2 sm:px-4' : 'px-4 py-3.5 sm:px-5 sm:py-4'}`}>
      {(parent || nav) && (
        <div className={`${compact ? 'mb-1' : 'mb-1.5'} flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-small text-fg-3 [&>span>div:not([popover])]:contents`}>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">{parent}</span>
          {nav && <span className="ml-auto flex min-w-0 max-w-full justify-end">{nav}</span>}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <h1 className={`min-w-0 flex-1 font-semibold text-fg-1 ${compact ? 'line-clamp-2 text-reading leading-snug tracking-[-0.01em] sm:line-clamp-1' : 'line-clamp-3 text-title leading-tight sm:text-display sm:leading-[1.2]'}`} title={title}>{title}</h1>
        {actions && <span className="flex shrink-0 items-center gap-1 pt-0.5">{actions}</span>}
      </div>
      {extra && <div className="mt-1.5">{extra}</div>}
      {/* everything about it on one line that wraps: the chips' own row melts into it */}
      <div className={`${compact ? 'mt-1.5' : 'mt-3'} flex flex-wrap items-center gap-x-1 gap-y-1.5 text-small text-fg-3 [&>div:not([popover])]:contents`}>
        {status}
        {id && <span className="font-mono text-fg-2 ">{id}</span>}
        {context}
        {chips}
        {people && <span className="ml-auto flex items-center">{people}</span>}
      </div>
    </header>
  )
}

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
