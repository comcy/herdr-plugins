// Dev launcher: scripts of package.json and targets of the Makefile in the focused pane's folder.
// Click = new tab in that folder that runs it (shell stays open afterwards). Local spaces only.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, spaces, panes, theme, readTextFile, layout, window } from "herdr";
import { parsePackage, parseMakefile, parseWorkspaces, detectPm, scriptCommand } from "./scripts.js";

// Terminal argv that runs `cmd` and keeps a shell open afterwards (sh on Linux/macOS, PowerShell on Windows).
const shell = (cmd) => window()?.platform === "windows"
  ? ["powershell", "-NoProfile", "-NoExit", "-Command", `${cmd}; Write-Host "[exit $LASTEXITCODE]"`]
  : ["sh", "-c", `${cmd}; c=$?; printf '\\n[exit %s]\\n' "$c"; exec "\${SHELL:-sh}"`];
const PROBE = ["package.json", "Makefile", "makefile", "GNUmakefile", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"];
// readTextFile: null = absent; a reject (e.g. lockfile over 1 MiB) = present.
const probe = (dir, f) => readTextFile(`${dir}/${f}`).then((t) => t !== null, () => true);
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));

export default class DevRun extends View {
  init(_p, cx) {
    this.groups = null; this.err = null; this.loc = ""; this.last = 0;
    this.load(cx);
    cx.timer.every(3000, (cx) => {
      const root = layout(), panel = find(root, "panel");
      if (!panel || panel.hidden || find(root, "panel-body")?.active !== "dev") return;
      if (JSON.stringify(this.where()) !== this.loc || Date.now() - this.last > 15000) this.load(cx);
    });
  }
  where() {
    const sp = spaces().find((s) => s.active);
    return { cwd: panes().find((p) => p.focused)?.cwd ?? sp?.folder, on: sp?.machine ?? null };
  }
  load(cx) {
    this.last = Date.now();
    const at = this.where(); this.loc = JSON.stringify(at); this.cwd = at.cwd;
    cx.spawn(async (cx) => {
      try {
        if (at.on) throw new Error("remote space: not supported");
        // The pane may sit in a subfolder: use the nearest folder upwards that has a package.json or Makefile.
        let dir = at.cwd, files = [];
        for (let i = 0; i < 8 && dir; i++) {
          files = (await Promise.all(PROBE.map(async (f) => ((await probe(dir, f)) ? f : null)))).filter(Boolean);
          if (files.some((f) => f === "package.json" || /akefile$/.test(f))) break;
          const up = dir.replace(/[\\/][^\\/]+[\\/]?$/, "");
          if (!up || up === dir) { files = []; break; }
          dir = up;
        }
        this.cwd = dir; this.dir = dir; this.found = files;
        const groups = [];
        const pkg = files.includes("package.json") ? parsePackage((await readTextFile(`${dir}/package.json`)) ?? "") : null;
        if (pkg?.scripts.length) {
          const pm = detectPm(files, pkg.pm);
          groups.push({ title: `package.json · ${pm}`, items: pkg.scripts.map((s) => ({ ...s, run: scriptCommand(pm, s.name) })) });
        }
        const rootPm = detectPm(files, pkg?.pm);
        const wsYaml = await readTextFile(`${dir}/pnpm-workspace.yaml`).catch(() => null);
        for (const rel of parseWorkspaces(wsYaml, pkg ? await readTextFile(`${dir}/package.json`) : null)) {
          const w = parsePackage((await readTextFile(`${dir}/${rel}/package.json`).catch(() => null)) ?? "");
          if (w.scripts.length) groups.push({ title: `${rel} · ${rootPm}`, items: w.scripts.map((x) => ({ ...x, folder: `${dir}/${rel}`, run: scriptCommand(rootPm, x.name) })) });
        }
        const mk = files.find((f) => ["Makefile", "makefile", "GNUmakefile"].includes(f));
        if (mk) {
          const targets = parseMakefile((await readTextFile(`${dir}/${mk}`)) ?? "");
          if (targets.length) groups.push({ title: "Makefile", items: targets.map((s) => ({ ...s, run: `make ${s.name}` })) });
        }
        this.groups = groups; this.err = null;
      } catch (e) { this.err = String(e.message ?? e); this.groups = null; }
      cx.notify();
    });
  }
  start(it) {
    run("terminal.open", {
      argv: shell(it.run),
      folder: it.folder ?? this.cwd, place: "tab", name: it.run,
    });
  }
  render() {
    const t = theme(), g = this.groups;
    const row = (it) => h_flex().id(`dev-${it.folder ?? ""}-${it.run}`).gap(8).px(10).h(28).flex_none().items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip([it.folder ? `in ${it.folder}` : "", it.run, it.cmd].filter(Boolean).join("\n")).on_click(() => this.start(it))
      .child(div().w(14).text_color(t.ansi2).child("▶"))
      .child(div().text_color(t.foreground).child(it.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(it.cmd));
    return v_flex().id("dev-run").size_full().min_h(0).bg(t.chrome).p(8).gap(2).text_size(13).overflow_y_scrollbar()
      .when(Boolean(this.err), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.err)))
      .when(!this.err && !g, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
      .when(g?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child(this.found?.includes("package.json") ? `package.json in ${this.dir} has no "scripts" and no workspace package with scripts` : `no package.json / Makefile in ${this.dir ?? "this folder"} or its parents`)))
      .when(Boolean(g?.length), (el) => el.child(div().px(10).text_size(11).text_color(t.dim).truncate().child(this.dir)))
      .children((g ?? []).flatMap((grp) => [div().px(10).pt(8).pb(2).text_size(11.5).text_color(t.dim).child(grp.title), ...grp.items.map(row)]));
  }
}
