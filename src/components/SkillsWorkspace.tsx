// The Skills workspace: your skills and the company's, how much each is used and how well it works, what is trending,
// and what to change, always weighing the goal against the cost (its runs, and the tokens it takes to load). Read from
// /skills/view (server/skills.ts); changes are proposed by a model on demand, and nothing changes until you act.
import { ArrowDownRight, ArrowUpRight, Copy, LoaderCircle, Minus, Sparkles, Trash2, Wand } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Advice, Installed, SkillRow, Source, Verdict } from '../../server/skills.ts'
import { api } from '../lib.ts'
import { refresh, useApi } from '../query.ts'
import { ROLES, useRole, type Role, type RolesView } from '../role.ts'
type Owner = Role | 'shared'

type Row = SkillRow & { before: number; source: Source; tokens?: number; mode?: string }
type View = { days: number; runs: number; withSkill: number; skills: Row[]; installed: Installed[]; perDay: Record<string, number>; advice: Advice[] }
type Improve = { verdict: 'keep' | 'change' | 'remove'; why: string; changes: { title: string; why: string; edit: string }[]; tokens: { after: number; how: string }; rewrite: string; tokensNow?: number; tokensNew?: number; file?: string; costUsd: number; from: number }
type Toast = (m: string, tone?: 'ok' | 'error') => void
type Scope = 'all' | 'mine' | 'company' | 'others'
type Sort = 'used' | 'trending' | 'work' | 'tokens'

const SOURCE: Record<Source, string> = { mine: 'Yours', company: 'Company', starter: 'Starter', plugin: 'Plugin' }
const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  good: { label: 'Working well', cls: 'bg-ok/12 text-ok' }, watch: { label: 'Watch', cls: 'bg-wait/14 text-wait' },
  fix: { label: 'Needs changes', cls: 'bg-fail/12 text-fail' }, few: { label: 'Too few runs', cls: 'bg-hover text-fg-3' },
}
const ADVICE: Record<Advice['kind'], { label: string; cls: string }> = { new: { label: 'New', cls: 'bg-accent-soft text-accent-text' }, modify: { label: 'Change', cls: 'bg-wait/14 text-wait' }, remove: { label: 'Remove', cls: 'bg-hover text-fg-2' } }
/** Runs in the period's first half and its second: the trend, from inside the period itself. */
const halves = (perDay: Record<string, number>, days: number): [number, number] => {
  const mid = new Date(Date.now() - (days / 2) * 86400_000).toISOString().slice(0, 10)
  let early = 0, late = 0
  for (const [d, n] of Object.entries(perDay)) if (d < mid) early += n; else late += n
  return [early, late]
}
const tok = (n?: number) => (n == null ? '–' : n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
// a skill with no runs in the period: still listed, so the unused show up
const idle = (i: Installed): Row => ({ name: i.name, source: i.source, tokens: i.tokens, mode: i.mode, before: 0, runs: 0, done: 0, failed: 0, cancelled: 0, costUsd: 0, turns: 0, steers: 0, refusedRuns: 0, followed: 0, lastAt: '', kinds: {}, score: 0, verdict: 'few', reasons: [], recent: [], perDay: {} })

function Trend({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="text-meta text-fg-4">–</span>
  const d = before ? Math.round(((now - before) / before) * 100) : 100
  const Icon = d > 5 ? ArrowUpRight : d < -5 ? ArrowDownRight : Minus
  return <span className={`inline-flex items-center gap-0.5 text-meta tabular-nums ${d > 5 ? 'text-ok' : d < -5 ? 'text-fail' : 'text-fg-3'}`}><Icon className="size-3.5" />{before ? `${d > 0 ? '+' : ''}${d}%` : 'new'}</span>
}

function Bars({ perDay, days }: { perDay: Record<string, number>; days: number }) {
  const n = Math.min(days, 45)
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400_000).toISOString().slice(0, 10))
  const max = Math.max(1, ...dates.map((d) => perDay[d] ?? 0))
  return (
    <div className="flex h-20 items-end gap-[3px]" role="img" aria-label="Runs per day">
      {dates.map((d) => <span key={d} title={`${d}: ${perDay[d] ?? 0}`} className="flex-1 rounded-t bg-accent/70" style={{ height: `${((perDay[d] ?? 0) / max) * 100}%`, minHeight: 1, opacity: perDay[d] ? 1 : 0.2 }} />)}
    </div>
  )
}

const Stat = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="card px-4 py-3">
    <div className="text-meta text-fg-3">{label}</div>
    <div className="mt-0.5 text-title font-semibold tabular-nums text-fg-1">{value}</div>
    {sub && <div className="text-meta text-fg-4">{sub}</div>}
  </div>
)

