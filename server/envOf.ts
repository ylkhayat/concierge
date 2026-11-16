// Which environment a ticket is about, so an investigation goes to the right one (prod or dev data).
// Sentry's own event says it best (environment tag, app name); without a Sentry link, clear words in the ticket do.
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

export type Env = { env: 'prod' | 'dev'; source: 'sentry' | 'text'; detail: string } | { env: 'unknown'; source: 'none' | 'sentry'; detail: string }

/** The first Sentry issue a ticket links to: an issue URL, or a feedback URL (feedbackSlug=<project>:<issue id>). */
export function sentryRef(text: string): { org: string; issue: string } | undefined {
  for (const m of text.matchAll(/https:\/\/([\w-]+)\.sentry\.io\/[^\s)>\]]*/g)) {
    const issue = m[0].match(/\/issues\/([\w-]+)/)?.[1] ?? m[0].match(/feedbackSlug=[^&%]+(?:%3A|:)(\d+)/i)?.[1]
    if (issue) return { org: m[1], issue }
  }
}

/** Unambiguous words only: "[Dev]", an environment or app field naming staging/dev/sandbox, dev- hosts → dev; "environment: production" → prod. */
export function textEnv(text: string): Env | undefined {
  const dev = text.match(/\[dev\]|\benv(?:ironment)?:?\**\s*(?:staging|dev\w*|sandbox)\b|\bapp(?:_name)?:?\**\s*"?[\w ]*sandbox\b|\bdev-(?:app|api)\.[\w.]+/i)
  const prod = text.match(/\benv(?:ironment)?:?\**\s*(?:prod|production)\b|\[prod\]/i)
  if (dev && !prod) return { env: 'dev', source: 'text', detail: `the ticket says “${dev[0]}”` }
  if (prod && !dev) return { env: 'prod', source: 'text', detail: `the ticket says “${prod[0]}”` }
}

/** What Sentry's event says, mapped to prod or dev. */
export function fromSentry(environment: string, appName: string): Env {
  const detail = `Sentry: environment ${environment || '?'}${appName ? `, app ${appName}` : ''}`
  if (/sandbox|staging|dev/i.test(`${environment} ${appName}`)) return { env: 'dev', source: 'sentry', detail }
  if (/^prod(uction)?$/i.test(environment)) return { env: 'prod', source: 'sentry', detail }
  return { env: 'unknown', source: 'sentry', detail }
}

const inflight = new Map<string, Promise<{ env: Env; costUsd: number }>>()

/**
 * Ask Sentry (through the Sentry connector, so no token to set up) for the issue's environment and app name.
 * A lean read-only Haiku call, about a cent; the caller caches the answer per ticket for good.
 */
export function sentryEnv(org: string, issue: string) {
  const key = `${org}/${issue}`
  if (!inflight.has(key)) inflight.set(key, new Promise((resolve, reject) => {
    const schema = { type: 'object', additionalProperties: false, required: ['environment', 'appName'], properties: { environment: { type: 'string' }, appName: { type: 'string' } } }
    const child = spawn('claude', [
      '-p', `Use get_sentry_resource with resourceType "issue", organizationSlug "${org}", resourceId "${issue}". Return its event's "environment" tag and the "app_name" from the app context ("" when missing).`,
      '--json-schema', JSON.stringify(schema), '--output-format', 'json', '--model', 'haiku', '--max-budget-usd', '0.2',
      '--allowedTools', 'mcp__claude_ai_Sentry__get_sentry_resource', 'mcp__sentry-token__get_sentry_resource', '--disable-slash-commands', '--no-session-persistence',
    ], { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c: Buffer) => { out += c })
    child.on('error', reject)
    child.on('close', () => {
      try {
        const r = JSON.parse(out)
        const s = r.structured_output
        if (!s) throw new Error(String(r.result ?? 'no answer'))
        resolve({ env: fromSentry(s.environment, s.appName), costUsd: r.total_cost_usd ?? 0 })
      } catch (e) { reject(e) }
      setTimeout(() => inflight.delete(key), 1000)
    })
  }))
  return inflight.get(key)!
}
