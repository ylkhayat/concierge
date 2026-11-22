// A PR or ticket of a repository that isn't on this machine (Settings → Repositories): said plainly, with the way to
// change it. Reached by a link or a URL; the lists don't open these.
import { CloudOff, FolderLock, Network, Settings2 } from 'lucide-react'
import { openRepoSettings } from '../away.ts'
import { setScope } from '../scope.ts'

export function NotHere({ repo, what }: { repo: string; what: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-fill text-fg-3"><FolderLock className="size-5" /></span>
      <p className="text-reading font-semibold text-fg-1">Not available on this machine</p>
      <p className="max-w-sm text-small text-fg-3">This {what} is in <span className="font-mono text-fg-2">{repo}</span>, which isn't checked out here. Allow it on this machine to open it.</p>
      <button onClick={openRepoSettings} className="btn-primary inline-flex items-center gap-1.5"><Settings2 className="size-3.5" />Open repository settings</button>
    </div>
  )
}

/**
 * Repositories no machine can work on now (none they are allowed on is online with the checkout): said across the top
 * while one of them is in view, with why. What is there stays to read; what would run waits for one of those machines.
 */
export function HeldBanner({ held }: { held: [string, string][] }) {
  if (!held.length) return null
  const one = held.length === 1
  // the server's sentence names the repository first ("acme/api is only allowed on…"): here it is already named
  const said = (r: string, why: string) => (why.startsWith(`${r} `) ? `it${why.slice(r.length)}` : why)
  return (
    <div className="relative z-20 flex items-start gap-2.5 border-b border-wait/20 bg-wait/10 px-4 py-2 text-body text-wait-text">
      <CloudOff className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p>{one ? <>No machine can work on <span className="font-mono">{held[0][0]}</span> right now: {said(held[0][0], held[0][1])}.</> : <>No machine can work on {held.length} applications right now:</>}
          {' '}{one ? 'Its' : 'Their'} pull requests and tickets are here to read; reviews, runs and explanations wait until a machine {one ? 'it is' : 'they are'} allowed on is back.</p>
        {!one && <ul className="mt-1 space-y-0.5 text-small">{held.map(([r, why]) => <li key={r}><span className="font-mono">{r}</span>: {said(r, why)}</li>)}</ul>}
      </div>
      <button onClick={openRepoSettings} className="shrink-0 rounded-lg px-2.5 py-1 font-medium transition-colors hover:bg-wait/15">Where it's allowed</button>
    </div>
  )
}

/** The home of a repository that isn't on this machine, when you pick it as the application here: what that means and
 *  where to go, instead of an empty list. Only in this machine's view (the fleet view has every repository). */
export function AwayRepo({ repo, onAllApps }: { repo: string; onAllApps: () => void }) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-fill text-fg-3"><FolderLock className="size-5" /></span>
      <p className="text-title font-semibold text-fg-1"><span className="font-mono">{repo}</span> isn't on this machine</p>
      <p className="max-w-md text-small text-fg-3">It isn't allowed here, so its pull requests, tickets and agents live on the machines it is allowed on. This view shows only what this machine works on.</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button onClick={() => setScope('fleet')} className="btn-primary inline-flex items-center gap-1.5"><Network className="size-3.5" />See it in the fleet view</button>
        <button onClick={openRepoSettings} className="btn-outline inline-flex items-center gap-1.5"><Settings2 className="size-3.5" />Allow it on this machine</button>
        <button onClick={onAllApps} className="btn-outline">All workspaces</button>
      </div>
    </main>
  )
}
