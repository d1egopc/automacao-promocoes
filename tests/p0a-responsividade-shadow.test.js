const assert = require("assert");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const databasePath = path.join(repoRoot, "modules", "engine", "database.js");
const flowPath = path.join(repoRoot, "modules", "engine", "ofc", "live-flow.repository.js");
const { criarThrottleLogIntervalo } = require(path.join(repoRoot, "modules", "executor", "fila-intervalo-log-throttle.js"));

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testarConcorrenciaOfcEFailsafe() {
  const database = require(databasePath);
  const original = database.queryEngineShadow;
  let ativas = 0;
  let pico = 0;
  database.queryEngineShadow = async () => {
    ativas += 1;
    pico = Math.max(pico, ativas);
    await esperar(8);
    ativas -= 1;
    return { ok: true, resultado: { rows: [{}] }, metricas: { tempoPoolMs: 1, tempoSqlMs: 1 } };
  };
  delete require.cache[require.resolve(flowPath)];
  const { consultarFluxoVivoOfc } = require(flowPath);
  const dados = await consultarFluxoVivoOfc({ limiteConcorrencia: 99, timeoutMs: 200 });
  assert.strictEqual(dados.ok, true);
  assert.ok(pico <= 2, `pico real ${pico} excedeu 2`);
  assert.strictEqual(dados.observabilidade.picoConsultasSimultaneas, 2);

  database.queryEngineShadow = async () => ({ ok: false, motivo: "timeout_sql_shadow", erro: "timeout", metricas: { timeout: true } });
  delete require.cache[require.resolve(flowPath)];
  const { consultarFluxoVivoOfc: consultarFalha } = require(flowPath);
  const falha = await consultarFalha({ timeoutMs: 200 });
  assert.strictEqual(falha.ok, false);
  assert.strictEqual(falha.motivo, "timeout_sql_shadow");

  database.queryEngineShadow = original;
  delete require.cache[require.resolve(flowPath)];
}

async function testarPoolShadowETimeoutSql() {
  const { queryEngineShadow } = require(databasePath);
  const chamadas = [];
  let liberadoComErro = "nao_liberado";
  let releases = 0;
  const client = {
    query: async (sql) => {
      chamadas.push(sql);
      if (sql.includes("SELECT 1")) {
        const erro = new Error("canceling statement due to statement timeout");
        erro.code = "57014";
        throw erro;
      }
      return { rows: [] };
    },
    release: erro => { releases += 1; liberadoComErro = erro || null; }
  };
  const pool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    options: { max: 1 },
    connect: async () => client
  };
  const resposta = await queryEngineShadow("SELECT 1", [], { pool, timeoutSqlMs: 25 });
  assert.strictEqual(resposta.ok, false);
  assert.strictEqual(resposta.motivo, "timeout_sql_shadow");
  assert.strictEqual(liberadoComErro, null, "consulta cancelada pelo servidor volta limpa ao pool Shadow");
  assert.strictEqual(releases, 1, "client Shadow deve ser liberado uma unica vez");
  assert.deepStrictEqual(chamadas, [
    "SELECT set_config('statement_timeout', $1, false)",
    "SELECT 1",
    "SELECT set_config('statement_timeout', '0', false)"
  ]);

  const respostaAquisicao = await queryEngineShadow("SELECT 1", [], {
    pool: {
      totalCount: 2,
      idleCount: 0,
      waitingCount: 3,
      options: { max: 2 },
      connect: async () => { throw new Error("timeout exceeded when trying to connect"); }
    },
    timeoutSqlMs: 25
  });
  assert.strictEqual(respostaAquisicao.motivo, "timeout_aquisicao_shadow");
}

function testarPoolShadowSingletonIsolado() {
  const database = require(databasePath);
  const anterior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://shadow-test:shadow-test@127.0.0.1:1/shadow_test";
  const operacional = database.getEnginePool();
  const shadowA = database.getEngineShadowPool();
  const shadowB = database.getEngineShadowPool();
  assert.notStrictEqual(shadowA, operacional);
  assert.strictEqual(shadowA, shadowB);
  assert.strictEqual(shadowA.options.max, 2);
  if (anterior === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = anterior;
}

function testarThrottleSemAlterarPayload() {
  let agora = 1000;
  const linhas = [];
  const throttle = criarThrottleLogIntervalo({
    janelaMs: 5000,
    agora: () => agora,
    log: (...args) => linhas.push(args)
  });
  const rodada = throttle.iniciarRodada({ rodadaId: "a", clienteId: "cliente-a" });
  const payload = { clienteId: "cliente-a", destinoId: "destino-1", motivo: "intervalo_ativo", intervaloMs: 120000 };
  const primeiro = throttle.registrar("[FILA-INTERVALO-AVALIADO]", payload, rodada);
  const segundo = throttle.registrar("[FILA-INTERVALO-AVALIADO]", payload, rodada);
  const resumo = throttle.finalizarRodada(rodada);
  assert.deepStrictEqual(primeiro, { emitido: true, agregado: false });
  assert.deepStrictEqual(segundo, { emitido: false, agregado: true });
  assert.strictEqual(resumo.avaliacoesIntervalo, 2);
  assert.strictEqual(resumo.logsEmitidos, 1);
  assert.strictEqual(resumo.logsSuprimidos, 1);
  assert.strictEqual(linhas.length, 2, "uma amostra e um resumo, sem alterar o payload da amostra");
  assert.strictEqual(linhas[0][1], JSON.stringify(payload));
  throttle.encerrar();
}

async function testarRodadasParalelasTtlETeto() {
  let agora = Date.now();
  const linhas = [];
  const throttle = criarThrottleLogIntervalo({ janelaMs: 1000, maxEntradas: 2, agora: () => agora, log: (...args) => linhas.push(args) });
  const a = throttle.iniciarRodada({ rodadaId: "A", clienteId: "A" });
  const b = throttle.iniciarRodada({ rodadaId: "B", clienteId: "B" });
  throttle.registrar("[FILA-INTERVALO-AVALIADO]", { clienteId: "A", destinoId: "d", motivo: "x" }, a);
  throttle.registrar("[FILA-INTERVALO-AVALIADO]", { clienteId: "B", destinoId: "d", motivo: "x" }, b);
  const resumoA = throttle.finalizarRodada(a);
  const resumoB = throttle.finalizarRodada(b);
  assert.strictEqual(resumoA.clienteId, "A");
  assert.strictEqual(resumoB.clienteId, "B");
  assert.strictEqual(resumoA.avaliacoesIntervalo, 1);
  assert.strictEqual(resumoB.avaliacoesIntervalo, 1);
  throttle.registrar("[FILA-INTERVALO-AVALIADO]", { clienteId: "C", destinoId: "d", motivo: "x" });
  assert.ok(throttle.obterMetricas().tamanhoAtual <= 2);
  agora += 1001;
  await esperar(1100);
  assert.ok(throttle.obterMetricas().entradasExpiradasRemovidas >= 2);
  assert.strictEqual(throttle.obterMetricas().tamanhoAtual, 0, "TTL deve limpar sem novo trafego");
  throttle.encerrar();
}

(async () => {
  await testarConcorrenciaOfcEFailsafe();
  await testarPoolShadowETimeoutSql();
  testarPoolShadowSingletonIsolado();
  testarThrottleSemAlterarPayload();
  await testarRodadasParalelasTtlETeto();
  console.log("p0a-responsividade-shadow.test.js: OK");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
