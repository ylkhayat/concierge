import { ChevronRight, CircleCheck, Copy, Eye, EyeOff, ExternalLink, LoaderCircle, PlugZap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Connection } from '../../server/connections.ts'
import { api } from '../lib.ts'
import { ArmBar, ArmLabel, useArm } from '../arm.tsx'
import { ConnectCard } from './ConnectCard.tsx'
import { SignInSteps, useMachineSignIn } from './MachineSignIn.tsx'
import { Tabs } from './Tabs.tsx'

type Toast = (m: string, tone?: 'ok' | 'error') => void

/** Settings → Connections: what every agent (reviews, revisions, exec runs) can reach, and how to set each up. */
export function Connections({ toast }: { toast: Toast }) {
  return (
    <div className="space-y-6">
      <Section title="Shared connections" hint="Connections Concierge holds itself: every agent run gets them, whichever account or tool does the work.">
        <Bank toast={toast} />
      </Section>
      <Section title="Connectors" hint="What agents can reach on each account. Set up once; every machine gets them.">
        <PerAccount toast={toast} />
      </Section>
      <Section title="Azure" hint="Your Azure login, for reading logs and resources in investigations. Agents can only read.">
        <Azure toast={toast} />
      </Section>
    </div>
  )
}

type BankView = { only: boolean; file?: string; servers: { name: string; service: string; how: 'key' | 'login'; mine: boolean; target: string; missing?: string[]; edit?: { kind: 'address'; url: string } | { kind: 'command'; command: string; env: string[] } }[] }
/**
 * The connection bank: what is in it, how each signs in, whether runs get only the bank, and a way to put one in.
 * An account's own connections (below) differ per account; these are the same for every run.
 */
/** Which workspaces may use each connection (none ticked: all of them), for the bank's rows and the connectors' alike. */
function useScope(toast: Toast) {
  const [scope, setScope] = useState<Record<string, string[]>>({})
  const [owners, setOwners] = useState<string[]>([])
  useEffect(() => {
    api('/setup?light=1').then((d: { config: { connections?: { scope?: Record<string, string[]> } } }) => setScope(d.config.connections?.scope ?? {}), () => {})
    api('/orgs').then((o: { owner: string }[]) => setOwners(o.map((x) => x.owner)), () => {})
  }, [])
  const keep = (name: string, owner: string) => {
    const was = scope[name] ?? [], next = was.includes(owner) ? was.filter((x) => x !== owner) : [...was, owner]
    setScope({ ...scope, [name]: next })
    api('/connections/scope', { name, owners: next }).then(() => toast(next.length ? `${nameOf(name).name}: only ${next.join(', ')}` : `${nameOf(name).name}: every workspace`), (e: Error) => toast(e.message, 'error'))
  }
  return { scope, owners, keep }
}

