"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { request, audit } = require("./entry.cjs");
const { approvedRelease, createDeployment, requireOk } = require("./deployment.cjs");
const { atomicWrite, createDockerHost } = require("./docker-host.cjs");

const root = "/etc/optimus-maintenance";
const stateFile = "/var/lib/optimus-maintenance/current.json";

async function main() {
  const principal = process.env.SUDO_USER;
  requireOk(process.getuid() === 0 && /^[a-z_][a-z0-9_-]{0,30}$/.test(principal || ""), "profile_denied");
  const config = JSON.parse(fs.readFileSync(root + "/deploy.json", "utf8"));
  requireOk(Array.isArray(config.principals) && config.principals.includes(principal), "profile_denied");
  const raw = Buffer.alloc(221);
  let length = 0;
  while (length < raw.length) {
    const n = fs.readSync(0, raw, length, raw.length - length);
    if (!n) break;
    length += n;
  }
  requireOk(length <= 220, "invalid_command");
  const command = raw.subarray(0, length).toString("utf8");
  const { action, id } = request(command, "deploy");
  const report = record => audit({ principal, profile: "deploy", action, id, ...record });
  if (process.argv.length === 2) {
    report({ outcome: "requested" });
    const result = spawnSync("/usr/bin/flock", ["-n", "-F", config.host.directory + "/backend-release.lock",
      process.execPath, "--", __filename, "locked"], {
      env: { PATH: "/usr/bin:/bin", HOME: "/root", SUDO_USER: principal },
      input: command, stdio: ["pipe", "inherit", "inherit"]
    });
    requireOk(result.status === 0, "maintenance_failed_or_locked");
    return;
  }
  requireOk(process.argv.length === 3 && process.argv[2] === "locked", "invalid_broker_invocation");
  const host = createDockerHost(config.host);
  const journal = {
    read() {
      try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    write(value) { atomicWrite(stateFile, JSON.stringify(value)); }
  };
  const controller = createDeployment({ host, journal, audit: report, wait: () => delay(2500) });
  try {
    let result;
    if (action === "status") {
      result = controller.status(id);
    } else if (action === "recover") {
      await controller.recover(id);
      result = controller.status(id);
    } else {
      const key = fs.readFileSync(root + "/release-approval.pub.pem");
      const envelope = JSON.parse(fs.readFileSync(root + "/releases/" + id + ".json", "utf8"));
      const release = approvedRelease(envelope, key, id, config.policy);
      if (action === "preflight") {
        host.preflight(release);
        const fence = host.fence("status");
        requireOk(fence.state === "OPEN" && typeof fence.epoch === "string" && !fence.epochMismatch &&
          (!fence.fenceEpoch || fence.fenceEpoch === fence.epoch), "fence_not_open");
        result = { phase: "preflight_ok", base: release.base.digest, candidate: release.candidate.digest,
          generation: fence.generation, epoch: fence.epoch };
      } else {
        const op = await controller.deploy(release);
        result = controller.status(op.id);
      }
    }
    report({ outcome: "ok" });
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
  } catch (error) {
    const state = journal.read();
    report({ outcome: error.maintenanceReason || "operation_failed", operation: state?.id, phase: state?.phase });
    if (state) process.stdout.write(JSON.stringify({ ok: false, operation: state.id, phase: state.phase }) + "\n");
    throw error;
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, reason: error.maintenanceReason || "operation_failed" }) + "\n");
  process.exitCode = 1;
});
