// node herdr-app/test/hosts.test.mjs
import assert from "node:assert/strict";
import { parseHosts } from "../mods/servers-code/hosts.js";

const cfg = `
Host *
  ServerAliveInterval 30
Host nas backup   # two names, one block
  HostName 192.168.0.5
  User admin
Host web-*
  User nobody
Host prod
  HostName=example.org
  User deploy
  User ignored
Match host x
  User nope
Host nas
  HostName dup
`;
assert.deepEqual(parseHosts(cfg), [
  { name: "nas", host: "192.168.0.5", user: "admin" },
  { name: "backup", host: "192.168.0.5", user: "admin" },
  { name: "prod", host: "example.org", user: "deploy" },
]);
assert.deepEqual(parseHosts(""), []);
console.log("ok");
import { parseDest, sshArgv, hostBlock } from "../mods/servers-code/hosts.js";
assert.deepEqual(parseDest(" root@10.0.0.5:2222 "), { user: "root", host: "10.0.0.5", port: "2222" });
assert.deepEqual(parseDest("nas.lan"), { user: "", host: "nas.lan", port: "" });
assert.equal(parseDest("a b"), null); assert.equal(parseDest(""), null);
assert.deepEqual(sshArgv(parseDest("me@h:22")), ["ssh", "-p", "22", "me@h"]);
assert.equal(hostBlock("h", parseDest("me@h:22")), "Host h\n  HostName h\n  User me\n  Port 22\n");
assert.deepEqual(parseHosts(hostBlock("x", parseDest("u@1.2.3.4"))), [{ name: "x", host: "1.2.3.4", user: "u" }]);
console.log("ok dest");
import { hostDetail, removeHost, updateHost, destString } from "../mods/servers-code/hosts.js";
const c2 = "Host a\n  HostName 1.1.1.1\n  User u\n  IdentityFile ~/k\n\nHost b c\n  HostName 2.2.2.2\n\nHost d\n  HostName 3.3.3.3\n";
assert.deepEqual(hostDetail(c2, "a"), { host: "1.1.1.1", user: "u", port: "" });
assert.equal(destString(hostDetail(c2, "d")), "3.3.3.3");
assert.equal(removeHost(c2, "a"), "Host b c\n  HostName 2.2.2.2\n\nHost d\n  HostName 3.3.3.3\n");
assert.equal(removeHost(c2, "b"), c2.replace("Host b c", "Host c"));
assert.equal(updateHost(c2, "a", "z", { host: "9.9.9.9", user: "", port: "22" }),
  "Host z\n  HostName 9.9.9.9\n  IdentityFile ~/k\n  Port 22\n\nHost b c\n  HostName 2.2.2.2\n\nHost d\n  HostName 3.3.3.3\n");
assert.equal(parseHosts(updateHost(c2, "b", "b", { host: "5.5.5.5", user: "", port: "" })).find((h) => h.name === "b").host, "5.5.5.5");
console.log("ok edit");
