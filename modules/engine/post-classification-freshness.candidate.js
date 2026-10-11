"use strict";

const { avaliarFrescorPreImporter } =
  require("./frescor-pre-importer.service");
const { classificarTurboComercialCandidato } =
  require("./turbo-classification.candidate");

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  return {};
}

function avaliarFrescorPosClassificacaoCandidato(oferta = {}, agoraMs = Date.now()) {
  const metadata = asObject(oferta.metadata);
  const jobMetadata = asObject(oferta.job_metadata);
  const eventoMetadata = asObject(oferta.evento_metadata);
  const classificacao = classificarTurboComercialCandidato(oferta);
  const capturadoEm = oferta.evento_capturado_em;
  const frescor = avaliarFrescorPreImporter({
    evento_capturado_em: capturadoEm,
    evento_origem: oferta.origem,
    evento_origem_tipo: oferta.origem_tipo,
    evento_metadata: eventoMetadata,
    metadata: { ...jobMetadata, ...metadata,
      cupomTurbo: classificacao.turbo,
      tipoOperacional: classificacao.tipoFluxo }
  }, { agoraMs });
  if (frescor.manualV2 === true) return { ok: true, manualV2: true,
    motivo: "manual_v2_preservado" };
  if (!capturadoEm || !Number.isFinite(Date.parse(capturadoEm))) {
    return { ok: false, motivo: "captura_sem_tempo_factual" };
  }
  return { ok: frescor.expirada !== true,
    motivo: frescor.expirada ? "captura_expirada_pos_classificacao" : "viva",
    capturadoEm: new Date(capturadoEm).toISOString(),
    tipoFluxo: frescor.tipoFluxo, ancoraTurbo: classificacao.ancora,
    ttlMs: frescor.ttlMs,
    expiraEmComercial: frescor.expiraEmComercial };
}

module.exports = { avaliarFrescorPosClassificacaoCandidato };
