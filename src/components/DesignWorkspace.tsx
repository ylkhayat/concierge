// Design: what the pull requests look like, before and after, without opening them. Built like Plans: the list on the
// left (the PRs that change what people see, and the tickets marked design), and the open one beside it: its screens,
// before and after, and a conversation with the agent that captured them ("also at phone width": it captures again).
import { ArrowLeft, ArrowUp, Check, ChevronRight, Component, SwatchBook, Crosshair, ExternalLink, Eye, EyeOff, Images, LayoutGrid, LayoutTemplate, LoaderCircle, MessageSquare, Palette, Pin, Search, Square, Camera, Tag, Wand, X, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Activity } from '../../server/runner.ts'
import type { Kind, Mark, Part, Shot, VisualSet, VisualsMode, UiCheck } from '../../server/visuals.ts'
import type { VisualsTask } from '../../server/store.ts'
import { api, enc, useIsDark, sendKey } from '../lib.ts'
import type { DesignView } from '../modes.ts'
import type { Token, TokenBook } from '../../server/tokens.ts'
import type { DraftChange, TokenDraft } from '../../server/tokenDraft.ts'
import { draftCss, valueWith } from '../tokenCss.ts'
import { refresh, remember, useApi } from '../query.ts'
import { bare, byApp, focusOn, layout, partAt } from '../board.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { Skeleton } from './Connections.tsx'
import { Md } from './Md.tsx'
import { Tabs } from './Tabs.tsx'
import { inSettings } from '../copy.ts'

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

/**
 * `focus`: the workspace (a repository) Design shows, else every one; `ticketRepo`: a ticket's repository, as the board
 * knows it. `feedOf`: an item's conversation, never the item open before it (its key: a PR id, `repo:`, `ticket:`).
 */
export function DesignWorkspace({ view = 'map', selected, onSelect, feedOf, focus, ticketRepo, toast }: {
  view?: DesignView; selected?: string; onSelect: (id?: string) => void; feedOf: (item: string) => Activity[]; focus?: string; ticketRepo: (id: string) => string | undefined; toast: Toast
}) {
  const list = useApi<List>('/visuals', { refetchInterval: 30_000 })
  const mine = (repo?: string) => !focus || repo === focus
  const prs = (list.data?.prs ?? []).filter((p) => mine(p.repo)), repos = (list.data?.repos ?? []).filter((r) => mine(r.repo))
  // a ticket is the workspace's when its PRs are, or the board puts it there
  const tickets = (list.data?.tickets ?? []).filter((t) => !focus || t.prs.some((id) => prs.some((p) => p.id === id)) || ticketRepo(t.id) === focus)
  // what is open: the item picked, while it is in this workspace; else its first PR, then its first blueprint (another
  // workspace's item, kept from before a switch, is never drawn)
  const listed = (id: string) => prs.some((p) => p.id === id) || repos.some((r) => baselineKey(r.repo) === id) || tickets.some((t) => `ticket:${t.id}` === id)
  // the Components and Tokens views are a project's (a repository's): the one the item open is in, else the first
  const aspect = view !== 'map'
  const repoOf = (id?: string) => id?.startsWith('repo:') ? id.slice(5) : id?.startsWith('ticket:') ? ticketRepo(id.slice(7)) : prs.find((p) => p.id === id)?.repo
  const own = repoOf(selected)
  const current = !list.data ? selected
    : aspect ? (own && repos.some((r) => r.repo === own) ? baselineKey(own) : repos[0] && baselineKey(repos[0].repo))
    : selected && listed(selected) ? selected : prs[0]?.id ?? (repos[0] && baselineKey(repos[0].repo))
  // and it is the selection: its feed is read, and the place Design keeps is it
  useEffect(() => { if (list.data && current !== selected) onSelect(current) }, [list.data, current, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const ticket = current?.startsWith('ticket:') ? tickets.find((t) => `ticket:${t.id}` === current) : undefined
  const feed = current ? feedOf(current) : []
  // a phone: the list is a screen of its own (the full width), opened from the bar over the item; picking one closes it
  const [listing, setListing] = useState(false)
  const pickItem = (id: string) => { onSelect(id); setListing(false) }
  // a blueprint wants the width (its list of components and its board): below a laptop's (a tablet) the list folds into the bar, as on a phone
  const roomy = !aspect && !!current?.startsWith('repo:')
  const name = current?.startsWith('repo:') ? `${current.slice(5).split("/")[1]} · map` : ticket ? ticket.title : prs.find((p) => p.id === current)?.title
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label="Design" className={`${listing ? 'flex w-full' : 'hidden'} shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-2 ${roomy ? 'xl:flex xl:w-60' : 'md:flex md:w-60'}`}>
        {aspect ? <>
          <p className="label px-2.5 pb-1 pt-2 text-fg-4">Projects</p>
          {!list.data && <Skeleton rows={2} />}
          {list.data && !repos.length && <p className="px-2.5 text-meta text-fg-3">None yet. Turn visuals on for a repository in {inSettings('repos')}.</p>}
          {repos.map((r) => (
            <button key={r.repo} onClick={() => pickItem(baselineKey(r.repo))} className={`flex gap-2 rounded-ctl px-2 py-1.5 text-left ${current === baselineKey(r.repo) ? 'sel-row' : 'hover:bg-hover'}`}>
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
                {view === 'tokens' ? <SwatchBook className="size-4 text-fg-3" /> : <Component className="size-4 text-fg-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-medium text-fg-1">{r.repo.split('/')[1]}</span>
                <span className="block truncate text-micro text-fg-3">{r.repo.split('/')[0]}</span>
              </span>
            </button>
          ))}
        </> : <>
        <p className="label px-2.5 pb-1 pt-2 text-fg-4">Pull requests</p>
        {!list.data && <Skeleton rows={3} />}
        {list.data && !prs.length && <p className="px-2.5 text-meta text-fg-3">None yet. Turn visuals on for a repository in {inSettings('repos')}, or for one PR from its page.</p>}
        {prs.map((p) => {
          const s = standing(p, p.latest?.sha)
          return (
            <button key={p.id} onClick={() => pickItem(p.id)} className={`flex gap-2 rounded-ctl px-2 py-1.5 text-left ${current === p.id ? 'sel-row' : 'hover:bg-hover'}`}>
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
                {p.latest?.thumb ? <img src={shotUrl(p.id, p.latest.sha, p.latest.thumb)} alt="" loading="lazy" className="size-full object-cover object-top" /> : <Images className="size-4 text-fg-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-small font-medium text-fg-1">{busy(p.task) && <LoaderCircle className="size-3 shrink-0 animate-spin text-run-text" />}<span className="truncate">{p.title}</span></span>
                <span className="block truncate text-micro text-fg-3">{p.repo.split('/')[1]}#{p.number}</span>
                <span className={`block truncate text-micro ${TONE[s.tone]}`}>{s.text}</span>
              </span>
            </button>
          )
        })}
        {repos.length > 0 && <p className="label px-2.5 pb-1 pt-3 text-fg-4">Maps</p>}
        {repos.map((r) => (
          <button key={r.repo} onClick={() => pickItem(baselineKey(r.repo))} className={`flex gap-2 rounded-ctl px-2 py-1.5 text-left ${current === baselineKey(r.repo) ? 'sel-row' : 'hover:bg-hover'}`}>
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-ctl bg-fill ring-1 ring-line">
              {r.baseline?.thumb ? <img src={shotUrl(baselineKey(r.repo), r.baseline.sha, r.baseline.thumb)} alt="" loading="lazy" className="size-full object-cover object-top" /> : <LayoutTemplate className="size-4 text-fg-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-small font-medium text-fg-1">{busy(r.task) && <LoaderCircle className="size-3 shrink-0 animate-spin text-run-text" />}<span className="truncate">{r.repo.split('/')[1]}</span></span>
              <span className={`block truncate text-micro ${r.baseline ? 'text-fg-3' : 'text-wait-text'}`}>{r.baseline?.screens ? `${r.baseline.screens} screens in ${r.baseline.domains} domains` : busy(r.task) ? (r.baseline ? 'Making its blueprint…' : 'Setting its Storybook up…') : r.baseline ? 'Stories, no blueprint yet' : 'No Storybook yet'}</span>
            </span>
          </button>
        ))}
        {tickets.length > 0 && <p className="label px-2.5 pb-1 pt-3 text-fg-4">Tickets</p>}
        {tickets.map((t) => (
          <button key={t.id} onClick={() => pickItem(`ticket:${t.id}`)} className={`rounded-ctl px-2.5 py-1.5 text-left ${current === `ticket:${t.id}` ? 'sel-row' : 'hover:bg-hover'}`}>
            <span className="block truncate text-small text-fg-1">{t.title}</span>
            <span className="block truncate text-micro text-fg-3">{t.id}{t.prs.length ? ` · ${t.prs.length} PR${t.prs.length === 1 ? '' : 's'}` : ' · no PR yet'}</span>
          </button>
        ))}
        </>}
      </nav>
      <div className={`min-w-0 flex-1 flex-col ${listing ? (roomy ? 'hidden xl:flex' : 'hidden md:flex') : 'flex'}`}>
        {current && (
          <button onClick={() => setListing(true)} className={`flex min-h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-left text-small text-fg-2 ${roomy ? 'xl:hidden' : 'md:hidden'}`}>
            <ArrowLeft className="size-4 shrink-0 text-fg-3" /><span className="shrink-0 font-medium text-fg-1">All designs</span><span className="min-w-0 flex-1 truncate text-fg-3">{name}</span>
          </button>
        )}
        <div className="min-h-0 flex-1">
        {aspect ? (current ? <Aspect key={`${view}:${current}`} view={view} repo={current.slice(5)} feed={feed} toast={toast} /> : <Empty />)
          : current?.startsWith('repo:') ? <Baseline key={current} repo={current.slice(5)} feed={feed} toast={toast} />
          : ticket ? <TicketVisuals t={ticket} prs={prs} onSelect={onSelect} />
          : current && !current.startsWith('ticket:') ? <VisualsView key={current} id={current} feed={feed} toast={toast} />
          : <Empty />}
        </div>
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Palette className="size-6 text-accent-text" />
      <p className="text-body font-medium text-fg-1">What your pull requests look like, before and after</p>
      <p className="max-w-md text-small text-fg-3">Turn visuals on for a repository ({inSettings('repos')}), and each PR that changes what people see gets its screens captured: from its Storybook stories, else from the running app.</p>
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
  const narrow = useNarrow() // no room for a column: the conversation is a sheet, always a tap away (a hook: before any early return)
  const q = useApi<{ repo: string; mode: VisualsMode; task?: VisualsTask & { prUrl?: string }; sets: VisualSet[] }>(path, { refetchInterval: ticking ? 3000 : 30_000 })
  const b = q.data, t = b?.task
  useEffect(() => setTicking(busy(t)), [t?.state])
  const post = (body: object, msg?: string) => api(path, body).then(() => { void refresh(path); void refresh('/visuals'); if (msg) toast(msg) }, (e: Error) => toast(e.message, 'error'))
  if (!b) return <div className="p-4"><Skeleton rows={6} /></div>
  const set = b.sets[0]
  // the blueprint: the map of the project, its screens by domain and step. It is the baseline; the components' own
  // shots (each one's stories) are beside it, a tab away
  const screens = set?.shots.filter((x) => x.domain && (x.after ?? x.before)) ?? []
  const mapped = screens.length > 0, onMap = mapped
  const parts = set?.impact?.changed ?? []
  const numbers = new Map(parts.map((c, i) => [c.name, i + 1]))
  // the conversation: a click away (the onboarding and the map say where things stand)
  const showTalk = talk ?? false
  // what the agent last said, for the onboarding's progress (the whole of it is the conversation)
  const said = busy(t) ? [...feed].reverse().find((x) => x.kind === 'text' || x.kind === 'result')?.text : undefined
  const making = !!(t as { board?: boolean } | undefined)?.board || !!set
  // a component's states: the Components view, a click on the rail away
  const goComponents = () => { history.pushState(null, '', `/design/components${location.search}${location.hash}`); dispatchEvent(new PopStateEvent('popstate')) }
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          <header className="card px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-3">{repo} · map</p>
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
              <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                <button onClick={() => setTalk(!showTalk)} aria-pressed={showTalk} title={showTalk ? 'Hide the conversation' : 'Talk to the agent that set it up'} className={`btn-ghost btn-sm inline-flex items-center gap-1.5 max-lg:hidden ${showTalk ? 'text-accent-text' : ''}`}><MessageSquare className="size-3.5" />Conversation</button>
                {t?.prUrl && <a href={t.prUrl} target="_blank" rel="noreferrer" className="btn-outline btn-sm inline-flex items-center gap-1.5"><ExternalLink className="size-3.5" />Open the PR</a>}
                {busy(t)
                  ? <button onClick={() => post({ cancel: true }, 'Stopped')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Square className="size-3.5" />Stop</button>
                  : mapped && <button onClick={() => post({ board: true }, 'Drawing the map again, from the code as it is now')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Wand className="size-3.5" />Redraw the map</button>}
              </div>
            </div>
          </header>
          {onMap ? <Blueprint pr={baselineKey(repo)} set={set!} screens={screens} parts={parts} numbers={numbers} onStates={goComponents} fill />
            : <MapOnboarding name={repo.split('/')[1]} has={set ? parts.length : 0} task={t} said={said}
                             onStart={() => (set ? post({ board: true }, 'Making the map: its screens, the built Storybook, every component marked') : post({ setup: true }, 'Setting its Storybook up, then its map'))}
                             onStop={() => post({ cancel: true }, 'Stopped')} onComponents={set ? goComponents : undefined} onTalk={() => setTalk(true)} />}
        </div>
      </div>
      {(showTalk || narrow) && <Conversation id={baselineKey(repo)} feed={feed} live={busy(t)} onSay={(text) => post({ say: text })} toast={toast} />}
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
              {/* the title keeps a readable measure: the actions go under it before it is squeezed into a few words a line */}
              <div className="min-w-0 flex-1 basis-80">
                <p className="text-meta text-fg-3">{p.repo}#{p.number} · {p.author}{p.tickets.length ? ` · ${p.tickets.join(', ')}` : ''}</p>
                <h2 className="text-title font-semibold text-fg-1">{p.title}</h2>
                <p className={`mt-0.5 text-meta ${TONE[s.tone]}`}>{s.text}</p>
                {p.ui && <p className="text-meta text-fg-4" title={p.ui.files.join('\n')}>{p.ui.is ? 'Changes what people see' : 'Doesn’t change what people see'}: {p.ui.why}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Tabs size="sm" label="Visuals for this PR" value={p.override ?? 'repo'} onChange={(v) => post({ override: v === 'repo' ? null : v }, v === 'repo' ? `Follows ${p.repo}: ${modeWord[p.mode]}` : v === 'on' ? 'Captured for every commit' : 'Not captured')}
                      options={[{ id: 'repo' as const, label: `Like its repository (${p.mode})` }, { id: 'on' as const, label: 'On' }, { id: 'off' as const, label: 'Off' }]} />
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

/** A lit place on a screen: in percent of the screen's width and height, and its corners' radius in the page's own px. */
type Lit = { x: number; y: number; w: number; h: number; r: number }
/**
 * Where a mark really is on the page drawn: the element whose box matches the mark best (the agent measured it on a
 * screenshot, a few pixels off), with its own rounded corners; the mark itself when the page has none that fits.
 * `W` and `H` are the page's own size the marks are in percent of.
 */
function snap(d: Document | null | undefined, marks: Mark[], W: number, H: number): Lit[] {
  marks = marks.filter((m) => m.y < 99 && m.x < 99 && m.y + m.h > 1) // what is drawn: not a part below the screen's fold
  const plain = marks.map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h, r: 4 }))
  if (!d?.body) return plain
  try {
    const root = d.documentElement.getBoundingClientRect()
    if (!root.width) return plain
    const k = W / root.width // the page's px per drawn px
    const els = [...d.body.querySelectorAll<HTMLElement>('*')].filter((e) => !e.classList.contains('bp-t'))
    const boxes = els.map((e) => { const r = e.getBoundingClientRect(); return { e, x: ((r.left - root.left) * k / W) * 100, y: ((r.top - root.top) * k / H) * 100, w: (r.width * k / W) * 100, h: (r.height * k / H) * 100 } })
    const iou = (m: Mark, b: (typeof boxes)[number]) => {
      const ix = Math.max(0, Math.min(m.x + m.w, b.x + b.w) - Math.max(m.x, b.x)), iy = Math.max(0, Math.min(m.y + m.h, b.y + b.h) - Math.max(m.y, b.y))
      const inter = ix * iy
      return inter / (m.w * m.h + b.w * b.h - inter)
    }
    const found = marks.map((m) => {
      let best: (typeof boxes)[number] | undefined, score = 0.55
      for (const b of boxes) if (b.w >= 0.3 && b.h >= 0.3) { const s = iou(m, b); if (s > score) { score = s; best = b } }
      return best
    })
    // a mark measured loosely (a small part, a few pixels off) is still the same component as the ones that matched:
    // the element of the same make (its classes) nearest it, when one is there
    const makes = new Set(found.flatMap((b) => (b && b.e.className && typeof b.e.className === 'string' ? [b.e.className] : [])))
    return marks.map((m, i) => {
      let best = found[i]
      if (!best && makes.size) {
        const cx = m.x + m.w / 2, cy = m.y + m.h / 2
        let far = Math.max(m.w, m.h, 2)
        for (const b of boxes) {
          if (typeof b.e.className !== 'string' || !makes.has(b.e.className)) continue
          const dist = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy)
          if (dist < far) { far = dist; best = b }
        }
      }
      if (!best) return plain[i]
      if (best.y >= 99) return undefined
      // what it draws past its own box (a label taller than its pill) is lit too, and a hair around it, so nothing is cut
      let [x0, y0, x1, y1] = [best.x, best.y, best.x + best.w, best.y + best.h]
      const css = d.defaultView!.getComputedStyle.bind(d.defaultView)
      let r = parseFloat(css(best.e).borderTopLeftRadius) || 0
      const area = best.w * best.h
      for (const c of best.e.querySelectorAll('*')) {
        const rc = c.getBoundingClientRect()
        if (!rc.width || !rc.height) continue
        // a wrapper's shape is the shape it holds: a pill inside a plain box lights as a pill
        if (!r && ((rc.width * k / W) * 100) * ((rc.height * k / H) * 100) > area * 0.6) r = parseFloat(css(c).borderTopLeftRadius) || 0
        const rr = rc
        const cx = ((rr.left - root.left) * k / W) * 100, cy = ((rr.top - root.top) * k / H) * 100
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx + (rr.width * k / W) * 100); y1 = Math.max(y1, cy + (rr.height * k / H) * 100)
      }
      const px = (2 / W) * 100, py = (2 / H) * 100
      return { x: x0 - px, y: y0 - py, w: x1 - x0 + 2 * px, h: y1 - y0 + 2 * py, r: r && r + 2 }
    }).filter((b): b is Lit => !!b)
  } catch { return plain }
}

/**
 * A count that goes up whenever a page's layout may have moved (its fonts came, it rendered more, it was resized or
 * zoomed): what the lit boxes are measured again on, so they stay on what is drawn.
 */
function useLayoutTick(frame: { current: HTMLIFrameElement | null }, ready: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const d = ready ? frame.current?.contentDocument : undefined
    if (!d?.body) return
    let t: number | undefined
    const bump = () => { clearTimeout(t); t = window.setTimeout(() => setN((x) => x + 1), 120) }
    const v = (d.defaultView ?? window) as typeof window // the page's own observers: its elements are its window's
    const ro = new v.ResizeObserver(bump), mo = new v.MutationObserver(bump)
    try {
      ro.observe(d.documentElement); ro.observe(d.body)
      mo.observe(d.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] })
      void d.fonts?.ready.then(bump)
    } catch { /* not readable */ }
    return () => { clearTimeout(t); ro.disconnect(); mo.disconnect() }
  }, [ready])
  return n
}

