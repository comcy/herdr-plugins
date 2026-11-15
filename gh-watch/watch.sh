#!/usr/bin/env bash
# usage: watch.sh runs|prs   (q quit)
# Data refreshed in background every $REFRESH s; spinner redraws every 0.1 s from cache.
mode=${1:?runs|prs}; REFRESH=${REFRESH:-5}
command -v gh >/dev/null && command -v jq >/dev/null || { echo "needs gh + jq"; read -rn1; exit 1; }

# pane may not start in the repo: fall back to any cwd in the plugin context
gh repo view >/dev/null 2>&1 || {
  d=$(jq -r '[.. | .cwd? // empty] | first // empty' <<<"${HERDR_PLUGIN_CONTEXT_JSON:-null}" 2>/dev/null)
  [ -n "$d" ] && cd "$d"
}

JQ_LIB='
def ic(s; c):
  (if s == "completed" then
     (if c == "success" then "\u001b[32m✓"
      elif c == "failure" or c == "timed_out" or c == "error" then "\u001b[31m✗"
      else "\u001b[2m⊘" end)
   elif s == "in_progress" then "\u001b[33m@@"
   else "\u001b[2m◌" end) + "\u001b[0m";
def dim: "\u001b[2m" + . + "\u001b[0m";
def bold: "\u001b[1m" + . + "\u001b[0m";
'

build_runs() {
  gh run list --limit 6 --json databaseId,workflowName,displayTitle,headBranch,status,conclusion |
  jq -c '.[]' | while read -r run; do
    jq -r "$JQ_LIB"'
      ic(.status; .conclusion) + " " + (.workflowName|bold) + "  " + .displayTitle + "  " + (.headBranch|dim)' <<<"$run"
    if [ "$(jq -r .status <<<"$run")" != completed ]; then
      gh run view "$(jq -r .databaseId <<<"$run")" --json jobs 2>/dev/null | jq -r "$JQ_LIB"'
        .jobs[] | "    " + ic(.status; .conclusion) + " " + .name +
          (if .status == "in_progress" then
             ((.steps | map(select(.status=="in_progress")) | first // empty) as $s
              | "  " + ("› \($s.name) (\($s.number)/\(.steps|length))" | dim))
           else "" end)'
    fi
  done
}

build_prs() {
  gh pr list --limit 15 --json number,title,author,isDraft,reviewDecision,statusCheckRollup |
  jq -r "$JQ_LIB"'
    .[] |
    ([.statusCheckRollup[]? | {
        n: (.name // .context),
        s: ((.status // (if .state == "PENDING" or .state == "EXPECTED" then "IN_PROGRESS" else "COMPLETED" end)) | ascii_downcase),
        c: ((.conclusion // .state // "") | ascii_downcase)}]) as $ck |
    "#\(.number)" + " " + (.title|bold) + "  " + (.author.login|dim) +
      (if .isDraft then "  [draft]" else "" end) +
      (if .reviewDecision == "APPROVED" then "  \u001b[32mapproved\u001b[0m"
       elif .reviewDecision == "CHANGES_REQUESTED" then "  \u001b[31mchanges\u001b[0m" else "" end),
    "    " + ([$ck[] | ic(.s; .c)] | join(" ")) +
      (([$ck[] | select(.s != "completed") | .n] | join(", ")) as $r
        | if $r != "" then "  " + ("running: " + $r | dim) else "" end)'
}

cache=$(mktemp); trap 'kill 0 2>/dev/null; rm -f "$cache"*' EXIT
echo "loading…" > "$cache"
( while :; do "build_$mode" > "$cache.new" 2>&1 && mv "$cache.new" "$cache"; sleep "$REFRESH"; done ) &
refresher=$!

frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏); i=0
title=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "no repo here")
printf '\e[?25l\e[2J'; trap 'printf "\e[?25h"' EXIT
while :; do
  out=$(<"$cache"); out=${out//@@/${frames[i++ % 10]}}
  printf '\e[H\e[1m%s · %s\e[0m  \e[2m(q quit)\e[0m\e[K\n\n' "$title" "$mode"
  while IFS= read -r l; do printf '%s\e[K\n' "$l"; done <<<"$out"
  printf '\e[J'
  read -rsn1 -t 0.1 k && [ "$k" = q ] && break
done
