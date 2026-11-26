import { Bot, ChevronRight, Cpu, Layers, Square, TerminalSquare, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BgTask } from '../../server/background.ts'
import { ago, api, type Activity } from '../lib.ts'
import { brief } from '../../server/brief.ts'

import { useArm, ArmLabel } from '../arm.tsx'
import { Chip } from './Chip.tsx'

type Task = BgTask & { alive: boolean; outlived: boolean; pids: number[]; cpu: number; mb: number; tail?: string }
type View = { tasks: Task[]; procs: { pid: number; cmd: string; cpu: number; mb: number }[] }
const KIND = { shell: { icon: TerminalSquare, label: 'Background shell' }, agent: { icon: Bot, label: 'Background subagent' }, detached: { icon: Layers, label: 'Detached command' } }

/** What a run started in the background: read every few seconds while there is any, so it stays live. */
export function useBackground(base: string, count: number, live: boolean) {
  const [v, setV] = useState<View>()
  useEffect(() => {
    if (!count && !live) { setV(undefined); return }
    let on = true
    const get = () => api(`${base}/background`).then((x: View) => on && setV(x), () => {})
    void get()
    // its run's activity says when to look again (query.ts staleNow), and a slow read covers the rest
    const mine = (e: Event) => (e as CustomEvent<string[]>).detail.some((p) => `${base}/background`.startsWith(p))
    const on2 = (e: Event) => { if (mine(e)) void get() }
    addEventListener('deck-stale', on2)
    const t = setInterval(get, 30_000)
    return () => { on = false; clearInterval(t); removeEventListener('deck-stale', on2) }
  }, [base, count, live])
  return v
}

/**
 * The chip for what an agent left running on its own (a background shell or subagent, a nohup'd server): how many
 * still run, and on click each one with what it runs, whether it is still going (or outlived the agent), its last
 * output, and Stop. Also any other process under the agent.
 */
