// Obsidian vault: due/overdue tasks, quick capture, preconfigured agent runs. Path etc. in ~/.config/herdr-app/vault.json
// (see vault.example.json). Two modes in one file: right panel (block `vault`) and the capture popup (`mod.open:vault`).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, theme, home, appHome, readTextFile, writeTextFile, props, closeOverlay, openOverlay, layout, window } from "herdr";
import { parseTasks, checkOff, captureName } from "./tasks.js";

const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };   // local time
const popup = () => openOverlay({ mod: "vault-watch", kind: "popup", width: 480, height: 170 });

const win = () => window()?.platform === "windows";
// Windows: same output shape as `grep -rn` ("./rel/path.md:12:line") via PowerShell, so tasks.js parses both.
const psScan = (cfg) => `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ex=@(${cfg.exclude.map((d) => `'${d}'`).join(",")}); $exf=@(${cfg.excludeFiles.map((f) => `'${f}'`).join(",")});
Get-ChildItem -Recurse -File -Filter *.md | ForEach-Object { $rel=(Resolve-Path -LiteralPath $_.FullName -Relative).Substring(2).Replace('\\','/');
  if (($rel.Split('/') | Select-Object -SkipLast 1 | Where-Object { $ex -contains $_ }) -or ($exf -contains $_.Name)) { return }
  Select-String -LiteralPath $_.FullName -Encoding utf8 -Pattern '^\s*- \[ \].*due::' | ForEach-Object { "./$rel:$($_.LineNumber):$($_.Line)" } }`;

async function loadConfig() {
  const text = await readTextFile(`${appHome()}/vault.json`);
  if (!text) throw new Error(`create ${appHome()}/vault.json  {"path": "~/path/to/vault"}`);
  const c = JSON.parse(text);
  if (!c.path) throw new Error("vault.json: \"path\" missing");
  return { exclude: [".obsidian", ".git", "_kb", "Templates"], excludeFiles: ["CONTEXT.md"], captureDir: "Inbox", agents: [], ...c, path: c.path.replace(/^~/, home()).replace(/\/$/, "") };
}

