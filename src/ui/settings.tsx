// What a page of settings is made of: a titled group of rows, a row with its control, a labelled setting, the switch,
// and the few button and field looks the pages share. Settings, the setup and the status bar's chips all take them
// from here, so none of them has to import a 2,000-line page to draw a switch.
import { Check, ChevronDown, Info, type LucideIcon } from 'lucide-react'
import { useId, type CSSProperties, type ReactNode } from 'react'
import { Tabs } from '../components/Tabs.tsx'

export function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <header className="px-0.5">
        <h3 className="text-small font-semibold text-fg-1 ">{title}</h3>
        {hint && <p className="text-meta text-fg-3">{hint}</p>}
      </header>
      <div className="divide-y divide-line overflow-hidden card ">{children}</div>
    </section>
  )
}

/** An (i) beside a setting: what it is and what it changes, in a few lines, on hover or click. */
export function More({ children }: { children: ReactNode }) {
  const id = 'more' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <>
      <button popoverTarget={id} style={{ anchorName: `--${id}` } as CSSProperties} aria-label="What is this?" className="inline-flex align-[-2px] text-fg-4 transition-colors hover:text-accent-text"><Info className="size-3.5" /></button>
      <div id={id} popover="auto" style={{ positionAnchor: `--${id}`, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-block, flip-inline', inset: 'auto' } as CSSProperties}
           className="m-0 mt-1.5 w-72 rounded-ctl border-0 bg-surface-2 p-3 text-small leading-relaxed text-fg-2 shadow-e3">{children}</div>
    </>
  )
}

export function Row({ icon: Icon, title, hint, more, children }: { icon: LucideIcon; title: string; hint?: ReactNode; more?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-ctl bg-fill text-fg-3"><Icon className="size-3.5" aria-hidden /></span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-center gap-1.5 text-small font-medium">{title}{more && <More>{more}</More>}</div>
        {hint && <div className="text-meta leading-snug text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
            className={`relative h-[22px] w-9 shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-accent' : 'bg-fill-strong'}`}>
      <span className={`absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all duration-300 ease-[var(--ease-snappy)] ${on ? 'left-[17px]' : 'left-[3px]'}`} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label = 'Choose' }: { value: T; options: { id: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void; label?: string }) {
  return <Tabs value={value} options={options} onChange={onChange} label={label} />
}

export const input = 'field'

export const primary = 'inline-flex shrink-0 items-center gap-1.5 btn-primary'

export const quiet = 'inline-flex shrink-0 items-center gap-1.5 btn-outline'

/** One setting of a list: its name on the left, its control beside it, a line on what it does under the control. */
export function Setting({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[8.5rem_1fr] sm:items-start">
      <span className="pt-1 text-small font-medium text-fg-2">{label}</span>
      <div className="min-w-0 space-y-1">{children}{hint && <p className="text-meta text-fg-4">{hint}</p>}</div>
    </div>
  )
}

/** Any of several: each option a checkbox you can see is one, so it never reads as a single choice. */
export function Checks<T extends string>({ label, value, options, onToggle }: { label: string; value: T[]; options: { value: T; label: ReactNode; sub?: string; locked?: string }[]; onToggle: (v: T, on: boolean) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <label key={o.value} title={o.locked} className={`inline-flex items-center gap-2 text-small ${o.locked ? 'text-fg-3' : 'cursor-pointer text-fg-1'}`}>
            <input type="checkbox" checked={on} disabled={!!o.locked} onChange={(e) => onToggle(o.value, e.target.checked)} className="peer sr-only" />
            <span aria-hidden className={`flex size-4 shrink-0 items-center justify-center rounded-[5px] ring-1 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${on ? 'bg-accent text-on-accent ring-accent' : 'bg-surface-1 ring-line-strong'}`}>{on && <Check className="size-3" strokeWidth={3} />}</span>
            {o.label}{o.sub && <span className="text-meta text-fg-4">{o.sub}</span>}
          </label>
        )
      })}
    </div>
  )
}

/** One of many: a dropdown, for a choice with more options than fit a segmented control. */
export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="relative inline-flex">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="field appearance-none py-1 pl-2.5 pr-8 text-small">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
    </span>
  )
}
