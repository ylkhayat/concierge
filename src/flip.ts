// Rows that change place glide there instead of jumping: after each render, every [data-flip] row inside the box that
// moved since the last one is slid from where it was (FLIP). offsetTop ignores transforms, so a row still gliding
// measures where it really is. New rows fade in; rows that leave just go.
import { useLayoutEffect, useRef, type RefObject } from 'react'

export function useFlip(box: RefObject<HTMLElement | null>) {
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const now = new Map<string, number>()
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const row of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = row.dataset.flip!, top = topIn(row, el)
      now.set(key, top)
      const was = last.current.get(key)
      if (calm || !last.current.size) continue // the first paint just shows the list
      if (was === undefined) row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
      else if (Math.abs(was - top) > 1) row.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    }
    last.current = now
  })
}

/** Where a row sits inside the scrolling box, whatever wraps it in between. */
function topIn(row: HTMLElement, box: HTMLElement) {
  let y = 0
  for (let n: HTMLElement | null = row; n && n !== box; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
  return y
}
