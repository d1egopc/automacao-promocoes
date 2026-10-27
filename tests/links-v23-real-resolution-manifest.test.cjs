"use strict";
// Integrity of the observed replay artifact, not a pretend live-network CI test.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const evidence = require("./fixtures/links-v23-real-resolution.sanitized.json");

test("fixed 40-URL cohort remains tied to the exact measured resolution code", () => {
  assert.equal(evidence.sampleFingerprint, "5fa12103ca5e2902e7d969d08967280aec1f398859dcb1565f2aa71ab2671e06");
  assert.equal(evidence.sampleCount, 40); assert.equal(evidence.rows.length, 40);
  assert.equal(new Set(evidence.rows.map(x => x.id)).size, 40);
  assert.equal(new Set(evidence.rows.map(x => x.domain)).size, 12);
  for (const [file, expected] of Object.entries(evidence.normalizedSourceHashes)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n")).digest("hex");
    assert.equal(actual, expected, `measured runtime changed: ${file}`);
  }
});

test("resolution gain has aligned first-party proof; unresolved and affiliate states cannot inflate success", () => {
  assert.equal(evidence.rows.filter(x => x.before.resolved).length, 9);
  assert.equal(evidence.rows.filter(x => x.after.resolved).length, 18);
  assert.equal(evidence.rows.filter(x => x.after.productIdentified).length, 18);
  assert.deepEqual(evidence.lost, []);
  for (const row of evidence.rows) {
    assert.equal(row.after.affiliationConfirmed, false);
    if (!row.after.resolved) { assert.notEqual(row.after.reason, "resolved"); continue; }
    assert.equal(row.after.reason, "resolved"); assert.ok(row.after.proofs.length);
    for (const proof of row.after.proofs) {
      assert.match(proof.host, /(?:^|\.)(?:amazon\.com\.br|mercadolivre\.com\.br|kabum\.com\.br)$/);
      assert.match(proof.bodyHash, /^[a-f0-9]{64}$/); assert.match(proof.keyHash, /^[a-f0-9]{12}$/);
    }
  }
  assert.equal(evidence.rows.filter(x => !x.after.resolved).length, 22);
  assert.equal(Object.values(evidence.unresolvedByReason).reduce((a, b) => a + b, 0), 22);
  assert.equal(evidence.reusableFamilyEvidence[0].distinctExamples, 3);
  assert.equal(evidence.reusableFamilyEvidence[0].activated, false);
});
