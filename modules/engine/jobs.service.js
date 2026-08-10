const { queryEngine, getEnginePool } = require("./database");
const {
  detectarMarketplaceLink,
  normalizarLinksExtraidos,
  normalizarTexto
} = require("./normalizers");
const {
  logEngineJobClienteCriado,
  logEngineJobClienteErro
} = require("./logger");
const coberturaRadar = require("../radar/cobertura-v1");
const {
  avaliarWorkspaceParaEngine
} = require("../workspace");
const {
  resolverImagemCanonicaEvento,
  aplicarImagemCanonicaMetadata
} = require("../imagens/cache-canonico-evento");

const CONFIRMACAO_RETENCAO_JOBS_POSTGRES = "LIMPAR_JOBS_POSTGRES_FINALIZADOS_12H";
const RETENCAO_JOBS_LOCK_ID = 902260733;
const STATUS_JOBS_ATIVOS_RETENCAO = Object.freeze([
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
  "bloqueado",
  "oferta_criada"
]);
const STATUS_JOBS_FINAIS_RETENCAO = Object.freeze([
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

let retencaoJobsPostgresEmExecucao = false;

// DEPRECATED — compatibilidade temporaria.
// Origem legada: chamadas de fan-out ainda podem enviar id/clienteId.
// Destino oficial: receber somente workspaceId na aplicacao.
// Consumidor atual: registrarEventoBruto/criarJobsParaClientes em testes e Engine V2.
// Remover na Fase: 3, mantendo cliente_id apenas na persistencia fisica do banco.
function idClienteEntrada(cliente) {
  return typeof cliente === "string"
    ? cliente
    : cliente?.workspaceId || cliente?.id || cliente?.clienteId;
}

function normalizarClientes(clientes = []) {
  const lista = Array.isArray(clientes) ? clientes : [clientes].filter(Boolean);
  const ids = lista
    .map(idClienteEntrada)
    .map(id => normalizarTexto(id || ""))
    .filter(Boolean);

  return [...new Set(ids)];
}

function avaliarClientesParaJobs(clientes = []) {
  const ids = normalizarClientes(clientes);
  const clientesIds = [];
  const ignorados = [];

  for (const clienteId of ids) {
    const avaliacao = avaliarWorkspaceParaEngine(clienteId);
    if (avaliacao.elegivelEngine) {
      clientesIds.push(clienteId);
    } else {
      ignorados.push({
        clienteId,
        motivo: avaliacao.motivo || "workspace_nao_operacional",
        motivos: avaliacao.motivos || []
      });
    }
  }

  return {
    clientesIds,
    ignorados
  };
}

function marketplacePrincipal(links = []) {
  const normalizados = normalizarLinksExtraidos(links);
  return normalizados.map(detectarMarketplaceLink).find(Boolean) || "";
}

function jsonbParam(valor, fallback) {
  const base = valor === undefined ? fallback : valor;
  const serializado = JSON.stringify(base);
  return serializado === undefined ? JSON.stringify(fallback) : serializado;
}

async function ignorarJobsAdminNaoOperacional() {
  const motivo = "admin_nao_e_cliente_operacional";
  const resultado = await queryEngine(
    `WITH jobs_admin AS (
       UPDATE engine_jobs_cliente
          SET status = 'ignorado',
              motivo_final = $1,
              atualizado_em = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE LOWER(TRIM(cliente_id)) = 'admin'
          AND (status IS DISTINCT FROM 'ignorado' OR motivo_final IS DISTINCT FROM $1)
        RETURNING id, oferta_id
     ), ofertas_admin AS (
       UPDATE engine_ofertas o
          SET status = 'retida',
              motivo_status = $1,
              atualizada_em = NOW()
        WHERE o.id IN (
          SELECT j.oferta_id
            FROM engine_jobs_cliente j
           WHERE LOWER(TRIM(j.cliente_id)) = 'admin'
             AND j.oferta_id IS NOT NULL
        )
          AND o.status IN ('importada', 'oferta_criada', 'distribuindo')
        RETURNING o.id
     )
     SELECT
       (SELECT COUNT(*)::int FROM jobs_admin) AS jobs_ignorados,
       (SELECT COUNT(*)::int FROM ofertas_admin) AS ofertas_retidas`,
    [motivo, jsonbParam({ motivo, operacional: false }, {})]
  );

  if (!resultado.ok) {
    logEngineJobClienteErro({
      clienteId: "admin",
      motivo: resultado.motivo || "admin_jobs_neutralizacao_falhou",
      erro: resultado.erro || ""
    });
    return { ok: false, motivo: resultado.motivo || "admin_jobs_neutralizacao_falhou", erro: resultado.erro || "" };
  }

  const resumo = resultado.resultado.rows[0] || {};
  if (resumo.jobs_ignorados || resumo.ofertas_retidas) {
    console.log("[ENGINE-ADMIN-NAO-OPERACIONAL]", JSON.stringify({
      motivo,
      jobsIgnorados: Number(resumo.jobs_ignorados || 0),
      ofertasRetidas: Number(resumo.ofertas_retidas || 0)
    }));
  }

  return {
    ok: true,
    motivo,
    jobsIgnorados: Number(resumo.jobs_ignorados || 0),
    ofertasRetidas: Number(resumo.ofertas_retidas || 0)
  };
}

async function resolverImagemCanonicaEventoSeguro({ eventoId, marketplace, linksExtraidos, metadataEvento, clientesIds = [], deps = {} } = {}) {
  if (!clientesIds.length) {
    return { imagemStatus: "nao_resolvida", motivo: "sem_clientes_operacionais", imagemEnviavel: false };
  }

  try {
    return await resolverImagemCanonicaEvento({
      eventoId,
      marketplace,
      linksExtraidos,
      metadataEvento
    }, deps.imagemCanonica || {});
  } catch (erro) {
    console.log("[ENGINE-IMAGEM-CACHE-CANONICO-ERRO]", JSON.stringify({
      eventoId: eventoId || null,
      marketplace: marketplace || "",
      motivo: "cache_canonico_imagem_falhou",
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180)
    }));
    return {
      imagemStatus: "nao_resolvida",
      motivo: "cache_canonico_imagem_falhou",
      imagemEnviavel: false
    };
  }
}

async function criarJobsParaClientes({ eventoId, ofertaId = null, clientes = [], marketplaceDetectado = "", linksExtraidos = [], metadataEvento = {}, deps = {} } = {}) {
  const contextoCobertura = {
    coberturaTraceId: metadataEvento?.coberturaTraceId || "",
    fidelidadeTraceId: metadataEvento?.fidelidadeTraceId || "",
    eventoEngineId: eventoId || "",
    ofertaId: ofertaId || "",
    marketplace: marketplaceDetectado || marketplacePrincipal(linksExtraidos),
    links: linksExtraidos
  };
  coberturaRadar.registrar("engine_job_inicio", {
    ...contextoCobertura,
    decisao: "iniciado"
  });
  if (!eventoId) {
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      decisao: "rejeitado",
      motivo: "evento_id_ausente",
      jobNovoCriado: false
    });
    return { ok: false, motivo: "evento_id_ausente", criados: 0 };
  }

  await ignorarJobsAdminNaoOperacional();

  const avaliacaoClientes = avaliarClientesParaJobs(clientes);
  const clientesIds = avaliacaoClientes.clientesIds;
  const marketplace = normalizarTexto(marketplaceDetectado || marketplacePrincipal(linksExtraidos));
  const imagemCanonicaEvento = await resolverImagemCanonicaEventoSeguro({
    eventoId,
    marketplace,
    linksExtraidos,
    metadataEvento,
    clientesIds,
    deps
  });
  const metadataEventoCanonico = aplicarImagemCanonicaMetadata(metadataEvento, imagemCanonicaEvento);
  const metadataJob = {
    fase: "1.1",
    ...(coberturaRadar.flagAtiva() && metadataEventoCanonico?.coberturaTraceId ? { coberturaTraceId: metadataEventoCanonico.coberturaTraceId } : {}),
    ...(coberturaRadar.flagAtiva() && metadataEventoCanonico?.fidelidadeTraceId ? { fidelidadeTraceId: metadataEventoCanonico.fidelidadeTraceId } : {}),
    imagemRadar: metadataEventoCanonico?.imagem || metadataEventoCanonico?.image || metadataEventoCanonico?.thumbnail || metadataEventoCanonico?.imagemUrl || "",
    imagemEventoOriginal: metadataEventoCanonico?.imagemOriginal || metadataEventoCanonico?.imagemRadar || metadataEventoCanonico?.foto || metadataEventoCanonico?.midia || "",
    imagemCanonicaDuravel: metadataEventoCanonico?.imagemCanonicaDuravel || "",
    imagemUrl: metadataEventoCanonico?.imagemUrl || "",
    imagemOrigem: metadataEventoCanonico?.imagemOrigem || "",
    imagemStatus: metadataEventoCanonico?.imagemStatus || "",
    imagemEnviavel: metadataEventoCanonico?.imagemEnviavel === true,
    imagemCacheCanonico: metadataEventoCanonico?.imagemCacheCanonico || null,
    metadataEvento: metadataEventoCanonico
  };
  let criados = 0;
  let existentes = 0;

  const adminIgnorado = avaliacaoClientes.ignorados
    .some(item => item.motivos.includes("workspace_admin") || normalizarTexto(item.clienteId).toLowerCase() === "admin");

  if (adminIgnorado) {
    console.log("[ENGINE-ADMIN-NAO-OPERACIONAL]", JSON.stringify({
      eventoId,
      motivo: "admin_nao_e_cliente_operacional",
      jobCriado: false
    }));
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      clienteId: "admin",
      decisao: "rejeitado",
      motivo: "admin_nao_e_cliente_operacional",
      jobNovoCriado: false
    });
  }

  for (const ignorado of avaliacaoClientes.ignorados.filter(item => normalizarTexto(item.clienteId).toLowerCase() !== "admin")) {
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      clienteId: ignorado.clienteId,
      decisao: "rejeitado",
      motivo: ignorado.motivo || "workspace_nao_operacional",
      jobNovoCriado: false
    });
  }

  if (!clientesIds.length) {
    coberturaRadar.registrar("engine_job_nao_criado", {
      ...contextoCobertura,
      decisao: "rejeitado",
      motivo: "sem_clientes_operacionais",
      jobNovoCriado: false
    });
  }

  for (const clienteId of clientesIds) {
    try {
      const insert = await queryEngine(
        `INSERT INTO engine_jobs_cliente (
           evento_id, oferta_id, cliente_id, marketplace_detectado, marketplace,
           status, prioridade, tentativas, metadata
         )
         SELECT $1, $2, $3, $4, $4, 'pendente', 0, 0, $5::jsonb
          WHERE NOT EXISTS (
            SELECT 1
              FROM engine_jobs_cliente
             WHERE evento_id = $1
               AND cliente_id = $3
          )
         RETURNING id`,
        [eventoId, ofertaId, clienteId, marketplace, jsonbParam(metadataJob, {})]
      );

      if (!insert.ok) {
        logEngineJobClienteErro({ eventoId, clienteId, motivo: insert.motivo || "insert_falhou", erro: insert.erro || "" });
        coberturaRadar.registrar("engine_job_erro", {
          ...contextoCobertura,
          clienteId,
          decisao: "erro",
          motivo: insert.motivo || "insert_falhou",
          erro: insert.erro || "",
          jobNovoCriado: false
        });
        continue;
      }

      const jobId = insert.resultado.rows[0]?.id;
      if (!jobId) {
        existentes += 1;
        coberturaRadar.registrar("engine_job_existente", {
          ...contextoCobertura,
          clienteId,
          decisao: "reaproveitado",
          motivo: "job_existente",
          jobNovoCriado: false
        });
        continue;
      }

      criados += 1;
      logEngineJobClienteCriado({ id: jobId, eventoId, clienteId, marketplaceDetectado: marketplace });
      coberturaRadar.registrar("engine_job_criado", {
        ...contextoCobertura,
        clienteId,
        decisao: "aceito",
        motivo: "job_criado",
        jobId,
        jobNovoCriado: true
      });
    } catch (e) {
      logEngineJobClienteErro({ eventoId, clienteId, motivo: "erro_inesperado", erro: e.message });
      coberturaRadar.registrar("engine_job_erro", {
        ...contextoCobertura,
        clienteId,
        decisao: "erro",
        motivo: "erro_inesperado",
        erro: e.message,
        jobNovoCriado: false
      });
    }
  }

  return { ok: true, criados, existentes };
}

