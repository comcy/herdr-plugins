// Open tasks with a `due::` field, from `grep -rn` output lines "./path.md:12:- [ ] text [due:: 2026-08-20]".
export function parseTasks(out, today) {
  const tasks = [];
  for (const l of (out ?? "").split("\n")) {
    const m = /^(?:\.\/)?(.+?\.md):(\d+):(.*)$/.exec(l);
    if (!m) continue;
    const due = /due::\s*(\d{4}-\d{2}-\d{2})/.exec(m[3])?.[1];
    if (!due || due > today) continue;   // upcoming tasks are not shown
    const prio = Number(/priority::\s*(\d+)/.exec(m[3])?.[1] ?? 9);
    const text = m[3].replace(/^\s*- \[ \]\s*/, "").replace(/\[\w+::(?:[^\[\]]|\[\[[^\]]*\]\])*\]/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\s+/g, " ").trim();
    tasks.push({ file: m[1], line: Number(m[2]), text, due, prio, overdue: due < today });
  }
  return tasks.sort((a, b) => a.due.localeCompare(b.due) || a.prio - b.prio);
}
// New content of a file with line `line` ([ ] -> [x]), or null if that line is no longer the open task (file changed).
export function checkOff(content, line, text) {
  const ls = content.split("\n"), l = ls[line - 1];
  if (!l || !/^\s*- \[ \]/.test(l) || !l.includes(text.slice(0, 20).replace(/\[\[|\]\]/g, "").split(" ")[0])) return null;
  ls[line - 1] = l.replace(/^(\s*- )\[ \]/, "$1[x]");
  return ls.join("\n");
}
export const captureName = (text, date) =>
  `${date} ${text.split("\n")[0].replace(/[\\/:*?"<>|#^\[\]]/g, "").trim().slice(0, 50) || "Quick capture"}.md`;
