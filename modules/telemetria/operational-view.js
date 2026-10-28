"use strict";

const crypto = require("node:crypto");
const telemetry = require("./telemetria.service");
const admin = require("../observabilidade/admin.service");
const { queryEngineShadow } = require("../engine/database");
const salt = crypto.randomBytes(32);
const ref = (value) =>
  value
    ? crypto
        .createHmac("sha256", salt)
        .update(String(value))
        .digest("hex")
        .slice(0, 16)
    : null;
const code = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) &&
  !/tel_|bearer|eyJ[A-Za-z0-9_-]+\.|secret|password|senha/i.test(value)
    ? value
    : null;
const stamp = (value) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toISOString()
    : null;
const rows = (result) =>
  result?.ok && Array.isArray(result.resultado?.rows)
    ? result.resultado.rows
    : [];
const evidence = (source, state, reason, at = null, extra = {}) => ({
  source,
  state,
  reason,
  at: stamp(at),
  ...extra,
});
const tenant = (query, scope) =>
  scope.tipo === "workspace" ? scope.clienteId : query.clienteId || null;

// Closed projection for delegated diagnostics. No arbitrary metadata, URL,
// message text, e-mail, JID, destination address, or integration configuration.
function project(value, key = "", depth = 0) {
  if (depth > 8) return undefined;
  if (value instanceof Date) return stamp(value);
  if (Array.isArray(value))
    return value.slice(0, 200).map((item) => project(item, key, depth + 1));
  if (!value || typeof value !== "object") {
    if (
      value == null ||
      typeof value === "boolean" ||
      typeof value === "number"
    )
      return value;
    if (
      /Em$|At$|timestamp|criado_em|ocorrido_em|atualizado_em|expiraEm/.test(key)
    )
      return stamp(value);
    return code(String(value));
  }
  const allowed = new Set([
    "ok",
    "readOnly",
    "state",
    "status",
    "statusTelemetria",
    "reason",
    "motivo",
    "erro",
    "fonte",
    "source",
    "at",
    "geradoEm",
    "janelaMinutos",
    "limit",
    "items",
    "cursorProximo",
    "eventoId",
    "jobId",
    "ofertaId",
    "processamentoId",
    "clienteId",
    "marketplace",
    "etapa",
    "origem",
    "origemTipo",
    "capturadoEm",
    "criadoEm",
    "atualizadoEm",
    "criadaEm",
    "atualizadaEm",
    "timestamp",
    "tentativas",
    "radar",
    "pipeline",
    "workspaces",
    "marketplaces",
    "eventos",
    "ofertas",
    "envios",
    "bloqueios",
    "jobs",
    "importer",
    "ofertaUniversal",
    "eventosComerciais",
    "estado",
    "filaAlvo",
    "pressaoViva",
    "capacidade",
    "enviados",
    "disponivel",
    "indisponivel",
    "eventosRecentes",
    "ultimaCapturaEm",
    "total",
    "categoria",
    "score",
    "semantica",
    "jobsVivos",
    "jobsVivosFrescos",
    "backlogOperacional",
    "circulaveis",
    "processando",
    "importando",
    "emCurso",
    "autoClean",
    "fontes",
    "escopo",
    "tipo",
    "origemPipeline",
    "linkId",
  ]);
  const out = {};
  for (const field of [
    "links",
    "dominioOriginal",
    "dominioFinal",
    "redirectOk",
    "motivoRedirect",
    "cobertura",
    "evento",
    "comerciais",
    "destinoRef",
    "filaItemRef",
  ])
    allowed.add(field);
  for (const [field, item] of Object.entries(value)) {
    if (!allowed.has(field)) continue;
    const safe = project(item, field, depth + 1);
    if (safe !== undefined) out[field] = safe;
  }
  return out;
}

