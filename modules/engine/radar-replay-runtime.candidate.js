"use strict";

const { getEnginePool } = require("./database");
const { criarJobsParaClientes } = require("./jobs.service");
const { promoverProximaIntencao } = require("./radar-replay.candidate");

async function recuperarIntencoesRadarCandidatas({ limite = 10, agoraMs = Date.now() } = {}) {
  const pool = getEnginePool();
  if (!pool) return { ok: false, motivo: "radar_replay_pool_indisponivel" };
  const max = Math.max(1, Math.min(20, Math.floor(Number(limite) || 10)));
  const resumo = { ok: true, examinadas: 0, criadas: 0, existentes: 0,
    expiradas: 0, preEpochRejeitadas: 0, admissionNegada: 0,
    ambiguas: 0 };
  const ignorarPares = [];
  for (let i = 0; i < max; i += 1) {
    const worker = await pool.connect();
    let resultado;
    try {
      resultado = await promoverProximaIntencao(worker, {
        agoraMs, ignorarPares, reportErrors: true,
        criarJob: intent => criarJobsParaClientes({
          eventoId: intent.evento_id,
          clientes: [intent.cliente_id],
          marketplaceDetectado: intent.marketplace_detectado || "",
          linksExtraidos: intent.links_extraidos || [],
          metadataEvento: intent.metadata || {}
        })
      });
    } finally {
      worker.release();
    }
    if (resultado.estado === "vazio") break;
    resumo.examinadas += 1;
    if (resultado.estado === "criada") resumo.criadas += 1;
    if (resultado.estado === "existente") resumo.existentes += 1;
    if (resultado.estado === "expirada") resumo.expiradas += 1;
    if (resultado.estado === "rejected_pre_epoch") resumo.preEpochRejeitadas += 1;
    if (resultado.estado === "admission_negada" ||
        resultado.estado === "erro_ambiguo") {
      if (resultado.estado === "admission_negada") resumo.admissionNegada += 1;
      else resumo.ambiguas += 1;
      if (!resultado.eventoId || !resultado.clienteId) break;
      ignorarPares.push(`${resultado.eventoId}:${resultado.clienteId}`);
    }
  }
  return resumo;
}

module.exports = { recuperarIntencoesRadarCandidatas };
