# herdr-app mods

For the native **herdr-app** (tested 0.1.16 / core 0.1.21), not the TUI `herdr`.
Install: `./install.sh` (copies into `~/.config/herdr-app`, runs `herdr-app check`), then `herdr-app do layout.switch --name main-code`.
Herdr's built-in mods/layouts are replaced on every start, so these are **clones** under new names.

| Item | What |
|---|---|
| `layouts/main-code.json` | Clone of `main` using the mods below; keeps Spaces list + Agents overview on the left |
| `mods/spaces-code` | `spaces` + every git repo gets a header row (repo name, click folds/unfolds its branches, state in localStorage `repos.folded`) with its spaces indented below, each row labelled with its **branch** (folder name instead when several spaces of the repo are on the same branch or HEAD is detached). Also bare repos (`.bare/` + worktrees). Spaces are sorted: repos first, then a thin divider, then plain folders (non-git); both groups have a caption (REPOSITORIES / DIRECTORIES) that folds them, state in localStorage `spaces.groups.folded` |
| `mods/agents-code` | clone of `agents`: every agent row names its space with the same colored letter chip as the Spaces list (also in the group headers), shows the agent's **git branch** on a second line, and agents of the **active space** get a bar in the space's color + tinted background. Layout `main-code` points the Agents block at it |
| `mods/tabs-code` | `tabs`, "+" opens `new-menu-code` |
| `mods/new-menu-code` | `new-menu` + entries: GitHub PRs & runs, repo cloning, Browser (carbonyl), Neovim tab, VS Code (`code .`) |
| `mods/gh-watch` | Open PRs, Actions runs and issues of the focused pane's repo (`gh`), spinner for running, click opens URL, hover tooltip (PR: branches, diff size, checks, description; issue: body, labels, assignees; run: event, status). Two modes, one file: dialog (`ctrl-shift-g`) and a **GitHub** panel on the right next to Files/Changes (button in the tab bar; polls every 15 s, only while shown) |
| `mods/branches-code` | Right-side **git** pane for the focused Git repo, with local and fetched remote refs sorted by tip commit date. Left-click checks out/opens; right-click offers **Checkout / open** and **Create worktree**. The header **+** creates a worktree from a local/remote branch or a new branch from `HEAD`. Ordinary repos use sibling `<repo>.worktrees/<branch-path>` paths; `.bare` repos use `<repo-root>/<branch-path>`. Slashes stay as directories: branch `features/topic` creates `<branch-root>/features/topic`. **Scratch** creates and switches to `scratch/<UTC timestamp>` without committing or pushing; staged, unstaged, and untracked changes stay in that checkout. **Clone** creates `<name>/.bare` and opens the remote default branch as a worktree. No automatic fetches or force-switches. |
| `mods/ado-watch` | Azure DevOps pipelines and active PRs in a right-side pane; needs the Azure DevOps `az` extension and login. |
| `mods/servers-code` | **Servers** list under Agents in the left sidebar: every `Host` of `~/.ssh/config` (no wildcards), click = new space running `ssh <host>` on this computer |

Needs: `git`; `az` with the Azure DevOps extension and login; `gh` (authenticated), `nvim`, `code`, `docker` (carbonyl: `fathyb/carbonyl`) for the respective entries.
Panel: click **git**, **ADO**, or **GitHub** in the tab bar (layout `main-code`, children of `panel-body`; buttons come from `tabs-code`). Git refs are sorted by latest tip commit date; right-click offers checkout/worktree actions, **+** opens the worktree dialog, **Scratch** creates a local scratch branch without committing, and **Clone** follows the `.bare` layout. Remote refs are shown without fetching. The new-menu also offers **Clone repository**. Key for the dialog of gh-watch (add to `~/.config/herdr-app/keys.json` → `global`): `"ctrl-shift-g": "mod.open:gh-watch"`.
Optional example layouts `code`, `pasture` (+ mods `vsc`, `pasture`): github.com/herdrdev/herdr-layout-examples.
If the layout switches back to `main` after a restart: `herdr-app do layout.switch --name main-code`; if the sidebar is hidden: `herdr-app do layout.show --id sidebar`.

## Servers (`servers-code`)

A list of your SSH hosts in the left sidebar, below Spaces and Agents (block `servers` in `layouts/main-code.json`; its height is `weight` 0.4, change it there). Same look as Agents: separator line on top, header with title and **+**.

- **Collapse:** click the title (`▾`/`▸`) → the block shrinks to its header (`layout.resize` to 41 px, state remembered in shared `servers.collapsed`, reapplied at start).
- **+ New connection:** popup with *Address* (`[user@]host[:port]`) and optional *Name* (default: host). **Save & connect** (Enter) appends a `Host <name>` block (`HostName`, `User`, `Port`) to `~/.ssh/config` (creates `~/.ssh` / the file if missing; an existing name is not duplicated), so it stays in the list, then connects with `ssh <name>`. **Connect once** = plain `ssh`, nothing saved. IPv6 addresses and `-i` keys: write the Host block by hand.

