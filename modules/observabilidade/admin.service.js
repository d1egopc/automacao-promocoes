"use strict";

const crypto = require("crypto");
const { queryEngine } = require("../engine/database");
const { consultarRastreioTelemetria } = require("../telemetria/telemetria.service");

const JANELAS_PERMITIDAS = Object.freeze([15, 30, 60, 180, 360]);
const LIMITE_WORKSPACES_PADRAO = 25;
const LIMITE_WORKSPACES_MAX = 100;
const LIMITE_EVENTOS_PADRAO = 50;
const LIMITE_EVENTOS_MAX = 100;
const LIMITE_PROBLEMAS_PADRAO = 50;
const LIMITE_PROBLEMAS_MAX = 100;
const CHAVES_SENSIVEIS = /senha|password|hash|cookie|cookies|token|secret|segredo|authorization|credencial|credential|clientSecret|access|refresh|jwt|headers|html|payload|imagem|image|base64|jid|telefone|phone/i;

function agoraIso() {
  return new Date().toISOString();
}

function texto(valor = "", limite = 180) {
  return String(valor ?? "").trim().slice(0, limite);
}

function textoLower(valor = "", limite = 180) {
  return texto(valor, limite).toLowerCase();
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

function janelaPermitida(valor) {
  const n = Math.floor(Number(valor));
  return JANELAS_PERMITIDAS.includes(n) ? n : 60;
}

function limiteWorkspaces(valor) {
  return inteiroLimitado(valor, LIMITE_WORKSPACES_PADRAO, 1, LIMITE_WORKSPACES_MAX);
}

function limiteEventos(valor) {
  return inteiroLimitado(valor, LIMITE_EVENTOS_PADRAO, 1, LIMITE_EVENTOS_MAX);
}

function limiteProblemas(valor) {
  return inteiroLimitado(valor, LIMITE_PROBLEMAS_PADRAO, 1, LIMITE_PROBLEMAS_MAX);
}

function cursorParaData(cursor = "") {
  const valor = texto(cursor, 300);
  if (!valor) return null;
  try {
    const data = new Date(Buffer.from(valor, "base64url").toString("utf8"));
    return Number.isFinite(data.getTime()) ? data.toISOString() : null;
  } catch {
    return null;
  }
}

function dataParaCursor(data = "") {
  const valor = texto(data, 120);
  if (!valor) return null;
  return Buffer.from(valor, "utf8").toString("base64url");
}

function linhas(resultado = {}) {
  return Array.isArray(resultado?.resultado?.rows) ? resultado.resultado.rows : [];
}

function normalizarStatusAtivo(valor = "") {
  const v = textoLower(valor, 40);
  if (["ativo", "true", "1", "sim"].includes(v)) return true;
  if (["inativo", "false", "0", "nao"].includes(v)) return false;
  return null;
}

function normalizarUsuarioWorkspace(usuario = {}, configsPorCliente = {}) {
  const clienteId = texto(usuario.id || usuario.clienteId || usuario.workspaceId || "", 120);
  const config = clienteId ? (configsPorCliente?.[clienteId] || {}) : {};
  return {
    clienteId,
    nome: texto(usuario.nome || usuario.name || usuario.razaoSocial || "", 120),
    email: texto(usuario.email || "", 160),
    workspaceNome: texto(
      usuario.workspaceNome ||
      usuario.workspace ||
      usuario.nomeWorkspace ||
      usuario.empresa ||
      usuario.nomeComercial ||
      config.workspaceNome ||
      config.nomeWorkspace ||
      config.nomeComercial ||
      "",
      120
    ),
    plano: texto(usuario.plano || usuario.plan || config.plano || "", 80),
    ativo: usuario.ativo !== false,
    saldoCreditos: numero(usuario.creditos ?? usuario.saldoCreditos ?? usuario.saldo ?? 0)
  };
}

function usuarioCombinaBusca(workspace = {}, busca = "") {
  const termo = textoLower(busca, 160);
  if (!termo) return true;
  return [
    workspace.clienteId,
    workspace.nome,
    workspace.email,
    workspace.workspaceNome,
    workspace.plano
  ].some(valor => textoLower(valor, 180).includes(termo));
}

function classificarSaudeOperacional(sinaisEntrada = {}) {
  const sinais = [];
  const jobsErro = numero(sinaisEntrada.jobsErro);
  const retidos = numero(sinaisEntrada.retidos);
  const leaseExpirado = numero(sinaisEntrada.leaseExpirado);
  const rejeitados = numero(sinaisEntrada.destinosRejeitados);
  const selecionados = numero(sinaisEntrada.destinosSelecionados);
  const enviados = numero(sinaisEntrada.enviados);
  const eventos = numero(sinaisEntrada.eventosRecentes);
  const ultimaAtividadeEm = sinaisEntrada.ultimaAtividadeEm || null;

  if (jobsErro > 0) sinais.push({ codigo: "jobs_erro", quantidade: jobsErro });
  if (leaseExpirado > 0) sinais.push({ codigo: "lease_expirado", quantidade: leaseExpirado });
  if (retidos > 0) sinais.push({ codigo: "jobs_retidos", quantidade: retidos });
  if (rejeitados > 0) sinais.push({ codigo: "destinos_rejeitados", quantidade: rejeitados });
  if (selecionados > 0) sinais.push({ codigo: "destinos_selecionados", quantidade: selecionados });
  if (enviados > 0) sinais.push({ codigo: "envios_confirmados", quantidade: enviados });
  if (eventos > 0) sinais.push({ codigo: "atividade_recente", quantidade: eventos });

  if (!ultimaAtividadeEm && eventos <= 0) {
    return { status: "sem_dados", sinais: [{ codigo: "sem_atividade_na_janela", quantidade: 0 }] };
  }
  if (jobsErro > 0 || leaseExpirado > 0) return { status: "critico", sinais };
  if (retidos > 0 || (rejeitados > 0 && selecionados === 0 && enviados === 0)) return { status: "atencao", sinais };
  return { status: "saudavel", sinais };
}

function sanitizarIntegracao(marketplace = "", config = {}) {
  const origem = config && typeof config === "object" ? config : {};
  const saude = origem.saude || origem.health || {};
  return {
    marketplace: texto(marketplace, 60).toLowerCase(),
    configurada: Boolean(Object.keys(origem).length),
    saude: texto(saude.status || origem.saudeStatus || origem.statusSaude || origem.status || "", 60) || null,
    codigoSaude: texto(saude.codigo || origem.codigoSaude || origem.healthCode || origem.codigo || "", 80) || null,
    atualizadoEm: texto(saude.atualizadoEm || origem.saudeAtualizadaEm || origem.atualizadoEm || origem.updatedAt || "", 80) || null
  };
}

function sanitizarObjetoSeguro(valor = {}) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (CHAVES_SENSIVEIS.test(chave)) continue;
    if (item === null || item === undefined || item === "") continue;
    if (typeof item === "number" || typeof item === "boolean") {
      saida[chave] = item;
    } else if (Array.isArray(item)) {
      saida[chave] = item.slice(0, 10).map(v => texto(v, 80)).filter(Boolean);
    } else if (typeof item === "object") {
      saida[chave] = "[objeto_sanitizado]";
    } else {
      const textoValor = texto(item, 160);
      if (!CHAVES_SENSIVEIS.test(textoValor)) saida[chave] = textoValor;
    }
  }
  return saida;
}

