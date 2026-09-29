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
    return { ok: false, motivo: motivoDesabilitado(workspaceId, env), workspaceId };
  }

  const fonte = selecionarFonteSnapshotOFC(workspaceId, {
    ...opcoes,
    env
  });
  if (fonte.eligible !== true || fonte.source !== "fila_viva") {
    return { ok: false, motivo: fonte.motivo || "distributor_viva_ineligible", workspaceId };
  }

  const tipoFluxo = entrada.tipoFluxo || (entrada.cupomTurbo === true ? "cupom_turbo" : "oferta_comum");
  const destinosOriginais = Array.isArray(entrada.destinosCompativeis)
    ? entrada.destinosCompativeis.map(projetarDestinoWorker)
    : [];
  const destinosGate = entrada.cupomTurbo === true
    ? destinosOriginais.map(destino => ({ ...destino, cupomTurbo: true }))
    : destinosOriginais;
  const oferta = entrada.oferta && typeof entrada.oferta === "object" ? entrada.oferta : {};
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
  }, opcoes);

  if (!resultado || resultado.type !== "distributor_compact_v1" ||
      resultado.workspaceId !== workspaceId || resultado.source !== "fila_viva" ||
      !compactoSemArraysIntegrais(resultado) || !resultado.facts?.flow?.fila ||
      !resultado.facts?.gate?.fila || !resultado.facts?.flow || !resultado.facts?.gate ||
      !resultado.before || !resultado.after || !iguais(resultado.before, resultado.after)) {
    return { ok: false, motivo: "distributor_compact_response_invalid", workspaceId };
  }

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
  if (atual.eligible !== true || atual.source !== "fila_viva") return false;
  if (!snapshot.proof?.fileRevision || atual.proof?.fileRevision !== snapshot.proof.fileRevision) return false;
  if (!iguais(snapshot.before, snapshot.after)) return false;
  return mesmaIdentidadeFisica(snapshot.sourceIdentity, atual.beforeIdentity);
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

  if (usouSnapshot && !(await validarSnapshot(snapshot))) {
    gate = await decidir(null);
    usouSnapshot = false;
  }

  return {
    gate,
    usouSnapshot,
    async revalidarAntesDaMutacao() {
      if (!usouSnapshot) return { gate, usouSnapshot: false, alterado: false };
      if (await validarSnapshot(snapshot)) return { gate, usouSnapshot: true, alterado: false };
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
