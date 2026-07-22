const fs = require("fs");
const path = require("path");

const {
  logEngineDbOk,
  logEngineDbErro
} = require("./logger");

let pool = null;
let pgDisponivel = null;
function perfDbMs(inicio) {
  return Number(process.hrtime.bigint() - inicio) / 1e6;
}

function logDbPerf(operacao, inicio, extra = {}) {
  console.log("[PERF DB]", JSON.stringify({
    operacao,
    tempoMs: Math.round(perfDbMs(inicio)),
    ...extra
  }));
}

function tipoQueryEngine(texto = "") {
  const sql = String(texto || "").trim().replace(/\s+/g, " ");
  const match = sql.match(/^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  const comando = match ? match[1].toUpperCase() : "SQL";

  const tabelaMatch = sql.match(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_."]+)/i);
  const tabela = tabelaMatch ? tabelaMatch[1].replace(/"/g, "").slice(0, 80) : null;

  return tabela ? `${comando} ${tabela}` : comando;
}

function resumoSqlEngine(texto = "") {
  return String(texto || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function estadoPoolEngine(clientPool, sufixo = "") {
  if (!clientPool) return {};
  const sufixoFinal = sufixo ? String(sufixo) : "";
  return {
    [`poolTotal${sufixoFinal}`]: Number(clientPool.totalCount || 0),
    [`poolIdle${sufixoFinal}`]: Number(clientPool.idleCount || 0),
    [`poolWaiting${sufixoFinal}`]: Number(clientPool.waitingCount || 0),
    [`poolMax${sufixoFinal}`]: Number(clientPool.options?.max || 0) || null
  };
}

function erroSanitizadoDb(erro) {
  const mensagem = String(erro?.message || "erro_desconhecido").slice(0, 180);
  return {
    erroCodigo: erro?.code ? String(erro.code).slice(0, 40) : null,
    erroMensagem: mensagem,
    connectionTerminated: /connection terminated unexpectedly/i.test(mensagem)
  };
}

function carregarPg() {
  if (pgDisponivel !== null) return pgDisponivel;

  try {
    pgDisponivel = require("pg");
  } catch (e) {
    pgDisponivel = false;
  }

  return pgDisponivel;
}

function engineDatabaseUrl() {
  return String(process.env.DATABASE_URL || "").trim();
}

function engineDbHabilitado() {
  return Boolean(engineDatabaseUrl());
}

function getEnginePool() {
  if (!engineDbHabilitado()) return null;
  if (pool) return pool;

  const pg = carregarPg();
  if (!pg) {
    logEngineDbErro({ motivo: "pg_nao_instalado" });
    return null;
  }

  pool = new pg.Pool({
    connectionString: engineDatabaseUrl(),
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
  });

  pool.on("error", (erro) => {
    logEngineDbErro({ motivo: "pool_error", erro: erro.message });
  });

  return pool;
}

async function queryEngine(texto, params = []) {
  const inicio = process.hrtime.bigint();
  const tipoQuery = tipoQueryEngine(texto);
  const clientPool = getEnginePool();
  if (!clientPool) {
    logDbPerf("queryEngine", inicio, {
      ok: false,
      motivo: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente",
      tipoQuery,
      tempoPoolMs: null,
      tempoSqlMs: null
    });
    return { ok: false, motivo: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente" };
  }

  const poolAntes = estadoPoolEngine(clientPool, "Antes");
  const inicioPool = process.hrtime.bigint();
  let client = null;
  let tempoPoolMs = null;
  let tempoSqlMs = null;

  try {
    client = await clientPool.connect();
    tempoPoolMs = Math.round(perfDbMs(inicioPool));

    const inicioSql = process.hrtime.bigint();
    const resultado = await client.query(texto, params);
    tempoSqlMs = Math.round(perfDbMs(inicioSql));

    logDbPerf("queryEngine", inicio, {
      ok: true,
      tipoQuery,
      tempoPoolMs,
      tempoSqlMs,
      linhas: resultado?.rowCount ?? null,
      sql: resumoSqlEngine(texto),
      ...poolAntes,
      ...estadoPoolEngine(clientPool, "Depois")
    });
    return { ok: true, resultado };
  } catch (e) {
    if (tempoPoolMs === null) tempoPoolMs = Math.round(perfDbMs(inicioPool));
    const erroDb = erroSanitizadoDb(e);
    logDbPerf("queryEngine", inicio, {
      ok: false,
      motivo: "query_falhou",
      tipoQuery,
      tempoPoolMs,
      tempoSqlMs,
      duracaoAteConnectionTerminatedMs: erroDb.connectionTerminated ? Math.round(perfDbMs(inicio)) : null,
      ...erroDb,
      sql: resumoSqlEngine(texto),
      ...poolAntes,
      ...estadoPoolEngine(clientPool, "Depois")
    });
    logEngineDbErro({ motivo: "query_falhou", erro: erroDb.erroMensagem, codigo: erroDb.erroCodigo || undefined });
    return { ok: false, motivo: "query_falhou", erro: e.message };
  } finally {
    if (client) client.release();
  }
}

async function initEngineDatabase() {
  if (!engineDbHabilitado()) {
    logEngineDbErro({ motivo: "database_url_ausente" });
    return { ok: false, motivo: "database_url_ausente" };
  }

  const clientPool = getEnginePool();
  if (!clientPool) return { ok: false, motivo: "pool_indisponivel" };

  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    const inicioQuery = process.hrtime.bigint();
    await clientPool.query(schema);
    logDbPerf("initEngineDatabase", inicioQuery, { ok: true, sql: "schema.sql" });
    logEngineDbOk({ tabelas: "engine" });
    return { ok: true };
  } catch (e) {
    logEngineDbErro({ motivo: "init_falhou", erro: e.message });
    return { ok: false, motivo: "init_falhou", erro: e.message };
  }
}

module.exports = {
  initEngineDatabase,
  queryEngine,
  getEnginePool,
  engineDbHabilitado
};
