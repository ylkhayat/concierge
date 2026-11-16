// Azure, with your own login (az, signed in once with a code), so investigations can read logs and resources.
// Your login can do far more than read: agents may only run the reading commands below, and the changes are denied
// in ~/.claude/settings.json (which holds even for agents running with permission checks off).
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { saveConfig } from './config.ts'
import { config } from './store.ts'

const run = promisify(execFile)

// what the investigation guides run: shows, lists and log queries, nothing that changes anything
export const AZ_READ = [
  'account show', 'account list', 'account set', 'group list', 'resource list', 'resource show',
  'monitor log-analytics query', 'monitor log-analytics workspace list', 'monitor log-analytics workspace show', 'monitor activity-log list',
  'containerapp list', 'containerapp show', 'containerapp logs show', 'containerapp revision list', 'containerapp revision show',
  'lock list', 'afd custom-domain list', 'afd profile list', 'security alert show', 'security alert list',
  'storage account show', 'storage account list', 'keyvault certificate show', 'rest --method get', 'rest --method GET',
].map((c) => `Bash(az ${c}:*)`)

export type AzureStatus = { signedIn: boolean; user?: string; subscription?: string; subscriptions?: string[] }
let known: AzureStatus = { signedIn: false }
export async function azureStatus(): Promise<AzureStatus> {
  const out = await run('az', ['account', 'show', '-o', 'json'], { timeout: 30_000 }).then((r) => r.stdout, () => '')
  try { const a = JSON.parse(out) as { name?: string; user?: { name?: string } }; known = { signedIn: true, user: a.user?.name, subscription: a.name, subscriptions: await run('az', ['account', 'list', '--query', '[].name', '-o', 'tsv'], { timeout: 30_000 }).then((r) => r.stdout.split('\n').filter(Boolean), () => []) } } catch { known = { signedIn: false } }
  return known
}

/**
 * Told to every investigation: a session resumed from an earlier run remembers "no az here" and wouldn't look again.
 * Last known state (checked at start, on each Settings visit and at sign-in).
 */
export const azureNote = () => known.signedIn
  ? `\n\nAccess on this machine now (it may be newer than what an earlier run found): the Azure CLI \`az\` is installed and signed in (default subscription ${known.subscription}; all of them: ${known.subscriptions?.join(', ')}; pass --subscription for the others). You may run its reading commands: ${AZ_READ.map((r) => r.slice(5, -3)).join(', ')}; anything that changes something is denied.`
  : ''

/** Agents may run the reading commands: in exec runs and in the investigate actions. */
function allowReads() {
  saveConfig({ exec: {
    allowedTools: [...new Set([...config.exec.allowedTools, ...AZ_READ])],
    actions: config.exec.actions.map((a) => (a.allowedTools && a.env ? { ...a, allowedTools: [...new Set([...a.allowedTools, ...AZ_READ])] } : a)),
  } })
}

let pending: { child: ReturnType<typeof spawn>; done?: boolean; ok?: boolean; error?: string } | undefined

/** Start signing in; returns the code and where to enter it. No terminal: az then asks nothing after the login. */
export function startAzureLogin(): Promise<{ code: string; url: string }> {
  pending?.child.kill()
  const child = spawn('az', ['login', '--use-device-code', '-o', 'none'], { cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AZURE_CORE_LOGIN_EXPERIENCE_V2: 'off' } })
  const p: NonNullable<typeof pending> = { child }
  pending = p
  const stop = setTimeout(() => child.kill(), 16 * 60_000) // the code is good for 15 minutes
  let out = ''
  child.on('close', (code) => {
    clearTimeout(stop); p.done = true; p.ok = code === 0
    if (p.ok) { allowReads(); void azureStatus(); console.log('azure: signed in with your account') }
    else { p.error = out.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 300); console.error('azure sign-in failed:', p.error) }
  })
  return new Promise((resolve, reject) => {
    const give = setTimeout(() => reject(new Error(`Azure gave no sign-in code. ${out.slice(-200)}`)), 60_000)
    const read = (c: Buffer) => {
      out = (out + c).slice(-20_000)
      const m = out.match(/(https:\/\/\S+) and enter the code (\w+)/)
      if (m) { clearTimeout(give); resolve({ url: m[1], code: m[2] }) }
    }
    child.stdout!.on('data', read); child.stderr!.on('data', read)
  })
}
export const azureLoginState = () => (pending ? { done: !!pending.done, ok: !!pending.ok, error: pending.error } : undefined)
