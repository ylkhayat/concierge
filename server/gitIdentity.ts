// Who the agents commit as, when nobody said (GIT_AUTHOR_NAME/EMAIL, or a git config of your own): the GitHub account
// you signed in with, with its private noreply address. Set once the token is there (onboarding's sign-in, or a key
// another machine set), never over a name or email already configured.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const get = (k: string) => run('git', ['config', '--global', '--get', k], { timeout: 5000 }).then((r) => r.stdout.trim(), () => '')

export async function gitIdentity(): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) return
  const [name, email] = await Promise.all([get('user.name'), get('user.email')])
  const want = { name: name || process.env.GIT_AUTHOR_NAME || '', email: email || process.env.GIT_AUTHOR_EMAIL || '' }
  if (name && email) return
  if (!want.name || !want.email) {
    const r = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
    const u = r?.ok ? await r.json().catch(() => ({})) as { login?: string; name?: string; id?: number } : {}
    if (!u.login) return
    want.name ||= u.name || u.login
    want.email ||= `${u.id}+${u.login}@users.noreply.github.com`
  }
  try {
    if (!name) await run('git', ['config', '--global', 'user.name', want.name], { timeout: 5000 })
    if (!email) await run('git', ['config', '--global', 'user.email', want.email], { timeout: 5000 })
    console.log(`git: agents commit as ${want.name} <${want.email}>`)
  } catch (e) { console.error('git: could not set who commits:', (e as Error).message) }
}
