"use strict";

const { readClienteJson } = require("../../../utils/storage");
const {
  resumoFilaWorkspace,
  avaliarDestinosWorkspace
} = require("../ofc/absorption-gate.service");
const {
  calcularBufferVivoWorkspace,
  resumirDivergenciaBufferVivo
} = require("../ofc/buffer-vivo-workspace.service");

const COBERTURA_NORMAL_MINUTOS = 10;
const COBERTURA_TURBO_MINUTOS = 5;
const TTL_NORMAL_MS = 30 * 60 * 1000;
const TTL_TURBO_MS = 10 * 60 * 1000;

const STATUS_BUFFER_VIVO = new Set([
  "pendente",
  "novo",
  "aguardando",
  "aguardando_envio",
  "pronto",
  "pronta",
  "programado",
  "programada",
  "enviando",
  "em_envio",
  "processando_envio",
  "tentando_envio",
  "tentativa_envio",
  "processando",
  "em_processamento",
  "erro_temporario",
  "erro_retry",
  "retry",
  "aguardando_retry",
  "falha_temporaria",
  "reprocessar"
]);

const CAMPOS_TIMESTAMP_BUFFER = [
  "dataEntradaFila",
  "adicionadoEm",
  "createdAt",
  "adicionado_em",
  "dataEntrada",
  "entradaFilaEm",
  "dataFila",
  "dataCriacao",
  "timestamp",
  "incluidoEm",
  "inseridoEm",
  "recebidoEm",
  "importadoEm",
  "criado_em",
  "criadoEm"
];

const CAMPOS_TIMESTAMP_ISO_CONFIAVEL = [
  "dataEntradaFila",
  "adicionadoEm",
  "createdAt",
  "adicionado_em",
  "dataEntrada",
  "entradaFilaEm",
  "dataFila",
  "dataCriacao",
  "timestamp",
  "incluidoEm",
  "inseridoEm",
  "recebidoEm",
  "importadoEm"
];

