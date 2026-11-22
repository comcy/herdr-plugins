// Obsidian vault: due/overdue tasks, quick capture, preconfigured agent runs. Path etc. in ~/.config/herdr-app/vault.json
// (see vault.example.json). Two modes in one file: right panel (block `vault`) and the capture popup (`mod.open:vault`).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { exec, run, theme, home, appHome, readTextFile, writeTextFile, props, closeOverlay, openOverlay, layout, window } from "herdr";
import { parseTasks, checkOff, captureName } from "./tasks.js";

const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };   // local time
const stamp = () => today().replace(/-/g, "") + new Date().toTimeString().slice(0, 8).replace(/:/g, "");   // 20261122143005, Obsidian style
const popup = () => openOverlay({ mod: "vault-watch", kind: "popup", width: 540, height: 350 });

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
  return { exclude: [".obsidian", ".git", "_kb", "Templates"], excludeFiles: ["CONTEXT.md"], captureDir: "Inbox", attachmentDir: "Attachments", agents: [], ...c, path: c.path.replace(/^~/, home()).replace(/\/$/, "") };
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
  // --- capture popup: multi-line note, Ctrl+V / button pastes a clipboard image as an attachment ---
  initCapture(cx) {
    this.text = ""; this.images = 0;
    this.ta = TextareaState.new({ placeholder: "First line = title. Ctrl+V pastes a screenshot from the clipboard.", rows: 8 });
    this.ta.on("change", (_e, cx) => { this.text = this.ta.value(); cx.notify(); });
    this.ta.on("paste_other", (_e, cx) => this.paste(cx));          // clipboard had no text
    this.ta.focus(); cx.timer.after(600, () => this.ta.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { try { this.cfg = await loadConfig(); } catch (e) { this.err = String(e.message ?? e); } cx.notify(); });
  }
  mkdir(dir) {
    return win() ? exec("powershell", ["-NoProfile", "-Command", `New-Item -ItemType Directory -Force -LiteralPath '${dir}'`]) : exec("mkdir", ["-p", dir]);
  }
  // Clipboard image -> <attachmentDir>/Pasted image <stamp>.png, then `![[name]]` at the cursor.
  paste(cx) {
    if (!this.cfg) return;
    cx.spawn(async (cx) => {
      const dir = `${this.cfg.path}/${this.cfg.attachmentDir}`, name = `Pasted image ${stamp()}.png`, f = `${dir}/${name}`;
      try {
        await this.mkdir(dir);
        const r = win()
          ? await exec("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Drawing; $i=Get-Clipboard -Format Image; if(-not $i){exit 1}; $i.Save('${f}',[Drawing.Imaging.ImageFormat]::Png)`])
          : await exec("sh", ["-c", `f="$1"; { wl-paste --type image/png || xclip -selection clipboard -t image/png -o || pngpaste -; } >"$f" 2>/dev/null; [ -s "$f" ] || { rm -f "$f"; exit 1; }`, "sh", f]);
        if (r.code !== 0) throw new Error("no image in the clipboard (Linux: wl-clipboard or xclip, macOS: pngpaste)");
        this.ta.replace(`![[${name}]]\n`); this.images++; this.err = null;
      } catch (e) { this.err = String(e.message ?? e); }
      cx.notify();
    });
  }
  async save() {
    const text = this.text.trim();
    if (!text || !this.cfg) return;
    const name = captureName(text, today()), dir = `${this.cfg.path}/${this.cfg.captureDir}`;
    try {
      await this.mkdir(dir);
      for (let i = 0; ; i++) {   // existing file -> writeTextFile rejects (expected null) -> next suffix
        try { await writeTextFile(`${dir}/${i ? name.replace(/\.md$/, ` ${i + 1}.md`) : name}`, text + "\n", null); break; }
        catch (e) { if (i >= 5) throw e; }
      }
      closeOverlay(props().overlay);
    } catch (e) { this.err = String(e.message ?? e); }
  }
  renderCapture() {
    const t = theme();
    const btn = (id, label, primary, fn) => div().id(id).px(12).py(6).rounded(8).border_1().border_color(primary ? t.solid : t.input)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(fn).child(label);
    return v_flex().id("vault-capture").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
        else if (e.key === "s" && (e.modifiers.control || e.modifiers.platform)) { this.save(); cx.stop_propagation(); }
      })
      .w_full().p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Quick capture"))
        .child(div().text_size(11).text_color(t.dim).child("Ctrl+S saves · Esc")))
      .child(Textarea.new(this.ta).w_full().h(190).px(10).py(8).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().text_size(11.5).text_color(this.err ? t.ansi1 : t.dim)
        .child(this.err ?? `→ ${this.cfg?.captureDir ?? "Inbox"}/${this.images ? ` · ${this.images} image(s) → ${this.cfg.attachmentDir}/` : ""}`))
      .child(h_flex().gap(8).justify_end()
        .child(btn("cap-img", "📎 Screenshot", false, (_e, cx) => this.paste(cx)))
        .child(btn("cap-save", "Save", true, () => this.save())));
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
    return v_flex().id("vault").size_full().min_h(0).text_size(13).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .child(h_flex().gap(6).items_center().h(42).flex_none().px(14).border_b(1).border_color(t.border).child(btn("v-cap", "+ Capture", popup)).child(div().flex_1())
        .child(div().id("v-reload").text_size(11.5).text_color(t.dim).cursor_pointer().on_click((_e, cx) => this.load(cx)).child("↻")))
      .child(v_flex().id("v-rows").flex_1().min_h(0).p(6).overflow_y_scrollbar().gap(2)
        .when(Boolean(this.err), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.err)))
        .when(!this.err && !tasks, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
        .when(!this.err && tasks?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("nothing due 🎉")))
        .when(over.length > 0, (el) => el.child(head("Overdue", over.length, t.ansi1)).children(over.map(row)))
        .when(due.length > 0, (el) => el.child(head("Due today", due.length, t.ansi3)).children(due.map(row))))
      .when((this.cfg?.agents ?? []).length > 0, (el) => el.child(v_flex().gap(4).p(10).flex_none().border_t(1).border_color(t.border)
        .child(div().px(4).text_size(11.5).text_color(t.dim).child("Agent runs"))
        .child(h_flex().gap(6).flex_wrap().children(this.cfg.agents.map((a, i) => btn(`ag-${i}`, `▶ ${a.name}`, () => this.agent(a)))))));
  }
}