export default class VaultWatch extends View {
  init(_p, cx) {
    this.capture = Boolean(props()?.overlay);
    this.cfg = null; this.tasks = null; this.err = null; this.last = 0;
    if (this.capture) return this.initCapture(cx);
    this.load(cx);
    cx.timer.every(3000, (cx) => {
      const root = layout(), panel = find(root, "panel");
      if (!panel || panel.hidden || find(root, "panel-body")?.active !== "vault") return;
      if (Date.now() - this.last > 15000) this.load(cx);
    });
  }
  // --- panel ---
  load(cx) {
    this.last = Date.now();
    cx.spawn(async (cx) => {
      try {
        this.cfg = await loadConfig();
        const ex = [...this.cfg.exclude.map((d) => `--exclude-dir=${d}`), ...this.cfg.excludeFiles.map((f) => `--exclude=${f}`)];
        const r = win()
          ? await exec("powershell", ["-NoProfile", "-Command", psScan(this.cfg)], { cwd: this.cfg.path, timeout: 120000 })
          : await exec("grep", ["-rnE", "--include=*.md", ...ex, "^[[:space:]]*- \\[ \\].*due::", "."], { cwd: this.cfg.path });
        if (r.code > 1) throw new Error(r.stderr.trim() || "grep failed");
        this.tasks = parseTasks(r.stdout, today()); this.err = null;
      } catch (e) { this.err = String(e.message ?? e); }
      cx.notify();
    });
  }
  open(tk, cx) {
    const vault = this.cfg.path.split(/[\\/]/).pop();
    cx.open_url(`obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(tk.file.replace(/\.md$/, ""))}`);
  }
  done(tk, cx) {
    cx.spawn(async (cx) => {
      const path = `${this.cfg.path}/${tk.file}`;
      try {
        const old = await readTextFile(path), next = old && checkOff(old, tk.line, tk.text);
        if (next) await writeTextFile(path, next, old);   // rejects when the file changed meanwhile
        else this.err = `${tk.file}:${tk.line} changed, not checked off`;
      } catch (e) { this.err = String(e.message ?? e); }
      this.load(cx);
    });
  }
  agent(a) {
    run("tab.new", { name: a.name, folder: this.cfg.path, argv: a.argv, ...(a.task ? { task: a.task } : {}) });
  }
  // --- capture popup ---
  initCapture(cx) {
    this.text = ""; this.input = InputState.new({ value: "" });
    this.input.on("change", () => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.save());
    this.input.focus(); cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { try { this.cfg = await loadConfig(); } catch (e) { this.err = String(e.message ?? e); } cx.notify(); });
  }
  async save() {
    const text = this.text.trim();
    if (!text || !this.cfg) return;
    const name = captureName(text, today()), dir = `${this.cfg.path}/${this.cfg.captureDir}`;
    try {
      await (win() ? exec("powershell", ["-NoProfile", "-Command", `New-Item -ItemType Directory -Force -LiteralPath '${dir}'`]) : exec("mkdir", ["-p", dir]));
      for (let i = 0; ; i++) {   // existing file -> writeTextFile rejects (expected null) -> next suffix
        try { await writeTextFile(`${dir}/${i ? name.replace(/\.md$/, ` ${i + 1}.md`) : name}`, text + "\n", null); break; }
        catch (e) { if (i >= 5) throw e; }
      }
      closeOverlay(props().overlay);
    } catch (e) { this.err = String(e.message ?? e); }
  }
  renderCapture() {
    const t = theme();
    return v_flex().id("vault-capture").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .w_full().p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Quick capture"))
        .child(div().text_size(11).text_color(t.dim).child("Enter saves · Esc")))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().text_size(11.5).text_color(this.err ? t.ansi1 : t.dim).child(this.err ?? `→ ${this.cfg?.captureDir ?? "Inbox"}/`));
  }
  render() {
    if (this.capture) return this.renderCapture();
    const t = theme(), tasks = this.tasks;
    const btn = (id, label, fn) => div().id(id).px(10).py(4).rounded(6).bg(t.raised).text_size(12).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(fn).child(label);
    const head = (label, n, color) => div().px(10).pt(8).pb(2).text_size(11.5).text_color(color).child(`${label} (${n})`);
    const row = (tk) => h_flex().id(`tk-${tk.file}-${tk.line}`).gap(8).px(10).h(28).flex_none().items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(`${tk.text}\n${tk.file}:${tk.line} · due ${tk.due}\n\nclick: open in Obsidian · ☐: check off`)
      .on_click((_e, cx) => this.open(tk, cx))
      .child(div().id(`ck-${tk.file}-${tk.line}`).w(14).text_color(t.dim).hover((s) => s.text_color(t.ansi2)).tooltip("check off")
        .on_click((_e, cx) => { cx.stop_propagation(); this.done(tk, cx); }).child("☐"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(tk.text))
      .child(div().flex_none().text_size(11.5).text_color(tk.overdue ? t.ansi1 : t.ansi3).child(tk.overdue ? tk.due.slice(5) : "today"));
    const over = (tasks ?? []).filter((x) => x.overdue), due = (tasks ?? []).filter((x) => !x.overdue);
    return v_flex().id("vault").size_full().min_h(0).bg(t.chrome).p(8).gap(6).text_size(13)
      .child(h_flex().gap(6).items_center().child(btn("v-cap", "+ Capture", popup)).child(div().flex_1())
        .child(div().id("v-reload").text_size(11.5).text_color(t.dim).cursor_pointer().on_click((_e, cx) => this.load(cx)).child("↻")))
      .child(v_flex().id("v-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(2)
        .when(Boolean(this.err), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.err)))
        .when(!this.err && !tasks, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
        .when(!this.err && tasks?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("nothing due 🎉")))
        .when(over.length > 0, (el) => el.child(head("Overdue", over.length, t.ansi1)).children(over.map(row)))
        .when(due.length > 0, (el) => el.child(head("Due today", due.length, t.ansi3)).children(due.map(row))))
      .when((this.cfg?.agents ?? []).length > 0, (el) => el.child(v_flex().gap(4).pt(4).border_t(1).border_color(t.border)
        .child(div().px(4).text_size(11.5).text_color(t.dim).child("Agent runs"))
        .child(h_flex().gap(6).flex_wrap().children(this.cfg.agents.map((a, i) => btn(`ag-${i}`, `▶ ${a.name}`, () => this.agent(a)))))));
  }
}
