const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { V3Store, buildOccurrenceKey } = require("../modules/mensageiro-v3/src/v3/store");
const { V3Scheduler } = require("../modules/mensageiro-v3/src/v3/scheduler");

function fixture(start = "2026-10-20T09:00:00.000Z") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m34-p21-recurrence-"));
  const filePath = path.join(dir, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 3, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} }, workspaceFences: {} }));
  let now = Date.parse(start);
  return {
    dir,
    filePath,
    now: () => now,
    setNow(value) { now = typeof value === "number" ? value : Date.parse(value); },
    store: new V3Store({ filePath, clock: () => now })
  };
}

function activeProfile(store, workspaceId = "workspace-a") {
  const profile = store.createProfile({ workspaceId, sessionId: `session-${workspaceId}`, name: "Perfil V3" });
  store.updateProfile(workspaceId, profile.id, { active: true });
  store.saveCard(workspaceId, profile.id, "scheduled", { active: true });
  return store.getProfile(workspaceId, profile.id);
}

function schedule(f, { intervalMs = 24 * 60 * 60 * 1000, nextRunAt = "2026-10-20T09:00:00.000Z", destinations = ["group-a"], content = { type: "text", text: "bom dia" } } = {}) {
  const profile = activeProfile(f.store);
  const created = f.store.createSchedule("workspace-a", profile.id, { intervalMs, nextRunAt, destinations, content, timezone: "America/Sao_Paulo" });
  return { profile, schedule: f.store.activateSchedule("workspace-a", created.id) };
}

function scheduler(store, clock, calls, sendResult) {
  return new V3Scheduler({
    store,
    clock,
    transport: {
      authorizeSend: async () => true,
      sendMessage: async payload => { calls.push(payload); return sendResult || { confirmed: true }; }
    }
  });
}

