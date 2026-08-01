"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const service = require("../modules/storage-manager/storage.service");
const repository = require("../modules/storage-manager/storage.repository");
const criarRotasStorageManager = require("../modules/storage-manager/storage.routes");
const { CLASSIFICACAO_STORAGE } = require("../modules/storage-manager/storage.types");

const tmpRoot = path.join(os.tmpdir(), `osm-test-${Date.now()}`);

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
    titulo: `Produto secreto ${id}`,
    token: "nao_deve_aparecer",
    dataEntradaFila: extra.dataEntradaFila || "2026-08-01T00:00:00.000Z",
    marketplace: extra.marketplace || "mercadolivre",
    destino: extra.destino || "whatsapp"
  };
}

function criarDataDir() {
  const dataDir = path.join(tmpRoot, "data");
  json(path.join(dataDir, "clientes", "user_a", "fila.json"), [
    filaItem("e1", "enviado"),
    filaItem("p1", "pendente", { dataEntradaFila: new Date().toISOString() }),
    filaItem("p2", "pendente", { dataEntradaFila: "2026-07-31T00:00:00.000Z" }),
    filaItem("r1", "retida"),
    filaItem("x1", "misterioso"),
    { id: "sem_ts", status: "pendente", segredo: "nao_deve_vazar" }
  ]);
  write(path.join(dataDir, "clientes", "user_a", "config.json"), "{}\n");
  write(path.join(dataDir, "clientes", "user_b", "fila.json"), "{ json invalido");
  write(path.join(dataDir, "baileys-auth", "sessao-principal", "creds.json"), "credencial-falsa-nao-deve-aparecer");
  write(path.join(dataDir, "reset-esteiras", "op1", "manifest.json"), "{}\n");
  write(path.join(dataDir, "logs", "app.log"), "linha de log\n".repeat(50));
  write(path.join(dataDir, "tmp", "arquivo.tmp"), "tmp".repeat(100));
  write(path.join(dataDir, "cache", "imagem.webp"), "img".repeat(200));
  return dataDir;
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
      out.push({ rel: path.relative(dir, atual).replace(/\\/g, "/"), size: stats.size, txt: fs.readFileSync(atual, "utf8") });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function criarAppRotas(dataDir) {
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
    timeoutMs: 10000,
    isAdminMaster: (req) => req.usuario?.papel === "admin_master"
  }));
  return app;
}

function ouvir(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, metodo, caminho, papel, body) {
  const url = `http://127.0.0.1:${server.address().port}${caminho}`;
  const headers = {};
  if (papel) headers["x-user-role"] = papel;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(url, {
    method: metodo,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  try {
    const dataDir = criarDataDir();

    const antes = snapshotArquivos(dataDir);
    const diagnostico = service.gerarDiagnosticoStorage({ dataDir, top: 20, recentMinutes: 30 });
    const depois = snapshotArquivos(dataDir);

    assert.deepStrictEqual(depois, antes, "OSM nao pode escrever, apagar ou alterar arquivos");
    assert.strictEqual(diagnostico.ok, true);
    assert.strictEqual(diagnostico.modo, "somente_leitura");
    assert.strictEqual(diagnostico.aplicouMudancas, false);
    assert.strictEqual(diagnostico.seguranca.naoApaga, true);
    assert.strictEqual(diagnostico.seguranca.naoAlteraFilas, true);
    assert(diagnostico.health.score >= 0 && diagnostico.health.score <= 100, "health deve ficar entre 0 e 100");

    const filas = diagnostico.filas.workspaces.user_a;
    assert.strictEqual(filas.totalItens, 6);
    assert.strictEqual(filas.enviadosHistorico, 1);
    assert.strictEqual(filas.pendentesRecentes, 1);
    assert.strictEqual(filas.pendentesVencidos, 1);
    assert.strictEqual(filas.finais, 1);
    assert.strictEqual(filas.semTimestamp, 1);
    assert.strictEqual(filas.statusDesconhecido, 1);
    assert(diagnostico.filas.erros.some(erro => erro.workspaceId === "user_b"), "fila invalida deve gerar erro sanitizado sem abortar auditoria");

    const payload = JSON.stringify(diagnostico);
    assert(!payload.includes("nao_deve_aparecer"), "payload de item nao pode vazar no diagnostico");
    assert(!payload.includes("credencial-falsa"), "conteudo de sessao nao pode vazar no diagnostico");
    assert(!payload.includes("nao_deve_vazar"), "segredo de payload nao pode vazar no diagnostico");

    assert.strictEqual(service.classificarCategoria("logs").classificacao, CLASSIFICACAO_STORAGE.VERMELHO);
    assert.strictEqual(service.classificarCategoria("sessoes_auth_whatsapp").classificacao, CLASSIFICACAO_STORAGE.VERDE);

    const inventario = repository.inventariarVolume({ dataDir, top: 5 });
    assert(inventario.maiorArquivo, "inventario deve apontar maior arquivo");
    assert(inventario.maiorDiretorio, "inventario deve apontar maior diretorio");
    assert(inventario.maiorWorkspace.workspaceId === "user_a", "inventario deve apontar maior workspace");

    criarRotasStorageManager._resetEstadoParaTeste();
    const server = await ouvir(criarAppRotas(dataDir));
    try {
      const semAuth = await request(server, "GET", "/admin/storage/health", "", null);
      assert.strictEqual(semAuth.status, 401, "sem autenticacao deve receber 401");

      const comum = await request(server, "GET", "/admin/storage/health", "cliente", null);
      assert.strictEqual(comum.status, 403, "usuario comum deve receber 403");

      const health = await request(server, "GET", "/admin/storage/health", "admin_master", null);
      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.body.ok, true);
      assert.strictEqual(health.body.auditoriaEmExecucao, false);
      assert.strictEqual(health.body.ultimaAuditoria, null);

      const audit = await request(server, "POST", "/admin/storage/auditar?dataDir=C:/Windows&top=9999", "admin_master", { dataDir: "C:/Windows", top: 9999 });
      assert.strictEqual(audit.status, 200);
      assert.strictEqual(audit.body.ok, true);
      assert.strictEqual(audit.body.auditoriaMonoliticaDesativada, true, "rota monolitica deve apenas orientar uso incremental");

      const filasIncremental = await request(server, "GET", "/admin/storage/filas?dataDir=C:/Windows&limit=1", "admin_master", null);
      assert.strictEqual(filasIncremental.status, 200);
      assert.strictEqual(filasIncremental.body.ok, true);
      assert(filasIncremental.body.filas.some(fila => fila.workspaceId === "user_a"), "rota incremental deve usar somente dataDir injetado/oficial");
      assert(!JSON.stringify(filasIncremental.body).includes("Produto secreto"), "rota incremental nao deve retornar payload de oferta");

      criarRotasStorageManager._setEscopoEmExecucaoParaTeste("filas", true);
      const conflito = await request(server, "GET", "/admin/storage/filas", "admin_master", null);
      assert.strictEqual(conflito.status, 409, "segunda auditoria simultanea deve receber 409");
      assert.strictEqual(conflito.body.erro, "auditoria_storage_em_execucao");
      criarRotasStorageManager._resetEstadoParaTeste();
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    assert.deepStrictEqual(snapshotArquivos(dataDir), antes, "rotas OSM nao podem escrever em disco");

    console.log("storage-manager.test.js OK");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch((erro) => {
  console.error(erro);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
