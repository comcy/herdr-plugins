// Containers of the focused folder's compose project (label com.docker.compose.project.working_dir),
// or all containers ("all" toggle). docker, else podman. Click = logs in a new tab. Local spaces only.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, spaces, panes, theme, layout } from "herdr";
import { parsePs, portLabel } from "./containers.js";

const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));

export default class Containers extends View {
  init(_p, cx) {
    this.items = null; this.err = null; this.all = false; this.loc = ""; this.last = 0;
    this.load(cx);
    cx.timer.every(2500, (cx) => {
      const root = layout(), panel = find(root, "panel");
      if (!panel || panel.hidden || find(root, "panel-body")?.active !== "containers") return;
      if (JSON.stringify(this.where()) !== this.loc || Date.now() - this.last > 5000) this.load(cx);
    });
  }
  where() {
    const sp = spaces().find((s) => s.active);
    return { cwd: panes().find((p) => p.focused)?.cwd ?? sp?.folder, on: sp?.machine ?? null };
  }
  async runtime() {
    if (!this.rt) {
      const r = await exec("sh", ["-c", "command -v docker || command -v podman"]);
      this.rt = r.stdout.trim().split("/").pop();
    }
    return this.rt;
  }
  load(cx) {
    this.last = Date.now();
    const at = this.where(); this.loc = JSON.stringify(at); this.cwd = at.cwd;
    cx.spawn(async (cx) => {
      try {
        if (at.on) throw new Error("remote space: not supported");
        const rt = await this.runtime();
        if (!rt) throw new Error("neither docker nor podman found");
        const args = ["ps", "-a", "--format", "json", ...(this.all ? [] : ["--filter", `label=com.docker.compose.project.working_dir=${at.cwd}`])];
        const r = await exec(rt, args, { cwd: at.cwd });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `${rt} failed`);
        this.items = parsePs(r.stdout); this.err = null;
      } catch (e) { this.err = String(e.message ?? e); }
      cx.notify();
    });
  }
  act(verb, c, cx) {
    exec(this.rt, [verb, c.id]).then(() => this.load(cx));
  }
  render() {
    const t = theme(), items = this.items;
    const dot = (s) => div().w(14).text_color(s === "running" ? t.ansi2 : s === "exited" || s === "created" ? t.dim : t.ansi3).child("●");
    const small = (id, label, tip, fn) => div().id(id).w(20).flex_none().text_center().rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { cx.stop_propagation(); fn(cx); }).child(label);
    const row = (c) => {
      const web = c.ports.find((p) => p.host), up = c.state === "running";
      return h_flex().id(`ct-${c.id}`).gap(8).px(10).h(28).flex_none().items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip([c.name, c.image, c.status, ...(c.ports.length ? ["", ...c.ports.map((p) => `${portLabel(p)}/${p.proto}`)] : []), "", "click: logs"].join("\n"))
        .on_click(() => run("terminal.open", { argv: ["sh", "-c", `${this.rt} logs -f --tail 300 ${c.id}; exec "\${SHELL:-sh}"`], folder: this.cwd, place: "tab", name: `logs ${c.name}` }))
        .child(dot(c.state))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.name))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(c.ports.filter((p) => p.host).map((p) => `:${p.host}`).join(" ")))
        .when(Boolean(web) && up, (el) => el.child(small(`open-${c.id}`, "↗", `open localhost:${web.host}`, (cx) => cx.open_url(`http://localhost:${web.host}`))))
        .child(small(`tg-${c.id}`, up ? "■" : "▶", up ? "stop" : "start", (cx) => this.act(up ? "stop" : "start", c, cx)));
    };
    const toggle = div().id("ct-scope").px(8).py(2).rounded(6).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.all = !this.all; this.items = null; this.load(cx); cx.notify(); }).child(this.all ? "all containers" : "this project");
    return v_flex().id("containers").size_full().min_h(0).bg(t.chrome).p(8).gap(6).text_size(13)
      .child(h_flex().items_center().gap(6).child(toggle).child(div().flex_1()).child(div().text_size(11.5).text_color(t.dim).child(this.rt ?? "")))
      .child(v_flex().id("ct-rows").flex_1().min_h(0).overflow_y_scrollbar().gap(2)
        .when(Boolean(this.err), (el) => el.child(div().p(10).text_color(t.ansi1).child(this.err)))
        .when(!this.err && !items, (el) => el.child(div().p(10).text_color(t.dim).child("loading…")))
        .when(!this.err && items?.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child(this.all ? "no containers" : "no compose containers for this folder — try \"all containers\"")))
        .when(!this.err && Boolean(items), (el) => el.children((items ?? []).map(row))));
  }
}
