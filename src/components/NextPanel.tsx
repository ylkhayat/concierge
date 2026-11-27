import { type LucideIcon } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** How fresh the data behind a page is: when it last synced, whether a sync runs now, and a way to sync. */
export type Sync = { at?: string; syncing: boolean; onSync: () => void }

/** A phone (narrower than 768px): panels become sheets from the bottom. */
export function usePhone() {
  const q = '(max-width: 767px)'
  const [n, setN] = useState(() => matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return n
}

/** Off inside a card that already says what its section is (the next step's card). */
export const SectionHeadings = createContext(true)

export function PanelSection({ title, icon: Icon, tone = 'text-fg-3', children }: { title: string; icon: LucideIcon; tone?: string; children: ReactNode }) {
  const headings = useContext(SectionHeadings)
  return (
    <section className="space-y-2.5">
      {headings && <h3 className="flex items-center gap-1.5 text-small font-medium text-fg-3"><Icon className={`size-3.5 ${tone}`} />{title}</h3>}
      {children}
    </section>
  )
}
