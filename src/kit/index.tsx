// The kit: the only place a control's look is decided. Screens compose these and never style a button, chip, tab or
// card themselves, so every screen reads as one product. Built from the tokens (src/design/tokens.css) alone.
import { Check, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'neutral' | 'accent' | 'ok' | 'wait' | 'run' | 'fail'
const DOT: Record<Tone, string> = { neutral: 'bg-fg-4', accent: 'bg-accent', ok: 'bg-ok', wait: 'bg-wait', run: 'bg-run', fail: 'bg-fail' }
const SOFT: Record<Tone, string> = {
  neutral: 'bg-fill text-fg-2', accent: 'bg-accent-soft text-accent-text', ok: 'bg-ok/12 text-ok-text',
  wait: 'bg-wait/14 text-wait-text', run: 'bg-run/12 text-run-text', fail: 'bg-fail/12 text-fail-text',
}

/** A button: `primary` is the one action a view wants from you, `quiet` everything else, `ghost` inside dense rows. */
export function Button({ kind = 'quiet', icon: Icon, children, onClick, disabled, title }: {
  kind?: 'primary' | 'quiet' | 'ghost'; icon?: LucideIcon; children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string
}) {
  const look = kind === 'primary' ? 'bg-accent text-on-accent shadow-e1 hover:bg-accent-hover'
    : kind === 'quiet' ? 'bg-surface-1 text-fg-1 shadow-e1 hover:bg-hover' : 'text-fg-3 hover:bg-hover hover:text-fg-1'
  return (
    <button onClick={onClick} disabled={disabled} title={title}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-ctl px-3 text-small font-medium transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${look}`}>
      {Icon && <Icon className="size-3.5" />}{children}
    </button>
  )
}

/** A status, always a dot and words: never colour alone. */
export function Status({ tone = 'neutral', children, pulse }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-meta font-medium ${SOFT[tone]}`}><span className={`size-1.5 rounded-full ${DOT[tone]} ${pulse ? 'animate-pulse' : ''}`} />{children}</span>
}

/** A small fact beside a title: a ticket id, a count, a branch. */
export const Tag = ({ children, mono }: { children: ReactNode; mono?: boolean }) =>
  <span className={`inline-flex h-5 items-center rounded-md bg-fill px-1.5 text-micro text-fg-2 ${mono ? 'font-mono' : 'font-medium'}`}>{children}</span>

/** The tabs of a page: one row, the current one underlined; a count says something waits there. */
export function Tabs<Id extends string>({ tabs, value, onChange }: { tabs: { id: Id; label: string; count?: number }[]; value: Id; onChange: (id: Id) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line px-6">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
                className={`-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-small font-medium transition-colors ${value === t.id ? 'border-accent text-fg-1' : 'border-transparent text-fg-3 hover:text-fg-1'}`}>
          {t.label}{!!t.count && <span className="rounded-full bg-wait/15 px-1.5 text-micro font-semibold tabular-nums text-wait-text">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A choice between a few views of the same thing. */
export function Segmented<Id extends string>({ options, value, onChange, label }: { options: { id: Id; label: string }[]; value: Id; onChange: (id: Id) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-ctl bg-fill p-0.5">
      {options.map((o) => <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
                                  className={`h-7 rounded-[calc(var(--radius-ctl)-2px)] px-2.5 text-small font-medium transition-colors ${value === o.id ? 'bg-surface-1 text-fg-1 shadow-e1' : 'text-fg-3 hover:text-fg-1'}`}>{o.label}</button>)}
    </div>
  )
}

/** A surface for one subject, with an optional title row. */
export function Card({ title, aside, children }: { title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || aside) && <div className="flex items-center gap-2 border-b border-line px-4 py-2.5"><h3 className="min-w-0 flex-1 truncate text-small font-semibold text-fg-1">{title}</h3>{aside}</div>}
      <div className="p-4">{children}</div>
    </section>
  )
}

/** A step you tick: the same row wherever a checklist appears. */
export function CheckRow({ on, onChange, children, note, tags }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; note?: string; tags?: ReactNode }) {
  return (
    <button role="checkbox" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-start gap-2.5 rounded-ctl px-2 py-1.5 text-left transition-colors hover:bg-hover">
      <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded ${on ? 'bg-accent text-on-accent' : 'ring-1 ring-line-strong'}`}>{on && <Check className="size-3" strokeWidth={3} />}</span>
      <span className="min-w-0 flex-1">
        <span className={`text-small ${on ? 'text-fg-1' : 'text-fg-3'}`}>{children}</span>{tags && <span className="ml-1.5 inline-flex gap-1 align-middle">{tags}</span>}
        {note && <span className="block text-meta text-fg-3">{note}</span>}
      </span>
    </button>
  )
}

/**
 * The dock: the one place a page says what it needs from you, pinned to the bottom of every tab. Closed it is one
 * line; open it holds the steps, the decisions and the box you answer in.
 */
export function Dock({ tone, title, summary, open, onToggle, children }: { tone: Tone; title: string; summary?: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <div className="border-t border-line bg-bg-app px-6 pb-4 pt-3">
      <div className="mx-auto max-w-[860px] rounded-2xl bg-surface-1 shadow-e2">
        <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
          <span className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
          <span className="shrink-0 text-small font-semibold text-fg-1">{title}</span>
          <span className="min-w-0 flex-1 truncate text-small text-fg-3">{summary}</span>
          <span className="shrink-0 text-meta font-medium text-accent-text">{open ? 'Hide' : 'Open'}</span>
        </button>
        {open && <div className="max-h-[46vh] overflow-y-auto border-t border-line px-4 py-3">{children}</div>}
      </div>
    </div>
  )
}

/** A text box, one look everywhere. */
export const Field = ({ value, onChange, placeholder, rows = 2 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) =>
  <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder}
            className="w-full resize-none rounded-xl bg-fill/60 px-3 py-2 text-body text-fg-1 outline-none ring-1 ring-line transition-shadow placeholder:text-fg-3 hover:ring-line-strong focus:bg-surface-1 focus:ring-2 focus:ring-accent/60" />

/** One row of a list of work: what it is, where it stands, when. */
export function ListRow({ on, onClick, title, meta, tone, pulse }: { on?: boolean; onClick?: () => void; title: string; meta: ReactNode; tone: Tone; pulse?: boolean }) {
  return (
    <button onClick={onClick} aria-current={on} className={`flex w-full items-start gap-2.5 border-l-2 px-4 py-2.5 text-left transition-colors ${on ? 'border-accent bg-accent-soft/50' : 'border-transparent hover:bg-hover/60'}`}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[tone]} ${pulse ? 'animate-pulse' : ''}`} />
      <span className="min-w-0 flex-1"><span className="line-clamp-2 text-small font-medium text-fg-1">{title}</span><span className="mt-0.5 flex items-center gap-2 text-meta text-fg-3">{meta}</span></span>
    </button>
  )
}

/** A heading over a group of rows in a list. */
export const ListGroup = ({ label, count }: { label: string; count: number }) =>
  <p className="flex items-center gap-2 px-4 pb-1 pt-4 label text-fg-4">{label}<span className="font-normal tabular-nums">{count}</span></p>
