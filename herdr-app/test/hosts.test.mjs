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
