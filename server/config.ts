// Settings: built-in defaults, overridden by what the user saved (only `repos` is required).
// Templates use {number} {repo} {event} {note} {gif}.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { CONFIG_DIR, setting } from './paths.ts'
import { fleet } from './fleet.ts'

/** A skill a ticket run loads by rule (Config.exec.rules). `match`/`unless`: regular expressions over the ticket's
 *  title and description (case-insensitive). `bug`: only for a bug report, `env`: only about that environment. */
export type SkillRule = { skill: string; why: string; match?: string; unless?: string; bug?: boolean; env?: 'prod' | 'dev' }

export type Config = {
  repos: Record<string, string> // "owner/repo" → absolute path of a local checkout
  port: number
  pollSeconds: number
  maxJobs: number
  autoStart: boolean
  explainBudgetUsd: number // per explain run, passed as --max-budget-usd
  terminal: 'Terminal' | 'iTerm'
  vpns?: import('./vpn.ts').Vpn[] // VPNs some runs need: Concierge checks them and tells you which to connect
  // who does the work: a provider per kind of work, the order to fall back in when one is over its budget or limit,
  // a daily budget each, and the models OpenAI and Llama run (providers.ts)
  providers?: {
    use?: Partial<Record<import('./providers.ts').Work, string>>
    fallback?: string[]
    budgets?: Record<string, number>
    models?: Record<string, { large?: string; small?: string }>
    stopAt?: number // how full (percent) a Claude plan window may get before its agents pause; 100: until Claude refuses
  }
  // accounts beyond the built-in Claude, OpenAI and Llama (or settings for those): each with its own sign-in (providers.ts)
  accounts?: import('./providers.ts').Account[]
  skillsRepo?: string | string[] // git checkouts of your skills (e.g. ~/.claude, ~/.claude/private): pulled every hour, so a second machine keeps up
  linearDesktop?: boolean // open Linear links in the Linear desktop app (linear://) instead of the browser
  // Linear releases by merge: a PR merged into a branch puts its tickets in the release at that branch's stage
  releases?: ReleaseRule[]
  workspaces?: Workspace[] // which halves of the app you use; unset: Review, plus Exec once it has a command
  // the areas of your code and the words that point to each ({"web-app": ["frontend", "settings page"]}): a PR's area
  // when its title has no conventional scope, and which PR a ticket's next step is about
  areas?: Record<string, string[]>
  access?: { logins: string[] } // who may open it through the tailnet link (access.ts), by their Tailscale login
  company?: import('./readiness.ts').Company // where its customers are, its certifications, data, reviews and team: what every plan is checked against
  skills?: Partial<Record<import('./method.ts').Feature, string>> // which skill each feature uses (method.ts); unset: its default
  skillSource?: string // the git repo a new setup's skills come from (Settings → Skills); unset: github.com/ylkhayat/skills
  // Exec mode: ship your Linear tickets with a command such as /my-exec
  exec: {
    command: string // {ids} becomes the ticket ids in order, space separated; '' turns exec mode off
    teams: string[] // Linear team keys to show; empty means all
    repoByPrefix: Record<string, string> // ticket prefix ("BLI") → owner/repo in `repos`
    allowedTools: string[]
    autoTodoCap: number // auto-exec picks at most this many Todo tickets per run
    // One-click ways past a ticket that waits on you. {id} {title} {url} {slug} {note} are filled in;
    // {note} is what you typed (empty when you typed nothing).
    actions: ExecAction[]
    // skills a ticket run loads first, by rule: when the ticket's text matches (and not `unless`), and for a bug, in
    // the environment it is about. Anything less clear goes to a small model that reads the ticket against the catalog
    rules?: SkillRule[]
  }
  agent: {
    review: { command: string; instructions: string } // someone asked you to review
    revise: { command: string; instructions: string } // your own PR has feedback
    post: string // resume prompt: submit the review as comments, or approve ({event} {note} {gif})
    publish: string // resume prompt: push fixes and post replies on your own PR
    allowedTools: string[] // what headless runs may do without asking
    // Optional: where your review skill keeps its PR worktree. Lets the app spot a crit session for a
    // review you started by hand, and lets Explain reuse that checkout. e.g. "{repoPath}/.claude/worktrees/review-pr-{number}"
    worktree?: string
    // Optional: your stack command, opened in the terminal from a stacked PR. {stack} is GitHub's stack number. e.g. "/review-stack {stack}"
    stack?: string
  }
}