- **Right-click a row:** popup *Edit <name>* with Address and Name prefilled. **Save** rewrites that `Host` block in place (HostName / User / Port updated, other directives like `IdentityFile` kept; a shared `Host a b` line is split). **Delete** (asks again: *Really delete?*) removes the block from `~/.ssh/config`. Untested in the real app: only the text rewrite is covered by `test/hosts.test.mjs`.

- **Source:** `~/.ssh/config`, re-read every 30 s. Each `Host` name counts, patterns with `*`, `?` or `!` are skipped. The row shows `User@HostName` from the first matching `HostName` / `User` line. `Include` and `Match` are not followed. Add a server = add a `Host` block, nothing else to maintain:

      Host nas
        HostName 192.168.0.5
        User admin

- **Click:** opens a new space named like the host with `ssh <host>`, on this computer (not on a remote machine of the app). The shell stays open after the connection ends. Keys / ssh-agent are assumed: a password prompt works like in any terminal but is not automated.
- **Not (yet) there:** reachability indicator, groups or labels, opening in a tab of the current space, hosts from `Include`d files. The collapse/popup paths were only checked visually (layout shrinks, popup renders); clicking, saving and connecting were not run. Hosts added as a herdr *Machine* ("Add machine") are a separate feature of the app (remote spaces with `herdr` on the server).
- **Narrow sidebar** (< 160 px): initials only.
- Parser check: `node herdr-app/test/hosts.test.mjs`.

## Azure DevOps, Git, Dev, Docker, Vault panels

Five more right-panel children next to Files / Changes / GitHub (tab-bar buttons **ADO**, **git**, **Dev**, **Docker**, **Vault**; all poll only while shown). **ADO** uses `az` with the Azure DevOps extension and an authenticated account; it detects org/project from an Azure DevOps checkout or uses `az devops configure` defaults. It lists pipeline runs and active PRs, shows running jobs/current tasks and PR policy details on hover, and opens the run or PR in the browser on click. The **git** panel lists local and fetched remote refs of the focused pane's repository, sorted newest tip commit first; it never fetches automatically. Left-click checks out or opens an existing worktree; right-click opens **Checkout / open** and **Create worktree** actions. The header **+** opens a dialog for an existing local/remote branch or a new branch from `HEAD`; ordinary repositories use sibling `<repo>.worktrees/<branch-path>` folders, while `.bare` repositories place worktrees under their repo root. Slash-separated branch names become nested folders, e.g. `features/topic` → `features/topic`. **Scratch** switches the current checkout to a unique `scratch/<UTC timestamp>` branch without committing or pushing, preserving staged, unstaged, and untracked changes. **Clone** creates `<name>/.bare` and opens the remote default branch as a worktree; the new-menu has the same clone action. **Dev**, **Docker**, and **Vault** use the focused pane's folder; local spaces only (remote space → message). Linux/macOS use `sh`/`grep`, Windows uses PowerShell (`powershell`; Windows branches **untested**).

| Mod | What |
|-----|------|
| `mods/ado-watch` | Azure CLI pipelines and active PRs (latest six runs and 15 PRs); status, running jobs/current task, PR policies. Refreshes every 15 s while shown. |
| `mods/branches-code` | Local/fetched refs sorted by latest commit date. Right-click for checkout or worktree creation; header **+** opens the worktree dialog. Ordinary repos use sibling `<repo>.worktrees/<branch-path>`; `.bare` layouts use `<repo-root>/<branch-path>`. Branch slashes create nested directories (`features/topic`). **Scratch** switches to a local timestamped branch without committing; **Clone** creates `<name>/.bare`. |
| `mods/dev-run` | `package.json` scripts (pm from `packageManager` or lockfile: pnpm/yarn/bun/npm) and `Makefile` targets (`target: ## description`). Click = new tab in that folder running the command; the shell stays open after `[exit N]`. Looks upwards for the nearest folder with a package.json/Makefile; workspace packages (literal folders in `pnpm-workspace.yaml` or `package.json` `workspaces`, no globs) get their own group and run in their folder. **Git hooks:** every hook in the repo's hooks folder (`git rev-parse --git-path hooks`, so `core.hooksPath`, husky and worktrees work; `.sample` files skipped) as its own group; click runs the hook in the repo root (Linux/macOS only, needs `ls`). Shown even without package.json/Makefile. |
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

Tests: `node herdr-app/test/branches.test.mjs` (recency order, local/remote checkout, repo-relative and `.bare` worktrees, bare cloning, scratch branch preservation, dirty-tree safety); `node herdr-app/test/hosts.test.mjs`; `node herdr-app/test/tools.test.mjs`. Live Azure DevOps, Docker containers, Dev scripts, and vault click paths still need their configured services and data.

