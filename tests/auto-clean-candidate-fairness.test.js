"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  runMediaPhysical,
  MAX_WORKING_SET_CANDIDATES,
  OBSERVATION_DELAY_MS
} = require("../modules/engine/auto-clean/gc-media-physical.service");

const NOW = Date.parse("2026-11-05T12:00:00.000Z");

async function run() {
  const fixtureRoot = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(fixtureRoot, "optimus-gc-fairness-"));
  try {
    const renderA = path.join(dataDir, "identidade-visual-ofertas", "clientes", "user_a", "renderizados");
    const renderB = path.join(dataDir, "identidade-visual-ofertas", "clientes", "user_b", "renderizados");
    fs.mkdirSync(renderA, { recursive: true });
    fs.mkdirSync(renderB, { recursive: true });
    const old = new Date(NOW - 192 * 60 * 60 * 1000 - 60_000);
    const candidateState = {};
    for (let i = 0; i < MAX_WORKING_SET_CANDIDATES; i += 1) {
      candidateState[`identity:user_a/file-${i}.png`] = {
        firstSeenAt: NOW - OBSERVATION_DELAY_MS - i,
        fingerprint: `0:0:1:${NOW - i}`,
        size: 1
      };
    }
    const targetFileName = "a".repeat(64) + ".png";
    const targetFile = path.join(renderB, targetFileName);
    fs.writeFileSync(targetFile, "fixture");
    fs.utimesSync(targetFile, old, old);
    fs.writeFileSync(path.join(dataDir, "auto-clean-media-physical-state.json"), JSON.stringify({
      version: 2, lastTarget: "", cursors: {}, cursorNames: {}, candidates: candidateState,
      lastObservedAt: {}, census: {}
    }));

    const referenceLoader = async () => ({ complete: true, refs: new Map() });
    const result = await runMediaPhysical({
      dataDir,
      targetId: "identity:user_b",
      execute: false,
      maxScan: 10,
      maxDurationMs: 2000,
      nowMs: NOW,
      referenceLoader,
      fsApi: fs.promises,
      logger: { log() {} }
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.candidates, 1, "escopo sub-representado precisa registrar candidato");
    assert.equal(result.candidateCapacityEvictions, 1, "deve desalojar somente uma observacao recente");
    assert.equal(result.candidateCapacityBlocked, 0);
    assert.ok(fs.existsSync(targetFile), "fairness nunca move ou remove arquivo");

    const stateAfter = JSON.parse(fs.readFileSync(path.join(dataDir, "auto-clean-media-physical-state.json"), "utf8"));
    const keys = Object.keys(stateAfter.candidates);
    assert.equal(keys.length, MAX_WORKING_SET_CANDIDATES, "limite global permanece intacto");
    assert.ok(keys.some(key => key === `identity:user_b/${targetFileName}`));
    assert.equal(keys.filter(key => key.startsWith("identity:user_a/")).length, MAX_WORKING_SET_CANDIDATES - 1);
    assert.equal(result.removed, 0);
    assert.equal(result.quarantined, 0);
    console.log("auto-clean-candidate-fairness.test.js OK");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
