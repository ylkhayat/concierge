// The Tokens view's draft: what a designer asks for shows at once, as a preview, and becomes a PR only when they say so.
// A message is one quick structured call (no tools, a small model: seconds), which answers with the whole draft after
// it; an edit on the sheet is the draft at once, with no call at all. "Make the PR" hands the draft to the Tokens
// conversation's agent (runner.ts enqueueChat), which changes the code to match it and opens the PR.
import { tmpdir } from 'node:os'
import { addSpend, save, state } from './store.ts'
import { providerFor, spawnAgent } from './providers.ts'
import { tokensFor, type TokenBook } from './tokens.ts'

export type DraftChange = { book: string; name: string; theme: string; value: string; was?: string }
export type DraftTurn = { who: 'you' | 'agent'; text: string; at: string }
export type TokenDraft = { changes: DraftChange[]; turns: DraftTurn[]; busy?: boolean; error?: string; sent?: { at: string; changes: DraftChange[] } }

export const draftOf = (repo: string): TokenDraft => ((state.tokenDrafts ??= {})[repo] ??= { changes: [], turns: [] })

/** One token's new value on the sheet: the draft at once. Its own old value takes it out of the draft. */
export function setChange(repo: string, c: DraftChange): TokenDraft {
  const d = draftOf(repo)
  d.changes = d.changes.filter((x) => !(x.book === c.book && x.name === c.name && x.theme === c.theme))
  if (c.value.trim() && c.value.trim() !== c.was) d.changes.push({ ...c, value: c.value.trim() })
  save(); return d
}
export function dropChanges(repo: string, which?: { book: string; name: string; theme?: string }): TokenDraft {
  const d = draftOf(repo)
  d.changes = which ? d.changes.filter((x) => !(x.book === which.book && x.name === which.name && (!which.theme || x.theme === which.theme))) : []
  if (!which) d.error = undefined
  save(); return d
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'changes'],
  properties: {
    reply: { type: 'string', description: 'One or two short sentences to the designer: what the draft now changes, or the answer to their question.' },
    changes: {
      type: 'array', description: 'The whole draft after this message: every change still wanted (keep the earlier ones unless they ask to undo them).',
      items: { type: 'object', additionalProperties: false, required: ['book', 'name', 'theme', 'value'], properties: { book: { type: 'string' }, name: { type: 'string' }, theme: { type: 'string' }, value: { type: 'string' } } },
    },
  },
}

const sheetOf = (books: TokenBook[]) => books.map((b) => `${b.book} (themes: ${b.themes.join(', ')}):\n${b.tokens.map((t) => `  ${t.name} [${t.kind}${t.rgb ? ', bare rgb channels' : t.hsl ? ', bare hsl channels' : ''}] ${Object.entries(t.values).map(([th, v]) => `${th}=${v}`).join(' ')} · read ${t.uses}×`).join('\n')}`).join('\n\n').slice(0, 14_000)

const waiting = new Map<string, Promise<unknown>>()
/** A designer's message: the draft after it, in seconds. Messages to one repository take turns. */
export function sayDraft(repo: string, text: string): Promise<TokenDraft> {
  const run = (waiting.get(repo) ?? Promise.resolve()).then(() => answer(repo, text))
  waiting.set(repo, run.catch(() => {}))
  return run
}

async function answer(repo: string, text: string): Promise<TokenDraft> {
  const d = draftOf(repo), now = new Date().toISOString()
  d.turns.push({ who: 'you', text, at: now }); d.busy = true; d.error = undefined; save()
  const { books } = await tokensFor(repo)
  const prompt = `A designer is changing the design tokens of ${repo}. What they see is a preview: their screens drawn with the draft's values, nothing in the code yet. Turn their words into the draft.

The tokens, by app (book), with each theme's value:
${sheetOf(books) || '(none read)'}

The draft so far:
${d.changes.length ? d.changes.map((c) => `  ${c.book} ${c.name} ${c.theme}: ${c.was ?? '(new)'} → ${c.value}`).join('\n') : '  (nothing yet)'}

The conversation so far:
${d.turns.slice(-9, -1).map((t) => `${t.who}: ${t.text}`).join('\n') || '(this is the first message)'}

Rules: a change names a token of a book and a theme as listed ("default" is the root's value). Write each value in the token's own form (bare channels stay bare channels: "233 134 154", not "rgb(...)"; a hex stays hex). When they don't name an app, change it in every app that has the token. Pick real values yourself (a warmer red, a 2px larger radius) rather than asking; ask only when you can't tell which token they mean. A question changes nothing: answer it and give the draft back as it was.

Their message:
${text}`
  try {
    const out = await new Promise<string>((ok, fail) => {
      const child = spawnAgent(providerFor('review'), ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--tools', '', '--model', 'haiku', '--max-budget-usd', '0.5'], { cwd: tmpdir() })
      let o = '', e = ''
      child.stdout.on('data', (c: Buffer) => { o += c })
      child.stderr.on('data', (c: Buffer) => { e = (e + c).slice(-400) })
      child.on('error', fail)
      child.on('close', (code) => (o.trim() ? ok(o) : fail(new Error(e.trim() || `it stopped (${code})`))))
    })
    const m = JSON.parse(out.trim().split('\n').pop()!) as { structured_output?: { reply: string; changes: Omit<DraftChange, 'was'>[] }; total_cost_usd?: number; result?: string; is_error?: boolean }
    addSpend(m.total_cost_usd ?? 0)
    const r = m.structured_output
    if (!r) throw new Error(m.result || 'no answer')
    const tok = (book: string, name: string) => books.find((b) => b.book === book)?.tokens.find((t) => t.name === name)
    d.changes = r.changes.filter((c) => c.value.trim()).map((c) => ({ ...c, value: c.value.trim(), was: tok(c.book, c.name)?.values[c.theme] }))
      .filter((c) => c.value !== c.was)
    d.turns.push({ who: 'agent', text: r.reply, at: new Date().toISOString() })
  } catch (e) {
    d.error = `It couldn't read that: ${(e as Error).message}`.slice(0, 300)
  } finally {
    d.busy = false; save()
  }
  return d
}

/** "Make the PR": the draft, as exact changes, to the Tokens conversation's agent. The preview starts over. */
export async function confirmDraft(repo: string): Promise<{ draft: TokenDraft; how: string }> {
  const d = draftOf(repo)
  if (!d.changes.length) return { draft: d, how: 'empty' }
  const { enqueueChat } = await import('./runner.ts')
  const said = `Make these token changes in the code, exactly these values, and open a PR (the designer saw them on a preview and confirmed). Change each where the token is defined (its theme's selector), not where it is used:
${d.changes.map((c) => `- ${c.book}: ${c.name} in ${c.theme === 'default' ? 'the root' : `the ${c.theme} theme`}: ${c.was ?? '(new token)'} → ${c.value}`).join('\n')}${d.turns.length ? `\n\nWhat they asked, for the PR's description:\n${d.turns.filter((t) => t.who === 'you').slice(-6).map((t) => `- ${t.text}`).join('\n')}` : ''}`
  const how = enqueueChat('tokens', repo, said)
  if (how !== 'no') {
    d.sent = { at: new Date().toISOString(), changes: d.changes }
    d.changes = []; d.turns.push({ who: 'agent', text: `Making the PR with ${d.sent.changes.length} change${d.sent.changes.length === 1 ? '' : 's'}.`, at: d.sent.at })
    save()
  }
  return { draft: d, how }
}
