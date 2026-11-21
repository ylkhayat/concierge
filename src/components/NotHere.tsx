// A PR or ticket of a repository that isn't on this machine (Settings → Repositories): said plainly, with the way to
// change it. Reached by a link or a URL; the lists don't open these.
import { FolderLock, Settings2 } from 'lucide-react'
import { openRepoSettings } from '../away.ts'

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
