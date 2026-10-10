const {
  avaliarFrescorComercialOferta,
  TTL_NORMAL_MS,
  TTL_TURBO_MS
} = require("./flow-manager/flow-manager.service");
const { classificarTurboComercialCandidato } =
  require("./turbo-classification.candidate");

const MOTIVO_FRESCOR_PRE_IMPORTER = "flow_expirada_frescor_comercial_pre_importer";
const STATUS_FINAL_FRESCOR_PRE_IMPORTER = "expirada_operacional";
const AGUA_NOVA_MINUTOS_PRE_IMPORTER = 5;
const FRESCA_EM_RISCO_MINUTOS_PRE_IMPORTER = 20;
const TTL_COMERCIAL_PADRAO_MINUTOS_PRE_IMPORTER = Math.floor(TTL_NORMAL_MS / 60000);
const CAMPOS_MANUAL_BOOLEANOS = Object.freeze({
  metadata: Object.freeze(["manualV2", "manual_v2", "manual"]),
  eventoMetadata: Object.freeze(["manualV2", "manual_v2", "manual"])
});
const CAMPOS_MANUAL_TEXTO = Object.freeze({
  metadata: Object.freeze(["origem", "fonte"]),
  eventoMetadata: Object.freeze(["origem", "fonte"]),
  job: Object.freeze(["evento_origem", "evento_origem_tipo"])
});
const CAMPOS_TURBO_BOOLEANOS = Object.freeze({
  metadata: Object.freeze(["cupomTurbo", "cupom_turbo"]),
  eventoMetadata: Object.freeze(["cupomTurbo", "cupom_turbo"])
});
const CAMPOS_TIPO_FLUXO = Object.freeze({
  metadata: Object.freeze(["tipoFluxo", "tipo_fluxo", "tipoOperacional", "tipo_operacional"]),
  eventoMetadata: Object.freeze(["tipoFluxo", "tipo_fluxo", "tipoOperacional", "tipo_operacional"])
});

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
  return Object.entries(CAMPOS_MANUAL_BOOLEANOS).some(([origem, campos]) =>
    campos.some(campo => ({ metadata, eventoMetadata })[origem][campo] === true)) ||
    Object.entries(CAMPOS_MANUAL_TEXTO).some(([origem, campos]) =>
      campos.some(campo => contemManual(({ metadata, eventoMetadata, job })[origem][campo])));
}

