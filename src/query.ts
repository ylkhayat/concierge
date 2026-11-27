// Server state, cached: what the app reads once (a PR's explanation, its turns, the skills, Settings' pages) is kept,
// shared between the views that read it, and refreshed in the background, so going back to something shows it at
// once instead of a spinner. Live data (the PR list, the board, activity) still streams over /api/events, and its
// events mark the reads that depend on it as stale (useLiveInvalidation).
import { QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './lib.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // fresh for 30s: switching back and forth asks nothing
      gcTime: 15 * 60_000, // kept 15 minutes after the last view
      refetchOnWindowFocus: false, // live data comes over the event stream; a focus needn't ask again
      retry: 1,
    },
  },
})

/** A GET of the API, cached under its path. `enabled: false` (or no path) waits. */
export function useApi<T>(path: string | undefined, opts: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api(path!) as Promise<T>, enabled: !!path && (opts.enabled ?? true), ...opts })
}

/** Mark every read whose path starts with `prefix` stale (refetched if on screen): after a change you made. */
export const refresh = (prefix: string) => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) })

/** Put a known answer in the cache (a POST that returns the new state), so nothing waits for a refetch. */
export const remember = <T,>(path: string, data: T) => queryClient.setQueryData([path], data)

/**
 * Something under these API paths changed (the server said so over /api/events, or one of the stream's own events
 * implies it): every cached read under them is refetched if on screen, and the pages that read by hand (useLive) read again.
 */
// A thing said stale is read again at once, and then at most once more two seconds later however often it is said in
// between: a run's every step patches the list, and each patch named the same few reads (the machine's load, which the
// server answers by listing its processes) in every open tab.
const SPACING = 2000
const readAt = new Map<string, number>(), later = new Map<string, ReturnType<typeof setTimeout>>()
export function staleNow(prefixes: string[]) {
  const now = Date.now(), go: string[] = []
  for (const p of prefixes) {
    const since = now - (readAt.get(p) ?? 0)
    if (since >= SPACING) { readAt.set(p, now); go.push(p) }
    else if (!later.has(p)) later.set(p, setTimeout(() => { later.delete(p); staleNow([p]) }, SPACING - since))
  }
  if (!go.length) return
  for (const p of go) void refresh(p)
  dispatchEvent(new CustomEvent('deck-stale', { detail: go }))
}
const touches = (said: string[], mine: string[]) => said.some((p) => mine.some((q) => q.startsWith(p) || p.startsWith(q)))
/**
 * Read now, and again whenever something under `prefixes` changes; a slow `fallback` read covers a change no event
 * names. A burst of changes is one read.
 */
export function useLive(prefixes: string[], read: () => unknown, fallback = 60_000) {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const soon = () => { t ??= setTimeout(() => { t = undefined; void read() }, 150) }
    void read()
    const on = (e: Event) => { if (touches((e as CustomEvent<string[]>).detail, prefixes)) soon() }
    addEventListener('deck-stale', on)
    const slow = setInterval(() => { if (document.visibilityState === 'visible') void read() }, fallback)
    return () => { removeEventListener('deck-stale', on); clearInterval(slow); if (t) clearTimeout(t) }
  }, [prefixes.join()])
}

/**
 * placeholderData that keeps showing what a read said last while its next version loads, only for the same thing
 * (`prefix`): switching to another PR shows its own loading, never the previous PR's answer for a moment.
 */
export const keepSame = (prefix: string) => <T,>(prev: T | undefined, q?: { queryKey: readonly unknown[] }) =>
  typeof q?.queryKey[0] === 'string' && q.queryKey[0].startsWith(prefix) ? prev : undefined
/** A PR's explanation, one read for Explain, Overview and the cards: versioned by its run and push, so a new one reads again. */
export const explainPath = (pr: { id: string; headSha: string; explain?: { state?: string; endedAt?: string } }) =>
  `/prs/${encodeURIComponent(pr.id)}/explain?v=${pr.explain?.state ?? ''}:${pr.explain?.endedAt ?? ''}:${pr.headSha}`