function pareceJidOuTelefone(valor = "") {
  const v = texto(valor, 180);
  if (!v) return false;
  if (/@(g\.us|s\.whatsapp\.net|c\.us|lid)$/i.test(v)) return true;
  const digitos = v.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length >= Math.floor(v.length * 0.55);
}

function identificadorOperacionalSeguro(valor = "") {
  const v = texto(valor, 160);
  if (!v) return null;
  if (!pareceJidOuTelefone(v)) return v;
  const hash = crypto.createHash("sha256").update(v).digest("hex").slice(0, 16);
  return `hash_${hash}`;
}

async function consultarAtividadeWorkspaces(clienteIds = [], opcoes = {}) {
  const ids = [...new Set(clienteIds.map(id => texto(id, 120)).filter(Boolean))].slice(0, LIMITE_WORKSPACES_MAX);
  if (!ids.length) return new Map();
  const executarQuery = opcoes.query || queryEngine;
  const janela = janelaPermitida(opcoes.janelaMinutos);
  const resultado = await executarQuery(
    `/* observabilidade_v22_workspaces_atividade */
     WITH eventos AS (
       SELECT j.cliente_id,
              e.capturado_em AS timestamp,
              'radar'::text AS tipo,
              NULL::text AS status,
              NULL::text AS motivo
         FROM engine_eventos_brutos e
         JOIN engine_jobs_cliente j ON j.evento_id = e.id
        WHERE j.cliente_id = ANY($1::text[])
          AND e.capturado_em >= NOW() - ($2::int * INTERVAL '1 minute')
       UNION ALL
       SELECT j.cliente_id,
              COALESCE(j.atualizado_em, j.criado_em) AS timestamp,
              'job'::text AS tipo,
              LOWER(COALESCE(j.status, '')) AS status,
              j.motivo_final AS motivo
         FROM engine_jobs_cliente j
        WHERE j.cliente_id = ANY($1::text[])
          AND COALESCE(j.atualizado_em, j.criado_em) >= NOW() - ($2::int * INTERVAL '1 minute')
       UNION ALL
       SELECT COALESCE(c.cliente_id, c.workspace_id) AS cliente_id,
              c.ocorrido_em AS timestamp,
              c.tipo_evento AS tipo,
              LOWER(COALESCE(c.metadata->>'status', c.tipo_evento, '')) AS status,
              COALESCE(c.metadata->>'motivoCodigo', c.metadata->>'motivo') AS motivo
         FROM engine_eventos_comerciais c
        WHERE COALESCE(c.cliente_id, c.workspace_id) = ANY($1::text[])
          AND c.ocorrido_em >= NOW() - ($2::int * INTERVAL '1 minute')
     )
     SELECT cliente_id,
            MAX(timestamp) AS ultima_atividade_em,
            COUNT(*)::int AS eventos_recentes,
            COUNT(*) FILTER (WHERE tipo = 'destino_rejeitado')::int AS destinos_rejeitados,
            COUNT(*) FILTER (WHERE tipo = 'destino_selecionado')::int AS destinos_selecionados,
            COUNT(*) FILTER (WHERE tipo = 'executor_enviado')::int AS enviados,
            COUNT(*) FILTER (WHERE status IN ('erro', 'error', 'falha'))::int AS jobs_erro,
            COUNT(*) FILTER (WHERE status IN ('retido', 'retida', 'bloqueado', 'bloqueada'))::int AS retidos
       FROM eventos
      GROUP BY cliente_id`,
    [ids, janela]
  );

  if (!resultado.ok) return new Map();
  return new Map(linhas(resultado).map(row => [String(row.cliente_id), row]));
}