function sqlFrescorComercialPreImporter(j = "j", e = "e", opcoes = {}) {
  if (!/^[a-z][a-z0-9_]*$/i.test(j) || !/^[a-z][a-z0-9_]*$/i.test(e)) {
    throw new Error("alias_sql_frescor_invalido");
  }
  const agoraSql = opcoes.agoraSql === "instante.agora" ? "instante.agora" : "NOW()";
  const fonteJson = {
    metadata: `${j}.metadata`,
    eventoMetadata: `COALESCE(NULLIF(${e}.metadata, 'null'::jsonb), ${j}.metadata->'metadataEvento', '{}'::jsonb)`
  };
  const campoJson = (origem, campo, textoCampo = true) =>
    `(${fonteJson[origem]} ${textoCampo ? "->>" : "->"} '${campo}')`;
  const manualBooleano = Object.entries(CAMPOS_MANUAL_BOOLEANOS)
    .flatMap(([origem, campos]) => campos.map(campo => `(${campoJson(origem, campo, false)} = 'true'::jsonb) IS TRUE`));
  const manualTexto = Object.entries(CAMPOS_MANUAL_TEXTO)
    .flatMap(([origem, campos]) => campos.map(campo => {
      const valor = origem === "job" ? `${e}.${campo === "evento_origem" ? "origem" : "origem_tipo"}` : campoJson(origem, campo);
      return `POSITION('manual' IN LOWER(COALESCE(${valor}, ''))) > 0`;
    }));
  const manual = `(${[...manualBooleano, ...manualTexto].join(" OR ")})`;
  const turboBooleano = Object.entries(CAMPOS_TURBO_BOOLEANOS)
    .flatMap(([origem, campos]) => campos.map(campo => `(${campoJson(origem, campo, false)} = 'true'::jsonb) IS TRUE`));
  const tipoFluxo = Object.entries(CAMPOS_TIPO_FLUXO)
    .flatMap(([origem, campos]) => campos.map(campo => `NULLIF(BTRIM(${campoJson(origem, campo)}), '')`));
  // This SQL expression is a selector hint for already persisted markers.
  // It does not classify cupom/resgate; every selected job is revalidated by
  // avaliarFrescorPreImporter with the shared commercial classifier before import.
  const turbo = `(${[...turboBooleano, `LOWER(COALESCE(${tipoFluxo.join(", ")}, '')) = 'cupom_turbo'`].join(" OR ")})`;
  // Engine commercial freshness is anchored to the event's factual capture.
  // Job creation remains technical telemetry, never a replacement clock.
  const origem = `${e}.capturado_em`;
  const expiraEm = `(${origem} + (CASE WHEN ${turbo} THEN ${Math.floor(TTL_TURBO_MS / 60000)} ELSE ${Math.floor(TTL_NORMAL_MS / 60000)} END) * INTERVAL '1 minute')`;
  const morto = `(NOT ${manual} AND ${expiraEm} <= ${agoraSql})`;
  const lane = `(CASE
    WHEN ${morto} THEN 'expirada'
    WHEN ${manual} THEN 'fresca_circulavel'
    WHEN ${expiraEm} <= ${agoraSql} + INTERVAL '${TTL_COMERCIAL_PADRAO_MINUTOS_PRE_IMPORTER - FRESCA_EM_RISCO_MINUTOS_PRE_IMPORTER} minutes' THEN 'fresca_em_risco'
    WHEN ${origem} >= ${agoraSql} - INTERVAL '${AGUA_NOVA_MINUTOS_PRE_IMPORTER} minutes' THEN 'agua_nova'
    ELSE 'fresca_circulavel' END)`;
  return {
    manual,
    turbo,
    origem,
    expiraEm,
    vivo: `(${manual} OR ${expiraEm} > ${agoraSql})`,
    morto,
    bucket: `(CASE WHEN ${morto} THEN 1 ELSE 0 END)`,
    lane
  };
}

function sqlRetryPreImporter(j = "j", opcoes = {}) {
  if (!/^[a-z][a-z0-9_]*$/i.test(j)) throw new Error("alias_sql_retry_invalido");
  const agoraSql = opcoes.agoraSql === "instante.agora" ? "instante.agora" : "NOW()";
  const afiliacao = `NULLIF(${j}.metadata #>> '{afiliacaoWorkspaceRetry,proximaTentativaEmMs}', '')`;
  const imagem = `NULLIF(${j}.metadata #>> '{localWorkerImageRetry,proximaTentativaEmMs}', '')`;
  const bruto = `COALESCE(${afiliacao}, ${imagem})`;
  const valido = `${bruto} ~ '^[0-9]+$'`;
  const agoraMs = `(EXTRACT(EPOCH FROM ${agoraSql}) * 1000)::bigint`;
  return {
    bruto,
    valido,
    proximoEmMs: `(CASE WHEN ${valido} THEN ${bruto}::bigint ELSE NULL END)`,
    vencido: `(CASE WHEN ${valido} THEN ${bruto}::bigint <= ${agoraMs} ELSE TRUE END)`,
    futuro: `(CASE WHEN ${valido} THEN ${bruto}::bigint > ${agoraMs} ELSE FALSE END)`
  };
}

function calcularCotasFrescorPreImporter(limite = 20) {
  const total = Math.max(1, Math.min(100, Math.floor(Number(limite || 20))));
  let aguaNova = Math.max(1, Math.ceil(total * 0.7));
  const frescaEmRisco = total >= 5 ? Math.max(1, Math.floor(total * 0.2)) : 0;
  const frescaCirculavel = total >= 5 ? Math.max(1, total - aguaNova - frescaEmRisco) : 0;
  aguaNova = total - frescaEmRisco - frescaCirculavel;
  const limpeza = total >= 5 ? Math.max(1, Math.floor(total * 0.2)) : 0;
  return {
    limite: total,
    aguaNova,
    frescaEmRisco,
    frescaCirculavel,
    frescos: total,
    limpeza,
    totalSelecao: total + limpeza,
    aguaNovaMinutos: AGUA_NOVA_MINUTOS_PRE_IMPORTER,
    frescaEmRiscoMinutos: FRESCA_EM_RISCO_MINUTOS_PRE_IMPORTER,
    ttlComercialPadraoMinutos: TTL_COMERCIAL_PADRAO_MINUTOS_PRE_IMPORTER,
    proporcaoLimpeza: limpeza > 0 ? limpeza / total : 0
  };
}

