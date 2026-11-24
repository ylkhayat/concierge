import { CircleCheck, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib.ts'

const btn = 'inline-flex items-center gap-1.5 btn-primary'
const outline = 'inline-flex items-center gap-1.5 btn-outline'

type Check = { checkedAt: string; hasKey: boolean; keyEverywhere: boolean; ok: boolean; machines: { name: string; answered: boolean; hasKey?: boolean; problems: string[] }[] }

/**
 * Sync & security for an account: how its sign-in is kept and moved, in plain words, and a check that asks every machine
 * whether it has the same key (synced), and whether the files that hold the key and the login are private there.
 */
export function AccountSecurity({ account, kind, keyed }: { account: string; kind: string; keyed: boolean }) {
  const [c, setC] = useState<Check>()
  const [busy, setBusy] = useState(false)
  const path = `/accounts/${encodeURIComponent(account)}/security`
  const check = () => { setBusy(true); api(path).then(setC, () => {}).finally(() => setBusy(false)) }
  useEffect(check, [account])
  const fixable = c?.machines.some((m) => m.problems.some((p) => /permissions/.test(p)))
  const fix = () => { setBusy(true); api(`${path}/fix`, {}).then(check, () => setBusy(false)) }

  return (
    <div className="space-y-3">
      <section className="card space-y-2 px-4 py-3.5 text-small text-fg-2">
        <h4 className="text-small font-semibold text-fg-1">How its sign-in is kept</h4>
        {kind === 'claude' && keyed ? <>
          <Fact>One key for every machine. It is kept in <code className="font-mono text-meta">secrets.json</code> in Concierge&apos;s settings folder, readable only by you, never in git.</Fact>
          <Fact>The machines copy it from the main one over your Tailscale network only (encrypted, between your own devices), and only with Concierge&apos;s machine key.</Fact>
          <Fact>Agents&apos; logs and output hide it. The key can run Claude models on this account&apos;s plan; it can&apos;t read your claude.ai chats or change the account.</Fact>
          <Fact>It lasts a year. Removing it here stops Concierge using it; to cancel it for good, revoke it in your Claude account.</Fact>
        </> : <>
          <Fact>Each machine signs in on its own, and that sign-in stays on that machine: it is never copied to another one (a copied sign-in would log the other machine out).</Fact>
          <Fact>The sign-in file on each machine is readable only by you. Concierge&apos;s other keys (GitHub, Linear) are kept once and copied to every machine over your Tailscale network only.</Fact>
          {kind === 'claude' && <Fact>Tired of signing in on every machine? Machines → Use one key on all machines.</Fact>}
        </>}
      </section>

      <section className="card px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {!c ? <LoaderCircle className="size-4 animate-spin text-fg-4" /> : c.ok ? <ShieldCheck className="size-4 text-ok-text" /> : <ShieldAlert className="size-4 text-wait-text" />}
          <h4 className="text-small font-semibold text-fg-1">{!c ? 'Checking every machine…' : c.ok ? (c.hasKey ? 'Synced and private on every machine' : 'Private on every machine') : 'Something to look at'}</h4>
          <span className="ml-auto flex gap-2">
            {fixable && <button onClick={fix} disabled={busy} className={btn}>Make the files private</button>}
            <button onClick={check} disabled={busy} className={outline}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}Check now</button>
          </span>
        </div>
        {c && <ul className="mt-2 space-y-1.5">
          {c.machines.map((m) => (
            <li key={m.name} className="text-small">
              <div className="flex items-center gap-2">
                {m.answered && !m.problems.length ? <CircleCheck className="size-3.5 shrink-0 text-ok-text" /> : <span className={`size-1.5 shrink-0 rounded-full ${m.answered ? 'bg-wait' : 'bg-fill-strong'}`} />}
                <span className="font-medium text-fg-1">{m.name}</span>
                {m.answered && !m.problems.length && <span className="text-meta text-fg-3">{c.hasKey ? 'same key, files private' : 'files private'}</span>}
              </div>
              {m.problems.map((p) => <p key={p} className="ml-5 text-meta text-wait-text">{p}</p>)}
            </li>
          ))}
        </ul>}
        {c && <p className="mt-2 text-meta text-fg-4">Checked {new Date(c.checkedAt).toLocaleTimeString()}. A machine that is behind catches up by itself within a minute; check again then.</p>}
      </section>
    </div>
  )
}

const Fact = ({ children }: { children: ReactNode }) => <p className="flex gap-2"><span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-4" aria-hidden />{children}</p>
