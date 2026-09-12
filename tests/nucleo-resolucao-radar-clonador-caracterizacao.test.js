"use strict";

// Caracterizacao pre-extracao: este teste nao faz HTTP. Os resultados do
// resolver sao fixtures deterministicas; o que fica congelado e o contrato
// que Radar e Bridge entregam imediatamente antes de registrarEventoBruto.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { resolverLinksClonador } = require("../modules/clonador-grupos/bridge");
const { detectarMarketplaceLink } = require("../modules/engine/normalizers");
const { resumoLinksClassificados } = require("../modules/engine/link-role.service");
const { criarContratoPreparacaoLinks } = require("../modules/engine/preparacao-links.service");
const { camposIdentidadeCanonicaOferta } = require("../modules/radar/produto-canonico");
const { dominioRedirectPermitido } = require("../modules/radar/redirect/redirect-resolver");

function extrairFuncao(nome, proximaAssinatura) {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const inicio = fonte.indexOf(`async function ${nome}`);
  assert.ok(inicio >= 0, `${nome} deve continuar existindo no index`);
  const fim = fonte.indexOf(proximaAssinatura, inicio);
  assert.ok(fim > inicio, `${nome} deve manter fronteira conhecida`);
  return fonte.slice(inicio, fim);
}

function carregarPreparadorRadar(resolverLinkOriginalRadar) {
  const corpo = extrairFuncao("prepararLinksRedirectEngineRadar", "async function registrarEventoBrutoEngineRadar");
  // Executa literalmente o corpo atual, mas sem subir o processo principal.
  return new Function(
    "linkRedirectPermitidoRadar",
    "camposIdentidadeCanonicaOferta",
    "resolverLinkOriginalRadar",
    "dominioMarketplaceConhecidoRadar",
    "criarContratoPreparacaoLinks",
    `${corpo}; return prepararLinksRedirectEngineRadar;`
  )(
    dominioRedirectPermitido,
    camposIdentidadeCanonicaOferta,
    resolverLinkOriginalRadar,
    detectarMarketplaceLink,
    criarContratoPreparacaoLinks
  );
}

function produtoAmazon(asin) {
  return `https://www.amazon.com.br/dp/${asin}?tag=origem-20`;
}

function produtoMl(item) {
  return `https://produto.mercadolivre.com.br/${item}-produto-_JM`;
}

function respostaResolvida(url, urlFinal, marketplace, extra = {}) {
  return {
    ok: true,
    urlOriginal: url,
    urlFinal,
    urlExpandida: urlFinal,
    marketplaceDetectado: marketplace,
    marketplaceReal: marketplace,
    status: "resolvido",
    ...extra
  };
}

function respostaFalha(url, motivo) {
  return { ok: false, urlOriginal: url, status: "ignorado", motivo };
}

const URLs = Object.freeze({
  mlDireto: produtoMl("MLB123456789"),
  meli: "https://meli.la/21NMwbA",
  mlSocialValido: "https://meli.la/social-com-card-destacado",
  mlSocialSem: "https://meli.la/social-sem-identidade",
  mlSocialMultiplo: "https://meli.la/social-mlbs-divergentes",
  amazonDireto: produtoAmazon("B0C3T4MFMM"),
  amzn: "https://amzn.to/3abc",
  divulgador: "https://amzn.divulgador.link/xyz",
  amzlink: "https://amzlink.to/xyz",
  amazonSemAsin: "https://amzn.divulguei.app/sem-asin",
  shopeeProduto: "https://shopee.com.br/product/123/456",
  shopeeResgate: "https://shopee.com.br/m/cupom-resgate",
  shopeeCupom: "https://shopee.com.br/cupom/CUPOM10",
  aliProduto: "https://www.aliexpress.com/item/1005001111111111.html",
  aliApp: "https://a.aliexpress.com/_app",
  aliPc: "https://a.aliexpress.com/_pc",
  aliMoedas: "https://a.aliexpress.com/_coins",
  awinKabum: "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123456%2Fteclado",
  awinDivergente: "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F123456%2Fteclado&url=https%3A%2F%2Fevil.example%2Fproduto",
  kabum: "https://www.kabum.com.br/produto/123456/teclado",
  magalu: "https://www.magazineluiza.com.br/produto/p/abc123",
  magaluAfiliado: "https://www.magazinevoce.com.br/magazineparceiro/p/abc123",
  magaluAmbiguo: "https://magazineluiza.onelink.me/ambiguous"
});

