// The this-machine view of the live lists (index.ts scopeOf): the same patches every page gets, less what isn't here.

export /** A live-list patch ({set, del, order}) with only what self shows. `hidden`: the ids this page leaves out, learned from
 *  each item as it comes (it carries its repository); an id never seen with one is shown. */
const selfPatch = (data: string, away: Set<string>, hidden: Set<string>) => {
  const d = JSON.parse(data) as { set: { id: string; repo?: string }[]; del: string[]; order: string[]; [k: string]: unknown }
  for (const x of d.set) if (x.repo && away.has(x.repo)) hidden.add(x.id); else hidden.delete(x.id)
  return JSON.stringify({ ...d, set: d.set.filter((x) => !hidden.has(x.id)), order: d.order.filter((id) => !hidden.has(id)) })
}
