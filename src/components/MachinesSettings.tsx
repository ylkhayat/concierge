// Settings → Machines: every machine Concierge runs on, as tabs. All: the totals and a line per machine. One machine:
// its CPU, memory and disk (the whole machine, and the share Concierge's agents take), its agents, and what you can do
// from here (work machine, log, restart). Then the keys every machine shares, which fill themselves from the machines'
// own .env files.
import { HardDrive, Laptop, Cpu, MemoryStick, Bot, Server, ShieldCheck } from 'lucide-react'
import { Tabs } from './Tabs.tsx'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { ago } from '../time.ts'

type M = {
  name: string; role?: string; control: boolean; work: boolean
  cores: number; cpu: number; agentsCpu: number; mb: number; usedMb: number; agentsMb: number
  diskGb?: number; diskUsedGb?: number; running: number; slots: number; room: number
  version?: string; fleet?: string; behind?: ('app' | 'fleet')[] // what it runs, and what it lacks of the latest
}
type Head = { sha: string; at: string }
type View = { machines: M[]; workSlots: number; several: boolean; latest?: { app?: Head; fleet?: Head } }
/** What a machine runs, and whether that's the latest on GitHub. */
function Version({ m, latest }: { m: M; latest?: View['latest'] }) {
  const lacks = m.behind ?? []
  const build = m.version ? `v${m.version.split('-')[0]}` : 'an older build'
  const runs = `${m.version ?? 'an older build'}${m.fleet ? ` · fleet ${m.fleet}` : ''}`
  if (!lacks.length) return <span className="text-meta tabular-nums text-fg-4" title={`${runs}: the latest`}>{build}</span>
  const want = lacks.map((k) => `${k === 'app' ? 'the app' : 'fleet'} at ${latest?.[k]?.sha.slice(0, 7)}${latest?.[k] ? ` (${ago(latest[k]!.at)})` : ''}`).join(' and ')
  return <span title={`Runs ${runs}; the latest is ${want}. Update now (below) brings it there.`}><Badge tone="warn">Update available</Badge></span>
}
type Key = { name: string; label: string; shared?: string; from?: string; here: boolean }

const quiet = 'inline-flex shrink-0 items-center gap-1.5 btn-outline btn-sm'
const gb = (mb: number) => `${(mb / 1024).toFixed(mb < 10240 ? 1 : 0)} GB`
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0)
const ROLE: Record<string, string> = { primary: 'main', standby: 'standby', worker: 'worker' }

/** One measure: a bar with the agents' share (accent) inside what the machine uses (muted), and the numbers. */
/** `agents` undefined: nothing of it is the agents' own (disk). Units: one short number, the unit said once on the total. */
function Meter({ icon: Icon, label, used, agents, total, unit, of }: { icon: typeof Cpu; label: string; used: number; agents?: number; total: number; unit: (n: number) => string; of: string }) {
  const u = Math.min(100, pct(used, total)), a = Math.min(u, pct(agents ?? 0, total))
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-meta text-fg-3"><Icon className="size-3.5" />{label}<span className={`ml-auto tabular-nums ${u >= 85 ? 'text-fail-text' : 'text-fg-2'}`}>{u}%</span></div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-fill" role="img" aria-label={`${label}: ${u}% used, ${a}% by agents`}>
        <span className="bg-accent" style={{ width: `${a}%` }} />
        <span className="bg-fill-strong" style={{ width: `${u - a}%` }} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 whitespace-nowrap text-micro tabular-nums text-fg-4">
        <span className="truncate">{agents !== undefined && <><span className="text-accent-text">{unit(agents)} agents</span> · </>}{unit(used)} used</span>
        <span className="ml-auto">of {of}</span>
      </div>
    </div>
  )
}