// whose a skill is: the role you work as sees its own and the shared ones, and changes only those; another role's skills
// it can use, and read here under "Other roles"
const OWNER_LABEL = (o?: Owner) => (!o || o === 'shared' ? 'Shared' : ROLES[o].label)
export function SkillsWorkspace({ toast }: { toast: Toast }) {
  const role = useRole()
  const roles = useApi<RolesView>('/roles', { staleTime: 60_000 })
  const owner = (name: string): Owner => roles.data?.owners[name] ?? 'developer'
  const mineHere = (name: string) => { const o = owner(name); return o === 'shared' || o === role }
  const [days, setDays] = useState(30)
  // cached per period: the counting reads every run's log, so coming back shows the last answer while it refreshes
  const q = useApi<View>(`/skills/view?days=${days}`, { staleTime: 5 * 60_000, placeholderData: (prev) => prev })
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
      <aside className="flex w-full shrink-0 flex-col border-r border-line md:w-[340px]">
        <div className="space-y-2.5 px-4 pb-3 pt-4">
          <div className="flex items-center gap-2"><button onClick={() => setSel(undefined)} className="text-title font-semibold tracking-tight">Skills</button>
            <div role="radiogroup" aria-label="Period" className="ml-auto inline-flex rounded-ctl bg-fill p-0.5 text-small">
              {[7, 30, 90].map((d) => <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`rounded-lg px-2 py-0.5 font-medium transition-colors ${days === d ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{d}d</button>)}
            </div>
          </div>
          <div role="tablist" className="flex gap-0.5 rounded-ctl bg-hover p-[3px]">
            {(['all', 'mine', 'company', 'others'] as const).map((s) => <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} title={s === 'others' ? 'Other roles\' skills: you can use them, not change them' : undefined} className={`flex-1 rounded-lg px-2 py-1 text-small font-medium ${scope === s ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{s === 'all' ? ROLES[role].label : s === 'mine' ? 'Mine' : s === 'company' ? 'Company' : 'Other roles'}</button>)}
          </div>
          <div className="flex flex-wrap gap-1 text-meta">
            {([['used', 'Most used'], ['trending', 'Trending'], ['work', 'Needs work'], ['tokens', 'Most tokens']] as const).map(([k, l]) => <button key={k} onClick={() => setSort(k)} className={`rounded-md px-2 py-0.5 ${sort === k ? 'bg-accent-soft text-accent-text' : 'text-fg-3 hover:text-fg-1'}`}>{l}</button>)}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!v ? <p className="flex items-center gap-2 p-3 text-small text-fg-3"><LoaderCircle className="size-4 animate-spin" />Reading the runs…</p> : rows.map((r) => (
            <button key={r.name} onClick={() => setSel(r.name)} className={`mb-0.5 flex w-full items-center gap-3 rounded-ctl px-2.5 py-2 text-left ${sel === r.name ? 'sel' : 'hover:bg-hover/60'}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-small text-fg-1">{r.name}</span>
                <span className="flex items-center gap-2 text-meta text-fg-3"><span>{SOURCE[r.source]}</span><span>{r.runs} run{r.runs === 1 ? '' : 's'}</span>{r.tokens != null && <span>{tok(r.tokens)} tok</span>}{r.mode === 'off' && <span className="text-fg-4">off</span>}</span>
              </span>
              <Trend now={halves(r.perDay, days)[1]} before={halves(r.perDay, days)[0]} />
              {r.runs >= 3 && <span className={`shrink-0 rounded-full px-1.5 py-px text-micro font-medium ${VERDICT[r.verdict].cls}`}>{r.score}</span>}
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[920px] space-y-4 p-4 sm:p-6">
          {!v ? null : cur ? <Detail key={cur.name} r={cur} days={days} toast={toast} owner={owner(cur.name)} role={role} onRemoved={() => { setSel(undefined); void load() }} /> : <Overview v={v} rows={rows} onPick={setSel} toast={toast} />}
        </div>
      </main>
    </div>
  )
}

/** Nothing picked: the totals, what moves, and what to do. */
function Overview({ v, rows, onPick, toast }: { v: View; rows: Row[]; onPick: (n: string) => void; toast: Toast }) {
  const loaded = v.skills.reduce((n, s) => n + (s.tokens ?? 0) * s.runs, 0)
  const half = (s: Row) => halves(s.perDay, v.days)
  const moving = [...v.skills].filter((s) => s.runs >= 3).sort((a, b) => (half(b)[1] - half(b)[0]) - (half(a)[1] - half(a)[0]))
  const [ai, setAi] = useState<{ suggestions: (Advice & { change: string })[]; costUsd: number; from: number }>()
  const [asking, setAsking] = useState(false)
  const suggest = () => { setAsking(true); api('/skills/suggest', { days: v.days }).then(setAi, (e: Error) => toast(e.message, 'error')).finally(() => setAsking(false)) }
  return <>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Stat label="Runs" value={v.runs} sub={`in ${v.days} days`} />
      <Stat label="With a skill" value={v.runs ? `${Math.round((v.withSkill / v.runs) * 100)}%` : '–'} sub="beyond their command" />
      <Stat label="Skills in use" value={`${v.skills.length} of ${v.installed.length}`} sub={`${rows.filter((r) => !r.runs).length} unused`} />
      <Stat label="Tokens spent loading skills" value={tok(loaded)} sub="their files, on every run" />
    </div>
    <div className="card p-4"><p className="mb-3 text-small font-medium text-fg-2">Runs with a skill, per day</p><Bars perDay={v.perDay} days={v.days} /></div>
    <div className="grid gap-2 md:grid-cols-2">
      {[['Trending up', moving.filter((s) => half(s)[1] > half(s)[0]).slice(0, 4)], ['Trending down', [...moving].reverse().filter((s) => half(s)[1] < half(s)[0]).slice(0, 4)]].map(([t, list]) => (
        <div key={t as string} className="card p-4">
          <p className="mb-2 text-small font-medium text-fg-2">{t as string}</p>
          {(list as Row[]).map((s) => <button key={s.name} onClick={() => onPick(s.name)} className="flex w-full items-center gap-2 py-1 text-left text-small"><span className="min-w-0 flex-1 truncate font-mono text-fg-1">{s.name}</span><span className="text-fg-3">{half(s)[0]} → {half(s)[1]}</span><Trend now={half(s)[1]} before={half(s)[0]} /></button>)}
        </div>
      ))}
    </div>
    <section className="space-y-2">
      <h3 className="text-body font-semibold text-fg-1">How to improve</h3>
      {v.advice.map((a, i) => (
        <div key={i} className="card p-4">
          <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-px text-meta font-medium ${ADVICE[a.kind].cls}`}>{ADVICE[a.kind].label}</span>
            {a.skill ? <button onClick={() => onPick(a.skill!)} className="text-body font-medium text-fg-1 hover:underline">{a.title}</button> : <span className="text-body font-medium text-fg-1">{a.title}</span>}</div>
          <p className="mt-1 text-small text-fg-2">{a.why}</p>
          {a.evidence && <p className="mt-2 flex flex-wrap gap-1">{a.evidence.map((e) => <button key={e} onClick={() => onPick(e)} className="rounded-md bg-hover px-1.5 font-mono text-meta text-fg-2 hover:text-fg-1">{e}</button>)}</p>}
        </div>
      ))}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-body font-medium text-fg-1">Proposals from what you told the agents</p><p className="text-small text-fg-3">A small model reads your messages to the agents and the scores, and drafts new skills or changes. A few cents.</p></div>
          <button onClick={suggest} disabled={asking} className="inline-flex items-center gap-1.5 btn-primary btn-lg shadow-e1 disabled:opacity-60">{asking ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{ai ? 'Draft again' : 'Draft proposals'}</button>
        </div>
        {ai && <div className="mt-3 space-y-3 border-t border-line pt-3">
          <p className="text-meta text-fg-4">From {ai.from} of your messages · ${ai.costUsd.toFixed(3)}</p>
          {ai.suggestions.map((s, i) => <div key={i}><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-px text-meta font-medium ${ADVICE[s.kind].cls}`}>{ADVICE[s.kind].label}</span><span className="text-body font-medium text-fg-1">{s.title}</span></div><p className="mt-0.5 text-small text-fg-2">{s.why}</p><p className="mt-1 whitespace-pre-wrap rounded-lg bg-hover px-3 py-2 text-small text-fg-1">{s.change}</p></div>)}
        </div>}
      </div>
    </section>
  </>
}

/** One skill: its numbers against the period before, why it scores as it does, and what to change or cut. */
function Detail({ r, days, toast, onRemoved, owner, role }: { r: Row; days: number; toast: Toast; onRemoved: () => void; owner: Owner; role: Role }) {
  // another role's skill: used as it is, changed only from that role
  const mine = owner === 'shared' || owner === role
  const own = (o: Owner) => api('/roles/skill', { name: r.name, owner: o }).then(() => { refresh('/roles'); toast(o === 'shared' ? 'Shared with every role' : `Now only ${ROLES[o].label}'s`) }, (e: Error) => toast(e.message, 'error'))
  const [imp, setImp] = useState<Improve>()
  const [asking, setAsking] = useState(false)
  const [armed, setArmed] = useState(false)
  const improve = () => { setAsking(true); api('/skills/improve', { name: r.name, days }).then(setImp, (e: Error) => toast(e.message, 'error')).finally(() => setAsking(false)) }
  const remove = () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    api('/skills/remove', { name: r.name }).then((x: { said: string }) => { toast(x.said); onRemoved() }, (e: Error) => toast(e.message, 'error'))
  }
  const canRemove = mine && r.source !== 'plugin' && r.mode !== 'off'
  return <>
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1"><h2 className="truncate font-mono text-title font-semibold text-fg-1">{r.name}</h2><p className="text-small text-fg-3">{SOURCE[r.source]} skill{r.mode === 'off' ? ' · turned off here' : ''}{` · ${OWNER_LABEL(owner)}`}{r.lastAt ? ` · last used ${new Date(r.lastAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ' · not used in this period'}</p></div>
      {r.runs >= 3 && <span className={`rounded-full px-2 py-px text-meta font-medium ${VERDICT[r.verdict].cls}`}>{VERDICT[r.verdict].label} · {r.score}</span>}
      {canRemove && <button onClick={remove} className={`inline-flex items-center gap-1.5 rounded-ctl px-3 py-1.5 text-small font-medium ${armed ? 'bg-fail text-white' : 'bg-hover text-fg-2 hover:text-fail'}`}><Trash2 className="size-3.5" />{armed ? 'Click again to confirm' : r.source === 'company' ? 'Turn off here' : 'Remove'}</button>}
    </div>
    {mine ? (
      <div className="flex flex-wrap items-center gap-2 text-small text-fg-3">
        <span>Belongs to</span>
        <div role="radiogroup" aria-label="Belongs to" className="inline-flex rounded-lg bg-hover p-0.5">
          {([role, 'shared'] as Owner[]).map((o) => <button key={o} role="radio" aria-checked={owner === o} onClick={() => owner !== o && own(o)} className={`rounded-md px-2.5 py-0.5 font-medium ${owner === o ? 'sel' : 'text-fg-3 hover:text-fg-1'}`}>{o === 'shared' ? 'Every role' : `${ROLES[role].label} only`}</button>)}
        </div>
      </div>
    ) : <p className="rounded-xl bg-hover/60 px-3 py-2 text-small text-fg-2">{OWNER_LABEL(owner)}'s skill: you can use it as {ROLES[role].label}, but change it only as {OWNER_LABEL(owner)}, or share it with every role from there.</p>}
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Stat label="Runs" value={r.runs} sub={<span className="flex items-center gap-1">{halves(r.perDay, days)[0]} → {halves(r.perDay, days)[1]} by half <Trend now={halves(r.perDay, days)[1]} before={halves(r.perDay, days)[0]} /></span>} />
      <Stat label="Finished" value={r.runs ? `${r.done}/${r.runs - r.cancelled}` : '–'} sub={`${r.followed} run again`} />
      <Stat label="Your help a run" value={r.runs ? (r.steers / r.runs).toFixed(1) : '–'} sub={`${r.refusedRuns} with a tool refused`} />
      <Stat label="Tokens" value={tok(r.tokens)} sub={r.tokens && r.runs ? `${tok(r.tokens * r.runs)} over its ${r.runs} runs · $${r.costUsd.toFixed(2)} in runs` : 'to load it'} />
    </div>
    {r.runs > 0 && <div className="card p-4"><p className="mb-3 text-small font-medium text-fg-2">Runs per day</p><Bars perDay={r.perDay} days={days} /></div>}
    {r.reasons.length > 0 && <div className="card p-4"><p className="text-small font-medium text-fg-2">What lowers its score</p><ul className="mt-1 list-inside list-disc text-small text-fg-2">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul></div>}
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><p className="text-body font-medium text-fg-1">What to change</p><p className="text-small text-fg-3">Sonnet reads the skill, how its runs went and what you told the agents in them: edits for the goal, and how to spend fewer tokens.</p></div>
        <button onClick={improve} disabled={asking || !mine} title={mine ? undefined : `Switch to ${OWNER_LABEL(owner)} to change it`} className="inline-flex items-center gap-1.5 btn-primary btn-lg shadow-e1 disabled:opacity-60">{asking ? <LoaderCircle className="size-4 animate-spin" /> : <Wand className="size-4" />}{imp ? 'Again' : 'Suggest improvements'}</button>
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
        <p className="text-meta text-fg-4">From {imp.from} of your messages · ${imp.costUsd.toFixed(3)}</p>
      </div>}
    </div>
  </>
}
