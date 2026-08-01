"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const criarRotasResetEsteirasPreflight = require("../modules/engine/reset-esteiras/preflight.routes");

const tmpRoot = path.join(os.tmpdir(), `reset-esteiras-admin-route-${Date.now()}`);
const WORKSPACE = "user_9hqs434h";

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function filaFile(dataDir, workspaceId = WORKSPACE) {
  return path.join(dataDir, "clientes", workspaceId, "fila.json");
}

function escreverFila(dataDir, workspaceId, fila) {
  const file = filaFile(dataDir, workspaceId);
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(fila, null, 2));
}

function lerFila(dataDir, workspaceId = WORKSPACE) {
  return JSON.parse(fs.readFileSync(filaFile(dataDir, workspaceId), "utf8"));
}

function item(id, extra = {}) {
  return {
    id,
    status: extra.status || "pendente",
    titulo: extra.titulo || `Oferta sigilosa ${id}`,
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
    executarDryRun: deps.executarDryRun,
    executarExecute: deps.executarExecute,
    executarRollback: deps.executarRollback,
    isAdminMaster: (req) => req.usuario?.papel === "admin_master"
  }));
  return app;
}

function ouvir(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, pathUrl, papel, body) {
  const url = `http://127.0.0.1:${server.address().port}${pathUrl}`;
  const headers = {};
  const options = { method: metodo, headers };
  if (papel) headers["x-user-role"] = papel;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  return { status: res.status, body: await res.json() };
}

async function post(server, pathUrl, papel, body) {
  return request(server, "POST", pathUrl, papel, body);
}

async function get(server, pathUrl, papel) {
  return request(server, "GET", pathUrl, papel);
}