test("M3.4-P2.1 — recorrência diária avança nextRunAt e executa cada ocorrência uma vez", async () => {
  const f = fixture();
  try {
    const { schedule: initial } = schedule(f);
    const calls = [];
    const run = scheduler(f.store, f.now, calls);
    const first = await run.tick();
    assert.equal(first.sent.length, 1);
    assert.equal(calls.length, 1);
    const afterDayOne = f.store.getSchedule("workspace-a", initial.id);
    assert.equal(afterDayOne.nextRunAt, "2026-10-21T09:00:00.000Z");
    assert.equal((await run.tick()).sent.length, 0);
    f.setNow("2026-10-21T09:00:00.000Z");
    const second = await run.tick();
    assert.equal(second.sent.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(f.store.getSchedule("workspace-a", initial.id).nextRunAt, "2026-10-22T09:00:00.000Z");
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — intervalo atrasado pula períodos sem replay ou avalanche", async () => {
  const f = fixture("2026-10-23T12:00:00.000Z");
  try {
    const { schedule: initial } = schedule(f, { intervalMs: 60 * 60 * 1000, nextRunAt: "2026-10-20T09:00:00.000Z" });
    const calls = [];
    const result = await scheduler(f.store, f.now, calls).tick();
    assert.equal(result.sent.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(result.blocked[0]?.reason, "atraso_sem_replay");
    assert.equal(f.store.getSchedule("workspace-a", initial.id).nextRunAt, "2026-10-23T13:00:00.000Z");
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — uma programação única conclui e não volta após restart", async () => {
  const f = fixture();
  try {
    const { schedule: initial } = schedule(f, { intervalMs: 0 });
    const calls = [];
    assert.equal((await scheduler(f.store, f.now, calls).tick()).sent.length, 1);
    const restarted = new V3Store({ filePath: f.filePath, clock: f.now });
    assert.equal(restarted.getSchedule("workspace-a", initial.id).active, false);
    assert.equal((await scheduler(restarted, f.now, calls).tick()).sent.length, 0);
    assert.equal(calls.length, 1);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — OFF pula ocorrência vencida e reativação agenda somente a próxima", async () => {
  const f = fixture();
  try {
    const { schedule: initial } = schedule(f);
    const calls = [];
    f.store.deactivateSchedule("workspace-a", initial.id, f.store.getSchedule("workspace-a", initial.id).revision);
    f.setNow("2026-10-21T12:00:00.000Z");
    assert.equal((await scheduler(f.store, f.now, calls).tick()).sent.length, 0);
    const inactive = f.store.getSchedule("workspace-a", initial.id);
    const reactivated = f.store.activateSchedule("workspace-a", initial.id, inactive.revision);
    assert.equal(reactivated.nextRunAt, "2026-10-22T09:00:00.000Z");
    assert.equal((await scheduler(f.store, f.now, calls).tick()).sent.length, 0);
    f.setNow("2026-10-22T09:00:00.000Z");
    assert.equal((await scheduler(f.store, f.now, calls).tick()).sent.length, 1);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — remoção de conteúdo e exclusão da programação bloqueiam próximas ocorrências", async () => {
  const f = fixture();
  try {
    const first = schedule(f);
    const calls = [];
    f.store.updateSchedule("workspace-a", first.schedule.id, { content: null }, { expectedRevision: f.store.getSchedule("workspace-a", first.schedule.id).revision });
    assert.equal((await scheduler(f.store, f.now, calls).tick()).sent.length, 0);
    const second = schedule(f, { nextRunAt: "2026-10-20T09:00:00.000Z" });
    f.store.deleteSchedule("workspace-a", second.schedule.id);
    assert.equal((await scheduler(f.store, f.now, calls).tick()).sent.length, 0);
    assert.equal(calls.length, 0);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — dois processos não duplicam o destino da mesma ocorrência", async () => {
  const f = fixture();
  try {
    schedule(f);
    const calls = [];
    const first = scheduler(new V3Store({ filePath: f.filePath, clock: f.now }), f.now, calls);
    const second = scheduler(new V3Store({ filePath: f.filePath, clock: f.now }), f.now, calls);
    const results = await Promise.all([first.tick(), second.tick()]);
    assert.equal(results.reduce((sum, result) => sum + result.sent.length, 0), 1);
    assert.equal(calls.length, 1);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — transporte ambíguo é terminal local e não é reenviado", async () => {
  const f = fixture();
  try {
    const { schedule: initial } = schedule(f);
    const calls = [];
    const run = scheduler(f.store, f.now, calls, { ambiguous: true });
    const first = await run.tick();
    assert.equal(first.sent.length, 0);
    assert.equal(first.ambiguous.length, 1);
    assert.equal((await run.tick()).sent.length, 0);
    assert.equal(calls.length, 1);
    const state = f.store.snapshot().workspaces["workspace-a"];
    const statuses = Object.values(state.occurrences).filter(item => item.scheduleId === initial.id).map(item => item.status);
    assert.deepEqual(statuses, ["ambiguous"]);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("M3.4-P2.1 — compactação não ressuscita ocorrência terminal", () => {
  const f = fixture();
  try {
    const { profile, schedule: initial } = schedule(f, { intervalMs: 24 * 60 * 60 * 1000 });
    const occurrenceAt = initial.nextRunAt;
    const key = buildOccurrenceKey("workspace-a", initial.id, initial.revision, occurrenceAt, "group-a");
    assert.equal(f.store.claimExecution("workspace-a", key, { scheduleId: initial.id, profileId: profile.id, destination: "group-a", occurrenceKey: key, occurrenceAt }), true);
    f.store.completeExecution("workspace-a", key, { status: "confirmed", occurrenceKey: key });
    const compacted = f.store.compactClaims("workspace-a", { now: f.now() + 8 * 24 * 60 * 60 * 1000, retentionMs: 7 * 24 * 60 * 60 * 1000, replayHorizonMs: 24 * 60 * 60 * 1000, maxRemovals: 10 });
    assert.equal(compacted.removed, 1);
    assert.equal(f.store.claimExecution("workspace-a", key, { scheduleId: initial.id, profileId: profile.id, destination: "group-a", occurrenceKey: key, occurrenceAt }), false);
    assert.equal(f.store.snapshot().workspaces["workspace-a"].occurrences[key].status, "confirmed");
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});
