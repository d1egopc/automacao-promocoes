"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");

const criarRotasClonadorGrupos = require("../modules/clonador-grupos/routes");
const {
  criarRepositorioClonadorGrupos
} = require("../modules/clonador-grupos/repository");
const {
  MAX_FONTES_ATIVAS
} = require("../modules/clonador-grupos");

const raiz = path.resolve(__dirname, "..");

function clone(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function criarRepoMemoria() {
  const estado = {
    configs: new Map(),
    fontes: new Map(),
    destinos: new Map()
  };

  return {
    estado,
    async lerConfig(clienteId) {
      return clone(estado.configs.get(clienteId) || { clienteId, ativo: false });
    },
    async salvarConfig(clienteId, dados = {}) {
      const config = {
        clienteId,
        ativo: dados.ativo === true,
        atualizadoEm: "2026-09-06T12:00:00.000Z"
      };
      estado.configs.set(clienteId, config);
      return clone(config);
    },
    async listarFontes(clienteId) {
      return clone(estado.fontes.get(clienteId) || []);
    },
    async substituirFontes(clienteId, fontes = []) {
      const salvas = fontes.map((fonte, index) => ({
        id: String(index + 1),
        clienteId,
        ...fonte
      }));
      estado.fontes.set(clienteId, salvas);
      return clone(salvas);
    },
    async listarDestinos(clienteId) {
      return clone(estado.destinos.get(clienteId) || []);
    },
    async substituirDestinos(clienteId, destinoIds = []) {
      const salvos = destinoIds.map((destinoId, index) => ({
        id: String(index + 1),
        clienteId,
        destinoId
      }));
      estado.destinos.set(clienteId, salvos);
      return clone(salvos);
    }
  };
}

function criarApp(repo, overrides = {}) {
  const app = express();
  app.use(express.json());

  const sessoes = {
    workspace_a: ["a_sessao_1", "a_sessao_2"],
    workspace_b: ["b_sessao_1"]
  };
  const grupos = {
    workspace_a: {
      a_sessao_1: [
        { id: "a_grupo_1@g.us", nome: "Grupo A 1" },
        { id: "a_grupo_2@g.us", nome: "Grupo A 2" },
        { id: "a_grupo_3@g.us", nome: "Grupo A 3" },
        { id: "a_grupo_4@g.us", nome: "Grupo A 4" },
        { id: "a_grupo_5@g.us", nome: "Grupo A 5" }
      ],
      a_sessao_2: [
        { id: "a_grupo_6@g.us", nome: "Grupo A 6" }
      ]
    },
    workspace_b: {
      b_sessao_1: [
        { id: "b_grupo_1@g.us", nome: "Grupo B 1" }
      ]
    }
  };
  const destinos = {
    workspace_a: [
      { id: "destino_a_whats", nome: "Destino A", tipo: "whatsapp", ativo: true, horarioInicio: "08:00" },
      { id: "destino_a_tg", nome: "Destino A TG", tipo: "telegram", ativo: true, limiteDiario: 10 }
    ],
    workspace_b: [
      { id: "destino_b_whats", nome: "Destino B", tipo: "whatsapp", ativo: true }
    ]
  };
  const recursos = {
    workspace_a: true,
    workspace_b: true,
    workspace_sem_recurso: false
  };

  app.use("/clonador-grupos", criarRotasClonadorGrupos({
    repository: repo,
    getClienteId: (req) => req.header("x-cliente-id") || "",
    usuarioTemRecurso: (req, recurso) => recurso === "clonador_grupos" && recursos[req.header("x-cliente-id")] === true,
    listarSessoesWorkspace: (clienteId) => sessoes[clienteId] || [],
    listarGruposSessao: (clienteId, sessaoId) => grupos[clienteId]?.[sessaoId] || [],
    listarDestinosOficiais: (clienteId) => destinos[clienteId] || [],
    ...overrides
  }));

  return app;
}

function ouvir(app) {
  return new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function request(server, metodo, caminho, clienteId, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers = {
    "x-cliente-id": clienteId
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: caminho,
      method: metodo,
      headers
    }, (res) => {
      let dados = "";
      res.on("data", chunk => { dados += chunk; });
      res.on("end", () => resolve({
        status: res.statusCode,
        body: dados ? JSON.parse(dados) : null
      }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fontes(qtd, ativo = true) {
  return Array.from({ length: qtd }, (_, index) => ({
    sessaoId: "a_sessao_1",
    grupoJid: `a_grupo_${index + 1}@g.us`,
    ativo
  }));
}

function criarDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function cloneMapListas(mapa) {
  const novo = new Map();
  for (const [chave, valor] of mapa.entries()) {
    novo.set(chave, clone(valor));
  }
  return novo;
}

function linhaFonte(clienteId, grupoJid, sessaoId = "sessao_1") {
  return {
    id: "1",
    cliente_id: clienteId,
    sessao_id: sessaoId,
    grupo_jid: grupoJid,
    grupo_nome: grupoJid,
    ativo: true,
    criado_em: "2026-09-06T12:00:00.000Z",
    atualizado_em: "2026-09-06T12:00:00.000Z"
  };
}

function linhaDestino(clienteId, destinoId) {
  return {
    id: "1",
    cliente_id: clienteId,
    destino_id: destinoId,
    criado_em: "2026-09-06T12:00:00.000Z",
    atualizado_em: "2026-09-06T12:00:00.000Z"
  };
}

function fontesRepo(prefixo, qtd) {
  return Array.from({ length: qtd }, (_, index) => ({
    sessaoId: `${prefixo}_sessao`,
    grupoJid: `${prefixo}_grupo_${index + 1}@g.us`,
    grupoNome: `Grupo ${prefixo} ${index + 1}`,
    ativo: true
  }));
}

function criarPoolPgMemoria(opcoes = {}) {
  const estado = {
    fontes: new Map(),
    destinos: new Map(),
    locksAtivos: new Set(),
    filasLock: new Map(),
    lockWaiters: new Map(),
    chamadas: [],
    proximoId: 1
  };

  function snapshot() {
    return {
      fontes: cloneMapListas(estado.fontes),
      destinos: cloneMapListas(estado.destinos)
    };
  }

  function aplicar(tx) {
    estado.fontes = tx.fontes;
    estado.destinos = tx.destinos;
  }

  function notificarLock(chave) {
    const waiters = estado.lockWaiters.get(chave) || [];
    estado.lockWaiters.delete(chave);
    waiters.forEach(resolve => resolve());
  }

  async function aguardarLock(chave) {
    if (estado.locksAtivos.has(chave) || estado.chamadas.includes(`LOCK ${chave}`)) return;
    await new Promise(resolve => {
      const waiters = estado.lockWaiters.get(chave) || [];
      waiters.push(resolve);
      estado.lockWaiters.set(chave, waiters);
    });
  }

  function liberarLocks(client) {
    for (const chave of client.locks) {
      estado.locksAtivos.delete(chave);
      const fila = estado.filasLock.get(chave) || [];
      const proximo = fila.shift();
      if (fila.length) estado.filasLock.set(chave, fila);
      else estado.filasLock.delete(chave);
      if (proximo) proximo();
    }
    client.locks = [];
  }

  async function adquirirLock(client, namespace, clienteId) {
    const chave = `${namespace}|${clienteId}`;
    if (estado.locksAtivos.has(chave)) {
      estado.chamadas.push(`WAIT ${chave}`);
      await new Promise(resolve => {
        const fila = estado.filasLock.get(chave) || [];
        fila.push(resolve);
        estado.filasLock.set(chave, fila);
      });
    }

    estado.locksAtivos.add(chave);
    client.locks.push(chave);
    client.tx = snapshot();
    estado.chamadas.push(`LOCK ${chave}`);
    notificarLock(chave);

    if (typeof opcoes.depoisLock === "function") {
      await opcoes.depoisLock({ namespace, clienteId, chave });
    }

    return { rows: [] };
  }

  function deveFalharInsert(tipo) {
    const chave = tipo === "fontes" ? "falharInsertFontes" : "falharInsertDestinos";
    return typeof opcoes[chave] === "function" ? opcoes[chave]() : opcoes[chave] === true;
  }

  function criarClient() {
    return {
      tx: null,
      locks: [],
      async query(sql, params = []) {
        const compacto = String(sql || "").replace(/\s+/g, " ").trim();
        estado.chamadas.push(compacto);

        if (compacto === "BEGIN") {
          this.tx = snapshot();
          return { rows: [] };
        }
        if (compacto === "COMMIT") {
          aplicar(this.tx);
          liberarLocks(this);
          return { rows: [] };
        }
        if (compacto === "ROLLBACK") {
          liberarLocks(this);
          return { rows: [] };
        }
        if (compacto.includes("pg_advisory_xact_lock")) {
          return adquirirLock(this, params[0], params[1]);
        }
        if (compacto.startsWith("DELETE FROM clonador_grupos_fontes")) {
          this.tx.fontes.delete(params[0]);
          return { rows: [], rowCount: 1 };
        }
        if (compacto.startsWith("DELETE FROM clonador_grupos_destinos")) {
          this.tx.destinos.delete(params[0]);
          return { rows: [], rowCount: 1 };
        }
        if (compacto.includes("INSERT INTO clonador_grupos_fontes")) {
          if (deveFalharInsert("fontes")) throw new Error("falha_insert_fontes");
          const clienteId = params[0];
          const linhas = JSON.parse(params[1]).map(fonte => ({
            id: String(estado.proximoId++),
            cliente_id: clienteId,
            sessao_id: fonte.sessao_id,
            grupo_jid: fonte.grupo_jid,
            grupo_nome: fonte.grupo_nome,
            ativo: fonte.ativo !== false,
            criado_em: "2026-09-06T12:00:00.000Z",
            atualizado_em: "2026-09-06T12:00:00.000Z"
          }));
          this.tx.fontes.set(clienteId, linhas);
          return { rows: clone(linhas), rowCount: linhas.length };
        }
        if (compacto.includes("INSERT INTO clonador_grupos_destinos")) {
          if (deveFalharInsert("destinos")) throw new Error("falha_insert_destinos");
          const clienteId = params[0];
          const linhas = JSON.parse(params[1]).map(destino => ({
            id: String(estado.proximoId++),
            cliente_id: clienteId,
            destino_id: destino.destino_id,
            criado_em: "2026-09-06T12:00:00.000Z",
            atualizado_em: "2026-09-06T12:00:00.000Z"
          }));
          this.tx.destinos.set(clienteId, linhas);
          return { rows: clone(linhas), rowCount: linhas.length };
        }
        throw new Error(`sql_nao_suportado_no_teste: ${compacto}`);
      },
      release() {
        estado.chamadas.push("RELEASE");
      }
    };
  }

  async function queryEngine(sql, params = []) {
    const compacto = String(sql || "").replace(/\s+/g, " ").trim();
    estado.chamadas.push(`QE ${compacto}`);
    if (compacto.startsWith("CREATE TABLE")) return { ok: true, resultado: { rows: [] } };
    if (compacto.includes("FROM clonador_grupos_fontes")) {
      return { ok: true, resultado: { rows: clone(estado.fontes.get(params[0]) || []) } };
    }
    if (compacto.includes("FROM clonador_grupos_destinos")) {
      return { ok: true, resultado: { rows: clone(estado.destinos.get(params[0]) || []) } };
    }
    return { ok: true, resultado: { rows: [] } };
  }

  return {
    estado,
    queryEngine,
    pool: {
      connect: async () => criarClient()
    },
    aguardarLock
  };
}

async function testarRepositorioTransacional() {
  {
    const pg = criarPoolPgMemoria({ falharInsertFontes: true });
    pg.estado.fontes.set("workspace_a", [linhaFonte("workspace_a", "fonte_antiga@g.us")]);
    const repo = criarRepositorioClonadorGrupos({ queryEngine: pg.queryEngine, pool: pg.pool });
    await assert.rejects(
      () => repo.substituirFontes("workspace_a", fontesRepo("nova", 1)),
      /falha_insert_fontes/
    );
    const fontesAtuais = await repo.listarFontes("workspace_a");
    assert.deepStrictEqual(fontesAtuais.map(fonte => fonte.grupoJid), ["fonte_antiga@g.us"]);
    assert.ok(pg.estado.chamadas.includes("ROLLBACK"), "falha no insert de fontes deve rollbackar");
  }

  {
    const pg = criarPoolPgMemoria({ falharInsertDestinos: true });
    pg.estado.destinos.set("workspace_a", [linhaDestino("workspace_a", "destino_antigo")]);
    const repo = criarRepositorioClonadorGrupos({ queryEngine: pg.queryEngine, pool: pg.pool });
    await assert.rejects(
      () => repo.substituirDestinos("workspace_a", ["destino_novo"]),
      /falha_insert_destinos/
    );
    const destinosAtuais = await repo.listarDestinos("workspace_a");
    assert.deepStrictEqual(destinosAtuais.map(destino => destino.destinoId), ["destino_antigo"]);
    assert.ok(pg.estado.chamadas.includes("ROLLBACK"), "falha no insert de destinos deve rollbackar");
  }

  {
    const bloqueio = criarDeferred();
    let bloqueouPrimeira = false;
    const pg = criarPoolPgMemoria({
      depoisLock: ({ chave }) => {
        if (chave === "clonador_grupos:fontes|workspace_a" && !bloqueouPrimeira) {
          bloqueouPrimeira = true;
          return bloqueio.promise;
        }
        return null;
      }
    });
    const repo = criarRepositorioClonadorGrupos({ queryEngine: pg.queryEngine, pool: pg.pool });
    const primeira = repo.substituirFontes("workspace_a", fontesRepo("primeira", 4));
    await pg.aguardarLock("clonador_grupos:fontes|workspace_a");

    let segundaConcluiu = false;
    const segunda = repo.substituirFontes("workspace_a", fontesRepo("segunda", 4))
      .then(resultado => {
        segundaConcluiu = true;
        return resultado;
      });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(segundaConcluiu, false, "PUT concorrente da mesma workspace deve aguardar lock");

    bloqueio.resolve();
    await Promise.all([primeira, segunda]);
    const finais = (await repo.listarFontes("workspace_a")).map(fonte => fonte.grupoJid);
    assert.strictEqual(finais.length, 4);
    assert.ok(
      finais.every(jid => jid.startsWith("primeira_")) || finais.every(jid => jid.startsWith("segunda_")),
      "estado final deve ser completo de uma unica substituicao"
    );
    assert.ok(!finais.some(jid => jid.startsWith("primeira_")) || !finais.some(jid => jid.startsWith("segunda_")));
    assert.ok(pg.estado.chamadas.includes("WAIT clonador_grupos:fontes|workspace_a"));
  }

  {
    const bloqueioA = criarDeferred();
    const pg = criarPoolPgMemoria({
      depoisLock: ({ chave }) => chave === "clonador_grupos:fontes|workspace_a" ? bloqueioA.promise : null
    });
    const repo = criarRepositorioClonadorGrupos({ queryEngine: pg.queryEngine, pool: pg.pool });
    let aConcluiu = false;
    const operacaoA = repo.substituirFontes("workspace_a", fontesRepo("a", 4))
      .then(resultado => {
        aConcluiu = true;
        return resultado;
      });
    await pg.aguardarLock("clonador_grupos:fontes|workspace_a");

    const resultadoB = await repo.substituirFontes("workspace_b", fontesRepo("b", 4));
    assert.strictEqual(resultadoB.length, 4);
    assert.strictEqual(aConcluiu, false, "workspace B nao deve aguardar lock da workspace A");
    bloqueioA.resolve();
    await operacaoA;
  }

  {
    const pg = criarPoolPgMemoria();
    const repo = criarRepositorioClonadorGrupos({ queryEngine: pg.queryEngine, pool: pg.pool });
    assert.deepStrictEqual(await repo.substituirFontes("workspace_regressao", []), []);
    assert.strictEqual((await repo.substituirFontes("workspace_regressao", fontesRepo("uma", 1))).length, 1);
    assert.strictEqual((await repo.substituirFontes("workspace_regressao", fontesRepo("quatro", 4))).length, 4);
    await assert.rejects(
      () => repo.substituirFontes("workspace_regressao", fontesRepo("cinco", 5)),
      erro => erro.codigo === "limite_fontes_ativas_excedido" && erro.detalhes?.limite === MAX_FONTES_ATIVAS
    );
    const troca = await repo.substituirFontes("workspace_regressao", fontesRepo("troca", 4));
    assert.strictEqual(troca.length, 4);
    assert.ok(troca.every(fonte => fonte.grupoJid.startsWith("troca_")));
  }
}

async function main() {
  await testarRepositorioTransacional();

  const repo = criarRepoMemoria();
  const app = criarApp(repo);
  const server = await ouvir(app);

  try {
    const semRecurso = await request(server, "GET", "/clonador-grupos/config", "workspace_sem_recurso");
    assert.strictEqual(semRecurso.status, 403);
    assert.strictEqual(semRecurso.body.recurso, "clonador_grupos");

    const inicialA = await request(server, "GET", "/clonador-grupos/config", "workspace_a");
    assert.strictEqual(inicialA.status, 200);
    assert.strictEqual(inicialA.body.config.ativo, false);

    const ativaA = await request(server, "PUT", "/clonador-grupos/config", "workspace_a", { ativo: true });
    assert.strictEqual(ativaA.status, 200);
    assert.strictEqual(ativaA.body.config.ativo, true);

    const configB = await request(server, "GET", "/clonador-grupos/config", "workspace_b");
    assert.strictEqual(configB.status, 200);
    assert.strictEqual(configB.body.config.ativo, false);

    const gruposA = await request(server, "GET", "/clonador-grupos/grupos", "workspace_a");
    assert.strictEqual(gruposA.status, 200);
    assert.ok(gruposA.body.grupos.some(grupo => grupo.grupoJid === "a_grupo_1@g.us"));
    assert.ok(!gruposA.body.grupos.some(grupo => grupo.grupoJid === "b_grupo_1@g.us"));

    const sessaoBPorA = await request(server, "GET", "/clonador-grupos/grupos?sessaoId=b_sessao_1", "workspace_a");
    assert.strictEqual(sessaoBPorA.status, 403);
    assert.strictEqual(sessaoBPorA.body.codigo, "sessao_fora_workspace");

    for (const qtd of [0, 1, MAX_FONTES_ATIVAS]) {
      const resposta = await request(server, "PUT", "/clonador-grupos/fontes", "workspace_a", { fontes: fontes(qtd) });
      assert.strictEqual(resposta.status, 200, `${qtd} fontes deve ser aceito`);
      assert.strictEqual(resposta.body.fontes.filter(fonte => fonte.ativo !== false).length, qtd);
    }

    const cinco = await request(server, "PUT", "/clonador-grupos/fontes", "workspace_a", { fontes: fontes(5) });
    assert.strictEqual(cinco.status, 400);
    assert.strictEqual(cinco.body.codigo, "limite_fontes_ativas_excedido");
    assert.strictEqual(cinco.body.limite, MAX_FONTES_ATIVAS);

    const trocaUma = await request(server, "PUT", "/clonador-grupos/fontes", "workspace_a", {
      fontes: [
        ...fontes(3),
        { sessaoId: "a_sessao_2", grupoJid: "a_grupo_6@g.us", ativo: true }
      ]
    });
    assert.strictEqual(trocaUma.status, 200);
    assert.strictEqual(trocaUma.body.fontes.length, 4);

    const grupoBPorA = await request(server, "PUT", "/clonador-grupos/fontes", "workspace_a", {
      fontes: [{ sessaoId: "a_sessao_1", grupoJid: "b_grupo_1@g.us" }]
    });
    assert.strictEqual(grupoBPorA.status, 403);
    assert.strictEqual(grupoBPorA.body.codigo, "grupo_fora_sessao_workspace");

    const sessaoBSelecionadaPorA = await request(server, "PUT", "/clonador-grupos/fontes", "workspace_a", {
      fontes: [{ sessaoId: "b_sessao_1", grupoJid: "b_grupo_1@g.us" }]
    });
    assert.strictEqual(sessaoBSelecionadaPorA.status, 403);
    assert.strictEqual(sessaoBSelecionadaPorA.body.codigo, "sessao_fora_workspace");

    const destinosA = await request(server, "GET", "/clonador-grupos/destinos", "workspace_a");
    assert.strictEqual(destinosA.status, 200);
    assert.deepStrictEqual(destinosA.body.destinos.map(destino => destino.destinoId), ["destino_a_whats", "destino_a_tg"]);

    const destinoBPorA = await request(server, "PUT", "/clonador-grupos/destinos", "workspace_a", {
      destinoIds: ["destino_b_whats"]
    });
    assert.strictEqual(destinoBPorA.status, 403);
    assert.strictEqual(destinoBPorA.body.codigo, "destino_fora_workspace");

    const salvaDestinoA = await request(server, "PUT", "/clonador-grupos/destinos", "workspace_a", {
      destinoIds: ["destino_a_whats"]
    });
    assert.strictEqual(salvaDestinoA.status, 200);
    assert.deepStrictEqual(salvaDestinoA.body.destinos, [
      { id: "1", clienteId: "workspace_a", destinoId: "destino_a_whats" }
    ]);

    const appReload = criarApp(repo);
    const serverReload = await ouvir(appReload);
    try {
      const configReload = await request(serverReload, "GET", "/clonador-grupos/config", "workspace_a");
      assert.strictEqual(configReload.body.config.ativo, true);
      const fontesReload = await request(serverReload, "GET", "/clonador-grupos/fontes", "workspace_a");
      assert.strictEqual(fontesReload.body.fontes.length, 4);
      const destinosReload = await request(serverReload, "GET", "/clonador-grupos/destinos/selecionados", "workspace_a");
      assert.deepStrictEqual(destinosReload.body.destinos.map(destino => destino.destinoId), ["destino_a_whats"]);
    } finally {
      await new Promise(resolve => serverReload.close(resolve));
    }

    const fonteIndex = fs.readFileSync(path.join(raiz, "index.js"), "utf8");
    const fonteBootstrap = fs.readFileSync(path.join(raiz, "utils", "clean-install-bootstrap.js"), "utf8");
    const fonteModulo = [
      "modules/clonador-grupos/routes.js",
      "modules/clonador-grupos/service.js",
      "modules/clonador-grupos/repository.js"
    ].map(relativo => fs.readFileSync(path.join(raiz, relativo), "utf8")).join("\n");

    assert.ok(fonteIndex.includes("criarRotasClonadorGrupos"));
    assert.ok(fonteIndex.includes("usuarioTemRecurso,"));
    assert.ok(fonteModulo.includes('usuarioTemRecurso(req, "clonador_grupos")'));
    assert.ok(fonteIndex.includes('clonador_grupos: booleanPlano("clonador_grupos", recursosAnteriores.clonador_grupos)'));
    assert.ok(fonteBootstrap.includes("clonador_grupos"));
    assert.ok(!/messages\.upsert|registrarEventoBruto|processarFila|debitarCreditos|usuarioTemCreditos|resolverRedirectUniversal/.test(fonteModulo));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log("clonador-grupos-foundation.test.js OK");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
