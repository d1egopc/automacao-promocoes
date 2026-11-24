"use strict";

const assert = require("node:assert/strict");
const { readFileSync, writeFileSync } = require("node:fs");
const { generateKeyPairSync, randomBytes, sign } = require("node:crypto");
const { join } = require("node:path");

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const [lab, sourceSha] = process.argv.slice(2);
assert.match(sourceSha, /^[a-f0-9]{40}$/);
const artifact = variant => {
  const [ref, imageId] = readFileSync(join(lab, "artifact-" + variant), "utf8").trim().split(" ");
  assert.match(ref, /^localhost:15000\/fixture-(base|good|bad)@sha256:[a-f0-9]{64}$/);
  return { ref, imageId, digest: ref.split("@")[1] };
};
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const write = (file, value) => writeFileSync(join(lab, file), value, { mode: 0o600 });
const json = (file, value) => write(file, JSON.stringify(value));
write("approval.pub.pem", publicKey.export({ type: "spki", format: "pem" }));
write("fence-url", "postgresql://fixture_fence@postgres:5432/maintenance_e2e");
json("audit.json", {
  principal: "fixtureaudit", workspaces: ["alpha"], salt: randomBytes(32).toString("hex"),
  databaseUrl: "postgresql://fixture_audit@127.0.0.1:15432/maintenance_e2e"
});
json("deploy.json", {
  principals: ["fixturerelease"],
  policy: { purpose: "maintenance-lab", profile: "synthetic", requiredChecks: ["golden", "fixture"] },
  host: {
    directory: join(lab, "infra"), project: "optimus-maintenance-e2e",
    backend: "v1-fixture-backend", postgres: "v1-fixture-postgres", httpPort: 18080,
    controlImage: process.env.CONTROL_IMAGE, controlNetwork: "optimus-maintenance-e2e_default",
    fenceDbUrlFile: "/etc/optimus-maintenance/fence-url"
  }
});

function createApproval(id, base, candidate, golden, tampered = false) {
  const data = {
    version: 1, id, sourceSha, baseSha: sourceSha, base, candidate,
    purpose: "maintenance-lab", profile: "synthetic", runtimeFiles: ["fixture-health"],
    approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    gates: { sourceSha, baseDigest: base.digest, candidateDigest: candidate.digest,
      runId: process.env.GITHUB_RUN_ID, runtimeDiffVerified: true, results: { golden, fixture: "pass" } }
  };
  const payload = Buffer.from(JSON.stringify(data));
  const signature = sign(null, payload, privateKey).toString("base64");
  if (tampered) data.runtimeFiles.push("arbitrary-file");
  json(id + ".json", { payload: Buffer.from(JSON.stringify(data)).toString("base64"), signature });
}

createApproval("release-good", artifact("base"), artifact("good"), "pass");
createApproval("release-bad", artifact("good"), artifact("bad"), "pass");
createApproval("release-no-golden", artifact("base"), artifact("good"), "fail");
createApproval("release-tampered", artifact("base"), artifact("good"), "pass", true);
