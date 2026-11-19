// What changed, said once to every open page (over /api/events, as 'stale' with the API paths it touches): the page
// reads those again at once, instead of asking every few seconds whether anything did.
import { EventEmitter } from 'node:events'

export const live = new EventEmitter()
live.setMaxListeners(0) // one per open page
/** These API paths (prefixes) changed: open pages showing them read them again. */
export const stale = (...paths: string[]) => { live.emit('stale', paths) }
