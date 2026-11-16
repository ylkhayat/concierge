import { Bot, FolderGit2, Gauge, LoaderCircle, MessagesSquare, Power, RotateCcw } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { Load as LoadT, Target } from '../../server/load.ts'
import type { Worktree } from '../../server/worktrees.ts'
import { ago, api } from '../lib.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'

const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`

/**
 * Always in the rail: how many agents and crit servers are running and what they cost the machine.
 * Opens a list with one button per kind to stop it, and one to stop everything.
 */
// one poll for everything that shows the load (the rail's gauge, the ribbon): every 5s while the page is visible
let last: LoadT | undefined
const subs = new Set<(l: LoadT) => void>()
let timer: ReturnType<typeof setInterval> | undefined
const read = () => api('/load').then((l: LoadT) => { last = l; subs.forEach((f) => f(l)) }, () => {})
function useLoad() {
  const [load, setLoad] = useState(last)
  useEffect(() => {
    subs.add(setLoad)
    if (subs.size === 1) { void read(); timer = setInterval(() => document.visibilityState === 'visible' && read(), 5000) }
    return () => { subs.delete(setLoad); if (!subs.size) clearInterval(timer) }
  }, [])
  return load
}

export function Load({ toast, onOpen }: { toast: (m: string, tone?: 'ok' | 'error') => void; onOpen: (t: Target) => void }) {
  const load = useLoad()
  const { armed, arm } = useArm()
  // worktrees: read when the popover opens (it walks every repo), cleaned on a second click
  const [wts, setWts] = useState<Worktree[]>()
  const [cleaning, setCleaning] = useState(false)
  useEffect(() => {
    if (!wts?.some((w) => w.mb == null)) return
    const t = setTimeout(() => readWts(), 4000)
    return () => clearTimeout(t)
  }, [wts])
  const readWts = (fresh = false) => { api('/worktrees/auto').then(setAuto, () => {}); return api(`/worktrees${fresh ? '?fresh=1' : ''}`).then(setWts, () => setWts([])) }
  const [auto, setAuto] = useState<{ on: boolean; last?: { at: string; removed: number; mb: number; why: string } }>()
  const toggleAuto = () => api('/worktrees/auto', { on: !auto?.on }).then(setAuto, (e: Error) => toast(e.message, 'error'))
  const clean = () => arm('worktrees', () => {
    setCleaning(true)
    api('/worktrees/clean', {}).then((r: { removed: number; mb: number; failed: string[] }) => {
      toast(r.removed ? `Removed ${r.removed} worktree${r.removed === 1 ? '' : 's'} · ${gb(r.mb)} freed${r.failed.length ? ` · ${r.failed.length} could not go` : ''}` : 'Nothing to remove', r.failed.length && !r.removed ? 'error' : 'ok')
      return readWts(true)
    }, (e: Error) => toast(e.message, 'error')).finally(() => setCleaning(false))
  })
  const stop = (what: 'crit' | 'runs' | 'all') => arm(what, () =>
    api('/load/stop', { what }).then((r: { stopped: number }) => { toast(r.stopped ? `Stopped ${r.stopped}` : 'Nothing was running'); setTimeout(read, 1500) }, (e: Error) => toast(e.message, 'error')))

  // stopped runs (failed, killed by restarts, cancelled) go again: one, or all of them
  const again = (key?: string) => api('/load/again', key ? { key } : {}).then((r: { started: number; failed: string[] }) => {
    toast(`${r.started} back in the queue${r.failed.length ? ` · ${r.failed[0]}` : ''}`); void read()
  }, (e: Error) => toast(e.message, 'error'))
  const stopped = load?.stopped ?? []
  const go = (t: Target) => { document.getElementById('load')?.hidePopover(); onOpen(t) }
  const agents = (load?.runs.length ?? 0) + (load?.strays ?? 0)
  const count = agents + (load?.crit.length ?? 0)
  const hot = (load?.total.cpu ?? 0) >= 150
  const btn = (what: 'crit' | 'runs' | 'all', label: string, n: number, danger = false) => (
    <button onClick={() => stop(what)} disabled={!n}
            className={`relative inline-flex items-center justify-center gap-1.5 rounded-lg text-meta font-medium transition-all disabled:pointer-events-none disabled:opacity-35 ${armed === what ? 'isolate overflow-hidden font-semibold' : ''} ${danger ? (n ? 'w-full bg-fail py-2 text-white shadow-sm hover:bg-rose-700' : 'w-full py-2 text-fg-3 ring-1 ring-line ') : 'px-2 py-0.5 text-fg-3 ring-1 ring-line-strong hover:text-fail-text hover:ring-fail/30'}`}>
      {danger && <Power className="size-3.5" />}{armed === what ? <ArmLabel>{`Confirm ${label.toLowerCase()}`}</ArmLabel> : label}{armed === what && <ArmBar on={danger ? 'color' : 'plain'} />}
    </button>
  )

  return (
    <>
      <button popoverTarget="load" style={{ anchorName: '--load' } as CSSProperties} onClick={read}
              title={load ? `${agents} agent${agents === 1 ? '' : 's'} · ${load.crit.length} crit · ${load.total.cpu}% CPU · ${fmt(load.total.mb)}` : 'What is running'} aria-label="What is running"
              className={`group relative rounded-lg p-2 transition-all hover:bg-hover active:scale-95 ${hot ? 'text-fail' : count ? 'text-fg-2 ' : 'text-fg-3'}`}>
        <Gauge className="size-4" />
        {!count && stopped.length > 0 && <span title={`${stopped.length} stopped`} className="absolute -right-0.5 -top-0.5 rounded-full bg-wait px-1 text-micro font-semibold tabular-nums leading-[14px] text-white">{stopped.length}</span>}
        {count > 0 && <span className={`absolute -right-0.5 -top-0.5 rounded-full px-1 text-micro font-semibold tabular-nums leading-[14px] text-white ${hot ? 'bg-fail' : 'bg-fg-3'}`}>{count}</span>}
      </button>
      <div id="load" popover="auto" onToggle={(e) => (e as unknown as ToggleEvent).newState === 'open' && readWts()}
           style={{ positionAnchor: '--load', positionArea: 'right span-top', inset: 'auto' } as CSSProperties}
           className="m-0 ml-2 max-h-[calc(100vh/var(--z)-24px)] w-[340px] overflow-y-auto overscroll-contain rounded-2xl border-0 bg-fill/60 p-0 text-fg-2 shadow-2xl ring-1 ring-line ">
        {!load ? <p className="p-4 text-small text-fg-3">Reading…</p> : (
          <div className="space-y-2.5 p-3 text-small">
            <header className="px-1">
              <h3 className="text-reading font-semibold tracking-tight">Running</h3>
              {/* what runs, against what this machine has (in Docker or WSL: what its VM gets) */}
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Meter label="CPU" value={`${load.total.cpu}%`} of={`of ${load.machine.cores} cores${(load.machine.count ?? 1) > 1 ? ` on ${load.machine.count} machines` : ''}`} fill={Math.min(1, load.total.cpu / (load.machine.cores * 100))} hot={hot} />
                <Meter label="Memory" value={fmt(load.total.mb)} of={`${fmt(load.machine.freeMb)} free`} fill={Math.min(1, load.total.mb / load.machine.mb)} hot={load.machine.freeMb < 1024} />
                {load.machine.diskGb != null && load.machine.diskFreeGb != null
                  ? <Meter label={(load.machine.count ?? 1) > 1 ? 'Disk here' : 'Disk'} value={`${load.machine.diskFreeGb} GB free`} of={`of ${load.machine.diskGb} GB`} fill={1 - load.machine.diskFreeGb / load.machine.diskGb} hot={load.machine.diskFreeGb < 10} />
                  : <span />}
              </div>
            </header>
            <Card icon={Bot} title="Agents" meta={`${agents} of ${load.machine.slots}${load.queued ? ` · ${load.queued} queued` : ''}`} action={btn('runs', 'Stop', agents + load.queued)}>
              {load.runs.length || load.strays || load.queued ? (
                <ul className="space-y-1">
                  {load.runs.slice(0, 3).map((r) => <li key={r.key}><Item target={r.target} go={go} dot="animate-pulse bg-run">{r.label}</Item></li>)}
                  {load.runs.length > 3 && <li className="pl-3.5 text-fg-3">+{load.runs.length - 3} more</li>}
                  {load.strays > 0 && <li className="flex items-center gap-2 text-wait-text"><span className="size-1.5 shrink-0 rounded-full bg-wait" />{load.strays} left over from a restart</li>}
                  {load.waiting && <li className="flex items-center gap-2 text-wait-text"><span className="size-1.5 shrink-0 rounded-full bg-wait" />Waiting: {load.waiting}</li>}
                </ul>
              ) : <p className="text-fg-3">Idle.</p>}
              {/* the other machines that take runs (several machines: server/machines.ts), and how full each is */}
              {!!load.machines?.length && (
                <p className="mt-2 border-t border-line pt-2 text-meta text-fg-3">
                  {load.machines.map((m) => <span key={m.name} className="mr-3 inline-flex items-center gap-1.5" title={m.up ? `${m.name}: ${m.running} of ${m.slots} running` : `${m.name} doesn't answer`}>
                    <span className={`size-1.5 rounded-full ${m.up ? 'bg-ok' : 'bg-fg-4'}`} />{m.name} {m.up ? `${m.running}/${m.slots}` : 'off'}</span>)}
                </p>
              )}
            </Card>
            {stopped.length > 0 && (
              <Card icon={RotateCcw} title="Stopped" meta={String(stopped.length)} action={stopped.length > 1 && <button onClick={() => again()} className="btn-outline btn-sm">Run all again</button>}>
                <ul className="space-y-1.5">
                  {stopped.map((r) => (
                    <li key={r.key} className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Item target={r.target} go={go} dot={r.state === 'cancelled' ? 'bg-fg-4' : 'bg-fail'}>{r.label}</Item>
                        <p className="truncate pl-3.5 text-meta text-fg-3" title={r.why}>{r.state === 'cancelled' ? 'Cancelled' : r.state === 'interrupted' ? 'Killed' : 'Failed'} {ago(r.at)}{r.why ? ` · ${r.why}` : ''}</p>
                      </div>
                      <button onClick={() => again(r.key)} className="btn-ghost btn-sm shrink-0">Run again</button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card icon={MessagesSquare} title="crit servers" meta={String(load.crit.length)} action={btn('crit', 'Stop', load.crit.length)}>
              {load.crit.length ? (
                <ul className="space-y-1">{load.crit.slice(0, 3).map((c) => (
                  <li key={c.pid}><Item target={c.target} go={go} dot="bg-ok" aside={`:${c.port}`}>{c.name}</Item></li>
                ))}{load.crit.length > 3 && <li className="pl-3.5 text-fg-3">+{load.crit.length - 3} more</li>}</ul>
              ) : <p className="text-fg-3">None. Comments are kept; Restart crit brings a review back.</p>}
            </Card>
            <WorktreesSection wts={wts} cleaning={cleaning} armed={armed === 'worktrees'} onClean={clean} auto={auto} onAuto={toggleAuto} />
            {btn('all', 'Stop everything', count + load.queued, true)}
          </div>
        )}
      </div>
    </>
  )
}

const gb = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~').split('/').slice(-2).join('/')

/** One running thing: a link to what it works on (its PR, ticket or codebase map), or plain text when it has none. */
function Item({ target, go, dot, aside, children }: { target?: Target; go: (t: Target) => void; dot: string; aside?: string; children: ReactNode }) {
  const body = <><span className={`size-1.5 shrink-0 rounded-full ${dot}`} /><span className="min-w-0 flex-1 truncate text-left">{children}</span>{aside && <span className="font-mono text-meta text-fg-3">{aside}</span>}</>
  return target
    ? <button onClick={() => go(target)} title="Open it" className="-mx-1.5 flex w-[calc(100%+12px)] items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hov hover:text-accent-text focus-visible:bg-fill">{body}</button>
    : <span className="flex items-center gap-2 py-0.5">{body}</span>
}

/**
 * The ribbon at the top right: what Concierge costs the machine right now, at a glance. Each figure shows its
 * details on hover; a click opens Running, where things can be stopped.
 */
export function LoadRibbon() {
  const load = useLoad()
  if (!load) return null
  const { machine: m, total } = load
  const used = m.diskGb != null && m.diskFreeGb != null ? 1 - m.diskFreeGb / m.diskGb : undefined
  const running = load.runs.length + load.strays
  const open = () => document.getElementById('load')?.showPopover()
  const line = (k: string, v: string) => <span className="flex justify-between gap-4"><span className="text-fg-3">{k}</span><span className="font-medium tabular-nums">{v}</span></span>
  const cpuHot = total.cpu >= m.cores * 75, memHot = m.freeMb < 1024
  // a window that has reset counts as empty until an agent reports it again
  const live = (w?: { used: number; resetsAt: number }) => (w && w.resetsAt * 1000 > Date.now() ? w : undefined)
  const plan = [live(load.plan?.five), live(load.plan?.seven)].filter((w) => !!w).sort((a, b) => b.used - a.used)[0]
  // one sentence, the way you'd say it: what the agents are doing, and only what needs a look
  const planHot = !!plan && plan.used >= load.plan!.stopAt - 0.1
  const issues = [cpuHot && 'machine busy', memHot && 'memory low', used != null && m.diskFreeGb! < 10 && 'disk almost full', planHot && `plan ${Math.round(plan!.used * 100)}% used`].filter(Boolean) as string[]
  const doing = running ? `${running} agent${running === 1 ? '' : 's'} working` : 'Agents idle'
  const section = (title: string, body: ReactNode) => <span className="block space-y-1 border-t border-line pt-2 first:border-0 first:pt-0"><span className="block text-meta font-medium text-fg-3">{title}</span>{body}</span>
  return (
    <span className="group/r relative hidden md:inline-flex">
      <button onClick={open} className="inline-flex items-center gap-1.5 rounded-md px-1.5 leading-[18px] text-fg-3 transition-colors duration-150 hov hover:text-fg-1">
        <span className={`size-1.5 rounded-full ${issues.length ? 'bg-wait' : running ? 'animate-pulse bg-run' : 'bg-ok'}`} />
        <span>{doing}{load.queued > 0 && `, ${load.queued} queued`}</span>
        {issues.length > 0 && <span className="text-fg-1">· {issues.join(', ')}</span>}
        {!issues.length && plan && <span className="text-fg-4">· plan {Math.round(plan.used * 100)}%</span>}
      </button>
      <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-1.5 hidden w-64 space-y-2 rounded-card bg-surface-1 p-3 text-small text-fg-2 shadow-e2 group-hover/r:block">
        {section('Agents', <>
          {load.runs.length ? load.runs.slice(0, 6).map((r) => <span key={r.key} className="flex items-center gap-1.5"><span className="size-1.5 shrink-0 animate-pulse rounded-full bg-run" /><span className="truncate">{r.label}</span></span>) : <span className="block text-fg-3">None running, {m.slots} can run at once.</span>}
          {load.runs.length > 6 && <span className="block text-fg-3">+{load.runs.length - 6} more</span>}
          {load.queued > 0 && line('Queued', String(load.queued))}{load.crit.length > 0 && line('crit servers', String(load.crit.length))}
          {load.strays > 0 && <span className="block text-wait">{load.strays} left over from a restart</span>}
        </>)}
        {plan && section('Plan', <>
          {([['5-hour', load.plan!.five], ['7-day', load.plan!.seven]] as const).map(([k, w]) => w && line(k, `${Math.round(w.used * 100)}% · resets ${resets(w.resetsAt)}`))}
          <span className="block text-meta text-fg-4">At {Math.round(load.plan!.stopAt * 100)}% the agents pause and continue once it resets.</span>
        </>)}
        {section('This machine', <>
          {line('CPU', `${Math.round(total.cpu / m.cores)}% of ${m.cores} cores${(m.count ?? 1) > 1 ? ` (${m.count} machines)` : ''}`)}{line('Memory', `${fmt(total.mb)} used · ${fmt(m.freeMb)} free`)}
          {used != null && line('Disk', `${m.diskFreeGb} GB free of ${m.diskGb}`)}
        </>)}
        <span className="block text-meta text-fg-4">Click for everything running, and worktrees.</span>
      </span>
    </span>
  )
}

/** Worktrees: how much space, what can go, and what stays (with why); one button removes what can go. */
function WorktreesSection({ wts, cleaning, armed, onClean, auto, onAuto }: {
  wts?: Worktree[]; cleaning: boolean; armed: boolean; onClean: () => void
  auto?: { on: boolean; last?: { at: string; removed: number; mb: number; why: string } }; onAuto: () => void
}) {
  const go = wts?.filter((w) => w.remove) ?? [], stay = wts?.filter((w) => !w.remove) ?? []
  const sum = (l: Worktree[]) => l.reduce((n, w) => n + (w.mb ?? 0), 0)
  const sizing = !!wts?.some((w) => w.mb == null)
  return (
    <section className="card p-3 ">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-fill text-fg-3"><FolderGit2 className="size-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-small font-semibold">Worktrees {wts && <span className="font-normal tabular-nums text-fg-3">{wts.length} · {sizing ? 'sizing…' : gb(sum(wts))}</span>}</span>
          <span className="block truncate text-meta text-fg-3">{!wts ? 'Reading the repos…' : `${go.length ? `${go.length} can go` : 'Nothing to clean up'}${stay.length ? ` · ${stay.length} stay` : ''}${auto?.on ? ' · auto' : ''}`}</span>
        </span>
        {!wts ? <LoaderCircle className="size-3.5 animate-spin text-fg-3" /> : (
          <button onClick={onClean} disabled={!go.length || cleaning}
                  className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-meta font-medium text-fg-2 ring-1 ring-line-strong transition-all hover:text-fail-text hover:ring-fail/30 disabled:pointer-events-none disabled:opacity-35 ${armed ? 'isolate overflow-hidden font-semibold' : ''}`}>
            {cleaning && <LoaderCircle className="size-3.5 animate-spin" />}
            {armed ? <ArmLabel>{`Confirm: remove ${go.length}`}</ArmLabel> : `Clean up${go.length && !go.some((w) => w.mb == null) ? ` · ${gb(sum(go))}` : ''}`}{armed && <ArmBar on="plain" />}
          </button>
        )}
      </div>
      {wts && (
        <details className="group mt-1.5 pl-8 text-meta text-fg-3">
          <summary className="cursor-pointer list-none hover:text-fg-1"><span className="group-open:hidden">Details</span><span className="hidden group-open:inline">Hide details</span></summary>
          <div className="mt-1.5 space-y-2">
            {stay.length > 0 && <ul className="space-y-0.5">{stay.slice(0, 3).map((w) => (
              <li key={w.path} className="flex gap-2" title={w.path}><span className="min-w-0 flex-1 truncate font-mono text-micro">{short(w.path)}</span><span className="shrink-0">{w.why}</span></li>
            ))}{stay.length > 3 && <li className="text-fg-3">+{stay.length - 3} more stay</li>}</ul>}
            <p className="text-meta text-fg-3">Never removes unpushed work, an open review, or anything used in the last 15 minutes.</p>
            {auto && (
              <div className="flex items-start gap-2">
                <button role="switch" aria-checked={auto.on} onClick={onAuto} aria-label="Clean up automatically"
                        className={`relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors ${auto.on ? 'bg-ok' : 'bg-fill-strong'}`}>
                  <span className={`absolute top-0.5 size-3 rounded-full bg-white shadow transition-all ${auto.on ? 'left-3.5' : 'left-0.5'}`} />
                </button>
                <span className="leading-snug text-fg-2 ">
                  Clean up automatically: when a PR closes, and nightly.
                  {auto.last && <span className="block text-fg-3">Last: {auto.last.removed ? `removed ${auto.last.removed} (${gb(auto.last.mb)})` : 'nothing to remove'} · {ago(auto.last.at)}</span>}
                </span>
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  )
}

/** A small gauge: label, value, what it is out of, and a thin bar (rose when it runs hot). */
function Meter({ label, value, of, fill, hot }: { label: string; value: string; of: string; fill: number; hot?: boolean }) {
  return (
    <span className="min-w-0 rounded-lg bg-surface-1 px-2 py-1.5 ring-1 ring-line " title={`${value} ${of}`}>
      <span className="block text-micro uppercase tracking-labelr text-fg-3">{label}</span>
      <span className={`block truncate text-small font-semibold tabular-nums leading-tight ${hot ? 'text-fail-text' : 'text-fg-1 '}`}>{value}</span>
      <span className="block truncate text-micro tabular-nums text-fg-3">{of}</span>
      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-fill-strong"><span className={`block h-full rounded-full transition-[width] duration-500 ${hot ? 'bg-fail' : 'bg-accent'}`} style={{ width: `${Math.max(4, fill * 100)}%` }} /></span>
    </span>
  )
}

/** One kind of thing running: a soft card with its count and its stop, then the items. */
function Card({ icon: Icon, title, meta, action, children }: { icon: typeof Bot; title: string; meta: string; action: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 card p-3 ">
      <h4 className="flex items-center gap-2 text-small font-semibold"><span className="flex size-6 items-center justify-center rounded-lg bg-fill text-fg-3"><Icon className="size-3.5" /></span>{title}<span className="font-normal tabular-nums text-fg-3">{meta}</span><span className="ml-auto">{action}</span></h4>
      {children}
    </section>
  )
}

/** "17:30" today, else "Sat 09:00" */
const resets = (sec: number) => new Date(sec * 1000).toLocaleString('en-GB', new Date(sec * 1000).toDateString() === new Date().toDateString() ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })

type Route = { work: string; chosen: string; using: string; label: string; chosenLabel: string; why?: string; until?: number; stuck: boolean }
// "7-day plan window full until Fri 02:00", in your time zone
const reason = (r: Route) => (r.why ?? '') + (r.until ? ` until ${resets(r.until / 1000)}` : '')
const WORK_NAME: Record<string, string> = { review: 'Reviews', revise: 'Your PRs', exec: 'Tickets', small: 'Quick calls' }

type Now = { id: string; label: string; kind: 'claude' | 'openai' | 'llama' | 'copilot'; windows?: { five?: { used: number; resetsAt: number }; seven?: { used: number; resetsAt: number } }
  today?: { usd: number; input: number; output: number; runs: number }; standingInFor?: string }
const KIND_LABEL = { claude: 'Claude', openai: 'OpenAI', llama: 'Llama', copilot: 'Copilot' }
const KIND_TONE = { claude: 'bg-wait/10 text-wait-text ring-wait/20', openai: 'bg-ok/10 text-ok-text ring-ok/20', llama: 'bg-run/10 text-run-text ring-run/20', copilot: 'bg-fg-3/10 text-fg-2 ring-zinc-500/25' }
const tokensShort = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

/**
 * Under the spend meter: the account the agents are on now, as a chip (amber while it stands in for another), with its
 * plan's session and week, or for a local model what it did today. Each kind of work and why, on hover.
 */
export function AccountNow({ now, routing }: { now?: Now; routing?: Route[] }) {
  if (!now) return null
  const live = (w?: { used: number; resetsAt: number }) => (w && w.resetsAt * 1000 > Date.now() ? w : undefined)
  const meter = (label: string, w?: { used: number; resetsAt: number }) => {
    const u = live(w)?.used ?? 0
    return (
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between text-micro"><span className="text-fg-3">{label}</span>
          <span className="font-mono font-semibold tabular-nums text-fg-2 ">{live(w) ? `${Math.round(u * 100)}%` : '–'}</span></span>
        <span className="h-1 overflow-hidden rounded-full bg-fill-strong"><span className={`block h-full rounded-full ${u >= 0.95 ? 'bg-fail' : u >= 0.8 ? 'bg-wait' : 'bg-accent'}`} style={{ width: `${Math.max(3, u * 100)}%` }} /></span>
      </span>
    )
  }
  const stuck = routing?.filter((r) => r.stuck) ?? []
  const title = [
    ...(routing ?? []).map((r) => `${WORK_NAME[r.work] ?? r.work}: ${r.label}${r.using !== r.chosen ? ` (for ${r.chosenLabel}: ${reason(r)})` : r.stuck ? ` (waits: ${reason(r)})` : ''}`),
    ...[['Session', live(now.windows?.five)], ['Week', live(now.windows?.seven)]].filter(([, w]) => w).map(([k, w]) => `${k} resets ${resets((w as { resetsAt: number }).resetsAt)}`),
  ].join('\n')
  return (
    <span className="mt-2 block" title={title}>
      <span className="flex items-center gap-1.5 text-meta">
        <span className={`rounded px-1 text-micro font-semibold ring-1 ring-inset ${KIND_TONE[now.kind]}`}>{KIND_LABEL[now.kind]}</span>
        <span className={`truncate font-semibold ${now.standingInFor || stuck.length ? 'text-wait-text' : 'text-fg-1 '}`}>{now.label}</span>
        <span className="ml-auto shrink-0 text-micro text-fg-3">{now.standingInFor ? `for ${now.standingInFor}` : stuck.length ? 'waiting' : 'in use'}</span>
      </span>
      {now.kind === 'llama'
        ? <span className="mt-1 block text-micro tabular-nums text-fg-3">{now.today ? `${tokensShort(now.today.input + now.today.output)} tokens · ${now.today.runs} run${now.today.runs === 1 ? '' : 's'} today` : 'nothing today'} · local, no limits</span>
        : <span className="mt-1 flex gap-3">{meter('Session', now.windows?.five)}{meter('Week', now.windows?.seven)}</span>}
    </span>
  )
}