// Equivale aos resultados ja cobertos pelo resolver. Links sociais ML
// permanecem sem identidade nesta camada; a prova estruturada e aplicada
// posteriormente pelo adapter ML, nao pelo Bridge.
function resolverFixture(url) {
  if (url === URLs.meli) return respostaResolvida(url, produtoMl("MLB4876269031"), "mercadolivre", {
    chaveCanonica: "mercadolivre:MLB4876269031",
    produtoIdCanonico: "MLB4876269031",
    marketplaceCanonico: "mercadolivre"
  });
  if ([URLs.mlSocialValido, URLs.mlSocialSem, URLs.mlSocialMultiplo].includes(url)) {
    return respostaFalha(url, "identidade_ml_nao_comprovada");
  }
  if (url === URLs.amzn) return respostaResolvida(url, produtoAmazon("B0C3T4MFMM"), "amazon");
  if (url === URLs.divulgador) return respostaResolvida(url, produtoAmazon("B0D4T5MFNN"), "amazon");
  if (url === URLs.amzlink) return respostaResolvida(url, produtoAmazon("B0E5T6MFPP"), "amazon");
  if (url === URLs.amazonSemAsin) return respostaFalha(url, "amazon_shortlink_sem_asin_resolvido");
  return respostaFalha(url, "dominio_redirect_nao_permitido");
}

function resolverRadarFixture(url) {
  const resolucao = resolverFixture(url);
  return {
    ...resolucao,
    linkOriginalLimpo: resolucao.urlExpandida || "",
    urlResolvida: resolucao.urlExpandida || ""
  };
}

function linhas(links) {
  return links.map((url, ordemCaptura) => ({ url_original: url, ordemCaptura: ordemCaptura + 1 }));
}

function papeis(links, texto, marketplace) {
  return resumoLinksClassificados(
    linhas(links),
    { texto_original: texto, links_extraidos: links },
    marketplace
  ).map(item => item.papelLink);
}

