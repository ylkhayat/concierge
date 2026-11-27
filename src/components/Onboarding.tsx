import {
  ArrowLeft, ArrowRight, Bot, Check, CircleAlert, CircleCheck, Copy, ExternalLink, FolderGit2, GitPullRequestArrow, Layers, LayoutGrid, LoaderCircle, Monitor,
  Lock, Moon, Network, Rocket, Search, Settings2, SquareTerminal, Sun, Wallet, Wand, X, Zap, type LucideIcon,
} from 'lucide-react'
import { ReviewIn } from './ReviewIn.tsx'
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import type { SetupView } from '../../server/index.ts'
import type { TailscaleView } from '../../server/tailscale.ts'
import type { RepoFound } from '../../server/setup.ts'
import { api, type Health, type Theme } from '../lib.ts'
import { Agents, blocked, Exec as ExecSetup, forgetSkills, guessSkill, SkillSources, skillsFor, Toggle, WorkflowCard, type FoundSkill, type ProvidersView } from './Settings.tsx'
import { Tabs } from './Tabs.tsx'
import { Pick } from '../ui/Pick.tsx'
import { NearbyMachines } from './NearbyMachines.tsx'

type Suggestion = { repo: string; prs: number; paths: string[]; watched: boolean }
type RepoPick = { on: boolean; path: string; status?: 'ok' | 'checking' | string }

type Icon = ComponentType<{ className?: string }>
/** GitHub's mark (lucide carries no brand icons). */
function GithubMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
}

// GitHub first (everything reads it), then Tailscale when the fleet is loaded (its machines meet there), then the agents
const STEPS: { id: string; title: string; hint: string; icon: Icon }[] = [
  { id: 'github', title: 'GitHub', hint: 'Your PRs and repositories', icon: GithubMark },
  { id: 'tailscale', title: 'Tailscale', hint: 'Your machines, one link', icon: Network },
  { id: 'agents', title: 'Agents', hint: 'Who does the work', icon: Bot },
  { id: 'spaces', title: 'Views', hint: 'Review, Ship, or both', icon: LayoutGrid },
  { id: 'repos', title: 'Repositories', hint: 'Which PRs to watch', icon: FolderGit2 },
  { id: 'skills', title: 'Skills', hint: 'What reviews your PRs', icon: Wand },
  { id: 'exec', title: 'Ship', hint: 'How tickets get shipped', icon: Rocket },
  { id: 'prefs', title: 'Preferences', hint: 'How it behaves', icon: Settings2 },
]

const field = 'w-full rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 ring-line transition-all placeholder:text-fg-3 hover:ring-line-strong focus:ring-2 focus:ring-accent/60'
const primaryBtn = 'inline-flex items-center gap-1.5 btn-primary btn-lg'
const quietBtn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-body font-medium text-fg-3 transition-colors hov hover:text-fg-1'