export function Background({ base, count, live, toast }: { base: string; count: number; live: boolean; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const v = useBackground(base, count, live)
  const running = v?.tasks.filter((t) => t.alive) ?? []
  const outlived = running.filter((t) => t.outlived)
  if (!v || (!v.tasks.length && !v.procs.length)) return null
  return (
    <Chip icon={outlived.length ? TriangleAlert : Layers} pulse={running.length > 0} tone={outlived.length ? 'amber' : running.length ? 'emerald' : 'zinc'}
          label={<>Background{running.length ? ` · ${running.length} running` : v.tasks.length ? ` · ${v.tasks.length} done` : ''}{outlived.length ? ', outlived the agent' : ''}</>}>
      <List v={v} base={base} toast={toast} />
    </Chip>
  )
}

/** The list itself (the chip's popover, and the phone's sheet). */
export function List({ v, base, toast }: { v: View; base: string; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const { armed, arm } = useArm()
  const stop = (body: { task?: string; pid?: number }, what: string) => api(`${base}/background/stop`, body).then(
    (r: { stopped: number }) => toast(r.stopped ? `Stopped ${what}` : `${what}: nothing was running`), (e: Error) => toast(e.message, 'error'))
  const now = Date.now()
  return (
    // p-px: a scrolling box clips at its edges, and the cards' 1px ring sits just outside them
    <div className="max-h-[min(70vh,560px)] w-full space-y-3 overflow-y-auto p-px">
      <p className="text-meta leading-relaxed text-fg-3">What the agent started to keep running while it went on. The feed only shows the launch; this is what it does since.</p>
      {v.tasks.map((t) => {
        const K = KIND[t.kind]
        return (
          <div key={t.id} className={`space-y-2 rounded-xl p-3 ring-1 ${t.outlived ? 'bg-wait/6 ring-wait/30' : 'ring-line '}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta">
              <span className={`size-2 shrink-0 rounded-full ${t.alive ? 'animate-pulse bg-ok' : 'bg-fg-4'}`} />
              <K.icon className="size-3.5 shrink-0 text-fg-3" />
              <span className="whitespace-nowrap font-medium text-fg-2">{K.label}</span>
              <span className="whitespace-nowrap text-fg-3">{t.alive ? `running since ${ago(t.at, now)}` : t.stoppedAt ? `stopped ${ago(t.stoppedAt, now)}` : `ended${t.endedAt ? ` ${ago(t.endedAt, now)}` : ''}`}</span>
              {t.alive && t.pids.length > 0 && <span className="ml-auto flex items-center gap-1 whitespace-nowrap font-mono text-micro text-fg-3"><Cpu className="size-3" />{t.cpu}% · {t.mb} MB</span>}
            </div>
            <code className="block whitespace-pre-wrap break-all rounded-lg bg-fill px-2 py-1.5 font-mono text-meta text-fg-2 ">{t.cmd}</code>
            {t.outlived && <p className="text-meta font-medium text-wait-text">Still running after the agent ended: nothing will read or stop it.</p>}
            {t.tail ? <pre className="max-h-40 overflow-auto rounded-lg bg-zinc-950 p-2 font-mono text-micro leading-snug text-zinc-200">{t.tail.split('\n').slice(-30).join('\n')}</pre>
              : t.output ? <p className="text-meta text-fg-3">Output goes to <span className="font-mono">{t.output}</span> (nothing yet)</p>
              : <p className="text-meta text-fg-3">{t.kind === 'agent' ? 'A subagent: its progress shows in the feed when it reports back.' : 'Its output isn’t written anywhere Concierge can read.'}</p>}
            <div className="flex items-center gap-3 text-meta text-fg-3">
              {t.checkedAt && <span>the agent checked it {ago(t.checkedAt, now)}</span>}
              {t.alive && t.kind !== 'agent' && (
                <button onClick={() => arm(t.id, () => stop({ task: t.id }, 'it'))} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-fg-2 ring-1 ring-line-strong hover:text-fail-text">
                  <Square className="size-3 fill-current" />{armed === t.id ? <ArmLabel>Confirm stop</ArmLabel> : 'Stop'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {v.procs.length > 0 && (
        <details className="rounded-xl p-3 ring-1 ring-line ">
          <summary className="cursor-pointer text-meta font-medium text-fg-2 ">{v.procs.length} other process{v.procs.length === 1 ? '' : 'es'} under the agent</summary>
          <ul className="mt-2 space-y-1.5">
            {v.procs.map((p) => (
              <li key={p.pid} className="flex items-start gap-2 text-meta">
                <code className="min-w-0 flex-1 break-all font-mono text-fg-2 ">{p.cmd}</code>
                <span className="shrink-0 font-mono text-fg-3">{p.cpu}% · {p.mb} MB</span>
                <button onClick={() => arm(`p${p.pid}`, () => stop({ pid: p.pid }, `process ${p.pid}`))} aria-label="Stop" className="shrink-0 text-fg-3 hover:text-fail-text">
                  {armed === `p${p.pid}` ? <span className="font-semibold">stop?</span> : <Square className="size-3 fill-current" />}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Its turn ended on background work: the latest thing in this run is the note that says so. */
export function turnOver(feed: Activity[]) {
  const since = feed.findLastIndex((a) => a.kind === 'section')
  const last = feed.slice(since + 1).findLast((a) => a.kind !== 'tool')
  return last?.kind === 'event' && /still running in the background/.test(last.text)
}

/**
 * What runs in the background right now (tests, evals, a subagent), where you look: one line saying what, folded;
 * open, each with how long and its latest output. Often all there is to an agent's work between its turns.
 */
export function BgNow({ base, count, parked, open: start = false, toast }: { base: string; count: number; parked?: boolean; open?: boolean; toast?: (m: string, tone?: 'ok' | 'error') => void }) {
  const v = useBackground(base, Math.max(count, 1), true)
  const [open, setOpen] = useState(start)
  const { armed, arm } = useArm()
  const running = (v?.tasks ?? []).filter((t) => t.alive)
  // what else runs under the agent (tests or an eval it started some other way): what it may well be waiting on
  const procs = (v?.procs ?? []).filter((p) => !/^(?:\S*\/)?(?:bash|sh|zsh|sleep|tail|cat|grep)\b/.test(brief(p.cmd)))
  if (!running.length && !procs.length) return null
  const stop = (body: { task?: string; pid?: number }, what: string) => api(`${base}/background/stop`, body).then(
    (r: { stopped: number }) => toast?.(r.stopped ? `Stopped ${what}` : `${what}: nothing was running`), (e: Error) => toast?.(e.message, 'error'))
  const stopBtn = (key: string, go: () => void) => (
    <button onClick={() => arm(key, go)} className="shrink-0 rounded-md px-1.5 py-0.5 text-meta font-medium text-fg-3 ring-1 ring-line hover:text-fail">{armed === key ? <ArmLabel>Stop?</ArmLabel> : 'Stop'}</button>
  )
  const now = Date.now()
  const name = (t: Task) => (t.kind === 'agent' ? t.cmd : brief(t.cmd))
  return (
    <div className="rounded-xl bg-run/[0.05] ring-1 ring-run/20">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-small">
        <span className="relative flex size-2 shrink-0"><span className="absolute inset-0 animate-ping rounded-full bg-run/60" /><span className="size-2 rounded-full bg-run" /></span>
        <span className="shrink-0 font-medium text-fg-1">{parked ? 'Waiting on' : 'Running in the background'} · {running.length + procs.length}</span>
        {!open && <span className="min-w-0 truncate text-fg-3">{[...running.map(name), ...procs.map((p) => brief(p.cmd))].join(' · ')}</span>}
        <ChevronRight className={`ml-auto size-3.5 shrink-0 text-fg-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        // capped, scrolling inside: a handful of tasks with their output would otherwise run the chat off its screen
        <ul className="max-h-[min(50vh,420px)] space-y-2 overflow-y-auto overscroll-contain border-t border-run/15 px-3 py-2">
          {parked && <li className="text-meta text-fg-3">Its turn is over: it carries on when {running.length === 1 ? 'this finishes' : 'these finish'}.</li>}
          {running.map((t) => (
            <li key={t.id}>
              <p className="flex items-center gap-2 text-small">
                {t.kind === 'agent' ? <Bot className="size-3.5 shrink-0 text-fg-4" /> : <TerminalSquare className="size-3.5 shrink-0 text-fg-4" />}
                <span className={`min-w-0 flex-1 truncate ${t.kind === 'agent' ? 'text-fg-1' : 'font-mono text-meta text-fg-1'}`} title={t.cmd}>{name(t)}</span>
                <span className="shrink-0 text-meta tabular-nums text-fg-4">for {ago(t.at, now).replace(/ ago$/, '')}</span>
                {t.kind !== 'agent' && stopBtn(t.id, () => stop({ task: t.id }, 'it'))}
              </p>
              {t.tail ? <pre className="mt-1 max-h-28 overflow-auto rounded-lg bg-zinc-950 px-2 py-1.5 font-mono text-micro leading-snug text-zinc-200">{t.tail.split('\n').slice(-6).join('\n')}</pre>
                : <p className="mt-0.5 pl-5.5 text-meta text-fg-4">{t.kind === 'agent' ? 'A subagent: it reports back when done.' : 'No output yet.'}</p>}
            </li>
          ))}
          {procs.map((p) => (
            <li key={p.pid} className="flex items-center gap-2 text-small">
              <Cpu className="size-3.5 shrink-0 text-fg-4" />
              <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg-1" title={p.cmd}>{brief(p.cmd)}</span>
              <span className="shrink-0 font-mono text-micro text-fg-4">{p.cpu}% · {p.mb} MB</span>
              {stopBtn(`p${p.pid}`, () => stop({ pid: p.pid }, `process ${p.pid}`))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
