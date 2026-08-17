const {
  avaliarFrescorComercialOferta
} = require("./flow-manager/flow-manager.service");

const MOTIVO_FRESCOR_PRE_IMPORTER = "flow_expirada_frescor_comercial_pre_importer";
const STATUS_FINAL_FRESCOR_PRE_IMPORTER = "expirada_operacional";

function numeroSeguro(valor = 0) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function contemManual(valor = "") {
  return texto(valor).toLowerCase().includes("manual");
}

function jobManualV2(job = {}) {
  const metadata = objeto(job.metadata);
  const eventoMetadata = objeto(job.evento_metadata || metadata.metadataEvento);
  return metadata.manualV2 === true ||
    metadata.manual_v2 === true ||
    metadata.manual === true ||
    eventoMetadata.manualV2 === true ||
    eventoMetadata.manual_v2 === true ||
    eventoMetadata.manual === true ||
    contemManual(metadata.origem) ||
    contemManual(metadata.fonte) ||
    contemManual(job.evento_origem) ||
    contemManual(job.evento_origem_tipo) ||
    contemManual(eventoMetadata.origem) ||
    contemManual(eventoMetadata.fonte);
}

function calcularCotasFrescorPreImporter(limite = 20) {
  const total = Math.max(1, Math.min(100, Math.floor(Number(limite || 20))));
  const limpeza = total >= 5 ? Math.max(1, Math.floor(total * 0.2)) : 0;
  return {
    limite: total,
    frescos: Math.max(1, total - limpeza),
    limpeza,
    proporcaoLimpeza: limpeza > 0 ? limpeza / total : 0
  };
}

function metadataComercial(job = {}) {
  const metadata = objeto(job.metadata);
  const eventoMetadata = objeto(job.evento_metadata || metadata.metadataEvento);
  return {
    ...metadata,
    metadataEvento: eventoMetadata,
    radarMirror: objeto(metadata.radarMirror || eventoMetadata.radarMirror || metadata.radarEspelhoComercial),
    ofertaUniversal: objeto(metadata.ofertaUniversal || eventoMetadata.ofertaUniversal)
  };
}

function montarEntradaFrescorPreImporter(job = {}) {
  const metadata = metadataComercial(job);
  const eventoMetadata = objeto(metadata.metadataEvento);
  const cupomTurbo = job.cupom_turbo === true ||
    job.cupomTurbo === true ||
    metadata.cupomTurbo === true ||
    metadata.cupom_turbo === true ||
    eventoMetadata.cupomTurbo === true ||
    eventoMetadata.cupom_turbo === true;
  const tipoFluxo = texto(
    job.tipoFluxo ||
    job.tipo_fluxo ||
    job.tipoOperacional ||
    job.tipo_operacional ||
    metadata.tipoFluxo ||
    metadata.tipo_fluxo ||
    metadata.tipoOperacional ||
    metadata.tipo_operacional ||
    eventoMetadata.tipoFluxo ||
    eventoMetadata.tipo_fluxo ||
    eventoMetadata.tipoOperacional ||
    eventoMetadata.tipo_operacional
  );

  const oferta = {
    id: job.oferta_id || null,
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    marketplace: job.marketplace || job.marketplace_detectado || "",
    capturadaEm: job.evento_capturado_em || job.capturadaEm || metadata.capturadaEm || eventoMetadata.capturadaEm || "",
    capturadoEm: job.evento_capturado_em || job.capturadoEm || metadata.capturadoEm || eventoMetadata.capturadoEm || "",
    capturada_em: job.evento_capturado_em || job.capturada_em || metadata.capturada_em || eventoMetadata.capturada_em || "",
    capturado_em: job.evento_capturado_em || job.capturado_em || metadata.capturado_em || eventoMetadata.capturado_em || "",
    evento_capturado_em: job.evento_capturado_em || "",
    criadoEm: job.criado_em || job.evento_criado_em || "",
    criado_em: job.criado_em || "",
    criada_em: job.criado_em || "",
    cupomTurbo,
    tipoOperacional: tipoFluxo,
    tipo_operacional: tipoFluxo,
    metadata,
    evento_metadata: eventoMetadata,
    job_metadata: metadata
  };

  return {
    oferta,
    tipoFluxo,
    cupomTurbo
  };
}

