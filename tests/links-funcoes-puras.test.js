const assert = require("assert");

const {
  validarUrlHttpHttps,
  normalizarDominioLinkOptimus,
  normalizarFormatoLinkOptimus,
  resolverDominioBaseLinkOptimus,
  montarUrlLinkOptimus,
  origemDominioLinkOptimus,
  montarRespostaConfigLinksOptimus,
  normalizarDominioConfigLinkOptimus,
  extrairLinkAfiliadoOferta,
  copiarOfertaComLinkResolvido,
  normalizarModoLinkDestino
} = require("../modules/links");

assert.strictEqual(validarUrlHttpHttps("https://exemplo.com/produto"), true);
assert.strictEqual(validarUrlHttpHttps("http://exemplo.com/produto"), true);
assert.strictEqual(validarUrlHttpHttps("javascript:alert(1)"), false);
assert.strictEqual(validarUrlHttpHttps("nota uma url"), false);

assert.strictEqual(normalizarDominioLinkOptimus("go.optimuspromo.com.br/"), "https://go.optimuspromo.com.br");
assert.strictEqual(normalizarDominioLinkOptimus("https://go.optimuspromo.com.br/?x=1#topo"), "https://go.optimuspromo.com.br");
assert.strictEqual(normalizarDominioLinkOptimus("ftp://go.optimuspromo.com.br"), "");

assert.strictEqual(normalizarFormatoLinkOptimus("r/"), "/r");
assert.strictEqual(normalizarFormatoLinkOptimus("/r/"), "/r");
assert.strictEqual(normalizarFormatoLinkOptimus(""), "/r");

assert.strictEqual(
  resolverDominioBaseLinkOptimus({ linksOptimus: { dominio: "https://go.optimuspromo.com.br/" } }, "https://railway.test/"),
  "https://go.optimuspromo.com.br"
);
assert.strictEqual(
  resolverDominioBaseLinkOptimus({ linksOptimus: { dominio: "" } }, "railway.test/"),
  "https://railway.test"
);
assert.strictEqual(
  resolverDominioBaseLinkOptimus({ linksOptimus: { dominio: "" } }, ""),
  ""
);

assert.strictEqual(
  montarUrlLinkOptimus("abc123", { linksOptimus: { dominio: "https://go.optimuspromo.com.br/" } }, ""),
  "https://go.optimuspromo.com.br/r/abc123"
);
assert.strictEqual(montarUrlLinkOptimus("", { linksOptimus: { dominio: "https://go.optimuspromo.com.br" } }, ""), "");

assert.deepStrictEqual(
  origemDominioLinkOptimus({ linksOptimus: { dominio: "https://go.optimuspromo.com.br/" } }, "https://railway.test"),
  { dominio: "https://go.optimuspromo.com.br", origem: "config" }
);
assert.deepStrictEqual(
  origemDominioLinkOptimus({ linksOptimus: { dominio: "" } }, "https://railway.test/"),
  { dominio: "https://railway.test", origem: "railway" }
);
assert.deepStrictEqual(
  origemDominioLinkOptimus({ linksOptimus: { dominio: "" } }, ""),
  { dominio: "", origem: "indisponivel" }
);
assert.deepStrictEqual(
  montarRespostaConfigLinksOptimus({ linksOptimus: { dominio: "https://go.optimuspromo.com.br/" } }, "https://railway.test/"),
  {
    dominio: "https://go.optimuspromo.com.br",
    dominioEfetivo: "https://go.optimuspromo.com.br",
    origem: "config"
  }
);

assert.deepStrictEqual(normalizarDominioConfigLinkOptimus(""), { ok: true, dominio: "" });
assert.deepStrictEqual(normalizarDominioConfigLinkOptimus("go.optimuspromo.com.br"), {
  ok: false,
  erro: "dominio_deve_incluir_http_ou_https"
});
assert.deepStrictEqual(normalizarDominioConfigLinkOptimus("https://go.optimuspromo.com.br/path"), {
  ok: false,
  erro: "dominio_nao_deve_conter_caminho_query_ou_fragmento"
});
assert.deepStrictEqual(normalizarDominioConfigLinkOptimus("https://go.optimuspromo.com.br/"), {
  ok: true,
  dominio: "https://go.optimuspromo.com.br"
});

assert.strictEqual(
  extrairLinkAfiliadoOferta({
    linkFinal: "https://final.test",
    link: "https://link.test",
    urlAfiliada: "https://url-afiliada.test",
    url: "https://url.test"
  }),
  "https://final.test"
);
assert.strictEqual(extrairLinkAfiliadoOferta({ link: " https://link.test/produto " }), "https://link.test/produto");

const ofertaOriginal = {
  titulo: "Produto",
  linkAfiliado: "https://afiliado.test/produto",
  linkFinal: "https://final.test/produto"
};
const ofertaCopiada = copiarOfertaComLinkResolvido(
  ofertaOriginal,
  "https://go.optimus.test/r/abc123",
  ofertaOriginal.linkAfiliado
);
assert.notStrictEqual(ofertaCopiada, ofertaOriginal);
assert.strictEqual(ofertaOriginal.linkAfiliado, "https://afiliado.test/produto");
assert.strictEqual(ofertaCopiada.linkAfiliado, "https://go.optimus.test/r/abc123");
assert.strictEqual(ofertaCopiada.linkFinal, "https://go.optimus.test/r/abc123");
assert.strictEqual(ofertaCopiada.link, "https://go.optimus.test/r/abc123");
assert.strictEqual(ofertaCopiada.urlAfiliada, "https://go.optimus.test/r/abc123");
assert.strictEqual(ofertaCopiada.url, "https://go.optimus.test/r/abc123");
assert.strictEqual(ofertaCopiada.linkAfiliadoOriginal, "https://afiliado.test/produto");
assert.strictEqual(ofertaCopiada.linkFinalOriginal, "https://final.test/produto");

assert.strictEqual(normalizarModoLinkDestino("optimus"), "optimus");
assert.strictEqual(normalizarModoLinkDestino("OPTIMUS"), "optimus");
assert.strictEqual(normalizarModoLinkDestino("invalido"), "original");
assert.strictEqual(normalizarModoLinkDestino(""), "original");

console.log("links-funcoes-puras.test.js OK");
