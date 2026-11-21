// Servers: the hosts of ~/.ssh/config as a list under Spaces. Click = new space that runs `ssh <host>`
// on this computer. Re-reads the file every 30 s. Narrow sidebar: initials only.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, home, readTextFile, layout } from "herdr";
import { parseHosts } from "./hosts.js";

const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class Servers extends View {
  init(_p, cx) {
    this.hosts = null;
    this.load(cx);
    cx.timer.every(30000, (cx) => this.load(cx));
  }
  load(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${home()}/.ssh/config`).catch(() => null);
      this.hosts = parseHosts(text ?? "");
      cx.notify();
    });
  }
  row(h, t, rail) {
    const tail = [h.user, h.host].filter(Boolean).join("@");
    return h_flex().id(`srv-${h.name}`).h(28).flex_none().px(rail ? 0 : 8).gap(8).items_center().rounded(6)
      .when(rail, (el) => el.justify_center()).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => run("space.new", { name: h.name, argv: ["ssh", h.name], machine: "" }))
      .when(rail, (el) => el.child(div().text_color(t.foreground).child(h.name[0].toUpperCase())))
      .when(!rail, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(h.name))
        .child(div().flex_none().max_w(110).truncate().text_size(11.5).text_color(t.dim).child(tail)));
  }
  render() {
    const t = theme(), rail = narrow(), hosts = this.hosts;
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(rail ? 0 : 16).pr(10).items_center().text_size(11.5).text_color(t.dim)
        .when(rail, (el) => el.justify_center()).child(rail ? "⌁" : `Servers${hosts?.length ? ` (${hosts.length})` : ""}`))
      .child(v_flex().id("srv-list").flex_1().min_h(0).px(rail ? 0 : 8).pb(10).overflow_y_scrollbar()
        .when(hosts?.length === 0, (el) => el.child(div().px(8).text_size(11.5).text_color(t.dim).child("no hosts in ~/.ssh/config")))
        .children((hosts ?? []).map((h) => this.row(h, t, rail))));
  }
}
