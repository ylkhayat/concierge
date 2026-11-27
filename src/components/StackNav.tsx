import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, GitPullRequest, Layers, MessageSquare, SquareKanban } from 'lucide-react'
import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import type { Linked } from '../../server/index.ts'
import { isTyping } from '../lib.ts'
import { DOT, STATE, type Me } from './Linked.tsx'

/** One place in a stack: a PR (or the ticket a desk unit is about), how it stands, and its agent. */
export type NavItem = {
  id: string; kind: 'pr' | 'ticket'; ref: string; title: string
  url?: string // on GitHub or Linear: the ↗ on its row
  dot: string; state: string // its status as a colour and in words (CI, review state)
  threads?: number
  linked?: Linked // its agent, for the hand-over card on its row
}

// a PR title without its conventional-commit prefix and the ticket id every PR of the stack repeats
export const plain = (t: string) => t.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/^[A-Z]{2,5}-\d+\s+/, '')

/**
 * The one way through a stack, in every header: ‹ › step through it (and [ ]), the label says where you are, and ▾
 * opens the whole stack as a list with how each one stands. Without `current` (a ticket, which is not one of its PRs)
 * it is just the list behind "8 PRs ▾". Rows open here; ↗ opens GitHub (or Linear).
 */
export function StackNav({ items, current, onOpen, me, toast, keys, noun = 'PR' }: {
  items: NavItem[]; current?: string; onOpen: (x: NavItem) => void
  me?: Me; toast?: (m: string, tone?: 'ok' | 'error') => void // for the hand-over card on each row
  keys?: boolean // [ and ] step through it (one stepper per page takes them)
  noun?: string
}) {
  const id = 'stack' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const at = current ? items.findIndex((x) => x.id === current) : -1
  const prev = at > 0 ? items[at - 1] : undefined, next = at >= 0 && at < items.length - 1 ? items[at + 1] : undefined
  const pop = useRef<HTMLDivElement>(null)
  const go = (x?: NavItem) => { if (!x) return; pop.current?.hidePopover(); onOpen(x) }
  useEffect(() => {
    if (!keys || at < 0) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || document.querySelector('dialog[open]')) return
      if (e.key === '[' && prev) { e.preventDefault(); go(prev) }
      if (e.key === ']' && next) { e.preventDefault(); go(next) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, at, prev?.id, next?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null
  const here = at >= 0 ? items[at] : undefined
  const arrow = 'rounded-md p-0.5 text-fg-3 transition-colors hov hover:text-fg-1 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
      {here && <button onClick={() => go(prev)} disabled={!prev} className={arrow} aria-label="Down the stack" title={prev ? `${prev.ref} ${plain(prev.title)} ([)` : 'The bottom of the stack'}><ChevronLeft className="size-4" /></button>}
      {/* the stack as a line: a stop per PR, bottom to top, in its status colour; the one you are on is larger and named */}
      {here && items.length <= 14 && (
        <span className="flex items-center px-1" role="list" aria-label="The stack, bottom to top">
          {items.map((x, i) => {
            const on = i === at, wait = /bg-wait|bg-amber/.test(x.dot), run = /bg-run|bg-blue/.test(x.dot)
            return (
              <span key={x.id} role="listitem" className="flex items-center">
                {i > 0 && <span className={`h-px w-2.5 ${i <= at ? 'bg-fg-4' : 'bg-line-strong'}`} />}
                <button onClick={() => go(x)} title={`${x.ref} ${plain(x.title)} · ${x.state}`} aria-current={on}
                        className={`group/stop relative flex items-center justify-center rounded-full transition-transform duration-150 ${on ? '' : 'hover:scale-125'}`}>
                  <span className={`block rounded-full ${on ? 'size-3 ring-2 ring-accent/35 ring-offset-1 ring-offset-surface-1' : 'size-2'} ${wait && !on ? 'bg-transparent ring-[1.5px] ring-wait' : x.dot} ${run ? 'animate-pulse' : ''}`} />
                </button>
              </span>
            )
          })}
        </span>
      )}
      <button popoverTarget={id} style={{ anchorName: `--${id}` } as CSSProperties} title={here ? `${here.ref} ${here.title} · the whole stack` : 'The stack, bottom to top'}
              className="group inline-flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-small text-fg-2 transition-colors hov hover:text-fg-1">
        {!here && <Layers className="size-3.5 shrink-0 text-accent-text" />}
        {here ? (
          <>
            <span className="shrink-0 font-mono font-semibold">{here.ref}</span>
            <span className="shrink-0 tabular-nums text-fg-4">{at + 1}/{items.length}</span>
          </>
        ) : <span className="font-medium">{items.length} {noun}{items.length === 1 ? '' : 's'}</span>}
        <ChevronDown className="size-3.5 shrink-0 text-fg-4" />
      </button>
      {here && <button onClick={() => go(next)} disabled={!next} className={arrow} aria-label="Up the stack" title={next ? `${next.ref} ${plain(next.title)} (])` : 'The top of the stack'}><ChevronRight className="size-4" /></button>}
      <div ref={pop} id={id} popover="auto" style={{ positionAnchor: `--${id}`, positionArea: 'bottom span-left', positionTryFallbacks: 'flip-inline, flip-block', inset: 'auto' } as CSSProperties}
           className="m-0 mt-1.5 max-h-[calc(70vh/var(--z))] w-[min(460px,calc(100vw/var(--z)-24px))] overflow-y-auto rounded-2xl border-0 bg-surface-1 p-1.5 text-fg-2 shadow-xl ring-1 ring-line ">
        <List items={items} at={at} onOpen={go} me={me} toast={toast} />
      </div>
    </span>
  )
}

/** The stack, bottom to top: ↑/↓ move, Enter opens. */
function List({ items, at, onOpen, me, toast }: { items: NavItem[]; at: number; onOpen: (x: NavItem) => void; me?: Me; toast?: (m: string, tone?: 'ok' | 'error') => void }) {
  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-row]')]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus() }
  }
  return (
    <ul onKeyDown={move} className="space-y-0.5">
      <li className="px-2 pb-1 pt-0.5 text-small font-semibold text-fg-3">Bottom</li>
      {items.map((x, i) => {
        const on = i === at
        const Icon = x.kind === 'ticket' ? SquareKanban : GitPullRequest
        return (
          <li key={x.id}>
            <div className={`group flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors ${on ? 'bg-accent/10 ring-1 ring-accent/25' : 'hover:bg-hover'}`}>
              <span className="w-4 shrink-0 text-right text-micro tabular-nums text-fg-3">{i + 1}</span>
              <button data-row autoFocus={on} onClick={() => onOpen(x)} title={`${x.title} · ${x.state}`} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none">
                <span className={`size-2 shrink-0 rounded-full ${x.dot}`} title={x.state} />
                <Icon className="size-3.5 shrink-0 text-fg-3" />
                <span className={`shrink-0 font-mono text-small font-semibold ${on ? 'text-accent-text' : ''}`}>{x.ref}</span>
                <span className="min-w-0 flex-1 truncate text-small text-fg-2 group-hover:text-fg-1">{plain(x.title)}</span>
              </button>
              {!!x.threads && <span className="inline-flex shrink-0 items-center gap-0.5 text-meta tabular-nums text-wait-text" title={`${x.threads} open thread${x.threads === 1 ? '' : 's'}`}><MessageSquare className="size-3" />{x.threads}</span>}
              {x.linked && x.linked.agent !== 'none' && <span className={`size-1.5 shrink-0 rounded-full ${DOT[x.linked.agent]}`} title={STATE[x.linked.agent]} />}
              {x.url && <a href={x.url} target="_blank" rel="noreferrer" title={x.kind === 'ticket' ? 'Open in Linear' : 'Open on GitHub'} className="shrink-0 rounded-md p-0.5 text-fg-3 opacity-0 transition-opacity hover:text-fg-1 group-hover:opacity-100"><ArrowUpRight className="size-3.5" /></a>}
            </div>
          </li>
        )
      })}
      <li className="px-2 pt-1 text-small font-semibold text-fg-3">Top</li>
    </ul>
  )
}
