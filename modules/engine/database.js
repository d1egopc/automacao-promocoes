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

function aguardarDb(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function idadeDesdeDb(valor, agora = Date.now()) {
  const numero = Number(valor || 0);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return Math.max(0, agora - numero);
}

function metadadosPoolEngine(clientPool) {
  return clientPool ? metadadosPools.get(clientPool) || {} : {};
}

function metadadosConexaoEngine(client, poolMeta = {}) {
  if (!client) return null;
  let dados = metadadosConexoesPool.get(client);
  if (!dados) {
    const agora = Date.now();
    dados = {
      id: proximoIdConexaoPool,
      poolVersao: poolMeta.versao || null,
      criadaEm: agora,
      ultimaUtilizacaoEm: null
    };
    proximoIdConexaoPool += 1;
    metadadosConexoesPool.set(client, dados);
  }
  return dados;
}

function resumoConexaoEngine(client, poolMeta = {}, agora = Date.now()) {
  const dados = metadadosConexaoEngine(client, poolMeta);
  if (!dados) {
    return {
      conexaoId: null,
      conexaoCriadaEm: null,
      idadeConexaoMs: null,
      ultimaUtilizacaoEm: null,
      idadeUltimaUtilizacaoMs: null
    };
  }

  return {
    conexaoId: dados.id,
    conexaoCriadaEm: new Date(dados.criadaEm).toISOString(),
    idadeConexaoMs: idadeDesdeDb(dados.criadaEm, agora),
    ultimaUtilizacaoEm: dados.ultimaUtilizacaoEm ? new Date(dados.ultimaUtilizacaoEm).toISOString() : null,
    idadeUltimaUtilizacaoMs: idadeDesdeDb(dados.ultimaUtilizacaoEm, agora)
  };
}

function marcarUsoConexaoEngine(client, poolMeta = {}) {
  const dados = metadadosConexaoEngine(client, poolMeta);
  if (dados) dados.ultimaUtilizacaoEm = Date.now();
  return resumoConexaoEngine(client, poolMeta);
}

function encerrarPoolAntigoSeguro(poolAntigo, poolMeta = {}) {
  if (!poolAntigo) return;
  const versao = poolMeta.versao || null;
  const inicio = Date.now();
  poolMeta.encerrando = true;
  poolMeta.encerramentoIniciadoEm = inicio;

  logDbPool("encerramento_inicio", {
    poolVersao: versao,
    encerrando: true,
    encerramentoIniciadoEm: new Date(inicio).toISOString(),
    ...estadoPoolEngine(poolAntigo, "")
  });

  poolAntigo.end()
    .then(() => {
      logDbPool("encerramento_sucesso", {
        poolVersao: versao,
        duracaoMs: Date.now() - inicio,
        encerrando: true
      });
    })
    .catch((erro) => {
      logDbPool("encerramento_erro", {
        poolVersao: versao,
        duracaoMs: Date.now() - inicio,
        erroMensagem: String(erro?.message || "erro_desconhecido").slice(0, 180),
        encerrando: true
      });
    });
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

async function recriarPoolEngineSeNecessario({ clientPool, erroDb, duranteConnect = false, origem = "query" } = {}) {
  if (!clientPool || clientPool !== pool) return false;
  if (!duranteConnect || !erroConexaoDb(erroDb)) return false;

  const poolMeta = metadadosPoolEngine(clientPool);
  if (poolMeta.encerrando) {
    logDbPool("recriacao_pulada_pool_encerrando", {
      poolVersao: poolMeta.versao || poolVersao,
      origem,
      erroCodigo: erroDb?.erroCodigo || null,
      erroMensagem: erroDb?.erroMensagem || "",
      encerrando: true,
      idadeEncerramentoMs: idadeDesdeDb(poolMeta.encerramentoIniciadoEm)
    });
    return false;
  }

  if (recriacaoPoolPromessa) {
    logDbPool("recriacao_single_flight_reutilizada", {
      poolVersao: poolMeta.versao || poolVersao,
      origem,
      erroCodigo: erroDb?.erroCodigo || null,
      erroMensagem: erroDb?.erroMensagem || ""
    });
    return recriacaoPoolPromessa;
  }

  const agora = Date.now();
  const desdeUltima = agora - ultimaRecriacaoPoolEm;
  if (desdeUltima < ENGINE_DB_POOL_RECREATE_COOLDOWN_MS) {
    logDbPool("recriacao_pulada_cooldown", {
      poolVersao: poolMeta.versao || poolVersao,
      origem,
      desdeUltimaMs: desdeUltima,
      cooldownMs: ENGINE_DB_POOL_RECREATE_COOLDOWN_MS,
      erroCodigo: erroDb?.erroCodigo || null,
      erroMensagem: erroDb?.erroMensagem || ""
    });
    return false;
  }

  ultimaRecriacaoPoolEm = agora;
  const poolAntigo = clientPool;
  const versaoAntiga = poolMeta.versao || poolVersao;
  pool = null;
  poolMeta.encerrando = true;
  poolMeta.encerramentoIniciadoEm = agora;

  logDbPool("recriacao_iniciada", {
    poolVersao: versaoAntiga,
    origem,
    motivo: "falha_ao_obter_conexao",
    erroCodigo: erroDb?.erroCodigo || null,
    erroMensagem: erroDb?.erroMensagem || "",
    encerrando: true,
    ...estadoPoolEngine(poolAntigo, "")
  });

  encerrarPoolAntigoSeguro(poolAntigo, poolMeta);

  let promessa = null;
  promessa = (async () => {
    try {
      getEnginePool();
      await aguardarDb(ENGINE_DB_POOL_RECREATE_COOLDOWN_MS);
      return true;
    } finally {
      if (recriacaoPoolPromessa === promessa) {
        recriacaoPoolPromessa = null;
        logDbPool("recriacao_single_flight_liberada", {
          poolVersaoAtual: poolVersao,
          cooldownMs: ENGINE_DB_POOL_RECREATE_COOLDOWN_MS
        });
      }
    }
  })();

  recriacaoPoolPromessa = promessa;
  return promessa;
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
  const versaoAtual = poolVersao + 1;
  const poolNovo = new pg.Pool(configPool);
  const poolMeta = {
    versao: versaoAtual,
    criadoEm: Date.now(),
    encerrando: false,
    encerramentoIniciadoEm: null
  };

  poolVersao = versaoAtual;
  pool = poolNovo;
  metadadosPools.set(poolNovo, poolMeta);

  logDbPool("criado", {
    poolVersao: versaoAtual,
    criadoEm: new Date(poolMeta.criadoEm).toISOString(),
    max: configPool.max,
    connectionTimeoutMillis: configPool.connectionTimeoutMillis,
    idleTimeoutMillis: configPool.idleTimeoutMillis,
    keepAlive: configPool.keepAlive,
    keepAliveInitialDelayMillis: configPool.keepAliveInitialDelayMillis,
    ssl: Boolean(configPool.ssl)
  });

  poolNovo.on("connect", (client) => {
    const conexao = metadadosConexaoEngine(client, poolMeta);
    logDbPool("connect", {
      poolVersao: versaoAtual,
      conexaoId: conexao?.id || null,
      conexaoCriadaEm: conexao?.criadaEm ? new Date(conexao.criadaEm).toISOString() : null,
      encerrando: Boolean(poolMeta.encerrando),
      idadePoolMs: idadeDesdeDb(poolMeta.criadoEm),
      ...estadoPoolEngine(poolNovo, "")
    });
  });

  poolNovo.on("acquire", (client) => {
    const conexaoAntes = resumoConexaoEngine(client, poolMeta);
    const conexaoDepois = marcarUsoConexaoEngine(client, poolMeta);
    logDbPool("acquire", {
      poolVersao: versaoAtual,
      ...conexaoDepois,
      idadeUltimaUtilizacaoAnteriorMs: conexaoAntes.idadeUltimaUtilizacaoMs,
      encerrando: Boolean(poolMeta.encerrando),
      idadePoolMs: idadeDesdeDb(poolMeta.criadoEm),
      ...estadoPoolEngine(poolNovo, "")
    });
  });

  poolNovo.on("remove", (client) => {
    logDbPool("remove", {
      poolVersao: versaoAtual,
      ...resumoConexaoEngine(client, poolMeta),
      encerrando: Boolean(poolMeta.encerrando),
      durantePoolEnd: Boolean(poolMeta.encerrando),
      encerramentoIniciadoEm: poolMeta.encerramentoIniciadoEm ? new Date(poolMeta.encerramentoIniciadoEm).toISOString() : null,
      idadeEncerramentoMs: idadeDesdeDb(poolMeta.encerramentoIniciadoEm),
      idadePoolMs: idadeDesdeDb(poolMeta.criadoEm),
      ...estadoPoolEngine(poolNovo, "")
    });
  });

  poolNovo.on("error", (erro, client) => {
    const erroDb = erroSanitizadoDb(erro);
    logDbPool("error", {
      poolVersao: versaoAtual,
      ...resumoConexaoEngine(client, poolMeta),
      encerrando: Boolean(poolMeta.encerrando),
      ...erroDb,
      ...estadoPoolEngine(poolNovo, "")
    });
    recriarPoolEngineSeNecessario({
      clientPool: poolNovo,
      erroDb,
      duranteConnect: true,
      origem: "pool_error"
    })
      .then(poolRecriado => {
        logEngineDbErro({ motivo: "pool_error", erro: erroDb.erroMensagem, codigo: erroDb.erroCodigo || undefined, poolRecriado });
      })
      .catch(e => {
        logEngineDbErro({ motivo: "pool_error_recriacao_falhou", erro: String(e?.message || "erro_desconhecido").slice(0, 180) });
      });
  });

  return poolNovo;
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
    const poolRecriado = await recriarPoolEngineSeNecessario({
      clientPool,
      erroDb,
      duranteConnect: !client,
      origem: "queryEngine"
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
