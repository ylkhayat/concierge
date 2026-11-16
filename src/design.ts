// Which design the PR and ticket pages use: the classic one, or the new conversation (thread) one while it is being
// built. Kept per browser; `?design=new` or `?design=classic` in a link sets it too.
import { useEffect, useState } from 'react'

export type Design = 'classic' | 'thread'
const KEY = 'design', EVENT = 'concierge:design'

const stored = (): Design => {
  try { return localStorage.getItem(KEY) === 'thread' ? 'thread' : 'classic' } catch { return 'classic' }
}

export function setDesign(d: Design) {
  try { localStorage.setItem(KEY, d) } catch {}
  dispatchEvent(new CustomEvent(EVENT))
}

// a link that names a design sets it, once, as the page loads
const asked = new URLSearchParams(location.search).get('design')
if (asked === 'new' || asked === 'thread') setDesign('thread')
else if (asked === 'classic') setDesign('classic')

export function useDesign(): Design {
  const [d, setD] = useState(stored)
  useEffect(() => {
    const on = () => setD(stored())
    addEventListener(EVENT, on)
    addEventListener('storage', on) // another tab switched
    return () => { removeEventListener(EVENT, on); removeEventListener('storage', on) }
  }, [])
  return d
}