/**
 * The component lit on a screen: everything else falls back under a veil of the board's own surface, and the component
 * stays as drawn, at full strength, with a soft glow in the accent around its own shape. `scale`: drawn px per page px.
 */
function Spotlight({ lit, W, H, scale, on }: { lit: Lit[]; W: number; H: number; scale: number; on: boolean }) {
  const mask = `s${useId().replace(/\W/g, '')}`
  const g = Math.min(1, Math.max(0.3, scale * 2.2)) // the glow's size: small on a miniature, full on a large screen
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ease-[var(--ease-out)] ${on ? 'opacity-100' : 'opacity-0'}`}>
      {lit.length > 0 && <>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
          <mask id={mask}><rect width={W} height={H} fill="white" />{lit.map((b, i) => <rect key={i} x={(b.x / 100) * W} y={(b.y / 100) * H} width={(b.w / 100) * W} height={(b.h / 100) * H} rx={b.r} fill="black" />)}</mask>
          <rect width={W} height={H} mask={`url(#${mask})`} style={{ fill: 'color-mix(in oklch, var(--surface-1) 80%, transparent)' }} />
        </svg>
        {lit.map((b, i) => (
          <span key={i} className="absolute" style={{
            left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, borderRadius: b.r * scale,
            boxShadow: `0 0 0 1px color-mix(in oklch, var(--accent) 55%, transparent), 0 0 ${10 * g}px ${1 * g}px color-mix(in oklch, var(--accent) 50%, transparent), 0 ${6 * g}px ${36 * g}px ${6 * g}px color-mix(in oklch, var(--accent) 28%, transparent)`,
          }} />
        ))}
      </>}
    </div>
  )
}