function normalizarStatusLimpeza(status = []) {
  const lista = Array.isArray(status) ? status : [status].filter(Boolean);
  return [...new Set(
    lista
      .map(item => normalizarTexto(item).toLowerCase())
      .filter(Boolean)
      .filter(item => item !== "cancelado")
  )];
}

function resumirJobsAfetados(rows = []) {
  const porStatus = {};
  const porCliente = {};

  for (const row of rows) {
    const status = row.status_anterior || "sem_status";
    const clienteId = row.cliente_id || "sem_cliente";
    porStatus[status] = (porStatus[status] || 0) + 1;
    porCliente[clienteId] = (porCliente[clienteId] || 0) + 1;
  }

  return { porStatus, porCliente };
}

function limitarLoteRetencao(valor, emergenciaVolumeCheio = false) {
  const padrao = emergenciaVolumeCheio ? 50 : 1000;
  const maximo = emergenciaVolumeCheio ? 200 : 5000;
  const numero = Number(valor || padrao);
  if (!Number.isFinite(numero) || numero <= 0) return padrao;
  return Math.max(1, Math.min(maximo, Math.floor(numero)));
}

function horasRetencao(valor, padrao) {
  const numero = Number(valor || padrao);
  if (!Number.isFinite(numero) || numero <= 0) return padrao;
  return Math.max(1, Math.floor(numero));
}

