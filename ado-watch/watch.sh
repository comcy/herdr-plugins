#!/usr/bin/env bash
# usage: watch.sh runs|prs   (q quit)
# Needs: az + devops extension (az extension add -n azure-devops), az login, jq.
# Org/project: from the git remote (az --detect), or `az devops configure -d organization=… project=…`.
# Same render loop as ../gh-watch/watch.sh (copied on purpose: plugins install separately).
mode=${1:?runs|prs}; REFRESH=${REFRESH:-10}
for c in az jq; do command -v $c >/dev/null || { echo "needs $c"; read -rn1; exit 1; }; done

# pane may not start in the repo: fall back to any cwd in the plugin context
git rev-parse --show-toplevel >/dev/null 2>&1 || {
  d=$(jq -r '[.. | .cwd? // empty] | first // empty' <<<"${HERDR_PLUGIN_CONTEXT_JSON:-null}" 2>/dev/null)
  [ -n "$d" ] && cd "$d"
}

JQ_LIB='
def ic(s; c):
  ((s // "" | ascii_downcase) as $s | (c // "" | ascii_downcase) as $c |
   if $s == "completed" then
     (if $c == "succeeded" or $c == "approved" then "\u001b[32m✓"
      elif $c == "partiallysucceeded" then "\u001b[33m✓"
      elif $c == "failed" or $c == "rejected" or $c == "broken" then "\u001b[31m✗"
      else "\u001b[2m⊘" end)
   elif $s == "inprogress" or $s == "cancelling" then "\u001b[33m@@"
   else "\u001b[2m◌" end) + "\u001b[0m";
def dim: "\u001b[2m" + . + "\u001b[0m";
def bold: "\u001b[1m" + . + "\u001b[0m";
'

build_runs() {
  az pipelines runs list --top 6 -o json | jq -c '.[]' | while read -r run; do
    jq -r "$JQ_LIB"'
      ic(.status; .result) + " " + (.definition.name|bold) + "  #" + .buildNumber + "  " +
      ((.sourceBranch // "")|sub("^refs/heads/";"")|dim)' <<<"$run"
    if [ "$(jq -r '.status|ascii_downcase' <<<"$run")" != completed ]; then
      id=$(jq -r .id <<<"$run"); proj=$(jq -r .project.name <<<"$run")
      az devops invoke --area build --resource timeline --api-version 7.1 \
        --route-parameters project="$proj" buildId="$id" -o json 2>/dev/null | jq -r "$JQ_LIB"'
        .records as $r | ($r | map({(.id): .}) | add) as $by |
        $r[] | select(.type == "Job") |
        . as $j |
        ($by[$j.parentId].parentId // null) as $sid | ($by[$sid].name // "") as $stage |
        "    " + ic($j.state; $j.result) + " " + (if $stage != "" then ($stage|dim) + " / " else "" end) + $j.name +
          (if ($j.state|ascii_downcase) == "inprogress" then
             (([$r[] | select(.type == "Task" and .parentId == $j.id)] | sort_by(.order)) as $t
              | ($t | map(select((.state|ascii_downcase) == "inprogress")) | first // empty) as $cur
              | "  " + ("› \($cur.name) (\($cur.order)/\($t|length))" | dim))
           else "" end)'
    fi
  done
}

build_prs() {
  az repos pr list --status active --top 15 -o json | jq -c '.[]' | while read -r pr; do
    jq -r "$JQ_LIB"'
      "#\(.pullRequestId) " + (.title|bold) + "  " + (.createdBy.displayName|dim) +
      (if .isDraft then "  [draft]" else "" end) +
      (if any(.reviewers[]?; .vote <= -10) then "  \u001b[31mrejected\u001b[0m"
       elif any(.reviewers[]?; .vote == -5) then "  \u001b[33mwaiting\u001b[0m"
       elif any(.reviewers[]?; .vote >= 5) then "  \u001b[32mapproved\u001b[0m" else "" end)' <<<"$pr"
    az repos pr policy list --id "$(jq -r .pullRequestId <<<"$pr")" -o json 2>/dev/null | jq -r "$JQ_LIB"'
      [.[] | select(.status != "notApplicable" and (.configuration.isEnabled // true))] as $p |
      "    " + ([$p[] | ic((if .status == "running" or .status == "queued" then "inProgress" else "completed" end); .status)] | join(" ")) +
        (([$p[] | select(.status == "running" or .status == "queued")
                | (.configuration.settings.displayName // .configuration.type.displayName)] | join(", ")) as $r
          | if $r != "" then "  " + ("running: " + $r | dim) else "" end)'
  done
}

cache=$(mktemp); trap 'kill 0 2>/dev/null; rm -f "$cache"*' EXIT
echo "loading…" > "$cache"
( while :; do "build_$mode" > "$cache.new" 2>&1 && mv "$cache.new" "$cache"; sleep "$REFRESH"; done ) &

frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏); i=0
title=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")
printf '\e[?25l\e[2J'; trap 'printf "\e[?25h"' EXIT
while :; do
  out=$(<"$cache"); out=${out//@@/${frames[i++ % 10]}}
  printf '\e[H\e[1m%s · ado %s\e[0m  \e[2m(q quit)\e[0m\e[K\n\n' "$title" "$mode"
  while IFS= read -r l; do printf '%s\e[K\n' "$l"; done <<<"$out"
  printf '\e[J'
  read -rsn1 -t 0.1 k && [ "$k" = q ] && break
done
