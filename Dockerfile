# syntax=docker/dockerfile:1.7
# Concierge in a container: fill .env, then `docker compose up -d`. See "Run with Docker" in the README.
ARG UV_VERSION=0.13.4
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv
# every version pinned: two machines building on their own must build the same thing (a floating tag stays frozen
# in each machine's build cache, at whatever it was when that machine first built). Bump them here, on purpose.
FROM node:26.12.1-bookworm-slim

ARG PNPM_VERSION=12.5.1
ARG CLAUDE_CODE_VERSION=2.1.306
# OpenAI agents (Settings → Agents)
ARG CODEX_VERSION=0.165.0
ARG COPILOT_VERSION=1.0.112
ARG CRIT_VERSION=v0.23.0

# git for worktrees, procps for the Running gauge (ps), util-linux for setpriv, curl for the healthcheck, bc for agents' shell math
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg openssh-client procps util-linux jq python3 make bc \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# pnpm (corepack is gone from Node 25+) and the Claude Code CLI
RUN npm install -g "pnpm@${PNPM_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}" "@github/copilot@${COPILOT_VERSION}" && npm cache clean --force

# uv for Python repos (`uv sync` in a worktree); the Python it fetches lives where compose's UV_PYTHON_INSTALL_DIR says
COPY --from=uv /uv /uvx /usr/local/bin/

# crit: the release binary for this architecture, checked against the release's checksums
RUN arch=$(dpkg --print-architecture) \
  && cd /tmp \
  && curl -fsSLO "https://github.com/tomasz-tomczyk/crit/releases/download/${CRIT_VERSION}/crit-linux-${arch}" \
  && curl -fsSLO "https://github.com/tomasz-tomczyk/crit/releases/download/${CRIT_VERSION}/checksums.txt" \
  && grep " crit-linux-${arch}\$" checksums.txt | sha256sum -c - \
  && install -m 0755 "crit-linux-${arch}" /usr/local/bin/crit \
  && rm -f "crit-linux-${arch}" checksums.txt

# the Azure CLI: investigations read logs with your own Azure login, signed in once from Settings
RUN install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ bookworm main" > /etc/apt/sources.list.d/azure-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends azure-cli \
  && rm -rf /var/lib/apt/lists/*
# extensions a command needs (containerapp, log-analytics) install on first use, without asking
ENV AZURE_EXTENSION_USE_DYNAMIC_INSTALL=yes_without_prompt AZURE_CORE_COLLECT_TELEMETRY=false

# the Atlas CLI: the database is reached with your own Atlas login, signed in once from Settings
ARG ATLAS_VERSION=1.59.0
RUN arch=$(dpkg --print-architecture | sed 's/amd64/x86_64/') \
  && cd /tmp \
  && curl -fsSLO "https://github.com/mongodb/mongodb-atlas-cli/releases/download/atlascli%2Fv${ATLAS_VERSION}/mongodb-atlas-cli_${ATLAS_VERSION}_linux_${arch}.tar.gz" \
  && curl -fsSLO "https://github.com/mongodb/mongodb-atlas-cli/releases/download/atlascli%2Fv${ATLAS_VERSION}/checksums.txt" \
  && grep " mongodb-atlas-cli_${ATLAS_VERSION}_linux_${arch}.tar.gz\$" checksums.txt | sha256sum -c - \
  && tar xzf "mongodb-atlas-cli_${ATLAS_VERSION}_linux_${arch}.tar.gz" \
  && install -m 0755 "mongodb-atlas-cli_${ATLAS_VERSION}_linux_${arch}/bin/atlas" /usr/local/bin/atlas \
  && rm -rf mongodb-atlas-cli_* checksums.txt

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# the build number (commits) and commit, from bin/update: .git stays out of the image
ARG DECK_VERSION=
ENV DECK_VERSION=$DECK_VERSION
# the extension's commit, and the repos both come from (owner/app owner/fleet): Settings → Machines checks them
ARG DECK_FLEET=
ARG DECK_REPOS=
ENV DECK_FLEET=$DECK_FLEET DECK_REPOS=$DECK_REPOS
RUN pnpm build

# Runs as root only long enough to give $HOME and a passwd entry to your own uid, then drops to it:
# agents refuse --dangerously-skip-permissions as root, and files they write in your repos stay yours.
COPY <<'EOF' /usr/local/bin/review-deck-entrypoint
#!/bin/sh
set -eu
uid="${HOST_UID:-1000}" gid="${HOST_GID:-1000}"
mkdir -p "$HOME" && chown "$uid:$gid" "$HOME"
getent group "$gid" >/dev/null || groupadd -o -g "$gid" deck
getent passwd "$uid" >/dev/null || useradd -o -u "$uid" -g "$gid" -M -d "$HOME" -s /bin/sh deck
as() { setpriv --reuid="$uid" --regid="$gid" --clear-groups env HOME="$HOME" "$@"; }
# DNS_SERVERS go ahead of the host's (host networking rules out compose's dns:). Written in place: Docker
# bind-mounts /etc/resolv.conf, so it can't be replaced.
if [ -n "${DNS_SERVERS:-}" ]; then
  { printf 'nameserver %s\n' $DNS_SERVERS; cat /etc/resolv.conf; } > /tmp/resolv.conf && cat /tmp/resolv.conf > /etc/resolv.conf
