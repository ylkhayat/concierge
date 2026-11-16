import {
  ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Copy, FolderGit2, GitPullRequestArrow, Layers, LayoutGrid, LoaderCircle, Monitor,
  Moon, Plus, RefreshCw, Rocket, Settings2, Sparkles, SquareTerminal, Sun, Wallet, Wand, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SetupView } from '../../server/index.ts'
import { api, type Health, type Theme } from '../lib.ts'
import { Agents, blocked, Exec as ExecSetup, guessSkill, skillsFor, WorkflowCard, type FoundSkill, type ProvidersView } from './Settings.tsx'

type Suggestion = { repo: string; prs: number; paths: string[]; watched: boolean }
type Pick = { on: boolean; path: string; status?: 'ok' | 'checking' | string }

const STEPS: { id: string; title: string; hint: string; icon: LucideIcon }[] = [
  { id: 'tools', title: 'Connect', hint: 'GitHub and your agents', icon: Wrench },
  { id: 'spaces', title: 'Workspaces', hint: 'Review, Ship, or both', icon: LayoutGrid },
  { id: 'repos', title: 'Repositories', hint: 'Which PRs to watch', icon: FolderGit2 },
  { id: 'skills', title: 'Skills', hint: 'What reviews your PRs', icon: Wand },
  { id: 'exec', title: 'Ship', hint: 'How tickets get shipped', icon: Rocket },
  { id: 'prefs', title: 'Preferences', hint: 'How it behaves', icon: Settings2 },
]

const field = 'w-full rounded-xl bg-surface-1 px-3 py-2 text-body outline-none ring-1 ring-line transition-all placeholder:text-fg-3 hover:ring-line-strong focus:ring-2 focus:ring-accent/60'
const primaryBtn = 'inline-flex items-center gap-1.5 btn-primary btn-lg shadow-sm transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40'
const quietBtn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-body font-medium text-fg-3 transition-colors hov hover:text-fg-1'

