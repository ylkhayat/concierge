import { GitPullRequest, ListTodo, SearchCheck, Layers, LoaderCircle, MessagesSquare, Bot, Wrench, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api } from '../lib.ts'
import { useApi } from '../query.ts'
import { useDraft } from '../draft.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { Kbd, secondary } from './PrDetail.tsx'
import { Missing } from './Missing.tsx'

type Scope = 'this' | 'stack' | 'all'
type Action = { id: string; group: string; label: string; hint: string; confirm?: string; missing?: string[]; counts: Partial<Record<Scope, number>> }
const GROUP_ICON: Record<string, LucideIcon> = { 'Pull request': GitPullRequest, Stack: Layers, crit: MessagesSquare, Agent: Bot, Ticket: ListTodo, Investigate: SearchCheck }

/**
 * Everything you can do around this PR, by context. Each row runs on this PR, its whole stack, or every PR
 * it fits at once (the numbers say how many), so a batch never needs picking PRs one by one. `.` opens it.
 */
export function Tools({ base, toast, noun = 'PR', allOf = 'every PR it fits', inline, version, steer }: {
  base: string // `/prs/<id>` or `/exec/tickets/<id>`: the menu is GET, a run is POST, on `${base}/actions`
  toast: (m: string, tone?: 'ok' | 'error') => void; noun?: string; allOf?: string
  inline?: boolean // listed in place (the Next panel's footer) instead of a button and a popover
  version?: string // changes when the PR or ticket does, so an inline list re-reads what applies
  steer?: boolean // a note for the agent, sent with whichever action starts a run (a ticket's)
}) {
  const [note, setNote] = useDraft(`note:${base}`)
  // one cached list per PR or ticket and its version, shared with the / menu (ui/Slash.tsx); the popover reads it on opening
  const [wanted, setWanted] = useState(!!inline)
  const q = useApi<Action[]>(wanted ? `${base}/actions?v=${encodeURIComponent(version ?? '')}` : undefined)
  const actions = q.data ?? (q.isError ? [] : undefined)
  const [running, setRunning] = useState<string>()
  const { armed, arm } = useArm()
  const disarm = () => armed && arm(armed, () => {}) // the second click spends the arm
  const pop = useRef<HTMLDivElement>(null)
  const load = () => { setWanted(true); void q.refetch() }

  useEffect(() => {
    if (inline) return
    const el = pop.current!
    const onToggle = (e: Event) => { if ((e as ToggleEvent).newState === 'open') setWanted(true) }
    el.addEventListener('toggle', onToggle)
    return () => el.removeEventListener('toggle', onToggle)
  }, [base, inline, version])
  useEffect(() => {
    if (inline) return
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '.' && !e.metaKey && !e.ctrlKey && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)) { e.preventDefault(); pop.current?.togglePopover() }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])

  const go = (a: Action, scope: Scope) => {
    // actions that push, post or start runs ask for a second click on the same button, not an alert
    if (a.confirm && armed !== `${a.id}:${scope}`) return arm(`${a.id}:${scope}`, () => {})
    disarm()
    setRunning(`${a.id}:${scope}`)
    api(`${base}/actions`, { action: a.id, scope, ...(steer && note.trim() && { note: note.trim() }) }).then(
      (r: { label: string; count: number }) => { toast(`${r.label}: ${r.count === 1 ? 'started' : `started on ${r.count}`}${steer && note.trim() ? ', with your note' : ''}`); setNote(''); load() },
      (e: Error) => toast(e.message, 'error'),
    ).finally(() => setRunning(undefined))
  }

  const groups = [...new Set(actions?.map((a) => a.group))]
  const list = (
    <>
        {steer && (
          <label className="mb-1.5 block px-1">
            <span className="mb-1 block text-small font-semibold text-fg-3">Note for the agent</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional: steer whichever you start, e.g. “only look at the last 24 h”"
                      className="w-full resize-y rounded-xl bg-surface-1 px-2.5 py-1.5 text-small ring-1 ring-line-strong outline-none placeholder:text-fg-3 focus:ring-accent" />
          </label>
        )}
        {!actions ? <p className="flex items-center gap-2 p-3 text-small text-fg-3"><LoaderCircle className="size-4 animate-spin" />Loading…</p> : <div className={inline ? "space-y-1" : "gap-2 md:columns-2"}>{groups.map((g) => {
          const Icon = GROUP_ICON[g] ?? (g.startsWith('PR #') ? GitPullRequest : Wrench)
          return (
            <section key={g} className="mb-1 break-inside-avoid rounded-xl py-1">
              <h4 className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-small font-semibold text-fg-3"><Icon className="size-3.5" />{g}</h4>
              {actions.filter((a) => a.group === g).map((a) => {
                const any = Object.values(a.counts).some(Boolean) && !a.missing?.length
                return (
                  <div key={a.id} className={`group/row flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-hover ${any || a.missing?.length ? '' : 'opacity-45'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-medium">{a.label}</div>
                      {a.missing?.length ? <Missing names={a.missing} className="mt-0.5" /> : <div className="line-clamp-2 text-meta leading-snug text-fg-3">{a.hint}</div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {(['this', 'stack', 'all'] as const).filter((s) => s in a.counts).map((s) => {
                        const n = a.counts[s] ?? 0
                        const busy = running === `${a.id}:${s}`
                        return (
                          <button key={s} disabled={!n || !!running || !!a.missing?.length} onClick={() => go(a, s)}
                                  title={n ? `Run on ${s === 'this' ? `this ${noun.toLowerCase()}` : s === 'stack' ? `the stack (${n})` : `${allOf} (${n})`}` : `Nothing to do for ${s === 'this' ? `this ${noun.toLowerCase()}` : s === 'stack' ? 'this stack' : allOf}`}
                                  className={`relative inline-flex items-center gap-1 rounded-lg px-2 py-1 text-meta font-medium ${armed === `${a.id}:${s}` ? 'isolate overflow-hidden font-semibold !text-accent-text !ring-accent' : ''} text-fg-2 ring-1 ring-line-strong transition-all hover:text-accent-text hover:ring-accent disabled:pointer-events-none disabled:opacity-35`}>
                            {busy && <LoaderCircle className="size-3 animate-spin" />}
                            {armed === `${a.id}:${s}` ? <ArmLabel>Confirm</ArmLabel> : s === 'this' ? 'This' : s === 'stack' ? 'Stack' : 'All'}
                            {s !== 'this' && armed !== `${a.id}:${s}` && <span className="tabular-nums text-fg-3">{n}</span>}{armed === `${a.id}:${s}` && <ArmBar on="plain" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}</div>}
    </>
  )
  if (inline) return <div className="-mx-2">{list}</div>
  return (
    <>
      <button popoverTarget="tools" className={secondary} style={{ anchorName: '--tools' } as CSSProperties} title={`Tools for this ${noun.toLowerCase()}, its stack, or all of them`}>
        <Wrench className="size-4 transition-transform duration-300 group-hover/btn:-rotate-12" />Tools<Kbd k="." />
      </button>
      <div id="tools" ref={pop} popover="auto"
           style={{ positionAnchor: '--tools', positionArea: 'bottom span-right', positionTryFallbacks: 'flip-inline, flip-block', inset: 'auto' } as CSSProperties}
           className="m-0 mt-1.5 max-h-[calc(70vh/var(--z))] w-[min(860px,calc(100vw/var(--z)-32px))] overflow-y-auto rounded-2xl border-0 bg-surface-1 p-2 text-fg-2 shadow-xl ring-1 ring-line ">
        {list}
      </div>
    </>
  )
}
