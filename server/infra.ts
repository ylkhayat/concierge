// Where it runs, as Settings → About shows it: the commit running here and since when, and, when an extension makes
// this one of several machines (fleet.ts), those machines and how they keep in step.
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fleet } from './fleet.ts'
import { DB_FILE, STATE_DIR } from './store.ts'
import { replicaStatus } from './replica.ts'

type Beat = { name: string; role?: string; active?: boolean; handing?: boolean; seq?: number; code?: string; agoS?: number }
type Machines = {
  machine?: string; role?: string; peer?: string; beats: Beat[]; conflicts: string[]
}

/** The bin/standby this build was made with, by content (bin/standby's own CODE): a machine's standby that beats with
 *  another one runs an older script (bin/update restarts it). undefined: no fleet in this build. */
export const fleetCode = async () => readFile(join(process.cwd(), 'fleet', 'bin', 'standby')).then((b) => createHash('sha1').update(b).digest('hex').slice(0, 12), () => undefined)
/** A beating standby left on an older script than this build's: "" means one from before heartbeats said (old too). */
export const behind = (b: Beat, code: string | undefined) => !!code && b.agoS != null && b.agoS < 60 && (b.code ?? '') !== code

export async function infraView() {
  const deployed = (await readFile(join(STATE_DIR, `deployed${fleet.machine ? `.${fleet.machine}` : ''}`), 'utf8').catch(() => '')).trim().slice(0, 7) || undefined
  return {
    version: deployed, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    stateBytes: (await stat(DB_FILE).catch(() => undefined))?.size, fleetCode: await fleetCode(),
    beats: [], conflicts: [],
    ...(await fleet.view?.() as Partial<Machines> | undefined),
    // how this machine keeps in step with the one holding the lease (replica.ts)
    replica: fleet.machine ? replicaStatus() : undefined,
  } as { version?: string; startedAt: string; stateBytes?: number; fleetCode?: string; replica?: ReturnType<typeof replicaStatus> } & Machines
}
export type InfraView = Awaited<ReturnType<typeof infraView>>