async function buscarWorkspacesObservabilidade(opcoes = {}) {
  const usuarios = Array.isArray(opcoes.usuarios) ? opcoes.usuarios : [];
  const configsPorCliente = opcoes.configsPorCliente || {};
  const busca = texto(opcoes.busca, 160);
  const filtroAtivo = normalizarStatusAtivo(opcoes.status);
  const limit = limiteWorkspaces(opcoes.limit);
  const janelaMinutos = janelaPermitida(opcoes.janelaMinutos);

  const workspaces = usuarios
    .map(usuario => normalizarUsuarioWorkspace(usuario, configsPorCliente))
    .filter(item => item.clienteId)
    .filter(item => filtroAtivo === null || item.ativo === filtroAtivo)
    .filter(item => usuarioCombinaBusca(item, busca))
    .sort((a, b) => String(a.nome || a.clienteId).localeCompare(String(b.nome || b.clienteId)))
    .slice(0, limit);

  const atividade = await consultarAtividadeWorkspaces(workspaces.map(item => item.clienteId), {
    query: opcoes.query,
    janelaMinutos
  });

  return {
    ok: true,
    readOnly: true,
    geradoEm: agoraIso(),
    janelaMinutos,
    limit,
    workspaces: workspaces.map(item => {
      const sinais = atividade.get(String(item.clienteId)) || {};
      const saude = classificarSaudeOperacional({
        eventosRecentes: sinais.eventos_recentes,
        ultimaAtividadeEm: sinais.ultima_atividade_em,
        destinosRejeitados: sinais.destinos_rejeitados,
        destinosSelecionados: sinais.destinos_selecionados,
        enviados: sinais.enviados,
        jobsErro: sinais.jobs_erro,
        retidos: sinais.retidos
      });
      return {
        clienteId: item.clienteId,
        nome: item.nome || null,
        email: item.email || null,
        workspaceNome: item.workspaceNome || null,
        plano: item.plano || null,
        ativo: item.ativo,
        saldoCreditos: item.saldoCreditos,
        ultimaAtividadeEm: sinais.ultima_atividade_em || null,
        saudeOperacional: saude
      };
    })
  };
}

