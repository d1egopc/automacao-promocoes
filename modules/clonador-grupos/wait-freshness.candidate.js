"use strict";

const { avaliarFrescorPreImporter } = require("../engine/frescor-pre-importer.service");
const { classificarTurboComercialCandidato } = require("../engine/turbo-classification.candidate");

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function classificarComercialEsperaClonador(item = {}) {
  const metadata = objeto(item.metadata);
  const comercialCapturado = objeto(metadata.comercialCapturado);
  const classificacao = classificarTurboComercialCandidato({
    marketplace: comercialCapturado.marketplaceDetectado || metadata.marketplaceDetectado || "",
    cupom: comercialCapturado.cupom || "",
    linksComerciais: comercialCapturado.linksComerciais || [],
    metadata: {
      ...metadata,
      cupom: comercialCapturado.cupom || metadata.cupom || "",
      linksComerciais: comercialCapturado.linksComerciais || metadata.linksComerciais || []
    }
  });
  return {
    turbo: classificacao.turbo === true,
    tipoFluxo: classificacao.tipoFluxo,
    ancora: classificacao.ancora || ""
  };
}

function metadataComClassificacaoComercial(item = {}) {
  const metadata = objeto(item.metadata);
  const classificacao = classificarComercialEsperaClonador(item);
  return {
    ...metadata,
    ...(classificacao.turbo ? { cupomTurbo: true, tipoFluxo: "cupom_turbo" } : {}),
    classificacaoTurboComercial: {
      turbo: classificacao.turbo,
      tipoFluxo: classificacao.tipoFluxo,
      ancora: classificacao.ancora,
      autoridade: "turbo_classification.candidate"
    }
  };
}

function avaliarFrescorEsperaClonador(item = {}, agoraMs = Date.now()) {
  const classificacao = classificarComercialEsperaClonador(item);
  const metadata = {
    ...objeto(item.metadata),
    ...(classificacao.turbo ? { cupomTurbo: true, tipoFluxo: "cupom_turbo" } : {}),
    classificacaoTurboComercial: {
      turbo: classificacao.turbo,
      tipoFluxo: classificacao.tipoFluxo,
      ancora: classificacao.ancora,
      autoridade: "turbo_classification.candidate"
    }
  };
  const capturadoEm = item.capturadoEm || item.capturado_em || "";
  const frescor = avaliarFrescorPreImporter({
    evento_capturado_em: capturadoEm,
    evento_origem: "clonador_grupos",
    evento_origem_tipo: "whatsapp",
    metadata,
    evento_metadata: metadata
  }, { agoraMs });
  return {
    expirada: frescor.expirada === true,
    manualV2: frescor.manualV2 === true,
    tipoFluxo: frescor.tipoFluxo || (frescor.manualV2 ? "manual_v2" : "oferta_comum"),
    ttlMs: frescor.ttlMs ?? null,
    expiraEmComercial: frescor.expiraEmComercial || null,
    origemComercialMs: frescor.origemComercialMs ?? null,
    turbo: classificacao.turbo,
    ancoraTurbo: classificacao.ancora,
    prioridadeComercial: classificacao.turbo ? 1 : 0,
    metadataClassificada: metadata
  };
}

module.exports = {
  avaliarFrescorEsperaClonador,
  classificarComercialEsperaClonador,
  metadataComClassificacaoComercial
};