(async () => {
  try {
    const dataDir = path.join(tmpRoot, "data");
    escreverFila(dataDir, WORKSPACE, [
      item("exp-1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("exp-2", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("proc-1", { status: "processando", dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("env-1", { status: "enviado", dataEntradaFila: "2026-07-31T20:00:00.000Z" })
    ]);
    escreverFila(dataDir, "user_outro", [
      item("outro", { dataEntradaFila: "2026-07-31T20:00:00.000Z" })
    ]);

    const server = await ouvir(criarApp(dataDir));
    let operationId;
    try {
      const semAuth = await post(server, "/admin/reset-esteiras/dry-run", "", {});
      assert.strictEqual(semAuth.status, 401, "sem autenticacao deve receber 401");

      const comum = await post(server, "/admin/reset-esteiras/dry-run", "cliente", {});
      assert.strictEqual(comum.status, 403, "usuario comum deve receber 403");

      const workspaceDiferente = await post(server, "/admin/reset-esteiras/dry-run", "admin_master", {
        workspaceId: "user_outro",
        confirmacao: "DRY_RUN_USER_9HQS434H"
      });
      assert.strictEqual(workspaceDiferente.status, 403, "workspace diferente deve ser recusado");
      assert.strictEqual(workspaceDiferente.body.erro, "workspace_reset_nao_autorizado");

      const confirmacaoIncorreta = await post(server, "/admin/reset-esteiras/dry-run", "admin_master", {
        workspaceId: WORKSPACE,
        confirmacao: "ERRADA"
      });
      assert.strictEqual(confirmacaoIncorreta.status, 400, "confirmacao incorreta deve ser recusada");

      const parametroLivre = await post(server, "/admin/reset-esteiras/dry-run", "admin_master", {
        workspaceId: WORKSPACE,
        confirmacao: "DRY_RUN_USER_9HQS434H",
        mode: "execute"
      });
      assert.strictEqual(parametroLivre.status, 400, "mode arbitrario deve ser recusado");
      assert.strictEqual(parametroLivre.body.erro, "parametro_nao_permitido");

      criarRotasResetEsteirasPreflight._setEmExecucaoParaTeste(true);
      const conflito = await post(server, "/admin/reset-esteiras/dry-run", "admin_master", {
        workspaceId: WORKSPACE,
        confirmacao: "DRY_RUN_USER_9HQS434H"
      });
      assert.strictEqual(conflito.status, 409, "segunda operacao simultanea deve receber 409");
      assert.strictEqual(conflito.body.erro, "reset_esteira_em_execucao");
      criarRotasResetEsteirasPreflight._resetEstadoParaTeste();

      const filaAntesDryRun = fs.readFileSync(filaFile(dataDir), "utf8");
      const dry = await post(server, "/admin/reset-esteiras/dry-run", "admin_master", {
        workspaceId: WORKSPACE,
        confirmacao: "DRY_RUN_USER_9HQS434H"
      });
      assert.strictEqual(dry.status, 200);
      assert.strictEqual(dry.body.workspaceId, WORKSPACE);
      assert.strictEqual(dry.body.status, "dry_run_concluido");
      assert.strictEqual(dry.body.totalLido, 4);
      assert.strictEqual(dry.body.elegiveis, 2);
      assert.strictEqual(dry.body.rollbackDisponivel, true);
      assert.strictEqual(dry.body.filaAlterada, false, "dry-run nao deve alterar fila");
      assert.strictEqual(fs.readFileSync(filaFile(dataDir), "utf8"), filaAntesDryRun, "fila intacta apos dry-run");
      assert(!JSON.stringify(dry.body).includes("Oferta sigilosa"), "dry-run nao pode vazar payload");
      assert(!JSON.stringify(dry.body).includes("nao_deve_vazar"), "dry-run nao pode vazar campo sensivel");
      operationId = dry.body.operationId;
      assert(operationId, "dry-run deve criar operationId");

      const operacao = await get(server, `/admin/reset-esteiras/operacoes/${operationId}`, "admin_master");
      assert.strictEqual(operacao.status, 200);
      assert.strictEqual(operacao.body.workspaceId, WORKSPACE);
      assert.strictEqual(operacao.body.status, "dry_run_concluido");
      assert.strictEqual(operacao.body.executePermitido, true);
      assert.strictEqual(operacao.body.snapshotDisponivel, true);
      assert(!JSON.stringify(operacao.body).includes("Oferta sigilosa"), "consulta nao pode vazar payload");

      const executeSemDry = await post(server, "/admin/reset-esteiras/execute", "admin_master", {
        workspaceId: WORKSPACE,
        operationId: "op-inexistente",
        confirmOperationId: "op-inexistente",
        confirmacao: "EXECUTAR_RESET_USER_9HQS434H"
      });
      assert.strictEqual(executeSemDry.status, 404, "execute sem dry-run valido deve bloquear");

      const executeDivergente = await post(server, "/admin/reset-esteiras/execute", "admin_master", {
        workspaceId: WORKSPACE,
        operationId,
        confirmOperationId: "outro",
        confirmacao: "EXECUTAR_RESET_USER_9HQS434H"
      });
      assert.strictEqual(executeDivergente.status, 400, "operationId divergente deve bloquear");

      const filaAtual = lerFila(dataDir);
      escreverFila(dataDir, WORKSPACE, [
        item("novo", { dataEntradaFila: "2026-08-01T00:01:00.000Z" }),
        { ...filaAtual[0], status: "processando" },
        filaAtual[1],
        filaAtual[2],
        filaAtual[3]
      ]);

      const execute = await post(server, "/admin/reset-esteiras/execute", "admin_master", {
        workspaceId: WORKSPACE,
        operationId,
        confirmOperationId: operationId,
        confirmacao: "EXECUTAR_RESET_USER_9HQS434H"
      });
      assert.strictEqual(execute.status, 200);
      assert.strictEqual(execute.body.removidos, 1, "execute remove apenas candidato ainda elegivel e identico");
      assert.strictEqual(execute.body.pulados, 1, "processando alterado por concorrencia deve ser pulado");
      const idsDepoisExecute = lerFila(dataDir).map(i => i.id).sort();
      assert.deepStrictEqual(idsDepoisExecute, ["env-1", "exp-1", "novo", "proc-1"].sort(), "processando, novo e historico permanecem");

      const executeRepetido = await post(server, "/admin/reset-esteiras/execute", "admin_master", {
        workspaceId: WORKSPACE,
        operationId,
        confirmOperationId: operationId,
        confirmacao: "EXECUTAR_RESET_USER_9HQS434H"
      });
      assert.strictEqual(executeRepetido.status, 409, "execute repetido sem dry-run limpo deve ser bloqueado");

      const rollback = await post(server, "/admin/reset-esteiras/rollback", "admin_master", {
        workspaceId: WORKSPACE,
        operationId,
        confirmOperationId: operationId,
        confirmacao: "ROLLBACK_RESET_USER_9HQS434H"
      });
      assert.strictEqual(rollback.status, 200);
      assert.strictEqual(rollback.body.restaurados, 1, "rollback deve restaurar removido");
      const rollback2 = await post(server, "/admin/reset-esteiras/rollback", "admin_master", {
        workspaceId: WORKSPACE,
        operationId,
        confirmOperationId: operationId,
        confirmacao: "ROLLBACK_RESET_USER_9HQS434H"
      });
      assert.strictEqual(rollback2.status, 200);
      assert(rollback2.body.pulados >= 1, "rollback repetido nao deve duplicar item");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    const outro = snapshotArquivos(path.join(dataDir, "clientes", "user_outro"));
    assert.strictEqual(outro.length, 1, "outro workspace permanece isolado");
    assert(outro[0].txt.includes("outro"), "outro workspace nao foi tocado");

    const timeoutServer = await ouvir(criarApp(dataDir, {
      timeoutMs: 20,
      executarDryRun: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 100))
    }));
    try {
      const timeout = await post(timeoutServer, "/admin/reset-esteiras/dry-run", "admin_master", {
        workspaceId: WORKSPACE,
        confirmacao: "DRY_RUN_USER_9HQS434H"
      });
      assert.strictEqual(timeout.status, 503, "timeout deve ser controlado");
    } finally {
      await new Promise(resolve => timeoutServer.close(resolve));
    }

    console.log("engine-reset-esteiras-admin-route.test.js OK");
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
