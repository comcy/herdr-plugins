# gh-watch
Live popups for the current repo (needs `gh`, logged in, and `jq`):
- `runs`: latest Actions runs; running ones show jobs + current step with a spinner.
- `prs`: open PRs with per-check icons and the names of checks still running.

Keys inside the popup: `q` quit. Refresh interval: `REFRESH=5` (seconds).

    herdr plugin link ./gh-watch
    herdr plugin action invoke hp.gh-watch.runs   # or .prs
