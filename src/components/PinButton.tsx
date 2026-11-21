import { Bookmark } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Alert } from '../../server/alerts.ts'
import { api } from '../lib.ts'
import { focusBlock } from '../deskTime.ts'

/** Bookmark a PR or ticket: it leads its list until it's done, and each change of its state is an alert (and a system notification). */
export function PinButton({ pinKey, on: given, className, toast }: { pinKey: string; on?: boolean; className: string; toast: (m: string, tone?: 'ok' | 'error') => void }) {
  // shown at once, before the server answers; back as it was if it refuses; the list's own word wins once it comes
  const [mine, setMine] = useState<boolean>()
  useEffect(() => setMine(undefined), [given])
  const on = mine ?? given
  const click = () => {
    setMine(!on)
    // the browser asks once, on this click: notifications need a gesture
    if (!on && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
    api('/pins', { key: pinKey, on: !on }).then(() => toast(on ? 'Bookmark removed' : 'Bookmarked: it stays on top, and each change of its state is an alert'), (e: Error) => { setMine(undefined); toast(e.message, 'error') })
  }
  return (
    <button className={className} onClick={click} aria-pressed={!!on} aria-label={on ? 'Remove bookmark' : 'Bookmark'}
            title={on ? 'Remove the bookmark' : 'Bookmark: keep it on top of the list and get an alert when its state changes'}>
      <Bookmark className={`size-3.5 ${on ? 'fill-current text-accent' : ''}`} />
    </button>
  )
}

/**
 * A system notification for each new update about a bookmarked item, and each one that needs you (an agent came back
 * with decisions or a question), while this page is in the background (in front,
 * the alert dock shows it). Several open pages notify once: the same tag replaces. Clicking one opens the item.
 */
export function usePinNotifications(alerts: Alert[], open: (a: Alert) => void) {
  const since = useRef<string | undefined>(undefined)
  useEffect(() => {
    const newest = alerts.reduce((m, a) => (a.at > m ? a.at : m), '')
    const from = since.current
    since.current = newest > (from ?? '') ? newest : from
    if (from === undefined || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden || focusBlock()) return // a focus block skips them: they still wait in the alert dock
    for (const a of alerts) for (const u of a.updates) {
      if (!(u.pin || u.tone === 'you') || u.at <= from) continue
      // Concierge's own news (a machine came online) reads as itself; an item says what changed about it
      const n = a.kind === 'system' ? new Notification(a.title, { body: u.text, tag: `${a.key}|${u.at}` })
        : new Notification(`${a.label} ${u.tone === 'you' ? 'needs you' : 'changed'}`, { body: `${a.title}\n${u.text}`, tag: `${a.key}|${u.at}` })
      n.onclick = () => { window.focus(); open(a); n.close() }
    }
  }, [alerts])
}
