"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  gerarLinkAfiliadoMagaluSeguro,
  classificarLinkMagalu,
  linkPertenceLojaMagalu,
  montarUrlLojaProdutoMagalu,
  normalizarPromoterIdMagalu,
  normalizarSlugLojaMagalu,
  slugsLojaMagalu,
  caminhoPareceProdutoMagalu
} = require("../modules/marketplaces/magalu/magalu-affiliate-link");

const urlProduto = "https://www.magazineluiza.com.br/smart-tv-50/p/abc123/et/elit/?utm_source=x";
const urlLojaCorreta = "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/";
const urlLojaSemPrefixo = "https://www.magazinevoce.com.br/d1egopc/night-caviar-100ml-paris-elysses/p/be172949ba/pf/ppfm/";
const urlOutraLoja = "https://www.magazinevoce.com.br/magazineoutraloja/smart-tv-50/p/abc123/et/elit/";
const oneLinkPortal = "https://magazineluiza.onelink.me/589508454/herbiqvt";

assert.strictEqual(normalizarPromoterIdMagalu(" d1egopc "), "d1egopc");
assert.strictEqual(normalizarPromoterIdMagalu("https://www.magazinevoce.com.br/magazined1egopc/"), "magazined1egopc");
assert.strictEqual(normalizarSlugLojaMagalu("d1egopc"), "magazined1egopc");
assert.strictEqual(normalizarSlugLojaMagalu("magazined1egopc"), "magazined1egopc");
assert.deepStrictEqual(slugsLojaMagalu("d1egopc").sort(), ["d1egopc", "magazined1egopc"].sort());
assert.deepStrictEqual(slugsLojaMagalu("magazined1egopc").sort(), ["d1egopc", "magazined1egopc"].sort());

const montado = montarUrlLojaProdutoMagalu(urlProduto, normalizarSlugLojaMagalu("d1egopc"));
assert.strictEqual(
  montado,
  "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/?utm_source=x",
  "d1egopc deve virar slug de loja observado magazined1egopc"
);
assert.strictEqual(linkPertenceLojaMagalu(montado, "d1egopc"), true);
assert.strictEqual(linkPertenceLojaMagalu(urlOutraLoja, "d1egopc"), false);

const convertido = gerarLinkAfiliadoMagaluSeguro(urlProduto, "d1egopc");
assert.strictEqual(convertido.comprovado, true);
assert.strictEqual(convertido.tipoLink, "magazinevoce_loja_produto");
assert.strictEqual(convertido.urlAfiliada, montado);
assert.strictEqual(convertido.proveniencia, "conversao_dominio_oficial_para_loja_configurada");
assert.deepStrictEqual(convertido.avisos, []);

const originalClassificado = classificarLinkMagalu(urlProduto, "d1egopc");
assert.strictEqual(originalClassificado.tipoLink, "magazineluiza_original");
assert.strictEqual(originalClassificado.comprovado, false);
assert.strictEqual(originalClassificado.urlAfiliada, "");
assert.ok(originalClassificado.avisos.includes("magalu_url_original_nao_e_afiliada"));

const lojaCorreta = gerarLinkAfiliadoMagaluSeguro(urlLojaCorreta, "d1egopc");
assert.strictEqual(lojaCorreta.comprovado, true);
assert.strictEqual(lojaCorreta.tipoLink, "magazinevoce_loja");
assert.strictEqual(lojaCorreta.urlAfiliada, urlLojaCorreta);

const lojaSemPrefixo = gerarLinkAfiliadoMagaluSeguro(urlLojaSemPrefixo, "d1egopc");
assert.strictEqual(lojaSemPrefixo.comprovado, true, "deep link /d1egopc deve pertencer ao promoter configurado");
assert.strictEqual(lojaSemPrefixo.tipoLink, "magazinevoce_loja");
assert.strictEqual(lojaSemPrefixo.urlAfiliada, urlLojaSemPrefixo);
assert.strictEqual(linkPertenceLojaMagalu(urlLojaSemPrefixo, "magazined1egopc"), true);

const lojaDivergente = gerarLinkAfiliadoMagaluSeguro(urlOutraLoja, "d1egopc");
assert.strictEqual(lojaDivergente.comprovado, false);
assert.strictEqual(lojaDivergente.urlAfiliada, "");
assert.strictEqual(lojaDivergente.tipoLink, "magazinevoce_outra_loja");
assert.ok(lojaDivergente.avisos.includes("magalu_link_loja_divergente"));

const oneLink = gerarLinkAfiliadoMagaluSeguro(oneLinkPortal, "d1egopc");
assert.strictEqual(oneLink.tipoLink, "onelink_magalu");
assert.strictEqual(oneLink.comprovado, false, "OneLink conhecido nao prova promoter sozinho");
assert.strictEqual(oneLink.urlAfiliada, "");
assert.ok(oneLink.avisos.includes("magalu_onelink_classificado_sem_prova_de_promoter"));

const semPromoter = gerarLinkAfiliadoMagaluSeguro(urlProduto, "");
assert.strictEqual(semPromoter.comprovado, false);
assert.strictEqual(semPromoter.urlAfiliada, "");
assert.ok(semPromoter.avisos.includes("magalu_promoter_ausente"));

const invalido = gerarLinkAfiliadoMagaluSeguro("https://example.com/produto/p/abc123/", "d1egopc");
assert.strictEqual(invalido.comprovado, false);
assert.strictEqual(invalido.urlAfiliada, "");
assert.strictEqual(invalido.tipoLink, "host_nao_suportado");

const semProduto = gerarLinkAfiliadoMagaluSeguro("https://www.magazineluiza.com.br/busca/tv/", "d1egopc");
assert.strictEqual(semProduto.comprovado, false);
assert.strictEqual(semProduto.urlAfiliada, "");
assert.ok(semProduto.avisos.includes("magalu_url_sem_caminho_de_produto"));

assert.strictEqual(caminhoPareceProdutoMagalu("/smart-tv/p/abc123/et/elit/"), true);
assert.strictEqual(caminhoPareceProdutoMagalu("/produto/123456"), true);
assert.strictEqual(caminhoPareceProdutoMagalu("/busca/tv/"), false);

const fonte = fs.readFileSync(
  path.join(__dirname, "..", "modules", "marketplaces", "magalu", "magalu-affiliate-link.js"),
  "utf8"
);

for (const proibido of [
  "processarFila",
  "adicionarOfertaInicioFila",
  "prepararOfertaGlobal",
  "fila.json",
  "Engine",
  "Radar",
  "Distributor",
  "Oferta Universal",
  "Manual V2",
  "manual-v2",
  "importarMagalu",
  "/importar-magalu-manual",
  "farejarMagalu",
  "getIntegracaoCliente"
]) {
  assert.ok(!fonte.includes(proibido), `link seguro Magalu nao deve referenciar ${proibido}`);
}

console.log("magalu-affiliate-link.test.js ok");