function Tiles({ m }: { m: Pick<M, 'cores' | 'cpu' | 'agentsCpu' | 'mb' | 'usedMb' | 'agentsMb' | 'diskGb' | 'diskUsedGb' | 'running' | 'room'> }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Meter icon={Cpu} label="CPU" used={(m.cpu * m.cores) / 100} agents={(m.agentsCpu * m.cores) / 100} total={m.cores} unit={(n) => n.toFixed(1)} of={`${m.cores} cores`} />
      <Meter icon={MemoryStick} label="Memory" used={m.usedMb} agents={m.agentsMb} total={m.mb} unit={(n) => (n / 1024).toFixed(1)} of={gb(m.mb)} />
      {m.diskGb ? <Meter icon={HardDrive} label="Disk" used={m.diskUsedGb ?? 0} total={m.diskGb} unit={(n) => String(Math.round(n))} of={`${m.diskGb} GB`} /> : <div />}
      <div className="card p-3">
        <div className="flex items-center gap-1.5 text-meta text-fg-3"><Bot className="size-3.5" />Agents</div>
        <div className="mt-1.5 text-title font-semibold tabular-nums text-fg-1">{m.running}<span className="text-body font-normal text-fg-4"> / {m.room}</span></div>
        <div className="text-micro text-fg-4">running / may run</div>
      </div>
    </div>
  )
}

const BADGE = { accent: 'bg-accent-soft text-accent-text', muted: 'bg-fill text-fg-3', warn: 'bg-wait/10 text-wait-text' }
const Badge = ({ children, tone = 'muted' }: { children: ReactNode; tone?: keyof typeof BADGE }) =>
  <span className={`rounded-full px-2 py-0.5 text-micro font-semibold ${BADGE[tone]}`}>{children}</span>

