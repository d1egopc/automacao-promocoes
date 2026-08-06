"use strict";

const fs = require("fs");
const path = require("path");
const { queryEngine } = require("../database");
const filaHistoricoPolicy = require("../../../utils/fila-historico-policy");

const ENV_SHADOW = "OPTIMUS_AUTO_CLEAN_SHADOW";
const ENV_EXECUTE = "OPTIMUS_AUTO_CLEAN_EXECUTE";
const DEFAULT_DATA_DIR = process.env.DATA_DIR || "/data";
const LOTE_LIMITE_PADRAO = 100;

const TTL_PADRAO = Object.freeze({
  flowNaoAceitaMs: 24 * 60 * 60 * 1000,
  filaEnviadaMs: 24 * 60 * 60 * 1000,
  filaTerminalMs: 72 * 60 * 60 * 1000,
  jobsConcluidosMs: 7 * 24 * 60 * 60 * 1000,
  jobsErroMs: 30 * 24 * 60 * 60 * 1000,
  eventosBrutosMs: 15 * 24 * 60 * 60 * 1000,
  processamentosMs: 7 * 24 * 60 * 60 * 1000,
  eventosComerciaisMs: 30 * 24 * 60 * 60 * 1000,
  logsMs: 15 * 24 * 60 * 60 * 1000,
  temporariosCacheMs: 72 * 60 * 60 * 1000,
  snapshotsMs: 30 * 24 * 60 * 60 * 1000
});

const STATUS_FILA_VIVO = filaHistoricoPolicy.STATUS_VIVO;
const STATUS_FILA_PROCESSANDO = filaHistoricoPolicy.STATUS_PROCESSANDO;
const STATUS_FILA_ENVIADO = filaHistoricoPolicy.STATUS_ENVIADO;
const STATUS_FILA_TERMINAL = filaHistoricoPolicy.STATUS_FINAL;

const STATUS_OFERTA_ATIVO = new Set(["importada", "oferta_criada", "distribuindo", "fila"]);
const STATUS_JOB_ATIVO = new Set(["pendente", "diagnosticado", "pronto", "processando", "importando", "distribuindo"]);
const STATUS_JOB_ERRO = new Set(["erro", "falha", "erro_final", "erro_permanente"]);
const STATUS_JOB_CONCLUIDO = new Set(["concluido", "concluida", "importado", "distribuido", "ignorado", "retido", "finalizado"]);

const EXT_LOG = new Set([".log", ".out", ".err"]);
const EXT_TEMP = new Set([".tmp", ".temp", ".old", ".swp"]);
const EXT_BACKUP = new Set([".bak", ".backup"]);
const EXT_MIDIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".ogg"]);
const SENSIVEL_RE = /(token|secret|senha|password|cookie|cred|session|sessao|auth|jwt|key|private|client_secret)/i;

function flagLigada(valor) {
  return ["1", "true", "sim", "yes", "on"].includes(String(valor || "").trim().toLowerCase());
}

function autoCleanShadowAtivo(opcoes = {}) {
  if (opcoes.shadow === true) return true;
  if (opcoes.shadow === false) return false;
  return flagLigada(process.env[ENV_SHADOW]);
}

function autoCleanExecuteAtivo(opcoes = {}) {
  if (opcoes.execute === true) return true;
  if (opcoes.execute === false) return false;
  return flagLigada(process.env[ENV_EXECUTE]);
}

function limitarInteiro(valor, padrao, min, max) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(min, Math.min(max, Math.floor(numero)));
}

function criarPoliticaRetencao(opcoes = {}) {
  const ttl = { ...TTL_PADRAO, ...(opcoes.ttl || {}) };
  return {
    ttl,
    loteLimite: limitarInteiro(opcoes.loteLimite, LOTE_LIMITE_PADRAO, 1, LOTE_LIMITE_PADRAO),
    dataDir: opcoes.dataDir || DEFAULT_DATA_DIR
  };
}