function Bank({ toast }: { toast: Toast }) {
  const { scope, owners, keep } = useScope(toast)
  const [b, setB] = useState<BankView>()
  const [form, setForm] = useState<{ kind: 'address' | 'command'; name: string; url: string; key: string; command: string; env: string; was?: string }>()
  const { armed, arm } = useArm() // removing one drops its key: a second click
  useEffect(() => { api('/bank').then(setB, () => setB({ only: false, servers: [] })) }, [])
  const post = (path: string, body: object, said: string) => api(path, body).then((v: BankView) => { setB(v); toast(said); return true }, (e: Error) => { toast(e.message, 'error'); return false })
  if (!b) return <Skeleton rows={2} />
  const field = 'field min-w-0 flex-1 text-small'
  return (
    <div className="space-y-2">
      <div className="card divide-y divide-line">
        {b.file && <p className="px-3.5 py-2 text-meta text-fg-3">Secrets for these live in <code className="font-mono text-fg-2">{b.file.replace(/^\/(Users|home)\/[^/]+/, '~')}</code> on each machine: one <code className="font-mono">NAME=value</code> per line, named in a connection as <code className="font-mono">{'${NAME}'}</code>.</p>}
        {b.servers.length === 0 && <p className="px-3.5 py-3 text-small text-fg-3">No shared connections yet. A service Concierge has a key for (Linear, Sentry) is added by itself; add any other by its MCP address and key, or by the command that starts it.</p>}
        {b.servers.map((s) => (
          <div key={s.name} className="flex items-center gap-2.5 px-3.5 py-2 text-small">
            <span className={`size-1.5 shrink-0 rounded-full ${s.how === 'key' ? 'bg-ok' : 'bg-wait'}`} />
            <span className="font-medium text-fg-1">{s.service}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg-4" title={s.target}>{s.target.replace(/^https:\/\//, '')}</span>
            {!!s.missing?.length && <span className="shrink-0 rounded-full bg-wait/15 px-1.5 text-micro font-medium text-wait-text" title={`Add ${s.missing.join(', ')} to ${b.file ?? 'mcp.env'} on this machine`}>needs {s.missing.join(', ')}</span>}
            <span className="shrink-0 text-meta text-fg-3" title={s.how === 'key' ? 'It signs in with a key Concierge holds: every tool can use it' : 'It signs in in the browser, into a Claude account: Codex and Copilot can’t use it'}>{s.how === 'key' ? 'Every tool' : 'Claude accounts only'}</span>
            {s.mine && s.edit && <button onClick={() => setForm(s.edit!.kind === 'command' ? { kind: 'command', name: s.name, url: '', key: '', command: s.edit!.command, env: s.edit!.env.map((k) => `${k}=`).join('\n'), was: s.name } : { kind: 'address', name: s.name, url: s.edit!.url, key: '', command: '', env: '', was: s.name })} className="shrink-0 text-meta text-fg-3 hover:text-fg-1">Edit</button>}
            {owners.length > 1 && <UsedBy owners={owners} on={scope[s.name] ?? []} onToggle={(o) => keep(s.name, o)} />}
            {s.mine && <button onClick={() => arm(s.name, () => void post('/bank/remove', { name: s.name }, `${s.name} removed`))} className="relative isolate shrink-0 overflow-hidden rounded px-1 text-meta text-fg-4 hover:text-fail-text">{armed === s.name ? <><ArmLabel>Confirm</ArmLabel><ArmBar on="plain" /></> : 'Remove'}</button>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-0.5">
        <Tabs size="sm" label="What a run gets" value={b.only ? 'only' : 'gaps'} onChange={(v) => void post('/bank', { only: v === 'only' }, v === 'only' ? 'Every run now gets only the shared connections' : 'Shared connections now add what an account lacks')}
              options={[{ id: 'gaps', label: 'Add what’s missing', title: 'An account that has a service through its own sign-in keeps that one; the shared connections add what it lacks' }, { id: 'only', label: 'Shared only', title: 'Every run gets exactly the shared connections and nothing of the account’s own, so its tools no longer depend on where it landed' }]} />
        <span className="min-w-0 flex-1 text-meta text-fg-3">{b.only ? 'Every run gets exactly the shared connections: nothing from claude.ai or plugins.' : 'An account keeps what its own sign-in brings; the shared connections add the rest.'}</span>
        {!form && <button onClick={() => setForm({ kind: 'address', name: '', url: '', key: '', command: '', env: '' })} className="btn-outline btn-sm"><PlugZap className="mr-1 size-3.5" />Add a connection</button>}
      </div>
      {form && (
        <div className="card space-y-2 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {form.was ? <span className="text-small font-medium text-fg-1">Editing {form.was}</span> : <Tabs size="sm" label="What it is" value={form.kind} onChange={(k) => setForm({ ...form, kind: k as 'address' | 'command' })}
                  options={[{ id: 'address', label: 'An address', title: 'An MCP server on the web, reached with a key' }, { id: 'command', label: 'A command', title: 'An MCP server Concierge starts itself, with the values it needs' }]} />}
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="name" aria-label="Name" className={`${field} max-w-36 font-mono`} />
          </div>
          {form.kind === 'address' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://… its MCP address" aria-label="MCP address" className={`${field} font-mono`} />
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} type="password" placeholder={form.was ? 'its key, or ${NAME} (empty: keep)' : 'its key, or ${NAME} from mcp.env; empty if it needs none'} aria-label="Key" className={`${field} max-w-64`} />
            </div>
          ) : (
            <div className="space-y-2">
              <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx -y mongodb-mcp-server@latest" aria-label="Command" className={`${field} w-full font-mono`} />
              <textarea value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} rows={3} placeholder={'MDB_MCP_CONNECTION_STRING=${MONGO_DEV_URI}\nMDB_MCP_READ_ONLY=true'} aria-label="Values, one NAME=value per line" className={`${field} w-full resize-y font-mono text-meta`} />
              <p className="text-meta text-fg-4">As the server’s own docs give it. Name a secret as <code className="font-mono">{'${NAME}'}</code> and put <code className="font-mono">NAME=…</code> in <code className="font-mono">{b.file ?? 'mcp.env'}</code> on each machine: it stays there, is never copied to another machine, and is handed to the server only as it starts.{form.was && ' A value left empty keeps the one kept; a line you delete is dropped.'}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setForm(undefined)} className="btn-ghost btn-sm">Cancel</button>
            <button disabled={!form.name.trim() || (form.kind === 'address' ? !form.url.trim() : !form.command.trim())}
                    onClick={() => void post('/bank/add', form.kind === 'address' ? { name: form.name, url: form.url, key: form.key, was: form.was }
                      : { name: form.name, command: form.command, was: form.was, env: Object.fromEntries(form.env.split('\n').map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) }, form.was ? `${form.name} saved` : `${form.name} is in the bank`).then((ok) => ok && setForm(undefined))}
                    className="btn-primary btn-sm">{form.was ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <header className="px-0.5"><h3 className="text-small font-semibold text-fg-1">{title}</h3><p className="text-meta text-fg-3">{hint}</p></header>
      {children}
    </section>
  )
}

/** Each machine's state of an account's connectors (several machines), for the markers on each row. */
// who: the login on each machine; login: the one the account is (one account, one login); off: machines signed in as another
type Where = { machines: string[]; has?: Record<string, Record<string, string>>; signedIn?: Record<string, boolean | null>; silent?: string[]; who?: Record<string, string | undefined>; login?: string; off?: string[] } // null, silent: didn't answer
function useWhere(account: string) {
  const [w, setW] = useState<Where>()
  const [n, setN] = useState(0)
  useEffect(() => { setW(undefined); api(`/connections/where?account=${encodeURIComponent(account)}`).then(setW, () => {}) }, [account, n])
  return [w, () => setN((x) => x + 1)] as const
}

/**
 * Where this account is signed in: each machine needs its own sign-in (its own session, so the machines never undo
 * each other's), made from here for any machine. Everything else (claude.ai connectors, keys) then works everywhere.
 */
function SignedInOn({ a, w, onDone }: { a: AccountRow; w?: Where; onDone: () => void }) {
  const signIn = useMachineSignIn(a.id, onDone)
  const flow = signIn.flow, start = signIn.start
  if (a.kind === 'llama' || !w?.signedIn || w.machines.length < 2) return null
  const silent = (m: string) => w.signedIn![m] === null || !!w.silent?.includes(m)
  const off = (m: string) => !!w.off?.includes(m)
  const missing = w.machines.filter((m) => w.signedIn![m] === false || off(m))
  const adopt = (m: string) => api(`/accounts/${encodeURIComponent(a.id)}/adopt-login`, { machine: m }).then(onDone, () => {})
  const quiet = w.machines.filter(silent)
  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2 text-small">
        <span className="font-medium text-fg-1">Signed in on</span>
        {w.machines.map((m) => (
          <span key={m} title={silent(m) ? `${m} didn't answer: it's offline, or still on an older version (it updates by itself)` : off(m) ? `Signed in on ${m} as ${w.who?.[m]}, not ${w.login}: it takes none of this account's work` : w.signedIn![m] ? `Signed in on ${m}${w.who?.[m] ? ` as ${w.who[m]}` : ''}` : `Not signed in on ${m}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta ring-1 ${silent(m) ? 'text-fg-4 ring-line' : off(m) ? 'text-fail-text ring-fail/30' : w.signedIn![m] ? 'text-fg-2 ring-line' : 'text-wait-text ring-wait/30'}`}>
            <span className={`size-1.5 rounded-full ${silent(m) ? 'bg-fill-strong' : off(m) ? 'bg-fail' : w.signedIn![m] ? 'bg-ok' : 'bg-wait'}`} />{m}{silent(m) ? ' · no answer' : w.who?.[m] ? <span className="text-fg-4">· {w.who[m]}</span> : ''}
          </span>
        ))}
        <span className="ml-auto flex gap-1.5">{missing.map((m) => <button key={m} onClick={() => start(m)} disabled={flow?.machine === m} className={btn}>{off(m) ? 'Sign in again' : 'Sign in'} on {m}</button>)}</span>
      </div>
      {w.login && <p className="mt-1 text-meta text-fg-3">This account is <b className="font-medium text-fg-2">{w.login}</b> on every machine: its plan, limits and spend are that login&apos;s.</p>}
      {w.off?.map((m) => (
        <p key={m} className="mt-1.5 rounded-lg bg-fail/7 px-2.5 py-1.5 text-meta text-fail-text ring-1 ring-fail/20">
          {m} has it signed in as {w.who?.[m]}, so {m} takes none of its work. Sign it in again there as {w.login}, or{' '}
          <button onClick={() => adopt(m)} className="font-medium underline decoration-fail/40 hover:decoration-current">make {w.who?.[m]} this account&apos;s login</button>{' '}
          (the other machines then sign in again). Two plans? Add the other as its own account.
        </p>
      ))}
      {!missing.length && !quiet.length && <p className="mt-1 text-meta text-fg-3">Every machine is signed in: connectors added on claude.ai for this account work everywhere.</p>}
      {!!quiet.length && <p className="mt-1 text-meta text-fg-3">{quiet.join(', ')} didn&apos;t answer: offline, or still updating to this version. Its markers fill in once it does.</p>}
      <SignInSteps s={signIn} />
    </div>
  )
}
/** One small marker per machine: connected there, needs a login there, or not there at all. Nothing with one machine. */
function OnMachines({ w, name }: { w?: Where; name: string }) {
  if (!w?.machines.length || w.machines.length < 2) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {w.machines.map((m) => {
        const st = w.has?.[m]?.[name], silent = !w.has?.[m]
        return <span key={m} title={`${m}: ${silent ? "didn't answer" : st === 'connected' ? 'connected' : st === 'needs-auth' ? 'needs a login on this machine' : st ? 'failed here' : 'not on this machine yet'}`}
                     className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-micro ring-1 ${st === 'connected' ? 'text-fg-2 ring-line' : st === 'needs-auth' ? 'text-wait-text ring-wait/30' : 'text-fg-4 ring-line'}`}>
          <span className={`size-1.5 rounded-full ${st === 'connected' ? 'bg-ok' : st === 'needs-auth' ? 'bg-wait' : st ? 'bg-fail' : 'bg-fill-strong'}`} />{m}
        </span>
      })}
    </span>
  )
}
/** A list still being asked for: its rows' shape, quietly pulsing. */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 card p-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-2" style={{ animationDelay: `${i * 90}ms` }}>
          <span className="size-2 rounded-full bg-fill-strong" />
          <span className="h-2.5 rounded bg-fill-strong" style={{ width: `${30 + ((i * 17) % 35)}%` }} />
          <span className="ml-auto h-2.5 w-16 rounded bg-fill" />
        </div>
      ))}
    </div>
  )
}

const chip = 'inline-flex items-center rounded-md px-2 py-0.5 text-meta font-medium text-fg-2 ring-1 ring-line transition-colors hover:text-fg-1 hover:ring-line-strong'
const btn = 'inline-flex items-center gap-1.5 btn-primary'
type AccountRow = { id: string; label: string; kind: 'claude' | 'openai' | 'llama' | 'copilot'; builtIn: boolean }
type AccountConn = { name: string; status: Connection['status']; via: 'claude.ai' | 'claude code' | 'codex' }
const KIND_LABEL = { claude: 'Claude', openai: 'OpenAI', llama: 'Llama' }

/** A tab per account; the first Claude account's connectors can be fixed here (a key, a login), the others' only listed. */
function PerAccount({ toast }: { toast: Toast }) {
  const [accounts, setAccounts] = useState<AccountRow[]>()
  const [tab, setTab] = useState('claude')
  useEffect(() => { api('/providers').then((r: { accounts: AccountRow[] }) => setAccounts(r.accounts), () => setAccounts([])) }, [])
  if (!accounts) return <Skeleton rows={3} />
  const a = accounts.find((x) => x.id === tab) ?? accounts[0]
  return (
    <div className="space-y-2">
      <Tabs as="tab" label="Account" value={a.id} onChange={setTab} options={accounts.map((x) => ({ id: x.id, label: x.label }))} />
      {a.id === 'claude' ? <Services toast={toast} /> : <AccountList a={a} toast={toast} />}
    </div>
  )
}

/** Another account's connectors, as its own sign-in has them: listed, with what to do about the ones that don't work. */
function AccountList({ a, toast }: { a: AccountRow; toast: Toast }) {
  const [list, setList] = useState<AccountConn[]>()
  const [busy, setBusy] = useState(false)
  const read = (fresh = false) => { setBusy(true); return api(`/accounts/${encodeURIComponent(a.id)}/connections${fresh ? '?fresh=1' : ''}`).then(setList, () => setList([])).finally(() => setBusy(false)) }
  const [w, again] = useWhere(a.id)
  useEffect(() => { setList(undefined); void read() }, [a.id])
  if (!list) return <Skeleton />
  const how = a.kind === 'claude' ? `A claude.ai connector is connected on claude.ai, signed in as ${a.label}'s account; a Claude Code one logs in here, into ${a.label}'s own folder.`
    : a.kind === 'llama' ? 'These are the Claude Code connectors of your first Claude account: Claude Code leaves claude.ai\'s out when it talks to a local model.'
    : 'Add one with codex mcp add (in its own folder, for an account you added).'
  return (
    <div className="space-y-1.5">
      <SignedInOn a={a} w={w} onDone={() => { again(); void read(true) }} />
      <Muting items={list} toneOf={(c) => (c.status === 'connected' ? 'ok' : c.status === 'needs-auth' ? 'warn' : 'bad')} row={(c, hide) => (
          <ConnectorRow key={c.name} raw={c.name} hide={hide} extra={<OnMachines w={w} name={c.name} />}
            tone={c.status === 'connected' ? 'ok' : c.status === 'needs-auth' ? 'warn' : 'bad'}
            status={c.status === 'connected' ? 'Connected' : c.status === 'needs-auth' ? 'Needs sign-in' : 'Failed'}
            action={c.status === 'needs-auth' && (c.via === 'claude.ai'
              ? <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" title={`On claude.ai, signed in as ${a.label}'s account`} className={chip}>Connect</a>
              : c.via === 'claude code' && a.kind !== 'openai' && <Login name={c.name} account={a.kind === 'claude' ? a.id : undefined} toast={toast} onDone={() => void read(true)} />)} />
        )} />
      <p className="flex items-center gap-2 px-0.5 text-meta text-fg-4">{how}
        <button onClick={() => void read(true)} disabled={busy} className="ml-auto shrink-0 font-medium text-fg-3 hover:text-fg-1 disabled:opacity-40">{busy ? 'Checking…' : 'Refresh'}</button></p>
    </div>
  )
}

function Services({ toast }: { toast: Toast }) {
  const [list, setList] = useState<Connection[]>()
  const [custom, setCustom] = useState<string[]>([])
  useEffect(() => { api('/connections').then(setList, () => setList([])); api('/connections/custom').then(setCustom, () => {}) }, [])
  const [w, again] = useWhere('claude')
  const { scope, owners, keep } = useScope(toast)
  const drop = (name: string) => api('/connections/custom', { name, remove: true }).then((l: Connection[]) => { setList(l); setCustom((c) => c.filter((x) => x !== name)); toast(`${name} removed`) }, (e: Error) => toast(e.message, 'error'))
  if (!list) return <Skeleton rows={7} />
  return (
    <div className="space-y-2">
      <SignedInOn a={{ id: 'claude', label: 'Claude', kind: 'claude', builtIn: true }} w={w} onDone={() => { again(); void api('/connections?fresh=1').then(setList, () => {}) }} />
      <ConnectCard toast={toast} />
      <Muting items={list} toneOf={(c) => (c.status === 'connected' || c.coveredBy ? 'ok' : c.status === 'needs-auth' ? 'warn' : 'bad')} row={(c, hide) => (
          <ConnectorRow key={c.name} raw={c.name} hide={hide}
            extra={<>{custom.includes(c.name) && <button onClick={() => void drop(c.name)} className="text-meta text-fg-4 hover:text-fail-text">Remove</button>}<OnMachines w={w} name={c.name} />{owners.length > 1 && <UsedBy owners={owners} on={scope[c.name] ?? []} onToggle={(o) => keep(c.name, o)} />}</>}
            tone={c.status === 'connected' || c.coveredBy ? 'ok' : c.status === 'needs-auth' ? 'warn' : 'bad'}
            status={c.coveredBy ? `Via ${nameOf(c.coveredBy).name}` : c.status === 'connected' ? 'Connected' : c.status === 'needs-auth' ? 'Needs sign-in' : 'Failed'}
            action={c.status === 'needs-auth' && !c.coveredBy && (c.name.startsWith('claude.ai ')
              ? <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" title="On claude.ai, signed in with the agents' account" className={chip}>Connect</a>
              : <Login name={c.name} toast={toast} onDone={setList} />)} />
        )} />
      <AddConnector />
    </div>
  )
}

/** Which workspaces' runs may use a connection: none ticked, every one; ticked, only those (the rest are refused its tools). */
function UsedBy({ owners, on, onToggle }: { owners: string[]; on: string[]; onToggle: (owner: string) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1" title="Workspaces whose runs may use it. None ticked: every workspace">
      <span className="text-meta text-fg-4">{on.length ? 'Only' : 'All'}</span>
      {owners.map((o) => (
        <button key={o} onClick={() => onToggle(o)} aria-pressed={on.includes(o)}
                className={`rounded-full px-2 py-0.5 font-mono text-micro transition-colors ${on.includes(o) ? 'bg-accent/15 text-accent-text' : 'bg-fill text-fg-4 hover:text-fg-2'}`}>{o}</button>
      ))}
    </span>
  )
}

/**
 * A connector that isn't in the list: added at claude.ai (a custom connector, by its MCP address), so it belongs to the
 * account and every machine signed in to it has it, with one login. Added on the machines instead, each would need its own.
 */
function AddConnector() {
  return (
    <p className="flex flex-wrap items-center gap-2 px-0.5 text-meta text-fg-4">
      <PlugZap className="size-3.5" />Add one on claude.ai, by any MCP address: it shows up here and works on every machine.
      <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-fg-3 hover:text-fg-1">Open claude.ai connectors<ExternalLink className="size-3" /></a>
    </p>
  )
}

/** A connector's name as people say it, and where it comes from: "claude.ai Sentry" → Sentry, claude.ai. */
export function nameOf(raw: string): { name: string; source: string } {
  if (raw.startsWith('claude.ai ')) return { name: raw.slice(10), source: 'claude.ai' }
  const plug = /^plugin:[^:]+:(.+)$/.exec(raw)
  if (plug) return { name: plug[1].replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()), source: 'plugin' }
  return { name: raw, source: 'local' }
}
type Tone = 'ok' | 'warn' | 'bad' | 'off'
const TONE: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-wait', bad: 'bg-fail', off: 'bg-fill-strong' }
const TEXT: Record<Tone, string> = { ok: 'text-fg-3', warn: 'text-wait-text', bad: 'text-fail-text', off: 'text-fg-4' }
/** One connector, in the same columns everywhere: status, name and source, what's wrong, what to do, where it works. */
function ConnectorRow({ raw, tone, status, action, extra, hide }: { raw: string; tone: Tone; status: string; action?: ReactNode; extra?: ReactNode; hide: ReactNode }) {
  const { name, source } = nameOf(raw)
  return (
    <li className="group flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2">
      <span className={`size-2 shrink-0 rounded-full ${TONE[tone]}`} aria-hidden />
      <span className="flex min-w-0 flex-1 items-baseline gap-2" title={raw}>
        <span className="truncate text-small font-medium text-fg-1">{name}</span>
        <span className="shrink-0 text-micro text-fg-4">{source}</span>
      </span>
      {extra}
      <span className={`shrink-0 text-meta ${TEXT[tone]}`}>{status}</span>
      {action && <span className="contents">{action}</span>}
      <span className="w-4 shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">{hide}</span>
    </li>
  )
}
const RANK: Record<Tone, number> = { bad: 0, warn: 1, ok: 2, off: 3 }
/**
 * The connector list: what needs you first, then the rest; the ones you don't use folded away under one line at the
 * bottom (kept on the server, so every device and account tab shares it).
 */