export function Onboarding({ health, theme, onTheme, onDone, onClose, toast }: {
  health?: Health; theme: Theme; onTheme: (t: Theme) => void; onDone: () => void; onClose?: () => void
  toast: (m: string, tone?: 'ok' | 'error') => void
}) {
  const [step, setStep] = useState(onClose ? 1 : 0) // reopening from Settings starts at the repositories
  const [setup, setSetup] = useState<SetupView>()
  const [rechecking, setRechecking] = useState(false)
  const [suggested, setSuggested] = useState<Suggestion[]>()
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [extra, setExtra] = useState({ repo: '', path: '' })
  const [mode, setMode] = useState<'starter' | 'own'>('starter')
  const [commands, setCommands] = useState({ review: '', revise: '' })
  const [prefs, setPrefs] = useState({ autoStart: true, maxJobs: 2, budget: '', terminal: 'Terminal' as 'Terminal' | 'iTerm' })
  const [saving, setSaving] = useState(false)
  const [spaces, setSpaces] = useState<('review' | 'exec')[]>(['review'])
  const [agents, setAgents] = useState<ProvidersView>()
  // the skills on this machine (yours, plugins', the org's), per kind of work: what onboarding offers and picks from
  const [found, setFound] = useState<Record<'review' | 'revise' | 'exec', FoundSkill[]>>({ review: [], revise: [], exec: [] })
  // the agents' sign-ins, re-read while the first step is open: a sign-in finishes in another tab
  useEffect(() => {
    if (step !== 0) return
    const read = () => api('/providers').then(setAgents, () => {})
    read(); const t = setInterval(read, 4000)
    return () => clearInterval(t)
  }, [step])
  useEffect(() => { void Promise.all((['review', 'revise', 'exec'] as const).map((w) => skillsFor(w))).then(([review, revise, exec]) => setFound({ review, revise, exec })) }, [])
  const guess = { review: guessSkill(found.review, 'review'), revise: guessSkill(found.revise, 'revise'), exec: guessSkill(found.exec, 'exec') }
  // a first setup on a machine that already has a review and a revise skill: those, not the starters. "First" is how
  // the setup was when onboarding opened (saving the repositories on the way marks it configured), and never once you
  // chose yourself; the skills can take a few seconds to read, so this waits for them
  const picked = useRef(false), first = useRef<boolean | undefined>(undefined)
  if (setup && first.current === undefined) first.current = !setup.configured
  useEffect(() => {
    if (picked.current || !first.current || !guess.review || !guess.revise) return
    picked.current = true
    setMode('own'); setCommands({ review: guess.review.command, revise: guess.revise.command })
  }, [setup, guess.review?.command, guess.revise?.command]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => api('/setup').then((s: SetupView) => {
    setSetup(s)
    setSpaces(s.config.workspaces)
    setCommands({ review: s.config.review, revise: s.config.revise })
    setMode(s.config.review.startsWith('/concierge-review') && s.config.revise.startsWith('/concierge-revise') ? 'starter' : 'own')
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
    if (step !== 1 || suggested) return
    api('/setup/repos').then((list: Suggestion[]) => {
      setSuggested(list)
      const watched = setup?.config.repos ?? {}
      setPicks(Object.fromEntries(list.map((s) => {
        const path = Object.entries(watched).find(([r]) => r.toLowerCase() === s.repo.toLowerCase())?.[1] ?? s.paths[0] ?? ''
        return [s.repo, { on: s.watched || (!Object.keys(watched).length && s.paths.length > 0 && s.prs > 0), path, status: path ? 'ok' : undefined }]
      })))
    }, () => setSuggested([]))
  }, [step, suggested, setup])

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
  const reposReady = chosen.length > 0 && chosen.every(([, p]) => p.status === 'ok')

  const addExtra = () => {
    const repo = extra.repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return toast('Use the owner/repo form, e.g. acme/api', 'error')
    setSuggested((s) => [{ repo, prs: 0, paths: [], watched: false }, ...(s ?? []).filter((x) => x.repo.toLowerCase() !== repo.toLowerCase())])
    setPicks((p) => ({ ...p, [repo]: { on: true, path: extra.path } }))
    if (extra.path) check(repo, extra.path)
    setExtra({ repo: '', path: '' })
  }

  const installSkills = () => api('/setup/skills', {}).then(() => { toast('Starter skills installed in ~/.claude/skills'); load() }, (e: Error) => toast(e.message, 'error'))

  const finish = async () => {
    setSaving(true)
    try {
      const starter = mode === 'starter'
      await api('/config', {
        repos: Object.fromEntries(chosen.map(([r, p]) => [r, p.path])),
        workspaces: spaces,
        review: starter ? '/concierge-review {number}' : commands.review,
        revise: starter ? '/concierge-revise {repo}#{number}' : commands.revise,
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
  const toolsReady = !!c?.github.ok && agentReady
  // the steps follow the workspaces you pick: skills are Review's, the exec command is Exec's
  const steps = STEPS.filter((s) => (s.id !== 'skills' || spaces.includes('review')) && (s.id !== 'exec' || spaces.includes('exec')))
  const id = steps[Math.min(step, steps.length - 1)].id
  const canNext = {
    tools: toolsReady, spaces: spaces.length > 0, repos: reposReady, prefs: true,
    skills: mode === 'starter' ? !!setup?.skills.every((s) => s.installed) : !!commands.review.trim() && !!commands.revise.trim(),
    exec: !!setup?.config.exec.command,
  }[id]
  // Exec maps tickets to watched repos, so the repos are saved on the way out of their step
  const next = async () => {
    if (id === 'repos' && spaces.includes('exec')) {
      try { setSetup(await api('/config', { repos: Object.fromEntries(chosen.map(([r, p]) => [r, p.path])) })) }
      catch (e) { return toast((e as Error).message, 'error') }
    }
    setStep(step + 1)
  }
  const saveExec = (body: object, msg: string) => api('/config', body).then((s: SetupView) => { setSetup(s); toast(msg) }, (e: Error) => toast(e.message, 'error'))
  const toggleSpace = (w: 'review' | 'exec') => setSpaces((x) => (x.includes(w) ? x.filter((y) => y !== w) : [...x, w]))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-fill/60 p-4 sm:p-8">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgb(139_92_246/0.12),transparent)]" />
      <div className="relative flex w-full max-w-4xl animate-[toast-in_300ms_var(--ease-snappy)] flex-col overflow-hidden rounded-3xl bg-surface-1 shadow-2xl ring-1 ring-line md:min-h-[600px] md:flex-row ">
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
              const done = i < step, on = i === step
              return (
                <li key={s.id} className="flex-1 md:flex-none">
                  <button onClick={() => (i <= step || onClose) && setStep(i)} disabled={i > step && !onClose}
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
        <section className="flex min-w-0 flex-1 flex-col">
          {onClose && (
            <button onClick={onClose} className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-3 transition-colors hov hover:text-fg-2 " aria-label="Close"><X className="size-4" /></button>
          )}
          <div key={step} className="flex-1 animate-[rise-in_260ms_var(--ease-snappy)] overflow-y-auto p-6 sm:p-8">
            {!setup ? <Loading text="Checking your setup" /> : id === 'tools' ? (
              <Step title="Connect your accounts" lead="Concierge works with your GitHub, private repositories included, and runs the agents you already pay for. Sign in once here; everything stays on this machine.">
                <div className="space-y-2">
                  <ToolRow name="GitHub" required c={c!.github} />
                  {!c!.github.ok && <KeyField name="GITHUB_TOKEN" placeholder="ghp_… or github_pat_…" hint={<>A token with <b>repo</b> access. With the GitHub CLI: <code className="font-mono">gh auth token</code>. Or create one at github.com/settings/tokens.</>} onSaved={load} toast={toast} />}
                  <ToolRow name="crit" c={c!.crit} note="Used by the starter review skills" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-body font-semibold">Agents</h3>
                    <span className={`text-small ${agentReady ? 'text-ok-text' : 'text-fg-3'}`}>{agentReady ? 'Ready to work' : 'Sign in to at least one'}</span>
                  </div>
                  <p className="text-small text-fg-3">Claude (a claude.ai plan or an API key), OpenAI (a ChatGPT plan or an API key) or Llama (local models through Ollama). Add more accounts later and the work is spread across them.</p>
                  <Agents compact toast={toast} onConnections={() => {}} />
                </div>
                <button onClick={() => { setRechecking(true); load().finally(() => setRechecking(false)) }} className={`${quietBtn} -ml-3`}>
                  <RefreshCw className={`size-4 ${rechecking ? 'animate-spin' : ''}`} />Check again
                </button>
              </Step>
            ) : id === 'spaces' ? (
              <Step title="What will you use it for?" lead="Each workspace is its own place in the app, with its own setup. Pick one or both; Settings can change it later.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice on={spaces.includes('review')} onClick={() => toggleSpace('review')} icon={GitPullRequestArrow} title="Review"
                          body="Review the PRs you are asked to, and revise your own from their threads. Prepared by an agent, finished by you in crit." />
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
                {!suggested ? <Loading text="Looking through GitHub and your code folders" /> : (
                  <div className="space-y-2">
                    {suggested.length === 0 && <p className="text-body text-fg-3">No suggestions. Add a repo below.</p>}
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
                                <div role="radiogroup" aria-label={`${s.repo}: checkout`} className="flex flex-wrap gap-1.5">
                                  {s.paths.map((x) => <button key={x} type="button" role="radio" aria-checked={p.path === x} onClick={() => check(s.repo, x)}
                                                              className={`rounded-full px-2.5 py-1 font-mono text-meta transition-colors ${p.path === x ? 'bg-accent-soft font-medium text-accent-text ring-1 ring-accent/40' : 'bg-fill text-fg-2 hover:bg-fill-strong hover:text-fg-1'}`}>{x}</button>)}
                                </div>
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
                    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-strong p-3 sm:flex-row">
                      <input value={extra.repo} onChange={(e) => setExtra({ ...extra, repo: e.target.value })} placeholder="owner/repo" className={`${field} font-mono sm:w-56`} />
                      <input value={extra.path} onChange={(e) => setExtra({ ...extra, path: e.target.value })} placeholder="~/code/repo" className={`${field} font-mono`} onKeyDown={(e) => e.key === 'Enter' && addExtra()} />
                      <button onClick={addExtra} className={`${quietBtn} shrink-0 ring-1 ring-line-strong`}><Plus className="size-4" />Add</button>
                    </div>
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
              <Step title="Choose the skills that do the work" lead="A review request runs a review skill; your own PRs run a revise skill. Both are Claude Code slash commands you can change any time.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice on={mode === 'starter'} onClick={() => { picked.current = true; setMode('starter') }} icon={Sparkles} title="Starter skills" body="concierge-review and concierge-revise, built on crit, and concierge-exec for Linear tickets. Installed into ~/.claude/skills, yours to edit." />
                  <Choice on={mode === 'own'} onClick={() => { picked.current = true; setMode('own') }} icon={SquareTerminal} title="My own commands" body="Point Concierge at slash commands you already use." />
                </div>
                {mode === 'starter' ? (
                  <div className="mt-4 space-y-2">
                    {setup.skills.map((s) => (
                      <div key={s.name} className="flex items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-line ">
                        <Wand className="size-4 text-accent" />
                        <span className="flex-1 font-mono text-body">/{s.name}</span>
                        {s.installed ? <span className="flex items-center gap-1 text-small text-ok-text"><CircleCheck className="size-4" />Installed</span>
                          : <span className="text-small text-fg-3">Not installed</span>}
                      </div>
                    ))}
                    {!setup.skills.every((s) => s.installed) && <button onClick={installSkills} className={`${primaryBtn} mt-2`}><Sparkles className="size-4" />Install starter skills</button>}
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {guess.review && guess.revise && first.current && commands.review === guess.review.command && <p className="flex items-center gap-1.5 text-small text-ok-text"><CircleCheck className="size-4" />Found your own review and revise skills on this machine: picked them for you.</p>}
                    <WorkflowCard work="review" title="Review someone else’s PR" icon={GitPullRequestArrow} trigger="When your review is requested" value={commands.review} suggested={guess.review?.command} onSave={(v) => setCommands((x) => ({ ...x, review: v }))} />
                    <WorkflowCard work="revise" title="Revise your own PR" icon={Wand} trigger="When new feedback lands on your PR" value={commands.revise} suggested={guess.revise?.command} onSave={(v) => setCommands((x) => ({ ...x, revise: v }))} />
                    <p className="text-small text-fg-3">Your skill should print <code className="rounded bg-fill px-1">crit is at http://localhost:&lt;port&gt;</code> and end its turn once ready. The README lists the full contract.</p>
                  </div>
                )}
              </Step>
            ) : (
              <Step title="Set how it behaves" lead="All of these live in Settings too.">
                <div className="divide-y divide-line rounded-2xl ring-1 ring-line ">
                  {spaces.includes('review') && (
                    <Pref icon={Zap} title="Auto-review" hint="Start the review skill as soon as someone requests your review.">
                      <Toggle on={prefs.autoStart} onChange={(v) => setPrefs({ ...prefs, autoStart: v })} />
                    </Pref>
                  )}
                  <Pref icon={Layers} title="Parallel runs" hint="Agent runs at once; more are queued.">
                    <div className="flex items-center gap-1 rounded-xl bg-fill p-1">
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} onClick={() => setPrefs({ ...prefs, maxJobs: n })}
                                className={`size-7 rounded-lg text-body font-semibold tabular-nums transition-all ${prefs.maxJobs === n ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{n}</button>
                      ))}
                    </div>
                  </Pref>
                  <Pref icon={Wallet} title="Daily budget" hint="Stop starting runs once today's spend reaches it. Empty means no cap.">
                    <label className="flex w-28 items-center gap-1 rounded-xl bg-fill/60 px-3 py-1.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-accent/60 ">
                      <span className="text-body text-fg-3">$</span>
                      <input inputMode="decimal" value={prefs.budget} placeholder="no cap" onChange={(e) => setPrefs({ ...prefs, budget: e.target.value })} className="w-full bg-transparent text-body outline-none" />
                    </label>
                  </Pref>
                  <Pref icon={SquareTerminal} title="Terminal for Resume" hint="Where an agent session opens when you take over.">
                    <Segmented value={prefs.terminal} options={[['Terminal', 'Terminal'], ['iTerm', 'iTerm']]} onChange={(v) => setPrefs({ ...prefs, terminal: v as 'Terminal' | 'iTerm' })} />
                  </Pref>
                  <Pref icon={Sun} title="Appearance" hint="Saved in this browser.">
                    <Segmented value={theme} options={[['system', <Monitor key="s" className="size-3.5" />], ['light', <Sun key="l" className="size-3.5" />], ['dark', <Moon key="d" className="size-3.5" />]]} onChange={(v) => onTheme(v as Theme)} />
                  </Pref>
                </div>
                {/* the safety story, said once, where you decide how much runs on its own */}
                <div className="mt-4 rounded-2xl bg-ok/6 p-4 text-small leading-relaxed ring-1 ring-ok/20">
                  <p className="font-semibold text-ok-text">What the agents never do on their own</p>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-fg-2 ">
                    <li>Post a review, approve, reply or push on a PR: those wait for your click.</li>
                    <li>Merge anything, or touch your main checkout: they work in throwaway worktrees.</li>
                    <li>Run a command outside the allowlist in Settings. Anything denied shows up in the run.</li>
                    <li>Spend past your daily budget: new runs wait for tomorrow or a higher cap.</li>
                  </ul>
                  <p className="mt-1.5 text-fg-3">Ship is the exception you opt into: it opens PRs and comments on its tickets, as the skill you choose says.</p>
                </div>
              </Step>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-line px-6 py-4 sm:px-8 ">
            {step > 0 && <button onClick={() => setStep(step - 1)} className={quietBtn}><ArrowLeft className="size-4" />Back</button>}
            <span className="flex-1" />
            {id === 'repos' && chosen.length > 0 && !reposReady && <span className="text-small text-fg-3">Each picked repo needs a valid checkout</span>}
            {id === 'exec' && !canNext && <span className="text-small text-fg-3">Save an exec command to continue</span>}
            {step < steps.length - 1
              ? <button onClick={next} disabled={!canNext} className={primaryBtn}>Continue<ArrowRight className="size-4" /></button>
              : <button onClick={finish} disabled={saving || !reposReady} className={primaryBtn}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{onClose ? 'Save' : spaces.includes('review') ? 'Start reviewing' : 'Start shipping'}</button>}
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

function ToolRow({ name, c, required, note }: { name: string; c: { ok: boolean; detail: string; fix?: string }; required?: boolean; note?: string }) {
  const [copied, setCopied] = useState(false)
  const Icon = c.ok ? CircleCheck : CircleAlert
  return (
    <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3 ring-1 ring-line ">
      <Icon className={`size-5 shrink-0 ${c.ok ? 'text-ok' : required ? 'text-fail' : 'text-wait'}`} />
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium">{name} {required && !c.ok && <span className="text-meta font-normal text-fail">required</span>}</div>
        <div className="truncate text-small text-fg-3">{c.detail}{note && c.ok ? ` · ${note}` : ''}</div>
      </div>
      {!c.ok && c.fix && (
        <button onClick={() => navigator.clipboard.writeText(c.fix!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
                className="group flex shrink-0 items-center gap-1.5 rounded-lg bg-fill px-2.5 py-1.5 font-mono text-meta text-fg-2 transition-colors hover:bg-active" title="Copy">
          {c.fix}{copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3 opacity-50 group-hover:opacity-100" />}
        </button>
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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-accent' : 'bg-fill-strong'}`}>
      <span className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-all duration-300 ease-[var(--ease-snappy)] ${on ? 'left-5' : 'left-1'}`} />
    </button>
  )
}

function Segmented({ value, options, onChange }: { value: string; options: [string, ReactNode][]; onChange: (v: string) => void }) {
  return (
    <div className="flex shrink-0 rounded-xl bg-fill p-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-small font-medium transition-all ${value === v ? 'sel text-fg-1 ' : 'text-fg-3 hover:text-fg-1'}`}>{label}</button>
      ))}
    </div>
  )
}

/** A key pasted into the page: checked by the server against GitHub or Linear, then kept for every machine. */
function KeyField({ name, placeholder, hint, onSaved, toast }: { name: string; placeholder: string; hint: ReactNode; onSaved: () => void; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const save = () => { setBusy(true); api('/shared-keys', { name, value: v.trim() }).then(() => { toast('Connected'); setV(''); onSaved() }, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false)) }
  return (
    <div className="space-y-1.5 card p-3">
      <div className="flex gap-2">
        <input type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && save()} placeholder={placeholder} aria-label={name} className={`${field} font-mono`} />
        <button onClick={save} disabled={!v.trim() || busy} className={`${primaryBtn} shrink-0`}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : 'Connect'}</button>
      </div>
      <p className="text-small text-fg-3">{hint}</p>
    </div>
  )
}
