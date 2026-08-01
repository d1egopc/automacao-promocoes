"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const {
  caminhosOperacao,
  filaPath,
  executarDryRunResetEsteiras,
  executarPreflightResetEsteiras,
  executarResetEsteiras,
  executarRollbackResetEsteiras
} = require("./reset.runner");
const {
  GRUPOS_ESTEIRA,
  classificarItemResetEsteira,
  hashObjeto,
  identidadeItem,
  resumoLeveItem
} = require("./criterios.service");

const WORKSPACE_PERMITIDO = "user_9hqs434h";
const OPERATION_ID_AUTORIZADA = "esteiras-reset-20260801202852-cd00691c";
const LOTE_TAMANHO_FIXO = 100;
const TIMEOUT_MS = 30000;
const RATE_LIMIT_MS = 10000;
const CONFIRMACAO_DRY_RUN = "DRY_RUN_USER_9HQS434H";
const CONFIRMACAO_RECONCILIAR = "RECONCILIAR_RESET_USER_9HQS434H";
const CONFIRMACAO_EXECUTE = "EXECUTAR_RESET_USER_9HQS434H";
const CONFIRMACAO_ROLLBACK = "ROLLBACK_RESET_USER_9HQS434H";
const PARAMETROS_PROIBIDOS = new Set(["mode", "modo", "dataDir", "path", "caminho"]);
const EMAILS_OPERACIONAIS_AUTORIZADOS = new Set([
  "d1egopcoficial@optimus.com",
  "rogeroficial@optimus.com",
  "wolfoficial@optimus.com"
]);
const PREFLIGHT_REFERENCIA = Object.freeze({
  total: 912,
  elegiveis: 600,
  processando: 2,
  historico: 310
});
const MB = 1024 * 1024;
const MARGEM_MINIMA_EXECUTE_BYTES = 15 * MB;

let resetEmExecucao = false;
let ultimaChamadaMs = 0;

function statusErro(erro) {
  return erro.statusCode || 500;
}

function respostaErro(erro) {
  return {
    ok: false,
    erro: erro.codigo || erro.message || "preflight_reset_esteira_erro"
  };
}

function criarErro(codigo, statusCode = 400) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = statusCode;
  return erro;
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function listarArquivosJson(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(nome => nome.endsWith(".json"))
      .sort();
  } catch (_) {
    return [];
  }
}

function tamanhoDirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const atual = stack.pop();
    let stats;
    try {
      stats = fs.lstatSync(atual);
    } catch (_) {
      continue;
    }
    if (stats.isDirectory()) {
      let filhos = [];
      try {
        filhos = fs.readdirSync(atual);
      } catch (_) {
        filhos = [];
      }
      for (const nome of filhos) stack.push(path.join(atual, nome));
    } else if (stats.isFile()) {
      total += stats.size;
    }
  }
  return total;
}

function hashArquivo(file) {
  try {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(file));
    return hash.digest("hex");
  } catch (_) {
    return null;
  }
}

function obterEspacoVolume(dataDir = "/data") {
  try {
    const stats = fs.statfsSync(dataDir);
    const total = Number(stats.blocks || 0) * Number(stats.bsize || 0);
    const livre = Number(stats.bavail || 0) * Number(stats.bsize || 0);
    return {
      espacoTotal: total,
      espacoLivre: livre,
      espacoUsado: Math.max(0, total - livre)
    };
  } catch (_) {
    return {
      espacoTotal: null,
      espacoLivre: null,
      espacoUsado: null
    };
  }
}

function megabytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 1024 / 1024) * 100) / 100;
}

function finaisDoPreflight(resultado = {}) {
  const porBucket = resultado.estatisticas?.porBucket || {};
  return Number(porBucket.erro_final || 0) +
    Number(porBucket.cancelado || 0) +
    Number(porBucket.expirado || 0);
}

function montarRespostaSanitizada(resultado = {}, espaco = {}, duracaoMs = 0) {
  return {
    workspaceId: resultado.workspaceId || WORKSPACE_PERMITIDO,
    tamanhoFilaBytes: resultado.filaJsonBytes ?? null,
    tamanhoFilaMB: megabytes(resultado.filaJsonBytes),
    totalItens: resultado.totalItens ?? 0,
    elegiveisExpiracao: resultado.grupos?.expirar ?? 0,
    processandoPreservados: resultado.estatisticas?.processandoProtegido ?? 0,
    semTimestamp: resultado.estatisticas?.semTimestamp ?? 0,
    enviadosHistorico: resultado.estatisticas?.enviadosHistorico ?? 0,
    finais: finaisDoPreflight(resultado),
    tamanhoBrutoElegiveis: resultado.estimativa?.payloadElegivelBytes ?? null,
    persistenteEstimado: resultado.estimativa?.persistenteEstimadoBytes ?? null,
    temporarioAtomic: resultado.estimativa?.temporariosEscritaAtomicaBytes ?? null,
    margemApp: resultado.estimativa?.margemAppBytes ?? null,
    espacoMinimoNecessario: resultado.espaco?.minimoNecessarioBytes ?? null,
    espacoTotal: espaco.espacoTotal,
    espacoUsado: espaco.espacoUsado,
    espacoLivre: espaco.espacoLivre,
    preflightAprovado: resultado.preflightAprovado === true,
    motivo: resultado.motivo || "estimativa_indisponivel",
    duracaoMs,
    aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais === true,
    snapshotCriado: resultado.snapshotCriado === true,
    lotesCriados: resultado.lotesCriados === true,
    rollbackCriado: resultado.rollbackCriado === true,
    filaAlterada: resultado.filaAlterada === true
  };
}

