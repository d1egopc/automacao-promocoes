"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const criarRotasResetEsteirasPreflight = require("../modules/engine/reset-esteiras/preflight.routes");

const tmpRoot = path.join(os.tmpdir(), `reset-esteiras-preflight-route-${Date.now()}`);

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function filaFile(dataDir, workspaceId) {
  return path.join(dataDir, "clientes", workspaceId, "fila.json");
}

function escreverFila(dataDir, workspaceId, fila) {
  const file = filaFile(dataDir, workspaceId);
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(fila, null, 2));
}

function item(id, extra = {}) {
  return {
    id,
    status: extra.status || "pendente",
    titulo: extra.titulo || `Produto secreto ${id}`,
    token: "nao_deve_vazar",
    dataEntradaFila: extra.dataEntradaFila,
    destinoId: extra.destinoId || "destino-a",
    ofertaId: extra.ofertaId || `oferta-${id}`,
    jobId: extra.jobId || `job-${id}`,
    marketplace: extra.marketplace || "mercadolivre",
    ...extra
  };
}

function snapshotArquivos(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const atual = stack.pop();
    if (!fs.existsSync(atual)) continue;
    const stats = fs.lstatSync(atual);
    if (stats.isDirectory()) {
      for (const nome of fs.readdirSync(atual)) stack.push(path.join(atual, nome));
      continue;
    }
    if (stats.isFile()) {
      out.push({
        rel: path.relative(dir, atual).replace(/\\/g, "/"),
        size: stats.size,
        txt: fs.readFileSync(atual, "utf8")
      });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function criarApp(dataDir, deps = {}) {
  criarRotasResetEsteirasPreflight._resetEstadoParaTeste();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const papel = req.header("x-user-role");
    if (!papel) return res.status(401).json({ ok: false, erro: "nao_autenticado" });
    req.usuario = { papel };
    next();
  });
  app.use("/admin/reset-esteiras", criarRotasResetEsteirasPreflight({
    dataDir,
    timeoutMs: deps.timeoutMs || 30000,
    rateLimitMs: deps.rateLimitMs ?? 0,
    executarPreflight: deps.executarPreflight,
    isAdminMaster: (req) => req.usuario?.papel === "admin_master"
  }));
  return app;
}

function ouvir(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, papel, body = {}) {
  const url = `http://127.0.0.1:${server.address().port}/admin/reset-esteiras/preflight`;
  const headers = { "content-type": "application/json" };
  if (papel) headers["x-user-role"] = papel;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  try {
    const dataDir = path.join(tmpRoot, "data");
    escreverFila(dataDir, "user_9hqs434h", [
      item("exp-1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("proc-1", { status: "processando", dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("sem-ts", { dataEntradaFila: "" }),
      item("env-1", { status: "enviado", dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("ret-1", { status: "retida", dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("err-1", { status: "erro", dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("expirado-1", { status: "expirado", dataEntradaFila: "2026-07-31T20:00:00.000Z" })
    ]);
    escreverFila(dataDir, "user_outro", [
      item("outro-nao-ler", { dataEntradaFila: "2026-07-31T20:00:00.000Z" })
    ]);

    const antes = snapshotArquivos(dataDir);
    const server = await ouvir(criarApp(dataDir));
    try {
      const semAuth = await request(server, "", {});
      assert.strictEqual(semAuth.status, 401, "sem autenticacao deve receber 401");

      const comum = await request(server, "cliente", {});
      assert.strictEqual(comum.status, 403, "usuario comum deve receber 403");

      const workspaceDiferente = await request(server, "admin_master", { workspaceId: "user_outro" });
      assert.strictEqual(workspaceDiferente.status, 403, "workspace diferente deve ser recusado");
      assert.strictEqual(workspaceDiferente.body.erro, "workspace_nao_permitido");

      criarRotasResetEsteirasPreflight._setEmExecucaoParaTeste(true);
      const conflito = await request(server, "admin_master", {});
      assert.strictEqual(conflito.status, 409, "segunda chamada simultanea deve receber 409");
      assert.strictEqual(conflito.body.erro, "preflight_reset_esteira_em_execucao");
      criarRotasResetEsteirasPreflight._resetEstadoParaTeste();

      const ok = await request(server, "admin_master", {});
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.body.workspaceId, "user_9hqs434h");
      assert.strictEqual(ok.body.totalItens, 7);
      assert.strictEqual(ok.body.elegiveisExpiracao, 1);
      assert.strictEqual(ok.body.processandoPreservados, 1);
      assert.strictEqual(ok.body.semTimestamp, 1);
      assert.strictEqual(ok.body.enviadosHistorico, 4);
      assert.strictEqual(ok.body.finais, 3);
      assert.strictEqual(ok.body.aplicouMudancasOperacionais, false);
      assert.strictEqual(ok.body.snapshotCriado, false);
      assert.strictEqual(ok.body.lotesCriados, false);
      assert.strictEqual(ok.body.rollbackCriado, false);
      assert.strictEqual(ok.body.filaAlterada, false);
      assert.strictEqual(typeof ok.body.tamanhoFilaBytes, "number");
      assert.strictEqual(typeof ok.body.persistenteEstimado, "number");
      assert.strictEqual(typeof ok.body.temporarioAtomic, "number");
      assert.strictEqual(typeof ok.body.margemApp, "number");
      assert.strictEqual(typeof ok.body.espacoMinimoNecessario, "number");
      assert(!JSON.stringify(ok.body).includes("Produto secreto"), "resposta nao pode retornar payload da fila");
      assert(!JSON.stringify(ok.body).includes("nao_deve_vazar"), "resposta nao pode retornar campos sensiveis");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    assert.deepStrictEqual(snapshotArquivos(dataDir), antes, "rota preflight nao pode escrever em disco");

    const timeoutServer = await ouvir(criarApp(dataDir, {
      timeoutMs: 20,
      executarPreflight: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 100))
    }));
    try {
      const timeout = await request(timeoutServer, "admin_master", {});
      assert.strictEqual(timeout.status, 503, "timeout deve ser controlado");
      assert.strictEqual(timeout.body.erro, "preflight_reset_esteira_timeout");
    } finally {
      await new Promise(resolve => timeoutServer.close(resolve));
    }

    console.log("engine-reset-esteiras-preflight-route.test.js OK");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    criarRotasResetEsteirasPreflight._resetEstadoParaTeste();
  }
})().catch((erro) => {
  console.error(erro);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  criarRotasResetEsteirasPreflight._resetEstadoParaTeste();
  process.exit(1);
});