fi
# GitHub: the token you signed in with in the app (onboarding, Settings → Machines), kept with its other keys in
# secrets.json; never in .env. Used here for the steps below only: the app hands its own copy to gh and git (sharedEnv.ts)
for f in "$HOME/.config/${CONCIERGE_DIRNAME:-concierge}/secrets.json" "$HOME/.config/review-deck/secrets.json"; do
  if [ -z "${GH_TOKEN:-}" ] && [ -r "$f" ]; then GH_TOKEN=$(jq -r '.shared.GITHUB_TOKEN.value // empty' "$f" 2>/dev/null || true); fi
done
# an install from before sign-ins moved into the app still has it in .env: that one, until it signs in from the app
[ -n "${GH_TOKEN:-}" ] || GH_TOKEN="${GITHUB_TOKEN:-}"
if [ -n "${GH_TOKEN:-}" ]; then export GH_TOKEN; else unset GH_TOKEN; fi
# git: who commits, and push over https with the GitHub token (ssh remotes are rewritten)
[ -n "${GIT_AUTHOR_NAME:-}" ] && as git config --global user.name "$GIT_AUTHOR_NAME"
[ -n "${GIT_AUTHOR_EMAIL:-}" ] && as git config --global user.email "$GIT_AUTHOR_EMAIL"
# none set: commit as the GitHub account the token belongs to, with its private noreply address (before the first
# sign-in there is none: the app sets it once you sign in, gitIdentity.ts)
if [ -n "${GH_TOKEN:-}" ] && { [ -z "${GIT_AUTHOR_NAME:-}" ] || [ -z "${GIT_AUTHOR_EMAIL:-}" ]; }; then
  who=$(as gh api user --jq '"\(.name // .login)\t\(.id)+\(.login)@users.noreply.github.com"' 2>/dev/null) || who=
  if [ -n "$who" ]; then
    [ -n "${GIT_AUTHOR_NAME:-}" ] || as git config --global user.name "$(printf '%s' "$who" | cut -f1)"
    [ -n "${GIT_AUTHOR_EMAIL:-}" ] || as git config --global user.email "$(printf '%s' "$who" | cut -f2)"
  fi
fi
as git config --global url."https://github.com/".insteadOf "git@github.com:"
as git config --global --add safe.directory '*'
# git asks gh for the token at each push, which reads the app's GH_TOKEN: set up before any sign-in (--force)
as gh auth setup-git --hostname github.com --force >/dev/null 2>&1 || echo "gh auth setup-git failed" >&2
# gh stack, which exec runs open their PRs with (kept in a volume; installed once)
GH_STACK_VERSION="${GH_STACK_VERSION:-v0.1.0}"
# mount points Docker made as root: the parents of the bind mounts, and the crit volume
for d in "$HOME/.claude" "$HOME/.codex" "$HOME/.local" "$HOME/.local/state" "$HOME/.local/state/review-pr" "$HOME/.local/state/revise" "$HOME/.config" "$HOME/.crit" "$HOME/.npm" "$HOME/.cache" "$HOME/.config/atlascli" "$HOME/.azure" "$HOME/.local/share" "$HOME/.local/share/gh"; do mkdir -p "$d" && chown "$uid:$gid" "$d"; done
# the Atlas sign-in is yours even if something ran atlas as root
chown -R "$uid:$gid" "$HOME/.config/atlascli" "$HOME/.azure"
if [ -n "${GH_TOKEN:-}" ]; then
  as sh -c "gh extension list 2>/dev/null | grep -q gh-stack || gh extension install github/gh-stack --pin $GH_STACK_VERSION >/dev/null" || echo "gh stack could not be installed" >&2
else echo "gh stack: installed at the next start, once you sign in to GitHub" >&2; fi
unset GH_TOKEN # the app's own copy (secrets.json, re-read every 30s) is the one that counts from here
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups env HOME="$HOME" "$@"
EOF
RUN chmod 0755 /usr/local/bin/review-deck-entrypoint

ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -sf "http://127.0.0.1:${CONCIERGE_PORT:-${REVIEW_DECK_PORT:-4747}}/api/alive" >/dev/null || exit 1
ENTRYPOINT ["review-deck-entrypoint"]
CMD ["node", "server/index.ts"]