function timeoutErro() {
  const erro = new Error("preflight_reset_esteira_timeout");
  erro.codigo = "preflight_reset_esteira_timeout";
  erro.statusCode = 503;
  return erro;
}

function comTimeout(promessa, timeoutMs = TIMEOUT_MS) {
  return Promise.race([
    promessa,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(timeoutErro()), timeoutMs);
      timer.unref?.();
    })
  ]);
}

function validarBodySemParametrosLivres(body = {}) {
  for (const chave of Object.keys(body || {})) {
    if (PARAMETROS_PROIBIDOS.has(chave)) throw criarErro("parametro_nao_permitido", 400);
  }
}

function validarWorkspace(workspaceId = "") {
  const workspace = String(workspaceId || WORKSPACE_PERMITIDO).trim();
  if (workspace !== WORKSPACE_PERMITIDO) throw criarErro("workspace_reset_nao_autorizado", 403);
  return workspace;
}

function validarConfirmacaoTexto(recebida = "", esperada = "") {
  if (String(recebida || "") !== esperada) throw criarErro("confirmacao_incorreta", 400);
}

function validarOperationId(operationId = "") {
  const texto = String(operationId || "").trim();
  if (!texto || texto.includes("..") || texto.includes("/") || texto.includes("\\") || !/^[a-zA-Z0-9_.-]+$/.test(texto)) {
    throw criarErro("operation_id_invalido", 400);
  }
  return texto;
}

function validarOperationIdAutorizado(operationId = "", operationIdAutorizado = OPERATION_ID_AUTORIZADA) {
  const opId = validarOperationId(operationId);
  if (operationIdAutorizado !== "*" && opId !== operationIdAutorizado) {
    throw criarErro("operation_id_reset_nao_autorizado", 403);
  }
  return opId;
}

function carregarOperacaoRestrita(operationId = "", dataDir = "/data", operationIdAutorizado = OPERATION_ID_AUTORIZADA) {
  const opId = validarOperationIdAutorizado(operationId, operationIdAutorizado);
  const caminhos = caminhosOperacao(opId, { dataDir });
  const manifest = readJson(caminhos.manifest, null);
  if (!manifest) throw criarErro("operation_id_nao_encontrado", 404);
  const workspaces = Object.keys(manifest.porWorkspace || {});
  if (!workspaces.includes(WORKSPACE_PERMITIDO) || workspaces.some(workspace => workspace !== WORKSPACE_PERMITIDO)) {
    throw criarErro("operation_id_workspace_nao_autorizado", 403);
  }
  return { operationId: opId, caminhos, manifest };
}

function carregarOperacaoRestritaSemAutorizacao(operationId = "", dataDir = "/data") {
  const opId = validarOperationId(operationId);
  const caminhos = caminhosOperacao(opId, { dataDir });
  const manifest = readJson(caminhos.manifest, null);
  if (!manifest) throw criarErro("operation_id_nao_encontrado", 404);
  const workspaces = Object.keys(manifest.porWorkspace || {});
  if (!workspaces.includes(WORKSPACE_PERMITIDO) || workspaces.some(workspace => workspace !== WORKSPACE_PERMITIDO)) {
    throw criarErro("operation_id_workspace_nao_autorizado", 403);
  }
  return { operationId: opId, caminhos, manifest };
}

function hashConjunto(registros = []) {
  return hashObjeto(registros.map(item => item.identidade?.chave || "").sort());
}

function todosRegistrosLotes(caminhos) {
  const registros = [];
  const arquivos = listarArquivosJson(caminhos.lotes);
  const integridade = {
    lotesTotais: arquivos.length,
    lotesIntegrais: 0,
    erros: []
  };
  for (const arquivo of arquivos) {
    const lote = readJson(path.join(caminhos.lotes, arquivo), null);
    if (!lote || lote.workspaceId !== WORKSPACE_PERMITIDO || lote.grupo !== GRUPOS_ESTEIRA.EXPIRAR || !Array.isArray(lote.registros)) {
      integridade.erros.push({ arquivo, erro: "lote_invalido" });
      continue;
    }
    if (Number(lote.total || 0) !== lote.registros.length) {
      integridade.erros.push({ arquivo, erro: "total_lote_divergente" });
      continue;
    }
    const payloadOk = lote.registros.every(registro => registro?.item && registro?.identidade?.chave && registro?.hashIndividual);
    if (!payloadOk) {
      integridade.erros.push({ arquivo, erro: "payload_rollback_insuficiente" });
      continue;
    }
    integridade.lotesIntegrais += 1;
    registros.push(...lote.registros);
  }
  return { registros, integridade };
}

