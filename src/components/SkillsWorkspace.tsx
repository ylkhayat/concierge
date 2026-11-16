// The Skills workspace: your skills and the company's, how much each is used and how well it works, what is trending,
// and what to change, always weighing the goal against the cost (its runs, and the tokens it takes to load). Read from
// /skills/view (server/skills.ts); changes are proposed by a model on demand, and nothing changes until you act.
import { ArrowDownRight, ArrowUpRight, Copy, LoaderCircle, Minus, Sparkles, Trash2, Wand, Workflow } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Advice, Installed, SkillRow, Source, Verdict } from '../../server/skills.ts'
import { api } from '../lib.ts'
import { refresh, useApi } from '../query.ts'
import { ROLES, useRole, type Role, type RolesView } from '../role.ts'
type Owner = Role | 'shared'

type Row = SkillRow & { before: number; source: Source; tokens?: number; mode?: string }
type View = { days: number; runs: number; withSkill: number; skills: Row[]; installed: Installed[]; perDay: Record<string, number>; advice: Advice[] }
type Improve = import('../../server/skills.ts').Improvement
type Suggest = { suggestions: (Advice & { change: string })[]; costUsd: number; from: number; at: string; days: number }
/** A proposal as the server keeps it: the last one written, whether one is being written now, and why the last try failed. */
type Kept<T> = { result?: T; busy: boolean; error?: string }
const ago = (at: string) => { const m = Math.round((Date.now() - Date.parse(at)) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
type Toast = (m: string, tone?: 'ok' | 'error') => void
type Scope = 'all' | 'mine' | 'company' | 'others'
type Sort = 'used' | 'trending' | 'work' | 'tokens'

const SOURCE: Record<Source, string> = { mine: 'Yours', company: 'Company', source: 'Skill source', plugin: 'Plugin' }
const VERDICT: Record<Verdict, { label: string; dot: string; text: string; soft: string }> = {
  good: { label: 'Healthy', dot: 'bg-ok', text: 'text-ok-text', soft: 'bg-ok/12' },
  watch: { label: 'Watch', dot: 'bg-wait', text: 'text-wait-text', soft: 'bg-wait/14' },
  fix: { label: 'Needs work', dot: 'bg-fail', text: 'text-fail-text', soft: 'bg-fail/12' },
  few: { label: 'Too few runs', dot: 'bg-fg-4', text: 'text-fg-3', soft: 'bg-hover' },
}
const ADVICE: Record<Advice['kind'], { label: string; cls: string }> = { new: { label: 'New', cls: 'bg-accent-soft text-accent-text' }, modify: { label: 'Change', cls: 'bg-wait/14 text-wait-text' }, remove: { label: 'Remove', cls: 'bg-hover text-fg-2' } }
/** Runs in the period's first half and its second: the trend, from inside the period itself. */
const halves = (perDay: Record<string, number>, days: number): [number, number] => {
  const mid = new Date(Date.now() - (days / 2) * 86400_000).toISOString().slice(0, 10)
  let early = 0, late = 0
  for (const [d, n] of Object.entries(perDay)) if (d < mid) early += n; else late += n
  return [early, late]
}
const tok = (n?: number) => (n == null ? '–' : n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const pct = (x: number) => (x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`)
const dayList = (days: number) => { const n = Math.min(days, 90); return Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400_000).toISOString().slice(0, 10)) }
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
// a skill with no runs in the period: still listed, so the unused show up
const idle = (i: Installed): Row => ({ name: i.name, source: i.source, tokens: i.tokens, mode: i.mode, before: 0, runs: 0, done: 0, failed: 0, cancelled: 0, costUsd: 0, turns: 0, steers: 0, refusedRuns: 0, followed: 0, lastAt: '', kinds: {}, score: 0, verdict: 'few', reasons: [], recent: [], perDay: {} })
/** The four parts of a skill's score, as server/skills.ts weighs them. */
const parts = (r: Row) => {
  const judged = r.runs - r.cancelled
  return [
    { label: 'Finished', weight: 40, v: judged ? r.done / judged : 1, note: `${r.done} of ${judged}` },
    { label: 'Right the first time', weight: 25, v: r.runs ? 1 - r.followed / r.runs : 1, note: `${r.followed} run again` },
    { label: 'Little of your help', weight: 20, v: r.runs ? 1 - Math.min(1, r.steers / r.runs / 2) : 1, note: `${r.runs ? (r.steers / r.runs).toFixed(1) : 0} messages a run` },
    { label: 'No tool refused', weight: 15, v: r.runs ? 1 - r.refusedRuns / r.runs : 1, note: `${r.refusedRuns} refused` },
  ]
}

/** A chart's real width, so its text and marks are drawn at their true size instead of scaled with the box. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function Trend({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="text-meta text-fg-4">–</span>
  const d = before ? Math.round(((now - before) / before) * 100) : 100
  const Icon = d > 5 ? ArrowUpRight : d < -5 ? ArrowDownRight : Minus
  return <span className={`inline-flex items-center gap-0.5 text-meta tabular-nums ${d > 5 ? 'text-ok-text' : d < -5 ? 'text-fail-text' : 'text-fg-3'}`}><Icon className="size-3.5" />{before ? `${d > 0 ? '+' : ''}${d}%` : 'new'}</span>
}

/** A row's runs per day, as a line: the shape, not the values (those are in the row). */
function Spark({ perDay, days, w = 56, h = 16 }: { perDay: Record<string, number>; days: number; w?: number; h?: number }) {
  const ds = dayList(days), max = Math.max(1, ...ds.map((d) => perDay[d] ?? 0))
  const pts = ds.map((d, i) => `${(i / Math.max(1, ds.length - 1)) * w},${h - 1 - ((perDay[d] ?? 0) / max) * (h - 2)}`).join(' ')
  return <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={Object.keys(perDay).length ? 0.9 : 0.25} /></svg>
}

/** Runs per day: thin bars on a baseline, the busiest day as the scale, dates under it, the day's value on hover. */
function DayChart({ perDay, days, label }: { perDay: Record<string, number>; days: number; label: string }) {
  const ds = dayList(days), max = Math.max(1, ...ds.map((d) => perDay[d] ?? 0))
  const total = ds.reduce((n, d) => n + (perDay[d] ?? 0), 0)
  const [at, setAt] = useState<number>()
  const [ref, W] = useWidth()
  const H = 120, gap = 2, bw = Math.max(1, W / ds.length - gap)
  const shown = at != null ? ds[at] : undefined
  return (
    <figure className="card p-4">
      <figcaption className="mb-3 flex items-baseline gap-2">
        <span className="text-small font-medium text-fg-1">{label}</span>
        <span className="ml-auto text-meta tabular-nums text-fg-3">{shown ? <><b className="font-semibold text-fg-1">{perDay[shown] ?? 0}</b> on {shortDay(shown)}</> : <>{total} in all · busiest {max} a day</>}</span>
      </figcaption>
      <div ref={ref}>
      <svg width={W} height={H + 18} className="block overflow-visible" role="img" aria-label={`${label}: ${total} runs, at most ${max} a day`} onMouseLeave={() => setAt(undefined)}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" />
        <line x1="0" x2={W} y1="0.5" y2="0.5" stroke="var(--line)" strokeDasharray="2 4" />
        <text x={W} y="11" textAnchor="end" className="fill-fg-4 text-[10px] tabular-nums">{max} a day</text>
        {ds.map((d, i) => {
          const v = perDay[d] ?? 0, bh = (v / max) * (H - 4)
          return <g key={d} onMouseEnter={() => setAt(i)}>
            <rect x={i * (bw + gap)} y="0" width={bw + gap} height={H} fill="transparent" />
            {v > 0 && <rect x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx={Math.min(3, bw / 2)} fill="var(--accent)" opacity={at == null || at === i ? 1 : 0.45} />}
          </g>
        })}
        {[0, Math.floor(ds.length / 2), ds.length - 1].map((i) => <text key={i} x={i * (bw + gap) + bw / 2} y={H + 14} textAnchor={i === 0 ? 'start' : i === ds.length - 1 ? 'end' : 'middle'} className="fill-fg-4 text-[10px]">{shortDay(ds[i])}</text>)}
      </svg>
      </div>
    </figure>
  )
}

/** Usage against health: where each skill stands, so what to fix first jumps out (busy and struggling). */
function Matrix({ rows, onPick }: { rows: Row[]; onPick: (n: string) => void }) {
  const judged = rows.filter((r) => r.runs >= 3)
  const [hover, setHover] = useState<string>()
  const [ref, W] = useWidth()
  if (judged.length < 2) return null
  const H = 240, P = { l: 30, r: 16, t: 14, b: 26 }
  // the score scale fits the skills (a set that all score in the 90s would sit on one line of a 0-100 scale), the
  // healthy line at 80 always in view
  const lo = Math.max(0, Math.min(70, Math.floor((Math.min(...judged.map((r) => r.score)) - 5) / 10) * 10))
  const maxRuns = Math.max(...judged.map((r) => r.runs))
  const x = (runs: number) => P.l + (Math.log10(runs) / Math.log10(Math.max(10, maxRuns))) * (W - P.l - P.r)
  const y = (score: number) => P.t + (1 - (score - lo) / (100 - lo)) * (H - P.t - P.b)
  const busy = [...judged].sort((a, b) => a.runs - b.runs)[Math.floor(judged.length / 2)].runs // the median: busier than most to its right
  // direct labels for the busiest and the struggling, each kept only where it collides with none placed before it,
  // and on the left of its dot near the right edge
  const placed: { x: number; y: number; w: number }[] = []
  const labels = new Map<string, { x: number; anchor: 'start' | 'end' }>()
  for (const r of [...judged.filter((r) => r.verdict === 'fix'), ...[...judged].sort((a, b) => b.runs - a.runs)].slice(0, 8)) {
    if (labels.has(r.name)) continue
    const w = r.name.length * 6.2, cx = x(r.runs), cy = y(r.score), left = cx + 8 + w > W - P.r
    const lx = left ? cx - 8 - w : cx + 8
    if (placed.some((p) => Math.abs(p.y - cy) < 13 && lx < p.x + p.w && lx + w > p.x)) continue
    placed.push({ x: lx, y: cy, w }); labels.set(r.name, { x: left ? cx - 8 : cx + 8, anchor: left ? 'end' : 'start' })
  }
  const h = judged.find((r) => r.name === hover)
  const quad = (tx: number, ty: number, t: string, anchor: 'start' | 'end') => <text x={tx} y={ty} textAnchor={anchor} className="fill-fg-4 text-[9.5px] font-semibold uppercase tracking-[0.08em]">{t}</text>
  return (
    <figure className="card p-4">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-small font-medium text-fg-1">Usage and health</span>
        <span className="text-meta text-fg-3">Each skill with 3 runs or more: how often it runs, against how well</span>
        <span className="ml-auto flex items-center gap-3 text-meta text-fg-3">{(['good', 'watch', 'fix'] as const).map((v) => <span key={v} className="inline-flex items-center gap-1"><span className={`size-2 rounded-full ${VERDICT[v].dot}`} />{VERDICT[v].label}</span>)}</span>
      </figcaption>
      <div className="relative">
        <div ref={ref}>
        <svg width={W} height={H} className="block" role="img" aria-label="Skills by runs and score">
          <rect x={x(busy)} y={y(80)} width={W - P.r - x(busy)} height={y(lo) - y(80)} fill="var(--st-fail)" opacity="0.05" />
          <line x1={P.l} x2={W - P.r} y1={y(80)} y2={y(80)} stroke="var(--line-strong)" strokeDasharray="3 4" />
          <line x1={x(busy)} x2={x(busy)} y1={P.t} y2={H - P.b} stroke="var(--line-strong)" strokeDasharray="3 4" />
          <line x1={P.l} x2={W - P.r} y1={H - P.b + 0.5} y2={H - P.b + 0.5} stroke="var(--line)" />
          {[lo, 80, 100].map((v) => <text key={v} x={P.l - 6} y={y(v) + 3} textAnchor="end" className="fill-fg-4 text-[10px] tabular-nums">{v}</text>)}
          {[1, 10, 100, 1000].filter((v) => v <= Math.max(10, maxRuns)).map((v) => <text key={v} x={x(v)} y={H - 8} textAnchor="middle" className="fill-fg-4 text-[10px] tabular-nums">{v}</text>)}
          <text x={W - P.r} y={H - 8} textAnchor="end" className="fill-fg-4 text-[10px]">runs →</text>
          {quad(W - P.r - 4, P.t + 12, 'Carries the work', 'end')}
          {quad(W - P.r - 4, H - P.b - 6, 'Fix first', 'end')}
          {quad(P.l + 6, P.t + 12, 'Healthy, rarely used', 'start')}
          {quad(P.l + 6, H - P.b - 6, 'Rarely used, struggling', 'start')}
          {judged.map((r) => (
            <g key={r.name} className="cursor-pointer" onMouseEnter={() => setHover(r.name)} onMouseLeave={() => setHover(undefined)} onClick={() => onPick(r.name)}>
              <circle cx={x(r.runs)} cy={y(r.score)} r="12" fill="transparent" />
              <circle cx={x(r.runs)} cy={y(r.score)} r={hover === r.name ? 6 : 4.5} stroke="var(--surface-1)" strokeWidth="2"
                      fill={r.verdict === 'good' ? 'var(--st-ok)' : r.verdict === 'watch' ? 'var(--st-wait)' : 'var(--st-fail)'} />
              {labels.has(r.name) && hover !== r.name && <text x={labels.get(r.name)!.x} y={y(r.score) + 3} textAnchor={labels.get(r.name)!.anchor} className="pointer-events-none fill-fg-2 font-mono text-[10.5px]">{r.name}</text>}
            </g>
          ))}
        </svg>
        </div>
        {h && (
          <div className="pointer-events-none absolute z-10 w-56 rounded-xl bg-surface-2 px-3 py-2 text-meta shadow-e2 ring-1 ring-line"
               style={{ left: `${Math.min(70, (x(h.runs) / W) * 100)}%`, top: `${Math.max(0, (y(h.score) / H) * 100 - 6)}%`, transform: 'translate(12px, -100%)' }}>
            <div className="truncate font-mono text-small text-fg-1">{h.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-fg-2"><span className={`size-2 rounded-full ${VERDICT[h.verdict].dot}`} />{VERDICT[h.verdict].label} · score {h.score}</div>
            <div className="text-fg-3 tabular-nums">{h.runs} runs · {tok(h.tokens)} tokens a load</div>
            {h.reasons[0] && <div className="mt-1 text-fg-3">{h.reasons[0]}</div>}
          </div>
        )}
      </div>
    </figure>
  )
}

/** Where the tokens go: what loading each skill cost over its runs, the biggest first, as a share of all of it. */
function TokenShare({ rows, onPick }: { rows: Row[]; onPick: (n: string) => void }) {
  const by = rows.map((r) => ({ r, n: (r.tokens ?? 0) * r.runs })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
  const all = by.reduce((t, x) => t + x.n, 0)
  if (!all) return null
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline gap-2"><span className="whitespace-nowrap text-small font-medium text-fg-1">Where the tokens go</span><span className="ml-auto truncate text-meta tabular-nums text-fg-3">{tok(all)} in all</span></div>
      <ul className="space-y-1.5">
        {by.slice(0, 7).map(({ r, n }) => (
          <li key={r.name}><button onClick={() => onPick(r.name)} className="group grid w-full grid-cols-[minmax(0,8rem)_minmax(3rem,1fr)_2.75rem] items-center gap-3 text-left">
            <span className="truncate font-mono text-small text-fg-2 group-hover:text-fg-1">{r.name}</span>
            <span className="h-2 rounded-full bg-fill"><span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, (n / by[0].n) * 100)}%` }} /></span>
            <span className="text-right text-meta tabular-nums text-fg-3">{pct(n / all)}</span>
          </button></li>
        ))}
      </ul>
      {by.length > 7 && <p className="mt-2 text-meta text-fg-4">and {by.length - 7} more, {pct(by.slice(7).reduce((t, x) => t + x.n, 0) / all)} together</p>}
    </section>
  )
}