function Muting<T extends { name: string }>({ items, toneOf, row }: { items: T[]; toneOf: (c: T) => Tone; row: (c: T, hide: ReactNode) => ReactNode }) {
  const [muted, setMuted] = useState<string[]>([])
  useEffect(() => { api('/connections/muted').then(setMuted, () => {}) }, [])
  const set = (name: string, on: boolean) => api('/connections/muted', { name, on }).then(setMuted, () => {})
  const btn = (name: string, on: boolean) => (
    <button onClick={() => void set(name, on)} title={on ? "Hide: you don't use it" : 'Show it again'} aria-label={on ? `Hide ${name}` : `Show ${name}`}
            className="text-fg-4 transition-colors hover:text-fg-1">
      {on ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
    </button>
  )
  const sort = (l: T[]) => [...l].sort((a, b) => RANK[toneOf(a)] - RANK[toneOf(b)] || nameOf(a.name).name.localeCompare(nameOf(b.name).name))
  const shown = sort(items.filter((c) => !muted.includes(c.name))), hidden = sort(items.filter((c) => muted.includes(c.name)))
  const ok = shown.filter((c) => toneOf(c) === 'ok').length
  return (
    <div className="overflow-hidden card">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-meta text-fg-3">
        <span className="font-medium text-fg-2">{ok} of {shown.length} working</span>
        {shown.length > ok && <span className="text-wait-text">· {shown.length - ok} need you</span>}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((c) => row(c, btn(c.name, true)))}
        {!items.length && <li className="px-3.5 py-3 text-small text-fg-3">None yet.</li>}
      </ul>
      {!!hidden.length && (
        <details className="group/hidden border-t border-line">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2 text-meta text-fg-3 hover:text-fg-1">
            <ChevronRight className="size-3.5 transition-transform group-open/hidden:rotate-90" />{hidden.length} hidden
          </summary>
          <ul className="divide-y divide-line opacity-70">{hidden.map((c) => row(c, btn(c.name, false)))}</ul>
        </details>
      )}
    </div>
  )
}

