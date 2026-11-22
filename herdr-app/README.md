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
| `mods/gh-watch` | Open PRs, Actions runs and issues of the focused pane's repo (`gh`), spinner for running, click opens URL, hover tooltip (PR: branches, diff size, checks, description; issue: body, labels, assignees; run: event, status). Two modes, one file: dialog (`ctrl-shift-g`) and a **GitHub** panel on the right next to Files/Changes (button in the tab bar; polls every 15 s, only while shown) |
| `mods/servers-code` | **Servers** list under Agents in the left sidebar: every `Host` of `~/.ssh/config` (no wildcards), click = new space running `ssh <host>` on this computer |

Needs: `gh` (authenticated), `nvim`, `code`, `docker` (carbonyl: `fathyb/carbonyl`) for the respective menu entries.
Panel: click **GitHub** in the tab bar (layout `main-code`, child `gh` of `panel-body`; button comes from `tabs-code`). Key for the dialog of gh-watch (add to `~/.config/herdr-app/keys.json` → `global`): `"ctrl-shift-g": "mod.open:gh-watch"`.
Optional example layouts `code`, `pasture` (+ mods `vsc`, `pasture`): github.com/herdrdev/herdr-layout-examples.
If the layout switches back to `main` after a restart: `herdr-app do layout.switch --name main-code`; if the sidebar is hidden: `herdr-app do layout.show --id sidebar`.

## Servers (`servers-code`)

A list of your SSH hosts in the left sidebar, below Spaces and Agents (block `servers` in `layouts/main-code.json`; its height is `weight` 0.4, change it there). Same look as Agents: separator line on top, header with title and **+**.

- **Collapse:** click the title (`▾`/`▸`) → the block shrinks to its header (`layout.resize` to 41 px, state remembered in shared `servers.collapsed`, reapplied at start).
- **+ New connection:** popup with *Address* (`[user@]host[:port]`) and optional *Name* (default: host). **Save & connect** (Enter) appends a `Host <name>` block (`HostName`, `User`, `Port`) to `~/.ssh/config` (creates `~/.ssh` / the file if missing; an existing name is not duplicated), so it stays in the list, then connects with `ssh <name>`. **Connect once** = plain `ssh`, nothing saved. IPv6 addresses and `-i` keys: write the Host block by hand.

- **Source:** `~/.ssh/config`, re-read every 30 s. Each `Host` name counts, patterns with `*`, `?` or `!` are skipped. The row shows `User@HostName` from the first matching `HostName` / `User` line. `Include` and `Match` are not followed. Add a server = add a `Host` block, nothing else to maintain:

      Host nas
        HostName 192.168.0.5
        User admin

- **Click:** opens a new space named like the host with `ssh <host>`, on this computer (not on a remote machine of the app). The shell stays open after the connection ends. Keys / ssh-agent are assumed: a password prompt works like in any terminal but is not automated.
- **Not (yet) there:** reachability indicator, groups or labels, opening in a tab of the current space, hosts from `Include`d files. The collapse/popup paths were only checked visually (layout shrinks, popup renders); clicking, saving and connecting were not run. Hosts added as a herdr *Machine* ("Add machine") are a separate feature of the app (remote spaces with `herdr` on the server).
- **Narrow sidebar** (< 160 px): initials only.
- Parser check: `node herdr-app/test/hosts.test.mjs`.

## Dev, Docker, Vault panels

Three more right-panel children next to Files / Changes / GitHub (tab-bar buttons **Dev**, **Docker**, **Vault**; they poll only while shown). All use the folder of the focused pane; local spaces only (remote space → message). Linux/macOS use `sh`/`grep`, Windows uses PowerShell (`powershell`; Windows branches **untested**).

| Mod | What |
|-----|------|
| `mods/dev-run` | `package.json` scripts (pm from `packageManager` or lockfile: pnpm/yarn/bun/npm) and `Makefile` targets (`target: ## description`). Click = new tab in that folder running the command; the shell stays open after `[exit N]`. Looks upwards for the nearest folder with a package.json/Makefile; workspace packages (literal folders in `pnpm-workspace.yaml` or `package.json` `workspaces`, no globs) get their own group and run in their folder. |
| `mods/containers-watch` | `docker` (else `podman`) containers of the folder's compose project (label `com.docker.compose.project.working_dir`); toggle **this project / all containers**. Dot = state, `:port` = published ports, hover = image/status/ports. Click = `logs -f` in a new tab, `■/▶` stop/start, `↗` opens `localhost:<port>`. Refresh 5 s. |
| `mods/vault-watch` | Obsidian vault: **overdue / due today** open tasks (`- [ ] … [due:: YYYY-MM-DD]`, `grep` over `*.md`), **+ Capture**, **agent runs**. |

### Vault config

`~/.config/herdr-app/vault.json` (not part of the repo; template `vault.example.json`):

```json
{ "path": "~/Workspace/my-vault", "captureDir": "Inbox", "attachmentDir": "Attachments",
  "exclude": [".obsidian", ".git", "_kb", "Templates"], "excludeFiles": ["CONTEXT.md"],
  "agents": [ { "name": "Inbox triage", "argv": ["claude", "--model", "sonnet"], "task": "…fixed prompt…" } ] }
```

- Task row: click = open in Obsidian (`obsidian://`), `☐` = check off (`[ ]` → `[x]`, nothing else touched; refuses if the line changed meanwhile).
- **+ Capture** (or key `"ctrl-shift-v": "mod.open:vault"` in `keys.json` → `global`): multi-line note, first line = file name, saved as `<captureDir>/<date> <title>.md` with **Ctrl+S** or *Save* (Enter and Ctrl+Enter are newlines). **Screenshot:** Ctrl+V with an image in the clipboard (or the *📎 Screenshot* button) saves `<attachmentDir>/Pasted image <stamp>.png` (default `Attachments`) and inserts `![[…]]` at the cursor. Needs `wl-clipboard` or `xclip` (Linux), `pngpaste` (macOS), PowerShell (Windows; untested).
- **Agent runs**: each entry becomes a button; it opens a tab in the vault folder with `argv` (agent + model) and `task` as first message.

Windows: `powershell -ExecutionPolicy Bypass -File herdr-app\install.ps1` (app home `%HERDR_APP_HOME%`, else `~\.config\herdr-app` — assumption, check with `herdr-app status`). Vault `path` then e.g. `C:/Users/me/vault`.

Test: `node herdr-app/test/tools.test.mjs`. Not verified: click paths (start, logs, check off, capture save, agent run), Docker with running containers, Dev with real scripts — only rendering/parsing.
