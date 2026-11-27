// A card's picture (server/discussions.ts Diagram): Understanding's path through the code, Intent's decision as a
// fork. Drawn in the theme, no diagram library. Pointing at a part (or focusing it) says its detail on the line under
// it, inside the slide: a floating tip would be cut by the carousel.
import { ArrowRight, Check, ChevronRight, CircleDashed, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Diagram } from '../../server/discussions.ts'

const node = 'rounded-ctl px-2 py-1 text-small leading-snug outline-none transition-colors duration-150'

function Detail({ text }: { text?: ReactNode }) {
  return <p className="mt-2 min-h-[2.6em] text-meta leading-snug text-fg-3 line-clamp-2">{text}</p>
}

export function CardDiagram({ d }: { d: Diagram }) {
  const [at, setAt] = useState(0)
  const hover = (i: number) => ({ onMouseEnter: () => setAt(i), onFocus: () => setAt(i), tabIndex: 0 })
  if (d.kind === 'path') {
    const s = d.steps[at] ?? d.steps[0]
    return (
      <div>
        {(d.before || d.after) && (
          <p className="mb-2.5 flex flex-wrap items-center gap-1.5 text-meta">
            <span className="rounded-full bg-fill px-2 py-0.5 text-fg-3 line-through decoration-fg-4/60">{d.before}</span>
            <ArrowRight className="size-3 shrink-0 text-fg-4" />
            <span className="rounded-full bg-[color-mix(in_oklch,var(--lane)_14%,transparent)] px-2 py-0.5 font-medium text-fg-1">{d.after}</span>
          </p>
        )}
        <ol className="flex flex-wrap items-center gap-y-1.5">
          {d.steps.map((x, i) => (
            <li key={i} className="flex items-center">
              {i > 0 && <ChevronRight className="mx-0.5 size-3.5 shrink-0 text-fg-4" aria-hidden />}
              <span {...hover(i)} title={x.file || undefined}
                    className={`${node} flex items-center gap-1.5 ring-1 ${i === at ? 'bg-[color-mix(in_oklch,var(--lane)_12%,transparent)] text-fg-1 ring-[color-mix(in_oklch,var(--lane)_45%,transparent)]' : 'bg-surface-1 text-fg-2 ring-line'}`}>
                <span className="font-mono text-micro tabular-nums text-fg-4">{i + 1}</span>{x.label}
              </span>
            </li>
          ))}
        </ol>
        <Detail text={s && <>{s.file && <code className="mr-1.5 font-mono text-micro text-fg-2">{s.file}</code>}{s.detail}</>} />
      </div>
    )
  }
  // the fork: the problem, then what was chosen (solid), set aside (dashed, crossed) and still open (hollow)
  const branches = [
    { label: d.chosen.label, why: d.chosen.why, kind: 'chosen' as const },
    ...d.setAside.map((x) => ({ label: x.label, why: x.why, kind: 'aside' as const })),
    ...d.open.map((x) => ({ label: x, why: 'Not decided yet.', kind: 'open' as const })),
  ]
  const b = branches[at] ?? branches[0]
  return (
    <div>
      <div className="flex items-stretch gap-3">
        {d.problem && <p className="w-[30%] shrink-0 self-center rounded-ctl bg-fill px-2.5 py-1.5 text-small leading-snug text-fg-1">{d.problem}</p>}
        <ul className="min-w-0 flex-1 space-y-1 border-l border-line-strong pl-0">
          {branches.map((x, i) => (
            <li key={i} className="flex items-center">
              <span className={`h-px w-3 shrink-0 ${x.kind === 'chosen' ? 'bg-[var(--lane)]' : 'border-t border-dashed border-fg-4/60'}`} aria-hidden />
              <span {...hover(i)}
                    className={`${node} flex min-w-0 items-center gap-1.5 ${x.kind === 'chosen' ? 'bg-[color-mix(in_oklch,var(--lane)_14%,transparent)] font-medium text-fg-1 ring-1 ring-[color-mix(in_oklch,var(--lane)_45%,transparent)]'
                      : x.kind === 'aside' ? 'border border-dashed border-line-strong text-fg-3' : 'text-fg-2 ring-1 ring-line'} ${i === at && x.kind !== 'chosen' ? 'bg-hover text-fg-1' : ''}`}>
                {x.kind === 'chosen' ? <Check className="size-3 shrink-0 text-[var(--lane)]" /> : x.kind === 'aside' ? <X className="size-3 shrink-0 text-fg-4" /> : <CircleDashed className="size-3 shrink-0 text-wait-text" />}
                <span className={`truncate ${x.kind === 'aside' ? 'line-through decoration-fg-4/50' : ''}`}>{x.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Detail text={b && <><b className="font-medium text-fg-2">{b.kind === 'chosen' ? 'Chosen: ' : b.kind === 'aside' ? 'Set aside: ' : 'Open: '}</b>{b.why}</>} />
    </div>
  )
}
