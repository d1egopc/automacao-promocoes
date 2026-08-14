"use strict";

const crypto = require("crypto");
const { queryEngine } = require("../engine/database");
const { criarGateAbsorcaoShadowOfc } = require("../engine/ofc/absorption-gate.service");
const { TTL_NORMAL_MS, TTL_TURBO_MS } = require("../engine/flow-manager/flow-manager.service");
const { minutosLeaseJobsAtivos } = require("../engine/jobs.service");
const { readGlobalJson, writeGlobalJson } = require("../../utils/storage");

const AUDITORIAS_ARQUIVO = "telemetria-auditorias.json";
const TTL_VALIDOS = new Set([15, 30, 60]);
const LIMITE_MAXIMO_EVENTOS = 200;
const LIMITE_PADRAO_EVENTOS = 50;
const STATUS_JOBS_CIRCULAVEIS_TELEMETRIA = ["pendente", "pronto_para_importar"];
const STATUS_JOBS_EM_CURSO_TELEMETRIA = ["processando", "importando"];
const ROTAS_TOKEN_READ_ONLY = new Set([
  "/telemetria/saude",
  "/telemetria/eventos",
  "/saude",
  "/eventos"
]);
const SEGREDO_PEPPER = "optimus_telemetria_v1";
const CHAVES_SENSIVEIS = /jwt|senha|password|cookie|cookies|token|secret|segredo|authorization|credencial|credential|appSecret|apiKey|apikey|access|refresh|session|sessao|html|payload|imagem|image/i;

function agoraIso() {
  return new Date().toISOString();
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function inteiroLimitado(valor, padrao, minimo, maximo) {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n)) return padrao;
  return Math.max(minimo, Math.min(maximo, n));
}

function minutosDeMs(valor, padrao) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.max(1, Math.ceil(n / 60_000));
}

function semanticaJobsVivosTelemetria() {
  return {
    statusCirculaveis: STATUS_JOBS_CIRCULAVEIS_TELEMETRIA,
    statusEmCurso: STATUS_JOBS_EM_CURSO_TELEMETRIA,
    ttlNormalMinutos: minutosDeMs(TTL_NORMAL_MS, 30),
    ttlTurboMinutos: minutosDeMs(TTL_TURBO_MS, 10),
    leaseMinutos: minutosLeaseJobsAtivos()
  };
}

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function normalizarEtapa(valor = "") {
  return texto(valor).toLowerCase();
}

function normalizarStatus(valor = "") {
  return texto(valor).toLowerCase();
}

function normalizarEscopo(valor = "") {
  const escopo = texto(valor).toLowerCase();
  return escopo === "workspace" ? "workspace" : "plataforma";
}

function hashSegredo(segredo = "") {
  return crypto
    .createHash("sha256")
    .update(`${SEGREDO_PEPPER}:${segredo}`)
    .digest("hex");
}

