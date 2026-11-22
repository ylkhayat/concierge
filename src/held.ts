// The repositories no machine can work on right now: none it is allowed on (Settings → Repositories) is online with
// its checkout. Their pull requests and tickets stay to read; their reviews, runs and explanations wait. From the
// machine that runs Concierge (a follower shows its), read again when the placement changes (the server's push).
import { useApi } from './query.ts'

const none: Record<string, string> = {}
/** repo → why no machine can work on it now. Empty with one machine, or while every repository has one. */
export function useHeld(): Record<string, string> {
  return useApi<Record<string, string>>('/repos/held').data ?? none
}
