"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { V3Store } = require("../mensageiro-v3/src/v3/store");
const { selectProfile, cardActive } = require("../mensageiro-v3/operational-gates");
const { scheduleInput } = require("../mensageiro-v3/legacy-compat");
const {
  CARDS,
  lightProfile,
  normalizeIntelligence,
  normalizeModeration,
  text,
  list,
  fail,
  validateImages,
} = require("./model");
const store = new V3Store({ filePath: workerData.filePath });
const profile = (w, id) => {
  const p = store.state.workspaces[w] ? store.getProfile(w, id) : null;
  if (!p || p.id !== id || p.workspaceId !== w) fail("perfil_nao_encontrado");
  return p;
};
function conflict(w, p) {
  if (!p.active) return;
  for (const other of store.listProfiles(w)) {
    if (other.id === p.id || !other.active || other.sessionId !== p.sessionId)
      continue;
    const privateCards = ["attendance", "faq", "flows", "quickReplies"];
    if (privateCards.some(c => p.cards[c]?.active) && privateCards.some(c => other.cards[c]?.active))
      fail("perfis_conflitantes");
    for (const card of CARDS.filter((c) => c !== "scheduled")) {
      if (!p.cards[card]?.active || !other.cards[card]?.active) continue;
      const groups = (value) =>
        value.cards[card].configuration?.gruposConfigurados === true ||
        value.cards[card].configuration?.grupos?.length
          ? value.cards[card].configuration.grupos || []
          : value.destinations || [];
      if (
        ["attendance", "faq", "flows", "quickReplies"].includes(card) ||
        groups(p).some((g) => groups(other).includes(g))
      )
        fail("perfis_conflitantes");
    }
  }
}
function saveSettings(w, p, input) {
  const attendance = p.cards.attendance;
  const manager = p.cards.groupManager;
  const exceptions = {};
  if (input.exemptions) {
    for (const key of ["isentarAdmins", "isentarDono"])
      if (typeof input.exemptions[key] === "boolean")
        exceptions[key] = input.exemptions[key];
  }
  store.saveCard(w, p.id, "attendance", {
    configuration: {
      ...attendance.configuration,
      v4: normalizeIntelligence(
        input.intelligence || attendance.configuration?.v4,
      ),
    },
  });
  const nested = manager.configuration?.configuracao;
  store.saveCard(w, p.id, "groupManager", {
    configuration: {
      ...manager.configuration,
      ...exceptions,
      ...(nested ? { configuracao: { ...nested, ...exceptions } } : {}),
      v4: {
        ...normalizeModeration(input.moderation || manager.configuration?.v4),
        migrationVersion: 4,
        sourceRevision: manager.configuration?.v4?.sourceRevision || p.revision,
      },
    },
  });
}
function execute(operation, a) {
  if (operation === "universal_sessions") {
    store.reload();
    const sessions = new Map();
    for (const [workspaceId, ws] of Object.entries(store.state.workspaces))
      for (const p of Object.values(ws.profiles || {}))
        if (p.workspaceId === workspaceId && p.execution?.version === 4) {
          sessions.set(JSON.stringify([workspaceId, p.sessionId]), { workspaceId, sessionId: p.sessionId });
          if (sessions.size > 10000) fail("v4_scope_invalid");
        }
    return [...sessions.values()];
  }
  if (operation === "outbound_targets") {
    // Read-only, bounded result in the existing worker. No runtime activation,
    // replay, refund or new financial authority after a process restart.
    store.reload();
    const targets = new Map();
    for (const [workspaceId, ws] of Object.entries(store.state.workspaces))
      for (const row of Object.values(ws.claims || {})) {
        if (row.card !== "v4_outbound" || ["settled", "not_sent"].includes(row.stage) ||
            row.identity?.workspaceId !== workspaceId || row.identity?.origin !== "mensageiro_v4" ||
            row.identity?.destinationId !== row.groupId || !row.messageId) continue;
        const t = { workspaceId, profileId: row.profileId, sessionId: row.sessionId, groupId: row.groupId };
        targets.set(JSON.stringify(t), t);
        if (targets.size > 4096) fail("v4_ack_backpressure");
      }
    return [...targets.values()];
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(a.workspaceId || ""))
    fail("workspace_invalido");
  const w = a.workspaceId;
  store.reload();
  if (operation === "state") {
    const workspace = store.state.workspaces[w];
    return {
      profiles: Object.values(workspace?.profiles || {})
        .filter((p) => p.workspaceId === w)
        .map(lightProfile),
      schedules: Object.values(workspace?.schedules || {})
        .filter(
          (s) =>
            s.workspaceId === w &&
            workspace.profiles[s.profileId]?.workspaceId === w,
        )
        .map((s) => ({
          id: s.id,
          profileId: s.profileId,
          revision: s.revision,
          name: s.name,
          active: s.active,
          nextRunAt: s.nextRunAt,
          destinations: s.destinations,
          timezone: s.timezone,
        })),
    };
  }
  if (operation === "profile") return profile(w, a.profileId);
  if (operation === "authorize" || operation === "scheduled_authorize") {
    const p = store.state.workspaces[w]?.profiles[a.profileId];
    if (!p || p.workspaceId !== w || !p.active || p.sessionId !== a.sessionId ||
        p.revision !== a.expectedRevision || p.execution?.version !== 4 || !p.execution.activatedAt ||
        !cardActive(p, a.card)) return false;
    if (operation === "scheduled_authorize") {
      const s = store.getSchedule(w, a.scheduleId);
      return !!(s && s.profileId === p.id && s.active && s.revision === a.scheduleRevision && s.destinations.includes(a.destination));
    }
    return true;
  }
  if (operation === "schedules")
    return store
      .listSchedules(w, { includeInactive: true })
      .filter((s) => s.profileId === a.profileId);
  if (operation === "schedule")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (!a.remove)
        validateImages(
          a.input,
          a.scheduleId ? store.getSchedule(w, a.scheduleId)?.content : null,
        );
      if (a.scheduleId) {
        const s = store.getSchedule(w, a.scheduleId);
        if (!s || s.profileId !== p.id) fail("programacao_nao_encontrada");
        if (a.expectedRevision !== s.revision) fail("conflito_revisao");
        if (a.remove)
          return store.deleteSchedule(w, s.id, {
            expectedRevision: s.revision,
          });
        return store.updateSchedule(
          w,
          s.id,
          {
            ...scheduleInput(a.input, Date.now(), s),
            active:
              a.input.ativo === undefined ? s.active : a.input.ativo === true,
          },
          { expectedRevision: s.revision },
        );
      }
      const input = { ...a.input };
      delete input.nextRunAt;
      if (!["horario", "intervalo"].includes(input.tipo))
        fail("programacao_invalida");
      const normalized = scheduleInput(input);
      if (
        !normalized.nextRunAt ||
        Date.parse(normalized.nextRunAt) <= Date.now()
      )
        fail("programacao_passada");
      const s = store.createSchedule(w, p.id, {
        ...normalized,
        allowInactive: true,
      });
      return store.updateSchedule(
        w,
        s.id,
        { active: a.input.ativo === true },
        { expectedRevision: s.revision },
      );
    });
  if (operation === "save")
    return store.transaction(() => {
      const body = a.input;
      let p;
      if (a.universal === true && a.profileId && body.active === true &&
          profile(w, a.profileId).execution?.version !== 4 && body.confirmLegacyReview !== true)
        fail("legacy_review_required");
      if (a.profileId) {
        p = profile(w, a.profileId);
        if (body.expectedRevision !== p.revision) fail("conflito_revisao");
        p = store.updateProfile(w, p.id, {
          name: text(body.name, 100),
          sessionId: text(body.sessionId, 150),
          active: body.active === true,
          destinations: list(body.destinations || [], 100),
        });
      } else {
        p = store.createProfile({
          workspaceId: w,
          sessionId: text(body.sessionId, 150),
          name: text(body.name, 100),
        });
        p = store.updateProfile(w, p.id, {
          destinations: list(body.destinations || [], 100),
          active: false,
        });
      }
      if (!p.name) fail("nome_obrigatorio");
      saveSettings(w, p, body);
      if (a.universal === true) {
        const current = profile(w, p.id);
        const previous = current.execution;
        if (body.active === true && body.confirmActivation !== true) fail("activation_confirmation_required");
        if (body.active === true && !Object.values(current.cards).some(c => c.active)) fail("active_card_required");
        // This field is not accepted by V3 profile/card payloads. Only this
        // authenticated adoption transaction can create the send authority.
        store.state.workspaces[w].profiles[p.id].execution = { version: 4,
          activatedAt: body.active === true ? previous?.activatedAt || new Date().toISOString() : null };
      }
      conflict(w, profile(w, p.id));
      return lightProfile(profile(w, p.id));
    });
  if (operation === "migrate")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (a.strictRevision === true && a.expectedRevision !== p.revision) fail("conflito_revisao");
      if (p.cards.groupManager.configuration?.v4?.migrationVersion === 4)
        return { alreadyMigrated: true, profile: lightProfile(p) };
      if (a.expectedRevision !== p.revision) fail("conflito_revisao");
      saveSettings(w, p, {});
      return {
        alreadyMigrated: false,
        profile: lightProfile(profile(w, p.id)),
      };
    });
  if (operation === "duplicate")
    return store.transaction(() => {
      const original = profile(w, a.profileId);
      const p = store.createProfile({
        workspaceId: w,
        sessionId: original.sessionId,
        name: original.name + " — cópia",
      });
      store.updateProfile(w, p.id, {
        destinations: original.destinations,
        active: false,
      });
      if (a.universal === true) store.state.workspaces[w].profiles[p.id].execution = { version: 4, activatedAt: null };
      for (const card of CARDS) {
        const copy = JSON.parse(JSON.stringify(original.cards[card]));
        if (card === "commands" && copy.configuration?.comandos)
          copy.configuration.comandos = copy.configuration.comandos.map(
            (c) => ({ ...c, perfilId: p.id }),
          );
        store.saveCard(w, p.id, card, { ...copy, active: false });
      }
      // Schedules/claims/ACKs are intentionally never cloned or replayed.
      return lightProfile(profile(w, p.id));
    });
  if (operation === "card")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (p.revision !== a.expectedRevision) fail("conflito_revisao");
      if (!CARDS.includes(a.card)) fail("card_invalido");
      const current = p.cards[a.card];
      validateImages(a.configuration, current.configuration);
      const configuration = { ...current.configuration, ...a.configuration };
      // V4 migration metadata is only writable through the validated settings path.
      if (current.configuration?.v4)
        configuration.v4 = current.configuration.v4;
      else delete configuration.v4;
      store.saveCard(w, p.id, a.card, {
        active: a.active === true,
        configuration,
      });
      conflict(w, profile(w, p.id));
      return lightProfile(profile(w, p.id));
    });
  if (operation === "select") {
    const selected = selectProfile(store, {
      workspaceId: w,
      sessionId: a.sessionId,
      card: a.card,
      groupId: a.groupId,
    });
    return {
      ...selected,
      profile: selected.profileId ? profile(w, selected.profileId) : null,
    };
  }
  if (operation === "outbound_create")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      const parent = store.state.workspaces[w]?.claims[a.parentKey];
      if (!parent || parent.profileId !== p.id || parent.status !== "claimed" ||
          p.sessionId !== a.sessionId || !p.active ||
          a.identity?.workspaceId !== w || a.identity?.operationId !== a.key ||
          a.identity?.destinationId !== a.groupId || a.identity?.origin !== "mensageiro_v4")
        fail("outbound_scope_invalid");
      return store.claimExecution(w, a.key, { profileId: p.id, card: "v4_outbound",
        parentKey: a.parentKey, sessionId: a.sessionId, groupId: a.groupId,
        identity: a.identity, messageId: a.messageId, stage: "prepared" });
    });
  if (operation === "outbound_patch")
    return store.transaction(() => {
      const ws = store.state.workspaces[w], row = ws?.claims[a.key];
      if (!row || row.card !== "v4_outbound") fail("outbound_missing");
      const transitions = { prepared: ["send_started", "not_sent"],
        send_started: ["local_resolved", "ambiguous", "not_sent", "settled"], local_resolved: ["settled", "ambiguous"],
        ambiguous: ["settled"], settled: [], not_sent: [] };
      if (row.stage === a.stage || row.stage === "settled") return true;
      if (!transitions[row.stage]?.includes(a.stage)) fail("outbound_transition_invalid");
      if (a.messageId) {
        if (row.messageId && row.messageId !== a.messageId) fail("outbound_identity_changed");
        row.messageId = a.messageId;
      }
      if (a.stage === "settled" && !["delivery_ack", "read", "played"].includes(row.ack))
        fail("outbound_ack_required");
      row.stage = a.stage;
      // Preserve uncertain holds/claims from terminal-claim compaction.
      if (a.stage === "settled") { row.status = "confirmed"; row.completedAt = new Date().toISOString(); }
      if (a.stage === "not_sent") { row.status = "blocked"; row.completedAt = new Date().toISOString(); }
      store._touch(ws, "v4_outbound_state", { key: a.key, stage: a.stage });
      return true;
    });
  if (operation === "outbound_recover") {
    return Object.entries(store.state.workspaces[w]?.claims || {}).filter(([, row]) =>
      row.card === "v4_outbound" && row.profileId === a.profileId && row.sessionId === a.sessionId &&
      row.groupId === a.groupId && ["delivery_ack", "read", "played"].includes(row.ack) &&
      row.stage !== "settled").slice(0, 16).map(([key, row]) => ({ key, identity: row.identity }));
  }
  if (operation === "outbound_ack")
    return store.transaction(() => {
      if (!["delivery_ack", "read", "played"].includes(a.ack)) fail("outbound_ack_invalid");
      const ws = store.state.workspaces[w];
      const rows = Object.entries(ws?.claims || {}).filter(([, row]) =>
        row.card === "v4_outbound" && row.sessionId === a.sessionId &&
        row.profileId === a.profileId && row.groupId === a.groupId &&
        row.messageId === a.messageId && ["send_started", "local_resolved", "ambiguous"].includes(row.stage));
      if (rows.length > 1) fail("outbound_ack_ambiguous");
      return rows.map(([key, row]) => {
        if (!row.ack) {
          row.ack = a.ack; row.ackAt = new Date().toISOString();
          store._touch(ws, "v4_outbound_ack", { key, ack: a.ack });
        }
        return { key, identity: row.identity };
      });
    });
  if (operation === "claim")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (p.revision !== a.expectedRevision || !p.active) return false;
      return store.claimExecution(w, a.key, { profileId: p.id, card: a.card });
    });
  if (operation === "complete")
    return store.completeExecution(w, a.key, { status: a.status });
  fail("operacao_invalida");
}
parentPort.on("message", ({ id, operation, args }) => {
  try {
    parentPort.postMessage({ id, value: execute(operation, args) });
  } catch (error) {
    const code = String(error.code || error.message);
    parentPort.postMessage({
      id,
      error: /^[a-zA-Z0-9_:-]{1,100}$/.test(code)
        ? code
        : "v4_storage_indisponivel",
    });
  }
});
