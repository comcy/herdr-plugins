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
