// The agents' Claude Code can run on your full claude.ai login instead of a model-only token: then your claude.ai
// connectors (Linear, Sentry, …) come with it, no keys or tokens. In a container that means one sign-in, approved in
// your browser; the login is kept in ~/.claude/.credentials.json. If it ever stops working, the token comes back.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { save, state } from './store.ts'

const run = promisify(execFile)
// the model-only token (the shared one, else this machine's): the fallback when the full login isn't there or stops working
import { claudeToken, claudeTokenOff } from './sharedEnv.ts'

export type ClaudeAuth = { loggedIn: boolean; method?: string; email?: string; org?: string; plan?: string; usingLogin: boolean } // org, plan: the claude.ai organization and its tier (pro, max…)

/** How the agents' Claude Code is signed in right now (asked with the token out of the way when the login is in use). */
export async function claudeAuth(home?: string, loginOnly = false): Promise<ClaudeAuth> {
  const env = { ...process.env }
  if (state.claudeLogin || home || loginOnly) delete env.CLAUDE_CODE_OAUTH_TOKEN // loginOnly: is the login itself there, whatever is in use
  if (home) env.CLAUDE_CONFIG_DIR = home // another account: its own folder, its own login
  const out = await run('claude', ['auth', 'status'], { timeout: 30_000, cwd: '/tmp', env }).then((r) => r.stdout, (e) => String(e.stdout ?? ''))
  try {
    const j = JSON.parse(out.slice(out.indexOf('{'))) as { loggedIn?: boolean; authMethod?: string; email?: string; account?: { email?: string }; orgName?: string; subscriptionType?: string }
    return { loggedIn: !!j.loggedIn, method: j.authMethod, email: j.email ?? j.account?.email, org: j.orgName, plan: j.subscriptionType, usingLogin: !!state.claudeLogin }
  } catch { return { loggedIn: false, usingLogin: !!state.claudeLogin } }
}

/** Use the full login for everything this server starts (agents, connectors) by taking the token out of its environment. */
function useLogin(on: boolean) {
  claudeTokenOff(on)
  const token = claudeToken()
  if (on) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  else if (token) process.env.CLAUDE_CODE_OAUTH_TOKEN = token
  state.claudeLogin = on
  save()
}

let pending: { child: ReturnType<typeof spawn>; url?: string; done?: boolean; ok?: boolean; out: string } | undefined

/** Start the claude.ai sign-in; returns the address to approve. Its callback (localhost) reaches the container. */
export function startClaudeLogin(home?: string): Promise<string> {
  pending?.child.kill()
  const env = { ...process.env }
  delete env.CLAUDE_CODE_OAUTH_TOKEN // so it signs in for real instead of reporting the token
  if (home) env.CLAUDE_CONFIG_DIR = home // another account: signed in into its own folder
  const child = spawn('script', ['-qfec', 'claude auth login --claudeai', '/dev/null'], { cwd: '/tmp', env, stdio: ['pipe', 'pipe', 'pipe'] })
  const p: NonNullable<typeof pending> = { child, out: '' }
  pending = p
  const stop = setTimeout(() => child.kill(), 10 * 60_000)
  child.on('close', async () => {
    clearTimeout(stop)
    p.done = true
    // signed in? then the agents use it; verified by asking without the token
    const env2 = { ...env }
    const st = await run('claude', ['auth', 'status'], { timeout: 30_000, cwd: '/tmp', env: env2 }).then((r) => r.stdout, () => '')
    p.ok = /"loggedIn":\s*true/.test(st) && !/"authMethod":\s*"oauth_token"/.test(st)
    if (p.ok && !home) { useLogin(true); console.log('claude: agents now run on your claude.ai login') }
  })
  return new Promise((resolve, reject) => {
    const give = setTimeout(() => reject(new Error('No sign-in address came back')), 30_000)
    const read = (c: Buffer) => {
      p.out = (p.out + c).slice(-20_000)
      const m = p.out.match(/https:\/\/\S*(?:claude\.(?:ai|com)|anthropic\.com)\S*oauth\S*/)
      if (m && !p.url) { p.url = m[0].split(/[\u0007\u001b]/)[0]; clearTimeout(give); resolve(p.url) }
    }
    child.stdout!.on('data', read); child.stderr!.on('data', read)
  })
}

/** From another device: paste the code or address the sign-in page shows. */
export function finishClaudeLogin(input: string) {
  if (!pending || pending.done) throw new Error('The sign-in is not waiting anymore; start it again')
  pending.child.stdin!.write(input.trim() + '\n')
}
export const claudeLoginState = () => (pending ? { done: !!pending.done, ok: !!pending.ok } : undefined)

/** Go back to the model-only token (the login stays on disk, unused). */
export const stopUsingLogin = () => useLogin(false)

/**
 * At start, and every 30 minutes: use the login if it was chosen and still works; otherwise fall back to the token,
 * so agents never stop because a login expired.
 */
export function keepClaudeAuth() {
  void checkClaudeAuth()
  setInterval(() => void checkClaudeAuth(), 30 * 60_000)
}
let checking: Promise<void> | undefined
/** Check now, once at a time: also when an agent's run says its sign-in failed, so the next one doesn't wait half an hour. */
export const checkClaudeAuth = () => (checking ??= (async () => {
  const works = (a: ClaudeAuth) => a.loggedIn && a.method !== 'oauth_token'
  // it fell back once: the login is tried again each time, and taken back the moment it answers (one bad answer, a
  // refresh caught halfway, must not leave the agents on someone else's token for good)
  if (!state.claudeLogin) {
    if (!state.claudeLoginLapsed) return
    if (works(await claudeAuth(undefined, true))) { console.log('claude: the claude.ai login works again; agents are back on it'); useLogin(true); state.claudeLoginLapsed = undefined; save() }
    return
  }
  useLogin(true)
  if (works(await claudeAuth())) return
  // once more a minute later before falling back: a check can land while the login refreshes itself
  await new Promise((r) => setTimeout(r, 60_000))
  if (works(await claudeAuth())) return
  console.warn('claude: the claude.ai login stopped working; agents fall back to the token'); useLogin(false); state.claudeLoginLapsed = new Date().toISOString(); save()
})().finally(() => { checking = undefined }))
/** Claude Code's words when it can't sign in, in a run's output. */
export const authFailed = (text: string) => /Failed to authenticate|OAuth session expired|Invalid API key|Please run \/login/i.test(text)
/** A provider that can't be paid: a subscription that ended, no credit or quota left. */
export const cantPay = (text: string) => /credit balance is too low|subscription (has )?(ended|expired|been cancel)|no active subscription|payment required|insufficient_quota|exceeded your (current |monthly |weekly |daily )?quota|out of (premium )?requests/i.test(text)
