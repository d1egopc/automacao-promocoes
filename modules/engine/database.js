const fs = require("fs");
const path = require("path");

const {
  logEngineDbOk,
  logEngineDbErro
} = require("./logger");

let pool = null;
let pgDisponivel = null;
let poolVersao = 0;
let ultimaRecriacaoPoolEm = 0;

const ENGINE_DB_POOL_RECREATE_COOLDOWN_MS = limitarInteiroDb(process.env.ENGINE_DB_POOL_RECREATE_COOLDOWN_MS, 30000, 5000, 300000);

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

function limitarInteiroDb(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

function logDbPool(evento, dados = {}) {
  console.log("[PERF DB POOL]", JSON.stringify({ evento, ...dados }));
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

function criarConfigPoolEngine() {
  return {
    connectionString: engineDatabaseUrl(),
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    max: limitarInteiroDb(process.env.ENGINE_DB_POOL_MAX, 10, 1, 20),
    connectionTimeoutMillis: limitarInteiroDb(process.env.ENGINE_DB_CONNECTION_TIMEOUT_MS, 8000, 1000, 30000),
    idleTimeoutMillis: limitarInteiroDb(process.env.ENGINE_DB_IDLE_TIMEOUT_MS, 30000, 5000, 300000),
    keepAlive: process.env.ENGINE_DB_KEEP_ALIVE === "0" ? false : true,
    keepAliveInitialDelayMillis: limitarInteiroDb(process.env.ENGINE_DB_KEEP_ALIVE_INITIAL_DELAY_MS, 10000, 1000, 60000)
  };
}

function erroConexaoDb(erroDb) {
  const codigo = String(erroDb?.erroCodigo || "").toUpperCase();
  const mensagem = String(erroDb?.erroMensagem || "");
  return Boolean(
    erroDb?.connectionTerminated ||
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(codigo) ||
    /connection terminated|timeout|timed out|connect econn|connection refused|getaddrinfo/i.test(mensagem)
  );
}

function recriarPoolEngineSeNecessario({ clientPool, erroDb, duranteConnect = false } = {}) {
  if (!clientPool || clientPool !== pool) return false;
  if (!duranteConnect || !erroConexaoDb(erroDb)) return false;

  const agora = Date.now();
  const desdeUltima = agora - ultimaRecriacaoPoolEm;
  if (desdeUltima < ENGINE_DB_POOL_RECREATE_COOLDOWN_MS) {
    logDbPool("recriacao_pulada_cooldown", {
      poolVersao,
      desdeUltimaMs: desdeUltima,
      cooldownMs: ENGINE_DB_POOL_RECREATE_COOLDOWN_MS,
      erroCodigo: erroDb?.erroCodigo || null,
      erroMensagem: erroDb?.erroMensagem || ""
    });
    return false;
  }

  ultimaRecriacaoPoolEm = agora;
  const poolAntigo = pool;
  pool = null;
  logDbPool("recriacao_agendada", {
    poolVersao,
    motivo: "falha_ao_obter_conexao",
    erroCodigo: erroDb?.erroCodigo || null,
    erroMensagem: erroDb?.erroMensagem || "",
    ...estadoPoolEngine(poolAntigo, "")
  });

  poolAntigo.end().catch((erro) => {
    logDbPool("recriacao_end_erro", {
      poolVersao,
      erroMensagem: String(erro?.message || "erro_desconhecido").slice(0, 180)
    });
  });

  return true;
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

  const configPool = criarConfigPoolEngine();
  poolVersao += 1;
  pool = new pg.Pool(configPool);

  logDbPool("criado", {
    poolVersao,
    max: configPool.max,
    connectionTimeoutMillis: configPool.connectionTimeoutMillis,
    idleTimeoutMillis: configPool.idleTimeoutMillis,
    keepAlive: configPool.keepAlive,
    keepAliveInitialDelayMillis: configPool.keepAliveInitialDelayMillis,
    ssl: Boolean(configPool.ssl)
  });

  pool.on("connect", () => {
    logDbPool("connect", { poolVersao, ...estadoPoolEngine(pool, "") });
  });

  pool.on("acquire", () => {
    logDbPool("acquire", { poolVersao, ...estadoPoolEngine(pool, "") });
  });

  pool.on("remove", () => {
    logDbPool("remove", { poolVersao, ...estadoPoolEngine(pool, "") });
  });

  pool.on("error", (erro) => {
    const erroDb = erroSanitizadoDb(erro);
    const poolAtual = pool;
    logDbPool("error", {
      poolVersao,
      ...erroDb,
      ...estadoPoolEngine(poolAtual, "")
    });
    const poolRecriado = recriarPoolEngineSeNecessario({
      clientPool: poolAtual,
      erroDb,
      duranteConnect: true
    });
    logEngineDbErro({ motivo: "pool_error", erro: erroDb.erroMensagem, codigo: erroDb.erroCodigo || undefined, poolRecriado });
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
    const poolRecriado = recriarPoolEngineSeNecessario({
      clientPool,
      erroDb,
      duranteConnect: !client
    });
    logEngineDbErro({ motivo: "query_falhou", erro: erroDb.erroMensagem, codigo: erroDb.erroCodigo || undefined, poolRecriado });
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
