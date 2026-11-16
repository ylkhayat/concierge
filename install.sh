#!/usr/bin/env bash
# Install and open Concierge (native, no Docker): clone, install, start, and open the onboarding in your browser.
#   gh repo clone ylkhayat/concierge && concierge/install.sh
# Safe to run again: it updates the clone, relinks, and opens it.
set -euo pipefail

REPO="ylkhayat/concierge"
DEST="${CONCIERGE_DIR:-$HOME/concierge}"
BIN="$HOME/.local/bin"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is missing. $2"; }

say "Checking tools"
need node "Install Node 22.18 or newer: https://nodejs.org"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || fail "Node $(node -v) is too old: Concierge needs 22.18 or newer (it runs TypeScript directly)."
# pnpm comes with Node (corepack): switched on here when it is missing
command -v pnpm >/dev/null 2>&1 || { say "Turning on pnpm (corepack)"; corepack enable pnpm 2>/dev/null || npm install -g pnpm >/dev/null; }
need pnpm "Install it: npm install -g pnpm"
need git "Install git first."
need gh "Install the GitHub CLI: https://cli.github.com (brew install gh)"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in. Run: gh auth login"
need claude "Install Claude Code: npm install -g @anthropic-ai/claude-code, then run claude once to sign in"
command -v crit >/dev/null 2>&1 || say "crit is missing: reviews need it. Install: brew install crit (or a release binary from github.com/tomasz-tomczyk/crit)"

# inside a clone already? use it; else clone (through gh, so private access works) or update the existing one
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -n $here && -f $here/package.json && -f $here/bin/concierge ]]; then
  DEST="$here"
elif [[ -d $DEST/.git ]]; then
  say "Updating $DEST"
  git -C "$DEST" pull --ff-only --quiet
else
  say "Cloning into $DEST"
  gh repo clone "$REPO" "$DEST" -- --quiet
fi

say "Installing dependencies"
(cd "$DEST" && pnpm install --frozen-lockfile --silent)

mkdir -p "$BIN"
ln -sf "$DEST/bin/concierge" "$BIN/concierge"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) say "Add $BIN to your PATH, e.g.: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;;
esac

say "Starting Concierge: the setup continues in your browser"
"$DEST/bin/concierge" open
say "Next time: concierge open"
