"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  resolverSessaoAutorizadaParaExclusao,
  resolverAuthStoreSeguro,
  createSessionDeletionRegistry,
  createReconnectTimerRegistry,
  aguardarPendenciasZeradas,
  executarComTimeout
} = require("../modules/whatsapp/session-delete.service");
const {
  STATES,
  createSessionQuiescenceRegistry
} = require("../modules/whatsapp/session-quiescence.service");
const {
  enumerarSessoesReconexaoBoot
} = require("../modules/whatsapp/session-reconnect.service");

function normalizarSessaoId(clienteId, id = "sessao1") {
  const cliente = String(clienteId || "admin").trim();
  let sessao = String(id || "sessao1").trim();
  if (sessao.startsWith(`${cliente}_`)) sessao = sessao.slice(cliente.length + 1);
  sessao = sessao.replace(/^admin_/g, "");
  return `${cliente}_${sessao}`;
}

function fakeTimers() {
  let sequence = 0;
  const callbacks = new Map();
  const cleared = [];
  return {
    setTimeoutImpl(callback) {
      const id = ++sequence;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeoutImpl(id) {
      cleared.push(id);
      callbacks.delete(id);
    },
    run(id) {
      callbacks.get(id)?.();
    },
    callbacks,
    cleared
  };
}

async function executarExclusaoSintetica({
  sessionId,
  sessions,
  metadata,
  authPath,
  deletionRegistry,
  quiescenceRegistry,
  reconnectTimers
}) {
  const started = deletionRegistry.begin(sessionId);
  assert.equal(started.ok, true);
  metadata[sessionId] = { ...metadata[sessionId], ativo: false, status: "deleting", deleteEpoch: started.epoch };
  reconnectTimers.cancel(sessionId);
  const socket = sessions[sessionId] || null;
  delete sessions[sessionId];
  quiescenceRegistry.blockForDeletion(sessionId);
  if (socket?.end) await socket.end();
  const drain = await aguardarPendenciasZeradas({
    getPending: () => quiescenceRegistry.status(sessionId).pending,
    timeoutMs: 100,
    pollMs: 1
  });
  assert.equal(drain.ok, true);
  fs.rmSync(authPath, { recursive: true, force: true });
  assert.equal(fs.existsSync(authPath), false);
  assert.equal(quiescenceRegistry.discardAfterDeletion(sessionId).ok, true);
  delete metadata[sessionId];
  assert.equal(deletionRegistry.complete(sessionId, started.token).ok, true);
  return started;
}

async function main() {
  const sessoesMeta = {
    "user_a_Claro": { id: "user_a_Claro", workspaceId: "user_a", clienteId: "user_a" },
    "user_b_Claro": { id: "user_b_Claro", workspaceId: "user_b", clienteId: "user_b" }
  };

  const crossWorkspace = resolverSessaoAutorizadaParaExclusao({
    requestedId: "user_b_Claro",
    actorWorkspaceId: "user_a",
    actorRole: "cliente",
    sessoesMeta,
    normalizarSessaoId
  });
  assert.deepEqual(crossWorkspace, {
    ok: false,
    statusCode: 403,
    reason: "cross_workspace_session_delete_denied"
  });
  assert.ok(sessoesMeta["user_b_Claro"], "negação não pode alterar a sessão de B");

  const adminWithoutExplicitScope = resolverSessaoAutorizadaParaExclusao({
    requestedId: "user_b_Claro",
    actorWorkspaceId: "admin",
    actorRole: "admin_master",
    sessoesMeta,
    normalizarSessaoId
  });
  assert.equal(adminWithoutExplicitScope.ok, false);
  assert.equal(adminWithoutExplicitScope.reason, "cross_workspace_session_delete_denied");

  const adminAuthorized = resolverSessaoAutorizadaParaExclusao({
    requestedId: "user_b_Claro",
    actorWorkspaceId: "admin",
    actorRole: "admin_master",
    explicitTargetWorkspaceId: "user_b",
    explicitTargetSessionId: "user_b_Claro",
    sessoesMeta,
    normalizarSessaoId
  });
  assert.equal(adminAuthorized.ok, true);
  assert.equal(adminAuthorized.authorization, "admin_master_explicit");
  assert.equal(adminAuthorized.sessionId, "user_b_Claro");

  const ownAuthorized = resolverSessaoAutorizadaParaExclusao({
    requestedId: "Claro",
    actorWorkspaceId: "user_a",
    actorRole: "cliente",
    sessoesMeta,
    normalizarSessaoId
  });
  assert.equal(ownAuthorized.ok, true);
  assert.equal(ownAuthorized.sessionId, "user_a_Claro");
  assert.equal(ownAuthorized.authorization, "workspace_owner");

  assert.throws(() => resolverAuthStoreSeguro("/data", "../outro"), /session_id_invalid/);
  assert.throws(() => resolverAuthStoreSeguro("/data", "a/b"), /session_id_invalid/);
  assert.equal(resolverAuthStoreSeguro("/data", "user_a_Claro"), path.resolve("/data", "auth_user_a_Claro"));
  await assert.rejects(
    () => executarComTimeout(() => new Promise(() => {}), { timeoutMs: 2, timeoutCode: "session_socket_close_timeout" }),
    error => error.code === "session_socket_close_timeout"
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-delete-contract-"));
  const sessionId = "user_a_Claro";
  const authPath = resolverAuthStoreSeguro(tempRoot, sessionId);
  fs.mkdirSync(authPath, { recursive: true });
  fs.writeFileSync(path.join(authPath, "creds.json"), "synthetic-only");

  const deletionRegistry = createSessionDeletionRegistry();
  const quiescenceRegistry = createSessionQuiescenceRegistry();
  const clock = fakeTimers();
  const reconnectTimers = createReconnectTimerRegistry(clock);
  let reconnectCalls = 0;
  const reconnectTimer = reconnectTimers.schedule(sessionId, 1000, () => { reconnectCalls += 1; });
  assert.equal(reconnectTimers.has(sessionId), true);

  const socketEvents = new EventEmitter();
  let endCalls = 0;
  const socket = { ev: socketEvents, async end() { endCalls += 1; } };
  const sessions = { [sessionId]: socket, "user_b_Claro": { ev: new EventEmitter() } };
  const metadata = { [sessionId]: { id: sessionId, workspaceId: "user_a" }, "user_b_Claro": sessoesMeta["user_b_Claro"] };
  let oldCallbackCalls = 0;
  socketEvents.on("messages.upsert", () => {
    if (sessions[sessionId] !== socket || deletionRegistry.isBlocked(sessionId)) return;
    oldCallbackCalls += 1;
  });

  await executarExclusaoSintetica({
    sessionId,
    sessions,
    metadata,
    authPath,
    deletionRegistry,
    quiescenceRegistry,
    reconnectTimers
  });
  assert.equal(endCalls, 1, "sessão conectada deve encerrar somente seu socket");
  assert.equal(clock.cleared.includes(reconnectTimer), true, "timer agendado deve ser cancelado");
  clock.run(reconnectTimer);
  assert.equal(reconnectCalls, 0, "timer cancelado não pode ressuscitar a sessão");
  socketEvents.emit("messages.upsert", {});
  assert.equal(oldCallbackCalls, 0, "callback antigo deve ser neutralizado");
  assert.ok(sessions["user_b_Claro"], "outra sessão deve permanecer intacta");
  assert.ok(metadata["user_b_Claro"], "metadata de outro workspace deve permanecer intacta");

  const bootAfterDelete = enumerarSessoesReconexaoBoot({
    sessoesMeta: metadata,
    configSessoesWhatsapp: [],
    statusSessao: {},
    auditarAuth: () => ({ authValidaParaReconectar: false })
  });
  assert.equal(bootAfterDelete.some(item => item.sessaoId === sessionId && item.elegivel), false, "restart não pode ressuscitar sessão excluída");

  const recreate = deletionRegistry.releaseForRecreate(sessionId, {
    metadataExists: Boolean(metadata[sessionId]),
    authExists: fs.existsSync(authPath)
  });
  assert.equal(recreate.ok, true);
  assert.equal(deletionRegistry.isBlocked(sessionId), false);
  assert.equal(quiescenceRegistry.status(sessionId).state, STATES.ACTIVE, "mesmo ID deve receber tracker limpo");

  const disconnectedId = "user_a_Desconectada";
  const disconnectedAuth = resolverAuthStoreSeguro(tempRoot, disconnectedId);
  fs.mkdirSync(disconnectedAuth, { recursive: true });
  metadata[disconnectedId] = { id: disconnectedId, workspaceId: "user_a" };
  await executarExclusaoSintetica({
    sessionId: disconnectedId,
    sessions,
    metadata,
    authPath: disconnectedAuth,
    deletionRegistry,
    quiescenceRegistry,
    reconnectTimers
  });
  assert.equal(metadata[disconnectedId], undefined, "sessão desconectada também deve ser removida");

  const failedId = "admin_Radar Zap Claro";
  const failedAuth = resolverAuthStoreSeguro(tempRoot, failedId);
  fs.mkdirSync(failedAuth, { recursive: true });
  metadata[failedId] = { id: failedId, workspaceId: "admin" };
  const failedRequest = quiescenceRegistry.request(failedId);
  quiescenceRegistry.trackerFor(failedId).fail("socket_close_not_proven");
  assert.equal(quiescenceRegistry.status(failedId).state, STATES.FAILED);
  await executarExclusaoSintetica({
    sessionId: failedId,
    sessions,
    metadata,
    authPath: failedAuth,
    deletionRegistry,
    quiescenceRegistry,
    reconnectTimers
  });
  assert.equal(failedRequest.epoch, 1);
  assert.equal(quiescenceRegistry.status(failedId).state, STATES.ACTIVE, "registry FAILED antigo deve ser descartado após exclusão");

  const healthyId = "user_b_Saudavel";
  const healthyTimer = reconnectTimers.schedule(healthyId, 1000, () => { reconnectCalls += 1; });
  assert.equal(reconnectTimers.has(healthyId), true);
  assert.equal(deletionRegistry.isBlocked(healthyId), false);
  assert.equal(quiescenceRegistry.status(healthyId).state, STATES.ACTIVE);
  clock.run(healthyTimer);
  assert.equal(reconnectCalls, 1, "reconexão normal de sessão não excluída deve continuar");

  const incompleteId = "user_a_Incompleta";
  const incompleteDelete = deletionRegistry.begin(incompleteId);
  assert.equal(incompleteDelete.ok, true);
  deletionRegistry.fail(incompleteId, incompleteDelete.token, "auth_store_delete_not_confirmed");
  assert.equal(deletionRegistry.isBlocked(incompleteId), true, "falha parcial deve permanecer fail-closed");
  assert.equal(deletionRegistry.releaseForRecreate(incompleteId, { metadataExists: false, authExists: false }).ok, false);

  const dirtyRecreateId = "user_a_Dirty";
  const dirtyDelete = deletionRegistry.begin(dirtyRecreateId);
  assert.equal(deletionRegistry.complete(dirtyRecreateId, dirtyDelete.token).ok, true);
  assert.equal(deletionRegistry.releaseForRecreate(dirtyRecreateId, { metadataExists: true, authExists: false }).ok, false);
  assert.equal(deletionRegistry.releaseForRecreate(dirtyRecreateId, { metadataExists: false, authExists: true }).ok, false);
  assert.equal(deletionRegistry.releaseForRecreate(dirtyRecreateId, { metadataExists: false, authExists: false }).ok, true);

  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const deleteStart = indexSource.indexOf('app.delete("/sessoes/:id"');
  const deleteEnd = indexSource.indexOf('app.post("/reset/:id"', deleteStart);
  const deleteRoute = indexSource.slice(deleteStart, deleteEnd);
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  assert.ok(deleteRoute.includes("resolverSessaoAutorizadaParaExclusao"));
  assert.ok(deleteRoute.includes("cancelarTimerReconexaoWhatsapp(id)"));
  assert.ok(deleteRoute.includes("whatsappQuiescence.blockForDeletion(id)"));
  assert.ok(deleteRoute.includes("whatsappQuiescence.discardAfterDeletion(id)"));
  assert.ok(deleteRoute.includes("resolverAuthStoreSeguro"));
  assert.equal(deleteRoute.includes("idsPossiveis"), false, "ID bruto não pode voltar ao contrato destrutivo");
  assert.equal(deleteRoute.includes("sock.logout"), false, "exclusão local não deve executar logout destrutivo remoto");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("whatsapp-session-delete-contract.test.cjs OK");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
