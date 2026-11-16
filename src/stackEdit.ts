// The stacks you shape before a run: lanes (stacks, bottom first) and the tickets on their own. Every ticket is built
// by its own agent either way; a lane only decides which PRs are submitted together, in its order, once all are ready.
export type Shape = { lanes: string[][]; alone: string[] }

/** The plan's stacks as lanes: a stack of one is a ticket on its own. */
export const shapeOf = (stacks: string[][]): Shape => ({ lanes: stacks.filter((s) => s.length > 1).map((s) => [...s]), alone: stacks.filter((s) => s.length === 1).map((s) => s[0]) })

/** The shape as the run takes it: every lane a stack, every ticket on its own a stack of one. */
export const stacksOf = (s: Shape): string[][] => [...s.lanes.filter((l) => l.length), ...s.alone.map((id) => [id])]

/** Move a ticket on top of a lane (its index), into a new lane, or out on its own. Empty lanes go. */
export function move(s: Shape, id: string, to: number | 'new' | 'alone'): Shape {
  const lanes = s.lanes.map((l) => l.filter((x) => x !== id)), alone = s.alone.filter((x) => x !== id)
  if (to === 'alone') alone.push(id)
  else if (to === 'new') lanes.push([id])
  else if (lanes[to]) lanes[to].push(id)
  else alone.push(id)
  // a lane left with one ticket keeps it only while it's the one being built (a new lane): otherwise it is on its own
  const kept = lanes.filter((l, i) => l.length > 1 || (l.length === 1 && to === 'new' && i === lanes.length - 1))
  for (const l of lanes) if (l.length === 1 && !kept.includes(l)) alone.push(l[0])
  return { lanes: kept, alone }
}

/** A ticket one place down (-1) or up (+1) in its lane. */
export function shift(s: Shape, id: string, by: -1 | 1): Shape {
  return { ...s, lanes: s.lanes.map((l) => {
    const i = l.indexOf(id), j = i + by
    if (i < 0 || j < 0 || j >= l.length) return l
    const out = [...l]; [out[i], out[j]] = [out[j], out[i]]; return out
  }) }
}

/** All picked tickets in one lane, in the order given; or every one on its own. */
export const oneStack = (ids: string[]): Shape => ({ lanes: [[...ids]], alone: [] })
export const noStacks = (ids: string[]): Shape => ({ lanes: [], alone: [...ids] })
