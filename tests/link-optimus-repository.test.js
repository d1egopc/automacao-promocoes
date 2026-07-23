const assert = require("assert");

const {
  criarLinkOptimus,
  criarLinkOptimusRepository,
  localizarLinkOptimusExistente,
  montarUrlLinkOptimus
} = require("../modules/links");

const config = {
  linksOptimus: {
    ativo: true,
    dominio: "https://go.optimuspromo.com.br/",
    formato: "/r",
    rastrearCliques: true
  },
  linksGerados: {}
};

let salvamentos = 0;
const repository = criarLinkOptimusRepository({
  configBase: config,
  salvarConfig() {
    salvamentos += 1;
  }
});

const criado = criarLinkOptimus("https://afiliado.test/produto?x=1", "mercadolivre", {
  clienteId: "cliente_a",
  configGlobal: config,
  repository
});

assert.strictEqual(criado.ok, true);
assert.strictEqual(criado.reutilizado, false);
assert.ok(criado.codigo);
assert.strictEqual(criado.url, `https://go.optimuspromo.com.br/r/${criado.codigo}`);
assert.strictEqual(salvamentos, 1);

const porCodigo = repository.buscarPorCodigo(criado.codigo);
assert.strictEqual(porCodigo.dados.original, "https://afiliado.test/produto?x=1");
assert.strictEqual(porCodigo.dados.urlOriginal, "https://afiliado.test/produto?x=1");
assert.strictEqual(porCodigo.dados.marketplace, "mercadolivre");
assert.strictEqual(porCodigo.dados.clienteId, "cliente_a");
assert.strictEqual(porCodigo.dados.cliques, 0);
assert.strictEqual(porCodigo.dados.ultimoClique, null);

const porLink = repository.buscarPorLinkOriginal({
  clienteId: "cliente_a",
  linkOriginal: "https://afiliado.test/produto?x=1"
});
assert.strictEqual(porLink.codigo, criado.codigo);

const localizado = localizarLinkOptimusExistente({
  clienteId: "cliente_a",
  linkOriginal: "https://afiliado.test/produto?x=1",
  repository,
  configBase: config
});
assert.strictEqual(localizado.codigo, criado.codigo);
assert.strictEqual(localizado.url, criado.url);

const reutilizado = criarLinkOptimus("https://afiliado.test/produto?x=1", "mercadolivre", {
  clienteId: "cliente_a",
  configGlobal: config,
  repository
});
assert.strictEqual(reutilizado.ok, true);
assert.strictEqual(reutilizado.reutilizado, true);
assert.strictEqual(reutilizado.codigo, criado.codigo);
assert.strictEqual(salvamentos, 1, "reuso nao deve salvar novamente");

repository.incrementarClique(criado.codigo, { agora: "2026-07-22T12:00:00.000Z" });
const clicado = repository.buscarPorCodigo(criado.codigo);
assert.strictEqual(clicado.dados.cliques, 1);
assert.strictEqual(clicado.dados.ultimoClique, "2026-07-22T12:00:00.000Z");
assert.strictEqual(salvamentos, 2);

assert.strictEqual(
  montarUrlLinkOptimus("xyz789", { linksOptimus: { dominio: "" } }, "backend-railway.optimus.test/"),
  "https://backend-railway.optimus.test/r/xyz789"
);

config.linksOptimus.dominio = "";
const railway = criarLinkOptimus("https://afiliado.test/outro", "amazon", {
  clienteId: "cliente_a",
  configGlobal: config,
  repository,
  dominioFallback: "backend-railway.optimus.test/"
});
assert.strictEqual(railway.ok, true);
assert.ok(railway.url.startsWith("https://backend-railway.optimus.test/r/"));

console.log("link-optimus-repository: ok");
