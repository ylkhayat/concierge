// Design: what the pull requests look like, before and after, without opening them. Built like Plans: the list on the
// left (the PRs that change what people see, and the tickets marked design), and the open one beside it: its screens,
// before and after, and a conversation with the agent that captured them ("also at phone width": it captures again).
import { ArrowUp, ChevronRight, Crosshair, ExternalLink, Eye, EyeOff, Images, LayoutTemplate, LoaderCircle, Palette, Square, Camera, Tag, Wand } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Activity } from '../../server/runner.ts'
import type { Kind, Mark, Shot, VisualSet, VisualsMode, UiCheck } from '../../server/visuals.ts'
import type { VisualsTask } from '../../server/store.ts'
import { api, enc } from '../lib.ts'
import { refresh, useApi } from '../query.ts'
import { Pick } from '../ui/Pick.tsx'
import { ActivityFeed } from './ActivityFeed.tsx'
import { Skeleton } from './Connections.tsx'
import { Md } from './Md.tsx'
import { Tabs } from './Tabs.tsx'

type Toast = (msg: string, tone?: 'ok' | 'error') => void
type Override = 'on' | 'off' | undefined
export type VisualsPr = {
  id: string; repo: string; number: number; title: string; url: string; author: string; mine: boolean; draft: boolean; headSha: string
  mode: VisualsMode; override: Override; ui?: UiCheck; wanted: boolean; task?: VisualsTask; tickets: string[]
}
type ListPr = VisualsPr & { latest?: { sha: string; at: string; summary?: string; count: number; thumb?: string } }
type RepoRow = { repo: string; mode: VisualsMode; task?: VisualsTask & { prUrl?: string }; baseline?: { sha: string; at: string; count: number; thumb?: string }; fromApp: boolean }
type List = { joined: boolean; repos: RepoRow[]; prs: ListPr[]; tickets: { id: string; title: string; labels: string[]; url: string; prs: string[] }[] }
type Full = VisualsPr & { sets: VisualSet[] }

/** A screenshot's address (served per PR, commit and file name). */
const baselineKey = (repo: string) => `repo:${repo}`
export const shotUrl = (pr: string, sha: string, f: string) => `/api/visuals/image?pr=${encodeURIComponent(pr)}&sha=${sha}&f=${encodeURIComponent(f)}`
const busy = (t?: VisualsTask) => t?.state === 'queued' || t?.state === 'running'
const modeWord: Record<VisualsMode, string> = { off: 'off', auto: 'when it changes what people see', always: 'always' }

/** Where a PR's visuals stand, in a few words: being captured, captured for this commit, or why not. */
function standing(p: VisualsPr, latestSha?: string): { text: string; tone: 'run' | 'ok' | 'wait' | 'idle' } {
  const t = p.task
  if (t?.state === 'running') return { text: t.machine ? `Capturing on ${t.machine}…` : 'Capturing…', tone: 'run' }
  if (t?.state === 'queued') return { text: 'Waiting for a machine with its checkout', tone: 'run' }
  if (latestSha === p.headSha) return { text: 'Captured for its latest commit', tone: 'ok' }
  if (t?.state === 'failed' && t.headSha === p.headSha) return { text: `Didn't capture: ${t.error ?? 'it failed'}`, tone: 'wait' }
  if (t?.state === 'done' && t.headSha === p.headSha && t.machine) return { text: `Captured on ${t.machine}: its screenshots are on their way here`, tone: 'run' }
  if (!p.wanted) return { text: p.override === 'off' ? 'Turned off for this PR' : p.mode === 'off' ? 'Visuals are off for its repository' : 'It doesn’t change what people see', tone: 'idle' }
  if (!p.mine) return { text: 'Someone else’s PR: capture it yourself (it runs their code)', tone: 'idle' }
  return { text: latestSha ? 'A new commit: captured again shortly' : 'Captured shortly', tone: 'wait' }
}
const TONE = { run: 'text-run-text', ok: 'text-ok-text', wait: 'text-wait-text', idle: 'text-fg-3' }

