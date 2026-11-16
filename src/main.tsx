import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './query.ts'
import { App } from './App.tsx'
import { MobileApp } from './mobile/MobileApp.tsx'
import '@fontsource-variable/inter/opsz.css' // Inter 4, variable weight and optical size (its Display cut for big text)
import './index.css'

// super-wide screens: everything scales up gently, as if the window were ~2400px wide (at most 1.4×).
// Viewport units grow with zoom, so full-height and full-width sizes divide by --z (see index.css and the h-/w- calcs).
// Settings → Interface size can fix it instead ('ui-scale' in this browser: 'auto' or a factor like '1.15').
const fit = () => {
  let pick = 'auto'
  try { pick = localStorage.getItem('ui-scale') ?? 'auto' } catch { /* private window */ }
  const z = pick !== 'auto' && Number(pick) > 0 ? Number(pick) : Math.min(1.4, Math.max(1, Math.round((innerWidth / 2400) * 20) / 20))
  document.documentElement.style.zoom = String(z)
  document.documentElement.style.setProperty('--z', String(z))
}
fit()
addEventListener('resize', fit)

// a phone gets its own app (MobileApp): tabs, lists that scroll as a page, bottom sheets. ?desktop=1 asks for the
// full desktop one anyway (kept for the tab)
const PHONE = '(max-width: 767px)'
try { if (new URLSearchParams(location.search).has('desktop')) sessionStorage.setItem('desktop', '1') } catch { /* private window */ }
const wantsDesktop = () => { try { return sessionStorage.getItem('desktop') === '1' } catch { return false } }
function Root() {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches && !wantsDesktop())
  useEffect(() => { const m = matchMedia(PHONE); const f = () => setPhone(m.matches && !wantsDesktop()); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return phone ? <MobileApp /> : <App />
}

// the dev server's gallery of parts (src/dev/Gallery.tsx): never in a build
const gallery = import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')
const Gallery = !gallery ? undefined : new URLSearchParams(location.search).get('gallery') === 'design' ? (await import('./dev/DesignSheet.tsx')).DesignSheet : (await import('./dev/Gallery.tsx')).Gallery
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}>{Gallery ? <Gallery /> : <Root />}</QueryClientProvider></StrictMode>)
