import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib.ts'

const btn = 'inline-flex items-center gap-1.5 btn-primary'

type Flow = { machine: string; url?: string; code?: string; input: string; error?: string; waiting?: boolean }

/**
 * Signing an account in on any machine, from this page: the machine starts the sign-in, you approve it in your browser
 * and paste the code it shows, and the page checks until that machine says it is signed in. Each machine signs in on its
 * own (its own session, so the machines never undo each other's).
 */
export function useMachineSignIn(account: string, onDone: () => void) {
  const [flow, setFlow] = useState<Flow>()
  const path = (m: string) => `/machines/${encodeURIComponent(m)}/signin`
  const poll = (machine: string, tries = 0): void => void api(path(machine), { account, step: 'state' }).then((r: { signedIn: boolean; state: { done: boolean } | null }) => {
    if (r.signedIn) { setFlow(undefined); onDone(); return }
    if (tries < 30 && !r.state?.done) setTimeout(() => poll(machine, tries + 1), 2000)
    else setFlow((f) => f && { ...f, waiting: false, error: 'Not signed in yet: try again' })
  }, () => {})
  const start = (machine: string) => {
    setFlow({ machine, input: '' })
    api(path(machine), { account, step: 'start' }).then(
      (r: { url: string; code?: string }) => setFlow({ machine, url: r.url, code: r.code, input: '', waiting: !!r.code }), (e: Error) => setFlow({ machine, input: '', error: e.message }))
  }
  const finish = () => {
    if (!flow) return
    const f = flow
    setFlow({ ...f, waiting: true })
    api(path(f.machine), { account, step: 'finish', input: f.input }).then(() => poll(f.machine), (e: Error) => setFlow({ ...f, error: e.message, waiting: false }))
  }
  return { flow, start, finish, poll, setInput: (input: string) => setFlow((f) => f && { ...f, input }), cancel: () => setFlow(undefined) }
}
export type MachineSignIn = ReturnType<typeof useMachineSignIn>

/** The steps of a sign-in under way: open the page and approve, paste the code, and a way out. */
export function SignInSteps({ s }: { s: MachineSignIn }) {
  const f = s.flow
  if (!f) return null
  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2 text-small">
      {f.error ? <p className="text-fail-text">{f.error}</p>
        : !f.url ? <p className="text-fg-3">Starting the sign-in on {f.machine}…</p>
        : <>
            <p className="text-fg-2">1. <a href={f.url} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">Open the sign-in page</a> and approve{f.code ? <> with the code <code className="rounded bg-fill px-1 font-mono">{f.code}</code></> : ''}.</p>
            {!f.code && <div className="flex gap-1.5">
              <input value={f.input} onChange={(e) => s.setInput(e.target.value)} placeholder="2. Paste the code it shows" className="min-w-0 flex-1 rounded-chip bg-surface-1 px-2 py-1 font-mono text-meta ring-1 ring-line-strong" />
              <button onClick={s.finish} disabled={!f.input.trim() || f.waiting} className={btn}>{f.waiting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}Finish</button>
            </div>}
            {f.code && <button onClick={() => s.poll(f.machine)} className={btn}>I approved it</button>}
          </>}
      <button onClick={s.cancel} className="text-meta text-fg-4 hover:text-fg-1">Cancel</button>
    </div>
  )
}

/** The button beside a line that waits on one sign-in ("… where Claude (Person) isn't signed in"), and its steps. */
export function SignInHere({ machine, account, onDone }: { machine: string; account: string; onDone?: () => void }) {
  const [done, setDone] = useState(false)
  const s = useMachineSignIn(account, () => { setDone(true); onDone?.() })
  if (done) return <p className="mt-1.5 text-meta text-ok-text">Signed in on {machine}: the work starts in a moment.</p>
  return (
    <div className="mt-1.5">
      {!s.flow && <button onClick={() => s.start(machine)} className={btn}>Sign in on {machine}</button>}
      <SignInSteps s={s} />
    </div>
  )
}
