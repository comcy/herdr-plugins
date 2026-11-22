// Normalizes `docker ps --format json` (NDJSON) and `podman ps --format json` (array) into one shape.
export function parsePs(text) {
  const t = (text ?? "").trim();
  if (!t) return [];
  const rows = t.startsWith("[") ? JSON.parse(t) : t.split("\n").map((l) => JSON.parse(l));
  return rows.map((c) => {
    const ports = Array.isArray(c.Ports)
      ? c.Ports.map((p) => ({ host: p.host_port || null, container: p.container_port, proto: p.protocol || "tcp" }))
      : String(c.Ports ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
          const m = /(?:.*:)?(\d+)->(\d+)\/(\w+)/.exec(s);
          return m ? { host: m[1], container: m[2], proto: m[3] } : { host: null, container: s.split("/")[0], proto: s.split("/")[1] ?? "tcp" };
        });
    return {
      id: c.ID ?? c.Id, name: Array.isArray(c.Names) ? c.Names[0] : c.Names, image: c.Image,
      state: (c.State ?? "").toLowerCase(), status: c.Status ?? "", ports,
    };
  });
}
export const portLabel = (p) => (p.host ? `${p.host}→${p.container}` : `${p.container}`);
