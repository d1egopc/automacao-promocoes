"use strict";

const fs = require("fs");
const path = require("path");
const { queryEngine, getEnginePool } = require("../database");
const {
  expirarJobsAtivosPorLease,
  minutosLeaseJobsAtivos,
  STATUS_JOBS_ATIVOS_COM_LEASE,
  LEASE_JOBS_ATIVOS_PADRAO_MINUTOS
} = require("../jobs.service");
const filaHistoricoPolicy = require("../../../utils/fila-historico-policy");
const {
  criarMedidorEngineMemoryStage
} = require("../../telemetria/engine-memory-stage");

const ENV_SHADOW = "OPTIMUS_AUTO_CLEAN_SHADOW";
const ENV_EXECUTE = "OPTIMUS_AUTO_CLEAN_EXECUTE";
const DEFAULT_DATA_DIR = process.env.DATA_DIR || "/data";
const LOTE_LIMITE_PADRAO = 100;
const LOTES_DB_POR_CICLO_PADRAO = 3;
const WORKSPACES_FILA_POR_CICLO_PADRAO = 5;
const AUTO_CLEAN_JOBS_LOCK_ID = 902260734;
const AUTO_CLEAN_OFERTAS_LOCK_ID = 902260735;
const AUTO_CLEAN_LINKS_LOCK_ID = 902260736;
const AUTO_CLEAN_EVENTOS_BRUTOS_LOCK_ID = 902260737;

const TTL_PADRAO = Object.freeze({
  flowNaoAceitaMs: 24 * 60 * 60 * 1000,
  filaEnviadaMs: 24 * 60 * 60 * 1000,
  filaTerminalMs: 7 * 24 * 60 * 60 * 1000,
  ofertasOperacionaisMs: 12 * 60 * 60 * 1000,
  jobsConcluidosMs: 12 * 60 * 60 * 1000,
  jobsAtivosLeaseMs: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS * 60 * 1000,
  eventosBrutosMs: 12 * 60 * 60 * 1000,
  linksOperacionaisMs: 12 * 60 * 60 * 1000,
  processamentosMs: 24 * 60 * 60 * 1000,
  eventosComerciaisMs: 7 * 24 * 60 * 60 * 1000,
  logsMs: 24 * 60 * 60 * 1000,
  temporariosCacheMs: 24 * 60 * 60 * 1000,
  snapshotsMs: 30 * 24 * 60 * 60 * 1000
});

const STATUS_FILA_VIVO = filaHistoricoPolicy.STATUS_VIVO;
const STATUS_FILA_PROCESSANDO = filaHistoricoPolicy.STATUS_PROCESSANDO;
const STATUS_FILA_ENVIADO = filaHistoricoPolicy.STATUS_ENVIADO;
const STATUS_FILA_TERMINAL = filaHistoricoPolicy.STATUS_FINAL;

const STATUS_OFERTA_ATIVO = new Set(["importada", "oferta_criada", "distribuindo", "fila"]);
const STATUS_OFERTA_TERMINAL_AUTO_CLEAN = new Set([
  "flow_nao_aceita",
  "retida_v2",
  "erro",
  "erro_final",
  "erro_distribuicao",
  "expirada",
  "expirado",
  "expirada_operacional",
  "expirado_operacional",
  "enviado",
  "enviada",
  "integracao_ausente",
  "marketplace_bloqueado",
  "marketplace_desabilitado",
  "categoria_incompativel",
  "sem_destino",
  "sem_destino_compativel",
  "automacao_desligada",
  "definitivo_operacional"
]);
const MOTIVOS_OFERTA_RETIDA_TERMINAL_AUTO_CLEAN = new Set([
  "retida_terminal",
  "definitivo_operacional",
  "marketplace_bloqueado",
  "marketplace_desabilitado",
  "categoria_incompativel",
  "sem_destino",
  "sem_destino_compativel",
  "automacao_desligada",
  "integracao_ausente",
  "erro_final",
  "expirada_operacional"
]);
const STATUS_JOB_ATIVO = new Set([
  "pendente",
  "diagnosticado",
  "pronto",
  "pronto_para_importar",
  "processando",
  "importando",
  "distribuindo",
  "executando",
  "retry",
  "agendado",
  "claimed",
  "bloqueado"
]);
const STATUS_JOB_CONCLUIDO = new Set([
  "concluido",
  "concluida",
  "finalizado",
  "finalizada",
  "importado",
  "importada",
  "distribuido",
  "distribuida",
  "enviado",
  "enviada",
  "erro_final",
  "erro_permanente",
  "falha_final",
  "cancelado",
  "cancelada",
  "expirado",
  "expirada",
  "expirada_operacional",
  "descartado",
  "descartada",
  "duplicado",
  "duplicada",
  "duplicado_final",
  "duplicada_final"
]);
const STATUS_JOB_CONCLUIDO_LISTA = Array.from(STATUS_JOB_CONCLUIDO);
const STATUS_JOB_ATIVO_SQL = Array.from(STATUS_JOB_ATIVO)
  .map(status => `'${status.replace(/'/g, "''")}'`)
  .join(",");
const STATUS_OFERTA_TERMINAL_SQL = Array.from(STATUS_OFERTA_TERMINAL_AUTO_CLEAN)
  .map(status => `'${status.replace(/'/g, "''")}'`)
  .join(",");
const MOTIVOS_OFERTA_RETIDA_TERMINAL_SQL = Array.from(MOTIVOS_OFERTA_RETIDA_TERMINAL_AUTO_CLEAN)
  .map(motivo => `'${motivo.replace(/'/g, "''")}'`)
  .join(",");
const CONDICAO_OFERTA_TERMINAL_SQL = `
       (
         o.status IN (${STATUS_OFERTA_TERMINAL_SQL})
         OR (
           o.status IN ('retida','retido')
           AND (
             COALESCE(o.metadata->>'retidaTerminal', 'false') = 'true'
             OR COALESCE(o.metadata->>'definitivoOperacional', 'false') = 'true'
             OR COALESCE(o.metadata->'integridadeComercial'->>'retidaTerminal', 'false') = 'true'
             OR COALESCE(o.metadata->'integridadeComercial'->>'definitivoOperacional', 'false') = 'true'
             OR LOWER(COALESCE(o.motivo_status, '')) IN (${MOTIVOS_OFERTA_RETIDA_TERMINAL_SQL})
           )
         )
       )`;
const CONDICAO_OFERTA_BLOQUEIA_LINK_SQL = cutoffSql => `
       (
         COALESCE(o.atualizada_em, o.criada_em) IS NULL
         OR COALESCE(o.atualizada_em, o.criada_em) >= ${cutoffSql}
         OR NOT (${CONDICAO_OFERTA_TERMINAL_SQL})
       )`;
const CONDICAO_EVENTO_BRUTO_REMOVIVEL_SQL = cutoffSql => `
       e.criado_em IS NOT NULL
       AND e.criado_em < ${cutoffSql}
       AND NOT EXISTS (SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM engine_ofertas o WHERE o.evento_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM engine_links l WHERE l.evento_id = e.id)`;

