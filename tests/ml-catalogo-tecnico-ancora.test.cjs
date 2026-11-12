"use strict";
const test = require("node:test");
process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = "fixture-a";
const assert = require("node:assert/strict");
const { extrairCatalogoTecnicoMercadoLivre } = require("../marketplaces/mercadolivre/utils");
const alertas = require("../utils/alertas-integracoes");
alertas.registrarSucessoIntegracao = () => {};
alertas.registrarAlertaIntegracao = () => {};
const { importarMercadoLivre } = require("../marketplaces/mercadolivre/importar");
const database = require("../modules/engine/database");
const queryOriginal = database.queryEngine;
database.queryEngine = async () => ({ ok: true, resultado: { rowCount: 1, rows: [] } });
const { normalizarOfertaImportada, avaliarGateIdentidadeMercadoLivre } = require("../modules/engine/importer/importer.service");
const { importarMercadoLivreEngine } = require("../modules/engine/importer/adapters/mercadolivre.adapter");
const { analisarDestinosOferta } = require("../modules/engine/distributor/distributor.service");
database.queryEngine = queryOriginal;
const { montarOfertaUniversalEngine, validarContratoOfertaUniversal } = require("../modules/engine/oferta-universal.contract");
const { criarLocalWorkerService } = require("../modules/local-worker/local-worker.service");
const { classificarCategoriaOferta } = require("../marketplaces/inteligencia/classificador-categorias");

const catalogId = "MLB12345678";
const listingId = "MLB98765432";
const url = "https://www.mercadolivre.com.br/carretilha/p/" + catalogId;
const title = "Carretilha de Pesca Maruri Black Tamba";
const image = "https://http2.mlstatic.com/D_NQ_NP_123456.jpg";
const produto = { "@type": "Product", productID: catalogId, url, name: title, image };
const html = (item = produto, canonical = url) => '<link rel="canonical" href="' + canonical +
  '"><script type="application/ld+json">' + JSON.stringify(item) + "</script>";
const extrair = (item = produto, final = url, canonical = url) =>
  extrairCatalogoTecnicoMercadoLivre({ html: html(item, canonical), entrada: url, final });

test("catálogo oficial permite enriquecer produto único sem inventar anúncio", () => {
  const prova = extrair({ ...produto, offers: { price: 4.99, url } });
  assert.deepEqual(prova, { titulo: title, imagem: image });
  assert.equal(classificarCategoriaOferta({ titulo: prova.titulo }, prova.titulo), "Pesca e Camping");
});

test("URL, canonical, produto, título ou variante ambíguos nunca geram prova", () => {
  assert.equal(extrair({ ...produto, productID: listingId }), null);
  assert.equal(extrair({ ...produto, item_id: listingId }), null);
  assert.equal(extrair({ ...produto, hasVariant: [{ "@type": "Product" }] }), null);
  assert.equal(extrair({ "@graph": [produto, produto] }), null);
  assert.equal(extrair({ ...produto, name: "Confira agora a promoção" }), null);
  assert.equal(extrair({ ...produto, name: "Loja Maruri" }), null);
  assert.equal(extrair(produto, url.replace(catalogId, listingId)), null);
  assert.equal(extrair(produto, url, "https://example.test/p/" + catalogId), null);
  assert.equal(extrair(produto, url + "?pdp_filters=item_id:" + listingId), null);
});

