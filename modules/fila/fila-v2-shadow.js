"use strict";

const fs = require("fs");
const {
  itemVivoOperacional,
  statusItem,
  timestampFila,
  JANELA_EXECUTOR_MS
} = require("./fila-store");

const FILA_VIVA_ARQUIVO = "fila-viva.json";
const FILA_HISTORICO_ARQUIVO = "fila-historico.json";
const FILA_LEGADA_ARQUIVO = "fila.json";
const INTERVALO_SHADOW_MS = 5 * 60 * 1000;

const STATUS_HISTORICO_EXPLICITO = new Set([
  "enviado",
  "enviada",
  "historico",
  "expirada",
  "expirado",
  "expirada_operacional",
  "expirado_operacional",
  "erro_final",
  "erro_permanente",
  "falha_final",
  "cancelada",
  "cancelado",
  "descartada",
  "descartado"
]);

const MOTIVOS_RETIDA_OPERACIONAL = [
  "intervalo",
  "aguardando",
  "fora_horario",
  "fora_da_janela",
  "limite_diario",
  "sessao",
  "proxima_tentativa"
];

const MOTIVOS_RETIDA_TERMINAL = [
  "sem_destino",
  "sem destino",
  "destino_compativel",
  "categoria_nao_marcada",
  "marketplace_nao_marcado",
  "repetida",
  "duplicata",
  "preco_suspeito",
  "retida_terminal"
];

function texto(valor = "") {
  return String(valor || "").trim();
}

