// The skillsAdvice routes, out of server/index.ts: mounted on the API there.
import { improveSkill, removeSkill, skillsView, suggestSkills } from '../skills.ts'
import { mustChange } from '../roles.ts'
import { save, state } from '../store.ts'
import type { Hono as App } from 'hono'

export function skillsAdviceRoutes(app: App) {
  // the skills: how they are used and how well they work (skills.ts); proposals, written on demand by the small model
  app.get('/skills/view', async (c) => c.json(await skillsView(Math.min(90, Number(c.req.query('days')) || 30))))
  // proposals take a minute or two: written in the background and kept (state.skillAdvice), so leaving the page loses
  // nothing; the page asks how it stands
  const advising = new Map<string, string | undefined>() // what is being written: 'improve:<skill>' or 'suggest', and its error once failed
  const advice = () => (state.skillAdvice ??= { improve: {} })
  app.get('/skills/advice', (c) => {
    const name = c.req.query('name')
    const k = name ? `improve:${name}` : 'suggest'
    return c.json({ result: name ? advice().improve[name] : advice().suggest, busy: advising.has(k) && advising.get(k) === undefined, error: advising.get(k) })
  })
  app.post('/skills/improve', async (c) => {
    const { name, days } = await c.req.json<{ name: string; days?: number }>()
    try { mustChange(String(name)) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
    const k = `improve:${name}`
    if (advising.has(k) && advising.get(k) === undefined) return c.json({ busy: true })
    advising.set(k, undefined)
    improveSkill(String(name), Math.min(90, Number(days) || 30))
      .then((r) => { advice().improve[String(name)] = r; save(); advising.delete(k) }, (e: Error) => advising.set(k, e.message))
    return c.json({ busy: true })
  })
  app.post('/skills/remove', async (c) => {
    const { name } = await c.req.json<{ name: string }>()
    try { mustChange(String(name)); return c.json({ said: await removeSkill(String(name)) }) } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })
  app.post('/skills/suggest', async (c) => {
    const { days } = await c.req.json<{ days?: number }>().catch(() => ({ days: 30 }))
    if (advising.has('suggest') && advising.get('suggest') === undefined) return c.json({ busy: true })
    advising.set('suggest', undefined)
    const d = Math.min(90, Number(days) || 30)
    suggestSkills(d).then((r) => { advice().suggest = { ...r, at: new Date().toISOString(), days: d }; save(); advising.delete('suggest') }, (e: Error) => advising.set('suggest', e.message))
    return c.json({ busy: true })
  })
}
