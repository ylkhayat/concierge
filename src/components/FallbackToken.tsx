import { KeyRound, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib.ts'
import type { AccountView, ProvidersView } from './Settings.tsx'

const btn = 'inline-flex items-center gap-1.5 btn-primary'
const link = 'text-meta font-medium text-accent-text hover:underline' // a word that acts, like the page's other links

/**
 * An added Claude account's fallback token (claude setup-token: a year long, models only). A claude.ai login can stop
 * working on one machine; with this set, that machine's runs for the account go on the token instead of waiting for a
 * sign-in, and are back on the login once it is signed in again. Made here in the browser, or pasted.
 */
export function FallbackToken({ a, onChange, toast }: { a: AccountView; onChange: (v: ProvidersView) => void; toast: (msg: string, tone?: 'ok' | 'error') => void }) {
  const [making, setMaking] = useState<{ url?: string; input: string; waiting?: boolean }>()
  const [pasting, setPasting] = useState<string>()
  const t = a.fallbackToken
  if (!t) return null
  const path = `/accounts/${encodeURIComponent(a.id)}/token`
  const refresh = () => api('/providers').then(onChange, () => {})
  const save = (value: string | null) => api(path, { value }).then((r: ProvidersView) => { onChange(r); setPasting(undefined); toast(value ? 'Fallback token set' : 'Fallback token removed') }, (e: Error) => toast(e.message, 'error'))
  const everywhere = (on: boolean) => api(path, { everywhere: on }).then((r: ProvidersView) => { onChange(r); toast(on ? `${a.label} runs on its key on every machine` : `${a.label} signs in on each machine again`) }, (e: Error) => toast(e.message, 'error'))
  const make = () => {
    const tab = window.open('about:blank', '_blank') // opened while the click still counts; it goes to claude.ai below
    setMaking({ input: '' })
    api(`${path}/start`, {}).then((r: { url: string }) => { setMaking({ url: r.url, input: '' }); if (tab) tab.location.href = r.url; else window.open(r.url, '_blank') },
      (e: Error) => { tab?.close(); setMaking(undefined); toast(e.message, 'error') })
  }
  const wait = (tries = 0): void => void api(`${path}/state`).then((s: { done: boolean; ok: boolean; error?: string } | null) => {
    if (s?.done) { setMaking(undefined); void refresh(); toast(s.ok ? 'Fallback token made and kept' : s.error ?? 'No token came back', s.ok ? 'ok' : 'error'); return }
    if (tries < 30) setTimeout(() => wait(tries + 1), 2000); else { setMaking(undefined); toast('No token came back: start it again', 'error') }
  }, () => {})
  const finish = () => making && api(`${path}/finish`, { input: making.input }).then(() => { setMaking({ ...making, waiting: true }); wait() }, (e: Error) => toast(e.message, 'error'))
  return (
    <div className="mt-2 rounded-lg bg-fill/50 px-2.5 py-2 text-meta text-fg-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KeyRound className="size-3.5 shrink-0" />
        <span className="font-medium text-fg-2">{t.everywhere ? 'Key' : 'Fallback token'}</span>
        {t.set
          ? <span>set {new Date(t.set).toLocaleDateString()}{t.everywhere ? ' · used on every machine' : t.inUse ? <b className="font-medium text-wait-text"> · in use here: its login on this machine stopped working</b> : ''}</span>
          : <span className="text-wait-text">none: if its login stops working on a machine, that machine takes none of its work</span>}
        {!making && pasting === undefined && <span className="ml-auto flex gap-3">
          <button onClick={make} className={link}>{t.set ? 'Make a new one' : 'Make one'}</button>
          <button onClick={() => setPasting('')} className={link}>Paste one</button>
          {t.set && <button onClick={() => save(null)} className={`${link} text-fail-text`}>Remove</button>}
        </span>}
      </div>
      {t.everywhere
        ? <p className="mt-1">Every machine runs this account on this one key, shared with them over your tailnet: no sign-in on any machine, nothing that lapses (it lasts a year). Runs don&apos;t have the account&apos;s claude.ai connectors.</p>
        : <p className="mt-1">Used only on a machine where this account&apos;s claude.ai login stopped working, until it is signed in again there. Runs on it don&apos;t have the account&apos;s claude.ai connectors.</p>}
      {t.set && (
        <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-fg-2">
          <input type="checkbox" checked={t.everywhere} onChange={(e) => everywhere(e.target.checked)} className="accent-current" />
          Use this key on every machine (no sign-in per machine)
        </label>
      )}
      {making && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-small">
          {!making.url ? <span className="text-fg-3">Starting…</span> : <>
            <span className="text-fg-2">Approve it in the tab that opened (<a href={making.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">open again</a>), then paste the code it shows:</span>
            <input value={making.input} onChange={(e) => setMaking({ ...making, input: e.target.value })} aria-label="Sign-in code" className="w-56 rounded-md bg-surface-1 px-2 py-1 font-mono text-meta ring-1 ring-line-strong" />
            <button onClick={finish} disabled={!making.input.trim() || making.waiting} className={btn}>{making.waiting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}Finish</button>
          </>}
          <button onClick={() => setMaking(undefined)} className="text-meta text-fg-4 hover:text-fg-1">Cancel</button>
        </div>
      )}
      {pasting !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-small">
          <input value={pasting} onChange={(e) => setPasting(e.target.value)} placeholder="sk-ant-oat…" type="password" aria-label="Setup token" className="w-72 rounded-md bg-surface-1 px-2 py-1 font-mono text-meta ring-1 ring-line-strong" />
          <button onClick={() => save(pasting.trim())} disabled={!pasting.trim()} className={btn}>Keep</button>
          <button onClick={() => setPasting(undefined)} className="text-meta text-fg-4 hover:text-fg-1">Cancel</button>
        </div>
      )}
    </div>
  )
}
