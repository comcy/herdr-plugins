import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState } from "gpui-base";
import { checking, exec, focused, layout, panes, props, readTextFile, run, setShared, shared, spaces, theme, window, writeTextFile } from "herdr";
import { changedPathSet, getFileDiff, listRepositoryFiles, stageFile, stageHunk } from "./git.js";

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map((child) => find(child, id)).find(Boolean);
const basename = (path) => String(path ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";

const FILE_CONTEXT = "git-explorer.file-context";
const STATUS_REVISION = "git-explorer.status-revision";

const bumpStatusRevision = () => setShared(STATUS_REVISION, (shared(STATUS_REVISION) ?? 0) + 1);
const dirname = (path) => {
  const value = String(path ?? "").replace(/\\/g, "/"), slash = value.lastIndexOf("/");
  return slash < 0 ? "." : slash === 0 ? "/" : slash === 2 && /^[A-Za-z]:\//.test(value) ? value.slice(0, 3) : value.slice(0, slash);
};

const LANGUAGES = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", rs: "rust", go: "go", rb: "ruby", sh: "bash", bash: "bash", zsh: "bash", json: "json", md: "markdown", html: "html", css: "css", yaml: "yaml", yml: "yaml", toml: "toml", sql: "sql" };
const languageFor = (path) => LANGUAGES[basename(path).split(".").pop()?.toLowerCase()];
const joinPath = (root, path) => `${String(root).replace(/[\\/]+$/, "")}/${path}`;

function location() {
  const space = spaces().find((item) => item.active), f = focused();
  const pane = f?.pane ? panes().find((item) => item.pane === f.pane) : null;
  const remembered = pane?.mod === "git-explorer" ? shared(FILE_CONTEXT)?.[space?.id] : null;
  const on = remembered ? remembered.on ?? null : f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: remembered?.folder || pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}

export default class GitExplorer extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.mode === "file" ? "file" : p.mode === "diff" ? "diff" : "panel";
    if (this.mode === "file") { this.initFile(p, cx); return; }
    if (this.mode === "diff") { this.initDiff(p, cx); return; }
    this.context = "";
    this.root = null;
    this.tree = new Map([["", []]]);
    this.status = new Map();
    this.changedPaths = new Set();
    this.expanded = new Set();
    this.error = "";
    this.note = "";
    this.loading = false;
    this.checked = false;
    this.busy = null;
    this.limited = false;
    this.changedOnly = false;
    this.last = 0;
    this.statusRevision = shared(STATUS_REVISION) ?? 0;
    this.sequence = 0;
    if (checking()) return;
    if (this.visible()) this.refresh(cx, true);
    cx.timer.every(3000, (cx) => {
      const revision = shared(STATUS_REVISION) ?? 0;
      if (revision !== this.statusRevision) { this.statusRevision = revision; this.last = 0; }
      if (!this.visible() || this.loading || this.busy || window()?.active === false) return;
      if (JSON.stringify(location()) !== this.context || Date.now() - this.last >= 15000) this.refresh(cx);
    });
  }
  initFile(p, cx) {
    this.file = String(p.path ?? "");
    this.label = String(p.label ?? basename(this.file));
    this.space = p.space ?? spaces().find((item) => item.active)?.id;
    this.folder = String(p.folder ?? dirname(this.file));
    this.machine = p.on ?? null;
    this.readonly = Boolean(this.machine);
    this.loading = true;
    this.error = "";
    this.note = "";
    this.editor = null;
    this.original = null;
    this.dirty = false;
    this.saving = false;
    this.closed = false;
    this.handle = cx.focus_handle();
    if (checking()) { this.loading = false; return; }
    if (!this.file) { this.loading = false; this.error = "No file path."; return; }
    this.rememberLocation();
    const path = this.file, on = this.machine;
    cx.spawn(async (cx) => {
      try {
        const value = await readTextFile(path, { on });
        if (this.closed) return;
        if (value === null) throw new Error("File not found or unreadable.");
        if (value.includes("\0")) throw new Error("Binary files cannot be opened in Explorer.");
        this.original = value;
        this.editor = EditorState.new({ language: languageFor(path), value, readonly: this.readonly, soft_wrap: false });
        if (!this.readonly) this.editor.on("change", (_event, cx) => {
          if (!this.editor || this.closed) return;
          this.dirty = this.editor.value() !== this.original;
          this.note = "";
          cx.notify();
        });
        this.editor.focus();
        cx.timer.after(100, () => { if (!this.closed) this.editor?.focus(); });
      } catch (e) {
        if (!this.closed) this.error = String(e?.message ?? e);
      } finally {
        if (!this.closed) { this.loading = false; cx.notify(); }
      }
    });
  }
  initDiff(p, cx) {
    this.file = String(p.path ?? "");
    this.label = String(p.label ?? basename(this.file));
    this.space = p.space ?? spaces().find((item) => item.active)?.id;
    this.folder = String(p.folder ?? "");
    this.machine = p.on ?? null;
    this.diff = null;
    this.loading = true;
    this.error = "";
    this.note = "";
    this.stageBusy = null;
    this.closed = false;
    this.handle = cx.focus_handle();
    if (checking()) { this.loading = false; return; }
    if (!this.file || !this.folder) { this.loading = false; this.error = "No repository file path."; return; }
    this.rememberLocation();
    this.loadDiff(cx);
  }
  loadDiff(cx) {
    const root = this.folder, path = this.file, on = this.machine;
    this.loading = true;
    this.error = "";
    cx.spawn(async (cx) => {
      try {
        this.diff = await getFileDiff(root, path, on, exec);
      } catch (e) {
        this.diff = null;
        this.error = String(e?.message ?? e);
      } finally {
        if (!this.closed) { this.loading = false; cx.notify(); }
      }
    });
  }
  rememberLocation() {
    if (!this.space || !this.folder) return;
    const contexts = shared(FILE_CONTEXT) ?? {}, current = contexts[this.space];
    if (current?.folder === this.folder && current?.on === this.machine) return;
    setShared(FILE_CONTEXT, { ...contexts, [this.space]: { folder: this.folder, on: this.machine } });
  }
  saveFile(cx) {
    if (this.readonly || !this.editor || !this.dirty || this.saving || this.closed) return;
    const editor = this.editor, expected = this.original, value = editor.value();
    this.saving = true;
    this.note = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(this.file, value, expected);
        if (this.closed) return;
        bumpStatusRevision();
        this.original = value;
        this.dirty = editor.value() !== value;
        this.note = "Saved";
      } catch (e) {
        if (!this.closed) this.note = `Save failed: ${String(e?.message ?? e)}`;
      } finally {
        if (!this.closed) { this.saving = false; cx.notify(); }
      }
    });
  }
  close() {
    this.closed = true;
    this.editor?.release();
    this.editor = null;
  }
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return Boolean(panel && !panel.hidden && body?.active === "explorer");
  }
  refresh(cx, force = false) {
    if (checking() || this.loading || this.busy) return;
    const at = location(), key = JSON.stringify(at), visiting = key !== this.context;
    if (!force && !visiting && Date.now() - this.last < 15000) return;
    this.context = key;
    const sequence = ++this.sequence;
    this.last = Date.now();
    this.loading = true;
    this.note = "";
    if (visiting) {
      this.root = null;
      this.tree = new Map([["", []]]);
      this.status = new Map();
      this.changedPaths = new Set();
      this.expanded = new Set();
      this.error = "";
      this.limited = false;
      this.checked = false;
      this.last = 0;
    }
    cx.spawn(async (cx) => {
      try {
        const result = await listRepositoryFiles(at.cwd, at.on, exec);
        if (sequence !== this.sequence || key !== JSON.stringify(location())) return;
        this.root = result.root;
        this.tree = result.tree;
        this.status = new Map(result.status.map((file) => [file.path, file]));
        this.changedPaths = changedPathSet(result.status);
        this.limited = result.limited;
        this.error = "";
      } catch (e) {
        if (sequence === this.sequence) this.error = String(e?.message ?? e);
      } finally {
        if (sequence === this.sequence) {
          this.loading = false;
          this.checked = key === JSON.stringify(location());
          cx.notify();
        }
      }
    });
  }
  toggle(path, cx) {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else this.expanded.add(path);
    cx.notify();
  }
  open(path) {
    if (!this.root) return;
    const status = this.status.get(path), at = location(), mode = status ? "diff" : "file";
    run("tab.new", {
      name: mode === "diff" ? `Diff · ${path}` : path,
      space: at.space,
      mod: "git-explorer",
      props: { mode, path: mode === "diff" ? path : joinPath(this.root, path), label: path, folder: this.root, space: at.space, on: at.on },
    });
  }
  stage(path, cx) {
    if (!this.root || this.busy) return;
    const root = this.root, on = location().on;
    this.busy = path;
    this.note = "";
    cx.notify();
    cx.spawn(async (cx) => {
      let succeeded = false;
      try {
        await stageFile(root, path, on, exec);
        succeeded = true;
      } catch (e) {
        this.note = `Could not stage ${path}: ${String(e?.message ?? e)}`;
      }
      this.busy = null;
      if (succeeded) {
        bumpStatusRevision();
        this.last = 0;
        this.refresh(cx, true);
      }
      cx.notify();
    });
  }
  stageSelectedHunk(index, cx) {
    if (!this.diff?.stageable || this.stageBusy !== null) return;
    const hunk = this.diff.hunks[index];
    if (!hunk) return;
    this.stageBusy = index;
    this.note = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await stageHunk(this.folder, hunk.patch, this.machine, exec);
        bumpStatusRevision();
        this.diff = await getFileDiff(this.folder, this.file, this.machine, exec);
        this.note = "Selected hunk staged; unstaged changes remain in the working tree.";
      } catch (e) {
        this.note = `Could not stage hunk: ${String(e?.message ?? e)}`;
      } finally {
        if (!this.closed) { this.stageBusy = null; cx.notify(); }
      }
    });
  }
  stageDiffFile(cx) {
    if (!this.diff?.stageable || this.stageBusy !== null) return;
    this.stageBusy = "file";
    this.note = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await stageFile(this.folder, this.file, this.machine, exec);
        bumpStatusRevision();
        this.diff = await getFileDiff(this.folder, this.file, this.machine, exec);
        this.note = "File staged.";
      } catch (e) {
        this.note = `Could not stage file: ${String(e?.message ?? e)}`;
      } finally {
        if (!this.closed) { this.stageBusy = null; cx.notify(); }
      }
    });
  }
  openDiffFile() {
    run("tab.new", {
      name: this.label,
      space: this.space,
      mod: "git-explorer",
      props: { mode: "file", path: joinPath(this.folder, this.file), label: this.label, folder: this.folder, space: this.space, on: this.machine },
    });
  }
  rows(prefix, depth, out, t) {
    for (const entry of this.tree.get(prefix) ?? []) {
      const status = this.status.get(entry.path), changed = entry.directory && this.changedPaths.has(entry.path);
      if (this.changedOnly && !this.changedPaths.has(entry.path)) continue;
      const open = this.expanded.has(entry.path), deleted = status?.kind === "D";
      const mark = status?.kind ?? (changed ? "●" : "");
      const markColor = changed ? t.ansi3 : status?.kind === "A" ? t.ansi2 : status?.kind === "D" || status?.kind === "U" ? t.ansi1 : status ? t.ansi3 : t.dim;
      const row = h_flex().id(`explorer-${encodeURIComponent(entry.path)}`).h(28).flex_none().pl(8 + depth * 16).pr(6).gap(6).items_center().rounded(6)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => entry.directory ? this.toggle(entry.path, cx) : this.open(entry.path))
        .tooltip(entry.directory ? `${entry.path}${changed ? " · contains changed files" : ""}` : `${entry.path} · ${status ? "open diff in main window" : "open in main editor"}`)
        .child(entry.directory ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files/${entry.directory ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(deleted ? t.dim : t.foreground).child(entry.name))
        .when(Boolean(mark), (el) => el.child(div().w(14).flex_none().text_size(10.5).text_color(markColor).child(mark)))
        .when(!entry.directory && status?.unstaged, (el) => el.child(div().id(`explorer-stage-${encodeURIComponent(entry.path)}`).w(22).h(22).flex_none().flex().items_center().justify_center().rounded(5)
          .when(!this.busy, (button) => button.cursor_pointer().hover((s) => s.bg(t.selected)).on_click((_e, cx) => { cx.stop_propagation(); this.stage(entry.path, cx); }))
          .text_color(this.busy ? t.dim : t.accent).tooltip(this.busy === entry.path ? "Staging…" : `Stage ${entry.path}`)
          .child(this.busy === entry.path ? "…" : "+")))
        .when(!entry.directory && status?.staged, (el) => el.child(div().w(22).flex_none().text_size(11).text_color(t.ansi2).tooltip("Staged").child("✓")));
      out.push(row);
      if (entry.directory && open) this.rows(entry.path, depth + 1, out, t);
    }
    return out;
  }
  renderFile() {
    const t = theme(), canSave = this.dirty && !this.saving;
    const message = this.note || (this.readonly ? "Remote file · read-only" : this.dirty ? "Unsaved changes · Ctrl+S to save" : "Ctrl+S to save");
    return v_flex().id("explorer-file").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (e.key === "s" && (e.modifiers.control || e.modifiers.platform)) { this.saveFile(cx); cx.stop_propagation(); }
      })
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.label || "File"))
        .child(div().flex_none().text_size(11).text_color(this.readonly ? t.ansi3 : this.dirty ? t.ansi1 : t.dim)
          .child(this.readonly ? "Read-only" : this.dirty ? "Unsaved" : "Local file")))
      .when(this.loading, (el) => el.child(div().flex_1().p(10).text_color(t.dim).child("Loading file…")))
      .when(Boolean(this.error), (el) => el.child(div().flex_1().p(10).text_color(t.ansi1).child(this.error)))
      .when(!this.loading && !this.error && Boolean(this.editor), (el) => el.child(Editor.new(this.editor).flex_1().min_w(0).min_h(0).bg(t.background)))
      .child(h_flex().h(38).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(this.note.startsWith("Save failed:") ? t.ansi1 : t.dim).child(message))
        .when(!this.readonly && Boolean(this.editor), (el) => el.child(div().id("explorer-save").px(10).py(4).rounded(6)
          .bg(canSave ? t.solid : t.raised).text_color(canSave ? t.solid_foreground : t.dim)
          .tooltip(canSave ? "Save changes" : "No unsaved changes")
          .when(canSave, (button) => button.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => this.saveFile(cx)))
          .child(this.saving ? "Saving…" : "Save"))));
  }
  diffCell(line, t) {
    const changed = line?.kind === "removed" || line?.kind === "added";
    const color = line?.kind === "removed" ? t.ansi1 : line?.kind === "added" ? t.ansi2 : t.foreground;
    return h_flex().h(22).flex_1().min_w(0).gap(5).px(4).items_center().bg(changed ? t.raised : t.background).text_color(color)
      .child(div().w(34).flex_none().text_right().text_size(10).text_color(t.dim).child(line ? String(line.number) : ""))
      .child(div().flex_1().min_w(0).truncate().text_size(11).child(line?.text ?? ""));
  }
  renderHunk(hunk, index, t) {
    const stageLabel = this.stageBusy === index ? "Staging…" : "Stage hunk";
    const stageButton = div().id(`explorer-stage-hunk-${index}`).px(9).py(4).rounded(5)
      .bg(this.stageBusy === null ? t.solid : t.raised).text_color(this.stageBusy === null ? t.solid_foreground : t.dim)
      .when(this.stageBusy === null, (button) => button.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => this.stageSelectedHunk(index, cx)))
      .child(stageLabel);
    return v_flex().id(`explorer-hunk-${index}`).flex_none().min_w(0).mb(8).rounded(6).overflow_hidden().border_1().border_color(t.border)
      .child(h_flex().h(34).flex_none().px(8).gap(8).items_center().bg(t.raised)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(hunk.header))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(`−${hunk.removed}  +${hunk.added}`))
        .when(this.diff.stageable, (el) => el.child(stageButton)))
      .children(hunk.rows.map((row, rowIndex) => h_flex().id(`explorer-hunk-row-${index}-${rowIndex}`).h(22).flex_none().gap(1)
        .child(this.diffCell(row.left, t)).child(this.diffCell(row.right, t))));
  }
  renderDiff(cx) {
    const t = theme(), conflict = this.diff?.comparison === "unmerged";
    const leftTitle = this.diff?.comparison === "head-index" ? "HEAD" : this.diff?.comparison === "empty-worktree" ? "Empty" : "Index";
    const rightTitle = this.diff?.comparison === "head-index" ? "Index" : "Working tree";
    const action = (id, label, fn, disabled = false) => div().id(id).px(10).py(5).rounded(5)
      .bg(disabled ? t.raised : t.solid).text_color(disabled ? t.dim : t.solid_foreground)
      .when(!disabled, (button) => button.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => fn(cx)))
      .child(label);
    const stageFile = action("explorer-stage-file", this.stageBusy === "file" ? "Staging…" : "Stage file", (cx) => this.stageDiffFile(cx), !this.diff?.stageable || this.stageBusy !== null);
    const comparison = this.diff?.comparison === "head-index" ? "Staged changes" : this.diff?.comparison === "empty-worktree" ? "Untracked file" : "Unstaged changes";
    const footer = this.note || (this.diff?.stageable ? "Stage hunks individually; unstaged content stays in the working tree." : "Read-only diff · no unstaged changes to stage.");
    return v_flex().id("explorer-diff").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.label || "Diff"))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(comparison))
        .child(div().id("explorer-diff-refresh").px(5).rounded(4).text_color(t.muted)
          .when(!this.loading && this.stageBusy === null, (button) => button.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.loadDiff(cx)))
          .tooltip("Refresh diff").child(this.loading ? "…" : "↻")))
      .when(this.loading, (el) => el.child(div().flex_1().p(12).text_color(t.dim).child("Loading diff…")))
      .when(Boolean(this.error), (el) => el.child(div().flex_1().p(12).text_color(t.ansi1).child(this.error)))
      .when(!this.loading && !this.error && conflict, (el) => el.child(v_flex().flex_1().p(12).gap(8)
        .child(div().text_color(t.ansi1).child("This file has unresolved conflicts. Resolve them before staging."))
        .child(action("explorer-open-conflict-file", "Open file editor", () => this.openDiffFile()))))
      .when(!this.loading && !this.error && Boolean(this.diff?.binary), (el) => el.child(v_flex().flex_1().p(12).gap(8)
        .child(div().text_color(t.dim).child("Binary file; line-by-line diff is unavailable."))
        .when(this.diff.stageable, (body) => body.child(stageFile))))
      .when(!this.loading && !this.error && Boolean(this.diff && !conflict && !this.diff.binary && this.diff.hunks.length === 0), (el) => el.child(v_flex().flex_1().p(12).gap(8)
        .child(div().text_color(t.dim).child("No text hunks to display (for example, an empty file or file-mode change)."))
        .when(this.diff.stageable, (body) => body.child(stageFile))))
      .when(!this.loading && !this.error && Boolean(this.diff?.hunks.length), (el) => el.child(v_flex().id("explorer-diff-hunks").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .child(h_flex().h(24).flex_none().gap(1).text_size(10.5).text_color(t.dim)
          .child(div().flex_1().min_w(0).pl(40).child(leftTitle)).child(div().flex_1().min_w(0).pl(40).child(rightTitle)))
        .children(this.diff.hunks.map((hunk, index) => this.renderHunk(hunk, index, t)))))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(this.note.startsWith("Could not") ? t.ansi1 : t.dim).child(footer)));
  }
  render(cx) {
    if (this.mode === "diff") { this.rememberLocation(); return this.renderDiff(cx); }
    if (this.mode === "file") { this.rememberLocation(); return this.renderFile(); }
    if (!checking() && this.visible()) {
      const key = JSON.stringify(location());
      if (key !== this.context || (!this.loading && !this.busy && Date.now() - this.last >= 15000)) this.refresh(cx);
    }
    const t = theme(), entries = this.rows("", 0, [], t);
    const filterButton = (label, changedOnly) => div().px(7).py(3).rounded(5).text_size(10.5)
      .bg(this.changedOnly === changedOnly ? t.selected : t.raised).text_color(this.changedOnly === changedOnly ? t.foreground : t.muted)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { this.changedOnly = changedOnly; cx.notify(); }).child(label);
    return v_flex().id("git-explorer").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Explorer"))
      .child(h_flex().gap(2).p(2).rounded(6).bg(t.raised)
        .child(filterButton("All", false)).child(filterButton("Changed", true)))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(t.dim).child(basename(this.root ?? location().cwd)))
        .child(div().id("explorer-refresh").px(4).rounded(4).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Refresh files and Git status").on_click((_e, cx) => { this.last = 0; this.refresh(cx, true); }).child(this.loading ? "…" : "↻")))
      .when(Boolean(this.error), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.error)))
      .when(!this.error && this.loading && !this.root, (el) => el.child(div().p(10).text_color(t.dim).child("Loading repository files…")))
      .when(!this.error && !this.loading && !this.root && !this.checked, (el) => el.child(div().p(10).text_color(t.dim).child("Waiting for a repository check…")))
      .when(!this.error && !this.loading && !this.root && this.checked, (el) => el.child(div().p(10).text_color(t.dim).child("No Git repository in the focused folder.")))
      .when(Boolean(this.root), (el) => el.child(v_flex().id("explorer-tree").flex_1().min_h(0).overflow_y_scrollbar().p(5).children(entries)
        .when(entries.length === 0, (empty) => empty.child(div().p(8).text_size(12).text_color(t.dim).child(this.changedOnly ? "No changed files" : "No tracked or unignored files")))
        .when(Boolean(this.note), (note) => note.child(div().px(8).py(5).text_size(11).text_color(t.ansi1).child(this.note)))));
  }
}
