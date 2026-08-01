"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const repository = require("../modules/storage-manager/storage.repository");
const criarRotasStorageManager = require("../modules/storage-manager/storage.routes");

const tmpRoot = path.join(os.tmpdir(), `osm-incremental-test-${Date.now()}`);

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, content) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, content);
}

function json(file, value) {
  write(file, JSON.stringify(value, null, 2));
}

function filaItem(id, status, extra = {}) {
  return {
    id,
    status,
    titulo: `Payload privado ${id}`,
    token: "token_nao_pode_sair",
    cookie: "cookie_nao_pode_sair",
    dataEntradaFila: extra.dataEntradaFila,
    marketplace: extra.marketplace || "mercadolivre",
    destino: extra.destino || "whatsapp"
  };
}

function criarDataDir() {
  const dataDir = path.join(tmpRoot, "data");
  const antigo = "2026-07-31T00:00:00.000Z";
  const recente = new Date().toISOString();
  json(path.join(dataDir, "clientes", "user_a", "fila.json"), [
    filaItem("a1", "enviado", { dataEntradaFila: antigo }),
    filaItem("a2", "pendente", { dataEntradaFila: recente }),
    filaItem("a3", "pendente", { dataEntradaFila: antigo }),
    filaItem("a4", "processando", { dataEntradaFila: antigo }),
    filaItem("a5", "retida", { dataEntradaFila: antigo }),
    filaItem("a6", "misterioso", { dataEntradaFila: antigo }),
    { id: "sem_ts", status: "pendente", titulo: "Payload sem timestamp" }
  ]);
  json(path.join(dataDir, "clientes", "user_b", "fila.json"), [
    filaItem("b1", "pendente", { dataEntradaFila: antigo, marketplace: "shopee", destino: "telegram" })
  ]);
  write(path.join(dataDir, "clientes", "user_a", "config.json"), "{}");
  write(path.join(dataDir, "logs", "app.log"), "log\n".repeat(10));
  write(path.join(dataDir, "tmp", "cache.tmp"), "tmp");
  write(path.join(dataDir, "cache", "imagem.webp"), "cache");
  write(path.join(dataDir, "reset-esteiras", "op", "manifest.json"), "{}");
  write(path.join(dataDir, "baileys-auth", "sessao", "creds.json"), "credencial_nao_pode_sair");
  return dataDir;
}

function snapshot(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const atual = stack.pop();
    if (!fs.existsSync(atual)) continue;
    const stats = fs.lstatSync(atual);
    if (stats.isDirectory()) {
      for (const nome of fs.readdirSync(atual)) stack.push(path.join(atual, nome));
    } else if (stats.isFile()) {
      out.push({ rel: path.relative(dir, atual).replace(/\\/g, "/"), size: stats.size, txt: fs.readFileSync(atual, "utf8") });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function criarApp(dataDir) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const papel = req.header("x-user-role");
    if (!papel) return res.status(401).json({ ok: false, erro: "nao_autenticado" });
    req.usuario = { papel };
    next();
  });
  app.use("/admin/storage", criarRotasStorageManager({
    dataDir,
    timeoutMs: 5000,
    isAdminMaster: (req) => req.usuario?.papel === "admin_master"
  }));
  return app;
}

function ouvir(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, papel) {
  const url = `http://127.0.0.1:${server.address().port}${caminho}`;
  const headers = {};
  if (papel) headers["x-user-role"] = papel;
  const res = await fetch(url, { method: metodo, headers });
  return { status: res.status, body: await res.json() };
}