const fixtures = [
  { nome: "ML direto", marketplace: "mercadolivre", links: [URLs.mlDireto], esperados: { radar: [URLs.mlDireto], clone: [URLs.mlDireto], papeis: ["desconhecido"] } },
  { nome: "ML meli.la com produto explicito", marketplace: "mercadolivre", links: [URLs.meli], esperados: { radar: [URLs.meli], clone: [produtoMl("MLB4876269031")], papeis: ["desconhecido"] } },
  { nome: "ML social com identidade estruturada", marketplace: "mercadolivre", links: [URLs.mlSocialValido], esperados: { radar: [URLs.mlSocialValido], clone: [URLs.mlSocialValido], papeis: ["desconhecido"], motivoClone: "identidade_ml_nao_comprovada" } },
  { nome: "ML social sem identidade", marketplace: "mercadolivre", links: [URLs.mlSocialSem], esperados: { radar: [URLs.mlSocialSem], clone: [URLs.mlSocialSem], papeis: ["desconhecido"], motivoClone: "identidade_ml_nao_comprovada" } },
  { nome: "ML social com MLBs divergentes", marketplace: "mercadolivre", links: [URLs.mlSocialMultiplo], esperados: { radar: [URLs.mlSocialMultiplo], clone: [URLs.mlSocialMultiplo], papeis: ["desconhecido"], motivoClone: "identidade_ml_nao_comprovada" } },
  { nome: "Amazon direto com ASIN", marketplace: "amazon", links: [URLs.amazonDireto], esperados: { radar: [URLs.amazonDireto], clone: [URLs.amazonDireto], papeis: ["desconhecido"] } },
  { nome: "Amazon amzn.to", marketplace: "amazon", links: [URLs.amzn], esperados: { radar: [produtoAmazon("B0C3T4MFMM")], clone: [produtoAmazon("B0C3T4MFMM")], papeis: ["desconhecido"], redirectsRadar: 1 } },
  { nome: "Amazon amzn.divulgador.link", marketplace: "amazon", links: [URLs.divulgador], esperados: { radar: [produtoAmazon("B0D4T5MFNN")], clone: [produtoAmazon("B0D4T5MFNN")], papeis: ["desconhecido"], redirectsRadar: 1 } },
  { nome: "Amazon amzlink.to", marketplace: "amazon", links: [URLs.amzlink], esperados: { radar: [produtoAmazon("B0E5T6MFPP")], clone: [produtoAmazon("B0E5T6MFPP")], papeis: ["desconhecido"], redirectsRadar: 1 } },
  { nome: "Amazon shortlink sem ASIN", marketplace: "amazon", links: [URLs.amazonSemAsin], esperados: { radar: [URLs.amazonSemAsin], clone: [URLs.amazonSemAsin], papeis: ["desconhecido"], motivoClone: "amazon_shortlink_sem_asin_resolvido", marketplaceEntregue: "", redirectsRadar: 1 } },
  { nome: "Shopee produto e resgate", marketplace: "shopee", texto: `Produto\n${URLs.shopeeProduto}\nResgate\n${URLs.shopeeResgate}`, links: [URLs.shopeeProduto, URLs.shopeeResgate], esperados: { radar: [URLs.shopeeProduto, URLs.shopeeResgate], clone: [URLs.shopeeProduto, URLs.shopeeResgate], papeis: ["produto", "cupom"] } },
  { nome: "Shopee multiplos com cupom auxiliar", marketplace: "shopee", texto: `Produto\n${URLs.shopeeProduto}\nCupom\n${URLs.shopeeCupom}\nResgate\n${URLs.shopeeResgate}`, links: [URLs.shopeeProduto, URLs.shopeeCupom, URLs.shopeeResgate], esperados: { radar: [URLs.shopeeProduto, URLs.shopeeCupom, URLs.shopeeResgate], clone: [URLs.shopeeProduto, URLs.shopeeCupom, URLs.shopeeResgate], papeis: ["produto", "cupom", "cupom"] } },
  { nome: "AliExpress produto PC app moedas", marketplace: "aliexpress", texto: `Produto\n${URLs.aliProduto}\nAPP\n${URLs.aliApp}\nPC\n${URLs.aliPc}\nMoedas\n${URLs.aliMoedas}`, links: [URLs.aliProduto, URLs.aliApp, URLs.aliPc, URLs.aliMoedas], esperados: { radar: [URLs.aliProduto, URLs.aliApp, URLs.aliPc, URLs.aliMoedas], clone: [URLs.aliProduto, URLs.aliApp, URLs.aliPc, URLs.aliMoedas], papeis: ["produto", "link_app", "link_pc", "link_app"] } },
  { nome: "AWIN com ued KaBuM", marketplace: "awin", links: [URLs.awinKabum], esperados: { radar: [URLs.awinKabum], clone: [URLs.awinKabum], papeis: ["produto"], radarCanonica: "kabum:123456" } },
  { nome: "AWIN destino divergente", marketplace: "awin", links: [URLs.awinDivergente], esperados: { radar: [URLs.awinDivergente], clone: [URLs.awinDivergente], papeis: ["produto"], radarCanonica: "kabum:123456" } },
  { nome: "KaBuM nativo", marketplace: "kabum", links: [URLs.kabum], esperados: { radar: [URLs.kabum], clone: [URLs.kabum], papeis: ["produto"], radarCanonica: "kabum:123456" } },
  { nome: "Magalu produto", marketplace: "magalu", links: [URLs.magalu], esperados: { radar: [URLs.magalu], clone: [URLs.magalu], papeis: ["produto"] } },
  { nome: "Magalu afiliado", marketplace: "magalu", links: [URLs.magaluAfiliado], esperados: { radar: [URLs.magaluAfiliado], clone: [URLs.magaluAfiliado], papeis: ["produto"] } },
  { nome: "Magalu ambiguo", marketplace: "magalu", links: [URLs.magaluAmbiguo], esperados: { radar: [URLs.magaluAmbiguo], clone: [URLs.magaluAmbiguo], papeis: ["desconhecido"] } }
];