test("importador reusa resposta já carregada e conserva o afiliado da workspace e os dados do Radar", async t => {
  let fetches = 0;
  const responseHtml = html({ ...produto, offers: { price: 4.99, url } }) + " 40% OFF";
  t.mock.method(globalThis, "fetch", async target => {
    assert.equal(target, url);
    fetches++;
    return { ok: true, status: 200, url, text: async () => responseHtml };
  });
  const integration = { credenciais: {} };
  const result = await importarMercadoLivre(url, "fixture-a", {
    exigirProvaCatalogoTecnico: true,
    textoOriginal: "Chamada promocional sem relação textual\nPor R$ 89,90",
    getIntegracaoCliente: id => { assert.equal(id, "fixture-a"); return integration; },
    gerarLinkAfiliadoMercadoLivre: async (original, credenciais, context) => {
      assert.equal(original, url);
      assert.equal(credenciais, integration);
      assert.equal(context.clienteId, "fixture-a");
      return "https://meli.la/fixture-a";
    }
  });
  assert.equal(fetches, 1);
  assert.equal(result.titulo, title);
  assert.equal(result.tituloFonteOficial, "jsonld.name");
  assert.equal(result.imagem, image);
  assert.equal(result.linkAfiliado, "https://meli.la/fixture-a");
  assert.equal(result.linkOriginal, url);
  assert.equal(result.preco, "89,90");
  assert.equal(result.precoOriginal, "");
  assert.equal(result.descontoPercentual, "");
});

test("flag global e allowlist são decisões separadas no adapter ML", async t => {
  t.mock.method(globalThis, "fetch", async target => {
    assert.equal(target, url);
    return { ok: true, status: 200, url, text: async () => html(produto) };
  });
  const evento = { id: 202, origem: "radar", origem_tipo: "whatsapp",
    texto_original: "O melhor achado do dia!\nDe R$ 129,90 por R$ 89,90\n" + url,
    links_extraidos: [url], metadata: { radarMirror: { preco: { atualCapturado: 89.9, anteriorCapturado: 129.9 } } } };
  const link = { id: 303, evento_id: evento.id, url_original: url, url_normalizada: url, marketplace_detectado: "mercadolivre" };
  const rodar = async (clienteId, global) => {
    const job = { id: 101, evento_id: evento.id, cliente_id: clienteId, marketplace: "mercadolivre" };
    let pediuProva;
    const entrada = await importarMercadoLivreEngine({ job, evento, links: [link], deps: {
      mlWorkEnrichmentAtivo: global,
      importarMercadoLivre: async (url, workspace, opcoes) => {
        assert.equal(workspace, clienteId);
        pediuProva = opcoes.exigirProvaCatalogoTecnico;
        return importarMercadoLivre(url, workspace, opcoes);
      },
      getIntegracaoCliente: () => ({ credenciais: {} }),
      gerarLinkAfiliadoMercadoLivre: async () => "https://meli.la/fixture-afiliado"
    } });
    return { pediuProva, prova: entrada.metadata?.produto?.provaCatalogoTecnicoMl, titulo: entrada.titulo };
  };
  const controle = await rodar("fixture-controle", true);
  assert.deepEqual(controle, await rodar("fixture-controle", false));
  assert.equal(controle.pediuProva, false);
  assert.equal(controle.prova, undefined);
  assert.equal((await rodar("fixture-a", false)).pediuProva, false);
  const canario = await rodar("fixture-a", true);
  assert.equal(canario.pediuProva, true);
  assert.equal(canario.prova?.catalogId, catalogId);
  assert.equal(canario.prova?.titulo, title);
});

test("worker de anúncio só recebe catálogo com seletor validado e vínculo existente", async () => {
  const calls = [];
  const worker = criarLocalWorkerService({
    repository: { garantirTask: async args => { calls.push(args); return { ok: true }; } },
    mlWorkEnrichmentAtivo: true,
    agora: () => new Date(100_000)
  });
  const selected = url + "?pdp_filters=item_id%3A" + listingId;
  const vinculo = { workspaceId: "fixture-a", chave: "a".repeat(64), deadline: 160_000 };
  // The unbound request keeps the legacy path, even when the global flag is on.
  assert.equal((await worker.garantirIdentidadeMercadoLivre({ productId: catalogId, sourceUrl: url })).ok, true);
  assert.equal(calls[0].idempotencyKey, "mercadolivre:" + catalogId + ":ml_identity_v1");
  calls.length = 0;
  assert.equal((await worker.garantirIdentidadeMercadoLivre({ productId: listingId, sourceUrl: selected,
    vinculo: { ...vinculo, workspaceId: "fixture-controle" } })).motivo, "task_ml_identity_workspace_fora_canario");
  assert.equal((await worker.garantirIdentidadeMercadoLivre({ productId: listingId, sourceUrl: selected })).ok, false);
  assert.equal((await worker.garantirIdentidadeMercadoLivre({ productId: catalogId, sourceUrl: selected, vinculo })).ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await worker.garantirIdentidadeMercadoLivre({ productId: listingId, sourceUrl: selected, vinculo })).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sourceUrl, selected);
  assert.equal(calls[0].productId, listingId);
  assert.equal(calls[0].ttlMs, 60_000);
});