function statusNormalizadoRetencao(status = "") {
  return normalizarTexto(status).toLowerCase();
}

function classificarStatusRetencaoJobsPostgres(status = "") {
  const normalizado = statusNormalizadoRetencao(status);
  if (!normalizado) return "protegido_status_ausente";
  if (STATUS_JOBS_ATIVOS_RETENCAO.includes(normalizado)) return "protegido_ativo";
  if (STATUS_JOBS_FINAIS_RETENCAO.includes(normalizado)) return "final_elegivel_por_idade";
  return "protegido_status_desconhecido";
}

function extrairPrimeiraLinha(resultado = {}) {
  return resultado?.resultado?.rows?.[0] || {};
}

function motivoErroRetencaoPostgres(resultado = {}, motivoPadrao = "retencao_jobs_postgres_falhou") {
  const motivo = String(resultado.motivo || "").toLowerCase();
  const erro = String(resultado.erro || resultado.message || "").toLowerCase();
  if (
    ["database_url_ausente", "pool_indisponivel", "query_falhou"].includes(motivo) ||
    /connection|terminated|timeout|timed out|econn|enotfound|database|pool|postgres/.test(erro)
  ) {
    return "banco_indisponivel";
  }
  if (/wal|pg_wal|no space|sem espaco|sem espaço|disk full|could not write|write failed/.test(erro)) {
    return "postgres_sem_espaco_ou_wal";
  }
  return resultado.motivo || motivoPadrao;
}

