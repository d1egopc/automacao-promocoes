#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const ALLOWED =
  /^\/(?:operacional|workspaces|problemas|sonda-radar|eventos|saude|rastreio\/(?:evento|job|oferta)\/\d{1,20})(?:\?[^#]*)?$/;

async function run({
  base = "https://go.optimuspromo.com.br",
  path = "/operacional",
  interactive = false,
  fixture = false,
  output = console.log,
  input,
  fetcher = fetch,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
} = {}) {
  const origin = new URL(base);
  if (
    origin.href !== "https://go.optimuspromo.com.br/" &&
    !(
      fixture &&
      origin.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(origin.hostname) &&
      !origin.username &&
      !origin.password
    )
  )
    throw new Error("unapproved_origin");
  if (origin.search || origin.hash || origin.pathname !== "/")
    throw new Error("unapproved_origin");
  let credential = "";
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  async function request(endpoint, body, token = "") {
    const res = await fetcher(`${origin.origin}/telemetria${endpoint}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok)
      throw new Error(`http_${res.status}:${endpoint.split("?")[0]}`);
    return res.json();
  }
  try {
    const pending = await request("/auditoria/solicitar", { challenge });
    if (!pending.ok) throw new Error("request_rejected");
    output(`REQUEST_ID=${pending.requestId}`);
    output(
      "Aprovar no painel /telemetria → Auditoria Codex. Nenhum login ou token principal é solicitado.",
    );
    const deadline = Math.min(pending.expiresAt, now() + 300000);
    let grant;
    while (now() < deadline) {
      await wait(5000);
      grant = await request("/auditoria/coletor", {
        requestId: pending.requestId,
        verifier,
      });
      if (grant.state === "authorized") break;
    }
    if (
      grant?.state !== "authorized" ||
      !/^tel_[A-Za-z0-9_-]{43}$/.test(grant.codigo || "")
    )
      throw new Error("authorization_not_received");
    credential = grant.codigo;
    delete grant.codigo;
    output(`AUTHORIZED=YES EXPIRES_AT=${grant.expiraEm}`);
    let current = path;
    do {
      if (
        !ALLOWED.test(current) ||
        /auditoriaToken|token=|https?:|\\/i.test(current)
      )
        throw new Error("read_path_not_allowed");
      if (now() >= new Date(grant.expiraEm).getTime())
        throw new Error("authorization_expired");
      output(JSON.stringify(await request(current, null, credential)));
      if (!interactive || !input) break;
      current = (await input("GET path (ENTER encerra): ")).trim();
    } while (current);
  } finally {
    credential = "";
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const interactive = args.includes("--interactive");
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  run({
    path: args.includes("--path")
      ? args[args.indexOf("--path") + 1]
      : "/operacional",
    interactive,
    input: rl ? (prompt) => rl.question(prompt) : undefined,
  })
    .catch((error) => {
      console.error(
        `COLLECTOR_BLOCKED=${/^http_\d+:\/[a-z/-]+$/.test(error.message) ? error.message : "safe_request_failed"}`,
      );
      process.exitCode = 1;
    })
    .finally(() => rl?.close());
}
module.exports = { run, ALLOWED };