function compararSeguro(a = "", b = "") {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function gerarCodigoAuditoria() {
  return `tel_${crypto.randomBytes(32).toString("base64url")}`;
}

function gerarAuditoriaId() {
  return `aud_${crypto.randomBytes(12).toString("hex")}`;
}

function carregarAuditorias() {
  const dados = readGlobalJson(AUDITORIAS_ARQUIVO, []);
  return Array.isArray(dados) ? dados : [];
}

function salvarAuditorias(lista = []) {
  const agora = Date.now();
  const retidas = lista.filter(item => {
    if (!item || typeof item !== "object") return false;
    if (item.revogada === true) return true;
    const expiraMs = new Date(item.expiraEm || 0).getTime();
    return Number.isFinite(expiraMs) && expiraMs > agora - 24 * 60 * 60 * 1000;
  });
  writeGlobalJson(AUDITORIAS_ARQUIVO, retidas);
  return retidas;
}

function listarAuditoriasSanitizadas() {
  return carregarAuditorias().map(item => ({
    auditoriaId: item.auditoriaId,
    escopo: item.escopo,
    clienteId: item.clienteId || null,
    criadoEm: item.criadoEm,
    expiraEm: item.expiraEm,
    revogada: item.revogada === true,
    revogadaEm: item.revogadaEm || null,
    ultimoUsoEm: item.ultimoUsoEm || null
  }));
}

function criarAuditoriaTemporaria({ ttlMinutos = 30, escopo = "plataforma", clienteId = "", criadoPor = "" } = {}) {
  const ttl = Number(ttlMinutos);
  if (!TTL_VALIDOS.has(ttl)) {
    return { ok: false, erro: "ttl_invalido", ttlPermitidos: [15, 30, 60] };
  }

  const escopoFinal = normalizarEscopo(escopo);
  const cliente = texto(clienteId);
  if (escopoFinal === "workspace" && !cliente) {
    return { ok: false, erro: "clienteId_obrigatorio_para_workspace" };
  }

  const segredo = gerarCodigoAuditoria();
  const criadoEm = agoraIso();
  const expiraEm = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const auditoria = {
    auditoriaId: gerarAuditoriaId(),
    hash: hashSegredo(segredo),
    escopo: escopoFinal,
    clienteId: escopoFinal === "workspace" ? cliente : null,
    criadoPor: texto(criadoPor) || null,
    criadoEm,
    expiraEm,
    revogada: false,
    revogadaEm: null,
    ultimoUsoEm: null
  };

  const lista = carregarAuditorias();
  lista.push(auditoria);
  salvarAuditorias(lista);

  return {
    ok: true,
    auditoriaId: auditoria.auditoriaId,
    codigo: segredo,
    escopo: auditoria.escopo,
    clienteId: auditoria.clienteId,
    criadoEm,
    expiraEm
  };
}

function revogarAuditoriaTemporaria({ auditoriaId = "" } = {}) {
  const id = texto(auditoriaId);
  if (!id) return { ok: false, erro: "auditoriaId_obrigatorio" };

  let encontrada = false;
  const lista = carregarAuditorias().map(item => {
    if (item.auditoriaId !== id) return item;
    encontrada = true;
    return { ...item, revogada: true, revogadaEm: agoraIso() };
  });

  salvarAuditorias(lista);
  return { ok: encontrada, revogada: encontrada, erro: encontrada ? undefined : "auditoria_nao_encontrada" };
}

function extrairTokenAuditoria(req = {}) {
  const header = texto(req.headers?.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return texto(req.headers?.["x-telemetria-auditoria"] || req.query?.auditoriaToken || "");
}

function rotaPermitidaTokenAuditoria(req = {}) {
  if (req.method !== "GET") return false;
  if (ROTAS_TOKEN_READ_ONLY.has(req.path)) return true;
  return /^\/telemetria\/rastrear\/[^/]+$/.test(req.path || "") ||
    /^\/rastrear\/[^/]+$/.test(req.path || "");
}

function autenticarTokenAuditoria(req = {}) {
  const token = extrairTokenAuditoria(req);
  if (!token) return { ok: false, motivo: "token_ausente" };
  if (!rotaPermitidaTokenAuditoria(req)) return { ok: false, motivo: "rota_nao_permitida" };

  const hash = hashSegredo(token);
  const agora = Date.now();
  const lista = carregarAuditorias();
  const indice = lista.findIndex(item => item?.hash && compararSeguro(item.hash, hash));
  if (indice < 0) return { ok: false, motivo: "token_invalido" };

  const item = lista[indice];
  if (item.revogada === true) return { ok: false, motivo: "token_revogado" };

  const expiraMs = new Date(item.expiraEm || 0).getTime();
  if (!Number.isFinite(expiraMs) || expiraMs <= agora) {
    return { ok: false, motivo: "token_expirado" };
  }

  lista[indice] = { ...item, ultimoUsoEm: agoraIso() };
  salvarAuditorias(lista);

  return {
    ok: true,
    auditoria: {
      auditoriaId: item.auditoriaId,
      escopo: item.escopo,
      clienteId: item.clienteId || null,
      expiraEm: item.expiraEm
    }
  };
}

function escopoDaRequisicao(req = {}) {
  if (req.telemetriaAuditoria) {
    return {
      tipo: req.telemetriaAuditoria.escopo || "plataforma",
      clienteId: req.telemetriaAuditoria.clienteId || null,
      origem: "token_auditoria"
    };
  }
  return { tipo: "plataforma", clienteId: null, origem: "auth_normal" };
}

function aplicarEscopoCliente(filtros = {}, escopo = {}) {
  if (escopo.tipo !== "workspace") return { ...filtros };
  return { ...filtros, clienteId: escopo.clienteId };
}

function sanitizarUrl(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return null;
  try {
    const url = new URL(bruto);
    return {
      dominio: url.hostname,
      caminho: url.pathname,
      urlSanitizada: `${url.origin}${url.pathname}`
    };
  } catch {
    return { dominio: "", caminho: "", urlSanitizada: bruto.slice(0, 120) };
  }
}

function sanitizarDestinoFuncional(valor = "") {
  const bruto = texto(valor);
  if (!bruto) return "";
  try {
    const url = new URL(bruto, "https://optimus.local");
    return url.pathname || "";
  } catch {
    return bruto.split(/[?#]/)[0].slice(0, 120);
  }
}

function sanitizarValor(valor, profundidade = 0) {
  if (profundidade > 4) return "[omitido]";
  if (Array.isArray(valor)) return valor.slice(0, 50).map(item => sanitizarValor(item, profundidade + 1));
  if (!valor || typeof valor !== "object") return valor;

  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (CHAVES_SENSIVEIS.test(chave)) {
      saida[chave] = item ? "***" : item;
      continue;
    }
    saida[chave] = sanitizarValor(item, profundidade + 1);
  }
  return saida;
}

function sanitizarLinks(links = []) {
  if (!Array.isArray(links)) return [];
  return links.slice(0, 50).map((link, indice) => {
    if (typeof link === "string") return { ordem: indice + 1, ...sanitizarUrl(link) };
    const url = link?.url || link?.urlOriginal || link?.original || link?.href || link?.url_original || "";
    return {
      ordem: Number(link?.ordem || link?.ordemCaptura || indice + 1),
      papel: texto(link?.papel || link?.tipo || link?.role || ""),
      ...sanitizarUrl(url),
      destinoFuncional: sanitizarDestinoFuncional(link?.destinoFuncional || link?.rota || "")
    };
  });
}

function linhas(resultado) {
  return resultado?.ok ? resultado.resultado?.rows || [] : [];
}

function linhaUnica(resultado, fallback = {}) {
  return resultado?.ok ? resultado.resultado?.rows?.[0] || fallback : fallback;
}

async function consultarResumoRadar(janelaMinutos = 15) {
  const janela = inteiroLimitado(janelaMinutos, 15, 1, 120);
  const resultado = await queryEngine(
    `SELECT COUNT(*)::int AS eventos_recentes,
            MAX(capturado_em) AS ultima_captura_em
       FROM engine_eventos_brutos
      WHERE capturado_em >= NOW() - ($1::int * INTERVAL '1 minute')`,
    [janela]
  );

  if (!resultado.ok) {
    return {
      fonte: "engine_eventos_brutos",
      disponivel: false,
      motivo: resultado.motivo || "consulta_radar_indisponivel"
    };
  }

  const linha = linhaUnica(resultado, {});
  return {
    fonte: "engine_eventos_brutos",
    disponivel: true,
    recebendo: Boolean(linha.ultima_captura_em),
    ultimaCapturaEm: linha.ultima_captura_em || null,
    eventosRecentes: numero(linha.eventos_recentes)
  };
}

async function consultarResumoRadarWorkspace(clienteId = "", janelaMinutos = 15) {
  const cliente = texto(clienteId);
  if (!cliente) {
    return {
      fonte: "engine_eventos_brutos+engine_jobs_cliente",
      disponivel: false,
      motivo: "workspace_sem_clienteId"
    };
  }

  const janela = inteiroLimitado(janelaMinutos, 15, 1, 120);
  const resultado = await queryEngine(
    `SELECT COUNT(DISTINCT e.id)::int AS eventos_recentes,
            MAX(e.capturado_em) AS ultima_captura_em
       FROM engine_eventos_brutos e
       JOIN engine_jobs_cliente j ON j.evento_id = e.id
      WHERE j.cliente_id = $1
        AND e.capturado_em >= NOW() - ($2::int * INTERVAL '1 minute')`,
    [cliente, janela]
  );

  if (!resultado.ok) {
    return {
      fonte: "engine_eventos_brutos+engine_jobs_cliente",
      disponivel: false,
      motivo: resultado.motivo || "consulta_radar_workspace_indisponivel"
    };
  }

  const linha = linhaUnica(resultado, {});
  return {
    fonte: "engine_eventos_brutos+engine_jobs_cliente",
    disponivel: true,
    escopo: "workspace",
    recebendo: Boolean(linha.ultima_captura_em),
    ultimaCapturaEm: linha.ultima_captura_em || null,
    eventosRecentes: numero(linha.eventos_recentes)
  };
}

async function consultarPipelineFrescoTelemetria({ clienteId = "", janelaMinutos = 15 } = {}) {
  const janela = inteiroLimitado(janelaMinutos, 15, 1, 120);
  const cliente = texto(clienteId) || null;
  const semantica = semanticaJobsVivosTelemetria();
  const resultado = await queryEngine(
    `/* telemetria_jobs_frescos */
     WITH base_jobs_telemetria AS (
       SELECT id,
              cliente_id,
              status,
              criado_em,
              COALESCE(atualizado_em, criado_em) AS referencia_em,
              (
                LOWER(COALESCE(metadata->>'tipoFluxo', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(metadata->>'tipoOperacional', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(metadata->'flow'->>'tipoFluxo', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(metadata->'metadataEvento'->>'tipoFluxo', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(metadata->>'cupomTurbo', '')) IN ('true', '1', 'sim')
                OR LOWER(COALESCE(metadata->>'turbo', '')) IN ('true', '1', 'sim')
              ) AS cupom_turbo
         FROM engine_jobs_cliente
        WHERE ($7::text IS NULL OR cliente_id = $7::text)
     )
     SELECT COUNT(*) FILTER (
              WHERE status = ANY($1::text[])
                AND referencia_em >= NOW() - ((CASE WHEN cupom_turbo THEN $4::int ELSE $3::int END) * INTERVAL '1 minute')
            )::int AS circulaveis_frescos,
            COUNT(*) FILTER (
              WHERE status = ANY($2::text[])
                AND referencia_em >= NOW() - ($5::int * INTERVAL '1 minute')
            )::int AS em_curso_lease_valido,
            COUNT(*) FILTER (
              WHERE status = 'processando'
                AND referencia_em >= NOW() - ($5::int * INTERVAL '1 minute')
            )::int AS processando_lease_valido,
            COUNT(*) FILTER (
              WHERE status = 'importando'
                AND referencia_em >= NOW() - ($5::int * INTERVAL '1 minute')
            )::int AS importando_lease_valido,
            COUNT(*) FILTER (WHERE status = ANY($1::text[]))::int AS backlog_circulavel,
            COUNT(*) FILTER (WHERE status = ANY($2::text[]))::int AS em_curso_total,
            COUNT(*) FILTER (
              WHERE status = ANY($1::text[])
                AND referencia_em < NOW() - ((CASE WHEN cupom_turbo THEN $4::int ELSE $3::int END) * INTERVAL '1 minute')
            )::int AS circulaveis_velhos,
            COUNT(*) FILTER (
              WHERE status = ANY($2::text[])
                AND referencia_em < NOW() - ($5::int * INTERVAL '1 minute')
            )::int AS em_curso_lease_expirado,
            COUNT(*) FILTER (WHERE criado_em >= NOW() - ($6::int * INTERVAL '1 minute'))::int AS criados_janela
       FROM base_jobs_telemetria`,
    [
      semantica.statusCirculaveis,
      semantica.statusEmCurso,
      semantica.ttlNormalMinutos,
      semantica.ttlTurboMinutos,
      semantica.leaseMinutos,
      janela,
      cliente
    ]
  );

  if (!resultado.ok) {
    return {
      indisponivel: true,
      motivo: resultado.motivo || "pipeline_workspace_indisponivel"
    };
  }

  const linha = linhaUnica(resultado, {});
  const circulaveisFrescos = numero(linha.circulaveis_frescos);
  const emCursoLeaseValido = numero(linha.em_curso_lease_valido);
  const backlogCirculavel = numero(linha.backlog_circulavel);
  const emCursoTotal = numero(linha.em_curso_total);
  const latencias = await consultarLatenciasFrescasTelemetria({ clienteId: cliente, janelaMinutos: janela, semantica });

  return {
    jobsVivos: circulaveisFrescos + emCursoLeaseValido,
    jobsVivosFrescos: circulaveisFrescos + emCursoLeaseValido,
    backlogOperacional: backlogCirculavel + emCursoTotal,
    circulaveis: circulaveisFrescos,
    circulaveisFrescos,
    circulaveisVelhos: numero(linha.circulaveis_velhos),
    processando: numero(linha.processando_lease_valido),
    importando: numero(linha.importando_lease_valido),
    emCursoProtegidos: emCursoLeaseValido,
    emCursoTotal,
    emCursoLeaseExpirado: numero(linha.em_curso_lease_expirado),
    criadosNaJanela: numero(linha.criados_janela),
    latencias,
    semantica
  };
}

async function consultarLatenciasFrescasTelemetria({ clienteId = "", janelaMinutos = 15, semantica = null } = {}) {
  const janela = inteiroLimitado(janelaMinutos, 15, 1, 120);
  const cliente = texto(clienteId) || null;
  const regras = semantica || semanticaJobsVivosTelemetria();
  const resultado = await queryEngine(
    `/* telemetria_latencias_frescas */
     WITH primeira_tentativa AS (
       SELECT job_id,
              MIN(criado_em) AS primeira_tentativa_em
         FROM engine_processamentos
        WHERE criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
          AND job_id IS NOT NULL
        GROUP BY job_id
     ),
     base_latencias AS (
       SELECT j.id,
              j.cliente_id,
              j.criado_em,
              p.primeira_tentativa_em,
              EXTRACT(EPOCH FROM (p.primeira_tentativa_em - j.criado_em)) * 1000 AS latencia_ms,
              (
                LOWER(COALESCE(j.metadata->>'tipoFluxo', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(j.metadata->>'tipoOperacional', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(j.metadata->'flow'->>'tipoFluxo', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(j.metadata->'metadataEvento'->>'tipoFluxo', '')) = 'cupom_turbo'
                OR LOWER(COALESCE(j.metadata->>'cupomTurbo', '')) IN ('true', '1', 'sim')
                OR LOWER(COALESCE(j.metadata->>'turbo', '')) IN ('true', '1', 'sim')
              ) AS cupom_turbo
         FROM primeira_tentativa p
         JOIN engine_jobs_cliente j ON j.id = p.job_id
        WHERE ($2::text IS NULL OR j.cliente_id = $2::text)
          AND p.primeira_tentativa_em >= j.criado_em
     ),
     classificadas AS (
       SELECT *,
              criado_em >= NOW() - ((CASE WHEN cupom_turbo THEN $4::int ELSE $3::int END) * INTERVAL '1 minute') AS fresco
         FROM base_latencias
     )
     SELECT (SELECT COUNT(*)::int FROM classificadas) AS total_candidatos,
            (SELECT COUNT(*)::int FROM classificadas WHERE fresco) AS total_frescos,
            (SELECT COUNT(*)::int FROM classificadas WHERE NOT fresco) AS total_contaminados,
            (SELECT AVG(latencia_ms)::bigint FROM classificadas WHERE fresco) AS primeira_tentativa_media_ms,
            (SELECT (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latencia_ms))::bigint FROM classificadas WHERE fresco) AS primeira_tentativa_mediana_ms,
            (SELECT (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latencia_ms))::bigint FROM classificadas WHERE fresco) AS primeira_tentativa_p95_ms`,
    [janela, cliente, regras.ttlNormalMinutos, regras.ttlTurboMinutos]
  );

  if (!resultado.ok) {
    return {
      indisponivel: true,
      motivo: resultado.motivo || "latencia_fresca_indisponivel"
    };
  }

  const linha = linhaUnica(resultado, {});
  const totalFrescos = numero(linha.total_frescos);
  const totalContaminados = numero(linha.total_contaminados);
  if (totalFrescos <= 0) {
    return {
      indisponivel: true,
      motivo: "sem_populacao_fresca_confiavel",
      amostras: 0
    };
  }
  if (totalContaminados > 0) {
    return {
      indisponivel: true,
      motivo: "populacao_contaminada_por_backlog",
      amostrasFrescas: totalFrescos,
      amostrasContaminadas: totalContaminados
    };
  }

  return {
    janelaOperacional: "fresca",
    amostras: totalFrescos,
    primeiraTentativaMediaMs: numero(linha.primeira_tentativa_media_ms, null),
    primeiraTentativaMedianaMs: numero(linha.primeira_tentativa_mediana_ms, null),
    primeiraTentativaP95Ms: numero(linha.primeira_tentativa_p95_ms, null)
  };
}

async function consultarMarketplacesTelemetria({ clienteId = "", janelaMinutos = 15 } = {}) {
  const janela = inteiroLimitado(janelaMinutos, 15, 1, 120);
  const cliente = texto(clienteId) || null;
  const resultado = await queryEngine(
    `/* telemetria_marketplaces */
     SELECT COALESCE(NULLIF(TRIM(marketplace), ''), 'indefinido') AS marketplace,
            COUNT(*)::int AS eventos,
            COUNT(*) FILTER (
              WHERE tipo_evento IN ('oferta_universal_criada', 'oferta_criada', 'importer_oferta_universal')
            )::int AS ofertas,
            COUNT(*) FILTER (
              WHERE tipo_evento IN ('executor_enviado', 'enviado', 'fila_executor_enviado')
            )::int AS envios,
            COUNT(*) FILTER (
              WHERE tipo_evento ILIKE '%bloque%'
                 OR tipo_evento ILIKE '%erro%'
                 OR tipo_evento ILIKE '%retid%'
                 OR tipo_evento ILIKE '%rejeit%'
                 OR tipo_evento ILIKE '%nao_aceita%'
                 OR metadata::text ILIKE '%bloque%'
                 OR metadata::text ILIKE '%erro%'
            )::int AS bloqueios
       FROM engine_eventos_comerciais
      WHERE ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
        AND ($2::text IS NULL OR cliente_id = $2::text)
      GROUP BY COALESCE(NULLIF(TRIM(marketplace), ''), 'indefinido')
      ORDER BY eventos DESC, marketplace ASC
      LIMIT 40`,
    [janela, cliente]
  );

  if (!resultado.ok) {
    return {
      indisponivel: true,
      motivo: resultado.motivo || "marketplaces_indisponiveis"
    };
  }

  return linhas(resultado).map(item => ({
    marketplace: item.marketplace,
    eventos: numero(item.eventos),
    ofertas: numero(item.ofertas),
    envios: numero(item.envios),
    bloqueios: numero(item.bloqueios)
  }));
}

async function consultarSaudeTelemetria(opcoes = {}) {
  const janelaMinutos = inteiroLimitado(opcoes.janelaMinutos, 15, 1, 120);
  const escopo = opcoes.escopo || { tipo: "plataforma" };
  const clienteEscopo = escopo.tipo === "workspace" ? texto(escopo.clienteId) : "";
  const [radar, gate, pipelineFresco, marketplaces] = await Promise.all([
    escopo.tipo === "workspace"
      ? consultarResumoRadarWorkspace(escopo.clienteId, janelaMinutos)
      : consultarResumoRadar(janelaMinutos),
    criarGateAbsorcaoShadowOfc({ janelaMinutos }),
    consultarPipelineFrescoTelemetria({ clienteId: clienteEscopo, janelaMinutos }),
    consultarMarketplacesTelemetria({ clienteId: clienteEscopo, janelaMinutos })
  ]);

  const workspacesBrutos = Array.isArray(gate?.workspaces) ? gate.workspaces : [];
  const workspacesFiltrados = escopo.tipo === "workspace"
    ? workspacesBrutos.filter(item => String(item.workspaceId || "") === String(escopo.clienteId || ""))
    : workspacesBrutos;
  const pipeline = pipelineFresco || {
    indisponivel: true,
    motivo: "pipeline_fresco_indisponivel"
  };

  return {
    ok: true,
    readOnly: true,
    geradoEm: agoraIso(),
    janelaMinutos,
    escopo,
    radar,
    pipeline,
    workspaces: workspacesFiltrados.map(item => ({
      clienteId: item.workspaceId,
      estado: item.estado,
      motivo: item.motivo,
      filaAlvo: item.filaAlvo15Min ?? item.filaAlvo ?? null,
      pressaoViva: item.pressaoEsteiraViva,
      capacidade: item.capacidadeAbsorcaoAgora,
      enviados: item.enviosUltimos15Min,
      bloqueios: {
        statusDesconhecido: item.statusDesconhecido,
        itensSemTimestamp: item.itensSemTimestamp,
        vencidosOperacionalmente: item.vencidosOperacionalmente,
        aguardandoAuditoria: item.aguardandoAuditoria,
        motivosForaPressaoViva: sanitizarValor(item.motivosForaPressaoViva || {})
      },
      marketplaces: sanitizarValor(item.porMarketplace || {})
    })),
    marketplaces: Array.isArray(marketplaces) ? marketplaces : [],
    autoClean: {
      fonte: "logs/select_operacional",
      disponivel: false,
      motivo: "resumo_por_ciclo_indisponivel",
      mensagem: "Resumo por ciclo indisponível na V1"
    },
    fontes: {
      radar: "engine_eventos_brutos",
      jobs: "engine_jobs_cliente",
      importer: "engine_processamentos",
      workspaces: "usuarios.json + fila.json",
      eventosComerciais: "engine_eventos_comerciais",
      autoClean: "logs/select_operacional"
    }
  };
}

function cursorParaData(cursor = "") {
  const textoCursor = texto(cursor);
  if (!textoCursor) return null;
  try {
    const data = new Date(Buffer.from(textoCursor, "base64url").toString("utf8"));
    const ms = data.getTime();
    return Number.isFinite(ms) ? data.toISOString() : null;
  } catch {
    return null;
  }
}

function dataParaCursor(data = "") {
  const textoData = texto(data);
  if (!textoData) return null;
  return Buffer.from(textoData, "utf8").toString("base64url");
}

function adicionarFiltro(params, filtros, sql, valor) {
  const v = texto(valor);
  if (!v) return;
  params.push(v);
  filtros.push(sql.replace("?", `$${params.length}`));
}

async function consultarEventosTelemetria(opcoes = {}) {
  const janelaMinutos = inteiroLimitado(opcoes.janelaMinutos, 60, 1, 1440);
  const limit = inteiroLimitado(opcoes.limit, LIMITE_PADRAO_EVENTOS, 1, LIMITE_MAXIMO_EVENTOS);
  const escopo = opcoes.escopo || { tipo: "plataforma" };
  const filtrosEntrada = aplicarEscopoCliente(opcoes, escopo);
  const params = [janelaMinutos];
  const filtros = ["timestamp >= NOW() - ($1::int * INTERVAL '1 minute')"];

  const cursorTimestamp = cursorParaData(opcoes.cursor);
  if (cursorTimestamp) {
    params.push(cursorTimestamp);
    filtros.push(`timestamp < $${params.length}::timestamptz`);
  }

  adicionarFiltro(params, filtros, "cliente_id = ?", filtrosEntrada.clienteId);
  adicionarFiltro(params, filtros, "marketplace = ?", filtrosEntrada.marketplace);
  adicionarFiltro(params, filtros, "etapa = ?", normalizarEtapa(filtrosEntrada.etapa));
  adicionarFiltro(params, filtros, "status = ?", normalizarStatus(filtrosEntrada.status));

  params.push(limit + 1);
  const resultado = await queryEngine(
    `WITH eventos AS (
       SELECT e.id::text AS evento_id,
              NULL::text AS job_id,
              NULL::text AS oferta_id,
              NULL::text AS cliente_id,
              COALESCE(NULLIF(TRIM(e.marketplace_detectado), ''), 'desconhecido') AS marketplace,
              'radar' AS etapa,
              'capturado' AS status,
              NULL::text AS motivo,
              e.capturado_em AS timestamp
         FROM engine_eventos_brutos e
        WHERE e.capturado_em >= NOW() - ($1::int * INTERVAL '1 minute')
       UNION ALL
       SELECT j.evento_id::text AS evento_id,
              j.id::text AS job_id,
              j.oferta_id::text AS oferta_id,
              j.cliente_id,
              COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), 'desconhecido') AS marketplace,
              'job' AS etapa,
              LOWER(COALESCE(j.status, '')) AS status,
              j.motivo_final AS motivo,
              COALESCE(j.atualizado_em, j.criado_em) AS timestamp
         FROM engine_jobs_cliente j
        WHERE j.criado_em >= NOW() - ($1::int * INTERVAL '1 minute')
       UNION ALL
       SELECT o.evento_id::text AS evento_id,
              NULL::text AS job_id,
              o.id::text AS oferta_id,
              jof.cliente_id AS cliente_id,
              COALESCE(NULLIF(TRIM(o.marketplace), ''), 'desconhecido') AS marketplace,
              'oferta_universal' AS etapa,
              LOWER(COALESCE(o.status, '')) AS status,
              o.motivo_status AS motivo,
              COALESCE(o.atualizada_em, o.criada_em) AS timestamp
         FROM engine_ofertas o
         LEFT JOIN engine_jobs_cliente jof ON jof.oferta_id = o.id
        WHERE o.criada_em >= NOW() - ($1::int * INTERVAL '1 minute')
       UNION ALL
       SELECT COALESCE(j.evento_id::text, o.evento_id::text) AS evento_id,
              c.job_id::text AS job_id,
              c.oferta_id::text AS oferta_id,
              COALESCE(c.cliente_id, c.workspace_id) AS cliente_id,
              COALESCE(NULLIF(TRIM(c.marketplace), ''), 'desconhecido') AS marketplace,
              LOWER(COALESCE(c.tipo_evento, 'evento_comercial')) AS etapa,
              LOWER(COALESCE(c.metadata->>'status', c.tipo_evento, 'registrado')) AS status,
              COALESCE(c.metadata->>'motivo', c.metadata->>'erroTipo') AS motivo,
              c.ocorrido_em AS timestamp
         FROM engine_eventos_comerciais c
         LEFT JOIN engine_jobs_cliente j ON j.id = c.job_id
         LEFT JOIN engine_ofertas o ON o.id = c.oferta_id
        WHERE c.ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')
     )
     SELECT evento_id AS "eventoId",
            job_id AS "jobId",
            oferta_id AS "ofertaId",
            cliente_id AS "clienteId",
            marketplace,
            etapa,
            status,
            motivo,
            timestamp
       FROM eventos
      WHERE ${filtros.join(" AND ")}
      ORDER BY timestamp DESC NULLS LAST, evento_id DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );

  if (!resultado.ok) {
    return {
      ok: false,
      motivo: resultado.motivo || "telemetria_eventos_indisponivel",
      erro: "telemetria_indisponivel",
      items: [],
      cursorProximo: null
    };
  }

  const rows = linhas(resultado);
  const temMais = rows.length > limit;
  const items = rows.slice(0, limit).map(item => ({
    eventoId: item.eventoId,
    jobId: item.jobId,
    ofertaId: item.ofertaId,
    clienteId: item.clienteId,
    marketplace: item.marketplace,
    etapa: item.etapa,
    status: item.status,
    motivo: item.motivo,
    timestamp: item.timestamp
  }));

  return {
    ok: true,
    janelaMinutos,
    limit,
    items,
    cursorProximo: temMais ? dataParaCursor(items[items.length - 1]?.timestamp) : null
  };
}

async function consultarRastreioTelemetria(eventoId = "", opcoes = {}) {
  const id = texto(eventoId);
  const escopo = opcoes.escopo || { tipo: "plataforma" };
  if (!/^\d+$/.test(id)) return { ok: false, erro: "eventoId_invalido" };

  const [evento, links, jobs, ofertas, processamentos, comerciais] = await Promise.all([
    queryEngine(
      `SELECT id, origem, origem_tipo, grupo_id, grupo_nome, marketplace_detectado,
              links_extraidos, capturado_em, criado_em, metadata
         FROM engine_eventos_brutos
        WHERE id = $1`,
      [id]
    ),
    queryEngine(
      `SELECT id, evento_id, url_original, url_expandida, dominio_original,
              dominio_final, marketplace_detectado, redirect_ok, motivo_redirect,
              metadata, criado_em
         FROM engine_links
        WHERE evento_id = $1
        ORDER BY id ASC
        LIMIT 100`,
      [id]
    ),
    queryEngine(
      `SELECT id, evento_id, oferta_id, cliente_id, marketplace, marketplace_detectado,
              status, motivo_final, tentativas, criado_em, atualizado_em, metadata
         FROM engine_jobs_cliente
        WHERE evento_id = $1
        ORDER BY criado_em ASC, id ASC
        LIMIT 200`,
      [id]
    ),
    queryEngine(
      `SELECT id, evento_id, link_id, marketplace, status, motivo_status,
              categoria, score, criada_em, atualizada_em, metadata
         FROM engine_ofertas
        WHERE evento_id = $1
        ORDER BY criada_em ASC, id ASC
        LIMIT 100`,
      [id]
    ),
    queryEngine(
      `SELECT p.id, p.job_id, p.etapa, p.status, p.motivo, p.detalhes, p.criado_em
         FROM engine_processamentos p
         JOIN engine_jobs_cliente j ON j.id = p.job_id
        WHERE j.evento_id = $1
        ORDER BY p.criado_em ASC, p.id ASC
        LIMIT 200`,
      [id]
    ),
    queryEngine(
      `SELECT c.tipo_evento, c.cliente_id, c.workspace_id, c.oferta_id, c.job_id,
              c.fila_item_id, c.destino_id, c.canal, c.marketplace, c.ocorrido_em,
              c.origem_pipeline, c.metadata
         FROM engine_eventos_comerciais c
         LEFT JOIN engine_jobs_cliente j ON j.id = c.job_id
         LEFT JOIN engine_ofertas o ON o.id = c.oferta_id
        WHERE j.evento_id = $1 OR o.evento_id = $1
        ORDER BY c.ocorrido_em ASC, c.id ASC
        LIMIT 200`,
      [id]
    )
  ]);

  if (!evento.ok) {
    return { ok: false, motivo: evento.motivo || "rastreio_indisponivel", erro: "telemetria_indisponivel" };
  }

  const eventoRow = evento.resultado?.rows?.[0] || null;
  if (!eventoRow) {
    return {
      ok: true,
      eventoId: id,
      statusTelemetria: "expirado_operacionalmente",
      motivo: "evento_bruto_indisponivel_ou_removido"
    };
  }

  const jobsRows = linhas(jobs).filter(job =>
    escopo.tipo !== "workspace" || String(job.cliente_id || "") === String(escopo.clienteId || "")
  );
  if (escopo.tipo === "workspace" && jobsRows.length === 0) {
    return {
      ok: true,
      eventoId: id,
      statusTelemetria: "fora_do_escopo",
      motivo: "evento_sem_job_para_workspace_autorizado"
    };
  }
  const jobIdsPermitidos = new Set(jobsRows.map(job => String(job.id)));
  const ofertaIdsPermitidos = new Set(jobsRows.map(job => String(job.oferta_id || "")).filter(Boolean));
  const ofertasRows = linhas(ofertas).filter(oferta =>
    escopo.tipo !== "workspace" || ofertaIdsPermitidos.has(String(oferta.id))
  );
  for (const oferta of ofertasRows) ofertaIdsPermitidos.add(String(oferta.id));

  return {
    ok: true,
    readOnly: true,
    eventoId: id,
    statusTelemetria: "disponivel",
    origem: {
      origem: eventoRow.origem,
      origemTipo: eventoRow.origem_tipo,
      grupoId: eventoRow.grupo_id,
      grupoNome: eventoRow.grupo_nome,
      marketplace: eventoRow.marketplace_detectado,
      capturadoEm: eventoRow.capturado_em,
      criadoEm: eventoRow.criado_em
    },
    radar: {
      linksCapturados: sanitizarLinks(eventoRow.links_extraidos),
      metadata: sanitizarValor(eventoRow.metadata || {})
    },
    links: linhas(links).map(link => ({
      linkId: link.id,
      eventoId: link.evento_id,
      original: sanitizarUrl(link.url_original),
      expandida: sanitizarUrl(link.url_expandida),
      dominioOriginal: link.dominio_original,
      dominioFinal: link.dominio_final,
      marketplace: link.marketplace_detectado,
      redirectOk: link.redirect_ok,
      motivoRedirect: link.motivo_redirect,
      metadata: sanitizarValor(link.metadata || {}),
      criadoEm: link.criado_em
    })),
    jobs: jobsRows.map(job => ({
      jobId: job.id,
      ofertaId: job.oferta_id,
      clienteId: job.cliente_id,
      marketplace: job.marketplace || job.marketplace_detectado,
      status: job.status,
      motivo: job.motivo_final,
      tentativas: job.tentativas,
      criadoEm: job.criado_em,
      atualizadoEm: job.atualizado_em,
      metadata: sanitizarValor(job.metadata || {})
    })),
    importer: linhas(processamentos)
      .filter(proc => escopo.tipo !== "workspace" || jobIdsPermitidos.has(String(proc.job_id)))
      .map(proc => ({
        processamentoId: proc.id,
        jobId: proc.job_id,
        etapa: proc.etapa,
        status: proc.status,
        motivo: proc.motivo,
        detalhes: sanitizarValor(proc.detalhes || {}),
        criadoEm: proc.criado_em
      })),
    ofertaUniversal: ofertasRows.map(oferta => ({
      ofertaId: oferta.id,
      linkId: oferta.link_id,
      marketplace: oferta.marketplace,
      status: oferta.status,
      motivo: oferta.motivo_status,
      categoria: oferta.categoria,
      score: oferta.score,
      criadaEm: oferta.criada_em,
      atualizadaEm: oferta.atualizada_em,
      metadata: sanitizarValor(oferta.metadata || {})
    })),
    eventosComerciais: linhas(comerciais)
      .filter(item => {
        if (escopo.tipo !== "workspace") return true;
        const cliente = String(item.cliente_id || item.workspace_id || "");
        return cliente === String(escopo.clienteId || "") ||
          jobIdsPermitidos.has(String(item.job_id || "")) ||
          ofertaIdsPermitidos.has(String(item.oferta_id || ""));
      })
      .map(item => ({
        etapa: item.tipo_evento,
        clienteId: item.cliente_id || item.workspace_id,
        ofertaId: item.oferta_id,
        jobId: item.job_id,
        filaItemId: item.fila_item_id,
        destinoId: item.destino_id,
        canal: item.canal,
        marketplace: item.marketplace,
        timestamp: item.ocorrido_em,
        origemPipeline: item.origem_pipeline,
        metadata: sanitizarValor(item.metadata || {})
      }))
  };
}

module.exports = {
  TTL_VALIDOS,
  AUDITORIAS_ARQUIVO,
  criarAuditoriaTemporaria,
  revogarAuditoriaTemporaria,
  listarAuditoriasSanitizadas,
  autenticarTokenAuditoria,
  escopoDaRequisicao,
  consultarSaudeTelemetria,
  consultarEventosTelemetria,
  consultarRastreioTelemetria,
  sanitizarValor,
  sanitizarLinks,
  sanitizarDestinoFuncional,
  hashSegredo,
  extrairTokenAuditoria,
  rotaPermitidaTokenAuditoria
};
