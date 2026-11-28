// The status bar's own controls: the update chip and the theme button. On every page from the first paint, so they live
// apart from Settings (which loads when it is opened).
import {
  Check, LoaderCircle, Moon, 
  CircleArrowUp, Download, RefreshCw, Sun
} from 'lucide-react'
import { label, sha, VERSION } from '../version.ts'
import { useEffect, useState } from 'react'
import { api, type Theme } from '../lib.ts'
import { inSettings } from '../copy.ts'

/** An update's steps, in order, as they are said. */
export const UPDATE_STEPS = [['queued', 'Asked'], ['building', 'Building'], ['draining', 'Waiting for agents'], ['restarting', 'Restarting'], ['updated', 'Done']] as const

export type UpdateView = {
  asked: boolean; standby?: boolean; deployed?: string; log: string[]; version?: string; latest?: { sha: string; at: string; n?: number }
  upstream?: { behind: number; at: string; url: string; note?: string; commits: { sha: string; subject: string }[] } // a fork: the original repo
  status?: { phase: 'idle' | 'queued' | 'building' | 'draining' | 'restarting' | 'updated' | 'current' | 'failed'; text: string; busy: boolean; sha?: string; until?: string }
}

/**
 * Update from anywhere: a chip in the status bar, always there. Quiet, it checks GitHub now (not on the next 5-minute
 * read) and says Up to date or Update to vNNN; that, an update under way, or a tab older than its server shows by
 * itself, and one click does it. An update this tab watched reloads it onto the new version when it is in.
 */
export function UpdateChip({ onOpen }: { onOpen?: () => void }) {
  const [u, setU] = useState<UpdateView>()
  const [asking, setAsking] = useState(false), [gone, setGone] = useState(false), [checked, setChecked] = useState<'checking' | 'current'>(), [err, setErr] = useState<{ what: string; why: string }>()
  const read = (q = '') => api(`/update${q}`).then((r: UpdateView) => { setU(r); setGone(false); return r }, () => { setGone(true) })
  const busy = !!u?.status?.busy || asking
  useEffect(() => { void read(); const t = setInterval(read, busy || gone ? 3000 : 60_000); return () => clearInterval(t) }, [busy, gone]) // eslint-disable-line react-hooks/exhaustive-deps
  const runs = u?.version ? sha(u.version) : u?.deployed
  const behind = !!u?.latest && !!runs && !u.latest.sha.startsWith(runs) && !runs.startsWith(u.latest.sha)
  const stale = !!u?.version && u.version !== VERSION
  // the update this tab saw under way is in: onto it, as the Settings toast says (App.tsx), instead of one more click
  const [watched, setWatched] = useState(false)
  useEffect(() => { if (busy || (gone && u?.status?.busy)) setWatched(true) }, [busy, gone, u?.status?.busy])
  useEffect(() => { if (watched && stale && !u?.status?.busy) location.reload() }, [watched, stale, u?.status?.busy])
  // its icon last, at the bar's end, where it stays: the words come and go to its left, into the room the bar keeps
  // for them (App.tsx), so neither the icon nor anything else in the bar moves when it says something
  const chip = 'inline-flex h-[22px] flex-row-reverse items-center gap-1.5 whitespace-nowrap rounded-ctl px-2 text-meta font-medium transition-colors'
  const update = () => { setAsking(true); setErr(undefined); api('/update', {}).then(() => read(), (e: Error) => { setErr({ what: 'Update refused', why: e.message }); return read() }).finally(() => setAsking(false)) }
  const check = () => {
    setChecked('checking'); setErr(undefined)
    void read('?check=1').then((r) => {
      const run = r && (r.version ? sha(r.version) : r.deployed)
      const newer = !!r?.latest && !!run && !r.latest.sha.startsWith(run) && !run.startsWith(r.latest.sha)
      // not knowing the latest isn't "up to date": said as such
      if (!r?.latest) setErr({ what: "Couldn't check", why: r ? "GitHub didn't say which commit is the latest (its token, or a build without DECK_REPOS)" : "This machine's Concierge didn't answer" })
      setChecked(r?.latest && !newer ? 'current' : undefined)
      if (r?.latest && !newer) setTimeout(() => setChecked((c) => (c === 'current' ? undefined : c)), 4000)
    })
  }
  if (stale && !busy) return <button onClick={() => location.reload()} className={`${chip} bg-accent-soft text-accent-text hover:bg-accent/20`} title={`The server runs ${label(u!.version!)}: reload to use it`}><RefreshCw className="size-3.5" />Reload for {label(u!.version!)}</button>
  if (busy || (gone && u?.status?.busy)) {
    const step = gone ? 'Restarting' : asking ? 'Asking' : (UPDATE_STEPS.find(([k]) => k === u?.status?.phase)?.[1] ?? 'Updating')
    return <button onClick={onOpen} className={`${chip} text-run-text hover:bg-hover`} title={`${u?.status?.text ?? 'Asking this machine to update'} · ${inSettings('machines')} shows each step`}><LoaderCircle className="size-3.5 animate-spin" />{step}…</button>
  }
  if (behind) {
    const to = u!.latest!.n ? `v${u!.latest!.n}` : u!.latest!.sha.slice(0, 7)
    return (
      <button onClick={update} className={`${chip} bg-fill ${err ? 'text-fail-text' : 'text-fg-1'} hover:bg-fill-strong`} title={err?.why ?? `Builds ${to} (${u!.latest!.sha.slice(0, 7)}) while this one runs, then restarts once agents are idle`}>
        <Download className="size-3.5" />Update to {to}
      </button>
    )
  }
  // nothing known to do: a quiet check, as the sync's refresh beside it
  return (
    <button onClick={check} disabled={checked === 'checking'} aria-label="Check for updates"
            title={err?.why ?? (u?.version ? `Concierge ${label(u.version)}: check for a newer one now` : 'Check for a newer Concierge now')}
            className={`${chip} ${err ? 'text-fail-text' : 'text-fg-3'} hover:bg-hover hover:text-fg-1`}>
      {checked === 'checking' ? <LoaderCircle className="size-3.5 animate-spin" /> : checked === 'current' ? <Check className="size-3.5 text-ok-text" /> : <CircleArrowUp className="size-3.5" />}
      {checked === 'checking' ? 'Checking…' : checked === 'current' ? 'Up to date' : err?.what}
    </button>
  )
}

/** One-click light/dark flip. */
export function ThemeButton({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const isDark = theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'))
  return (
    <button onClick={() => onTheme(isDark ? 'light' : 'dark')} title={isDark ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle theme"
            className="group relative rounded-ctl p-1.5 text-fg-3 transition-all duration-200 hover:bg-hover hover:text-fg-1 active:scale-95">
      <Sun className={`size-4 transition-all duration-500 ${isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100 group-hover:rotate-45'}`} />
      <Moon className={`absolute inset-0 m-auto size-4 transition-all duration-500 ${isDark ? 'rotate-0 scale-100 opacity-100 group-hover:-rotate-12' : '-rotate-90 scale-0 opacity-0'}`} />
    </button>
  )
}