function carregarFilaWorkspace(dataDir = "/data") {
  const file = filaPath(WORKSPACE_PERMITIDO, { dataDir });
  const fila = readJson(file, []);
  if (!Array.isArray(fila)) throw criarErro("fila_json_invalida", 500);
  return { file, fila };
}

function indexarFilaPorIdentidade(fila = []) {
  const mapa = new Map();
  for (const item of fila) {
    const chave = identidadeItem(item).chave;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(item);
  }
  return mapa;
}

function incrementar(mapa = {}, chave = "") {
  const k = String(chave || "desconhecido");
  mapa[k] = (mapa[k] || 0) + 1;
}

function possuiChaveSensivel(valor, profundidade = 0) {
  if (!valor || typeof valor !== "object" || profundidade > 12) return false;
  if (Array.isArray(valor)) return valor.some(item => possuiChaveSensivel(item, profundidade + 1));
  return Object.entries(valor).some(([chave, conteudo]) =>
    /token|secret|senha|password|cookie|authorization|jwt|access[_-]?token|refresh[_-]?token|client[_-]?secret/i.test(chave) ||
    possuiChaveSensivel(conteudo, profundidade + 1)
  );
}

function calcularHistoricoLeveBytes(removiveis = []) {
  const historico = removiveis.map(({ itemAtual, classificacaoAtual }) => resumoLeveItem(itemAtual, classificacaoAtual));
  return Buffer.byteLength(JSON.stringify(historico, null, 2), "utf8");
}

function reconciliarOperacao({ operationId, caminhos, manifest, dataDir }) {
  const { registros, integridade } = todosRegistrosLotes(caminhos);
  const { fila } = carregarFilaWorkspace(dataDir);
  const indice = indexarFilaPorIdentidade(fila);
  const cutoffMs = new Date(manifest.cutoffCongelado).getTime();
  const agoraMs = Date.now();
  let totalAtualmenteCompativel = 0;
  let totalAlteradoPorConcorrencia = 0;
  let totalAusente = 0;
  let processandoPreservados = 0;
  let historicoPreservadoAtual = 0;
  const transicoesPorStatus = {};
  const motivosConcorrencia = {};
  const removiveis = [];

  for (const registro of registros) {
    const chave = registro.identidade?.chave || "";
    const encontrados = indice.get(chave) || [];
    if (encontrados.length !== 1) {
      totalAusente += encontrados.length === 0 ? 1 : 0;
      totalAlteradoPorConcorrencia += encontrados.length > 1 ? 1 : 0;
      incrementar(motivosConcorrencia, encontrados.length === 0 ? "item_ausente" : "identidade_ambigua_atual");
      incrementar(transicoesPorStatus, `${registro.statusAnterior || "sem_status"} -> ${encontrados.length === 0 ? "ausente" : "identidade_ambigua"}`);
      continue;
    }
    const itemAtual = encontrados[0];
    const hashAtual = identidadeItem(itemAtual).hashIndividual;
    const classificacaoAtual = classificarItemResetEsteira(itemAtual, { agoraMs, cutoffMs, colidiu: false });
    if (classificacaoAtual.bucket === "em_tentativa") processandoPreservados += 1;
    if (classificacaoAtual.grupo === GRUPOS_ESTEIRA.PRESERVAR_HISTORICO) historicoPreservadoAtual += 1;
    incrementar(transicoesPorStatus, `${registro.statusAnterior || "sem_status"} -> ${classificacaoAtual.status || "sem_status"}`);

    if (hashAtual === registro.hashIndividual && classificacaoAtual.grupo === GRUPOS_ESTEIRA.EXPIRAR) {
      totalAtualmenteCompativel += 1;
      removiveis.push({ registro, itemAtual, classificacaoAtual });
      continue;
    }
    totalAlteradoPorConcorrencia += 1;
    incrementar(motivosConcorrencia, hashAtual !== registro.hashIndividual ? "hash_individual_divergente" : `grupo_atual_${classificacaoAtual.grupo}`);
  }

  const protegidoManifest = Number(manifest.totais?.preservarHistorico || 0) + Number(manifest.totais?.preservarAtivo || 0);
  const diferencaPreflight = Math.max(0, Number(PREFLIGHT_REFERENCIA.elegiveis) - Number(manifest.totais?.expirar || 0));
  const historicoNovoDesdePreflight = Math.max(0, Number(manifest.totais?.preservarHistorico || 0) - Number(PREFLIGHT_REFERENCIA.historico));
  const divergenciaDeCriterio = integridade.erros.length > 0;
  const executeSeguroPorCriterio = !divergenciaDeCriterio &&
    integridade.erros.length === 0 &&
    registros.length === Number(manifest.totais?.expirar || 0) &&
    totalAtualmenteCompativel > 0;

  return {
    operationId,
    workspaceId: WORKSPACE_PERMITIDO,
    totalSnapshot: manifest.totais?.totalFila ?? null,
    totalElegivelCongelado: manifest.totais?.expirar ?? registros.length,
    totalAtualmenteCompativel,
    totalAlteradoPorConcorrencia,
    totalAusente,
    transicoesPorStatus,
    motivosConcorrencia,
    processandoPreservados,
    historicoPreservado: manifest.totais?.preservarHistorico ?? protegidoManifest,
    historicoPreservadoAtual,
    divergenciaPreflight: {
      preflightElegiveis: PREFLIGHT_REFERENCIA.elegiveis,
      dryRunElegiveis: manifest.totais?.expirar ?? registros.length,
      diferenca: diferencaPreflight,
      historicoPreflight: PREFLIGHT_REFERENCIA.historico,
      historicoDryRun: manifest.totais?.preservarHistorico ?? null,
      transicaoInferida: {
        "pendente_vencido_fluxo_vivo -> preservar_historico": Math.min(diferencaPreflight, historicoNovoDesdePreflight)
      }
    },
    divergencia: divergenciaDeCriterio ? "criterio_ou_integridade" : "concorrencia_normal",
    divergenciaDeCriterio,
    concorrenciaNormal: !divergenciaDeCriterio,
    executeSeguroPorCriterio,
    lotes: integridade,
    removiveis
  };
}

