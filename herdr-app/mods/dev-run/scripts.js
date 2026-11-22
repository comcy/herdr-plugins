// Pure parsers for the Dev launcher (unit-tested in test/dev-run.test.mjs).
export function parsePackage(text) {
  try {
    const j = JSON.parse(text);
    return { scripts: Object.entries(j.scripts ?? {}).map(([name, cmd]) => ({ name, cmd: String(cmd) })), pm: (j.packageManager ?? "").split("@")[0] };
  } catch { return { scripts: [], pm: "" }; }
}
// Targets `name:` at line start (no `:=`, no `.PHONY`/pattern rules); `## text` on the line = description.
export function parseMakefile(text) {
  const seen = new Set(), out = [];
  for (const l of text.split("\n")) {
    const m = /^([A-Za-z0-9][\w.-]*)\s*:(?!=)[^#]*(?:##\s*(.*))?$/.exec(l);
    if (m && !seen.has(m[1])) { seen.add(m[1]); out.push({ name: m[1], cmd: m[2]?.trim() ?? "" }); }
  }
  return out;
}
export const detectPm = (files, declared) =>
  declared || (files.includes("pnpm-lock.yaml") ? "pnpm" : files.includes("yarn.lock") ? "yarn" : files.some((f) => f === "bun.lockb" || f === "bun.lock") ? "bun" : "npm");
export const scriptCommand = (pm, name) => (pm === "yarn" ? `yarn ${name}` : `${pm} run ${name}`);
