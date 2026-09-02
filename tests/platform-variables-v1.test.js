"use strict";

const assert = require("assert");
const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");

const criarRotasPlatformVariables = require("../modules/platform-variables/platform-variables.routes");
const {
  criarPlatformVariablesService
} = require("../modules/platform-variables/platform-variables.service");
const {
  prepararSchemaPlatformVariables
} = require("../modules/platform-variables/platform-variables.repository");
const {
  criarAdminMasterEstrito
} = require("../utils/admin-auth-estrito");

const MASTER_KEY = "platform-config-master-key-tests-123456";

class RepoMemoria {
  constructor() {
    this.rows = new Map();
    this.schemaChamadas = 0;
  }

  async prepararSchema() {
    this.schemaChamadas += 1;
    return { ok: true };
  }

  async listar() {
    return Array.from(this.rows.values())
      .filter(row => !row.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async buscar(nome) {
    const row = this.rows.get(nome);
    return row && !row.deleted_at ? row : null;
  }

  async salvar({ nome, tipo, encryptedValue, iv, authTag, keyVersion, description, updatedBy }) {
    const anterior = this.rows.get(nome);
    const now = new Date().toISOString();
    const row = {
      name: nome,
      type: tipo,
      encrypted_value: encryptedValue,
      iv,
      auth_tag: authTag,
      key_version: keyVersion,
      sensitive: true,
      description: description || "",
      created_at: anterior?.created_at || now,
      updated_at: now,
      updated_by: updatedBy || null,
      deleted_at: null
    };
    this.rows.set(nome, row);
    return row;
  }

  async excluir(nome, updatedBy) {
    const row = this.rows.get(nome);
    if (!row || row.deleted_at) return false;
    row.deleted_at = new Date().toISOString();
    row.updated_by = updatedBy || null;
    return true;
  }
}

function criarApp({ repo = new RepoMemoria(), env = { PLATFORM_CONFIG_MASTER_KEY: MASTER_KEY } } = {}) {
  const app = express();
  app.use(express.json());

  const secret = "jwt-secret-platform-variables";
  const usuarios = [
    { id: "admin", papel: "admin_master", ativo: true },
    { id: "cliente", papel: "cliente", ativo: true }
  ];
  const authAdmin = criarAdminMasterEstrito({
    jwt,
    getJwtSecret: () => secret,
    getUsuarios: () => usuarios,
    usuarioEhAdminMaster: usuario => usuario?.papel === "admin_master"
  });
  const service = criarPlatformVariablesService({ repository: repo, env });

  app.use("/admin/platform-variables", authAdmin, criarRotasPlatformVariables({ service }));

  return {
    app,
    repo,
    service,
    tokenAdmin: jwt.sign({ clienteId: "admin", papel: "admin_master" }, secret, { expiresIn: "5m" }),
    tokenCliente: jwt.sign({ clienteId: "cliente", papel: "cliente" }, secret, { expiresIn: "5m" })
  };
}

async function request(app, metodo, url, { token = "", body } = {}) {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const dados = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: url,
        method: metodo,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(dados ? { "Content-Type": "application/json", "Content-Length": dados.length } : {})
        }
      }, res => {
        let texto = "";
        res.on("data", chunk => { texto += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: texto ? JSON.parse(texto) : null });
        });
      });
      if (dados) req.write(dados);
      req.end();
    });
  });
}

async function testarSchemaIdempotente() {
  const chamadas = [];
  await prepararSchemaPlatformVariables({
    query: async (sql) => {
      chamadas.push(sql);
      return { ok: true, resultado: { rows: [] } };
    }
  });
  await prepararSchemaPlatformVariables({
    query: async (sql) => {
      chamadas.push(sql);
      return { ok: true, resultado: { rows: [] } };
    }
  });
  assert.ok(chamadas.length >= 4, "schema deve poder ser executado repetidamente");
  assert.ok(chamadas.every(sql => /IF NOT EXISTS/i.test(sql)), "schema deve ser idempotente");
}