function respostaErroRetencao(resultado = {}, motivo = "retencao_jobs_postgres_falhou") {
  return {
    ok: false,
    motivo: motivoErroRetencaoPostgres(resultado, motivo),
    erro: resultado.erro || "",
    aplicouMudancas: false
  };
}

function bytesLegiveisRetencao(bytes = 0) {
  const unidades = ["B", "KB", "MB", "GB"];
  let valor = Number(bytes || 0);
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  return `${valor.toFixed(indice === 0 ? 0 : 2)} ${unidades[indice]}`;
}

async function queryRetencao(sql, params = [], deps = {}) {
  const query = deps.queryEngine || queryEngine;
  return query(sql, params);
}

async function consultarTamanhosRetencao(deps = {}) {
  const resultado = await queryRetencao(
    `SELECT relname AS tabela,
            pg_total_relation_size(oid)::bigint AS bytes
       FROM pg_class
      WHERE relname = ANY($1::text[])
      ORDER BY relname`,
    [[
      "engine_jobs_cliente",
      "engine_processamentos",
      "engine_eventos_comerciais"
    ]],
    deps
  );

  if (!resultado.ok) return {};
  return (resultado.resultado.rows || []).reduce((acc, row) => {
    acc[row.tabela] = Number(row.bytes || 0);
    return acc;
  }, {});
}

