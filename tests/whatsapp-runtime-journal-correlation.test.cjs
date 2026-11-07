"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { operationalRef } = require("../modules/telemetria/operational-ref");
const { createIngressBoundaryObservation, resolveConfiguredObservationGroups } = require("../modules/whatsapp/ingress-boundary-observation");

test("runtime and journal share one opaque session reference without exposing identity", () => {
  const workspace = "tenant_a";
  const session = "tenant_a_private_phone";
  const expected = operationalRef("session", workspace, session);
  const records = [];
  const observer = createIngressBoundaryObservation({
    journal: { append: row => records.push(row), open: async () => {}, status: () => ({ available: true, retentionMs: 900000 }) },
    resolveContinuousScope: () => ({ verified: true, groupIds: ["120363400000000001@g.us"] })
  });
  observer.startContinuous();
  const ev = { emit() {} };
  const sock = { ev, ws: { emit() {} }, __optimusListeners: { "messages.upsert": { emissor: ev, evento: "messages.upsert", handler() {} } } };
  observer.trackSocket({ workspaceId: workspace, sessionId: session, sock, generation: 1 });
  observer.mark("callback", { workspaceId: workspace, sessionId: session, sock, emitter: ev, current: true,
    messages: [{ key: { remoteJid: "120363400000000001@g.us", id: "message-private" } }], upsertType: "notify" });
  observer.mark("clonador_result", { workspaceId: workspace, sessionId: session, sock, emitter: ev,
    message: { key: { remoteJid: "120363400000000001@g.us", id: "message-private" } },
    decision: "accepted", reason: "accepted" });
  assert.equal(records.find(row => row.stage === "callback")?.sessionRef, expected);
  assert.equal(records.find(row => row.stage === "clonador_result")?.decision, "accepted");
  assert.match(expected, /^[a-f0-9]{16}$/);
  assert.ok(!JSON.stringify(records).includes(session));
  assert.ok(!JSON.stringify(records).includes("message-private"));
});

test("clonador-only sources join the observer scope without broadening other workspaces", () => {
  const actualGroupIds = ["120363400000000001@g.us", "120363400000000002@g.us"];
  const common = { workspaceId: "tenant_a", sessionId: "wa_a", sessionBelongsToWorkspace: true,
    sessionWorkspaceId: "tenant_a", actualGroupIds, radarConfig: { monitoramentoAtivo: false }, messengerProfiles: [] };
  assert.deepEqual(resolveConfiguredObservationGroups({ ...common, clonadorSources: [
    { clienteId: "tenant_a", sessaoId: "wa_a", grupoJid: actualGroupIds[0], ativo: true },
    { clienteId: "tenant_b", sessaoId: "wa_a", grupoJid: actualGroupIds[1], ativo: true },
    { clienteId: "tenant_a", sessaoId: "wa_b", grupoJid: actualGroupIds[1], ativo: true }
  ] }), [actualGroupIds[0]]);
  assert.deepEqual(resolveConfiguredObservationGroups({ ...common, clonadorSources: [
    { clienteId: "tenant_a", sessaoId: "wa_a", grupoJid: "120363499999999999@g.us", ativo: true }
  ] }), []);
});

test("session references are isolated by workspace and rotate only with process authority", () => {
  const session = "shared_label";
  assert.equal(operationalRef("session", "tenant_a", session), operationalRef("session", "tenant_a", session));
  assert.notEqual(operationalRef("session", "tenant_a", session), operationalRef("session", "tenant_b", session));
  assert.equal(operationalRef("session", "tenant_a", ""), null);
});
