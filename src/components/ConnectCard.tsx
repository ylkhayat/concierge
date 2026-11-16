import { ExternalLink, LoaderCircle, PlugZap, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Connection } from '../../server/connections.ts'
import { api } from '../lib.ts'

const SERVICE: Record<string, string> = { 'linear-key': 'Linear', 'sentry-token': 'Sentry' }

/**
 * When the agents can't reach a service (its browser login lives in the Mac's Keychain, out of the container's reach):
 * connect it with a key, the app's own (Linear) or one you paste (Sentry), then run the ticket again.
 */
// ponytail: dismissals are per browser (localStorage); move to the server if the phone should share them
const HIDDEN = 'connect:hidden'
const hiddenNow = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN) ?? '[]') } catch { return [] } }

/** `compact`: on a ticket page, one line you can open or dismiss (Settings › Connections keeps the full card). */
export function ConnectCard({ onRun, toast, compact }: { onRun?: () => void; toast: (m: string, tone?: 'ok' | 'error') => void; compact?: boolean }) {
  const [list, setList] = useState<Connection[]>()
  const [done, setDone] = useState<string[]>([])
  const [hidden, setHidden] = useState(hiddenNow)
  const [open, setOpen] = useState<string>()
  const hide = (fix: string) => { const h = [...new Set([...hidden, fix])]; setHidden(h); try { localStorage.setItem(HIDDEN, JSON.stringify(h)) } catch { /* private window */ } }
  useEffect(() => {
    // asked again every minute and when you come back to the tab, so a login done elsewhere clears the card
    const read = () => api('/connections').then(setList, () => setList([]))
    read()
    const t = setInterval(read, 60_000)
    const onFocus = () => document.visibilityState === 'visible' && read()
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onFocus) }
  }, [])
  const fixable = (list ?? []).filter((c) => c.fix && !(compact && hidden.includes(c.fix)))
  if (!fixable.length && !done.length) return null
  return (
    <div className="space-y-2">
      {done.length > 0 && (
        <div className="space-y-2 rounded-xl bg-ok/7 p-3 text-small ring-1 ring-ok/20">
          <p className="text-ok-text"><span className="font-semibold">{done.join(' and ')} {done.length === 1 ? 'is' : 'are'} connected</span> for the agents. Runs from now on can use {done.length === 1 ? 'it' : 'them'}.</p>
          {onRun && <button onClick={onRun} className="inline-flex items-center gap-1.5 rounded-lg bg-ok px-2.5 py-1 text-small font-medium text-white hover:bg-ok"><RotateCcw className="size-3.5" />Run again</button>}
        </div>
      )}
      {fixable.map((c) => compact && open !== c.fix ? (
        <p key={c.name} className="flex items-center gap-2 rounded-lg bg-wait/7 px-2.5 py-1.5 text-meta text-wait-text ring-1 ring-wait/20">
          <PlugZap className="size-3.5 shrink-0" /><span className="flex-1">Agents can&apos;t reach {SERVICE[c.fix!] ?? c.name}.</span>
          <button onClick={() => setOpen(c.fix)} className="font-medium underline decoration-wait/40 hover:decoration-current">Connect</button>
          <button onClick={() => hide(c.fix!)} title="Dismiss (Settings › Connections still has it)" aria-label="Dismiss"><X className="size-3.5" /></button>
        </p>
      ) : (
        <Fix key={c.name} c={c} toast={toast} onDone={(l) => { setList(l); setDone((d) => [...new Set([...d, SERVICE[c.fix!] ?? c.name])]) }} />
      ))}
    </div>
  )
}

function Fix({ c, toast, onDone }: { c: Connection; toast: (m: string, tone?: 'ok' | 'error') => void; onDone: (l: Connection[]) => void }) {
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [org, setOrg] = useState('')
  const name = SERVICE[c.fix!] ?? c.name
  const go = () => {
    setBusy(true)
    const call = c.needsKey ? api('/connections/sentry', { token, org }).then((r: { list: Connection[]; orgs: string[] }) => { toast(`Sentry connected (${r.orgs.join(', ')})`); return r.list })
      : api('/connections/connect', { fix: c.fix }).then((l: Connection[]) => { toast(`${name} connected for the agents`); return l })
    call.then(onDone, (e: Error) => toast(e.message, 'error')).finally(() => setBusy(false))
  }
  return (
    <div className="space-y-2 rounded-xl bg-wait/7 p-3 text-small ring-1 ring-wait/20">
      <p className="flex items-start gap-2 text-wait-text"><PlugZap className="mt-0.5 size-4 shrink-0" />
        <span><span className="font-semibold">The agents can&apos;t reach {name}.</span> Its browser login isn&apos;t one the agents can use on every machine; a Sentry auth token works everywhere, set once.
          {c.needsKey ? ' A Sentry auth token works instead.' : ` Your ${name} API key works instead.`}</span></p>
      {c.needsKey && (
        <>
          <p className="text-meta text-wait-text/80">
            Best: an <b>internal integration</b>, owned by the organization rather than a person.{' '}
            <a href="https://sentry.io/settings/developer-settings/new-internal/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-wait-text underline decoration-wait/40 hover:decoration-current">Create one<ExternalLink className="size-3" /></a>
            {' '}(Developer Settings → Custom Integrations → Internal Integration), name it after you, and set Organization, Project and Issue &amp; Event to <b>Read</b>, the rest to No Access: the agents can then look, never change anything. Paste its token. A personal auth token with the same Read scopes works too.
          </p>
          <input value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="off" placeholder="Organization, as in its URL (e.g. acme for acme.sentry.io); optional"
                 className="w-full rounded-lg bg-surface-1 px-2.5 py-1.5 font-mono text-small outline-none ring-1 ring-wait/30 focus:ring-2 focus:ring-wait/60" />
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" placeholder="Integration token…"
                 className="w-full rounded-lg bg-surface-1 px-2.5 py-1.5 font-mono text-small outline-none ring-1 ring-wait/30 focus:ring-2 focus:ring-wait/60" />
        </>
      )}
      <button onClick={go} disabled={busy || (c.needsKey && token.trim().length < 20)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-wait px-2.5 py-1 text-small font-medium text-white hover:bg-wait disabled:opacity-50">
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}{c.needsKey ? `Connect ${name}` : `Connect ${name} with your API key`}
      </button>
    </div>
  )
}
