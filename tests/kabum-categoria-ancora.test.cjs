const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");
const { montarOfertaUniversalEngine } = require("../modules/engine/oferta-universal.contract");
const { analisarDestinoOferta } = require("../utils/destinos");
const { importarProdutoKabumViaAwin } = require("../marketplaces/kabum/importador");
const axios = require("axios");

const url = "https://www.kabum.com.br/produto/123456/produto";
const afiliado = `https://www.awin1.com/cread.php?ued=${encodeURIComponent(url)}`;

function oferta(titulo, { produtoId = "123456", linkExpandido = url, categoria = "Gamer e Hardware", categoriaOrigem = "padrao_importador_kabum" } = {}) {
  const imagem = "https://images.kabum.com.br/produtos/fotos/123456/oficial.jpg";
  const linksComerciais = [{ id: 1, urlOriginal: url, urlConvertida: afiliado }];
  return normalizarOfertaImportada({
    marketplace: "kabum", titulo, categoria, linkOriginal: url, linkExpandido,
    linkAfiliado: afiliado, imagem, preco: 89.9, precoOriginal: 109.9, cupom: "EXEMPLO",
    metadata: { adapter: "awin_kabum", linksComerciais, produto: { titulo, produtoId, categoriaOrigem } }
  });
}

test("categoria padrão KaBuM cede ao classificador sem alterar os campos comerciais", () => {
  const titulo = "Barraca Camping Nautika 4 Pessoas";
  const o = oferta(titulo);
  assert.equal(o.titulo, titulo);
  assert.equal(o.categoria, "Pesca e Camping");
  assert.equal(o.categoriaOficialAncorada, undefined);
  assert.equal(o.preco, 89.9);
  assert.equal(o.precoOriginal, 109.9);
  assert.equal(o.cupom, "EXEMPLO");
  assert.equal(o.linkOriginal, url);
  assert.equal(o.linkAfiliado, afiliado);
  assert.equal(o.imagem, "https://images.kabum.com.br/produtos/fotos/123456/oficial.jpg");
  assert.deepEqual(o.metadata.linksComerciais, [{ id: 1, urlOriginal: url, urlConvertida: afiliado }]);
  const universal = montarOfertaUniversalEngine({ oferta: o, metadata: o.metadata,
    job: { id: 10, evento_id: 20, cliente_id: "workspace_fixture" }, link: { id: 1, url_original: url } });
  assert.equal(universal.jobId, 10);
  assert.equal(universal.workspaceId, "workspace_fixture");
  assert.equal(universal.produto.idExterno, "123456");
  assert.equal(universal.produto.categoriaNormalizada, "Pesca e Camping");
  assert.equal(universal.afiliacao.urlAfiliada, afiliado);
  const destino = { ativo: true, marketplaces: ["AWIN / KaBuM"], categorias: ["Pesca e Camping"] };
  assert.equal(analisarDestinoOferta(destino, o).aceita, true);
  assert.equal(analisarDestinoOferta({ ...destino, categorias: ["Gamer e Hardware"] }, o).aceita, false);
});

test("categoria inferida mantém hardware e usa Diversos quando não há sinal suficiente", () => {
  assert.equal(oferta("Placa de Vídeo RTX 4060 8 GB").categoria, "Gamer e Hardware");
  assert.equal(oferta("Produto Factual Modelo ZX100").categoria, "Diversos");
  assert.equal(oferta("Barraca Camping Nautika 4 Pessoas", { categoriaOrigem: "" }).categoria, "Gamer e Hardware");
});

test("SKU divergente e URL externa não comprovam título nem categoria especializada", () => {
  for (const opcoes of [
    { produtoId: "654321" },
    { linkExpandido: `https://externo.example/?url=${url}` },
    { linkExpandido: "https://falsokabum.com.br/produto/123456" }
  ]) {
    const o = oferta("Barraca Camping Nautika 4 Pessoas", opcoes);
    assert.equal(o.titulo, "");
    assert.equal(o.categoria, "Diversos");
  }
});

test("título da página KaBuM chega com o SKU e a ocorrência AWIN", async (t) => {
  const { importarAwinEngine } = require("../modules/engine/importer/adapters/awin.adapter");
  const titulo = "Barraca Camping Nautika 4 Pessoas";
  const original = afiliado + "&awinmid=17729&awinaffid=111";
  const workspaceUrl = original.replace("awinaffid=111", "awinaffid=222");
  t.mock.method(axios, "get", async () => ({
    status: 200, request: { res: { responseUrl: url } },
    data: '<title>' + titulo + '</title><meta property="og:image" content="https://images.kabum.com.br/fixture.jpg">R$ 89,90'
  }));
  const job = { id: 1001, evento_id: 2001, cliente_id: "workspace_fixture", marketplace: "kabum" };
  const bruto = await importarAwinEngine({
    job, evento: { texto_original: "De R$ 109,90 por R$ 89,90\n" + original },
    links: [{ id: 1, url_original: original, url_normalizada: original }],
    deps: { importarProdutoKabumViaAwin, gerarDeepLinkAwin: async () => workspaceUrl,
      getIntegracaoCliente: () => ({ credenciais: { publisherId: "222" } }) }
  });
  assert.equal(bruto.ok, true, bruto.motivo);
  const o = normalizarOfertaImportada(bruto, job);
  assert.equal(o.metadata.provaTituloTecnicoValidada?.titulo.valor, titulo);
  assert.equal(o.metadata.provaTituloTecnicoValidada?.ocorrenciaLink.urlOriginal, original);
  assert.equal(o.categoria, "Pesca e Camping");
  assert.equal(o.linkAfiliado, workspaceUrl);
});

test("resposta da página de outro SKU não fornece dados técnicos para a âncora", async (t) => {
  t.mock.method(axios, "get", async () => ({
    status: 200,
    data: "<title>Barraca Camping Nautika 4 Pessoas</title>",
    request: { res: { responseUrl: "https://www.kabum.com.br/produto/654321/outro" } }
  }));
  const gerarDeepLinkAwin = t.mock.fn(async () => afiliado);
  await assert.rejects(importarProdutoKabumViaAwin(url, "workspace_fixture", { gerarDeepLinkAwin }),
    /kabum_produto_nao_comprovado/);
  assert.equal(gerarDeepLinkAwin.mock.callCount(), 0);
});