const Kpi = ({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
    <span className="label text-fg-4">{label}</span>
    <span className="text-display font-semibold tabular-nums tracking-tight text-fg-1">{value}</span>
    {sub && <span className="truncate text-meta text-fg-3">{sub}</span>}
    {children}
  </div>
)

// whose a skill is: the role you work as sees its own and the shared ones, and changes only those; another role's skills
// it can use, and read here under "Others"
const OWNER_LABEL = (o?: Owner) => (!o || o === 'shared' ? 'Shared' : ROLES[o].label)
export function SkillsWorkspace({ toast }: { toast: Toast }) {
  const role = useRole()
  const roles = useApi<RolesView>('/roles', { staleTime: 60_000 })
  const owner = (name: string): Owner => roles.data?.owners[name] ?? 'developer'
  const mineHere = (name: string) => { const o = owner(name); return o === 'shared' || o === role }
  const [days, setDays] = useState(30)
  // cached per period: the counting reads every run's log, so coming back shows the last answer while it refreshes
  const q = useApi<View>(`/skills/view?days=${days}`, { staleTime: 5 * 60_000, placeholderData: (prev) => prev })
  // the skills Concierge itself runs (Settings → What each feature runs): in use, though no agent run loads them
  const method = useApi<{ features: { label: string; skill: string }[] }>('/method', { staleTime: 5 * 60_000 })
  const feature = useMemo(() => new Map((method.data?.features ?? []).map((f) => [f.skill, f.label])), [method.data])
  const v = q.data
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<Sort>('used')
  const [sel, setSel] = useState<string>()
  const load = () => refresh('/skills/view')
  useEffect(() => { if (q.error) toast((q.error as Error).message, 'error') }, [q.error])

  const rows = useMemo(() => {
    if (!v) return []
    const used = new Map(v.skills.map((s) => [s.name, s]))
    const all = [...v.skills, ...v.installed.filter((i) => !used.has(i.name)).map(idle)]
    const scoped = all.filter((r) => (scope === 'others' ? !mineHere(r.name) : mineHere(r.name)) && (scope === 'all' || scope === 'others' || (scope === 'company' ? r.source === 'company' : r.source !== 'company')))
    const key: Record<Sort, (r: Row) => number> = { used: (r) => r.runs, trending: (r) => { const [a, b] = halves(r.perDay, days); return b - a }, work: (r) => (r.runs >= 3 ? 100 - r.score : -1), tokens: (r) => (r.tokens ?? 0) * Math.max(1, r.runs) }
    return scoped.sort((a, b) => key[sort](b) - key[sort](a) || a.name.localeCompare(b.name))
  }, [v, scope, sort, days, role, roles.data])
  const cur = rows.find((r) => r.name === sel)

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-full shrink-0 flex-col border-r border-line md:w-[360px]">
        <div className="space-y-2.5 px-4 pb-2 pt-4">
          <div className="flex items-center gap-2"><button onClick={() => setSel(undefined)} className="text-title font-semibold tracking-tight">Skills</button>
            <div role="radiogroup" aria-label="Period" className="ml-auto inline-flex rounded-ctl bg-fill p-0.5 text-small">
              {[7, 30, 90].map((d) => <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`rounded-lg px-2 py-0.5 font-medium transition-colors ${days === d ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{d}d</button>)}
            </div>
          </div>
          <div role="tablist" className="flex gap-0.5 rounded-ctl bg-hover p-[3px]">
            {(['all', 'mine', 'company', 'others'] as const).map((s) => <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} title={s === 'others' ? 'Other roles\' skills: you can use them, not change them' : undefined} className={`flex-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-small font-medium ${scope === s ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{s === 'all' ? ROLES[role].label : s === 'mine' ? 'Mine' : s === 'company' ? 'Company' : 'Others'}</button>)}
          </div>
          <div className="flex items-center gap-1 text-meta">
            <span className="text-fg-4">Sort</span>
            {([['used', 'Runs'], ['trending', 'Trend'], ['work', 'Needs work'], ['tokens', 'Tokens']] as const).map(([k, l]) => <button key={k} onClick={() => setSort(k)} className={`whitespace-nowrap rounded-md px-2 py-0.5 ${sort === k ? 'bg-accent-soft text-accent-text' : 'text-fg-3 hover:text-fg-1'}`}>{l}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_56px_2.5rem_2.25rem] gap-3 border-y border-line px-4 py-1.5 label text-fg-4"><span>Skill</span><span>{days}d</span><span className="text-right">Runs</span><span className="text-right">Score</span></div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          {!v ? <p className="flex items-center gap-2 p-4 text-small text-fg-3"><LoaderCircle className="size-4 animate-spin" />Reading the runs…</p> : rows.map((r) => (
            <button key={r.name} onClick={() => setSel(r.name)} title={`${SOURCE[r.source]}${r.tokens != null ? ` · ${tok(r.tokens)} tokens a load` : ''}${feature.has(r.name) ? ` · Concierge runs it: ${feature.get(r.name)}` : ''}`}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_56px_2.5rem_2.25rem] items-center gap-3 border-l-2 px-4 py-[7px] text-left transition-colors ${sel === r.name ? 'border-accent bg-accent-soft/50' : 'border-transparent hover:bg-hover/60'}`}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`truncate font-mono text-small ${r.runs || feature.has(r.name) ? 'text-fg-1' : 'text-fg-3'}`}>{r.name}</span>
                {feature.has(r.name) && <Workflow className="size-3 shrink-0 text-fg-4" aria-label={`Concierge runs it: ${feature.get(r.name)}`} />}
                {r.mode === 'off' && <span className="shrink-0 text-micro text-fg-4">off</span>}
              </span>
              <Spark perDay={r.perDay} days={days} />
              <span className={`text-right text-small tabular-nums ${r.runs ? 'text-fg-1' : 'text-fg-4'}`}>{r.runs || '–'}</span>
              <span className="flex items-center justify-end gap-1">{r.runs >= 3 ? <><span className={`size-1.5 rounded-full ${VERDICT[r.verdict].dot}`} /><span className="text-small tabular-nums text-fg-2">{r.score}</span></> : <span className="text-meta text-fg-4">–</span>}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[980px] space-y-4 p-4 sm:p-6">
          {!v ? null : cur ? <Detail key={cur.name} r={cur} days={days} toast={toast} owner={owner(cur.name)} role={role} feature={feature.get(cur.name)} onRemoved={() => { setSel(undefined); void load() }} /> : <Overview v={v} rows={rows} feature={feature} onPick={setSel} toast={toast} />}
        </div>
      </main>
    </div>
  )
}

/** Nothing picked: the totals, where each skill stands, what costs the most, what moves, and what to do. */
function Overview({ v, rows, feature, onPick, toast }: { v: View; rows: Row[]; feature: Map<string, string>; onPick: (n: string) => void; toast: Toast }) {
  const loaded = v.skills.reduce((n, s) => n + (s.tokens ?? 0) * s.runs, 0)
  const judged = v.skills.filter((s) => s.runs >= 3)
  const health = judged.reduce((t, s) => t + s.score * s.runs, 0) / Math.max(1, judged.reduce((t, s) => t + s.runs, 0))
  const half = (s: Row) => halves(s.perDay, v.days)
  const moving = [...v.skills].filter((s) => s.runs >= 3).sort((a, b) => (half(b)[1] - half(b)[0]) - (half(a)[1] - half(a)[0]))
  const unused = rows.filter((r) => !r.runs && !feature.has(r.name))
  const [showUnused, setShowUnused] = useState(false)
  // kept on the server: written in the background, there when you come back
  const kept = useApi<Kept<Suggest>>('/skills/advice', { refetchInterval: (q) => (q.state.data?.busy ? 3000 : false) })
  const ai = kept.data?.result, asking = !!kept.data?.busy
  useEffect(() => { if (kept.data?.error) toast(kept.data.error, 'error') }, [kept.data?.error])
  const suggest = () => api('/skills/suggest', { days: v.days }).then(() => refresh('/skills/advice'), (e: Error) => toast(e.message, 'error'))
  const advice = v.advice.filter((a) => a.kind !== 'remove' || a.skill) // the unused have their own row below
  const counts = (['good', 'watch', 'fix'] as const).map((k) => [k, judged.filter((s) => s.verdict === k).length] as const)
  return <>
    <div className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
      <Kpi label="Runs" value={v.runs} sub={`${v.days} days · ${v.runs ? pct(v.withSkill / v.runs) : '–'} loaded a skill`}><Spark perDay={v.perDay} days={v.days} w={120} h={20} /></Kpi>
      <Kpi label="Health" value={judged.length ? Math.round(health) : '–'} sub="score, weighted by runs">
        <span className="flex h-1.5 overflow-hidden rounded-full bg-fill">{counts.map(([k, n]) => n > 0 && <span key={k} className={`${VERDICT[k].dot} border-r-2 border-surface-1 last:border-r-0`} style={{ width: `${(n / judged.length) * 100}%` }} title={`${VERDICT[k].label}: ${n}`} />)}</span>
      </Kpi>
      <Kpi label="In use" value={<>{v.skills.length}<span className="text-title font-normal text-fg-4"> / {v.installed.length}</span></>} sub={`${unused.length} unused · ${feature.size} run by Concierge`} />
      <Kpi label="Tokens loading skills" value={tok(loaded)} sub="their files, on every run" />
    </div>
    <Matrix rows={v.skills} onPick={onPick} />
    <DayChart perDay={v.perDay} days={v.days} label="Runs with a skill, per day" />
    <div className="grid gap-4 lg:grid-cols-2">
      <TokenShare rows={v.skills} onPick={onPick} />
      {moving.length > 0 && (
        <section className="card p-4">
          <div className="mb-3 flex items-baseline gap-2"><span className="text-small font-medium text-fg-1">Moving</span><span className="ml-auto truncate text-meta text-fg-3">first half of the period → second</span></div>
          <ul className="space-y-1.5">
            {[...moving].sort((a, b) => Math.abs(half(b)[1] - half(b)[0]) - Math.abs(half(a)[1] - half(a)[0])).slice(0, 7).map((s) => (
              <li key={s.name}><button onClick={() => onPick(s.name)} className="group grid w-full grid-cols-[minmax(0,1fr)_56px_4.5rem_3.5rem] items-center gap-3 text-left text-small">
                <span className="truncate font-mono text-fg-2 group-hover:text-fg-1">{s.name}</span><Spark perDay={s.perDay} days={v.days} /><span className="text-right tabular-nums text-fg-3">{half(s)[0]} → {half(s)[1]}</span><span className="text-right"><Trend now={half(s)[1]} before={half(s)[0]} /></span>
              </button></li>
            ))}
          </ul>
        </section>
      )}
    </div>
    <section className="space-y-2">
      <h3 className="text-body font-semibold text-fg-1">What to do</h3>
      {advice.map((a, i) => (
        <div key={i} className="card flex items-start gap-3 p-4">
          <span className={`mt-px shrink-0 rounded-full px-2 py-px text-meta font-medium ${ADVICE[a.kind].cls}`}>{ADVICE[a.kind].label}</span>
          <div className="min-w-0 flex-1">
            {a.skill ? <button onClick={() => onPick(a.skill!)} className="text-body font-medium text-fg-1 hover:underline">{a.title}</button> : <span className="text-body font-medium text-fg-1">{a.title}</span>}
            <p className="mt-0.5 text-small text-fg-2">{a.why}</p>
          </div>
        </div>
      ))}
      {unused.length > 0 && (
        <div className="card p-4">
          <button onClick={() => setShowUnused((x) => !x)} className="flex w-full items-center gap-3 text-left">
            <span className={`shrink-0 rounded-full px-2 py-px text-meta font-medium ${ADVICE.remove.cls}`}>Unused</span>
            <span className="min-w-0 flex-1 text-body font-medium text-fg-1">{unused.length} skill{unused.length === 1 ? '' : 's'} no run loaded in {v.days} days</span>
            <span className="text-meta text-fg-3">{showUnused ? 'Hide' : 'Show'}</span>
          </button>
          {showUnused && <div className="mt-3 flex flex-wrap gap-1">{unused.map((r) => <button key={r.name} onClick={() => onPick(r.name)} className="rounded-md bg-hover px-1.5 py-0.5 font-mono text-meta text-fg-2 hover:text-fg-1">{r.name}</button>)}</div>}
        </div>
      )}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-body font-medium text-fg-1">Proposals from what you told the agents</p><p className="text-small text-fg-3">A small model reads your messages to the agents and the scores, and drafts new skills or changes. A few cents.</p></div>
          <button onClick={suggest} disabled={asking} className="inline-flex items-center gap-1.5 btn-primary disabled:opacity-60">{asking ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{asking ? 'Drafting… you can leave' : ai ? 'Draft again' : 'Draft proposals'}</button>
        </div>
        {ai && <div className="mt-3 space-y-3 border-t border-line pt-3">
          <p className="text-meta text-fg-4">Written {ago(ai.at)} over {ai.days} days · from {ai.from} of your messages · ${ai.costUsd.toFixed(3)}</p>
          {ai.suggestions.map((s, i) => <div key={i}><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-px text-meta font-medium ${ADVICE[s.kind].cls}`}>{ADVICE[s.kind].label}</span><span className="text-body font-medium text-fg-1">{s.title}</span></div><p className="mt-0.5 text-small text-fg-2">{s.why}</p><p className="mt-1 whitespace-pre-wrap rounded-lg bg-hover px-3 py-2 text-small text-fg-1">{s.change}</p></div>)}
        </div>}
      </div>
    </section>
  </>
}