function normalizarStatus(valor = "") {
  return String(valor || "").trim().toLowerCase();
}

function timestampMs(valor) {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function idadeMsDesde(valor, agoraMs = Date.now()) {
  const ms = timestampMs(valor);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, agoraMs - ms);
}

function bytesLegiveis(bytes = 0) {
  const unidades = ["B", "KB", "MB", "GB"];
  let valor = Number(bytes) || 0;
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  return `${valor.toFixed(indice === 0 ? 0 : 2)} ${unidades[indice]}`;
}

function motivoProtecaoBase(registro = {}) {
  if (registro.sessaoOuAuth === true) return "sessao_auth_protegida";
  if (registro.configuracao === true) return "configuracao_protegida";
  if (registro.credencial === true) return "credencial_protegida";
  if (registro.temReferenciaFilaViva === true) return "referencia_fila_viva";
  if (registro.temJobAtivo === true) return "job_ativo";
  if (registro.temOfertaAtiva === true) return "oferta_ativa";
  if (registro.rollbackAtivo === true) return "rollback_ativo";
  if (registro.memoriaComercialRecente === true) return "memoria_comercial_recente";
  return "";
}

function ttlPorRegistro(registro = {}, politica = criarPoliticaRetencao()) {
  const status = normalizarStatus(registro.status);
  const tipo = String(registro.tipoRegistro || registro.origem || "").trim();
  const ttl = politica.ttl;

  if (tipo === "fila_json" && status === "flow_nao_aceita") return ttl.flowNaoAceitaMs;
  if (tipo === "fila_json" && STATUS_FILA_ENVIADO.has(status)) return ttl.filaEnviadaMs;
  if (tipo === "fila_json" && STATUS_FILA_TERMINAL.has(status)) return ttl.filaTerminalMs;
  if (tipo === "engine_ofertas" && status === "flow_nao_aceita") return ttl.flowNaoAceitaMs;
  if (tipo === "engine_ofertas" && ["retida", "retida_v2", "erro_final", "erro", "expirada", "enviado"].includes(status)) return ttl.filaTerminalMs;
  if (tipo === "engine_jobs_cliente" && STATUS_JOB_ERRO.has(status)) return ttl.jobsErroMs;
  if (tipo === "engine_jobs_cliente" && STATUS_JOB_CONCLUIDO.has(status)) return ttl.jobsConcluidosMs;
  if (tipo === "engine_eventos_brutos" || tipo === "engine_links") return ttl.eventosBrutosMs;
  if (tipo === "engine_processamentos") return ttl.processamentosMs;
  if (tipo === "engine_eventos_comerciais") return ttl.eventosComerciaisMs;
  if (tipo === "logs_persistidos") return ttl.logsMs;
  if (tipo === "temporarios" || tipo === "caches") return ttl.temporariosCacheMs;
  if (tipo === "snapshots_reset") return ttl.snapshotsMs;
  return null;
}

function avaliarRegistroAutoClean(registro = {}, opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const status = normalizarStatus(registro.status);
  const idadeMs = Number.isFinite(Number(registro.idadeMs)) ? Number(registro.idadeMs) : idadeMsDesde(registro.referenciaTemporal, agoraMs);
  const ttlMs = ttlPorRegistro({ ...registro, status }, politica);
  const motivoProtecao = motivoProtecaoBase(registro);

  if (motivoProtecao) {
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: motivoProtecao, aplicouMudancas: false };
  }

  if (registro.tipoRegistro === "fila_json" && (STATUS_FILA_VIVO.has(status) || STATUS_FILA_PROCESSANDO.has(status))) {
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "item_vivo", aplicouMudancas: false };
  }

  if (registro.tipoRegistro === "engine_ofertas" && STATUS_OFERTA_ATIVO.has(status)) {
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "oferta_ativa", aplicouMudancas: false };
  }

  if (registro.tipoRegistro === "engine_jobs_cliente" && STATUS_JOB_ATIVO.has(status)) {
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "job_ativo", aplicouMudancas: false };
  }

  if (!Number.isFinite(Number(ttlMs))) {
    return { ...registro, status, idadeMs, ttlMs: null, elegivel: false, motivo: "sem_politica_ttl", aplicouMudancas: false };
  }

  if (!Number.isFinite(Number(idadeMs))) {
    return { ...registro, status, idadeMs: null, ttlMs, elegivel: false, motivo: "timestamp_indisponivel", aplicouMudancas: false };
  }

  if (idadeMs < ttlMs) {
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "dentro_ttl", aplicouMudancas: false };
  }

  return { ...registro, status, idadeMs, ttlMs, elegivel: true, motivo: "ttl_vencido_sem_dependencia_viva", aplicouMudancas: false };
}