/**
 * A browser login for a connector that only offers one: the provider's page opens in a new tab; approving finishes it
 * on this machine by itself. From another device the browser can't reach this machine's localhost, so its address is pasted.
 */
/** Log a Claude Code connector in for the agents: the first account's, or (`account`) another Claude account's own. */
function Login({ name, account, toast, onDone }: { name: string; account?: string; toast: Toast; onDone: (l: Connection[]) => void }) {
  const q = account ? `?account=${encodeURIComponent(account)}` : ''
  const [state, setState] = useState<'idle' | 'starting' | 'waiting'>('idle')
  const [redirect, setRedirect] = useState('')
  useEffect(() => {
    if (state !== 'waiting') return
    const t = setInterval(() => api(`/connections/login/${encodeURIComponent(name)}${q}`).then((r: { done?: boolean; ok?: boolean; list?: Connection[] }) => {
      if (!r.done) return
      clearInterval(t); setState('idle')
      if (r.list) onDone(r.list)
      toast(r.ok ? `${name}: logged in for the agents` : `${name}: the login didn't finish; try again`, r.ok ? 'ok' : 'error')
    }, () => {}), 3000)
    return () => clearInterval(t)
  }, [state])
  const start = () => {
    setState('starting')
    // the tab opens now (a popup opened later would be blocked), then goes to the provider's page
    const tab = window.open('about:blank', '_blank')
    api('/connections/login', { name, account }).then((r: { url: string }) => { if (tab) tab.location.href = r.url; else window.open(r.url, '_blank'); setState('waiting') },
      (e: Error) => { tab?.close(); setState('idle'); toast(e.message, 'error') })
  }
  const finish = () => api('/connections/login/finish', { name, redirect, account }).then(() => toast('Finishing the login…'), (e: Error) => toast(e.message, 'error'))
  if (state === 'idle') return <button onClick={start} className={chip}>Sign in</button>
  // its sign-in returns to http://localhost:<port>/callback, which is the machine running Concierge only from a browser
  // on that machine: from anywhere else the page won't load, and its address is pasted here instead
  const elsewhere = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
  return (
    <span className="flex w-full basis-full flex-col gap-1.5 rounded-lg bg-accent/5 p-2.5 text-meta text-fg-2 ring-1 ring-accent/20 ">
      <span className="flex items-center gap-1.5"><LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent" />{state === 'starting' ? 'Opening the sign-in…' : <>1. Approve <b>{name}</b> in the tab that opened.</>}</span>
      {state === 'waiting' && elsewhere && (
        <>
          <span>2. It then goes to a page at <code className="font-mono">http://localhost:…/callback</code> that won&apos;t load: that address is meant for the machine running Concierge. Copy the whole address from that tab and paste it here:</span>
          <span className="flex items-center gap-1.5">
            <input autoFocus value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="http://localhost:51426/callback?code=…" className="min-w-0 flex-1 rounded-md bg-surface-1 px-2 py-1 font-mono text-meta ring-1 ring-line-strong" />
            <button onClick={finish} disabled={!/^https?:\/\/localhost[:/]/.test(redirect.trim())} className="rounded-md bg-accent px-2.5 py-1 font-medium text-on-accent disabled:opacity-40">Finish</button>
          </span>
        </>
      )}
      {state === 'waiting' && !elsewhere && <span>2. It comes back here by itself.</span>}
    </span>
  )
}

