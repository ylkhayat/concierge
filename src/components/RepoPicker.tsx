import { Check, ChevronDown, CloudOff, FolderGit2, FolderLock, Search } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { appColor } from '../appColor.ts'

export type RepoCount = { repo: string; tickets: number; waiting: number; away?: boolean; held?: string } // away: not on this machine (its own page); held: why no machine can work on it now

/**
 * The focus: which application (repository) you are working on, shared by every workspace, for any number of them: one button, and a popover listing every repo (busiest
 * first) with its ticket count and what waits on you. A search box shows once the list is long.
 */
export function RepoPicker({ value, repos, total, onChange, unit, wide }: { value?: string; repos: RepoCount[]; total: number; onChange: (r?: string) => void; unit: string; wide?: boolean }) {
  const [q, setQ] = useState('')
  const pop = useRef<HTMLDivElement>(null)
  const sorted = [...repos].sort((a, b) => b.waiting - a.waiting || b.tickets - a.tickets || a.repo.localeCompare(b.repo))
  const shown = sorted.filter((r) => r.repo.toLowerCase().includes(q.trim().toLowerCase()))
  const current = repos.find((r) => r.repo === value)
  useEffect(() => {
    const el = pop.current!
    const t = (e: Event) => { if ((e as ToggleEvent).newState === 'open') setQ('') }
    el.addEventListener('toggle', t)
    return () => el.removeEventListener('toggle', t)
  }, [])
  const pick = (r?: string) => { onChange(r); pop.current?.hidePopover() }
  // it opens as you point at it (a moment's wait, so passing by doesn't), and closes a moment after you leave both it
  // and the list: one click to switch. A click (or touch, or Enter) opens it too
  const timer = useRef(0)
  const show = (ms: number) => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { try { pop.current?.showPopover() } catch { /* open */ } }, ms) }
  const hide = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { try { if (!pop.current?.contains(document.activeElement)) pop.current?.hidePopover() } catch { /* shut */ } }, 280) }
  const stay = () => clearTimeout(timer.current)
  useEffect(() => () => clearTimeout(timer.current), [])
  const row = (label: string, n: number, waiting: number, on: boolean, r?: string, away?: boolean, held?: string) => (
    <button key={r ?? 'all'} onClick={() => pick(r)} aria-current={on} title={away ? `${r}: not on this machine` : held ? `${r}: no machine can work on it now (${held})` : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-body transition-colors ${on ? 'bg-accent/10' : 'hov '} ${away ? 'text-fg-4' : ''}`}>
      <span className="flex size-4 shrink-0 items-center justify-center">{on && <Check className="size-4 text-accent-text" />}</span>
      {r && <span className={`size-2 shrink-0 rounded-full ${appColor(r).bar}`} aria-hidden />}
      <span className={`min-w-0 flex-1 truncate ${r ? 'font-mono' : 'font-medium'}`} title={r}>{label}</span>
      {away && <FolderLock className="size-3.5 shrink-0 text-fg-4" aria-label="not on this machine" />}
      {!away && held && <CloudOff className="size-3.5 shrink-0 text-wait-text" aria-label="no machine can work on it now" />}
      {waiting > 0 && <span className="rounded-full bg-wait/15 px-1.5 text-micro font-semibold tabular-nums text-wait-text" title="waiting on you">{waiting}</span>}
      <span className="text-meta tabular-nums text-fg-3">{n}</span>
    </button>
  )
  return (
    <>
      <button onClick={() => show(0)} onMouseEnter={() => show(120)} onMouseLeave={hide} aria-haspopup="dialog" style={{ anchorName: '--repo-picker' } as CSSProperties} title={`Focus: ${value ?? 'all applications'} · ${current?.tickets ?? total} ${unit}s`}
              className={`group flex w-full ${wide ? 'items-center gap-2.5 rounded-xl px-1.5 py-1 text-left hover:bg-hover' : 'flex-col items-center gap-1 py-1'}`}>
        <span className={`relative flex size-10 items-center justify-center rounded-2xl font-mono text-body font-bold uppercase ring-1 transition-all group-hover:scale-105 ${value
          ? `${appColor(value).tile} ring-transparent` : 'bg-surface-1 text-fg-3 ring-line-strong'}`}>
          {value ? monogram(value) : <FolderGit2 className="size-[18px]" />}
          <ChevronDown className="absolute -bottom-1 -right-1 size-3.5 rounded-full bg-surface-1 p-px text-fg-3 ring-1 ring-line-strong" />
        </span>
        {wide ? <span className="min-w-0 flex-1"><span className="block truncate font-mono text-small font-semibold text-fg-1">{value ? value.split('/')[1] : 'All applications'}</span><span className="block truncate text-micro text-fg-3">{value ? value.split('/')[0] : `${repos.length} repositories`}</span></span>
          : <span className="w-full truncate px-0.5 text-center text-micro font-medium text-fg-2 ">{value ? value.split('/')[1] : 'All apps'}</span>}
      </button>
      <div id="repo-picker" ref={pop} popover="auto" onMouseEnter={stay} onMouseLeave={hide}
           style={{ positionAnchor: '--repo-picker', positionArea: 'right span-bottom', inset: 'auto' } as CSSProperties}
           className="m-0 ml-2 max-h-[calc(70vh/var(--z))] w-[280px] overflow-y-auto rounded-2xl border-0 bg-surface-1 p-1.5 text-fg-2 shadow-xl ring-1 ring-line ">
        <p className="px-2.5 pb-1.5 pt-1 labelr text-fg-3">Focus on an application</p>
        {repos.length > 6 && (
          <label className="mb-1 flex items-center gap-2 rounded-lg bg-fill px-2.5 py-1.5 text-small">
            <Search className="size-3.5 text-fg-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Find an application" className="w-full bg-transparent outline-none placeholder:text-fg-3"
                   onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) pick(shown[0].repo) }} />
          </label>
        )}
        {!q && row('All applications', total, repos.reduce((n, r) => n + r.waiting, 0), !value)}
        {shown.map((r) => row(r.repo, r.tickets, r.waiting, r.repo === value, r.repo, r.away, r.held))}
        {!shown.length && <p className="px-2.5 py-2 text-small text-fg-3">No repository matches.</p>}
      </div>
    </>
  )
}

/** "acme/desktop-app" → "DA", "acme/api" → "AP": two letters to tell applications apart in the rail. */
export const monogram = (repo: string) => {
  const name = repo.split('/').pop() ?? repo
  const parts = name.split(/[-_.]/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}
