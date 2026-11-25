const text = (value) => String(value ?? "").replace(/\r?\n$/, "");
const cleanPath = (value) => text(value).replace(/\\/g, "/").replace(/\/+$/, "") || "/";
const base = (value) => cleanPath(value).split("/").pop();
const parent = (value) => {
  const path = cleanPath(value), at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
};

async function git(exec, cwd, args, on, timeout) {
  const options = { cwd, on };
  if (timeout !== undefined) options.timeout = timeout;
  const r = await exec("git", args, options);
  return { code: r.code, out: text(r.stdout), err: String(r.stderr ?? r.stdout ?? "").trim() };
}

async function required(exec, cwd, args, on) {
  const r = await git(exec, cwd, args, on);
  if (r.code !== 0) throw new Error(r.err || `git ${args.join(" ")} failed`);
  return r.out;
}

export function parseWorktrees(value) {
  return String(value ?? "").split(/\r?\n\s*\r?\n+/).flatMap((block) => {
    const lines = block.split(/\r?\n/);
    const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    if (!path || lines.includes("bare") || lines.some((line) => line.startsWith("prunable "))) return [];
    const ref = lines.find((line) => line.startsWith("branch "))?.slice(7) ?? "";
    return [{ path: cleanPath(path), branch: ref.replace(/^refs\/heads\//, "") || null }];
  });
}

export function parseBranches(localValue, remoteValue, remoteNamesValue) {
  const local = String(localValue ?? "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [branch, time] = line.split("\t");
    return { kind: "local", branch, at: Number(time) || 0 };
  });
  const remotes = String(remoteNamesValue ?? "").split(/\r?\n/).filter(Boolean).sort((a, b) => b.length - a.length);
  const remote = [];
  for (const line of String(remoteValue ?? "").split(/\r?\n/).filter(Boolean)) {
    const [short, symref = "", time = ""] = line.split("\t");
    if (symref || short.endsWith("/HEAD")) continue;
    const remoteName = remotes.find((name) => short.startsWith(`${name}/`)) ?? short.slice(0, short.indexOf("/"));
    const branch = remoteName ? short.slice(remoteName.length + 1) : "";
    if (!branch || branch === "HEAD") continue;
    remote.push({ kind: "remote", branch, ref: `refs/remotes/${short}`, remoteRef: short, at: Number(time) || 0 });
  }
  const recent = (a, b) => b.at - a.at || a.branch.localeCompare(b.branch);
  local.sort(recent);
  remote.sort((a, b) => recent(a, b) || a.remoteRef.localeCompare(b.remoteRef));
  return { local, remote };
}

export async function inspectRepository(folder, on, exec) {
  if (!folder) throw new Error("No focused folder.");
  const [common, top, bare] = await Promise.all([
    git(exec, folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on),
    git(exec, folder, ["rev-parse", "--path-format=absolute", "--show-toplevel"], on),
    git(exec, folder, ["rev-parse", "--is-bare-repository"], on),
  ]);
  if (common.code !== 0) throw new Error(common.err || "The focused folder is not in a Git repository.");
  if (bare.code !== 0) throw new Error(bare.err || "Could not inspect the Git repository.");
  const isBare = bare.out.trim() === "true";
  if (top.code !== 0 && !isBare) throw new Error(top.err || "Could not find the repository's working folder.");
  const commonDir = cleanPath(common.out), leaf = base(commonDir);
  const bareLayout = leaf === ".bare", worktreeMode = isBare || bareLayout;
  const repoRoot = leaf === ".git" || bareLayout ? parent(commonDir) : isBare ? commonDir : cleanPath(top.out);
  const name = (leaf === ".git" || bareLayout ? base(repoRoot) : isBare ? base(commonDir) : leaf).replace(/\.git$/, "");
  const source = top.code === 0 ? cleanPath(top.out) : cleanPath(folder);
  const [localRefs, remoteRefs, remoteNames, worktreeList, current] = await Promise.all([
    required(exec, source, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on),
    required(exec, source, ["for-each-ref", "--format=%(refname:short)%09%(symref)%09%(committerdate:unix)", "refs/remotes"], on),
    required(exec, source, ["remote"], on),
    required(exec, source, ["worktree", "list", "--porcelain"], on),
    git(exec, source, ["symbolic-ref", "--quiet", "--short", "HEAD"], on),
  ]);
  return {
    source,
    top: top.code === 0 ? cleanPath(top.out) : null,
    commonDir,
    repoRoot,
    bareLayout,
    name,
    isBare,
    worktreeMode,
    currentBranch: isBare || current.code !== 0 ? null : current.out,
    worktrees: parseWorktrees(worktreeList),
    branches: parseBranches(localRefs, remoteRefs, remoteNames),
  };
}

export function branchSlug(branch) {
  const normalized = branch.normalize("NFC");
  const name = normalized.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  if (name) return name;
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return `branch-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const join = (first, ...rest) => {
  const root = cleanPath(first), suffix = rest.map((part) => String(part).replace(/^[\\/]+|[\\/]+$/g, "")).filter(Boolean).join("/");
  return suffix ? `${root === "/" ? "" : root}/${suffix}` : root;
};
const branchPath = (branch) => branch.split("/").map(branchSlug);
const worktreePath = (repo, branch) => {
  const root = repo.bareLayout ? repo.repoRoot
    : repo.isBare ? join(parent(repo.repoRoot), repo.name)
      : join(parent(repo.repoRoot), `${repo.name}.worktrees`);
  return join(root, ...branchPath(branch));
};

export async function checkoutBranch(repo, target, on, exec) {
  if (!repo || !target?.branch || !["local", "remote"].includes(target.kind)) throw new Error("Invalid branch selection.");
  const listing = await git(exec, repo.source, ["worktree", "list", "--porcelain"], on);
  if (listing.code !== 0) throw new Error(listing.err || "Could not list repository worktrees.");
  const existing = parseWorktrees(listing.out).find((worktree) => worktree.branch === target.branch);
  if (existing) return { path: existing.path, open: true, created: false };

  const local = await git(exec, repo.source, ["show-ref", "--verify", "--quiet", `refs/heads/${target.branch}`], on);
  if (local.code !== 0 && local.code !== 1) throw new Error(local.err || "Could not check the local branch.");
  const localExists = local.code === 0;
  if (target.kind === "local" && !localExists) throw new Error("That local branch disappeared. Refresh the list and try again.");
  if (target.kind === "remote") {
    const remote = await git(exec, repo.source, ["show-ref", "--verify", "--quiet", target.ref], on);
    if (remote.code !== 0) throw new Error("That remote branch disappeared. Refresh the list and try again.");
  }

  if (repo.worktreeMode) {
    const path = worktreePath(repo, target.branch);
    const args = localExists
      ? ["worktree", "add", path, target.branch]
      : ["worktree", "add", "--track", "-b", target.branch, path, target.ref];
    const added = await git(exec, repo.source, args, on, 600_000);
    if (added.code !== 0) throw new Error(added.err || "git worktree add failed.");
    return { path, open: true, created: true };
  }

  const args = target.kind === "remote" && !localExists
    ? ["switch", "--track", "-c", target.branch, target.ref]
    : ["switch", "--", target.branch];
  const switched = await git(exec, repo.source, args, on, 600_000);
  if (switched.code !== 0) throw new Error(switched.err || "git switch failed; local changes were left intact.");
  const current = await git(exec, repo.source, ["rev-parse", "--path-format=absolute", "--show-toplevel"], on);
  return { path: current.code === 0 ? cleanPath(current.out) : repo.top, open: false, created: false };
}

export async function createWorktree(repo, target, on, exec) {
  if (!repo || !target?.branch || !["local", "remote", "new"].includes(target.kind)) throw new Error("Invalid worktree selection.");
  let localExists = false;
  if (target.kind === "new") {
    const valid = await git(exec, repo.source, ["check-ref-format", "--branch", target.branch], on);
    if (valid.code !== 0) throw new Error("That is not a valid Git branch name.");
    const local = await git(exec, repo.source, ["show-ref", "--verify", "--quiet", `refs/heads/${target.branch}`], on);
    if (local.code === 0) throw new Error("That branch already exists. Choose it from the branch list instead.");
    if (local.code !== 1) throw new Error(local.err || "Could not check the local branch.");
  } else {
    const listing = await git(exec, repo.source, ["worktree", "list", "--porcelain"], on);
    if (listing.code !== 0) throw new Error(listing.err || "Could not list repository worktrees.");
    const existing = parseWorktrees(listing.out).find((worktree) => worktree.branch === target.branch);
    if (existing) throw new Error(`Branch is already checked out at ${existing.path}.`);
    const local = await git(exec, repo.source, ["show-ref", "--verify", "--quiet", `refs/heads/${target.branch}`], on);
    if (local.code !== 0 && local.code !== 1) throw new Error(local.err || "Could not check the local branch.");
    localExists = local.code === 0;
    if (target.kind === "local" && !localExists) throw new Error("That local branch disappeared. Refresh the list and try again.");
    if (target.kind === "remote") {
      if (!target.ref?.startsWith("refs/remotes/")) throw new Error("Invalid remote branch reference.");
      const remote = await git(exec, repo.source, ["show-ref", "--verify", "--quiet", target.ref], on);
      if (remote.code !== 0) throw new Error("That remote branch disappeared. Refresh the list and try again.");
    }
  }

  const path = worktreePath(repo, target.branch);
  const args = target.kind === "new"
    ? ["worktree", "add", "-b", target.branch, path, "HEAD"]
    : target.kind === "remote" && !localExists
      ? ["worktree", "add", "--track", "-b", target.branch, path, target.ref]
      : ["worktree", "add", path, target.branch];
  const added = await git(exec, repo.source, args, on, 600_000);
  if (added.code !== 0) throw new Error(added.err || "git worktree add failed.");
  return { path, open: true, created: true };
}

const cloneName = (url) => String(url ?? "").trim().replace(/[?#].*$/, "").replace(/[\\/]+$/, "").split(/[/:\\]/).pop()?.replace(/\.git$/i, "") ?? "";
const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function createDirectory(path, parentPath, on, exec) {
  let first = "";
  try {
    const r = await exec("mkdir", [path], { cwd: parentPath, on });
    if (r.code === 0) return;
    first = String(r.stderr ?? r.stdout ?? "").trim();
    if (/already exists|file exists/i.test(first)) throw new Error("Clone destination already exists.");
  } catch (e) {
    if (/Clone destination already exists/.test(String(e?.message ?? e))) throw e;
    first ||= String(e?.message ?? e);
  }
  try {
    const script = `$p=${quotePowerShell(path)}; if (Test-Path -LiteralPath $p) { throw 'Clone destination already exists.' }; New-Item -ItemType Directory -Path $p | Out-Null`;
    const r = await exec("powershell.exe", ["-NoProfile", "-Command", script], { cwd: parentPath, on });
    if (r.code === 0) return;
    const error = String(r.stderr ?? r.stdout ?? "").trim();
    if (/Clone destination already exists/i.test(error)) throw new Error("Clone destination already exists.");
  } catch (e) {
    if (/Clone destination already exists/.test(String(e?.message ?? e))) throw e;
  }
  throw new Error(first || "Could not create the clone destination folder.");
}

export async function cloneBareRepository(parentDir, urlValue, nameValue, on, exec) {
  const url = String(urlValue ?? "").trim();
  if (!url) throw new Error("Enter a Git repository URL.");
  const name = String(nameValue ?? "").trim() || cloneName(url);
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error("Enter a valid single-folder repository name.");
  const baseDir = cleanPath(parentDir);
  const destination = join(baseDir, name), barePath = join(destination, ".bare");
  await createDirectory(destination, baseDir, on, exec);
  const init = await git(exec, baseDir, ["init", "--bare", barePath], on, 600_000);
  if (init.code !== 0) throw new Error(init.err || "git init --bare failed.");
  const remote = await git(exec, baseDir, ["--git-dir", barePath, "remote", "add", "origin", url], on, 600_000);
  if (remote.code !== 0) throw new Error(remote.err || "Could not add origin.");
  const fetch = await git(exec, baseDir, ["--git-dir", barePath, "fetch", "origin"], on, 600_000);
  if (fetch.code !== 0) throw new Error(fetch.err || `Could not fetch origin. The bare repository remains at ${barePath}.`);
  const head = await git(exec, baseDir, ["--git-dir", barePath, "remote", "set-head", "origin", "--auto"], on, 600_000);
  if (head.code !== 0) throw new Error(`Could not find origin's default branch. The bare repository remains at ${barePath}.`);
  const defaultRef = await git(exec, baseDir, ["--git-dir", barePath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], on);
  if (defaultRef.code !== 0 || !defaultRef.out.startsWith("origin/")) throw new Error(`Could not resolve origin's default branch. The bare repository remains at ${barePath}.`);
  const branch = defaultRef.out.slice("origin/".length);
  const setHead = await git(exec, baseDir, ["--git-dir", barePath, "symbolic-ref", "HEAD", `refs/heads/${branch}`], on);
  if (setHead.code !== 0) throw new Error(setHead.err || "Could not set the bare repository's HEAD.");
  const path = join(destination, branchSlug(branch));
  const worktree = await git(exec, baseDir, ["--git-dir", barePath, "worktree", "add", "--track", "-b", branch, path, `refs/remotes/origin/${branch}`], on, 600_000);
  if (worktree.code !== 0) throw new Error(worktree.err || `Could not create the initial worktree. The bare repository remains at ${barePath}.`);
  return { path, repoRoot: destination, barePath, branch, name };
}

export async function scratchBranch(repo, on, exec, now = Date.now()) {
  if (!repo?.top || repo.isBare) throw new Error("Open a worktree before moving changes to a scratch branch.");
  const status = await git(exec, repo.top, ["status", "--porcelain", "--untracked-files=all"], on);
  if (status.code !== 0) throw new Error(status.err || "Could not inspect working tree changes.");
  if (!status.out) throw new Error("There are no uncommitted changes to move.");
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  for (let suffix = 1; suffix <= 100; suffix++) {
    const branch = `scratch/${stamp}${suffix === 1 ? "" : `-${suffix}`}`;
    const existing = await git(exec, repo.source, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on);
    if (existing.code === 0) continue;
    if (existing.code !== 1) throw new Error(existing.err || "Could not check scratch branch names.");
    const switched = await git(exec, repo.top, ["switch", "-c", branch], on);
    if (switched.code !== 0) throw new Error(switched.err || "Could not create a scratch branch; changes were left intact.");
    return branch;
  }
  throw new Error("Could not find an unused scratch branch name.");
}
