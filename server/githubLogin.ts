// Signing in to GitHub instead of pasting a token: the GitHub CLI's own device sign-in (a code you enter at
// github.com/login/device), so nothing has to be registered. It runs in a folder of its own in Concierge's state, never
// your gh setup, and once it is approved the token it got is kept like a pasted one (sharedEnv.ts: every machine uses
// it) and the folder goes. An organisation that blocks the GitHub CLI's app, or wants single sign-on for it, still needs
// a pasted token: that stays the other way in.
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { STATE_DIR } from './paths.ts'

const run = promisify(execFile)
// what Concierge needs: your repositories (private ones too), your organisations' PRs, and re-running their workflows
const SCOPES = 'repo,read:org,workflow,project' // project: an organization's GitHub Projects, offered when planning, and a plan made into one

type Pending = { child: ReturnType<typeof spawn>; dir: string; done?: boolean; ok?: boolean; error?: string; login?: string }
let pending: Pending | undefined

/** The one-time code and where to enter it, from what gh prints while it waits (login and refresh print the same). */
export function deviceCode(out: string): { code: string; url: string } | undefined {
  const code = out.match(/one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/), url = out.match(/(https:\/\/github\.com\/login\/device\S*)/)
  return code && url ? { code: code[1], url: url[1] } : undefined
}

/**
 * Start the sign-in; returns the code and where to enter it. `keep` gets the token once it is approved.
 * `more`: scopes beyond the usual (webhooks ask admin:repo_hook). `refresh`: your own gh login is the token in use
 * (no GITHUB_TOKEN): `gh auth refresh` adds the scopes to it, in your gh setup, instead of a new sign-in of Concierge's.
 */
export async function startGithubLogin(keep: (token: string) => Promise<string | undefined>, o: { more?: string[]; refresh?: boolean } = {}): Promise<{ code: string; url: string }> {
  pending?.child.kill()
  // what an earlier sign-in left when the server stopped halfway: its folder may hold a token, so it goes
  for (const f of await readdir(STATE_DIR).catch(() => [] as string[])) if (f.startsWith('gh-login-')) await rm(join(STATE_DIR, f), { recursive: true, force: true }).catch(() => {})
  const dir = await mkdtemp(join(STATE_DIR, 'gh-login-'))
  // no token of ours in its way (gh refuses to sign in while GH_TOKEN is set), and its own config folder (a refresh:
  // yours, which it changes); no browser opened on the server (BROWSER: a command that does nothing)
  const env: NodeJS.ProcessEnv = { ...process.env, ...(!o.refresh && { GH_CONFIG_DIR: dir }), BROWSER: 'true' }
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN
  const scopes = [SCOPES, ...(o.more ?? [])].join(',')
  const args = o.refresh ? ['auth', 'refresh', '--hostname', 'github.com', '--scopes', (o.more ?? []).join(',') || SCOPES] : ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', scopes]
  // a refresh: stdin a pipe that says Enter once, should gh ask to press it before it "opens the browser" (BROWSER does nothing)
  const child = spawn('gh', args, { cwd: dir, env, stdio: [o.refresh ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  child.stdin?.end('\n')
  const p: Pending = { child, dir }
  pending = p
  const stop = setTimeout(() => child.kill(), 16 * 60_000) // the code is good for 15 minutes
  let out = ''
  child.on('close', async (code) => {
    clearTimeout(stop)
    try {
      if (code !== 0) throw new Error(out.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 300) || 'The sign-in was not approved')
      const token = (await run('gh', ['auth', 'token', '--hostname', 'github.com'], { env, timeout: 15_000 })).stdout.trim()
      if (!token) throw new Error('GitHub signed you in but gave no token')
      p.login = await keep(token)
      p.ok = true
      console.log(`github: signed in${p.login ? ` as ${p.login}` : ''}`)
    } catch (e) { p.ok = false; p.error = (e as Error).message; console.error('github sign-in failed:', p.error) } finally {
      p.done = true
      await rm(dir, { recursive: true, force: true }).catch(() => {}) // the token is kept with the other keys; this copy goes
    }
  })
  return new Promise((resolve, reject) => {
    const give = setTimeout(() => reject(new Error(`GitHub gave no sign-in code. ${out.slice(-200)}`)), 30_000)
    const read = (c: Buffer) => {
      out = (out + c).slice(-20_000)
      const d = deviceCode(out)
      if (d) { clearTimeout(give); resolve(d) }
    }
    child.stdout!.on('data', read); child.stderr!.on('data', read)
    child.on('close', () => { clearTimeout(give); reject(new Error(out.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 300) || 'gh stopped before giving a code')) }) // after resolve: nothing
  })
}
export const githubLoginState = () => (pending ? { done: !!pending.done, ok: !!pending.ok, error: pending.error, login: pending.login } : undefined)
