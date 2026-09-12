"use strict";

const assert = require("assert");
const {
  importarShopeeEngine,
  montarVisaoOcorrenciasShopeeClonador
} = require("../modules/engine/importer/adapters/shopee.adapter");

const PRODUTO = "https://www.shopee.com.br/product/111111111/222222222";
const RESGATE = "https://www.shopee.com.br/m/cupom-a";
const CUPOM = "https://www.shopee.com.br/cupom/CUPOM10";
const AUSENTE = "https://www.shopee.com.br/m/nao-correlato";

function linha(url) {
  return { url_original: url, url_normalizada: url, url_expandida: url };
}

function ocorrencia(urlOriginal, ordemCaptura, mensagemId = "msg") {
  return { urlOriginal, ordemCaptura, ocorrenciaId: `clonador:${mensagemId}:${ordemCaptura}` };
}

function depsFixture(rastreio) {
  return {
    getIntegracaoCliente: () => ({ credenciais: { appId: "app", secret: "secret" } }),
    gerarShortLinkShopee: async url => {
      rastreio.resgates.push(url);
      return { ok: true, shortLink: `https://s.shopee.com.br/resgate${rastreio.resgates.length}` };
    },
    expandirShortlinkShopee: async url => rastreio.resgates.includes(RESGATE) && /resgate\d+$/i.test(url) ? RESGATE : "",
    importarShopee: async url => {
      rastreio.importacoes.push(url);
      assert.strictEqual(url, PRODUTO, "somente o candidato tecnico de produto pode importar");
      return {
        ok: true,
        titulo: "Produto Shopee de Fixture",
        precoAtual: "99,90",
        preco: "99,90",
        imagem: "https://img.test/shopee.jpg",
        imagemOrigem: "fixture",
        linkAfiliado: "https://s.shopee.com.br/afiliadoProduto",
        linkFinal: "https://s.shopee.com.br/afiliadoProduto",
        link: "https://s.shopee.com.br/afiliadoProduto",
        linkOriginal: PRODUTO,
        linkExpandido: PRODUTO,
        shopId: "111111111",
        itemId: "222222222",
        categoria: "Shopee"
      };
    }
  };
}

async function executar({ links, texto, ocorrencias = null }) {
  const rastreio = { importacoes: [], resgates: [] };
  const metadata = ocorrencias ? { clonadorGrupos: { linksOcorrencias: ocorrencias } } : {};
  const resultado = await importarShopeeEngine({
    job: { id: 10, evento_id: 20, cliente_id: "workspace" },
    evento: { texto_original: texto, links_extraidos: links.map(item => item.url_original), marketplace: "shopee", metadata },
    links,
    deps: depsFixture(rastreio)
  });
  assert.strictEqual(resultado.ok, true);
  return { resultado, rastreio };
}

function contratoFuncional(resultado) {
  return {
    linkOriginal: resultado.linkOriginal,
    linkAfiliado: resultado.linkAfiliado,
    linksComerciais: resultado.linksComerciais,
    linksProduto: resultado.linksProduto,
    linksResgate: resultado.linksResgate,
    titulo: resultado.titulo,
    preco: resultado.preco,
    cupom: resultado.cupom,
    beneficioTexto: resultado.beneficioTexto
  };
}

async function testarDuplicataProdutoPassiva() {
  const texto = `Produto: ${PRODUTO}\nProduto novamente: ${PRODUTO}`;
  const baseline = await executar({ links: [linha(PRODUTO)], texto });
  const clone = await executar({
    links: [linha(PRODUTO)],
    texto,
    ocorrencias: [ocorrencia(PRODUTO, 1), ocorrencia(PRODUTO, 2)]
  });

  assert.deepStrictEqual(contratoFuncional(clone.resultado), contratoFuncional(baseline.resultado));
  assert.deepStrictEqual(clone.rastreio, baseline.rastreio);
  assert.strictEqual(clone.rastreio.importacoes.length, 1);
  assert.strictEqual(clone.resultado.linksComerciais.length, 1, "ocorrencia duplicada nao cria CTA");
  assert.deepStrictEqual(clone.resultado.metadata.ocorrenciasShopeeClonador.map(item => item.papelTecnico), ["produto", "produto"]);
  assert.deepStrictEqual(clone.resultado.metadata.ocorrenciasShopeeClonador.map(item => item.ordemCaptura), [1, 2]);
}

