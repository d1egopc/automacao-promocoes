"use strict";
// Local-only terminal proof. This fake grant has no privileges outside this loopback server.
const http = require("node:http");
const { run } = require("../../modules/telemetria/codex-client.cjs");
const fake = "tel_" + "F".repeat(43);
let gets = 0,
  bad = 0;
const server = http.createServer((req, res) => {
  const valid =
    req.method === "GET" &&
    req.url === "/telemetria/operacional" &&
    req.headers.authorization === `Bearer ${fake}`;
  if (valid) gets++;
  else bad++;
  res.writeHead(valid ? 200 : 401, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: valid,
      source: "isolated_loopback_fixture",
      readOnly: true,
    }),
  );
});
server.listen(0, "127.0.0.1", async () => {
  try {
    console.log("ISOLATED_FIXTURE=YES REAL_CREDENTIALS=NO");
    await run({
      prepared: true,
      fixture: true,
      base: `http://127.0.0.1:${server.address().port}`,
    });
    if (gets !== 1 || bad !== 0) throw Error("fixture_request_mismatch");
    console.log("FIXTURE_GET=PASS AUTHORIZATION_REQUESTS=0");
  } catch {
    console.error("FIXTURE_BLOCKED=YES");
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