async function executarPreflightRetencaoJobsPostgres(opcoes = {}) {
  const emergenciaVolumeCheio = opcoes.emergenciaVolumeCheio === true;
  const horasMinimas = Math.max(12, horasRetencao(opcoes.horasMinimas, 12));
  const loteLimite = limitarLoteRetencao(opcoes.loteLimite, emergenciaVolumeCheio);
  const deps = opcoes.deps || {};

  const total = await queryRetencao(
    `SELECT COUNT(*)::bigint AS total_jobs,
            COALESCE(SUM(pg_column_size(j.*)), 0)::bigint AS bytes_jobs
       FROM engine_jobs_cliente j`,
    [],
    deps
  );
  if (!total.ok) return respostaErroRetencao(total, "preflight_total_jobs_falhou");

  const statusReais = await queryRetencao(
    `SELECT COALESCE(NULLIF(TRIM(status), ''), 'sem_status') AS status,
            COUNT(*)::bigint AS total,
            MIN(criado_em) AS criado_min,
            MAX(criado_em) AS criado_max,
            MIN(atualizado_em) AS atualizado_min,
            MAX(atualizado_em) AS atualizado_max
       FROM engine_jobs_cliente
      GROUP BY COALESCE(NULLIF(TRIM(status), ''), 'sem_status')
      ORDER BY total DESC, status`,
    [],
    deps
  );
  if (!statusReais.ok) return respostaErroRetencao(statusReais, "preflight_status_jobs_falhou");

  const protecoes = await queryRetencao(
    `SELECT
       COUNT(*) FILTER (WHERE status = ANY($1::text[]))::bigint AS ativos_protegidos,
       COUNT(*) FILTER (WHERE criado_em >= NOW() - ($3::int * INTERVAL '1 hour'))::bigint AS recentes_12h,
       COUNT(*) FILTER (WHERE criado_em IS NULL)::bigint AS sem_timestamp_confiavel,
       COUNT(*) FILTER (
         WHERE COALESCE(NULLIF(TRIM(status), ''), '') = ''
            OR (
              NOT (status = ANY($1::text[]))
              AND NOT (status = ANY($2::text[]))
            )
       )::bigint AS status_desconhecido_protegido
     FROM engine_jobs_cliente`,
    [STATUS_JOBS_ATIVOS_RETENCAO, STATUS_JOBS_FINAIS_RETENCAO, horasMinimas],
    deps
  );
  if (!protecoes.ok) return respostaErroRetencao(protecoes, "preflight_protecoes_jobs_falhou");

  const elegiveis = await queryRetencao(
    `WITH candidatos AS (
       SELECT id
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])
          AND criado_em IS NOT NULL
          AND criado_em < NOW() - ($2::int * INTERVAL '1 hour')
        ORDER BY criado_em ASC, id ASC
        LIMIT $3
     )
     SELECT COUNT(*)::bigint AS jobs_elegiveis_lote,
            COALESCE(SUM(pg_column_size(j.*)), 0)::bigint AS bytes_jobs_lote,
            MIN(j.criado_em) AS criado_min,
            MAX(j.criado_em) AS criado_max,
            MIN(j.id)::bigint AS id_min,
            MAX(j.id)::bigint AS id_max
       FROM candidatos c
       JOIN engine_jobs_cliente j ON j.id = c.id`,
    [STATUS_JOBS_FINAIS_RETENCAO, horasMinimas, loteLimite],
    deps
  );
  if (!elegiveis.ok) return respostaErroRetencao(elegiveis, "preflight_elegiveis_jobs_falhou");

  const dependencias = await queryRetencao(
    `WITH candidatos AS (
       SELECT id
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])
          AND criado_em IS NOT NULL
          AND criado_em < NOW() - ($2::int * INTERVAL '1 hour')
        ORDER BY criado_em ASC, id ASC
        LIMIT $3
     )
     SELECT 'engine_processamentos' AS tabela,
            COUNT(*)::bigint AS registros,
            COALESCE(SUM(pg_column_size(p.*)), 0)::bigint AS bytes_estimados
       FROM engine_processamentos p
       JOIN candidatos c ON c.id = p.job_id
     UNION ALL
     SELECT 'engine_eventos_comerciais' AS tabela,
            COUNT(*)::bigint AS registros,
            COALESCE(SUM(pg_column_size(e.*)), 0)::bigint AS bytes_estimados
       FROM engine_eventos_comerciais e
       JOIN candidatos c ON c.id = e.job_id`,
    [STATUS_JOBS_FINAIS_RETENCAO, horasMinimas, loteLimite],
    deps
  );
  if (!dependencias.ok) return respostaErroRetencao(dependencias, "preflight_dependencias_jobs_falhou");

  const tamanhos = await consultarTamanhosRetencao(deps);
  const totalRow = extrairPrimeiraLinha(total);
  const protecoesRow = extrairPrimeiraLinha(protecoes);
  const elegiveisRow = extrairPrimeiraLinha(elegiveis);
  const dependenciasRows = dependencias.resultado.rows || [];
  const bytesDependencias = dependenciasRows.reduce((soma, row) => soma + Number(row.bytes_estimados || 0), 0);
  const bytesRecuperaveis = Number(elegiveisRow.bytes_jobs_lote || 0) + bytesDependencias;

  return {
    ok: true,
    modo: "dry-run",
    aplicouMudancas: false,
    tabelaJobs: "engine_jobs_cliente",
    colunaData: "criado_em",
    colunaStatus: "status",
    politica: {
      emergenciaVolumeCheio,
      lotePadrao: emergenciaVolumeCheio ? 50 : 1000,
      loteMaximo: emergenciaVolumeCheio ? 200 : 5000,
      commitPorLote: true,
      vacuumExecutado: false,
      preservaQualquerJobComMenosDeHoras: horasMinimas,
      removeSomenteFinalizadosComMaisDeHoras: horasMinimas,
      loteLimite,
      statusAtivosProtegidos: STATUS_JOBS_ATIVOS_RETENCAO,
      statusFinaisElegiveis: STATUS_JOBS_FINAIS_RETENCAO
    },
    totalJobs: Number(totalRow.total_jobs || 0),
    bytesJobsEstimados: Number(totalRow.bytes_jobs || 0),
    bytesJobsEstimadosLegivel: bytesLegiveisRetencao(totalRow.bytes_jobs || 0),
    statusReais: statusReais.resultado.rows || [],
    ativosProtegidos: Number(protecoesRow.ativos_protegidos || 0),
    recentesMenos12hProtegidos: Number(protecoesRow.recentes_12h || 0),
    semTimestampConfiavelProtegidos: Number(protecoesRow.sem_timestamp_confiavel || 0),
    statusDesconhecidoProtegido: Number(protecoesRow.status_desconhecido_protegido || 0),
    finaisMais12hElegiveisLote: Number(elegiveisRow.jobs_elegiveis_lote || 0),
    elegiveisAmostra: {
      idMin: elegiveisRow.id_min || null,
      idMax: elegiveisRow.id_max || null,
      criadoMin: elegiveisRow.criado_min || null,
      criadoMax: elegiveisRow.criado_max || null
    },
    dependenciasTecnicasElegiveis: dependenciasRows,
    tabelasPreservadasPorContrato: [
      "usuarios",
      "workspaces",
      "configuracoes",
      "integracoes",
      "creditos",
      "destinos",
      "auth_sessoes",
      "engine_ofertas",
      "engine_eventos_brutos",
      "engine_links"
    ],
    tamanhoRelacoesAntesBytes: tamanhos,
    espacoLogicoEstimadoRecuperavelBytes: bytesRecuperaveis,
    espacoLogicoEstimadoRecuperavel: bytesLegiveisRetencao(bytesRecuperaveis),
    observacao: "engine_eventos_brutos e engine_links ficam preservados para nao apagar ofertas por cascata nem reinterpretar vinculos comerciais."
  };
}

