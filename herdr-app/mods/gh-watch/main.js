// GitHub watch: open PRs and Actions runs of the focused pane's repo, refreshed every 5 s.
// Tab or ←/→ switches PRs/Runs, click opens the item in the browser, Esc closes. Needs `gh` (logged in).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, theme, props, closeOverlay } from "herdr";

const PR = ["pr", "list", "--limit", "15", "--json", "number,title,author,isDraft,reviewDecision,statusCheckRollup,url"];
const RUN = ["run", "list", "--limit", "10", "--json", "databaseId,workflowName,displayTitle,headBranch,status,conclusion,url"];
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default class GhWatch extends View {
  init(_p, cx) {
    this.tab = "prs"; this.data = { prs: null, runs: null }; this.error = null;
    this.handle = cx.focus_handle(); this.handle.focus();
    const sp = spaces().find((s) => s.active);
    this.at = { cwd: panes().find((p) => p.focused)?.cwd ?? sp?.folder, on: sp?.machine };
    this.load(cx);
    cx.timer.every(5000, (cx) => this.load(cx));
  }
  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const [prs, runs] = await Promise.all([PR, RUN].map((a) => exec("gh", a, this.at)));
        for (const [k, r] of [["prs", prs], ["runs", runs]]) {
          if (r.code !== 0) throw new Error(r.stderr.trim() || "gh failed");
          this.data[k] = JSON.parse(r.stdout);
        }
        this.error = null;
      } catch (e) { this.error = String(e.message ?? e); }
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
  row(id, url, mark, title, tail, t) {
    return h_flex().id(id).gap(8).px(10).h(28).flex_none().items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.open_url(url))
      .child(mark).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(tail));
  }
  prRow(p, t) {
    // statusCheckRollup mixes check runs (status/conclusion) and statuses (state).
    const checks = (p.statusCheckRollup ?? []).map((c) => c.status ? [c.status, c.conclusion] : [c.state === "PENDING" || c.state === "EXPECTED" ? "IN_PROGRESS" : "COMPLETED", c.state]);
    const bad = checks.some(([s, c]) => s === "COMPLETED" && ["FAILURE", "TIMED_OUT", "ERROR", "CANCELLED"].includes((c ?? "").toUpperCase()));
    const running = checks.some(([s]) => s !== "COMPLETED");
    const mark = this.mark(bad ? "completed" : running ? "in_progress" : checks.length ? "completed" : "", bad ? "failure" : "success", t);
    const review = p.reviewDecision === "APPROVED" ? "approved · " : p.reviewDecision === "CHANGES_REQUESTED" ? "changes · " : "";
    return this.row(`pr-${p.number}`, p.url, mark, `#${p.number}  ${p.title}${p.isDraft ? "  [draft]" : ""}`, `${review}${p.author?.login ?? ""}`, t);
  }
  runRow(r, t) {
    return this.row(`run-${r.databaseId}`, r.url, this.mark(r.status, r.conclusion, t), `${r.workflowName}  ${r.displayTitle}`, r.headBranch, t);
  }
  render() {
    const t = theme(), rows = this.data[this.tab];
    const tab = (id, label) => div().id(`tab-${id}`).px(10).py(4).rounded(6).cursor_pointer()
      .text_color(this.tab === id ? t.foreground : t.muted).when(this.tab === id, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.tab = id; cx.notify(); }).child(label);
    return v_flex().id("gh-watch").size_full().min_h(0).bg(t.popover).p(8).gap(6).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "tab" || e.key === "left" || e.key === "right") { this.tab = this.tab === "prs" ? "runs" : "prs"; cx.notify(); }
      })
      .child(h_flex().gap(6).items_center().child(tab("prs", `Pull requests${this.data.prs ? ` (${this.data.prs.length})` : ""}`)).child(tab("runs", "Actions runs"))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.dim).child("click opens · Tab switches · Esc closes")))
      .child(v_flex().id("gh-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(2)
        .when(Boolean(this.error), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.error)))
        .when(!this.error && !rows, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
        .when(!this.error && rows?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("nothing here")))
        .when(!this.error && Boolean(rows), (el) => el.children((rows ?? []).map((x) => (this.tab === "prs" ? this.prRow(x, t) : this.runRow(x, t))))));
  }
}
