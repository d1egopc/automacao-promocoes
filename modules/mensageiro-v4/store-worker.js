"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { V3Store } = require("../mensageiro-v3/src/v3/store");
const { selectProfile } = require("../mensageiro-v3/operational-gates");
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
  const p = store.getProfile(w, id);
  if (!p || p.id !== id || p.workspaceId !== w) fail("perfil_nao_encontrado");
  return p;
};
function conflict(w, p) {
  if (!p.active) return;
  for (const other of store.listProfiles(w)) {
    if (other.id === p.id || !other.active || other.sessionId !== p.sessionId)
      continue;
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
      conflict(w, profile(w, p.id));
      return lightProfile(profile(w, p.id));
    });
  if (operation === "migrate")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
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