function calcularPicoEspacoExecute({ caminhos, manifest, dataDir, reconciliacao }) {
  const { file, fila } = carregarFilaWorkspace(dataDir);
  const filaAtualBytes = fs.existsSync(file) ? fs.statSync(file).size : Buffer.byteLength(JSON.stringify(fila, null, 2), "utf8");
  const removiveisChaves = new Set((reconciliacao.removiveis || []).map(item => item.registro.identidade?.chave).filter(Boolean));
  const filaPosReset = fila.filter(item => !removiveisChaves.has(identidadeItem(item).chave));
  const filaPosResetBytes = Buffer.byteLength(JSON.stringify(filaPosReset, null, 2), "utf8");
  const arquivosLote = listarArquivosJson(caminhos.lotes);
  let maiorTmpFilaBytes = filaPosResetBytes;
  let executePersistenteBytes = 0;
  let removidosAteAqui = new Set();
  for (const arquivo of arquivosLote) {
    const lote = readJson(path.join(caminhos.lotes, arquivo), {});
    const removiveisLote = (lote.registros || [])
      .map(registro => registro.identidade?.chave)
      .filter(chave => chave && removiveisChaves.has(chave));
    for (const chave of removiveisLote) removidosAteAqui.add(chave);
    const parcial = fila.filter(item => !removidosAteAqui.has(identidadeItem(item).chave));
    maiorTmpFilaBytes = Math.max(maiorTmpFilaBytes, Buffer.byteLength(JSON.stringify(parcial, null, 2), "utf8"));
    executePersistenteBytes += Buffer.byteLength(JSON.stringify({
      workspaceId: WORKSPACE_PERMITIDO,
      lote: lote.lote,
      antes: fila.length,
      depois: parcial.length,
      removidos: removiveisLote.length,
      pulados: Math.max(0, (lote.registros || []).length - removiveisLote.length)
    }, null, 2), "utf8");
  }
  const historicoLeveEstimadoBytes = calcularHistoricoLeveBytes(reconciliacao.removiveis || []);
  const snapshotAtualBytes = tamanhoDirBytes(caminhos.base);
  const bakBytes = 0;
  const espaco = obterEspacoVolume(dataDir);
  const picoAdicionalExecuteBytes = Math.max(maiorTmpFilaBytes, filaPosResetBytes) + executePersistenteBytes + historicoLeveEstimadoBytes + bakBytes;
  const espacoLivreMinimoDuranteOperacaoBytes = espaco.espacoLivre === null ? null : espaco.espacoLivre - Math.max(maiorTmpFilaBytes, filaPosResetBytes);
  const margemFinalPrevistaBytes = espaco.espacoLivre === null ? null : espaco.espacoLivre - executePersistenteBytes - historicoLeveEstimadoBytes + Math.max(0, filaAtualBytes - filaPosResetBytes);
  const executeSeguroPorEspaco = espacoLivreMinimoDuranteOperacaoBytes !== null &&
    espacoLivreMinimoDuranteOperacaoBytes >= MARGEM_MINIMA_EXECUTE_BYTES;

  return {
    snapshotAtualBytes,
    filaAtualBytes,
    filaPosResetEstimadaBytes: filaPosResetBytes,
    tmpFilaPosResetBytes: maiorTmpFilaBytes,
    bakBytes,
    executePersistenteEstimadoBytes: executePersistenteBytes,
    historicoLeveEstimadoBytes,
    margemNormalAplicacaoBytes: MARGEM_MINIMA_EXECUTE_BYTES,
    picoAdicionalExecuteBytes,
    espacoTotal: espaco.espacoTotal,
    espacoUsado: espaco.espacoUsado,
    espacoLivreAtual: espaco.espacoLivre,
    espacoLivreMinimoDuranteOperacaoBytes,
    margemFinalPrevistaBytes,
    executeSeguroPorEspaco,
    metodoEscrita: "writeJsonAtomic_reset_sem_bak"
  };
}