/**
 * A screen on the board, small: the page itself when the baseline has its Storybook (`live`: the story's own page,
 * rendered at its real size and scaled down), else its screenshot. A click opens it large.
 *
 * Built to be many: no element per component (the pointer's place is worked out against the marks), drawn again only
 * when its own state changes (`mode`: idle, dimmed, or the component lit on it), skipped by the browser while off
 * screen. A live page is only there while its screen is near the board's view. The light comes and goes softly: the
 * last lit component stays drawn while it fades out.
 */
/** Below this scale a page's text is a grey haze: the miniature draws it as a blueprint instead. */
export const BLUEPRINT_BELOW = 0.42
const BLUEPRINT_CSS = `
html.bp, html.bp body { background: transparent !important; scrollbar-width: none !important; }
html.bp ::-webkit-scrollbar { display: none !important; }
html.bp *, html.bp *::before, html.bp *::after { border-color: transparent !important; outline-color: transparent; box-shadow: none !important; text-shadow: none !important; transition: none !important; animation: none !important; }
html.bp [data-bp-s] { background: color-mix(in srgb, var(--bp-ink) 5%, transparent) !important; }
html.bp [data-bp-f] { background: color-mix(in srgb, var(--bp-fill) 28%, transparent) !important; }
html.bp .bp-t { color: transparent !important; -webkit-text-fill-color: transparent !important;
  --bp-bar: color-mix(in srgb, var(--bp-c, var(--bp-ink)) 42%, transparent);
  background: linear-gradient(var(--bp-bar), var(--bp-bar)) 0 55% / 100% 58% no-repeat !important; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
html.bp .bp-t.bp-h { --bp-bar: color-mix(in srgb, var(--bp-c, var(--bp-ink)) 85%, transparent); }
html.bp [data-bp-b] { outline: var(--bp-px) solid var(--bp-bc, color-mix(in srgb, var(--bp-ink) 24%, transparent)) !important; outline-offset: calc(-1 * var(--bp-px)); }
html.bp input, html.bp textarea, html.bp select { color: transparent !important; }
html.bp ::placeholder { color: transparent !important; }
html.bp svg { color: color-mix(in srgb, var(--bp-ink) 55%, transparent) !important; }
html.bp img, html.bp video, html.bp canvas { filter: grayscale(1); opacity: .45; }`

/** A colour as sRGB through a 1px canvas (so oklch, named and rgb colours read alike): its alpha, and whether it is a hue rather than a grey. */
const tone = (() => {
  const seen = new Map<string, { a: number; hue: boolean }>()
  let ctx: CanvasRenderingContext2D | null = null
  return (c: string) => {
    let t = seen.get(c)
    if (t) return t
    ctx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
    t = { a: 0, hue: false }
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      t = { a: a / 255, hue: Math.max(r, g, b) - Math.min(r, g, b) > 48 }
    }
    seen.set(c, t)
    return t
  }
})()

/**
 * A kept page drawn for the board, seen from afar, in no theme of its own: its grounds clear (a neutral surface a
 * faint wash in the board's ink, a coloured one a light tint of its hue), each run of text a bar in the board's ink (a
 * title or a bold word darker; coloured text keeps its hue), every edge a line one screen pixel wide, fields empty.
 * The layout and its places stay as drawn. Marking the page is done once; `on`, the scale `k` and `ink` switch it.
 */
