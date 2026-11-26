import { GitBranch, LoaderCircle, Map as MapIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ago, api } from '../lib.ts'

type Base = { repo: string; meta?: { branch: string; sha: string; mappedAt: string; folders: number }; task?: { state: string } }

/** The Codebase view's left column: one row per watched repo with its map's state; picking one opens its map. */
export function RepoList({ selected, onSelect, now, version }: { selected: string; onSelect: (repo: string) => void; now: number; version?: string }) {
  const [repos, setRepos] = useState<Base[]>()
  useEffect(() => { api('/base').then(setRepos).catch(() => {}) }, [version]) // version: the last sync, so mapping state stays current
  return (
    <nav aria-label="Repositories" className="h-full space-y-1 overflow-y-auto px-2 py-2">
      {(repos ?? []).map((b) => {
        const on = b.repo === selected
        const mapping = b.task?.state === 'running' || b.task?.state === 'queued'
        return (
          <button key={b.repo} onClick={() => onSelect(b.repo)} aria-current={on}
                  className={`group relative flex w-full items-start gap-3 overflow-hidden rounded-md px-3 py-2.5 text-left transition-colors ${on ? 'sel-row' : 'hov'}`}>
            <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-accent/10 text-accent-text' : 'bg-fill text-fg-3'}`}>
              {mapping ? <LoaderCircle className="size-4 animate-spin" /> : <MapIcon className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-body font-medium text-fg-1 ">{b.repo.split('/')[1]}</span>
              <span className="mt-0.5 flex items-center gap-1.5 truncate text-meta text-fg-3">
                {b.meta ? <><GitBranch className="size-3 shrink-0" /><span className="font-mono">{b.meta.branch} @ {b.meta.sha.slice(0, 7)}</span></> : 'not mapped yet'}
              </span>
              <span className="mt-0.5 block truncate text-meta text-fg-3">
                {mapping ? 'mapping…' : b.meta ? `${b.meta.folders} folders · mapped ${ago(b.meta.mappedAt, now)}` : 'open it to map the codebase'}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
