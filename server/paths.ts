// Where it keeps its state and settings: ~/.local/state/concierge and ~/.config/concierge, or the review-deck folders an
// install from before the rename already has. Its own settings read CONCIERGE_<name>, or the older REVIEW_DECK_<name>.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const pick = (base: string) => (existsSync(join(base, 'review-deck')) ? join(base, 'review-deck') : join(base, 'concierge'))
export const STATE_DIR = pick(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'))
export const CONFIG_DIR = pick(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
export const setting = (name: string): string | undefined => process.env[`CONCIERGE_${name}`] ?? process.env[`REVIEW_DECK_${name}`]