function origemComercialPreImporterMs(job = {}) {
  if (job.evento_id != null) {
    const factual = Date.parse(job.evento_capturado_em || "");
    return Number.isFinite(factual) ? factual : 0;
  }
  const metadata = objeto(job.metadata);
  const eventoMetadata = objeto(job.evento_metadata || metadata.metadataEvento);
  const valor = job.evento_capturado_em ||
    job.capturadaEm ||
    job.capturadoEm ||
    job.capturada_em ||
    job.capturado_em ||
    metadata.capturadaEm ||
    metadata.capturadoEm ||
    metadata.capturada_em ||
    metadata.capturado_em ||
    eventoMetadata.capturadaEm ||
    eventoMetadata.capturadoEm ||
    eventoMetadata.capturada_em ||
    eventoMetadata.capturado_em ||
    "";
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : 0;
}

function classificarLaneVazaoPreImporter(job = {}, opcoes = {}) {
  if (jobManualV2(job)) return "manual_v2";
  const agoraMs = Number.isFinite(Number(opcoes.agoraMs)) ? Number(opcoes.agoraMs) : Date.now();
  const origemMs = origemComercialPreImporterMs(job);
  if (!origemMs) return "fresca_circulavel";
  const frescor = avaliarFrescorPreImporter(job, { agoraMs });
  if (frescor.expirada) return "expirada";
  const ttlMs = Number(frescor.ttlMs || TTL_NORMAL_MS);
  if (origemMs + ttlMs <= agoraMs +
    (TTL_COMERCIAL_PADRAO_MINUTOS_PRE_IMPORTER - FRESCA_EM_RISCO_MINUTOS_PRE_IMPORTER) * 60000) {
    return "fresca_em_risco";
  }
  const idadeMinutos = Math.max(0, (agoraMs - origemMs) / 60000);
  if (idadeMinutos <= AGUA_NOVA_MINUTOS_PRE_IMPORTER) return "agua_nova";
  return "fresca_circulavel";
}

function compararPrioridade(a = {}, b = {}) {
  return numeroSeguro(b.prioridade) - numeroSeguro(a.prioridade);
}

function compararOrigemDesc(a = {}, b = {}) {
  return origemComercialPreImporterMs(b) - origemComercialPreImporterMs(a) || numeroSeguro(a.id) - numeroSeguro(b.id);
}

function compararOrigemAsc(a = {}, b = {}) {
  return origemComercialPreImporterMs(a) - origemComercialPreImporterMs(b) || numeroSeguro(a.id) - numeroSeguro(b.id);
}

function selecionarComFairnessWorkspace(jobs = [], limite = 1, comparador = compararOrigemDesc) {
  const total = Math.max(0, Math.floor(Number(limite || 0)));
  if (!total) return [];
  const porWorkspace = new Map();
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const workspace = texto(job.cliente_id || job.clienteId || "workspace_desconhecido") || "workspace_desconhecido";
    if (!porWorkspace.has(workspace)) porWorkspace.set(workspace, []);
    porWorkspace.get(workspace).push(job);
  }

  for (const lista of porWorkspace.values()) {
    lista.sort((a, b) => compararPrioridade(a, b) || comparador(a, b));
  }

  const workspaces = [...porWorkspace.keys()].sort();
  const selecionados = [];
  let rank = 0;
  while (selecionados.length < total) {
    let adicionou = false;
    for (const workspace of workspaces) {
      const item = porWorkspace.get(workspace)?.[rank];
      if (!item) continue;
      selecionados.push(item);
      adicionou = true;
      if (selecionados.length >= total) break;
    }
    if (!adicionou) break;
    rank += 1;
  }
  return selecionados;
}

