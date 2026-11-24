// node herdr-app/test/branches.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutBranch, cloneBareRepository, createWorktree, inspectRepository, parseBranches, scratchBranch } from "../mods/branches-code/git.js";

const sorted = parseBranches("old\t100\nnew\t300\nmid\t200\n", "origin/old\t\t100\norigin/new\t\t300\norigin/mid\t\t200\norigin/HEAD\trefs/remotes/origin/new\t300\n", "origin");
assert.deepEqual(sorted.local.map((branch) => branch.branch), ["new", "mid", "old"]);
assert.deepEqual(sorted.remote.map((branch) => branch.remoteRef), ["origin/new", "origin/mid", "origin/old"]);

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(" ")} failed`);
  return (r.stdout ?? "").trim();
}
const execGit = async (command, args, { cwd }) => {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
function initRepo(path) {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "-b", "main"]);
  git(path, ["config", "user.name", "Herdr Test"]);
  git(path, ["config", "user.email", "herdr-test@example.invalid"]);
  writeFileSync(join(path, "file.txt"), "main\n");
  git(path, ["add", "file.txt"]);
  git(path, ["commit", "-qm", "main"]);
}
async function fixture(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-branches-")));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

await fixture(async (tmp) => {
  const repoPath = join(tmp, "repo");
  initRepo(repoPath);
  git(repoPath, ["branch", "feature/local"]);
  const repo = await inspectRepository(repoPath, null, execGit);
  assert.deepEqual(repo.branches.local.map((b) => b.branch), ["feature/local", "main"]);
  const result = await checkoutBranch(repo, { kind: "local", branch: "feature/local" }, null, execGit);
  assert.equal(result.path, repoPath);
  assert.equal(result.open, false);
  assert.equal(git(repoPath, ["branch", "--show-current"]), "feature/local");
});

await fixture(async (tmp) => {
  const repoPath = join(tmp, "repo"), remotePath = join(tmp, "origin.git");
  initRepo(repoPath);
  git(tmp, ["init", "--bare", "-q", remotePath]);
  git(repoPath, ["remote", "add", "origin", remotePath]);
  git(repoPath, ["push", "-qu", "origin", "main"]);
  git(repoPath, ["switch", "-q", "-c", "feature/remote"]);
  writeFileSync(join(repoPath, "remote.txt"), "remote\n");
  git(repoPath, ["add", "remote.txt"]);
  git(repoPath, ["commit", "-qm", "remote feature"]);
  git(repoPath, ["push", "-qu", "origin", "feature/remote"]);
  git(repoPath, ["switch", "-q", "main"]);
  git(repoPath, ["switch", "-q", "-c", "feature/worktree"]);
  writeFileSync(join(repoPath, "worktree.txt"), "worktree branch\n");
  git(repoPath, ["add", "worktree.txt"]);
  git(repoPath, ["commit", "-qm", "remote worktree branch"]);
  git(repoPath, ["push", "-qu", "origin", "feature/worktree"]);
  git(repoPath, ["switch", "-q", "main"]);
  git(repoPath, ["branch", "-D", "feature/remote"]);
  git(repoPath, ["branch", "-D", "feature/worktree"]);
  git(repoPath, ["fetch", "-q", "origin"]);

  const repo = await inspectRepository(repoPath, null, execGit);
  const target = repo.branches.remote.find((b) => b.remoteRef === "origin/feature/remote");
  assert.ok(target);
  const worktreeTarget = repo.branches.remote.find((b) => b.remoteRef === "origin/feature/worktree");
  assert.ok(worktreeTarget);
  const worktree = await createWorktree(repo, worktreeTarget, null, execGit);
  assert.equal(worktree.path, join(tmp, "repo.worktrees", "feature-worktree"));
  assert.equal(git(worktree.path, ["branch", "--show-current"]), "feature/worktree");
  assert.equal(git(worktree.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]), "origin/feature/worktree");
  const result = await checkoutBranch(repo, target, null, execGit);
  assert.equal(result.path, repoPath);
  assert.equal(git(repoPath, ["branch", "--show-current"]), "feature/remote");
  assert.equal(git(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]), "origin/feature/remote");
});

await fixture(async (tmp) => {
  const repoPath = join(tmp, "repo"), worktreePath = join(tmp, "repo-feature");
  initRepo(repoPath);
  git(repoPath, ["branch", "feature"]);
  git(repoPath, ["worktree", "add", "-q", worktreePath, "feature"]);
  const repo = await inspectRepository(repoPath, null, execGit);
  const result = await checkoutBranch(repo, { kind: "local", branch: "feature" }, null, execGit);
  assert.deepEqual(result, { path: worktreePath, open: true, created: false });
  assert.equal(git(repoPath, ["branch", "--show-current"]), "main");
  assert.equal(git(worktreePath, ["branch", "--show-current"]), "feature");
});

await fixture(async (tmp) => {
  const project = join(tmp, "project"), barePath = join(project, ".bare"), seed = join(tmp, "seed");
  mkdirSync(project, { recursive: true });
  initRepo(seed);
  git(seed, ["switch", "-q", "-c", "feature/bare"]);
  writeFileSync(join(seed, "bare.txt"), "bare feature\n");
  git(seed, ["add", "bare.txt"]);
  git(seed, ["commit", "-qm", "bare feature"]);
  git(seed, ["switch", "-q", "main"]);
  git(tmp, ["init", "--bare", "-q", barePath]);
  git(barePath, ["remote", "add", "origin", seed]);
  git(barePath, ["fetch", "-q", "origin"]);
  git(seed, ["remote", "add", "bare", barePath]);
  git(seed, ["push", "-q", "bare", "main:refs/heads/main"]);
  git(barePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  const repo = await inspectRepository(barePath, null, execGit);
  assert.equal(repo.worktreeMode, true);
  const target = repo.branches.remote.find((b) => b.remoteRef === "origin/feature/bare");
  assert.ok(target);
  const result = await checkoutBranch(repo, target, null, execGit);
  assert.equal(result.path, join(project, "feature-bare"));
  assert.equal(result.open, true);
  assert.equal(result.created, true);
  assert.equal(git(result.path, ["branch", "--show-current"]), "feature/bare");
  assert.equal(git(barePath, ["config", "--get", "branch.feature/bare.remote"]), "origin");
  const localMain = repo.branches.local.find((branch) => branch.branch === "main");
  const localResult = await createWorktree(repo, localMain, null, execGit);
  assert.equal(localResult.path, join(project, "main"));
  assert.equal(git(localResult.path, ["branch", "--show-current"]), "main");
});

await fixture(async (tmp) => {
  const repoPath = join(tmp, "repo");
  initRepo(repoPath);
  git(repoPath, ["switch", "-q", "-c", "feature"]);
  writeFileSync(join(repoPath, "file.txt"), "feature\n");
  git(repoPath, ["add", "file.txt"]);
  git(repoPath, ["commit", "-qm", "feature"]);
  git(repoPath, ["switch", "-q", "main"]);
  writeFileSync(join(repoPath, "file.txt"), "uncommitted user data\n");
  const repo = await inspectRepository(repoPath, null, execGit);
  await assert.rejects(checkoutBranch(repo, { kind: "local", branch: "feature" }, null, execGit));
  assert.equal(git(repoPath, ["branch", "--show-current"]), "main");
  assert.equal(readFileSync(join(repoPath, "file.txt"), "utf8"), "uncommitted user data\n");
});
 
await fixture(async (tmp) => {
  const repoPath = join(tmp, "repo");
  initRepo(repoPath);
  git(repoPath, ["branch", "feature/existing"]);
  const repo = await inspectRepository(repoPath, null, execGit);
  const existing = await createWorktree(repo, { kind: "local", branch: "feature/existing" }, null, execGit);
  assert.equal(existing.path, join(tmp, "repo.worktrees", "feature-existing"));
  assert.equal(git(existing.path, ["branch", "--show-current"]), "feature/existing");
  assert.equal(git(repoPath, ["branch", "--show-current"]), "main");
  await assert.rejects(createWorktree(repo, { kind: "local", branch: "feature/existing" }, null, execGit), /already checked out/);

  const baseCommit = git(repoPath, ["rev-parse", "HEAD"]);
  const fresh = await createWorktree(repo, { kind: "new", branch: "feature/dialog" }, null, execGit);
  assert.equal(fresh.path, join(tmp, "repo.worktrees", "feature-dialog"));
  assert.equal(git(fresh.path, ["branch", "--show-current"]), "feature/dialog");
  assert.equal(git(fresh.path, ["rev-parse", "HEAD"]), baseCommit);
  assert.equal(git(repoPath, ["branch", "--show-current"]), "main");
});

await fixture(async (tmp) => {
  const seed = join(tmp, "seed"), remote = join(tmp, "remote.git");
  initRepo(seed);
  git(tmp, ["init", "--bare", "-q", remote]);
  git(seed, ["push", "-q", remote, "main:refs/heads/main"]);
  git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  const cloned = await cloneBareRepository(tmp, remote, "", null, execGit);
  assert.equal(cloned.name, "remote");
  assert.equal(cloned.repoRoot, join(tmp, "remote"));
  assert.equal(cloned.barePath, join(tmp, "remote", ".bare"));
  assert.equal(cloned.path, join(tmp, "remote", "main"));
  assert.equal(git(cloned.path, ["show", "HEAD:file.txt"]), "main");
  const repo = await inspectRepository(cloned.path, null, execGit);
  assert.equal(repo.bareLayout, true);
  assert.equal(repo.repoRoot, cloned.repoRoot);
  assert.equal(repo.currentBranch, "main");
  assert.equal(git(cloned.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]), "origin/main");
  assert.equal(git(cloned.path, ["remote", "get-url", "origin"]), remote);
  await assert.rejects(cloneBareRepository(tmp, remote, "remote", null, execGit), /already exists/);
});

await fixture(async (tmp) => {
  const repoPath = join(tmp, "repo"), now = Date.UTC(2026, 0, 2, 3, 4, 5);
  initRepo(repoPath);
  const baseCommit = git(repoPath, ["rev-parse", "HEAD"]);
  git(repoPath, ["branch", "scratch/20260102T030405Z"]);
  writeFileSync(join(repoPath, "file.txt"), "staged\n");
  git(repoPath, ["add", "file.txt"]);
  writeFileSync(join(repoPath, "file.txt"), "unstaged\n");
  writeFileSync(join(repoPath, "new.txt"), "untracked\n");

  const repo = await inspectRepository(repoPath, null, execGit);
  const branch = await scratchBranch(repo, null, execGit, now);
  assert.equal(branch, "scratch/20260102T030405Z-2");
  assert.equal(git(repoPath, ["branch", "--show-current"]), branch);
  assert.equal(git(repoPath, ["show", ":file.txt"]), "staged");
  assert.equal(readFileSync(join(repoPath, "file.txt"), "utf8"), "unstaged\n");
  assert.equal(readFileSync(join(repoPath, "new.txt"), "utf8"), "untracked\n");
  assert.equal(git(repoPath, ["rev-parse", "HEAD"]), baseCommit);
  assert.match(git(repoPath, ["status", "--porcelain", "--untracked-files=all"]), /MM file\.txt/);
  assert.match(git(repoPath, ["status", "--porcelain", "--untracked-files=all"]), /\?\? new\.txt/);
  git(repoPath, ["add", "file.txt", "new.txt"]);
  git(repoPath, ["commit", "-qm", "scratch"]);
  await assert.rejects(scratchBranch(repo, null, execGit, now + 1000), /no uncommitted changes/);
});
 
console.log("ok: recency, repo-relative worktrees, bare cloning, scratch branches, checkout, and dirty-tree safety");