async function executarBatchRetencaoJobsPostgres(client, { loteLimite, horasMinimas }) {
  const resultado = await client.query(
    `WITH candidatos AS (
       SELECT id
         FROM engine_jobs_cliente
        WHERE status = ANY($1::text[])
          AND criado_em IS NOT NULL
          AND criado_em < NOW() - ($2::int * INTERVAL '1 hour')
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
    [STATUS_JOBS_FINAIS_RETENCAO, horasMinimas, loteLimite]
  );

  return resultado.rows[0] || {};
}

async function executarRetencaoJobsPostgres(opcoes = {}) {
  const dryRun = opcoes.dryRun !== false;
  const emergenciaVolumeCheio = opcoes.emergenciaVolumeCheio === true;
  const horasMinimas = Math.max(12, horasRetencao(opcoes.horasMinimas, 12));
  const loteLimite = limitarLoteRetencao(opcoes.loteLimite, emergenciaVolumeCheio);
  const deps = opcoes.deps || {};

  if (dryRun) {
    return executarPreflightRetencaoJobsPostgres({ ...opcoes, horasMinimas, loteLimite });
  }

  if (String(opcoes.confirmacao || "") !== CONFIRMACAO_RETENCAO_JOBS_POSTGRES) {
    return {
      ok: false,
      motivo: "confirmacao_retencao_jobs_postgres_invalida",
      confirmacaoEsperada: CONFIRMACAO_RETENCAO_JOBS_POSTGRES,
      aplicouMudancas: false
    };
  }

  if (retencaoJobsPostgresEmExecucao) {
    return { ok: false, motivo: "retencao_jobs_postgres_em_execucao", aplicouMudancas: false };
  }

  const pool = deps.pool || getEnginePool();
  if (!pool) return { ok: false, motivo: "banco_indisponivel", aplicouMudancas: false };

  retencaoJobsPostgresEmExecucao = true;
  const antes = await executarPreflightRetencaoJobsPostgres({ ...opcoes, horasMinimas, loteLimite, deps });
  if (!antes.ok) {
    retencaoJobsPostgresEmExecucao = false;
    return antes;
  }
  const tamanhosAntes = antes.tamanhoRelacoesAntesBytes || {};
  const resumo = {
    ok: true,
    modo: "execute",
    aplicouMudancas: true,
    lotes: 0,
    jobsRemovidos: 0,
    processamentosRemovidos: 0,
    eventosComerciaisRemovidos: 0,
    espacoLogicoLiberadoBytes: 0,
    emergenciaVolumeCheio,
    loteLimite,
    commitPorLote: true,
    vacuumExecutado: false
  };

  try {
    while (true) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lock = await client.query("SELECT pg_try_advisory_xact_lock($1) AS locked", [RETENCAO_JOBS_LOCK_ID]);
        if (lock.rows[0]?.locked !== true) {
          await client.query("ROLLBACK");
          return { ok: false, motivo: "retencao_jobs_postgres_lock_ocupado", aplicouMudancas: false };
        }

        const batch = await executarBatchRetencaoJobsPostgres(client, { loteLimite, horasMinimas });
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

    const depois = await executarPreflightRetencaoJobsPostgres({ ...opcoes, horasMinimas, loteLimite, deps });
    const tamanhosDepois = depois.tamanhoRelacoesAntesBytes || {};
    const fisicoAntes = Object.values(tamanhosAntes).reduce((soma, valor) => soma + Number(valor || 0), 0);
    const fisicoDepois = Object.values(tamanhosDepois).reduce((soma, valor) => soma + Number(valor || 0), 0);
    resumo.espacoLogicoLiberado = bytesLegiveisRetencao(resumo.espacoLogicoLiberadoBytes);
    resumo.espacoFisicoRecuperadoBytes = 0;
    resumo.espacoFisicoRecuperado = bytesLegiveisRetencao(0);
    resumo.observacaoEspacoFisico = "VACUUM nao executado nesta rota; recuperacao fisica fica para etapa posterior.";
    resumo.preflightAntes = antes;
    resumo.preflightDepois = depois;
    return resumo;
  } catch (erro) {
    const motivo = motivoErroRetencaoPostgres(erro, "retencao_jobs_postgres_falhou");
    return {
      ok: false,
      motivo,
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180),
      aplicouMudancas: resumo.jobsRemovidos > 0,
      parcial: resumo
    };
  } finally {
    retencaoJobsPostgresEmExecucao = false;
  }
}

async function limparJobsAntigosEngine({ antesDoId = 0, status = [] } = {}) {
  const limiteId = Number(antesDoId || 0);
  const statusLimpeza = normalizarStatusLimpeza(status);

  if (!Number.isFinite(limiteId) || limiteId <= 0) {
    return { ok: false, motivo: "antesDoId_invalido", afetados: 0, porStatus: {}, porCliente: {} };
  }

  if (!statusLimpeza.length) {
    return { ok: false, motivo: "status_vazio", afetados: 0, porStatus: {}, porCliente: {} };
  }

  const resultado = await queryEngine(
    `WITH selecionados AS (
       SELECT id, cliente_id, status AS status_anterior
         FROM engine_jobs_cliente
        WHERE id < $1
          AND status = ANY($2::text[])
     ), atualizados AS (
       UPDATE engine_jobs_cliente j
          SET status = 'cancelado',
              motivo_final = 'limpeza_teste_clientes_antigos',
              atualizado_em = NOW(),
              metadata = COALESCE(j.metadata, '{}'::jsonb) || $3::jsonb
         FROM selecionados s
        WHERE j.id = s.id
        RETURNING j.id, s.cliente_id, s.status_anterior
     )
     SELECT id, cliente_id, status_anterior
       FROM atualizados
      ORDER BY id ASC`,
    [
      Math.floor(limiteId),
      statusLimpeza,
      JSON.stringify({ limpeza: "limpeza_teste_clientes_antigos", antesDoId: Math.floor(limiteId) })
    ]
  );

  if (!resultado.ok) {
    return { ok: false, motivo: resultado.motivo || "limpeza_falhou", erro: resultado.erro || "", afetados: 0, porStatus: {}, porCliente: {} };
  }

  const rows = resultado.resultado.rows || [];
  const resumo = resumirJobsAfetados(rows);

  return {
    ok: true,
    antesDoId: Math.floor(limiteId),
    statusSolicitados: statusLimpeza,
    novoStatus: "cancelado",
    motivoFinal: "limpeza_teste_clientes_antigos",
    afetados: rows.length,
    ...resumo
  };
}

module.exports = {
  criarJobsParaClientes,
  ignorarJobsAdminNaoOperacional,
  limparJobsAntigosEngine,
  executarPreflightRetencaoJobsPostgres,
  executarRetencaoJobsPostgres,
  classificarStatusRetencaoJobsPostgres,
  CONFIRMACAO_RETENCAO_JOBS_POSTGRES,
  STATUS_JOBS_ATIVOS_RETENCAO,
  STATUS_JOBS_FINAIS_RETENCAO
};
