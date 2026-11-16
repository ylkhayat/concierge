import { Clock, CornerDownLeft, GitPullRequest, Keyboard, ListTodo, Search, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isTyping, type PrView, type TicketView } from '../lib.ts'

export type Command = { id: string; label: string; hint?: string; run: () => void }
type Entry = { key: string; icon: typeof Search; ref?: string; label: string; hint?: string; group: string; run: () => void }

// every key the app answers to, for the ? sheet (keep in step with App.tsx, Desk.tsx, PrDetail.tsx and NextSteps.tsx)
const KEYS: [string, string][] = [
  ['⌘K', 'Jump anywhere, run a command'], ['?', 'These shortcuts'],
  ['g d · g r · g e · g s · g c', 'Desk, Review, Ship, Standup, Codebase'], ['g', 'Open the PR on GitHub (alone)'],
  ['j / k', 'Next and previous in the list'], ['/', 'Filter the list'], ['Esc', 'Clear the filter, close'],
  ['n / p', 'Next and previous unit on the desk'], ['d', 'Open the PR on the desk'],
  ['o', 'Open crit'], ['r', 'Resume the agent session in Terminal'], ['f', 'Focus while reading an explanation'],
  ['⌘↵', 'Send to the agent'], ['Alt ↑ / ↓', 'Move an account in the fallback order'],
]

const RECENT = 'palette:recent'
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[] } catch { return [] } }
const remember = (key: string) => { try { localStorage.setItem(RECENT, JSON.stringify([key, ...recent().filter((k) => k !== key)].slice(0, 6))) } catch { /* private window */ } }

/** How well an entry matches: an id or number typed exactly first, then one that starts with it, a title that does, then anywhere. */
function score(e: Entry, words: string[]): number {
  const ref = (e.ref ?? '').toLowerCase().replace('#', ''), label = e.label.toLowerCase()
  const s = `${ref} ${label} ${(e.hint ?? '').toLowerCase()}`
  if (!words.every((w) => s.includes(w))) return 0
  const first = (words[0] ?? '').replace('#', '')
  return ref && ref === first ? 4 : ref && ref.startsWith(first) ? 3 : label.startsWith(words[0] ?? '') ? 2 : 1
}

/**
 * ⌘K: jump to any PR or ticket, or run a command, by typing a few letters of it; with nothing typed, what you opened
 * last and the commands. Every word typed must appear in the entry (number, id, title, repo), in any order. ? lists
 * every shortcut.
 */
export function Palette({ prs, tickets, commands, onPr, onTicket }: {
  prs: PrView[]; tickets: TicketView[]; commands: Command[]
  onPr: (id: string) => void; onTicket: (id: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  useEffect(() => {
    const show = (text: string) => { setQ(text); setAt(0); dialog.current!.showModal() }
    const k = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (dialog.current!.open) dialog.current!.close(); else show('') }
      else if (e.key === '?' && !isTyping(e) && !dialog.current!.open) { e.preventDefault(); show('?') }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])

  const all: Entry[] = [
    ...commands.map((c) => ({ key: `c:${c.id}`, icon: Zap, label: c.label, hint: c.hint, group: 'Commands', run: c.run })),
    ...prs.filter((p) => !p.closed).map((p) => ({ key: p.id, icon: GitPullRequest, ref: `#${p.number}`, label: p.title, hint: `${p.repo.split('/')[1]} · ${p.mine ? 'yours' : p.author.login}`, group: 'Pull requests', run: () => onPr(p.id) })),
    ...tickets.map((t) => ({ key: t.id, icon: ListTodo, ref: t.id, label: t.title, hint: t.state, group: 'Tickets', run: () => onTicket(t.id) })),
  ]
  const keys = q.trimStart().startsWith('?')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hits: Entry[] = keys ? [] : words.length
    ? all.map((e) => [e, score(e, words)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([e]) => e).slice(0, 50)
    // nothing typed: what you opened last, then the commands
    : [...recent().map((k) => all.find((e) => e.key === k)).filter((e): e is Entry => !!e).map((e) => ({ ...e, group: 'Recent', icon: e.icon === Zap ? Zap : Clock })), ...all.filter((e) => e.group === 'Commands')]
  const pick = (e?: Entry) => { if (!e) return; remember(e.key); dialog.current!.close(); e.run() }

  return (
    <dialog ref={dialog} onClick={(e) => e.target === dialog.current && dialog.current!.close()}
            className="palette m-auto mt-[calc(12vh/var(--z))] w-[min(640px,calc(100vw/var(--z)-32px))] overflow-hidden rounded-card bg-surface-1 p-0 text-fg-1 shadow-e3 backdrop:bg-zinc-950/30 backdrop:backdrop-blur-[2px]">
      <label className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        {keys ? <Keyboard className="size-4 text-fg-4" /> : <Search className="size-4 text-fg-4" />}
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setAt(0) }} placeholder="Jump to a PR or ticket, or run a command… (? for shortcuts)"
               onKeyDown={(e) => {
                 if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(i + 1, hits.length - 1)) }
                 else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)) }
                 else if (e.key === 'Enter') { e.preventDefault(); pick(hits[at]) }
               }}
               className="w-full bg-transparent text-reading outline-none placeholder:text-fg-4" />
        <kbd className="rounded-md border border-line px-1.5 font-sans text-micro text-fg-4">esc</kbd>
      </label>
      {keys ? (
        <dl className="grid max-h-[calc(55vh/var(--z))] grid-cols-[auto_1fr] gap-x-6 gap-y-2 overflow-y-auto px-5 py-4 text-body">
          {KEYS.map(([k, what]) => [
            <dt key={`k${k}`} className="text-right"><kbd className="rounded-md bg-hover px-1.5 py-0.5 font-sans text-small text-fg-1 ring-1 ring-line">{k}</kbd></dt>,
            <dd key={`d${k}`} className="text-fg-2">{what}</dd>,
          ])}
        </dl>
      ) : (
        <ul className="max-h-[calc(50vh/var(--z))] overflow-y-auto p-1.5">
          {hits.map((e, i) => (
            <li key={`${e.group}:${e.key}`}>
              {(i === 0 || hits[i - 1].group !== e.group) && <p className="px-3 pb-1 pt-2 text-meta font-medium text-fg-4">{e.group}</p>}
              <button onMouseMove={() => setAt(i)} onClick={() => pick(e)} ref={(el) => { if (i === at) el?.scrollIntoView({ block: 'nearest' }) }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body ${i === at ? 'sel text-fg-1' : 'text-fg-2'}`}>
                <e.icon className={`size-4 shrink-0 ${i === at ? 'text-accent-text' : 'text-fg-4'}`} />
                {e.ref && <span className="shrink-0 text-small tabular-nums text-fg-4">{e.ref}</span>}
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.hint && <span className="shrink-0 text-meta text-fg-4">{e.hint}</span>}
                {i === at && <CornerDownLeft className="size-3.5 shrink-0 text-fg-4" />}
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-3 py-6 text-center text-body text-fg-3">Nothing matches. <span className="text-fg-4">Try an id like AC-1221 or #4729.</span></li>}
        </ul>
      )}
    </dialog>
  )
}
