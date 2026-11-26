// The push gate: an agent's push is refused unless the code typechecks. Concierge hands every agent run a hooks folder of
// its own (git's core.hooksPath, through GIT_CONFIG_* in the run's environment only: nothing in the repository changes).
// Its pre-push runs the repository's typecheck first; every hook then goes on to the repository's own (husky's, or
// .git/hooks), so their checks still run. Written at start on every machine, since each one runs its own agents.
//
//   which check   nx.json: `nx affected -t typecheck` against the default branch; a package.json "typecheck" script: that;
//                 otherwise none (a repository with nothing to typecheck pushes as before)
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STATE_DIR } from './paths.ts'

export const HOOKS_DIR = join(STATE_DIR, 'githooks')
const HOOKS = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'post-rewrite', 'pre-auto-gc']

// the repository's own hook, if it has one: its core.hooksPath as the repository sets it (husky), else .git/hooks
const CHAIN = `top=$(git rev-parse --show-toplevel)
own=$(git config --local --get core.hooksPath)
[ -z "$own" ] && own="$(git rev-parse --git-common-dir)/hooks"
case "$own" in /*) ;; *) own="$top/$own" ;; esac
if [ -x "$own/$name" ]; then exec "$own/$name" "$@"; fi
exit 0`

const CHECK = `cd "$top" || exit 1
cmd=""
if [ -f nx.json ]; then
  base=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/develop)
  cmd="npx nx affected -t typecheck --base=$(git merge-base HEAD "$base" 2>/dev/null || echo "$base") --head=HEAD"
elif [ -f package.json ] && grep -q '"typecheck"[[:space:]]*:' package.json; then
  if [ -f pnpm-lock.yaml ]; then cmd="pnpm run typecheck"; elif [ -f yarn.lock ]; then cmd="yarn typecheck"; else cmd="npm run typecheck"; fi
fi
if [ -n "$cmd" ]; then
  if [ -f package.json ] && [ ! -d node_modules ]; then
    echo "Concierge refused the push: this checkout has no node_modules, so it can't be typechecked. Install the dependencies (e.g. pnpm install), then push again." >&2; exit 1
  fi
  echo "Concierge: checking the code compiles before the push: $cmd" >&2
  if ! sh -c "$cmd" >&2; then
    echo "Concierge refused the push: \\\`$cmd\\\` failed (the errors are above). Fix them, commit, and push again. Never push with --no-verify." >&2; exit 1
  fi
fi`

const script = (name: string) => `#!/bin/sh
# written by Concierge (server/gate.ts): ${name === 'pre-push' ? 'typecheck before a push, then ' : ''}the repository's own hook
name=${name}
top=$(git rev-parse --show-toplevel)
${name === 'pre-push' ? CHECK + '\n' : ''}${CHAIN}
`

/** Write the hooks folder (at start, on every machine). */
export async function writeGate() {
  await mkdir(HOOKS_DIR, { recursive: true })
  for (const h of HOOKS) { const f = join(HOOKS_DIR, h); await writeFile(f, script(h)); await chmod(f, 0o755) }
}

/** The environment that puts the gate in front of an agent run's git (added to what it already sets). */
export function gateEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const n = Number(base.GIT_CONFIG_COUNT ?? 0) || 0
  return { ...base, GIT_CONFIG_COUNT: String(n + 1), [`GIT_CONFIG_KEY_${n}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${n}`]: HOOKS_DIR }
}
