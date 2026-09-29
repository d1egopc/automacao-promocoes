"use strict";

const {
  selecionarFonteSnapshotOFC
} = require("./absorption-gate.service");
const { projetarDestinoWorker } = require("./workspace-worker-client");
const { validarElegibilidadeViva, mesmaIdentidadeFisica } = require("./viva-snapshot");
const { iguais } = require("./workspace-worker-revision");
const {
  executarDistributorSnapshot,
  fecharDistributorSnapshot
} = require("./distributor-snapshot-client");

const FLAG = "OFC_DISTRIBUTOR_VIVA_COMPACT";
const CANARY_FLAG = "OFC_DISTRIBUTOR_VIVA_COMPACT_CANARY_CLIENTES";
const TELEMETRY_TAG = "[OFC-DISTRIBUTOR-COMPACT]";

function listaCanary(valor = "") {
  return new Set(String(valor || "")
    .split(/[;,\s]+/)
    .map(item => item.trim())
    .filter(Boolean));
}

function ativoParaWorkspace(workspaceId = "", env = process.env) {
  if (String(env?.[FLAG] || "") !== "1") return false;
  return listaCanary(env?.[CANARY_FLAG]).has(String(workspaceId || "").trim());
}

function revisaoSegura(valor = null) {
  if (!valor || typeof valor !== "object") return undefined;
  const revisao = {};
  for (const campo of ["size", "mtimeMs", "ctimeMs", "ino", "dev"]) {
    if (valor[campo] !== undefined && valor[campo] !== null) revisao[campo] = valor[campo];
  }
  return Object.keys(revisao).length ? revisao : undefined;
}

function camposPerf(resultado = {}, sourceBytes = undefined) {
  const perf = resultado?.perf || {};
  const leitura = perf.leitura || {};
  return {
    ...(sourceBytes === undefined ? {} : { sourceBytes }),
    contentReads: perf.contentReads,
    legacyContentReads: perf.legacyContentReads,
    readMs: leitura.leituraMs,
    parseMs: leitura.parseMs,
    calcMs: perf.calcMs,
    roundTripMs: perf.roundTripMs,
    inputCloneBytes: perf.inputCloneBytes,
    outputCloneBytes: perf.outputCloneBytes
  };
}

function emitirTelemetria(opcoes = {}, payload = {}) {
  const telemetria = opcoes?.telemetry;
  if (!telemetria) return;
  const evento = {
    timestamp: new Date().toISOString(),
    stage: payload.stage || "",
    workspaceId: String(payload.workspaceId || ""),
    ...(payload.source ? { source: payload.source } : {}),
    ...(payload.fallbackReason ? { fallbackReason: payload.fallbackReason } : {}),
    ...(payload.fileRevision ? { fileRevision: payload.fileRevision } : {}),
    ...(payload.revisionBefore ? { revisionBefore: revisaoSegura(payload.revisionBefore) } : {}),
    ...(payload.revisionAfter ? { revisionAfter: revisaoSegura(payload.revisionAfter) } : {}),
    ...Object.fromEntries(Object.entries(payload).filter(([chave, valor]) =>
      !["stage", "workspaceId", "source", "fallbackReason", "fileRevision", "revisionBefore", "revisionAfter"].includes(chave) &&
      valor !== undefined
    ))
  };
  try {
    if (typeof telemetria === "function") return telemetria(evento);
    if (typeof telemetria.logger === "function") return telemetria.logger(TELEMETRY_TAG, JSON.stringify(evento));
    if (typeof telemetria.logger?.log === "function") return telemetria.logger.log(TELEMETRY_TAG, JSON.stringify(evento));
  } catch (_) {}
}

function motivoTelemetriaFonte(motivo = "") {
  const texto = String(motivo || "");
  if (texto.includes("proof")) return "proof_invalid";
  if (texto.includes("manifest")) return "manifest_invalid";
  if (texto.includes("stat")) return "stat_mismatch";
  if (texto.includes("ausente")) return "viva_missing";
  return texto || "worker_unavailable";
}

function compactoSemArraysIntegrais(valor = {}) {
  if (!valor || typeof valor !== "object") return false;
  if (Object.hasOwn(valor, "fila") || Object.hasOwn(valor, "itens")) return false;
  if (valor.facts?.flow?.fila && Object.hasOwn(valor.facts.flow.fila, "itens")) return false;
  if (valor.facts?.gate?.fila && Object.hasOwn(valor.facts.gate.fila, "itens")) return false;
  return true;
}

function motivoDesabilitado(workspaceId, env) {
  return String(env?.[FLAG] || "") !== "1"
    ? "distributor_compact_disabled"
    : !listaCanary(env?.[CANARY_FLAG]).has(String(workspaceId || "").trim())
      ? "distributor_workspace_not_canary"
      : "distributor_compact_ineligible";
}