function validarSnapshotOperacao({ caminhos, manifest }) {
  const snapshotFile = path.join(caminhos.snapshot, `${WORKSPACE_PERMITIDO}.json`);
  const snapshot = readJson(snapshotFile, null);
  const hashesArquivo = readJson(caminhos.hashes, {});
  const { registros, integridade } = todosRegistrosLotes(caminhos);
  const outroWorkspacePresente = Object.keys(manifest.porWorkspace || {}).some(workspace => workspace !== WORKSPACE_PERMITIDO);
  const snapshotDisponivel = Boolean(snapshot && snapshot.workspaceId === WORKSPACE_PERMITIDO);
  const hashesEsperados = manifest.hashes?.[WORKSPACE_PERMITIDO] || hashesArquivo?.[WORKSPACE_PERMITIDO] || {};
  const hashesCalculados = {
    expirar: hashConjunto(registros),
    auditar: hashConjunto(snapshot?.grupos?.[GRUPOS_ESTEIRA.AUDITAR] || []),
    preservarAtivo: hashConjunto(snapshot?.grupos?.[GRUPOS_ESTEIRA.PRESERVAR_ATIVO] || [])
  };
  const hashesValidos = Boolean(
    hashesEsperados.expirar === hashesCalculados.expirar &&
    hashesEsperados.auditar === hashesCalculados.auditar &&
    hashesEsperados.preservarAtivo === hashesCalculados.preservarAtivo
  );
  const payloadRollbackSuficiente = registros.every(registro => registro.item && registro.identidade?.chave && registro.hashIndividual);
  const segredosIndevidos = registros.some(registro => possuiChaveSensivel(registro.item));

  return {
    snapshotDisponivel,
    hashesValidos,
    hashesEsperados,
    hashesCalculados,
    lotesTotais: integridade.lotesTotais,
    lotesIntegros: integridade.lotesIntegrais,
    lotesErros: integridade.erros,
    outroWorkspacePresente,
    payloadRollbackSuficiente,
    segredosIndevidos,
    rollbackDisponivel: fs.existsSync(caminhos.rollback)
  };
}

function resolverIdentidadeWorkspace(dataDir = "/data") {
  const usuarios = readJson(path.join(dataDir, "usuarios.json"), []);
  const usuario = Array.isArray(usuarios)
    ? usuarios.find(item => String(item?.id || "") === WORKSPACE_PERMITIDO)
    : null;
  const email = String(usuario?.email || "").toLowerCase();
  const papel = String(usuario?.papel || "");
  const autorizado = Boolean(usuario) &&
    papel !== "admin_master" &&
    EMAILS_OPERACIONAIS_AUTORIZADOS.has(email);
  return {
    workspaceId: WORKSPACE_PERMITIDO,
    nome: usuario?.nome || usuario?.name || "",
    email,
    papel,
    autorizado,
    motivo: usuario ? (autorizado ? "workspace_operacional_autorizado" : "workspace_nao_autorizado") : "workspace_usuario_nao_encontrado"
  };
}

function totalRemovidosExecute(caminhos) {
  let removidos = 0;
  let pulados = 0;
  for (const arquivo of listarArquivosJson(caminhos.execute)) {
    const resultado = readJson(path.join(caminhos.execute, arquivo), {});
    removidos += Array.isArray(resultado.removidos) ? resultado.removidos.length : 0;
    pulados += Array.isArray(resultado.pulados) ? resultado.pulados.length : 0;
  }
  return { removidos, pulados };
}

function montarStatusOperacao({ operationId, caminhos, manifest }) {
  const lotes = listarArquivosJson(caminhos.lotes);
  const executados = listarArquivosJson(caminhos.execute);
  const totais = manifest.totais || {};
  const workspace = manifest.porWorkspace?.[WORKSPACE_PERMITIDO] || {};
  const exec = totalRemovidosExecute(caminhos);
  const status = executados.length > 0
    ? (executados.length >= lotes.length ? "execute_concluido_ou_retomavel" : "execute_parcial")
    : "dry_run_concluido";

  return {
    operationId,
    status,
    workspaceId: WORKSPACE_PERMITIDO,
    lotes: {
      total: lotes.length,
      executados: executados.length
    },
    totais: {
      totalLido: totais.totalFila ?? workspace.totalFila ?? null,
      elegiveis: totais.expirar ?? workspace.expirar ?? null,
      protegidos: Number(totais.preservarHistorico || 0) + Number(totais.preservarAtivo || 0),
      auditados: totais.auditar ?? workspace.auditar ?? null,
      removidos: exec.removidos,
      pulados: exec.pulados
    },
    erros: [],
    snapshotDisponivel: fs.existsSync(caminhos.snapshot),
    executePermitido: status === "dry_run_concluido",
    rollbackDisponivel: executados.length > 0,
    iniciadoEm: manifest.operationStartedAt || null,
    finalizadoEm: null
  };
}

