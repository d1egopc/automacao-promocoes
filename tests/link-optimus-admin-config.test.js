const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const linksPuros = require("../modules/links");

const indexPath = path.join(__dirname, "..", "index.js");
const fonte = fs.readFileSync(indexPath, "utf8");

function extrairFuncao(nome) {
  const inicio = fonte.indexOf(`function ${nome}`);
  assert.ok(inicio >= 0, `funcao ${nome} deve existir`);
  const abre = fonte.indexOf(") {", inicio) + 2;
  assert.ok(abre >= 2, `corpo da funcao ${nome} deve existir`);
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    if (fonte[i] === "{") profundidade += 1;
    if (fonte[i] === "}") profundidade -= 1;
    if (profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error(`nao foi possivel extrair ${nome}`);
}

const sandbox = {
  config: {
    linksOptimus: {
      ativo: true,
      dominio: "",
      formato: "/r",
      rastrearCliques: true
    },
    linksGerados: {}
  },
  salvouConfig: 0,
  linksPuros,
  salvarConfig() {
    sandbox.salvouConfig += 1;
  },
  URL,
  process: { env: {} },
  console: {
    log() {}
  }
};

vm.createContext(sandbox);
vm.runInContext([
  extrairFuncao("normalizarDominioLinkOptimus"),
  extrairFuncao("origemDominioLinkOptimus"),
  extrairFuncao("montarRespostaConfigLinksOptimus"),
  extrairFuncao("normalizarDominioConfigLinkOptimus"),
  extrairFuncao("logConfigLinkOptimus"),
  extrairFuncao("adminMasterAutorizadoLinksOptimus"),
  extrairFuncao("responderAdminConfigLinksOptimus"),
  extrairFuncao("salvarAdminConfigLinksOptimus")
].join("\n"), sandbox);

function criarRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function reqAdmin(body = {}) {
  return {
    usuario: { id: "admin", papel: "admin_master" },
    clienteId: "admin",
    body
  };
}

function serializar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

sandbox.process.env = { RAILWAY_PUBLIC_DOMAIN: "automacao-promocoes-production.up.railway.app" };
let res = criarRes();
sandbox.responderAdminConfigLinksOptimus(reqAdmin(), res);
assert.strictEqual(res.statusCode, 200);
assert.deepStrictEqual(serializar(res.body), {
  ok: true,
  linksOptimus: {
    dominio: "",
    dominioEfetivo: "https://automacao-promocoes-production.up.railway.app",
    origem: "railway"
  }
});

res = criarRes();
sandbox.responderAdminConfigLinksOptimus({ usuario: { id: "cliente", papel: "cliente" }, body: {} }, res);
assert.strictEqual(res.statusCode, 403, "usuario comum nao pode consultar");

res = criarRes();
sandbox.salvarAdminConfigLinksOptimus(reqAdmin({ dominio: "https://go.optimuspromo.com.br/" }), res);
assert.strictEqual(res.statusCode, 200);
assert.strictEqual(res.body.linksOptimus.dominio, "https://go.optimuspromo.com.br");
assert.strictEqual(res.body.linksOptimus.dominioEfetivo, "https://go.optimuspromo.com.br");
assert.strictEqual(res.body.linksOptimus.origem, "config");
assert.strictEqual(sandbox.config.linksOptimus.dominio, "https://go.optimuspromo.com.br");
assert.strictEqual(sandbox.salvouConfig, 1);

res = criarRes();
sandbox.salvarAdminConfigLinksOptimus(reqAdmin({ dominio: "https://go.optimuspromo.com.br/caminho" }), res);
assert.strictEqual(res.statusCode, 400, "dominio com caminho deve ser rejeitado");
assert.strictEqual(sandbox.config.linksOptimus.dominio, "https://go.optimuspromo.com.br", "dominio invalido nao altera config");

res = criarRes();
sandbox.salvarAdminConfigLinksOptimus(reqAdmin({ dominio: "" }), res);
assert.strictEqual(res.statusCode, 200);
assert.strictEqual(res.body.linksOptimus.dominio, "");
assert.strictEqual(res.body.linksOptimus.dominioEfetivo, "https://automacao-promocoes-production.up.railway.app");
assert.strictEqual(res.body.linksOptimus.origem, "railway");
assert.strictEqual(sandbox.config.linksOptimus.dominio, "");

res = criarRes();
sandbox.salvarAdminConfigLinksOptimus({ usuario: { id: "cliente", papel: "cliente" }, body: { dominio: "https://go.optimuspromo.com.br" } }, res);
assert.strictEqual(res.statusCode, 403, "usuario comum nao pode alterar");

sandbox.process.env = {};
assert.deepStrictEqual(serializar(sandbox.montarRespostaConfigLinksOptimus(sandbox.config)), {
  dominio: "",
  dominioEfetivo: "",
  origem: "indisponivel"
});

assert.ok(fonte.includes('app.get("/admin/config/links-optimus", responderAdminConfigLinksOptimus);'));
assert.ok(fonte.includes('app.put("/admin/config/links-optimus", salvarAdminConfigLinksOptimus);'));

console.log("link-optimus-admin-config: ok");
