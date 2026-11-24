import {
  ArrowLeft, ArrowRight, ChevronRight, BookOpen, Bot, Check, Info, Network, Palette, Search, Workflow, GripVertical, CircleAlert, ExternalLink, GitPullRequestArrow, CircleCheck, Coins, FolderGit2, Keyboard, Layers, LoaderCircle, Map as MapIcon, Minus, Monitor, Moon, Plus, RotateCcw,
  CheckCheck, Download, RefreshCw, ShieldCheck, Gauge, Maximize, PlugZap, Rocket, Server, Settings2, ShieldAlert, Sparkles, SquareTerminal, Sun, Trash2, UsersRound, Wallet, Wand, X, Zap, type LucideIcon
} from 'lucide-react'
import { ReviewIn } from './ReviewIn.tsx'
import { useMachineName } from '../machineNames.ts'
import { Tabs } from './Tabs.tsx'
import { label, sha, VERSION } from '../version.ts'
import { Field, Pick, PickPill } from '../ui/Pick.tsx'
import { Fragment, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { SetupView } from '../../server/index.ts'
import { CERTIFICATIONS, DATA, REGIONS, REVIEWS, ROLES as TEAM_ROLES, type Compliance, type Member } from '../../server/readiness.ts'
import type { ComplianceSuggestion } from '../../server/complianceScan.ts'
type Org = import('../../server/orgs.ts').Org
import type { InfraView } from '../../server/infra.ts'
import { api, PALETTES, paletteNow, setPalette, setTexture, TEXTURES, textureNow, type Health, type Theme } from '../lib.ts'
import { refresh, remember, useApi, useLive } from '../query.ts'
import { ROLES, setRole, useRole, type Role, type RolesView } from '../role.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { ago, clock, weekday } from '../time.ts'
import { ClaudeAccount, Connections, Skeleton } from './Connections.tsx'
import { MachinesSettings } from './MachinesSettings.tsx'
import { FallbackToken } from './FallbackToken.tsx'
import type { Mode, OrgSkill } from '../../server/orgSkills.ts'

export type SettingsTab = 'overview' | 'roles' | 'workflows' | 'accounts' | 'spend' | 'compliance' | 'repos' | 'connections' | 'machines' | 'appearance' | 'about'
  // older names, still used by links around the app
  | 'general' | 'skills' | 'exec' | 'agents' | 'usage' | 'company'
const ALIAS: Partial<Record<SettingsTab, SettingsTab>> = { general: 'workflows', skills: 'workflows', exec: 'workflows', agents: 'accounts', usage: 'spend', company: 'compliance' }
type Page = { id: SettingsTab; label: string; hint: string; icon: LucideIcon }
const NAV: { group: string; pages: Page[] }[] = [
  { group: 'Start', pages: [{ id: 'overview', label: 'How it works', hint: 'What runs when, with which skill, on which account', icon: Workflow }] },
  { group: 'Work', pages: [
    { id: 'roles', label: 'Roles', hint: 'The roles you work as, and what each one runs', icon: UsersRound },
    { id: 'workflows', label: 'Workflows', hint: 'Triggers, skills and commands for reviews, your PRs and tickets', icon: Wand },
    { id: 'accounts', label: 'Accounts', hint: 'Claude, OpenAI or Llama, and which one takes what', icon: Bot },
    { id: 'spend', label: 'Spend', hint: 'Budgets, limits and what the runs cost', icon: Coins },
    { id: 'compliance', label: 'Compliance', hint: 'What each workspace’s plans are checked against (or not): where its users are, certifications, data, required reviews, and the people who build it', icon: ShieldCheck },
  ] },
  { group: 'Sources', pages: [
    { id: 'repos', label: 'Workspaces', hint: 'The organizations Concierge works with and the repositories it watches in each, where they live, their codebase maps', icon: FolderGit2 },
    { id: 'connections', label: 'Connections', hint: 'Databases and services the agents can reach', icon: PlugZap },
    { id: 'machines', label: 'Machines', hint: 'Where Concierge runs, your tailnet, sync and updates', icon: Network },
  ] },
  { group: 'You', pages: [
    { id: 'appearance', label: 'Appearance', hint: 'Theme, size, links and the terminal', icon: Palette },
    { id: 'about', label: 'About', hint: 'Setup, the settings file and shortcuts', icon: BookOpen },
  ] },
]
const PAGES = NAV.flatMap((g) => g.pages)
// every setting by name, for the search box: what you'd type, and the page it lives on
const INDEX: [string, SettingsTab][] = [
  ['Compliance: GDPR, SOC 2, HIPAA, PCI, regions, data, reviews', 'compliance'], ['Compliance and security checks for plans', 'compliance'], ['Capacity: the people who build it, roles and pace', 'compliance'],
  ['Roles: developer, product, design', 'roles'], ['Join a role', 'roles'], ['Execute command per role', 'roles'],
  ['Skill source', 'workflows'], ['Which skill each feature uses: explain, brief, standup, plans', 'workflows'],
  ['Auto-review', 'workflows'], ['Parallel runs', 'workflows'], ['Views: Review and Ship', 'workflows'],
  ['Review skill or command', 'workflows'], ['Revise skill or command', 'workflows'], ['Stack command', 'workflows'], ['Starter skills', 'workflows'],
  ['Org skills', 'workflows'], ['Skills this setup runs', 'workflows'], ['Ship command', 'workflows'], ['Linear teams', 'workflows'],
  ['Repository by ticket prefix', 'workflows'], ['Allowed tools for Ship', 'workflows'], ['Auto-release', 'workflows'], ['LINEAR_API_KEY', 'workflows'],
  ['Accounts and sign-in', 'accounts'], ['Fallback order', 'accounts'], ['Who runs what', 'accounts'], ['Llama models', 'accounts'],
  ['Daily budget', 'spend'], ['Budget per explanation', 'spend'], ['Runs and their cost', 'spend'],
  ['Workspaces: organizations and their repositories', 'repos'], ['Watched repositories', 'repos'], ['Codebase map', 'repos'], ['Databases (MongoDB)', 'connections'], ['Sentry', 'connections'],
  ['This machine', 'machines'], ['Tailnet devices (Tailscale)', 'machines'], ['Sync between machines', 'machines'], ['Update now', 'machines'],
  ['Theme', 'appearance'], ['Interface size', 'appearance'], ['Open Linear links in the app', 'appearance'], ['Terminal for Resume', 'appearance'],
  ['Run setup again', 'about'], ['Settings file', 'about'], ['Keyboard shortcuts', 'about'],
]
const THEMES: { id: Theme; label: string; icon: LucideIcon }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]
type Toast = (m: string, tone?: 'ok' | 'error') => void
type Plan = { branch: string; folders: number; known: number; toMap: number; estimateUsd: number; complete: boolean; mapped: boolean }
type BaseInfo = { repo: string; meta?: { branch: string; sha: string; mappedAt: string; folders: number; costUsd: number; complete?: boolean } }

// --- primitives ------------------------------------------------------------------------------

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <header className="px-0.5">
        <h3 className="text-small font-semibold text-fg-1 ">{title}</h3>
        {hint && <p className="text-meta text-fg-3">{hint}</p>}
      </header>
      <div className="divide-y divide-line overflow-hidden card ">{children}</div>
    </section>
  )
}

/** An (i) beside a setting: what it is and what it changes, in a few lines, on hover or click. */
export function More({ children }: { children: ReactNode }) {
  const id = 'more' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <>
      <button popoverTarget={id} style={{ anchorName: `--${id}` } as CSSProperties} aria-label="What is this?" className="inline-flex align-[-2px] text-fg-4 transition-colors hover:text-accent-text"><Info className="size-3.5" /></button>
      <div id={id} popover="auto" style={{ positionAnchor: `--${id}`, positionArea: 'bottom span-right', positionTryFallbacks: 'flip-block, flip-inline', inset: 'auto' } as CSSProperties}
           className="m-0 mt-1.5 w-72 rounded-xl border-0 bg-surface-2 p-3 text-small leading-relaxed text-fg-2 shadow-e3">{children}</div>
    </>
  )
}