function montarRespostaDryRun(resultado = {}, dataDir = "/data", duracaoMs = 0, contexto = {}) {
  const caminhos = caminhosOperacao(resultado.operationId, { dataDir });
  const workspace = resultado.porWorkspace?.[WORKSPACE_PERMITIDO] || {};
  const totais = resultado.totais || {};
  const filaHashAntes = contexto.filaHashAntes || null;
  const filaHashDepois = contexto.filaHashDepois || null;
  return {
    ok: resultado.ok === true,
    operationId: resultado.operationId,
    status: "dry_run_concluido",
    workspaceId: WORKSPACE_PERMITIDO,
    cutoffCongelado: resultado.cutoffCongelado || null,
    criterioHash: resultado.criterioHash || null,
    totalLido: totais.totalFila ?? workspace.totalFila ?? 0,
    elegiveis: totais.expirar ?? workspace.expirar ?? 0,
    protegidos: Number(totais.preservarHistorico || 0) + Number(totais.preservarAtivo || 0),
    auditados: totais.auditar ?? workspace.auditar ?? 0,
    lotes: resultado.quantidadeLotes ?? 0,
    tamanhoSnapshotBytes: tamanhoDirBytes(caminhos.base),
    espacoLivreAntes: contexto.espacoLivreAntes ?? null,
    espacoLivreDepois: contexto.espacoLivreDepois ?? null,
    hashes: resultado.hashes?.[WORKSPACE_PERMITIDO] || null,
    filaHashAntes,
    filaHashDepois,
    filaAlterada: filaHashAntes !== null && filaHashDepois !== null ? filaHashAntes !== filaHashDepois : null,
    rollbackDisponivel: fs.existsSync(caminhos.rollback),
    duracaoMs,
    aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais === true
  };
}

function montarRespostaExecute(resultado = {}, dataDir = "/data", duracaoMs = 0, contexto = {}) {
  return {
    ok: resultado.ok === true,
    status: "execute_concluido_ou_retomavel",
    workspaceId: WORKSPACE_PERMITIDO,
    operationId: resultado.operationId,
    lotesProcessados: resultado.lotesProcessados ?? 0,
    removidos: resultado.removidos ?? 0,
    pulados: resultado.pulados ?? 0,
    filaHashAntes: contexto.filaHashAntes || null,
    filaHashDepois: contexto.filaHashDepois || null,
    filaAlterada: contexto.filaHashAntes && contexto.filaHashDepois ? contexto.filaHashAntes !== contexto.filaHashDepois : null,
    duracaoMs,
    aplicouMudancasOperacionais: resultado.aplicouMudancasOperacionais === true
  };
}

function montarRespostaRollback(resultado = {}, duracaoMs = 0) {
  return {
    ok: resultado.ok === true,
    status: "rollback_concluido_ou_retomavel",
    workspaceId: WORKSPACE_PERMITIDO,
    operationId: resultado.operationId,
    restaurados: resultado.restaurados ?? 0,
    pulados: resultado.pulados ?? 0,
    duracaoMs
  };
}