export type Workspace = 'review' | 'exec'
export type ReleaseRule = { repo: string; pipeline: string; branches: Record<string, string> } // pipeline slug; base branch → stage name, e.g. { develop: 'In Progress', beta: 'Beta' }

export type ExecAction = {
  id: string
  label: string
  hint: string
  icon?: 'play' | 'file' | 'reply' | 'wand' | 'search'
  prompt: string // the slash command and instructions for an unattended run, from the ticket's repo
  confirm?: string // asked before running, for actions that push or post
  env?: 'prod' | 'dev' // offered only on tickets about this environment (or when it is unknown)
  allowedTools?: string[] // replaces exec.allowedTools for this action's runs (an investigation gets read-only tools)
}

// Reading from the shell: what agents glue their commands with (cd …; grep … | head). Claude Code checks each part of
// a compound command, so one missing part denies it all. Nothing here writes, deletes or publishes.
export const SHELL_READS = ['cd', 'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'wc', 'sort', 'uniq', 'cut', 'diff', 'echo', 'printf', 'sed -n', 'basename', 'dirname', 'realpath', 'pwd', 'true',
  'ps', 'date', 'stat'] // ps: is my test run still going; date/stat: how old is this file
  .map((c) => `Bash(${c}:*)`)

export const DEFAULTS: Config = {
  repos: {},
  port: 4747,
  pollSeconds: 60,
  maxJobs: 2,
  autoStart: true,
  explainBudgetUsd: 1.5,
  terminal: 'Terminal',
  exec: {
    command: '',
    teams: [],
    repoByPrefix: {},
    allowedTools: [
      'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Agent', 'Skill', 'ToolSearch', 'TodoWrite',
      'Bash(git:*)', 'Bash(gh:*)', 'Bash(pnpm:*)', 'Bash(npx:*)', 'Bash(uv:*)', 'Bash(make:*)', 'Bash(curl:*)', 'Bash(claude:*)',
      ...SHELL_READS, 'Bash(jq:*)', 'Bash(python3:*)', 'Bash(mkdir:*)', 'Bash(rm -rf /tmp:*)',
      'mcp__plugin_productivity_linear', 'mcp__claude_ai_Linear', 'mcp__claude_ai_Sentry',
    ],
    autoTodoCap: 3,
    actions: [
      {
        id: 'proceed', label: 'Proceed with implementation', icon: 'play',
        hint: 'Re-run with your decision to build now instead of refining further.',
        prompt: '{command}\n\nDecision from the ticket owner, made in Concierge: proceed with the implementation of {id} now. '
          + 'Treat the decisions in the latest human comments on {id} as settled and do not route it back to refinement; '
          + 'put anything still open in the PR description instead. Remove the "Refinement" label.{note}',
      },
    ],
  },
  agent: {
    review: {
      command: '/review-pr {number}',
      instructions: 'Launched headless by Concierge. Prepare the review: start crit, print the line "crit is at http://localhost:<port>", '
        + 'and author your findings as crit comments. Then end your turn with a short summary. Do not wait for Finish Review '
        + 'and post nothing to GitHub unless the prompt says the reviewer asked. The reviewer will resume this session to finalize.',
    },
    revise: {
      command: '/revise {repo}#{number}',
      instructions: 'Launched headless by Concierge for the PR author. Bring the reviewers\' open threads into crit, print the line '
        + '"crit is at http://localhost:<port>", then end your turn with a short summary. Do not edit code, push, or post to GitHub '
        + 'unless the prompt says the author asked to publish. The author will resume this session to fix and finalize.',
    },
    post: 'The reviewer clicked "{event}" in Concierge: submit this review to GitHub now as event {event}.\n'
      + 'Reviewer note: {note}\nGIF: {gif}\n'
      + 'Both answers are here, so do not ask for them. You are headless and nobody can answer questions. '
      + 'If something blocks submission, stop and explain it instead of asking. End with the review URL.',
    publish: 'The author clicked "Push & reply" in Concierge. That is the explicit instruction to publish: push the fix commits '
      + 'and post the drafted replies. Never rewrite published history. If nothing is fixed or drafted yet, say so and publish nothing. '
      + 'You are headless and nobody can answer questions. If something blocks publishing, stop and explain it instead of asking. End with the PR URL.',
    allowedTools: [
      'Read', 'Grep', 'Glob', 'Agent', 'Write', 'Edit', 'Skill', 'ToolSearch', 'TodoWrite',
      'Bash(gh:*)', 'Bash(git:*)', 'Bash(crit:*)', 'Bash(nohup crit:*)', 'Bash(jq:*)', 'Bash(python3:*)',
      // shell glue the review skills use; nothing here can delete or publish
      'Bash(mkdir:*)', 'Bash(export:*)', 'Bash(curl -s:*)', 'Bash(sleep:*)', 'Bash(seq:*)', 'Bash(tr:*)', ...SHELL_READS,
      'Bash(npm:*)', 'Bash(pnpm:*)', 'Bash(yarn:*)', 'Bash(bun:*)',
    ],
  },
}

