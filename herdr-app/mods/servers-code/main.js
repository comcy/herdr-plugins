// Servers: hosts of ~/.ssh/config under Spaces/Agents. Click = new space that runs `ssh <host>` on this computer.
// "+" opens a popup: connect to [user@]host[:port] once, or save it as a Host block in ~/.ssh/config.
// Click the title to collapse/expand (remembered). Narrow sidebar (<160px): initials only.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, exec, theme, home, readTextFile, writeTextFile, layout, shared, setShared, props, openOverlay, closeOverlay, window, checking } from "herdr";
import { parseHosts, parseDest, sshArgv, hostBlock } from "./hosts.js";

const find = (n, id) => (n?.id === id ? n : (n?.children ?? []).map((c) => find(c, id)).find(Boolean));
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const CONFIG = () => `${home()}/.ssh/config`;
const collapsed = () => Boolean(shared("servers.collapsed"));
const applySize = () => run("layout.resize", collapsed() ? { id: "servers", px: 41 } : { id: "servers", weight: 0.4 });
const connect = (name, argv) => run("space.new", { name, argv, machine: "" });

export default class Servers extends View {
  init(_p, cx) {
    this.add = Boolean(props()?.overlay);
    if (this.add) return this.initAdd(cx);
    this.hosts = null; this.rev = shared("servers.rev");
    if (!checking() && collapsed()) applySize();   // the layout file resets the size at start
    this.load(cx);
    cx.timer.every(2000, (cx) => { if (shared("servers.rev") !== this.rev) { this.rev = shared("servers.rev"); this.load(cx); } });
    cx.timer.every(30000, (cx) => this.load(cx));
  }
  load(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(CONFIG()).catch(() => null);
      this.hosts = parseHosts(text ?? "");
      cx.notify();
    });
  }
  // --- "+" popup ---
  initAdd(cx) {
    this.err = null; this.addr = ""; this.name = "";
    const field = (key) => { const s = InputState.new({ value: "" }); s.on("change", () => { this[key] = s.value(); }); s.on("submit", () => this.go(false)); return s; };
    this.addrIn = field("addr"); this.nameIn = field("name");
    this.addrIn.focus(); cx.timer.after(600, () => this.addrIn.focus());
    this.handle = cx.focus_handle();
  }
  go(save) {
    const d = parseDest(this.addr), name = this.name.trim();
    if (!d) { this.err = "address: [user@]host[:port]"; return; }
    if (!save) { closeOverlay(props().overlay); connect(name || d.host, sshArgv(d)); return; }
    if (!name || /[\s*?!]/.test(name)) { this.err = "name needed to save (no spaces / wildcards)"; return; }
    this.persist(name, d).then(
      () => { setShared("servers.rev", Date.now()); closeOverlay(props().overlay); connect(name, ["ssh", name]); },
      (e) => { this.err = String(e.message ?? e); },
    );
  }
  async persist(name, d) {
    const path = CONFIG(), old = await readTextFile(path).catch(() => null);
    if (old && parseHosts(old).some((h) => h.name === name)) throw new Error(`${name} already in ssh config`);
    if (old === null) {
      const dir = `${home()}/.ssh`;
      await (window()?.platform === "windows" ? exec("powershell", ["-NoProfile", "-Command", `New-Item -ItemType Directory -Force -LiteralPath '${dir}'`]) : exec("mkdir", ["-p", dir]));
    }
    await writeTextFile(path, (old ? old.replace(/\s*$/, "\n\n") : "") + hostBlock(name, d), old);
  }
  renderAdd() {
    const t = theme();
    const label = (s) => div().pt(8).pb(4).text_size(11.5).text_color(t.dim).child(s);
    const input = (st) => Input.new(st).h(34).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
    const button = (id, text, primary, fn) => h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(primary ? t.solid : t.input)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(fn).child(text);
    return v_flex().id("srv-add").track_focus(this.handle).w_full().p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
        else if (e.key === "tab") { (this.nameIn.is_focused?.() ? this.addrIn : this.nameIn).focus(); cx.stop_propagation(); }
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("New connection")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Address  (user@host or host:port)")).child(input(this.addrIn))
      .child(label("Name  (needed to save to ~/.ssh/config)")).child(input(this.nameIn))
      .child(div().pt(6).h(20).text_size(11.5).text_color(t.ansi1).child(this.err ?? ""))
      .child(h_flex().pt(6).gap(8).justify_end()
        .child(button("srv-save", "Save & connect", false, () => this.go(true)))
        .child(button("srv-go", "Connect", true, () => this.go(false))));
  }
  // --- panel ---
  row(h, t, rail) {
    const tail = [h.user, h.host].filter(Boolean).join("@");
    return h_flex().id(`srv-${h.name}`).h(28).flex_none().px(rail ? 0 : 8).gap(8).items_center().rounded(6)
      .when(rail, (el) => el.justify_center()).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => connect(h.name, ["ssh", h.name]))
      .when(rail, (el) => el.child(div().text_color(t.foreground).child(h.name[0].toUpperCase())))
      .when(!rail, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(h.name))
        .child(div().flex_none().max_w(110).truncate().text_size(11.5).text_color(t.dim).child(tail)));
  }
  render() {
    if (this.add) return this.renderAdd();
    const t = theme(), rail = narrow(), hosts = this.hosts, folded = collapsed();
    const toggle = () => { setShared("servers.collapsed", !folded); applySize(); };
    // Same look as the Agents block: border on top, header 41 px.
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(h_flex().h(41).flex_none().pt(rail ? 0 : 10).pl(rail ? 0 : 16).pr(rail ? 0 : 10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(rail, (el) => el.justify_center())
        .child(div().id("srv-title").flex_1().cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip(folded ? "Show servers" : "Hide servers").on_click(toggle)
          .child(rail ? "⌁" : `${folded ? "▸" : "▾"} Servers${hosts?.length ? ` (${hosts.length})` : ""}`))
        .when(!rail, (el) => el.child(div().id("srv-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).tooltip("New connection")
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => openOverlay({ mod: "servers-code", kind: "popup", width: 440, height: 250 }))
          .child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      .when(!folded, (el) => el.child(v_flex().id("srv-list").flex_1().min_h(0).px(rail ? 0 : 8).pb(10).overflow_y_scrollbar()
        .when(hosts?.length === 0, (e) => e.child(div().px(8).text_size(11.5).text_color(t.dim).child("no hosts yet — click + (or add Host blocks to ~/.ssh/config)")))
        .children((hosts ?? []).map((h) => this.row(h, t, rail)))));
  }
}
