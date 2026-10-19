"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const history = require("../modules/engine/universal-history.repository");
const { normalizarDestinosAplicaveis } = require("../modules/engine/universal-queue-distributor.adapter");

(async () => {
  const partial = history.commercialStatus([{ status: "sent" }, { status: "failed" }]);
  assert.equal(partial.status, "partial");
  assert.equal(partial.sent.length, 1, "partial conta como enviada por possuir ACK");
  assert.equal(Boolean(partial.status), true, "partial conta em finalizadas");
  assert.equal(history.commercialStatus([{ status: "sent" }]).status, "sent");
  assert.equal(history.commercialStatus([{ status: "failed" }]).status, "error");
  assert.equal(history.commercialStatus([{ status: "skipped" }]), null);
  assert.equal(history.commercialStatus([{ status: "discarded_without_replay" }]), null);
  assert.equal(history.commercialStatus([{ status: "expired" }]), null);

  const destination = { id: "dest-1", nome: "Ofertas VIP", canal: "whatsapp",
    alvos: [{ id: "grupo-1", nome: "Grupo A" }] };
  const snapshot = normalizarDestinosAplicaveis([destination]);
  destination.nome = "Nome alterado";
  destination.alvos[0].nome = "Grupo alterado";
  assert.equal(snapshot[0].destinationNameSnapshot, "Ofertas VIP");
  assert.equal(snapshot[0].targetLabelSnapshot, "Grupo A");

  const projectionQueries = [];
  const client = { query: async (sql, params = []) => {
    projectionQueries.push({ sql, params });
    if (/FROM engine_universal_queue_items/.test(sql)) return { rows: [{
      id: 91, workspace_id: "w1", item_payload: { titulo: "Produto",
        marketplace: "amazon", precoAtual: "R$ 10" }, status: "partial",
      terminal_at: "2026-10-13T12:00:00.000Z", origem_fluxo: "radar"
    }] };
    if (/FROM engine_universal_queue_destinations/.test(sql)) return { rows: [
      { destination_id: "d1", target_key: "g1", channel: "whatsapp",
        status: "sent", provider_message_id: "ack-1",
        confirmed_at: "2026-10-13T12:00:01.000Z",
        destination_name_snapshot: "VIP", target_label_snapshot: "Grupo 1" },
      { destination_id: "d2", target_key: "g2", channel: "telegram",
        status: "failed", terminal_reason: "provider_rejected",
        terminal_evidence: "provider_no_effect_confirmed",
        destination_name_snapshot: "Alertas", target_label_snapshot: "Canal 2" }
    ] };
    if (/INSERT INTO engine_history_items/.test(sql)) return { rows: [{ history_id: 501 }] };
    if (/INSERT INTO engine_history_targets/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error("consulta inesperada no fake");
  } };
  const projected = await history.projectUniversalTerminalTx(client,
    { queueItemId: 91, workspaceId: "w1" });
  assert.deepEqual(projected, { projected: true, duplicate: false, historyId: 501 });
  const itemInsert = projectionQueries.find(call => /INSERT INTO engine_history_items/.test(call.sql));
  assert.equal(itemInsert.params[8], "partial");
  assert.equal(itemInsert.params[10], 1, "partial preserva um ACK");
  assert.equal(itemInsert.params[11], 1, "partial preserva uma falha");
  const targetInserts = projectionQueries.filter(call => /INSERT INTO engine_history_targets/.test(call.sql));
  assert.equal(targetInserts.length, 2);
  assert.equal(targetInserts[0].params[8], "ack-1");
  assert.equal(targetInserts[1].params[8], "", "falha nunca inventa ACK");

  const preUniversalCalls = [];
  const prePool = { query: async (sql, params) => {
    preUniversalCalls.push({ sql, params });
    return { rows: [{ history_id: 700 }] };
  } };
  const pre = await history.projectPreUniversalTerminalError({ pool: prePool,
    job: { id: 33, cliente_id: "w1", marketplace: "magalu",
      metadata: { comercialCapturado: { titulo: "Produto sem imagem" } } },
    reason: "sem_imagem_apos_retries", stage: "importacao_final",
    terminalAt: new Date().toISOString() });
  assert.equal(pre.projected, true);
  assert.equal(preUniversalCalls.length, 1);
  const missingMarker = await history.projectPreUniversalTerminalError({ pool: prePool,
    job: { id: 35, cliente_id: "w1", marketplace: "magalu",
      metadata: { comercialCapturado: { titulo: "Sem marco" } } },
    reason: "sem_imagem_apos_retries", stage: "importacao_final" });
  assert.deepEqual(missingMarker, { projected: false, reason: "terminal_fact_missing" });
  assert.equal(preUniversalCalls.length, 1, "sem marco terminal não inventa data nem grava histórico");
  const expiredMarker = await history.projectPreUniversalTerminalError({ pool: prePool,
    job: { id: 36, cliente_id: "w1", marketplace: "magalu",
      metadata: { comercialCapturado: { titulo: "Marco antigo" } } },
    reason: "sem_imagem_apos_retries", stage: "importacao_final",
    terminalAt: new Date(Date.now() - (192 * 60 * 60 * 1000 + 1_000)).toISOString() });
  assert.deepEqual(expiredMarker, { projected: false, reason: "terminal_fact_expired" });
  assert.equal(preUniversalCalls.length, 1, "marco expirado não grava histórico");
  const retry = await history.projectPreUniversalTerminalError({ pool: prePool,
    job: { id: 34, cliente_id: "w1" }, reason: "retry",
    stage: "importacao_retry_agendado" });
  assert.deepEqual(retry, { projected: false,
    reason: "pre_universal_not_safely_classified" });
  assert.equal(preUniversalCalls.length, 1, "retry intermediario nao gera Historico");

  const calls = [];
  const pool = { query: async (sql, params = []) => {
    calls.push(sql);
    if (/count\(\*\)::int AS finalized/.test(sql)) {
      return { rows: [params[0] === "w-other"
        ? { finalized: 0, sent: 0, partial: 0, errors: 0 }
        : { finalized: 3, sent: 2, partial: 1, errors: 1 }] };
    }
    return { rows: [{ history_id: 7, thumbnail_url: "thumb", title: "Produto", price_text: "R$ 10", marketplace: "amazon", category: "Casa", commercial_status: "partial", total_targets: 2, sent_targets: 1, failed_targets: 1, destination_summary: "2 destinos", channels: ["whatsapp"], finalized_at: new Date().toISOString() }] };
  } };
  const listed = await history.listHistory({ pool, workspaceId: "w1", period: "hoje" });
  assert.deepEqual(listed.summary, { finalized: 3, sent: 2, partial: 1, errors: 1, sendRate: 2 / 3 });
  assert.equal(listed.items[0].status, "partial");
  assert.equal(calls.some(sql => /FROM engine_history_targets/.test(sql)), false,
    "listagem sem filtro nao carrega targets/ACKs");
  const isolatedSummary = await history.historicoResumo({ pool, workspace: "w-other", periodo: "hoje" });
  assert.deepEqual(isolatedSummary, { finalized: 0, sent: 0, partial: 0, errors: 0, sendRate: 0 },
    "resumo isola o workspace");

  const schema = fs.readFileSync(path.join(__dirname, "../modules/engine/universal-history.additive.sql"), "utf8");
  assert.match(schema, /commercial_status IN \('sent','partial','error'\)/);
  assert.match(schema, /status='sent' AND confirmed_at IS NOT NULL/);
  assert.match(schema, /commercial_status='error' AND sent_targets=0/);
  assert.match(schema, /destination_name_snapshot/);
  assert.doesNotMatch(schema, /INSERT\s+INTO\s+engine_history/i,
    "migration não executa backfill");

  const contract = fs.readFileSync(path.join(__dirname,
    "../docs/contracts/HISTORY.md"), "utf8");
  assert.match(contract, /HISTORY_BACKFILL=false/);
  assert.match(contract, /começa no epoch\/cutover/);

  const repoSource = fs.readFileSync(path.join(__dirname, "../modules/engine/universal-history.repository.js"), "utf8");
  const listStart = repoSource.indexOf("async function listHistory");
  const detailStart = repoSource.indexOf("async function historyDetail");
  assert.equal(repoSource.slice(listStart, detailStart).includes("engine_universal_queue"), false,
    "Historico nao consulta fila viva");
  assert.match(repoSource.slice(detailStart), /FROM engine_history_targets/,
    "detalhe carrega targets sob demanda");
  const summaryStart = repoSource.indexOf("async function historicoResumo");
  assert.match(repoSource.slice(summaryStart, listStart), /commercial_status IN \('sent','partial'\)/,
    "Enviadas soma sent + partial na autoridade única");

  const indexSource = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.match(indexSource, /app\.get\("\/historico"/);
  assert.match(indexSource, /app\.get\("\/historico\/resumo"/);
  assert.match(indexSource, /app\.get\("\/historico\/:historyId"/);
  const summaryRouteStart = indexSource.indexOf('app.get("/historico/resumo"');
  const detailRouteStart = indexSource.indexOf('app.get("/historico/:historyId"');
  assert(summaryRouteStart >= 0 && summaryRouteStart < detailRouteStart,
    "resumo deve preceder a rota parametrizada do detalhe");
  assert.doesNotMatch(indexSource.slice(summaryRouteStart, detailRouteStart), /fila|engine_universal_queue|engine_history_targets/,
    "resumo nao consulta fila viva nem materializa itens/targets");
  console.log("historico definitivo v1: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