function criarResumoOrigem(origem, tipoRegistro, registros = [], limite = LOTE_LIMITE_PADRAO) {
  const quantidade = registros.length;
  const elegiveis = registros.filter(item => item.elegivel).length;
  const protegidos = quantidade - elegiveis;
  const bytesEstimados = registros
    .filter(item => item.elegivel)
    .reduce((soma, item) => soma + Number(item.bytesEstimados || 0), 0);
  const motivos = {};
  for (const item of registros) motivos[item.motivo || "desconhecido"] = (motivos[item.motivo || "desconhecido"] || 0) + 1;
  return {
    origem,
    tipoRegistro,
    quantidade,
    elegiveis,
    protegidos,
    bytesEstimados,
    bytesEstimadosLegivel: bytesLegiveis(bytesEstimados),
    loteLimite: limite,
    motivoEncerramento: quantidade >= limite ? "lote_limite" : "origem_esgotada",
    motivos,
    aplicouMudancas: false
  };
}

function sanitizarLogPayload(payload = {}) {
  const permitido = [
    "origem",
    "tipoRegistro",
    "status",
    "idadeMs",
    "ttlMs",
    "elegivel",
    "motivo",
    "quantidade",
    "elegiveis",
    "bytesEstimados",
    "protegidos",
    "loteLimite",
    "motivoEncerramento",
    "aplicouMudancas",
    "duracaoMs",
    "totalOrigens",
    "totalElegiveis",
    "totalProtegidos",
    "erroTipo",
    "compactaveis",
    "removiveis",
    "integrais",
    "bytesRecuperaveisCompactacao",
    "bytesRecuperaveisCompactacaoLegivel",
    "politicaCentral"
  ];
  const saida = {};
  for (const chave of permitido) {
    if (payload[chave] !== undefined) saida[chave] = payload[chave];
  }
  if (saida.aplicouMudancas === undefined) saida.aplicouMudancas = false;
  return saida;
}

function logAutoClean(tag, payload = {}, logger = console) {
  try {
    logger.log(tag, JSON.stringify(sanitizarLogPayload(payload)));
  } catch {}
}

function isSessaoOuConfig(rel = "") {
  const texto = String(rel || "").toLowerCase();
  return /session|sessao|auth|baileys|whatsapp|wpp|config|destino|cred|token|cookie|secret|senha|password|jwt|private/.test(texto);
}

function categoriaArquivoAutoClean(dataDir, caminho, stats) {
  const rel = path.relative(dataDir, caminho).replace(/\\/g, "/").toLowerCase();
  const ext = path.extname(rel);
  if (isSessaoOuConfig(rel)) return "protegido_sensivel";
  if (rel.startsWith("clientes/") && rel.endsWith("/fila.json")) return "fila_json_arquivo";
  if (rel.startsWith("reset-esteiras/") || rel.startsWith("reset-operacional/") || rel.includes("snapshot")) return "snapshots_reset";
  if (EXT_LOG.has(ext) || rel.includes("log")) return "logs_persistidos";
  if (EXT_TEMP.has(ext)) return "temporarios";
  if (EXT_BACKUP.has(ext) || rel.includes("backup") || rel.includes("bak")) return "backups_operacionais";
  if (rel.includes("cache")) return "caches";
  if (EXT_MIDIA.has(ext) || rel.includes("image") || rel.includes("imagem") || rel.includes("media") || rel.includes("midia")) return "midias_reconstruiveis";
  if (stats?.isFile?.()) return "arquivos_auditoria";
  return "outros";
}

