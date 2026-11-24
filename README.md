# herdr-plugins
Small plugins for [Herdr](https://herdr.dev) (tested with 0.9.5).

| Plugin | What |
|---|---|
| [`claude-layout`](claude-layout) | Split current pane into shell \| claude + test shell |
| [`gh-watch`](gh-watch) | Live GitHub Actions runs / open PRs popup with spinner |
| [`ado-watch`](ado-watch) | Live Azure DevOps pipeline runs / active PRs popup with spinner |

| [`herdr-app/`](herdr-app) | Mods + layout for native herdr-app (spaces grouping, GitHub dialog/panel, Azure DevOps and Branches panels, editor/browser menu) |

Install from a clone (`link`) or straight from GitHub (`install owner/repo/subdir`):

    herdr plugin link ./claude-layout
    herdr plugin link ./gh-watch
    herdr plugin link ./ado-watch
    # or: herdr plugin install <owner>/herdr-plugins/gh-watch

Keybindings: see [`config.example.toml`](config.example.toml).
Plugins run unsandboxed as your user; skim the scripts before installing.