const MATRIZ_STATUS_AUTO_CLEAN = Object.freeze({
  oferta_criada: Object.freeze({
    vivo: true,
    vivoAteHoras: 24,
    terminal: true,
    reprocessavel: true,
    reprocessavelAteHoras: 24,
    ttlIntegralHoras: 24,
    ttlCompactoDias: 7,
    removivelAposHoras: 24,
    dependenciasTecnicas: ["engine_processamentos", "engine_eventos_comerciais"],
    historicoLeveSeparado: true,
    decisao: "remover_job_stale_e_dependencias_tecnicas"
  }),
  integracao_ausente: Object.freeze({
    vivo: false,
    vivoAteHoras: 0,
    terminal: true,
    reprocessavel: false,
    reprocessavelAteHoras: 0,
    ttlIntegralHoras: 24,
    ttlCompactoDias: 7,
    removivelAposHoras: 24,
    dependenciasTecnicas: ["engine_processamentos", "engine_eventos_comerciais"],
    historicoLeveSeparado: true,
    decisao: "remover_job_sem_integracao_e_dependencias_tecnicas"
  }),
  retida_v2: Object.freeze({
    vivo: false,
    vivoAteHoras: 0,
    terminal: true,
    reprocessavel: true,
    reprocessavelAteHoras: 24,
    ttlIntegralHoras: 24,
    ttlCompactoDias: 7,
    removivelAposHoras: 24,
    dependenciasTecnicas: ["engine_processamentos", "engine_eventos_comerciais"],
    historicoLeveSeparado: true,
    decisao: "remover_job_retido_e_dependencias_tecnicas"
  }),
  erro_importacao: Object.freeze({
    vivo: false,
    vivoAteHoras: 0,
    terminal: true,
    reprocessavel: true,
    reprocessavelAteHoras: 24,
    ttlIntegralHoras: 24,
    ttlCompactoDias: 7,
    removivelAposHoras: 24,
    dependenciasTecnicas: ["engine_processamentos", "engine_eventos_comerciais"],
    historicoLeveSeparado: true,
    decisao: "remover_job_com_erro_e_dependencias_tecnicas"
  }),
  importando: Object.freeze({
    vivo: true,
    vivoAteHoras: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS / 60,
    vivoAteMinutos: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS,
    terminal: false,
    reprocessavel: true,
    reprocessavelAteHoras: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS / 60,
    ttlIntegralHoras: null,
    ttlCompactoDias: null,
    removivelAposHoras: null,
    dependenciasTecnicas: [],
    decisao: "preservar_ativo_fresco_expirar_por_lease"
  }),
  processando: Object.freeze({
    vivo: true,
    vivoAteHoras: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS / 60,
    vivoAteMinutos: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS,
    terminal: false,
    reprocessavel: true,
    reprocessavelAteHoras: LEASE_JOBS_ATIVOS_PADRAO_MINUTOS / 60,
    ttlIntegralHoras: null,
    ttlCompactoDias: null,
    removivelAposHoras: null,
    dependenciasTecnicas: [],
    decisao: "preservar_ativo_fresco_expirar_por_lease"
  }),
  expirada_operacional: Object.freeze({
    vivo: false,
    vivoAteHoras: 0,
    terminal: true,
    reprocessavel: false,
    reprocessavelAteHoras: 0,
    ttlIntegralHoras: 12,
    ttlCompactoDias: 7,
    removivelAposHoras: 12,
    dependenciasTecnicas: ["engine_processamentos", "engine_eventos_comerciais"],
    historicoLeveSeparado: true,
    decisao: "remover_job_e_dependencias_tecnicas"
  })
});

function ttlHorasStatusJob(status = "") {
  const normalizado = normalizarStatus(status);
  const matriz = MATRIZ_STATUS_AUTO_CLEAN[normalizado];
  if (Number.isFinite(Number(matriz?.removivelAposHoras))) return Number(matriz.removivelAposHoras);
  if (STATUS_JOB_CONCLUIDO.has(normalizado)) return 12;
  return null;
}

const STATUS_JOB_REMOVIVEL_AUTO_CLEAN = [
  ...new Set([
    ...STATUS_JOB_CONCLUIDO_LISTA,
    ...Object.entries(MATRIZ_STATUS_AUTO_CLEAN)
      .filter(([, config]) => Number.isFinite(Number(config.removivelAposHoras)))
      .map(([status]) => status)
  ])
].filter(status => !STATUS_JOB_ATIVO.has(status));

const TTL_JOB_CASE_SQL = STATUS_JOB_REMOVIVEL_AUTO_CLEAN
  .map(status => `WHEN status = '${status.replace(/'/g, "''")}' THEN ${ttlHorasStatusJob(status)}`)
  .join(" ");

const EXT_LOG = new Set([".log", ".out", ".err"]);
const EXT_TEMP = new Set([".tmp", ".temp", ".old", ".swp"]);
const EXT_BACKUP = new Set([".bak", ".backup"]);
const EXT_MIDIA = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".ogg"]);
const SENSIVEL_RE = /(token|secret|senha|password|cookie|cred|session|sessao|auth|jwt|key|private|client_secret)/i;

function flagLigada(valor) {
  return ["1", "true", "sim", "yes", "on"].includes(String(valor || "").trim().toLowerCase());
}

function flagDesligada(valor) {
  return ["0", "false", "nao", "não", "no", "off", "desligado", "disabled"].includes(String(valor || "").trim().toLowerCase());
}

