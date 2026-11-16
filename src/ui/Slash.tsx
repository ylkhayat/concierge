// Slash commands in the composer: typing `/` lists what can be done here (the next step, every tool, the views),
// filtered as you type; ↑↓ to move, Enter to run, Esc to close. A command that pushes, posts or starts something on
// several asks for Enter a second time.
import { CornerDownLeft } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '../lib.ts'
import { useApi } from '../query.ts'

export type Command = {
  id: string
  label: string
  group: string // the heading it sits under: Next, Read, Tools…
  hint?: string
  confirm?: boolean // asks for Enter a second time
  run: () => unknown
}

/** A command's name as typed after the slash: /smart-rebase. */
export const slug = (label: string) => label.toLowerCase().replace(/[:(].*$/, '').replace(/#\d+/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-')
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()

/** The menu's state for a composer's text: open while it starts with `/`; its key handler says whether it took the key. */
export function useSlash(commands: Command[] | undefined, text: string, clear: () => void) {
  const query = commands && /^\/\S*( \S*)*$/.test(text) && !text.includes('\n') ? norm(text.slice(1)) : null
  const items = useMemo(() => (query === null ? [] : commands!.filter((c) => { const words = norm(`${c.label} ${c.hint ?? ''}`).split(' '); return !query || query.split(' ').every((q) => words.some((w) => w.startsWith(q))) })), [commands, query])
  const [at, setAt] = useState(0)
  const [armed, setArmed] = useState<string>()
  const [closed, setClosed] = useState(false)
  useEffect(() => { setAt(0); setArmed(undefined); setClosed(false) }, [query])
  const open = query !== null && !closed

  const pick = (c: Command) => {
    if (c.confirm && armed !== c.id) return setArmed(c.id)
    setArmed(undefined); clear(); void c.run()
  }
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open || !items.length) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length); setArmed(undefined); return true }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pick(items[Math.min(at, items.length - 1)]); return true }
    if (e.key === 'Escape') { e.preventDefault(); setClosed(true); return true }
    return false
  }
  // the menu floats in the page's top layer, anchored above the box (the box's own frame may be short and scroll, which
  // would cut it off): the box's wrapper takes `anchor` as its style
  const name = `--slash-${useId().replace(/[^\w-]/g, '')}`
  const menu = open ? <Floating anchor={name}><SlashMenu items={items} at={Math.min(at, items.length - 1)} armed={armed} onPick={pick} onHover={setAt} /></Floating> : null
  return { open, onKeyDown, menu, anchor: { anchorName: name } as CSSProperties }
}

/** In the top layer (a popover), above its anchor and as wide: shown while it is mounted. */
function Floating({ anchor, children }: { anchor: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { const el = ref.current; try { el?.showPopover() } catch { /* shown */ } return () => { try { el?.hidePopover() } catch { /* gone */ } } }, [])
  return (
    <div ref={ref} popover="manual" style={{ positionAnchor: anchor, positionArea: 'top span-all', width: 'anchor-size(width)', inset: 'auto', margin: 0, marginBottom: 8, background: 'transparent', border: 0, padding: 0, overflow: 'visible' } as CSSProperties}>
      {children}
    </div>
  )
}

function SlashMenu({ items, at, armed, onPick, onHover }: { items: Command[]; at: number; armed?: string; onPick: (c: Command) => void; onHover: (i: number) => void }) {
  if (!items.length) return <div className={FRAME}><p className="px-3 py-2.5 text-small text-fg-3">No action matches. Esc closes; anything else is sent to the agent as words.</p></div>
  let last = ''
  const rows: ReactNode[] = []
  items.forEach((c, i) => {
    if (c.group !== last) { last = c.group; rows.push(<li key={`g:${c.group}`} role="presentation" className="px-3 pb-1 pt-2.5 label text-fg-4">{c.group}</li>) }
    const on = i === at
    rows.push(
      <li key={c.id} role="option" aria-selected={on}>
        {/* the pointer picks without taking focus from the box */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(c) }} onMouseEnter={() => onHover(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left ${on ? 'bg-hover' : ''}`}>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2"><span className="truncate text-body font-medium text-fg-1">{c.label}</span><span className="shrink-0 font-mono text-micro text-fg-4">/{slug(c.label)}</span></span>
            {c.hint && <span className="block truncate text-meta text-fg-3">{c.hint}</span>}
          </span>
          {armed === c.id ? <span className="shrink-0 rounded-md bg-wait/15 px-1.5 py-0.5 text-meta font-semibold text-wait">Enter again to confirm</span>
            : on && <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-fg-4" />}
        </button>
      </li>,
    )
  })
  return <ul role="listbox" aria-label="Actions" className={FRAME}>{rows}</ul>
}
const FRAME = 'max-h-[min(360px,50vh)] overflow-y-auto rounded-2xl bg-surface-1 p-1 shadow-[var(--e3)] ring-1 ring-line'

type ToolAction = { id: string; group: string; label: string; hint: string; confirm?: string; missing?: string[]; counts: Partial<Record<'this' | 'stack' | 'all', number>> }

/** The tools of a PR or ticket (the same list as the Tools menu), as commands: one per scope that has something to do. */
export function useToolCommands(base: string, version: string, toast: (m: string, tone?: 'ok' | 'error') => void, noun: string): Command[] {
  const actions = useApi<ToolAction[]>(`${base}/actions?v=${encodeURIComponent(version)}`).data ?? []
  return actions.filter((a) => !a.missing?.length).flatMap((a) => (['this', 'stack', 'all'] as const).filter((s) => a.counts[s]).map((s) => ({
    id: `tool:${a.id}:${s}`, group: a.group, confirm: !!a.confirm,
    label: s === 'this' ? a.label : `${a.label}: ${s === 'stack' ? 'the stack' : 'all'} (${a.counts[s]})`,
    hint: s === 'this' ? a.hint : `On ${s === 'stack' ? 'every PR in the stack' : `every ${noun} it fits`}. ${a.hint}`,
    run: () => api(`${base}/actions`, { action: a.id, scope: s }).then((r: { label: string; count: number }) => toast(`${r.label}: ${r.count === 1 ? 'started' : `started on ${r.count}`}`), (e: Error) => toast(e.message, 'error')),
  })))
}
