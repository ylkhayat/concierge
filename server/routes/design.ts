// The design routes, out of server/index.ts: mounted on the API there.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stale, shared } from '../live.ts'
import { baselineId, DESIGN_LABEL, imagePath, modeOf, setsOf, storybookFile, uiChange, wanted } from '../visuals.ts'
import { gh } from '../github.ts'
import { type Ticket } from '../linear.ts'
import { fleet } from '../fleet.ts'
import { cancelSetup, cancelVisuals, enqueueSetup, enqueueVisuals } from '../runner.ts'
import { loadActivity, bus } from '../runner.ts'
import { roles } from '../roles.ts'
import { config, save, state, type Pr } from '../store.ts'
import type { Hono as App } from 'hono'

// what these routes use that lives in index.ts
type Deps = { execBoard: { tickets: Ticket[] }; ticketsOf: (p: Pr) => Ticket[] }
export function designRoutes(app: App, { execBoard, ticketsOf }: Deps) {
  // --- Design: visuals (visuals.ts) --------------------------------------------------------------------------------------
  const designJoined = () => roles().joined.includes('design')
  /** A PR's visuals as the page needs them: its setting and why, whether it changes what people see, its capture now and before. */
  async function visualsView(p: Pr) {
    const mode = modeOf(p.repo), sets = await setsOf(p.id)
    return {
      id: p.id, repo: p.repo, number: p.number, title: p.title, url: p.url, author: p.author.login, mine: !!p.mine, draft: p.draft, headSha: p.headSha,
      mode, override: p.visualsOverride, ui: p.ui, wanted: wanted(mode, p.visualsOverride, p.ui), task: p.visuals,
      tickets: ticketsOf(p).map((t) => t.id), sets,
    }
  }
  /** The PR's changed files, from GitHub (three pages at most): what decides whether it changes what people see. */
  async function changedFiles(p: Pr): Promise<string[]> {
    const out: string[] = []
    for (let page = 1; page <= 3; page++) {
      const got = await gh<{ filename: string }[]>(`/repos/${p.repo}/pulls/${p.number}/files?per_page=100&page=${page}`).catch(() => [] as { filename: string }[])
      out.push(...got.map((f) => f.filename))
      if (got.length < 100) break
    }
    return out
  }
  /** Whether a PR changes what people see, read again only for a new commit. */
  async function checkUi(p: Pr) {
    if (p.ui?.head === p.headSha) return p.ui
    const labels = ticketsOf(p).flatMap((t) => t.labels ?? [])
    p.ui = uiChange(await changedFiles(p), labels, p.headSha)
    save()
    return p.ui
  }
  /**
   * Every 2 minutes, once you joined Design: the open PRs of repositories with visuals on (and the ones you turned on
   * yourself) are checked for a new commit; one that changes what people see, and is yours, gets its screens captured
   * once per commit. Someone else's PR waits for Capture now: running another person's code is your call.
   */
  let visualsBusy = false
  async function visualsTick() {
    if (visualsBusy || fleet.elsewhere() || !designJoined()) return
    visualsBusy = true
    try {
      for (const p of Object.values(state.prs)) {
        if (p.closed || !config.repos[p.repo] || p.visualsOverride === 'off') continue
        const mode = modeOf(p.repo)
        if (mode === 'off' && p.visualsOverride !== 'on') continue
        const ui = await checkUi(p).catch(() => undefined)
        if (!p.mine || p.draft || !wanted(mode, p.visualsOverride, ui)) continue
        const t = p.visuals
        if (t?.headSha === p.headSha && t.state !== 'cancelled') continue // this commit is captured, being captured, or failed once
        enqueueVisuals(p, { auto: true })
      }
    } finally { visualsBusy = false; stale('/visuals') }
  }
  setInterval(() => void visualsTick(), 120_000).unref()
  setTimeout(() => void visualsTick(), 15_000).unref()
  bus.on('visuals', () => stale('/visuals'))

  /** Design's list: the PRs that change what people see (or that you turned on) and the tickets marked design. */
  app.get('/visuals', async (c) => c.json(await shared('/visuals', 15_000, visualsList)))
  // every manifest of every PR and repository Design looks at is read from disk for this: kept 15s, and forgotten when
  // a capture or a setting says it changed
  async function visualsList() {
    const prs = Object.values(state.prs).filter((p) => !p.closed && config.repos[p.repo] && (p.ui?.is || p.visualsOverride === 'on' || modeOf(p.repo) === 'always' || p.visuals))
    const list = await Promise.all(prs.map(visualsView))
    const tickets = execBoard.tickets.filter((t) => (t.labels ?? []).some((l) => DESIGN_LABEL.test(l.trim())) || list.some((v) => v.tickets.includes(t.id)))
      .map((t) => ({ id: t.id, title: t.title, labels: t.labels ?? [], url: t.url, prs: list.filter((v) => v.tickets.includes(t.id)).map((v) => v.id) }))
    // the repositories Design looks at: their baseline (the first shot of every component, once their Storybook is set
    // up) and whether their captures still come from the running app (no stories yet: Set up Storybook)
    const repoIds = [...new Set([...Object.keys(config.visuals?.repos ?? {}).filter((r) => modeOf(r) !== 'off'), ...Object.keys(config.repos).filter((r) => modeOf(r) !== 'off'), ...list.map((v) => v.repo), ...Object.keys(state.visualsSetup ?? {})])].filter((r) => config.repos[r])
    const repoList = await Promise.all(repoIds.map(async (r) => {
      const base = await setsOf(baselineId(r)), its = list.filter((v) => v.repo === r)
      return { repo: r, mode: modeOf(r), task: state.visualsSetup?.[r], baseline: base[0] && { sha: base[0].sha, at: base[0].at, count: base[0].shots.length, thumb: (base[0].shots.find((x) => x.domain && (x.thumb ?? x.after)) ?? base[0].shots.find((x) => x.after))?.after,
          screens: base[0].shots.filter((x) => x.domain).length, domains: new Set(base[0].shots.map((x) => x.domain).filter(Boolean)).size },
        fromApp: !base.length && its.some((v) => v.sets[0]?.source === 'app') }
    }))
    return { joined: designJoined(), repos: repoList, prs: list.map(({ sets, ...v }) => ({ ...v, latest: sets[0] && { sha: sets[0].sha, at: sets[0].at, summary: sets[0].summary, count: sets[0].shots.length, thumb: sets[0].shots.find((s) => s.after)?.after } })), tickets }
  }
  app.get('/prs/:id/visuals', async (c) => {
    const p = state.prs[decodeURIComponent(c.req.param('id'))]
    if (!p) return c.json({ error: 'No such PR' }, 404)
    // whether it changes what people see is worked out beside the read (GitHub is asked), and the page reads again when it is known
    if (!p.ui && config.repos[p.repo]) void checkUi(p).then(() => stale(`/prs/${encodeURIComponent(p.id)}/visuals`), () => undefined)
    return c.json(await visualsView(p))
  })
  // capture now, say something about the screens (the conversation), stop it, or turn this PR on or off
  app.post('/prs/:id/visuals', async (c) => {
    const p = state.prs[decodeURIComponent(c.req.param('id'))]
    if (!p) return c.json({ error: 'No such PR' }, 404)
    const b = await c.req.json() as { say?: string; capture?: boolean; cancel?: boolean; override?: 'on' | 'off' | null }
    if (b.override !== undefined) { if (b.override === 'on' || b.override === 'off') p.visualsOverride = b.override; else delete p.visualsOverride; save() }
    if (b.cancel) cancelVisuals(p)
    const said = typeof b.say === 'string' ? b.say.trim().slice(0, 4000) : ''
    let how: string | undefined
    if (said || b.capture) {
      if (!config.repos[p.repo]) return c.json({ error: `${p.repo} has no checkout here` }, 400)
      how = enqueueVisuals(p, { said: said || undefined })
      if (how === 'no') return c.json({ error: 'It can\'t be captured: the PR is closed or its repository isn\'t set up' }, 400)
    }
    stale('/visuals')
    return c.json({ ...(await visualsView(p)), how })
  })
  // a repository's baseline: its Storybook set up as a PR, and the first shot of every component (setupPrompt)
  app.get('/visuals/repos/:owner/:name', async (c) => {
    const repo = `${c.req.param('owner')}/${c.req.param('name')}`
    if (!config.repos[repo]) return c.json({ error: 'Not a watched repository' }, 404)
    return c.json({ repo, mode: modeOf(repo), task: state.visualsSetup?.[repo], sets: await setsOf(baselineId(repo)) })
  })
  app.post('/visuals/repos/:owner/:name', async (c) => {
    const repo = `${c.req.param('owner')}/${c.req.param('name')}`
    if (!config.repos[repo]) return c.json({ error: 'Not a watched repository' }, 404)
    const b = await c.req.json() as { setup?: boolean; board?: boolean; say?: string; cancel?: boolean }
    if (b.cancel) cancelSetup(repo)
    const said = typeof b.say === 'string' ? b.say.trim().slice(0, 4000) : ''
    // board: only the blueprint, for a baseline that has its stories (the session that set them up goes on)
    const how = b.setup || b.board || said ? enqueueSetup(repo, said || undefined, !!b.board) : undefined
    if (how === 'no') return c.json({ error: `${repo} has no checkout set up` }, 400)
    stale('/visuals')
    return c.json({ repo, task: state.visualsSetup?.[repo], how })
  })
  // Design's Tokens view: each app's tokens from the baseline's built Storybook (tokens.ts)
  app.get('/visuals/tokens/:owner/:name', async (c) => {
    const repo = `${c.req.param('owner')}/${c.req.param('name')}`
    if (!config.repos[repo]) return c.json({ error: 'Not a watched repository' }, 404)
    const { tokensFor } = await import('../tokens.ts')
    return c.json({ repo, ...(await tokensFor(repo)) })
  })
  // The Tokens view's draft: changes previewed at once, a PR only once confirmed (tokenDraft.ts)
  app.get('/visuals/tokens/:owner/:name/draft', async (c) => {
    const repo = `${c.req.param('owner')}/${c.req.param('name')}`
    if (!config.repos[repo]) return c.json({ error: 'Not a watched repository' }, 404)
    const { draftOf } = await import('../tokenDraft.ts')
    return c.json(draftOf(repo))
  })
  app.post('/visuals/tokens/:owner/:name/draft', async (c) => {
    const repo = `${c.req.param('owner')}/${c.req.param('name')}`
    if (!config.repos[repo]) return c.json({ error: 'Not a watched repository' }, 404)
    const b = await c.req.json() as { say?: string; set?: { book: string; name: string; theme: string; value: string; was?: string }; drop?: { book: string; name: string; theme?: string }; discard?: boolean; confirm?: boolean }
    const x = await import('../tokenDraft.ts')
    const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '')
    if (b.set && str(b.set.name)) return c.json(x.setChange(repo, { book: str(b.set.book), name: str(b.set.name), theme: str(b.set.theme) || 'default', value: str(b.set.value), was: b.set.was === undefined ? undefined : str(b.set.was) }))
    if (b.drop) return c.json(x.dropChanges(repo, { book: str(b.drop.book), name: str(b.drop.name), theme: b.drop.theme ? str(b.drop.theme) : undefined }))
    if (b.discard) return c.json(x.dropChanges(repo))
    if (b.confirm) {
      const r = await x.confirmDraft(repo)
      if (r.how === 'no') return c.json({ error: `${repo} has no checkout set up` }, 400)
      return c.json(r.draft)
    }
    const said = str(b.say, 4000).trim()
    return c.json(said ? await x.sayDraft(repo, said) : x.draftOf(repo))
  })
  // Design's Components and Tokens views: each its own conversation about the repository (runner.ts enqueueChat)
  const chatOf = (c: { req: { param: (k: string) => string } }) => {
    const view = c.req.param('view'), repo = `${c.req.param('owner')}/${c.req.param('name')}`
    return (view === 'components' || view === 'tokens') && config.repos[repo] ? { view: view as 'components' | 'tokens', repo } : undefined
  }
  app.get('/visuals/chat/:view/:owner/:name', (c) => {
    const x = chatOf(c)
    return x ? c.json({ task: state.designChats?.[`${x.view}:${x.repo}`] }) : c.json({ error: 'Not a watched repository' }, 404)
  })
  app.post('/visuals/chat/:view/:owner/:name', async (c) => {
    const x = chatOf(c)
    if (!x) return c.json({ error: 'Not a watched repository' }, 404)
    const b = await c.req.json() as { say?: string; cancel?: boolean }
    const { enqueueChat, cancelChat } = await import('../runner.ts')
    if (b.cancel) cancelChat(x.view, x.repo)
    const said = typeof b.say === 'string' ? b.say.trim().slice(0, 4000) : ''
    const how = said ? enqueueChat(x.view, x.repo, said) : undefined
    if (how === 'no') return c.json({ error: `${x.repo} has no checkout set up` }, 400)
    return c.json({ task: state.designChats?.[`${x.view}:${x.repo}`], how })
  })
  app.get('/visuals/chat/:view/:owner/:name/activity', async (c) => c.json(await loadActivity(`design-${c.req.param('view')}:${c.req.param('owner')}/${c.req.param('name')}`)))
  app.get('/visuals/setup/:owner/:name/activity', async (c) => c.json(await loadActivity(`setup:${c.req.param('owner')}/${c.req.param('name')}`)))
  app.get('/visuals/:id/activity', async (c) => c.json(await loadActivity(`visuals:${decodeURIComponent(c.req.param('id'))}`)))
  // a baseline's built Storybook, file by file, for the board's live screens (visuals.ts storybookFile: baselines only)
  const SB_TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm' }
  // MSW reloads a page it doesn't control yet whenever any registration of its worker's address exists, whichever
  // Storybook's folder it is for: each page sees only its own Storybook's (or Rumanna reloaded forever once Buffehgi had one).
  // Also quiet: Next's "Runtime config is deprecated", which Storybook's Next.js framework sets off on every page load (it
  // imports next/config itself; nothing in the app to change)
  const SW_SCOPE = `(function(){var w=console.warn;console.warn=function(){if(!/Runtime config is deprecated/.test(String(arguments[0])))w.apply(console,arguments)}})();(function(){var c=navigator.serviceWorker;if(!c)return;var r=c.register.bind(c),base=location.pathname.replace(/[^/]*$/,'');c.register=function(u,o){try{if(/mockServiceWorker\\.js$/.test(new URL(u,location.href).pathname))o=Object.assign({},o,{scope:base})}catch(e){}return r(u,o)};var g=c.getRegistrations.bind(c),at=location.origin+base;c.getRegistrations=function(){return g().then(function(l){return l.filter(function(x){return x.scope===at})})}})()`
  // the board's screens as they rendered (the page's own HTML and CSS, without its scripts): one live page renders each
  // once, in the browser, and its markup is kept beside the build, for every visit and every machine after (it travels)
  const SNAP = /^[\w-]{1,200}$/
  app.get('/visuals/snaps/:slug/:sha', async (c) => {
    const { slug, sha } = c.req.param(), { readdir } = await import('node:fs/promises'), { VISUALS_DIR } = await import('../visuals.ts')
    if (!/^repo-[\w.-]+$/.test(slug) || !/^[0-9a-f]{7,40}$/.test(sha)) return c.json([])
    const dir = join(VISUALS_DIR, slug, sha, 'storybook'), out: string[] = []
    for (const book of await readdir(dir).catch(() => [] as string[])) for (const f of await readdir(join(dir, book, '__snap__')).catch(() => [] as string[])) if (f.endsWith('.html')) out.push(`${book}/${f.slice(0, -5)}`)
    return c.json(out)
  })
  app.post('/visuals/snaps/:slug/:sha', async (c) => {
    const { slug, sha } = c.req.param(), b = await c.req.json() as { book?: string; story?: string; html?: string }
    if (!/^repo-[\w.-]+$/.test(slug) || !/^[0-9a-f]{7,40}$/.test(sha) || !b.book || !/^[\w.-]{1,60}$/.test(b.book) || b.book.includes('..') || !b.story || !SNAP.test(b.story) || typeof b.html !== 'string' || b.html.length > 6_000_000) return c.json({ error: 'Not a screen' }, 400)
    if (!await storybookFile(slug, sha, `${b.book}/iframe.html`)) return c.json({ error: 'No such Storybook' }, 404)
    const { VISUALS_DIR } = await import('../visuals.ts'), dir = join(VISUALS_DIR, slug, sha, 'storybook', b.book, '__snap__')
    // nothing that runs: no script, no handler, no javascript: address (the page serves it with script-src 'none' too)
    const html = b.html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '')
    await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${b.story}.html`), html)
    return c.json({ ok: true })
  })
  app.get('/visuals/sb/:slug/:sha/*', async (c) => {
    const { slug, sha } = c.req.param(), rest = decodeURIComponent(c.req.path.split(`/visuals/sb/${slug}/${sha}/`)[1] ?? '')
    const path = await storybookFile(slug, sha, rest)
    if (!path) return c.body(null, 404)
    const ext = path.split('.').pop()!.toLowerCase(), html = ext === 'html', snap = rest.includes('/__snap__/')
    if (snap) return new Response(await readFile(path), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-cache',
      // a screen as it rendered, kept: nothing in it runs
      'content-security-policy': "script-src 'none'; frame-ancestors 'self'", 'x-content-type-options': 'nosniff' } })
    // a build made for its own server registers MSW's worker at the site's root ('/mockServiceWorker.js'): served there
    // below, and registered here for this Storybook's folder only, so it mocks its pages and never sees Concierge's
    const body = html ? (await readFile(path, 'utf8')).replace(/<head[^>]*>/i, (h) => `${h}<script>${SW_SCOPE}</script>`) : await readFile(path)
    return new Response(body, { headers: {
      'content-type': SB_TYPES[ext] ?? 'application/octet-stream',
      // a build never changes under its commit; the pages themselves are looked at again
      'cache-control': html ? 'private, no-cache' : 'private, max-age=31536000, immutable',
      // shown only inside Concierge's own page, never framed elsewhere
      ...(html && { 'content-security-policy': "frame-ancestors 'self'" }), 'x-content-type-options': 'nosniff',
    } })
  })
  // one screenshot, by PR, commit and file name (nothing else under the visuals folder is reachable)
  app.get('/visuals/image', async (c) => {
    const path = await imagePath(c.req.query('pr') ?? '', c.req.query('sha') ?? '', c.req.query('f') ?? '')
    if (!path) return c.body(null, 404)
    return new Response(await readFile(path), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' } })
  })

}
