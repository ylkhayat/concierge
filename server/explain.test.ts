import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { listTree, parseImport, resolve } from './atlas.ts'
import { buildFacts, carryOver, staleNodes, type NodeSummary } from './explain.ts'

// a tiny monorepo: an app importing a shared package, plus python with relative and absolute imports
const repo = mkdtempSync(join(tmpdir(), 'rd-explain-'))
const sh = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim()
const put = (p: string, body: string) => { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), body) }
sh('init', '-q', '-b', 'main'); sh('config', 'user.email', 't@t'); sh('config', 'user.name', 't')
put('packages/shared/package.json', '{ "name": "@acme/shared" }')
put('packages/shared/src/index.ts', 'export const money = 1\n')
put('apps/web/src/pages/checkout.ts', "import { money } from '@acme/shared'\nimport { cart } from '../state/cart'\n")
put('apps/web/src/state/cart.ts', 'export const cart = []\n')
put('apps/web/src/state/user.ts', "import { cart } from './cart'\n")
put('apps/ai/src/brain/runner.py', 'from .budget import Budget\nfrom src.tools.search import run\n')
put('apps/ai/src/brain/budget.py', 'class Budget: pass\n')
put('apps/ai/src/tools/search.py', 'def run(): pass\n')
sh('add', '-A'); sh('commit', '-qm', 'base')
const base = sh('rev-parse', 'HEAD')
put('apps/web/src/state/cart.ts', 'export const cart = [1]\n')
put('apps/ai/src/brain/budget.py', 'class Budget:\n  limit = 10\n')
sh('add', '-A'); sh('commit', '-qm', 'pr v1')
const v1 = sh('rev-parse', 'HEAD')

test('imports: TS relative + workspace package, Python relative + absolute', async () => {
  const tree = await listTree(repo, v1)
  const files = new Set([...tree].filter(([, e]) => e.type === 'blob').map(([p]) => p))
  const pkgs = new Map([['@acme/shared', 'packages/shared']])
  const r = (f: string, line: string) => resolve(f, parseImport(f, line)!, files, pkgs)
  assert.equal(r('apps/web/src/pages/checkout.ts', "import { cart } from '../state/cart'"), 'apps/web/src/state/cart.ts')
  assert.equal(r('apps/web/src/pages/checkout.ts', "import { money } from '@acme/shared'"), 'packages/shared/src/index.ts')
  assert.equal(r('apps/ai/src/brain/runner.py', 'from .budget import Budget'), 'apps/ai/src/brain/budget.py')
  assert.equal(r('apps/ai/src/brain/runner.py', 'from src.tools.search import run'), 'apps/ai/src/tools/search.py')
})

test('facts: touched chain, blast radius and edges between siblings', async () => {
  const { facts } = await buildFacts(repo, base, v1, [])
  assert.deepEqual(facts.roots.sort(), ['apps/ai', 'apps/web'])
  // cart.ts changed, so checkout.ts and user.ts are its dependents
  assert.deepEqual(facts.dependents.filter((d) => d.imports.endsWith('cart.ts')).map((d) => d.path).sort(), ['apps/web/src/pages/checkout.ts', 'apps/web/src/state/user.ts'])
  const web = facts.views['apps/web/src']
  assert.equal(web.children.find((c) => c.path === 'apps/web/src/state')?.touched, 'contains')
  assert.equal(web.children.find((c) => c.path === 'apps/web/src/pages')?.impacted, true)
  assert.deepEqual(facts.edges['apps/web/src'], [{ from: 'apps/web/src/pages', to: 'apps/web/src/state', count: 1 }])
  assert.ok(facts.systemEdges.some((e) => e.from === 'apps/web' && e.to === 'packages/shared'))
})

test('atlas: unchanged folders are never re-asked, drifted ones are updated', async () => {
  const { facts, tree, idx } = await buildFacts(repo, base, v1, [])
  const first = await staleNodes(repo, facts, tree, idx, {})
  assert.ok(first.length > 0 && first.every((a) => a.mode === 'new'))
  // pretend all were summarised at v1
  const nodes: Record<string, NodeSummary> = {}
  for (const a of first) nodes[a.path] = { sha: tree.get(a.path)!.sha, children: (idx.get(a.path) ?? []).map((p) => p.split('/').pop()!), summary: 's', responsibilities: [], at: '' }
  assert.deepEqual(await staleNodes(repo, facts, tree, idx, nodes), [], 'same sha: nothing to ask')

  // a small edit inside a folder keeps its summary; a new child folder forces an update
  put('apps/web/src/state/user.ts', "import { cart } from './cart'\nexport const u = 1\n")
  put('apps/web/src/hooks/useCart.ts', "import { cart } from '../state/cart'\n")
  sh('add', '-A'); sh('commit', '-qm', 'pr v2')
  const v2 = sh('rev-parse', 'HEAD')
  const next = await buildFacts(repo, base, v2, [])
  const asks = await staleNodes(repo, next.facts, next.tree, next.idx, nodes)
  assert.ok(!asks.some((a) => a.path === 'apps/web/src/state'), 'one-file drift reuses the summary')
  const src = asks.find((a) => a.path === 'apps/web/src')
  assert.equal(src?.mode, 'update', 'new child folder: update from the old summary')
  assert.equal(src?.previous, 's')
  assert.ok(asks.some((a) => a.path === 'apps/web/src/hooks' && a.mode === 'new'))
  // the untouched python side is not asked again
  assert.ok(!asks.some((a) => a.path.startsWith('apps/ai')))
})

