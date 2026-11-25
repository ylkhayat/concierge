// The blueprint board's arithmetic (components/DesignWorkspace.tsx): kept apart from the page so it is tested alone.
import type { Mark } from '../server/visuals.ts'

/**
 * The component under a point of a screen (in percent of it): the smallest one there, so a component inside another
 * wins. One pass over the screen's marks per pointer move: the board has no element per component to ask.
 */
export function partAt(marks: Mark[], x: number, y: number): string | undefined {
  let best: Mark | undefined
  for (const m of marks) if (m.part && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h && (!best || m.w * m.h < best.w * best.h)) best = m
  return best?.part
}