(async () => {
  try {
    const dataDir = criarDataDir();
    const antes = snapshot(dataDir);
    criarRotasStorageManager._resetEstadoParaTeste();
    const server = await ouvir(criarApp(dataDir));

    try {
      const originalInventario = repository.inventariarVolume;
      repository.inventariarVolume = () => {
        throw new Error("health_nao_deve_varrer_volume");
      };
      const health = await request(server, "GET", "/admin/storage/health", "admin_master");
      repository.inventariarVolume = originalInventario;
      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.body.ok, true);
      assert(!health.body.inventario, "health nao deve devolver inventario completo");

      const semAuth = await request(server, "GET", "/admin/storage/diretorios", "");
      assert.strictEqual(semAuth.status, 401);

      const comum = await request(server, "GET", "/admin/storage/diretorios", "cliente");
      assert.strictEqual(comum.status, 403);

      const dirPagina1 = await request(server, "GET", "/admin/storage/diretorios?limit=1&topFiles=1", "admin_master");
      assert.strictEqual(dirPagina1.status, 200);
      assert.strictEqual(dirPagina1.body.processados, 1);
      assert(dirPagina1.body.nextCursor, "primeira pagina deve informar nextCursor");

      const dirPagina2 = await request(server, `GET`, `/admin/storage/diretorios?limit=1&cursor=${encodeURIComponent(dirPagina1.body.nextCursor)}`, "admin_master");
      assert.strictEqual(dirPagina2.status, 200);
      assert.strictEqual(dirPagina2.body.processados, 1);

      const cursorInvalido = await request(server, "GET", "/admin/storage/diretorios?cursor=cursor-invalido", "admin_master");
      assert.strictEqual(cursorInvalido.status, 400);
      assert.strictEqual(cursorInvalido.body.erro, "cursor_storage_invalido");

      const workspaces = await request(server, "GET", "/admin/storage/workspaces?limit=1", "admin_master");
      assert.strictEqual(workspaces.status, 200);
      assert.strictEqual(workspaces.body.workspaces.length, 1);
      assert(workspaces.body.nextCursor, "workspaces deve paginar");

      const workspace = await request(server, "GET", "/admin/storage/workspaces/user_a?topFiles=5", "admin_master");
      assert.strictEqual(workspace.status, 200);
      assert.strictEqual(workspace.body.workspace.workspaceId, "user_a");
      assert.strictEqual(workspace.body.workspace.fila.totalItens, 7);
      assert.strictEqual(workspace.body.workspace.fila.pendentesRecentes, 1);
      assert.strictEqual(workspace.body.workspace.fila.pendentesVencidos, 1);
      assert.strictEqual(workspace.body.workspace.fila.processando, 1);
      assert.strictEqual(workspace.body.workspace.fila.statusDesconhecido, 1);
      assert.strictEqual(workspace.body.workspace.fila.semTimestamp, 1);

      const traversal = await request(server, "GET", "/admin/storage/workspaces/..%2F..%2FWindows", "admin_master");
      assert([400, 404].includes(traversal.status), "path traversal deve ser bloqueado");

      const inexistente = await request(server, "GET", "/admin/storage/workspaces/user_inexistente", "admin_master");
      assert.strictEqual(inexistente.status, 404);

      const filas = await request(server, "GET", "/admin/storage/filas?limit=1", "admin_master");
      assert.strictEqual(filas.status, 200);
      assert.strictEqual(filas.body.filas.length, 1);
      assert(filas.body.nextCursor, "filas deve paginar");

      const categoria = await request(server, "GET", "/admin/storage/categoria/logs?limit=5", "admin_master");
      assert.strictEqual(categoria.status, 200);
      assert.strictEqual(categoria.body.categoria, "logs");
      assert(categoria.body.arquivos.length >= 1);

      const categoriaInvalida = await request(server, "GET", "/admin/storage/categoria/clientes", "admin_master");
      assert.strictEqual(categoriaInvalida.status, 400);

      criarRotasStorageManager._setEscopoEmExecucaoParaTeste("filas", true);
      const conflitoMesmoEscopo = await request(server, "GET", "/admin/storage/filas", "admin_master");
      assert.strictEqual(conflitoMesmoEscopo.status, 409);
      const outroEscopo = await request(server, "GET", "/admin/storage/diretorios?limit=1", "admin_master");
      assert.strictEqual(outroEscopo.status, 200, "escopos diferentes podem executar sem corrida indevida");
      criarRotasStorageManager._resetEstadoParaTeste();

      const parcial = await repository.auditarCategoriaIncremental("logs", {
        dataDir,
        timeoutMs: 1000,
        deadlineMs: Date.now() - 1,
        limit: 5
      });
      assert.strictEqual(parcial.parcial, true);
      assert.strictEqual(parcial.timeoutAtingido, true);

      const payload = JSON.stringify({ workspace: workspace.body, filas: filas.body, categoria: categoria.body });
      assert(!payload.includes("Payload privado"), "payload da fila nao pode sair");
      assert(!payload.includes("token_nao_pode_sair"), "token da fila nao pode sair");
      assert(!payload.includes("cookie_nao_pode_sair"), "cookie da fila nao pode sair");
      assert(!payload.includes("credencial_nao_pode_sair"), "conteudo de sessao nao pode sair");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepStrictEqual(snapshot(dataDir), antes, "auditoria incremental nao pode escrever nem alterar arquivos");
    console.log("storage-manager-incremental.test.js OK");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch(erro => {
  console.error(erro);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
