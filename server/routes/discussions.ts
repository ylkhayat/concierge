// The discussions routes, out of server/index.ts: mounted on the API there.
import { stale } from '../live.ts'
import { component } from '../work.ts'
import { type Ticket } from '../linear.ts'
import { randomUUID } from 'node:crypto'
import { loadActivity, ticketActivity } from '../runner.ts'
import { git } from '../atlas.ts'
import { ask as askCard, discussionsOf, markSent, reset, say, settled, type Topic } from '../discussions.ts'
import { config, save, state, type Pr } from '../store.ts'
import type { Hono as App } from 'hono'
import type { TicketView, workOfMember as WorkOfMemberFn } from '../index.ts'
type WorkOfMember = typeof WorkOfMemberFn

// what these routes use that lives in index.ts
type Deps = {
  execBoard: { tickets: Ticket[] }; explainedOf: (id: string) => Promise<string>; ticketViews: () => TicketView[]; ticketsOf: (p: Pr) => Ticket[]
  workEdges: (k: string) => string[]; workOfMember: WorkOfMember
}
export function discussionsRoutes(app: App, { execBoard, explainedOf, ticketViews, ticketsOf, workEdges, workOfMember }: Deps) {
  async function lastWord(key: string) {
    const said = (await loadActivity(key)).filter((a) => a.kind === 'result' || a.kind === 'text').map((a) => a.text)
    return said.slice(-3).join('\n\n').slice(-3000) || '(nothing yet)'
  }
  // a stack's discussion: target "stack:<repo>#<the bottom PR's number>", the same from any PR of it
  const stackOfTarget = (target: string) => {
    const m = /^stack:(.+)#(\d+)$/.exec(target)
    return m ? Object.values(state.prs).find((p) => p.repo === m[1] && p.stack?.[0].number === Number(m[2]))?.stack : undefined
  }
  /** The PRs a discussion covers when it covers several: a stack's, or the ones a ticket ships as. */
  const workMembers = (target: string) => { const w = state.works?.[target.slice(5)]; return w ? Object.entries(state.workOf ?? {}).filter(([, id]) => id === w.id).map(([k]) => k) : [] }
  function discussionPrs(target: string): { repo: string; number: number }[] | undefined {
    if (target.startsWith('work:')) { const prs = workMembers(target).filter((k) => k.startsWith('pr:')).map((k) => state.prs[k.slice(3)]).filter((p): p is Pr => !!p); return prs.length > 1 ? prs.map((p) => ({ repo: p.repo, number: p.number })) : undefined }
    if (target.startsWith('stack:')) return stackOfTarget(target)?.map((x) => ({ repo: x.repo, number: x.number }))
    if (target.startsWith('ticket:')) { const t = ticketViews().find((x) => x.id === target.slice(7)); return t && t.prs.length > 1 ? t.prs.map((x) => ({ repo: x.repo, number: x.number })) : undefined }
    return undefined
  }
  /** The version of the work a card was written for: a PR's head and its feedback (every PR's, for a stack), a ticket's last run. */
  function versionOf(target: string): string | undefined {
    if (target.startsWith('work:')) return workMembers(target).sort().map((k) => versionOf(k)).join()
    if (target.startsWith('stack:')) return stackOfTarget(target)?.map((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return `${p?.headSha ?? ''}:${p?.feedbackAt ?? ''}` }).join()
    if (target.startsWith('pr:')) { const p = state.prs[target.slice(3)]; return p && `${p.headSha}:${p.feedbackAt ?? ''}` }
    const run = ticketViews().find((x) => x.id === target.slice(7))?.run
    return `${run?.id ?? ''}:${run?.endedAt ?? ''}`
  }
  async function discussionContext(target: string, topic: Topic): Promise<{ context: string; cwd?: string; version: string }> {
    // a Work: each of its parts as it would be on its own, cut so the whole stays small
    if (target.startsWith('work:')) {
      const keys = workMembers(target).sort()
      if (!keys.length) throw new Error('That piece of work is gone')
      const parts = await Promise.all(keys.map((k) => discussionContext(k, topic).catch(() => undefined)))
      const each = Math.floor(24_000 / keys.length)
      return {
        version: versionOf(target) ?? '',
        cwd: parts.find((x) => x?.cwd)?.cwd,
        context: `One piece of work in ${keys.length} parts (tickets and pull requests linked together, sharing one memory):\n\n`
          + parts.map((x, i) => `### ${keys[i]}\n${x ? x.context.slice(0, each) : '(could not be read)'}`).join('\n\n'),
      }
    }
    if (target.startsWith('stack:')) {
      const stack = stackOfTarget(target)
      if (!stack) throw new Error('That stack is no longer open')
      const each = stack.map((x, i) => {
        const p = state.prs[`${x.repo}#${x.number}`]
        return `${i + 1}. #${x.number} "${x.title}" by ${x.author}: ${x.head} into ${x.base}${p ? `, ${p.changedFiles} files, +${p.additions} −${p.deletions}` : ''}. Its diff: git diff origin/${x.base}...origin/${x.head}`
          + `\n   Its description: ${(p?.body ?? '').slice(0, 1500).replace(/\n+/g, ' ') || '(none)'}`
      }).join('\n')
      const tickets = [...new Map(stack.flatMap((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return p ? ticketsOf(p) : [] }).map((t) => [t.id, t])).values()]
        .map((t) => `- ${t.id} ${t.title}\n${t.description.slice(0, 1200)}`).join('\n') || '(none)'
      return {
        version: stack.map((x) => { const p = state.prs[`${x.repo}#${x.number}`]; return `${p?.headSha ?? ''}:${p?.feedbackAt ?? ''}` }).join(),
        cwd: config.repos[stack[0].repo],
        context: `The work: a stack of ${stack.length} pull requests in ${stack[0].repo}, bottom first (each builds on the one before):\n${each}`
          + '\n(git fetch origin first if a branch is missing.)'
          + `\n\nThe tickets they name:\n${tickets}`,
      }
    }
    if (target.startsWith('pr:')) {
      const p = state.prs[target.slice(3)]
      if (!p) throw new Error('No such PR')
      const tickets = ticketsOf(p).map((t) => `- ${t.id} ${t.title}\n${t.description.slice(0, 1500)}`).join('\n') || '(none)'
      // the change itself, cut: the card is written without tools, so what it says about the code comes from here
      const dir = config.repos[p.repo]
      const diff = topic === 'understanding' && dir ? await git(dir, 'diff', '-U1', '--no-color', `origin/${p.base}...origin/${p.head}`, '--', '.', ':!*lock*', ':!*.snap').then((t) => t.slice(0, 9000), () => '') : ''
      return {
        version: `${p.headSha}:${p.feedbackAt ?? ''}`,
        cwd: config.repos[p.repo],
        context: `The work: pull request ${p.repo}#${p.number} "${p.title}" by ${p.author.login}${p.mine ? ' (the developer\'s own, revised by an agent)' : ' (the developer reviews it, helped by an agent)'}: ${p.head} into ${p.base}, ${p.changedFiles} files, +${p.additions} −${p.deletions}.`
          + `\nIts diff: git diff origin/${p.base}...origin/${p.head} (git fetch origin first if a branch is missing).`
          + `\n\nThe PR's description:\n${(p.body ?? '').slice(0, 4000) || '(none)'}\n\nThe tickets it names:\n${tickets}\n\nWhat the main agent said last:\n${await lastWord(p.id)}`
          + (topic === 'understanding' ? `\n\nIts explanation (what the Explain view shows: the tour, the business and technical views):\n${await explainedOf(p.id)}` : '')
          + (diff ? `\n\nThe diff (cut at 9000 characters):\n${diff}` : ''),
      }
    }
    const id = target.slice(7)
    const t = ticketViews().find((x) => x.id === id)
    if (!t) throw new Error('No such ticket')
    const run = t.run
    return {
      version: `${run?.id ?? ''}:${run?.endedAt ?? ''}`,
      cwd: t.repo ? config.repos[t.repo] : undefined,
      context: `The work: the Linear ticket ${t.id} "${t.title}"${t.labels.length ? ` (${t.labels.join(', ')})` : ''}, shipped by a coding agent.`
        + `\n\nThe ticket:\n${t.description.slice(0, 5000) || '(no description)'}`
        + (run?.plan ? `\n\nThe agent's plan: skills ${run.plan.skills.map((x) => x.name).join(', ') || 'none'}; steps: ${run.plan.steps.join('; ')}` : '')
        + (t.prs.length ? `\n\nIts PRs: ${t.prs.map((x) => `#${x.number} ${x.url}`).join(', ')}` : '')
        + `\n\nWhat the main agent said last:\n${run ? await lastWord(`exec:${run.id}`) : '(no run yet)'}`,
    }
  }
  // each card says whether the work moved on since it was written (it is written again when next asked)
  app.get('/discussions', (c) => {
    const target = String(c.req.query('target')), v = versionOf(target), d = discussionsOf(target)
    return c.json(Object.fromEntries(Object.entries(d).map(([k, x]) => [k, { ...x, stale: !!x.brief && !!v && x.brief.version !== v }])))
  })
  app.post('/discussions/say', async (c) => {
    const { target, topic, text } = await c.req.json<{ target: string; topic: Topic; text: string }>()
    if (!text?.trim() || !['intent', 'understanding'].includes(topic)) return c.json({ error: 'Nothing to say' }, 400)
    try {
      const { context, cwd } = await discussionContext(target, topic)
      say(target, topic, text.trim(), context, cwd, settled(discussionsOf(target)[topic === 'intent' ? 'understanding' : 'intent']), discussionPrs(target))
      return c.json(discussionsOf(target))
    } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })
  // the other parts' conversations, for one shared chat: each entry says which part it is from
  app.get('/works/feed', async (c) => {
    const here = String(c.req.query('member') ?? '')
    const { members } = workOfMember(here)
    const feeds = await Promise.all(members.filter((m) => m.key !== here).map(async (m) =>
      (m.kind === 'pr' ? await loadActivity(m.key.slice(3)) : await ticketActivity(m.key.slice(7))).slice(-600).map((a) => ({ ...a, part: m.label }))))
    return c.json(feeds.flat().sort((a, b) => a.at.localeCompare(b.at)).slice(-1500))
  })
  // what @ in the box can name: the tickets on your board and the PRs being tracked
  app.get('/works/candidates', (c) => c.json([
    ...execBoard.tickets.map((t) => ({ key: `ticket:${t.id}`, kind: 'ticket', label: t.id, title: t.title })),
    ...Object.values(state.prs).filter((p) => !p.closed).map((p) => ({ key: `pr:${p.id}`, kind: 'pr', label: `#${p.number}`, repo: p.repo, title: p.title })),
  ]))
  // a link you made, undone: the part that comes apart takes a copy of the memory with it
  app.post('/works/unlink', async (c) => {
    const { a, b } = await c.req.json<{ a: string; b: string }>()
    const { w } = workOfMember(a)
    const had = w.links.length
    w.links = w.links.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)))
    if (w.links.length === had) return c.json({ error: 'Linked by name or by its stack, not by you: rename the PR, or move it out of the stack, to separate them' }, 400)
    const keep = new Set(component(a, workEdges)), apart = component(b, workEdges)
    if (!keep.has(b)) { const id = randomUUID().slice(0, 8); state.works![id] = { id, at: new Date().toISOString(), said: [...w.said], links: [] }; for (const k of apart) state.workOf![k] = id }
    save(); stale('/works')
    return c.json({ ok: true })
  })
  // a member's Work: its id, the target its cards live under, and its parts
  app.get('/works', (c) => {
    const key = String(c.req.query('member') ?? '')
    if (!/^(pr|ticket):/.test(key)) return c.json({ error: 'member is pr:… or ticket:…' }, 400)
    const { w, members } = workOfMember(key) // (a work made here is kept with the next thing saved: a read doesn't write)
    return c.json({ id: w.id, target: `work:${w.id}`, members, links: w.links, said: w.said.slice(-20) })
  })
  // a card asked (or, with no words, written): answered from the card, which is written again first when the work moved on
  app.post('/discussions/ask', async (c) => {
    const { target, topic, text } = await c.req.json<{ target: string; topic: Topic; text?: string }>()
    if (!['intent', 'understanding'].includes(topic)) return c.json({ error: 'No such card' }, 400)
    try {
      const { context, cwd, version } = await discussionContext(target, topic)
      askCard(target, topic, (text ?? '').trim().slice(0, 4000), { context, cwd, version, shared: settled(discussionsOf(target)[topic === 'intent' ? 'understanding' : 'intent']), prs: discussionPrs(target) })
      return c.json(discussionsOf(target))
    } catch (e) { return c.json({ error: (e as Error).message }, 400) }
  })
  app.post('/discussions/sent', async (c) => { const { target, topic, number } = await c.req.json<{ target: string; topic: Topic; number?: number }>(); markSent(target, topic, number); return c.json(discussionsOf(target)) })
  app.post('/discussions/reset', async (c) => { const { target, topic } = await c.req.json<{ target: string; topic: Topic }>(); reset(target, topic); return c.json(discussionsOf(target)) })
}
