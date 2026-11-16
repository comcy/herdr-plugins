# ado-watch
Live popups for Azure DevOps (same idea as `gh-watch`):
- `runs`: latest pipeline runs; running ones show stage / job and the current task with a spinner.
- `prs`: active PRs with one icon per policy (build validation etc.) and the names of policies still running.

Needs `az` with the devops extension, `jq`, and a login:

    az extension add -n azure-devops
    az login                                  # or: AZURE_DEVOPS_EXT_PAT=<pat> (keep it out of git)
    az devops configure -d organization=https://dev.azure.com/<org> project=<project>

Inside an Azure DevOps git checkout, org/project are detected from the remote. `q` quits; `REFRESH=10` (seconds).

    herdr plugin link ./ado-watch
    herdr plugin action invoke hp.ado-watch.runs   # or .prs

Verified only against stubbed `az` output (shapes from the REST docs), not a live organization.