export function Onboarding({ health, theme, onTheme, onDone, onClose, toast }: {
  health?: Health; theme: Theme; onTheme: (t: Theme) => void; onDone: () => void; onClose?: () => void
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const [step, setStep] = useState(0)
  const [setup, setSetup] = useState<SetupView>()
  const [ts, setTs] = useState<TailscaleView>()
  const [suggested, setSuggested] = useState<Suggestion[]>()
  const [picks, setPicks] = useState<Record<string, RepoPick>>({})
  const [commands, setCommands] = useState({ review: '', revise: '' })
  const [prefs, setPrefs] = useState({ autoStart: true, maxJobs: 2, budget: '', terminal: 'Terminal' as 'Terminal' | 'iTerm' })
  const [saving, setSaving] = useState(false)
  const [spaces, setSpaces] = useState<('review' | 'exec')[]>(['review'])
  const [agents, setAgents] = useState<ProvidersView>()
  // the skills on this machine (yours, plugins', the org's), per kind of work: what onboarding offers and picks from
  const [found, setFound] = useState<Record<'review' | 'revise' | 'exec', FoundSkill[]>>({ review: [], revise: [], exec: [] })
  // the steps follow the setup: Tailscale only with the fleet, skills are Review's, the exec command is Exec's
  const steps = STEPS.filter((s) => (s.id !== 'tailscale' || !!setup?.fleet) && (s.id !== 'skills' || spaces.includes('review')) && (s.id !== 'exec' || spaces.includes('exec')))
  const id = steps[Math.min(step, steps.length - 1)].id
  // the agents' sign-ins, and Tailscale's, re-read while their step is open: a sign-in finishes in another tab
  useEffect(() => {
    if (id !== 'agents' && id !== 'tailscale') return
    const read = () => id === 'agents' ? api('/providers').then(setAgents, () => {}) : api('/tailscale').then(setTs, () => {})
    read(); const t = setInterval(read, 3000)
    return () => clearInterval(t)
  }, [id])
  // read again once skill sources are added: their skills join the suggestions
  const [sourcesAt, setSourcesAt] = useState(0)
  useEffect(() => { void Promise.all((['review', 'revise', 'exec'] as const).map((w) => skillsFor(w))).then(([review, revise, exec]) => setFound({ review, revise, exec })) }, [sourcesAt])
  const guess = { review: guessSkill(found.review, 'review'), revise: guessSkill(found.revise, 'revise'), exec: guessSkill(found.exec, 'exec') }
  // a first setup on a machine that already has a review and a revise skill: those, not the starters. "First" is how
  // the setup was when onboarding opened (saving the repositories on the way marks it configured), and never once you
  // chose yourself; the skills can take a few seconds to read, so this waits for them
  const picked = useRef(false), first = useRef<boolean | undefined>(undefined)
  if (setup && first.current === undefined) first.current = !setup.configured
  useEffect(() => {
    if (picked.current || !first.current || !guess.review || !guess.revise) return
    picked.current = true
    setCommands({ review: guess.review.command, revise: guess.revise.command })
  }, [setup, guess.review?.command, guess.revise?.command]) // eslint-disable-line react-hooks/exhaustive-deps

  const opened = useRef(false)
  const load = () => api('/setup').then((s: SetupView) => {
    setSetup(s)
    if (!opened.current) {
      opened.current = true
      // the steps as this setup has them (before the state above is in)
      const list = STEPS.filter((x) => (x.id !== 'tailscale' || s.fleet) && (x.id !== 'skills' || s.config.workspaces.includes('review')) && (x.id !== 'exec' || s.config.workspaces.includes('exec')))
      const at = (k?: string) => Math.max(0, list.findIndex((x) => x.id === k))
      // reopening from Settings starts at the workspaces: the sign-ins are done by then. A first setup goes back to
      // where it was left (a GitHub sign-in that lapsed since comes first again)
      setStep(onClose ? at('spaces') : s.checks && !s.checks.github.ok ? 0 : at(s.onboardingStep))
    }
    setSpaces(s.config.workspaces)
    setCommands({ review: s.config.review, revise: s.config.revise })
    setPrefs((p) => ({ ...p, terminal: s.config.terminal }))
  })
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!onClose) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); onClose() } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  useEffect(() => {
    if (health) setPrefs((p) => ({ ...p, autoStart: health.autoStart, maxJobs: health.settings.maxJobs, budget: health.settings.dailyBudgetUsd?.toString() ?? '' }))
  }, [!!health]) // eslint-disable-line react-hooks/exhaustive-deps

  // repositories: suggestions from GitHub activity, matched to checkouts found on disk
  useEffect(() => {
    if (id !== 'repos' || suggested) return
    api('/setup/repos').then((list: Suggestion[]) => {
      setSuggested(list)
      const watched = setup?.config.repos ?? {}
      setPicks(Object.fromEntries(list.map((s) => {
        const path = Object.entries(watched).find(([r]) => r.toLowerCase() === s.repo.toLowerCase())?.[1] ?? s.paths[0] ?? ''
        return [s.repo, { on: s.watched || (!Object.keys(watched).length && s.paths.length > 0 && s.prs > 0), path, status: path ? 'ok' : undefined }]
      })))
    }, () => setSuggested([]))
  }, [id, suggested, setup])

  const check = async (repo: string, path: string) => {
    setPicks((p) => ({ ...p, [repo]: { ...p[repo], path, status: 'checking' } }))
    const r = await api('/setup/validate', { repo, path }).catch(() => ({ ok: false, error: 'Could not check' }))
    setPicks((p) => ({ ...p, [repo]: { ...p[repo], path, status: r.ok ? 'ok' : r.error } }))
  }
  // no checkout yet: clone one into the code folder
  const clone = async (repo: string) => {
    setPicks((p) => ({ ...p, [repo]: { ...p[repo], status: 'checking' } }))
    const r = await api('/setup/clone', { repo }).catch((e: Error) => ({ error: e.message }))
    setPicks((p) => ({ ...p, [repo]: { ...p[repo], ...(r.path ? { path: r.path, status: 'ok' } : { status: r.error }) } }))
  }
  const chosen = useMemo(() => Object.entries(picks).filter(([, p]) => p.on), [picks])
  // the repositories it will watch: what you picked on their step, or (resumed past it, so nothing picked in this visit)
  // the ones saved when you left it
  const picksMade = !!suggested
  const repoList = picksMade ? Object.fromEntries(chosen.map(([r, p]) => [r, p.path])) : setup?.config.repos ?? {}
  const reposReady = picksMade ? chosen.length > 0 && chosen.every(([, p]) => p.status === 'ok') : Object.keys(repoList).length > 0

  // one found by search (or pasted as a link): on top of the list, picked, with its checkout here if it has one
  const addFound = (f: RepoFound) => {
    const key = f.repo.toLowerCase()
    setSuggested((s) => {
      const had = (s ?? []).find((x) => x.repo.toLowerCase() === key)
      return [{ repo: had?.repo ?? f.repo, prs: had?.prs ?? 0, paths: had?.paths.length ? had.paths : f.paths, watched: f.watched }, ...(s ?? []).filter((x) => x.repo.toLowerCase() !== key)]
    })
    setPicks((p) => {
      const had = Object.entries(p).find(([r]) => r.toLowerCase() === key)?.[1]
      const path = had?.path || f.paths[0] || ''
      return { ...p, [f.repo]: { on: true, path, status: had?.status ?? (path ? 'ok' : undefined) } }
    })
  }

  // the skill repositories you add: fetched into Concierge's own folder, their skills offered for review and revise
  const saveSources = (list: string[]) => api('/config', { skillSources: list }).then((s: SetupView) => {
    setSetup(s); forgetSkills(); setSourcesAt(Date.now()); picked.current = false
    toast(list.length ? `${s.skills.length} skill${s.skills.length === 1 ? '' : 's'} from ${list.length} source${list.length === 1 ? '' : 's'}` : 'No skill sources')
  }, (e: Error) => { toast(e.message, 'error'); throw e })

  const finish = async () => {
    setSaving(true)
    try {
      await api('/config', {
        repos: repoList,
        workspaces: spaces,
        review: commands.review,
        revise: commands.revise,
        terminal: prefs.terminal,
      })
      const budget = prefs.budget.trim() === '' ? null : Number(prefs.budget)
      await api('/settings', { maxJobs: prefs.maxJobs, dailyBudgetUsd: budget })
      await api('/auto-start', { on: prefs.autoStart })
      toast(onClose ? 'Settings saved' : `Watching ${chosen.length} repo${chosen.length === 1 ? '' : 's'}. You're all set`)
      onDone()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally { setSaving(false) }
  }

  const c = setup?.checks
  const agentReady = !!agents?.accounts.some((a) => !blocked(a))
  // where you are, kept on the server: a reload, another browser or a rebuild opens onboarding here again
  // the furthest step you reached: going back to an earlier one keeps everything up to it done and a click away, and a
  // reload (another browser, a rebuild) opens there again. Kept on the server
  const [reached, setReached] = useState(0)
  useEffect(() => setReached((r) => Math.max(r, step)), [step])
  const furthest = steps[Math.min(reached, steps.length - 1)].id
  useEffect(() => { if (setup && !onClose) void api('/setup/step', { step: furthest }).catch(() => {}) }, [furthest, !!setup]) // eslint-disable-line react-hooks/exhaustive-deps
  // a sign-in that finishes while its step is open moves on by itself (the agents' step waits: you may add more; so does
  // Tailscale's, which then shows the machines it found)
  const signedIn = id === 'github' ? !!c?.github.ok : undefined
  const wasIn = useRef(signedIn)
  useEffect(() => {
    const before = wasIn.current; wasIn.current = signedIn
    if (signedIn && before === false) { const t = setTimeout(() => setStep((n) => n + 1), 900); return () => clearTimeout(t) }
  }, [id, signedIn])
  const canNext = {
    github: !!c?.github.ok, tailscale: !!ts?.signedIn, agents: agentReady, spaces: spaces.length > 0, repos: reposReady, prefs: true,
    skills: !!commands.review.trim() && !!commands.revise.trim(),
    exec: !!setup?.config.exec.command,
  }[id]
  // the repos are saved on the way out of their step: Exec maps tickets to them, and onboarding resumed later (a
  // reload, another browser) finishes with them
  const next = async () => {
    if (id === 'repos') {
      try { setSetup(await api('/config', { repos: Object.fromEntries(chosen.map(([r, p]) => [r, p.path])) })) }
      catch (e) { return toast((e as Error).message, 'error') }
    }
    setStep(step + 1)
  }
  const saveExec = (body: object, msg: string) => api('/config', body).then((s: SetupView) => { setSetup(s); toast(msg) }, (e: Error) => toast(e.message, 'error'))
  const toggleSpace = (w: 'review' | 'exec') => setSpaces((x) => (x.includes(w) ? x.filter((y) => y !== w) : [...x, w]))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-fill/60 p-4 sm:p-8">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(139_92_246/0.12),transparent)]" />
      <div className="relative flex max-h-full w-full max-w-4xl animate-[toast-in_300ms_var(--ease-snappy)] flex-col overflow-hidden rounded-3xl bg-surface-1 shadow-2xl ring-1 ring-line md:h-[min(680px,100%)] md:flex-row">
        {/* step rail */}
        <aside className="flex shrink-0 flex-col gap-6 border-b border-line bg-fill/60 p-6 md:w-64 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent text-white shadow-md shadow-accent/30"><GitPullRequestArrow className="size-5" /></span>
            <div>
              <div className="font-semibold tracking-tight">Concierge</div>
              <div className="text-meta text-fg-3">{onClose ? 'Settings' : 'Let’s get you set up'}</div>
            </div>
          </div>
          <ol className="flex gap-1 md:flex-col">
            {steps.map((s, i) => {
              const done = i < reached && i !== step, on = i === step
              return (
                <li key={s.id} className="flex-1 md:flex-none">
                  <button onClick={() => (i <= reached || onClose) && setStep(i)} disabled={i > reached && !onClose}
                          className={`group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${on ? 'sel' : 'hover:bg-hover disabled:hover:bg-transparent'}`}>
                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors ${done ? 'bg-accent text-on-accent' : on ? 'bg-accent/15 text-accent-text' : 'bg-fill text-fg-3'}`}>
                      {done ? <Check className="size-4" strokeWidth={3} /> : <s.icon className="size-4" />}
                    </span>
                    <span className="hidden min-w-0 md:block">
                      <span className={`block text-body font-medium ${on || done ? 'text-fg-1 ' : 'text-fg-3'}`}>{s.title}</span>
                      <span className="block truncate text-meta text-fg-3">{s.hint}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {setup && <p className="mt-auto hidden break-all font-mono text-micro text-fg-3 md:block">Saved to {setup.configFile.replace(/^\/Users\/(?!Shared\/)[^/]+/, '~')}</p>}
        </aside>

        {/* step body */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {onClose && (
            <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-3 transition-colors hov hover:text-fg-2 " aria-label="Close"><X className="size-4" /></button>
          )}
          <div key={step} className="min-h-0 flex-1 animate-[rise-in_260ms_var(--ease-snappy)] overflow-y-auto p-6 sm:p-8">
            {!setup ? <Loading text="Checking your setup" /> : id === 'github' ? (
              <Step title="Connect GitHub" lead="Concierge reads the pull requests you are asked to review and pushes fixes to your own, private repositories included. You sign in here once; nothing goes in a file.">
                <GithubCard c={c!.github} onSaved={load} toast={toast} />
              </Step>
            ) : id === 'tailscale' ? (
              <Step title="Join your tailnet" lead="The fleet runs Concierge on your machines one at a time and gives them one shared link, all over Tailscale. Sign this machine's link in to your tailnet.">
                <TailscaleCard ts={ts} />
                {ts?.signedIn && <NearbyMachines />}
              </Step>
            ) : id === 'agents' ? (
              <Step title="Sign in your agents" lead="The agents run on plans you already pay for. Sign in to at least one; add more later and the work is spread across them.">
                <Agents compact toast={toast} onConnections={() => {}} />
              </Step>
            ) : id === 'spaces' ? (
              <Step title="What will you use it for?" lead="Each view is its own place in the app, with its own setup. Pick one or both; Settings can change it later.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice on={spaces.includes('review')} onClick={() => toggleSpace('review')} icon={GitPullRequestArrow} title="Review"
                          body="Review the PRs you are asked to, and revise your own from their threads. Prepared by an agent, finished by you." />
                  <div data-accent="exec" className="contents">
                    <Choice on={spaces.includes('exec')} onClick={() => toggleSpace('exec')} icon={Rocket} title="Ship"
                            body={`Ship your Linear tickets: an agent runs your exec command and opens the PRs.${setup.linearKey ? ' Linear is connected.' : ''}`} />
                  </div>
                </div>
                {spaces.includes('exec') && !setup.linearKey && (
                  <KeyField name="LINEAR_API_KEY" placeholder="lin_api_…" hint={<>A personal API key: Linear → Settings → Security &amp; access.</>} onSaved={load} toast={toast} />
                )}
              </Step>
            ) : id === 'repos' ? (
              <Step title="Pick the repositories to watch" lead="Concierge reviews PRs in these repos, using a local checkout of each. Suggestions come from your recent PR activity and the clones it found on this machine.">
                <RepoSearch onPick={addFound} picked={chosen.map(([r]) => r.toLowerCase())} />
                {!suggested ? <Loading text="Looking through GitHub and your code folders" /> : (
                  <div className="space-y-2">
                    {suggested.length === 0 && <p className="text-body text-fg-3">No suggestions from your recent pull requests: search for a repository above.</p>}
                    {suggested.map((s) => {
                      const p = picks[s.repo] ?? { on: false, path: '' }
                      return (
                        <div key={s.repo} className={`rounded-2xl p-3 ring-1 transition-all ${p.on ? 'bg-accent/4 ring-accent/30' : 'ring-line hover:ring-line-strong'}`}>
                          <label className="flex cursor-pointer items-center gap-3">
                            <input type="checkbox" checked={p.on} onChange={(e) => setPicks((x) => ({ ...x, [s.repo]: { ...p, on: e.target.checked } }))} className="size-4 accent-accent" />
                            <span className="min-w-0 flex-1 truncate font-mono text-body font-medium">{s.repo}</span>
                            {s.prs > 0 && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-meta text-fg-3">{s.prs} PR{s.prs === 1 ? '' : 's'} lately</span>}
                          </label>
                          {p.on && (
                            <div className="mt-2.5 flex items-center gap-2 pl-7">
                              {s.paths.length > 1 ? (
                                <Pick label={`${s.repo}: checkout`} value={p.path} onChange={(x) => check(s.repo, x)} options={s.paths.map((x) => ({ value: x, label: x, mono: true }))} />
                              ) : (
                                <input value={p.path} placeholder="Local checkout, e.g. ~/code/repo" onChange={(e) => setPicks((x) => ({ ...x, [s.repo]: { ...p, path: e.target.value, status: undefined } }))}
                                       onBlur={(e) => e.target.value && check(s.repo, e.target.value)} className={`${field} font-mono`} />
                              )}
                              {!s.paths.length && p.status !== 'ok' && (
                                <button onClick={() => clone(s.repo)} disabled={p.status === 'checking'} title="Clone it into your code folder with the GitHub CLI"
                                        className="shrink-0 rounded-lg px-2.5 py-1.5 text-small font-medium text-accent-text ring-1 ring-accent/30 hover:bg-accent/10 disabled:opacity-50">
                                  {p.status === 'checking' ? 'Cloning…' : 'Clone it'}</button>
                              )}
                              <PathStatus status={p.status} />
                            </div>
                          )}
                          {p.on && p.status && p.status !== 'ok' && p.status !== 'checking' && <p className="mt-1.5 pl-7 text-small text-fail-text">{p.status}</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Step>
            ) : id === 'exec' ? (
              <div data-accent="exec">
                <Step title="Set up Ship" lead="The command an agent runs to ship a ticket, the Linear teams to show, and which repository each ticket prefix lives in. Save, then continue.">
                  <div className="space-y-4">
                    <WorkflowCard work="exec" title="Ship a ticket" icon={Rocket} trigger="When you press Run on tickets; several are stacked in the order picked" value={setup.config.exec?.command ?? ''}
                                  suggested={guess.exec?.command} onSave={(v) => saveExec({ exec: { ...setup.config.exec, command: v } }, 'Ship command saved')} />
                    <ExecSetup setup={setup} saveConfig={saveExec} />
                  </div>
                </Step>
              </div>
            ) : id === 'skills' ? (
              <Step title="Choose the skills that do the work" lead="A review request runs a review skill; your own PRs run a revise skill. Use your own, or add repositories of skills: Concierge keeps them in its own folder for its agents and never touches your ~/.claude.">
                <ReviewIn setup={setup} onSaved={setSetup} />
                {c && !c.crit.ok && <ToolRow name="crit" c={c.crit} note="You chose to review in crit" />}
                {setup.brokenLinks.length > 0 && (
                  <div className="rounded-2xl bg-wait/6 px-3.5 py-3 text-small ring-1 ring-wait/20">
                    <p className="flex items-center gap-2 font-medium text-wait-text"><CircleAlert className="size-4 shrink-0" />Some of your skills are links Concierge can&apos;t follow here</p>
                    <p className="mt-1 text-fg-3">{setup.brokenLinks.map((l) => l.name).join(', ')} point into {[...new Set(setup.brokenLinks.map((l) => l.to.replace(/\/[^/]+\/?$/, '')))].join(', ')}, which the container doesn&apos;t see. Run <code className="font-mono">bin/up</code> again: it mounts that folder. Nothing of yours is changed meanwhile.</p>
                  </div>
                )}
                <SkillSources list={setup.skillSources} skills={setup.skills} onSave={saveSources} />
                <div className="space-y-3">
                  {guess.review && guess.revise && first.current && commands.review === guess.review.command && <p className="flex items-center gap-1.5 text-small text-ok-text"><CircleCheck className="size-4" />Picked the review and revise skills found here: change them below.</p>}
                  <WorkflowCard work="review" title="Review someone else’s PR" icon={GitPullRequestArrow} trigger="When your review is requested" value={commands.review} suggested={guess.review?.command} onSave={(v) => setCommands((x) => ({ ...x, review: v }))} />
                  <WorkflowCard work="revise" title="Revise your own PR" icon={Wand} trigger="When new feedback lands on your PR" value={commands.revise} suggested={guess.revise?.command} onSave={(v) => setCommands((x) => ({ ...x, revise: v }))} />
                  {setup.reviewIn === 'crit' && <p className="text-small text-fg-3">Your skill should print <code className="rounded bg-fill px-1">crit is at http://localhost:&lt;port&gt;</code> and end its turn once ready. The README lists the full contract.</p>}
                </div>
              </Step>
            ) : (
              <Step title="Set how it behaves" lead="All of these live in Settings too.">
                <div className="divide-y divide-line rounded-2xl ring-1 ring-line ">
                  {spaces.includes('review') && (
                    <Pref icon={Zap} title="Auto-review" hint="Start the review skill as soon as someone requests your review.">
                      <Toggle label="Auto-review" on={prefs.autoStart} onChange={(v) => setPrefs({ ...prefs, autoStart: v })} />
                    </Pref>
                  )}
                  <Pref icon={Layers} title="Parallel runs" hint="Agent runs at once; more are queued.">
                    <Tabs label="Parallel runs" value={String(prefs.maxJobs)} options={['1', '2', '3', '4'].map((n) => ({ id: n, label: n }))} onChange={(n) => setPrefs({ ...prefs, maxJobs: Number(n) })} />
                  </Pref>
                  <Pref icon={Wallet} title="Daily budget" hint="Stop starting runs once today's spend reaches it. Empty means no cap.">
                    <label className="flex w-28 items-center gap-1 rounded-xl bg-fill/60 px-3 py-1.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent/60 ">
                      <span className="text-body text-fg-3">$</span>
                      <input inputMode="decimal" value={prefs.budget} placeholder="no cap" onChange={(e) => setPrefs({ ...prefs, budget: e.target.value })} className="w-full bg-transparent text-body outline-none" />
                    </label>
                  </Pref>
                  <Pref icon={SquareTerminal} title="Terminal for Resume" hint="Where an agent session opens when you take over.">
                    <Tabs<'Terminal' | 'iTerm'> label="Terminal for Resume" value={prefs.terminal} options={[{ id: 'Terminal', label: 'Terminal' }, { id: 'iTerm', label: 'iTerm' }]} onChange={(v) => setPrefs({ ...prefs, terminal: v })} />
                  </Pref>
                  <Pref icon={Sun} title="Appearance" hint="Saved in this browser.">
                    <Tabs<Theme> label="Appearance" value={theme} options={[{ id: 'system', icon: Monitor, label: <span className="sr-only">System</span>, title: 'System' }, { id: 'light', icon: Sun, label: <span className="sr-only">Light</span>, title: 'Light' }, { id: 'dark', icon: Moon, label: <span className="sr-only">Dark</span>, title: 'Dark' }]} onChange={onTheme} />
                  </Pref>
                </div>
                {/* the safety story, said once, where you decide how much runs on its own */}
                <div className="mt-4 rounded-2xl bg-ok/6 p-4 text-small leading-relaxed ring-1 ring-ok/20">
                  <p className="font-semibold text-ok-text">What the agents never do on their own</p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-fg-2 ">
                    <li>Post a review, approve, reply or push on a PR: those wait for your click.</li>
                    <li>Merge anything, unless you turn on “Ship as one PR” for a repository; or touch your main checkout: they work in throwaway worktrees.</li>
                    <li>Run a command outside the allowed tools in Settings. Anything denied shows up in the run.</li>
                    <li>Spend past your daily budget: new runs wait for tomorrow or a higher cap.</li>
                  </ul>
                  <p className="mt-1.5 text-fg-3">Ship is the exception you opt into: it opens PRs and comments on its tickets, as the skill you choose says.</p>
                </div>
              </Step>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-line px-6 py-4 sm:px-8 ">
            {step > 0 && <button onClick={() => setStep(step - 1)} className={quietBtn}><ArrowLeft className="size-4" />Back</button>}
            <span className="flex-1 text-center text-meta text-fg-4 tabular-nums">Step {Math.min(step, steps.length - 1) + 1} of {steps.length}</span>
            {id === 'repos' && chosen.length > 0 && !reposReady && <span className="text-small text-fg-3">Each picked repo needs a valid checkout</span>}
            {id === 'exec' && !canNext && <span className="text-small text-fg-3">Save an exec command to continue</span>}
            {step < steps.length - 1
              ? <button onClick={next} disabled={!canNext} className={primaryBtn}>Continue<ArrowRight className="size-4" /></button>
              : <>
                  {!reposReady && !saving && <button onClick={() => setStep(steps.findIndex((x) => x.id === 'repos'))} className="text-small text-fg-3 underline decoration-line-strong underline-offset-2 hover:text-fg-1">Pick a repository to watch first</button>}
                  <button onClick={finish} disabled={saving || !reposReady} className={primaryBtn}>{onClose ? <><Check className="size-4" />Save</> : <>Let’s go{saving ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}</>}</button>
                </>}
          </footer>
        </section>
      </div>
    </div>
  )
}

function Step({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-body leading-relaxed text-fg-3">{lead}</p>
      </header>
      {children}
    </div>
  )
}

function Loading({ text }: { text: string }) {
  return <div className="flex items-center gap-2.5 py-10 text-body text-fg-3"><LoaderCircle className="size-4 animate-spin text-accent" />{text}…</div>
}

function ToolRow({ name, c, note }: { name: string; c: { ok: boolean; detail: string; fix?: string }; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-wait/6 px-3.5 py-3 ring-1 ring-wait/20">
      <CircleAlert className="size-5 shrink-0 text-wait" />
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium">{name}: {c.detail}</div>
        {note && <div className="text-small text-fg-3">{note}</div>}
      </div>
      {c.fix && <CopyCommand text={c.fix} />}
    </div>
  )
}

function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
            className="group flex max-w-full shrink-0 items-center gap-1.5 rounded-lg bg-fill px-2.5 py-1.5 font-mono text-meta text-fg-2 transition-colors hover:bg-active" title="Copy">
      <span className="truncate">{text}</span>{copied ? <Check className="size-3 shrink-0 text-ok" /> : <Copy className="size-3 shrink-0 opacity-50 group-hover:opacity-100" />}
    </button>
  )
}

/** One service to connect, as one card: its mark, where it stands, and the one thing to do next. */
function ServiceCard({ icon: Icon, name, ok, detail, action, children }: { icon: Icon; name: string; ok: boolean; detail: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3.5 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill text-fg-1"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-reading font-semibold">{name}
            {ok && <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-px text-micro font-medium text-ok-text ring-1 ring-inset ring-ok/20"><Check className="size-3" strokeWidth={3} />Connected</span>}
          </div>
          <div className="truncate text-small text-fg-3">{detail}</div>
        </div>
        {action}
      </div>
      {children && <div className="space-y-3 border-t border-line bg-fill/40 p-4">{children}</div>}
    </div>
  )
}

/**
 * Search every repository your GitHub account reaches, or paste a link to one (a public one outside it too). Results
 * come as you type; Enter or a click adds the first or the chosen one to the list above it, picked.
 */
function RepoSearch({ onPick, picked }: { onPick: (f: RepoFound) => void; picked: string[] }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ q: string; list: RepoFound[]; error?: string }>()
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  useEffect(() => {
    const t = q.trim()
    if (!t) { setFound(undefined); return }
    setBusy(true)
    const h = setTimeout(() => {
      api(`/setup/repos/search?q=${encodeURIComponent(t)}`).then((list: RepoFound[]) => { setFound({ q: t, list }); setAt(0) },
        (e: Error) => setFound({ q: t, list: [], error: e.message })).finally(() => setBusy(false))
    }, 180)
    return () => clearTimeout(h)
  }, [q])
  const pick = (f?: RepoFound) => { if (!f) return; onPick(f); setQ(''); setFound(undefined) }
  const list = found?.list ?? []
  return (
    <div className="space-y-1.5">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your repositories, or paste a GitHub link" aria-label="Search repositories" spellCheck={false} autoComplete="off"
               onKeyDown={(e) => {
                 if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, list.length - 1)) }
                 if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)) }
                 if (e.key === 'Enter') { e.preventDefault(); pick(list[at]) }
                 if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ('') }
               }}
               className={`${field} pl-9 pr-9`} />
        {busy && <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-fg-3" />}
      </label>
      {found && (
        <div className="card max-h-72 overflow-y-auto p-1" role="listbox" aria-label="Repositories found">
          {found.error ? <p className="px-3 py-2.5 text-small text-fail-text">{found.error}</p>
            : !list.length ? <p className="px-3 py-2.5 text-small text-fg-3">Nothing matches “{found.q}”. A full link (github.com/owner/repo) finds one outside your account.</p>
            : list.map((f, i) => {
              const on = picked.includes(f.repo.toLowerCase())
              return (
                <button key={f.repo} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => pick(f)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${i === at ? 'bg-hover' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-mono text-body font-medium text-fg-1">
                      <span className="truncate">{f.repo}</span>{f.private && <Lock className="size-3 shrink-0 text-fg-3" aria-label="Private" />}
                    </span>
                    {f.description && <span className="block truncate text-meta text-fg-3">{f.description}</span>}
                  </span>
                  <span className="shrink-0 text-meta text-fg-3">{on ? <span className="flex items-center gap-1 text-ok-text"><Check className="size-3.5" />Added</span> : f.paths.length ? 'On this machine' : 'Clone it'}</span>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}

function PathStatus({ status }: { status?: string }) {
  if (status === 'checking') return <LoaderCircle className="size-4 shrink-0 animate-spin text-fg-3" />
  if (status === 'ok') return <CircleCheck className="size-4 shrink-0 text-ok" />
  if (status) return <CircleAlert className="size-4 shrink-0 text-fail" />
  return <span className="size-4 shrink-0" />
}

function Choice({ on, onClick, icon: Icon, title, body }: { on: boolean; onClick: () => void; icon: LucideIcon; title: string; body: string }) {
  return (
    <button onClick={onClick} aria-pressed={on}
            className={`group flex flex-col rounded-2xl p-4 text-left ring-1 transition-all ${on ? 'bg-accent/5 ring-2 ring-accent' : 'ring-line hover:shadow-md hover:ring-line-strong'}`}>
      <span className={`mb-2.5 flex size-8 items-center justify-center rounded-lg ${on ? 'bg-accent text-on-accent' : 'bg-fill text-fg-3'}`}><Icon className="size-4" /></span>
      <span className="block text-reading font-semibold">{title}</span>
      <span className="mt-1 block text-small leading-relaxed text-fg-3">{body}</span>
    </button>
  )
}

function Pref({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <Icon className="size-4 shrink-0 text-fg-3" />
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium">{title}</div>
        <div className="text-small text-fg-3">{hint}</div>
      </div>
      {children}
    </div>
  )
}

/** A key pasted into the page: checked by the server against GitHub or Linear, then kept for every machine. */
function KeyField({ name, placeholder, hint, onSaved, toast, label, bare }: { name: string; placeholder: string; hint: ReactNode; onSaved: () => void; toast: (m: string, tone?: 'ok' | 'error') => void; label?: string; bare?: boolean }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const save = () => { setBusy(true); api('/shared-keys', { name, value: v.trim() }).then((r: { who?: string }) => { toast(r.who ? `Connected as ${r.who}` : 'Connected'); setV(''); onSaved() }, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false)) }
  return (
    <div className={`space-y-1.5 ${bare ? '' : 'card p-3'}`}>
      {label && <p className="text-meta font-medium text-fg-3">{label}</p>}
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && save()} placeholder={placeholder} aria-label={name} className={`${field} font-mono`} />
        <button onClick={save} disabled={!v.trim() || busy} className="inline-flex shrink-0 items-center gap-1.5 btn-outline">{busy ? <LoaderCircle className="size-4 animate-spin" /> : 'Connect'}</button>
      </div>
      <p className="text-small text-fg-3">{hint}</p>
    </div>
  )
}

/**
 * GitHub, as one card: the GitHub CLI's device sign-in (a code to enter at github.com; Concierge keeps the token it got,
 * server/githubLogin.ts), or a pasted token for an organisation that blocks that app.
 */
function GithubCard({ c, onSaved, toast }: { c: { ok: boolean; detail: string }; onSaved: () => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [code, setCode] = useState<{ code: string; url: string }>()
  const [busy, setBusy] = useState(false)
  const [paste, setPaste] = useState(false)
  useEffect(() => {
    if (!code) return
    const t = setInterval(() => {
      void api('/github/login').then((s: { done: boolean; ok: boolean; error?: string; login?: string } | null) => {
        if (!s?.done) return
        clearInterval(t); setCode(undefined)
        if (s.ok) { toast(`Signed in to GitHub${s.login ? ` as ${s.login}` : ''}`); onSaved() } else toast(s.error ?? 'The sign-in didn’t finish', 'error')
      }, () => {})
    }, 2000)
    return () => clearInterval(t)
  }, [code?.code]) // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { setBusy(true); api('/github/login', {}).then(setCode, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false)) }
  if (c.ok) return <ServiceCard icon={GithubMark} name="GitHub" ok detail={c.detail} />
  return (
    <ServiceCard icon={GithubMark} name="GitHub" ok={false} detail="Repositories, pull requests and their checks"
                 action={!code && <button onClick={start} disabled={busy} className={`${primaryBtn} shrink-0`}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <GithubMark className="size-4" />}Sign in</button>}>
      {code ? (
        <div className="space-y-2.5">
          <p className="text-small text-fg-2">Open <a href={code.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline">{code.url.replace('https://', '')}<ExternalLink className="size-3" /></a> and enter this code:</p>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => void navigator.clipboard?.writeText(code.code).then(() => toast('Code copied'))} title="Copy the code" className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-1.5 font-mono text-title font-semibold tracking-widest text-fg-1 ring-1 ring-line hover:ring-accent/50">{code.code}<Copy className="size-3.5 text-fg-3" /></button>
            <span className="flex items-center gap-1.5 text-meta text-fg-3"><LoaderCircle className="size-3.5 animate-spin" />Waiting for you to approve it…</span>
          </div>
        </div>
      ) : paste ? (
        <KeyField bare label="A token with repo access" name="GITHUB_TOKEN" placeholder="ghp_… or github_pat_…" onSaved={onSaved} toast={toast}
                  hint={<>From <code className="font-mono">gh auth token</code>, or create one at github.com/settings/tokens. For an organisation that blocks the GitHub CLI’s sign-in.</>} />
      ) : (
        <p className="text-small text-fg-3">A code to enter on github.com; no token to create. <button onClick={() => setPaste(true)} className="font-medium text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg-1">Use a token instead</button></p>
      )}
    </ServiceCard>
  )
}

/** The fleet's link (its Tailscale, in Docker Compose): signed in with the address its own status gives, no auth key. */
function TailscaleCard({ ts }: { ts?: TailscaleView }) {
  if (!ts) return <Loading text="Asking Tailscale" />
  if (ts.signedIn) return <ServiceCard icon={Network} name="Tailscale" ok detail={[ts.name, ts.tailnet].filter(Boolean).join(' · ') || 'Signed in'} />
  return (
    <ServiceCard icon={Network} name="Tailscale" ok={false} detail={!ts.running ? 'The link isn’t running' : ts.authUrl ? 'Waiting for you to sign in' : 'Starting…'}
                 action={ts.authUrl && <a href={ts.authUrl} target="_blank" rel="noreferrer" className={`${primaryBtn} shrink-0`}>Sign in<ExternalLink className="size-3.5" /></a>}>
      {!ts.running ? (
        <div className="space-y-2">
          <p className="text-small text-fg-2">The fleet’s Tailscale runs in Docker Compose beside Concierge. Start it on this machine:</p>
          <CopyCommand text="docker compose up -d link" />
        </div>
      ) : ts.authUrl ? (
        <p className="text-small text-fg-3">Opens login.tailscale.com. Approve this machine there and it comes back here by itself.</p>
      ) : (
        <p className="flex items-center gap-1.5 text-small text-fg-3"><LoaderCircle className="size-3.5 animate-spin" />Waiting for Tailscale to give a sign-in address…</p>
      )}
    </ServiceCard>
  )
}
