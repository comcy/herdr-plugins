// node herdr-app/test/explorer.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPathSet, getFileDiff, listRepositoryFiles, parseStatus, stageFile, stageHunk } from "../mods/git-explorer/git.js";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout ?? "";
}

async function execGit(command, args, { cwd }) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const changed = changedPathSet([{ path: "src/nested/changed.ts" }]);
assert.deepEqual([...changed].sort(), ["src", "src/nested", "src/nested/changed.ts"]);

const temp = mkdtempSync(join(tmpdir(), "herdr-explorer-"));
try {
  const root = join(temp, "repo");
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Herdr Test"]);
  git(root, ["config", "user.email", "herdr-test@example.invalid"]);
  for (const name of ["staged file.txt", "unstaged file.txt", "deleted file.txt"]) {
    writeFileSync(join(root, name), "base\n");
    git(root, ["add", "--", name]);
  }
  git(root, ["commit", "-qm", "base"]);
  writeFileSync(join(root, "staged file.txt"), "staged change\n");
  git(root, ["add", "--", "staged file.txt"]);
  writeFileSync(join(root, "staged file.txt"), "staged and unstaged change\n");
  writeFileSync(join(root, "unstaged file.txt"), "unstaged change\n");
  rmSync(join(root, "deleted file.txt"));
  writeFileSync(join(root, "untracked file.txt"), "new file\n");

  const status = parseStatus(git(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]));
  const byPath = new Map(status.map((entry) => [entry.path, entry]));
  assert.deepEqual(
    [byPath.get("staged file.txt")?.staged, byPath.get("staged file.txt")?.unstaged],
    [true, true],
  );
  assert.deepEqual(
    [byPath.get("unstaged file.txt")?.staged, byPath.get("unstaged file.txt")?.unstaged],
    [false, true],
  );
  assert.deepEqual(
    [byPath.get("untracked file.txt")?.kind, byPath.get("untracked file.txt")?.unstaged],
    ["A", true],
  );
  assert.deepEqual(
    [byPath.get("deleted file.txt")?.kind, byPath.get("deleted file.txt")?.unstaged],
    ["D", true],
  );
  assert.equal(readFileSync(join(root, "staged file.txt"), "utf8"), "staged and unstaged change\n");
  assert.equal(git(root, ["show", ":staged file.txt"]), "staged change\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const diffTemp = mkdtempSync(join(tmpdir(), "herdr-explorer-diff-"));
try {
  const root = join(diffTemp, "repo");
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Herdr Test"]);
  git(root, ["config", "user.email", "herdr-test@example.invalid"]);
  const before = ["first-old", ...Array.from({ length: 8 }, (_, i) => `middle ${i}`), "last-old"].join("\n") + "\n";
  writeFileSync(join(root, "sample.txt"), before);
  git(root, ["add", "--", "sample.txt"]);
  git(root, ["commit", "-qm", "base"]);
  const after = before.replace("first-old", "first-new").replace("last-old", "last-new");
  writeFileSync(join(root, "sample.txt"), after);
  const diff = await getFileDiff(root, "sample.txt", null, execGit);
  assert.equal(diff.comparison, "index-worktree");
  assert.equal(diff.stageable, true);
  assert.deepEqual(diff.hunks.map((hunk) => [hunk.added, hunk.removed]), [[1, 1], [1, 1]]);
  assert.deepEqual(diff.hunks[0].rows.filter((row) => row.left?.kind === "removed").map((row) => row.left.text), ["first-old"]);
  assert.deepEqual(diff.hunks[0].rows.filter((row) => row.right?.kind === "added").map((row) => row.right.text), ["first-new"]);
  await stageHunk(root, diff.hunks[0].patch, null, execGit);
  assert.equal(git(root, ["show", ":sample.txt"]), after.replace("last-new", "last-old"));
  assert.equal(readFileSync(join(root, "sample.txt"), "utf8"), after);
  const untrackedContent = "new file\n";
  writeFileSync(join(root, "new file.txt"), untrackedContent);
  const untrackedDiff = await getFileDiff(root, "new file.txt", null, execGit);
  assert.equal(untrackedDiff.comparison, "empty-worktree");
  assert.equal(untrackedDiff.stageable, true);
  assert.equal(untrackedDiff.hunks.length, 1);
  await stageHunk(root, untrackedDiff.hunks[0].patch, null, execGit);
  assert.equal(git(root, ["show", ":new file.txt"]), untrackedContent);
} finally {
  rmSync(diffTemp, { recursive: true, force: true });
}

const stageTemp = mkdtempSync(join(tmpdir(), "herdr-explorer-stage-"));
try {
  const root = join(stageTemp, "repo");
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Herdr Test"]);
  git(root, ["config", "user.email", "herdr-test@example.invalid"]);
  for (const name of ["--target file.txt", "other file.txt"]) {
    writeFileSync(join(root, name), "base\n");
    git(root, ["add", "--", name]);
  }
  git(root, ["commit", "-qm", "base"]);
  writeFileSync(join(root, "--target file.txt"), "selected change\n");
  writeFileSync(join(root, "other file.txt"), "unselected change\n");
  const execGit = async (command, args, { cwd }) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  await stageFile(root, "--target file.txt", null, execGit);
  assert.equal(git(root, ["diff", "--cached", "--name-only"]).trim(), "--target file.txt");
  assert.equal(git(root, ["diff", "--name-only"]).trim(), "other file.txt");
} finally {
  rmSync(stageTemp, { recursive: true, force: true });
}

const listTemp = mkdtempSync(join(tmpdir(), "herdr-explorer-list-"));
try {
  const root = join(listTemp, "repo");
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Herdr Test"]);
  git(root, ["config", "user.email", "herdr-test@example.invalid"]);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "tracked file.js"), "tracked\n");
  git(root, ["add", "--", "src/tracked file.js"]);
  git(root, ["commit", "-qm", "base"]);
  writeFileSync(join(root, "src", "new file.js"), "untracked\n");
  const execGit = async (command, args, { cwd }) => {
    const result = spawnSync(command, args, { cwd, encoding: "utf8" });
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const listing = await listRepositoryFiles(root, null, execGit);
  assert.equal(listing.root, git(root, ["rev-parse", "--show-toplevel"]).trim());
  assert.deepEqual(listing.tree.get("src").map((entry) => entry.name), ["new file.js", "tracked file.js"]);
  assert.equal(listing.status.find((entry) => entry.path === "src/new file.js")?.kind, "A");
} finally {
  rmSync(listTemp, { recursive: true, force: true });
}
 
console.log("ok: Explorer recognizes staged, unstaged, untracked, and deleted files");