async function obterDistributorSnapshot(entrada = {}, opcoes = {}) {
  const workspaceId = String(entrada.workspaceId || entrada.clienteId || "").trim();
  const env = opcoes.env || process.env;
  if (!ativoParaWorkspace(workspaceId, env)) {
    if (listaCanary(env?.[CANARY_FLAG]).has(workspaceId) && String(env?.[FLAG] || "") !== "1") {
      emitirTelemetria(opcoes, { stage: "fallback", workspaceId, fallbackReason: "feature_disabled" });
    }
    return { ok: false, motivo: motivoDesabilitado(workspaceId, env), workspaceId };
  }

  emitirTelemetria(opcoes, { stage: "attempt", workspaceId });

  const fonte = selecionarFonteSnapshotOFC(workspaceId, {
    ...opcoes,
    env
  });
  if (fonte.eligible !== true || fonte.source !== "fila_viva") {
    const fallbackReason = motivoTelemetriaFonte(fonte.motivo || "distributor_viva_ineligible");
    emitirTelemetria(opcoes, {
      stage: "ineligible",
      workspaceId,
      source: fonte.source || "",
      fallbackReason,
      sourceBytes: fonte.sourceBytes,
      fileRevision: fonte.proof?.fileRevision,
      revisionBefore: fonte.beforeIdentity
    });
    emitirTelemetria(opcoes, { stage: "fallback", workspaceId, source: fonte.source || "", fallbackReason });
    return { ok: false, motivo: fonte.motivo || "distributor_viva_ineligible", workspaceId };
  }

  emitirTelemetria(opcoes, {
    stage: "worker_started",
    workspaceId,
    source: "fila_viva",
    sourceBytes: fonte.sourceBytes,
    fileRevision: fonte.proof?.fileRevision,
    revisionBefore: fonte.beforeIdentity
  });

  const tipoFluxo = entrada.tipoFluxo || (entrada.cupomTurbo === true ? "cupom_turbo" : "oferta_comum");
  const destinosOriginais = Array.isArray(entrada.destinosCompativeis)
    ? entrada.destinosCompativeis.map(projetarDestinoWorker)
    : [];
  const destinosGate = entrada.cupomTurbo === true
    ? destinosOriginais.map(destino => ({ ...destino, cupomTurbo: true }))
    : destinosOriginais;
  const oferta = entrada.oferta && typeof entrada.oferta === "object" ? entrada.oferta : {};
  let falhaWorker = null;
  const resultado = await executarDistributorSnapshot({
    workspaceId,
    arquivo: fonte.arquivo,
    sourceMeta: {
      eligible: true,
      sourceBytes: fonte.sourceBytes,
      bytesAvoidedEstimate: fonte.bytesAvoidedEstimate,
      proofValidationMs: fonte.proofValidationMs,
      beforeIdentity: fonte.beforeIdentity
    },
    destinosFlow: destinosOriginais,
    destinosGate,
    agoraMs: Number(entrada.agoraMs || Date.now()),
    ofertaId: entrada.ofertaId ?? oferta.id ?? null,
    marketplace: entrada.marketplace || oferta.marketplace || "",
    categoria: entrada.categoria || oferta.categoria || "",
    tipoMidia: entrada.tipoMidia || oferta.tipoMidia || oferta.tipo_midia || "",
    tipoFluxo,
    tipoOperacional: entrada.tipoOperacional || "",
    flowCoberturaMinutos: tipoFluxo === "cupom_turbo" ? 5 : 10,
    gateCoberturaMinutos: 15
  }, {
    ...opcoes,
    onEvent: evento => { falhaWorker = evento; }
  });

  if (!resultado || resultado.type !== "distributor_compact_v1" ||
      resultado.workspaceId !== workspaceId || resultado.source !== "fila_viva" ||
      !compactoSemArraysIntegrais(resultado) || !resultado.facts?.flow?.fila ||
      !resultado.facts?.gate?.fila || !resultado.facts?.flow || !resultado.facts?.gate ||
      !resultado.before || !resultado.after || !iguais(resultado.before, resultado.after)) {
    const fallbackReason = falhaWorker?.fallbackReason || "worker_response_invalid";
    const stage = fallbackReason.startsWith("revision_changed") ? "revision_changed" : "worker_invalid";
    emitirTelemetria(opcoes, {
      stage,
      workspaceId,
      source: "fila_viva",
      fallbackReason,
      fileRevision: fonte.proof?.fileRevision,
      revisionBefore: falhaWorker?.revisionBefore || resultado?.before || fonte.beforeIdentity,
      revisionAfter: falhaWorker?.revisionAfter || resultado?.after,
      ...camposPerf(resultado, fonte.sourceBytes)
    });
    emitirTelemetria(opcoes, { stage: "fallback", workspaceId, source: "fila_viva", fallbackReason });
    return { ok: false, motivo: "distributor_compact_response_invalid", workspaceId };
  }

  emitirTelemetria(opcoes, {
    stage: "worker_completed",
    workspaceId,
    source: "fila_viva",
    fileRevision: fonte.proof?.fileRevision,
    revisionBefore: resultado.before,
    revisionAfter: resultado.after,
    ...camposPerf(resultado, fonte.sourceBytes)
  });
  emitirTelemetria(opcoes, {
    stage: "accepted",
    workspaceId,
    source: "fila_viva",
    fileRevision: fonte.proof?.fileRevision,
    revisionBefore: resultado.before,
    revisionAfter: resultado.after,
    bytesAvoidedEstimate: fonte.bytesAvoidedEstimate,
    proofValidationMs: fonte.proofValidationMs,
    ...camposPerf(resultado, fonte.sourceBytes)
  });

  return {
    ok: true,
    workspaceId,
    source: "fila_viva",
    arquivo: fonte.arquivo,
    before: resultado.before,
    after: resultado.after,
    sourceIdentity: fonte.beforeIdentity,
    proof: fonte.proof,
    sourceBytes: fonte.sourceBytes,
    bytesAvoidedEstimate: fonte.bytesAvoidedEstimate,
    proofValidationMs: fonte.proofValidationMs,
    facts: resultado.facts,
    perf: resultado.perf
  };
}