function resolverWorkspace(clienteId = "", opcoes = {}) {
  const id = texto(clienteId, 120);
  const usuarios = Array.isArray(opcoes.usuarios) ? opcoes.usuarios : [];
  const usuario = usuarios.find(item => String(item?.id || item?.clienteId || item?.workspaceId || "") === id);
  if (!usuario) return null;
  return normalizarUsuarioWorkspace(usuario, opcoes.configsPorCliente || {});
}

async function consultarPipelineWorkspace(clienteId = "", opcoes = {}) {
  const executarQuery = opcoes.query || queryEngine;
  const janela = janelaPermitida(opcoes.janelaMinutos);
  const resultado = await executarQuery(
    `/* observabilidade_v22_workspace_pipeline */
     WITH jobs AS (
       SELECT j.id, j.evento_id, j.status, j.motivo_final, j.criado_em,
              COALESCE(j.atualizado_em, j.criado_em) AS referencia_em
         FROM engine_jobs_cliente j
        WHERE j.cliente_id = $1
          AND COALESCE(j.atualizado_em, j.criado_em) >= NOW() - ($2::int * INTERVAL '1 minute')
     )
     SELECT (SELECT MAX(e.capturado_em)
               FROM engine_eventos_brutos e
               JOIN jobs j ON j.evento_id = e.id) AS ultima_captura_radar,
            (SELECT COUNT(DISTINCT evento_id)::int FROM jobs WHERE evento_id IS NOT NULL) AS eventos_recentes,
            COUNT(*) FILTER (WHERE status = 'pendente')::int AS jobs_pendentes,
            COUNT(*) FILTER (WHERE status = 'processando')::int AS processando,
            COUNT(*) FILTER (WHERE status = 'importando')::int AS importando,
            COUNT(*) FILTER (WHERE status IN ('erro', 'falha'))::int AS erro,
            COUNT(*) FILTER (WHERE status IN ('retido', 'retida', 'bloqueado', 'bloqueada'))::int AS retidos,
            COUNT(*) FILTER (
              WHERE status IN ('processando', 'importando')
                AND referencia_em < NOW() - (15 * INTERVAL '1 minute')
            )::int AS lease_expirado
       FROM jobs`,
    [clienteId, janela]
  );
  const row = resultado.ok ? (linhas(resultado)[0] || {}) : {};
  return {
    ultimaCapturaRadar: row.ultima_captura_radar || null,
    eventosRecentes: numero(row.eventos_recentes),
    jobsPendentes: numero(row.jobs_pendentes),
    processando: numero(row.processando),
    importando: numero(row.importando),
    erro: numero(row.erro),
    retidos: numero(row.retidos),
    leaseExpirado: numero(row.lease_expirado),
    disponivel: resultado.ok !== false,
    motivoIndisponivel: resultado.ok ? null : (resultado.motivo || "pipeline_indisponivel")
  };
}

