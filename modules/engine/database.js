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
  const clientPool = getEnginePool();
  if (!clientPool) {
    logDbPerf("queryEngine", inicio, { ok: false, motivo: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente" });
    return { ok: false, motivo: engineDbHabilitado() ? "pool_indisponivel" : "database_url_ausente" };
  }

  try {
    const resultado = await clientPool.query(texto, params);
    logDbPerf("queryEngine", inicio, { ok: true, linhas: resultado?.rowCount ?? null, sql: String(texto || "").replace(/\s+/g, " ").slice(0, 120) });
    return { ok: true, resultado };
  } catch (e) {
    logDbPerf("queryEngine", inicio, { ok: false, motivo: "query_falhou" });
    logEngineDbErro({ motivo: "query_falhou", erro: e.message });
    return { ok: false, motivo: "query_falhou", erro: e.message };
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
