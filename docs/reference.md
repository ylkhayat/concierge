# Concierge reference

Everything the [README](../README.md) leaves out: requirements, Docker, configuration, your own skills, caches and development.

## Requirements

| | Why |
|---|---|
| macOS | Opening Terminal or iTerm for *Resume*. The dashboard itself runs anywhere. |
| Node ≥ 22.18 | The server is TypeScript run directly by Node; there is no build step for it. |
| pnpm | Installs dependencies. |
| [GitHub CLI](https://cli.github.com) (`gh`), logged in | Onboarding signs you in to GitHub; the CLI itself is what that sign-in and `git push` use. |
| [Claude Code](https://claude.com/claude-code) (`claude`), logged in | Runs the review, revise and explain agents. |
| [crit](https://crit.md/) (`brew install crit`) | The review surface `review-pr` and `revise` use. |

## Quick start

```bash
gh repo clone ylkhayat/concierge && concierge/install.sh
```

It checks your tools (Node 22.18+, git, `gh` signed in, `claude`; pnpm is switched on through Node's corepack when it
is missing), installs the dependencies, links `concierge` into `~/.local/bin`, starts it and opens it. Safe to run
again: it updates and relinks. Afterwards, `concierge open`.

The first time you open it, a short onboarding sets everything up:

1. **Tools.** Checks that `gh` is signed in and that `claude` and `crit` are installed. Anything missing shows the command to fix it.
2. **Repositories.** Suggests repos from your recent PR activity and matches each one to a clone it finds on your machine (in `~/code`, `~/src`, `~/dev`, `~/projects` and similar). Pick the ones to watch, or add another by hand.
3. **Skills.** Install the skills from your skill source with one click ([ylkhayat/skills](https://github.com/ylkhayat/skills) unless you pick another), or point Concierge at slash commands you already use. Your organization's skills from claude.ai come along by themselves (Settings → Skills).
4. **Preferences.** Auto-review, parallel runs, daily budget, which terminal *Resume* opens, and the theme.

To change any of this later, open Settings → *Repositories & skills*. Changes apply immediately, with no restart.

On the first poll, PRs already waiting for you are listed but not started. Auto-review applies only to requests that arrive after that. To start one from the backlog, click *Run review*.

## Run with Docker

Everything (Node, pnpm, `gh`, `claude`, `crit`, `uv`) comes in the image. You fill one env file.

```bash
gh repo clone ylkhayat/concierge && cd concierge
bin/up                      # .env (CODE_DIR, HOST_UID/GID), the folders it mounts, build, start, host networking check, open
```

- **Sign-ins happen in the app, never in `.env`.** Onboarding signs you in to GitHub (a code at github.com/login/device, or a pasted token), Tailscale when the fleet is loaded, and your agents (claude.ai, ChatGPT, Copilot, Ollama). The keys are kept in `~/.config/concierge/secrets.json` (readable only by you), shared by every machine, and handed to Concierge, `gh` and `git push` from there. The Linear key for Ship is set the same way (onboarding, or Settings → Machines).
- **Your clones are mounted at the same path** (`CODE_DIR`), and `HOME` inside matches yours. Repo paths in `config.json`, `~` paths and the worktrees agents make all line up. Keep every repo you watch under `CODE_DIR`.
- **It reads your setup and keeps its own.** `~/.config/concierge` and `~/.local/state/concierge` are mounted, so a native install and the container see the same settings and history. Your `~/.claude` and `~/.codex` are mounted for your skills, commands and settings. Each agent tool (Claude Code, Codex, Copilot) keeps its own files in `~/.local/state/concierge/<tool>-home`, per machine: its sign-in, connectors and sessions, and for Claude the plugins you enabled. It never writes them into yours. Your skills are read from wherever you keep them (`~/.claude/skills`, else `~/.codex/skills`) and every tool gets the same ones.
- **Agents run as you** (`HOST_UID`/`HOST_GID`), never root, so files they write in your repos stay yours.
- **Networking is host mode.** The dashboard and each crit server (every review picks a random port) are reachable from your browser as they are. On Docker Desktop turn it on once: Settings → Resources → Network → *Enable host networking* (4.34 or newer).
- **Private DNS is opt-in.** Set `DNS_SERVERS` in `.env` (e.g. a VPN's internal DNS) and those nameservers are asked before your machine's, so agents reach private endpoints that public DNS would send to addresses that refuse them.
- **crit reviews live in a Docker volume**, not your `~/.crit`. Session files hold process ids, which mean nothing across the container boundary.

What doesn't work from a container:
- *Resume* in Terminal or iTerm, and opening Linear links in the desktop app (both are macOS-only). Copy the resume command from the run instead.
- Claude Code hooks and the status line in your `~/.claude/settings.json`. They are programs of your machine, so the agents run without them (hooks that come with a plugin still run).
- Repos outside `CODE_DIR`, and SSH-only setups: remotes are pushed over HTTPS with your token (`git@github.com:` is rewritten).

## More than one machine

Concierge runs on one machine. Running it on two, one at a time with a shared link (a desktop that hands over to a
laptop), is a separate private extension cloned into `fleet/`; ask for access if you want it.

## What the agents do on their own, and what they don't

- **Review and revise never publish by themselves.** Posting a review, approving, replying and pushing all wait for your click; until then the work sits in crit and in a worktree.
- **They never merge**, except Ship as one PR in a repository where you allow it (Settings → Repositories: "Let Ship as one PR merge its pull request once the checks pass", for your own projects). They never edit your main checkout. Each run gets its own worktree.
- **Design captures screens only where you turn it on.** Once you join the Design role, PRs that change what people see (their files, or a ticket labelled design) get their screens captured before and after: from the repository's Storybook stories, else the running app through Playwright. Off for every repository until you set Visuals to Auto or Always (Settings → Repositories, per workspace or per repository), or turn it on for one PR. Only your own PRs are captured on their own; someone else's waits for Capture now, since it runs their code. A capture never pushes or comments, and costs at most $4.
- **Headless runs can only use the tools in the allowlist** (`agent.allowedTools`, `exec.allowedTools`, Settings). A denied tool is listed on the run, so you can add it or not.
- **Spend is capped.** A fresh install stops starting runs at $20 a day; change it in Settings → Usage. The Today view shows the average cost per review and per ticket.
- **A Ship run keeps going until it's done.** Each one carries a goal, the way Claude Code's `/goal` works: after every turn a small model checks that every ticket has its outcome line (`shipped`, `ready`, `refined` or `failed`) and nothing it started still runs, or that it's waiting on a decision of yours. Otherwise the run is sent back with what is missing, instead of stopping halfway. A review or revise has a goal too: not to finish, but to reach you (crit up with its findings or replies, and next steps for you). Runs on Claude accounts only.
- **Ship is the one you opt into.** Its skill opens ready PRs and comments on its Linear tickets. `ship-tickets` never merges, never pushes to the default branch and never moves a ticket to Done.
- **One button stops everything.** The gauge in the left rail lists every running agent and crit server, with their CPU and memory, and stops them.

## Commands

```
Concierge start            run in the background (rebuilds the UI if needed)
Concierge stop
Concierge restart          interrupted agent runs are picked up again on start
Concierge status
Concierge open             start if needed, then open the browser
Concierge ship             same, straight into Ship (/ship)
Concierge logs
Concierge install-skills   copy the skill source's skills into ~/.claude/skills (never overwrites)
```

The server listens on `127.0.0.1` only, because it can launch agents.

## Configuration

The onboarding and Settings write `~/.config/concierge/config.json` (or `$XDG_CONFIG_HOME/concierge/config.json`; an install from before the rename keeps `review-deck`). You never have to edit it, but you can, for example to change the prompts below. Every key except `repos` has a default, and an older `config.json` in the repo folder is moved there automatically.

| Key | Default | |
|---|---|---|
| `repos` | `{}` | `"owner/repo": "/path/to/checkout"`. Only these repos are reviewed or revised. |
| `port` | `4747` | Dashboard port. `CONCIERGE_PORT` overrides it. |
| `pollSeconds` | `60` | GitHub poll interval. Polls use ETags, so a quiet poll costs no rate limit. |
| `maxJobs` | `2` | Agent runs at once. Also adjustable live in Settings. |
| `autoStart` | `true` | Start a review as soon as one is requested. Also a toggle in the header. |
| `explainBudgetUsd` | `1.5` | Spending cap for each Explain run. |
| `terminal` | `"Terminal"` | `"Terminal"` or `"iTerm"`, used by *Resume*. |
| `agent.review.command` | `/review-pr {number}` | What runs when your review is requested. |
| `agent.review.instructions` | see `server/config.ts` | Appended to the system prompt of headless review runs. |
| `agent.revise.command` | `/revise {repo}#{number}` | What *Run revise* runs on your own PR. |
| `agent.revise.instructions` | see `server/config.ts` | Appended to headless revise runs. |
| `agent.post` | see `server/config.ts` | Prompt sent to the review session when you click *Post review* or *Approve*. Placeholders: `{event}`, `{note}`, `{gif}`. |
| `agent.publish` | see `server/config.ts` | Prompt sent to the revise session when you click *Push & reply*. |
| `agent.allowedTools` | read, edit, git, gh, crit, package managers, shell glue | Passed as `--allowedTools`. Anything else an agent tries is refused and shown in the side panel. |
| `agent.worktree` | unset | Where your review skill checks out PRs, such as `{repoPath}/.claude/worktrees/review-pr-{number}`. When set, a review you started by hand shows up as well, and Explain reuses that checkout. |
| `areas` | `{}` | The areas of your code and the words that point to each, e.g. `{"web-app": ["frontend", "settings page"]}`. Labels a PR whose title has no conventional scope, and tells which linked PR a ticket's next step is about. |
| `skillSource` | `https://github.com/ylkhayat/skills` | The git repository a new setup installs its skills from (never over one you have). |
| `skills` | `{}` | Which skill each feature uses, by feature: `everyRun`, `explainChange`, `explainCodebase`, `explainDomain`, `stackTour`, `turns`, `intent`, `understanding`, `brief`, `standup`, `stacks`, `plan`, `skills`. Unset: the default of the same purpose in the skill source (Settings → Workflows → What each feature runs). Concierge brings the facts and the output format its pages read; the skill brings the method. |
| `exec.rules` | `[]` | Skills a ticket run loads first, by rule: `{ "skill", "why", "match"?, "unless"?, "bug"?, "env"? }`. `match`/`unless` are regular expressions over the ticket's title and description; `bug` limits it to bug reports, `env` to tickets about `prod` or `dev`. Tickets no rule covers go to a small model that picks from your skills. |

## Bring your own skills

Concierge ships no skills of its own. The skill source ([ylkhayat/skills](https://github.com/ylkhayat/skills) unless `skillSource` names another) gives a working set: `review-pr`, `revise`, `ship-tickets`, and one skill per feature for how Concierge explains, briefs, plans and writes (`skills`, below). Edit them, or point `agent.review.command` and `agent.revise.command` at your own. Concierge works with any skill that follows five rules:

1. **Print the crit link** as `crit is at http://localhost:<port>` (or `Crit is open at …`). Concierge reads the port from this line to link the session and count comments.
2. **End the turn once prepared.** A headless run is finished when the agent's turn ends. Don't block waiting for *Finish Review*. Anything left running in the background is stopped a few seconds after the turn ends.
3. **Publish only when told.** *Post review*, *Approve* and *Push & reply* resume the same session with an explicit instruction (`agent.post`, `agent.publish`). Until then, post nothing.
4. **Write AI comments in crit as `Claude Code`.** This is how the side panel separates AI findings from your notes.
5. **Use only tools listed in `agent.allowedTools`.** Headless runs can't ask for permission. Add what your skill needs, such as its own scripts, to `agent.allowedTools`.

## How Explain avoids redoing work

The explanation is built from two caches, both keyed by git content hashes.

- **A map of each repo.** It holds the systems (apps and packages, what they do, how they talk to each other) and a one-line summary of every folder a PR has touched.
  - A folder summary is reused as long as the folder's contents are unchanged, or have changed only slightly. A bigger change updates the old summary rather than rewriting it from scratch.
  - The map grows as PRs come in. Each new PR in an area you've already seen costs less.
- **The explanation of each PR, per pushed commit.** When the author pushes again, only files changed since the last push are re-explained, and the business summary is updated rather than rewritten.

The edges on the map come from a regex-based import graph (TypeScript, JavaScript, Python) of the whole repo. Building it takes about 1.5 s on a 5,000-file monorepo and uses no AI.

Explain runs use a lean Claude session with no plugins, skills, hooks or MCP servers, and read-only tools. A typical PR costs $0.20 to $0.45.

## Where things live

| | |
|---|---|
| `~/.config/concierge/config.json` | Your settings (repos, skills, terminal, prompts) |
| `~/.local/state/concierge/state.json` | Tracked PRs, jobs, settings, daily spend |
| `~/.local/state/concierge/logs/` | Each agent run's stream, replayed in the Activity tab |
| `~/.local/state/concierge/atlas/`, `explain/` | The Explain caches |
| `~/.local/state/concierge/visuals/` | Design's screenshots, per PR and commit, with each capture's `manifest.json` |
| `~/.local/state/concierge/server.log` | Server log (`concierge logs`) |

Set `XDG_CONFIG_HOME` and `XDG_STATE_HOME` to move them.

## Development

```bash
pnpm dev         # server on :4747 with --watch, UI on Vite with hot reload (proxies /api)
pnpm test        # node --test, no framework
pnpm typecheck
```

Stop the background server first (`concierge stop`); both use port 4747.

| Path | |
|---|---|
| `server/config.ts` | Defaults, loading and saving settings |
| `server/setup.ts` | Onboarding: tool checks, finding local clones, repo suggestions, installing skills |
| `server/github.ts` | GitHub polling (REST + GraphQL, ETag cached) |
| `server/runner.ts` | Job queue, headless `claude` runs, live activity |
| `server/crit.ts` | crit session discovery and PR status |
| `server/atlas.ts` | Git tree, diff and import graph |
| `server/explain.ts` | Explain pipeline and caches |
| `src/` | React + Tailwind + lucide UI. The graph uses React Flow + ELK, and flows use Mermaid; all three load only when the Explain tab opens. |

## Troubleshooting

- **Azure "Connection is not an approved private link" while on the VPN, after installing Tailscale.** Tailscale's DNS (`100.100.100.100`) answers first, so private-link names resolve to their public addresses. Send the Key Vault domains to the VPN's DNS (macOS; find its address with `scutil --dns`): `sudo sh -c 'for d in vault.azure.net vaultcore.azure.net; do echo "nameserver <vpn-dns-ip>" > /etc/resolver/$d; done; killall -HUP mDNSResponder'`. Both are needed: the vault name is an alias to a `privatelink.vaultcore.azure.net` name that macOS looks up separately. The files can stay for good, since a vault behind private link only works on the VPN anyway. Tailscale's own split DNS doesn't help here: it can't reach a DNS server that only exists inside the VPN. On Linux/WSL, point those two domains at the VPN's DNS with `resolvectl domain`.

- **"reconnecting" in the header.** The server is down. Run `concierge status`, then `concierge logs`.
- **A run says "Denied: …".** The agent tried a tool that isn't in `agent.allowedTools`. Add it if it's safe, then *Re-run*.
- **No crit link after a run.** The skill didn't print `crit is at http://localhost:<port>`. Check its last lines in the Activity tab.
