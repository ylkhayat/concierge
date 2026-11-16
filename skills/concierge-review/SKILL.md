---
name: concierge-review
description: Review someone else's GitHub PR with crit inline comments. Prepares the review headless (worktree, crit, findings), then waits for the reviewer to discuss in crit and say when to post or approve. Starter skill shipped with Concierge; edit it freely.
argument-hint: "<pr-number>"
disable-model-invocation: true
---

You are the **reviewer** of someone else's pull request. You never edit their code. Your output is a set of
findings in crit, which the human reviewer reads, discusses with you, and decides when to publish.

**Nothing reaches GitHub until the reviewer says so** ("post", "approve", "submit") in this session.

## 1. Context

`$ARGUMENTS` is the PR number. Run everything from the repository's main checkout.

```bash
n=<number>
gh pr view "$n" --json number,title,body,author,baseRefName,headRefName,headRefOid,url,files
me=$(gh api user -q .login)
```

If the author is `$me`, stop: this is your own PR, use `/concierge-revise` instead.

## 2. Worktree at the PR head

Never touch the reviewer's checkout. Work in a detached worktree under the state directory.

```bash
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner | tr / -)
state="${XDG_STATE_HOME:-$HOME/.local/state}/concierge-review/$repo-$n"; mkdir -p "$state"
git fetch --quiet origin "pull/$n/head" && head=$(git rev-parse FETCH_HEAD)
git fetch --quiet origin "<baseRefName>" && base=$(git merge-base "origin/<baseRefName>" "$head")
wt="$state/worktree"
if [ -d "$wt" ]; then git -C "$wt" checkout --quiet --detach --force "$head"; else git worktree add --quiet --detach "$wt" "$head"; fi
```

## 3. Start crit on a stable port

One crit session per PR, pinned to a port derived from the PR number so the link never changes.

```bash
port=$((40000 + n % 4000))
cd "$wt"
crit stop >/dev/null 2>&1
export CRIT_PORT=$port   # pin with the env var: crit keeps it across reconnects
nohup crit --range "$base..$head" --no-open >"$state/crit.log" 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null "localhost:$port/api/session" && break; sleep 0.5; done
```

Then print this line exactly, because Concierge reads the port from it:

```
crit is at http://localhost:<port>
```

## 4. Review and author findings

Read the diff (`git -C "$wt" diff "$base..$head"`) and the code around every change. Read callers of anything
whose behaviour changed. Check the project's own conventions (CONTRIBUTING, lint config, nearby code).

A finding must have all three, or it is not a finding:
- **what breaks**: a concrete input or state and the wrong result,
- **evidence**: `path:line` you actually read,
- **the smallest fix** that holds.

Skip style nits unless they break a written convention. Rank by severity: `blocker`, `should-fix`, `nit`.

Write the findings to `$state/findings.json` as a crit comment array, then post them in one call from the worktree:

```json
[{ "path": "src/a.ts", "line": 42, "body": "**should-fix**: ...\n\n**Fix:** ..." }]
```

```bash
cd "$wt" && crit comment --json --file "$state/findings.json" --author 'Claude Code'
crit comments --json | jq length   # verify they landed
```

Line numbers are lines of the file on disk in the worktree, not diff positions. Single-quote any inline body.

## 5. Hand over

End your turn with a short summary: what the PR does, the findings by severity, and the crit link. Do not wait
for the reviewer.

## When the reviewer comes back

- **They replied in crit** (Finish Review, or "read my comments"): `cd "$wt" && crit comments --json --all`.
  Answer each reply with `crit comment --reply-to <id> --author 'Claude Code' '<body>'`. Drop a finding they
  disagree with if they are right; defend it with evidence if they are not.
- **"post" or "approve"**: submit one GitHub review.
  1. Take the unresolved findings authored by `Claude Code` from `crit comments --json`.
  2. GitHub only accepts inline comments on lines inside a diff hunk. Anything outside goes into the review body.
  3. Build `$state/review.json`:
     `{ "commit_id": "<head>", "event": "COMMENT" | "APPROVE", "body": "<reviewer note>\n\n<summary>", "comments": [{ "path", "line", "side": "RIGHT", "body" }] }`
  4. `gh api "repos/<owner>/<repo>/pulls/$n/reviews" -X POST --input "$state/review.json"`
  5. Report the review URL. Then `cd "$wt" && crit stop` and `git worktree remove "$wt"`.
- **"done" without posting**: `crit stop`, remove the worktree, post nothing.