async function consultarMarketplacesWorkspace(clienteId = "", opcoes = {}) {
  const executarQuery = opcoes.query || queryEngine;
  const janela = janelaPermitida(opcoes.janelaMinutos);
  const resultado = await executarQuery(
    `/* observabilidade_v22_workspace_marketplaces */
     WITH eventos AS (
       SELECT COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), 'desconhecido') AS marketplace,
              'capturado'::text AS etapa,
              COALESCE(j.atualizado_em, j.criado_em) AS timestamp
         FROM engine_jobs_cliente j
        WHERE j.cliente_id = $1
          AND COALESCE(j.atualizado_em, j.criado_em) >= NOW() - ($2::int * INTERVAL '1 minute')
       UNION ALL
       SELECT COALESCE(NULLIF(TRIM(o.marketplace), ''), 'desconhecido') AS marketplace,
              CASE WHEN LOWER(COALESCE(o.status, '')) IN ('aprovada', 'aprovado', 'ativo') THEN 'aprovado'
                   WHEN LOWER(COALESCE(o.status, '')) IN ('rejeitada', 'rejeitado', 'bloqueada', 'bloqueado') THEN 'rejeitado'
                   ELSE 'importado'
              END AS etapa,
              COALESCE(o.atualizada_em, o.criada_em) AS timestamp
         FROM engine_ofertas o
         JOIN engine_jobs_cliente j ON j.oferta_id = o.id
        WHERE j.cliente_id = $1
          AND COALESCE(o.atualizada_em, o.criada_em) >= NOW() - ($2::int * INTERVAL '1 minute')
       UNION ALL
       SELECT COALESCE(NULLIF(TRIM(c.marketplace), ''), 'desconhecido') AS marketplace,
              c.tipo_evento AS etapa,
              c.ocorrido_em AS timestamp
         FROM engine_eventos_comerciais c
        WHERE COALESCE(c.cliente_id, c.workspace_id) = $1
          AND c.ocorrido_em >= NOW() - ($2::int * INTERVAL '1 minute')
     )
     SELECT marketplace,
            COUNT(*) FILTER (WHERE etapa = 'capturado')::int AS capturados,
            COUNT(*) FILTER (WHERE etapa IN ('importado', 'oferta_universal_criada'))::int AS importados,
            COUNT(*) FILTER (WHERE etapa IN ('aprovado', 'destino_selecionado', 'fila_cliente_adicionada', 'distribuicao_final'))::int AS aprovados,
            COUNT(*) FILTER (WHERE etapa IN ('rejeitado', 'destino_rejeitado'))::int AS rejeitados,
            COUNT(*) FILTER (WHERE etapa = 'executor_enviado')::int AS enviados,
            MAX(timestamp) AS ultimo_evento
       FROM eventos
      GROUP BY marketplace
      ORDER BY ultimo_evento DESC NULLS LAST, marketplace ASC
      LIMIT 40`,
    [clienteId, janela]
  );
  if (!resultado.ok) return [];
  return linhas(resultado).map(row => ({
    marketplace: row.marketplace,
    capturados: numero(row.capturados),
    importados: numero(row.importados),
    aprovados: numero(row.aprovados),
    rejeitados: numero(row.rejeitados),
    enviados: numero(row.enviados),
    ultimoEvento: row.ultimo_evento || null,
    saudeOperacional: classificarSaudeOperacional({
      eventosRecentes: numero(row.capturados) + numero(row.importados) + numero(row.aprovados) + numero(row.rejeitados) + numero(row.enviados),
      ultimaAtividadeEm: row.ultimo_evento,
      destinosRejeitados: row.rejeitados,
      destinosSelecionados: row.aprovados,
      enviados: row.enviados
    })
  }));
}

async function consultarDestinosWorkspace(clienteId = "", opcoes = {}) {
  const executarQuery = opcoes.query || queryEngine;
  const janela = janelaPermitida(opcoes.janelaMinutos);
  const resultado = await executarQuery(
    `/* observabilidade_v22_workspace_destinos */
     SELECT COALESCE(NULLIF(TRIM(destino_id), ''), 'sem_destino') AS destino_id,
            COALESCE(NULLIF(TRIM(canal), ''), 'desconhecido') AS canal,
            COUNT(*) FILTER (WHERE tipo_evento = 'destino_candidato')::int AS candidatos,
            COUNT(*) FILTER (WHERE tipo_evento = 'destino_selecionado')::int AS selecionados,
            COUNT(*) FILTER (WHERE tipo_evento = 'destino_rejeitado')::int AS rejeitados,
            COUNT(*) FILTER (WHERE tipo_evento = 'executor_enviado')::int AS enviados,
            COALESCE(metadata->>'motivoCodigo', metadata->>'motivo', '') AS motivo_codigo,
            MAX(ocorrido_em) AS ultimo_evento
       FROM engine_eventos_comerciais
      WHERE COALESCE(cliente_id, workspace_id) = $1
        AND ocorrido_em >= NOW() - ($2::int * INTERVAL '1 minute')
        AND tipo_evento IN ('destino_candidato', 'destino_selecionado', 'destino_rejeitado', 'executor_enviado')
      GROUP BY destino_id, canal, motivo_codigo
      ORDER BY ultimo_evento DESC NULLS LAST
      LIMIT 100`,
    [clienteId, janela]
  );
  if (!resultado.ok) return { candidatos: 0, selecionados: 0, rejeitados: 0, enviados: 0, itens: [] };
  const rows = linhas(resultado);
  return {
    candidatos: rows.reduce((t, r) => t + numero(r.candidatos), 0),
    selecionados: rows.reduce((t, r) => t + numero(r.selecionados), 0),
    rejeitados: rows.reduce((t, r) => t + numero(r.rejeitados), 0),
    enviados: rows.reduce((t, r) => t + numero(r.enviados), 0),
    itens: rows.map(row => ({
      destinoId: identificadorOperacionalSeguro(row.destino_id),
      canal: row.canal,
      candidatos: numero(row.candidatos),
      selecionados: numero(row.selecionados),
      rejeitados: numero(row.rejeitados),
      enviados: numero(row.enviados),
      motivoCodigo: row.motivo_codigo || null,
      ultimoEvento: row.ultimo_evento || null
    }))
  };
}

