import { KeyRound, LoaderCircle, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib.ts'
import { SignInSteps, useMachineSignIn } from './MachineSignIn.tsx'

const btn = 'inline-flex items-center gap-1.5 btn-primary'
const link = 'text-meta font-medium text-accent-text hover:underline' // a word that acts, like the page's other links

type State = 'signed-in' | 'key' | 'signed-out' | 'other-login' | 'no-answer'
export type Machines = { machines: { name: string; state: State; who?: string }[]; login?: string; key?: { set?: string; everywhere: boolean } }
const READY: State[] = ['signed-in', 'key']

/** The machines an account isn't ready on, for its badge ("Not ready on macbookpro"). Machines that didn't answer aren't counted. */
export const notReadyOn = (m?: Machines) => m?.machines.filter((x) => x.state === 'signed-out' || x.state === 'other-login').map((x) => x.name) ?? []

/** Where an account works, asked of every machine; again after a fix. */
export function useAccountMachines(account: string) {
  const [m, setM] = useState<Machines>()
  const [n, setN] = useState(0)
  useEffect(() => { if (account) api(`/accounts/${encodeURIComponent(account)}/machines`).then(setM, () => {}) }, [account, n]) // none: an account that runs the same everywhere
  return [m, () => setN((x) => x + 1)] as const
}

const LINE: Record<State, string> = {
  'signed-in': 'Ready: signed in',
  key: 'Ready: shared key',
  'signed-out': 'Not ready: not signed in',
  'other-login': 'Not ready: signed in as another account',
  'no-answer': "Didn't answer (offline or updating)",
}

/**
 * An account, machine by machine: does it work there, and the fix where it doesn't. Two ways to make it work: sign in on
 * each machine (keeps the account's claude.ai connectors), or one key for all of them (an added Claude account: made
 * once, shared over your tailnet, nothing to sign in and nothing that lapses).
 */
export function AccountMachines({ account, label, m, again, toast }: { account: string; label: string; m?: Machines; again: () => void; toast: (msg: string, tone?: 'ok' | 'error') => void }) {
  const signIn = useMachineSignIn(account, again)
  const [making, setMaking] = useState<{ url?: string; input: string; waiting?: boolean }>()
  const [pasting, setPasting] = useState<string>()
  if (!m) return <p className="mt-3 flex items-center gap-1.5 text-meta text-fg-4"><LoaderCircle className="size-3 animate-spin" />Asking each machine…</p>
  const path = `/accounts/${encodeURIComponent(account)}/token`
  const everywhere = !!m.key?.everywhere
  const setKeyEverywhere = (on: boolean) => api(path, { everywhere: on }).then(() => { again(); toast(on ? `${label} now uses one key on every machine` : `${label} signs in on each machine again`) }, (e: Error) => toast(e.message, 'error'))
  // the key: made here (approved on claude.ai, its code pasted back), then every machine uses it
  const make = () => {
    const tab = window.open('about:blank', '_blank') // opened while the click still counts; it goes to claude.ai below
    setMaking({ input: '' })
    api(`${path}/start`, {}).then((r: { url: string }) => { setMaking({ url: r.url, input: '' }); if (tab) tab.location.href = r.url; else window.open(r.url, '_blank') },
      (e: Error) => { tab?.close(); setMaking(undefined); toast(e.message, 'error') })
  }
  const wait = (tries = 0): void => void api(`${path}/state`).then((s: { done: boolean; ok: boolean; error?: string } | null) => {
    if (s?.done) { setMaking(undefined); if (s.ok) void setKeyEverywhere(true); else toast(s.error ?? 'No key came back: try again', 'error'); return }
    if (tries < 30) setTimeout(() => wait(tries + 1), 2000); else { setMaking(undefined); toast('No key came back: try again', 'error') }
  }, () => {})
  const finish = () => making && api(`${path}/finish`, { input: making.input }).then(() => { setMaking({ ...making, waiting: true }); wait() }, (e: Error) => toast(e.message, 'error'))
  const paste = (v: string) => api(path, { value: v }).then(() => { setPasting(undefined); void setKeyEverywhere(true) }, (e: Error) => toast(e.message, 'error'))
  const busy = !!making || pasting !== undefined || !!signIn.flow
  const notReady = notReadyOn(m)

  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-meta font-semibold text-fg-2">Machines</span>
        <span className="text-meta text-fg-3">
          {everywhere ? 'Every machine uses this account’s one key: nothing to sign in.' : notReady.length ? `Not ready on ${notReady.join(' and ')}.` : 'Ready everywhere it answered.'}
        </span>
        {m.key && !busy && <span className="ml-auto flex gap-3">
          {everywhere
            ? <button onClick={() => setKeyEverywhere(false)} className={link} title="Each machine then needs its own claude.ai sign-in again (which brings the account's claude.ai connectors)">Sign in per machine instead</button>
            : m.key.set
              ? <button onClick={() => setKeyEverywhere(true)} className={link}>Use its key on all machines</button>
              : <button onClick={make} className={link} title="Make one key (approved once on claude.ai) and use it on every machine: no sign-ins, nothing that lapses">Use one key on all machines</button>}
        </span>}
      </div>

      <ul className="mt-1.5 space-y-1">
        {m.machines.map((x) => {
          const ready = READY.includes(x.state), silent = x.state === 'no-answer'
          return (
            <li key={x.name} className="flex flex-wrap items-center gap-2 text-small">
              <span className={`size-1.5 shrink-0 rounded-full ${ready ? 'bg-ok' : silent ? 'bg-fill-strong' : 'bg-wait'}`} aria-hidden />
              <span className="font-medium text-fg-1">{x.name}</span>
              <span className={`text-meta ${ready ? 'text-fg-3' : silent ? 'text-fg-4' : 'text-wait-text'}`}>
                {LINE[x.state]}{x.state === 'signed-in' && x.who ? ` as ${x.who}` : x.state === 'other-login' && x.who ? ` (${x.who}${m.login ? `, not ${m.login}` : ''})` : ''}
              </span>
              {!ready && !silent && !busy && (
                <button onClick={() => signIn.start(x.name)} className={`ml-auto ${btn}`}>{x.state === 'other-login' ? <RotateCcw className="size-3.5" /> : null}Sign in on {x.name}</button>
              )}
            </li>
          )
        })}
      </ul>

      <SignInSteps s={signIn} />

      {making && (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2 text-small">
          {!making.url ? <p className="text-fg-3">Starting…</p> : <>
            <p className="text-fg-2">1. Approve it in the tab that opened (<a href={making.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">open again</a>).</p>
            <div className="flex gap-1.5">
              <input value={making.input} onChange={(e) => setMaking({ ...making, input: e.target.value })} placeholder="2. Paste the code it shows" aria-label="Code" className="min-w-0 flex-1 rounded-md bg-surface-1 px-2 py-1 font-mono text-meta ring-1 ring-line-strong" />
              <button onClick={finish} disabled={!making.input.trim() || making.waiting} className={btn}>{making.waiting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}Finish</button>
            </div>
          </>}
          <span className="flex gap-3">
            <button onClick={() => setMaking(undefined)} className="text-meta text-fg-4 hover:text-fg-1">Cancel</button>
            <button onClick={() => { setMaking(undefined); setPasting('') }} className="text-meta text-fg-4 hover:text-fg-1">I already have a key (from claude setup-token)</button>
          </span>
        </div>
      )}
      {pasting !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-small">
          <KeyRound className="size-3.5 text-fg-3" />
          <input value={pasting} onChange={(e) => setPasting(e.target.value)} placeholder="sk-ant-oat…" type="password" aria-label="Key" className="w-72 rounded-md bg-surface-1 px-2 py-1 font-mono text-meta ring-1 ring-line-strong" />
          <button onClick={() => paste(pasting.trim())} disabled={!pasting.trim()} className={btn}>Use on all machines</button>
          <button onClick={() => setPasting(undefined)} className="text-meta text-fg-4 hover:text-fg-1">Cancel</button>
        </div>
      )}
      {everywhere && m.key?.set && <p className="mt-1.5 text-meta text-fg-4">Key made {new Date(m.key.set).toLocaleDateString()}; it lasts a year. Runs on it don&apos;t have the account&apos;s claude.ai connectors (Linear and GitHub still work through Concierge&apos;s own keys).</p>}
    </div>
  )
}

/** An account's Machines section, asking for itself; tells the card which machines it isn't ready on (its badge). */
export function AccountMachinesFor({ account, label, toast, onNotReady }: { account: string; label: string; toast: (msg: string, tone?: 'ok' | 'error') => void; onNotReady: (machines: string[]) => void }) {
  const [m, again] = useAccountMachines(account)
  const key = notReadyOn(m).join(',')
  useEffect(() => { if (m) onNotReady(key ? key.split(',') : []) }, [key, !!m])
  return <AccountMachines account={account} label={label} m={m} again={again} toast={toast} />
}
