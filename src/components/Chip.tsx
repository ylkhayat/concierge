import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useId, type CSSProperties, type ReactNode } from 'react'

// static class names: Tailwind only ships classes it can see in the source
const TONE = {
  // metadata that opens: reads as text, a surface only on hover; colour only when it needs a look
  zinc: 'text-fg-3 hov hover:text-fg-1',
  emerald: 'text-ok hover:bg-ok/10',
  amber: 'bg-wait/10 text-fg-1 hover:bg-wait/15 [&>svg:first-child]:text-wait',
  rose: 'bg-fail/10 text-fg-1 hover:bg-fail/15 [&>svg:first-child]:text-fail',
}

/**
 * One line of status that opens its details on click. Native popover + CSS anchor positioning:
 * click outside or Esc closes it, and it renders in the top layer so nothing clips it.
 */
export function Chip({ icon: Icon, label, tone = 'zinc', pulse, children }: {
  icon: LucideIcon; label: ReactNode; tone?: keyof typeof TONE; pulse?: boolean; children: ReactNode
}) {
  const id = 'chip' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <>
      <button popoverTarget={id} style={{ anchorName: `--${id}` } as CSSProperties}
              className={`group/chip inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-small transition-colors duration-150 ${TONE[tone]}`}>
        <Icon className={`size-3.5 shrink-0 ${pulse ? 'animate-pulse' : ''}`} />
        <span className="tabular-nums">{label}</span>
        <ChevronDown className="size-3 opacity-0 transition-opacity group-hover/chip:opacity-60" />
      </button>
      <div id={id} popover="auto"
           style={{ positionAnchor: `--${id}`, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-inline, flip-block', inset: 'auto' } as CSSProperties}
           className="m-0 mt-1.5 w-80 rounded-2xl border-0 bg-surface-1 p-4 text-fg-2 shadow-xl ring-1 ring-line ">
        {children}
      </div>
    </>
  )
}