type UserConfig = Partial<Omit<Config, 'agent' | 'exec'>> & { exec?: Partial<Config['exec']> } & { agent?: Partial<Omit<Config['agent'], 'review' | 'revise'>> & { review?: Partial<Config['agent']['review']>; revise?: Partial<Config['agent']['revise']> } }

// Saved by the onboarding / Settings in the app; nobody needs to edit it by hand.
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const LEGACY = new URL('../config.json', import.meta.url) // older installs kept it in the repo

function load(): UserConfig {
  if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  if (existsSync(LEGACY) && !process.env.NODE_TEST_CONTEXT) {
    const legacy = JSON.parse(readFileSync(LEGACY, 'utf8'))
    write(legacy) // migrate once; the repo copy can be deleted afterwards
    return legacy
  }
  return {}
}
function write(u: UserConfig) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(u, null, 2))
  renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE)
}

const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir())
function resolve(u: UserConfig): Config {
  return {
    ...DEFAULTS, ...u,
    exec: { ...DEFAULTS.exec, ...u.exec },
    agent: {
      ...DEFAULTS.agent, ...u.agent,
      review: { ...DEFAULTS.agent.review, ...u.agent?.review },
      revise: { ...DEFAULTS.agent.revise, ...u.agent?.revise },
    },
    repos: Object.fromEntries(Object.entries(u.repos ?? {}).map(([k, v]) => [k, expand(v)])),
    ...(setting('PORT') && { port: Number(setting('PORT')) }),
  }
}

let user = load()
/** Live settings. Modules hold this object, so saving updates it in place and nothing needs a restart. */
export const config: Config = resolve(user)
export const configured = () => Object.keys(config.repos).length > 0
export const userConfig = () => user

const withReads = (l: string[]) => [...new Set([...l, ...SHELL_READS])]
// a settings file written before SHELL_READS existed has its own review list, which replaces the defaults: add them
if (user.agent?.allowedTools && SHELL_READS.some((t) => !user.agent!.allowedTools!.includes(t)))
  queueMicrotask(() => saveConfig({ agent: { allowedTools: withReads(user.agent!.allowedTools!) } }))
if ([user.exec?.allowedTools, ...(user.exec?.actions ?? []).map((a) => a.allowedTools)].some((l) => l && SHELL_READS.some((t) => !l.includes(t))))
  queueMicrotask(() => saveConfig({ exec: {
    ...(user.exec?.allowedTools && { allowedTools: withReads(user.exec.allowedTools) }),
    ...(user.exec?.actions && { actions: user.exec.actions.map((a) => (a.allowedTools ? { ...a, allowedTools: withReads(a.allowedTools) } : a)) }),
  } }))

export function saveConfig(patch: UserConfig) {
  user = { ...user, ...patch, ...(patch.agent && { agent: { ...user.agent, ...patch.agent } }), ...(patch.exec && { exec: { ...user.exec, ...patch.exec } }) }
  // a worker (another machine is the control plane) keeps it in memory only: config.json syncs, and two machines
  // writing it at once would leave conflict copies. The control plane writes the same change
  if (!fleet.elsewhere()) write(user)
  Object.assign(config, resolve(user))
}

/** Fill {placeholders}; unknown ones are left as-is. */
export const fill = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))

export const workspaces = (): Workspace[] => config.workspaces?.length ? config.workspaces : config.exec.command ? ['review', 'exec'] : ['review']
