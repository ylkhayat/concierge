// Settings → Machines: live updates through GitHub webhooks. Two steps you take yourself (nothing here runs by
// itself): open the webhook door (Tailscale Funnel, for the hook path only), then connect repositories. Once
// deliveries come in, polling drops to every 10 minutes as a safety net. Self-contained: its own small layout bits.
import { Check, CircleAlert, CircleCheck, Copy, DoorOpen, ExternalLink, KeyRound, LoaderCircle, Radio, Send, Power, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { HooksView } from '../../server/index.ts'
import { api } from '../lib.ts'
import { remember, useApi } from '../query.ts'
import { ago } from '../time.ts'
import { Skeleton } from './Connections.tsx'

type Toast = (m: string, tone?: 'ok' | 'error') => void
type Outcome = { repo: string; ok: boolean; text?: string }
type SignIn = { code: string; url: string; via: 'gh' | 'concierge' }
const primary = 'inline-flex shrink-0 items-center gap-1.5 btn-primary'
const quiet = 'inline-flex shrink-0 items-center gap-1.5 btn-outline'
const at = (ms?: number) => (ms ? ago(new Date(ms).toISOString()) : undefined)

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-3.5 py-3">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-meta font-semibold ${done ? 'bg-ok/15 text-ok-text' : 'bg-fill text-fg-3'}`}>{done ? <Check className="size-3.5" /> : n}</span>
      <div className="min-w-0 flex-1 space-y-2"><div className="text-small font-medium text-fg-1">{title}</div>{children}</div>
    </div>
  )
}
const Note = ({ tone = 'wait', children }: { tone?: 'wait' | 'fail'; children: ReactNode }) => (
  <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-small ${tone === 'fail' ? 'bg-fail/6 text-fail-text' : 'bg-wait/6 text-wait-text'}`}><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span className="min-w-0 break-words">{children}</span></p>
)

export function LiveUpdates({ toast }: { toast: Toast }) {
  const q = useApi<HooksView>('/hooks')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [picked, setPicked] = useState<Set<string>>()
  const [signIn, setSignIn] = useState<SignIn>()
  const [copied, setCopied] = useState(false)
  const v = q.data
  const set = (x: HooksView) => remember('/hooks', x)
  const act = <T,>(what: string, path: string, body: unknown, then: (r: T) => void) => {
    setBusy(what); setError(undefined)
    return api(path, body).then(then, (e: Error) => setError(e.message)).finally(() => setBusy(undefined))
  }
  const connect = (repos: string[]) => act<{ results: Outcome[]; view: HooksView }>('connect', '/hooks/connect', { repos }, (r) => {
    set(r.view)
    const ok = r.results.filter((x) => x.ok).length
    toast(ok === r.results.length ? `Connected ${ok} ${ok === 1 ? 'repository' : 'repositories'}` : `Connected ${ok} of ${r.results.length}: the others keep polling`, ok ? 'ok' : 'error')
  })

  // the sign-in: wait for gh to finish, then read the scopes again and carry on with step 2 by itself
  useEffect(() => {
    if (!signIn) return
    const t = setInterval(() => {
      void api('/github/login').then((s: { done: boolean; ok: boolean; error?: string; login?: string } | null) => {
        if (!s?.done) return
        clearInterval(t); setSignIn(undefined)
        if (!s.ok) { setError(s.error ?? 'The sign-in didn’t finish'); return }
        toast(`Signed in to GitHub${s.login ? ` as ${s.login}` : ''}`)
        void q.refetch().then(({ data }) => {
          const again = data?.repos.filter((r) => r.problem?.problem === 'scope').map((r) => r.repo) ?? []
          if (again.length && data?.funnel.on) void connect(again)
        })
      }, () => {})
    }, 2000)
    return () => clearInterval(t)
  }, [signIn?.code]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return <Skeleton rows={3} />
  const connected = v.repos.filter((r) => r.id)
  const live = connected.filter((r) => r.live)
  const chosen = picked ?? new Set(v.repos.filter((r) => !r.id && r.watched && r.problem?.problem !== 'no-admin').map((r) => r.repo))
  const toConnect = [...chosen].filter((r) => v.repos.some((x) => x.repo === r))
  const needsSignIn = v.token.canHook === false || v.repos.some((r) => r.problem?.problem === 'scope')
  const startSignIn = () => act<SignIn>('signin', '/hooks/signin', {}, setSignIn)

  return (
    <section className="space-y-2">
      <header className="px-0.5">
        <h3 className="text-small font-semibold text-fg-1">Live updates (GitHub webhooks)</h3>
        <p className="text-meta text-fg-3">GitHub tells Concierge the moment a PR changes. Polling then drops to every 10 minutes, as a safety net. Only the webhook path is opened to the internet; this app stays on your tailnet.</p>
      </header>
      <div className="divide-y divide-line overflow-hidden card">
        {/* where things stand: what came in, and the test and off switches */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${live.length ? 'bg-ok/15 text-ok-text' : 'bg-fill text-fg-3'}`}><Radio className="size-3.5" aria-hidden /></span>
          <div className="min-w-0 flex-1 basis-48 text-small">
            <div className="font-medium text-fg-1">{live.length ? `Live on ${live.length} of ${connected.length} ${connected.length === 1 ? 'repository' : 'repositories'}` : connected.length ? 'Waiting for a delivery' : 'Off: polling every minute'}</div>
            <div className="text-meta text-fg-3">{v.lastAt ? `Last delivery ${at(v.lastAt)} · ${v.today} today` : 'No deliveries yet'}{v.bad ? ` · ${v.bad} refused (bad signature)` : ''}</div>
          </div>
          {connected.length > 0 && <button disabled={!!busy} onClick={() => void act<{ sent: { repo: string; ok: boolean; text?: string }[] }>('test', '/hooks/test', {}, (r) => {
            const bad = r.sent.filter((s) => !s.ok)
            toast(bad.length ? `GitHub couldn't ping ${bad.map((s) => s.repo).join(', ')}: ${bad[0].text}` : 'Test sent: it shows here in a few seconds', bad.length ? 'error' : 'ok')
            setTimeout(() => void q.refetch(), 4000)
          })} className={quiet}><Send className="size-3.5" />Send a test</button>}
          {(v.funnel.on || connected.length > 0) && <button disabled={!!busy} onClick={() => void act<{ left: string[]; view: HooksView }>('off', '/hooks/off', {}, (r) => {
            set(r.view); toast(r.left.length ? `Couldn't remove the webhook on ${r.left.join(', ')}: remove it on GitHub` : 'Webhooks off: polling every minute again', r.left.length ? 'error' : 'ok')
          })} className={quiet}><Power className="size-3.5" />Turn off</button>}
        </div>

        <Step n={1} title="Open the webhook door" done={v.funnel.on}>
          {v.funnel.on
            ? <p className="text-small text-fg-3">GitHub reaches Concierge at <code className="break-all font-mono text-fg-2">{v.funnel.url}</code>, through Tailscale Funnel. Nothing else is reachable there.</p>
            : <>
                <p className="text-small text-fg-3">Turns on Tailscale Funnel on {v.machine ?? 'this machine'} for the webhook path only, on port {v.funnelPort}{v.funnel.url && <> (<code className="break-all font-mono">{v.funnel.url}</code>)</>}. Every delivery must carry GitHub's signature.</p>
                {v.funnel.blocker && <Note>{v.funnel.blocker}</Note>}
                <button disabled={!!busy} onClick={() => void act<HooksView>('funnel', '/hooks/funnel', { on: true }, (x) => { set(x); toast('The webhook door is open') })} className={primary}>
                  {busy === 'funnel' ? <LoaderCircle className="size-3.5 animate-spin" /> : <DoorOpen className="size-3.5" />}Open the webhook door
                </button>
              </>}
        </Step>

        <Step n={2} title="Connect repositories" done={connected.length > 0 && !toConnect.length}>
          <p className="text-small text-fg-3">A webhook on each repository ticked. It needs admin on the repository; the others keep polling every minute.</p>
          {/* the token can't make webhooks: sign in again, here, asking GitHub for admin:repo_hook */}
          {(needsSignIn || signIn) && (
            <div className="space-y-2 rounded-lg bg-wait/6 px-3 py-2.5 text-small text-wait-text">
              <p className="flex items-start gap-2"><KeyRound className="mt-0.5 size-3.5 shrink-0" />
                <span>{v.token.source === 'env'
                  ? 'Your GitHub token (GITHUB_TOKEN in this machine\'s .env) may not manage webhooks. Sign in again: the new token, with admin:repo_hook, replaces it for every machine.'
                  : v.token.source === 'shared'
                    ? 'Your GitHub token may not manage webhooks. Sign in again to allow it (admin:repo_hook): the new token replaces it for every machine.'
                    : 'Your GitHub sign-in (gh) may not manage webhooks. Sign in again to add admin:repo_hook to it.'}</span></p>
              {signIn
                ? <div className="flex flex-wrap items-center gap-2 pl-5.5">
                    <span className="text-fg-2">Enter this code on GitHub:</span>
                    <code className="rounded-md bg-surface-1 px-2 py-0.5 font-mono font-semibold tracking-wider text-fg-1 ring-1 ring-line">{signIn.code}</code>
                    <button aria-label="Copy the code" onClick={() => void navigator.clipboard.writeText(signIn.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })} className={`${quiet} btn-sm`}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
                    <a href={signIn.url} target="_blank" rel="noreferrer" className={`${quiet} btn-sm`}><ExternalLink className="size-3.5" />Open github.com/login/device</a>
                    <span className="flex items-center gap-1.5 text-meta text-fg-3"><LoaderCircle className="size-3 animate-spin" />Waiting for you to approve it</span>
                  </div>
                : <div className="pl-5.5"><button disabled={!!busy} onClick={() => void startSignIn()} className={quiet}>{busy === 'signin' ? <LoaderCircle className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}Sign in to GitHub again</button></div>}
            </div>
          )}
          {v.token.canHook === undefined && !needsSignIn && !signIn && <p className="text-meta text-fg-4">Your token doesn't list its scopes (a fine-grained token): it needs the Webhooks permission (read and write) on each repository. <button onClick={() => void startSignIn()} className="font-medium text-accent-text hover:underline">Sign in to GitHub instead</button></p>}
          <ul className="space-y-1">
            {v.repos.map((r) => {
              const on = chosen.has(r.repo)
              return (
                <li key={r.repo} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-small">
                  {r.id ? <CircleCheck className={`size-4 shrink-0 ${r.live ? 'text-ok-text' : 'text-fg-4'}`} aria-label="Connected" />
                    : <label className="inline-flex cursor-pointer items-center">
                        <input type="checkbox" checked={on} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(r.repo); else n.delete(r.repo); setPicked(n) }} className="peer sr-only" aria-label={`Connect ${r.repo}`} />
                        <span aria-hidden className={`flex size-4 items-center justify-center rounded-[5px] ring-1 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${on ? 'bg-accent text-on-accent ring-accent' : 'bg-surface-1 ring-line-strong'}`}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                      </label>}
                  <span className="min-w-0 truncate font-mono text-fg-1">{r.repo}</span>
                  <span className={`text-meta ${r.problem && !r.id ? (r.problem.problem === 'no-admin' ? 'text-fg-4' : 'text-fail-text') : 'text-fg-3'}`}>
                    {r.id ? (r.live ? `Live · ${at(r.lastAt)}` : 'Connected · waiting for its first delivery') : r.problem ? r.problem.text : !r.watched ? 'A PR you follow' : ''}
                  </span>
                  {r.id && <button disabled={!!busy} aria-label={`Disconnect ${r.repo}`} title="Remove its webhook" onClick={() => void act<HooksView>('disconnect', '/hooks/disconnect', { repo: r.repo }, set)} className="ml-auto rounded-lg p-1 text-fg-4 transition-colors hover:bg-fail/10 hover:text-fail-text"><Trash2 className="size-3.5" /></button>}
                </li>
              )
            })}
          </ul>
          <button disabled={!!busy || !v.funnel.on || !toConnect.length} title={v.funnel.on ? undefined : 'Open the webhook door first'} onClick={() => void connect(toConnect)} className={primary}>
            {busy === 'connect' ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Connect {toConnect.length || ''} {toConnect.length === 1 ? 'repository' : 'repositories'}
          </button>
        </Step>
        {error && <div className="px-3.5 py-2.5"><Note tone="fail">{error}</Note></div>}
      </div>
    </section>
  )
}
