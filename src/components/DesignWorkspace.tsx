// Design: what the pull requests look like, before and after, without opening them. Built like Plans: the list on the
// left (the PRs that change what people see, and the tickets marked design), and the open one beside it: its screens,
// before and after, and a conversation with the agent that captured them ("also at phone width": it captures again).
import { ArrowUp, ExternalLink, Images, LoaderCircle, Palette, Square, Camera, Tag } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Activity } from '../../server/runner.ts'
import type { VisualSet, VisualsMode, UiCheck } from '../../server/visuals.ts'
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
type List = { joined: boolean; prs: ListPr[]; tickets: { id: string; title: string; labels: string[]; url: string; prs: string[] }[] }
type Full = VisualsPr & { sets: VisualSet[] }

/** A screenshot's address (served per PR, commit and file name). */
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
        {tickets.length > 0 && <p className="label px-2.5 pb-1 pt-3 text-fg-4">Tickets</p>}
        {tickets.map((t) => (
          <button key={t.id} onClick={() => onSelect(`ticket:${t.id}`)} className={`rounded-lg px-2.5 py-1.5 text-left ${current === `ticket:${t.id}` ? 'sel' : 'hover:bg-hover'}`}>
            <span className="block truncate text-small text-fg-1">{t.title}</span>
            <span className="block truncate text-micro text-fg-3">{t.id}{t.prs.length ? ` · ${t.prs.length} PR${t.prs.length === 1 ? '' : 's'}` : ' · no PR yet'}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {ticket ? <TicketVisuals t={ticket} prs={prs} onSelect={onSelect} />
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
          {set ? <Gallery pr={p.id} set={set} /> : (
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

/** A capture: what changed in words, then each screen before and after, side by side (one alone when it is new or gone). */
function Gallery({ pr, set }: { pr: string; set: VisualSet }) {
  return (
    <div className="space-y-3">
      {set.summary && <div className="card px-4 py-3 text-small text-fg-2"><Md text={set.summary} /></div>}
      <p className="px-0.5 text-meta text-fg-4">{set.shots.length} screen{set.shots.length === 1 ? '' : 's'} · from {set.source === 'storybook' ? 'its Storybook stories' : 'the running app'} · {new Date(set.at).toLocaleString()}</p>
      {set.shots.map((s) => (
        <section key={s.name} className="card overflow-hidden">
          <header className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2">
            <h3 className="text-small font-semibold text-fg-1">{s.name}</h3>
            {s.note && <p className="min-w-0 flex-1 text-meta text-fg-3">{s.note}</p>}
          </header>
          <div className={`grid gap-px bg-line ${s.before && s.after ? 'md:grid-cols-2' : ''}`}>
            {(['before', 'after'] as const).map((side) => s[side] ? (
              <figure key={side} className="bg-surface-1">
                <figcaption className="px-3 pt-2 label text-fg-4">{side === 'before' ? 'Before' : s.before ? 'After' : 'New'}</figcaption>
                <a href={shotUrl(pr, set.sha, s[side]!)} target="_blank" rel="noreferrer" title="Open full size">
                  <img src={shotUrl(pr, set.sha, s[side]!)} alt={`${s.name}, ${side}`} loading="lazy" className="block w-full p-2" />
                </a>
              </figure>
            ) : null)}
          </div>
        </section>
      ))}
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
  const shown = set.shots.filter((s) => s.after ?? s.before).slice(0, 4)
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