(async () => {
  await testarSchemaIdempotente();

  const { app, repo, service, tokenAdmin, tokenCliente } = criarApp();
  const valorSecret = "super-segredo-teste-12345";

  const semToken = await request(app, "GET", "/admin/platform-variables");
  assert.strictEqual(semToken.status, 401, "usuario anonimo nao acessa");

  const cliente = await request(app, "GET", "/admin/platform-variables", { token: tokenCliente });
  assert.strictEqual(cliente.status, 403, "usuario comum nao acessa");

  const listaInicial = await request(app, "GET", "/admin/platform-variables", { token: tokenAdmin });
  assert.strictEqual(listaInicial.status, 200, "Admin Master acessa");
  assert.deepStrictEqual(listaInicial.body.variaveis, []);

  const logs = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => logs.push(args.join(" "));
  console.warn = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const criada = await request(app, "POST", "/admin/platform-variables", {
      token: tokenAdmin,
      body: { nome: "TEST_SECRET", tipo: "secret", valor: valorSecret, description: "segredo de teste" }
    });
    assert.strictEqual(criada.status, 201, "cria variavel");
    assert.strictEqual(criada.body.variavel.nome, "TEST_SECRET");
    assert.strictEqual(criada.body.variavel.tipo, "secret");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(criada.body.variavel, "value"), false, "secret nao volta em claro");
    assert.ok(criada.body.variavel.masked, "secret volta apenas mascarado");
  } finally {
    console.log = originais.log;
    console.warn = originais.warn;
    console.error = originais.error;
  }
  assert.ok(!logs.join("\n").includes(valorSecret), "logs nao expoem valor");

  const row = repo.rows.get("TEST_SECRET");
  assert.ok(row, "variavel foi persistida");
  assert.ok(!Object.prototype.hasOwnProperty.call(row, "value_plaintext"), "storage nao tem plaintext");
  assert.ok(!JSON.stringify(row).includes(valorSecret), "valor armazenado no PostgreSQL nao fica em plaintext");

  const interno = await service.getPlatformVariable("TEST_SECRET");
  assert.strictEqual(interno.ok, true, "descriptografia interna funciona");
  assert.strictEqual(interno.value, valorSecret);

  const serviceReiniciado = criarPlatformVariablesService({
    repository: repo,
    env: { PLATFORM_CONFIG_MASTER_KEY: MASTER_KEY }
  });
  const depoisRestart = await serviceReiniciado.getPlatformVariable("TEST_SECRET");
  assert.strictEqual(depoisRestart.value, valorSecret, "persistencia nao depende de memoria do service anterior");

  const atualizada = await request(app, "PUT", "/admin/platform-variables/TEST_SECRET", {
    token: tokenAdmin,
    body: { tipo: "secret", valor: "novo-segredo-67890", description: "novo valor" }
  });
  assert.strictEqual(atualizada.status, 200, "update substitui");
  const internoAtualizado = await service.getPlatformVariable("TEST_SECRET");
  assert.strictEqual(internoAtualizado.value, "novo-segredo-67890");
  assert.notStrictEqual(row.iv, repo.rows.get("TEST_SECRET").iv, "IV muda a cada gravacao");

  const criadaUrl = await request(app, "POST", "/admin/platform-variables", {
    token: tokenAdmin,
    body: { nome: "PUBLIC_URL_TEST", tipo: "url", valor: "https://exemplo.local/callback" }
  });
  assert.strictEqual(criadaUrl.status, 201);
  assert.strictEqual(criadaUrl.body.variavel.value, "https://exemplo.local/callback");

  const criadaBool = await request(app, "POST", "/admin/platform-variables", {
    token: tokenAdmin,
    body: { nome: "FLAG_TESTE", tipo: "boolean", valor: true }
  });
  assert.strictEqual(criadaBool.status, 201);
  assert.strictEqual(criadaBool.body.variavel.value, true);

  const discordSecretTexto = await request(app, "POST", "/admin/platform-variables", {
    token: tokenAdmin,
    body: { nome: "DISCORD_BOT_TOKEN", tipo: "text", valor: "discord-bot-token-nao-vaza" }
  });
  assert.strictEqual(discordSecretTexto.status, 201, "Discord bot token pode ser salvo pelo painel");
  assert.strictEqual(discordSecretTexto.body.variavel.tipo, "secret", "Discord bot token e secret por nome");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(discordSecretTexto.body.variavel, "value"), false, "Discord bot token nao volta em claro mesmo se enviado como text");
  assert.ok(!JSON.stringify(discordSecretTexto.body).includes("discord-bot-token-nao-vaza"), "API nao vaza token Discord");
  const discordSecretInterno = await service.getPlatformVariable("DISCORD_BOT_TOKEN");
  assert.strictEqual(discordSecretInterno.value, "discord-bot-token-nao-vaza", "Resolvedor interno descriptografa token Discord");

  const discordClientSecretTexto = await request(app, "POST", "/admin/platform-variables", {
    token: tokenAdmin,
    body: { nome: "DISCORD_CLIENT_SECRET", tipo: "url", valor: "discord-client-secret-nao-vaza" }
  });
  assert.strictEqual(discordClientSecretTexto.status, 201);
  assert.strictEqual(discordClientSecretTexto.body.variavel.tipo, "secret", "Discord client secret e secret por nome");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(discordClientSecretTexto.body.variavel, "value"), false);
  assert.ok(!JSON.stringify(discordClientSecretTexto.body).includes("discord-client-secret-nao-vaza"), "API nao vaza client secret Discord");

  const remover = await request(app, "DELETE", "/admin/platform-variables/TEST_SECRET", { token: tokenAdmin });
  assert.strictEqual(remover.status, 200, "delete remove");
  const depoisDelete = await service.getPlatformVariable("TEST_SECRET");
  assert.strictEqual(depoisDelete.ok, false);

  const appSemChave = criarApp({ env: {}, repo: new RepoMemoria() });
  const listaSemChave = await request(appSemChave.app, "GET", "/admin/platform-variables", {
    token: appSemChave.tokenAdmin
  });
  assert.strictEqual(listaSemChave.status, 503, "master key ausente falha fechado tambem na leitura");

  const falhaSemChave = await request(appSemChave.app, "POST", "/admin/platform-variables", {
    token: appSemChave.tokenAdmin,
    body: { nome: "SEM_CHAVE", tipo: "text", valor: "nao persiste" }
  });
  assert.strictEqual(falhaSemChave.status, 503, "master key ausente falha fechado");
  assert.strictEqual(appSemChave.repo.rows.size, 0, "sem master key nao persiste valor");

  console.log("platform-variables-v1.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
