// node herdr-app/test/tools.test.mjs
import assert from "node:assert/strict";
import { parsePackage, parseMakefile, detectPm, scriptCommand } from "../mods/dev-run/scripts.js";
import { parsePs, portLabel } from "../mods/containers-watch/containers.js";
import { parseTasks, checkOff, captureName } from "../mods/vault-watch/tasks.js";

const p = parsePackage('{"scripts":{"dev":"vite","build":"vite build"},"packageManager":"pnpm@9.1"}');
assert.deepEqual(p.scripts.map((s) => s.name), ["dev", "build"]); assert.equal(p.pm, "pnpm");
assert.deepEqual(parsePackage("{broken").scripts, []);
assert.equal(detectPm(["yarn.lock"], ""), "yarn"); assert.equal(detectPm(["yarn.lock"], "pnpm"), "pnpm"); assert.equal(detectPm([], ""), "npm");
assert.equal(scriptCommand("yarn", "dev"), "yarn dev"); assert.equal(scriptCommand("npm", "dev"), "npm run dev");
const mk = parseMakefile("CC := gcc\n.PHONY: all\nall: build ## build all\nbuild:\n\tcc\n%.o: %.c\nbuild:\nfoo-bar_1: x\n\tbody: not a target\n");
assert.deepEqual(mk.map((t) => t.name), ["all", "build", "foo-bar_1"]); assert.equal(mk[0].cmd, "build all");

const d = parsePs('{"ID":"a1","Names":"web","Image":"nginx","State":"running","Status":"Up 2h","Ports":"0.0.0.0:8080->80/tcp, :::8080->80/tcp, 5432/tcp"}\n');
assert.equal(d[0].name, "web"); assert.equal(portLabel(d[0].ports[0]), "8080→80"); assert.equal(d[0].ports[2].host, null);
const pm = parsePs('[{"Id":"b2","Names":["db"],"Image":"pg","State":"exited","Status":"Exited","Ports":[{"host_port":5432,"container_port":5432,"protocol":"tcp"}]}]');
assert.equal(pm[0].id, "b2"); assert.equal(pm[0].state, "exited"); assert.equal(portLabel(pm[0].ports[0]), "5432→5432");
assert.deepEqual(parsePs(""), []);

const out = "./Journal/a.md:3:- [ ] Alt [due:: 2026-11-01] [scope:: [[X]]]\n./b.md:9:  - [ ] Heute mit [[Person|Anna]] [due:: 2026-11-22] [priority:: 1]\n./c.md:1:- [ ] Später [due:: 2026-12-01]\n./d.md:1:- [ ] ohne\n";
const t = parseTasks(out, "2026-11-22");
assert.deepEqual(t.map((x) => [x.file, x.overdue]), [["Journal/a.md", true], ["b.md", false]]);
assert.equal(t[1].text, "Heute mit Anna"); assert.equal(t[0].text, "Alt");
assert.equal(checkOff("x\n- [ ] Alt [due:: 1]\ny", 2, "Alt"), "x\n- [x] Alt [due:: 1]\ny");
assert.equal(checkOff("x\n- [x] Alt\n", 2, "Alt"), null); assert.equal(checkOff("x\n- [ ] Anders\n", 2, "Alt"), null);
assert.equal(captureName("Idee: Foo/Bar\nmehr", "2026-11-22"), "2026-11-22 Idee FooBar.md");
console.log("ok");
import { parseWorkspaces } from "../mods/dev-run/scripts.js";
assert.deepEqual(parseWorkspaces("packages:\n  - 'src/web'\n  - \"e2e\"\n  - 'pk/*'\nallowBuilds:\n  - 'x'\n", '{"workspaces":["./a/"]}'), ["src/web", "e2e", "a"]);
assert.deepEqual(parseWorkspaces(null, '{"workspaces":{"packages":["x"]}}'), ["x"]);
console.log("ok ws");
import { parseHooks } from "../mods/dev-run/scripts.js";
assert.deepEqual(parseHooks("pre-commit\npre-push.sample\n.hidden\ncommit-msg\n"), ["pre-commit", "commit-msg"]);
console.log("ok hooks");