async function testarProdutoResgateProdutoPassivos() {
  const texto = `Produto: ${PRODUTO}\nResgate cupom: ${RESGATE}\nProduto novamente: ${PRODUTO}`;
  const baseline = await executar({ links: [linha(PRODUTO), linha(RESGATE)], texto });
  const clone = await executar({
    links: [linha(PRODUTO), linha(RESGATE)],
    texto,
    ocorrencias: [ocorrencia(PRODUTO, 1), ocorrencia(RESGATE, 2), ocorrencia(PRODUTO, 3)]
  });

  assert.deepStrictEqual(contratoFuncional(clone.resultado), contratoFuncional(baseline.resultado));
  assert.deepStrictEqual(clone.rastreio, baseline.rastreio);
  assert.deepStrictEqual(clone.resultado.linksComerciais.map(item => item.tipo), ["produto", "resgate"]);
  assert.deepStrictEqual(clone.resultado.metadata.ocorrenciasShopeeClonador.map(item => [item.ordemCaptura, item.papelTecnico]), [[1, "produto"], [2, "cupom"], [3, "produto"]]);
}

async function testarCupomEAusentePassivos() {
  const texto = `Produto: ${PRODUTO}\nCupom: ${CUPOM}`;
  const baseline = await executar({ links: [linha(PRODUTO), linha(CUPOM)], texto });
  const clone = await executar({
    links: [linha(PRODUTO), linha(CUPOM)],
    texto,
    ocorrencias: [ocorrencia(PRODUTO, 1), ocorrencia(CUPOM, 2), ocorrencia(AUSENTE, 3)]
  });

  assert.deepStrictEqual(contratoFuncional(clone.resultado), contratoFuncional(baseline.resultado));
  assert.deepStrictEqual(clone.rastreio, baseline.rastreio);
  assert.deepStrictEqual(clone.resultado.metadata.ocorrenciasShopeeClonador.map(item => item.papelTecnico), ["produto", "cupom", "desconhecido"]);
  assert.strictEqual(clone.resultado.metadata.ocorrenciasShopeeClonador[2].correlacionadaComLinkTecnico, false);
}

function testarAmbiguidadeEEventoRadar() {
  const tecnico = linha(PRODUTO);
  const ambiguo = montarVisaoOcorrenciasShopeeClonador({
    ocorrenciasCapturadas: [ocorrencia(PRODUTO, 1)],
    linksTecnicos: [tecnico],
    classificados: [
      { link: tecnico, papelLink: "produto" },
      { link: tecnico, papelLink: "cupom" }
    ],
    evento: { texto_original: `Produto: ${PRODUTO}` }
  });
  assert.deepStrictEqual(ambiguo[0], {
    urlOriginal: PRODUTO,
    ordemCaptura: 1,
    ocorrenciaId: "clonador:msg:1",
    papelTecnico: "desconhecido",
    motivoPapel: "ocorrencia_clone_papeis_tecnicos_ambiguos",
    correlacionadaComLinkTecnico: true,
    urlTecnicaCorrelacionada: PRODUTO
  });
}

async function testarRadarNaoRecebeMetadataClone() {
  const resultado = await executar({ links: [linha(PRODUTO)], texto: `Produto: ${PRODUTO}` });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(resultado.resultado.metadata, "ocorrenciasShopeeClonador"), false);
}

(async function main() {
  await testarDuplicataProdutoPassiva();
  await testarProdutoResgateProdutoPassivos();
  await testarCupomEAusentePassivos();
  testarAmbiguidadeEEventoRadar();
  await testarRadarNaoRecebeMetadataClone();
  console.log("shopee-ocorrencias-clonador-passivas.test.js ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
