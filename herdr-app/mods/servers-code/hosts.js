// Hosts of an OpenSSH client config: every `Host` name without wildcards (* ? !), with the
// first HostName / User found in its block (ssh's own rule). `Include`/`Match` are not followed.
export function parseHosts(text) {
  const hosts = [], seen = new Set();
  let block = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^(\S+?)(?:\s*=\s*|\s+)(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "host") {
      block = val.split(/\s+/).filter((n) => !/[*?!]/.test(n) && !seen.has(n)).map((name) => ({ name, host: "", user: "" }));
      for (const h of block) { seen.add(h.name); hosts.push(h); }
    } else if (key === "match") block = [];
    else if (key === "hostname") for (const h of block) h.host ||= val;
    else if (key === "user") for (const h of block) h.user ||= val;
  }
  return hosts;
}

// "[user@]host[:port]" -> parts (IPv6 not supported); null if empty/invalid.
export function parseDest(s) {
  const m = /^(?:([^@\s]+)@)?([^@\s:]+)(?::(\d{1,5}))?$/.exec((s ?? "").trim());
  return m ? { user: m[1] ?? "", host: m[2], port: m[3] ?? "" } : null;
}
export const sshArgv = (d) => ["ssh", ...(d.port ? ["-p", d.port] : []), d.user ? `${d.user}@${d.host}` : d.host];
export const hostBlock = (name, d) =>
  `Host ${name}\n  HostName ${d.host}\n${d.user ? `  User ${d.user}\n` : ""}${d.port ? `  Port ${d.port}\n` : ""}`;

// --- editing a single Host entry in the config text ---
const hostLine = (l) => /^\s*host(?:\s*=\s*|\s+)/i.test(l.replace(/#.*$/, ""));
const keyOf = (l) => l.replace(/#.*$/, "").trim().match(/^(\S+?)(?:\s*=\s*|\s+)/)?.[1].toLowerCase();
const namesOf = (l) => l.replace(/#.*$/, "").trim().replace(/^host(?:\s*=\s*|\s+)/i, "").split(/\s+/);
// [start, end) line range of the block whose Host line lists `name`, or null.
function findBlock(lines, name) {
  for (let i = 0; i < lines.length; i++) {
    if (!hostLine(lines[i]) || !namesOf(lines[i]).includes(name)) continue;
    let end = i + 1;
    while (end < lines.length && !hostLine(lines[end]) && keyOf(lines[end]) !== "match") end++;
    return [i, end];
  }
  return null;
}
// {host,user,port} of the first HostName/User/Port inside the block of `name` (null if absent).
export function hostDetail(text, name) {
  const lines = text.split(/\r?\n/), b = findBlock(lines, name);
  if (!b) return null;
  const d = { host: "", user: "", port: "" };
  for (const l of lines.slice(b[0] + 1, b[1])) {
    const k = keyOf(l), v = l.replace(/#.*$/, "").trim().replace(/^\S+?(?:\s*=\s*|\s+)/, "");
    if (k === "hostname") d.host ||= v; else if (k === "user") d.user ||= v; else if (k === "port") d.port ||= v;
  }
  return d;
}
export const destString = (d) => `${d.user ? d.user + "@" : ""}${d.host}${d.port ? ":" + d.port : ""}`;
// Remove `name`; a shared "Host a b" line only loses that name.
export function removeHost(text, name) {
  const lines = text.split("\n"), b = findBlock(lines, name);
  if (!b) return text;
  const names = namesOf(lines[b[0]]);
  if (names.length > 1) lines[b[0]] = `Host ${names.filter((n) => n !== name).join(" ")}`;
  else lines.splice(b[0], b[1] - b[0]);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
// Rename / change HostName, User, Port of `name` in place, keeping its other directives.
export function updateHost(text, name, newName, d) {
  const lines = text.split("\n"), b = findBlock(lines, name);
  if (!b) return text;
  if (namesOf(lines[b[0]]).length > 1) {   // split the entry off the shared block
    const rest = removeHost(text, name);
    return rest.replace(/\s*$/, "\n\n") + hostBlock(newName, d);
  }
  const want = { hostname: d.host, user: d.user, port: d.port }, done = new Set(), out = [`Host ${newName}`];
  for (const l of lines.slice(b[0] + 1, b[1])) {
    const k = keyOf(l);
    if (k in want && !done.has(k)) { done.add(k); if (want[k]) out.push(`  ${{ hostname: "HostName", user: "User", port: "Port" }[k]} ${want[k]}`); }
    else if (k in want) continue;
    else out.push(l);
  }
  const trail = []; while (out.length > 1 && out[out.length - 1].trim() === "") trail.push(out.pop());
  for (const k of ["hostname", "user", "port"]) if (!done.has(k) && want[k]) out.push(`  ${{ hostname: "HostName", user: "User", port: "Port" }[k]} ${want[k]}`);
  lines.splice(b[0], b[1] - b[0], ...out, ...trail);
  return lines.join("\n");
}