function validarDistributorSnapshot(snapshot = {}, opcoes = {}) {
  if (!snapshot || snapshot.ok !== true || snapshot.source !== "fila_viva") return false;
  const atual = validarElegibilidadeViva(snapshot.workspaceId, opcoes);
  const emitirFalha = (fallbackReason, stage = "revision_changed") => {
    emitirTelemetria(opcoes, {
      stage,
      workspaceId: snapshot.workspaceId,
      source: "fila_viva",
      fallbackReason,
      fileRevision: snapshot.proof?.fileRevision,
      revisionBefore: snapshot.before,
      revisionAfter: atual.beforeIdentity
    });
    emitirTelemetria(opcoes, {
      stage: "fallback",
      workspaceId: snapshot.workspaceId,
      source: "fila_viva",
      fallbackReason
    });
  };
  if (atual.eligible !== true || atual.source !== "fila_viva") {
    emitirFalha(motivoTelemetriaFonte(atual.motivo), "ineligible");
    return false;
  }
  const stageRevision = opcoes.telemetryStage || "revision_changed_post";
  if (!snapshot.proof?.fileRevision || atual.proof?.fileRevision !== snapshot.proof.fileRevision) {
    emitirFalha("revision_changed_post", "revision_changed");
    return false;
  }
  if (!iguais(snapshot.before, snapshot.after)) {
    emitirFalha(stageRevision, "revision_changed");
    return false;
  }
  if (!mesmaIdentidadeFisica(snapshot.sourceIdentity, atual.beforeIdentity)) {
    emitirFalha("stat_mismatch", "revision_changed");
    return false;
  }
  return true;
}

async function decidirGateComSnapshotSeguro({
  entrada = {},
  opcoes = {},
  snapshot = null,
  validarSnapshot = async () => false,
  decidirGate
} = {}) {
  if (typeof decidirGate !== "function") throw new TypeError("distributor_gate_decider_missing");
  const decidir = fonte => decidirGate(entrada, { ...opcoes, distributorSnapshot: fonte || null });
  let gate = await decidir(snapshot);
  let usouSnapshot = Boolean(snapshot && gate?.ativo);

  if (usouSnapshot && !(await validarSnapshot(snapshot, "revision_changed_post"))) {
    gate = await decidir(null);
    usouSnapshot = false;
  }

  return {
    gate,
    usouSnapshot,
    async revalidarAntesDaMutacao() {
      if (!usouSnapshot) return { gate, usouSnapshot: false, alterado: false };
      if (await validarSnapshot(snapshot, "revision_changed_before_mutation")) return { gate, usouSnapshot: true, alterado: false };
      gate = await decidir(null);
      usouSnapshot = false;
      return { gate, usouSnapshot: false, alterado: true };
    }
  };
}

async function fecharCoordenadorDistributorSnapshot() {
  await fecharDistributorSnapshot();
}

module.exports = {
  FLAG,
  CANARY_FLAG,
  listaCanary,
  ativoParaWorkspace,
  obterDistributorSnapshot,
  validarDistributorSnapshot,
  decidirGateComSnapshotSeguro,
  fecharCoordenadorDistributorSnapshot
};
