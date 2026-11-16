---
name: concierge-revise
description: Close out reviewers' feedback on your own GitHub PR. Brings every unresolved thread into crit with a proposed action, then fixes, commits and drafts replies on your word, and pushes only when you say publish. Starter skill shipped with Concierge; edit it freely.
argument-hint: "<owner/repo#number | number>"
disable-model-invocation: true
---

You are the **author** of this pull request, working through what reviewers asked for. A request to fix
authorizes the **edit**, never the **publish**: push and GitHub replies wait for "publish", "push" or "post".

## 1. Context

`$ARGUMENTS` is `owner/repo#N` or `N`. Run from the repository's main checkout.

```bash
gh pr view <N> --json number,title,author,baseRefName,headRefName,headRefOid,url
```

If you are not the author (`gh api user -q .login`), stop: use `/concierge-review` for other people's PRs.

## 2. Worktree on the PR branch

Never edit the main checkout. Work in a detached worktree at the remote head, so a branch that was force-pushed
under you is not rebuilt from a stale copy.

```bash
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner | tr / -)
state="${XDG_STATE_HOME:-$HOME/.local/state}/concierge-revise/$repo-$n"; mkdir -p "$state"
git fetch --quiet origin "<headRefName>" "<baseRefName>"
head=$(git rev-parse "origin/<headRefName>"); base=$(git merge-base "origin/<baseRefName>" "$head")
wt="$state/worktree"
if [ -d "$wt" ]; then git -C "$wt" checkout --quiet --detach --force "$head"; else git worktree add --quiet --detach "$wt" "$head"; fi
```

## 3. Pull the work-list

Unresolved review threads, plus review bodies and PR comments (asks without a line anchor get forgotten
otherwise):

```bash
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
  reviewThreads(first:100){nodes{id isResolved path line comments(first:20){nodes{id author{login} body url}}}}
  reviews(first:50){nodes{author{login} body state}} comments(first:50){nodes{author{login} body url}}}}}' \
  -F o=<owner> -F r=<repo> -F n=<N> > "$state/threads.json"
```

Read the **current** file at each thread's path, not the quoted hunk: half of these are already fixed. Sort each
item into one class:

| Class | Means |
|---|---|
| fix | The comment is right and the code still has the problem. |
| already fixed | A later commit did it. Reply with the commit. |
| won't fix | Wrong or out of scope. Reply with the reason. |
| needs you | A product call, or you can't tell what they want. Ask the author. Never invent an answer. |

## 4. Start crit and lay out the threads

```bash
port=$((40000 + n % 4000))
cd "$wt"
crit stop >/dev/null 2>&1
export CRIT_PORT=$port   # pin with the env var: crit keeps it across reconnects
nohup crit --range "$base..$head" --no-open >"$state/crit.log" 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null "localhost:$port/api/session" && break; sleep 0.5; done
```

Author each thread in crit as a comment by the reviewer who raised it (`"author": "<their login>"`), with your
class and proposed action as a reply from `Claude Code`. Keep `thread id → crit comment id` in
`$state/map.json` so replies go back to the right thread later. Post them with one
`crit comment --json --file ... ` call from the worktree.

Then print this line exactly, because Concierge reads the port from it:

```
crit is at http://localhost:<port>
```

End your turn with a summary: counts per class, the questions that need the author, and the crit link.

## When the author comes back

- **"fix", "do it", "yes"**: make the smallest change that resolves each `fix` item, in the worktree only. Run the
  project's checks. Commit locally. **Published history only gains commits**: if `git branch -r --contains <sha>`
  is non-empty, add a new commit, never amend or force-push. Draft each GitHub reply to `$state/replies/<thread-id>.md`.
  Report and wait. A fix directive is not permission to publish.
- **"publish", "push", "post"**: `git -C "$wt" push origin HEAD:<headRefName>`, then post each drafted reply:
  `gh api graphql -f query='mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{url}}}' -F t=<thread-id> -F b=@$state/replies/<thread-id>.md`.
  Leave threads open; the reviewer resolves them. Report the PR URL.
- **"done"**: `cd "$wt" && crit stop`, then `git worktree remove "$wt"` once everything is pushed.
