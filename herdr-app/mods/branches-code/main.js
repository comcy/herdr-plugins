// Branch picker for the focused pane's Git repository. Existing worktrees are opened;
// branches without a checkout switch the current tree, or create a worktree for .bare repos.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, layout, openOverlay, panes, props, run, spaces, theme } from "herdr";
import { checkoutBranch, cloneBareRepository, createWorktree, inspectRepository, scratchBranch } from "./git.js";

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map((child) => find(child, id)).find(Boolean);
const pathText = (path) => {
  const clean = String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return clean || (path ? "/" : "");
};
const base = (path) => pathText(path).split("/").pop() || path;
const parent = (path) => {
  const clean = pathText(path);
  if (/^[A-Za-z]:$/.test(clean)) return `${clean}/`;
  const slash = clean.lastIndexOf("/");
  return slash < 0 ? "." : slash === 0 ? "/" : slash === 2 && /^[A-Za-z]:/.test(clean) ? clean.slice(0, 3) : clean.slice(0, slash);
};
const inside = (path, dir) => path === dir || path.startsWith(`${dir}/`);
const targetKey = (target) => target?.kind === "local" ? `local:${target.branch}` : target?.kind === "remote" ? `remote:${target.remoteRef}` : target ? `new:${target.branch}` : "";
const targetLabel = (target) => target?.kind === "local" ? target.branch : target?.remoteRef?.replace(/^refs\/remotes\//, "") ?? target?.branch ?? "branch";


function openCheckout(path, on) {
  const wanted = pathText(path), machine = on ?? null, allPanes = panes();
  const space = spaces().find((s) => (s.machine ?? null) === machine && (() => {
    const tabs = new Set((s.tabs ?? []).map((tab) => tab.id));
    const current = allPanes.find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || s.folder;
    const at = pathText(current);
    return at && inside(at, wanted);
  })());
  if (space) run("space.select", { id: space.id });
  else run("space.new", { folder: path, machine: on ?? "" });
}

export default class Branches extends View {
  init(_props, cx) {
    this.mode = props()?.mode ?? "panel";
    if (this.mode === "actions") { this.actionBusy = false; this.actionError = ""; return; }
    if (this.mode === "worktree") { this.initWorktree(cx); return; }
    if (this.mode === "clone") { this.initClone(cx); return; }
    this.repo = null;
    this.error = "";
    this.notice = "";
    this.loading = false;
    this.busy = null;
    this.loc = "";
    this.last = 0;
    this.sequence = 0;
    if (this.visible()) this.load(cx);
    cx.timer.every(3000, (cx) => {
      if (!this.visible() || this.busy || this.loading) return;
      if (JSON.stringify(this.where()) !== this.loc || Date.now() - this.last >= 15000) this.load(cx);
    });
  }
  initClone(cx) {
    const p = props() ?? {};
    this.clone = { cwd: p.cwd, machine: p.machine ?? null, parent: null, loading: true, busy: false, error: "", url: "", name: "" };
    const d = this.clone;
    d.handle = cx.focus_handle();
    d.urlInput = InputState.new({ value: "", placeholder: "https://github.com/owner/repo.git" });
    d.nameInput = InputState.new({ value: "", placeholder: "auto from URL" });
    d.urlInput.on("change", (_e, cx) => { d.url = d.urlInput.value(); d.error = ""; cx.notify(); });
    d.urlInput.on("submit", (_e, cx) => this.cloneRepository(cx));
    d.nameInput.on("change", (_e, cx) => { d.name = d.nameInput.value(); d.error = ""; cx.notify(); });
    d.handle.focus();
    cx.spawn(async (cx) => {
      if (!d.cwd) d.error = "No focused folder.";
      else {
        try { const repo = await inspectRepository(d.cwd, d.machine, exec); d.parent = parent(repo.repoRoot); }
        catch { d.parent = pathText(d.cwd); }
      }
      d.loading = false;
      cx.notify();
    });
    cx.timer.after(100, () => d.urlInput.focus());
  }
  openClone(at = this.where()) {
    openOverlay({ mod: "branches-code", kind: "dialog", width: 520, height: 380, props: { mode: "clone", cwd: at.cwd, machine: at.on } });
  }
  cloneRepository(cx) {
    const d = this.clone;
    if (!d || d.loading || d.busy) return;
    if (!d.url.trim()) { d.error = "Enter a Git repository URL."; return cx.notify(); }
    if (!d.parent) { d.error = "Could not determine the clone destination folder."; return cx.notify(); }
    d.busy = true;
    d.error = "";
    const overlay = props()?.overlay;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await cloneBareRepository(d.parent, d.url, d.name, d.machine, exec);
        openCheckout(result.path, d.machine);
        d.busy = false;
        closeOverlay(overlay);
      } catch (e) {
        d.error = String(e?.message ?? e);
        d.busy = false;
        cx.notify();
      }
    });
  }
  initWorktree(cx) {
    const p = props() ?? {};
    this.dialog = { cwd: p.cwd, machine: p.machine ?? null, repo: null, loading: true, busy: false, error: "", selected: p.target ?? null, newBranch: "" };
    this.dialog.handle = cx.focus_handle();
    this.dialog.input = InputState.new({ value: "", placeholder: "feature/my-branch" });
    this.dialog.input.on("change", (_e, cx) => { this.dialog.newBranch = this.dialog.input.value(); this.dialog.error = ""; cx.notify(); });
    this.dialog.input.on("submit", (_e, cx) => this.createNewWorktree(cx));
    this.dialog.handle.focus();
    cx.spawn(async (cx) => {
      try { this.dialog.repo = await inspectRepository(this.dialog.cwd, this.dialog.machine, exec); }
      catch (e) { this.dialog.error = String(e?.message ?? e); }
      this.dialog.loading = false;
      cx.notify();
    });
    cx.timer.after(100, () => this.dialog?.input.focus());
  }
  openWorktree(target = null, at = this.where()) {
    openOverlay({ mod: "branches-code", kind: "dialog", width: 520, height: 560, props: { mode: "worktree", cwd: at.cwd, machine: at.on, target } });
  }
  openActions(target) {
    const at = this.where();
    openOverlay({ mod: "branches-code", kind: "popup", width: 250, height: 112, props: { mode: "actions", cwd: at.cwd, machine: at.on, target } });
  }
  actionCheckout(cx) {
    if (this.actionBusy) return;
    const p = props() ?? {};
    this.actionBusy = true;
    this.actionError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const repo = await inspectRepository(p.cwd, p.machine, exec);
        const result = await checkoutBranch(repo, p.target, p.machine, exec);
        if (result.open) openCheckout(result.path, p.machine);
        this.actionBusy = false;
        closeOverlay(p.overlay);
      } catch (e) {
        this.actionError = String(e?.message ?? e);
        this.actionBusy = false;
        cx.notify();
      }
    });
  }
  actionWorktree() {
    const p = props() ?? {};
    closeOverlay(p.overlay);
    this.openWorktree(p.target, { cwd: p.cwd, on: p.machine });
  }
  createWorktreeTarget(target, cx) {
    const d = this.dialog;
    if (!d?.repo || d.busy || !target) return;
    d.busy = true;
    d.error = "";
    const overlay = props()?.overlay;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await createWorktree(d.repo, target, d.machine, exec);
        openCheckout(result.path, d.machine);
        d.busy = false;
        closeOverlay(overlay);
      } catch (e) {
        d.error = String(e?.message ?? e);
        d.busy = false;
        cx.notify();
      }
    });
  }
  createNewWorktree(cx) {
    const branch = this.dialog.newBranch.trim();
    if (!branch) { this.dialog.error = "Type a branch name."; return cx.notify(); }
    this.createWorktreeTarget({ kind: "new", branch }, cx);
  }
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return Boolean(panel && !panel.hidden && body?.active === "branches");
  }
  where() {
    const space = spaces().find((item) => item.active);
    return { cwd: panes().find((pane) => pane.focused)?.cwd ?? space?.folder, on: space?.machine ?? null };
  }
  load(cx) {
    if (!this.visible() || this.loading || this.busy) return;
    const at = this.where(), key = JSON.stringify(at), sequence = ++this.sequence;
    this.loc = key;
    this.last = Date.now();
    this.loading = true;
    this.repo = null;
    this.error = "";
    cx.spawn(async (cx) => {
      try {
        const repo = await inspectRepository(at.cwd, at.on, exec);
        if (sequence !== this.sequence) return;
        this.repo = repo;
      } catch (e) {
        if (sequence !== this.sequence) return;
        this.error = String(e?.message ?? e);
      }
      if (sequence === this.sequence) {
        this.loading = false;
        cx.notify();
      }
    });
  }
  checkout(target, cx) {
    if (this.busy || !this.repo) return;
    const repo = this.repo, at = this.where();
    const key = target.kind === "local" ? `local:${target.branch}` : `remote:${target.remoteRef}`;
    this.busy = key;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      let succeeded = false;
      try {
        const result = await checkoutBranch(repo, target, at.on, exec);
        if (result.open) openCheckout(result.path, at.on);
        succeeded = true;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.busy = null;
      if (succeeded) { this.last = 0; this.load(cx); }
      cx.notify();
    });
  }
  scratch(cx) {
    if (this.busy || !this.repo?.top || this.repo.isBare) return;
    const repo = this.repo, at = this.where();
    this.busy = "scratch";
    this.error = "";
    this.notice = "";
    cx.notify();
    cx.spawn(async (cx) => {
      let branch = "";
      try { branch = await scratchBranch(repo, at.on, exec); }
      catch (e) { this.error = String(e?.message ?? e); }
      this.busy = null;
      if (branch) { this.notice = `Changes moved to ${branch}.`; this.last = 0; this.load(cx); }
      cx.notify();
    });
  }
  branchRow(target, t) {
    const repo = this.repo;
    const checkedOut = repo.worktrees.find((worktree) => worktree.branch === target.branch);
    const here = Boolean(checkedOut && repo.top && pathText(checkedOut.path) === pathText(repo.top));
    const localExists = repo.branches.local.some((branch) => branch.branch === target.branch);
    const label = target.kind === "local" ? target.branch : target.remoteRef.replace(/^refs\/remotes\//, "");
    const tail = checkedOut ? (here ? "here" : base(checkedOut.path)) : target.kind === "remote" ? (localExists ? `local ${target.branch}` : `track ${target.branch}`) : "";
    const tip = checkedOut
      ? `${label}\nAlready checked out at ${checkedOut.path}\nClick to open that worktree.`
      : target.kind === "remote"
        ? `${label}\n${localExists ? `Uses local branch ${target.branch}.` : `Creates local tracking branch ${target.branch}.`}${repo.worktreeMode ? " Opens a new worktree." : " Switches this checkout."}`
        : `${label}\n${repo.worktreeMode ? "Creates and opens a worktree." : "Switches this checkout."}`;
    const details = `${tip}\nRight-click for checkout and worktree actions.`;
    const key = targetKey(target);
    return h_flex().id(`branch-${encodeURIComponent(key)}`).h(30).flex_none().items_center().gap(8).px(10).rounded(6)
      .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.checkout(target, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openActions(target); }))
      .tooltip(details)
      .child(div().w(14).flex_none().text_color(here ? t.ansi2 : target.kind === "remote" ? t.ansi4 : t.dim).child(here ? "●" : target.kind === "remote" ? "⇣" : checkedOut ? "↗" : "○"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(label))
      .child(div().flex_none().truncate().max_w(100).text_size(11).text_color(t.dim).child(this.busy === key ? "Checking out…" : tail));
  }
  section(id, title, rows, t) {
    return v_flex().id(`branches-${id}`).flex_none().gap(2)
      .child(div().px(10).pt(8).pb(3).text_size(11).text_color(t.dim).child(`${title} (${rows.length})`))
      .when(rows.length === 0, (el) => el.child(div().px(10).py(4).text_size(11.5).text_color(t.dim).child(`No ${title.toLowerCase()} branches.`)))
      .children(rows.map((target) => this.branchRow(target, t)));
  }
  worktreeBranchRow(target, t) {
    const d = this.dialog, repo = d.repo;
    const occupied = repo.worktrees.find((worktree) => worktree.branch === target.branch);
    const selected = targetKey(d.selected) === targetKey(target), label = targetLabel(target);
    return h_flex().id(`branch-worktree-${encodeURIComponent(targetKey(target))}`).h(28).flex_none().items_center().gap(8).px(10).rounded(6)
      .when(selected, (el) => el.bg(t.selected))
      .when(!occupied && !d.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { d.selected = target; d.error = ""; cx.notify(); }))
      .tooltip(occupied ? `${label}\nAlready checked out at ${occupied.path}` : `Create a worktree for ${label}`)
      .child(div().w(14).flex_none().text_color(occupied ? t.dim : target.kind === "remote" ? t.ansi4 : t.muted).child(occupied ? "↗" : target.kind === "remote" ? "⇣" : "○"))
      .child(div().flex_1().min_w(0).truncate().text_color(occupied ? t.dim : t.foreground).child(label))
      .child(div().flex_none().truncate().max_w(100).text_size(11).text_color(t.dim).child(occupied ? `in ${base(occupied.path)}` : target.kind));
  }
  worktreeSection(id, title, rows, t) {
    return v_flex().id(`branch-worktree-${id}`).flex_none().gap(2)
      .child(div().px(10).pt(7).pb(2).text_size(11).text_color(t.dim).child(`${title} (${rows.length})`))
      .when(rows.length === 0, (el) => el.child(div().px(10).py(3).text_size(11.5).text_color(t.dim).child(`No ${title.toLowerCase()} branches.`)))
      .children(rows.map((target) => this.worktreeBranchRow(target, t)));
  }
  renderActions() {
    const p = props() ?? {}, t = theme();
    const item = (id, label, action) => h_flex().id(id).h(30).px(9).items_center().rounded(6).text_color(t.foreground)
      .when(!this.actionBusy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => action(cx)))
      .when(this.actionBusy, (el) => el.text_color(t.dim)).child(label);
    return v_flex().id("branch-actions").w_full().p(7).gap(3).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(div().px(8).py(4).truncate().text_size(11).text_color(t.dim).child(targetLabel(p.target)))
      .child(item("branch-action-checkout", this.actionBusy ? "Checking out…" : "Checkout / open", (cx) => this.actionCheckout(cx)))
      .child(item("branch-action-worktree", "Create worktree…", () => this.actionWorktree()))
      .when(Boolean(this.actionError), (el) => el.child(div().px(8).py(4).text_color(t.ansi1).child(this.actionError)));
  }
  renderWorktree() {
    const d = this.dialog, t = theme(), repo = d.repo;
    const local = repo?.branches.local ?? [], remote = repo?.branches.remote ?? [];
    const selectedOccupied = Boolean(repo && d.selected && repo.worktrees.some((worktree) => worktree.branch === d.selected.branch));
    const canCreate = Boolean(repo && d.selected && !selectedOccupied && !d.busy && !d.loading);
    const canNew = Boolean(repo && d.newBranch.trim() && !d.busy && !d.loading);
    const label = (text) => div().pt(2).pb(1).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, disabled, action) => h_flex().id(id).h(32).px(11).items_center().justify_center().rounded(8).border_1()
      .border_color(disabled ? t.border : primary ? t.solid : t.input).bg(disabled ? t.background : primary ? t.solid : t.raised)
      .text_color(disabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx))).child(text);
    const list = v_flex().id("branch-worktree-choices").flex_1().min_h(0).gap(3).overflow_y_scrollbar()
      .when(d.loading, (el) => el.child(div().p(10).text_color(t.dim).child("Loading branches…")))
      .when(!d.loading && !repo && !d.error, (el) => el.child(div().p(10).text_color(t.dim).child("No Git repository in the focused pane.")))
      .when(Boolean(repo), (el) => el.children([this.worktreeSection("local", "LOCAL", local, t), this.worktreeSection("remote", "REMOTE", remote, t)]));
    return v_flex().id("branches-worktree-dialog").track_focus(d.handle).size_full().p(16).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props()?.overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child("Create worktree")).child(div().text_size(11).text_color(t.dim).child("Esc closes")))
      .child(div().text_size(11.5).text_color(t.muted).child(repo ? `${repo.name} · new branches start at ${repo.currentBranch ?? "HEAD"}` : "Choose an existing branch or create one from HEAD."))
      .child(label("Existing branches — already checked out branches cannot be duplicated"))
      .child(list)
      .child(label("Or create a new branch from current HEAD"))
      .child(Input.new(d.input).h(32).px(10).items_center().rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
      .when(Boolean(d.error), (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(d.error)))
      .child(h_flex().justify_end().gap(7)
        .child(button("branch-worktree-cancel", "Cancel", false, d.busy, () => closeOverlay(props()?.overlay)))
        .child(button("branch-worktree-new", "Create new branch", false, !canNew, (cx) => this.createNewWorktree(cx)))
        .child(button("branch-worktree-create", d.busy ? "Creating…" : "Create worktree", true, !canCreate, (cx) => this.createWorktreeTarget(d.selected, cx))));
  }
  renderClone() {
    const d = this.clone, t = theme();
    const label = (text) => div().pt(3).pb(2).text_size(11.5).text_color(t.dim).child(text);
    const input = (state) => Input.new(state).h(34).px(10).items_center().rounded(6).border_1().border_color(t.input).bg(t.background).text_color(t.foreground);
    const button = (id, text, disabled, action) => h_flex().id(id).h(32).px(13).items_center().justify_center().rounded(8).border_1()
      .border_color(disabled ? t.border : t.solid).bg(disabled ? t.background : t.solid).text_color(disabled ? t.dim : t.solid_foreground)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx))).child(text);
    return v_flex().id("branches-clone-dialog").track_focus(d.handle).size_full().p(16).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props()?.overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child("Clone repository")).child(div().text_size(11).text_color(t.dim).child("Esc closes")))
      .child(label("Git repository URL"))
      .child(input(d.urlInput))
      .child(label("Parent folder"))
      .child(div().h(28).px(10).items_center().rounded(6).bg(t.background).text_size(11.5).text_color(t.muted).truncate().child(d.parent ?? (d.loading ? "Finding folder…" : "Unavailable")))
      .child(label("Repository folder name (optional; inferred from URL)"))
      .child(input(d.nameInput))
      .child(div().text_size(11.5).text_color(t.muted).child("Creates <name>/.bare and opens its default branch as a worktree. Use SSH or a credential manager for private repositories."))
      .when(d.loading, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Finding clone folder…")))
      .when(Boolean(d.error), (el) => el.child(div().text_size(11.5).text_color(t.ansi1).child(d.error)))
      .child(h_flex().justify_end().gap(7)
        .child(button("branches-clone-cancel", "Cancel", d.busy, () => closeOverlay(props()?.overlay)))
        .child(button("branches-clone-submit", d.busy ? "Cloning…" : "Clone", d.loading || d.busy || !d.url.trim() || !d.parent, (cx) => this.cloneRepository(cx))));
  }
  render() {
    if (this.mode === "actions") return this.renderActions();
    if (this.mode === "worktree") return this.renderWorktree();
    if (this.mode === "clone") return this.renderClone();
    const t = theme(), repo = this.repo;
    const branchName = repo?.currentBranch ?? (repo?.isBare ? "bare repository" : "detached HEAD");
    const canScratch = Boolean(repo?.top && !repo.isBare && !this.busy);
    const local = repo?.branches.local ?? [], remote = repo?.branches.remote ?? [];
    const body = v_flex().id("branches-list").flex_1().min_h(0).overflow_y_scrollbar().gap(3).p(6)
      .when(Boolean(this.error), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.error)))
      .when(Boolean(this.notice), (el) => el.child(div().px(10).py(5).text_color(t.ansi2).child(this.notice)))
      .when(!this.error && this.loading && !repo, (el) => el.child(div().p(10).text_color(t.dim).child("Loading branches…")))
      .when(!this.error && !this.loading && !repo, (el) => el.child(div().p(10).text_color(t.dim).child("No Git repository in the focused pane.")))
      .when(Boolean(repo), (el) => el.children([this.section("local", "LOCAL", local, t), this.section("remote", "REMOTE", remote, t)]));
    return v_flex().id("branches-code").size_full().min_h(0).text_size(13).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .child(h_flex().gap(6).items_center().h(42).flex_none().px(10).border_b(1).border_color(t.border)
        .child(div().flex_none().text_color(t.foreground).child("git"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(repo ? `${repo.name} · ${branchName}` : this.where().cwd ?? ""))
        .child(div().id("branches-scratch").flex_none().px(5).rounded(4).text_size(11).text_color(canScratch ? t.muted : t.dim)
          .when(canScratch, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.scratch(cx)))
          .tooltip("Move staged, unstaged, and untracked changes to a new scratch branch")
          .child(this.busy === "scratch" ? "Saving…" : "Scratch"))
        .child(div().id("branches-clone").flex_none().px(5).rounded(4).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Clone repository into the current repo's parent folder").on_click(() => this.openClone()).child("↓"))
        .child(div().id("branches-worktree-create").flex_none().px(6).rounded(4).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Create worktree…").on_click(() => this.openWorktree()).child("+"))
        .child(div().id("branches-refresh").flex_none().px(4).rounded(4).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Refresh branches").on_click((_e, cx) => { this.last = 0; this.load(cx); }).child(this.loading ? "…" : "↻")))
      .child(body);
  }
}