export function MachinesSettings() {
  const [v, setV] = useState<View>()
  const [tab, setTab] = useState('all')
  const [log, setLog] = useState<{ name: string; lines?: string[]; error?: string }>()
  const [err, setErr] = useState<string>()
  const { armed, arm } = useArm()
  const [fail, setFail] = useState<string>()
  const read = () => api('/machines/stats').then((r: View) => { if (!Array.isArray(r?.machines)) throw new Error('No numbers came back'); setV(r); setFail(undefined) }).catch((e: Error) => setFail(e.message))
  useEffect(() => { void read(); const t = setInterval(read, 5_000); return () => clearInterval(t) }, [])
  const act = (p: Promise<unknown>) => p.then(() => { setErr(undefined); return read() }, (e: Error) => setErr(e.message))

  if (!v) return fail
    ? <p className="rounded-xl px-3.5 py-3 text-small text-fail-text ring-1 ring-line">Couldn&apos;t read the machines: {fail}</p>
    : (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-busy="true" aria-label="Loading">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[86px] animate-pulse card" style={{ animationDelay: `${i * 90}ms` }} />)}
      </div>
    )
  const ms = v.machines, m = ms.find((x) => x.name === tab)
  const sum = (k: keyof M) => ms.reduce((n, x) => n + (Number(x[k]) || 0), 0)
  const all = {
    cores: sum('cores'), mb: sum('mb'), usedMb: sum('usedMb'), agentsMb: sum('agentsMb'), diskGb: sum('diskGb'), diskUsedGb: sum('diskUsedGb'), running: sum('running'), room: sum('room'),
    cpu: Math.round(ms.reduce((n, x) => n + x.cpu * x.cores, 0) / Math.max(1, sum('cores'))), agentsCpu: Math.round(ms.reduce((n, x) => n + x.agentsCpu * x.cores, 0) / Math.max(1, sum('cores'))),
  }
  const showLog = (name: string) => log?.name === name ? setLog(undefined) : (setLog({ name }), api(`/machines/${encodeURIComponent(name)}/logs`).then((r: { lines: string[] }) => setLog({ name, lines: r.lines }), (e: Error) => setLog({ name, error: e.message })))

  return (
    <section className="space-y-3">
      {v.several && (
        <Tabs as="tab" label="Machine" value={tab} onChange={setTab}
              options={[{ id: 'all', label: 'All machines' }, ...ms.map((x) => ({ id: x.name, label: x.name, icon: x.work ? Laptop : Server, dot: x.behind?.length ? 'warn' as const : undefined, title: x.behind?.length ? 'Not on the latest version' : undefined }))]} />
      )}

      {!m ? (
        <>
          <Tiles m={all} />
          {v.several && (
            <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
              {ms.map((x) => (
                <li key={x.name}>
                  <button onClick={() => setTab(x.name)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hover">
                    {x.work ? <Laptop className="size-4 text-fg-3" /> : <Server className="size-4 text-fg-3" />}
                    <span className="text-body font-medium text-fg-1">{x.name}</span>
                    {x.control && <Badge tone="accent">control plane</Badge>}
                    {x.work && <Badge>work machine</Badge>}
                    <Version m={x} latest={v.latest} />
                    <span className="ml-auto flex items-center gap-4 text-meta tabular-nums text-fg-3">
                      <span title="CPU, whole machine">{x.cpu}% cpu</span><span title="Memory, whole machine">{pct(x.usedMb, x.mb)}% mem</span>
                      {x.diskGb ? <span title="Disk">{pct(x.diskUsedGb ?? 0, x.diskGb)}% disk</span> : null}<span>{x.running}/{x.room} agents</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold text-fg-1">{m.name}</span>
            {m.control && <Badge tone="accent">control plane</Badge>}
            {m.role && ROLE[m.role] && <Badge>{ROLE[m.role]}</Badge>}
            <span className="text-meta text-fg-4">{m.cores} cores · {gb(m.mb)}</span>
            <Version m={m} latest={v.latest} />
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <button onClick={() => showLog(m.name)} className={quiet}>{log?.name === m.name ? 'Hide log' : 'Log'}</button>
              <button onClick={() => arm(`restart:${m.name}`, () => void act(api(`/machines/${encodeURIComponent(m.name)}/restart`, {})))}
                      title="Restart Concierge there (within ~10s): its runs continue where they left off" className={`${quiet} relative isolate overflow-hidden ${armed === `restart:${m.name}` ? 'text-fail-text' : ''}`}>
                {armed === `restart:${m.name}` ? <><ArmLabel>Confirm restart</ArmLabel><ArmBar on="plain" /></> : 'Restart'}
              </button>
            </span>
          </div>
          <Tiles m={m} />
          <div className="flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5 ring-1 ring-line">
            <Laptop className="size-4 text-fg-3" />
            <div className="min-w-0 flex-1">
              <div className="text-small font-medium text-fg-1">Work machine</div>
              <div className="text-meta text-fg-3">The machine you use. It takes few agents so it stays quick.</div>
            </div>
            {m.work ? (
              <>
                <Tabs size="sm" label="Agents on the work machine at most" value={String(v.workSlots)} onChange={(n) => void act(api('/machines', { workSlots: Number(n) }))}
                      options={[0, 1, 2, 3, 4].map((n) => ({ id: String(n), label: n === 0 ? 'None' : String(n), title: n === 0 ? 'No agents here' : `${n} agent${n > 1 ? 's' : ''} at most` }))} />
                <button onClick={() => void act(api('/machines', { workMachine: null }))} className={quiet}>Not my work machine</button>
              </>
            ) : <button onClick={() => void act(api('/machines', { workMachine: m.name }))} className={quiet}>Make it my work machine</button>}
          </div>
          {log?.name === m.name && (
            <pre className="max-h-80 overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-micro leading-relaxed text-zinc-200">
              {log.error ?? (log.lines ? (log.lines.length ? log.lines.join('\n') : 'Nothing logged since it started.') : 'Loading…')}
            </pre>
          )}
        </>
      )}
      {err && <p className="text-meta text-fail-text">{err}</p>}
      <SharedKeys />
    </section>
  )
}

/**
 * The keys every machine uses: taken by themselves from the machines' own .env files and kept once for all (readable
 * only by you, never shown). Replace is there for rotating one.
 */
function SharedKeys() {
  const [v, setV] = useState<Key[]>()
  const [open, setOpen] = useState<string>()
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState<{ name: string; text: string; bad?: boolean }>()
  const read = () => api('/shared-keys').then(setV, () => {})
  useEffect(() => { void read() }, [])
  if (!v) return null
  const put = (name: string) => api('/shared-keys', { name, value: draft }).then(
    (r: { who?: string }) => { setOpen(undefined); setDraft(''); setMsg({ name, text: `${r.who ? `Connected as ${r.who}. ` : ''}Every machine uses it within 30 seconds` }); return read() },
    (e: Error) => setMsg({ name, text: e.message, bad: true }))
  return (
    <div className="space-y-2 pt-3">
      <header>
        <h3 className="text-small font-semibold text-fg-1">Shared keys</h3>
        <p className="text-meta text-fg-3">Kept once for every machine. Never shown, and removed from logs.</p>
      </header>
      <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
        {v.map((k) => (
          <li key={k.name} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
            <ShieldCheck className={`size-4 ${k.shared ? 'text-ok' : 'text-fg-4'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-small font-medium text-fg-1">{k.label}</div>
              <div className={`text-meta ${msg?.name === k.name && msg.bad ? 'text-fail-text' : 'text-fg-3'}`}>
                {msg?.name === k.name ? msg.text : k.shared ? `${k.from === 'you' ? 'Set by you' : `Shared${k.from ? ` from ${k.from}’s .env` : ''}`} · ${ago(k.shared)}` : 'Not on any machine yet: add it to one machine’s .env, or paste it here'}
              </div>
            </div>
            {open === k.name ? (
              <span className="flex items-center gap-1.5">
                <input type="password" autoFocus autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New value…" aria-label={`${k.label}: new value`}
                       className="w-56 rounded-lg bg-surface-1 px-2.5 py-1 font-mono text-small ring-1 ring-line outline-none focus:ring-2 focus:ring-accent/50" />
                <button disabled={!draft.trim()} onClick={() => void put(k.name)} className={quiet}>Save</button>
                <button onClick={() => { setOpen(undefined); setDraft('') }} className={quiet}>Cancel</button>
              </span>
            ) : <span className="flex items-center gap-1.5">
                {k.name === 'GITHUB_TOKEN' && <GithubSignIn onDone={(text, bad) => { setMsg({ name: k.name, text, bad }); void read() }} />}
                <button onClick={() => { setOpen(k.name); setDraft(''); setMsg(undefined) }} className={quiet}>{k.shared ? 'Replace' : 'Paste'}</button>
              </span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** GitHub's sign-in beside its token: a code to enter on github.com, then the token it gets is kept like a pasted one. */
function GithubSignIn({ onDone }: { onDone: (text: string, bad?: boolean) => void }) {
  const [code, setCode] = useState<{ code: string; url: string }>()
  useEffect(() => {
    if (!code) return
    const t = setInterval(() => {
      void api('/github/login').then((s: { done: boolean; ok: boolean; error?: string; login?: string } | null) => {
        if (!s?.done) return
        clearInterval(t); setCode(undefined)
        onDone(s.ok ? `Signed in${s.login ? ` as ${s.login}` : ''}. Every machine uses it within 30 seconds` : s.error ?? 'The sign-in didn’t finish', !s.ok)
      }, () => {})
    }, 2000)
    return () => clearInterval(t)
  }, [code?.code]) // eslint-disable-line react-hooks/exhaustive-deps
  if (code) return <a href={code.url} target="_blank" rel="noreferrer" title="Open it and enter this code" className="rounded-md bg-fill px-2 py-0.5 font-mono text-small font-semibold tracking-wider text-fg-1 ring-1 ring-line hover:ring-accent/50">{code.code}</a>
  return <button onClick={() => void api('/github/login', {}).then(setCode, (e: Error) => onDone(e.message, true))} className={quiet}>Sign in</button>
}
