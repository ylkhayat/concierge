// A PR or ticket of a repository that isn't on this machine (Settings → Repositories): said plainly, with the way to
// change it. Reached by a link or a URL; the lists don't open these.
import { FolderLock, Network, Settings2 } from 'lucide-react'
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
        <button onClick={onAllApps} className="btn-outline">All applications</button>
      </div>
    </main>
  )
}