test('iterations: only files changed since the last head are re-explained', () => {
  const prev = [
    { path: 'a.ts', change: 'modified' as const, after: 'A', why: 'w' },
    { path: 'b.ts', change: 'modified' as const, after: 'B', why: 'w' },
    { path: 'gone.ts', change: 'added' as const, after: 'G', why: 'w' },
  ]
  const { kept, ask } = carryOver(prev, ['a.ts', 'b.ts', 'c.ts'], ['b.ts', 'c.ts'])
  assert.deepEqual(kept.map((k) => k.path), ['a.ts'])
  assert.deepEqual(ask, ['b.ts', 'c.ts'])
  assert.deepEqual(carryOver(prev, ['a.ts'], undefined).ask, ['a.ts'], 'rewritten history: redo everything')
  assert.deepEqual(carryOver(undefined, ['a.ts'], []).ask, ['a.ts'], 'first iteration')
})

test('base map scope: folders with enough files, shallow first, no dot folders', async () => {
  const { baseScope } = await import('./explain.ts')
  const tree = await listTree(repo, v1)
  const scope = baseScope(tree)
  // apps/web/src has 3 files below it; apps/ai/src/brain has only 2
  assert.ok(scope.includes('apps/web/src'))
  assert.ok(!scope.includes('apps/ai/src/brain'))
  assert.ok(scope.indexOf('apps') < scope.indexOf('apps/web/src'), 'parents come before children')
  assert.ok(scope.every((p) => !p.split('/').some((x) => x.startsWith('.'))))
})

test('map deeper: every folder holding files below one folder, up to 3 more levels', async () => {
  const { deepScope } = await import('./explain.ts')
  const tree = await listTree(repo, v1)
  assert.deepEqual(deepScope(tree, 'apps/web'), ['apps/web/src', 'apps/web/src/pages', 'apps/web/src/state'])
  assert.deepEqual(deepScope(tree, 'apps/ai/src/brain'), [], 'a folder with only files has nothing deeper')
})

test('git clears a stale lock left by an interrupted git, and keeps a fresh one', async () => {
  const { git } = await import('./atlas.ts')
  const { mkdtempSync, writeFileSync, utimesSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const repo = mkdtempSync(join(tmpdir(), 'lock-'))
  await git(repo, 'init', '-q'); writeFileSync(join(repo, 'a'), 'x')
  const lock = join(repo, '.git', 'index.lock')
  writeFileSync(lock, '')
  await assert.rejects(git(repo, 'add', 'a'), /index\.lock/) // fresh: may be a live git, left alone
  const old = (Date.now() - 20 * 60_000) / 1000
  utimesSync(lock, old, old)
  await git(repo, 'add', 'a') // stale: removed, retried
  assert.ok(!existsSync(lock))
})

test('a checkout gets past an index.lock a killed git left behind, but not a fresh one', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, utimesSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { checkoutAt } = await import('./explain.ts')
  const dir = mkdtempSync(join(tmpdir(), 'lock-')), g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
  g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one')
  const sha = g('rev-parse', 'HEAD'), lock = join(dir, '.git', 'index.lock')
  writeFileSync(lock, '')
  await assert.rejects(checkoutAt(dir, sha), /index\.lock/, 'a fresh lock may belong to a running git: left alone')
  utimesSync(lock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
  await checkoutAt(dir, sha)
  assert.equal(existsSync(lock), false)
})

test('a system map that lumps a monorepo into one system is not good enough', async () => {
  const { goodSkeleton, unitsOf } = await import('./explain.ts')
  const sig = ',apps,apps/ai-core,apps/ai-core-e2e,apps/backend,apps/web-app,apps/web-app-e2e,apps/websocket-api,libs,libs/llm,libs/salesforce,libs/store'
  assert.deepEqual(unitsOf(sig), ['apps/ai-core', 'apps/backend', 'apps/web-app', 'apps/websocket-api', 'libs/llm', 'libs/salesforce', 'libs/store'])
  const sys = (paths: string[][]) => ({ systems: paths.map((p, i) => ({ id: `s${i}`, name: '', kind: 'app', summary: '', paths: p })) })
  assert.equal(goodSkeleton(sys([['/apps']]), sig), false) // the Oct 29 map: one box for everything
  assert.equal(goodSkeleton(sys([['apps'], ['libs'], []]), sig), false) // owning a whole top-level folder hides the units in it
  assert.equal(goodSkeleton(sys([['apps/ai-core'], ['apps/backend'], ['apps/web-app'], ['apps/websocket-api'], ['libs/llm', 'libs/salesforce', 'libs/store']]), sig), true)
  assert.equal(goodSkeleton(sys([['apps/ai-core'], ['apps/backend'], ['apps/web-app']]), sig), false) // 3 of 7 units owned
  assert.equal(goodSkeleton(sys([['src']]), ',src,docs'), true) // a small repo: one system is fine
})