function inventariarArquivosPorCategoria(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const limite = politica.loteLimite;
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const registrosPorOrigem = {
    logs_persistidos: [],
    temporarios: [],
    caches: [],
    snapshots_reset: [],
    midias_reconstruiveis: [],
    backups_operacionais: []
  };

  if (!fsImpl.existsSync(dataDir)) return [];
  const pilha = [dataDir];
  while (pilha.length) {
    const atual = pilha.pop();
    let stats;
    try {
      stats = fsImpl.lstatSync(atual);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink && stats.isSymbolicLink()) continue;
    if (stats.isDirectory && stats.isDirectory()) {
      const rel = path.relative(dataDir, atual).replace(/\\/g, "/");
      if (isSessaoOuConfig(rel)) continue;
      let filhos = [];
      try { filhos = fsImpl.readdirSync(atual).map(nome => path.join(atual, nome)); } catch { filhos = []; }
      for (const filho of filhos) pilha.push(filho);
      continue;
    }
    if (!stats.isFile || !stats.isFile()) continue;
    const categoria = categoriaArquivoAutoClean(dataDir, atual, stats);
    if (categoria === "protegido_sensivel" || categoria === "fila_json_arquivo" || categoria === "arquivos_auditoria" || categoria === "outros") continue;
    if (!registrosPorOrigem[categoria] || registrosPorOrigem[categoria].length >= limite) continue;
    const tipoRegistro = categoria === "logs_persistidos" ? "logs_persistidos" : categoria;
    const registro = avaliarRegistroAutoClean({
      origem: categoria,
      tipoRegistro: categoria === "midias_reconstruiveis" || categoria === "backups_operacionais" ? "temporarios" : tipoRegistro,
      status: "arquivo",
      referenciaTemporal: new Date(stats.mtimeMs || stats.ctimeMs || agoraMs).toISOString(),
      bytesEstimados: Number(stats.size || 0),
      rollbackAtivo: categoria === "snapshots_reset" && (agoraMs - Number(stats.mtimeMs || agoraMs)) < politica.ttl.snapshotsMs
    }, { politica, agoraMs });
    registrosPorOrigem[categoria].push(registro);
  }

  return Object.entries(registrosPorOrigem).map(([origem, registros]) => criarResumoOrigem(origem, origem, registros, limite));
}

function extrairTimestampFila(item = {}) {
  for (const campo of ["dataEntradaFila", "criadoEm", "createdAt", "adicionadoEm", "updatedAt", "enviadoEm", "dataEnvio", "retidaEm", "erroEm"]) {
    if (!item[campo]) continue;
    const ms = timestampMs(item[campo]);
    if (Number.isFinite(ms)) return { campo, ms };
  }
  return { campo: null, ms: null };
}

