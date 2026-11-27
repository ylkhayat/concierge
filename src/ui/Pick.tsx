// The one way to choose among a few things, across the app: a row of pills. One value (radio) or several (each a
// toggle, with a check when on). Long lists use the inline list (PlansWorkspace InlineList); on/off settings use Toggle.
import { Check, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

export type PickOption<T> = { value: T; label: ReactNode; hint?: string; mono?: boolean; disabled?: boolean }

const pill = (on: boolean, mono?: boolean, wrap?: boolean) =>
  `inline-flex ${wrap ? 'min-h-7 py-1 text-left' : 'h-7'} max-w-full items-center gap-1.5 rounded-full px-2.5 text-small transition-colors duration-150 disabled:cursor-default disabled:opacity-40 ${mono ? 'font-mono text-meta' : ''} ${
    on ? 'bg-accent-soft font-medium text-accent-text ring-1 ring-accent/40' : 'bg-fill text-fg-2 hover:bg-fill-strong hover:text-fg-1'}`

/** One pill on its own (a filter, a single toggle): the same look as a Pick's. */
export function PickPill({ on, onClick, children, title, mono, check }: { on: boolean; onClick: () => void; children: ReactNode; title?: string; mono?: boolean; check?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title} className={pill(on, mono)}>
      {check && (on ? <Check className="size-3 shrink-0" /> : <Plus className="size-3 shrink-0 opacity-60" />)}<span className="truncate">{children}</span>
    </button>
  )
}

type One<T> = { multi?: false; value: T | undefined; onChange: (v: T) => void }
type Many<T> = { multi: true; value: T[]; onChange: (next: T[], changed: T, on: boolean) => void }

/** A few options as pills: one chosen, or (multi) any number, each with a check when on and a plus when off. */
export function Pick<T extends string | number>(props: { label: string; options: PickOption<T>[]; className?: string; wrap?: boolean } & (One<T> | Many<T>)) {
  const { label, options, className = '', wrap } = props // wrap: long options (an agent's choices) run onto more lines instead of cutting off
  const isOn = (v: T) => (props.multi ? props.value.includes(v) : props.value === v)
  const click = (v: T) => {
    if (!props.multi) return props.onChange(v)
    const on = !props.value.includes(v)
    props.onChange(on ? [...props.value, v] : props.value.filter((x) => x !== v), v, on)
  }
  return (
    <div role={props.multi ? 'group' : 'radiogroup'} aria-label={label} className={`flex flex-wrap items-center gap-1 ${className}`}>
      {options.map((o) => {
        const on = isOn(o.value)
        return (
          <button key={String(o.value)} type="button" disabled={o.disabled} title={o.hint} onClick={() => click(o.value)}
                  {...(props.multi ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })} className={`${pill(on, o.mono, wrap)} ${wrap ? 'rounded-2xl' : ''}`}>
            {props.multi && (on ? <Check className="size-3 shrink-0" /> : <Plus className="size-3 shrink-0 opacity-60" />)}
            <span className={wrap ? 'min-w-0 break-words' : 'truncate'}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
