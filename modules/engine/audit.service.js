const { queryEngine } = require("./database");
const { logEngineAuditoriaConsulta } = require("./logger");

function limitarConsulta(valor = 50) {
  const numero = Number(valor || 50);
  if (!Number.isFinite(numero) || numero <= 0) return 50;
  return Math.min(Math.floor(numero), 200);
}

function adicionarFiltro(filtros, params, coluna, valor) {
  const texto = String(valor || "").trim();
  if (!texto) return;
  params.push(texto);
  filtros.push(`${coluna} = $${params.length}`);
}

function respostaErro(resultado) {
  return {
    ok: false,
    motivo: resultado.motivo || "consulta_engine_falhou",
    erro: resultado.erro || ""
  };
}

async function consultarEventosEngine(filtrosEntrada = {}) {
  const filtros = [];
  const params = [];

  adicionarFiltro(filtros, params, "marketplace_detectado", filtrosEntrada.marketplace);
  adicionarFiltro(filtros, params, "origem", filtrosEntrada.origem);
  adicionarFiltro(filtros, params, "grupo_id", filtrosEntrada.grupoId);

  const limit = limitarConsulta(filtrosEntrada.limit);
  params.push(limit);

  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const resultado = await queryEngine(
    `SELECT id, uuid, origem, origem_tipo, grupo_nome, links_extraidos,
            marketplace_detectado, capturado_em, criado_em
       FROM engine_eventos_brutos
       ${where}
      ORDER BY capturado_em DESC NULLS LAST, id DESC
      LIMIT $${params.length}`,
    params
  );

  logEngineAuditoriaConsulta({ rota: "/engine/eventos", filtros: filtrosEntrada, ok: resultado.ok === true });

  if (!resultado.ok) return respostaErro(resultado);
  return { ok: true, eventos: resultado.resultado.rows };
}

async function consultarJobsEngine(filtrosEntrada = {}) {
  const filtros = [];
  const params = [];

  adicionarFiltro(filtros, params, "cliente_id", filtrosEntrada.clienteId);
  adicionarFiltro(filtros, params, "marketplace", filtrosEntrada.marketplace);
  adicionarFiltro(filtros, params, "status", filtrosEntrada.status);

  const limit = limitarConsulta(filtrosEntrada.limit);
  params.push(limit);

  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const resultado = await queryEngine(
    `SELECT id, uuid, evento_id, cliente_id, marketplace, status,
            motivo_final, criado_em, atualizado_em
       FROM engine_jobs_cliente
       ${where}
      ORDER BY criado_em DESC NULLS LAST, id DESC
      LIMIT $${params.length}`,
    params
  );

  logEngineAuditoriaConsulta({ rota: "/engine/jobs", filtros: filtrosEntrada, ok: resultado.ok === true });

  if (!resultado.ok) return respostaErro(resultado);
  return { ok: true, jobs: resultado.resultado.rows };
}

async function consultarOfertasEngine(filtrosEntrada = {}) {
  const filtros = [];
  const params = [];

  adicionarFiltro(filtros, params, "o.marketplace", filtrosEntrada.marketplace);
  adicionarFiltro(filtros, params, "j.cliente_id", filtrosEntrada.clienteId);
  adicionarFiltro(filtros, params, "o.status", filtrosEntrada.status);

  const limit = limitarConsulta(filtrosEntrada.limit);
  params.push(limit);

  const where = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
  const resultado = await queryEngine(
    `SELECT o.id, o.uuid, o.evento_id, j.id AS job_id, j.cliente_id,
            o.marketplace, o.titulo, o.preco, o.preco_original, o.imagem,
            o.link_original, o.link_afiliado, o.categoria, o.score,
            o.status, o.motivo_status, o.criada_em
       FROM engine_ofertas o
       LEFT JOIN engine_jobs_cliente j ON j.oferta_id = o.id
       ${where}
      ORDER BY o.criada_em DESC NULLS LAST, o.id DESC
      LIMIT $${params.length}`,
    params
  );

  logEngineAuditoriaConsulta({ rota: "/engine/ofertas", filtros: filtrosEntrada, ok: resultado.ok === true });

  if (!resultado.ok) return respostaErro(resultado);
  return { ok: true, ofertas: resultado.resultado.rows };
}

async function consultaLista(sql, params = []) {
  const resultado = await queryEngine(sql, params);
  if (!resultado.ok) return { ok: false, rows: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, rows: resultado.resultado.rows };
}

async function consultarResumoEngine() {
  const consultas = await Promise.all([
    consultaLista(
      `SELECT COUNT(*)::bigint AS total
         FROM engine_eventos_brutos
        WHERE criado_em >= NOW() - INTERVAL '24 hours'`
    ),
    consultaLista(
      `SELECT COUNT(*)::bigint AS total
         FROM engine_jobs_cliente
        WHERE criado_em >= NOW() - INTERVAL '24 hours'`
    ),
    consultaLista(
      `SELECT COALESCE(marketplace_detectado, 'nao_detectado') AS marketplace,
              COUNT(*)::bigint AS total
         FROM engine_eventos_brutos
        WHERE criado_em >= NOW() - INTERVAL '24 hours'
        GROUP BY COALESCE(marketplace_detectado, 'nao_detectado')
        ORDER BY total DESC`
    ),
    consultaLista(
      `SELECT cliente_id, COUNT(*)::bigint AS total
         FROM engine_jobs_cliente
        WHERE criado_em >= NOW() - INTERVAL '24 hours'
        GROUP BY cliente_id
        ORDER BY total DESC`
    ),
    consultaLista(
      `SELECT status, COUNT(*)::bigint AS total
         FROM engine_jobs_cliente
        WHERE criado_em >= NOW() - INTERVAL '24 hours'
        GROUP BY status
        ORDER BY total DESC`
    )
  ]);

  const falha = consultas.find(consulta => !consulta.ok);
  if (falha) {
    logEngineAuditoriaConsulta({ rota: "/engine/resumo", ok: false, motivo: falha.motivo || "consulta_engine_falhou" });
    return respostaErro(falha);
  }

  const [totaisEventos, totaisJobs, eventosPorMarketplace, jobsPorClienteId, jobsPorStatus] = consultas.map(consulta => consulta.rows);

  logEngineAuditoriaConsulta({ rota: "/engine/resumo", ok: true });

  return {
    ok: true,
    janela: "24h",
    totalEventos24h: Number(totaisEventos[0]?.total || 0),
    totalJobs24h: Number(totaisJobs[0]?.total || 0),
    eventosPorMarketplace,
    jobsPorClienteId,
    jobsPorStatus
  };
}

module.exports = {
  consultarEventosEngine,
  consultarJobsEngine,
  consultarOfertasEngine,
  consultarResumoEngine
};
