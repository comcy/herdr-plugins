// GitHub watch: open PRs, Actions runs and issues of the focused pane's repo. Needs `gh` (logged in).
// Two modes, same file: dialog (`mod.open:gh-watch`, refresh 5 s, Tab or ←/→ switches, Esc closes)
// and right panel (block `gh` in layout main-code, refresh 15 s, only while shown).
// Click opens the item in the browser.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, theme, props, closeOverlay, layout } from "herdr";

const PR = ["pr", "list", "--limit", "15", "--json", "number,title,author,isDraft,reviewDecision,statusCheckRollup,url,body,headRefName,baseRefName,mergeable,additions,deletions,changedFiles"];
const RUN = ["run", "list", "--limit", "10", "--json", "databaseId,workflowName,displayTitle,headBranch,status,conclusion,url,event,createdAt,updatedAt,attempt"];
const ISSUE = ["issue", "list", "--limit", "15", "--json", "number,title,author,labels,url,body,assignees,createdAt"];
const TABS = [["prs", "PRs"], ["runs", "Runs"], ["issues", "Issues"]];
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const clip = (b) => (b?.trim() ? "\n\n" + (b.trim().length > 500 ? b.trim().slice(0, 500) + "…" : b.trim()) : "");
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default class GhWatch extends View {
  init(_p, cx) {
    this.panel = !props()?.overlay;
    this.tab = "prs"; this.data = { prs: null, runs: null, issues: null }; this.errors = {}; this.last = 0;
    this.every = this.panel ? 15000 : 5000;
    if (!this.panel) {
      this.handle = cx.focus_handle(); this.handle.focus();
      this.at = this.where();   // dialog: the repo that was focused when it opened
    }
    this.load(cx);
    cx.timer.every(3000, (cx) => {
      if (this.panel && !this.visible()) return;
      // Panel: reload at once when the focused pane / space moved to another folder.
      const moved = this.panel && JSON.stringify(this.where()) !== this.loc;
      if (!moved && Date.now() - this.last < this.every) return;
      this.load(cx);
    });
  }
  // Panel: only poll while the `gh` child of the right panel is the shown one (hidden mods keep their timers).
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return Boolean(panel && !panel.hidden && body?.active === "gh");
  }
  where() {
    const sp = spaces().find((s) => s.active);
    return { cwd: panes().find((p) => p.focused)?.cwd ?? sp?.folder, on: sp?.machine };
  }
  load(cx) {
    this.last = Date.now();
    const at = this.panel ? this.where() : this.at;   // panel follows focus / space switches
    this.loc = JSON.stringify(at);
    cx.spawn(async (cx) => {
      // Each list fails on its own (e.g. issues disabled on the repo) and only shows on its tab.
      await Promise.all([["prs", PR], ["runs", RUN], ["issues", ISSUE]].map(async ([k, a]) => {
        try {
          const r = await exec("gh", a, at);
          if (r.code !== 0) throw new Error(r.stderr.trim() || "gh failed");
          this.data[k] = JSON.parse(r.stdout); this.errors[k] = null;
        } catch (e) { this.errors[k] = String(e.message ?? e); }
      }));
      cx.notify();
    });
  }
  // One status mark: spinner while running, ✓ / ✗ / ⊘ / ◌ otherwise.
  mark(status, conclusion, t) {
    const s = (status ?? "").toLowerCase(), c = (conclusion ?? "").toLowerCase();
    if (s === "in_progress" || s === "inprogress" || s === "pending") return div().w(14).text_color(t.ansi3).frames(SPIN, 90);
    if (s === "completed") {
      if (c === "success") return div().w(14).text_color(t.ansi2).child("✓");
      if (c === "failure" || c === "timed_out" || c === "error" || c === "startup_failure") return div().w(14).text_color(t.ansi1).child("✗");
      return div().w(14).text_color(t.dim).child("⊘");
    }
    return div().w(14).text_color(t.dim).child("◌");
  }
  row(id, url, mark, title, tail, t, tip) {
    return h_flex().id(id).when(Boolean(tip), (el) => el.tooltip(tip)).gap(8).px(10).h(28).flex_none().items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.open_url(url))
      .child(mark).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(tail));
  }
  prTip(p, checks) {
    const lines = [`#${p.number} ${p.title}`, `${p.headRefName} → ${p.baseRefName} · ${p.author?.login ?? ""}`,
      `+${p.additions} −${p.deletions} · ${p.changedFiles} files · merge: ${(p.mergeable ?? "").toLowerCase()}${p.reviewDecision ? " · " + p.reviewDecision.toLowerCase() : ""}`];
    if (checks.length) lines.push("", ...checks.map((c) => `${c.status === "COMPLETED" ? ((c.conclusion ?? "").toUpperCase() === "SUCCESS" ? "✓" : "✗") : "…"} ${c.name ?? c.context}${c.status === "COMPLETED" && c.conclusion && c.conclusion !== "SUCCESS" ? " (" + c.conclusion.toLowerCase() + ")" : ""}`));
    return lines.join("\n") + clip(p.body);
  }
  prRow(p, t) {
    // statusCheckRollup mixes check runs (status/conclusion) and statuses (state).
    const checks = (p.statusCheckRollup ?? []).map((c) => c.status ? [c.status, c.conclusion] : [c.state === "PENDING" || c.state === "EXPECTED" ? "IN_PROGRESS" : "COMPLETED", c.state]);
    const bad = checks.some(([s, c]) => s === "COMPLETED" && ["FAILURE", "TIMED_OUT", "ERROR", "CANCELLED"].includes((c ?? "").toUpperCase()));
    const running = checks.some(([s]) => s !== "COMPLETED");
    const mark = this.mark(bad ? "completed" : running ? "in_progress" : checks.length ? "completed" : "", bad ? "failure" : "success", t);
    const review = p.reviewDecision === "APPROVED" ? "approved · " : p.reviewDecision === "CHANGES_REQUESTED" ? "changes · " : "";
    return this.row(`pr-${p.number}`, p.url, mark, `#${p.number}  ${p.title}${p.isDraft ? "  [draft]" : ""}`, `${review}${p.author?.login ?? ""}`, t, this.prTip(p, p.statusCheckRollup ?? []));
  }
  runRow(r, t) {
    return this.row(`run-${r.databaseId}`, r.url, this.mark(r.status, r.conclusion, t), `${r.workflowName}  ${r.displayTitle}`, r.headBranch, t,
      `${r.workflowName}\n${r.displayTitle}\n${r.headBranch} · ${r.event} · attempt ${r.attempt ?? 1}\n${r.status}${r.conclusion ? " / " + r.conclusion : ""} · updated ${r.updatedAt}`);
  }
  issueRow(i, t) {
    const labels = (i.labels ?? []).map((l) => l.name).join(", ");
    return this.row(`issue-${i.number}`, i.url, div().w(14).text_color(t.ansi2).child("○"), `#${i.number}  ${i.title}`, labels || (i.author?.login ?? ""), t,
      `#${i.number} ${i.title}\n${i.author?.login ?? ""} · ${i.createdAt?.slice(0, 10)}${(i.assignees ?? []).length ? " · → " + i.assignees.map((a) => a.login).join(", ") : ""}${labels ? "\n[" + labels + "]" : ""}${clip(i.body)}`);
  }
  render() {
    const t = theme(), rows = this.data[this.tab], error = this.errors[this.tab];
    const rowFor = (x) => (this.tab === "prs" ? this.prRow(x, t) : this.tab === "runs" ? this.runRow(x, t) : this.issueRow(x, t));
    const tab = ([id, label]) => div().id(`tab-${id}`).px(10).py(4).rounded(6).cursor_pointer()
      .text_color(this.tab === id ? t.foreground : t.muted).when(this.tab === id, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.tab = id; cx.notify(); })
      .child(`${label}${this.data[id] && id !== "runs" ? ` (${this.data[id].length})` : ""}`);
    const root = v_flex().id("gh-watch").size_full().min_h(0).bg(this.panel ? t.chrome : t.popover).p(8).gap(6).text_size(13)
      .child(h_flex().gap(6).items_center().children(TABS.map(tab))
        .when(!this.panel, (el) => el.child(div().flex_1()).child(div().text_size(11).text_color(t.dim).child("click opens · Tab switches · Esc closes"))))
      .child(v_flex().id("gh-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(2)
        .when(Boolean(error), (el) => el.child(div().p(10).text_color(t.ansi1).child(error)))
        .when(!error && !rows, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
        .when(!error && rows?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("nothing here")))
        .when(!error && Boolean(rows), (el) => el.children((rows ?? []).map(rowFor))));
    if (this.panel) return root;
    const ids = TABS.map(([id]) => id);
    return root.track_focus(this.handle).on_key_down((e, cx) => {
      if (e.key === "escape") closeOverlay(props().overlay);
      else if (e.key === "tab" || e.key === "right") { this.tab = ids[(ids.indexOf(this.tab) + 1) % ids.length]; cx.notify(); }
      else if (e.key === "left") { this.tab = ids[(ids.indexOf(this.tab) + ids.length - 1) % ids.length]; cx.notify(); }
    });
  }
}