/** One skill: its numbers against the period before, why it scores as it does, and what to change or cut. */
function Detail({ r, days, toast, onRemoved, owner, role, feature }: { r: Row; days: number; toast: Toast; onRemoved: () => void; owner: Owner; role: Role; feature?: string }) {
  // another role's skill: used as it is, changed only from that role
  const mine = owner === 'shared' || owner === role
  const own = (o: Owner) => api('/roles/skill', { name: r.name, owner: o }).then(() => { refresh('/roles'); toast(o === 'shared' ? 'Shared with every role' : `Now only ${ROLES[o].label}'s`) }, (e: Error) => toast(e.message, 'error'))
  // kept on the server: written in the background (a minute or two), there when you come back
  const kept = useApi<Kept<Improve>>(`/skills/advice?name=${encodeURIComponent(r.name)}`, { refetchInterval: (q) => (q.state.data?.busy ? 3000 : false) })
  const imp = kept.data?.result, asking = !!kept.data?.busy
  useEffect(() => { if (kept.data?.error) toast(kept.data.error, 'error') }, [kept.data?.error])
  const [armed, setArmed] = useState(false)
  const improve = () => api('/skills/improve', { name: r.name, days }).then(() => refresh('/skills/advice'), (e: Error) => toast(e.message, 'error'))
  const remove = () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    api('/skills/remove', { name: r.name }).then((x: { said: string }) => { toast(x.said); onRemoved() }, (e: Error) => toast(e.message, 'error'))
  }
  const canRemove = mine && r.source !== 'plugin' && r.mode !== 'off'
  const [early, late] = halves(r.perDay, days)
  const judged = r.runs >= 3
  return <>
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-mono text-title font-semibold text-fg-1">{r.name}</h2>
        <p className="mt-0.5 text-small text-fg-3">{SOURCE[r.source]}{r.mode === 'off' ? ' · turned off here' : ''} · {OWNER_LABEL(owner)}{feature ? ` · Concierge runs it for ${feature}` : ''}{r.lastAt ? ` · last used ${new Date(r.lastAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ' · no run loaded it in this period'}</p>
      </div>
      {canRemove && <button onClick={remove} className={`inline-flex items-center gap-1.5 rounded-ctl px-3 py-1.5 text-small font-medium ${armed ? 'bg-fail text-white' : 'bg-hover text-fg-2 hover:text-fail-text'}`}><Trash2 className="size-3.5" />{armed ? 'Click again to confirm' : r.source === 'company' ? 'Turn off here' : 'Remove'}</button>}
    </div>
    {mine ? (
      <div className="flex flex-wrap items-center gap-2 text-small text-fg-3">
        <span>Belongs to</span>
        <div role="radiogroup" aria-label="Belongs to" className="inline-flex rounded-lg bg-hover p-0.5">
          {([role, 'shared'] as Owner[]).map((o) => <button key={o} role="radio" aria-checked={owner === o} onClick={() => owner !== o && own(o)} className={`rounded-md px-2.5 py-0.5 font-medium ${owner === o ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{o === 'shared' ? 'Every role' : `${ROLES[role].label} only`}</button>)}
        </div>
      </div>
    ) : <p className="rounded-xl bg-hover/60 px-3 py-2 text-small text-fg-2">{OWNER_LABEL(owner)}'s skill: you can use it as {ROLES[role].label}, but change it only as {OWNER_LABEL(owner)}, or share it with every role from there.</p>}
    <div className="card grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
      <Kpi label="Score" value={judged ? <span className="inline-flex items-center gap-2">{r.score}<span className={`rounded-full px-2 py-px text-meta font-medium ${VERDICT[r.verdict].soft} ${VERDICT[r.verdict].text}`}>{VERDICT[r.verdict].label}</span></span> : '–'} sub={judged ? 'out of 100' : 'needs 3 runs to judge'} />
      <Kpi label="Runs" value={r.runs} sub={<span className="inline-flex items-center gap-1.5">{early} → {late} by half <Trend now={late} before={early} /></span>} />
      <Kpi label="Cost" value={`$${r.costUsd.toFixed(2)}`} sub={r.runs ? `$${(r.costUsd / r.runs).toFixed(2)} a run · ${r.turns.toFixed(0)} turns` : 'no runs'} />
      <Kpi label="Tokens a load" value={tok(r.tokens)} sub={r.tokens && r.runs ? `${tok(r.tokens * r.runs)} over its runs` : 'its file, loaded each run'} />
    </div>
    {r.runs > 0 && (
      <section className="card p-4">
        <div className="mb-3 flex items-baseline gap-2"><span className="text-small font-medium text-fg-1">What makes the score</span><span className="text-meta text-fg-3">each part weighted as shown</span></div>
        <ul className="space-y-2.5">
          {parts(r).map((p) => (
            <li key={p.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-small">
              <span className="text-fg-2">{p.label} <span className="text-meta text-fg-4">{p.weight}%</span></span>
              <span className="relative h-2 rounded-full bg-fill"><span className={`absolute inset-y-0 left-0 rounded-full ${p.v >= 0.85 ? 'bg-ok' : p.v >= 0.7 ? 'bg-wait' : 'bg-fail'}`} style={{ width: `${Math.max(2, p.v * 100)}%` }} /></span>
              <span className="text-right tabular-nums text-fg-1" title={p.note}>{pct(p.v)}</span>
            </li>
          ))}
        </ul>
        {r.reasons.length > 0 && <p className="mt-3 border-t border-line pt-2.5 text-small text-fg-2">{r.reasons.join('; ')}.</p>}
      </section>
    )}
    {r.runs > 0 && <DayChart perDay={r.perDay} days={days} label="Runs per day" />}
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><p className="text-body font-medium text-fg-1">What to change</p><p className="text-small text-fg-3">Sonnet reads the skill, how its runs went and what you told the agents in them: edits for the goal, and how to spend fewer tokens.</p></div>
        <button onClick={improve} disabled={asking || !mine} title={mine ? undefined : `Switch to ${OWNER_LABEL(owner)} to change it`} className="inline-flex items-center gap-1.5 btn-primary disabled:opacity-60">{asking ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wand className="size-3.5" />}{asking ? 'Reading… you can leave' : imp ? 'Again' : 'Suggest improvements'}</button>
      </div>
      {imp && <div className="mt-3 space-y-3 border-t border-line pt-3">
        <p className="text-small text-fg-1"><b className="font-semibold">{imp.verdict === 'keep' ? 'Keep it' : imp.verdict === 'change' ? 'Change it' : 'Remove it'}.</b> {imp.why}</p>
        {imp.changes.map((c, i) => (
          <div key={i}><p className="text-small font-medium text-fg-1">{c.title}</p><p className="text-small text-fg-3">{c.why}</p>
            <div className="mt-1 flex items-start gap-2 rounded-lg bg-hover px-3 py-2"><p className="min-w-0 flex-1 whitespace-pre-wrap text-small text-fg-1">{c.edit}</p><button onClick={() => navigator.clipboard.writeText(c.edit).then(() => toast('Copied'))} className="shrink-0 text-meta text-fg-3 hover:text-fg-1">Copy</button></div></div>
        ))}
        <div className="rounded-xl bg-accent-soft px-3 py-2 text-small text-fg-1"><b className="font-semibold">Tokens:</b> {tok(imp.tokensNow)} → {tok(imp.tokensNew ?? imp.tokens.after)} a load. {imp.tokens.how}</div>
        {imp.rewrite && (
          // the new look of the skill, whole: copy it and paste it over the old file
          <div className="rounded-xl ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-small"><b className="font-semibold text-fg-1">The new skill</b> <span className="text-fg-3">· {tok(imp.tokensNew)} tokens{imp.file ? ` · paste it over ${imp.file}` : ''}</span></span>
              <button onClick={() => navigator.clipboard.writeText(imp.rewrite).then(() => toast(`Copied${imp.file ? `: paste it over ${imp.file}` : ''}`))}
                      className="inline-flex items-center gap-1.5 btn-primary btn-sm"><Copy className="size-3.5" />Copy the new skill</button>
            </div>
            <details className="group/rw border-t border-line">
              <summary className="cursor-pointer list-none px-3 py-2 text-small text-fg-3 hover:text-fg-1">Show it</summary>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-meta text-fg-2">{imp.rewrite}</pre>
            </details>
          </div>
        )}
        {imp.newSkills?.map((n) => (
          // a part the rewrite moves out: its whole file, to save next to the others before using the rewrite
          <div key={n.name} className="rounded-xl ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-small"><b className="font-semibold text-fg-1">New skill <span className="font-mono">{n.name}</span></b> <span className="text-fg-3">· {tok(Math.round(n.content.length / 4))} tokens · save it as ~/.claude/skills/{n.name}/SKILL.md</span><span className="block text-fg-3">{n.why}</span></span>
              <button onClick={() => navigator.clipboard.writeText(n.content).then(() => toast(`Copied: save it as ~/.claude/skills/${n.name}/SKILL.md`))} className="inline-flex items-center gap-1.5 btn-quiet btn-sm"><Copy className="size-3.5" />Copy {n.name}</button>
            </div>
            <details className="border-t border-line"><summary className="cursor-pointer list-none px-3 py-2 text-small text-fg-3 hover:text-fg-1">Show it</summary>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-meta text-fg-2">{n.content}</pre></details>
          </div>
        ))}
        <p className="text-meta text-fg-4">Written {ago(imp.at)} over {imp.days} days · from {imp.from} of your messages · ${imp.costUsd.toFixed(3)}</p>
      </div>}
    </div>
  </>
}