function textoNormalizado(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clienteItem(item = {}) {
  return texto(item.clienteId || item.cliente_id || "admin") || "admin";
}

function idItem(item = {}, indice = -1) {
  return texto(
    item.id ||
    item.ofertaId ||
    item.oferta_id ||
    item.engineOfertaId ||
    item.engine_oferta_id ||
    item.idOferta
  ) || `indice:${indice}`;
}

function motivoItem(item = {}) {
  return textoNormalizado([
    item.motivoRetencao,
    item.motivo,
    item.motivoFinal,
    item.statusDetalhe,
    item.statusDetalheVisual,
    item.erro
  ].filter(Boolean).join(" "));
}

function enviadoRecenteExecutor(item = {}, agora = Date.now()) {
  const status = statusItem(item);
  if (status !== "enviado" && status !== "enviada") return false;
  const enviadoEmMs = timestampFila(item.enviadoEm || item.dataEnvio);
  return Number.isFinite(enviadoEmMs) &&
    enviadoEmMs <= agora &&
    agora - enviadoEmMs < JANELA_EXECUTOR_MS;
}

function erroRecuperavel(item = {}) {
  return Boolean(item.proximaTentativaEnvioEm || item.retry || item.recuperavel);
}

function retidaOperacional(item = {}) {
  if (item.retidaTerminal === true) return false;
  if (item.proximaTentativaEnvioEm) return true;
  const motivo = motivoItem(item);
  if (MOTIVOS_RETIDA_OPERACIONAL.some(parte => motivo.includes(parte))) return true;
  if (MOTIVOS_RETIDA_TERMINAL.some(parte => motivo.includes(parte))) return false;
  return false;
}

function classificarItemFilaV2(item = {}, opcoes = {}) {
  const agora = Number(opcoes.agora || Date.now());
  const status = statusItem(item);

  if (itemVivoOperacional(item)) {
    return { bucket: "viva", motivo: "status_operacional" };
  }

  if (enviadoRecenteExecutor(item, agora)) {
    return { bucket: "viva", motivo: "enviado_recente_executor_2h" };
  }

  if (status === "erro") {
    return erroRecuperavel(item)
      ? { bucket: "viva", motivo: "erro_recuperavel" }
      : { bucket: "historico", motivo: "erro_terminal" };
  }

  if (status === "retida" || status === "retido") {
    return retidaOperacional(item)
      ? { bucket: "viva", motivo: "retida_operacional" }
      : { bucket: "historico", motivo: "retida_terminal" };
  }

  if (STATUS_HISTORICO_EXPLICITO.has(status)) {
    return { bucket: "historico", motivo: enviadoRecenteExecutor(item, agora) ? "enviado_recente_executor_2h" : "status_terminal" };
  }

  return { bucket: "viva", motivo: "fallback_conservador" };
}

function entradaShadow(item = {}, indice = 0, classificacao = {}) {
  return {
    posicaoLegada: indice,
    bucket: classificacao.bucket || "",
    motivoBucket: classificacao.motivo || "",
    status: statusItem(item),
    id: idItem(item, indice),
    item
  };
}

function projetarFilaV2(filaLegada = [], opcoes = {}) {
  const agora = Number(opcoes.agora || Date.now());
  const fila = Array.isArray(filaLegada) ? filaLegada : [];
  const viva = [];
  const historico = [];
  const statusViva = {};
  const statusHistorico = {};

  fila.forEach((item, indice) => {
    const classificacao = classificarItemFilaV2(item, { agora });
    const entrada = entradaShadow(item, indice, classificacao);
    if (classificacao.bucket === "historico") {
      historico.push(entrada);
      statusHistorico[entrada.status || "desconhecido"] = (statusHistorico[entrada.status || "desconhecido"] || 0) + 1;
    } else {
      viva.push(entrada);
      statusViva[entrada.status || "desconhecido"] = (statusViva[entrada.status || "desconhecido"] || 0) + 1;
    }
  });

  const unificada = recomporEntradasLegadas(viva, historico);
  const comparacao = compararFilaLegada(fila, unificada);

  return {
    ok: comparacao.divergencias === 0,
    totalLegado: fila.length,
    totalViva: viva.length,
    totalHistorico: historico.length,
    viva,
    historico,
    unificada,
    comparacao,
    statusViva,
    statusHistorico
  };
}

function recomporEntradasLegadas(viva = [], historico = []) {
  return [...(Array.isArray(viva) ? viva : []), ...(Array.isArray(historico) ? historico : [])]
    .sort((a, b) => Number(a?.posicaoLegada || 0) - Number(b?.posicaoLegada || 0))
    .map(entrada => entrada?.item)
    .filter(Boolean);
}

function compararFilaLegada(filaLegada = [], filaUnificada = []) {
  const divergencias = {
    total: 0,
    ids: 0,
    status: 0,
    ordem: 0
  };
  const legado = Array.isArray(filaLegada) ? filaLegada : [];
  const unificada = Array.isArray(filaUnificada) ? filaUnificada : [];

  if (legado.length !== unificada.length) divergencias.total += Math.abs(legado.length - unificada.length) || 1;

  const limite = Math.min(legado.length, unificada.length);
  for (let i = 0; i < limite; i += 1) {
    const idLegado = idItem(legado[i], i);
    const idUnificado = idItem(unificada[i], i);
    if (idLegado !== idUnificado) {
      divergencias.ids += 1;
      divergencias.ordem += 1;
    }
    if (statusItem(legado[i]) !== statusItem(unificada[i])) divergencias.status += 1;
  }

  const totalDivergencias = divergencias.total + divergencias.ids + divergencias.status + divergencias.ordem;
  return {
    ok: totalDivergencias === 0,
    divergencias: totalDivergencias,
    totalDivergente: divergencias.total,
    idsDivergentes: divergencias.ids,
    statusDivergentes: divergencias.status,
    ordemDivergente: divergencias.ordem
  };
}

function tamanhoJsonBytes(valor) {
  try {
    return Buffer.byteLength(JSON.stringify(valor, null, 2), "utf8");
  } catch {
    return 0;
  }
}

function statBytes(file = "") {
  try {
    return fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch {
    return 0;
  }
}

function caminhoCliente(getClienteJsonPath, clienteId = "admin", arquivo = "") {
  if (typeof getClienteJsonPath !== "function") return "";
  return getClienteJsonPath(clienteId, arquivo);
}

function logShadow(logger = console, payload = {}) {
  const destino = logger && typeof logger.log === "function" ? logger : console;
  destino.log("[FILA-V2-SHADOW]", JSON.stringify(payload));
}

function shadowCompletoEvitado(opcoes = {}, params = {}, clienteId = "admin") {
  if (typeof opcoes.devePularShadowCompleto === "function") {
    try {
      return opcoes.devePularShadowCompleto({
        clienteId,
        motivo: params.motivo || "snapshot",
        agora: params.agora || Date.now()
      }) === true;
    } catch {
      return false;
    }
  }
  return opcoes.pularShadowCompleto === true;
}

function logShadowCompletoEvitado(logger = console, params = {}, clienteId = "admin") {
  const payload = {
    versao: 2,
    motivo: params.motivo || "snapshot",
    clienteId,
    pulou: true,
    shadowCompletoEvitado: true,
    motivoSkip: "fila_v2_operacional_habilitada",
    totalLegado: "nao_medido",
    totalViva: "nao_medido",
    totalHistorico: "nao_medido",
    bytesFilaJson: "nao_medido",
    bytesFilaVivaJson: "nao_medido",
    bytesFilaHistoricoJson: "nao_medido",
    tempoProjecaoMs: 0
  };
  logShadow(logger, payload);
  return { ok: true, ...payload };
}

function projetarFilaV2Shadow({
  fila = [],
  clienteId = "admin",
  motivo = "snapshot",
  agora = Date.now(),
  writeClienteJson,
  getClienteJsonPath,
  logger = console
} = {}) {
  const inicio = process.hrtime.bigint();
  const cliente = texto(clienteId || "admin") || "admin";

  try {
    const legadoCliente = (Array.isArray(fila) ? fila : [])
      .filter(item => clienteItem(item) === cliente);
    const projecao = projetarFilaV2(legadoCliente, { agora });

    if (typeof writeClienteJson === "function") {
      writeClienteJson(cliente, FILA_VIVA_ARQUIVO, projecao.viva);
      writeClienteJson(cliente, FILA_HISTORICO_ARQUIVO, projecao.historico);
    }

    const arquivoLegado = caminhoCliente(getClienteJsonPath, cliente, FILA_LEGADA_ARQUIVO);
    const arquivoViva = caminhoCliente(getClienteJsonPath, cliente, FILA_VIVA_ARQUIVO);
    const arquivoHistorico = caminhoCliente(getClienteJsonPath, cliente, FILA_HISTORICO_ARQUIVO);
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);

    const payload = {
      versao: 1,
      motivo,
      clienteId: cliente,
      totalLegado: projecao.totalLegado,
      totalViva: projecao.totalViva,
      totalHistorico: projecao.totalHistorico,
      divergencias: projecao.comparacao.divergencias,
      idsDivergentes: projecao.comparacao.idsDivergentes,
      statusDivergentes: projecao.comparacao.statusDivergentes,
      ordemDivergente: projecao.comparacao.ordemDivergente,
      bytesFilaJson: statBytes(arquivoLegado) || tamanhoJsonBytes(legadoCliente),
      bytesFilaVivaJson: statBytes(arquivoViva) || tamanhoJsonBytes(projecao.viva),
      bytesFilaHistoricoJson: statBytes(arquivoHistorico) || tamanhoJsonBytes(projecao.historico),
      tempoProjecaoMs: duracaoMs,
      statusViva: projecao.statusViva,
      statusHistorico: projecao.statusHistorico
    };

    logShadow(logger, payload);
    return { ok: true, ...payload, projecao };
  } catch (erro) {
    const duracaoMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    const payload = {
      versao: 1,
      motivo,
      clienteId: cliente,
      ok: false,
      erro: erro?.message || "erro_shadow",
      tempoProjecaoMs: duracaoMs
    };
    logShadow(logger, payload);
    return payload;
  }
}

function lerEntradasShadow(readClienteJson, clienteId = "admin", arquivo = "") {
  if (typeof readClienteJson !== "function") return [];
  const lido = readClienteJson(clienteId, arquivo, []);
  return Array.isArray(lido) ? lido : [];
}

function obterFilaLegadaUnificada(clienteId = "admin", deps = {}) {
  const cliente = texto(clienteId || "admin") || "admin";
  const viva = lerEntradasShadow(deps.readClienteJson, cliente, FILA_VIVA_ARQUIVO);
  const historico = lerEntradasShadow(deps.readClienteJson, cliente, FILA_HISTORICO_ARQUIVO);

  if (viva.length || historico.length) {
    return {
      ok: true,
      fonte: "fila_v2_shadow",
      fila: recomporEntradasLegadas(viva, historico)
    };
  }

  const legado = typeof deps.readClienteJson === "function"
    ? deps.readClienteJson(cliente, FILA_LEGADA_ARQUIVO, [])
    : [];

  return {
    ok: true,
    fonte: "fila_json_legado",
    fila: Array.isArray(legado) ? legado : []
  };
}

function criarControladorFilaV2Shadow(opcoes = {}) {
  const intervaloMs = Number(opcoes.intervaloMs ?? INTERVALO_SHADOW_MS);
  const ultimoPorCliente = new Map();

  function projetarSeNecessario(params = {}) {
    const cliente = texto(params.clienteId || "admin") || "admin";
    const agora = Number(params.agora || Date.now());
    const ultimo = ultimoPorCliente.get(cliente) || 0;
    const forcar = params.forcar === true;
    if (!forcar && intervaloMs > 0 && agora - ultimo < intervaloMs) {
      return { ok: true, pulou: true, motivo: "throttle_shadow", clienteId: cliente };
    }
    ultimoPorCliente.set(cliente, agora);
    if (shadowCompletoEvitado(opcoes, params, cliente)) {
      return logShadowCompletoEvitado(params.logger || opcoes.logger, params, cliente);
    }
    return projetarFilaV2Shadow({ ...opcoes, ...params, clienteId: cliente, agora });
  }

  return {
    projetarSeNecessario
  };
}

module.exports = {
  FILA_VIVA_ARQUIVO,
  FILA_HISTORICO_ARQUIVO,
  FILA_LEGADA_ARQUIVO,
  INTERVALO_SHADOW_MS,
  classificarItemFilaV2,
  enviadoRecenteExecutor,
  projetarFilaV2,
  projetarFilaV2Shadow,
  obterFilaLegadaUnificada,
  criarControladorFilaV2Shadow
};
