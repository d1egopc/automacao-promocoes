"use strict";

const assert = require("node:assert/strict");
const runnerPath = require.resolve("../optimus-capture/local-worker/task-runner.js");
const produtoUrl = "https://www.mercadolivre.com.br/produto/p/MLB44134240?pdp_filters=item_id%3AMLB7329175430";

function storage(dados) {
  return {
    get: async chave => ({ [chave]: dados[chave] }),
    set: async valor => Object.assign(dados, JSON.parse(JSON.stringify(valor))),
    remove: async chave => { delete dados[chave]; }
  };
}

function erro(codigo, statusHttp = 0, etapa = "") {
  const result = new Error(codigo);
  result.statusHttp = statusHttp;
  result.mlIdentityStage = etapa;
  return result;
}

function ambiente({ resolver, result, failure, taskOverride = {} }) {
  const local = {}, session = {}, failures = [], results = [];
  const task = {
    id: "fixture-ml-identity", type: "identidade_oficial", marketplace: "mercadolivre", capability: "ml_identity_v1",
    productId: "MLB7329175430", sourceUrl: produtoUrl, leaseToken: "lease-privado", attempts: 1,
    ...taskOverride
  };
  global.chrome = {
    storage: { local: storage(local), session: storage(session) },
    alarms: { get: (_nome, callback) => callback(null), create: () => {}, onAlarm: { addListener: () => {} } }
  };
  global.OptimusLocalWorkerClient = {
    claim: async () => ({ task }),
    heartbeat: async () => ({ ok: true }),
    result: async (tarefa, payload) => {
      results.push({ tarefa, payload });
      return result ? result(tarefa, payload) : { ok: true };
    },
    failure: async (tarefa, payload) => {
      failures.push({ tarefa, payload });
      return failure ? failure(tarefa, payload) : { ok: true };
    }
  };
  global.OptimusMercadoLivreIdentityResolver = { resolver };
  delete require.cache[runnerPath];
  const runner = require(runnerPath);
  return { runner, task, local, failures, results };
}

function prova(task) {
  return {
    identidadeValidada: true, tituloOficial: "Carretilha Maruri Black Tamba BG 11 Rol Drag 12kg Esquerda",
    expectedMlb: task.productId, observedMlb: task.productId,
    collectedAt: new Date().toISOString(),
    provaTecnica: { source: "local_first_party", listingId: task.productId, catalogId: "MLB44134240" }
  };
}

