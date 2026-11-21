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
| `mods/gh-watch` | Open PRs, Actions runs and issues of the focused pane's repo (`gh`), spinner for running, click opens URL. Two modes, one file: dialog (`ctrl-shift-g`) and a **GitHub** panel on the right next to Files/Changes (button in the tab bar; polls every 15 s, only while shown) |
| `mods/servers-code` | **Servers** list under Agents in the left sidebar: every `Host` of `~/.ssh/config` (no wildcards), click = new space running `ssh <host>` on this computer |

Needs: `gh` (authenticated), `nvim`, `code`, `docker` (carbonyl: `fathyb/carbonyl`) for the respective menu entries.
Panel: click **GitHub** in the tab bar (layout `main-code`, child `gh` of `panel-body`; button comes from `tabs-code`). Key for the dialog of gh-watch (add to `~/.config/herdr-app/keys.json` → `global`): `"ctrl-shift-g": "mod.open:gh-watch"`.
Optional example layouts `code`, `pasture` (+ mods `vsc`, `pasture`): github.com/herdrdev/herdr-layout-examples.
If the layout switches back to `main` after a restart: `herdr-app do layout.switch --name main-code`; if the sidebar is hidden: `herdr-app do layout.show --id sidebar`.

## Servers (`servers-code`)

A list of your SSH hosts in the left sidebar, below Spaces and Agents (block `servers` in `layouts/main-code.json`; its height is `weight` 0.4, change it there).

- **Source:** `~/.ssh/config`, re-read every 30 s. Each `Host` name counts, patterns with `*`, `?` or `!` are skipped. The row shows `User@HostName` from the first matching `HostName` / `User` line. `Include` and `Match` are not followed. Add a server = add a `Host` block, nothing else to maintain:

      Host nas
        HostName 192.168.0.5
        User admin

- **Click:** opens a new space named like the host with `ssh <host>`, on this computer (not on a remote machine of the app). The shell stays open after the connection ends. Keys / ssh-agent are assumed: a password prompt works like in any terminal but is not automated.
- **Not (yet) there:** reachability indicator, groups or labels, opening in a tab of the current space, hosts from `Include`d files. Hosts added as a herdr *Machine* ("Add machine") are a separate feature of the app (remote spaces with `herdr` on the server).
- **Narrow sidebar** (< 160 px): initials only.
- Parser check: `node test/hosts.test.mjs`.