function Row({ icon: Icon, title, hint, more, children }: { icon: LucideIcon; title: string; hint?: ReactNode; more?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-fill text-fg-3"><Icon className="size-3.5" aria-hidden /></span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-center gap-1.5 text-small font-medium">{title}{more && <More>{more}</More>}</div>
        {hint && <div className="text-meta leading-snug text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
            className={`relative h-[22px] w-9 shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-accent' : 'bg-fill-strong'}`}>
      <span className={`absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-all duration-300 ease-[var(--ease-snappy)] ${on ? 'left-[17px]' : 'left-[3px]'}`} />
    </button>
  )
}

function Segmented<T extends string>({ value, options, onChange, label = 'Choose' }: { value: T; options: { id: T; label: string; icon?: LucideIcon }[]; onChange: (v: T) => void; label?: string }) {
  return <Tabs value={value} options={options} onChange={onChange} label={label} />
}

const input = 'field'
const primary = 'inline-flex shrink-0 items-center gap-1.5 btn-primary'
const quiet = 'inline-flex shrink-0 items-center gap-1.5 btn-outline'
const hours = (iso: string) => ago(iso)
const home = (p: string) => p.replace(/^\/Users\/(?!Shared\/)[^/]+/, '~')

// --- the dialog --------------------------------------------------------------------------------

/** Settings as a modal with tabs: a native <dialog>, so it sits above everything and Esc / backdrop close it. */
/**
 * Settings, as a page of its own: grouped navigation, a search over every setting, and "How it works" first, so what
 * runs when (and with which skill and account) is the first thing you read. Esc or Back returns to where you were.
 */
export function SettingsDialog({ open, tab: initial = 'overview', onTab, onClose, health, theme, onTheme, toast, onSetup }: {
  open: boolean; tab?: SettingsTab; onTab?: (t: SettingsTab) => void; onClose: () => void; health?: Health; theme: Theme; onTheme: (t: Theme) => void; toast: Toast; onSetup: () => void
}) {
  const [tab, setTabState] = useState<SettingsTab>(ALIAS[initial] ?? initial)
  const [setup, setSetup] = useState<SetupView>()
  const [q, setQ] = useState('')
  useEffect(() => { if (open) { setTabState(ALIAS[initial] ?? initial); api('/setup').then(setSetup).catch(() => {}) } }, [open, initial])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector(':popover-open, dialog[open]')) { e.preventDefault(); onClose() } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  const go = (t: SettingsTab) => { setTabState(t); onTab?.(t); setQ('') }
  const save: Save = (path, body, msg) => api(path, body).then((r) => { toast(msg); return r }, (e: Error) => { toast(e.message, 'error'); throw e })
  const saveConfig: SaveConfig = (body, msg) => save('/config', body, msg).then((s) => setSetup(s as SetupView)).catch(() => {})
  const uses = (w: 'review' | 'exec') => !setup || setup.config.workspaces.includes(w)
  const current = PAGES.find((t) => t.id === tab) ?? PAGES[0]
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = words.length ? INDEX.filter(([label]) => words.every((w) => label.toLowerCase().includes(w))).slice(0, 8) : []

  return (
    <div role="dialog" aria-label="Settings" className="grain fixed inset-0 z-50 flex animate-[fade-in_160ms] flex-col text-fg-1">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
        <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-small font-medium text-fg-3 transition-colors hov hover:text-fg-1"><ArrowLeft className="size-4" />Back</button>
        <h1 className="flex items-center gap-2 text-title font-semibold"><Settings2 className="size-4 text-fg-4" />Settings</h1>
        <div className="relative ml-auto w-[min(360px,50vw)]">
          <label className="flex items-center gap-2 card px-3 py-1.5">
            <Search className="size-4 text-fg-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting…" aria-label="Find a setting"
                   onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0][1]); if (e.key === 'Escape') { e.stopPropagation(); setQ('') } }}
                   className="w-full bg-transparent text-body outline-none placeholder:text-fg-4" />
          </label>
          {words.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1.5 overflow-hidden rounded-xl bg-surface-2 p-1 shadow-e3">
              {hits.map(([label, t]) => (
                <li key={label}><button onClick={() => go(t)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-body hov">
                  <span className="min-w-0 flex-1 truncate">{label}</span><span className="text-meta text-fg-4">{PAGES.find((x) => x.id === t)?.label}</span>
                </button></li>
              ))}
              {!hits.length && <li className="px-2.5 py-2 text-small text-fg-3">No setting by that name.</li>}
            </ul>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 md:w-60 md:flex-col md:gap-4 md:overflow-y-auto md:border-b-0 md:border-r md:px-3 md:py-5">
          {NAV.map((g) => (
            <div key={g.group} className="flex gap-1 md:flex-col md:gap-0.5">
              <p className="hidden px-2.5 pb-1 text-meta font-medium text-fg-4 md:block">{g.group}</p>
              {g.pages.filter((t) => t.id !== 'workflows' || uses('review') || uses('exec')).map((t) => (
                <button key={t.id} onClick={() => go(t.id)} aria-current={tab === t.id} title={t.hint}
                        className={`flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-body transition-colors ${tab === t.id ? 'sel font-medium' : 'text-fg-2 hov hover:text-fg-1'}`}>
                  <t.icon className={`size-4 shrink-0 ${tab === t.id ? 'text-accent-text' : 'text-fg-4'}`} />{t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div key={tab} className="mx-auto max-w-[880px] animate-[rise-in_220ms_var(--ease-snappy)] space-y-6 px-4 pb-16 pt-6 md:px-8">
            <header>
              <h2 className="text-display font-semibold">{current.label}</h2>
              <p className="mt-1 text-body text-fg-3">{current.hint}</p>
            </header>
            {tab === 'overview' && <HowItWorks setup={setup} health={health} go={go} />}
            {tab === 'workflows' && <>
              <WorkflowCards setup={setup} health={health} save={save} saveConfig={saveConfig} go={go} />
              <Workflows health={health} setup={setup} save={save} saveConfig={saveConfig} />
              {uses('review') && setup && <ReviewIn setup={setup} onSaved={setSetup} />}
              {uses('review') && <Skills setup={setup} toast={toast} saveConfig={saveConfig} reload={() => api('/setup').then(setSetup)} />}
              {uses('exec') && <Exec setup={setup} saveConfig={saveConfig} />}
            </>}
            {tab === 'roles' && <RolesSettings />}
            {tab === 'accounts' && <Agents toast={toast} onConnections={() => go('connections')} />}
            {tab === 'compliance' && <ComplianceSettings setup={setup} saveConfig={saveConfig} />}
            {tab === 'spend' && <Usage health={health} setup={setup} save={save} saveConfig={saveConfig} />}
            {tab === 'repos' && <Repositories setup={setup} health={health} toast={toast} saveConfig={saveConfig} reload={() => api('/setup').then(setSetup)} />}
            {tab === 'connections' && <Connections toast={toast} />}
            {tab === 'machines' && <><Access toast={toast} /><MachinesSettings /><Update />
              <details className="group/adv rounded-xl ring-1 ring-line [&[open]]:pb-3">
                <summary className="cursor-pointer px-3.5 py-2.5 text-small font-medium text-fg-3 hover:text-fg-1">Advanced: control plane, sync, tailnet, machine key</summary>
                <div className="space-y-5 px-3.5 pt-1"><JoinRequests /><Machines /><MachineKey /><Tailnet /></div>
              </details></>}
            {tab === 'appearance' && <Appearance setup={setup} theme={theme} onTheme={onTheme} saveConfig={saveConfig} />}
            {tab === 'about' && <About setup={setup} onSetup={() => { onClose(); onSetup() }} />}
          </div>
        </main>
      </div>
    </div>
  )
}

type Save = (path: string, body: object, msg: string) => Promise<unknown>
export type SaveConfig = (body: object, msg: string) => Promise<void>

// --- General -------------------------------------------------------------------------------------

const SCALES = [{ id: 'auto', label: 'Auto' }, { id: '1', label: '100%' }, { id: '1.15', label: '115%' }, { id: '1.3', label: '130%' }, { id: '1.5', label: '150%' }]

function Workflows({ health, setup, save, saveConfig }: { health?: Health; setup?: SetupView; save: Save; saveConfig: SaveConfig }) {
  const maxJobs = health?.settings?.maxJobs ?? 2
  const step = 'flex size-7 items-center justify-center rounded-lg text-fg-3 transition-all hover:bg-surface-1 hover:text-fg-1 hover:shadow-sm active:scale-90 disabled:pointer-events-none disabled:opacity-30'
  return (
    <>
      {setup && (
        <Group title="Views" hint="Which halves of Concierge you use. Each has its own place in the rail and its own setup.">
          {(['review', 'exec'] as const).map((w) => {
            const on = setup.config.workspaces.includes(w)
            return (
              <Row key={w} icon={w === 'review' ? GitPullRequestArrow : Rocket} title={w === 'review' ? 'Review' : 'Ship'}
                   hint={w === 'review' ? 'Review PRs you are asked to, and revise your own from their threads.' : 'Ship your Linear tickets with your exec command.'}>
                <Toggle label={w} on={on} onChange={(v) => {
                  const next = v ? [...setup.config.workspaces, w] : setup.config.workspaces.filter((x) => x !== w)
                  if (next.length) saveConfig({ workspaces: next }, `${w === 'review' ? 'Review' : 'Ship'} ${v ? 'on' : 'off'}`)
                }} />
              </Row>
            )
          })}
        </Group>
      )}
      <Group title="Reviews" hint="How review requests are picked up.">
        <Row icon={Zap} title="Auto-review" hint="Start the review skill as soon as someone requests your review."
             more="Off: a review request waits in the list until you press Run review. On: the review skill starts by itself, within the parallel limit and the daily budget, and the findings wait for you (on the PR page, or in crit if you review there). Nothing is posted to GitHub until you choose.">
          <Toggle label="Auto-review" on={!!health?.autoStart} onChange={(on) => save('/auto-start', { on }, on ? 'Auto-review on' : 'Auto-review off').catch(() => {})} />
        </Row>
        <Row icon={Layers} title="Parallel runs" hint="Agent runs at once; the rest wait in a queue."
             more="Counts every agent run: reviews, your PRs, tickets and explanations. A run past the limit waits its turn; a stack runs bottom first.">
          <div className="inline-flex items-center gap-1 rounded-xl bg-fill p-1">
            <button className={step} disabled={maxJobs <= 1} onClick={() => save('/settings', { maxJobs: maxJobs - 1 }, `Up to ${maxJobs - 1} at once`).catch(() => {})} aria-label="Fewer"><Minus className="size-3.5" /></button>
            <span className="w-7 text-center text-reading font-semibold tabular-nums">{maxJobs}</span>
            <button className={step} disabled={maxJobs >= 8} onClick={() => save('/settings', { maxJobs: maxJobs + 1 }, `Up to ${maxJobs + 1} at once`).catch(() => {})} aria-label="More"><Plus className="size-3.5" /></button>
          </div>
        </Row>
      </Group>
    </>
  )
}

/** The palettes as cards: each shows its page, a card on it and its text, in the theme you are in now. */
function Palettes({ dark }: { dark: boolean }) {
  const [now, setNow] = useState(paletteNow)
  return (
    <div role="radiogroup" aria-label="Palette" className="grid grid-cols-3 gap-2 px-3 pb-3">
      {PALETTES.map((p) => {
        const { h, c, d, l } = p.swatch, on = now === p.id
        const page = dark ? `oklch(${d} ${c} ${h})` : `oklch(${l} ${c * 0.8} ${h})`, card = dark ? `oklch(${d + 0.05} ${c} ${h})` : `oklch(0.995 ${c * 0.4} ${h})`
        const ink = dark ? `oklch(0.88 ${c} ${h})` : `oklch(0.3 ${c * 2} ${h})`
        return (
          <button key={p.id || 'default'} role="radio" aria-checked={on} onClick={() => { setPalette(p.id); setNow(p.id) }} title={p.hint}
                  className={`overflow-hidden rounded-card text-left ring-1 transition-shadow ${on ? 'ring-2 ring-accent' : 'ring-line hover:ring-line-strong'}`}>
            <span className="block p-2" style={{ background: page }}>
              <span className="block rounded-md p-1.5" style={{ background: card }}>
                <span className="block h-1.5 w-3/4 rounded-full" style={{ background: ink, opacity: 0.8 }} />
                <span className="mt-1 block h-1.5 w-1/2 rounded-full" style={{ background: ink, opacity: 0.35 }} />
              </span>
            </span>
            <span className="block bg-surface-1 px-2 py-1.5">
              <span className="flex items-center gap-1 text-small font-medium text-fg-1">{on && <Check className="size-3 text-accent-text" />}{p.label}</span>
              <span className="line-clamp-2 text-micro text-fg-3">{p.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Textures() {
  const [now, setNow] = useState(textureNow)
  return (
    <div role="radiogroup" aria-label="Texture" className="grid grid-cols-3 gap-2 px-3 pb-3">
      {TEXTURES.map((t) => {
        const on = now === t.id
        return (
          <button key={t.id || 'none'} role="radio" aria-checked={on} onClick={() => { setTexture(t.id); setNow(t.id) }} title={t.hint}
                  className={`overflow-hidden rounded-card text-left ring-1 transition-shadow ${on ? 'ring-2 ring-accent' : 'ring-line hover:ring-line-strong'}`}>
            <span data-t={t.id} className="tex-tile block h-12 bg-bg-app" />
            <span className="block bg-surface-1 px-2 py-1.5">
              <span className="flex items-center gap-1 text-small font-medium text-fg-1">{on && <Check className="size-3 text-accent-text" />}{t.label}</span>
              <span className="line-clamp-1 text-micro text-fg-3">{t.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Appearance({ setup, theme, onTheme, saveConfig }: { setup?: SetupView; theme: Theme; onTheme: (t: Theme) => void; saveConfig: SaveConfig }) {
  const [scale, setScale] = useState(() => { try { return localStorage.getItem('ui-scale') ?? 'auto' } catch { return 'auto' } })
  return (
    <>
      <Group title="Look" hint="Saved in this browser.">
        <Row icon={Sun} title="Theme">
          <Segmented value={theme} options={THEMES} onChange={onTheme} />
        </Row>
        <Row icon={Palette} title="Palette" hint="The tint and depth of every surface, in light and in dark. Each view keeps its accent." />
        <Palettes dark={theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'))} />
        <Row icon={Sparkles} title="Texture" hint="A faint grain over everything, fine or coarser. With any palette." />
        <Textures />
        <Row icon={Maximize} title="Interface size" hint="Auto grows it on very wide screens; or pick a size.">
          <Segmented value={scale} options={SCALES} onChange={(v) => {
            setScale(v)
            try { localStorage.setItem('ui-scale', v) } catch { /* private window */ }
            dispatchEvent(new Event('resize')) // main.tsx applies it
          }} />
        </Row>
      </Group>
      <Group title="Opening things">
        <Row icon={ExternalLink} title="Open Linear links in the app" hint="Every Linear link here opens in the Linear desktop app instead of the browser.">
          {setup && <Toggle label="Open Linear links in the app" on={setup.config.linearDesktop} onChange={(on) => saveConfig({ linearDesktop: on }, on ? 'Linear links open in the app' : 'Linear links open in the browser')} />}
        </Row>
        <Row icon={SquareTerminal} title="Terminal for Resume" hint="Where an agent session opens when you take over."
             more="Resume opens the agent's own Claude Code session in this terminal, so you continue exactly where it stopped, with its context.">
          {setup && <Segmented value={setup.config.terminal} options={[{ id: 'Terminal', label: 'Terminal' }, { id: 'iTerm', label: 'iTerm' }]}
                               onChange={(t) => saveConfig({ terminal: t }, `Resume opens ${t}`)} />}
        </Row>
      </Group>
    </>
  )
}

// --- Repositories// --- Repositories: what to watch, and each repo's codebase map -----------------------------------

type Suggestion = { repo: string; prs: number; paths: string[]; watched: boolean }

function Repositories({ setup, health, toast, saveConfig, reload }: { setup?: SetupView; health?: Health; toast: Toast; saveConfig: SaveConfig; reload: () => Promise<unknown> }) {
  const called = useMachineName()
  // a repository being cloned onto this machine: looked at again until it is there
  const cloning = Object.values(setup?.clones ?? {}).includes('cloning')
  useEffect(() => { if (!cloning) return; const t = setInterval(() => void reload().catch(() => {}), 4000); return () => clearInterval(t) }, [cloning])
  const repos = setup?.config.repos ?? {}
  // which account each repository is kept to (none: the order in Accounts)
  const pins = setup?.config.repoAccounts ?? {}
  const [accts, setAccts] = useState<{ id: string; label: string }[]>([])
  useEffect(() => { api('/usage/accounts').then((a: { id: string; label: string }[]) => setAccts(a.map(({ id, label }) => ({ id, label })))).catch(() => {}) }, [])
  const [bases, setBases] = useState<BaseInfo[]>([])
  const [suggested, setSuggested] = useState<Suggestion[]>()
  const [add, setAdd] = useState({ repo: '', path: '', status: '' })
  const anyMapping = Object.values(health?.base ?? {}).some((t) => t.state === 'running' || t.state === 'queued')
  useEffect(() => { api('/base').then(setBases).catch(() => {}) }, [anyMapping, Object.keys(repos).length])
  useEffect(() => { api('/setup/repos').then(setSuggested).catch(() => setSuggested([])) }, [])

  const remove = (repo: string) => {
    const next = { ...repos }; delete next[repo]
    saveConfig({ repos: next }, `Stopped watching ${repo}`)
  }
  const addRepo = async (repo: string, path: string) => {
    // its GitHub link as you copied it (https, ssh, or owner/repo): the folder is its name in the working directory
    repo = repo.trim().replace(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/, '').replace(/(?:\.git)?\/?(?:[?#].*)?$/, '').split('/').slice(0, 2).join('/')
    path = path.trim() || repo.split('/')[1] || ''
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return setAdd((a) => ({ ...a, status: 'Paste the repository\'s GitHub link, e.g. https://github.com/acme/api' }))
    setAdd((a) => ({ ...a, status: 'checking' }))
    const v = await api('/setup/validate', { repo, path }).catch(() => ({ ok: false, error: 'Could not check' }))
    if (!v.ok) return setAdd((a) => ({ ...a, status: v.error }))
    await saveConfig({ repos: { ...repos, [repo]: path } }, v.clone ? `Watching ${repo}: each machine clones it into its working directory` : `Watching ${repo}`)
    refresh('/orgs'); refresh('/workspaces/offers') // its organization is a workspace now, if it wasn't
    setAdd({ repo: '', path: '', status: '' })
  }
  const offers = (suggested ?? []).filter((s) => !Object.keys(repos).some((r) => r.toLowerCase() === s.repo.toLowerCase()) && s.paths.length)
  const orgsQ = useApi<Org[]>('/orgs', { staleTime: 60_000 })

  // the workspaces: the organizations Concierge works with, each with the repositories watched in it
  const owners = orgsQ.data?.map((o) => o.owner) ?? [...new Set(Object.keys(repos).map((r) => r.split('/')[0]))]
  const changed = () => { refresh('/orgs'); refresh('/workspaces/offers'); return reload() }
  return (
    <>
      <p className="px-0.5 text-small text-fg-3">Your workspaces are the organizations Concierge works with, and in each the repositories it watches: reviews, your PRs, plans, compliance and Ship act on these, never on every organization your GitHub account belongs to. Each machine keeps the repositories in its own working directory ({setup?.workDir ? home(setup.workDir) : 'its CODE_DIR'} here), and clones only the ones you allow on it.</p>
      {owners.map((owner) => { const o = orgsQ.data?.find((x) => x.owner === owner), mine = Object.entries(repos).filter(([r]) => r.split('/')[0] === owner), org = setup?.cloneOn?.[`${owner}/*`] ?? []; return (
        <section key={owner} className="space-y-2">
          <WorkspaceHead owner={owner} personal={!!o?.personal} count={mine.length} onRemoved={changed} toast={toast}>
            {(setup?.machines?.length ?? 0) > 1 && (
              <Pick multi label={`Machines that may clone ${owner}'s repositories`} value={org} className="ml-auto"
                    options={setup!.machines.map((m) => ({ value: m, label: m === setup?.machine ? <>{called(m)} <span className="font-normal opacity-60">this one</span></> : called(m) }))}
                    onChange={(_, m, on) => api('/repos/clone-on', { repo: `${owner}/*`, machine: m, on }).then(() => { toast(on ? `${owner}'s repositories may be cloned on ${m}` : `${owner} is no longer allowed on ${m} as a whole`); return reload() }, (e: Error) => toast(e.message, 'error'))} />
            )}
          </WorkspaceHead>
          <div className="divide-y divide-line overflow-hidden card">
            {mine.length === 0 && <p className="px-4 py-3 text-small text-fg-3">No repositories watched in {owner} yet: add them from its list below.</p>}
            {mine.map(([repo, path]) => (
              <Fragment key={repo}>
          <RepoCard key={repo} repo={repo} path={path} meta={bases.find((b) => b.repo === repo)?.meta} task={health?.base?.[repo]} toast={toast} onRemove={() => remove(repo)} clone={setup?.clones?.[repo]}
                        machines={setup?.machines ?? []} machine={setup?.machine} allowed={setup?.cloneOn?.[repo] ?? []} byOrg={org} removed={setup?.removeFrom?.[repo] ?? []} here={Object.entries(setup?.checkedOut ?? {}).filter(([, rs]) => rs.includes(repo)).map(([m]) => m)}
                        route={setup?.placement?.find((r) => r.repo === repo)}
                        onAllow={(m, on) => api('/repos/clone-on', { repo, machine: m, on }).then(() => { toast(on ? `${repo} may be cloned on ${m}` : `${repo} stays off ${m}`); return reload() }, (e: Error) => toast(e.message, 'error'))}
                        accounts={accts} pin={pins[repo]} onPin={(a) => { const next = { ...pins }; if (a) next[repo] = a; else delete next[repo]; void saveConfig({ repoAccounts: next }, a ? `${repo} runs only on ${accts.find((x) => x.id === a)?.label ?? a}` : `${repo} follows the account order`) }} />
              </Fragment>
            ))}
            <OwnerRepos owner={owner} watched={Object.keys(repos)} onAdd={(r) => addRepo(r, '')} />
          </div>
        </section>
      ) })}

      <Group title="Add a workspace" hint="An organization Concierge should work with (or you): then pick which of its repositories it watches. Your GitHub account's organizations are offered; any other one by its name.">
        <AddWorkspace onAdded={changed} toast={toast} />
        <div className="space-y-2 px-4 py-3.5">
          <p className="text-meta text-fg-3">Or a single repository by its GitHub link: its organization becomes a workspace with it.{offers.length > 0 && ' From your recent PRs:'}</p>
          {offers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {offers.slice(0, 6).map((s) => (
                <button key={s.repo} onClick={() => addRepo(s.repo, s.paths[0])} title={home(s.paths[0])}
                        className="group inline-flex items-center gap-1.5 rounded-full bg-fill/60 px-3 py-1 font-mono text-small ring-1 ring-line transition-all hover:bg-white hover:ring-accent">
                  <Plus className="size-3 text-fg-3 group-hover:text-accent" />{s.repo}
                  {s.prs > 0 && <span className="font-sans text-micro text-fg-3">{s.prs} PRs</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={add.repo} onChange={(e) => setAdd({ ...add, repo: e.target.value, status: '' })} placeholder="https://github.com/owner/repo" className={`${input} flex-1 font-mono`}
                   onKeyDown={(e) => e.key === 'Enter' && addRepo(add.repo, '')} />
            <button onClick={() => addRepo(add.repo, '')} disabled={!add.repo || add.status === 'checking'} className={primary}>
              {add.status === 'checking' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Add
            </button>
          </div>
          {add.status && add.status !== 'checking' && <p className="flex items-center gap-1.5 text-small text-fail-text"><CircleAlert className="size-3.5" />{add.status}</p>}
        </div>
      </Group>
    </>
  )
}

/** A workspace's heading: its name, how many repositories it watches, who may clone them, and taking it away. */
function WorkspaceHead({ owner, personal, count, onRemoved, toast, children }: { owner: string; personal: boolean; count: number; onRemoved: () => unknown; toast: Toast; children?: ReactNode }) {
  const { armed, arm } = useArm()
  const remove = () => api('/workspaces', { owner, on: false }).then(() => { toast(count ? `${owner} is no longer a workspace: its ${count} repositor${count === 1 ? 'y is' : 'ies are'} no longer watched` : `${owner} is no longer a workspace`); return onRemoved() }, (e: Error) => toast(e.message, 'error'))
  return (
    <header className="flex flex-wrap items-center gap-2 px-0.5">
      <h3 className="font-mono text-small font-semibold text-fg-1">{owner}</h3>
      {personal && <span className="rounded-full bg-fill px-1.5 py-px text-micro font-medium text-fg-3">you</span>}
      <span className="text-meta text-fg-3">{count} repositor{count === 1 ? 'y' : 'ies'} watched</span>
      <span className="ml-auto flex items-center gap-2">
        {children}
        <button onClick={() => arm('remove', remove)} className="relative overflow-hidden rounded-lg px-2 py-1 text-meta font-medium text-fg-3 hover:bg-fail/10 hover:text-fail-text">
          {armed === 'remove' ? <><ArmLabel>{count ? `Confirm: stop watching ${count}` : 'Confirm'}</ArmLabel><ArmBar on="plain" /></> : 'Remove workspace'}
        </button>
      </span>
    </header>
  )
}

/** A workspace's repositories on GitHub, to watch with a click: found by name, the most recently pushed first. */
function OwnerRepos({ owner, watched, onAdd }: { owner: string; watched: string[]; onAdd: (repo: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [find, setFind] = useState(''), [adding, setAdding] = useState<string>()
  const q = useApi<{ repo: string; description?: string; private: boolean }[]>(open ? `/workspaces/${encodeURIComponent(owner)}/repos` : undefined, { staleTime: 5 * 60_000 })
  const have = new Set(watched.map((r) => r.toLowerCase()))
  const list = (q.data ?? []).filter((r) => !have.has(r.repo.toLowerCase()) && r.repo.toLowerCase().includes(find.trim().toLowerCase()))
  if (!open) return <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-small font-medium text-accent-text hover:bg-hover"><Plus className="size-3.5" />Add from {owner}&rsquo;s repositories</button>
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <input value={find} onChange={(e) => setFind(e.target.value)} autoFocus placeholder={`Find a repository in ${owner}`} className={`${input} flex-1`} />
        <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-meta font-medium text-fg-3 hover:bg-hover hover:text-fg-1">Done</button>
      </div>
      {q.isLoading ? <Skeleton rows={3} /> : q.error ? <p className="text-small text-fail-text">{(q.error as Error).message}</p> : !list.length ? <p className="text-small text-fg-3">{find ? 'None matches.' : 'Every repository here is watched.'}</p> : (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line">
          {list.slice(0, 100).map((r) => (
            <li key={r.repo} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-small text-fg-1">{r.repo.split('/')[1]}{r.private && <span className="ml-1.5 font-sans text-micro text-fg-4">private</span>}</span>
                {r.description && <span className="block truncate text-meta text-fg-3">{r.description}</span>}
              </span>
              <button disabled={!!adding} onClick={() => { setAdding(r.repo); void onAdd(r.repo).finally(() => setAdding(undefined)) }} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-meta font-medium text-accent-text ring-1 ring-accent/30 hover:bg-accent-soft disabled:opacity-50">
                {adding === r.repo ? <LoaderCircle className="size-3 animate-spin" /> : <Plus className="size-3" />}Watch
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Adding a workspace: you, or one of your GitHub account's organizations (offered only here), or any other by name. */
function AddWorkspace({ onAdded, toast }: { onAdded: () => unknown; toast: Toast }) {
  const q = useApi<{ owner: string; personal: boolean }[]>('/workspaces/offers', { staleTime: 10 * 60_000 })
  const [name, setName] = useState('')
  const add = (owner: string) => { owner = owner.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').split('/')[0]; if (!owner) return
    return api('/workspaces', { owner, on: true }).then(() => { toast(`${owner} is a workspace: pick its repositories`); setName(''); return onAdded() }, (e: Error) => toast(e.message, 'error')) }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
      {(q.data ?? []).map((o) => (
        <button key={o.owner} onClick={() => void add(o.owner)} className="group inline-flex items-center gap-1.5 rounded-full bg-fill/60 px-3 py-1 font-mono text-small ring-1 ring-line transition-all hover:ring-accent">
          <Plus className="size-3 text-fg-3 group-hover:text-accent" />{o.owner}{o.personal && <span className="font-sans text-micro text-fg-3">you</span>}
        </button>
      ))}
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong py-0.5 pl-3 pr-1 focus-within:border-accent/60">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(name) }} placeholder="another organization" aria-label="Add an organization as a workspace" className="w-40 bg-transparent font-mono text-small outline-none placeholder:text-fg-4" />
        <button onClick={() => void add(name)} disabled={!name.trim()} className="rounded-full p-1 text-fg-3 hover:text-accent-text disabled:opacity-40" aria-label="Add"><Plus className="size-3.5" /></button>
      </span>
    </div>
  )
}

function RepoCard({ repo, path, meta, task, toast, onRemove, accounts, pin, onPin, clone, machines = [], machine, allowed = [], byOrg = [], removed = [], here = [], onAllow, route }: {
  route?: { order: string[]; why?: string } // where its work runs, best first (the placement matrix: machines.ts route)
  clone?: string // not on this machine yet: 'cloning', 'not-here' (not allowed on it), or why the clone failed
  machines?: string[]; machine?: string; allowed?: string[]; byOrg?: string[]; removed?: string[]; here?: string[]; onAllow?: (machine: string, on: boolean) => void // several machines: where it may be cloned
  repo: string; path: string; meta?: BaseInfo['meta']; task?: NonNullable<Health['base']>[string]; toast: Toast; onRemove: () => void
  accounts: { id: string; label: string }[]; pin?: string; onPin: (account?: string) => void
}) {
  const called = useMachineName()
  const [plan, setPlan] = useState<Plan | { error: string }>()
  const { armed, arm } = useArm() // stop watching takes a second click
  const busy = task?.state === 'running' || task?.state === 'queued'
  useEffect(() => { if (!busy && !clone) api(`/base/plan?repo=${encodeURIComponent(repo)}`).then(setPlan, (e: Error) => setPlan({ error: e.message })) }, [repo, busy, task?.endedAt, clone])
  const act = (action: 'start' | 'cancel') => api('/base', { repo, action }).then(
    () => toast(action === 'start' ? `Mapping ${repo}` : 'Mapping stopped; finished folders are kept'), (e: Error) => toast(e.message, 'error'))
  const p = plan && !('error' in plan) ? plan : undefined
  const pct = task?.total ? Math.round(((task.done ?? 0) / task.total) * 100) : 0
  const coverage = p ? Math.round((p.known / Math.max(1, p.folders)) * 100) : 0

  const status = clone === 'cloning' ? <span className="inline-flex items-center gap-1.5 text-run-text"><LoaderCircle className="size-3 animate-spin" />Cloning onto this machine</span>
    : clone === 'not-here' ? 'Not on this machine' : clone?.startsWith('kept:') ? <span className="text-wait-text">Unticked here, {clone}</span> : clone ? <span className="text-fail-text">{clone}</span> : undefined
  const mapped = clone !== 'not-here' && !clone?.startsWith('kept:')
  const link = 'shrink-0 text-meta font-medium text-accent-text hover:underline disabled:opacity-40'
  return (
    <div className="group px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fill text-fg-3"><FolderGit2 className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-body font-semibold">{repo}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-meta text-fg-3"><span className="truncate font-mono" title={path}>{home(path)}</span>{status && <><span className="text-fg-4">·</span><span className="truncate">{status}</span></>}</div>
        </div>
        <button onClick={() => arm('remove', onRemove)} title={armed ? 'Click again to stop watching (its codebase map is kept)' : 'Stop watching'} aria-label={`Stop watching ${repo}`}
                className={`relative isolate flex items-center gap-1 overflow-hidden rounded-lg p-1.5 text-small font-medium transition-all hover:bg-fail/10 hover:text-fail-text focus:opacity-100 group-hover:opacity-100 ${armed ? 'text-fail-text opacity-100' : 'text-fg-4 opacity-0'}`}>
          <Trash2 className="size-4" />{armed && <><ArmLabel>Confirm: stop watching</ArmLabel><ArmBar on="plain" /></>}
        </button>
      </div>
      {/* where it lives, what it runs on, its map: one row each, lined up */}
      <div className="ml-11 mt-2.5 space-y-2">
        {machines.length > 1 && onAllow && (
          <Field label="Machines" hint="Where it may be checked out: a new machine holds none until ticked; unticking takes the checkout off once nothing would be lost">
            <Pick multi label={`Machines that may clone ${repo}`} value={machines.filter((m) => !removed.includes(m) && (allowed.includes(m) || byOrg.includes(m) || here.includes(m)))}
                  options={machines.map((m) => ({ value: m, label: m === machine ? <>{called(m)} <span className="font-normal opacity-60">this one</span></> : called(m) }))}
                  onChange={(_, m, on) => onAllow(m, on)} />
          </Field>
        )}
        {machines.length > 1 && route && (
          <Field label="Runs on" hint="Where its reviews, revisions and tickets run: the main server when it may have it, then the machine you work on, then the others; each once it has the checkout">
            {route.order.length
              ? <span className="flex flex-wrap items-center gap-1.5 text-small">
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 font-medium text-accent-text ring-1 ring-accent/20">{route.order[0]}</span>
                  {route.order.length > 1 && <span className="text-meta text-fg-3">then {route.order.slice(1).join(', ')} when it's full or offline</span>}
                </span>
              : <span className="text-small text-wait-text">Nowhere now: {route.why}</span>}
          </Field>
        )}
        {accounts.length > 1 && (
          <Field label="Account" hint="Kept to one account: every run on this repository uses only it, and waits when it is at its limit instead of moving to another">
            <Pick label={`The account ${repo} runs on`} value={pin ?? ''} options={[{ value: '', label: 'Any', hint: 'Follows the order in Accounts' }, ...accounts.map((a) => ({ value: a.id, label: a.label }))]}
                  onChange={(v) => onPin(v || undefined)} />
          </Field>
        )}
        {mapped && (
          <Field label="Map" hint="Its codebase map, made from this machine's checkout: what Explain and the agents read first">
            <div className="flex items-center gap-3">
              <span className="flex h-1 w-24 shrink-0 overflow-hidden rounded-full bg-fill-strong">
                <span className={`h-full rounded-full transition-all duration-700 ease-[var(--ease-snappy)] ${busy ? 'bg-accent' : coverage === 100 ? 'bg-ok' : 'bg-accent/50'}`} style={{ width: `${busy ? Math.max(3, pct) : coverage}%` }} />
              </span>
              <span className="min-w-0 flex-1 truncate text-small text-fg-2">
                {busy ? `${task?.under ? `Mapping ${task.under}` : 'Mapping'} · ${task?.step ?? 'queued'}`
                  : task?.state === 'failed' ? <span className="text-fail-text">{task.error}</span>
                  : p ? (p.toMap === 0 ? `Up to date · ${p.folders} folders on ${p.branch}${meta ? ` · ${hours(meta.mappedAt)}` : ''}`
                    : p.mapped ? (p.complete ? `${p.toMap} folders changed on ${p.branch}` : `${p.known} of ${p.folders} folders`) : `Not mapped · ${p.folders} folders on ${p.branch}`)
                  : plan ? <span className="text-fail-text">{(plan as { error: string }).error}</span> : <span className="text-fg-3">Checking…</span>}
              </span>
              {busy ? <button onClick={() => act('cancel')} className={`${link} !text-fg-3 hover:!text-fail-text`}>Stop</button>
                : p && p.toMap > 0 ? <button onClick={() => act('start')} className={link}>{p.mapped ? (p.complete ? 'Update' : 'Finish') : 'Map it'} · ~${p.estimateUsd.toFixed(2)}</button> : null}
            </div>
          </Field>
        )}
      </div>
    </div>
  )
}

/** What each thing Concierge writes for you runs: a skill you pick (method.ts), shown with whether it is installed. */
function FeatureSkills({ saveConfig }: { saveConfig: SaveConfig }) {
  const q = useApi<{ features: { key: string; label: string; hint: string; default: string; skill: string; found: boolean }[] }>('/method')
  const [open, setOpen] = useState<string>()
  const [all, setAll] = useState<FoundSkill[]>()
  const [filter, setFilter] = useState('')
  useEffect(() => { if (open && !all) void skillsFor('review').then(setAll) }, [open, all])
  const set = (key: string, name: string, label: string) => saveConfig({ skills: { [key]: name } }, `${label}: ${name || 'default'}`).then(() => { setOpen(undefined); refresh('/method') })
  const shown = (all ?? []).filter((x) => !filter || x.name.toLowerCase().includes(filter.toLowerCase()) || x.description?.toLowerCase().includes(filter.toLowerCase())).slice(0, 40)
  return (
    <Group title="What each feature runs" hint="How Concierge explains, briefs, plans and writes is a skill of yours. It brings the facts and the format its pages read; the skill brings the method.">
      {!q.data && <div className="px-4 py-3"><Skeleton rows={3} /></div>}
      {q.data?.features.map((f) => (
        <div key={f.key} className="border-t border-line first:border-t-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
            <div className="min-w-0 flex-1 basis-48"><div className="text-body font-medium text-fg-1">{f.label}</div><div className="text-meta text-fg-3">{f.hint}</div></div>
            <span title={f.found ? 'Installed' : 'Not installed: this feature fails until it is, or you pick another'} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-meta ${f.found ? 'bg-fill text-fg-1' : 'bg-fail/10 text-fail-text ring-1 ring-fail/30'}`}>
              {f.found ? <CircleCheck className="size-3 text-ok" /> : <CircleAlert className="size-3" />}{f.skill}
            </span>
            {f.skill !== f.default && <button onClick={() => void set(f.key, '', f.label)} className={quiet} title={`Back to ${f.default}`}>Default</button>}
            <button onClick={() => { setOpen(open === f.key ? undefined : f.key); setFilter('') }} className={quiet}>{open === f.key ? 'Close' : 'Change'}</button>
          </div>
          {open === f.key && (
            <div className="border-t border-line bg-fill/30 px-3.5 py-2.5">
              <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg bg-fill px-2 py-1"><Search className="size-3.5 text-fg-4" />
                <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter skills" className="w-40 bg-transparent text-small outline-none placeholder:text-fg-4" /></span>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                {!all && <li className="px-2 py-1.5 text-small text-fg-3">Reading the skills on this setup…</li>}
                {shown.map((x) => (
                  <li key={x.invoke}>
                    <button onClick={() => void set(f.key, x.name, f.label)} className={`flex w-full items-start gap-3 rounded-ctl px-2.5 py-1.5 text-left transition-colors ${x.name === f.skill ? 'sel' : 'hover:bg-hover'}`}>
                      <span className="shrink-0 font-mono text-small text-fg-1">{x.name}</span>
                      <span className="min-w-0 flex-1 truncate text-meta text-fg-3">{x.description}</span>
                      <span className="shrink-0 text-micro text-fg-4">{x.source}</span>
                    </button>
                  </li>
                ))}
                {all && !shown.length && <li className="px-2 py-1.5 text-small text-fg-3">No skill matches.</li>}
              </ul>
            </div>
          )}
        </div>
      ))}
    </Group>
  )
}

// --- Skills ----------------------------------------------------------------------------------------

/**
 * The git repositories of skills you added: paste one link or several (any space or line between them), take any off.
 * Each is fetched into Concierge's own folder for its agents; your ~/.claude is never touched. `skills`: what they give.
 */
export function SkillSources({ list, skills, onSave }: { list: string[]; skills: SetupView['skills']; onSave: (list: string[]) => Promise<unknown> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const links = text.split(/[\s,]+/).map((x) => x.trim().replace(/\/$/, '')).filter(Boolean)
  const bad = links.filter((l) => !/^(https:\/\/|git@)[\w.@:/~-]+$/.test(l))
  const save = (next: string[]) => { setBusy(true); void onSave(next).then(() => setText(''), () => {}).finally(() => setBusy(false)) }
  const name = (url: string) => url.replace(/^https:\/\/(www\.)?github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '')
  const slug = (url: string) => url.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).slice(-2).join('-').replace(/[^\w.-]/g, '_')
  return (
    <div className="card overflow-hidden">
      {list.map((url) => {
        const from = skills.filter((x) => x.source === slug(url))
        return (
          <div key={url} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5">
            <Sparkles className="size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-small font-medium text-fg-1" title={url}>{name(url)}</div>
              <div className="truncate text-meta text-fg-3" title={from.map((x) => x.name).join(', ')}>{from.length ? `${from.length} skill${from.length === 1 ? '' : 's'}: ${from.map((x) => x.name).join(', ')}` : busy ? 'Fetching…' : 'No skills found there yet'}</div>
            </div>
            <button onClick={() => save(list.filter((x) => x !== url))} disabled={busy} aria-label={`Take ${name(url)} off`} title="Take it off: its skills leave the agents" className={`${quiet} px-2`}><X className="size-3.5" /></button>
          </div>
        )
      })}
      <div className="space-y-1.5 px-3.5 py-3">
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Skill repository links" placeholder={list.length ? 'Another repository of skills: its link' : 'A repository of skills: its link (paste several at once if you like)'}
                 onKeyDown={(e) => e.key === 'Enter' && links.length && !bad.length && save([...list, ...links.filter((l) => !list.includes(l))])} className={`${input} min-w-0 flex-1 font-mono`} />
          <button onClick={() => save([...list, ...links.filter((l) => !list.includes(l))])} disabled={!links.length || !!bad.length || busy} className={primary}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}Add</button>
        </div>
        <p className={`text-meta ${bad.length ? 'text-fail-text' : 'text-fg-3'}`}>{bad.length ? `Not a git repository link: ${bad.join(', ')}` : 'A git repository (https:// or git@) whose skills/ folder holds one folder per skill. Yours win on the same name.'}</p>
      </div>
    </div>
  )
}

function Skills({ setup, toast, saveConfig, reload }: { setup?: SetupView; toast: Toast; saveConfig: SaveConfig; reload: () => void }) {
  if (!setup) return <Skeleton rows={4} />
  const install = () => api('/setup/skills', {}).then(() => { toast('Concierge’s skills are up to date for its agents'); reload(); refresh('/method') }, (e: Error) => toast(e.message, 'error'))
  const missing = setup.skills.filter((s) => !s.installed)

  return (
    <>
      <OrgSkills toast={toast} />
      <Group title="Skill sources" hint="Git repositories of skills, kept in Concierge's own folder and given to its agents beside yours: on the same name yours wins. Nothing is written into your ~/.claude.">
        <div className="p-3">
          <SkillSources list={setup.skillSources} skills={setup.skills} onSave={(list) => Promise.resolve(saveConfig({ skillSources: list }, 'Skill sources saved')).then(() => { forgetSkills(); refresh('/method') })} />
          {setup.skillSources.length > 0 && <button onClick={install} className={`${quiet} mt-2`}><Sparkles className="size-3.5" />{missing.length ? `Get ${missing.length} missing` : 'Fetch them again now'}</button>}
        </div>
        <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
          {setup.skills.map((s) => (
            <span key={s.name} title={s.yours ? 'Yours (~/.claude/skills): the agents use it' : s.installed ? "Concierge's copy, in its own folder" : 'Not available to the agents here'} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-meta ${s.installed ? 'bg-fill text-fg-2' : 'bg-wait/10 text-wait-text ring-1 ring-wait/30'}`}>
              {s.installed ? <CircleCheck className="size-3 text-ok" /> : <CircleAlert className="size-3" />}{s.name}
            </span>
          ))}
          {!setup.skills.length && <span className="text-small text-fg-3">Can't read this source right now.</span>}
        </div>
      </Group>
      <FeatureSkills saveConfig={saveConfig} />
      <Group title="Skills this setup runs" hint="Every skill your settings name, and the ones they use. Each must exist on every machine.">
        {setup.needed.filter((s) => s.from === 'settings').map((top) => {
          const uses = setup.needed.filter((s) => s.from === top.name)
          const pill = (s: typeof top, main?: boolean) => (
            <span key={s.name} title={s.found ? 'On this machine' : 'Missing on this machine'}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-meta ${main ? 'font-semibold text-fg-1' : 'text-fg-2'} ${s.found ? 'bg-fill' : 'bg-fail/10 text-fail-text ring-1 ring-fail/30'}`}>
              {s.found ? <CircleCheck className="size-3 text-ok" /> : <CircleAlert className="size-3" />}/{s.name}
            </span>
          )
          return (
            <div key={top.name} className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5">
              {pill(top, true)}
              {uses.length > 0 && <span className="px-1 text-meta text-fg-4">uses</span>}
              {uses.map((u) => pill(u))}
            </div>
          )
        })}
      </Group>
    </>
  )
}

// --- who does the work: accounts (Claude, OpenAI through Codex, Llama on Ollama), each signed in on its own ------------

type Kind = 'claude' | 'openai' | 'llama' | 'copilot'
type Spend = { usd: number; input: number; output: number; runs: number }
export type AccountView = {
  id: string; label: string; kind: Kind; host?: string; builtIn: boolean; models: { large?: string; small: string }
  // why: the server's own reason when it can't take work
  available: boolean; why?: string; limitedUntil?: number; plan?: { which: string; w: { resetsAt: number } }; signedIn?: boolean
  // a Claude account: whose plan it spends (its claude.ai login's email, org, tier); samePlanAs: another account signed
  // in as the same login
  who?: { email?: string; org?: string; tier?: string; byToken: boolean; tokenSet?: string; tokenFrom?: string; samePlanAs?: string }
  openai?: 'chatgpt' | 'api-key' | 'none'; llama?: { up: boolean; models: string[]; pulling?: string[] }; today?: Spend
  fallbackToken?: { set?: string; inUse: boolean; everywhere: boolean } // an added Claude account's own setup token (FallbackToken.tsx)
}
export type ProvidersView = {
  use: Partial<Record<string, string>>; fallback: string[]; budgets: Record<string, number>; tiers?: Record<string, string | null>
  stopAt: number // percent of a Claude plan window at which its agents pause
  login: { claude?: { done: boolean; ok: boolean }; openai?: { done: boolean; ok: boolean } }
  routing: { work: string; chosen: string; using: string; label: string; chosenLabel: string; why?: string; until?: number; stuck: boolean }[]
  accounts: AccountView[]
}
const KINDS: [Kind, string][] = [['claude', 'Claude'], ['openai', 'OpenAI'], ['llama', 'Llama'], ['copilot', 'Copilot']]
const WORKS: [string, string, string][] = [
  ['review', 'Reviews', 'Reviewing PRs you were asked to look at, and explaining them'],
  ['revise', 'Your PRs', 'Working through review feedback on your own PRs'],
  ['exec', 'Tickets', 'Shipping Linear tickets as PRs (Ship)'],
  ['small', 'Quick calls', 'Small structured calls: next steps, turns, plans, the standup'],
]
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
const KIND_TONE: Record<Kind, string> = {
  claude: 'bg-wait/10 text-wait-text ring-wait/20',
  openai: 'bg-ok/10 text-ok-text ring-ok/20',
  llama: 'bg-run/10 text-run-text ring-run/20',
  copilot: 'bg-fg-3/10 text-fg-2 ring-zinc-500/25',
}

// a time today, or with its day when it isn't today ("Fri 02:00")
const when = (ms: number) => new Date(ms).toDateString() === new Date().toDateString() ? clock(new Date(ms).toISOString()) : new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
/** Why an account can't take work now, in a few words; nothing when it can. */
export function blocked(a: AccountView): string {
  if (a.kind === 'openai' && a.openai === 'none') return 'not signed in'
  if (a.kind === 'claude' && a.signedIn === false) return 'not signed in'
  if (a.kind === 'llama' && !a.llama?.up) return 'Ollama is not running'
  if (a.kind === 'llama' && a.llama?.pulling?.length) return `downloading ${a.llama.pulling.join(' and ')}`
  if (a.kind === 'llama' && a.llama && [a.models.large, a.models.small].some((m) => m && !hasModel(a.llama!.models, m))) return 'a chosen model is missing from its Ollama'
  if (a.plan) return `plan window spent until ${when(a.plan.w.resetsAt * 1000)}`
  if (a.limitedUntil) return `at its limit until ${when(a.limitedUntil)}`
  return a.available ? '' : a.why ?? 'unavailable'
}

const signedOut = (a: AccountView) => (a.kind === 'claude' && a.signedIn === false) || (a.kind === 'openai' && a.openai === 'none')
/** What a signed-out account would run on, in onboarding's words. */
const SIGN_IN_HINT: Record<Kind, string> = {
  claude: 'Your claude.ai plan (Pro or Max)', openai: 'Your ChatGPT plan', llama: 'Local models through Ollama', copilot: 'Your GitHub Copilot plan',
}

/** Whose plan a Claude account spends, in one line: the login's email and tier, or what is known of a setup token. */
function whoText(a: AccountView): string {
  const w = a.who
  if (!w) return a.builtIn ? 'Your claude.ai sign-in (Settings → Connections)' : 'Signed in'
  const tier = w.tier ? ` · ${w.tier.charAt(0).toUpperCase()}${w.tier.slice(1)}` : ''
  if (a.signedIn === false) return 'Not signed in'
  if (!w.byToken) return w.email ? `${w.email}${tier}` : 'Signed in (no email reported)'
  const set = w.tokenSet ? `, set ${new Date(w.tokenSet).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${w.tokenFrom && w.tokenFrom !== 'you' ? ` from ${w.tokenFrom}` : ''}` : ''
  // Anthropic doesn't name a token's owner: only a match with another account's usage places it (the line below)
  return `Setup token${set} · Anthropic doesn't show whose it is`
}

/** `list` with the item at `from` moved to `to`. */
const moved = <T,>(list: T[], from: number, to: number) => { const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next }

export function Agents({ toast, onConnections, compact }: { toast: Toast; onConnections: () => void; compact?: boolean }) {
  const [drag, setDrag] = useState<{ from: number; over: number }>()
  const [v, setV] = useState<ProvidersView>()
  const [signing, setSigning] = useState<{ id: string; kind: Kind; url: string; code?: string }>()
  const [paste, setPaste] = useState('')
  const [adding, setAdding] = useState<{ kind: Kind; label: string; host: string }>()
  // "does it answer?": one tiny question through the path a run takes, and what came back, shown under the account
  const [tested, setTested] = useState<Record<string, { busy?: boolean; ok?: boolean; text?: string; error?: string; ms?: number }>>({})
  useEffect(() => { api('/providers').then(setV, () => {}) }, [])
  // signing in: check until it is done
  useEffect(() => {
    if (!signing) return
    const t = setInterval(() => api('/providers').then((r: ProvidersView) => {
      setV(r)
      const l = r.login[signing.kind === 'openai' ? 'openai' : 'claude']
      if (l?.done) { setSigning(undefined); setPaste(''); toast(l.ok ? 'Signed in' : 'The sign-in did not finish', l.ok ? 'ok' : 'error') }
    }), 3000)
    return () => clearInterval(t)
  }, [signing])
  if (!v) return <Skeleton rows={4} />
  const set = (body: object, msg: string) => api('/providers', body).then((r) => { setV(r as ProvidersView); toast(msg) }, (e: Error) => toast(e.message, 'error'))
  const test = (a: AccountView) => { setTested((t) => ({ ...t, [a.id]: { busy: true } })); api(`/providers/${encodeURIComponent(a.id)}/test`, {}).then((r) => setTested((t) => ({ ...t, [a.id]: r })), (e: Error) => setTested((t) => ({ ...t, [a.id]: { ok: false, error: e.message } }))) }
  const signIn = (a: AccountView) => {
    // the tab opens now, while the click still counts (a popup opened after the call is blocked), then goes to claude.ai
    const tab = a.kind === 'claude' ? window.open('about:blank', '_blank') : null
    api(`/accounts/${encodeURIComponent(a.id)}/login`, {}).then((r: { url: string; code?: string }) => {
      setSigning({ id: a.id, kind: a.kind, ...r })
      if (a.kind === 'claude') { if (tab) tab.location.href = r.url; else window.open(r.url, '_blank') }
    }, (e: Error) => { tab?.close(); toast(e.message, 'error') })
  }
  const add = () => adding && api('/accounts', { kind: adding.kind, label: adding.label, host: adding.host || undefined })
    .then((r) => { setV(r as ProvidersView); setAdding(undefined); toast(`${adding.label} added: sign it in below`) }, (e: Error) => toast(e.message, 'error'))
  const remove = (a: AccountView) => fetch(`/api/accounts/${encodeURIComponent(a.id)}`, { method: 'DELETE' }).then((r) => r.json())
    .then((r) => { if (r.error) throw new Error(r.error); setV(r); toast(`${a.label} removed`) }).catch((e: Error) => toast(e.message, 'error'))
  const byId = new Map(v.accounts.map((a) => [a.id, a]))
  return (
    <>
      {/* compact (onboarding): the accounts alone, to sign in; the routing and limits wait in Settings */}
      {!compact && <>
      {/* one line for what's off: who can't run, why, and who does the work instead */}
      {(() => {
        const out = [...new Map(v.routing.filter((r) => r.using !== r.chosen || r.stuck).map((r) => [r.chosen, r])).values()]
        return out.length > 0 && (
          <p className="rounded-xl bg-wait/7 px-3.5 py-2.5 text-small text-wait-text ring-1 ring-wait/20">
            {out.map((r) => <span key={r.chosen} className="block"><b>{r.chosenLabel}</b> can't run: {blocked(byId.get(r.chosen)!)}. {r.stuck ? 'Its work waits: nothing set to stand in can take it.' : <>Fresh work goes to <b>{r.label}</b> meanwhile; a run already on {r.chosenLabel} moves only if it's out for more than half an hour.</>}</span>)}
          </p>
        )
      })()}
      <section className="space-y-2">
        <header className="px-0.5"><h3 className="text-small font-semibold text-fg-1">Who does what</h3><p className="text-meta text-fg-3">The account each kind of work runs on. A continued session stays where it started.</p></header>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-small">
            <thead>
              <tr className="border-b border-line">
                <th className="w-[40%] px-4 py-2.5 text-left font-normal text-fg-4" />
                {v.accounts.map((a) => (
                  <th key={a.id} className="px-2 py-2.5 text-center font-medium text-fg-2">
                    <span className="inline-flex flex-col items-center gap-1">
                      <span className={`flex size-6 items-center justify-center rounded-md text-micro font-semibold ring-1 ring-inset ${KIND_TONE[a.kind]}`}>{KINDS.find(([k]) => k === a.kind)![1][0]}</span>
                      <span className="max-w-24 truncate text-meta" title={a.label}>{a.label}</span>
                      <span className={`size-1.5 rounded-full ${blocked(a) ? 'bg-wait' : 'bg-ok'}`} title={blocked(a) || 'Can take work'} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {WORKS.map(([w, title, hint]) => {
                const chosen = v.use[w] ?? v.fallback[0] ?? 'claude', r = v.routing.find((x) => x.work === w)
                return (
                  <tr key={w} className="hover:bg-hover/50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-fg-1">{title}</div>
                      <div className="text-meta text-fg-3">{r && r.using !== r.chosen ? <span className="text-wait-text">On {r.label} for now: {r.chosenLabel} can’t run</span> : hint}</div>
                    </td>
                    {v.accounts.map((a) => {
                      const on = chosen === a.id, off = a.kind === 'openai' && a.openai === 'none' && !on
                      return (
                        <td key={a.id} className="px-2 py-2.5 text-center">
                          <button role="radio" aria-checked={on} disabled={off} aria-label={`${title} on ${a.label}`} title={off ? 'Sign it in first' : on ? `${title} runs on ${a.label}` : `Run ${title.toLowerCase()} on ${a.label}`}
                                  onClick={() => !on && set({ use: { [w]: a.id } }, `${title}: ${a.label}`)}
                                  className={`inline-flex size-5 items-center justify-center rounded-full transition-all disabled:opacity-25 ${on ? 'bg-accent text-on-accent shadow-[0_0_0_4px_var(--accent-soft)]' : 'ring-1 ring-line-strong hover:ring-accent/60'}`}>
                            {on && <Check className="size-3" />}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      </>}

      <section className="space-y-2">
        {!compact && <header className="px-0.5"><h3 className="text-small font-semibold text-fg-1">Accounts</h3><p className="text-meta text-fg-3">Each signs in on its own. Claude and Llama run through Claude Code, OpenAI through Codex, Copilot through its CLI.</p></header>}
        <div className={`grid ${compact ? 'gap-2' : 'gap-3 md:grid-cols-2'}`}>
        {v.accounts.map((a) => (
          <div key={a.id} className={`card flex flex-col ${compact ? 'px-3.5 py-3' : 'px-4 py-3.5'}`}>
            <div className={`flex gap-3 ${compact ? 'items-center' : 'items-start'}`}>
              <span className={`${compact ? '' : 'mt-0.5'} flex size-8 shrink-0 items-center justify-center rounded-lg text-small font-semibold ring-1 ring-inset ${KIND_TONE[a.kind]}`} aria-hidden>{KINDS.find(([k]) => k === a.kind)![1][0]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-body font-semibold text-fg-1">{a.label}</span>
                  {(!compact || !signedOut(a)) && <StatusPill a={a} />}
                </div>
                <div className="truncate text-meta text-fg-3" title={a.kind === 'claude' ? whoText(a) : undefined}>
                  {compact && signedOut(a) ? SIGN_IN_HINT[a.kind]
                    : a.kind === 'claude' ? whoText(a)
                    : a.kind === 'openai' ? (a.openai === 'none' ? 'Not signed in' : `${a.openai === 'chatgpt' ? 'ChatGPT plan' : 'API key, billed per token'} · agents ${a.models.large ?? 'its default'}, quick calls ${a.models.small}`)
                    : a.kind === 'copilot' ? (a.available ? `Your GitHub Copilot plan, through its CLI · model ${a.models.large ?? 'auto'} (auto: Copilot picks)` : `Can't run now: ${a.why ?? 'checking its CLI'}`)
                    : `${a.host ?? 'This machine'} · ${a.llama?.models.length ?? 0} model${a.llama?.models.length === 1 ? '' : 's'} · agents ${a.models.large ?? 'its default'}, quick calls ${a.models.small}`}
                </div>
                {a.id === 'claude' && !compact && <div className="mt-0.5"><ClaudeAccount toast={toast} /></div>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* onboarding signs the built-in Claude in here too; Settings keeps its claude.ai/token switch (ClaudeAccount) */}
                {(a.kind === 'openai' || (a.kind === 'claude' && (!a.builtIn || (compact && signedOut(a))))) && signing?.id !== a.id && (signedOut(a)
                  ? <button onClick={() => signIn(a)} className={primary}>Sign in</button>
                  : <button onClick={() => signIn(a)} className={`${quiet} px-2`} title="Sign in again" aria-label={`Sign ${a.label} in again`}><RotateCcw className="size-3.5" /></button>)}
                {!compact && <button onClick={() => test(a)} disabled={tested[a.id]?.busy} className={`${quiet} px-2`} title="Test: ask it one tiny question, the way a run would, and show what comes back" aria-label={`Test ${a.label}`}>{tested[a.id]?.busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}</button>}
                {!a.builtIn && <button onClick={() => remove(a)} className={`${quiet} px-2 hover:text-fail-text`} aria-label={`Remove ${a.label}`} title="Remove this account"><Trash2 className="size-3.5" /></button>}
              </div>
            </div>
            {tested[a.id] && !tested[a.id].busy && (
              <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-meta ring-1 [overflow-wrap:anywhere] ${tested[a.id].ok ? 'bg-ok/10 text-ok-text ring-ok/20' : 'bg-fail/10 text-fail-text ring-fail/20'}`}>
                {tested[a.id].ok ? `It answers (${((tested[a.id].ms ?? 0) / 1000).toFixed(1)}s): “${tested[a.id].text}”` : `It doesn't answer: ${tested[a.id].error}`}
              </p>
            )}
            {!compact && a.fallbackToken && <FallbackToken a={a} onChange={setV} toast={toast} />}
            {a.who?.samePlanAs && <p className="mt-2 rounded-lg bg-wait/7 px-2.5 py-1.5 text-meta text-wait-text ring-1 ring-wait/20">Same claude.ai login as {a.who.samePlanAs}: runs on either spend one plan.</p>}
            {signing?.id === a.id && (signing.code
              ? <p className="mt-2 text-small">Open <a href={signing.url} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">{signing.url.replace('https://', '')}</a> and enter <b className="font-mono">{signing.code}</b></p>
              : <div className="mt-2 flex flex-wrap items-center gap-2 text-small">
                  <span className="text-fg-2">Approve it in the tab that opened (<a href={signing.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">open again</a>), then paste the code it shows:</span>
                  <input value={paste} onChange={(e) => setPaste(e.target.value)} className={`${input} w-56 font-mono`} aria-label="Sign-in code" />
                  <button disabled={!paste.trim()} onClick={() => api('/claude-auth/finish', { input: paste }).then(() => toast('Code sent'), (e: Error) => toast(e.message, 'error'))} className={primary}>Send</button>
                </div>)}
            {/* a quiet footer: what it reaches, what it did today, and its cap; not while setting up */}
            {!compact && <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-meta text-fg-3 [&:not(:first-child)]:mt-3">
              <AccountConnections a={a} first={byId.get('claude')} onMore={onConnections} />
              <Spent s={a.today} />
              <label className="ml-auto flex items-center gap-1.5">Daily budget
                <span className="flex items-center rounded-md ring-1 ring-line focus-within:ring-accent/50"><span className="pl-1.5 text-fg-4">$</span>
                  <input type="number" min={0} step={1} defaultValue={v.budgets[a.id] ?? ''} placeholder="none" aria-label={`${a.label} daily budget in dollars`}
                         onBlur={(e) => { const n = e.target.value === '' ? null : Number(e.target.value); if (n !== (v.budgets[a.id] ?? null)) void set({ budgets: { [a.id]: n } }, n == null ? `${a.label}: no budget` : `${a.label}: $${n} a day`) }}
                         className="w-14 bg-transparent px-1 py-0.5 text-right tabular-nums text-fg-1 outline-none placeholder:text-fg-4" /></span>
              </label>
            </div>}
            {/* which model each kind of work runs on here: inherited unless picked (Llama's are picked with its speed checks below) */}
            {!compact && a.kind !== 'llama' && <AccountModels a={a} set={set} />}
            {!compact && a.kind === 'llama' && a.llama?.up && (
              <details className="group/models mt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-meta font-medium text-fg-3 hover:text-fg-1">
                  <ChevronRight className="size-3.5 transition-transform group-open/models:rotate-90" />Models and speed checks
                </summary>
                <div className="mt-2"><LlamaModels a={a} set={set} /></div>
              </details>
            )}
          </div>
        ))}
        {adding ? (
          <div className="card flex flex-wrap items-center gap-2 px-3.5 py-3 md:col-span-2">
            <Tabs size="sm" label="Kind" value={adding.kind} onChange={(k) => setAdding({ ...adding, kind: k })} options={KINDS.map(([k, label]) => ({ id: k, label }))} />
            <input autoFocus value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder={adding.kind === 'claude' ? 'Claude (personal)' : adding.kind === 'openai' ? 'OpenAI (work)' : 'Llama on the desktop'} className={`${input} w-52`} aria-label="Name" />
            {adding.kind === 'llama' && <input value={adding.host} onChange={(e) => setAdding({ ...adding, host: e.target.value })} placeholder="http://desktop:11434" className={`${input} w-48 font-mono`} aria-label="Ollama address" />}
            <button onClick={add} disabled={!adding.label.trim()} className={primary}><Plus className="size-3.5" />Add</button>
            <button onClick={() => setAdding(undefined)} className={quiet}>Cancel</button>
          </div>
        ) : compact ? <button onClick={() => setAdding({ kind: 'claude', label: '', host: '' })} className="inline-flex items-center gap-1.5 justify-self-start rounded-md px-1 py-1 text-small font-medium text-fg-3 transition-colors hover:text-fg-1"><Plus className="size-3.5" />Add another account</button>
          : <button onClick={() => setAdding({ kind: 'claude', label: '', host: '' })} className="flex min-h-24 w-full items-center justify-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-3 text-small font-medium text-fg-3 transition-colors hover:border-accent/50 hover:bg-hover hover:text-fg-1"><span className="flex size-8 items-center justify-center rounded-lg border border-dashed border-line"><Plus className="size-3.5" /></span>Add an account</button>}
        </div>
      </section>

      {!compact && <>
      <Group title="The order" hint="Work goes to the first account here that can take it, unless you picked one for that kind of work above; when that one can't run, the next here does. Agents pause when a Claude plan window is this full.">
        <Row icon={Gauge} title="Pause agents at" hint="Lower leaves room for your own Claude use. At 100%, a run stops wherever Claude refuses.">
          <Tabs size="sm" label="Pause agents at" value={String(v.stopAt)} onChange={(n) => void set({ stopAt: Number(n) }, `Agents now pause at ${n}% of a plan window`)}
                options={[...new Set([80, 90, 95, 99, 100, v.stopAt])].sort((a, b) => a - b).map((n) => ({ id: String(n), label: `${n}%`, title: n === 95 ? 'The default' : n === 100 ? 'Until Claude refuses' : undefined }))} />
        </Row>

        {/* the order, dragged by its grip (or Alt + ↑/↓ on a row): it shows where a row lands while it moves */}
        {(drag ? moved(v.fallback, drag.from, drag.over) : v.fallback).map((id, i) => {
          const a = byId.get(id)
          if (!a) return null
          const at = v.fallback.indexOf(id)
          const to = (n: number) => { if (n < 0 || n >= v.fallback.length || n === at) return; void set({ fallback: moved(v.fallback, at, n) }, `${a.label} is now ${n + 1}. in the fallback order`) }
          return (
            <div key={id} draggable tabIndex={0} aria-label={`${i + 1}. ${a.label}: drag, or Alt + arrow keys, to move it`}
                 onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); setDrag({ from: at, over: at }) }}
                 onDragOver={(e) => { e.preventDefault(); if (drag && drag.over !== i) setDrag({ ...drag, over: i }) }}
                 onDrop={(e) => { e.preventDefault(); if (drag) { const { from, over } = drag; setDrag(undefined); if (from !== over) void set({ fallback: moved(v.fallback, from, over) }, `${byId.get(v.fallback[from])?.label} is now ${over + 1}. in the fallback order`) } }}
                 onDragEnd={() => setDrag(undefined)}
                 onKeyDown={(e) => { if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); to(at - 1) } if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); to(at + 1) } }}
                 className={`flex cursor-grab items-center gap-2 px-3.5 py-2 text-small outline-none transition-colors focus-visible:bg-accent/6 active:cursor-grabbing ${drag && v.fallback[drag.from] === id ? 'bg-accent/8 opacity-70' : ''}`}>
              <GripVertical className="size-4 shrink-0 text-fg-4" aria-hidden />
              <span className="w-5 text-right font-semibold tabular-nums text-fg-3">{i + 1}.</span>
              <span className={`shrink-0 rounded-md px-1.5 py-px text-micro font-semibold ring-1 ring-inset ${KIND_TONE[a.kind]}`}>{KINDS.find(([k]) => k === a.kind)![1]}</span>
              <span className="font-medium">{a.label}</span>
              {blocked(a) && <span className="truncate text-meta text-wait-text">{blocked(a)}</span>}
              <button onClick={() => set({ fallback: v.fallback.filter((x) => x !== id) }, `${a.label} is no fallback`)} aria-label={`Remove ${a.label} from the fallbacks`} className={`ml-auto ${quiet}`}><X className="size-3.5" /></button>
            </div>
          )
        })}
        {v.accounts.some((a) => !v.fallback.includes(a.id)) && (
          <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-small">
            <span className="text-fg-3">{v.fallback.length ? 'Add' : 'Stand in with'}</span>
            {v.accounts.filter((a) => !v.fallback.includes(a.id)).map((a) => (
              <button key={a.id} onClick={() => set({ fallback: [...v.fallback, a.id] }, `${a.label} stands in when the chosen one can't`)} className={quiet}><Plus className="size-3.5" />{a.label}</button>
            ))}
          </div>
        )}
      </Group>
      </>}

    </>
  )
}

type Conn = { name: string; status: 'connected' | 'needs-auth' | 'failed'; via: 'claude.ai' | 'claude code' | 'codex' }
const connCache = new Map<string, Conn[]>() // across tab switches: reading them starts every connector, which takes a while
/**
 * The connectors an account's runs can use, by where they come from, and (for any but the first account) the ones the
 * first has that this one lacks: what a run on it will have to do without.
 */
function AccountConnections({ a, first, onMore }: { a: AccountView; first?: AccountView; onMore: () => void }) {
  const [list, setList] = useState<Conn[] | undefined>(connCache.get(a.id))
  const [busy, setBusy] = useState(false)
  const [firstList, setFirstList] = useState<Conn[] | undefined>(connCache.get('claude'))
  const read = (fresh = false) => {
    setBusy(true)
    return api(`/accounts/${encodeURIComponent(a.id)}/connections${fresh ? '?fresh=1' : ''}`).then((r: Conn[]) => { connCache.set(a.id, r); setList(r); if (a.id === 'claude') setFirstList(r) }, () => {}).finally(() => setBusy(false))
  }
  useEffect(() => {
    if (!list) void read()
    if (a.id !== 'claude' && !firstList && first) api('/accounts/claude/connections').then((r: Conn[]) => { connCache.set('claude', r); setFirstList(r) }, () => {})
  }, [a.id])
  const bare = (n: string) => n.replace(/^claude\.ai /, '')
  const ok = new Set((list ?? []).filter((c) => c.status === 'connected').map((c) => bare(c.name)))
  const missing = a.id === 'claude' || !firstList || !list ? [] : firstList.filter((c) => c.status === 'connected' && !ok.has(bare(c.name))).map((c) => bare(c.name))
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <PlugZap className="size-3.5 text-fg-4" />
      {list ? <button onClick={onMore} title="See them in Connections" className="hover:text-fg-1 hover:underline">{ok.size} of {list.length} connectors work</button> : <span className="text-fg-4">checking connectors…</span>}
      {missing.length > 0 && <span className="inline-flex items-center gap-1 text-wait-text">· {missing.length} missing<More>
        <p className="mb-1.5 font-medium text-fg-1">What Claude has and this one doesn’t</p>
        <p>{missing.join(', ')}</p>
        <p className="mt-1.5 text-fg-3">A run here works without them, and says so.</p>
      </More></span>}
      <button onClick={() => void read(true)} disabled={busy} title="Check again" aria-label="Check the connectors again" className="rounded p-0.5 text-fg-4 hover:text-fg-1 disabled:opacity-40"><RotateCcw className={`size-3 ${busy ? 'animate-spin' : ''}`} /></button>
    </div>
  )
}

/** Today's use of an account: its runs, and dollars where known. */
const Spent = ({ s }: { s?: Spend }) => !s?.runs ? <span className="text-fg-4">No runs today</span> : (
  <span className="tabular-nums" title={`${tokens(s.input)} in · ${tokens(s.output)} out`}>
    {s.runs} run{s.runs === 1 ? '' : 's'} today{s.usd ? ` · $${s.usd.toFixed(2)}` : ''}
  </span>
)

/** Whether an account takes work now, in one or two words; the full reason on hover. */
function StatusPill({ a }: { a: AccountView }) {
  const why = blocked(a)
  const label = !why ? 'Ready' : /not signed in/.test(why) ? 'Signed out' : /not running/.test(why) ? 'Offline'
    : /downloading/.test(why) ? 'Downloading' : /missing/.test(why) ? 'Model missing' : /budget/.test(why) ? 'Over budget' : /CLI/.test(why) ? 'Not ready'
    : why.replace(/^(plan window spent|at its limit) until /, 'Paused until ')
  return <span title={why || 'Can take work'} className={`inline-flex items-center gap-1 rounded-full px-2 py-px text-micro font-medium ring-1 ring-inset ${why ? 'bg-wait/10 text-wait-text ring-wait/20' : 'bg-ok/10 text-ok-text ring-ok/20'}`}>
    <span className={`size-1.5 rounded-full ${why ? 'bg-wait' : 'bg-ok'}`} />{label}
  </span>
}

type OllamaCheck = { model: string; error?: string; seconds?: number; writingPerSecond?: number; loaded?: { name: string; onGpu: number }[] }
const isCloud = (m: string) => /cloud$/.test(m)
const hasModel = (list: string[], m?: string) => !!m && list.some((x) => x === m || x === `${m}:latest`)
const CLOUD_TONE = 'bg-run/10 text-run-text ring-run/20'
const LOCAL_TONE = 'bg-fg-3/10 text-fg-2 ring-zinc-500/20 '

/** What a speed check found, in a few words: how fast, and where it ran (Ollama Cloud, or how much on the GPU). */
function Checked({ r }: { r?: OllamaCheck | 'checking' }) {
  if (!r) return null
  if (r === 'checking') return <span className="inline-flex items-center gap-1 text-fg-3"><LoaderCircle className="size-3 animate-spin" />checking…</span>
  if (r.error) return <span className="text-wait-text">{
    /not included in your free usage/.test(r.error) ? <>Not in your Ollama Cloud plan · <a href="https://ollama.com/upgrade" target="_blank" rel="noreferrer" className="underline">upgrade</a></>
      : /unauthori[sz]ed|sign ?in/i.test(r.error) ? 'Ollama Cloud: not signed in (ollama signin, where Ollama runs)'
      : /timeout|aborted/i.test(r.error) ? 'no answer in 3 minutes (busy with other work, or too slow here)'
      : r.error.slice(0, 140)}</span>
  const gpu = r.loaded?.find((m) => m.name === r.model)?.onGpu
  return <span className="tabular-nums text-fg-3">answered in {r.seconds}s{r.writingPerSecond ? ` · writes ${r.writingPerSecond}/s` : ''}{isCloud(r.model) ? '' : gpu ? ` · ${gpu}% on the GPU` : ' · on the CPU'}</span>
}

/** A Llama account's models, from its Ollama: large for agents, small for quick calls, each on this machine or on Ollama
 * Cloud. A speed check for each, and an Ollama Cloud model tried before it is chosen (the free plan takes only a few). */
function LlamaModels({ a, set }: { a: AccountView; set: (b: object, m: string) => void }) {
  const [checks, setChecks] = useState<Record<string, OllamaCheck | 'checking'>>({})
  const [other, setOther] = useState('')
  const all = a.llama?.models ?? []
  const here = a.host ? 'On its machine' : 'On this machine'
  const check = (model: string, q: string) => {
    setChecks((c) => ({ ...c, [model]: 'checking' }))
    return api(`/ollama/check?account=${encodeURIComponent(a.id)}&${q}`)
      .then((r: OllamaCheck) => setChecks((c) => ({ ...c, [model]: r })), (e: Error) => setChecks((c) => ({ ...c, [model]: { model, error: e.message } })))
  }
  const use = (size: 'large' | 'small', m: string) => set({ models: { [a.id]: { [size]: m } } }, `${a.label} ${size === 'large' ? 'agents' : 'quick calls'}: ${m}`)
  const tried = other.trim() ? checks[other.trim()] : undefined
  const triedOk = !!tried && tried !== 'checking' && !tried.error
  return (
    <div className="basis-full space-y-1.5 rounded-xl bg-fill/60 px-3 py-2.5 text-small ring-1 ring-line ">
      {([['large', 'Agents'], ['small', 'Quick calls']] as const).map(([size, title]) => {
        const now = a.models[size] ?? ''
        const opts = (cloud: boolean) => [...new Set([now, ...all].filter((m) => m && isCloud(m) === cloud))]
        return (
          <div key={size} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 font-medium text-fg-2 ">{title}</span>
            <Pick className="min-w-0 flex-1" label={`${a.label} ${title}: model`} value={now} onChange={(m) => m !== now && use(size, m)}
                  options={[...opts(true), ...opts(false)].map((m) => ({ value: m, mono: true, label: `${m}${hasModel(all, m) ? '' : ' (missing)'}`, hint: `${isCloud(m) ? 'Ollama Cloud' : here}${hasModel(all, m) ? '' : ' · not pulled yet'}` }))} />
            <button onClick={() => check(now, `size=${size}`)} disabled={checks[now] === 'checking'} className={quiet}><Zap className="size-3.5" />Check speed</button>
            <Checked r={checks[now]} />
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 ">
        <span className="w-20 shrink-0 font-medium text-fg-2 ">Try a model</span>
        <input value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && other.trim()) void check(other.trim(), `model=${encodeURIComponent(other.trim())}`) }}
               placeholder="gemma4:31b-cloud" aria-label="Model to try" className={`${input} w-52 font-mono text-small`} />
        <button disabled={!other.trim() || tried === 'checking'} onClick={() => check(other.trim(), `model=${encodeURIComponent(other.trim())}`)} className={quiet}>Try</button>
        {triedOk && <>
          <button onClick={() => use('large', other.trim())} className={primary}>Use for agents</button>
          <button onClick={() => use('small', other.trim())} className={quiet}>For quick calls</button>
        </>}
        <Checked r={tried} />
        <a href="https://ollama.com/search?c=cloud" target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent-text hover:underline">Ollama Cloud models<ExternalLink className="size-3" /></a>
      </div>
    </div>
  )
}

// --- each account's use, a tab each: its plan windows (Claude's and Codex's), and a week of tokens, dollars and runs

type Window = { used: number; resetsAt: number }
type AccountUse = {
  id: string; label: string; kind: Kind; using: boolean; windows?: { five?: Window; seven?: Window; at?: string }
  days: { day: string; usd: number; input: number; output: number; runs: number }[]; ollama?: { up: boolean; loaded: string[] }
}
const resetsAt = (sec: number) => new Date(sec * 1000).toLocaleString('en-GB', new Date(sec * 1000).toDateString() === new Date().toDateString() ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })

function AccountUsage() {
  const [all, setAll] = useState<AccountUse[]>()
  const [tab, setTab] = useState<string>()
  useLive(['/usage/accounts'], () => api('/usage/accounts').then((r: AccountUse[]) => { setAll(r); setTab((t) => t ?? r.find((a) => a.using)?.id ?? r[0]?.id) }, () => {}))
  if (!all?.length) return null
  const a = all.find((x) => x.id === tab) ?? all[0]
  const sum = (k: 'usd' | 'input' | 'output' | 'runs') => a.days.reduce((n, d) => n + d[k], 0)
  const today = a.days.at(-1)!
  const peak = Math.max(...a.days.map((d) => d.input + d.output), 1)
  const live = (w?: Window) => (w && w.resetsAt * 1000 > Date.now() ? w : undefined)
  const bar = (title: string, w?: Window) => (
    <div className="min-w-0 flex-1 basis-40 rounded-xl px-3 py-2.5 ring-1 ring-line ">
      <div className="flex items-baseline justify-between text-small"><span className="font-medium text-fg-2 ">{title}</span>
        <span className="font-mono font-semibold tabular-nums">{live(w) ? `${Math.round(w!.used * 100)}%` : '–'}</span></div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-strong"><div className={`h-full rounded-full ${(live(w)?.used ?? 0) >= 0.95 ? 'bg-fail' : (live(w)?.used ?? 0) >= 0.8 ? 'bg-wait' : 'bg-accent'}`} style={{ width: `${Math.max(2, (live(w)?.used ?? 0) * 100)}%` }} /></div>
      <div className="mt-1 text-meta text-fg-3">{live(w) ? `resets ${resetsAt(w!.resetsAt)}` : 'no report yet: it shows after its next run'}</div>
    </div>
  )
  const stat = (label: string, value: string) => <div className="min-w-0"><div className="text-meta text-fg-3">{label}</div><div className="font-mono text-body font-semibold tabular-nums">{value}</div></div>
  return (
    <Group title="Accounts" hint="Plan windows and the last 7 days of use, per account.">
      <div className="px-3 pt-3">
        <Tabs as="tab" label="Account" value={a.id} onChange={setTab} options={all.map((x) => ({ id: x.id, label: x.label, dot: x.using ? 'ok' as const : undefined, title: x.using ? 'Agents run on it now' : undefined }))} />
      </div>
      <div className="space-y-3 px-3.5 py-3">
        {a.kind === 'llama'
          ? <p className="text-small text-fg-3">{a.ollama?.up ? (a.ollama.loaded.length ? `Running ${a.ollama.loaded.join(', ')}` : 'Ollama is up, no model loaded') : 'Ollama is not running'} · local models have no plan limits</p>
          : <div className="flex flex-wrap gap-2">{bar(a.kind === 'claude' ? 'Session (5 hours)' : 'Session (5 hours)', a.windows?.five)}{bar('Week (7 days)', a.windows?.seven)}</div>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat('Today', `${tokensShort(today.input + today.output)} tokens`)}{stat('Runs today', String(today.runs))}
          {stat('7 days', `${tokensShort(sum('input') + sum('output'))} tokens`)}{stat(a.kind === 'llama' || (a.kind === 'openai' && !sum('usd')) ? 'Runs, 7 days' : 'Spent, 7 days', a.kind === 'llama' || (a.kind === 'openai' && !sum('usd')) ? String(sum('runs')) : `$${sum('usd').toFixed(2)}`)}
        </div>
        <div className="flex h-16 items-end gap-1.5" aria-label="Tokens per day, last 7 days">
          {a.days.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${tokensShort(d.input)} in, ${tokensShort(d.output)} out, ${d.runs} run${d.runs === 1 ? '' : 's'}${d.usd ? `, $${d.usd.toFixed(2)}` : ''}`}>
              <div className={`w-full rounded-sm ${d.day === today.day ? 'bg-accent' : 'bg-fill-strong'}`} style={{ height: `${Math.max(4, ((d.input + d.output) / peak) * 48)}px` }} />
              <span className="text-micro text-fg-3">{new Date(d.day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
            </div>
          ))}
        </div>
      </div>
    </Group>
  )
}
const tokensShort = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

// --- the organization's skills --------------------------------------------------------------------

const MODES: [Mode, string, string][] = [
  ['auto', 'By fit', 'Offered to every run; the agent loads it when the task fits its description'],
  ['always', 'Always', 'Loaded at the start of every run'],
  ['off', 'Off', 'Never offered to the agents'],
]

/** Your organization's skills from claude.ai: on which machines, how the agents use them, and how often they did. */
function OrgSkills({ toast }: { toast: Toast }) {
  const called = useMachineName()
  const [skills, setSkills] = useState<OrgSkill[]>()
  const [more, setMore] = useState(false)
  useEffect(() => { api('/org-skills?fresh=1').then(setSkills, () => setSkills([])) }, [])
  if (!skills?.length) return null
  const setMode = (s: OrgSkill, mode: Mode) => {
    setSkills(skills.map((x) => (x.name === s.name ? { ...x, mode } : x)))
    api(`/org-skills/${encodeURIComponent(s.name)}/mode`, { mode }).then(() => toast(`${s.name}: ${MODES.find(([m]) => m === mode)![1].toLowerCase()}`), (e: Error) => toast(e.message, 'error'))
  }
  const ours = skills.filter((s) => s.company), theirs = skills.filter((s) => !s.company)
  const on = skills.filter((s) => s.mode !== 'off').length
  const runs = skills.reduce((n, s) => n + (s.used?.count ?? 0), 0)
  const card = (s: OrgSkill) => (
    <div key={s.name} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-3">
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${s.mode === 'off' ? 'bg-fill text-fg-3' : 'bg-accent/10 text-accent-text'}`}><Wand className="size-3.5" aria-hidden /></span>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-small font-semibold">{s.name}</span>
          {s.used && <span title={`Last: ${s.used.lastFor}, ${ago(s.used.lastAt)}`} className="rounded-full bg-ok/10 px-1.5 text-micro font-semibold text-ok-text">used {s.used.count}×</span>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-meta leading-snug text-fg-3" title={s.description}>{s.description}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-fg-3">
          <span>updated {ago(s.updatedAt)}</span>
          {Object.entries(s.machines).map(([m, how]) => (
            <span key={m} title={how === 'current' ? `${m} has the newest from claude.ai` : `${m} runs the newest through Concierge's sync`} className="inline-flex items-center gap-1">
              <span className={`size-1.5 rounded-full ${how === 'current' ? 'bg-ok' : 'bg-run'}`} />{called(m)}{how === 'mirror' && ' (via deck)'}
            </span>
          ))}
          {s.used && <span className="truncate">last in {s.used.lastFor}</span>}
        </p>
      </div>
      <Tabs size="sm" label={`${s.name}: when agents use it`} value={s.mode} onChange={(m) => setMode(s, m)} options={MODES.map(([m, label, hint]) => ({ id: m, label, title: hint }))} />
    </div>
  )
  return (
    <Group title="Organization skills" hint={`From your organization on claude.ai, kept in sync on every machine that runs Concierge. ${on} of ${skills.length} reach the agents${runs ? `; runs loaded them ${runs} time${runs === 1 ? '' : 's'}` : ''}.`}>
      {ours.map(card)}
      {theirs.length > 0 && (more ? theirs.map(card)
        : <button onClick={() => setMore(true)} className="w-full px-4 py-2.5 text-left text-small font-medium text-accent-text hover:underline">+{theirs.length} from Anthropic ({theirs.filter((s) => s.mode !== 'off').length} on)</button>)}
    </Group>
  )
}

// --- Exec ------------------------------------------------------------------------------------------

/**
 * What every plan is checked against (readiness.ts): where its users are, what it is certified for, what data it
 * handles, which reviews it requires, and the people who build it. Each click saves. Plans turn it into the obligations they
 * must cover (a DPIA, change review, a security review…) and compare their scope with the team's capacity.
 */
/**
 * Fill the profile for you: Linear (its teams and everyone on them, a role from their teams and a
 * pace from the points they finished in six weeks) and your code (what it shows of regions, certifications, data and
 * reviews, with the files it was read from). Shown as suggestions: take them all, or one by one.
 */
function FillCompliance({ c, saveConfig }: { c: Compliance; saveConfig: SaveConfig }) {
  const [on, setOn] = useState(false), [fresh, setFresh] = useState(0)
  const q = useApi<ComplianceSuggestion>(on ? `/compliance/suggest${fresh ? '?fresh=1' : ''}` : undefined, { staleTime: 10 * 60_000 })
  const v = q.data
  const label = (k: 'regions' | 'certifications' | 'data' | 'reviews', id: string) => ({ regions: REGIONS, certifications: CERTIFICATIONS, data: DATA, reviews: REVIEWS }[k].find(([x]) => x === id)?.[1] ?? id)
  const newIds = (k: 'regions' | 'certifications' | 'data' | 'reviews') => (v?.[k] ?? []).filter((e) => !(c[k] ?? []).includes(e.id))
  const team = c.team ?? []
  const known = (m: Member) => team.find((x) => (m.linearId && x.linearId === m.linearId) || x.name === m.name)
  const newPeople = (v?.team ?? []).filter((m) => !known(m))
  // people already here, with what Linear knows that they lack: their teams, their Linear id, a pace
  const updates = (v?.team ?? []).filter((m) => { const x = known(m); return x && (!x.linearId || JSON.stringify([...(x.teams ?? [])].sort()) !== JSON.stringify([...(m.teams ?? [])].sort()) || (!x.pace && m.pace)) })
  const merged = (): Compliance => ({
    ...c,
    ...Object.fromEntries((['regions', 'certifications', 'data', 'reviews'] as const).map((k) => [k, [...new Set([...(c[k] ?? []), ...newIds(k).map((e) => e.id)])]])),
    team: [...team.map((x) => { const m = (v?.team ?? []).find((y) => (x.linearId && y.linearId === x.linearId) || y.name === x.name); return m ? { ...x, teams: m.teams, linearId: m.linearId, pace: x.pace ?? m.pace } : x }),
      ...newPeople.map(({ done6w: _, ...m }) => m)],
  })
  const total = (['regions', 'certifications', 'data', 'reviews'] as const).reduce((a, k) => a + newIds(k).length, 0) + newPeople.length + updates.length
  if (!on) return (
    <button onClick={() => setOn(true)} className="flex w-full items-center gap-3 rounded-card border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-3 text-left transition-colors hover:bg-accent-soft">
      <Sparkles className="size-5 shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1"><span className="block text-small font-semibold text-fg-1">Fill it from Linear and your code</span>
        <span className="block text-meta text-fg-3">Your teams and everyone on them, each one’s pace, and what your repositories show of regions, certifications and data. You pick what to keep.</span></span>
    </button>
  )
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent-text" /><h3 className="text-small font-semibold text-fg-1">From Linear and your code</h3>
        {v && <span className="text-meta text-fg-4">· read {v.scanned.length} repositor{v.scanned.length === 1 ? 'y' : 'ies'}{v.teams.length ? ` and ${v.teams.length} Linear team${v.teams.length === 1 ? '' : 's'}` : ''}</span>}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {v && <button onClick={() => setFresh((n) => n + 1)} disabled={q.isFetching} className={quiet} title="Read them again"><RotateCcw className={`size-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /></button>}
          <button onClick={() => setOn(false)} className={quiet}>Close</button>
        </span>
      </div>
      {!v ? <p className="flex items-center gap-2 text-small text-fg-3"><LoaderCircle className="size-4 animate-spin" />Reading Linear and your repositories… (a big codebase takes a little while)</p> : <>
        {v.error && <p className="rounded-ctl bg-wait/10 px-3 py-2 text-small text-wait-text">{v.error}</p>}
        {(['regions', 'certifications', 'data', 'reviews'] as const).map((k) => newIds(k).length > 0 && (
          <div key={k} className="flex flex-wrap items-center gap-1.5">
            <span className="label w-28 shrink-0 text-fg-4">{k}</span>
            {newIds(k).map((e) => (
              <button key={e.id} onClick={() => saveConfig({ compliance: { ...c, [k]: [...(c[k] ?? []), e.id] } }, `${label(k, e.id)}: on`)} title={`Found in ${e.hits} file${e.hits === 1 ? '' : 's'}:\n${e.files.join('\n')}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent/50 px-2.5 py-1 text-small text-fg-1 transition-colors hover:bg-accent-soft">
                <Plus className="size-3 text-accent-text" />{label(k, e.id)}<span className="text-micro text-fg-4">{e.hits} file{e.hits === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        ))}
        {(newPeople.length > 0 || updates.length > 0) && (
          <div className="space-y-1.5">
            <p className="label text-fg-4">People {newPeople.length > 0 && `· ${newPeople.length} new`}{updates.length > 0 && ` · ${updates.length} to update`}</p>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto">
              {[...newPeople, ...updates].map((m) => (
                <li key={m.linearId ?? m.name} className="flex flex-wrap items-center gap-2 rounded-ctl px-2 py-1 text-small hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate text-fg-1">{m.name}{known(m) && <span className="ml-1.5 text-micro text-fg-4">already here</span>}</span>
                  <span className="font-mono text-meta text-fg-3">{m.teams?.join(' · ')}</span>
                  <span className="w-20 text-right text-meta tabular-nums text-fg-3" title={`${m.done6w} points finished in six weeks`}>{m.pace ? `${m.pace} pt/wk` : 'no points'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {total ? (
          <div className="flex items-center gap-2 border-t border-line pt-3">
            <button onClick={() => saveConfig({ compliance: merged() }, `Filled from Linear and your code`)} className={primary}><Check className="size-3.5" />Use all {total}</button>
            <span className="text-meta text-fg-3">Or take them one by one above. Each suggestion shows where it was read on hover.</span>
          </div>
        ) : <p className="text-small text-fg-3">Nothing new: your profile already has all of it.</p>}
      </>}
    </section>
  )
}

/**
 * Compliance, per organization: each one's plans are checked against its own profile (where its users are, what it is
 * certified for, the data it handles, the reviews it requires, the people who build it), or not at all. An
 * organization without its own uses the shared one of before; your personal one starts off.
 */
function ComplianceSettings({ setup, saveConfig: saveShared }: { setup?: SetupView; saveConfig: SaveConfig }) {
  const [name, setName] = useState(''), [role, setRole] = useState('engineer')
  const teamsQ = useApi<{ teams: { key: string; name: string }[] }>(setup?.linearKey ? '/plans/teams' : undefined, { staleTime: 10 * 60_000 })
  const orgsQ = useApi<Org[]>('/orgs', { staleTime: 10 * 60_000 })
  // opened for one organization (a plan's "Turn them on": ?org=…), else the first company one
  const [owner, setOwner] = useState<string | undefined>(() => new URLSearchParams(location.search).get('org') ?? undefined)
  if (!setup) return <Skeleton rows={4} />
  const orgs = orgsQ.data ?? []
  const o = orgs.find((x) => x.owner === owner) ?? orgs.find((x) => !x.personal) ?? orgs[0]
  const own = o ? (setup.config.orgs as Record<string, { compliance?: Compliance }> | undefined)?.[o.owner]?.compliance : undefined
  const c: Compliance = o ? (own ?? (o.personal ? { off: true } : setup.config.compliance ?? {})) : setup.config.compliance ?? {}
  // what changes here is the picked organization's own profile (the shared one stays for those without one)
  const saveConfig: SaveConfig = (body, msg) => { const b = body as { compliance?: Compliance }; return o && b.compliance ? saveShared({ orgCompliance: { owner: o.owner, compliance: b.compliance } }, msg) : saveShared(body, msg) }
  const toggle = (k: 'regions' | 'certifications' | 'data' | 'reviews', id: string, label: string) => {
    const on = (c[k] ?? []).includes(id)
    saveConfig({ compliance: { ...c, [k]: on ? (c[k] ?? []).filter((x) => x !== id) : [...(c[k] ?? []), id] } }, `${label}: ${on ? 'off' : 'on'}`)
  }
  const team = c.team ?? []
  const setTeam = (t: NonNullable<Compliance['team']>, msg: string) => saveConfig({ compliance: { ...c, team: t } }, msg)
  const add = () => { const n = name.trim(); if (!n || team.some((m) => m.name === n)) return; setTeam([...team, { name: n, role }], `${n} added`); setName('') }
  const group = (k: 'regions' | 'certifications' | 'data' | 'reviews', title: string, hint: string, list: [string, string][]) => (
    <Group title={title} hint={hint}>
      <div className="flex flex-wrap gap-1.5 px-3.5 py-3">{list.map(([id, label]) => <Chip key={id} on={(c[k] ?? []).includes(id)} onClick={() => toggle(k, id, label)}>{label}</Chip>)}</div>
    </Group>
  )
  const teamKeys = teamsQ.data?.teams.map((t) => t.key) ?? [...new Set(team.flatMap((m) => m.teams ?? []))]
  return (
    <>
      {o && (
        <Group title="Workspace" hint="Each workspace's plans are checked against its own profile, or not at all (Settings → Workspaces lists them).">
          {orgs.length > 1 && <div className="px-3.5 pt-3"><Tabs size="sm" as="tab" label="Workspace" value={o.owner} onChange={setOwner} options={orgs.map((x) => ({ id: x.owner, label: x.personal ? `${x.owner} (you)` : x.owner }))} /></div>}
          <div className="flex items-center gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-small font-medium text-fg-1">Compliance checks for {o.owner}</p>
              <p className="text-meta text-fg-3">{c.off ? 'Off: its plans are not checked for privacy law, certifications or required reviews.' : own ? 'On, with its own profile below.' : 'On, with the shared profile below (changing it gives this workspace its own).'}</p>
            </div>
            <Toggle on={!c.off} label={`Compliance checks for ${o.owner}`} onChange={(v) => void saveConfig({ compliance: { ...c, off: v ? undefined : true } }, `Compliance for ${o.owner}: ${v ? 'on' : 'off'}`)} />
          </div>
        </Group>
      )}
      {!c.off && <>
      <FillCompliance c={c} saveConfig={saveConfig} />
      {group('regions', 'Where your users are', 'Each brings its privacy law: a plan that handles their data owes what it requires.', REGIONS)}
      {group('certifications', 'Certifications', 'What you are certified for, or working toward: each adds controls every plan must keep.', CERTIFICATIONS)}
      {group('data', 'Data you handle', 'What your product processes. A plan that touches it is checked for consent, retention and safeguards.', DATA)}
      {group('reviews', 'Reviews you require', 'Sign-offs a change needs before it ships. Counted as covered roles on the team.', REVIEWS)}
      </>}
      <Group title="Capacity" hint="Who builds it, and in which role: plans compare their scope with what these people finish inside the appetite.">
        {team.map((m) => (
          <div key={m.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-micro font-semibold text-fg-2">{m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
            <span className="min-w-0 flex-1 basis-28 truncate text-small font-medium text-fg-1">{m.name}</span>
            <div className="flex flex-wrap gap-1.5">{TEAM_ROLES.map(([id, label]) => <Chip key={id} on={m.role === id} onClick={() => m.role !== id && setTeam(team.map((x) => (x.name === m.name ? { ...x, role: id } : x)), `${m.name}: ${label}`)}>{label}</Chip>)}</div>
            {teamKeys.length > 0 && (
              <div className="flex basis-full flex-wrap items-center gap-1.5 pl-10" aria-label={`${m.name}: teams`}>
                <span className="text-meta text-fg-4">Teams</span>
                {teamKeys.map((k) => { const on = !!m.teams?.includes(k); return <Chip key={k} mono on={on} onClick={() => setTeam(team.map((x) => (x.name === m.name ? { ...x, teams: on ? (x.teams ?? []).filter((t) => t !== k) : [...(x.teams ?? []), k] } : x)), `${m.name}: ${on ? 'off' : 'on'} ${k}`)}>{k}</Chip> })}
              </div>
            )}
            <span className="inline-flex items-center gap-1 rounded-ctl bg-fill text-small" title="Points a week (unset: the plan's pace)">
              <button onClick={() => setTeam(team.map((x) => (x.name === m.name ? { ...x, pace: Math.max(1, (x.pace ?? 5) - 1) } : x)), `${m.name}: ${Math.max(1, (m.pace ?? 5) - 1)} pt a week`)} className="px-2 py-1 text-fg-3 hover:text-fg-1" aria-label="Slower">−</button>
              <b className="min-w-12 text-center font-semibold tabular-nums text-fg-1">{m.pace ?? '–'}<span className="font-normal text-fg-4"> /wk</span></b>
              <button onClick={() => setTeam(team.map((x) => (x.name === m.name ? { ...x, pace: Math.min(50, (x.pace ?? 5) + 1) } : x)), `${m.name}: ${Math.min(50, (m.pace ?? 5) + 1)} pt a week`)} className="px-2 py-1 text-fg-3 hover:text-fg-1" aria-label="Faster">+</button>
            </span>
            <button onClick={() => setTeam(team.filter((x) => x.name !== m.name), `${m.name} removed`)} aria-label={`Remove ${m.name}`} className="rounded-lg p-1.5 text-fg-4 transition-colors hover:bg-fail/10 hover:text-fail-text"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} placeholder="Name" aria-label="Name" className={`${input} w-44`} />
          <div className="flex flex-wrap gap-1.5">{TEAM_ROLES.map(([id, label]) => <Chip key={id} on={role === id} onClick={() => setRole(id)}>{label}</Chip>)}</div>
          <button onClick={add} disabled={!name.trim()} className={primary}><Plus className="size-3.5" />Add</button>
        </div>
      </Group>
    </>
  )
}

/**
 * Who may open Concierge through your tailnet link: the people listed (by Tailscale login), added and removed here. On
 * this machine itself it always opens. When the link doesn't say who is calling, only a password protects it.
 */
function Access({ toast }: { toast: Toast }) {
  const q = useApi<{ logins: string[]; you?: string; proxied?: boolean; fromEnv: string[] }>('/access')
  const [add, setAdd] = useState('')
  const v = q.data
  if (!v) return <Skeleton rows={2} />
  const save = (logins: string[], msg: string) => api('/access', { logins: logins.filter((l) => !v.fromEnv.includes(l)) }).then(() => { void q.refetch(); toast(msg) }, (e: Error) => toast(e.message, 'error'))
  const go = () => { const l = add.trim(); if (!l || v.logins.includes(l)) return; void save([...v.logins, l], `${l} can open it`); setAdd('') }
  return (
    <Group title="Who can open it" hint="Through your tailnet link, only these people (as Tailscale knows them). On this machine itself it always opens.">
      {/* through the Tailscale link, Tailscale says who is asking: no password. Opened on this machine: always yours.
          Only a request from elsewhere that carries no login (the port exposed some other way) can't be checked */}
      {v.proxied && !v.you && <p className="flex items-start gap-2 bg-wait/6 px-4 py-2.5 text-small text-wait-text"><CircleAlert className="mt-px size-3.5 shrink-0" />
        <span>This page reached it from another device without Tailscale saying who you are (not through the tailnet link), so nobody can be checked this way. Open it through the link, or set <code className="font-mono">CONCIERGE_PASSWORD</code> in .env to ask for a password.</span></p>}
      {!v.proxied && <p className="px-4 py-2.5 text-small text-fg-3">You opened it on this machine, where it always opens. Through the tailnet link, Tailscale tells Concierge who is asking, so only the people below get in: no password needed.</p>}
      {v.logins.map((l) => (
        <Row key={l} icon={UsersRound} title={l} hint={l === v.you ? 'You' : v.fromEnv.includes(l) ? 'From CONCIERGE_ALLOW in .env' : undefined}>
          {l !== v.you && !v.fromEnv.includes(l) && <button onClick={() => void save(v.logins.filter((x) => x !== l), `${l} can no longer open it`)} aria-label={`Remove ${l}`} className="rounded-lg p-1.5 text-fg-4 transition-colors hover:bg-fail/10 hover:text-fail-text"><Trash2 className="size-3.5" /></button>}
        </Row>
      ))}
      {!v.logins.length && <p className="px-4 py-3 text-small text-fg-3">Nobody yet. Once this machine is on your tailnet, the person whose devices are on it is let in by themselves; on a tailnet several people share, the first to open it through the link becomes its owner.</p>}
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} placeholder="their Tailscale login, e.g. sam@example.com" aria-label="Tailscale login" className={`${input} min-w-0 flex-1`} />
        <button onClick={go} disabled={!add.trim()} className={primary}><Plus className="size-3.5" />Let them in</button>
      </div>
    </Group>
  )
}

/** A choice that toggles: the app's one pill (ui/Pick.tsx). */
const Chip = ({ on, onClick, children, title, mono }: { on: boolean; onClick: () => void; children: ReactNode; title?: string; mono?: boolean }) => <PickPill on={on} onClick={onClick} title={title} mono={mono} check>{children}</PickPill>

/**
 * Ship's setup, all of it a click: which Linear teams' tickets show (each team from Linear itself), the repository
 * each team's tickets are worked in (one pill per watched repository), and the tools a run may use. Each change is
 * saved as it is made.
 */
export function Exec({ setup, saveConfig }: { setup?: SetupView; saveConfig: SaveConfig }) {
  const x = setup?.config.exec
  const teamsQ = useApi<{ teams: { id: string; key: string; name: string }[] }>(setup?.linearKey ? '/plans/teams' : undefined, { staleTime: 10 * 60_000 })
  // a Linear team's tickets are worked in the repositories of the organizations that manage their work in Linear: not
  // your personal ones (orgs.ts). None marked Linear yet: every repository, as before
  const orgsQ = useApi<import('../../server/orgs.ts').Org[]>('/orgs', { staleTime: 10 * 60_000 })
  const [rule, setRule] = useState('')
  if (!setup || !x) return <Skeleton rows={4} />
  const all_ = Object.keys(setup.config.repos)
  const linearOrgs = new Set((orgsQ.data ?? []).filter((o) => o.tracker === 'linear').map((o) => o.owner))
  const ofLinear = all_.filter((r) => linearOrgs.has(r.split('/')[0]))
  const repos = ofLinear.length ? ofLinear : all_
  const known = teamsQ.data?.teams ?? []
  const keys = [...new Set([...known.map((t) => t.key), ...x.teams, ...Object.keys(x.repoByPrefix)])].sort()
  const nameOf = (k: string) => known.find((t) => t.key === k)?.name
  const save = (patch: Partial<typeof x>, msg: string) => saveConfig({ exec: { ...x, ...patch } }, msg)
  const all = !x.teams.length
  const showTeam = (k: string) => {
    const on = all || x.teams.includes(k)
    // from "every team", turning one off keeps the others; the last one off again means every team
    const next = all ? keys.filter((t) => t !== k) : on ? x.teams.filter((t) => t !== k) : [...x.teams, k]
    save({ teams: next.length === keys.length ? [] : next }, `${k}: ${on ? 'hidden from Ship' : 'shown in Ship'}`)
  }
  const setRepo = (k: string, r?: string) => {
    const { [k]: _, ...rest } = x.repoByPrefix
    save({ repoByPrefix: r ? { ...rest, [k]: r } : rest }, r ? `${k} tickets are worked in ${r}` : `${k}: no repository`)
  }
  const addRule = () => { const t = rule.trim(); if (!t || x.allowedTools.includes(t)) return setRule(''); save({ allowedTools: [...x.allowedTools, t] }, `Allowed: ${t}`); setRule('') }
  return (
    <>
      <Group title="Linear teams" hint={`Whose tickets show in Ship, and the repository each team’s tickets are worked in${ofLinear.length ? ` (${[...linearOrgs].join(', ')}: the organizations that manage their work in Linear)` : ''}. Saved as you click.`}>
        {!setup.linearKey && <Row icon={CircleAlert} title="Linear isn’t connected" hint="Paste a Linear API key under Machines → Shared keys (Linear → Settings → Security & access → API keys). Ship lists your tickets with it." />}
        {setup.linearKey && teamsQ.isLoading && <div className="px-4 py-3"><Skeleton rows={2} /></div>}
        {keys.map((k) => {
          const on = all || x.teams.includes(k), repo = x.repoByPrefix[k]
          return (
            <div key={k} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 transition-opacity ${on ? '' : 'opacity-55'}`}>
              <span className="flex h-7 min-w-11 shrink-0 items-center justify-center rounded-lg bg-fill px-1.5 font-mono text-meta font-semibold text-fg-1">{k}</span>
              <div className="min-w-0 flex-1 basis-32">
                <div className="truncate text-small font-medium text-fg-1">{nameOf(k) ?? k}</div>
                <div className="text-meta text-fg-3">{!on ? 'Hidden from Ship' : repo ? <>Worked in <span className="font-mono">{repo}</span></> : <span className="text-wait-text">Pick its repository</span>}</div>
              </div>
              {on && (
                <Pick label={`${k}: repository`} value={repo} onChange={(r) => setRepo(k, repo === r ? undefined : r)}
                      options={[...new Set([...repos, ...(repo ? [repo] : [])])].map((r) => ({ value: r, mono: true, hint: r, label: r.split('/')[1] ?? r }))} />
              )}
              <Toggle label={`Show ${k} in Ship`} on={on} onChange={() => showTeam(k)} />
            </div>
          )
        })}
        {setup.linearKey && !keys.length && !teamsQ.isLoading && <p className="px-4 py-3 text-small text-fg-3">No Linear teams found for your key.</p>}
      </Group>

      <Group title="Allowed tools" hint="What a ticket’s run may use without asking. Anything else is refused, and the ticket shows it.">
        {([['Built in', (t: string) => !/^Bash\(|^mcp__/.test(t)], ['Commands', (t: string) => t.startsWith('Bash(')], ['Connectors', (t: string) => t.startsWith('mcp__')]] as const).map(([group, is]) => {
          const list = x.allowedTools.filter(is)
          if (!list.length) return null
          const short = (t: string) => t.startsWith('Bash(') ? t.slice(5, -1).replace(/:\*$/, '') : t.startsWith('mcp__') ? t.slice(5).replace(/^(?:plugin_[a-z]+_|claude_ai_)/, '').replace(/__+/g, ' · ').replace(/_/g, ' ') : t
          return (
            <div key={group} className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5">
              <span className="label w-24 shrink-0 text-fg-4">{group}</span>
              {list.map((t) => (
                <span key={t} title={t} className="group/t inline-flex max-w-full items-center gap-1 rounded-full bg-fill py-0.5 pl-2.5 pr-1 font-mono text-meta text-fg-2">
                  <span className="truncate">{short(t)}</span>
                  <button onClick={() => save({ allowedTools: x.allowedTools.filter((y) => y !== t) }, `No longer allowed: ${t}`)} aria-label={`Remove ${t}`}
                          className="rounded-full p-0.5 text-fg-4 opacity-0 transition-opacity hover:bg-fail/10 hover:text-fail-text group-hover/t:opacity-100 focus-visible:opacity-100"><X className="size-3" /></button>
                </span>
              ))}
            </div>
          )
        })}
        <div className="flex items-center gap-1.5 px-3.5 py-2.5">
          <span className="label w-24 shrink-0 text-fg-4">Add</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong py-0.5 pl-2.5 pr-1 focus-within:border-accent/60">
            <Plus className="size-3 text-fg-4" />
            <input value={rule} onChange={(e) => setRule(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRule() }} onBlur={addRule}
                   placeholder="Bash(npm:*)" aria-label="Allow another tool" className="w-28 bg-transparent font-mono text-meta outline-none placeholder:text-fg-4" />
          </span>
        </div>
      </Group>
    </>
  )
}

// --- Usage --------------------------------------------------------------------------------------------

function Usage({ health, setup, save, saveConfig }: { health?: Health; setup?: SetupView; save: Save; saveConfig: SaveConfig }) {
  const budget = health?.settings?.dailyBudgetUsd ?? null
  const today = health?.spentToday ?? 0
  const days = health?.spendDays ?? []
  const [draft, setDraft] = useState(budget?.toString() ?? '')
  const [perRun, setPerRun] = useState(setup ? String(setup.config.explainBudgetUsd) : '')
  const [bases, setBases] = useState<BaseInfo[]>([])
  useEffect(() => setDraft(budget?.toString() ?? ''), [budget])
  useEffect(() => { if (setup) setPerRun(String(setup.config.explainBudgetUsd)) }, [setup])
  useEffect(() => { api('/base').then(setBases).catch(() => {}) }, [])
  const peak = useMemo(() => Math.max(...days.map((d) => d.usd), budget ?? 0, 0.01), [days, budget])
  const week = days.reduce((n, d) => n + d.usd, 0)
  const mapped = bases.filter((b) => b.meta)
  const pct = budget ? Math.min(100, (today / budget) * 100) : 0
  const tone = pct >= 100 ? 'bg-fail' : pct >= 75 ? 'bg-wait' : 'bg-accent'
  const saveBudget = () => {
    const v = draft.trim() === '' ? null : Number(draft)
    if (v === budget || (v !== null && (!Number.isFinite(v) || v < 0))) return
    save('/settings', { dailyBudgetUsd: v }, v === null ? 'Daily budget removed' : `Daily budget set to $${v}`).catch(() => {})
  }
  const stats: [string, number, string][] = [
    ['Today', today, budget != null ? `of a $${budget} budget` : 'no daily budget'],
    ['Last 7 days', week, `$${(week / 7).toFixed(2)} a day on average`],
    ['Codebase maps', mapped.reduce((n, b) => n + (b.meta?.costUsd ?? 0), 0), `${mapped.length} repo${mapped.length === 1 ? '' : 's'}, paid once`],
  ]

  return (
    <>
      <AccountUsage />
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map(([label, usd, hint]) => (
          <div key={label} className="card p-4 ">
            <div className="text-small font-medium text-fg-3">{label}</div>
            <div className="mt-1 font-mono text-display font-semibold tabular-nums">${usd.toFixed(2)}</div>
            <div className="text-meta text-fg-3">{hint}</div>
          </div>
        ))}
      </div>

      <Group title="Last 7 days" hint={budget != null ? 'The dashed line is your daily budget.' : undefined}>
        <div className="px-4 pb-3 pt-6">
          <div className="relative flex h-28 items-end gap-2">
            {budget != null && <span className="absolute inset-x-0 border-t border-dashed border-fail/70" style={{ bottom: `${(budget / peak) * 100}%` }} />}
            {days.map((d, i) => (
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-micro text-fg-3 opacity-0 transition-opacity group-hover:opacity-100">${d.usd.toFixed(2)}</span>
                <span className={`w-full rounded-md transition-all duration-500 ${i === days.length - 1 ? tone : 'bg-fill-strong group-hover:bg-fill-strong'}`}
                      style={{ height: `${Math.max(3, (d.usd / peak) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            {days.map((d, i) => <span key={d.day} className="flex-1 text-center text-micro text-fg-3">{i === days.length - 1 ? 'Today' : weekday(d.day + 'T12:00')}</span>)}
          </div>
        </div>
      </Group>

      <Runs />

      <Group title="Limits" hint="When a limit is reached, new runs wait instead of starting.">
        <Row icon={Wallet} title="Daily budget" hint={budget != null ? `$${today.toFixed(2)} spent today` : 'Empty means no cap'}>
          <label className={`flex w-28 items-center gap-1 ${input}`}>
            <span className="text-fg-3">$</span>
            <input inputMode="decimal" value={draft} placeholder="no cap" onChange={(e) => setDraft(e.target.value)}
                   onBlur={saveBudget} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-full bg-transparent tabular-nums outline-none" />
          </label>
        </Row>
        {budget != null && (
          <div className="px-4 pb-3.5">
            <span className="flex h-1.5 overflow-hidden rounded-full bg-fill">
              <span className={`h-full rounded-full transition-all duration-700 ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
            </span>
          </div>
        )}
        <Row icon={MapIcon} title="Per explanation" hint="The most a single Explain run may spend.">
          <label className={`flex w-28 items-center gap-1 ${input}`}>
            <span className="text-fg-3">$</span>
            <input inputMode="decimal" value={perRun} onChange={(e) => setPerRun(e.target.value)}
                   onBlur={() => { const v = Number(perRun); if (setup && Number.isFinite(v) && v !== setup.config.explainBudgetUsd) saveConfig({ explainBudgetUsd: v }, `Explain runs capped at $${v}`) }}
                   onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-full bg-transparent tabular-nums outline-none" />
          </label>
        </Row>
        {health?.github?.remaining != null && (
          <Row icon={GitPullRequestArrow} title="GitHub API" hint={health.github.remaining < 500 ? 'Low: syncing every 5 minutes until it resets. Shared with your own gh.' : 'Shared with your own gh.'}>
            <span className={`text-small tabular-nums ${health.github.remaining < 500 ? 'text-wait-text' : 'text-fg-2'}`}>{health.github.remaining} of 5000 left{health.github.resetAt ? ` · resets ${clock(health.github.resetAt)}` : ''}</span>
          </Row>
        )}
      </Group>
    </>
  )
}

/** Every run of the last 7 days from the event log: per day how they ended and what they cost, then the latest ones. */
type RunRow = { at: string; entity: string; id: string; kind?: string; to: string; cause: string; costUsd?: number; refused?: number; error?: string; restarts: number; startedAt?: string }
type DayRow = { day: string; runs: number; done: number; failed: number; cancelled: number; interrupted: number; refused: number; costUsd: number }
function Runs() {
  const [v, setV] = useState<{ runs: RunRow[]; totals: DayRow[] }>()
  useLive(['/runs'], () => api('/runs?days=7').then(setV, () => {}))
  if (!v || (!v.runs.length && !v.totals.length)) return null
  const tone: Record<string, string> = { done: 'text-ok-text', failed: 'text-fail-text', interrupted: 'text-wait-text', cancelled: 'text-fg-3', running: 'text-run-text', queued: 'text-fg-3' }
  const cell = 'px-2 py-1.5 text-right tabular-nums'
  return (
    <Group title="Runs" hint="Every run in the last 7 days, and how it ended.">
      <div className="overflow-x-auto px-2 pb-1 pt-1">
        <table className="w-full text-small">
          <thead className="text-meta font-medium text-fg-3">
            <tr><th className="px-2 py-1.5 text-left font-medium">Day</th><th className={cell}>Runs</th><th className={cell}>Done</th><th className={cell}>Failed</th><th className={cell}>Stopped</th><th className={cell}>Refused</th><th className={cell}>Cost</th></tr>
          </thead>
          <tbody>
            {v.totals.map((d) => (
              <tr key={d.day} className="border-t border-line ">
                <td className="px-2 py-1.5">{weekday(d.day + 'T12:00')} <span className="text-fg-3">{d.day.slice(5)}</span></td>
                <td className={cell}>{d.runs}</td><td className={cell}>{d.done}</td>
                <td className={`${cell} ${d.failed ? 'text-fail-text' : ''}`}>{d.failed}</td>
                <td className={cell}>{d.cancelled + d.interrupted}</td>
                <td className={`${cell} ${d.refused ? 'text-wait-text' : ''}`}>{d.refused}</td>
                <td className={cell}>${d.costUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-t border-line text-small ">
        {v.runs.slice(0, 25).map((r) => (
          <li key={`${r.entity}|${r.id}|${r.at}`} className="flex items-center gap-3 px-4 py-2" title={r.error}>
            <span className={`w-20 shrink-0 font-medium ${tone[r.to] ?? ''}`}>{r.to}</span>
            <span className="min-w-0 flex-1 truncate"><span className="text-fg-3">{r.kind ?? r.entity}</span> {r.id}<span className="text-fg-3"> · {r.cause}{r.restarts ? ` · ${r.restarts} restart${r.restarts > 1 ? 's' : ''}` : ''}{r.refused ? ` · ${r.refused} refused` : ''}</span></span>
            {r.costUsd != null && <span className="shrink-0 font-mono text-meta text-fg-3">${r.costUsd.toFixed(2)}</span>}
            <span className="w-16 shrink-0 text-right text-meta text-fg-3">{clock(r.at)}</span>
          </li>
        ))}
      </ul>
    </Group>
  )
}

// --- About -----------------------------------------------------------------------------------------

function About({ setup, onSetup }: { setup?: SetupView; onSetup: () => void }) {
  const keys: [string, string][] = [['j / k', 'Next / previous PR'], ['o', 'Open crit'], ['r', 'Resume the agent session'], ['g', 'Open on GitHub'], ['/', 'Filter the list'], ['Esc', 'Close the top modal, then the PR']]
  return (
    <>
      <Group title="Setup">
        <Row icon={RotateCcw} title="Run setup again" hint="Tools, repositories, skills and preferences, step by step.">
          <button onClick={onSetup} className={quiet}>Open</button>
        </Row>
        {setup && <Row icon={Settings2} title="Settings file" hint={<span className="font-mono">{home(setup.configFile)}</span>} />}
      </Group>
      <Group title="Keyboard">
        <div className="grid gap-x-6 gap-y-2.5 px-4 py-4 sm:grid-cols-2">
          {keys.map(([k, label]) => (
            <div key={k} className="flex items-center gap-3 text-small">
              <kbd className="min-w-12 rounded-md border border-b-2 border-line-strong bg-surface-1 px-1.5 py-0.5 text-center font-mono text-meta text-fg-2 ">{k}</kbd>
              <span className="text-fg-2 ">{label}</span>
            </div>
          ))}
        </div>
      </Group>
      <p className="flex items-center gap-1.5 text-small text-fg-3"><Keyboard className="size-3.5" />Concierge runs on this machine; it only talks to GitHub and Claude.</p>
    </>
  )
}

/**
 * Update a Docker install: the button leaves a note that bin/update on the host picks up within a minute (cron); it
 * builds while things run and swaps the container once no agent is working. Its last log lines show here.
 */
type UpdateView = {
  asked: boolean; standby?: boolean; deployed?: string; log: string[]; version?: string; latest?: { sha: string; at: string }
  upstream?: { behind: number; at: string; url: string; note?: string; commits: { sha: string; subject: string }[] } // a fork: the original repo
  status?: { phase: 'idle' | 'queued' | 'building' | 'draining' | 'restarting' | 'updated' | 'current' | 'failed'; text: string; busy: boolean; sha?: string; until?: string }
}
const STEPS = [['queued', 'Asked'], ['building', 'Building'], ['draining', 'Waiting for agents'], ['restarting', 'Restarting'], ['updated', 'Done']] as const
/** Update now, and where it stands: each step bin/update goes through, what it waits for, and when it is done. */
function Update() {
  const [u, setU] = useState<UpdateView>()
  const [gone, setGone] = useState(false) // the server didn't answer: restarting, if an update was under way
  const read = () => api('/update').then((r: UpdateView) => { setU(r); setGone(false) }, () => setGone(true))
  // a click answers at once (Asking…), and a refusal says why instead of doing nothing
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState<string>()
  const ask = (body: object) => { setAsking(true); setErr(undefined); api('/update', body).then(read, (e: Error) => setErr(e.message)).finally(() => setAsking(false)) }
  useEffect(() => { void read(); const t = setInterval(read, 3000); return () => clearInterval(t) }, [])
  const st = u?.status, busy = !!st?.busy || (gone && !!u?.status?.busy)
  const phase = gone && busy ? 'restarting' : st?.phase
  const at = STEPS.findIndex(([k]) => k === phase)
  const runs = u?.version ? sha(u.version) : u?.deployed
  const behind = !!u?.latest && !!runs && !u.latest.sha.startsWith(runs) && !runs.startsWith(u.latest.sha)
  const title = u?.version ? `Running ${label(u.version)} (${sha(u.version)})` : runs ? `Running ${runs}` : 'Update'
  const hint = gone && busy ? 'Restarting: this page reconnects by itself in a few seconds.'
    : st?.text ?? 'Pulls the latest Concierge and restarts it once no agent is working.'
  return (
    <Group title="Updates" hint="Builds the latest while this version runs, then restarts once agents are idle (30 minutes at most).">
      <Row icon={Download} title={`${title}${u?.latest ? (behind ? ` · ${u.latest.sha} is out` : ' · the latest') : ''}`} hint={hint}>
        <span className="flex shrink-0 items-center gap-1.5">
          {u?.version && u.version !== VERSION && !busy
            ? <button onClick={() => location.reload()} className={quiet}>Reload this tab</button>
            : <button disabled={!u || busy || asking} onClick={() => ask({})} className={`${quiet} inline-flex items-center gap-1.5 disabled:opacity-60`}>
                {(busy || asking) && <LoaderCircle className="size-3.5 animate-spin" />}{asking ? 'Asking…' : busy ? (STEPS[at]?.[1] ?? 'Updating') + '…' : 'Update now'}
              </button>}
          {phase === 'draining' && <button onClick={() => ask({ now: true })} title="Agents continue after, in the same conversation, but what they ran in the background is lost" className={quiet}>Restart now anyway</button>}
        </span>
      </Row>
      {err && <p role="alert" className="mx-3.5 mb-3 rounded-lg bg-fail/10 px-3 py-2 text-small text-fail">{err}</p>}
      {/* one machine: no standby to build it, and the app (which runs agents) may not drive Docker: you run it */}
      {u && !u.standby && (asking || u.asked) && !busy && <p className="mx-3.5 mb-3 rounded-lg bg-fill px-3 py-2 text-small text-fg-2">
        Updating builds the new version on your computer and restarts Concierge with it, which Concierge can’t do from inside Docker. Run <code className="font-mono">bin/update</code> in its checkout (a cron line of yours with <code className="font-mono">--if-asked</code> does it for this button).</p>}
      {u?.upstream && <Upstream up={u.upstream} busy={busy || asking} onMerge={() => ask({ upstream: true })} />}
      {(busy || phase === 'updated') && at >= 0 && (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3.5 pb-3 text-meta" aria-label="Update progress">
          {STEPS.map(([k, name], i) => (
            <li key={k} className={`flex items-center gap-1.5 ${i < at ? 'text-fg-3' : i === at ? 'font-semibold text-fg-1' : 'text-fg-4'}`} aria-current={i === at ? 'step' : undefined}>
              {i > 0 && <span className="text-fg-4">›</span>}
              {i < at || phase === 'updated' ? '✓ ' : ''}{name}
            </li>
          ))}
        </ol>
      )}
    </Group>
  )
}

/**
 * Update from anywhere: a chip in the status bar. It shows only when there is something to do (a newer Concierge is
 * out, an update is under way, or this tab runs an older page than the server), and one click does it.
 */
export function UpdateChip() {
  const [u, setU] = useState<UpdateView>()
  const [asking, setAsking] = useState(false), [gone, setGone] = useState(false)
  const read = () => api('/update').then((r: UpdateView) => { setU(r); setGone(false) }, () => setGone(true))
  const busy = !!u?.status?.busy || asking
  useEffect(() => { void read(); const t = setInterval(read, busy || gone ? 3000 : 60_000); return () => clearInterval(t) }, [busy, gone]) // eslint-disable-line react-hooks/exhaustive-deps
  const runs = u?.version ? sha(u.version) : u?.deployed
  const behind = !!u?.latest && !!runs && !u.latest.sha.startsWith(runs) && !runs.startsWith(u.latest.sha)
  const stale = !!u?.version && u.version !== VERSION
  const chip = 'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-meta font-medium transition-colors'
  if (stale && !busy) return <button onClick={() => location.reload()} className={`${chip} bg-accent-soft text-accent-text hover:bg-accent/20`} title={`The server runs ${label(u!.version!)}: reload to use it`}><RefreshCw className="size-3.5" />Reload for {label(u!.version!)}</button>
  if (busy || (gone && u?.status?.busy)) {
    const step = gone ? 'Restarting' : (STEPS.find(([k]) => k === u?.status?.phase)?.[1] ?? 'Updating')
    return <span className={`${chip} text-run-text`} title={u?.status?.text}><LoaderCircle className="size-3.5 animate-spin" />{step}…</span>
  }
  if (!behind) return null
  return (
    <button onClick={() => { setAsking(true); api('/update', {}).then(read, () => {}).finally(() => setAsking(false)) }} className={`${chip} bg-fill text-fg-1 hover:bg-fill-strong`}
            title={`Builds ${u!.latest!.sha} while this one runs, then restarts once agents are idle`}>
      <Download className="size-3.5" />Update to {u!.latest!.sha.slice(0, 7)}
    </button>
  )
}

/** A fork: what the original Concierge has that it lacks. Merging is yours to ask (your fork has changes of its own). */
function Upstream({ up, busy, onMerge }: { up: NonNullable<UpdateView['upstream']>; busy: boolean; onMerge: () => void }) {
  const conflict = !!up.note && /conflict/.test(up.note)
  return (
    <div className="mx-3.5 mb-3 rounded-lg border border-line px-3 py-2.5">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-small text-fg-2">
          {up.behind
            ? <><span className="font-semibold text-fg-1">The original Concierge has {up.behind} new commit{up.behind === 1 ? '' : 's'}</span> your fork lacks.</>
            : 'Your fork has everything from the original Concierge.'}
          <span className="text-fg-4"> Checked {new Date(up.at).toLocaleString()} · <a href={up.url} target="_blank" rel="noreferrer" className="underline">{up.url.replace(/^https?:\/\/(www\.)?github\.com\//, '')}</a></span>
        </p>
        {!!up.behind && <button disabled={busy} onClick={onMerge} title="Merges them into your fork, pushes it, then updates as usual. A conflict changes nothing." className={`${quiet} shrink-0 disabled:opacity-60`}>Merge and update</button>}
      </div>
      {conflict && <p role="alert" className="mt-2 rounded-md bg-fail/10 px-2.5 py-1.5 text-meta text-fail">They conflict with your changes: run <code>git merge upstream/main</code> in the repo and resolve them.</p>}
      {!!up.commits.length && (
        <details className="mt-1.5 text-meta">
          <summary className="cursor-pointer text-fg-3">What's new</summary>
          <ul className="mt-1 space-y-0.5">{up.commits.map((c) => <li key={c.sha} className="truncate text-fg-2"><a href={`${up.url}/commit/${c.sha}`} target="_blank" rel="noreferrer" className="font-mono text-fg-4">{c.sha}</a> {c.subject}</li>)}</ul>
          {up.behind > up.commits.length && <p className="mt-1 text-fg-4">and {up.behind - up.commits.length} more</p>}
        </details>
      )}
    </div>
  )
}

/**
 * Where Concierge runs: this machine and the other one (two machines, README), their heartbeats and how they keep in
 * step (replica.ts), so a hand-over or a machine falling behind shows here instead of only in a log.
 */
/**
 * Machines asking to join from another Tailscale login (bin/join on that machine; your own login joins at once): approve
 * one only if its screen shows the same code. Shown only while one waits.
 */
function JoinRequests() {
  const q = useApi<{ joins: { id: string; name: string; ip: string; login?: string; code: string; at: string }[] }>('/machines/joins', { refetchInterval: 5000 })
  const { armed, arm } = useArm()
  const [err, setErr] = useState<string>()
  const decide = (id: string, approve: boolean) => api(`/machines/joins/${id}`, { approve }).then(() => refresh('/machines/joins'), (e: Error) => setErr(e.message))
  if (!q.data?.joins.length) return null
  return (
    <Group title="Asking to join" hint="From another Tailscale login. Approve only if that machine's screen shows the same code: it gets the machine key and your shared keys.">
      {q.data.joins.map((j) => (
        <Row key={j.id} icon={UsersRound} title={`${j.name} · ${j.login ?? j.ip}`} hint={<>Its code: <b className="font-mono text-body tracking-[0.2em] text-fg-1">{j.code}</b></>}>
          <span className="flex items-center gap-1.5">
            <button onClick={() => void decide(j.id, false)} className={quiet}>Deny</button>
            <button onClick={() => arm(`join-${j.id}`, () => void decide(j.id, true))} className={`${quiet} relative isolate overflow-hidden !text-accent-text`}>
              {armed === `join-${j.id}` ? <><ArmLabel>Confirm: codes match</ArmLabel><ArmBar on="plain" /></> : 'Approve'}
            </button>
          </span>
        </Row>
      ))}
      {err && <p role="alert" className="mx-3.5 mb-3 rounded-lg bg-fail/10 px-3 py-2 text-small text-fail">{err}</p>}
    </Group>
  )
}

/** The key the machines prove to each other: a new one reaches all within a minute, the old one works 10 more. */
function MachineKey() {
  const { armed, arm } = useArm()
  const [done, setDone] = useState<string>()
  return (
    <Group title="Machine key" hint="Shared by the machines to trust each other. A new one reaches all within a minute.">
      <Row icon={ShieldAlert} title={done ?? 'Rotate it now and then, or when a machine leaves'}>
        <button onClick={() => arm('rotate', () => void api('/machines/rotate-key', {}).then(() => setDone('New key made: every machine has it within a minute'), (e: Error) => setDone(e.message)))}
                className={`${quiet} relative isolate overflow-hidden ${armed === 'rotate' ? 'text-fail-text' : ''}`}>
          {armed === 'rotate' ? <><ArmLabel>Confirm new key</ArmLabel><ArmBar on="plain" /></> : 'New key'}</button>
      </Row>
    </Group>
  )
}

function Machines() {
  const [v, setV] = useState<InfraView>()
  useLive(['/infra'], () => api('/infra').then(setV, () => {}))
  if (!v) return null
  const since = `up since ${clock(v.startedAt)}${v.version ? ` · ${v.version}` : ''}`
  if (!v.role) return <Group title="Machine"><Row icon={Server} title="This machine runs it" hint={since} /></Group>
  // in step: this machine follows the one holding the lease (its state, then its files), or is the one others follow
  const r = v.replica, files = r ? Object.entries(r.files) : []
  const filesLate = files.filter(([, f]) => f.pending || f.error)
  return (
    <Group title="Control plane" hint="The primary runs Concierge; the standby takes over while it is offline.">
      {v.beats.filter((b) => !b.name.includes('.sync-conflict-')).map((b) => (
        <Row key={b.name} icon={Server} title={`${b.name}${b.name === v.machine ? ' (this one)' : ''} · ${b.role ?? '?'}`}
             hint={`${b.handing ? 'handing over' : b.active ? 'runs Concierge' : 'waiting'} · heartbeat ${b.agoS != null ? `${b.agoS}s ago` : 'never'}${b.name === v.machine ? ` · ${since}` : ''}`} />
      ))}
      {r && <Row icon={PlugZap}
           title={r.following ? (r.stateError ? `Not following ${r.following}` : r.caughtUp ? `In step with ${r.following}` : `Catching up with ${r.following}`) : 'Others follow this one'}
           hint={r.following
             ? (r.stateError ?? `State: change ${r.applied} of ${r.sourceHead}${filesLate.length ? ` · files: ${filesLate.map(([n, f]) => f.error ?? `${f.pending} to bring from ${n}`).join(', ')}` : ' · files up to date'}`)
             : `State at change ${r.head}${files.length ? ` · files from ${files.map(([n, f]) => `${n} ${f.error ? `(${f.error})` : 'up to date'}`).join(', ')}` : ''}`} />}
      {v.conflicts.length > 0 && <Row icon={CircleAlert} title={`${v.conflicts.length} conflict cop${v.conflicts.length > 1 ? 'ies' : 'y'}`} hint={`Both machines changed: ${v.conflicts.slice(0, 3).join(', ')}`} />}
    </Group>
  )
}

/** One-click light/dark flip. */
export function ThemeButton({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const isDark = theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'))
  return (
    <button onClick={() => onTheme(isDark ? 'light' : 'dark')} title={isDark ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle theme"
            className="group relative rounded-lg p-1.5 text-fg-3 transition-all duration-200 hover:bg-hover hover:text-fg-1 active:scale-95">
      <Sun className={`size-4 transition-all duration-500 ${isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100 group-hover:rotate-45'}`} />
      <Moon className={`absolute inset-0 m-auto size-4 transition-all duration-500 ${isDark ? 'rotate-0 scale-100 opacity-100 group-hover:-rotate-12' : '-rotate-90 scale-0 opacity-0'}`} />
    </button>
  )
}

/** The tailnet as this machine's Tailscale sees it: each device, online or not, and which ones run Concierge. */
function Tailnet() {
  type Dev = { name: string; dns?: string; os?: string; online: boolean; tagged: boolean; ip?: string; lastSeen?: string; self: boolean }
  const [v, setV] = useState<{ available: boolean; tailnet?: string; devices?: Dev[] }>()
  const [beats, setBeats] = useState<string[]>([])
  useEffect(() => { api('/tailnet').then(setV, () => setV({ available: false })); api('/infra').then((x: InfraView) => setBeats(x.beats.map((b) => b.name.toLowerCase())), () => {}) }, [])
  if (!v) return null
  if (!v.available) return (
    <Group title="Tailnet" hint="Devices on your Tailscale network.">
      <Row icon={Network} title="Tailscale isn't reachable from here" hint="Concierge reads the tailnet with the tailscale command on the machine it runs on. Install Tailscale there to see your devices." />
    </Group>
  )
  const runs = (d: Dev) => beats.some((b) => d.name.toLowerCase().includes(b) || b.includes(d.name.toLowerCase()))
  const devices = [...(v.devices ?? [])].sort((a, b) => Number(runs(b)) - Number(runs(a)) || Number(b.online) - Number(a.online))
  return (
    <Group title={`Tailnet${v.tailnet ? ` · ${v.tailnet}` : ''}`} hint="Devices on your Tailscale network, as this machine sees them. The ones running Concierge come first.">
      {devices.map((d) => (
        <Row key={d.name + d.ip} icon={Server} title={`${d.name}${d.self ? ' (this one)' : ''}`}
             hint={[d.online ? 'online' : `offline${d.lastSeen && !d.lastSeen.startsWith('0001') ? `, last seen ${ago(d.lastSeen)}` : ''}`, d.os, d.ip, d.tagged ? 'tagged device' : ''].filter(Boolean).join(' · ')}>
          {runs(d) && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-semibold text-accent-text">Concierge</span>}
          <span className={`size-2 rounded-full ${d.online ? 'bg-ok' : 'bg-fg-4'}`} aria-label={d.online ? 'online' : 'offline'} />
        </Row>
      ))}
    </Group>
  )
}

/**
 * What runs when: one line per workflow, from what starts it to what comes out, each step a link to where it is set.
 * Read from the live settings, so it is also the quickest way to check a change did what you meant.
 */
// which flows each role sees: its own work, and Ship or Revise only once the role sets its own command for them
const SHOWN: Record<Role, (name: string, own: Partial<Record<string, string>>) => boolean> = {
  developer: (n) => !['Plan a project', 'Read the domain', 'Read the experience'].includes(n),
  product: (n, own) => ['Plan a project', 'Read the domain', 'Talk about it'].includes(n) || (n === 'Ship a ticket' && !!own.exec),
  design: (n, own) => ['Review someone’s PR', 'Read the experience', 'Talk about it'].includes(n) || (n === 'Revise your PR' && !!own.revise),
}
/**
 * How it works, per role: what starts each flow, what it runs (that role's slot, else the developer's), on which
 * account, and what comes of it. One tab per role you joined; it opens on the one you work as.
 */
function HowItWorks({ setup, health, go }: { setup?: SetupView; health?: Health; go: (t: SettingsTab) => void }) {
  const [routing, setRouting] = useState<ProvidersView['routing']>([])
  useEffect(() => { api('/providers').then((v: ProvidersView) => setRouting(v.routing), () => {}) }, [])
  const roles = useApi<RolesView>('/roles')
  const working = useRole()
  const [shown, setShown] = useState<Role>(working)
  if (!setup) return <Skeleton rows={4} />
  const joined = roles.data?.joined ?? ['developer' as Role]
  const role = joined.includes(shown) ? shown : joined[0]
  const own = roles.data?.setups[role]?.slots ?? {}
  const slot = (k: 'review' | 'revise' | 'exec' | 'plan', base: string) => (role !== 'developer' && own[k]) || base
  const owned = Object.values(roles.data?.owners ?? {}), mine = owned.filter((o) => o === role).length, shared = owned.filter((o) => o === 'shared').length
  const who = (w: string) => routing.find((r) => r.work === w)?.label ?? '…'
  type Step = { k: string; v: string; at: SettingsTab; mono?: boolean; tip: string }
  const flows: { name: string; icon: LucideIcon; on: boolean; steps: Step[] }[] = [
    { name: 'Review someone’s PR', icon: GitPullRequestArrow, on: setup.config.workspaces.includes('review'), steps: [
      { k: 'When', v: health?.autoStart ? 'your review is requested' : 'you press Run review', at: 'workflows', tip: 'Auto-review starts it as soon as your review is requested; off, it waits for you.' },
      { k: 'Runs', v: slot('review', setup.config.review) || 'no command', at: role === 'developer' ? 'workflows' : 'roles', mono: true, tip: 'The slash command the agent runs. {number} becomes the PR number.' },
      { k: 'On', v: who('review'), at: 'accounts', tip: 'The account that takes reviews; when it is limited the next in the fallback order does.' },
      { k: 'Then', v: 'findings in crit; you post them, or approve, as the skill proposes', at: 'workflows', tip: 'Nothing reaches GitHub until you pick in the Next panel.' },
    ] },
    { name: 'Revise your PR', icon: Wand, on: setup.config.workspaces.includes('review'), steps: [
      { k: 'When', v: 'you press Revise, after new feedback', at: 'workflows', tip: 'Your own PR got review threads; Revise brings them into crit.' },
      { k: 'Runs', v: slot('revise', setup.config.revise) || 'no command', at: role === 'developer' ? 'workflows' : 'roles', mono: true, tip: '{repo} and {number} are filled in.' },
      { k: 'On', v: who('revise'), at: 'accounts', tip: 'The account that works on your PRs.' },
      { k: 'Then', v: 'threads in crit, fixes drafted; Push & reply publishes', at: 'workflows', tip: 'It never pushes or replies before you press Push & reply.' },
    ] },
    { name: 'Ship a ticket', icon: Rocket, on: setup.config.workspaces.includes('exec'), steps: [
      { k: 'When', v: 'you press Run on a ticket', at: 'workflows', tip: 'Pick several to have them stacked in the order picked.' },
      { k: 'Runs', v: slot('exec', setup.config.exec?.command ?? '') || 'no command', at: role === 'developer' ? 'workflows' : 'roles', mono: true, tip: '{ids} becomes the picked tickets. Always unattended; questions go to Linear and show as Needs you.' },
      { k: 'On', v: who('exec'), at: 'accounts', tip: 'The account that ships tickets.' },
      { k: 'Then', v: 'a branch, a commit and a PR per ticket, stacked', at: 'workflows', tip: 'In its own worktree, with the tools allowed in Ship settings.' },
    ] },
    { name: 'Talk about it', icon: Workflow, on: true, steps: [
      { k: 'When', v: 'you write in the box under a PR or a ticket', at: 'workflows', tip: 'One box for everything: it reads where your words go as you type, and Tab picks another.' },
      { k: 'Goes to', v: 'Build: the agent · Intent or Understanding: read-only', at: 'workflows', tip: 'An instruction goes to the coding agent; scope and decisions to Intent; questions to Understanding. Anything unclear goes to Understanding, which changes nothing.' },
      { k: 'On', v: `${who('review')} (Sonnet for the discussions)`, at: 'accounts', tip: 'The discussions run on the review account, with the smaller model: many short turns.' },
      { k: 'Then', v: 'one conversation, each turn in its lane’s colour; a decision record for Intent', at: 'workflows', tip: 'A discussion’s steer for the agent is yours to send.' },
    ] },
    { name: 'Explain, next steps, standup', icon: Sparkles, on: role === 'developer', steps: [
      { k: 'When', v: 'after a review or a push, and when you open Standup', at: 'workflows', tip: 'Explanations follow new commits; the small calls run when a run ends.' },
      { k: 'Runs', v: 'built in', at: 'workflows', tip: 'Concierge’s own prompts, no skill needed.' },
      { k: 'On', v: who('small'), at: 'accounts', tip: 'Quick calls use the small model of this account.' },
      { k: 'Then', v: 'the Explain tab, the Next panel, your standup', at: 'spend', tip: 'Explanations have their own budget under Spend.' },
    ] },
    { name: 'Plan a project', icon: Layers, on: role === 'product', steps: [
      { k: 'When', v: 'you write a brief, or pick a Linear project, in Plans', at: 'roles', tip: 'A new project, or one that exists: its vision, tickets and timeline come in.' },
      { k: 'Runs', v: slot('plan', roles.data?.base.plan ?? '…'), at: 'workflows', mono: true, tip: 'The planning skill: the one in Settings → Workflows → What each feature runs, or another picked per plan.' },
      { k: 'On', v: `${who('review')} (Sonnet)`, at: 'accounts', tip: 'The planner streams its reply; each change to the map lands as it writes.' },
      { k: 'Then', v: 'a live map you edit; Create in Linear when you say so. Not its lead: tickets only', at: 'roles', tip: 'If you lead the project, the agent may propose a new vision, applied only when you accept it.' },
    ] },
    { name: role === 'design' ? 'Read the experience' : 'Read the domain', icon: Palette, on: role !== 'developer', steps: [
      { k: 'When', v: 'you open a PR or a ticket', at: 'roles', tip: role === 'design' ? 'The Experience tab: the journey and the screens first.' : 'The Domain tab, first in the panel.' },
      { k: 'Runs', v: 'built in', at: 'roles', tip: 'From what is already known: the explanation, the description, the tickets. Nothing technical.' },
      { k: 'On', v: `${who('small')} (Sonnet)`, at: 'accounts', tip: 'One short call per change, kept until the next push.' },
      { k: 'Then', v: role === 'design' ? 'the journey, the screens and their states, the words' : 'a context map, the journey, rules, events, the words', at: 'roles', tip: 'Drawn the way domain-driven design does: event-storming notes.' },
    ] },
  ]
  return (
    <div className="space-y-3">
      {joined.length > 1 && (
        <div role="tablist" aria-label="Role" className="inline-flex rounded-xl bg-hover p-1">
          {joined.map((r) => { const R = ROLES[r]; return <button key={r} role="tab" aria-selected={r === role} onClick={() => setShown(r)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-small font-medium ${r === role ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}><R.icon className="size-3.5" />{R.label}{r === working && <span className="text-micro text-fg-4">· now</span>}</button> })}
        </div>
      )}
      <p className="text-small text-fg-2">
        As <b className="font-semibold text-fg-1">{ROLES[role].label}</b>: the views {ROLES[role].rail.join(', ')}; {mine} skill{mine === 1 ? '' : 's'} of its own and {shared} shared.
        {role !== 'developer' && !Object.keys(own).length && <> It runs the developer’s commands until you give it its own <button onClick={() => go('roles')} className="text-accent-text hover:underline">under Roles</button>.</>}
      </p>
      {flows.filter((f) => f.on && SHOWN[role](f.name, own)).map((f) => (
        <section key={f.name} className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold"><f.icon className="size-4 text-accent-text" />{f.name}</h3>
          <ol className="grid gap-2 md:grid-cols-[repeat(4,minmax(0,1fr))]">
            {f.steps.map((x, i) => (
              <li key={x.k} className="relative">
                <button onClick={() => go(x.at)} title={x.tip} className="group h-full w-full rounded-lg bg-hover px-3 py-2 text-left transition-colors hover:bg-active">
                  <span className="block labelr text-fg-4">{x.k}</span>
                  <span className={`mt-0.5 block text-small leading-snug text-fg-1 ${x.mono ? 'break-all font-mono' : ''}`}>{x.v}</span>
                </button>
                {i < f.steps.length - 1 && <ArrowRight aria-hidden className="absolute -right-2 top-1/2 z-10 hidden size-3 -translate-y-1/2 text-fg-4 md:block" />}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="text-small text-fg-3">Each step opens where it is set; hover one for what it means.</p>
    </div>
  )
}

export { guessSkill } from '../skillGuess.ts'
export type FoundSkill = { name: string; invoke: string; description?: string; argumentHint?: string; source: string; kind: 'skill' | 'command'; command: string; args: { word: string; token?: string }[] }
const skillCache = new Map<string, Promise<FoundSkill[]>>()
/** Read the skills again on the next ask: a skill source was added or taken off. */
export const forgetSkills = () => skillCache.clear()
export const skillsFor = (work: string) => { if (!skillCache.has(work)) skillCache.set(work, api(`/skills?work=${work}`).catch(() => [])); return skillCache.get(work)! }
// what each placeholder becomes in the preview
const SAMPLE: Record<string, string> = { '{number}': '4649', '{repo}': 'acme/api', '{ids}': 'ENG-1435 ENG-1221', '{stack}': '12' }
const TOKENS: Record<string, string[]> = { review: ['{number}', '{repo}'], revise: ['{repo}', '{number}'], stack: ['{stack}', '{number}'], exec: ['{ids}'] }

/**
 * One card per workflow: what starts it, the skill it runs (picked from every skill on this setup, or typed), the inputs
 * that skill takes (from its argument-hint) and what fills them, the exact command it will run, and on which account.
 */
function WorkflowCards({ setup, health, save, saveConfig, go }: { setup?: SetupView; health?: Health; save: Save; saveConfig: SaveConfig; go: (t: SettingsTab) => void }) {
  const [routing, setRouting] = useState<ProvidersView['routing']>([])
  useEffect(() => { api('/providers').then((v: ProvidersView) => setRouting(v.routing), () => {}) }, [])
  if (!setup) return <Skeleton rows={4} />
  const who = (w: string) => routing.find((r) => r.work === w)?.label
  const uses = (w: 'review' | 'exec') => setup.config.workspaces.includes(w)
  const cards: { work: string; title: string; icon: LucideIcon; value: string; trigger: ReactNode; account?: string; onSave: (v: string) => void; optional?: boolean }[] = [
    ...(uses('review') ? [
      { work: 'review', title: 'Review someone’s PR', icon: GitPullRequestArrow, value: setup.config.review, account: who('review'),
        trigger: <span className="inline-flex items-center gap-2">{health?.autoStart ? 'As soon as your review is requested' : 'When you press Run review'}
          <Toggle label="Auto-review" on={!!health?.autoStart} onChange={(on) => save('/auto-start', { on }, on ? 'Auto-review on' : 'Auto-review off').catch(() => {})} /><span className="text-fg-4">auto</span></span>,
        onSave: (v: string) => saveConfig({ review: v }, 'Review command saved') },
      { work: 'revise', title: 'Revise your PR', icon: Wand, value: setup.config.revise, account: who('revise'), trigger: 'When you press Revise on your PR, after new feedback',
        onSave: (v: string) => saveConfig({ revise: v }, 'Revise command saved') },
      { work: 'stack', title: 'Work a whole stack', icon: Layers, value: setup.config.stack, optional: true, trigger: 'From Tools on a stack; opens in your terminal',
        onSave: (v: string) => saveConfig({ stack: v }, 'Stack command saved') },
    ] : []),
    ...(uses('exec') && setup.config.exec ? [
      { work: 'exec', title: 'Ship a ticket', icon: Rocket, value: setup.config.exec.command, account: who('exec'), trigger: 'When you press Run on tickets; several are stacked in the order picked',
        onSave: (v: string) => saveConfig({ exec: { ...setup.config.exec, command: v } }, 'Ship command saved') },
    ] : []),
  ]
  return (
    <div className="space-y-3">
      {cards.map((c) => <WorkflowCard key={c.work} {...c} go={go} />)}
    </div>
  )
}

/**
 * One kind of work: when it runs, the skill it runs (its command, found or not on this setup), what that comes to with
 * a real PR, and the account it runs on. Change opens, in place, the skills on this setup to pick from (a click saves)
 * and the command to adjust, with the placeholders it fills in.
 */
export function WorkflowCard({ work, title, icon: Icon, value, trigger, account, onSave, optional, go, inherited, suggested }: {
  work: string; title: string; icon: LucideIcon; value: string; trigger: ReactNode; account?: string; onSave: (v: string) => void; optional?: boolean; go?: (t: SettingsTab) => void
  inherited?: string // what runs when it has none of its own (a role's slot: the developer's)
  suggested?: string // a skill on this machine that looks like the one for this work: offered while it has none
}) {
  const [text, setText] = useState(value)
  const [all, setAll] = useState<FoundSkill[]>()
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => setText(value), [value])
  useEffect(() => { void skillsFor(work).then(setAll) }, [work])
  const head = (s: string) => s.trim().split(/\s+/)[0] ?? ''
  const skill = all?.find((x) => x.invoke === head(value))
  const shown = (all ?? []).filter((x) => !q || x.invoke.toLowerCase().includes(q.toLowerCase()) || x.description?.toLowerCase().includes(q.toLowerCase())).slice(0, 40)
  const preview = (t: string) => Object.entries(SAMPLE).reduce((r, [k, v]) => r.split(k).join(v), t)
  const close = () => { setEditing(false); setQ(''); setText(value) }
  const pick = (cmd: string) => { onSave(cmd); setEditing(false); setQ('') }
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-ctl bg-accent-soft text-accent-text"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-2"><h3 className="text-body font-semibold text-fg-1">{title}</h3>{optional && <span className="text-meta text-fg-4">optional</span>}</div>
          <div className="text-meta text-fg-3">{trigger}</div>
        </div>
        {!editing && <button onClick={() => setEditing(true)} className={quiet}>Change</button>}
      </div>
      {/* what it runs, in one line, and on which account */}
      {!editing && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-fill/40 px-4 py-2.5 text-meta">
          {value ? <>
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-1 px-2 py-1 font-mono text-small text-fg-1 shadow-e1">
              <span className={`size-1.5 shrink-0 rounded-full ${!all ? 'bg-fg-4' : skill ? 'bg-ok' : 'bg-wait'}`} title={!all ? 'Checking' : skill ? `Found: ${skill.source}` : 'Not found on this setup: it runs as typed'} />
              <span className="truncate">{value}</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-fg-3" title={skill?.description}>{skill?.description ?? (all ? 'Not found on this setup: it runs as typed' : '')}</span>
          </> : inherited ? <span className="min-w-0 truncate text-fg-3">Uses the developer’s: <span className="font-mono text-fg-2">{inherited}</span></span>
            : suggested ? <span className="inline-flex min-w-0 items-center gap-2 text-fg-3">Not set. Found <span className="truncate font-mono text-fg-1">{suggested}</span> on this machine
                <button onClick={() => onSave(suggested)} className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-text hover:bg-accent/20">Use it</button></span>
            : <span className="text-fg-3">{optional ? 'Not set: the action is hidden' : 'Not set'}</span>}
          {account && go && <button onClick={() => go('accounts')} className="shrink-0 rounded-full bg-surface-1 px-2 py-0.5 text-fg-2 shadow-e1 hover:text-accent-text" title="Which account runs it: Accounts">on {account}</button>}
        </div>
      )}
      {editing && (
        <div className="space-y-3 border-t border-line px-4 py-3.5">
          <div>
            <p className="label mb-1.5 text-fg-4">Command</p>
            <div className="flex items-center gap-2">
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() !== value) pick(text.trim()); if (e.key === 'Escape') { e.stopPropagation(); close() } }}
                     placeholder={optional ? 'none' : '/a-skill {number}'} spellCheck={false} aria-label={`${title}: command`} className={`${input} min-w-0 flex-1 font-mono`} />
              <button onClick={() => pick(text.trim())} disabled={text.trim() === value || (!optional && !text.trim())} className={primary}><Check className="size-3.5" />Save</button>
              {inherited && value && <button onClick={() => pick('')} className={quiet} title="Use the developer’s again">Reset</button>}
              <button onClick={close} className={quiet}>Cancel</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-meta text-fg-3">
              <span>Fills in</span>
              {(TOKENS[work] ?? []).map((t) => <button key={t} onClick={() => setText((x) => `${x.trimEnd()} ${t}`)} title={`Add ${t} (e.g. ${SAMPLE[t]})`} className="rounded-md bg-fill px-1.5 py-0.5 font-mono text-fg-2 hover:bg-fill-strong hover:text-fg-1">{t}</button>)}
              {text.trim() && <span className="ml-auto truncate font-mono text-fg-4" title={preview(text)}>runs {preview(text)}</span>}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <p className="label text-fg-4">Or pick a skill on this setup</p>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-fill px-2 py-1"><Search className="size-3.5 text-fg-4" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter skills" className="w-32 bg-transparent text-small outline-none placeholder:text-fg-4" /></span>
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {!all && <li className="px-2 py-1.5 text-small text-fg-3">Reading the skills on this setup…</li>}
              {shown.map((x) => (
                <li key={x.invoke}>
                  <button onClick={() => pick(x.command)} className={`flex w-full items-start gap-3 rounded-ctl px-2.5 py-1.5 text-left transition-colors ${x.invoke === head(value) ? 'sel' : 'hover:bg-hover'}`}>
                    <span className="shrink-0 font-mono text-small text-fg-1">{x.invoke}</span>
                    <span className="min-w-0 flex-1 truncate text-meta text-fg-3">{x.description}</span>
                    <span className="shrink-0 text-micro text-fg-4">{x.source}</span>
                  </button>
                </li>
              ))}
              {all && !shown.length && <li className="px-2 py-1.5 text-small text-fg-3">No skill matches.</li>}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * The roles you work as. Each one is a setup of its own: its workspaces, its skills, and its slots (what it runs to
 * review, revise, execute and plan). A slot left empty runs the developer's (Workflows), so one skill can serve every
 * role while another differs: Execute can be a product skill for Product and yours for Developer.
 */
const SLOTS = [
  ['review', 'Review', 'Reviewing someone else\'s PR', '{number}'], ['revise', 'Revise', 'Working through feedback on yours', '{number}'],
  ['exec', 'Execute', 'Shipping a ticket (must include {ids})', '{ids}'], ['plan', 'Plan', 'Breaking a brief down in Plans: a skill\'s name', ''],
] as const
function RolesSettings() {
  const q = useApi<RolesView>('/roles')
  const v = q.data
  const [err, setErr] = useState<string>()
  const post = (body: object) => { setErr(undefined); return api('/roles', body).then(() => refresh('/roles'), (e: Error) => setErr(e.message)) }
  if (!v) return <Skeleton />
  return (
    <>
      <Group title="Your roles" hint="Join the roles you work as; the switch at the top of the rail moves between them. Each keeps its own views and skills.">
        {(Object.keys(ROLES) as Role[]).map((r) => {
          const x = ROLES[r], on = v.joined.includes(r)
          return (
            <Row key={r} icon={x.icon} title={x.label} hint={x.pending ? `${x.hint}. Not available yet.` : `${x.hint}. Views: ${x.rail.join(', ')}`}>
              {x.pending ? <span className="rounded-full bg-fill px-2 py-0.5 text-meta font-medium text-fg-3">Coming soon</span>
              : on ? <span className="flex items-center gap-1.5">
                      {v.joined[0] === r && <span className="text-meta text-fg-3">signed up as</span>}
                      {v.joined.length > 1 && <button onClick={() => post({ joined: v.joined.filter((y) => y !== r) })} className={quiet}>Leave</button>}
                    </span>
                  : <button onClick={() => post({ joined: [...v.joined, r] }).then(() => setRole(r))} className={`${quiet} !text-accent-text`}>Join</button>}
            </Row>
          )
        })}
        {err && <p role="alert" className="mx-3.5 mb-3 rounded-lg bg-fail/10 px-3 py-2 text-small text-fail">{err}</p>}
      </Group>
      {v.joined.filter((r) => r !== 'developer' && !ROLES[r].pending).map((r) => <RoleSlots key={r} role={r} v={v} onSaved={(x) => remember('/roles', { ...v, ...x })} />)}
    </>
  )
}
function RoleSlots({ role, v, onSaved }: { role: Role; v: RolesView; onSaved: (x: Partial<RolesView>) => void }) {
  const own = v.setups[role]?.slots ?? {}
  const [err, setErr] = useState<string>()
  const save = (k: string, cmd: string) => { setErr(undefined); api('/roles', { role, setup: { slots: { ...Object.fromEntries(SLOTS.map(([x]) => [x, own[x as keyof typeof own] ?? ''])), [k]: cmd } } }).then((x: RolesView) => onSaved(x), (e: Error) => setErr(e.message)) }
  const ICONS: Record<string, LucideIcon> = { review: GitPullRequestArrow, revise: Wand, exec: Rocket, plan: Workflow }
  return (
    <section className="space-y-2">
      <header className="px-0.5"><h3 className="text-small font-semibold text-fg-1">{ROLES[role].label}: what it runs</h3><p className="text-meta text-fg-3">Runs you start while working as this role use these; one left alone uses the developer’s.</p></header>
      {err && <p role="alert" className="rounded-ctl bg-fail/10 px-3 py-2 text-small text-fail-text">{err}</p>}
      <div className="space-y-3">
        {SLOTS.map(([k, label, hint]) => (
          <WorkflowCard key={k} work={k} title={label} icon={ICONS[k]} trigger={hint} value={own[k as keyof typeof own] ?? ''} inherited={v.base[k as keyof typeof v.base] || undefined} onSave={(cmd) => save(k, cmd)} />
        ))}
      </div>
    </section>
  )
}

// each kind of work an account can run, what it inherits when nothing is picked, and whether the kind takes it
const MODEL_KINDS: { slot: 'large' | 'planner' | 'reading' | 'small'; label: string; hint: string; inherit: string; claudeOnly?: boolean }[] = [
  { slot: 'large', label: 'Agents', hint: 'Reviews, revisions, Ship runs, explanations: most of the tokens', inherit: 'its default' },
  { slot: 'planner', label: 'Plans', hint: 'Breaking a brief down into a project', inherit: 'Opus', claudeOnly: true },
  { slot: 'reading', label: 'Deeper reads', hint: 'The stack’s check and answer, the business lens, discussions, skill reviews', inherit: 'Sonnet', claudeOnly: true },
  { slot: 'small', label: 'Quick calls', hint: 'Next steps, turns, briefs, the standup, the stack tour', inherit: 'its default' },
]
/**
 * An account's Models, folded: each kind of work inherits until you pick one of the models this account offers (read
 * from the tool where it can list them). Nothing is assumed about which tool the account is.
 */
function AccountModels({ a, set }: { a: AccountView; set: (b: object, m: string) => void }) {
  const [open, setOpen] = useState(false)
  const q = useApi<{ models: { id: string; label: string }[]; picked: Record<string, string> }>(open ? `/accounts/${encodeURIComponent(a.id)}/models` : undefined)
  const picked = q.data?.picked ?? {}
  const kinds = MODEL_KINDS.filter((k) => !k.claudeOnly || a.kind === 'claude')
  const pick = (slot: string, label: string, m: string, name: string) => {
    set({ models: { [a.id]: { [slot]: m } } }, `${a.label} · ${label}: ${m ? name : 'inherits'}`)
    void q.refetch()
  }
  const shown = Object.values(picked).filter(Boolean).length
  return (
    <details className="group/am mt-2" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-meta font-medium text-fg-3 hover:text-fg-1">
        <ChevronRight className="size-3.5 transition-transform group-open/am:rotate-90" />Models<span className="font-normal text-fg-4">{shown ? `· ${shown} picked` : '· all inherited'}</span>
      </summary>
      {open && (!q.data ? <p className="mt-2 text-meta text-fg-3">{q.isError ? 'Couldn’t read the models this account offers: everything inherits.' : 'Reading the models this account offers…'}</p> : (
        <div className="mt-2 space-y-2">
          {kinds.map((k) => {
            const cur = picked[k.slot] ?? ''
            const list = q.data!.models.some((m) => m.id === cur) || !cur ? q.data!.models : [...q.data!.models, { id: cur, label: cur }]
            return (
              <div key={k.slot}>
                <p className="text-meta text-fg-2" title={k.hint}>{k.label}</p>
                <Pick className="mt-1" label={`${a.label}: ${k.label}`} value={cur} options={[{ id: '', label: `Inherit (${k.inherit})` }, ...list].map((m) => ({ value: m.id, label: m.label }))}
                      onChange={(id) => { const m = [{ id: '', label: `Inherit (${k.inherit})` }, ...list].find((x) => x.id === id)!; if (cur !== id) pick(k.slot, k.label, id, m.label) }} />
              </div>
            )
          })}
          {!q.data.models.length && <p className="text-meta text-fg-4">This account can’t list its models right now: everything inherits.</p>}
        </div>
      ))}
    </details>
  )
}
