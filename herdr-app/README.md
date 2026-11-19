# herdr-app mods

For the native **herdr-app** (tested 0.1.16 / core 0.1.21), not the TUI `herdr`.
Install: `./install.sh` (copies into `~/.config/herdr-app`, runs `herdr-app check`), then `herdr-app do layout.switch --name main-code`.
Herdr's built-in mods/layouts are replaced on every start, so these are **clones** under new names.

| Item | What |
|---|---|
| `layouts/main-code.json` | Clone of `main` using the mods below; keeps Spaces list + Agents overview on the left |
| `mods/spaces-code` | `spaces` + worktrees grouped under their repo (also bare repos: `.bare/` + worktrees), header = repo folder, row = folder + branch |
| `mods/tabs-code` | `tabs`, "+" opens `new-menu-code` |
| `mods/new-menu-code` | `new-menu` + entries: GitHub PRs & runs, Browser (carbonyl), Neovim tab, VS Code (`code .`) |
| `mods/gh-watch` | Dialog: open PRs + Actions runs of the focused pane's repo (`gh`), spinner for running, click opens URL |

Needs: `gh` (authenticated), `nvim`, `code`, `docker` (carbonyl: `fathyb/carbonyl`) for the respective menu entries.
Key for gh-watch (add to `~/.config/herdr-app/keys.json` → `global`): `"ctrl-shift-g": "mod.open:gh-watch"`.
Optional example layouts `code`, `pasture` (+ mods `vsc`, `pasture`): github.com/herdrdev/herdr-layout-examples.
If the layout switches back to `main` after a restart: `herdr-app do layout.switch --name main-code`; if the sidebar is hidden: `herdr-app do layout.show --id sidebar`.