function auditarFilaJson(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const limite = politica.loteLimite;
  const clientesDir = path.join(dataDir, "clientes");
  const registros = [];
  const resumoExtra = {
    filasInvalidas: 0,
    totalItens: 0,
    vivos: 0,
    terminais: 0,
    bytesTotais: 0,
    compactaveis: 0,
    removiveis: 0,
    integrais: 0,
    bytesRecuperaveisCompactacao: 0
  };

  if (!fsImpl.existsSync(clientesDir)) return criarResumoOrigem("fila_json", "fila_json", registros, limite);

  for (const workspaceId of fsImpl.readdirSync(clientesDir).sort()) {
    if (registros.length >= limite) break;
    if (SENSIVEL_RE.test(workspaceId)) continue;
    const filaPath = path.join(clientesDir, workspaceId, "fila.json");
    if (!fsImpl.existsSync(filaPath)) continue;
    let stats;
    try { stats = fsImpl.statSync(filaPath); } catch { continue; }
    resumoExtra.bytesTotais += Number(stats.size || 0);
    let fila;
    try { fila = JSON.parse(fsImpl.readFileSync(filaPath, "utf8")); } catch {
      resumoExtra.filasInvalidas += 1;
      continue;
    }
    if (!Array.isArray(fila)) {
      resumoExtra.filasInvalidas += 1;
      continue;
    }
    resumoExtra.totalItens += fila.length;
    const analiseHistoricoFila = filaHistoricoPolicy.analisarFilaHistorico(fila, { agoraMs });
    resumoExtra.compactaveis += analiseHistoricoFila.resumo.compactaveis;
    resumoExtra.removiveis += analiseHistoricoFila.resumo.removiveis;
    resumoExtra.integrais += analiseHistoricoFila.resumo.integrais;
    resumoExtra.bytesRecuperaveisCompactacao += analiseHistoricoFila.resumo.bytesRecuperaveisJson;

    for (const item of fila) {
      if (registros.length >= limite) break;
      const status = normalizarStatus(item?.status || item?.estado || "pendente");
      const decisao = filaHistoricoPolicy.analisarItemHistoricoFila(item || {}, { agoraMs });
      if (decisao.protegido) resumoExtra.vivos += 1;
      else resumoExtra.terminais += 1;
      const bytesItem = Buffer.byteLength(JSON.stringify(item || {}));
      registros.push({
        origem: "fila_json",
        tipoRegistro: "fila_json",
        status,
        idadeMs: decisao.idadeMs,
        ttlMs: decisao.acao === "compactar" ? filaHistoricoPolicy.HISTORICO_DETALHADO_MS : decisao.acao === "remover" ? filaHistoricoPolicy.HISTORICO_COMPACTO_MS : null,
        elegivel: decisao.acao === "compactar" || decisao.acao === "remover",
        motivo: decisao.motivo,
        acaoCompactacao: decisao.acao,
        bytesEstimados: bytesItem,
        bytesRecuperaveis: decisao.bytesRecuperaveis || 0,
        aplicouMudancas: false
      });
    }
  }

  const resumo = criarResumoOrigem("fila_json", "fila_json", registros, limite);
  return {
    ...resumo,
    ...resumoExtra,
    politicaCentral: "fila_historico_policy_v1",
    bytesRecuperaveisCompactacaoLegivel: bytesLegiveis(resumoExtra.bytesRecuperaveisCompactacao)
  };
}

function memoriaComercialStatus(opcoes = {}) {
  const dataDir = path.resolve(opcoes.politica?.dataDir || opcoes.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const arquivo = path.join(dataDir, "ofertas_vistas.json");
  let stats = null;
  try { stats = fsImpl.existsSync(arquivo) ? fsImpl.statSync(arquivo) : null; } catch { stats = null; }
  return {
    origem: "memoria_comercial",
    tipoRegistro: "ofertas_vistas_json",
    quantidade: stats ? 1 : 0,
    elegiveis: 0,
    protegidos: stats ? 1 : 0,
    bytesEstimados: 0,
    tamanhoBytes: stats ? Number(stats.size || 0) : 0,
    motivoEncerramento: "somente_auditoria",
    motivo: "memoria_comercial_preservada",
    aplicouMudancas: false
  };
}

async function consultarOrigemDb(nome, sql, params, opcoes) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const query = opcoes.queryEngine || queryEngine;
  const limite = politica.loteLimite;
  const registros = [];
  const retorno = await query(sql, params);
  if (!retorno?.ok) {
    return { ...criarResumoOrigem(nome, nome, [], limite), erro: true, motivoEncerramento: retorno?.motivo || "query_indisponivel" };
  }
  const rows = retorno.resultado?.rows || [];
  for (const row of rows.slice(0, limite)) {
    registros.push(avaliarRegistroAutoClean({
      origem: nome,
      tipoRegistro: nome,
      status: row.status || "registro",
      referenciaTemporal: row.referencia_temporal || row.criado_em || row.atualizada_em || row.capturado_em || row.ocorrido_em,
      bytesEstimados: Number(row.bytes_estimados || 0),
      temReferenciaFilaViva: row.tem_referencia_fila_viva === true,
      temJobAtivo: row.tem_job_ativo === true,
      temOfertaAtiva: row.tem_oferta_ativa === true
    }, opcoes));
  }
  return criarResumoOrigem(nome, nome, registros, limite);
}

