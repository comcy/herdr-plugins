// Azure DevOps watch: pipeline runs and active PRs for the focused pane's repository.
// Uses the Azure DevOps CLI extension; polls every 15 s, only while this panel is shown.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, theme, layout } from "herdr";

const RUNS = ["pipelines", "runs", "list", "--top", "6", "-o", "json"];
const PRS = ["repos", "pr", "list", "--status", "active", "--top", "15", "-o", "json"];
const TABS = [["runs", "Pipelines"], ["prs", "PRs"]];
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const branch = (s) => (s ?? "").replace(/^refs\/heads\//, "");
const errText = (e) => String(e?.message ?? e);

function runUrl(r) {
  const web = r?._links?.web?.href;
  if (web) return web;
  const match = (r?.url ?? "").match(/^(.*)\/_apis\/build\/builds\/[^/?]+/);
  return match ? `${match[1]}/_build/results?buildId=${encodeURIComponent(r.id)}&view=results` : null;
}
function prUrl(p) {
  const web = p?.repository?.webUrl;
  if (web && p.pullRequestId != null) return `${web.replace(/\/$/, "")}/pullrequest/${p.pullRequestId}`;
  return p?.url ?? null;
}
function policyName(p) {
  return p?.configuration?.settings?.displayName ?? p?.configuration?.type?.displayName ?? p?.type?.displayName ?? "Policy";
}
function policyStatus(p) {
  return String(p?.status ?? "unknown").toLowerCase();
}

export default class AdoWatch extends View {
  init(_p, cx) {
    this.tab = "runs";
    this.data = { runs: null, prs: null };
    this.errors = {};
    this.last = 0;
    this.loc = null;
    if (this.visible()) this.load(cx);
    cx.timer.every(3000, (cx) => {
      if (!this.visible()) return;
      if (JSON.stringify(this.where()) !== this.loc || Date.now() - this.last >= 15000) this.load(cx);
    });
  }
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return Boolean(panel && !panel.hidden && body?.active === "ado");
  }
  where() {
    const sp = spaces().find((s) => s.active);
    return { cwd: panes().find((p) => p.focused)?.cwd ?? sp?.folder, on: sp?.machine };
  }
  load(cx) {
    this.last = Date.now();
    const at = this.where();
    this.loc = JSON.stringify(at);
    cx.spawn(async (cx) => {
      await Promise.all([this.loadRuns(at), this.loadPrs(at)]);
      cx.notify();
    });
  }
  async result(args, at) {
    const r = await exec("az", args, at);
    if (r.code !== 0) throw new Error(r.stderr?.trim() || "az failed");
    const value = JSON.parse(r.stdout);
    if (!Array.isArray(value)) throw new Error("az returned an unexpected list");
    return value;
  }
  async loadRuns(at) {
    try {
      const runs = await this.result(RUNS, at);
      await Promise.all(runs.filter((r) => ["inprogress", "cancelling"].includes(String(r.status).toLowerCase()) && r.id != null && r.project?.name)
        .map(async (r) => {
          try {
            const timeline = await exec("az", ["devops", "invoke", "--area", "build", "--resource", "timeline", "--api-version", "7.1", "--route-parameters", `project=${r.project.name}`, `buildId=${r.id}`, "-o", "json"], at);
            if (timeline.code === 0) r.timeline = JSON.parse(timeline.stdout);
          } catch { /* Pipeline status remains useful if timeline details are unavailable. */ }
        }));
      this.data.runs = runs;
      this.errors.runs = null;
    } catch (e) { this.errors.runs = errText(e); }
  }
  async loadPrs(at) {
    try {
      const prs = await this.result(PRS, at);
      await Promise.all(prs.map(async (p) => {
        try {
          p.policies = await this.result(["repos", "pr", "policy", "list", "--id", String(p.pullRequestId), "-o", "json"], at);
        } catch (e) { p.policyError = errText(e); }
      }));
      this.data.prs = prs;
      this.errors.prs = null;
    } catch (e) { this.errors.prs = errText(e); }
  }
  mark(status, result, t) {
    const s = String(status ?? "").toLowerCase(), r = String(result ?? "").toLowerCase();
    if (s === "inprogress" || s === "cancelling" || s === "queued" || s === "running") return div().w(14).text_color(t.ansi3).frames(SPIN, 90);
    if (s === "completed") {
      if (r === "succeeded" || r === "success") return div().w(14).text_color(t.ansi2).child("✓");
      if (r === "partiallysucceeded") return div().w(14).text_color(t.ansi3).child("✓");
      if (r === "failed" || r === "broken") return div().w(14).text_color(t.ansi1).child("✗");
      return div().w(14).text_color(t.dim).child("⊘");
    }
    return div().w(14).text_color(t.dim).child("◌");
  }
  row(id, url, mark, title, tail, t, tip) {
    return h_flex().id(id).when(Boolean(tip), (el) => el.tooltip(tip)).gap(8).px(10).h(28).flex_none().items_center().rounded(6)
      .when(Boolean(url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => cx.open_url(url)))
      .child(mark).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(title))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(tail));
  }
  timelineLines(run) {
    const records = run.timeline?.records ?? [];
    const byId = new Map(records.map((r) => [r.id, r]));
    return records.filter((r) => r.type === "Job").map((job) => {
      const parent = byId.get(job.parentId), stage = byId.get(parent?.parentId)?.name;
      const tasks = records.filter((r) => r.type === "Task" && r.parentId === job.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const current = tasks.find((r) => String(r.state).toLowerCase() === "inprogress");
      return `  ${String(job.state).toLowerCase() === "completed" ? (String(job.result).toLowerCase() === "succeeded" ? "✓" : "✗") : "…"} ${stage ? `${stage} / ` : ""}${job.name}${current ? `\n    › ${current.name} (${current.order ?? "?"}/${tasks.length})` : ""}`;
    });
  }
  runRow(r, t) {
    const name = r.definition?.name ?? r.pipeline?.name ?? "Pipeline";
    const number = r.buildNumber ?? r.name ?? `#${r.id}`;
    const status = `${r.status ?? "unknown"}${r.result ? ` / ${r.result}` : ""}`;
    const lines = [`${name}  #${number}`, `${branch(r.sourceBranch)} · ${status}`, `queued ${r.queueTime ?? "unknown"}`];
    const jobs = this.timelineLines(r);
    if (jobs.length) lines.push("", ...jobs);
    return this.row(`ado-run-${r.id}`, runUrl(r), this.mark(r.status, r.result, t), `${name}  #${number}`, branch(r.sourceBranch), t, lines.join("\n"));
  }
  prMark(p, t) {
    const policies = p.policies ?? [];
    const states = policies.map(policyStatus);
    const votes = (p.reviewers ?? []).map((r) => Number(r.vote ?? 0));
    if (states.some((s) => ["rejected", "broken", "failed"].includes(s)) || votes.some((v) => v <= -10)) return this.mark("completed", "failed", t);
    if (states.some((s) => s === "running" || s === "queued") || votes.some((v) => v === -5)) return this.mark("inprogress", null, t);
    if (states.some((s) => s === "approved") || votes.some((v) => v >= 5)) return this.mark("completed", "succeeded", t);
    return this.mark("", "", t);
  }
  prRow(p, t) {
    const id = p.pullRequestId;
    const reviewers = p.reviewers ?? [];
    const review = reviewers.some((r) => Number(r.vote) <= -10) ? "rejected" : reviewers.some((r) => Number(r.vote) === -5) ? "waiting" : reviewers.some((r) => Number(r.vote) >= 5) ? "approved" : "";
    const author = p.createdBy?.displayName ?? "";
    const source = branch(p.sourceRefName), target = branch(p.targetRefName);
    const policies = p.policies ?? [];
    const details = [`#${id} ${p.title}`, `${source} → ${target} · ${author}${review ? ` · ${review}` : ""}`, p.isDraft ? "draft" : ""].filter(Boolean);
    if (policies.length) details.push("", ...policies.map((x) => `${policyStatus(x)} · ${policyName(x)}`));
    if (p.policyError) details.push("", `Policy details: ${p.policyError}`);
    const tail = [review, author].filter(Boolean).join(" · ");
    return this.row(`ado-pr-${id}`, prUrl(p), this.prMark(p, t), `#${id}  ${p.title}${p.isDraft ? "  [draft]" : ""}`, tail, t, details.join("\n"));
  }
  render() {
    const t = theme(), rows = this.data[this.tab], error = this.errors[this.tab];
    const rowFor = (x) => this.tab === "runs" ? this.runRow(x, t) : this.prRow(x, t);
    const tab = ([id, label]) => div().id(`ado-tab-${id}`).px(10).py(4).rounded(6).cursor_pointer()
      .text_color(this.tab === id ? t.foreground : t.muted).when(this.tab === id, (el) => el.bg(t.selected))
      .on_click((_e, cx) => { this.tab = id; cx.notify(); })
      .child(`${label}${this.data[id] ? ` (${this.data[id].length})` : ""}`);
    return v_flex().id("ado-watch").size_full().min_h(0).text_size(13).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .child(h_flex().gap(6).items_center().h(42).flex_none().px(10).border_b(1).border_color(t.border).children(TABS.map(tab)))
      .child(v_flex().id("ado-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(2).p(6)
        .when(Boolean(error), (el) => el.child(div().p(10).text_color(t.ansi1).child(error)))
        .when(!error && !rows, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
        .when(!error && rows?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("nothing here")))
        .when(!error && Boolean(rows), (el) => el.children((rows ?? []).map(rowFor))));
  }
}