export function blueprint(d: Document, k: number, on: boolean, ink: string, dark = false) {
  const root = d.documentElement
  if (!root.dataset.bp) {
    root.dataset.bp = '1'
    const st = d.createElement('style'); st.textContent = BLUEPRINT_CSS; d.head?.append(st)
    const view = d.defaultView!
    const walk = d.createTreeWalker(d.body ?? root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => !n.textContent?.trim() || n.parentElement?.closest('script, style, noscript, textarea, option, svg, title') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })
    const texts: Text[] = []
    for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(n as Text)
    for (const t of texts) {
      const cs = view.getComputedStyle(t.parentElement!)
      const span = d.createElement('span')
      span.className = Number(cs.fontWeight) >= 600 || parseFloat(cs.fontSize) >= 20 || /^H[1-3]$/.test(t.parentElement!.tagName) ? 'bp-t bp-h' : 'bp-t'
      if (tone(cs.color).hue) span.style.setProperty('--bp-c', cs.color)
      t.replaceWith(span); span.append(t)
    }
    for (const el of (d.body ?? root).querySelectorAll<HTMLElement>('*')) {
      if (el.classList.contains('bp-t')) continue
      const cs = view.getComputedStyle(el)
      const bg = tone(cs.backgroundColor)
      if (bg.a > 0.05) { if (bg.hue) { el.dataset.bpF = ''; el.style.setProperty('--bp-fill', cs.backgroundColor) } else el.dataset.bpS = '' }
      const side = (['Top', 'Right', 'Bottom', 'Left'] as const).find((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none')
      if (!side) continue
      const c = cs[`border${side}Color`], line = tone(c)
      if (line.a < 0.05) continue
      el.dataset.bpB = ''
      if (line.hue) el.style.setProperty('--bp-bc', c)
    }
  }
  root.classList.toggle('bp', on)
  // the frame's canvas in the board's own scheme: one that differs is painted opaque (white behind a light page on a dark board)
  if (on) root.style.setProperty('color-scheme', dark ? 'dark' : 'light', 'important'); else root.style.removeProperty('color-scheme')
  root.style.setProperty('--bp-px', `${(1 / k).toFixed(2)}px`)
  root.style.setProperty('--bp-ink', ink)
}

/**
 * A rendered page as plain HTML: its markup and every style it has (the files it links, and the rules a CSS-in-JS
 * library put in by script), what is typed in its fields, without a script, and its addresses read from its own
 * folder (`base`). What the board shows: the page itself, drawn by the browser, with nothing running in it.
 */
export function pageHtml(doc: Document, base: string): string {
  const copy = doc.documentElement.cloneNode(true) as HTMLElement
  const live = [...doc.querySelectorAll('style')], copies = [...copy.querySelectorAll('style')]
  live.forEach((st, i) => { try { if (!st.textContent?.trim() && st.sheet && copies[i]) copies[i].textContent = [...st.sheet.cssRules].map((r) => r.cssText).join('\n') } catch { /* another origin's sheet */ } })
  const head = copy.querySelector('head') ?? copy
  for (const sheet of doc.adoptedStyleSheets ?? []) { try { const st = doc.createElement('style'); st.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n'); head.append(st) } catch { /* unreadable */ } }
  const fields = [...doc.querySelectorAll('input, textarea, select')], kept = [...copy.querySelectorAll('input, textarea, select')]
  fields.forEach((f, i) => {
    const k = kept[i]; if (!k) return
    if (f instanceof HTMLInputElement) { if (f.type === 'checkbox' || f.type === 'radio') { if (f.checked) k.setAttribute('checked', '') } else k.setAttribute('value', f.value) }
    else if (f instanceof HTMLTextAreaElement) k.textContent = f.value
    else if (f instanceof HTMLSelectElement) k.querySelectorAll('option').forEach((o, j) => { if (j === f.selectedIndex) o.setAttribute('selected', '') })
  })
  copy.querySelectorAll('script, noscript, iframe, link[rel="modulepreload"], link[as="script"]').forEach((x) => x.remove())
  copy.style.removeProperty('zoom')
  head.insertAdjacentHTML('afterbegin', `<base href="${base}">`)
  return `<!doctype html>${copy.outerHTML}`
}

/**
 * The live pages the board runs to keep its screens: one per Storybook, off screen, side by side. Each loads its
 * Storybook once and goes from story to story over Storybook's own channel (no reload: a screen in about half a
 * second), waits until the story has rendered and holds still, and keeps its HTML, for every visit and every machine
 * after. A story that reloads the page or takes it elsewhere (a redirect to sign in) gets a page of its own once, then is
 * let go.
 */
function Renderer({ base, slug, sha, jobs, onDone }: { base: string; slug: string; sha: string; jobs: Shot[]; onDone: (key: string, ok: boolean) => void }) {
  const books = [...new Set(jobs.map((j) => j.book!))]
  return <>{books.map((b) => <BookRenderer key={b} base={base} slug={slug} sha={sha} book={b} jobs={jobs.filter((j) => j.book === b)} onDone={onDone} />)}</>
}

type Channel = { on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void; emit: (e: string, a: unknown) => void }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function BookRenderer({ base, slug, sha, book, jobs, onDone }: { base: string; slug: string; sha: string; book: string; jobs: Shot[]; onDone: (key: string, ok: boolean) => void }) {
  const frame = useRef<HTMLIFrameElement>(null), pending = useRef(jobs), done = useRef(onDone)
  pending.current = jobs; done.current = onDone
  const tried = useRef(new Set<string>()), loads = useRef(0), now = useRef<string | undefined>(undefined), again = useRef(new Set<string>()), storm = useRef(0) // storm: reloads in a row with nothing kept
  const [start, setStart] = useState(() => ({ story: jobs[0]?.story, n: 0 })) // the story the page is loaded at, and which load
  const next = () => pending.current.find((j) => !tried.current.has(j.story!))
  useEffect(() => {
    if (!start.story) return
    let stop = false
    loads.current = 0
    const doc = () => frame.current?.contentDocument
    const ready = async () => { // the page's Storybook is up and showing its first story (or its error)
      for (let t = 0; t < 150 && !stop; t++) {
        const d = doc(), w = frame.current?.contentWindow as (Window & { __STORYBOOK_ADDONS_CHANNEL__?: Channel }) | null
        if (d?.body?.classList.contains('sb-show-errordisplay')) return { ch: w?.__STORYBOOK_ADDONS_CHANNEL__, ok: false }
        if (w?.__STORYBOOK_ADDONS_CHANNEL__ && d?.body?.classList.contains('sb-show-main') && d.querySelector('#storybook-root')?.firstElementChild) return { ch: w.__STORYBOOK_ADDONS_CHANNEL__, ok: true }
        await wait(100)
      }
      return undefined
    }
    const still = async () => { // the story's markup holds still for a moment (data arriving, effects settling)
      let last = '', same = 0
      for (let t = 0; t < 40 && !stop; t++) {
        const r = doc()?.querySelector('#storybook-root'), sig = r ? `${r.innerHTML.length}:${r.querySelectorAll('*').length}` : ''
        same = sig && sig === last ? same + 1 : 0; last = sig
        if (same >= 2) break
        await wait(120)
      }
      await doc()?.fonts?.ready
    }
    const keep = async (job: Shot) => {
      const d = doc(); if (!d || stop) return false
      storm.current = 0
      return api(`/visuals/snaps/${slug}/${sha}`, { book, story: job.story, html: pageHtml(d, `${base}/${book}/`) }).then(() => true, () => false)
    }
    const show = (ch: Channel, story: string) => new Promise<boolean>((res) => { // Storybook's own switch, and its word that it drew it
      const evs: Record<string, () => void> = {}
      const end = (ok: boolean) => () => { for (const k in evs) ch.off(k, evs[k]); clearTimeout(t); res(ok) }
      // a play function that fails still leaves the story drawn
      for (const [k, ok] of [['storyRendered', true], ['playFunctionThrewException', true], ['storyErrored', false], ['storyThrewException', false], ['storyMissing', false]] as const) { evs[k] = end(ok); ch.on(k, evs[k]) }
      const t = setTimeout(end(false), 12_000)
      ch.emit('setCurrentStory', { storyId: story, viewMode: 'story' })
    })
    void (async () => {
      const up = await ready()
      if (stop) return
      const first = pending.current.find((j) => j.story === start.story) // the one it was loaded at (a retry, too)
      if (first) { tried.current.add(first.story!); now.current = first.story; if (up?.ok) await still(); if (stop) return; done.current(`${book}/${first.story}`, !!up?.ok && await keep(first)) }
      if (!up?.ch) { const n = next(); if (n && !stop) setStart({ story: n.story, n: start.n + 1 }); return }
      for (let job = next(); job && !stop; job = next()) {
        tried.current.add(job.story!); now.current = job.story
        const ok = await show(up.ch, job.story!)
        if (stop) return
        if (ok) await still()
        if (stop) return
        done.current(`${book}/${job.story}`, ok && await keep(job))
      }
    })()
    return () => { stop = true }
  }, [start])
  // more to do after the page went quiet (the list arrived later): start again where it stands
  useEffect(() => { const n = next(); if (n && !start.story) setStart({ story: n.story, n: start.n + 1 }) }, [jobs])
  if (!start.story) return null
  return <iframe key={start.n} ref={frame} aria-hidden tabIndex={-1} title="" src={`${base}/${book}/iframe.html?id=${encodeURIComponent(start.story)}&viewMode=story`}
                 onLoad={() => {
                   // loaded a second time: the story took the page elsewhere; it is let go, the page starts again at the next
                   if (++loads.current < 2) return
                   // loaded again: the story reloaded the page or took it elsewhere. It gets one page of its own; a
                   // second time it is let go, and the page starts again at the next
                   const cur = now.current; now.current = undefined
                   // a page that keeps reloading (a Storybook that can't settle) is let go for this visit, not run forever
                   if (++storm.current > 4) { for (const j of pending.current) if (!tried.current.has(j.story!)) { tried.current.add(j.story!); done.current(`${book}/${j.story}`, false) } if (cur) done.current(`${book}/${cur}`, false); return setStart({ story: undefined, n: start.n + 1 }) }
                   if (cur && !again.current.has(cur)) { again.current.add(cur); return setStart({ story: cur, n: start.n + 1 }) }
                   if (cur) done.current(`${book}/${cur}`, false)
                   const n = next(); setStart({ story: n?.story, n: start.n + 1 })
                 }}
                 style={{ position: 'fixed', left: -20000, top: 0, width: 1280, height: 800, border: 0, opacity: 0, pointerEvents: 'none' }} />
}

/** A page while it loads: the shape of a screen (its rail, its title, a few blocks), softly pulsing, never a picture of it. */
const PageSkeleton = () => (
  <span aria-hidden className="absolute inset-0 animate-pulse bg-surface-1">
    <span className="absolute inset-y-0 left-0 w-[16%] bg-fill" />
    <span className="absolute left-[22%] top-[9%] h-[5%] w-[28%] rounded-[2px] bg-fill-strong" />
    <span className="absolute left-[22%] top-[22%] h-[26%] w-[34%] rounded-[2px] bg-fill" />
    <span className="absolute left-[60%] top-[22%] h-[26%] w-[34%] rounded-[2px] bg-fill" />
    <span className="absolute left-[22%] top-[56%] h-[4%] w-[52%] rounded-[2px] bg-fill" />
    <span className="absolute left-[22%] top-[64%] h-[4%] w-[40%] rounded-[2px] bg-fill" />
  </span>
)

const Mini = memo(function Mini({ src, live, waiting, shot, mode, step, cell, onHover, onOpen }: {
  src: string; live?: string; waiting?: boolean; shot: Shot; mode: string; step: number; cell: number; onHover: (part: string | undefined, ms: number) => void; onOpen: (sh: Shot, from: DOMRect) => void
}) {
  const marks = shot.marks ?? []
  const litPart = mode !== 'idle' && mode !== 'dim' ? mode : undefined
  const last = useRef<string | undefined>(undefined)
  if (litPart) last.current = litPart
  const shown = last.current ? marks.filter((m) => m.part === last.current) : []
  const frame = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false), [ready, setReady] = useState(false)
  useEffect(() => {
    if (!live || !frame.current) return
    const io = new IntersectionObserver(([e]) => { setNear(e.isIntersecting); if (!e.isIntersecting) setReady(false) }, { rootMargin: '240px' })
    io.observe(frame.current)
    return () => io.disconnect()
  }, [live])
  const W = shot.width ?? 1280, H = shot.height ?? Math.round(W * 0.625)
  // the page itself, drawn at this size: its layout as at full width, the browser zooming it down (never a picture shrunk)
  const page = useRef<HTMLIFrameElement>(null), k = cell / W
  const dark = useIsDark()
  useEffect(() => {
    try {
      const d = page.current?.contentDocument
      if (!d) return
      d.documentElement.style.zoom = String(k)
      // from afar: the layout in the board's own ink, not a haze of text in the page's theme
      if (ready && frame.current) blueprint(d, k, k < BLUEPRINT_BELOW, getComputedStyle(frame.current).color, dark)
    } catch { /* another origin: as drawn */ }
  }, [k, ready, dark])
  // the lit component, on the page's own element when the page is there
  const moved = useLayoutTick(page, ready && shown.length > 0)
  const lit = useMemo(() => (shown.length ? snap(ready ? page.current?.contentDocument : undefined, shown, W, H) : []), [shown.map((m) => `${m.x},${m.y}`).join(), ready, W, H, moved]) // eslint-disable-line react-hooks/exhaustive-deps
  const at = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    return partAt(marks, ((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100)
  }
  return (
    <figure className={`transition-opacity duration-500 ease-[var(--ease-out)] [contain-intrinsic-size:auto_160px] [content-visibility:auto] ${mode === 'dim' ? 'opacity-30' : ''}`}>
      <div ref={frame} style={live !== undefined || waiting ? { aspectRatio: `${W} / ${H}` } : undefined} title={shot.note}
           className={`group/mini relative cursor-zoom-in overflow-hidden rounded-[3px] bg-surface-1 text-fg-2 shadow-[0_1px_2px_rgb(0_0_0/0.18)] ring-1 transition-[box-shadow,transform] duration-300 ease-[var(--ease-out)] hover:-translate-y-px ${litPart ? 'ring-accent/60' : 'ring-line-strong hover:ring-fg-4'}`}
           onMouseMove={(e) => onHover(at(e), 1000)} onMouseLeave={() => onHover(undefined, 0)} onClick={(e) => onOpen(shot, e.currentTarget.getBoundingClientRect())}
           // a screen on the board opens from the keyboard too
           role="button" tabIndex={0} aria-label={`Open ${shot.name}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(shot, e.currentTarget.getBoundingClientRect()) } }}>
        {live !== undefined || waiting ? (!ready && <PageSkeleton />) : <img src={src} alt={shot.name} loading="lazy" decoding="async" draggable={false} className="block w-full select-none" />}
        {live && near && (
          <iframe ref={page} src={live} title={shot.name} tabIndex={-1} aria-hidden loading="lazy" sandbox="allow-same-origin" onLoad={() => setReady(true)}
                  style={{ width: '100%', height: '100%' }}
                  className={`pointer-events-none absolute inset-0 border-0 bg-surface-1 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`} />
        )}
        <Spotlight lit={lit} W={W} H={H} scale={k} on={!!litPart} />
      </div>
      <figcaption className="mt-1.5 flex items-baseline gap-1.5 truncate text-micro text-fg-3"><span className="tabular-nums text-fg-4">{step}</span>{shot.variant ?? shot.name}</figcaption>
    </figure>
  )
})

/**
 * One screen, large: it grows out of the place it sat on the board, and every component on it is a way in. Resting on
 * one names it; a click (or picking one in the list) glides the view to it. A component that isn't on this screen
 * takes the view to the first screen that has it.
 */
function Focus({ pr, sha, shot, origin, live, target, lit: litPart, onPart, onClose, onStep }: {
  pr: string; sha: string; shot: Shot; origin?: DOMRect; live?: string; target?: string; lit?: string; onPart: (part: string) => void; onClose: () => void; onStep?: (d: number) => void
}) {
  const box = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null)
  const [hoverMark, setHoverMark] = useState<Mark>()
  const marks = shot.marks ?? []
  const W = shot.width ?? 1280, H = shot.height ?? Math.round(W * 0.625)
  const aim = target ? marks.filter((m) => m.part === target).sort((a, b) => b.w * b.h - a.w * a.h)[0] : undefined
  const t = aim ? focusOn(aim) : { s: 1, tx: 0, ty: 0 }
  // where it grew from: the screen's place on the board, as the start of the opening motion
  const [from, setFrom] = useState<string>()
  useLayoutEffect(() => {
    const b = stage.current?.getBoundingClientRect()
    if (!origin || !b) return
    setFrom(`translate(${origin.left - b.left}px, ${origin.top - b.top}px) scale(${origin.width / b.width})`)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFrom(undefined)))
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') onStep?.(1); if (e.key === 'ArrowLeft') onStep?.(-1) }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose, onStep])
  const [ready, setReady] = useState(false)
  // sharp at any zoom: the live page draws itself at the size it is shown (`R` times its own, its layout unchanged),
  // instead of a small picture of it being magnified. While the view glides it moves as drawn; once it lands, it is
  // drawn again for where it landed
  const [fw, setFw] = useState(0), [settled, setSettled] = useState(1)
  // the screen as large as the space it has, whichever way it is short (a tablet's view is short and narrow both)
  const area = useRef<HTMLDivElement>(null), [fit, setFit] = useState<number>()
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const measure = () => { const cs = getComputedStyle(el), w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); setFit(Math.max(120, Math.floor(Math.min(w, (h * W) / H)))) }
    const ro = new ResizeObserver(measure)
    ro.observe(el); measure()
    return () => ro.disconnect()
  }, [W, H])
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setFw(el.clientWidth))
    ro.observe(el); setFw(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const R = fw ? Math.round((fw / W) * settled * 1000) / 1000 : 1 // the page's zoom: its layout at full width, drawn at the size it is shown
  const page = useRef<HTMLIFrameElement>(null)
  useEffect(() => { try { const d = page.current?.contentDocument; if (d) d.documentElement.style.zoom = String(R) } catch { /* not the same origin: as drawn */ } }, [R, ready])
  // the component lit: the one rested on here, else the one pointed at in the list (or pinned, or glided to)
  const showPart = hoverMark?.part ?? litPart ?? target
  const lastPart = useRef<string | undefined>(undefined)
  if (showPart) lastPart.current = showPart
  const litMarks = useMemo(() => marks.filter((m) => m.part && m.part === lastPart.current), [marks, lastPart.current]) // eslint-disable-line react-hooks/exhaustive-deps
  const moved = useLayoutTick(page, ready)
  const lit = useMemo(() => snap(ready ? page.current?.contentDocument : undefined, litMarks, W, H), [litMarks, ready, W, H, R, moved])
  const hoverTimer = useRef<number | undefined>(undefined)
  const over = (m?: Mark) => { clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverMark(m), m ? 350 : 150) }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])
  // opened: the keys go here (Esc, the arrows), and back to where they were when it closes
  useEffect(() => { const was = document.activeElement as HTMLElement | null; box.current?.focus({ preventScroll: true }); return () => was?.focus?.({ preventScroll: true }) }, [])
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label="A screen, opened" tabIndex={-1} className="absolute inset-0 z-30 flex animate-[fade-in_240ms_var(--ease-out)_both] flex-col bg-surface-1/90 outline-none backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <header className="flex items-center gap-3 px-5 pb-2 pt-3.5">
        <span className="min-w-0 flex-1 truncate text-small"><b className="font-semibold text-fg-1">{shot.domain}</b><span className="text-fg-3"> · {shot.variant}</span>{shot.note && <span className="text-fg-4"> · {shot.note}</span>}</span>
        {aim && <button onClick={() => onPart('')} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><ZoomOut className="size-3.5" />Whole screen</button>}
        {onStep && <span className="flex gap-1"><button onClick={() => onStep(-1)} aria-label="The step before" className="btn-ghost btn-sm"><ChevronRight className="size-3.5 rotate-180" /></button><button onClick={() => onStep(1)} aria-label="The next step" className="btn-ghost btn-sm"><ChevronRight className="size-3.5" /></button></span>}
        <button onClick={onClose} aria-label="Back to the map" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><X className="size-3.5" />Back to the map</button>
      </header>
      <div ref={area} className="flex min-h-0 flex-1 items-center justify-center px-3 pb-3 sm:px-5 sm:pb-5" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div ref={stage} style={{ aspectRatio: `${W} / ${H}`, width: fit, transform: from, transformOrigin: '0 0', transition: from ? 'none' : 'transform 420ms var(--ease-out)' }}
             className="relative max-h-full max-w-full shrink-0 overflow-hidden rounded-[4px] bg-surface-1 shadow-e3 ring-1 ring-line-strong">
          <div className="absolute inset-0 origin-top-left transition-transform duration-700 ease-[var(--ease-out)]" style={{ transform: `translate(${t.tx}%, ${t.ty}%) scale(${t.s})` }}
               onTransitionEnd={(e) => { if (e.target === e.currentTarget) setSettled(t.s) }}>
            {live ? (!ready && <PageSkeleton />) : <img src={shotUrl(pr, sha, (shot.after ?? shot.before)!)} alt={shot.name} className="absolute inset-0 size-full object-cover object-top" />}
            {live && (
              <span className="absolute inset-0 overflow-hidden">
                <iframe ref={page} src={live} title={shot.name} sandbox="allow-scripts allow-same-origin" onLoad={() => setReady(true)}
                        style={{ width: fw * settled, height: (fw * settled * H) / W, transform: `scale(${1 / settled})`, transformOrigin: '0 0' }}
                        className={`pointer-events-none absolute left-0 top-0 border-0 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`} />
              </span>
            )}
            <Spotlight lit={lit} W={W} H={H} scale={fw ? (fw / W) * t.s : 1} on={!!showPart && lit.length > 0} />
            {marks.map((m, i) => m.part && (
              <button key={i} type="button" style={boxOf(m)} onMouseEnter={() => over(m)} onMouseLeave={() => over(undefined)} onClick={() => onPart(m.part!)} aria-label={m.part} className="absolute" />
            ))}
          </div>
          {hoverMark && <span className="pointer-events-none absolute left-3 top-3 animate-[fade-in_200ms_var(--ease-out)_both] rounded-[3px] bg-surface-2/95 px-2 py-1 text-micro font-medium text-fg-1 shadow-e2 ring-1 ring-line">{bare(hoverMark.part ?? '')}</span>}
        </div>
      </div>
    </div>
  )
}

/**
 * The blueprint of the app: every screen in small, grouped by application, a lane per domain and a column per step of
 * its storyline; every component on the left, by application. Rest on a component on the board for a second, or point
 * at it in the list (at once) and the board falls back softly, leaving it lit wherever it shows, with a card on where it is
 * used. Passing over things does nothing. A click on a screen opens it large; a click on a component then glides to it.
 */
function Blueprint({ pr, set, screens, parts, numbers, onStates, fill }: { pr: string; set: VisualSet; screens: Shot[]; parts: Part[]; numbers: Map<string, number>; onStates: () => void; fill?: boolean }) {
  const [hover, setHover] = useState<string>(), [pinned, setPinned] = useState<string>(), [find, setFind] = useState('')
  const [open, setOpen] = useState<{ shot: Shot; from?: DOMRect }>(), [aim, setAim] = useState<string>()
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(() => { try { return Number(localStorage.getItem('design:board-zoom')) || 180 } catch { return 180 } })
  const canLive = pr.startsWith('repo:') && screens.some((x) => x.book && x.story)
  const liveOn = true // the pages themselves; a skeleton holds the place until one is there
  // the screens as kept HTML (rendered once, one live page at a time): '' while one isn't kept yet
  const slug = pr.replace(/[^\w.-]+/g, '-'), sbBase = `/api/visuals/sb/${slug}/${set.sha}`
  const failed = useRef(new Set<string>()) // screens the renderer couldn't keep: left as skeletons, not tried again here
  const kept = useApi<string[]>(canLive ? `/visuals/snaps/${slug}/${set.sha}` : undefined)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [, setFailures] = useState(0) // a screen let go: the list to render is worked out again without it
  const keyOf = (sh: Shot) => `${sh.book}/${sh.story}`
  const isKept = (sh: Shot) => kept.data?.includes(keyOf(sh)) || done.has(keyOf(sh))
  const pageOf = (sh: Shot) => (!canLive || !sh.book || !sh.story ? undefined : isKept(sh) ? `${sbBase}/${sh.book}/__snap__/${sh.story}.html?v=${done.has(keyOf(sh)) ? 1 : 0}` : '')
  const toRender = kept.data ? screens.filter((sh) => sh.book && sh.story && !isKept(sh) && !failed.current.has(keyOf(sh))) : []
  const liveOf = (sh: Shot) => (canLive && liveOn && sh.book && sh.story ? `/api/visuals/sb/${pr.replace(/[^\w.-]+/g, '-')}/${set.sha}/${sh.book}/iframe.html?id=${encodeURIComponent(sh.story)}&viewMode=story` : undefined)
  const zoomTo = (z: number) => { const v = Math.min(440, Math.max(120, z)); setZoom(v); try { localStorage.setItem('design:board-zoom', String(v)) } catch { /* private window */ } }
  const hot = hover ?? pinned

  // intent: a component lights only once the pointer rests on it (`ms`), and lets go a moment after it leaves; passing
  // over many in a row lights none
  const want = useRef<string | undefined>(undefined), timer = useRef<number | undefined>(undefined)
  const onHover = useCallback((part: string | undefined, ms: number) => {
    if (part === want.current) return
    want.current = part
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHover(part), part ? ms : 220)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const groups = useMemo(() => layout(screens, parts), [screens, parts])
  const usage = useMemo(() => {
    const by = new Map<string, Shot[]>()
    for (const sh of screens) for (const name of new Set((sh.marks ?? []).map((m) => m.part).filter((x): x is string => !!x))) by.set(name, [...(by.get(name) ?? []), sh])
    return by
  }, [screens])
  const names = useMemo(() => [...new Set([...parts.map((x) => x.name), ...usage.keys()])], [parts, usage])
  const lists = useMemo(() => byApp(names.filter((n) => n.toLowerCase().includes(find.trim().toLowerCase())), parts, (n) => usage.get(n)?.length ?? 0), [names, find, parts, usage])
  const has = useMemo(() => new Map(screens.map((sh) => [sh, new Set((sh.marks ?? []).map((m) => m.part))])), [screens])
  const modeOf = (sh: Shot) => (!hot ? 'idle' : has.get(sh)?.has(hot) ? hot : 'dim')
  const url = (sh: Shot) => shotUrl(pr, set.sha, (zoom <= 300 && sh.thumb) || (sh.after ?? sh.before)!)
  const cols = Math.max(1, ...groups.flatMap((g) => g.domains.map((d) => d.screens.length)))
  const onOpen = useCallback((shot: Shot, from: DOMRect) => { setAim(undefined); setOpen({ shot, from }) }, [])

  // the card on where the lit component is used: it eases in and out, holding the last one while it leaves
  const card = useRef<string | undefined>(undefined)
  if (hot) card.current = hot
  const shownCard = card.current
  const part = shownCard ? parts.find((x) => x.name === shownCard) : undefined, used = shownCard ? usage.get(shownCard) ?? [] : []
  const story = shownCard ? set.shots.find((x) => x.lens === 'changed' && x.part === shownCard && x.after) : undefined
  const domainsOf = (xs: Shot[]) => [...new Set(xs.map((x) => x.domain))]

  // a component picked: on the open screen, glide to it; not on it, open the first screen that has it
  const pick = (n: string) => {
    if (!open) return setPinned((x) => (x === n ? undefined : n))
    if (!n) return setAim(undefined)
    if (!(open.shot.marks ?? []).some((m) => m.part === n)) { const other = usage.get(n)?.[0]; if (other) setOpen({ shot: other }) }
    setAim(n); setPinned(n)
  }
  const flat = useMemo(() => groups.flatMap((g) => g.domains.flatMap((d) => d.screens)), [groups])
  const step = (d: number) => setOpen((o) => { if (!o) return o; const i = flat.indexOf(o.shot); const n = flat[(i + d + flat.length) % flat.length]; return { shot: n } })

  return (
    <div className="relative flex overflow-hidden rounded-[6px] bg-surface-1 ring-1 ring-line" style={{ height: fill ? 'max(24rem, calc(100dvh / var(--z, 1) - 11rem))' : 'clamp(24rem, calc(100dvh / var(--z, 1) - 17.5rem), 64rem)' }}>
      {/* a phone or a tablet has no room for the list beside the board: the board alone (Components lists them, a tab away) */}
      <aside aria-label="Components" className="flex w-56 shrink-0 flex-col border-r border-line max-lg:hidden">
        <label className="m-2 flex items-center gap-1.5 rounded-[4px] bg-fill px-2 py-1"><Search className="size-3.5 shrink-0 text-fg-4" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`${names.length} components`} aria-label="Find a component" className="w-full bg-transparent text-small outline-none placeholder:text-fg-4" /></label>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" onMouseLeave={() => onHover(undefined, 0)}>
          {lists.map((g) => {
            const key = g.app ?? '', shut = folded.has(key)
            return (
              <section key={key} className="mb-1">
                {(lists.length > 1 || g.app) && (
                  <button onClick={() => setFolded((f) => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n })} aria-expanded={!shut}
                          className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-surface-1 px-2 pb-1 pt-2.5 text-left label text-fg-4 hover:text-fg-2">
                    <ChevronRight className={`size-3 transition-transform duration-200 ${shut ? '' : 'rotate-90'}`} />{g.app ?? 'Shared'}<span className="ml-auto tabular-nums font-normal normal-case">{g.names.length}</span>
                  </button>
                )}
                {!shut && g.names.map((n) => {
                  const on = hot === n, count = usage.get(n)?.length ?? 0
                  return (
                    <button key={n} onMouseEnter={() => onHover(n, 0)} onFocus={() => onHover(n, 0)} onBlur={() => onHover(undefined, 0)} onClick={() => pick(n)} aria-pressed={pinned === n}
                            className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-[3px] text-left text-small transition-colors duration-300 ${on ? 'bg-accent/10 text-accent-text' : hot ? 'text-fg-4 hover:text-fg-2' : 'text-fg-2 hover:bg-hover'}`}>
                      <span className={`w-5 shrink-0 text-right tabular-nums text-micro ${on ? 'text-accent-text' : 'text-fg-4'}`}>{numbers.get(n) ?? ''}</span>
                      <span className="min-w-0 flex-1 truncate">{bare(n)}</span>
                      {pinned === n ? <Pin className="size-3 shrink-0" /> : <span className={`shrink-0 tabular-nums text-micro ${count ? 'text-fg-4' : 'text-fg-4/50'}`}>{count || '–'}</span>}
                    </button>
                  )
                })}
              </section>
            )
          })}
          {!lists.length && <p className="px-2 py-1.5 text-meta text-fg-4">None matches.</p>}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <div className="absolute right-3 top-2.5 z-20 flex items-center gap-1.5 rounded-[4px] bg-surface-2/90 px-2 py-1 shadow-e1 ring-1 ring-line backdrop-blur">
          <button onClick={() => zoomTo(zoom - 40)} aria-label="Smaller" className="btn-ghost btn-sm px-1.5"><ZoomOut className="size-3.5" /></button>
          <input type="range" min={120} max={440} step={20} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Size of the screens" className="w-20 accent-current text-accent" />
          <button onClick={() => zoomTo(zoom + 40)} aria-label="Larger" className="btn-ghost btn-sm px-1.5"><ZoomIn className="size-3.5" /></button>
        </div>
        {/* the board: a faint grid, moving with the screens */}
        <div className="size-full overflow-auto px-6 pb-8 pt-5" style={{ backgroundImage: 'linear-gradient(color-mix(in oklch, var(--line) 45%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--line) 45%, transparent) 1px, transparent 1px)', backgroundSize: '40px 40px', backgroundAttachment: 'local' }}>
          <div className="w-max space-y-8" style={{ '--cell': zoom } as CSSProperties}>
            {groups.map((g) => (
              <section key={g.app ?? ''} className="space-y-2.5">
                {(groups.length > 1 || g.app) && (
                  <header className="sticky left-0 flex w-fit items-baseline gap-2 pr-4">
                    <h3 className="text-body font-semibold tracking-tight text-fg-1">{g.app ?? 'The app'}</h3>
                    <span className="text-meta text-fg-4">{g.domains.length} domain{g.domains.length === 1 ? '' : 's'} · {g.domains.reduce((n, d) => n + d.screens.length, 0)} screens</span>
                  </header>
                )}
                {g.domains.map((d) => {
                  const lit = !hot || d.screens.some((x) => has.get(x)?.has(hot))
                  return (
                    <div key={d.name} className={`grid items-start gap-x-3.5 rounded-[4px] bg-fill/35 px-3 py-3 ring-1 ring-line/60 transition-opacity duration-500 ${lit ? '' : 'opacity-50'}`}
                         style={{ gridTemplateColumns: `7.5rem repeat(${cols}, ${zoom}px)` }}>
                      <div className="sticky left-0 z-10 self-stretch pr-2 pt-0.5">
                        <p className="text-small font-semibold text-fg-1">{d.name}</p>
                        <p className="text-micro text-fg-4">{d.screens.length} step{d.screens.length === 1 ? '' : 's'}</p>
                      </div>
                      {d.screens.map((sh, i) => <Mini key={`${sh.name}:${sh.after ?? ''}`} src={url(sh)} live={pageOf(sh) || undefined} waiting={pageOf(sh) === ''} shot={sh} mode={modeOf(sh)} step={i + 1} cell={zoom} onHover={onHover} onOpen={onOpen} />)}
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        </div>

        {/* where the lit component is used: eases in, and out with the last one */}
        <div role="status" className={`pointer-events-none absolute bottom-3 right-3 z-20 w-72 rounded-[6px] bg-surface-2/95 p-3 shadow-e3 ring-1 ring-line backdrop-blur transition-[opacity,transform] duration-300 ease-[var(--ease-out)] ${hot && !open ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0'}`}>
          {shownCard && <>
            <div className="flex items-center gap-2">
              <span className="text-micro tabular-nums text-accent-text">{numbers.get(shownCard) ?? ''}</span>
              <span className="min-w-0 flex-1 truncate text-small font-semibold text-fg-1">{bare(shownCard)}</span>
              {part && <KindChip kind={part.kind} />}
            </div>
            {part?.file && <p className="mt-1 truncate font-mono text-micro text-fg-4" title={part.file}>{part.file}</p>}
            {story && <img src={shotUrl(pr, set.sha, story.after!)} alt="" className="mt-2 max-h-20 w-full rounded-[3px] bg-fill object-contain ring-1 ring-line" />}
            <p className="mt-2 text-meta text-fg-2">{used.length ? `On ${used.length} of ${screens.length} screens, in ${domainsOf(used).length} domain${domainsOf(used).length === 1 ? '' : 's'}` : 'On no screen of the map: only in its own stories'}</p>
            <ul className="mt-1 space-y-0.5">
              {domainsOf(used).slice(0, 6).map((d) => <li key={d} className="flex gap-1.5 text-micro"><span className="shrink-0 font-medium text-fg-2">{d}</span><span className="truncate text-fg-3">{used.filter((x) => x.domain === d).map((x) => x.variant).join(', ')}</span></li>)}
            </ul>
            <p className="pointer-events-auto mt-2 flex items-center gap-2 text-micro text-fg-4">
              {pinned === shownCard ? <><Pin className="size-3" />Pinned: click it in the list to let go</> : 'Click it in the list to keep it lit'}
              {story && <button onClick={onStates} className="ml-auto font-medium text-accent-text hover:underline">Its states</button>}
            </p>
          </>}
        </div>

        {canLive && <Renderer base={sbBase} slug={slug} sha={set.sha} jobs={toRender} onDone={(key, ok) => { if (ok) setDone((d) => new Set(d).add(key)); else { failed.current.add(key); setFailures((n) => n + 1) } }} />}
        {open && <Focus key={open.shot.name} pr={pr} sha={set.sha} shot={open.shot} origin={open.from} live={liveOf(open.shot)} target={aim} lit={hot} onPart={pick} onClose={() => { setOpen(undefined); setAim(undefined) }} onStep={step} />}
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
                    options={[...(screens.length ? [{ id: 'board' as const, label: 'Map', count: screens.length, icon: LayoutGrid }] : []), ...(lensed ? [{ id: 'changed' as const, label: 'Changed', count: changed.length, icon: Crosshair }, { id: 'affected' as const, label: 'Affected', count: affected.length, icon: LayoutTemplate }] : []), { id: 'all' as const, label: 'All', count: set.shots.length, icon: Images }]} />
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
/**
 * Design's Components or Tokens view of a project: what Design read of it, and a conversation of its own beside it
 * (runner.ts enqueueChat): ask about a component or a token, or for a change, which comes back as a PR.
 */
function Aspect({ view, repo, feed, toast }: { view: 'components' | 'tokens'; repo: string; feed: Activity[]; toast: Toast }) {
  const narrow = useNarrow() // no room for a column: the conversation is a sheet, always a tap away
  const name = repo.split('/')[1]
  const base = useApi<{ sets: VisualSet[] }>(`/visuals/repos/${repo}`)
  const tokens = useApi<{ sha?: string; books: TokenBook[] }>(view === 'tokens' ? `/visuals/tokens/${repo}` : undefined)
  const chatPath = `/visuals/chat/${view}/${repo}`
  const [ticking, setTicking] = useState(false)
  const chat = useApi<{ task?: VisualsTask & { prUrl?: string } }>(chatPath, { refetchInterval: ticking ? 3000 : 30_000 })
  const t = chat.data?.task
  useEffect(() => setTicking(busy(t)), [t?.state])
  const talkKey = `design-talk:${view}`
  const [talk, setTalkNow] = useState(() => { try { return localStorage.getItem(talkKey) !== '0' } catch { return true } })
  const setTalk = (on: boolean) => { setTalkNow(on); try { localStorage.setItem(talkKey, on ? '1' : '0') } catch { /* private window */ } }
  const post = (body: object, msg?: string) => api(chatPath, body).then(() => { void refresh(chatPath); if (msg) toast(msg) }, (e: Error) => toast(e.message, 'error'))
  const set = base.data?.sets[0], parts = set?.impact?.changed ?? []
  const books = tokens.data?.books ?? []
  // Tokens: a draft, previewed at once; a PR only on "Make the PR"
  const draftPath = `/visuals/tokens/${repo}/draft`
  const draftQ = useApi<TokenDraft>(view === 'tokens' ? draftPath : undefined)
  const [draft, setDraft] = useState<TokenDraft>()
  useEffect(() => { if (draftQ.data) setDraft(draftQ.data) }, [draftQ.data])
  const changes = draft?.changes ?? []
  const keep = (d: TokenDraft) => { setDraft(d); remember(draftPath, d) }
  const postDraft = (body: object) => api(draftPath, body).then((d) => keep(d as TokenDraft), (e: Error) => toast(e.message, 'error'))
  const sends = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // an edit on the sheet: drawn now, kept a moment later (a colour dragged is many edits)
  const edit = (c: DraftChange) => {
    setDraft((d) => {
      const rest = (d?.changes ?? []).filter((x) => !(x.book === c.book && x.name === c.name && x.theme === c.theme))
      return { turns: [], ...d, changes: c.value.trim() && c.value.trim() !== c.was ? [...rest, c] : rest }
    })
    const k = `${c.book}|${c.name}|${c.theme}`
    clearTimeout(sends.current.get(k))
    sends.current.set(k, setTimeout(() => { sends.current.delete(k); void postDraft({ set: c }) }, 300))
  }
  const say = (text: string) => {
    setDraft((d) => ({ changes: [], ...d, turns: [...(d?.turns ?? []), { who: 'you', text, at: new Date().toISOString() }], busy: true, error: undefined }))
    return postDraft({ say: text })
  }
  const confirm = () => postDraft({ confirm: true }).then(() => { void refresh(chatPath); setTicking(true); toast('Making the PR') })
  const count = view === 'tokens' ? books.reduce((n, b) => n + b.tokens.length, 0) : parts.length
  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-4">
          <header className="card px-4 py-3.5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-3">{repo} · {view}</p>
                <h2 className="text-title font-semibold text-fg-1">{view === 'tokens' ? `The design tokens of ${name}` : `The components of ${name}`}</h2>
                <p className={`mt-0.5 text-meta ${t?.state === 'failed' ? 'text-wait-text' : busy(t) ? 'text-run-text' : 'text-fg-3'}`}>
                  {t?.state === 'running' ? `Answering${t.machine ? ` on ${t.machine}` : ''}…` : t?.state === 'queued' ? 'Waiting for a machine with its checkout'
                    : t?.state === 'failed' ? `It didn't finish: ${t.error ?? 'it failed'}`
                    : view === 'tokens' ? (books.length ? `${count} tokens in ${books.length} app${books.length === 1 ? '' : 's'}, read from its built Storybook` : tokens.data ? 'No tokens read yet' : 'Reading its tokens…')
                    : set ? `${count} components, from its Storybook · ${new Date(set.at).toLocaleString()}` : base.data ? 'No components read yet' : 'Reading its components…'}
                </p>
              </div>
              <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                <button onClick={() => setTalk(!talk)} aria-pressed={talk} title={talk ? 'Hide the conversation' : `Talk about its ${view}`} className={`btn-ghost btn-sm inline-flex items-center gap-1.5 max-lg:hidden ${talk ? 'text-accent-text' : ''}`}><MessageSquare className="size-3.5" />Conversation</button>
                {view === 'tokens' && changes.length > 0 && <>
                  <button onClick={() => void postDraft({ discard: true })} className="btn-ghost btn-sm">Discard</button>
                  <button onClick={() => void confirm()} disabled={busy(t)} title={busy(t) ? 'Its agent is still on the last one' : 'The agent changes the code to these values and opens a PR'} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Check className="size-3.5" />Make the PR · {changes.length}</button>
                </>}
                {t?.prUrl && <a href={t.prUrl} target="_blank" rel="noreferrer" className="btn-outline btn-sm inline-flex items-center gap-1.5"><ExternalLink className="size-3.5" />Open the PR</a>}
                {busy(t) && <button onClick={() => post({ cancel: true }, 'Stopped')} className="btn-outline btn-sm inline-flex items-center gap-1.5"><Square className="size-3.5" />Stop</button>}
              </div>
            </div>
          </header>
          {view === 'tokens' ? (!tokens.data ? <Skeleton rows={6} /> : books.length ? <>
                {set && <DraftPreview repo={repo} set={set} books={books} changes={changes} />}
                {books.map((b) => <TokenSheet key={b.book} book={b} changes={changes.filter((c) => c.book === b.book)} onEdit={edit} />)}
              </>
              : <p className="card px-4 py-3 text-small text-fg-3">No tokens yet: they are read from the Storybook its map is built with. Make its map (the Map view), or ask in the conversation.</p>)
            : !base.data ? <Skeleton rows={6} /> : set ? <Impact key={set.sha} pr={baselineKey(repo)} set={set} noBoard />
              : <p className="card px-4 py-3 text-small text-fg-3">No components yet: they are read with its map. Make its map (the Map view), or ask in the conversation.</p>}
        </div>
      </div>
      {(talk || narrow) && view === 'tokens' && <DraftChat draft={draft} task={t} onSay={say} onConfirm={() => void confirm()} onDiscard={() => void postDraft({ discard: true })} />}
      {(talk || narrow) && view !== 'tokens' && <Conversation id={`design-${view}:${repo}`} feed={feed} live={busy(t)} onSay={(text) => post({ say: text })} toast={toast}
                             hint={'Ask about a component (its states, its props, where it is used), or for a change: a new state, a story, a fix. A change comes back as a PR.'}
                             placeholder={'Which states does RuleCard have?'} />}
    </div>
  )
}

const TOKEN_GROUPS: { kinds: Token['kind'][]; label: string }[] = [
  { kinds: ['color'], label: 'Colour' }, { kinds: ['font', 'text', 'weight', 'leading', 'tracking'], label: 'Type' }, { kinds: ['spacing', 'size'], label: 'Space and size' },
  { kinds: ['radius'], label: 'Radius' }, { kinds: ['shadow'], label: 'Shadow' }, { kinds: ['motion'], label: 'Motion' }, { kinds: ['other'], label: 'Other' },
]
/** A token's value as the page reads it: bare channels wrapped the way the app uses them. */
const cssOf = (t: Token) => (t.rgb ? `rgb(var(${t.name}))` : t.hsl ? `hsl(var(${t.name}))` : `var(${t.name})`)

/**
 * One app's tokens, drawn as what they are: colours as swatches (a column per theme), type as samples at its size,
 * radii and shadows on a tile, space as a bar. Each is drawn inside its theme's own values, so a token made of another
 * (var(--accent)) shows as the page shows it.
 */
function TokenSheet({ book, changes, onEdit }: { book: TokenBook; changes: DraftChange[]; onEdit: (c: DraftChange) => void }) {
  const themes = book.themes
  // each theme's values with the draft's: a token made of another (var(--accent)) follows its change too
  const scope = (th: string, orig = false) => Object.fromEntries(book.tokens.flatMap((t) => {
    const v = orig ? t.values[th] ?? t.values.default : valueWith(t, th, changes) ?? valueWith(t, 'default', changes)
    return v === undefined ? [] : [[t.name, v]]
  })) as CSSProperties
  const base = scope('default')
  const changed = (t: Token) => changes.some((c) => c.name === t.name)
  const put = (t: Token, th: string, value: string) => onEdit({ book: book.book, name: t.name, theme: th, value, was: t.values[th] })
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-body font-semibold capitalize text-fg-1">{book.book}</h3>
        <span className="text-meta text-fg-3">{book.tokens.length} tokens{themes.length > 1 ? ` · ${themes.join(', ')}` : ''}</span>
        {changes.length > 0 && <span className="text-meta text-accent-text">· {changes.length} changed</span>}
      </header>
      <div className="space-y-5 px-4 py-4">
        {TOKEN_GROUPS.map((g) => {
          const ts = book.tokens.filter((t) => g.kinds.includes(t.kind))
          if (!ts.length) return null
          return (
            <div key={g.label}>
              <h4 className="label mb-2 text-fg-4">{g.label} · {ts.length}</h4>
              {g.kinds[0] === 'color' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                  {ts.map((t) => {
                    const ths = themes.filter((th) => th in t.values)
                    return (
                      <div key={t.name} className={`overflow-hidden rounded-ctl ring-1 ${changed(t) ? 'ring-accent/70' : 'ring-line'}`} title={Object.entries(t.values).map(([th, v]) => `${th}: ${v}`).join('\n')}>
                        <div className="flex h-12">
                          {themes.filter((th) => th === 'default' || th in t.values).map((th) => (
                            <span key={th} style={{ ...scope(th), background: cssOf(t) }} className="relative flex-1">
                              {changed(t) && <span style={{ ...scope(th, true), background: cssOf(t) }} title="Before" className="absolute inset-x-0 bottom-0 h-2.5" />}
                            </span>
                          ))}
                        </div>
                        <div className="px-2 py-1.5">
                          <p className="truncate font-mono text-micro text-fg-1">{t.name}{t.uses ? <span className="text-fg-4"> · {t.uses}×</span> : null}</p>
                          {ths.map((th) => <EditValue key={th} label={ths.length > 1 ? th : undefined} value={valueWith(t, th, changes) ?? ''} was={t.values[th]} color={t} onCommit={(v) => put(t, th, v)} />)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="divide-y divide-line rounded-ctl ring-1 ring-line">
                  {ts.map((t) => <TokenRow key={t.name} t={t} scope={base} value={valueWith(t, 'default', changes) ?? Object.values(t.values)[0]} onCommit={(v) => put(t, 'default' in t.values ? 'default' : Object.keys(t.values)[0], v)} />)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// the app's own values only on the sample: on the row they would replace Concierge's tokens of the same name (--font-mono)
function TokenRow({ t, scope, value, onCommit }: { t: Token; scope: CSSProperties; value: string; onCommit: (v: string) => void }) {
  const v = `var(${t.name})`
  const sample = t.kind === 'font' ? <span style={{ ...scope, fontFamily: v }} className="text-body text-fg-1">Aa Bb Cc 123</span>
    : t.kind === 'text' ? <span style={{ ...scope, fontSize: v }} className="leading-none text-fg-1">Aa</span>
    : t.kind === 'weight' ? <span style={{ ...scope, fontWeight: v }} className="text-body text-fg-1">Aa Bb</span>
    : t.kind === 'tracking' ? <span style={{ ...scope, letterSpacing: v }} className="text-small text-fg-1">TRACKING</span>
    : t.kind === 'radius' ? <span style={{ ...scope, borderRadius: v }} className="block size-9 bg-accent/15 ring-1 ring-accent/40" />
    : t.kind === 'shadow' ? <span style={{ ...scope, boxShadow: v }} className="block h-9 w-14 rounded-ctl bg-surface-1" />
    : t.kind === 'spacing' || t.kind === 'size' ? <span style={{ ...scope, width: `min(100%, ${v})` }} className="block h-2 min-w-px rounded-full bg-accent/50" />
    : null
  return (
    <div className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_9rem] items-center gap-3 px-3 py-2">
      <span className="truncate font-mono text-micro text-fg-1" title={t.name}>{t.name}</span>
      <span className="flex min-w-0 items-center overflow-hidden">{sample ?? <span className="truncate font-mono text-micro text-fg-3">{value}</span>}</span>
      <EditValue value={value} was={t.values.default ?? Object.values(t.values)[0]} onCommit={onCommit} right />
    </div>
  )
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const hex6 = (v: string) => (v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v)
const toHex = (n: number[]) => `#${n.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
/** A colour token's value as a picker's hex, when it is one plainly: hex, or bare rgb channels. */
function pickable(v: string, t: Token): string | undefined {
  if (HEX.test(v.trim())) return hex6(v.trim())
  if (t.rgb) { const n = v.trim().split(/\s+/).slice(0, 3).map(Number); if (n.length === 3 && n.every((x) => x >= 0 && x <= 255)) return toHex(n) }
  return undefined
}
const fromHex = (h: string, t: Token) => (t.rgb ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ') : h)

/**
 * A token's value, edited in place: a click makes it a field (Enter keeps it, Escape leaves it), a colour also takes a
 * picker, drawn as you drag. A changed one shows what it was; a click on that puts it back.
 */
function EditValue({ value, was, label, color, right, onCommit }: { value: string; was?: string; label?: string; color?: Token; right?: boolean; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(value)
  const changed = was !== undefined && value !== was
  const pick = color ? pickable(value, color) : undefined
  const done = (keep: boolean) => { setEditing(false); if (keep && text.trim() && text.trim() !== value) onCommit(text.trim()) }
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-1 ${right ? 'justify-end' : ''}`}>
      {label && <span className="shrink-0 text-micro text-fg-4">{label}</span>}
      {pick && color && <input type="color" value={pick} onChange={(e) => onCommit(fromHex(e.target.value, color))} aria-label="Pick a colour" className="size-3.5 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent p-0" />}
      {editing ? (
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => done(true)} onFocus={(e) => e.target.select()}
               onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) }}
               className="min-w-0 flex-1 rounded-sm bg-surface-2 px-1 font-mono text-micro text-fg-1 outline-none ring-1 ring-accent/50" />
      ) : (
        <button onClick={() => { setText(value); setEditing(true) }} title="Change it: the preview shows it at once" className={`min-w-0 truncate rounded-sm px-0.5 text-left font-mono text-micro hover:bg-surface-2 ${changed ? 'text-accent-text' : 'text-fg-4'}`}>{value}</button>
      )}
      {changed && !editing && <button onClick={() => onCommit(was!)} title={`Put it back: ${was}`} className={`min-w-0 basis-full truncate font-mono text-micro text-fg-4 line-through hover:text-fg-2 ${right ? 'text-right' : 'text-left'}`}>{was}</button>}
    </div>
  )
}

/**
 * The draft on the app's own screens: each kept page (the board's), with the draft's values set after its own, as they
 * change. Held, "Before" shows them without it.
 */
function DraftPreview({ repo, set, books, changes }: { repo: string; set: VisualSet; books: TokenBook[]; changes: DraftChange[] }) {
  const slug = baselineKey(repo).replace(/[^\w.-]+/g, '-'), base = `/api/visuals/sb/${slug}/${set.sha}`
  const kept = useApi<string[]>(`/visuals/snaps/${slug}/${set.sha}`)
  const [before, setBefore] = useState(false)
  const touched = [...new Set(changes.map((c) => c.book))].join('|')
  const screens = useMemo(() => {
    const seen = new Set<string>(), on = new Set(touched.split('|'))
    const all = set.shots.filter((sh) => {
      const k = `${sh.book}/${sh.story}`
      if (!sh.book || !sh.story || seen.has(k) || !kept.data?.includes(k)) return false
      seen.add(k); return true
    })
    return [...all.filter((sh) => on.has(sh.book!)), ...all.filter((sh) => !on.has(sh.book!))].slice(0, 10)
  }, [set, kept.data, touched])
  const css = useMemo(() => Object.fromEntries(books.map((b) => [b.book, draftCss(b.tokens, changes.filter((c) => c.book === b.book))])), [books, changes])
  if (!kept.data || !screens.length) return null
  const n = changes.length
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-body font-semibold text-fg-1">Preview</h3>
        <span className="min-w-0 flex-1 text-meta text-fg-3">{n ? `${n} change${n === 1 ? '' : 's'} on its screens: nothing reaches the code until you make the PR` : 'Change a value below, or say what you want: its screens show it at once'}</span>
        {n > 0 && (
          <button onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)}
                  onKeyDown={(e) => { if (e.key === ' ') setBefore(true) }} onKeyUp={() => setBefore(false)}
                  aria-pressed={before} title="Hold to see them as they are" className={`btn-outline btn-sm inline-flex items-center gap-1.5 ${before ? 'text-accent-text' : ''}`}><Eye className="size-3.5" />Hold to compare</button>
        )}
      </header>
      <div className="flex gap-3 overflow-x-auto p-3">
        {screens.map((sh) => <DraftScreen key={`${sh.book}/${sh.story}`} src={`${base}/${sh.book}/__snap__/${sh.story}.html`} shot={sh} css={before ? '' : css[sh.book!] ?? ''} />)}
      </div>
    </section>
  )
}

/** One kept page, small, with the draft's stylesheet last in it. */
function DraftScreen({ src, shot, css }: { src: string; shot: Shot; css: string }) {
  const W = shot.width ?? 1280, H = shot.height ?? Math.round(W * 0.625), cw = 300, k = cw / W
  const page = useRef<HTMLIFrameElement>(null), [ready, setReady] = useState(false)
  useEffect(() => {
    try {
      const d = page.current?.contentDocument
      if (!ready || !d?.documentElement) return
      d.documentElement.style.zoom = String(k)
      let st = d.getElementById('concierge-draft')
      if (!st) { st = d.createElement('style'); st.id = 'concierge-draft'; (d.body ?? d.documentElement).append(st) }
      st.textContent = css
    } catch { /* not readable */ }
  }, [ready, css, k])
  return (
    <figure className="shrink-0">
      <div style={{ width: cw, height: Math.min(cw * (H / W), 240) }} className="relative overflow-hidden rounded-ctl bg-surface-2 ring-1 ring-line">
        <iframe ref={page} src={src} title={shot.name} tabIndex={-1} aria-hidden loading="lazy" sandbox="allow-same-origin" onLoad={() => setReady(true)}
                style={{ width: cw, height: cw * (H / W), border: 0, pointerEvents: 'none', opacity: ready ? 1 : 0 }} />
        {!ready && <div className="absolute inset-0"><PageSkeleton /></div>}
      </div>
      <figcaption className="mt-1 max-w-[300px] truncate text-micro text-fg-3">{shot.name}</figcaption>
    </figure>
  )
}

/** Narrower than the room a side column needs (1024px): the conversation is a sheet, not a column. */
function useNarrow() {
  const q = '(max-width: 1023px)'
  const [n, setN] = useState(() => matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return n
}

/**
 * Where a conversation sits: a column beside the page where there is room for one; where there isn't (a tablet, a narrow
 * window), a button over the page's corner that opens it as a sheet from the bottom, low enough that the page it talks
 * about (the preview a token change redraws) stays in sight above it. It is never out of reach.
 */
function TalkFrame({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState(false)
  useEffect(() => { if (!sheet) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false) }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [sheet])
  return (
    <>
      {!sheet && <button onClick={() => setSheet(true)} className="btn-primary fixed bottom-12 right-4 z-30 inline-flex items-center gap-1.5 shadow-e2 lg:hidden"><MessageSquare className="size-4" />Conversation</button>}
      {sheet && <button aria-label="Close the conversation" onClick={() => setSheet(false)} className="fixed inset-0 z-40 animate-[fade-in_200ms] bg-black/10 lg:hidden" />}
      <aside aria-label="Conversation" className={`${sheet ? 'flex max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:h-[55dvh] max-lg:animate-[sheet-in_260ms_var(--ease-snappy)] max-lg:rounded-t-panel max-lg:bg-surface-1 max-lg:shadow-e3' : 'hidden'} w-full shrink-0 flex-col lg:flex lg:w-[clamp(300px,34%,460px)] lg:border-l lg:border-line`}>
        <p className="label flex items-center border-b border-line px-4 py-2.5 text-fg-4">Conversation
          <button onClick={() => setSheet(false)} aria-label="Close the conversation" className="btn-ghost btn-sm -my-1 ml-auto px-1.5 lg:hidden"><X className="size-4" /></button>
        </p>
        {children}
      </aside>
    </>
  )
}

/**
 * The Tokens view's conversation: each message comes back in seconds as the draft (drawn on the preview), not a PR.
 * "Make the PR" hands the draft to the agent, which changes the code to it.
 */
function DraftChat({ draft, task, onSay, onConfirm, onDiscard }: { draft?: TokenDraft; task?: VisualsTask & { prUrl?: string }; onSay: (text: string) => Promise<unknown>; onConfirm: () => void; onDiscard: () => void }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const turns = draft?.turns ?? [], n = draft?.changes.length ?? 0
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [turns.length, draft?.busy])
  const send = () => { const t = text.trim(); if (!t) return; setText(''); void onSay(t) }
  return (
    <TalkFrame>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {!turns.length && <p className="px-1 text-small text-fg-3">Say what to change: "a warmer accent", "rounder cards", "more contrast in dark". The preview shows it in seconds; nothing reaches the code until you make the PR.</p>}
        {turns.map((t, i) => (
          <div key={i} className={t.who === 'you' ? 'ml-8 rounded-card rounded-br-chip bg-accent/12 px-3 py-2 text-small text-fg-1' : 'mr-8 px-1 text-small text-fg-2'}>{t.text}</div>
        ))}
        {draft?.busy && <p className="inline-flex items-center gap-1.5 px-1 text-small text-fg-3"><LoaderCircle className="size-3.5 animate-spin" />Drafting…</p>}
        {draft?.error && <p className="px-1 text-small text-wait-text">{draft.error}</p>}
        {busy(task) && <p className="inline-flex items-center gap-1.5 px-1 text-small text-run-text"><LoaderCircle className="size-3.5 animate-spin" />{task?.state === 'queued' ? 'The PR waits for a machine with its checkout' : 'Making the PR…'}</p>}
        {!busy(task) && task?.prUrl && draft?.sent && <a href={task.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-1 text-small text-accent-text hover:underline"><ExternalLink className="size-3.5" />Open the PR</a>}
        <div ref={end} />
      </div>
      {n > 0 && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="min-w-0 flex-1 text-meta text-fg-3">{n} change{n === 1 ? '' : 's'} on the preview</span>
          <button onClick={onDiscard} className="btn-ghost btn-sm">Discard</button>
          <button onClick={onConfirm} disabled={busy(task)} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Check className="size-3.5" />Make the PR</button>
        </div>
      )}
      <div className="p-2.5">
        <div className="flex items-end gap-2 rounded-card bg-surface-1 p-2 shadow-e1 ring-1 ring-line focus-within:ring-accent/40">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="A warmer accent, rounder cards…"
                    onKeyDown={(e) => { if (sendKey(e)) { e.preventDefault(); send() } }}
                    className="max-h-[160px] flex-1 resize-none bg-transparent px-2 py-1.5 text-body outline-none placeholder:text-fg-4" />
          <button onClick={send} disabled={!text.trim()} aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-ctl bg-accent text-on-accent disabled:opacity-40"><ArrowUp className="size-4" /></button>
        </div>
      </div>
    </TalkFrame>
  )
}

function Conversation({ id, feed, live, onSay, toast, hint, placeholder }: { id: string; feed: Activity[]; live: boolean; onSay: (text: string) => Promise<unknown>; toast: Toast; hint?: string; placeholder?: string }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const shown = useMemo(() => feed, [feed])
  const send = () => { const t = text.trim(); if (!t) return; setText(''); void onSay(t) }
  return (
    <TalkFrame>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length ? <ActivityFeed key={id} feed={shown} live={live} toast={toast} />
          : <p className="px-4 py-3 text-small text-fg-3">{hint ?? 'Say what to look at: a screen, a state, a width. The agent captures it, and keeps what you said for the next commits.'}</p>}
      </div>
      <div className="p-2.5">
        <div className="flex items-end gap-2 rounded-card bg-surface-1 p-2 shadow-e1 ring-1 ring-line focus-within:ring-accent/40">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={placeholder ?? 'Also at phone width, the empty state…'}
                    onKeyDown={(e) => { if (sendKey(e)) { e.preventDefault(); send() } }}
                    className="max-h-[160px] flex-1 resize-none bg-transparent px-2 py-1.5 text-body outline-none placeholder:text-fg-4" />
          <button onClick={send} disabled={!text.trim()} aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-ctl bg-accent text-on-accent disabled:opacity-40"><ArrowUp className="size-4" /></button>
        </div>
      </div>
    </TalkFrame>
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