function avaliarFrescorPreImporter(job = {}, opcoes = {}) {
  if (jobManualV2(job)) {
    return {
      expirada: false,
      manualV2: true,
      motivo: "manual_v2_preservado"
    };
  }

  const avaliar = opcoes.avaliarFrescorComercialOferta || avaliarFrescorComercialOferta;
  const entrada = montarEntradaFrescorPreImporter(job);
  return avaliar(entrada, {
    agoraMs: opcoes.agoraMs,
    ttlMs: opcoes.ttlMs,
    tipoFluxo: entrada.tipoFluxo
  });
}

function detalhesFrescorPreImporter(job = {}, frescor = {}) {
  return {
    motivo: MOTIVO_FRESCOR_PRE_IMPORTER,
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    clienteId: job.cliente_id || "",
    marketplace: job.marketplace || job.marketplace_detectado || "",
    statusAnterior: job.status || "",
    tipoFluxo: frescor.tipoFluxo || "",
    ttlMs: frescor.ttlMs ?? null,
    idadeComercialMs: frescor.idadeComercialMs ?? null,
    origemComercialCampo: frescor.origemComercialCampo || "",
    origemComercialMs: frescor.origemComercialMs ?? null,
    expiraEmComercial: frescor.expiraEmComercial || "",
    eventoCapturadoEm: job.evento_capturado_em || "",
    jobCriadoEm: job.criado_em || "",
    prioridade: numeroSeguro(job.prioridade)
  };
}

async function expirarJobPreImporterSeNecessario(job = {}, deps = {}) {
  const frescor = avaliarFrescorPreImporter(job, deps);
  if (!frescor.expirada) {
    return { expirou: false, frescor };
  }

  const registrarProcessamento = deps.registrarProcessamento;
  const marcarJobStatus = deps.marcarJobStatus;
  if (typeof registrarProcessamento !== "function" || typeof marcarJobStatus !== "function") {
    return { expirou: true, frescor, ignorado: true, motivo: "deps_indisponiveis" };
  }

  const detalhes = detalhesFrescorPreImporter(job, frescor);
  await registrarProcessamento(
    job.id,
    "frescor_pre_importer",
    "expirada",
    MOTIVO_FRESCOR_PRE_IMPORTER,
    detalhes
  );

  const statusEsperado = deps.statusEsperado || job.status || "";
  const resultado = await marcarJobStatus(
    job.id,
    STATUS_FINAL_FRESCOR_PRE_IMPORTER,
    MOTIVO_FRESCOR_PRE_IMPORTER,
    statusEsperado ? { statusEsperado } : {}
  );

  return {
    expirou: true,
    frescor,
    resultado,
    motivo: MOTIVO_FRESCOR_PRE_IMPORTER
  };
}

function resumirSelecaoFrescorPreImporter(jobs = [], opcoes = {}) {
  const lista = Array.isArray(jobs) ? jobs : [];
  let frescosSelecionados = 0;
  let expiradosCandidatos = 0;
  let somaIdadeMs = 0;
  let idades = 0;

  for (const job of lista) {
    const frescor = avaliarFrescorPreImporter(job, opcoes);
    if (frescor.manualV2) continue;
    if (Number.isFinite(Number(frescor.idadeComercialMs))) {
      somaIdadeMs += Number(frescor.idadeComercialMs);
      idades += 1;
    }
    if (frescor.expirada) expiradosCandidatos += 1;
    else frescosSelecionados += 1;
  }

  return {
    frescosSelecionados,
    expiradosCandidatos,
    idadeMediaJobsSelecionadosMs: idades ? Math.round(somaIdadeMs / idades) : 0
  };
}

module.exports = {
  MOTIVO_FRESCOR_PRE_IMPORTER,
  STATUS_FINAL_FRESCOR_PRE_IMPORTER,
  calcularCotasFrescorPreImporter,
  avaliarFrescorPreImporter,
  expirarJobPreImporterSeNecessario,
  resumirSelecaoFrescorPreImporter,
  montarEntradaFrescorPreImporter,
  jobManualV2
};