function criarRotasResetEsteirasPreflight(deps = {}) {
  const router = express.Router();
  const isAdminMaster = typeof deps.isAdminMaster === "function"
    ? deps.isAdminMaster
    : (req) => req.usuario?.papel === "admin_master";
  const dataDir = deps.dataDir || process.env.DATA_DIR || "/data";
  const preflightFn = typeof deps.executarPreflight === "function"
    ? deps.executarPreflight
    : executarPreflightResetEsteiras;
  const dryRunFn = typeof deps.executarDryRun === "function"
    ? deps.executarDryRun
    : executarDryRunResetEsteiras;
  const executeFn = typeof deps.executarExecute === "function"
    ? deps.executarExecute
    : executarResetEsteiras;
  const rollbackFn = typeof deps.executarRollback === "function"
    ? deps.executarRollback
    : executarRollbackResetEsteiras;
  const timeoutMs = Number(deps.timeoutMs === undefined ? TIMEOUT_MS : deps.timeoutMs);
  const rateLimitMs = Number(deps.rateLimitMs === undefined ? RATE_LIMIT_MS : deps.rateLimitMs);
  const operationIdAutorizado = deps.operationIdAutorizado === undefined
    ? OPERATION_ID_AUTORIZADA
    : deps.operationIdAutorizado;

  function exigirAdminMaster(req, res) {
    if (!req.usuario) {
      res.status(401).json({ ok: false, erro: "nao_autenticado" });
      return false;
    }
    if (isAdminMaster(req)) return true;
    res.status(403).json({ ok: false, erro: "acesso_restrito_admin_master" });
    return false;
  }

  async function executarComProtecao(req, res, handler) {
    if (!exigirAdminMaster(req, res)) return;
    try {
      validarBodySemParametrosLivres(req.body || {});
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    }

    if (resetEmExecucao) {
      return res.status(409).json({ ok: false, erro: "reset_esteira_em_execucao" });
    }

    const agora = Date.now();
    if (ultimaChamadaMs && agora - ultimaChamadaMs < rateLimitMs) {
      return res.status(429).json({ ok: false, erro: "reset_esteira_rate_limit" });
    }

    resetEmExecucao = true;
    ultimaChamadaMs = agora;
    const inicio = Date.now();
    try {
      return await handler(inicio);
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    } finally {
      resetEmExecucao = false;
    }
  }

  router.post("/preflight", async (req, res) => {
    if (!exigirAdminMaster(req, res)) return;

    const workspaceId = String(req.body?.workspaceId || req.query?.workspaceId || WORKSPACE_PERMITIDO).trim();
    if (workspaceId !== WORKSPACE_PERMITIDO) {
      return res.status(403).json({
        ok: false,
        erro: "workspace_nao_permitido",
        workspacePermitido: WORKSPACE_PERMITIDO
      });
    }

    if (resetEmExecucao) {
      return res.status(409).json({ ok: false, erro: "preflight_reset_esteira_em_execucao" });
    }

    const agora = Date.now();
    if (ultimaChamadaMs && agora - ultimaChamadaMs < rateLimitMs) {
      return res.status(429).json({ ok: false, erro: "preflight_reset_esteira_rate_limit" });
    }

    resetEmExecucao = true;
    ultimaChamadaMs = agora;
    const inicio = Date.now();
    try {
      const resultado = await comTimeout(Promise.resolve(preflightFn({
        mode: "preflight",
        workspaceId: WORKSPACE_PERMITIDO,
        loteTamanho: LOTE_TAMANHO_FIXO,
        dataDir
      })), timeoutMs);
      const espaco = obterEspacoVolume(dataDir);
      return res.json(montarRespostaSanitizada(resultado, espaco, Date.now() - inicio));
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    } finally {
      resetEmExecucao = false;
    }
  });

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/dry-run", async (req, res) => executarComProtecao(req, res, async (inicio) => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_DRY_RUN);
    const fila = filaPath(WORKSPACE_PERMITIDO, { dataDir });
    const filaHashAntes = hashArquivo(fila);
    const espacoAntes = obterEspacoVolume(dataDir);
    const resultado = await comTimeout(Promise.resolve(dryRunFn({
      mode: "dry-run",
      workspaceId: WORKSPACE_PERMITIDO,
      loteTamanho: LOTE_TAMANHO_FIXO,
      dataDir
    })), timeoutMs);
    const filaHashDepois = hashArquivo(fila);
    const espacoDepois = obterEspacoVolume(dataDir);
    return res.json(montarRespostaDryRun(resultado, dataDir, Date.now() - inicio, {
      filaHashAntes,
      filaHashDepois,
      espacoLivreAntes: espacoAntes.espacoLivre,
      espacoLivreDepois: espacoDepois.espacoLivre
    }));
  }));

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.get("/operacoes/:operationId", async (req, res) => {
    if (!exigirAdminMaster(req, res)) return;
    try {
      const operacao = operationIdAutorizado === "*"
        ? carregarOperacaoRestritaSemAutorizacao(req.params.operationId, dataDir)
        : carregarOperacaoRestrita(req.params.operationId, dataDir, operationIdAutorizado);
      return res.json({ ok: true, ...montarStatusOperacao(operacao) });
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    }
  });

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/reconciliar", async (req, res) => executarComProtecao(req, res, async () => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_RECONCILIAR);
    const operacao = carregarOperacaoRestrita(req.body?.operationId, dataDir, operationIdAutorizado);
    const reconciliacao = reconciliarOperacao({ ...operacao, dataDir });
    const { removiveis: _removiveis, ...resposta } = reconciliacao;
    return res.json({
      ok: true,
      modo: "somente_leitura",
      aplicouMudancasOperacionais: false,
      ...resposta
    });
  }));

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.get("/operacoes/:operationId/validar", async (req, res) => {
    if (!exigirAdminMaster(req, res)) return;
    try {
      const operacao = carregarOperacaoRestrita(req.params.operationId, dataDir, operationIdAutorizado);
      const status = montarStatusOperacao(operacao);
      const snapshot = validarSnapshotOperacao(operacao);
      const reconciliacao = reconciliarOperacao({ ...operacao, dataDir });
      const espaco = calcularPicoEspacoExecute({ ...operacao, dataDir, reconciliacao });
      const identidadeWorkspace = resolverIdentidadeWorkspace(dataDir);
      const executePermitidoFinal = status.status === "dry_run_concluido" &&
        reconciliacao.executeSeguroPorCriterio === true &&
        espaco.executeSeguroPorEspaco === true &&
        snapshot.snapshotDisponivel === true &&
        snapshot.hashesValidos === true &&
        snapshot.lotesTotais === snapshot.lotesIntegros &&
        snapshot.outroWorkspacePresente === false &&
        snapshot.payloadRollbackSuficiente === true &&
        snapshot.segredosIndevidos === false &&
        identidadeWorkspace.autorizado === true;

      return res.json({
        ok: true,
        modo: "somente_leitura",
        aplicouMudancasOperacionais: false,
        operationId: operacao.operationId,
        statusOperacao: status.status,
        workspaceId: WORKSPACE_PERMITIDO,
        identidadeWorkspace,
        cutoff: operacao.manifest.cutoffCongelado || null,
        criterioHash: operacao.manifest.criterioHash || null,
        lotesTotais: snapshot.lotesTotais,
        lotesIntegros: snapshot.lotesIntegros,
        snapshotDisponivel: snapshot.snapshotDisponivel,
        hashesValidos: snapshot.hashesValidos,
        outroWorkspacePresente: snapshot.outroWorkspacePresente,
        rollbackDisponivel: snapshot.rollbackDisponivel,
        payloadRollbackSuficiente: snapshot.payloadRollbackSuficiente,
        segredosIndevidos: snapshot.segredosIndevidos,
        totalElegivelCongelado: reconciliacao.totalElegivelCongelado,
        totalAtualmenteCompativel: reconciliacao.totalAtualmenteCompativel,
        totalAlteradoPorConcorrencia: reconciliacao.totalAlteradoPorConcorrencia,
        totalAusente: reconciliacao.totalAusente,
        divergencia: reconciliacao.divergencia,
        executeSeguroPorCriterio: reconciliacao.executeSeguroPorCriterio,
        ...espaco,
        executePermitidoFinal
      });
    } catch (erro) {
      return res.status(statusErro(erro)).json(respostaErro(erro));
    }
  });

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/execute", async (req, res) => executarComProtecao(req, res, async (inicio) => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_EXECUTE);
    const operationId = validarOperationIdAutorizado(req.body?.operationId, operationIdAutorizado);
    if (operationId !== String(req.body?.confirmOperationId || "")) {
      throw criarErro("confirm_operation_id_divergente", 400);
    }
    const operacao = carregarOperacaoRestrita(operationId, dataDir, operationIdAutorizado);
    const status = montarStatusOperacao(operacao);
    if (status.status !== "dry_run_concluido") throw criarErro("operation_id_sem_dry_run_valido", 409);
    const snapshot = validarSnapshotOperacao(operacao);
    const reconciliacao = reconciliarOperacao({ ...operacao, dataDir });
    const espaco = calcularPicoEspacoExecute({ ...operacao, dataDir, reconciliacao });
    const identidadeWorkspace = resolverIdentidadeWorkspace(dataDir);
    if (!reconciliacao.executeSeguroPorCriterio) throw criarErro("execute_bloqueado_reconciliacao", 409);
    if (!espaco.executeSeguroPorEspaco) throw criarErro("execute_bloqueado_espaco", 409);
    if (!identidadeWorkspace.autorizado) throw criarErro("execute_bloqueado_workspace_nao_autorizado", 403);
    if (!snapshot.snapshotDisponivel || !snapshot.hashesValidos || snapshot.lotesTotais !== snapshot.lotesIntegros || snapshot.outroWorkspacePresente || !snapshot.payloadRollbackSuficiente || snapshot.segredosIndevidos) {
      throw criarErro("execute_bloqueado_snapshot_invalido", 409);
    }
    const fila = filaPath(WORKSPACE_PERMITIDO, { dataDir });
    const filaHashAntes = hashArquivo(fila);
    const resultado = await comTimeout(Promise.resolve(executeFn({
      mode: "execute",
      operationId,
      confirmOperationId: operationId,
      workspaceId: WORKSPACE_PERMITIDO,
      loteTamanho: LOTE_TAMANHO_FIXO,
      dataDir
    })), timeoutMs);
    const filaHashDepois = hashArquivo(fila);
    return res.json(montarRespostaExecute(resultado, dataDir, Date.now() - inicio, {
      filaHashAntes,
      filaHashDepois
    }));
  }));

  // TEMPORARIA, ADMIN_MASTER, WORKSPACE UNICO, SEM EXECUCAO AUTOMATICA.
  router.post("/rollback", async (req, res) => executarComProtecao(req, res, async (inicio) => {
    validarWorkspace(req.body?.workspaceId);
    validarConfirmacaoTexto(req.body?.confirmacao, CONFIRMACAO_ROLLBACK);
    const operationId = validarOperationIdAutorizado(req.body?.operationId, operationIdAutorizado);
    if (operationId !== String(req.body?.confirmOperationId || "")) {
      throw criarErro("confirm_operation_id_divergente", 400);
    }
    carregarOperacaoRestrita(operationId, dataDir, operationIdAutorizado);
    const resultado = await comTimeout(Promise.resolve(rollbackFn({
      mode: "rollback",
      operationId,
      confirmOperationId: operationId,
      workspaceId: WORKSPACE_PERMITIDO,
      loteTamanho: LOTE_TAMANHO_FIXO,
      dataDir
    })), timeoutMs);
    return res.json(montarRespostaRollback(resultado, Date.now() - inicio));
  }));

  return router;
}

criarRotasResetEsteirasPreflight._resetEstadoParaTeste = () => {
  resetEmExecucao = false;
  ultimaChamadaMs = 0;
};
criarRotasResetEsteirasPreflight._setEmExecucaoParaTeste = (valor) => {
  resetEmExecucao = Boolean(valor);
};

module.exports = criarRotasResetEsteirasPreflight;