export function DesignWorkspace({ selected, onSelect, feed, toast }: { selected?: string; onSelect: (id: string) => void; feed: Activity[]; toast: Toast }) {
  const list = useApi<List>('/visuals', { refetchInterval: 30_000 })
  const prs = list.data?.prs ?? [], tickets = list.data?.tickets ?? []
  const current = selected ?? prs[0]?.id
  const ticket = current?.startsWith('ticket:') ? tickets.find((t) => `ticket:${t.id}` === current) : undefined
  const repos = list.data?.repos ?? []
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Design" className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-2 md:flex">
        <p className="label px-2.5 pb-1 pt-2 text-fg-4">Pull requests</p>
        {!list.data && <Skeleton rows={3} />}
        {list.data && !prs.length && <p className="px-2.5 text-meta text-fg-3">None yet. Turn visuals on for a repository in Settings → Repositories, or for one PR from its page.</p>}
        {prs.map((p) => {
          const s = standing(p, p.latest?.sha)
          return (
            <button key={p.id} onClick={() => onSelect(p.id)} className={`flex gap-2 rounded-lg px-2 py-1.5 text-left ${current === p.id ? 'sel' : 'hover:bg-hover'}`}>
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
                {p.latest?.thumb ? <img src={shotUrl(p.id, p.latest.sha, p.latest.thumb)} alt="" loading="lazy" className="size-full object-cover object-top" /> : <Images className="size-4 text-fg-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-small font-medium text-fg-1">{busy(p.task) && <LoaderCircle className="size-3 shrink-0 animate-spin text-run" />}<span className="truncate">{p.title}</span></span>
                <span className="block truncate text-micro text-fg-3">{p.repo.split('/')[1]}#{p.number}</span>
                <span className={`block truncate text-micro ${TONE[s.tone]}`}>{s.text}</span>
              </span>
            </button>
          )
        })}
        {repos.length > 0 && <p className="label px-2.5 pb-1 pt-3 text-fg-4">Baselines</p>}
        {repos.map((r) => (
          <button key={r.repo} onClick={() => onSelect(baselineKey(r.repo))} className={`flex gap-2 rounded-lg px-2 py-1.5 text-left ${current === baselineKey(r.repo) ? 'sel' : 'hover:bg-hover'}`}>
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
              {r.baseline?.thumb ? <img src={shotUrl(baselineKey(r.repo), r.baseline.sha, r.baseline.thumb)} alt="" loading="lazy" className="size-full object-cover object-top" /> : <LayoutTemplate className="size-4 text-fg-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-small font-medium text-fg-1">{busy(r.task) && <LoaderCircle className="size-3 shrink-0 animate-spin text-run" />}<span className="truncate">{r.repo.split('/')[1]}</span></span>
              <span className={`block truncate text-micro ${r.baseline ? 'text-fg-3' : 'text-wait-text'}`}>{r.baseline ? `${r.baseline.count} components in stories` : busy(r.task) ? 'Setting its Storybook up…' : 'No Storybook yet'}</span>
            </span>
          </button>
        ))}
        {tickets.length > 0 && <p className="label px-2.5 pb-1 pt-3 text-fg-4">Tickets</p>}
        {tickets.map((t) => (
          <button key={t.id} onClick={() => onSelect(`ticket:${t.id}`)} className={`rounded-lg px-2.5 py-1.5 text-left ${current === `ticket:${t.id}` ? 'sel' : 'hover:bg-hover'}`}>
            <span className="block truncate text-small text-fg-1">{t.title}</span>
            <span className="block truncate text-micro text-fg-3">{t.id}{t.prs.length ? ` · ${t.prs.length} PR${t.prs.length === 1 ? '' : 's'}` : ' · no PR yet'}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {current?.startsWith('repo:') ? <Baseline key={current} repo={current.slice(5)} feed={feed} toast={toast} />
          : ticket ? <TicketVisuals t={ticket} prs={prs} onSelect={onSelect} />
          : current && !current.startsWith('ticket:') ? <VisualsView key={current} id={current} feed={feed} toast={toast} />
          : <Empty />}
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Palette className="size-6 text-accent-text" />
      <p className="text-body font-medium text-fg-1">What your pull requests look like, before and after</p>
      <p className="max-w-md text-small text-fg-3">Turn visuals on for a repository (Settings → Repositories), and each PR that changes what people see gets its screens captured: from its Storybook stories, else from the running app.</p>
    </div>
  )
}

/**
 * A repository's baseline: its Storybook set up (as a PR, by an agent through the Storybook skills) and the first shot
 * of every component, read through the same lenses. Before that, the way to set it up; the conversation beside it.
 */
function Baseline({ repo, feed, toast }: { repo: string; feed: Activity[]; toast: Toast }) {
  const path = `/visuals/repos/${repo}`
  const [ticking, setTicking] = useState(false)
  const q = useApi<{ repo: string; mode: VisualsMode; task?: VisualsTask & { prUrl?: string }; sets: VisualSet[] }>(path, { refetchInterval: ticking ? 3000 : 30_000 })
  const b = q.data, t = b?.task
  useEffect(() => setTicking(busy(t)), [t?.state])
  const post = (body: object, msg?: string) => api(path, body).then(() => { void refresh(path); void refresh('/visuals'); if (msg) toast(msg) }, (e: Error) => toast(e.message, 'error'))
  if (!b) return <div className="p-4"><Skeleton rows={6} /></div>
  const set = b.sets[0]
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-3 p-4">
          <header className="card px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-3">{repo} · baseline</p>
                <h2 className="text-title font-semibold text-fg-1">{set ? 'Every component, as it looks today' : 'No Storybook yet'}</h2>
                <p className={`mt-0.5 text-meta ${t?.state === 'failed' ? 'text-wait-text' : busy(t) ? 'text-run-text' : 'text-fg-3'}`}>
                  {t?.state === 'running' ? `Setting its Storybook up${t.machine ? ` on ${t.machine}` : ''}: layers, stories, docs, then the first shot…`
                    : t?.state === 'queued' ? 'Waiting for a machine with its checkout'
                    : t?.state === 'failed' ? `It didn't finish: ${t.error ?? 'it failed'}`
                    : set ? `${set.shots.length} shots, ${new Date(set.at).toLocaleString()}`
                    : 'Its PRs are captured from the running app, screen by screen. With stories, each component is captured on its own, in each of its states.'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {t?.prUrl && <a href={t.prUrl} target="_blank" rel="noreferrer" className="btn-outline btn-sm inline-flex items-center gap-1.5"><ExternalLink className="size-3.5" />Its PR</a>}
                {busy(t)
                  ? <button onClick={() => post({ cancel: true }, 'Stopped')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Square className="size-3.5" />Stop</button>
                  : <button onClick={() => post({ setup: true }, set ? 'Taking the baseline again' : 'Setting its Storybook up')} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Wand className="size-3.5" />{set ? 'Shoot again' : 'Set up Storybook'}</button>}
              </div>
            </div>
          </header>
          {set ? <Impact key={set.sha} pr={baselineKey(repo)} set={set} /> : !busy(t) && (
            <div className="card space-y-2 px-4 py-4 text-small text-fg-2">
              <p className="font-medium text-fg-1">What Set up Storybook does, as one pull request</p>
              <ol className="list-decimal space-y-1 pl-5 text-fg-3">
                <li>Storybook per UI package, in layers: foundations, primitives, components, patterns, screens.</li>
                <li>Shared decorators for every provider, one named viewport set, data mocked at the network.</li>
                <li>Each component's stories as its full state matrix; one screen story per app.</li>
                <li>Design docs: foundations from the tokens, a page per primitive.</li>
                <li>The first shot: every story at phone and laptop, here.</li>
              </ol>
              <p className="text-meta text-fg-4">Say in the conversation what to start with, or what to leave out.</p>
            </div>
          )}
        </div>
      </div>
      <Conversation id={baselineKey(repo)} feed={feed} live={busy(t)} onSay={(text) => post({ say: text })} toast={toast} />
    </div>
  )
}

/** A design ticket: what it is, and the screens of the PRs that ship it. */
function TicketVisuals({ t, prs, onSelect }: { t: List['tickets'][number]; prs: ListPr[]; onSelect: (id: string) => void }) {
  const its = prs.filter((p) => t.prs.includes(p.id))
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="card px-4 py-3.5">
        <p className="text-meta text-fg-3">{t.id}</p>
        <h2 className="text-title font-semibold text-fg-1">{t.title}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-1.5">{t.labels.map((l) => <span key={l} className="inline-flex items-center gap-1 rounded-full bg-fill px-2 py-px text-micro text-fg-2"><Tag className="size-3" />{l}</span>)}
          <a href={t.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-meta text-accent-text hover:underline">Open the ticket<ExternalLink className="size-3" /></a></p>
      </header>
      {!its.length && <p className="card px-4 py-3 text-small text-fg-3">No pull request ships it yet: its screens show here once one does.</p>}
      {its.map((p) => (
        <button key={p.id} onClick={() => onSelect(p.id)} className="card flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
          <span className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
            {p.latest?.thumb ? <img src={shotUrl(p.id, p.latest.sha, p.latest.thumb)} alt="" loading="lazy" className="size-full object-cover object-top" /> : <Images className="size-4 text-fg-4" />}
          </span>
          <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-fg-1">{p.title}</span><span className="block text-meta text-fg-3">{p.repo}#{p.number}{p.latest ? ` · ${p.latest.count} screens` : ''}</span></span>
        </button>
      ))}
    </div>
  )
}

/** One PR's visuals: its screens before and after (one capture at a time, newest first), its switch, and the conversation. */
export function VisualsView({ id, feed, toast }: { id: string; feed: Activity[]; toast: Toast }) {
  const path = `/prs/${enc(id)}/visuals`
  const [ticking, setTicking] = useState(false)
  const q = useApi<Full>(path, { refetchInterval: ticking ? 3000 : 30_000 })
  const p = q.data
  useEffect(() => setTicking(busy(p?.task)), [p?.task?.state])
  const [sha, setSha] = useState<string>()
  const set = p?.sets.find((s) => s.sha === sha) ?? p?.sets[0]
  const post = (body: object, msg?: string) => api(path, body).then(() => { void refresh(path); void refresh('/visuals'); if (msg) toast(msg) }, (e: Error) => toast(e.message, 'error'))
  if (!p) return <div className="p-4"><Skeleton rows={6} /></div>
  const s = standing(p, set?.sha)
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-3 p-4">
          <header className="card px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-3">{p.repo}#{p.number} · {p.author}{p.tickets.length ? ` · ${p.tickets.join(', ')}` : ''}</p>
                <h2 className="text-title font-semibold text-fg-1">{p.title}</h2>
                <p className={`mt-0.5 text-meta ${TONE[s.tone]}`}>{s.text}</p>
                {p.ui && <p className="text-meta text-fg-4" title={p.ui.files.join('\n')}>{p.ui.is ? 'Changes what people see' : 'Doesn’t change what people see'}: {p.ui.why}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Pick label="Visuals for this PR" value={p.override ?? 'repo'} onChange={(v) => post({ override: v === 'repo' ? null : v }, v === 'repo' ? `Follows ${p.repo}: ${modeWord[p.mode]}` : v === 'on' ? 'Captured for every commit' : 'Not captured')}
                      options={[{ value: 'repo', label: `As its repo (${p.mode})` }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
                {busy(p.task)
                  ? <button onClick={() => post({ cancel: true }, 'Stopped')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Square className="size-3.5" />Stop</button>
                  : <button onClick={() => post({ capture: true }, 'Capturing its screens')} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Camera className="size-3.5" />Capture now</button>}
                <a href={p.url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1" title="Open the PR on GitHub"><ExternalLink className="size-3.5" /></a>
              </div>
            </div>
          </header>

          {p.sets.length > 1 && (
            <Tabs size="sm" label="Capture" value={set!.sha} onChange={(x) => setSha(x)}
                  options={p.sets.slice(0, 6).map((x) => ({ id: x.sha, label: `${x.sha.slice(0, 7)}${x.sha === p.headSha ? ' · latest' : ''}`, title: new Date(x.at).toLocaleString() }))} />
          )}
          {set?.source === 'app' && (
            <a href={`#${encodeURIComponent(baselineKey(p.repo))}`} className="card flex items-center gap-3 px-4 py-3 text-small transition-colors hover:bg-hover">
              <Wand className="size-4 shrink-0 text-accent-text" />
              <span className="min-w-0 flex-1 text-fg-2"><b className="font-medium text-fg-1">Captured from the running app.</b> Give {p.repo.split('/')[1]} a Storybook and every component is captured on its own, in each state, from then on.</span>
              <span className="shrink-0 font-medium text-accent-text">Set it up</span>
            </a>
          )}
          {set ? <Impact key={set.sha} pr={p.id} set={set} /> : (
            <div className="card flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Images className="size-6 text-fg-4" />
              <p className="text-small text-fg-3">{busy(p.task) ? 'Its screens show here as soon as they are captured.' : 'No screens yet. Capture now, or say below what to capture.'}</p>
            </div>
          )}
        </div>
      </div>
      <Conversation id={id} feed={feed} live={busy(p.task)} onSay={(text) => post({ say: text })} toast={toast} />
    </div>
  )
}

/** The marks layer: shown or not, for this browser (the eye in a capture's lens bar). */
const MARKS_KEY = 'design:marks'
function useMarks(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(MARKS_KEY) !== 'off' } catch { return true } })
  return [on, (v) => { setOn(v); try { localStorage.setItem(MARKS_KEY, v ? 'on' : 'off') } catch { /* private window */ } }]
}

/**
 * An image with its annotations: each changed part outlined in the accent, numbered, its words on hover, the focused
 * one lit and the others quiet. A mark is a way in: clicking it focuses that changed component.
 */
function Marked({ src, alt, marks, numbers, focus, onPart, compact }: {
  src: string; alt: string; marks: Mark[]; numbers: Map<string, number>; focus?: string; onPart?: (part: string) => void; compact?: boolean
}) {
  return (
    <span className="relative block">
      <img src={src} alt={alt} loading="lazy" className={`block w-full ${compact ? 'max-h-72 object-contain object-left-top' : ''}`} />
      {marks.map((m, i) => {
        const n = m.part ? numbers.get(m.part) : undefined, lit = !focus || focus === m.part
        return (
          <button key={i} type="button" onClick={(e) => { e.preventDefault(); if (m.part) onPart?.(m.part) }} title={[m.part, m.label].filter(Boolean).join(': ')}
                  style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w}%`, height: `${m.h}%`, animationDelay: `${i * 60}ms` }}
                  className={`group/mark absolute animate-[mark-in_320ms_var(--ease-spring)_both] rounded-ctl ring-2 transition-[box-shadow,background-color,opacity] duration-200 ${lit ? 'bg-accent/8 ring-accent shadow-[0_0_0_4px_var(--accent-soft)]' : 'opacity-40 ring-accent/50'} hover:bg-accent/14 hover:opacity-100`}>
            <span className="absolute -left-2.5 -top-2.5 flex size-5 items-center justify-center rounded-full bg-accent text-micro font-semibold text-on-accent shadow-e1 ring-2 ring-surface-1">{n ?? i + 1}</span>
            {m.label && <span className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 hidden w-max max-w-56 rounded-ctl bg-surface-2 px-2 py-1 text-left text-micro text-fg-1 shadow-e2 ring-1 ring-line group-hover/mark:block"><b className="font-semibold">{m.part}</b>{m.part ? ' · ' : ''}{m.label}</span>}
          </button>
        )
      })}
    </span>
  )
}

/** One capture's before and after, side by side (one alone when it is new or gone), each opening full size, its marks over it. */
function ShotPair({ pr, sha, shot, compact, marks = true, numbers = new Map(), focus, onPart }: {
  pr: string; sha: string; shot: Shot; compact?: boolean; marks?: boolean; numbers?: Map<string, number>; focus?: string; onPart?: (part: string) => void
}) {
  return (
    <div className={`grid gap-px bg-line ${shot.before && shot.after ? 'sm:grid-cols-2' : ''}`}>
      {(['before', 'after'] as const).map((side) => shot[side] ? (
        <figure key={side} className="bg-surface-1">
          <figcaption className="flex items-center gap-2 px-3 pt-2 label text-fg-4">{side === 'before' ? 'Before' : shot.before ? 'After' : 'New'}{shot.viewport ? <span className="font-normal normal-case">{shot.viewport}{shot.width ? ` · ${shot.width}px` : ''}</span> : null}
            <a href={shotUrl(pr, sha, shot[side]!)} target="_blank" rel="noreferrer" title="Open full size" className="ml-auto text-fg-4 hover:text-fg-1"><ExternalLink className="size-3" /></a>
          </figcaption>
          <div className="p-2">
            <Marked src={shotUrl(pr, sha, shot[side]!)} alt={`${shot.name}, ${side}`} compact={compact} numbers={numbers} focus={focus} onPart={onPart}
                    marks={marks ? (shot.marks ?? []).filter((m) => (m.side ?? 'after') === side) : []} />
          </div>
        </figure>
      ) : null)}
    </div>
  )
}

/**
 * The lens switch: one accent pill that glides to the lens you pick (the rail's own motion), each lens with its count.
 * Keys ← and → move between them.
 */
function LensSwitch<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number; icon: typeof Crosshair }[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number }>()
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-lens="${value}"]`)
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, options.length])
  const move = (d: number) => { const i = options.findIndex((o) => o.id === value); const n = options[(i + d + options.length) % options.length]; if (n) onChange(n.id) }
  return (
    <div ref={box} role="tablist" aria-label="Lens" onKeyDown={(e) => { if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1) }}
         className="relative inline-flex rounded-panel bg-fill/70 p-1 ring-1 ring-line">
      <span aria-hidden className="sel pointer-events-none absolute inset-y-1 rounded-ctl shadow-e1 transition-[left,width,opacity] duration-300 ease-[var(--ease-spring)]" style={{ left: pill?.left, width: pill?.width, opacity: pill ? 1 : 0 }} />
      {options.map((o) => (
        <button key={o.id} data-lens={o.id} role="tab" aria-selected={value === o.id} tabIndex={value === o.id ? 0 : -1} onClick={() => onChange(o.id)}
                className={`relative z-10 inline-flex items-center gap-1.5 rounded-ctl px-3 py-1.5 text-small font-medium transition-colors duration-200 ${value === o.id ? 'text-accent-text' : 'text-fg-3 hover:text-fg-1'}`}>
          <o.icon className="size-3.5" />{o.label}{o.count !== undefined && <span className={`tabular-nums text-micro ${value === o.id ? 'text-accent-text/80' : 'text-fg-4'}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Every capture as it came, one after the other: the whole set, for a capture made before the lenses. */
function Gallery({ pr, set }: { pr: string; set: VisualSet }) {
  return (
    <div className="space-y-3">
      {set.shots.map((s) => (
        <section key={`${s.name}:${s.viewport ?? ''}`} className="card overflow-hidden">
          <header className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2">
            <h3 className="text-small font-semibold text-fg-1">{s.name}</h3>
            {s.note && <p className="min-w-0 flex-1 text-meta text-fg-3">{s.note}</p>}
          </header>
          <ShotPair pr={pr} sha={set.sha} shot={s} />
        </section>
      ))}
    </div>
  )
}

const KIND_LABEL: Record<Kind, string> = { component: 'Component', layout: 'Layout', screen: 'Screen' }
const KindChip = ({ kind }: { kind: Kind }) => <span className="rounded-full bg-fill px-1.5 py-px text-micro font-medium text-fg-2">{KIND_LABEL[kind]}</span>
const away = (d: number) => (d <= 1 ? 'uses it directly' : `${d} imports away`)

/**
 * A capture through two lenses. Changed: each component the PR edits, in focus. Affected: where those changes show,
 * the components, layouts and screens that use them, each with the changed ones that reach it. A changed component
 * focuses the affected lens on itself.
 */
function Impact({ pr, set }: { pr: string; set: VisualSet }) {
  const im = set.impact
  const lensed = !!im || set.shots.some((x) => x.lens)
  type Lens = 'changed' | 'affected' | 'all'
  const ORDER: Lens[] = ['changed', 'affected', 'all']
  const [lens, setLensNow] = useState<Lens>(lensed ? 'changed' : 'all')
  const [from, setFrom] = useState(1) // the side the next lens slides in from
  const setLens = (l: Lens) => { setFrom(ORDER.indexOf(l) >= ORDER.indexOf(lens) ? 1 : -1); setLensNow(l) }
  const [focus, setFocus] = useState<string>()
  const [marks, setMarks] = useMarks()
  const changed = im?.changed ?? [...new Set(set.shots.filter((x) => x.lens === 'changed' && x.part).map((x) => x.part!))].map((name) => ({ name, file: '', kind: 'component' as Kind }))
  const affected = im?.affected ?? []
  const shotsOf = (name: string, l: 'changed' | 'affected') => set.shots.filter((x) => x.part === name && (x.lens ?? 'affected') === l)
  const usedIn = (name: string) => affected.filter((a) => a.via.includes(name))
  const shown = focus ? usedIn(focus) : affected
  // every changed component keeps one number, on every image and in every list: the same 3 is the same component
  const numbers = new Map(changed.map((c, i) => [c.name, i + 1]))
  const toPart = (part: string) => { setFocus(part); if (lens === 'changed') setLens('affected') }
  const marked = set.shots.some((x) => x.marks?.length)
  return (
    <div className="space-y-3">
      {set.summary && <div className="card px-4 py-3 text-small text-fg-2"><Md text={set.summary} /></div>}
      <div className="flex flex-wrap items-center gap-2">
        <LensSwitch value={lens} onChange={setLens}
                    options={[...(lensed ? [{ id: 'changed' as const, label: 'Changed', count: changed.length, icon: Crosshair }, { id: 'affected' as const, label: 'Affected', count: affected.length, icon: LayoutTemplate }] : []), { id: 'all' as const, label: 'All', count: set.shots.length, icon: Images }]} />
        {marked && <button onClick={() => setMarks(!marks)} aria-pressed={marks} title={marks ? 'Hide the annotations' : 'Show where each change sits'}
                           className={`inline-flex items-center gap-1.5 rounded-ctl px-2 py-1 text-meta font-medium transition-colors ${marks ? 'text-accent-text' : 'text-fg-3 hover:text-fg-1'}`}>{marks ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}Marks</button>}
        <span className="ml-auto text-meta text-fg-4">from {set.source === 'storybook' ? 'its Storybook stories' : 'the running app'} · {new Date(set.at).toLocaleString()}</span>
      </div>
      {/* each lens slides in from its side; the key restarts the motion on every switch */}
      <div key={lens} style={{ '--lens-from': from } as CSSProperties} className="animate-[lens-in_280ms_var(--ease-snappy)_both]">

      {lens === 'changed' && (
        <div className="grid gap-3 xl:grid-cols-2">
          {!changed.length && <p className="card px-4 py-3 text-small text-fg-3">The capture named no changed component. Ask in the conversation to capture them in focus.</p>}
          {changed.map((c) => {
            const shots = shotsOf(c.name, 'changed'), users = usedIn(c.name)
            return (
              <section key={c.name} className="card overflow-hidden">
                <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-accent text-micro font-semibold text-on-accent">{numbers.get(c.name)}</span>
                  <h3 className="text-small font-semibold text-fg-1">{c.name}</h3>
                  <KindChip kind={c.kind} />
                  {users.length > 0 && <button onClick={() => { setFocus(c.name); setLens('affected') }} className="ml-auto text-meta font-medium text-accent-text hover:underline">Used in {users.length}</button>}
                  {c.file && <p className="w-full truncate font-mono text-micro text-fg-4" title={c.file}>{c.file}</p>}
                </header>
                {shots.length ? shots.map((x) => (
                  <div key={`${x.name}:${x.viewport ?? ''}`}>
                    {(x.note || shots.length > 1) && <p className="px-4 pt-2 text-meta text-fg-3"><span className="font-medium text-fg-2">{x.name}</span>{x.note ? ` · ${x.note}` : ''}</p>}
                    <ShotPair pr={pr} sha={set.sha} shot={x} compact marks={marks} numbers={numbers} onPart={toPart} />
                  </div>
                )) : <p className="px-4 py-3 text-meta text-fg-3">Not captured on its own: see where it shows under Affected.</p>}
              </section>
            )
          })}
        </div>
      )}

      {lens === 'affected' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Focus on a changed component">
            <span className="text-meta text-fg-3">Reached by</span>
            <button onClick={() => setFocus(undefined)} aria-pressed={!focus} className={`rounded-full px-2 py-0.5 text-meta ring-1 ${!focus ? 'bg-accent/10 text-accent-text ring-accent/30' : 'text-fg-3 ring-line hover:text-fg-1'}`}>Any change</button>
            {changed.map((c) => (
              <button key={c.name} onClick={() => setFocus(focus === c.name ? undefined : c.name)} aria-pressed={focus === c.name}
                      className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-meta ring-1 transition-colors ${focus === c.name ? 'bg-accent/10 text-accent-text ring-accent/30' : 'text-fg-3 ring-line hover:text-fg-1'}`}><span className={`flex size-4 items-center justify-center rounded-full text-micro font-semibold ${focus === c.name ? 'bg-accent text-on-accent' : 'bg-fill text-fg-2'}`}>{numbers.get(c.name)}</span>{c.name}<span className="text-fg-4">{usedIn(c.name).length}</span></button>
            ))}
          </div>
          {!shown.length && <p className="card px-4 py-3 text-small text-fg-3">{focus ? `Nothing else uses ${focus}.` : 'The changes stay inside the changed components: nothing else uses them.'}</p>}
          {(['layout', 'screen', 'component'] as Kind[]).map((k) => {
            const rows = shown.filter((a) => a.kind === k).sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
            if (!rows.length) return null
            return (
              <section key={k} className="space-y-2">
                <h3 className="label px-0.5 text-fg-4">{KIND_LABEL[k]}s · {rows.length}</h3>
                {rows.map((a) => {
                  const shots = shotsOf(a.name, 'affected')
                  return (
                    <details key={a.file} className="card group/aff overflow-hidden" open={shots.length > 0 && rows.length <= 3}>
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-hover">
                        <ChevronRight className="size-3.5 text-fg-4 transition-transform group-open/aff:rotate-90" />
                        <span className="text-small font-medium text-fg-1">{a.name}</span>
                        <span className="text-meta text-fg-3">{away(a.depth)}</span>
                        <span className="flex flex-wrap gap-1">{a.via.map((v) => <span key={v} className={`inline-flex items-center gap-1 rounded-full py-px pl-0.5 pr-1.5 text-micro ring-1 ${v === focus ? 'bg-accent/10 text-accent-text ring-accent/30' : 'text-fg-3 ring-line'}`}><span className={`flex size-3.5 items-center justify-center rounded-full font-semibold ${v === focus ? 'bg-accent text-on-accent' : 'bg-fill text-fg-2'}`}>{numbers.get(v)}</span>{v}</span>)}</span>
                        <span className="ml-auto flex items-center gap-1 text-micro text-fg-4">{shots.length ? <><Images className="size-3" />{shots.length}</> : 'not captured'}</span>
                        <span className="w-full truncate font-mono text-micro text-fg-4" title={a.file}>{a.file}</span>
                      </summary>
                      {shots.map((x) => (
                        <div key={`${x.name}:${x.viewport ?? ''}`} className="border-t border-line">
                          {x.note && <p className="px-4 pt-2 text-meta text-fg-3">{x.note}</p>}
                          <ShotPair pr={pr} sha={set.sha} shot={x} marks={marks} numbers={numbers} focus={focus} onPart={setFocus} />
                        </div>
                      ))}
                      {!shots.length && <p className="border-t border-line px-4 py-2.5 text-meta text-fg-3">Not captured. Ask for it in the conversation: “capture {a.name}”.</p>}
                    </details>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}

      {lens === 'all' && <Gallery pr={pr} set={set} />}
      </div>
    </div>
  )
}

/** The conversation with the agent that captures: your words go on in its own session, and it captures again. */
function Conversation({ id, feed, live, onSay, toast }: { id: string; feed: Activity[]; live: boolean; onSay: (text: string) => Promise<unknown>; toast: Toast }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const shown = useMemo(() => feed, [feed])
  const send = () => { const t = text.trim(); if (!t) return; setText(''); void onSay(t) }
  return (
    <aside aria-label="Conversation" className="hidden w-[clamp(300px,34%,460px)] shrink-0 flex-col border-l border-line lg:flex">
      <p className="label border-b border-line px-4 py-2.5 text-fg-4">Conversation</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length ? <ActivityFeed key={id} feed={shown} live={live} toast={toast} />
          : <p className="px-4 py-3 text-small text-fg-3">Say what to look at: a screen, a state, a width. The agent captures it, and keeps what you said for the next commits.</p>}
      </div>
      <div className="p-2.5">
        <div className="flex items-end gap-2 rounded-2xl bg-surface-1 p-2 shadow-e1 ring-1 ring-line focus-within:ring-accent/40">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Also at phone width, the empty state…"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    className="max-h-[160px] flex-1 resize-none bg-transparent px-2 py-1.5 text-body outline-none placeholder:text-fg-4" />
          <button onClick={send} disabled={!text.trim()} aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent disabled:opacity-40"><ArrowUp className="size-4" /></button>
        </div>
      </div>
    </aside>
  )
}

/**
 * Dev's glance at Design: a PR's latest screens, after only, handed to `children` to frame (nothing at all when it has
 * none, so the frame doesn't show either). Clicking one opens Design.
 */
export function VisualsGlance({ id, children }: { id: string; children: (strip: ReactNode) => ReactNode }) {
  const q = useApi<Full>(`/prs/${enc(id)}/visuals`, { refetchInterval: 60_000 })
  const set = q.data?.sets[0]
  if (!set) return null
  // the changed components in focus first: what the PR is about, before where it shows
  const shown = [...set.shots.filter((s) => s.lens === 'changed'), ...set.shots.filter((s) => s.lens !== 'changed')].filter((s) => s.after ?? s.before).slice(0, 4)
  const onOpen = () => { location.assign(`/design#${encodeURIComponent(id)}`) }
  return <>{children(
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        {shown.map((s) => (
          <button key={s.name} onClick={onOpen} title={s.note ?? s.name} className="overflow-hidden rounded-ctl bg-fill ring-1 ring-line hover:ring-accent/50">
            <img src={shotUrl(id, set.sha, (s.after ?? s.before)!)} alt={s.name} loading="lazy" className="aspect-[16/10] w-full object-cover object-top" />
          </button>
        ))}
      </div>
      {set.summary && <p className="line-clamp-3 text-meta text-fg-3">{set.summary}</p>}
    </div>,
  )}</>
}