function autoCleanShadowAtivo(opcoes = {}) {
  if (opcoes.shadow === true) return true;
  if (opcoes.shadow === false) return false;
  if (flagDesligada(process.env[ENV_SHADOW])) return false;
  return true;
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
  if (opcoes.leaseMinutos !== undefined) {
    ttl.jobsAtivosLeaseMs = minutosLeaseJobsAtivos(opcoes.leaseMinutos) * 60 * 1000;
  }
  return {
    ttl,
    loteLimite: limitarInteiro(opcoes.loteLimite, LOTE_LIMITE_PADRAO, 1, LOTE_LIMITE_PADRAO),
    lotesDbPorCiclo: limitarInteiro(opcoes.lotesDbPorCiclo, LOTES_DB_POR_CICLO_PADRAO, 1, 10),
    workspacesFilaPorCiclo: limitarInteiro(opcoes.workspacesFilaPorCiclo, WORKSPACES_FILA_POR_CICLO_PADRAO, 1, 50),
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

  if (tipo === "engine_jobs_cliente" && STATUS_JOBS_ATIVOS_COM_LEASE.includes(status)) {
    return Number(ttl.jobsAtivosLeaseMs || minutosLeaseJobsAtivos() * 60 * 1000);
  }
  if (tipo === "fila_json" && status === "flow_nao_aceita") return ttl.flowNaoAceitaMs;
  if (tipo === "fila_json" && STATUS_FILA_ENVIADO.has(status)) return ttl.filaEnviadaMs;
  if (tipo === "fila_json" && STATUS_FILA_TERMINAL.has(status)) return ttl.filaTerminalMs;
  if (tipo === "engine_ofertas" && (STATUS_OFERTA_TERMINAL_AUTO_CLEAN.has(status) || registro.ofertaTerminalConfirmada === true)) return ttl.ofertasOperacionaisMs;
  if (tipo === "engine_jobs_cliente" && MATRIZ_STATUS_AUTO_CLEAN[status]?.removivelAposHoras) return Number(MATRIZ_STATUS_AUTO_CLEAN[status].removivelAposHoras) * 60 * 60 * 1000;
  if (tipo === "engine_jobs_cliente" && STATUS_JOB_CONCLUIDO.has(status)) return ttl.jobsConcluidosMs;
  if (tipo === "engine_links") return ttl.linksOperacionaisMs;
  if (tipo === "engine_eventos_brutos") return ttl.eventosBrutosMs;
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

  if (registro.tipoRegistro === "engine_jobs_cliente" && STATUS_JOBS_ATIVOS_COM_LEASE.includes(status)) {
    if (!Number.isFinite(idadeMs)) {
      return { ...registro, status, idadeMs: null, ttlMs, elegivel: false, motivo: "timestamp_indisponivel", aplicouMudancas: false };
    }
    if (Number.isFinite(ttlMs) && idadeMs >= ttlMs) {
      return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "lease_expirado_operacional", aplicouMudancas: false };
    }
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "job_ativo_fresco", aplicouMudancas: false };
  }

  if (registro.tipoRegistro === "engine_jobs_cliente" && STATUS_JOB_ATIVO.has(status)) {
    return { ...registro, status, idadeMs, ttlMs, elegivel: false, motivo: "job_ativo", aplicouMudancas: false };
  }

  if (!Number.isFinite(ttlMs)) {
    return { ...registro, status, idadeMs, ttlMs: null, elegivel: false, motivo: "sem_politica_ttl", aplicouMudancas: false };
  }

  if (!Number.isFinite(idadeMs)) {
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
    "politicaCentral",
    "lotes",
    "limiteLotesPorCiclo",
    "jobsRemovidos",
    "ofertasRemovidas",
    "linksRemovidos",
    "eventosBrutosRemovidos",
    "processamentosRemovidos",
    "eventosComerciaisRemovidos",
    "arquivosRemovidos",
    "filasRegravadas",
    "workspacesProcessados",
    "bytesLiberados",
    "bytesLiberadosLegivel",
    "espacoLogicoLiberadoBytes",
    "espacoLogicoLiberado",
    "compactados",
    "removidos",
    "erros",
    "failOpen",
    "classificacao",
    "orphanWorkspaces",
    "workspaces",
    "workspaceClassificacao"
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
  const medidorAutoCleanFila = criarMedidorEngineMemoryStage("auto_clean_shadow_fila_json", {
    limite: politica.loteLimite
  });
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const limite = politica.loteLimite;
  const clientesDir = path.join(dataDir, "clientes");
  const orfaos = new Set(detectarOrphanWorkspacesAutoClean({ ...opcoes, politica }).map(item => item.workspaceId));
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
    bytesRecuperaveisCompactacao: 0,
    orphanWorkspaces: 0,
    workspacesLidos: 0
  };

  if (!fsImpl.existsSync(clientesDir)) {
    medidorAutoCleanFila.fim({
      ok: true,
      autoCleanShadowBytesLidos: 0,
      autoCleanShadowBytesSerializados: 0,
      autoCleanItensLidos: 0,
      autoCleanWorkspaces: 0
    });
    return criarResumoOrigem("fila_json", "fila_json", registros, limite);
  }

  for (const workspaceId of fsImpl.readdirSync(clientesDir).sort()) {
    if (registros.length >= limite) break;
    if (SENSIVEL_RE.test(workspaceId)) continue;
    const workspaceClassificacao = orfaos.has(workspaceId) ? "orphan_workspace" : "workspace_registrado";
    if (workspaceClassificacao === "orphan_workspace") resumoExtra.orphanWorkspaces += 1;
    const filaPath = path.join(clientesDir, workspaceId, "fila.json");
    if (!fsImpl.existsSync(filaPath)) continue;
    resumoExtra.workspacesLidos += 1;
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
        workspaceId,
        workspaceClassificacao,
        aplicouMudancas: false
      });
    }
  }

  const resumo = criarResumoOrigem("fila_json", "fila_json", registros, limite);
  medidorAutoCleanFila.fim({
    ok: true,
    autoCleanShadowBytesLidos: resumoExtra.bytesTotais,
    autoCleanShadowBytesSerializados: registros.reduce((soma, item) => soma + Number(item.bytesEstimados || 0), 0),
    autoCleanItensLidos: resumoExtra.totalItens,
    autoCleanWorkspaces: resumoExtra.workspacesLidos
  });
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
      temOfertaAtiva: row.tem_oferta_ativa === true,
      ofertaTerminalConfirmada: row.oferta_terminal_confirmada === true
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
    SELECT o.id, o.status, COALESCE(o.atualizada_em, o.criada_em) AS referencia_temporal, pg_column_size(o.*)::bigint AS bytes_estimados,
           false AS tem_referencia_fila_viva,
           EXISTS (
             SELECT 1
               FROM engine_jobs_cliente j
              WHERE (j.oferta_id = o.id OR j.evento_id = o.evento_id)
                AND j.status IN (${STATUS_JOB_ATIVO_SQL})
           ) AS tem_job_ativo,
           false AS tem_oferta_ativa,
           ${CONDICAO_OFERTA_TERMINAL_SQL} AS oferta_terminal_confirmada
      FROM engine_ofertas o
     WHERE ${CONDICAO_OFERTA_TERMINAL_SQL}
       AND COALESCE(o.atualizada_em, o.criada_em) < $1::timestamptz
     ORDER BY COALESCE(o.atualizada_em, o.criada_em) ASC
     LIMIT $2`, [cutoff(ttl.ofertasOperacionaisMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_jobs_cliente", `
    SELECT j.id, j.status, j.atualizado_em AS referencia_temporal, pg_column_size(j.*)::bigint AS bytes_estimados,
           false AS tem_referencia_fila_viva,
           j.status IN (${STATUS_JOB_ATIVO_SQL}) AS tem_job_ativo,
           false AS tem_oferta_ativa
      FROM engine_jobs_cliente j
     WHERE COALESCE(NULLIF(TRIM(j.status), ''), '') <> ''
       AND j.status NOT IN (${STATUS_JOB_ATIVO_SQL})
       AND j.atualizado_em < $1::timestamptz
     ORDER BY j.atualizado_em ASC
     LIMIT $2`, [cutoff(ttl.jobsConcluidosMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_eventos_brutos", `
    SELECT e.id, 'evento_bruto' AS status, e.criado_em AS referencia_temporal, pg_column_size(e.*)::bigint AS bytes_estimados,
           false AS tem_job_ativo,
           false AS tem_oferta_ativa,
           false AS tem_referencia_fila_viva
      FROM engine_eventos_brutos e
     WHERE ${CONDICAO_EVENTO_BRUTO_REMOVIVEL_SQL("$1::timestamptz")}
     ORDER BY e.criado_em ASC
     LIMIT $2`, [cutoff(ttl.eventosBrutosMs), limite], opcoes));

  origens.push(await consultarOrigemDb("engine_links", `
    SELECT l.id, 'link' AS status, l.criado_em AS referencia_temporal, pg_column_size(l.*)::bigint AS bytes_estimados,
           EXISTS (SELECT 1 FROM engine_jobs_cliente j WHERE j.evento_id = l.evento_id AND j.status IN (${STATUS_JOB_ATIVO_SQL})) AS tem_job_ativo,
           EXISTS (
             SELECT 1
               FROM engine_ofertas o
              WHERE (o.link_id = l.id OR o.evento_id = l.evento_id)
                AND ${CONDICAO_OFERTA_BLOQUEIA_LINK_SQL("$1::timestamptz")}
           ) AS tem_oferta_ativa,
           false AS tem_referencia_fila_viva
      FROM engine_links l
     WHERE l.criado_em < $1::timestamptz
     ORDER BY l.criado_em ASC
     LIMIT $2`, [cutoff(ttl.linksOperacionaisMs), limite], opcoes));

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

async function executarBatchJobsPostgresAutoClean(client, { loteLimite, horasMinimas }) {
  const resultado = await client.query(
    `WITH candidatos AS (
       SELECT id
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])
          AND criado_em IS NOT NULL
          AND criado_em < NOW() - (GREATEST($2::int, CASE ${TTL_JOB_CASE_SQL} ELSE 12 END)::int * INTERVAL '1 hour')
        ORDER BY criado_em ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
     ), eventos_removidos AS (
       DELETE FROM engine_eventos_comerciais e
        USING candidatos c
        WHERE e.job_id = c.id
        RETURNING e.id, pg_column_size(e.*)::bigint AS bytes
     ), processamentos_removidos AS (
       DELETE FROM engine_processamentos p
        USING candidatos c
        WHERE p.job_id = c.id
        RETURNING p.id, pg_column_size(p.*)::bigint AS bytes
     ), jobs_removidos AS (
       DELETE FROM engine_jobs_cliente j
        USING candidatos c
        WHERE j.id = c.id
        RETURNING j.id, j.status, j.cliente_id, pg_column_size(j.*)::bigint AS bytes
     )
     SELECT
       (SELECT COUNT(*)::int FROM jobs_removidos) AS jobs_removidos,
       (SELECT COUNT(*)::int FROM processamentos_removidos) AS processamentos_removidos,
       (SELECT COUNT(*)::int FROM eventos_removidos) AS eventos_comerciais_removidos,
       COALESCE((SELECT SUM(bytes) FROM jobs_removidos), 0)::bigint AS bytes_jobs,
       COALESCE((SELECT SUM(bytes) FROM processamentos_removidos), 0)::bigint AS bytes_processamentos,
       COALESCE((SELECT SUM(bytes) FROM eventos_removidos), 0)::bigint AS bytes_eventos_comerciais`,
    [STATUS_JOB_REMOVIVEL_AUTO_CLEAN, horasMinimas, loteLimite]
  );

  return resultado.rows[0] || {};
}

async function executarJobsPostgresAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const loteLimite = politica.loteLimite;
  const limiteLotesPorCiclo = politica.lotesDbPorCiclo;
  const horasMinimas = Math.max(12, limitarInteiro(opcoes.horasMinimas, 12, 12, 168));
  const pool = opcoes.pool || (typeof opcoes.getEnginePool === "function" ? opcoes.getEnginePool() : getEnginePool());
  const resumo = {
    origem: "postgres_jobs",
    tipoRegistro: "engine_jobs_cliente",
    modo: "execute",
    lotes: 0,
    limiteLotesPorCiclo,
    loteLimite,
    jobsRemovidos: 0,
    processamentosRemovidos: 0,
    eventosComerciaisRemovidos: 0,
    jobsExpiradosLease: 0,
    processandoExpiradosLease: 0,
    importandoExpiradosLease: 0,
    leaseMinutos: minutosLeaseJobsAtivos(opcoes.leaseMinutos),
    espacoLogicoLiberadoBytes: 0,
    aplicouMudancas: false,
    vacuumExecutado: false
  };

  if (!pool) {
    return { ...resumo, ok: false, failOpen: true, motivo: "banco_indisponivel" };
  }

  try {
    const lease = await expirarJobsAtivosPorLease({
      ...opcoes,
      leaseMinutos: resumo.leaseMinutos,
      loteLimite,
      deps: { queryEngine: opcoes.queryEngine || queryEngine }
    });
    if (lease.ok === false) {
      return { ...resumo, ok: false, failOpen: true, motivo: lease.motivo || "lease_jobs_ativos_falhou" };
    }
    resumo.jobsExpiradosLease = Number(lease.jobsExpirados || 0);
    resumo.processandoExpiradosLease = Number(lease.processandoExpirados || 0);
    resumo.importandoExpiradosLease = Number(lease.importandoExpirados || 0);

    for (let lote = 0; lote < limiteLotesPorCiclo; lote += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [AUTO_CLEAN_JOBS_LOCK_ID]);
        if (lock.rows[0]?.locked !== true) {
          await client.query("ROLLBACK");
          return { ...resumo, ok: false, failOpen: true, motivo: "auto_clean_jobs_lock_ocupado" };
        }

        const batch = await executarBatchJobsPostgresAutoClean(client, { loteLimite, horasMinimas });
        await client.query("COMMIT");

        const jobsRemovidos = Number(batch.jobs_removidos || 0);
        if (!jobsRemovidos) break;

        resumo.lotes += 1;
        resumo.jobsRemovidos += jobsRemovidos;
        resumo.processamentosRemovidos += Number(batch.processamentos_removidos || 0);
        resumo.eventosComerciaisRemovidos += Number(batch.eventos_comerciais_removidos || 0);
        resumo.espacoLogicoLiberadoBytes +=
          Number(batch.bytes_jobs || 0) +
          Number(batch.bytes_processamentos || 0) +
          Number(batch.bytes_eventos_comerciais || 0);
      } catch (erro) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw erro;
      } finally {
        client.release();
      }
    }

    resumo.ok = true;
    resumo.aplicouMudancas = resumo.jobsRemovidos > 0 || resumo.jobsExpiradosLease > 0;
    resumo.espacoLogicoLiberado = bytesLegiveis(resumo.espacoLogicoLiberadoBytes);
    return resumo;
  } catch (erro) {
    return {
      ...resumo,
      ok: false,
      failOpen: true,
      motivo: "auto_clean_jobs_execute_falhou",
      erroTipo: erro?.code || erro?.name || "erro",
      aplicouMudancas: resumo.jobsRemovidos > 0,
      espacoLogicoLiberado: bytesLegiveis(resumo.espacoLogicoLiberadoBytes)
    };
  }
}

async function executarBatchOfertasPostgresAutoClean(client, { loteLimite, horasMinimas }) {
  const resultado = await client.query(
    `WITH candidatos AS (
       SELECT o.id
         FROM engine_ofertas o
        WHERE ${CONDICAO_OFERTA_TERMINAL_SQL}
          AND COALESCE(o.atualizada_em, o.criada_em) IS NOT NULL
          AND COALESCE(o.atualizada_em, o.criada_em) < NOW() - ($1::int * INTERVAL '1 hour')
          AND NOT EXISTS (
            SELECT 1
              FROM engine_jobs_cliente j
             WHERE (j.oferta_id = o.id OR j.evento_id = o.evento_id)
               AND j.status = ANY($2::text[])
          )
        ORDER BY COALESCE(o.atualizada_em, o.criada_em) ASC, o.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
     ), ofertas_removidas AS (
       DELETE FROM engine_ofertas o
        USING candidatos c
        WHERE o.id = c.id
          AND ${CONDICAO_OFERTA_TERMINAL_SQL}
          AND COALESCE(o.atualizada_em, o.criada_em) IS NOT NULL
          AND COALESCE(o.atualizada_em, o.criada_em) < NOW() - ($1::int * INTERVAL '1 hour')
          AND NOT EXISTS (
            SELECT 1
              FROM engine_jobs_cliente j
             WHERE (j.oferta_id = o.id OR j.evento_id = o.evento_id)
               AND j.status = ANY($2::text[])
          )
        RETURNING o.id, o.status, pg_column_size(o.*)::bigint AS bytes
     )
     SELECT
       (SELECT COUNT(*)::int FROM ofertas_removidas) AS ofertas_removidas,
       COALESCE((SELECT SUM(bytes) FROM ofertas_removidas), 0)::bigint AS bytes_ofertas`,
    [horasMinimas, Array.from(STATUS_JOB_ATIVO), loteLimite]
  );

  return resultado.rows[0] || {};
}

async function executarOfertasPostgresAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const loteLimite = politica.loteLimite;
  const limiteLotesPorCiclo = politica.lotesDbPorCiclo;
  const horasMinimas = Math.max(12, limitarInteiro(opcoes.horasMinimasOfertas, 12, 12, 168));
  const pool = opcoes.pool || (typeof opcoes.getEnginePool === "function" ? opcoes.getEnginePool() : getEnginePool());
  const resumo = {
    origem: "postgres_ofertas",
    tipoRegistro: "engine_ofertas",
    modo: "execute",
    lotes: 0,
    limiteLotesPorCiclo,
    loteLimite,
    horasMinimas,
    ofertasRemovidas: 0,
    espacoLogicoLiberadoBytes: 0,
    aplicouMudancas: false,
    vacuumExecutado: false
  };

  if (!pool) {
    return { ...resumo, ok: false, failOpen: true, motivo: "banco_indisponivel" };
  }

  try {
    for (let lote = 0; lote < limiteLotesPorCiclo; lote += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [AUTO_CLEAN_OFERTAS_LOCK_ID]);
        if (lock.rows[0]?.locked !== true) {
          await client.query("ROLLBACK");
          return { ...resumo, ok: false, failOpen: true, motivo: "auto_clean_ofertas_lock_ocupado" };
        }

        const batch = await executarBatchOfertasPostgresAutoClean(client, { loteLimite, horasMinimas });
        await client.query("COMMIT");

        const ofertasRemovidas = Number(batch.ofertas_removidas || 0);
        if (!ofertasRemovidas) break;

        resumo.lotes += 1;
        resumo.ofertasRemovidas += ofertasRemovidas;
        resumo.espacoLogicoLiberadoBytes += Number(batch.bytes_ofertas || 0);
      } catch (erro) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw erro;
      } finally {
        client.release();
      }
    }

    resumo.ok = true;
    resumo.aplicouMudancas = resumo.ofertasRemovidas > 0;
    resumo.espacoLogicoLiberado = bytesLegiveis(resumo.espacoLogicoLiberadoBytes);
    return resumo;
  } catch (erro) {
    return {
      ...resumo,
      ok: false,
      failOpen: true,
      motivo: "auto_clean_ofertas_execute_falhou",
      erroTipo: erro?.code || erro?.name || "erro",
      aplicouMudancas: resumo.ofertasRemovidas > 0,
      espacoLogicoLiberado: bytesLegiveis(resumo.espacoLogicoLiberadoBytes)
    };
  }
}

async function executarBatchLinksPostgresAutoClean(client, { loteLimite, horasMinimas }) {
  const cutoffSql = "NOW() - ($1::int * INTERVAL '1 hour')";
  const ofertaBloqueiaLinkSql = CONDICAO_OFERTA_BLOQUEIA_LINK_SQL(cutoffSql);
  const resultado = await client.query(
    `WITH candidatos AS (
       SELECT l.id
         FROM engine_links l
        WHERE l.criado_em IS NOT NULL
          AND l.criado_em < ${cutoffSql}
          AND NOT EXISTS (
            SELECT 1
              FROM engine_jobs_cliente j
             WHERE j.evento_id = l.evento_id
               AND j.status = ANY($2::text[])
          )
          AND NOT EXISTS (
            SELECT 1
              FROM engine_ofertas o
             WHERE (o.link_id = l.id OR o.evento_id = l.evento_id)
               AND ${ofertaBloqueiaLinkSql}
          )
        ORDER BY l.criado_em ASC, l.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
     ), links_removidos AS (
       DELETE FROM engine_links l
        USING candidatos c
        WHERE l.id = c.id
          AND l.criado_em IS NOT NULL
          AND l.criado_em < ${cutoffSql}
          AND NOT EXISTS (
            SELECT 1
              FROM engine_jobs_cliente j
             WHERE j.evento_id = l.evento_id
               AND j.status = ANY($2::text[])
          )
          AND NOT EXISTS (
            SELECT 1
              FROM engine_ofertas o
             WHERE (o.link_id = l.id OR o.evento_id = l.evento_id)
               AND ${ofertaBloqueiaLinkSql}
          )
        RETURNING l.id, pg_column_size(l.*)::bigint AS bytes
     )
     SELECT
       (SELECT COUNT(*)::int FROM links_removidos) AS links_removidos,
       COALESCE((SELECT SUM(bytes) FROM links_removidos), 0)::bigint AS bytes_links`,
    [horasMinimas, Array.from(STATUS_JOB_ATIVO), loteLimite]
  );

  return resultado.rows[0] || {};
}

async function executarLinksPostgresAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const loteLimite = politica.loteLimite;
  const limiteLotesPorCiclo = politica.lotesDbPorCiclo;
  const horasMinimas = Math.max(12, limitarInteiro(opcoes.horasMinimasLinks, 12, 12, 168));
  const pool = opcoes.pool || (typeof opcoes.getEnginePool === "function" ? opcoes.getEnginePool() : getEnginePool());
  const resumo = {
    origem: "postgres_links",
    tipoRegistro: "engine_links",
    modo: "execute",
    lotes: 0,
    limiteLotesPorCiclo,
    loteLimite,
    horasMinimas,
    linksRemovidos: 0,
    espacoLogicoLiberadoBytes: 0,
    aplicouMudancas: false,
    vacuumExecutado: false
  };

  if (!pool) {
    return { ...resumo, ok: false, failOpen: true, motivo: "banco_indisponivel" };
  }

  try {
    for (let lote = 0; lote < limiteLotesPorCiclo; lote += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [AUTO_CLEAN_LINKS_LOCK_ID]);
        if (lock.rows[0]?.locked !== true) {
          await client.query("ROLLBACK");
          return { ...resumo, ok: false, failOpen: true, motivo: "auto_clean_links_lock_ocupado" };
        }

        const batch = await executarBatchLinksPostgresAutoClean(client, { loteLimite, horasMinimas });
        await client.query("COMMIT");

        const linksRemovidos = Number(batch.links_removidos || 0);
        if (!linksRemovidos) break;

        resumo.lotes += 1;
        resumo.linksRemovidos += linksRemovidos;
        resumo.espacoLogicoLiberadoBytes += Number(batch.bytes_links || 0);
      } catch (erro) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw erro;
      } finally {
        client.release();
      }
    }

    resumo.ok = true;
    resumo.aplicouMudancas = resumo.linksRemovidos > 0;
    resumo.espacoLogicoLiberado = bytesLegiveis(resumo.espacoLogicoLiberadoBytes);
    return resumo;
  } catch (erro) {
    return {
      ...resumo,
      ok: false,
      failOpen: true,
      motivo: "auto_clean_links_execute_falhou",
      erroTipo: erro?.code || erro?.name || "erro",
      aplicouMudancas: resumo.linksRemovidos > 0,
      espacoLogicoLiberado: bytesLegiveis(resumo.espacoLogicoLiberadoBytes)
    };
  }
}

async function executarBatchEventosBrutosPostgresAutoClean(client, { loteLimite, horasMinimas }) {
  const cutoffSql = "NOW() - ($1::int * INTERVAL '1 hour')";
  const condicaoEventoRemovivelSql = CONDICAO_EVENTO_BRUTO_REMOVIVEL_SQL(cutoffSql);
  const resultado = await client.query(
    `WITH candidatos AS (
       SELECT e.id
         FROM engine_eventos_brutos e
        WHERE ${condicaoEventoRemovivelSql}
        ORDER BY e.criado_em ASC, e.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     ), eventos_brutos_removidos AS (
       DELETE FROM engine_eventos_brutos e
        USING candidatos c
        WHERE e.id = c.id
          AND ${condicaoEventoRemovivelSql}
        RETURNING e.id, pg_column_size(e.*)::bigint AS bytes
     )
     SELECT
       (SELECT COUNT(*)::int FROM eventos_brutos_removidos) AS eventos_brutos_removidos,
       COALESCE((SELECT SUM(bytes) FROM eventos_brutos_removidos), 0)::bigint AS bytes_eventos_brutos`,
    [horasMinimas, loteLimite]
  );

  return resultado.rows[0] || {};
}

async function executarEventosBrutosPostgresAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const loteLimite = politica.loteLimite;
  const limiteLotesPorCiclo = politica.lotesDbPorCiclo;
  const horasMinimas = Math.max(12, limitarInteiro(opcoes.horasMinimasEventosBrutos, 12, 12, 168));
  const pool = opcoes.pool || (typeof opcoes.getEnginePool === "function" ? opcoes.getEnginePool() : getEnginePool());
  const resumo = {
    origem: "postgres_eventos_brutos",
    tipoRegistro: "engine_eventos_brutos",
    modo: "execute",
    lotes: 0,
    limiteLotesPorCiclo,
    loteLimite,
    horasMinimas,
    eventosBrutosRemovidos: 0,
    espacoLogicoLiberadoBytes: 0,
    aplicouMudancas: false,
    vacuumExecutado: false
  };

  if (!pool) {
    return { ...resumo, ok: false, failOpen: true, motivo: "banco_indisponivel" };
  }

  try {
    for (let lote = 0; lote < limiteLotesPorCiclo; lote += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [AUTO_CLEAN_EVENTOS_BRUTOS_LOCK_ID]);
        if (lock.rows[0]?.locked !== true) {
          await client.query("ROLLBACK");
          return { ...resumo, ok: false, failOpen: true, motivo: "auto_clean_eventos_brutos_lock_ocupado" };
        }

        const batch = await executarBatchEventosBrutosPostgresAutoClean(client, { loteLimite, horasMinimas });
        await client.query("COMMIT");

        const eventosBrutosRemovidos = Number(batch.eventos_brutos_removidos || 0);
        if (!eventosBrutosRemovidos) break;

        resumo.lotes += 1;
        resumo.eventosBrutosRemovidos += eventosBrutosRemovidos;
        resumo.espacoLogicoLiberadoBytes += Number(batch.bytes_eventos_brutos || 0);
      } catch (erro) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw erro;
      } finally {
        client.release();
      }
    }

    resumo.ok = true;
    resumo.aplicouMudancas = resumo.eventosBrutosRemovidos > 0;
    resumo.espacoLogicoLiberado = bytesLegiveis(resumo.espacoLogicoLiberadoBytes);
    return resumo;
  } catch (erro) {
    return {
      ...resumo,
      ok: false,
      failOpen: true,
      motivo: "auto_clean_eventos_brutos_execute_falhou",
      erroTipo: erro?.code || erro?.name || "erro",
      aplicouMudancas: resumo.eventosBrutosRemovidos > 0,
      espacoLogicoLiberado: bytesLegiveis(resumo.espacoLogicoLiberadoBytes)
    };
  }
}

function listarWorkspacesFila(dataDir, fsImpl = fs) {
  const clientesDir = path.join(dataDir, "clientes");
  try {
    if (!fsImpl.existsSync(clientesDir)) return [];
    return fsImpl.readdirSync(clientesDir)
      .filter(workspaceId => workspaceId && !SENSIVEL_RE.test(workspaceId))
      .filter(workspaceId => {
        try {
          return fsImpl.statSync(path.join(clientesDir, workspaceId)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function lerUsuariosIdsAutoClean(dataDir, fsImpl = fs) {
  const usuariosPath = path.join(dataDir, "usuarios.json");
  try {
    if (!fsImpl.existsSync(usuariosPath)) return null;
    const usuarios = JSON.parse(fsImpl.readFileSync(usuariosPath, "utf8"));
    return new Set(
      (Array.isArray(usuarios) ? usuarios : [])
        .map(usuario => String(usuario?.id || "").trim())
        .filter(Boolean)
    );
  } catch {
    return null;
  }
}

function detectarOrphanWorkspacesAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const idsUsuarios = lerUsuariosIdsAutoClean(dataDir, fsImpl);
  if (!idsUsuarios) return [];

  return listarWorkspacesFila(dataDir, fsImpl)
    .filter(workspaceId => !idsUsuarios.has(workspaceId))
    .map(workspaceId => ({
      origem: "orphan_workspace",
      tipoRegistro: "orphan_workspace",
      status: "orphan_workspace",
      workspaceId,
      classificacao: "orphan_workspace",
      elegivel: false,
      motivo: "diretorio_sem_usuario_correspondente",
      aplicouMudancas: false
    }));
}

function auditarOrphanWorkspaces(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const limite = politica.loteLimite;
  const registros = detectarOrphanWorkspacesAutoClean({ ...opcoes, politica });
  const resumo = criarResumoOrigem("orphan_workspace", "orphan_workspace", registros.slice(0, limite), limite);
  return {
    ...resumo,
    classificacao: "orphan_workspace",
    orphanWorkspaces: registros.length,
    workspaces: registros.map(item => item.workspaceId).slice(0, limite),
    aplicouMudancas: false
  };
}

function escreverJsonAtomico(fsImpl, arquivo, dados) {
  const dir = path.dirname(arquivo);
  const tmp = path.join(dir, `.${path.basename(arquivo)}.autoclean-${process.pid}-${Date.now()}.tmp`);
  fsImpl.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fsImpl.renameSync(tmp, arquivo);
}

function executarCompactacaoFilaWorkspace(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const workspaceId = String(opcoes.workspaceId || "").trim();
  const filaPath = path.join(dataDir, "clientes", workspaceId, "fila.json");

  if (!workspaceId || SENSIVEL_RE.test(workspaceId)) {
    return { ok: false, aplicouMudancas: false, motivo: "workspace_inseguro" };
  }

  let fila;
  let antesBytes = 0;
  try {
    if (!fsImpl.existsSync(filaPath)) return { ok: true, aplicouMudancas: false, motivo: "fila_ausente" };
    const texto = fsImpl.readFileSync(filaPath, "utf8");
    antesBytes = Buffer.byteLength(texto || "", "utf8");
    fila = JSON.parse(texto);
  } catch {
    return { ok: false, aplicouMudancas: false, motivo: "fila_json_invalida" };
  }

  if (!Array.isArray(fila)) return { ok: false, aplicouMudancas: false, motivo: "fila_json_invalida" };

  const analise = filaHistoricoPolicy.analisarFilaHistorico(fila, { agoraMs });
  if (!analise.resumo.compactaveis && !analise.resumo.removiveis) {
    return {
      ok: true,
      aplicouMudancas: false,
      motivo: "sem_itens_elegiveis",
      integrais: analise.resumo.integrais,
      protegidos: analise.resumo.protegidos
    };
  }

  try {
    escreverJsonAtomico(fsImpl, filaPath, analise.transformada);
  } catch (erro) {
    return {
      ok: false,
      failOpen: true,
      aplicouMudancas: false,
      motivo: "fila_json_gravacao_falhou",
      erroTipo: erro?.code || erro?.name || "erro"
    };
  }

  const depoisBytes = Buffer.byteLength(JSON.stringify(analise.transformada, null, 2), "utf8");
  return {
    ok: true,
    aplicouMudancas: true,
    compactados: analise.resumo.compactaveis,
    removidos: analise.resumo.removiveis,
    protegidos: analise.resumo.protegidos,
    integrais: analise.resumo.integrais,
    bytesLiberados: Math.max(0, antesBytes - depoisBytes),
    bytesLiberadosLegivel: bytesLegiveis(Math.max(0, antesBytes - depoisBytes))
  };
}

function executarFilaJsonAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const workspaces = Array.isArray(opcoes.workspaces)
    ? opcoes.workspaces
    : listarWorkspacesFila(dataDir, fsImpl);
  const selecionados = workspaces.slice(0, politica.workspacesFilaPorCiclo);
  const resumo = {
    origem: "fila_json",
    tipoRegistro: "fila_json",
    modo: "execute",
    workspacesProcessados: 0,
    filasRegravadas: 0,
    compactados: 0,
    removidos: 0,
    protegidos: 0,
    bytesLiberados: 0,
    erros: 0,
    aplicouMudancas: false
  };

  for (const workspaceId of selecionados) {
    const resultado = executarCompactacaoFilaWorkspace({ ...opcoes, politica, dataDir, fs: fsImpl, workspaceId });
    resumo.workspacesProcessados += 1;
    if (resultado.ok === false) {
      resumo.erros += 1;
      continue;
    }
    resumo.protegidos += Number(resultado.protegidos || 0);
    if (resultado.aplicouMudancas) {
      resumo.filasRegravadas += 1;
      resumo.compactados += Number(resultado.compactados || 0);
      resumo.removidos += Number(resultado.removidos || 0);
      resumo.bytesLiberados += Number(resultado.bytesLiberados || 0);
    }
  }

  resumo.aplicouMudancas = resumo.filasRegravadas > 0;
  resumo.bytesLiberadosLegivel = bytesLegiveis(resumo.bytesLiberados);
  return resumo;
}

function coletarArquivosElegiveisAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const dataDir = path.resolve(politica.dataDir || DEFAULT_DATA_DIR);
  const fsImpl = opcoes.fs || fs;
  const agoraMs = Number(opcoes.agoraMs || Date.now());
  const limite = politica.loteLimite;
  const elegiveis = [];

  if (!fsImpl.existsSync(dataDir)) return elegiveis;
  const pilha = [dataDir];
  while (pilha.length && elegiveis.length < limite) {
    const atual = pilha.pop();
    let stats;
    try { stats = fsImpl.lstatSync(atual); } catch { continue; }
    if (stats.isSymbolicLink && stats.isSymbolicLink()) continue;
    if (stats.isDirectory && stats.isDirectory()) {
      const relDir = path.relative(dataDir, atual).replace(/\\/g, "/");
      if (isSessaoOuConfig(relDir)) continue;
      let filhos = [];
      try { filhos = fsImpl.readdirSync(atual).map(nome => path.join(atual, nome)); } catch { filhos = []; }
      for (const filho of filhos) pilha.push(filho);
      continue;
    }
    if (!stats.isFile || !stats.isFile()) continue;

    const categoria = categoriaArquivoAutoClean(dataDir, atual, stats);
    if (categoria === "protegido_sensivel" || categoria === "fila_json_arquivo" || categoria === "arquivos_auditoria" || categoria === "outros") continue;
    const tipoRegistro = categoria === "logs_persistidos" ? "logs_persistidos" : categoria;
    const decisao = avaliarRegistroAutoClean({
      origem: categoria,
      tipoRegistro: categoria === "midias_reconstruiveis" || categoria === "backups_operacionais" ? "temporarios" : tipoRegistro,
      status: "arquivo",
      referenciaTemporal: new Date(stats.mtimeMs || stats.ctimeMs || agoraMs).toISOString(),
      bytesEstimados: Number(stats.size || 0),
      rollbackAtivo: categoria === "snapshots_reset" && (agoraMs - Number(stats.mtimeMs || agoraMs)) < politica.ttl.snapshotsMs
    }, { politica, agoraMs });
    if (decisao.elegivel) elegiveis.push({ caminho: atual, categoria, bytes: Number(stats.size || 0) });
  }

  return elegiveis;
}

function executarArquivosAutoClean(opcoes = {}) {
  const politica = opcoes.politica || criarPoliticaRetencao(opcoes);
  const fsImpl = opcoes.fs || fs;
  const arquivos = coletarArquivosElegiveisAutoClean({ ...opcoes, politica });
  const resumo = {
    origem: "arquivos_operacionais",
    tipoRegistro: "arquivos",
    modo: "execute",
    quantidade: arquivos.length,
    arquivosRemovidos: 0,
    bytesLiberados: 0,
    erros: 0,
    loteLimite: politica.loteLimite,
    aplicouMudancas: false
  };

  for (const arquivo of arquivos) {
    try {
      fsImpl.unlinkSync(arquivo.caminho);
      resumo.arquivosRemovidos += 1;
      resumo.bytesLiberados += Number(arquivo.bytes || 0);
    } catch {
      resumo.erros += 1;
    }
  }

  resumo.aplicouMudancas = resumo.arquivosRemovidos > 0;
  resumo.bytesLiberadosLegivel = bytesLegiveis(resumo.bytesLiberados);
  return resumo;
}

async function executarAutoCleanExecute(opcoes = {}) {
  const inicio = Date.now();
  const politica = criarPoliticaRetencao(opcoes);
  const etapas = [];

  if (opcoes.incluirPostgres !== false) {
    etapas.push(await executarJobsPostgresAutoClean({ ...opcoes, politica }));
    etapas.push(await executarOfertasPostgresAutoClean({ ...opcoes, politica }));
    etapas.push(await executarLinksPostgresAutoClean({ ...opcoes, politica }));
    etapas.push(await executarEventosBrutosPostgresAutoClean({ ...opcoes, politica }));
  }
  if (opcoes.incluirArquivos !== false) {
    etapas.push(executarFilaJsonAutoClean({ ...opcoes, politica }));
    etapas.push(executarArquivosAutoClean({ ...opcoes, politica }));
  }

  const resumo = {
    origem: "auto_clean",
    tipoRegistro: "execute_resumo",
    modo: "execute",
    totalOrigens: etapas.length,
    aplicouMudancas: etapas.some(etapa => etapa.aplicouMudancas === true),
    jobsRemovidos: etapas.reduce((soma, etapa) => soma + Number(etapa.jobsRemovidos || 0), 0),
    ofertasRemovidas: etapas.reduce((soma, etapa) => soma + Number(etapa.ofertasRemovidas || 0), 0),
    linksRemovidos: etapas.reduce((soma, etapa) => soma + Number(etapa.linksRemovidos || 0), 0),
    eventosBrutosRemovidos: etapas.reduce((soma, etapa) => soma + Number(etapa.eventosBrutosRemovidos || 0), 0),
    jobsExpiradosLease: etapas.reduce((soma, etapa) => soma + Number(etapa.jobsExpiradosLease || 0), 0),
    processandoExpiradosLease: etapas.reduce((soma, etapa) => soma + Number(etapa.processandoExpiradosLease || 0), 0),
    importandoExpiradosLease: etapas.reduce((soma, etapa) => soma + Number(etapa.importandoExpiradosLease || 0), 0),
    processamentosRemovidos: etapas.reduce((soma, etapa) => soma + Number(etapa.processamentosRemovidos || 0), 0),
    eventosComerciaisRemovidos: etapas.reduce((soma, etapa) => soma + Number(etapa.eventosComerciaisRemovidos || 0), 0),
    arquivosRemovidos: etapas.reduce((soma, etapa) => soma + Number(etapa.arquivosRemovidos || 0), 0),
    filasRegravadas: etapas.reduce((soma, etapa) => soma + Number(etapa.filasRegravadas || 0), 0),
    compactados: etapas.reduce((soma, etapa) => soma + Number(etapa.compactados || 0), 0),
    removidos: etapas.reduce((soma, etapa) => soma + Number(etapa.removidos || 0), 0),
    erros: etapas.reduce((soma, etapa) => soma + Number(etapa.erros || 0) + (etapa.ok === false ? 1 : 0), 0),
    bytesLiberados: etapas.reduce((soma, etapa) => soma + Number(etapa.bytesLiberados || etapa.espacoLogicoLiberadoBytes || 0), 0),
    duracaoMs: Date.now() - inicio,
    loteLimite: politica.loteLimite,
    limiteLotesPorCiclo: politica.lotesDbPorCiclo,
    etapas
  };
  resumo.bytesLiberadosLegivel = bytesLegiveis(resumo.bytesLiberados);
  resumo.failOpen = resumo.erros > 0;
  return resumo;
}

async function executarAutoCleanShadow(opcoes = {}) {
  const inicio = Date.now();
  const politica = criarPoliticaRetencao(opcoes);
  const logger = opcoes.logger || console;
  const origens = [];
  const executarDb = opcoes.incluirPostgres !== false;
  const executarArquivos = opcoes.incluirArquivos !== false;

  if (executarDb) origens.push(...await inventariarPostgres({ ...opcoes, politica }));
  if (executarArquivos) {
    origens.push(auditarOrphanWorkspaces({ ...opcoes, politica }));
    origens.push(auditarFilaJson({ ...opcoes, politica }));
    origens.push(...inventariarArquivosPorCategoria({ ...opcoes, politica }));
    origens.push(memoriaComercialStatus({ ...opcoes, politica }));
  }

  for (const origem of origens) logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-SHADOW]", origem, logger);

  let execute = null;
  if (autoCleanExecuteAtivo(opcoes)) {
    try {
      execute = await executarAutoCleanExecute({ ...opcoes, politica });
      for (const etapa of execute.etapas || []) logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-EXECUTE]", etapa, logger);
      logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-EXECUTE-RESUMO]", execute, logger);
    } catch (erro) {
      execute = {
        origem: "auto_clean",
        tipoRegistro: "execute_erro",
        ok: false,
        failOpen: true,
        motivo: "auto_clean_execute_indisponivel",
        erroTipo: erro?.code || erro?.name || "erro",
        aplicouMudancas: false
      };
      logAutoClean("[OPTIMUS-AUTO-CLEAN-V1-ERRO]", execute, logger);
    }
  }

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
    aplicouMudancas: execute?.aplicouMudancas === true,
    origens,
    execute
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
    return { ok: true, ...resumo, aplicouMudancas: resumo.aplicouMudancas === true };
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
  MATRIZ_STATUS_AUTO_CLEAN,
  flagLigada,
  flagDesligada,
  autoCleanShadowAtivo,
  autoCleanExecuteAtivo,
  criarPoliticaRetencao,
  avaliarRegistroAutoClean,
  executarAutoCleanShadow,
  executarAutoCleanShadowSeguro,
  executarAutoCleanExecute,
  executarJobsPostgresAutoClean,
  executarOfertasPostgresAutoClean,
  executarLinksPostgresAutoClean,
  executarEventosBrutosPostgresAutoClean,
  executarFilaJsonAutoClean,
  executarArquivosAutoClean,
  executarCompactacaoFilaWorkspace,
  auditarOrphanWorkspaces,
  detectarOrphanWorkspacesAutoClean,
  coletarArquivosElegiveisAutoClean,
  auditarFilaJson,
  inventariarArquivosPorCategoria,
  memoriaComercialStatus,
  sanitizarLogPayload
};