(async function main() {
  const prepararRadar = carregarPreparadorRadar(resolverRadarFixture);
  const matriz = [];

  for (const fixture of fixtures) {
    const texto = fixture.texto || fixture.links.join("\n");
    const radar = await prepararRadar({ linksExtraidos: fixture.links, textoOriginal: texto });
    const clone = await resolverLinksClonador(fixture.links, resolverFixture);
    const dadosRadar = radar.dados;

    assert.deepStrictEqual(dadosRadar.metadata.linksOriginaisCapturados, fixture.links, `${fixture.nome}: Radar preserva originais`);
    assert.deepStrictEqual(clone.linksOriginais, fixture.links, `${fixture.nome}: Clone preserva originais`);
    assert.deepStrictEqual(dadosRadar.linksExtraidos, fixture.esperados.radar, `${fixture.nome}: saida Radar congelada`);
    assert.deepStrictEqual(clone.linksPreparados, fixture.esperados.clone, `${fixture.nome}: saida Clone congelada`);
    assert.deepStrictEqual(papeis(dadosRadar.linksExtraidos, texto, fixture.marketplace), fixture.esperados.papeis, `${fixture.nome}: papeis Radar`);
    assert.deepStrictEqual(papeis(clone.linksPreparados, texto, fixture.marketplace), fixture.esperados.papeis, `${fixture.nome}: papeis Clone`);
    assert.strictEqual(dadosRadar.linksExtraidos.length, fixture.links.length, `${fixture.nome}: Radar preserva quantidade e ordem`);
    assert.strictEqual(clone.linksPreparados.length, fixture.links.length, `${fixture.nome}: Clone preserva quantidade e ordem`);
    const marketplaceEntregue = Object.prototype.hasOwnProperty.call(fixture.esperados, "marketplaceEntregue")
      ? fixture.esperados.marketplaceEntregue
      : fixture.marketplace;
    assert.strictEqual(dadosRadar.marketplaceDetectado, marketplaceEntregue, `${fixture.nome}: marketplace Radar`);
    assert.strictEqual(clone.redirects.length, fixture.links.length, `${fixture.nome}: Clone registra todos os redirects`);
    assert.deepStrictEqual(
      Object.keys(radar.preparacaoLinks).sort(),
      ["identidadesCanonicas", "linksOriginais", "linksPreparados", "redirects"],
      `${fixture.nome}: Radar entrega contrato comum`
    );
    assert.deepStrictEqual(
      Object.keys(clone).sort(),
      ["identidadesCanonicas", "linksOriginais", "linksPreparados", "redirects"],
      `${fixture.nome}: Clone entrega contrato comum`
    );
    assert.deepStrictEqual(radar.preparacaoLinks.linksOriginais, fixture.links, `${fixture.nome}: contrato Radar originais`);
    assert.deepStrictEqual(radar.preparacaoLinks.linksPreparados, dadosRadar.linksExtraidos, `${fixture.nome}: contrato Radar preparados`);
    assert.deepStrictEqual(radar.preparacaoLinks.redirects, dadosRadar.metadata.redirectsRadar, `${fixture.nome}: contrato Radar redirects`);
    assert.deepStrictEqual(radar.preparacaoLinks.identidadesCanonicas, dadosRadar.metadata.identidadesCanonicas, `${fixture.nome}: contrato Radar identidades`);
    assert.deepStrictEqual(clone.identidadesCanonicas, [], `${fixture.nome}: Clone nao inventa identidade canonica`);
    assert.strictEqual(
      dadosRadar.metadata.redirectsRadar.length,
      fixture.esperados.redirectsRadar || 0,
      `${fixture.nome}: redirects Radar somente para dominio permitido`
    );
    assert.strictEqual(
      clone.redirects.map(item => item.marketplaceDetectado).find(Boolean) || "",
      marketplaceEntregue,
      `${fixture.nome}: marketplace Clone`
    );

    if (fixture.esperados.motivoClone) {
      assert.strictEqual(clone.redirects[0].motivo, fixture.esperados.motivoClone, `${fixture.nome}: motivo do Clone`);
    }
    if (fixture.esperados.radarCanonica) {
      assert.strictEqual(dadosRadar.metadata.identidadesCanonicas[0]?.chaveCanonica, fixture.esperados.radarCanonica, `${fixture.nome}: identidade Radar`);
    }

    matriz.push({
      fixture: fixture.nome,
      marketplace: fixture.marketplace,
      radar: dadosRadar.linksExtraidos,
      clone: clone.linksPreparados,
      redirectsRadar: dadosRadar.metadata.redirectsRadar,
      redirectsClone: clone.redirects,
      identidadesRadar: dadosRadar.metadata.identidadesCanonicas,
      papeis: fixture.esperados.papeis
    });
  }

  // O fixture social valido prova que a aceitacao por card destacado pertence
  // ao adapter ML posterior, nao a esta preparacao pre-evento.
  const socialValido = matriz.find(item => item.fixture === "ML social com identidade estruturada");
  assert.deepStrictEqual(socialValido.radar, [URLs.mlSocialValido]);
  assert.deepStrictEqual(socialValido.clone, [URLs.mlSocialValido]);
  assert.strictEqual(socialValido.redirectsClone[0].motivo, "identidade_ml_nao_comprovada");

  console.log(`nucleo-resolucao-radar-clonador-caracterizacao.test.js ok (${matriz.length} fixtures)`);
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
