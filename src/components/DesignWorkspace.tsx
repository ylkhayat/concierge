// Design: what the pull requests look like, before and after, without opening them. Built like Plans: the list on the
// left (the PRs that change what people see, and the tickets marked design), and the open one beside it: its screens,
// before and after, and a conversation with the agent that captured them ("also at phone width": it captures again).
import { ArrowUp, Check, ChevronRight, Crosshair, ExternalLink, Eye, EyeOff, Images, LayoutGrid, LayoutTemplate, LoaderCircle, MessageSquare, Palette, Pin, Search, Square, Camera, Tag, Wand, ZoomIn, ZoomOut } from 'lucide-react'
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Activity } from '../../server/runner.ts'
import type { Kind, Mark, Part, Shot, VisualSet, VisualsMode, UiCheck } from '../../server/visuals.ts'
import type { VisualsTask } from '../../server/store.ts'
import { api, enc } from '../lib.ts'
import { refresh, useApi } from '../query.ts'
import { partAt } from '../board.ts'
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
type RepoRow = { repo: string; mode: VisualsMode; task?: VisualsTask & { prUrl?: string }; baseline?: { sha: string; at: string; count: number; thumb?: string; screens?: number; domains?: number }; fromApp: boolean }
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
        {repos.length > 0 && <p className="label px-2.5 pb-1 pt-3 text-fg-4">Blueprints</p>}
        {repos.map((r) => (
          <button key={r.repo} onClick={() => onSelect(baselineKey(r.repo))} className={`flex gap-2 rounded-lg px-2 py-1.5 text-left ${current === baselineKey(r.repo) ? 'sel' : 'hover:bg-hover'}`}>
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
              {r.baseline?.thumb ? <img src={shotUrl(baselineKey(r.repo), r.baseline.sha, r.baseline.thumb)} alt="" loading="lazy" className="size-full object-cover object-top" /> : <LayoutTemplate className="size-4 text-fg-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-small font-medium text-fg-1">{busy(r.task) && <LoaderCircle className="size-3 shrink-0 animate-spin text-run" />}<span className="truncate">{r.repo.split('/')[1]}</span></span>
              <span className={`block truncate text-micro ${r.baseline ? 'text-fg-3' : 'text-wait-text'}`}>{r.baseline?.screens ? `${r.baseline.screens} screens in ${r.baseline.domains} domains` : busy(r.task) ? (r.baseline ? 'Making its blueprint…' : 'Setting its Storybook up…') : r.baseline ? 'Stories, no blueprint yet' : 'No Storybook yet'}</span>
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
  const [talk, setTalk] = useState<boolean>()
  const [view, setView] = useState<'map' | 'components'>('map')
  const q = useApi<{ repo: string; mode: VisualsMode; task?: VisualsTask & { prUrl?: string }; sets: VisualSet[] }>(path, { refetchInterval: ticking ? 3000 : 30_000 })
  const b = q.data, t = b?.task
  useEffect(() => setTicking(busy(t)), [t?.state])
  const post = (body: object, msg?: string) => api(path, body).then(() => { void refresh(path); void refresh('/visuals'); if (msg) toast(msg) }, (e: Error) => toast(e.message, 'error'))
  if (!b) return <div className="p-4"><Skeleton rows={6} /></div>
  const set = b.sets[0]
  // the blueprint: the map of the project, its screens by domain and step. It is the baseline; the components' own
  // shots (each one's stories) are beside it, a tab away
  const screens = set?.shots.filter((x) => x.domain && (x.after ?? x.before)) ?? []
  const mapped = screens.length > 0, onMap = mapped && view === 'map'
  const parts = set?.impact?.changed ?? []
  const numbers = new Map(parts.map((c, i) => [c.name, i + 1]))
  // the conversation: a click away (the onboarding and the map say where things stand)
  const showTalk = talk ?? false
  // what the agent last said, for the onboarding's progress (the whole of it is the conversation)
  const said = busy(t) ? [...feed].reverse().find((x) => x.kind === 'text' || x.kind === 'result')?.text : undefined
  const making = !!(t as { board?: boolean } | undefined)?.board || !!set
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          <header className="card px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-3">{repo} · blueprint</p>
                <h2 className="text-title font-semibold text-fg-1">{mapped ? `The map of ${repo.split('/')[1]}` : `${repo.split('/')[1]}: no map yet`}</h2>
                <p className={`mt-0.5 text-meta ${t?.state === 'failed' ? 'text-wait-text' : busy(t) ? 'text-run-text' : 'text-fg-3'}`}>
                  {t?.state === 'running' ? `${making ? 'Making its map' : 'Setting its Storybook up'}${t.machine ? ` on ${t.machine}` : ''}…`
                    : t?.state === 'queued' ? 'Waiting for a machine with its checkout'
                    : t?.state === 'failed' ? `It didn't finish: ${t.error ?? 'it failed'}`
                    : mapped ? `${screens.length} screens in ${new Set(screens.map((x) => x.domain)).size} domains, ${parts.length} components · ${new Date(set!.at).toLocaleString()}`
                    : set ? `${parts.length} components in stories, ${new Date(set.at).toLocaleString()}`
                    : 'Not set up yet'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {set && <Tabs size="sm" label="What to look at" value={view} onChange={setView} options={[{ id: 'map' as const, label: 'Map' }, { id: 'components' as const, label: `Components · ${parts.length}` }]} />}
                <button onClick={() => setTalk(!showTalk)} aria-pressed={showTalk} title={showTalk ? 'Hide the conversation' : 'Talk to the agent that set it up'} className={`btn-ghost btn-sm inline-flex items-center gap-1.5 ${showTalk ? 'text-accent-text' : ''}`}><MessageSquare className="size-3.5" />Conversation</button>
                {t?.prUrl && <a href={t.prUrl} target="_blank" rel="noreferrer" className="btn-outline btn-sm inline-flex items-center gap-1.5"><ExternalLink className="size-3.5" />Its PR</a>}
                {busy(t)
                  ? <button onClick={() => post({ cancel: true }, 'Stopped')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Square className="size-3.5" />Stop</button>
                  : mapped && <button onClick={() => post({ board: true }, 'Drawing the map again, from the code as it is now')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Wand className="size-3.5" />Draw it again</button>}
              </div>
            </div>
          </header>
          {onMap ? <Blueprint pr={baselineKey(repo)} set={set!} screens={screens} parts={parts} numbers={numbers} onStates={() => setView('components')} fill />
            : set && view === 'components' ? <Impact key={set.sha} pr={baselineKey(repo)} set={set} noBoard />
            : <MapOnboarding name={repo.split('/')[1]} has={set ? parts.length : 0} task={t} said={said}
                             onStart={() => (set ? post({ board: true }, 'Making the map: its screens, the built Storybook, every component marked') : post({ setup: true }, 'Setting its Storybook up, then its map'))}
                             onStop={() => post({ cancel: true }, 'Stopped')} onComponents={set ? () => setView('components') : undefined} onTalk={() => setTalk(true)} />}
        </div>
      </div>
      {showTalk && <Conversation id={baselineKey(repo)} feed={feed} live={busy(t)} onSay={(text) => post({ say: text })} toast={toast} />}
    </div>
  )
}

/**
 * No map yet: what the blueprint is, drawn small, and the one thing to do. With stories already there (`has`), only
 * the map is left to make; while it is being made, the steps, and the agent's last words.
 */
function MapOnboarding({ name, has, task, said, onStart, onStop, onComponents, onTalk }: {
  name: string; has: number; task?: VisualsTask & { board?: boolean }; said?: string; onStart: () => void; onStop: () => void; onComponents?: () => void; onTalk: () => void
}) {
  const working = busy(task), failed = task?.state === 'failed'
  // a picture of it: three domains, their steps, one component lit across them
  const ROWS = [[[18, 30, 20, 30], [44, 30, 20, 30], [70, 30, 20, 30]], [[18, 22, 30, 50], [56, 22, 34, 22]], [[18, 26, 44, 20], [18, 54, 20, 22], [70, 26, 20, 48]]]
  const LIT = new Set(['0:1', '1:1', '2:1', '0:2'])
  const steps = [
    { done: has > 0, text: has > 0 ? `Storybook and stories: ${has} components` : 'Storybook, with every component in stories', now: working && !has },
    { done: false, text: 'The screens, as a storyline: each domain, step by step', now: working && has > 0 },
    { done: false, text: 'The Storybook built in, so the screens are the pages themselves' },
    { done: false, text: 'Every component found on every screen' },
  ]
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-10 text-center">
      <div aria-hidden className="w-full max-w-md rounded-panel p-4 ring-1 ring-line" style={{ backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        <div className="space-y-2.5">
          {ROWS.map((row, r) => (
            <div key={r} className="flex items-center gap-2.5">
              <span className="h-1.5 w-10 shrink-0 rounded-full bg-fill-strong" />
              {[0, 1, 2].map((c) => (
                <span key={c} className={`relative aspect-[16/10] flex-1 overflow-hidden rounded-ctl bg-surface-1 shadow-e1 ring-1 ring-line ${working ? 'animate-pulse' : ''}`} style={{ animationDelay: `${(r * 3 + c) * 120}ms` }}>
                  {row.map(([x, y, w, h], i) => <span key={i} className={`absolute rounded-[2px] ${LIT.has(`${r}:${i}`) && c !== 2 - r ? 'bg-accent/70 ring-1 ring-accent' : 'bg-fill-strong'}`} style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }} />)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <h2 className="mt-7 text-display font-semibold tracking-tight text-fg-1">{working ? `Drawing the map of ${name}` : `A map of ${name}`}</h2>
      <p className="mt-2 max-w-lg text-body text-fg-3">Every screen of the app on one board, small and live: a row for each domain, a column for each step and variation. Point at a component and it lights up wherever it is used.</p>

      <ol className="mt-6 w-full max-w-md space-y-2 text-left">
        {steps.map((x, i) => (
          <li key={i} className="flex items-center gap-2.5 text-small">
            <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-semibold ${x.done ? 'bg-ok/15 text-ok-text' : x.now ? 'bg-accent/15 text-accent-text' : 'bg-fill text-fg-3'}`}>
              {x.done ? <Check className="size-3" strokeWidth={3} /> : x.now ? <LoaderCircle className="size-3 animate-spin" /> : i + 1}
            </span>
            <span className={x.done ? 'text-fg-3' : x.now ? 'font-medium text-fg-1' : 'text-fg-2'}>{x.text}</span>
          </li>
        ))}
      </ol>

      {working ? (
        <div className="mt-7 w-full max-w-md space-y-3">
          {said && <p className="line-clamp-3 rounded-card bg-fill/60 px-3.5 py-2.5 text-left text-small text-fg-2 ring-1 ring-line">{said}</p>}
          <p className="text-meta text-fg-3">{task?.state === 'queued' ? 'Waiting for a machine that has its checkout.' : `An agent is at it${task?.machine ? ` on ${task.machine}` : ''}. You can leave this page: the map shows here when it is done.`}</p>
          <p className="flex items-center justify-center gap-3">
            <button onClick={onTalk} className="btn-outline btn-sm inline-flex items-center gap-1.5"><MessageSquare className="size-3.5" />Follow it</button>
            <button onClick={onStop} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Square className="size-3.5" />Stop</button>
          </p>
        </div>
      ) : (
        <div className="mt-7 space-y-3">
          {failed && <p className="max-w-md rounded-card bg-wait/10 px-3.5 py-2.5 text-left text-small text-wait-text ring-1 ring-wait/20">The last try didn't finish: {task?.error ?? 'it failed'}</p>}
          <button onClick={onStart} className="btn-primary btn-lg inline-flex items-center gap-2"><LayoutGrid className="size-4" />{has ? (failed ? 'Try again' : 'Make the map') : 'Set up Storybook and make the map'}</button>
          <p className="max-w-md text-meta text-fg-4">{has ? 'The agent that set the Storybook up goes on: it adds the screens and their components, as commits on its pull request.' : 'One agent run, one pull request: Storybook in layers, every component in stories, the design docs, then the map.'}</p>
          {onComponents && <button onClick={onComponents} className="text-meta font-medium text-accent-text hover:underline">See its {has} components' stories</button>}
        </div>
      )}
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
                <Tabs size="sm" label="Visuals for this PR" value={p.override ?? 'repo'} onChange={(v) => post({ override: v === 'repo' ? null : v }, v === 'repo' ? `Follows ${p.repo}: ${modeWord[p.mode]}` : v === 'on' ? 'Captured for every commit' : 'Not captured')}
                      options={[{ id: 'repo' as const, label: `As its repo · ${p.mode}` }, { id: 'on' as const, label: 'On' }, { id: 'off' as const, label: 'Off' }]} />
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

/** Where a mark sits on its image, as the style of a box over it. */
const boxOf = (m: Mark): CSSProperties => ({ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w}%`, height: `${m.h}%` })

/**
 * A screen on the board, small: the page itself when the baseline has its Storybook (`live`: the story's own page,
 * rendered at its real size and scaled down, so it is the app, not a picture of it), else its screenshot. Every
 * component on it is a way in. With a component lit, the page falls back behind a scrim with a window cut for each of
 * its instances.
 *
 * Built to be many: no element per component (the pointer's place is worked out against the marks), drawn again only
 * when its own state changes (`mode`: idle, dimmed, or the component lit on it), skipped by the browser while off
 * screen. A live page is only there while its screen is near the board's view (its screenshot holds the place before
 * and after), and takes no pointer: the board does.
 */
const Mini = memo(function Mini({ src, live, shot, mode, onHover, onPin }: { src: string; live?: string; shot: Shot; mode: string; onHover: (part?: string) => void; onPin: (part: string) => void }) {
  const marks = shot.marks ?? []
  const lit = mode !== 'idle' && mode !== 'dim' ? marks.filter((m) => m.part === mode) : []
  const frame = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false), [ready, setReady] = useState(false)
  useEffect(() => {
    if (!live || !frame.current) return
    const io = new IntersectionObserver(([e]) => { setNear(e.isIntersecting); if (!e.isIntersecting) setReady(false) }, { rootMargin: '240px' })
    io.observe(frame.current)
    return () => io.disconnect()
  }, [live])
  const W = shot.width ?? 1280, H = shot.height ?? Math.round(W * 0.625)
  const mask = `m${useId().replace(/\W/g, '')}`
  const at = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    return partAt(marks, ((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100)
  }
  return (
    <figure className={`transition-opacity duration-300 ease-[var(--ease-out)] [contain-intrinsic-size:auto_200px] [content-visibility:auto] ${mode === 'dim' ? 'opacity-20' : ''}`}>
      <div ref={frame} style={live ? { aspectRatio: `${W} / ${H}` } : undefined} className={`relative cursor-pointer overflow-hidden rounded-ctl bg-surface-1 shadow-e1 ring-1 ${lit.length ? 'ring-accent/50' : 'ring-line'}`}
           onMouseMove={(e) => onHover(at(e))} onMouseLeave={() => onHover(undefined)} onClick={(e) => { const part = at(e); if (part) onPin(part) }}>
        <img src={src} alt={shot.name} loading="lazy" decoding="async" draggable={false} className={`select-none ${live ? 'absolute inset-0 size-full object-cover object-top' : 'block w-full'}`} />
        {live && near && (
          <iframe src={live} title={shot.name} tabIndex={-1} aria-hidden loading="lazy" sandbox="allow-scripts allow-same-origin" onLoad={() => setReady(true)}
                  style={{ width: W, height: H, transform: `scale(calc(var(--cell) / ${W}))`, transformOrigin: '0 0' }}
                  className={`pointer-events-none absolute left-0 top-0 border-0 bg-surface-1 transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`} />
        )}
        {lit.length > 0 && (
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full animate-[fade-in_200ms_var(--ease-out)_both]">
            <mask id={mask}><rect width="100" height="100" fill="white" />{lit.map((m, i) => <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} fill="black" />)}</mask>
            <rect width="100" height="100" mask={`url(#${mask})`} style={{ fill: 'color-mix(in oklch, var(--surface-1) 48%, transparent)' }} />
          </svg>
        )}
        {lit.map((m, i) => <span key={i} aria-hidden style={boxOf(m)} className="pointer-events-none absolute animate-[fade-in_200ms_var(--ease-out)_both] rounded-[2px] shadow-[0_0_0_3px_var(--accent-soft)] ring-[1.5px] ring-accent" />)}
      </div>
      <figcaption className="mt-1.5 truncate text-micro text-fg-3" title={shot.note}>{shot.variant ?? shot.name}</figcaption>
    </figure>
  )
})

/**
 * The blueprint of the app: every screen in small, a row per domain, a column per step of its storyline; every
 * component on the left. Rest on a component, there or on any screen, and the board falls back, leaving it lit wherever
 * it shows, with a card on where it is used. A click keeps it lit.
 */
function Blueprint({ pr, set, screens, parts, numbers, onStates, fill }: { pr: string; set: VisualSet; screens: Shot[]; parts: Part[]; numbers: Map<string, number>; onStates: () => void; fill?: boolean }) {
  const [hover, setHover] = useState<string>(), [pinned, setPinned] = useState<string>(), [find, setFind] = useState('')
  const [zoom, setZoom] = useState(() => { try { return Number(localStorage.getItem('design:board-zoom')) || 220 } catch { return 220 } })
  // live: the screens as the pages themselves (a baseline with its Storybook built beside it); yours to turn off
  const canLive = pr.startsWith('repo:') && screens.some((x) => x.book && x.story)
  const [liveOn, setLiveOn] = useState(() => { try { return localStorage.getItem('design:board-live') !== 'off' } catch { return true } })
  const setLive = (on: boolean) => { setLiveOn(on); try { localStorage.setItem('design:board-live', on ? 'on' : 'off') } catch { /* private window */ } }
  const liveOf = (sh: Shot) => (canLive && liveOn && sh.book && sh.story ? `/api/visuals/sb/${pr.replace(/[^\w.-]+/g, '-')}/${set.sha}/${sh.book}/iframe.html?id=${encodeURIComponent(sh.story)}&viewMode=story` : undefined)
  const zoomTo = (z: number) => { const v = Math.min(440, Math.max(120, z)); setZoom(v); try { localStorage.setItem('design:board-zoom', String(v)) } catch { /* private window */ } }
  const hot = hover ?? pinned
  const pin = useCallback((part: string) => setPinned((x) => (x === part ? undefined : part)), [])
  // the pointer moves many times a frame: the lit component changes at most once a frame, and only when it differs
  const next = useRef<{ part?: string; frame?: number }>({})
  const onHover = useCallback((part?: string) => {
    next.current.part = part
    next.current.frame ??= requestAnimationFrame(() => { next.current.frame = undefined; setHover((was) => (was === next.current.part ? was : next.current.part)) })
  }, [])
  useEffect(() => () => { if (next.current.frame) cancelAnimationFrame(next.current.frame) }, [])
  const domains = useMemo(() => [...new Set(screens.map((x) => x.domain!))], [screens])
  // where each component shows: the screens that mark it
  const usage = useMemo(() => {
    const by = new Map<string, Shot[]>()
    for (const sh of screens) for (const name of new Set((sh.marks ?? []).map((m) => m.part).filter((x): x is string => !!x))) by.set(name, [...(by.get(name) ?? []), sh])
    return by
  }, [screens])
  // the components: the ones the capture named, and any a screen marks besides; the most used first
  const names = useMemo(() => [...new Set([...parts.map((x) => x.name), ...usage.keys()])].sort((a, b) => (usage.get(b)?.length ?? 0) - (usage.get(a)?.length ?? 0) || a.localeCompare(b)), [parts, usage])
  const shown = names.filter((n) => n.toLowerCase().includes(find.trim().toLowerCase()))
  const cols = Math.max(1, ...domains.map((d) => screens.filter((x) => x.domain === d).length))
  // the small image until the screens are large enough to need the whole one
  const url = (sh: Shot) => shotUrl(pr, set.sha, (zoom <= 300 && sh.thumb) || (sh.after ?? sh.before)!)
  // which components each screen shows, looked up once: a screen's state on a hover is then one lookup
  const has = useMemo(() => new Map(screens.map((sh) => [sh, new Set((sh.marks ?? []).map((m) => m.part))])), [screens])
  const modeOf = (sh: Shot) => (!hot ? 'idle' : has.get(sh)?.has(hot) ? hot : 'dim')
  const part = hot ? parts.find((x) => x.name === hot) : undefined, used = hot ? usage.get(hot) ?? [] : []
  const story = hot ? set.shots.find((x) => x.lens === 'changed' && x.part === hot && x.after) : undefined
  return (
    <div className="card relative flex overflow-hidden" style={{ height: fill ? 'max(24rem, calc(100vh / var(--z, 1) - 11rem))' : 'clamp(24rem, calc(100vh / var(--z, 1) - 17.5rem), 64rem)' }}>
      <aside aria-label="Components" className="flex w-52 shrink-0 flex-col border-r border-line">
        <label className="m-2 flex items-center gap-1.5 rounded-ctl bg-fill px-2 py-1"><Search className="size-3.5 shrink-0 text-fg-4" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`${names.length} components`} aria-label="Find a component" className="w-full bg-transparent text-small outline-none placeholder:text-fg-4" /></label>
        <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-1" onMouseLeave={() => onHover(undefined)}>
          {shown.map((n) => {
            const on = hot === n, count = usage.get(n)?.length ?? 0
            return (
              <li key={n}>
                <button onMouseEnter={() => onHover(n)} onFocus={() => onHover(n)} onBlur={() => onHover(undefined)} onClick={() => pin(n)} aria-pressed={pinned === n}
                        className={`flex w-full items-center gap-2 rounded-ctl px-2 py-1 text-left text-small transition-colors duration-150 ${on ? 'sel text-accent-text' : hot ? 'text-fg-4' : 'text-fg-2 hover:bg-hover'}`}>
                  <span className={`flex size-4 shrink-0 items-center justify-center rounded-full text-micro font-semibold transition-colors ${on ? 'bg-accent text-on-accent' : 'bg-fill text-fg-3'}`}>{numbers.get(n) ?? '·'}</span>
                  <span className="min-w-0 flex-1 truncate">{n}</span>
                  {pinned === n ? <Pin className="size-3 shrink-0" /> : <span className={`shrink-0 tabular-nums text-micro ${count ? '' : 'opacity-40'}`}>{count}</span>}
                </button>
              </li>
            )
          })}
          {!shown.length && <li className="px-2 py-1.5 text-meta text-fg-4">None matches.</li>}
        </ul>
      </aside>

      <div className="relative min-w-0 flex-1">
        <div className="absolute right-3 top-2.5 z-20 flex items-center gap-1.5 rounded-ctl bg-surface-2/90 px-2 py-1 shadow-e1 ring-1 ring-line backdrop-blur">
          {canLive && <button onClick={() => setLive(!liveOn)} role="switch" aria-checked={liveOn} title={liveOn ? 'The screens are the pages themselves, from the Storybook. Click for their screenshots' : 'The screens are screenshots. Click for the pages themselves'}
                              className={`mr-1 inline-flex items-center gap-1.5 border-r border-line pr-2 text-meta font-medium ${liveOn ? 'text-accent-text' : 'text-fg-3 hover:text-fg-1'}`}><span className={`size-1.5 rounded-full ${liveOn ? 'animate-pulse bg-accent' : 'bg-fg-4'}`} />Live</button>}
          <button onClick={() => zoomTo(zoom - 40)} aria-label="Smaller" className="text-fg-3 hover:text-fg-1"><ZoomOut className="size-3.5" /></button>
          <input type="range" min={120} max={440} step={20} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Size of the screens" className="w-20 accent-current text-accent" />
          <button onClick={() => zoomTo(zoom + 40)} aria-label="Larger" className="text-fg-3 hover:text-fg-1"><ZoomIn className="size-3.5" /></button>
        </div>
        {/* the board: a faint grid under the screens, moving with them */}
        <div className="size-full overflow-auto p-5" style={{ backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)', backgroundSize: '28px 28px', backgroundAttachment: 'local' }}>
          <div className="grid w-max items-start gap-x-4 gap-y-7" style={{ '--cell': zoom, gridTemplateColumns: `6.5rem repeat(${cols}, ${zoom}px)` } as CSSProperties}>
            {domains.map((d) => {
              const row = screens.filter((x) => x.domain === d)
              const lit = !hot || row.some((x) => has.get(x)?.has(hot))
              return (
                <Fragment key={d}>
                  <div className={`sticky left-0 z-10 -ml-5 self-stretch bg-gradient-to-r from-[var(--surface-1)] from-70% to-transparent pl-5 pr-3 pt-1 transition-opacity duration-300 ${lit ? '' : 'opacity-40'}`}>
                    <p className="text-small font-semibold text-fg-1">{d}</p>
                    <p className="text-micro text-fg-4">{row.length} step{row.length === 1 ? '' : 's'}</p>
                  </div>
                  {row.map((sh) => <Mini key={`${sh.name}:${sh.after ?? ''}`} src={url(sh)} live={liveOf(sh)} shot={sh} mode={modeOf(sh)} onHover={onHover} onPin={pin} />)}
                  {Array.from({ length: cols - row.length }, (_, i) => <span key={i} aria-hidden />)}
                </Fragment>
              )
            })}
          </div>
        </div>

        {/* where the lit component is used: floats over the board's corner, and stays while it is pinned */}
        {hot && (
          <div key={hot} role="status" className="pointer-events-none absolute bottom-3 right-3 z-20 w-72 animate-[pop-in_180ms_var(--ease-snappy)_both] rounded-card bg-surface-2/95 p-3 shadow-e3 ring-1 ring-line backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold text-on-accent">{numbers.get(hot) ?? '·'}</span>
              <span className="min-w-0 flex-1 truncate text-small font-semibold text-fg-1">{hot}</span>
              {part && <KindChip kind={part.kind} />}
            </div>
            {part?.file && <p className="mt-1 truncate font-mono text-micro text-fg-4" title={part.file}>{part.file}</p>}
            {story && <img src={shotUrl(pr, set.sha, story.after!)} alt="" className="mt-2 max-h-20 w-full rounded-ctl bg-fill object-contain ring-1 ring-line" />}
            <p className="mt-2 text-meta text-fg-2">{used.length ? `On ${used.length} of ${screens.length} screens, in ${new Set(used.map((x) => x.domain)).size} of ${domains.length} domains` : 'On no screen of the board: only in its own stories'}</p>
            <ul className="mt-1 space-y-0.5">
              {domains.filter((d) => used.some((x) => x.domain === d)).slice(0, 6).map((d) => (
                <li key={d} className="flex gap-1.5 text-micro"><span className="shrink-0 font-medium text-fg-2">{d}</span><span className="truncate text-fg-3">{used.filter((x) => x.domain === d).map((x) => x.variant).join(', ')}</span></li>
              ))}
            </ul>
            <p className="pointer-events-auto mt-2 flex items-center gap-2 text-micro text-fg-4">
              {pinned === hot ? <><Pin className="size-3" />Pinned: click it again to let go</> : 'Click to keep it lit'}
              {story && <button onClick={onStates} className="ml-auto font-medium text-accent-text hover:underline">Its states</button>}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A capture through two lenses. Changed: each component the PR edits, in focus. Affected: where those changes show,
 * the components, layouts and screens that use them, each with the changed ones that reach it. A changed component
 * focuses the affected lens on itself.
 */
function Impact({ pr, set, noBoard }: { pr: string; set: VisualSet; noBoard?: boolean }) {
  const im = set.impact
  const lensed = !!im || set.shots.some((x) => x.lens)
  type Lens = 'board' | 'changed' | 'affected' | 'all'
  const ORDER: Lens[] = ['board', 'changed', 'affected', 'all']
  const screens = noBoard ? [] : set.shots.filter((x) => x.domain && (x.after ?? x.before)) // the board: whole screens, by domain and step (a baseline shows its own, as its page)
  const [lens, setLensNow] = useState<Lens>(screens.length ? 'board' : lensed ? 'changed' : 'all')
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
                    options={[...(screens.length ? [{ id: 'board' as const, label: 'Blueprint', count: screens.length, icon: LayoutGrid }] : []), ...(lensed ? [{ id: 'changed' as const, label: 'Changed', count: changed.length, icon: Crosshair }, { id: 'affected' as const, label: 'Affected', count: affected.length, icon: LayoutTemplate }] : []), { id: 'all' as const, label: 'All', count: set.shots.length, icon: Images }]} />
        {marked && lens !== 'board' && <button onClick={() => setMarks(!marks)} aria-pressed={marks} title={marks ? 'Hide the annotations' : 'Show where each change sits'}
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

      {lens === 'board' && <Blueprint pr={pr} set={set} screens={screens} parts={changed} numbers={numbers} onStates={() => setLens('changed')} />}
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