async function inventariarPostgres(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const limite = politica.loteLimite;
  const ttl = politica.ttl;
  const agora = new Date(Number(opcoes.agoraMs || Date.now()));
  const cutoff = ms => new Date(agora.getTime() - ms).toISOString();

  const origens = [];
  origens.push(await consultarOrigemDb("engine_ofertas", `
    SELECT o.id, o.status, o.atualizada_em AS referencia_temporal, pg_column_size(o.*)::bigint AS bytes_estimados,
           false AS tem_referencia_fila_viva, false AS tem_job_ativo, false AS tem_oferta_ativa
      FROM engine_ofertas o
     WHERE o.status IN ('flow_nao_aceita','retida','retida_v2','erro','erro_final','expirada','enviado')
       AND o.atualizada_em < $1::timestamptz
     ORDER BY o.atualizada_em ASC
     LIMIT $2`, [cutoff(Math.min(ttl.flowNaoAceitaMs, ttl.filaTerminalMs)), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_jobs_cliente", `
    SELECT j.id, j.status, j.atualizado_em AS referencia_temporal, pg_column_size(j.*)::bigint AS bytes_estimados,
           false AS tem_referencia_fila_viva,
           j.status IN ('pendente','diagnosticado','pronto','processando','importando','distribuindo') AS tem_job_ativo,
           false AS tem_oferta_ativa
      FROM engine_jobs_cliente j
     WHERE j.status NOT IN ('pendente','diagnosticado','pronto','processando','importando','distribuindo')
       AND j.atualizado_em < $1::timestamptz
     ORDER BY j.atualizado_em ASC
     LIMIT $2`, [cutoff(ttl.jobsConcluidosMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_eventos_brutos", `
    SELECT e.id, 'evento_bruto' AS status, e.criado_em AS referencia_temporal, pg_column_size(e.*)::bigint AS bytes_estimados,
           EXISTS (SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id = e.id AND j.status IN ('pendente','diagnosticado','pronto','processando','importando','distribuindo')) AS tem_job_ativo,
           EXISTS (SELECT 1 FROM engine_ofertas o WHERE o.evento_id = e.id AND o.status IN ('importada','oferta_criada','distribuindo','fila')) AS tem_oferta_ativa,
           false AS tem_referencia_fila_viva
      FROM engine_eventos_brutos e
     WHERE e.criado_em < $1::timestamptz
     ORDER BY e.criado_em ASC
     LIMIT $2`, [cutoff(ttl.eventosBrutosMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_links", `
    SELECT l.id, 'link' AS status, l.criado_em AS referencia_temporal, pg_column_size(l.*)::bigint AS bytes_estimados,
           EXISTS (SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id = l.evento_id AND j.status IN ('pendente','diagnosticado','pronto','processando','importando','distribuindo')) AS tem_job_ativo,
           EXISTS (SELECT 1 FROM engine_ofertas o WHERE o.link_id = l.id AND o.status IN ('importada','oferta_criada','distribuindo','fila')) AS tem_oferta_ativa,
           false AS tem_referencia_fila_viva
      FROM engine_links l
     WHERE l.criado_em < $1::timestamptz
     ORDER BY l.criado_em ASC
     LIMIT $2`, [cutoff(ttl.eventosBrutosMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_processamentos", `
    SELECT p.id, COALESCE(p.status, 'processamento') AS status, p.criado_em AS referencia_temporal, pg_column_size(p.*)::bigint AS bytes_estimados,
           false AS tem_referencia_fila_viva, false AS tem_job_ativo, false AS tem_oferta_ativa
      FROM engine_processamentos p
     WHERE p.criado_em < $1::timestamptz
     ORDER BY p.criado_em ASC
     LIMIT $2`, [cutoff(ttl.processamentosMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_eventos_comerciais", `
    SELECT c.id, COALESCE(c.tipo_evento, 'evento_comercial') AS status, c.ocorrido_em AS referencia_temporal, pg_column_size(c.*)::bigint AS bytes_estimados,
           false AS tem_referencia_fila_viva, false AS tem_job_ativo, false AS tem_oferta_ativa
      FROM engine_eventos_comerciais c
     WHERE c.ocorrido_em < $1::timestamptz
     ORDER BY c.ocorrido_em ASC
     LIMIT $2`, [cutoff(ttl.eventosComerciaisMs), limite], opcoes));

  return origens;
}

async function executarAutoCleanShadow(opcoes = {}) {
  const inicio = Date.now();
  const politica = criarPoliticaRetencao(opcoes);
  const logger = opcoes.logger || console;
  const origens = [];
  const executarDb = opcoes.incluirPostgres !== false;
  const executarArquivos = opcoes.incluirArquivos !== false;

  if (autoCleanExecuteAtivo(opcoes)) {
    logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-ERRO]", {
      origem: "auto_clean",
      tipoRegistro: "execute",
      motivo: "execute_nao_implementado_nesta_fase",
      aplicouMudancas: false
    }, logger);
  }

  if (executarDb) origens.push(...await inventariarPostgres({ ...opcoes, politica }));
  if (executarArquivos) {
    origens.push(auditarFilaJson({ ...opcoes, politica }));
    origens.push(...inventariarArquivosPorCategoria({ ...opcoes, politica }));
    origens.push(memoriaComercialStatus({ ...opcoes, politica }));
  }

  for (const origem of origens) logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-SHADOW]", origem, logger);

  const resumo = {
    origem: "auto_clean",
    tipoRegistro: "resumo",
    quantidade: origens.reduce((soma, item) => soma + Number(item.quantidade || 0), 0),
    totalOrigens: origens.length,
    totalElegiveis: origens.reduce((soma, item) => soma + Number(item.elegiveis || 0), 0),
    totalProtegidos: origens.reduce((soma, item) => soma + Number(item.protegidos || 0), 0),
    bytesEstimados: origens.reduce((soma, item) => soma + Number(item.bytesEstimados || 0), 0),
    duracaoMs: Date.now() - inicio,
    loteLimite: politica.loteLimite,
    aplicouMudancas: false,
    origens
  };
  logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-RESUMO]", resumo, logger);
  return resumo;
}

async function executarAutoCleanShadowSeguro(opcoes = {}) {
  if (!autoCleanShadowAtivo(opcoes)) {
    return { ok: true, pulado: true, motivo: "shadow_desligado", aplicouMudancas: false };
  }
  try {
    const resumo = await executarAutoCleanShadow(opcoes);
    return { ok: true, ...resumo, aplicouMudancas: false };
  } catch (erro) {
    logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-ERRO]", {
      origem: "auto_clean",
      tipoRegistro: "erro",
      motivo: "auto_clean_shadow_indisponivel",
      erroTipo: erro?.code || erro?.name || "erro",
      aplicouMudancas: false
    }, opcoes.logger || console);
    return { ok: false, failOpen: true, motivo: "auto_clean_shadow_indisponivel", aplicouMudancas: false };
  }
}

module.exports = {
  ENV_SHADOW,
  ENV_EXECUTE,
  TTL_PADRAO,
  flagLigada,
  autoCleanShadowAtivo,
  autoCleanExecuteAtivo,
  criarPoliticaRetencao,
  avaliarRegistroAutoClean,
  executarAutoCleanShadow,
  executarAutoCleanShadowSeguro,
  auditarFilaJson,
  inventariarArquivosPorCategoria,
  memoriaComercialStatus,
  sanitizarLogPayload
};
