// The product's words, said one way. A thing has one name everywhere, and a name means one thing:
//
//   Role          Developer, Product, Design: who you work as (never "mode")
//   View          a place on the rail: Review, Ship, Plans, Map… (never "workspace")
//   Workspace     a GitHub organization Concierge works with
//   Repository    one repo in it (never "workspace")
//   Ship          agents working your tickets (never "exec" or "build" in what people read)
//   Run           one piece of agent work; "session" only for what `claude --resume` resumes
//   Map           Design's picture of an app (never "blueprint" or "board" as a label)
//   Draft         changes shown but not applied yet (a plan's, the tokens')
//   Stop          end a run (never "cancel")
//   Refresh       fetch it again (never "sync now", "catch up", "check again")
//   Set aside     out of the way until it changes
//
// A label is a verb and its object ("Add a connection", "Open the PR"), never a bare pronoun ("Its PR", "Put one in").

/** The Settings pages by id, as their nav names them: the one place a page's name is written. */
export const SETTINGS = {
  overview: 'How it works', roles: 'Roles', workflows: 'Workflows', skills: 'Skills', limits: 'Limits', accounts: 'Accounts', spend: 'Spend', compliance: 'Planning',
  repos: 'Workspaces', connections: 'Connections', machines: 'Machines', appearance: 'Preferences', about: 'About',
} as const
export type SettingsPage = keyof typeof SETTINGS

/** "Settings → Workspaces": how the app points at a page of Settings, so a renamed page can't leave old words behind. */
export const inSettings = (page: SettingsPage, ...within: string[]) => ['Settings', SETTINGS[page], ...within].join(' → ')

/** What the same action is called wherever it is offered. */
export const SAY = { stop: 'Stop', stopped: 'Run stopped', refresh: 'Refresh' } as const
