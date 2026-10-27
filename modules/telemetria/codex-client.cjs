#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const { readPreparedToken } = require("./prepared-token-input.cjs");
const ALLOWED =
  /^\/(?:operacional|workspaces|problemas|sonda-radar|eventos|saude|rastreio\/(?:evento|job|oferta)\/\d{1,20})(?:\?[^#]*)?$/;

async function run({
  base = "https://go.optimuspromo.com.br",
  path = "/operacional",
  interactive = false,
  prepared = false,
  readToken = readPreparedToken,
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
    let grant;
    if (prepared) {
      credential = await readToken();
      if (!/^tel_[A-Za-z0-9_-]{43}$/.test(credential || ""))
        throw new Error("prepared_token_invalid");
    } else {
      const verifier = crypto.randomBytes(32).toString("base64url");
      const challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const pending = await request("/auditoria/solicitar", { challenge });
      if (!pending.ok) throw new Error("request_rejected");
      output(`REQUEST_ID=${pending.requestId}`);
      output(
        "Aprovar no painel /telemetria → Auditoria Codex. Nenhum login ou token principal é solicitado.",
      );
      const deadline = Math.min(pending.expiresAt, now() + 300000);
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
    }
    let current = path;
    let firstRead = true;
    do {
      if (
        !ALLOWED.test(current) ||
        /auditoriaToken|token=|https?:|\\/i.test(current)
      )
        throw new Error("read_path_not_allowed");
      if (grant && now() >= new Date(grant.expiraEm).getTime())
        throw new Error("authorization_expired");
      const result = await request(current, null, credential);
      if (prepared && firstRead) output("PREAUTHORIZED_READ=PASS");
      firstRead = false;
      output(JSON.stringify(result));
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
  const prepared = args.includes("--prepared");
  let rl = null;
  // Create readline only after hidden token input: it must never echo that input.
  const question = async (prompt) => {
    rl ||= readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return rl.question(prompt);
  };
  if (
    args.some((arg) =>
      /^tel_|^--(?:token|secret|authorization)(?:=|$)/i.test(arg),
    )
  ) {
    console.error("COLLECTOR_BLOCKED=credential_argument_not_allowed");
    process.exitCode = 1;
  } else if (prepared && interactive && !process.stdin.isTTY) {
    console.error("COLLECTOR_BLOCKED=prepared_interactive_requires_tty");
    process.exitCode = 1;
  } else {
    run({
      path: args.includes("--path")
        ? args[args.indexOf("--path") + 1]
        : "/operacional",
      interactive,
      prepared,
      input: interactive ? question : undefined,
    })
      .catch((error) => {
        console.error(
          `COLLECTOR_BLOCKED=${/^http_\d+:\/[a-z/-]+$/.test(error.message) || /^prepared_(?:token_invalid|input_(?:unavailable|cancelled|timeout))$/.test(error.message) ? error.message : "safe_request_failed"}`,
        );
        process.exitCode = 1;
      })
      .finally(() => rl?.close());
  }
}
module.exports = { run, ALLOWED };