const CAMPOS_DESTINO_BUFFER = [
  "destinoId",
  "destino_id",
  "destino",
  "chatId",
  "grupoId",
  "jid",
  "canalId"
];

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function flowManagerAtivoWorkspace(workspaceId = "") {
  const id = texto(workspaceId);
  return Boolean(id);
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function limitarNaoNegativo(valor = 0) {
  return Math.max(0, numero(valor));
}

function statusBufferItem(item = {}) {
  return texto(item.status ?? item.situacao).toLowerCase();
}

function parseTimestampBuffer(valor = "") {
  const bruto = String(valor || "").trim();
  if (!bruto) return NaN;
  return Date.parse(bruto);
}

function timestampBufferItem(item = {}) {
  for (const campo of CAMPOS_TIMESTAMP_BUFFER) {
    const ms = parseTimestampBuffer(item?.[campo] || "");
    if (Number.isFinite(ms)) return { ms, campo };
  }
  return { ms: null, campo: "" };
}

function timestampIsoConfiavelItem(item = {}) {
  for (const campo of CAMPOS_TIMESTAMP_ISO_CONFIAVEL) {
    const ms = parseTimestampBuffer(item?.[campo] || "");
    if (Number.isFinite(ms)) return { ms, campo };
  }
  return { ms: null, campo: "" };
}

function idDestino(destino = {}, indice = 0) {
  return texto(destino.id || destino.destinoId || destino.jid || destino.chatId || destino.nome || `destino_${indice + 1}`);
}

function idsDestinosAptos(destinosResumo = {}) {
  return lista(destinosResumo.capacidadePorDestino)
    .filter(item => item.aptoAgora)
    .map((item, indice) => idDestino(item.destino || item, indice))
    .filter(Boolean);
}

function itemCompativelComDestinos(item = {}, destinosAptos = []) {
  const candidatos = CAMPOS_DESTINO_BUFFER
    .map(campo => texto(item?.[campo]))
    .filter(Boolean);
  if (!candidatos.length) return true;
  return candidatos.some(valor => destinosAptos.includes(valor));
}

function timestampValido(valor = "") {
  if (!valor) return NaN;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : NaN;
}

function timestampComercialOferta(oferta = {}, agoraMs = Date.now()) {
  const metadata = objeto(oferta.metadata);
  const jobMetadata = objeto(oferta.job_metadata);
  const eventoMetadata = objeto(oferta.evento_metadata);
  const radarMirror = objeto(metadata.radarMirror || metadata.radarEspelhoComercial);
  const ofertaUniversal = objeto(metadata.ofertaUniversal);
  const candidatos = [
    ["capturadaEm", oferta.capturadaEm],
    ["capturadoEm", oferta.capturadoEm],
    ["capturada_em", oferta.capturada_em],
    ["capturado_em", oferta.capturado_em],
    ["evento_capturado_em", oferta.evento_capturado_em],
    ["metadata.capturadaEm", metadata.capturadaEm],
    ["metadata.capturadoEm", metadata.capturadoEm],
    ["metadata.capturada_em", metadata.capturada_em],
    ["metadata.capturado_em", metadata.capturado_em],
    ["metadata.radarMirror.capturadaEm", radarMirror.capturadaEm],
    ["metadata.radarMirror.capturadoEm", radarMirror.capturadoEm],
    ["metadata.ofertaUniversal.capturadaEm", ofertaUniversal.capturadaEm],
    ["metadata.ofertaUniversal.capturadoEm", ofertaUniversal.capturadoEm],
    ["evento_metadata.capturadaEm", eventoMetadata.capturadaEm],
    ["evento_metadata.capturadoEm", eventoMetadata.capturadoEm],
    ["evento_metadata.capturada_em", eventoMetadata.capturada_em],
    ["evento_metadata.capturado_em", eventoMetadata.capturado_em],
    ["criadoEm", oferta.criadoEm],
    ["criado_em", oferta.criado_em],
    ["criada_em", oferta.criada_em],
    ["criadaEm", oferta.criadaEm],
    ["metadata.criadoEm", metadata.criadoEm],
    ["metadata.criado_em", metadata.criado_em],
    ["metadata.criada_em", metadata.criada_em],
    ["job_metadata.criadoEm", jobMetadata.criadoEm],
    ["job_metadata.criado_em", jobMetadata.criado_em],
    ["dataEntradaFila", oferta.dataEntradaFila],
    ["atualizada_em", oferta.atualizada_em]
  ];

  for (const [campo, valor] of candidatos) {
    const ms = timestampValido(valor);
    if (Number.isFinite(ms)) return { ms, campo };
  }

  return { ms: agoraMs, campo: "fallback_agora" };
}

function tipoFluxoOferta(entrada = {}) {
  const oferta = objeto(entrada.oferta);
  const tipo = texto(
    entrada.tipoFluxo ||
    entrada.tipoOperacional ||
    entrada.tipo_operacional ||
    oferta.tipoOperacional ||
    oferta.tipo_operacional
  ).toLowerCase();
  const turbo = entrada.cupomTurbo === true ||
    oferta.cupomTurbo === true ||
    oferta.cupom_turbo === true ||
    tipo === "cupom_turbo";
  return turbo ? "cupom_turbo" : "oferta_comum";
}

function ttlFluxoMs(tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo" ? TTL_TURBO_MS : TTL_NORMAL_MS;
}

function avaliarFrescorComercialOferta(entrada = {}, opcoes = {}) {
  const agoraEntradaMs = Number(opcoes.agoraMs);
  const agoraMs = Number.isFinite(agoraEntradaMs) ? agoraEntradaMs : Date.now();
  const oferta = objeto(entrada.oferta);
  const tipoFluxo = tipoFluxoOferta({
    ...entrada,
    tipoFluxo: opcoes.tipoFluxo || entrada.tipoFluxo,
    oferta
  });
  const ttlEntradaMs = Number(opcoes.ttlMs || entrada.ttlMs || ttlFluxoMs(tipoFluxo));
  const ttlMs = Number.isFinite(ttlEntradaMs) ? ttlEntradaMs : ttlFluxoMs(tipoFluxo);
  const origem = timestampComercialOferta(oferta, agoraMs);
  const idadeComercialMs = Math.max(0, agoraMs - origem.ms);
  const expiraEmComercial = new Date(origem.ms + ttlMs).toISOString();

  return {
    tipoFluxo,
    ttlMs,
    origemComercialMs: origem.ms,
    origemComercialCampo: origem.campo,
    idadeComercialMs,
    expiraEmComercial,
    expirada: idadeComercialMs >= ttlMs
  };
}

function isoValido(valor = "") {
  if (!valor) return "";
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function metadataOperacionalFlow(item = {}) {
  return objeto(item.metadata?.flowOperacional || item.flowOperacional);
}

function origemPoliticaExpiracao(valor = "") {
  return texto(valor) || "flow_manager";
}

function expiraEmProtegidoPorEntrada(expiraEm = "", item = {}, ttlMs = TTL_NORMAL_MS) {
  const expiraIso = isoValido(expiraEm);
  if (!expiraIso) return "";

  const entrada = timestampIsoConfiavelItem(item);
  const expiraMs = Date.parse(expiraIso);
  if (!Number.isFinite(entrada.ms) || !Number.isFinite(expiraMs) || expiraMs >= entrada.ms) {
    return expiraIso;
  }

  return new Date(entrada.ms + ttlMs).toISOString();
}

function calcularExpiracaoOperacionalFila(item = {}, opcoes = {}) {
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const metadataFlow = metadataOperacionalFlow(item);
  const tipoFluxo = tipoFluxoOferta({
    tipoFluxo: opcoes.tipoFluxo || item.tipoFluxo || metadataFlow.tipoFluxo,
    tipoOperacional: item.tipoOperacional || item.tipo_operacional || item.modoEnvio || item.modo,
    cupomTurbo: item.cupomTurbo === true || item.turbo === true || metadataFlow.tipoFluxo === "cupom_turbo",
    oferta: item
  });
  const ttlMs = Number(opcoes.ttlMs || item.ttlMs || metadataFlow.ttlMs || ttlFluxoMs(tipoFluxo));
  const timestamp = timestampBufferItem(item);
  const entradaConfiavel = timestampIsoConfiavelItem(item);
  const origemMs = Number.isFinite(Number(opcoes.origemMs))
    ? Number(opcoes.origemMs)
    : timestamp.ms;
  const origemFinalMs = Number.isFinite(origemMs) ? origemMs : null;
  const entradaMs = entradaConfiavel.ms;
  const expiraPersistido = isoValido(item.expiraEm || metadataFlow.expiraEm || "");
  const expiraPersistidoMs = expiraPersistido ? Date.parse(expiraPersistido) : NaN;
  const expiraPersistidoAntesEntrada = Number.isFinite(expiraPersistidoMs) &&
    Number.isFinite(entradaMs) &&
    expiraPersistidoMs < entradaMs;
  const origemCorrigidaMs = expiraPersistidoAntesEntrada && Number.isFinite(entradaMs)
    ? entradaMs
    : origemFinalMs;
  const expiraEmCalculado = expiraPersistido && !expiraPersistidoAntesEntrada
    ? expiraPersistido
    : (Number.isFinite(origemCorrigidaMs) ? new Date(origemCorrigidaMs + ttlMs).toISOString() : "");
  const expiraEm = expiraEmProtegidoPorEntrada(expiraEmCalculado, item, ttlMs);
  const expiraEmMs = expiraEm ? Date.parse(expiraEm) : NaN;

  return {
    tipoFluxo,
    ttlMs,
    origemMs: origemCorrigidaMs,
    origemCampo: timestamp.campo,
    entradaConfiavelMs: entradaMs,
    entradaConfiavelCampo: entradaConfiavel.campo,
    expiraPersistidoCorrigido: expiraPersistidoAntesEntrada,
    expiraEm,
    expiraEmMs,
    vencido: Number.isFinite(expiraEmMs) && expiraEmMs < agoraMs,
    politica: origemPoliticaExpiracao(opcoes.politica)
  };
}

function carimbarExpiracaoOperacionalFila(item = {}, decisao = {}, opcoes = {}) {
  if (!item || typeof item !== "object") return item;

  const expiraDecisao = isoValido(decisao.expiraEm || "");
  const tipoFluxo = texto(decisao.tipoFluxo) || tipoFluxoOferta({
    tipoFluxo: item.tipoFluxo,
    tipoOperacional: item.tipoOperacional || item.tipo_operacional || item.modoEnvio || item.modo,
    cupomTurbo: item.cupomTurbo === true || item.turbo === true,
    oferta: item
  });
  const ttlMs = Number(decisao.ttlMs || ttlFluxoMs(tipoFluxo));
  const calculada = calcularExpiracaoOperacionalFila(item, {
    ...opcoes,
    tipoFluxo,
    ttlMs
  });
  const expiraEm = expiraEmProtegidoPorEntrada(expiraDecisao || calculada.expiraEm, item, ttlMs);

  if (!expiraEm) return item;

  item.expiraEm = expiraEm;
  item.ttlMs = ttlMs;
  item.tipoFluxo = tipoFluxo;
  item.metadata = {
    ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
    flowOperacional: {
      ...(item.metadata?.flowOperacional && typeof item.metadata.flowOperacional === "object" ? item.metadata.flowOperacional : {}),
      ttlMs,
      tipoFluxo,
      expiraEm,
      politica: origemPoliticaExpiracao(opcoes.politica),
      origem: "flow_manager"
    }
  };

  return item;
}

function sanearExpiracaoOperacionalFilaItem(item = {}, opcoes = {}) {
  if (!item || typeof item !== "object") {
    return { alterou: false, expirou: false, motivo: "item_invalido" };
  }

  const status = texto(item.status).toLowerCase();
  if (status && status !== "pendente") {
    return { alterou: false, expirou: false, motivo: "status_fora_pendente" };
  }

  const politica = calcularExpiracaoOperacionalFila(item, opcoes);
  let alterou = false;

  if (politica.expiraEm) {
    if (item.expiraEm !== politica.expiraEm) {
      item.expiraEm = politica.expiraEm;
      alterou = true;
    }
    if (item.ttlMs !== politica.ttlMs) {
      item.ttlMs = politica.ttlMs;
      alterou = true;
    }
    if (item.tipoFluxo !== politica.tipoFluxo) {
      item.tipoFluxo = politica.tipoFluxo;
      alterou = true;
    }
  }

  if (!politica.expiraEm) {
    return { alterou, expirou: false, motivo: "sem_timestamp_operacional", ...politica };
  }

  const metadataAnterior = JSON.stringify(item.metadata?.flowOperacional || {});
  item.metadata = {
    ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
    flowOperacional: {
      ...(item.metadata?.flowOperacional && typeof item.metadata.flowOperacional === "object" ? item.metadata.flowOperacional : {}),
      ttlMs: politica.ttlMs,
      tipoFluxo: politica.tipoFluxo,
      expiraEm: politica.expiraEm,
      politica: politica.politica,
      origem: item.expiraEm ? "executor_saneamento" : "flow_manager"
    }
  };
  if (JSON.stringify(item.metadata.flowOperacional || {}) !== metadataAnterior) alterou = true;

  if (!politica.vencido) {
    return { alterou, expirou: false, motivo: "vivo_operacional", ...politica };
  }

  item.status = "expirada_operacional";
  item.statusDetalhe = "Expirada pelo TTL operacional do Flow antes do envio";
  item.expiradaEm = new Date(Number(opcoes.agoraMs || Date.now())).toISOString();
  item.motivoExpiracao = "ttl_operacional_flow";
  alterou = true;

  return { alterou, expirou: true, motivo: "ttl_operacional_vencido", ...politica };
}

function coberturaFluxoMinutos(tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo" ? COBERTURA_TURBO_MINUTOS : COBERTURA_NORMAL_MINUTOS;
}

function prioridadeFluxoOferta(entrada = {}, tipoFluxo = "") {
  const oferta = objeto(entrada.oferta);
  const base = numero(
    entrada.prioridade ??
    entrada.prioridadeFluxo ??
    oferta.prioridade ??
    oferta.prioridadeEnvio ??
    oferta.prioridadeFila ??
    oferta.score,
    40
  );
  if (tipoFluxo === "cupom_turbo") return Math.max(110, base);
  return Math.max(0, Math.min(100, Math.round(base)));
}

function calcularBufferAtualShadow(filaItens = [], destinosResumo = {}, opcoes = {}) {
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const destinosAptos = idsDestinosAptos(destinosResumo);
  const itensContados = [];
  const itensIgnorados = [];

  for (const item of lista(filaItens)) {
    const status = statusBufferItem(item);
    const id = item.id || item.filaItemId || item.ofertaId || item.oferta_id || null;
    if (!STATUS_BUFFER_VIVO.has(status)) {
      itensIgnorados.push({ id, status, motivo: "status_fora_pressao_viva" });
      continue;
    }

    if (!itemCompativelComDestinos(item, destinosAptos)) {
      itensIgnorados.push({ id, status, motivo: "destino_incompativel" });
      continue;
    }

    const timestamp = timestampBufferItem(item);
    if (timestamp.ms === null) {
      itensIgnorados.push({ id, status, motivo: "sem_timestamp" });
      continue;
    }

    const tipoFluxo = tipoFluxoOferta({
      tipoFluxo: item.tipoFluxo,
      tipoOperacional: item.tipoOperacional || item.tipo_operacional || item.modoEnvio || item.modo,
      cupomTurbo: item.cupomTurbo === true || item.turbo === true,
      oferta: item
    });
    const ttlMs = ttlFluxoMs(tipoFluxo);
    const idadeMs = Math.max(0, agoraMs - timestamp.ms);
    if (idadeMs >= ttlMs) {
      itensIgnorados.push({ id, status, idadeMs, ttlMs, motivo: "fora_ttl_shadow" });
      continue;
    }

    itensContados.push({
      id,
      status,
      idadeMs,
      ttlMs,
      destino: CAMPOS_DESTINO_BUFFER.map(campo => texto(item?.[campo])).find(Boolean) || "sem_destino_explicito",
      motivo: "item_vivo_dentro_ttl_shadow"
    });
  }

  return {
    bufferAtual: itensContados.length,
    itensContados,
    itensIgnorados
  };
}

function contarItensIgnoradosBuffer(itensIgnorados = []) {
  const contagem = {};
  for (const item of lista(itensIgnorados)) {
    const motivo = texto(item.motivo) || "desconhecido";
    contagem[motivo] = (contagem[motivo] || 0) + 1;
  }
  return contagem;
}

function motivoSemCapacidade(destinosResumo = {}, creditoOk = true, runtime = null, nivelAlvo = 0) {
  if (!creditoOk) return "sem_credito";
  if (runtime) return runtime.motivo || "sessao_ou_integracao_inapta";
  if (numero(destinosResumo.destinosAtivos) <= 0) return "automacao_desligada";
  if (numero(destinosResumo.integracoesAptas) <= 0) return "sessao_ou_integracao_inapta";
  if (numero(destinosResumo.destinosAptos) <= 0) {
    const capacidades = lista(destinosResumo.capacidadePorDestino);
    const integracoes = capacidades.filter(item => item.destinoHabilitado && item.integracaoApta);
    const todosLimiteZerado = integracoes.length > 0 && integracoes.every(item => item.limiteDiarioRestante === 0);
    return todosLimiteZerado ? "limite_diario_esgotado" : "janela_fechada";
  }
  if (nivelAlvo <= 0) return "sem_saida_possivel";
  return "esteira_saturada";
}

async function verificarCreditos(workspaceId = "", oferta = {}, opcoes = {}) {
  if (typeof opcoes.validarCreditos !== "function") return { ok: true };
  try {
    const resultado = await opcoes.validarCreditos(workspaceId, oferta);
    if (resultado?.ok === false) return { ok: false, motivo: resultado.motivo || "sem_credito" };
    return { ok: true };
  } catch (_) {
    return { ok: false, motivo: "creditos_indisponiveis" };
  }
}

function diagnosticarRuntime(entrada = {}, opcoes = {}) {
  if (typeof opcoes.diagnosticarDisponibilidadeEnvioWorkspace !== "function") return null;
  try {
    const resultado = opcoes.diagnosticarDisponibilidadeEnvioWorkspace(entrada.workspaceId || "", {
      destinosCompativeis: entrada.destinosCompativeis || [],
      oferta: entrada.oferta || {
        id: entrada.ofertaId,
        marketplace: entrada.marketplace
      }
    });
    if (!resultado || resultado.ok !== false) return null;
    const motivo = texto(resultado.motivo).toLowerCase();
    if (/credito/.test(motivo)) return { motivo: "sem_credito" };
    if (/destino/.test(motivo)) return { motivo: "sem_destino_apto" };
    if (/janela|horario|horário/.test(motivo)) return { motivo: "janela_fechada" };
    if (/sessao|sessão|integracao|integração|canal|whatsapp|telegram/.test(motivo)) {
      return { motivo: "sessao_ou_integracao_inapta" };
    }
    return { motivo: motivo || "workspace_indisponivel" };
  } catch (_) {
    return { motivo: "workspace_indisponivel" };
  }
}

function nivelAlvoPorCobertura(destinosResumo = {}, tipoFluxo = "") {
  return tipoFluxo === "cupom_turbo"
    ? limitarNaoNegativo(destinosResumo.filaAlvo5Min ?? destinosResumo.slots5Min)
    : limitarNaoNegativo(destinosResumo.filaAlvo10Min ?? destinosResumo.slots10Min);
}

function logFlowShadow(decisao = {}) {
  try {
    console.log("[OPTIMUS-FLOW-V1-SHADOW]", JSON.stringify({
      workspaceId: texto(decisao.workspaceId),
      ofertaId: decisao.ofertaId ?? null,
      marketplace: texto(decisao.marketplace),
      tipoFluxo: texto(decisao.tipoFluxo),
      aceitarAgora: decisao.aceitarAgora === true,
      motivo: texto(decisao.motivo),
      nivelAlvo: decisao.nivelAlvo ?? null,
      bufferAtual: decisao.bufferAtual ?? null,
      vagasDisponiveis: decisao.vagasDisponiveis ?? null,
      destinosAptos: decisao.destinosAptos ?? null,
      itensBufferContados: decisao.itensBufferContados ?? null,
      itensBufferIgnorados: decisao.itensBufferIgnorados ?? null,
      motivosItensIgnorados: objeto(decisao.motivosItensIgnorados),
      ttlMs: decisao.ttlMs ?? null,
      idadeOfertaMs: decisao.idadeOfertaMs ?? null,
      prioridadeFluxo: decisao.prioridadeFluxo ?? null,
      aplicouMudancas: false
    }));
  } catch (_) {}
}

function logBufferVivoFlowShadow(bufferVivo = {}, divergencia = {}) {
  try {
    console.log("[BUFFER-VIVO-SHADOW]", JSON.stringify({
      origem: "flow_manager",
      workspaceId: texto(bufferVivo.workspaceId),
      ofertaId: bufferVivo.capacidadePorOferta?.ofertaId ?? null,
      marketplace: texto(bufferVivo.capacidadePorOferta?.marketplace),
      categoria: texto(bufferVivo.capacidadePorOferta?.categoria),
      estado: texto(bufferVivo.estado),
      bufferAlvo: bufferVivo.bufferAlvo ?? null,
      bufferAtualUtil: bufferVivo.bufferAtualUtil ?? null,
      deficitBuffer: bufferVivo.deficitBuffer ?? null,
      slotsFuturosUtilizaveis: bufferVivo.slotsFuturosUtilizaveis ?? null,
      motivo: texto(bufferVivo.motivo),
      flowAceitarAgora: divergencia.aceitarFlow,
      bufferVivoAceitarAgora: divergencia.aceitarBufferVivo,
      aplicouMudancas: false
    }));
    console.log("[BUFFER-VIVO-CAPACIDADE-POR-BRACO]", JSON.stringify({
      origem: "flow_manager",
      workspaceId: texto(bufferVivo.workspaceId),
      ofertaId: bufferVivo.capacidadePorOferta?.ofertaId ?? null,
      capacidadePorOferta: bufferVivo.capacidadePorOferta || {},
      capacidadePorDestino: lista(bufferVivo.capacidadePorDestino).map(item => ({
        destinoId: item.destinoId,
        nome: item.nome,
        tipo: item.tipo,
        aptoAgora: item.aptoAgora === true,
        janelaAbertaAgora: item.janelaAbertaAgora === true,
        integracaoApta: item.integracaoApta === true,
        intervaloEfetivo: item.intervaloEfetivo,
        slotsFuturosUtilizaveis: item.slotsFuturosUtilizaveis,
        bufferAtualDestino: item.bufferAtualDestino,
        deficitDestino: item.deficitDestino,
        limiteDiarioRestante: item.limiteDiarioRestante,
        proximoHorarioPermitido: item.proximoHorarioPermitido
      })),
      pressaoPorDestino: bufferVivo.pressaoPorDestino || {},
      pressaoPorMarketplace: bufferVivo.pressaoPorMarketplace || {},
      pressaoPorCategoria: bufferVivo.pressaoPorCategoria || {},
      aplicouMudancas: false
    }));
    if (divergencia.divergente) {
      console.log("[BUFFER-VIVO-DIVERGENCIA-FLOW]", JSON.stringify({
        origem: "flow_manager",
        workspaceId: texto(bufferVivo.workspaceId),
        ofertaId: bufferVivo.capacidadePorOferta?.ofertaId ?? null,
        divergencias: lista(divergencia.divergencias),
        aceitarFlow: divergencia.aceitarFlow,
        aceitarBufferVivo: divergencia.aceitarBufferVivo,
        motivoFlow: texto(divergencia.motivoFlow),
        motivoBufferVivo: texto(divergencia.motivoBufferVivo),
        nivelAlvoFlow: bufferVivo.flowAtual?.nivelAlvo ?? null,
        bufferAtualFlow: bufferVivo.flowAtual?.bufferAtual ?? null,
        vagasDisponiveisFlow: bufferVivo.flowAtual?.vagasDisponiveis ?? null,
        bufferAlvo: bufferVivo.bufferAlvo,
        bufferAtualUtil: bufferVivo.bufferAtualUtil,
        deficitBuffer: bufferVivo.deficitBuffer,
        capacidadeAgregada: divergencia.capacidadeAgregada,
        aplicouMudancas: false
      }));
    }
  } catch (_) {}
}

async function avaliarFluxoWorkspaceShadow(entrada = {}, opcoes = {}) {
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const workspaceId = texto(entrada.workspaceId || entrada.clienteId || entrada.oferta?.cliente_id);
  const oferta = objeto(entrada.oferta);
  const marketplace = texto(entrada.marketplace || oferta.marketplace);
  const ofertaId = entrada.ofertaId ?? oferta.id ?? null;
  const tipoFluxo = tipoFluxoOferta(entrada);
  const coberturaMinutos = coberturaFluxoMinutos(tipoFluxo);
  const frescor = avaliarFrescorComercialOferta({ ...entrada, oferta, tipoFluxo }, { agoraMs });
  const ttlMs = frescor.ttlMs;
  const idadeOfertaMs = frescor.idadeComercialMs;
  const expiraEm = frescor.expiraEmComercial;
  const prioridadeFluxo = prioridadeFluxoOferta(entrada, tipoFluxo);

  if (frescor.expirada) {
    const decisao = {
      modo: "shadow",
      workspaceId,
      ofertaId,
      marketplace,
      aceitarAgora: false,
      motivo: "flow_expirada_frescor_comercial",
      quantidadeAceita: 0,
      nivelAlvo: 0,
      bufferAtual: null,
      vagasDisponiveis: 0,
      destinosAptos: null,
      ttlMs,
      expiraEm,
      expiraEmComercial: expiraEm,
      origemComercialCampo: frescor.origemComercialCampo,
      origemComercialMs: frescor.origemComercialMs,
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
      idadeComercialMs: idadeOfertaMs,
      aplicouMudancas: false
    };
    logFlowShadow(decisao);
    return decisao;
  }

  try {
    const destinos = lista(entrada.destinosCompativeis);
    const destinosPreview = avaliarDestinosWorkspace(destinos, coberturaMinutos, []);
    const fila = resumoFilaWorkspace(workspaceId, {
      ...opcoes,
      readClienteJson: opcoes.readClienteJson || readClienteJson,
      janelaAbertaAgora: destinosPreview.janelaAbertaAgora
    });
    const destinosResumo = avaliarDestinosWorkspace(destinos, coberturaMinutos, fila.itens || []);
    const credito = await verificarCreditos(workspaceId, oferta, opcoes);
    const runtime = diagnosticarRuntime({ ...entrada, workspaceId, oferta }, opcoes);
    const nivelCalculado = nivelAlvoPorCobertura(destinosResumo, tipoFluxo);
    const nivelAlvo = destinosResumo.janelaAbertaAgora === true && !runtime && credito.ok
      ? nivelCalculado
      : 0;
    const bufferShadow = calcularBufferAtualShadow(fila.itens || [], destinosResumo, { agoraMs });
    const bufferAtual = limitarNaoNegativo(bufferShadow.bufferAtual);
    const vagasDisponiveis = Math.max(0, nivelAlvo - bufferAtual);
    const aceitarAgora = nivelAlvo > 0 && vagasDisponiveis > 0;
    const motivo = aceitarAgora
      ? "capacidade_disponivel"
      : motivoSemCapacidade(destinosResumo, credito.ok, runtime || (credito.ok ? null : { motivo: credito.motivo }), nivelAlvo);

    const decisao = {
      modo: "shadow",
      workspaceId,
      ofertaId,
      marketplace,
      aceitarAgora,
      motivo,
      quantidadeAceita: aceitarAgora ? 1 : 0,
      nivelAlvo,
      bufferAtual,
      vagasDisponiveis,
      destinosAptos: limitarNaoNegativo(destinosResumo.destinosAptos),
      ttlMs,
      expiraEm,
      expiraEmComercial: expiraEm,
      origemComercialCampo: frescor.origemComercialCampo,
      origemComercialMs: frescor.origemComercialMs,
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
      idadeComercialMs: idadeOfertaMs,
      itensBufferShadow: bufferShadow.itensContados,
      itensBufferContados: bufferShadow.itensContados.length,
      itensBufferIgnorados: bufferShadow.itensIgnorados.length,
      motivosItensIgnorados: contarItensIgnoradosBuffer(bufferShadow.itensIgnorados),
      aplicouMudancas: false
    };
    const bufferVivo = calcularBufferVivoWorkspace({
      workspaceId,
      ofertaId,
      marketplace,
      oferta,
      tipoFluxo,
      destinosCompativeis: destinos,
      destinosResumo,
      filaItens: fila.itens || [],
      flowAtual: {
        aceitarAgora,
        motivo,
        nivelAlvo,
        bufferAtual,
        vagasDisponiveis
      },
      saudeAgregada: {
        filaAlvo5Min: destinosResumo.filaAlvo5Min,
        filaAlvo10Min: destinosResumo.filaAlvo10Min,
        filaAlvo15Min: destinosResumo.filaAlvo15Min,
        pressaoEsteiraViva: fila.pressaoEsteiraViva,
        capacidade: Math.max(0, limitarNaoNegativo(destinosResumo.filaAlvo15Min) - limitarNaoNegativo(fila.pressaoEsteiraViva))
      },
      agoraMs
    });
    const divergenciaBufferVivo = resumirDivergenciaBufferVivo(bufferVivo);
    decisao.bufferVivoShadow = bufferVivo;
    decisao.bufferVivoDivergencia = divergenciaBufferVivo;
    logBufferVivoFlowShadow(bufferVivo, divergenciaBufferVivo);
    logFlowShadow(decisao);
    return decisao;
  } catch (erro) {
    const decisao = {
      modo: "shadow",
      workspaceId,
      ofertaId,
      marketplace,
      aceitarAgora: true,
      motivo: "flow_shadow_indisponivel",
      quantidadeAceita: 1,
      nivelAlvo: null,
      bufferAtual: null,
      vagasDisponiveis: null,
      destinosAptos: null,
      ttlMs,
      expiraEm,
      expiraEmComercial: expiraEm,
      origemComercialCampo: frescor.origemComercialCampo,
      origemComercialMs: frescor.origemComercialMs,
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
      idadeComercialMs: idadeOfertaMs,
      erro: erro?.message || "",
      aplicouMudancas: false
    };
    logFlowShadow(decisao);
    return decisao;
  }
}

module.exports = {
  COBERTURA_NORMAL_MINUTOS,
  COBERTURA_TURBO_MINUTOS,
  TTL_NORMAL_MS,
  TTL_TURBO_MS,
  avaliarFluxoWorkspaceShadow,
  avaliarFrescorComercialOferta,
  calcularBufferAtualShadow,
  calcularExpiracaoOperacionalFila,
  carimbarExpiracaoOperacionalFila,
  contarItensIgnoradosBuffer,
  coberturaFluxoMinutos,
  flowManagerAtivoWorkspace,
  sanearExpiracaoOperacionalFilaItem,
  ttlFluxoMs,
  nivelAlvoPorCobertura,
  prioridadeFluxoOferta
};
