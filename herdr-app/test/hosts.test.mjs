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
