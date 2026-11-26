// Rows that change place glide there instead of jumping (FLIP): every [data-flip] row inside the box is measured after
// each render, and when the list's arrangement (`shape`: which rows, where) changed, the ones that moved slide from
// where they were. Only then: a refresh that changes nothing but a row's text, a time ticking, or a row's height
// settling as it scrolls into view used to glide rows that never moved. offsetTop ignores transforms, so a row still
// gliding measures where it really is; a new move starts from where it shows, not from where it was headed.
// Only items never seen before fade in (`ids`: every item in the data, shown or not): one that comes back into view
// (a tab, a folded section, a filter cleared, a blip in the data) just shows. Rows that leave just go.
import { useLayoutEffect, useRef, type RefObject } from 'react'

export function useFlip(box: RefObject<HTMLElement | null>, shape: string, ids: string[]) {
  const last = useRef(new Map<string, number>())
  const was = useRef(shape)
  const known = useRef<Set<string>>(undefined)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const moved = was.current !== shape
    was.current = shape
    const first = !known.current // the first paint just shows the list
    const born = new Set(first ? [] : ids.filter((id) => !known.current!.has(id)))
    known.current ??= new Set()
    for (const id of ids) known.current.add(id)
    const now = new Map<string, number>()
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const row of el.querySelectorAll<HTMLElement>('[data-flip]')) {
      const key = row.dataset.flip!, top = topIn(row, el)
      now.set(key, top)
      if (calm || first || (!moved && !born.size)) continue
      if (born.has(key)) { row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); continue }
      const from = last.current.get(key)
      if (!moved || from === undefined) continue
      // still gliding from an earlier move: carry on from where it is on screen
      const gliding = row.getAnimations().filter((a) => a.id === 'flip')
      const t = gliding.length ? getComputedStyle(row).transform : 'none'
      const off = t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0
      gliding.forEach((a) => a.cancel())
      const dy = from + off - top
      if (Math.abs(dy) > 1) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { id: 'flip', duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
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