function createOperationalView({
  query = (sql, params) =>
    queryEngineShadow(sql, params, { timeoutSqlMs: 2000 }),
  getRuntime = () => [],
  getUsers = () => [],
  getProbeStatus,
  validateProbeTarget,
  startProbe,
  stopProbe,
} = {}) {
  function probe(scope = { tipo: "plataforma" }) {
    if (scope.tipo === "workspace" && scope.clienteId !== "admin")
      return {
        available: false,
        state: "INDISPONIVEL",
        reason: "outside_authorized_workspace",
      };
    if (!getProbeStatus || !validateProbeTarget)
      return {
        available: false,
        state: "INDISPONIVEL",
        reason: "probe_adapter_unavailable",
      };
    const target = validateProbeTarget();
    const socket = target.socket;
    const record = socket?.__optimusListeners?.["messages.upsert"];
    let attachment = null;
    try {
      if (record && typeof socket?.ev?.listeners === "function")
        attachment = socket.ev
          .listeners("messages.upsert")
          .includes(record.handler);
    } catch {
      /* unknown remains unknown */
    }
    const report = getProbeStatus();
    return {
      available: true,
      readOnly: true,
      observedAt: new Date().toISOString(),
      preflight: {
        valid: target.ok === true,
        reason:
          code(target.reason) ||
          (target.ok ? "binding_validated" : "binding_unavailable"),
        socket: target.ok ? "COMPROVADO" : "DESCONHECIDO",
        listenerRegistration: record ? "COMPROVADO" : "DESCONHECIDO",
        physicalAttachment:
          attachment === null
            ? "DESCONHECIDO"
            : attachment
              ? "COMPROVADO"
              : "INDISPONIVEL",
        socketRef: ref(socket && target.sessionId),
        generation: Number(target.generation) || null,
      },
      report,
      limits: report?.profile === "sensor24h"
        ? { durationMs: 86400000, maxEvents: 32, maxInspected: 10000 }
        : { durationMs: 300000, maxEvents: 10 },
      coverage:
        "Only the authorized group; zero records do not prove absence at WhatsApp transport.",
    };
  }
  function controlProbe(action) {
    if (action === "stop")
      return stopProbe
        ? stopProbe()
        : { ok: false, reason: "probe_adapter_unavailable" };
    const target = validateProbeTarget?.();
    if (!target?.ok)
      return {
        ok: false,
        reason: code(target?.reason) || "binding_unavailable",
      };
    // Existing validator calls the socket 'socket'; existing observer accepts 'sock'.
    return startProbe({
      ...target,
      sock: target.socket,
      scopeValidated: true,
      listenerRegistered: true,
    });
  }
  async function snapshot(filters = {}, scope = {}) {
    const client = tenant(filters, scope);
    const window = Math.min(
      60,
      Math.max(1, Number(filters.janelaMinutos) || 15),
    );
    const at = new Date().toISOString();
    const [events, ingress, workers] = await Promise.all([
      telemetry.consultarEventosTelemetria({
        ...filters,
        clienteId: client,
        escopo: scope,
        janelaMinutos: window,
        limit: 50,
        query,
      }),
      query(
        `/* telemetry_operational_ingress */ SELECT id::text AS id, origem_tipo, origem, marketplace_detectado, capturado_em
        FROM engine_eventos_brutos e WHERE capturado_em >= NOW() - ($1::int * INTERVAL '1 minute')
        AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id=e.id AND j.cliente_id=$2))
        AND ($3::text IS NULL OR marketplace_detectado=$3)
        ORDER BY capturado_em DESC, id DESC LIMIT 100`,
        [window, client, filters.marketplace || null],
      ),
      client || (filters.marketplace && filters.marketplace !== "magalu")
        ? Promise.resolve({ ok: false })
        : query(
            `/* telemetry_operational_workers */ SELECT id::text AS id, status, capability, attempts, updated_at
        FROM local_worker_tasks WHERE marketplace='magalu' AND capability='magalu_identity_v1'
        AND updated_at >= NOW() - ($1::int * INTERVAL '1 minute') ORDER BY id DESC LIMIT 20`,
            [window],
          ),
    ]);
    const ingressRows = rows(ingress);
    const motors = ["radar", "teleradar", "clonador"].map((motor) => {
      const matches = ingressRows.filter((row) => {
        const source =
          `${row.origem_tipo || ""} ${row.origem || ""}`.toLowerCase();
        return motor === "radar"
          ? /whatsapp|radar/.test(source) &&
              !/telegram|teleradar|clonador/.test(source)
          : motor === "teleradar"
            ? /telegram|teleradar/.test(source)
            : /clonador/.test(source);
      });
      return {
        motor,
        ...evidence(
          "engine_eventos_brutos; bounded sample",
          ingress.ok
            ? matches.length
              ? "COMPROVADO"
              : "NAO_OBSERVADO"
            : "INDISPONIVEL",
          ingress.ok
            ? matches.length
              ? "persisted_ingress"
              : "no_correlated_record_in_sample"
            : "source_unavailable",
          matches[0]?.capturado_em,
          {
            sampleCount: matches.length,
            latestEventId: matches[0]?.id || null,
            callback: "DESCONHECIDO",
          },
        ),
      };
    });
    let runtime = [],
      runtimeAvailable = true;
    try {
      runtime = getRuntime(client)
        .slice(0, 100)
        .filter((item) => !client || item.workspaceId === client)
        .map((item) => ({
          workspaceId: code(item.workspaceId),
          sessionRef: ref(item.sessionId),
          source: "current_socket + sessoesMeta in memory",
          ownershipSource: "session_metadata_loaded_from_persistence",
          workspaceCapturedByCallback: "DESCONHECIDO",
          observedAt: at,
          state: item.socketPresent === true ? "COMPROVADO" : "DESCONHECIDO",
          status: code(item.status),
          generation: Number(item.generation) || null,
          socketPresent: item.socketPresent === true,
          listenerRegistered: item.listenerRegistered === true,
          physicalAttachment:
            typeof item.attachmentVerified === "boolean"
              ? item.attachmentVerified
              : null,
        }));
    } catch {
      runtime = [];
      runtimeAvailable = false;
    }
    const probeState = probe(
      client ? { tipo: "workspace", clienteId: client } : scope,
    );
    if (probeState.report?.counters?.callbackCalls > 0) {
      const radar = motors.find((m) => m.motor === "radar");
      radar.callback = "COMPROVADO";
      radar.callbackEvidence = evidence(
        "radar ingress-observation-v1; authorized tuple only",
        "COMPROVADO",
        "callback_counter",
        probeState.report.startedAt,
      );
    }
    const rioEvent = (events.items || []).find((e) =>
      /executor|fila|destino|ack|distribu/.test(e.etapa || ""),
    );
    return {
      ok: true,
      readOnly: true,
      generatedAt: at,
      workspace: client,
      windowMinutes: window,
      coverage: {
        sampleLimit: 100,
        eventLimit: 50,
        workerLimit: 20,
        absenceIsNotTransportProof: true,
      },
      motors,
      runtime,
      runtimeEvidence: evidence(
        "current socket/status in memory; ownership from session metadata, not callback ingress",
        runtimeAvailable
          ? runtime.length
            ? "COMPROVADO"
            : "NAO_OBSERVADO"
          : "INDISPONIVEL",
        runtimeAvailable
          ? "scoped_session_inventory"
          : "runtime_adapter_failed",
        at,
      ),
      events: project(events),
      magaluWorker: {
        ...evidence(
          "local_worker_tasks (platform shared; no tenant ownership column)",
          client
            ? "INDISPONIVEL"
            : workers.ok
              ? rows(workers).length
                ? "COMPROVADO"
                : "NAO_OBSERVADO"
              : "INDISPONIVEL",
          client
            ? "shared_worker_requires_event_correlation"
            : workers.ok
              ? "bounded_task_sample"
              : "source_unavailable",
        ),
        tasks: rows(workers).map((row) => ({
          taskId: String(row.id),
          status: code(row.status),
          capability: code(row.capability),
          attempts: Number(row.attempts) || 0,
          at: stamp(row.updated_at),
        })),
        identity: "DESCONHECIDO",
        affiliation: "DESCONHECIDO",
        note: "Task completion alone proves neither product identity nor workspace affiliation.",
      },
      rio: evidence(
        "engine_eventos_comerciais via existing telemetry",
        events.ok
          ? rioEvent
            ? "COMPROVADO"
            : "NAO_OBSERVADO"
          : "INDISPONIVEL",
        events.ok
          ? "consult_event_stages_for_job_destination_send_ack"
          : "source_unavailable",
        rioEvent?.timestamp,
      ),
      probe: probeState,
    };
  }
  async function workspaces(filters, scope) {
    const client = tenant(filters, scope);
    const users = getUsers()
      .filter((u) => !client || String(u.id || u.clienteId) === client)
      .slice(0, 100);
    const result = await admin.buscarWorkspacesObservabilidade({
      usuarios: users,
      query,
      limit: 100,
      janelaMinutos: 15,
    });
    return {
      ok: result.ok,
      source: "users_memory + existing observability query",
      at: new Date().toISOString(),
      workspaces: (result.workspaces || []).map((w) => ({
        clienteId: w.clienteId,
        state: code(w.saudeOperacional?.status),
        active: w.ativo !== false,
      })),
    };
  }
  async function problems(filters, scope) {
    const result = await admin.consultarProblemasObservabilidade({
      ...filters,
      query,
      clienteId: tenant(filters, scope),
      limit: 50,
      janelaMinutos: 15,
    });
    return {
      ok: result.ok,
      source: "existing admin observability",
      at: new Date().toISOString(),
      problems: (result.problemas || []).slice(0, 50).map((p) => ({
        motivo: code(p.motivoCodigo || p.motivo),
        etapa: code(p.tipoEvento || p.etapa),
        marketplace: code(p.marketplace),
        quantidade: Number(p.total || p.quantidade) || 0,
        at: stamp(
          p.ultimoOcorridoEm || p.ultimaOcorrenciaEm || p.ultimoEventoEm,
        ),
      })),
    };
  }
  async function trace(type, id, filters, scope) {
    if (!["evento", "job", "oferta"].includes(type) || !/^\d{1,20}$/.test(id))
      return { ok: false, erro: "identificador_invalido" };
    const client = tenant(filters, scope);
    let eventId = id;
    if (type !== "evento") {
      const sql =
        type === "job"
          ? "SELECT evento_id::text AS id FROM engine_jobs_cliente WHERE id=$1 AND ($2::text IS NULL OR cliente_id=$2) LIMIT 1"
          : "SELECT o.evento_id::text AS id FROM engine_ofertas o WHERE o.id=$1 AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM engine_jobs_cliente j WHERE j.oferta_id=o.id AND j.cliente_id=$2)) LIMIT 1";
      eventId = rows(await query(sql, [id, client]))[0]?.id;
      if (!eventId)
        return {
          ok: true,
          state: "NAO_OBSERVADO",
          reason: "identifier_unavailable_in_scope",
        };
    }
    const original = await telemetry.consultarRastreioTelemetria(eventId, {
      query,
      closedMetadata: true,
      escopo: client ? { tipo: "workspace", clienteId: client } : scope,
    });
    original.eventosComerciais = (original.eventosComerciais || []).map(
      (item) => ({
        ...item,
        destinoRef: item.destinoId
          ? ref(`${item.clienteId}:${item.destinoId}`)
          : null,
        filaItemRef: item.filaItemId
          ? ref(`${item.clienteId}:${item.filaItemId}`)
          : null,
      }),
    );
    const result = project(original);
    if (original.statusTelemetria !== "disponivel") return result;
    const oneLink = (original.links || []).some(
      (link) =>
        link.dominioOriginal === "magazineluiza.onelink.me" ||
        link.original?.dominio === "magazineluiza.onelink.me",
    );
    const worker = oneLink
      ? await query(
          `/* telemetry_event_worker_correlation */ SELECT id::text AS id, status, capability, attempts, updated_at,
      (result_metadata->>'identidadeValidada')='true' AS identity_validated,
      COALESCE(result_metadata->>'motivo', result_metadata->>'reason', result_metadata->>'errorCode') AS reason
      FROM local_worker_tasks WHERE marketplace='magalu' AND capability='magalu_identity_v1'
      AND source_url IN (SELECT url_original FROM engine_links WHERE evento_id=$1)
      AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id=$1 AND j.cliente_id=$2))
      ORDER BY id DESC LIMIT 10`,
          [eventId, client],
        )
      : { ok: true, resultado: { rows: [] } };
    const metadata = [
      ...(original.ofertaUniversal || []).map((o) => o.metadata),
      ...(original.jobs || []).map((j) => j.metadata),
      ...(original.importer || []).map((p) => p.detalhes),
    ]
      .filter(Boolean)
      .slice(0, 400);
    const conversion = metadata
      .map((m) => m.provaAfiliado || m.afiliacaoWorkspace)
      .find((p) => p && typeof p.conversaoStatus === "string");
    const identityTask = rows(worker).find(
      (t) => t.status === "completed" && t.identity_validated === true,
    );
    const selected = metadata.some((m) => m.adapter === "magalu");
    return {
      ...result,
      magalu: {
        oneLink: evidence(
          "engine_links.dominio_original",
          oneLink ? "COMPROVADO" : "NAO_OBSERVADO",
          oneLink ? "onelink_recorded" : "no_onelink_in_event",
          original.origem?.capturadoEm,
        ),
        worker: evidence(
          "local_worker_tasks.source_url = engine_links.url_original",
          worker.ok
            ? rows(worker).length
              ? "COMPROVADO"
              : "NAO_OBSERVADO"
            : "INDISPONIVEL",
          "exact_url_correlation_only",
        ),
        tasks: rows(worker).map((t) => ({
          taskId: String(t.id),
          status: code(t.status),
          reason: code(t.reason),
          at: stamp(t.updated_at),
          attempts: Number(t.attempts) || 0,
          identityValidated: t.identity_validated === true ? true : null,
        })),
        importerSelected: evidence(
          "recorded importer metadata.adapter",
          selected ? "COMPROVADO" : "DESCONHECIDO",
          selected ? "magalu_adapter_recorded" : "adapter_not_recorded",
        ),
        identity: evidence(
          "local_worker_tasks.result_metadata.identidadeValidada",
          identityTask ? "COMPROVADO" : "DESCONHECIDO",
          identityTask
            ? "recorded_identity_validation"
            : "identity_proof_unavailable",
          identityTask?.updated_at,
          { confirmed: identityTask ? true : null },
        ),
        affiliation: evidence(
          "recorded importer provaAfiliado; authorized workspace",
          conversion ? "COMPROVADO" : "DESCONHECIDO",
          code(conversion?.motivoConversao) || "conversion_proof_unavailable",
          null,
          {
            confirmed: conversion
              ? conversion.conversaoStatus !== "convertida"
                ? false
                : ["page_validated", "deterministic_workspace"].includes(
                      conversion.proofType,
                    )
                  ? true
                  : null
              : null,
            status: code(conversion?.conversaoStatus),
            proofType: code(conversion?.proofType),
          },
        ),
        note: "Recorded evidence only; completion alone is not identity or affiliation. No conversion or task is executed by telemetry.",
      },
    };
  }
  async function events(filters, scope) {
    return project(
      await telemetry.consultarEventosTelemetria({
        ...filters,
        clienteId: tenant(filters, scope),
        escopo: scope,
        janelaMinutos: Math.min(
          60,
          Math.max(1, Number(filters.janelaMinutos) || 15),
        ),
        limit: 50,
        query,
      }),
    );
  }
  return { snapshot, events, workspaces, problems, trace, probe, controlProbe };
}
module.exports = { createOperationalView, project };
