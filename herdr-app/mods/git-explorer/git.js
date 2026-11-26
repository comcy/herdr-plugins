export function parseStatus(value) {
  const files = [];
  for (const entry of String(value ?? "").split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2), path = entry.slice(3), untracked = code === "??";
    if (!path) continue;
    const conflict = code.includes("U") || code === "AA" || code === "DD";
    files.push({
      path,
      code,
      kind: conflict ? "U" : code.includes("D") ? "D" : untracked || code.includes("A") ? "A" : "M",
      staged: !untracked && code[0] !== " ",
      unstaged: untracked || code[1] !== " ",
    });
  }
  return files;
}

export function changedPathSet(status) {
  const paths = new Set();
  for (const file of status ?? []) {
    const path = String(file.path ?? "");
    if (!path) continue;
    paths.add(path);
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) paths.add(parts.slice(0, index).join("/"));
  }
  return paths;
}

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export async function stageFile(root, path, on, exec) {
  const result = await exec("git", [...READ, "add", "--", path], { cwd: root, on });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || "git add failed").trim());
}

function parseUnifiedDiff(value) {
  const lines = String(value ?? "").split("\n"), firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk < 0) return [];
  const header = `${lines.slice(0, firstHunk).join("\n")}\n`, hunks = [];
  let index = firstHunk;
  while (index < lines.length) {
    const start = index, match = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) { index++; continue; }
    let oldLine = Number(match[1]), newLine = Number(match[3]), added = 0, removed = 0;
    const rows = [], deleted = [], inserted = [];
    const flush = () => {
      for (let row = 0; row < Math.max(deleted.length, inserted.length); row++) {
        rows.push({ left: deleted[row] ?? null, right: inserted[row] ?? null });
      }
      deleted.length = 0;
      inserted.length = 0;
    };
    index++;
    for (; index < lines.length; index++) {
      const line = lines[index];
      if (line.startsWith("@@ ") || line.startsWith("diff --git ")) break;
      if (line.startsWith("\\ No newline")) continue;
      if (line.startsWith(" ")) {
        flush();
        const text = line.slice(1);
        rows.push({ left: { number: oldLine++, text, kind: "context" }, right: { number: newLine++, text, kind: "context" } });
      } else if (line.startsWith("-")) {
        deleted.push({ number: oldLine++, text: line.slice(1), kind: "removed" });
        removed++;
      } else if (line.startsWith("+")) {
        inserted.push({ number: newLine++, text: line.slice(1), kind: "added" });
        added++;
      } else break;
    }
    flush();
    hunks.push({ header: lines[start], patch: `${header}${lines.slice(start, index).join("\n")}\n`, rows, added, removed });
  }
  return hunks;
}

export async function getFileDiff(root, path, on, exec) {
  const statusResult = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", path], { cwd: root, on });
  if (statusResult.code !== 0) throw new Error((statusResult.stderr || "Could not read repository status.").trim());
  const status = parseStatus(statusResult.stdout).find((file) => file.path === path);
  if (!status) throw new Error(`${path} no longer has Git changes.`);
  if (status.kind === "U") return { status, comparison: "unmerged", stageable: false, binary: false, hunks: [], raw: "" };
  const untracked = status.code === "??", stagedOnly = status.staged && !status.unstaged;
  const args = untracked
    ? [...READ, "diff", "--no-index", "--no-color", "--no-ext-diff", "--unified=3", "--", /^[A-Za-z]:[\\/]|^\\\\/.test(root) ? "NUL" : "/dev/null", path]
    : [...READ, "diff", ...(stagedOnly ? ["--cached"] : []), "--no-color", "--no-ext-diff", "--no-renames", "--unified=3", "--", path];
  const result = await exec("git", args, { cwd: root, on });
  if (result.code !== 0 && !(untracked && result.code === 1)) throw new Error((result.stderr || result.stdout || "Could not read file diff.").trim());
  const raw = String(result.stdout ?? "");
  return {
    status,
    comparison: untracked ? "empty-worktree" : stagedOnly ? "head-index" : "index-worktree",
    stageable: status.unstaged && status.kind !== "U",
    binary: /^(?:Binary files |GIT binary patch)/m.test(raw),
    hunks: parseUnifiedDiff(raw),
    raw,
  };
}

export async function stageHunk(root, patch, on, exec) {
  const text = String(patch ?? "");
  if (!text.includes("\n@@ ")) throw new Error("Selected hunk patch is invalid.");
  let result;
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(root)) {
    const body = text.replace(/\r?\n$/, "");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$patch = @'",
      body,
      "'@",
      "$path = Join-Path $env:TEMP ('herdr-stage-' + [guid]::NewGuid().ToString('N') + '.patch')",
      "try {",
      "  [System.IO.File]::WriteAllText($path, $patch, [System.Text.UTF8Encoding]::new($false))",
      "  & git apply --cached -- $path",
      "  if ($LASTEXITCODE -ne 0) { throw \"git apply failed ($LASTEXITCODE)\" }",
      "} finally { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }",
    ].join("\n");
    result = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { cwd: root, on });
  } else {
    let marker = "HERDR_PATCH_END";
    while (text.split(/\r?\n/).includes(marker)) marker += "_";
    const script = `git apply --cached - <<'${marker}'\n${text}${marker}\n`;
    result = await exec("sh", ["-c", script], { cwd: root, on });
  }
  if (result.code !== 0) throw new Error((result.stderr || result.stdout || "Could not stage selected hunk.").trim());
}

const MAX_FILES = 5000;

export function buildTree(paths) {
  const tree = new Map([["", []]]);
  for (const path of paths) {
    const parts = path.split("/");
    let parent = "";
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      const current = parent ? `${parent}/${name}` : name;
      const directory = index < parts.length - 1;
      const siblings = tree.get(parent);
      if (!siblings.some((entry) => entry.path === current)) siblings.push({ path: current, name, directory });
      if (directory && !tree.has(current)) tree.set(current, []);
      parent = current;
    }
  }
  for (const entries of tree.values()) entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return tree;
}

export async function listRepositoryFiles(folder, on, exec) {
  if (!folder) throw new Error("No focused folder.");
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  if (top.code !== 0) throw new Error((top.stderr || "The focused folder is not in a Git repository.").trim());
  const root = String(top.stdout ?? "").trim();
  const [listed, statusResult] = await Promise.all([
    exec("git", [...READ, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, on }),
    exec("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on }),
  ]);
  if (listed.code !== 0) throw new Error((listed.stderr || "Could not list repository files.").trim());
  if (statusResult.code !== 0) throw new Error((statusResult.stderr || "Could not read repository status.").trim());
  const status = parseStatus(statusResult.stdout);
  const unique = new Set(status.map((file) => file.path));
  for (const path of String(listed.stdout ?? "").split("\0")) if (path) unique.add(path);
  const allPaths = [...unique], limited = allPaths.length > MAX_FILES;
  const paths = allPaths.slice(0, MAX_FILES);
  return { root, status, tree: buildTree(paths), limited };
}