async function consultarProblemasObservabilidade(opcoes = {}) {
  const executarQuery = opcoes.query || queryEngine;
  const janela = janelaPermitida(opcoes.janelaMinutos);
  const limit = limiteProblemas(opcoes.limit);
  const params = [janela];
  const filtros = ["ocorrido_em >= NOW() - ($1::int * INTERVAL '1 minute')"];

  function filtro(campo, valor) {
    const v = texto(valor, 120);
    if (!v) return;
    params.push(v);
    filtros.push(`${campo} = $${params.length}`);
  }

  filtro("COALESCE(cliente_id, workspace_id)", opcoes.clienteId);
  filtro("marketplace", opcoes.marketplace);
  filtro("COALESCE(metadata->>'motivoCodigo', metadata->>'motivo', tipo_evento)", opcoes.motivoCodigo);
  params.push(limit);

  const resultado = await executarQuery(
    `/* observabilidade_v22_problemas */
     SELECT COALESCE(NULLIF(TRIM(metadata->>'motivoCodigo'), ''), NULLIF(TRIM(metadata->>'motivo'), ''), tipo_evento, 'nao_determinado') AS motivo_codigo,
            COALESCE(NULLIF(TRIM(marketplace), ''), 'desconhecido') AS marketplace,
            COALESCE(cliente_id, workspace_id) AS cliente_id,
            COUNT(*)::int AS quantidade,
            MIN(ocorrido_em) AS primeiro_ocorrido_em,
            MAX(ocorrido_em) AS ultimo_ocorrido_em
       FROM engine_eventos_comerciais
      WHERE ${filtros.join(" AND ")}
        AND (
          tipo_evento IN ('destino_rejeitado', 'executor_erro_final')
          OR metadata ? 'motivoCodigo'
          OR metadata ? 'erroTipo'
        )
      GROUP BY motivo_codigo, marketplace, cliente_id
      ORDER BY quantidade DESC, ultimo_ocorrido_em DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );
  if (!resultado.ok) {
    return { ok: false, erro: "observabilidade_indisponivel", motivo: resultado.motivo || "problemas_indisponiveis", problemas: [] };
  }
  return {
    ok: true,
    readOnly: true,
    geradoEm: agoraIso(),
    janelaMinutos: janela,
    limit,
    problemas: linhas(resultado).map(row => ({
      motivoCodigo: row.motivo_codigo || "nao_determinado",
      marketplace: row.marketplace || "desconhecido",
      clienteId: row.cliente_id || null,
      quantidade: numero(row.quantidade),
      primeiroOcorridoEm: row.primeiro_ocorrido_em || null,
      ultimoOcorridoEm: row.ultimo_ocorrido_em || null,
      primeiroPontoConhecidoFalha: row.motivo_codigo || "nao_determinado"
    }))
  };
}

function listarIntegracoesSanitizadas(clienteId = "", integracoesPorCliente = {}) {
  const mapa = integracoesPorCliente?.[clienteId] || {};
  return Object.keys(mapa)
    .sort()
    .map(marketplace => sanitizarIntegracao(marketplace, mapa[marketplace]));
}

async function consultarResumoWorkspaceObservabilidade(clienteId = "", opcoes = {}) {
  const workspace = resolverWorkspace(clienteId, opcoes);
  if (!workspace) {
    return { ok: false, erro: "workspace_nao_encontrado" };
  }
  const janelaMinutos = janelaPermitida(opcoes.janelaMinutos);
  const [pipeline, marketplaces, destinos, problemas] = await Promise.all([
    consultarPipelineWorkspace(workspace.clienteId, { ...opcoes, janelaMinutos }),
    consultarMarketplacesWorkspace(workspace.clienteId, { ...opcoes, janelaMinutos }),
    consultarDestinosWorkspace(workspace.clienteId, { ...opcoes, janelaMinutos }),
    consultarProblemasObservabilidade({ ...opcoes, clienteId: workspace.clienteId, janelaMinutos, limit: 10 })
  ]);
  const saude = classificarSaudeOperacional({
    eventosRecentes: pipeline.eventosRecentes,
    ultimaAtividadeEm: pipeline.ultimaCapturaRadar,
    jobsErro: pipeline.erro,
    retidos: pipeline.retidos,
    leaseExpirado: pipeline.leaseExpirado,
    destinosRejeitados: destinos.rejeitados,
    destinosSelecionados: destinos.selecionados,
    enviados: destinos.enviados
  });

  return {
    ok: true,
    readOnly: true,
    geradoEm: agoraIso(),
    janelaMinutos,
    identidade: {
      clienteId: workspace.clienteId,
      nome: workspace.nome || null,
      email: workspace.email || null,
      workspaceNome: workspace.workspaceNome || null,
      plano: workspace.plano || null,
      ativo: workspace.ativo,
      saldoCreditos: workspace.saldoCreditos
    },
    saudeOperacional: saude,
    pipeline,
    marketplaces,
    destinos,
    problemas: problemas.ok ? problemas.problemas : [],
    integracoes: listarIntegracoesSanitizadas(workspace.clienteId, opcoes.integracoesPorCliente || {}),
    mensageiro: {
      disponivel: false,
      motivo: "mensageiro_fica_para_fase_seguinte"
    },
    fontes: {
      identidade: "usuarios.json + configs_clientes.json",
      pipeline: "engine_eventos_brutos + engine_jobs_cliente",
      marketplaces: "engine_jobs_cliente + engine_ofertas + engine_eventos_comerciais",
      destinos: "engine_eventos_comerciais",
      problemas: "engine_eventos_comerciais",
      integracoes: "integracoes.json sanitizado"
    }
  };
}

function adicionarFiltro(params, filtros, sql, valor) {
  const v = texto(valor, 120);
  if (!v) return;
  params.push(v);
  filtros.push(sql.replace("?", `$${params.length}`));
}

async function consultarEventosWorkspaceObservabilidade(clienteId = "", opcoes = {}) {
  const executarQuery = opcoes.query || queryEngine;
  const janela = janelaPermitida(opcoes.janelaMinutos);
  const limit = limiteEventos(opcoes.limit);
  const params = [clienteId, janela];
  const filtros = ["cliente_id = $1", "timestamp >= NOW() - ($2::int * INTERVAL '1 minute')"];
  const cursorTimestamp = cursorParaData(opcoes.cursor);
  if (cursorTimestamp) {
    params.push(cursorTimestamp);
    filtros.push(`timestamp < $${params.length}::timestamptz`);
  }
  adicionarFiltro(params, filtros, "marketplace = ?", opcoes.marketplace);
  adicionarFiltro(params, filtros, "tipo_evento = ?", opcoes.tipoEvento);
  adicionarFiltro(params, filtros, "motivo_codigo = ?", opcoes.motivoCodigo);
  adicionarFiltro(params, filtros, "evento_id = ?", opcoes.eventoId);
  adicionarFiltro(params, filtros, "job_id = ?", opcoes.jobId);
  adicionarFiltro(params, filtros, "oferta_id = ?", opcoes.ofertaId);
  adicionarFiltro(params, filtros, "destino_id = ?", opcoes.destinoId);
  params.push(limit + 1);

  const resultado = await executarQuery(
    `/* observabilidade_v22_workspace_eventos */
     WITH eventos AS (
       SELECT j.evento_id::text AS evento_id,
              j.id::text AS job_id,
              j.oferta_id::text AS oferta_id,
              j.cliente_id,
              COALESCE(NULLIF(TRIM(j.marketplace), ''), NULLIF(TRIM(j.marketplace_detectado), ''), 'desconhecido') AS marketplace,
              'job'::text AS tipo_evento,
              LOWER(COALESCE(j.status, '')) AS status,
              j.motivo_final AS motivo_codigo,
              NULL::text AS destino_id,
              COALESCE(j.atualizado_em, j.criado_em) AS timestamp,
              '{}'::jsonb AS metadata
         FROM engine_jobs_cliente j
        WHERE j.cliente_id = $1
       UNION ALL
       SELECT COALESCE(j.evento_id::text, o.evento_id::text) AS evento_id,
              c.job_id::text AS job_id,
              c.oferta_id::text AS oferta_id,
              COALESCE(c.cliente_id, c.workspace_id) AS cliente_id,
              COALESCE(NULLIF(TRIM(c.marketplace), ''), 'desconhecido') AS marketplace,
              c.tipo_evento,
              LOWER(COALESCE(c.metadata->>'status', c.tipo_evento, '')) AS status,
              COALESCE(c.metadata->>'motivoCodigo', c.metadata->>'motivo', c.metadata->>'erroTipo') AS motivo_codigo,
              c.destino_id,
              c.ocorrido_em AS timestamp,
              c.metadata
         FROM engine_eventos_comerciais c
         LEFT JOIN engine_jobs_cliente j ON j.id = c.job_id
         LEFT JOIN engine_ofertas o ON o.id = c.oferta_id
        WHERE COALESCE(c.cliente_id, c.workspace_id) = $1
     )
     SELECT evento_id AS "eventoId",
            job_id AS "jobId",
            oferta_id AS "ofertaId",
            cliente_id AS "clienteId",
            marketplace,
            tipo_evento AS "tipoEvento",
            status,
            motivo_codigo AS "motivoCodigo",
            destino_id AS "destinoId",
            timestamp,
            metadata
       FROM eventos
      WHERE ${filtros.join(" AND ")}
      ORDER BY timestamp DESC NULLS LAST, evento_id DESC NULLS LAST
      LIMIT $${params.length}`,
    params
  );

  if (!resultado.ok) {
    return { ok: false, erro: "observabilidade_indisponivel", motivo: resultado.motivo || "eventos_indisponiveis", items: [] };
  }
  const rows = linhas(resultado);
  const temMais = rows.length > limit;
  const items = rows.slice(0, limit).map(row => ({
    eventoId: row.eventoId,
    jobId: row.jobId,
    ofertaId: row.ofertaId,
    clienteId: row.clienteId,
    marketplace: row.marketplace,
    tipoEvento: row.tipoEvento,
    status: row.status,
    motivoCodigo: row.motivoCodigo || null,
    destinoId: identificadorOperacionalSeguro(row.destinoId),
    timestamp: row.timestamp,
    metadata: sanitizarObjetoSeguro(row.metadata || {})
  }));
  return {
    ok: true,
    readOnly: true,
    janelaMinutos: janela,
    limit,
    items,
    cursorProximo: temMais ? dataParaCursor(items[items.length - 1]?.timestamp) : null
  };
}

async function rastrearEventoObservabilidade(eventoId = "") {
  const resultado = await consultarRastreioTelemetria(eventoId, {
    escopo: { tipo: "plataforma", clienteId: null }
  });
  if (!resultado.ok) return resultado;
  const origem = resultado.origem && typeof resultado.origem === "object"
    ? {
        ...resultado.origem,
        grupoId: identificadorOperacionalSeguro(resultado.origem.grupoId),
        remoteJid: identificadorOperacionalSeguro(resultado.origem.remoteJid)
      }
    : resultado.origem;
  const eventosComerciais = Array.isArray(resultado.eventosComerciais) ? resultado.eventosComerciais : [];
  const decisoesDestino = eventosComerciais
    .filter(item => ["destino_candidato", "destino_selecionado", "destino_rejeitado", "executor_enviado"].includes(item.etapa))
    .map(item => ({
      tipoEvento: item.etapa,
      clienteId: item.clienteId,
      ofertaId: item.ofertaId,
      jobId: item.jobId,
      destinoId: identificadorOperacionalSeguro(item.destinoId),
      canal: item.canal,
      marketplace: item.marketplace,
      timestamp: item.timestamp,
      motivoCodigo: item.metadata?.motivoCodigo || item.metadata?.motivo || null,
      decisao: item.metadata?.decisao || item.metadata?.status || null,
      metadata: sanitizarObjetoSeguro(item.metadata || {})
    }));
  return {
    ...resultado,
    origem,
    eventosComerciais: eventosComerciais.map(item => ({
      ...item,
      destinoId: identificadorOperacionalSeguro(item.destinoId),
      metadata: sanitizarObjetoSeguro(item.metadata || {})
    })),
    readOnly: true,
    observabilidadeV22: {
      decisoesDestino,
      destinoSelecionado: decisoesDestino.find(item => item.tipoEvento === "destino_selecionado") || null,
      rejeicoesDestino: decisoesDestino.filter(item => item.tipoEvento === "destino_rejeitado"),
      executor: decisoesDestino.filter(item => item.tipoEvento === "executor_enviado")
    }
  };
}

module.exports = {
  JANELAS_PERMITIDAS,
  LIMITE_EVENTOS_MAX,
  LIMITE_WORKSPACES_MAX,
  buscarWorkspacesObservabilidade,
  consultarResumoWorkspaceObservabilidade,
  consultarProblemasObservabilidade,
  consultarEventosWorkspaceObservabilidade,
  rastrearEventoObservabilidade,
  classificarSaudeOperacional,
  sanitizarIntegracao,
  sanitizarObjetoSeguro,
  janelaPermitida,
  limiteEventos,
  limiteWorkspaces
};