async function main() {
  for (const [codigo, statusHttp, etapa] of [
    ["ml_identity_captcha", 200, "consulta_pdp"],
    ["ml_identity_catalogo_sem_prova_anuncio", 200, "parser_produto"],
    ["ml_identity_catalogo_url_invalida", 0, "entrada_url"],
    ["ml_identity_product_ausente", 200, "parser_produto"],
    ["ml_identity_binding_conflitante", 200, "parser_produto"]
  ]) {
    const env = ambiente({ resolver: async () => { throw erro(codigo, statusHttp, etapa); } });
    await env.runner.processar();
    assert.equal(env.failures.length, 1, codigo);
    assert.equal(env.failures[0].payload.motivo, codigo);
    const metadataEsperada = codigo === "ml_identity_captcha"
      ? { etapa, statusHttp, terminal: true, retryable: false }
      : { etapa, statusHttp };
    assert.deepEqual(env.failures[0].payload.metadata, metadataEsperada);
    assert.equal(env.failures[0].tarefa.productId, env.task.productId);
    assert.equal(env.failures[0].tarefa.sourceUrl, produtoUrl);
    assert.equal(env.results.length, 0);
  }

  const parser = ambiente({ resolver: async () => { throw new SyntaxError("token=privado html=<secret>"); } });
  await parser.runner.processar();
  assert.equal(parser.failures[0].payload.motivo, "ml_identity_parser_erro");
  assert.doesNotMatch(JSON.stringify({ motivo: parser.failures[0].payload.motivo, metadata: parser.failures[0].payload.metadata }), /privado|secret|html/);

  const sucesso = ambiente({ resolver: async ({ productId }) => prova({ productId }) });
  await sucesso.runner.processar();
  assert.equal(sucesso.results.length, 1);
  assert.equal(sucesso.failures.length, 0);

  let recapturasLocais = 0;
  const staleLocal = ambiente({
    resolver: async ({ productId }) => {
      recapturasLocais += 1;
      const resultado = prova({ productId });
      resultado.collectedAt = recapturasLocais === 1
        ? new Date(Date.now() - (11 * 60 * 1000)).toISOString()
        : new Date().toISOString();
      return resultado;
    }
  });
  await staleLocal.runner.processar();
  assert.equal(recapturasLocais, 2, "resultado local vencido exige nova coleta");
  assert.equal(staleLocal.results.length, 1);
  assert.equal(staleLocal.failures.length, 0);
  const staleLocalBreadcrumbs = JSON.stringify(staleLocal.local[staleLocal.runner.STORAGE_KEYS.BREADCRUMBS] || []);
  assert.match(staleLocalBreadcrumbs, /ML_IDENTITY_RESULT_REFRESH/);
  assert.match(staleLocalBreadcrumbs, /HEARTBEAT_START/);
  assert.match(staleLocalBreadcrumbs, /HEARTBEAT_OK/);

  let recapturasBackend = 0;
  const staleBackend = ambiente({
    resolver: async ({ productId }) => {
      recapturasBackend += 1;
      return prova({ productId });
    },
    result: async (_task, payload) => {
      if (recapturasBackend === 1) {
        const falha = erro("ml_identity_resultado_stale", 422, "envio_resultado");
        falha.body = { submotivo: "timestamp_expirado" };
        throw falha;
      }
      assert.ok(payload.collectedAt, "a coleta renovada leva timestamp");
      return { ok: true };
    }
  });
  await staleBackend.runner.processar();
  assert.equal(recapturasBackend, 2, "422 stale exige nova coleta oficial");
  assert.equal(staleBackend.results.length, 2);
  assert.equal(staleBackend.failures.length, 0);

  let staleSemProgresso = 0;
  const staleExhausted = ambiente({
    resolver: async ({ productId }) => {
      staleSemProgresso += 1;
      const resultado = prova({ productId });
      resultado.collectedAt = new Date(Date.now() - (11 * 60 * 1000)).toISOString();
      return resultado;
    }
  });
  await staleExhausted.runner.processar();
  assert.equal(staleSemProgresso, 2, "stale repetido tem no máximo uma recaptura");
  assert.equal(staleExhausted.results.length, 0);
  assert.equal(staleExhausted.failures.length, 1);
  assert.equal(staleExhausted.failures[0].payload.motivo, "ml_identity_resultado_stale_timestamp_expirado");
  assert.deepEqual(staleExhausted.failures[0].payload.metadata, {
    etapa: "envio_resultado", statusHttp: 422, terminal: true, retryable: false
  });

  const rejeitado = ambiente({
    resolver: async ({ productId }) => prova({ productId }),
    result: async () => {
      const falha = erro("backend_rejeitou", 0);
      falha.status = 422;
      throw falha;
    }
  });
  await rejeitado.runner.processar();
  assert.equal(rejeitado.failures[0].payload.motivo, "ml_identity_resultado_envio_falhou");
  assert.deepEqual(rejeitado.failures[0].payload.metadata, { etapa: "envio_resultado", statusHttp: 422 });

  let tentativas = 0;
  const envio = ambiente({
    resolver: async ({ productId }) => prova({ productId }),
    result: async () => {
      tentativas += 1;
      const falha = new Error("Failed to fetch token=privado");
      falha.name = "TypeError";
      throw falha;
    }
  });
  await envio.runner.processar();
  assert.equal(envio.failures.length, 0, "primeira falha ambigua preserva reconciliacao do resultado");
  assert.equal(envio.local[envio.runner.STORAGE_KEYS.STATE].stage, envio.runner.STAGES.RESULT_PENDING);
  await envio.runner.processar();
  assert.equal(tentativas, 2);
  assert.equal(envio.failures.length, 1);
  assert.equal(envio.failures[0].payload.motivo, "ml_identity_resultado_envio_falhou");
  assert.deepEqual(envio.failures[0].payload.metadata, { etapa: "envio_resultado", statusHttp: 0 });
  assert.doesNotMatch(JSON.stringify({ motivo: envio.failures[0].payload.motivo, metadata: envio.failures[0].payload.metadata }), /privado/);
  assert.equal(envio.local[envio.runner.STORAGE_KEYS.STATE], undefined);

  let reports = 0;
  const falhaPost = ambiente({
    resolver: async () => { throw erro("ml_identity_captcha", 200, "consulta_pdp"); },
    failure: async () => {
      reports += 1;
      if (reports === 1) throw new TypeError("Failed to fetch token=privado");
      return { ok: true };
    }
  });
  await falhaPost.runner.processar();
  assert.equal(falhaPost.local[falhaPost.runner.STORAGE_KEYS.STATE].stage, falhaPost.runner.STAGES.FAILURE_PENDING);
  assert.equal(falhaPost.local[falhaPost.runner.STORAGE_KEYS.STATE].reportingError, "ml_identity_failure_post_0");
  await falhaPost.runner.processar();
  assert.equal(reports, 2);
  assert.equal(falhaPost.failures[1].payload.motivo, "ml_identity_captcha");
  assert.equal(falhaPost.local[falhaPost.runner.STORAGE_KEYS.STATE], undefined);

  const captchaTerminal = ambiente({
    resolver: async () => { throw erro("ml_pdp_captcha", 200, "consulta_pdp"); }
  });
  await captchaTerminal.runner.processar();
  assert.equal(captchaTerminal.failures.length, 1);
  assert.equal(captchaTerminal.failures[0].payload.motivo, "ml_pdp_captcha");
  assert.deepEqual(captchaTerminal.failures[0].payload.metadata, {
    etapa: "consulta_pdp", statusHttp: 200, terminal: true, retryable: false
  });
  assert.equal(captchaTerminal.local[captchaTerminal.runner.STORAGE_KEYS.STATE], undefined, "CAPTCHA terminal não fica pendente para repetir a mesma navegação");

  const captchaImagem = ambiente({
    taskOverride: { type: "imagem_oficial", capability: "ml_image_v1" },
    resolver: async () => { throw erro("ml_pdp_captcha", 200, "consulta_pdp"); }
  });
  global.OptimusMercadoLivreLocalResolver = {
    resolver: async () => { throw erro("ml_pdp_captcha", 200, "consulta_pdp"); }
  };
  await captchaImagem.runner.processar();
  assert.equal(captchaImagem.failures.length, 1);
  assert.equal(captchaImagem.failures[0].payload.motivo, "ml_pdp_captcha");
  assert.deepEqual(captchaImagem.failures[0].payload.metadata, {
    etapa: "consulta_pdp", statusHttp: 200, terminal: true, retryable: false
  });
  assert.equal(captchaImagem.local[captchaImagem.runner.STORAGE_KEYS.STATE], undefined);

  const expirado = ambiente({
    taskOverride: { expiresAt: new Date(Date.now() - 1000).toISOString() },
    resolver: async () => { throw new Error("resolver não deveria ser chamado após expiração"); }
  });
  await expirado.runner.processar();
  assert.equal(expirado.failures.length, 0);
  assert.equal(expirado.local[expirado.runner.STORAGE_KEYS.STATE], undefined);
  assert.ok(JSON.stringify(expirado.local[expirado.runner.STORAGE_KEYS.BREADCRUMBS] || []).includes("TASK_EXPIRED"));

  console.log("optimus-capture-ml-identity-observability.test.cjs: ok");
}

main().catch(falha => { console.error(falha); process.exitCode = 1; });
