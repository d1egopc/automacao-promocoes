"use strict";

const { readClienteJson } = require("../../../utils/storage");
const {
  resumoFilaWorkspace,
  avaliarDestinosWorkspace
} = require("../ofc/absorption-gate.service");

const COBERTURA_NORMAL_MINUTOS = 10;
const COBERTURA_TURBO_MINUTOS = 5;
const TTL_NORMAL_MS = 30 * 60 * 1000;
const TTL_TURBO_MS = 10 * 60 * 1000;
const ENV_FLOW_ATIVO = "OPTIMUS_FLOW_V1_ATIVO";
const ENV_FLOW_ATIVO_WORKSPACES = "OPTIMUS_FLOW_V1_ATIVO_WORKSPACES";

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

function flagLigada(valor = "") {
  return ["1", "true", "sim", "on", "yes"].includes(texto(valor).toLowerCase());
}

function listaWorkspacesAtivos(valor = "") {
  return new Set(
    texto(valor)
      .split(/[,\s;]+/)
      .map(item => texto(item))
      .filter(Boolean)
  );
}

function flowManagerAtivoWorkspace(workspaceId = "", opcoes = {}) {
  const id = texto(workspaceId);
  if (!id) return false;
  if (opcoes.ativo === true || opcoes.flowAtivo === true) return true;
  if (opcoes.ativo === false || opcoes.flowAtivo === false) return false;

  const workspacesOpcao = opcoes.workspacesAtivos instanceof Set
    ? opcoes.workspacesAtivos
    : listaWorkspacesAtivos(opcoes.workspacesAtivos || "");
  if (workspacesOpcao.has(id)) return true;

  if (flagLigada(process.env[ENV_FLOW_ATIVO])) return true;
  return listaWorkspacesAtivos(process.env[ENV_FLOW_ATIVO_WORKSPACES] || "").has(id);
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

function dataOfertaMs(oferta = {}, agoraMs = Date.now()) {
  const candidatos = [
    oferta.criada_em,
    oferta.criado_em,
    oferta.criadoEm,
    oferta.dataEntradaFila,
    oferta.capturado_em,
    oferta.capturadaEm,
    oferta.atualizada_em
  ];

  for (const candidato of candidatos) {
    if (!candidato) continue;
    const ms = Date.parse(candidato);
    if (Number.isFinite(ms)) return ms;
  }

  return agoraMs;
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

function isoValido(valor = "") {
  if (!valor) return "";
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function metadataOperacionalFlow(item = {}) {
  return objeto(item.metadata?.flowOperacional || item.flowOperacional);
}

function origemPoliticaExpiracao(valor = "") {
  return texto(valor) || "flow_manager_d1";
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
  item.statusDetalhe = "Expirada pelo TTL operacional do Flow D1 antes do envio";
  item.expiradaEm = new Date(Number(opcoes.agoraMs || Date.now())).toISOString();
  item.motivoExpiracao = "ttl_operacional_flow_d1";
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

async function avaliarFluxoWorkspaceShadow(entrada = {}, opcoes = {}) {
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const workspaceId = texto(entrada.workspaceId || entrada.clienteId || entrada.oferta?.cliente_id);
  const oferta = objeto(entrada.oferta);
  const marketplace = texto(entrada.marketplace || oferta.marketplace);
  const ofertaId = entrada.ofertaId ?? oferta.id ?? null;
  const tipoFluxo = tipoFluxoOferta(entrada);
  const coberturaMinutos = coberturaFluxoMinutos(tipoFluxo);
  const ttlMs = ttlFluxoMs(tipoFluxo);
  const origemMs = dataOfertaMs(oferta, agoraMs);
  const idadeOfertaMs = Math.max(0, agoraMs - origemMs);
  const expiraEm = new Date(origemMs + ttlMs).toISOString();
  const prioridadeFluxo = prioridadeFluxoOferta(entrada, tipoFluxo);

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
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
      itensBufferShadow: bufferShadow.itensContados,
      itensBufferContados: bufferShadow.itensContados.length,
      itensBufferIgnorados: bufferShadow.itensIgnorados.length,
      motivosItensIgnorados: contarItensIgnoradosBuffer(bufferShadow.itensIgnorados),
      aplicouMudancas: false
    };
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
      prioridadeFluxo,
      tipoFluxo,
      idadeOfertaMs,
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
