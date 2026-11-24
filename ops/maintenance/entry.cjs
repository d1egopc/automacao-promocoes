"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { releaseId, opId, requireOk } = require("./deployment.cjs");
const { auditWorkspace } = require("./audit.cjs");

const configRoot = "/etc/optimus-maintenance";
const account = /^[a-z_][a-z0-9_-]{0,30}$/;
const workspaceName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
const env = { PATH: "/usr/bin:/bin", HOME: "/var/empty" };

function request(command, profile) {
  requireOk(typeof command === "string" && command.length <= 220, "invalid_command");
  const args = command.split(" ");
  if (profile === "deploy") {
    const [action, id] = args;
    requireOk(args.length === 2 && (
      (["preflight", "deploy"].includes(action) && releaseId.test(id)) ||
      (["status", "recover"].includes(action) && opId.test(id)) ||
      (action === "status" && id === "current")
    ), "command_denied");
    return { action, id };
  }
  const [action, workspace, minutes, limit] = args;
  requireOk(args.length === 4 && ["jobs", "funil", "logs", "work", "acks"].includes(action) &&
    workspaceName.test(workspace) && /^[1-9][0-9]{0,3}$/.test(minutes) && /^[1-9][0-9]{0,2}$/.test(limit),
    "command_denied");
  return { action, workspace, minutes: Number(minutes), limit: Number(limit) };
}

function audit(record) {
  const result = spawnSync("/usr/bin/logger", ["--tag", "optimus-maintenance-v1", "--",
    JSON.stringify({ at: new Date().toISOString(), ...record })], {
    env, encoding: "utf8", timeout: 2500, stdio: "ignore"
  });
  requireOk(result.status === 0, "audit_unavailable");
}

async function main() {
  const profile = process.argv[2];
  const command = process.env.SSH_ORIGINAL_COMMAND;
  requireOk(process.argv.length === 3 && ["audit", "deploy"].includes(profile), "profile_denied");
  const login = spawnSync("/usr/bin/id", ["-un"], { env, encoding: "utf8", timeout: 1500 });
  const principal = (login.stdout || "").trim();
  requireOk(login.status === 0 && account.test(principal) && process.getuid() !== 0, "identity_unavailable");
  let parsed;
  try {
    parsed = request(command, profile);
    audit({ principal, profile, action: parsed.action, outcome: "requested" });
    if (profile === "deploy") {
      const result = spawnSync("/usr/bin/sudo", ["-n", "--", "/usr/local/bin/node", "--",
        "/opt/optimus-maintenance/ops/maintenance/broker.cjs"], {
        env, input: command, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"], timeout: 450000
      });
      requireOk(result.status === 0, "broker_stopped_check_status");
      return;
    }
    const cfg = JSON.parse(fs.readFileSync(`${configRoot}/audit/${principal}.json`, "utf8"));
    requireOk(cfg.principal === principal && Array.isArray(cfg.workspaces) &&
      /^[a-f0-9]{64}$/.test(cfg.salt) && typeof cfg.databaseUrl === "string", "invalid_audit_profile");
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: cfg.databaseUrl, max: 1, connectionTimeoutMillis: 3000,
      options: "-c default_transaction_read_only=on -c statement_timeout=2000" });
    try {
      const result = await auditWorkspace({ pool, scopes: cfg.workspaces, salt: cfg.salt, ...parsed });
      audit({ principal, profile, action: parsed.action, workspace: result.workspace,
        minutes: result.minutes, limit: result.limit, rows: result.rows.length, outcome: "ok" });
      process.stdout.write(JSON.stringify(result) + "\n");
    } finally {
      await pool.end();
    }
  } catch (error) {
    audit({ principal, profile, action: parsed?.action || "denied", outcome: error.maintenanceReason || "operation_failed" });
    throw error;
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, reason: error.maintenanceReason || "operation_failed" }) + "\n");
  process.exitCode = 1;
});

module.exports = { request, audit };
