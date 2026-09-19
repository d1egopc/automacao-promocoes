"use strict";

const assert = require("assert");
const express = require("express");
const { criarLocalWorkerRepository } = require("../modules/local-worker/local-worker.repository");
const { criarRotasLocalWorker } = require("../modules/local-worker/local-worker.routes");

function poolFalha({ attempts, maxAttempts }) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql, params });
      const metadata = JSON.parse(params[3]);
      return {
        rows: [{
          id: params[0],
          type: "imagem_oficial",
          marketplace: "magalu",
          product_id: "afh3e1g80j",
          status: attempts >= maxAttempts ? "failed" : "pending",
          capability: "magalu_image_v1",
          attempts,
          max_attempts: maxAttempts,
          result_metadata: metadata
        }]
      };
    }
  };
}

async function falhaTerminalPreservaMotivo() {
  const pool = poolFalha({ attempts: 3, maxAttempts: 3 });
  const repo = criarLocalWorkerRepository({ pool });
  const resposta = await repo.falhar({
    taskId: "5",
    workerId: "worker-1",
    leaseToken: "lease-nao-logado",
    motivo: "magalu_imagem_produto_nao_confirmado",
    metadata: { stage: "RESOLVING_PAGE" }
  });
  const chamada = pool.chamadas[0];
  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.task.status, "failed");
  assert.match(chamada.sql, /result_metadata\s*=\s*\$4::jsonb/);
  assert.doesNotMatch(chamada.sql, /\$5/);
  assert.strictEqual(chamada.params.length, 4, "query nao pode manter parametro sem tipo/uso");
  assert.deepStrictEqual(JSON.parse(chamada.params[3]), {
    stage: "RESOLVING_PAGE",
    motivo: "magalu_imagem_produto_nao_confirmado"
  });
}

async function metadataOpcionalNaoCriaBuracoDeParametro() {
  const pool = poolFalha({ attempts: 1, maxAttempts: 3 });
  const repo = criarLocalWorkerRepository({ pool });
  const resposta = await repo.falhar({
    taskId: "6",
    workerId: "worker-1",
    leaseToken: "lease-nao-logado",
    motivo: "worker_falhou",
    metadata: null
  });
  const chamada = pool.chamadas[0];
  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.task.status, "pending");
  assert.deepStrictEqual(JSON.parse(chamada.params[3]), { motivo: "worker_falhou" });
  assert.deepStrictEqual(chamada.params.slice(0, 3), ["6", "worker-1", "lease-nao-logado"]);
}

async function endpointFailureAceitaMotivoOriginal() {
  const pool = poolFalha({ attempts: 3, maxAttempts: 3 });
  const repo = criarLocalWorkerRepository({ pool });
  const service = {
    autenticar: async () => ({ ok: true, workerId: "worker-1", workerType: "dedicated" }),
    falha: ({ worker, taskId, leaseToken, motivo, metadata }) => repo.falhar({ taskId, workerId: worker.workerId, leaseToken, motivo, metadata })
  };
  const app = express();
  app.use(express.json());
  app.use("/local-worker", criarRotasLocalWorker({ service }));
  const server = await new Promise(resolve => {
    const iniciado = app.listen(0, "127.0.0.1", () => resolve(iniciado));
  });
  try {
    const porta = server.address().port;
    const response = await fetch(`http://127.0.0.1:${porta}/local-worker/tasks/7/failure`, {
      method: "POST",
      headers: { authorization: "Bearer token-teste", "content-type": "application/json" },
      body: JSON.stringify({ leaseToken: "lease-nao-logado", motivo: "magalu_imagem_produto_nao_confirmado", metadata: null })
    });
    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.task.status, "failed");
    assert.strictEqual(JSON.parse(pool.chamadas[0].params[3]).motivo, "magalu_imagem_produto_nao_confirmado");
  } finally {
    await new Promise((resolve, reject) => server.close(erro => erro ? reject(erro) : resolve()));
  }
}

(async () => {
  await falhaTerminalPreservaMotivo();
  await metadataOpcionalNaoCriaBuracoDeParametro();
  await endpointFailureAceitaMotivoOriginal();
  console.log("local-worker-failure.test.js: ok");
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