type ClaudeAuth = { loggedIn: boolean; method?: string; email?: string; usingLogin: boolean; lapsed?: string; login?: { done: boolean; ok: boolean } }

/** Sign the agents in with claude.ai (once, approved in your browser), or go back to the model-only token. */
/** The first Claude account's sign-in: its claude.ai login (with its connectors), or the model-only token. */
export function ClaudeAccount({ toast }: { toast: Toast }) {
  const [a, setA] = useState<ClaudeAuth>()
  const [waiting, setWaiting] = useState(false)
  const [code, setCode] = useState('')
  const read = () => api('/claude-auth').then(setA, () => {})
  useEffect(() => { read() }, [])
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => api('/claude-auth').then((r: ClaudeAuth) => {
      if (!r.login?.done) return
      setA(r); setWaiting(false)
      toast(r.login.ok ? 'Agents now run on your claude.ai account' : "The sign-in didn't finish; try again", r.login.ok ? 'ok' : 'error')
    }, () => {}), 3000)
    return () => clearInterval(t)
  }, [waiting])
  const start = () => {
    const tab = window.open('about:blank', '_blank')
    api('/claude-auth/login', {}).then((r: { url: string }) => { if (tab) tab.location.href = r.url; else window.open(r.url, '_blank'); setWaiting(true) },
      (e: Error) => { tab?.close(); toast(e.message, 'error') })
  }
  const finish = () => api('/claude-auth/finish', { input: code }).then(() => { setCode(''); toast('Finishing the sign-in…') }, (e: Error) => toast(e.message, 'error'))
  const backToToken = () => api('/claude-auth/token', {}).then(read)
  if (!a) return null
  return (
    <div className="space-y-2 text-small">
      {a.usingLogin
        ? <p className="flex items-center gap-1.5 text-meta text-fg-3"><CircleCheck className="size-3.5 text-ok-text" />Through claude.ai, with its connectors
            <span className="text-fg-4">·</span><button onClick={backToToken} className="hover:text-fg-1 hover:underline">Use the token instead</button></p>
        : !a.loggedIn ? <p className="text-meta text-fg-3">Sign in with your claude.ai plan.</p>
        : <p className="text-meta text-fg-3">On the setup token: models only, without claude.ai connectors.
            {a.lapsed && <span className="text-wait-text"> The claude.ai sign-in expired {new Date(a.lapsed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.</span>}</p>}
      {!a.usingLogin && !waiting && <button onClick={start} className="rounded-md px-2 py-0.5 text-meta font-medium text-accent-text ring-1 ring-accent/30 hover:bg-accent/10">Sign in with claude.ai</button>}
      {waiting && (
        <span className="flex items-center gap-1.5 text-meta text-fg-3">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />Approve in the new tab, then paste the code it shows:
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-56 rounded-md bg-surface-1 px-1.5 py-0.5 font-mono text-meta ring-1 ring-line-strong" />
          <button onClick={finish} disabled={!code.trim()} className="rounded-md px-1.5 py-0.5 font-medium text-accent-text ring-1 ring-accent/30 disabled:opacity-40">Finish</button>
        </span>
      )}
    </div>
  )
}

/** Azure: your own login, signed in with a one-time code; agents get its reading commands only. */
function Azure({ toast }: { toast: Toast }) {
  const [st, setSt] = useState<{ signedIn: boolean; user?: string; subscription?: string }>()
  const [got, setGot] = useState<{ code: string; url: string }>()
  const [busy, setBusy] = useState(false)
  const read = () => api('/azure').then(setSt, () => {})
  useEffect(() => { read() }, [])
  useEffect(() => {
    if (!got) return
    const t = setInterval(() => api('/azure').then((r: { login?: { done: boolean; ok: boolean; error?: string } }) => {
      if (!r.login?.done) return
      clearInterval(t); setGot(undefined); read()
      toast(r.login.ok ? 'Signed in to Azure' : `The Azure sign-in didn't finish${r.login.error ? `: ${r.login.error}` : ''}`, r.login.ok ? 'ok' : 'error')
    }, () => {}), 3000)
    return () => clearInterval(t)
  }, [got])
  const start = () => { setBusy(true); api('/azure/login', {}).then(setGot, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false)) }
  if (!st) return <Skeleton rows={1} />
  if (got) return (
    <div className="space-y-1.5 text-small text-fg-3">
      <p>Open <a href={got.url} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">{got.url.replace('https://', '')}<ExternalLink className="ml-0.5 inline size-3" /></a> and enter this code:</p>
      <button onClick={() => navigator.clipboard?.writeText(got.code).then(() => toast('Code copied'))} className="inline-flex items-center gap-1.5 rounded-lg bg-fill px-2 py-1 font-mono text-reading font-semibold tracking-wider hover:bg-active">{got.code}<Copy className="size-3 text-fg-3" /></button>
      <p className="flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" />Waiting for you to approve…</p>
    </div>
  )
  return (
    <div className="flex min-h-12 items-center gap-3 card px-3.5 py-2.5">
      <span className={`size-2 shrink-0 rounded-full ${st.signedIn ? 'bg-ok' : 'bg-fill-strong'}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-medium text-fg-1">{st.signedIn ? st.user : 'Not signed in'}</span>
        {st.signedIn && st.subscription && <span className="block truncate text-meta text-fg-3">{st.subscription}</span>}
      </span>
      <button onClick={start} disabled={busy} className={st.signedIn ? chip : btn}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}{st.signedIn ? 'Sign in again' : 'Sign in to Azure'}</button>
    </div>
  )
}
