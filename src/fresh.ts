// An open tab keeps running the code it loaded, so a fix that was deployed meanwhile never reached it. Now and then
// (and when you come back to the tab) it compares the page's script with the one the server serves now: a hidden tab
// reloads by itself; one you are looking at is told, and reloads when you say so. Drafts survive (draft.ts).
import { useEffect, useState } from 'react'

const SCRIPT = /\/assets\/index-[\w-]+\.js/, META = /name="deck-version" content="([^"]+)"/
const mine = () => [...document.scripts].map((s) => s.src.match(SCRIPT)?.[0]).find(Boolean)

/** The version deployed when it is newer than the one this tab runs ('' when it can't tell which), else undefined. */
export function useNewVersion() {
  const [newer, setNewer] = useState<string>()
  useEffect(() => {
    const loaded = mine()
    if (!loaded) return // the dev server: nothing to compare
    const check = () => fetch('/', { cache: 'no-store' }).then((r) => r.text()).then((html) => {
      const served = html.match(SCRIPT)?.[0]
      if (!served || served === loaded) return
      if (document.hidden) location.reload()
      else setNewer(html.match(META)?.[1] ?? '')
    }, () => {})
    const t = setInterval(check, 2 * 60_000)
    addEventListener('visibilitychange', check)
    return () => { clearInterval(t); removeEventListener('visibilitychange', check) }
  }, [])
  return newer
}
