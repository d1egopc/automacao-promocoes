"use strict";

// Keep TeleRadar transport independent of Engine. Radar owns the final
// admission handoff and rechecks the original capture clock on every retry.
const { avaliarFrescorPreImporter } = require("../engine/frescor-pre-importer.service");

function avaliarFrescorHandoffTeleRadar(dados = {}, agoraMs = Date.now()) {
  if (dados.fonte !== "teleradar") return { ok: true, aplicavel: false };
  const capturadoEm = dados.capturadoEm || dados.metadata?.teleradar?.capturedAt;
  const origemMs = Date.parse(capturadoEm);
  if (!Number.isFinite(origemMs)) {
    return { ok: false, aplicavel: true, motivo: "captura_sem_tempo_factual" };
  }
  const frescor = avaliarFrescorPreImporter({
    evento_capturado_em: capturadoEm,
    evento_origem: "radar",
    evento_origem_tipo: "telegram",
    evento_metadata: dados.metadata || {}
  }, { agoraMs });
  return frescor.expirada
    ? { ok: false, aplicavel: true, motivo: "captura_expirada_antes_admissao",
        capturadoEm: new Date(origemMs).toISOString(), tipoFluxo: frescor.tipoFluxo }
    : { ok: true, aplicavel: true, capturadoEm: new Date(origemMs).toISOString(),
        tipoFluxo: frescor.tipoFluxo };
}

module.exports = { avaliarFrescorHandoffTeleRadar };
