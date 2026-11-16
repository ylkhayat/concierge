import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type TabOption<T extends string> = {
  id: T
  label: ReactNode
  icon?: LucideIcon
  dot?: 'ok' | 'warn' | 'off' // a status beside the label (an account that can't run, a machine that's down)
  title?: string
}

const DOT = { ok: 'bg-ok', warn: 'bg-wait', off: 'bg-fg-4' }

/**
 * The one control for choosing between a few options, everywhere in Settings: a pill that slides to the chosen one.
 * Each option is as wide as its label. `as` says what it is to a screen reader: tabs that switch a view, or a choice
 * that sets a value.
 */
export function Tabs<T extends string>({ value, options, onChange, size = 'md', as = 'radio', label, full }: {
  value: T
  options: TabOption<T>[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  as?: 'tab' | 'radio'
  label: string // what is being chosen, for screen readers
  full?: boolean // stretch to the row's width
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number }>()
  const at = options.findIndex((o) => o.id === value)
  useLayoutEffect(() => {
    const el = box.current?.querySelectorAll<HTMLButtonElement>('[data-tab]')[at]
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : undefined)
  }, [at, options.length, ...options.map((o) => o.id)])
  const pad = size === 'sm' ? 'px-2 py-0.5 text-meta' : 'px-3 py-1 text-small'
  return (
    <div ref={box} role={as === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label}
         className={`relative ${full ? 'flex w-full' : 'inline-flex'} shrink-0 rounded-xl bg-fill p-1`}>
      {pill && <span aria-hidden className="absolute inset-y-1 rounded-lg bg-surface-1 shadow-sm ring-1 ring-black/[0.04] transition-all duration-300 ease-[var(--ease-snappy)] dark:ring-white/[0.06]"
                     style={{ left: pill.left, width: pill.width }} />}
      {options.map((o) => {
        const on = o.id === value
        return (
          <button key={o.id} data-tab type="button" title={o.title} onClick={() => onChange(o.id)}
                  role={as === 'tab' ? 'tab' : 'radio'} {...(as === 'tab' ? { 'aria-selected': on } : { 'aria-checked': on })}
                  className={`relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors ${pad} ${full ? 'flex-1' : ''} ${on ? 'text-fg-1' : 'text-fg-3 hover:text-fg-1'}`}>
            {o.icon && <o.icon className="size-3.5" aria-hidden />}
            {o.label}
            {o.dot && <span aria-hidden className={`size-1.5 rounded-full ${DOT[o.dot]}`} />}
          </button>
        )
      })}
    </div>
  )
}