function selecionarJobsVazaoPreImporterMemoria(jobs = [], limite = 20, opcoes = {}) {
  const cotas = calcularCotasFrescorPreImporter(limite);
  const lanes = {
    agua_nova: [],
    fresca_em_risco: [],
    fresca_circulavel: [],
    expirada: [],
    manual_v2: []
  };

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const lane = classificarLaneVazaoPreImporter(job, opcoes);
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(job);
  }

  return [
    ...selecionarComFairnessWorkspace(lanes.agua_nova, cotas.aguaNova, compararOrigemDesc),
    ...selecionarComFairnessWorkspace(lanes.fresca_em_risco, cotas.frescaEmRisco, compararOrigemAsc),
    ...selecionarComFairnessWorkspace([...lanes.fresca_circulavel, ...lanes.manual_v2], cotas.frescaCirculavel, compararOrigemDesc),
    ...selecionarComFairnessWorkspace(lanes.expirada, cotas.limpeza, compararOrigemAsc)
  ];
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
  const tipoDeclarado = [
    job.tipoFluxo, job.tipo_fluxo, job.tipoOperacional, job.tipo_operacional,
    metadata.tipoFluxo, metadata.tipo_fluxo, metadata.tipoOperacional, metadata.tipo_operacional,
    eventoMetadata.tipoFluxo, eventoMetadata.tipo_fluxo, eventoMetadata.tipoOperacional,
    eventoMetadata.tipo_operacional
  ].map(texto).find(Boolean) || "";

  const oferta = {
    id: job.oferta_id || null,
    jobId: job.id || null,
    eventoId: job.evento_id || null,
    marketplace: job.marketplace || job.marketplace_detectado ||
      metadata.marketplace || eventoMetadata.marketplace || "",
    capturadaEm: job.evento_capturado_em || job.capturadaEm || metadata.capturadaEm || eventoMetadata.capturadaEm || "",
    capturadoEm: job.evento_capturado_em || job.capturadoEm || metadata.capturadoEm || eventoMetadata.capturadoEm || "",
    capturada_em: job.evento_capturado_em || job.capturada_em || metadata.capturada_em || eventoMetadata.capturada_em || "",
    capturado_em: job.evento_capturado_em || job.capturado_em || metadata.capturado_em || eventoMetadata.capturado_em || "",
    evento_capturado_em: job.evento_capturado_em || "",
    criadoEm: job.criado_em || job.evento_criado_em || "",
    criado_em: job.criado_em || "",
    criada_em: job.criado_em || "",
    cupom: job.cupom || metadata.cupom || eventoMetadata.cupom || "",
    codigoCupom: job.codigoCupom || metadata.codigoCupom || eventoMetadata.codigoCupom || "",
    linksComerciais: job.linksComerciais || metadata.linksComerciais || eventoMetadata.linksComerciais,
    linksResgate: job.linksResgate || metadata.linksResgate || eventoMetadata.linksResgate,
    cupomSuspeito: job.cupomSuspeito === true || metadata.cupomSuspeito === true ||
      eventoMetadata.cupomSuspeito === true,
    cupomTurbo: job.cupomTurbo === true || job.cupom_turbo === true,
    tipoOperacional: tipoDeclarado,
    tipo_operacional: tipoDeclarado,
    metadata,
    evento_metadata: eventoMetadata,
    job_metadata: metadata
  };
  const classificacao = classificarTurboComercialCandidato(oferta);

  return {
    oferta,
    tipoFluxo: classificacao.tipoFluxo,
    cupomTurbo: classificacao.turbo
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

  if (job.evento_id != null &&
      !Number.isFinite(Date.parse(job.evento_capturado_em || ""))) {
    return { expirada: true, capturaInvalida: true,
      motivo: "captura_sem_tempo_factual" };
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
  AGUA_NOVA_MINUTOS_PRE_IMPORTER,
  FRESCA_EM_RISCO_MINUTOS_PRE_IMPORTER,
  TTL_COMERCIAL_PADRAO_MINUTOS_PRE_IMPORTER,
  calcularCotasFrescorPreImporter,
  classificarLaneVazaoPreImporter,
  selecionarJobsVazaoPreImporterMemoria,
  avaliarFrescorPreImporter,
  expirarJobPreImporterSeNecessario,
  resumirSelecaoFrescorPreImporter,
  montarEntradaFrescorPreImporter,
  jobManualV2,
  sqlFrescorComercialPreImporter,
  sqlRetryPreImporter
};