for (const origem of [url, "https://meli.la/fixture-catalogo"]) test("catálogo direto ou resolvido projeta oferta técnica: " + origem, async t => {
  t.mock.method(globalThis, "fetch", async target => {
    assert.equal(target, url);
    return { ok: true, status: 200, url, text: async () => html(produto) };
  });
  const afiliado = "https://meli.la/fixture-a";
  const evento = { id: 202, origem: "radar", origem_tipo: "whatsapp",
    texto_original: "O melhor achado do dia!\nDe R$ 129,90 por R$ 89,90\n" + origem,
    links_extraidos: [origem], metadata: { radarMirror: { preco: { atualCapturado: 89.9, anteriorCapturado: 129.9 } } } };
  const job = { id: 101, evento_id: evento.id, cliente_id: "fixture-a", marketplace: "mercadolivre" };
  const link = { id: 303, evento_id: evento.id, url_original: origem, url_normalizada: origem, marketplace_detectado: "mercadolivre" };
  const entrada = await importarMercadoLivreEngine({ job, evento, links: [link], deps: {
    mlWorkEnrichmentAtivo: true, importarMercadoLivre,
    resolverLinkOriginalRadar: async capturada => ({
      ok: true, urlCapturada: capturada, linkOriginalRadar: capturada, urlResolvida: url,
      linkOriginalLimpo: url, tipoLinkRadar: "shortlink_meli", metodoResolucaoMeli: "", statusHttp: 200
    }),
    getIntegracaoCliente: workspace => { assert.equal(workspace, job.cliente_id); return { credenciais: {} }; },
    gerarLinkAfiliadoMercadoLivre: async () => afiliado
  } });
  const oferta = normalizarOfertaImportada(entrada, job, null, true);
  assert.equal(oferta.titulo, title);
  assert.equal(oferta.categoria, "Pesca e Camping");
  assert.equal(avaliarGateIdentidadeMercadoLivre(oferta, oferta.metadata, true).retida, false);
  const universal = montarOfertaUniversalEngine({ oferta, ofertaEntrada: entrada, job, evento, link, metadata: oferta.metadata });
  assert.equal(validarContratoOfertaUniversal(universal).ok, true);
  assert.equal(universal.produto.idExterno, catalogId);
  assert.ok(!universal.produto.listingId);
  assert.equal(universal.produto.urlOriginal, origem);
  assert.equal(universal.comercial.precoAtual, 89.9);
  assert.equal(universal.comercial.precoAnterior, 129.9);
  assert.equal(universal.afiliacao.urlAfiliada, afiliado);
  assert.equal(universal.midia.imagemPrincipal, image);
  const result = analisarDestinosOferta(job.cliente_id, { ...oferta, origem: "optimus" }, {
    destinosPorCliente: { [job.cliente_id]: [
      { id: "pesca", ativo: true, marketplaces: ["mercadolivre"], categorias: ["Pesca e Camping"] },
      { id: "ferramentas", ativo: true, marketplaces: ["mercadolivre"], categorias: ["Ferramentas"] }
    ], "fixture-b": [{ id: "outro", ativo: true, marketplaces: ["mercadolivre"], categorias: ["Pesca e Camping"] }] }
  });
  assert.deepEqual(result.compativeis.map(item => item.destino.id), ["pesca"]);
});
