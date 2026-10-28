const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { V3Store } = require("../modules/mensageiro-v3/src/v3/store");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m33-v3-persistence-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 3,
    revision: 0,
    workspaces: {},
    deletedIds: { profiles: {}, schedules: {} }
  }));
  return { dir, filePath };
}

function activeProfile(store, workspaceId, name = "Perfil V3") {
  const profile = store.createProfile({ workspaceId, sessionId: `session-${workspaceId}`, name });
  store.updateProfile(workspaceId, profile.id, { active: true });
  store.saveCard(workspaceId, profile.id, "scheduled", { active: true });
  return store.getProfile(workspaceId, profile.id);
}

test("M3.3 — escrita, revisão, desativação e exclusão sobrevivem ao restart", () => {
  const f = fixture();
  try {
    const first = new V3Store({ filePath: f.filePath });
    const profile = activeProfile(first, "workspace-a");
    const schedule = first.createSchedule("workspace-a", profile.id, {
      destinations: ["group-a"],
      content: { type: "text", text: "persistido" },
      nextRunAt: new Date(Date.now() - 1000).toISOString()
    });
    first.activateSchedule("workspace-a", schedule.id);
    const beforeDeactivate = first.getSchedule("workspace-a", schedule.id);
    first.deactivateSchedule("workspace-a", schedule.id, beforeDeactivate.revision);

    const restarted = new V3Store({ filePath: f.filePath });
    assert.equal(restarted.getProfile("workspace-a", profile.id).active, true);
    assert.equal(restarted.getSchedule("workspace-a", schedule.id).active, false);
    assert.equal(restarted.effectiveSchedules("workspace-a").length, 0);
    assert.equal(restarted.deleteSchedule("workspace-a", schedule.id).deleted, true);
    assert.deepEqual(restarted.deleteSchedule("workspace-a", schedule.id), {
      deleted: false,
      alreadyDeleted: true
    });
    assert.equal(new V3Store({ filePath: f.filePath }).getSchedule("workspace-a", schedule.id), null);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.3 — exclusão deixa tombstone e não reutiliza identificador após recriação", () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const first = activeProfile(store, "workspace-a", "Antigo");
    const oldProfileId = first.id;
    const oldSchedule = store.createSchedule("workspace-a", oldProfileId, {
      destinations: ["group-a"],
      content: { type: "text", text: "antigo" }
    });
    assert.equal(store.deleteProfile("workspace-a", oldProfileId).deleted, true);
    const recreated = activeProfile(new V3Store({ filePath: f.filePath }), "workspace-a", "Novo");
    const newSchedule = new V3Store({ filePath: f.filePath }).createSchedule("workspace-a", recreated.id, {
      destinations: ["group-a"],
      content: { type: "text", text: "novo" }
    });
    assert.notEqual(recreated.id, oldProfileId);
    assert.notEqual(newSchedule.id, oldSchedule.id);
    const state = new V3Store({ filePath: f.filePath }).snapshot();
    assert.ok(state.deletedIds.profiles[oldProfileId]);
    assert.ok(state.deletedIds.schedules[oldSchedule.id]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.3 — duas instâncias serializam revisão e claim sem duplicação", async () => {
  const f = fixture();
  try {
    const first = new V3Store({ filePath: f.filePath });
    const profile = activeProfile(first, "workspace-a");
    const second = new V3Store({ filePath: f.filePath });
    const results = await Promise.all([
      Promise.resolve(first.claimExecution("workspace-a", "event-1", { source: "first" })),
      Promise.resolve(second.claimExecution("workspace-a", "event-1", { source: "second" }))
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const restarted = new V3Store({ filePath: f.filePath });
    assert.equal(restarted.snapshot().workspaces["workspace-a"].claims["event-1"] !== undefined, true);
    assert.ok(restarted.snapshot().revision >= profile.revision);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4-P1 — claims só compactam com horizonte de replay explícito e lote limitado", () => {
  const f = fixture();
  try {
    const clock = () => Date.parse("2026-01-10T00:00:00.000Z");
    const store = new V3Store({ filePath: f.filePath, clock });
    activeProfile(store, "workspace-a");
    assert.equal(store.claimExecution("workspace-a", "old", { source: "old" }), true);
    assert.equal(store.completeExecution("workspace-a", "old", { status: "confirmed" }).status, "confirmed");
    assert.throws(() => store.compactClaims("workspace-a", {
      now: clock(), retentionMs: 48 * 60 * 60 * 1000, maxRemovals: 1
    }), /claims_retencao_insegura/);
    assert.throws(() => store.compactClaims("workspace-a", {
      now: clock(), retentionMs: 48 * 60 * 60 * 1000,
      replayHorizonMs: 72 * 60 * 60 * 1000, maxRemovals: 1
    }), /claims_retencao_insegura/);

    const result = store.compactClaims("workspace-a", {
      now: Date.parse("2026-01-20T00:00:00.000Z"),
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      replayHorizonMs: 24 * 60 * 60 * 1000,
      maxRemovals: 1
    });
    assert.equal(result.removed, 1);
    assert.equal(result.remaining, 0);
    assert.equal(new V3Store({ filePath: f.filePath }).claimExecution("workspace-a", "old"), true);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.4-P1 — claim sem timestamp válido permanece preservado", () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    activeProfile(store, "workspace-a");
    store._mutate(() => {
      const workspace = store._workspace("workspace-a");
      workspace.claims.invalid = { source: "fixture" };
      store._touch(workspace, "fixture_claim_invalid");
    });
    const result = store.compactClaims("workspace-a", {
      now: Date.now() + 30 * 24 * 60 * 60 * 1000,
      retentionMs: 7 * 24 * 60 * 60 * 1000,
      replayHorizonMs: 24 * 60 * 60 * 1000,
      maxRemovals: 10
    });
    assert.equal(result.removed, 0);
    assert.deepEqual(new V3Store({ filePath: f.filePath }).snapshot().workspaces["workspace-a"].claims.invalid, { source: "fixture" });
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.3 — falha de persistência não retorna sucesso nem perde estado confirmado", () => {
  const f = fixture();
  const fsModule = require("node:fs");
  const originalCopy = fsModule.copyFileSync;
  const originalRename = fsModule.renameSync;
  try {
    const store = new V3Store({ filePath: f.filePath });
    const profile = activeProfile(store, "workspace-a", "Confirmado");
    const committedRevision = store.getProfile("workspace-a", profile.id).revision;
    fsModule.copyFileSync = (source, target, ...rest) => {
      if (target === f.filePath) throw new Error("persistencia_simulada_falha");
      return originalCopy(source, target, ...rest);
    };
    fsModule.renameSync = (source, target) => {
      if (target === f.filePath) throw new Error("persistencia_simulada_falha");
      return originalRename(source, target);
    };
    assert.throws(() => store.updateProfile("workspace-a", profile.id, { name: "nao-confirmado" }), /persistencia_simulada_falha/);
    fsModule.copyFileSync = originalCopy;
    fsModule.renameSync = originalRename;
    const restarted = new V3Store({ filePath: f.filePath });
    assert.equal(restarted.getProfile("workspace-a", profile.id).name, "Confirmado");
    assert.equal(restarted.getProfile("workspace-a", profile.id).revision, committedRevision);
  } finally {
    fsModule.copyFileSync = originalCopy;
    fsModule.renameSync = originalRename;
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.3 — lock sem identidade falha fechado e temporário não ressuscita configuração", () => {
  const f = fixture();
  try {
    const store = new V3Store({ filePath: f.filePath });
    const profile = activeProfile(store, "workspace-a");
    const orphanTmp = `${f.filePath}.orphan.tmp`;
    fs.writeFileSync(orphanTmp, JSON.stringify({ schemaVersion: 3, revision: 999, workspaces: {}, deletedIds: { profiles: {}, schedules: {} } }));
    fs.writeFileSync(store.lockPath, "");
    const stale = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(store.lockPath, stale, stale);
    const committed = fs.readFileSync(f.filePath);
    // The published lock-identity contract supersedes age-only recovery.
    // An empty old lock does not prove that its original owner terminated.
    assert.throws(() => store.claimExecution("workspace-a", "after-crash"), error =>
      error.code === "MENSAGEIRO_V3_LOCK_BUSY" && error.reason === "owner_partial_or_invalid");
    assert.deepEqual(fs.readFileSync(f.filePath), committed);
    assert.equal(fs.readFileSync(store.lockPath, "utf8"), "");
    const restarted = new V3Store({ filePath: f.filePath });
    assert.ok(restarted.getProfile("workspace-a", profile.id));
    assert.equal(restarted.snapshot().revision > 0, true);
    assert.equal(fs.existsSync(orphanTmp), true, "temporário órfão não pode substituir o commit confirmado");
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("M3.3 — estado incompatível falha fechado", () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.filePath, JSON.stringify({ schemaVersion: 2 }));
    assert.throws(() => new V3Store({ filePath: f.filePath }), /mensageiro_v3_schema_incompativel/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
