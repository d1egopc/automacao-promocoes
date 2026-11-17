"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fixture = require("./fixtures/kabum-awin-golden-contracts.json");

const { importarAwinEngine } = require("../modules/engine/importer/adapters/awin.adapter");
const { normalizarOfertaImportada } = require("../modules/engine/importer/importer.service");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal
} = require("../modules/engine/oferta-universal.contract");
const { criarPreflightFilaUniversal } = require("../modules/engine/universal-queue-preflight");
const { criarGerarDeepLinkAwin } = require("../modules/marketplaces/conversores/awin.converter");

function productLink(overrides = {}) {
  return {
    id: "kabum-link-991001",
    evento_id: fixture.job.evento_id,
    url_original: fixture.produto.urlOriginal,
    url_normalizada: fixture.produto.urlOriginal,
    url_expandida: fixture.produto.urlOriginal,
    dominio_original: "www.kabum.com.br",
    dominio_final: "www.kabum.com.br",
    redirect_ok: true,
    motivo_redirect: "resolvido",
    marketplace_detectado: "kabum",
    papelLink: "produto",
    metadata: {
      papelLink: "produto",
      papelLinkMotivo: "kabum_id_produto_url",
      papelLinkConfianca: "alta",
      variante: fixture.produto.variante
    },
    ...overrides
  };
}

function campaignLink(urlOriginal, urlExpandida, id) {
  return {
    id,
    evento_id: fixture.job.evento_id,
    url_original: urlOriginal,
    url_normalizada: urlOriginal,
    url_expandida: urlExpandida,
    dominio_original: "seuhardware.com",
    dominio_final: "www.kabum.com.br",
    redirect_ok: true,
    motivo_redirect: "resolvido",
    marketplace_detectado: "kabum"
  };
}

function awinUrl(destination, publisherId = "222") {
  return `https://www.awin1.com/cread.php?awinaffid=${publisherId}&ued=${encodeURIComponent(destination)}`;
}

function depsFor(product = fixture.produto) {
  return {
    importarProdutoKabumViaAwin: async () => ({
      marketplace: "kabum",
      titulo: product.titulo,
      tituloFonteOficial: "kabum_html.title",
      produtoIdCanonico: product.sku,
      linkOriginal: product.urlOriginal,
      linkExpandido: product.urlOriginal,
      linkAfiliado: awinUrl(product.urlOriginal),
      imagem: product.imagem,
      preco: product.preco,
      precoAtual: product.preco,
      precoOriginal: product.precoOriginal,
      precoAntigo: product.precoOriginal,
      avisoPagamento: product.pix,
      cupom: product.cupom,
      categoria: product.categoria,
      categoriaOrigem: "padrao_importador_kabum",
      variante: product.variante
    }),
    gerarDeepLinkAwin: async (url) => awinUrl(url),
    getIntegracaoCliente: (_workspace, marketplace) => marketplace === "awin"
      ? { credenciais: { publisherId: "222", apiToken: "fixture-token" } }
      : null
  };
}

function fixturePreflight(expected) {
  const ok = async () => ({ ok: true });
  return criarPreflightFilaUniversal({
    pool: { connect() {} },
    now: () => Date.parse("2026-11-16T23:00:00.000Z"),
    readClock: async () => null,
    resolveDestination: async () => ({ ok: true, destination: { id: "destino-kabum", tipo: "whatsapp" } }),
    checkWindow: ok,
    checkDailyLimit: ok,
    checkSession: ok,
    checkCredits: ok,
    checkMedia: async ({ oferta }) => ({ ok: oferta.midia?.imagemPrincipal === expected.imagem }),
    checkLinks: async ({ oferta }) => ({ ok: oferta.afiliacao?.urlAfiliada === expected.linkAfiliado }),
    checkDedup: ok,
    renderMessage: async () => ({ ok: true, message: "golden-dry-run" })
  });
}

test("URL de produto KaBuM preserva identidade, imagem oficial e contrato comercial", async () => {
  const job = { ...fixture.job };
  const link = productLink();
  const evento = { id: fixture.job.evento_id, texto_original: fixture.eventoTexto };
  const bruto = await importarAwinEngine({ job, evento, links: [link], deps: depsFor() });

  assert.equal(bruto.ok, true, bruto.motivo);
  const oferta = normalizarOfertaImportada(bruto, job);
  assert.equal(oferta.produtoIdDetectado, fixture.produto.sku);
  assert.equal(oferta.titulo, fixture.produto.titulo);
  assert.equal(oferta.categoria, fixture.produto.categoria);
  assert.equal(oferta.imagem, fixture.produto.imagem);
  assert.equal(oferta.preco, fixture.produto.preco);
  assert.equal(oferta.precoOriginal, fixture.produto.precoOriginal);
  assert.equal(oferta.cupom, fixture.produto.cupom);
  assert.equal(bruto.beneficioComercial, fixture.produto.pix);
  assert.equal(oferta.linkOriginal, fixture.produto.urlOriginal);
  assert.match(oferta.linkAfiliado, /awin1\.com\/cread\.php/);
  assert.equal(decodeURIComponent(new URL(oferta.linkAfiliado).searchParams.get("ued")), fixture.produto.urlOriginal);
  assert.equal(oferta.metadata.clienteId, fixture.workspaceId);
  assert.equal(oferta.metadata.provaTituloTecnicoValidada.produto.produtoIdCanonico, fixture.produto.sku);

  const universal = montarOfertaUniversalEngine({
    oferta: { ...oferta, engineOfertaId: 991001 },
    ofertaEntrada: oferta,
    job,
    evento,
    link,
    metadata: oferta.metadata
  });
  universal.clienteId = fixture.workspaceId;
  universal.engineOfertaId = 991001;
  assert.equal(validarContratoOfertaUniversal(universal).ok, true);
  assert.equal(universal.workspaceId, fixture.workspaceId);
  assert.equal(universal.produto.idExterno, fixture.produto.sku);
  assert.equal(universal.midia.imagemPrincipal, fixture.produto.imagem);
  assert.equal(universal.comercial.precoAtual, fixture.produto.preco);
  assert.equal(universal.comercial.precoAnterior, fixture.produto.precoOriginal);
  assert.equal(universal.comercial.cupom, fixture.produto.cupom);

  const preflight = await fixturePreflight({
    imagem: fixture.produto.imagem,
    linkAfiliado: oferta.linkAfiliado
  })({
    workspace_id: fixture.workspaceId,
    destination_id: "destino-kabum",
    capturado_em: "2026-11-16T22:58:00.000Z",
    operationEpochStartedAt: "2026-11-16T22:50:00.000Z",
    evento_id: job.evento_id,
    oferta_id: 991001,
    origem_fluxo: "radar",
    item_payload: universal
  });
  assert.equal(preflight.ready, true, JSON.stringify(preflight));
  assert.ok(!/whatsapp|telegram|group/i.test(oferta.imagem));
});

test("campanha/cupom sem SKU fica retida e link de produto vence link auxiliar", async () => {
  const job = { ...fixture.job };
  const evento = {
    id: fixture.job.evento_id,
    texto_original: `Cupom FARMOU\nProduto: ${fixture.produto.urlOriginal}`
  };
  const campanha = campaignLink(fixture.campanha.urlOriginal, fixture.campanha.urlExpandida, "campaign-1");
  const cupom = campaignLink(fixture.cupomAuxiliar.urlOriginal, fixture.cupomAuxiliar.urlExpandida, "coupon-1");
  cupom.metadata = { papelLink: "cupom", papelLinkMotivo: "contexto_cupom", papelLinkConfianca: "alta" };
  const produto = productLink({ id: "product-1" });
  const deps = depsFor();

  const retida = await importarAwinEngine({
    job,
    evento: { id: fixture.job.evento_id, texto_original: "Cupom TEMPESTADE10 https://seuhardware.com/s/C1TyTxK" },
    links: [campanha],
    deps
  });
  assert.equal(retida.ok, false);
  assert.equal(retida.motivo, "sem_link_produto_entre_links_auxiliares");

  const bruto = await importarAwinEngine({ job, evento, links: [cupom, produto], deps });
  assert.equal(bruto.ok, true, bruto.motivo);
  assert.equal(bruto.metadata.linkOriginalEngine, fixture.produto.urlOriginal);
  assert.equal(bruto.cupom, fixture.produto.cupom);
  assert.equal(bruto.metadata.linksComerciais.some(link => link.papelLink === "cupom"), true);
});

test("SKU divergente e transporte sem prova bloqueiam identidade", async () => {
  const job = { ...fixture.job };
  const evento = { id: fixture.job.evento_id, texto_original: fixture.eventoTexto };
  const skuDivergente = productLink({
    url_original: fixture.produto.urlOriginal.replace(fixture.produto.sku, "999999"),
    url_normalizada: fixture.produto.urlOriginal.replace(fixture.produto.sku, "999999"),
    url_expandida: fixture.produto.urlOriginal.replace(fixture.produto.sku, "999999")
  });
  const transporteSemProva = campaignLink(
    "https://seuhardware.com/s/produto-609953",
    fixture.produto.urlOriginal,
    "transport-1"
  );
  transporteSemProva.redirect_ok = false;
  transporteSemProva.motivo_redirect = "falhou";
  for (const link of [skuDivergente, transporteSemProva]) {
    const bruto = await importarAwinEngine({ job, evento, links: [link], deps: depsFor() });
    assert.equal(bruto.ok, true, "o adaptador pode retornar a prova para o importer rejeitar");
    const oferta = normalizarOfertaImportada(bruto, job);
    assert.equal(oferta.titulo, "");
    assert.equal(oferta.metadata.provaTituloTecnicoRejeitada, true);
  }
});

test("AWIN 401/403 falha sem conversão fabricada", async () => {
  for (const status of [401, 403]) {
    let recebido;
    const gerar = criarGerarDeepLinkAwin({
      axios: {
        post: async (_url, body) => {
          recebido = body;
          const erro = new Error(`HTTP ${status}`);
          erro.response = { status };
          throw erro;
        }
      },
      getIntegracaoCliente: () => ({ credenciais: { publisherId: "222", apiToken: "fixture-token" } }),
      obterProgramaAwin: () => ({ advertiserId: "17729" }),
      registrarAlertaIntegracao: () => {}
    });
    await assert.rejects(
      gerar(fixture.produto.urlOriginal, fixture.workspaceId),
      new RegExp(`HTTP ${status}`)
    );
    assert.deepEqual(recebido, {
      advertiserId: 17729,
      destinationUrl: fixture.produto.urlOriginal
    });
  }
});

test("guardas compartilhadas continuam carregáveis", () => {
  assert.equal(typeof require("../modules/engine/importer/adapters/magalu.adapter").importarProdutoMagaluEngine, "function");
  assert.equal(typeof require("../modules/engine/importer/adapters/mercadolivre.adapter").importarMercadoLivreEngine, "function");
  assert.equal(typeof require("../modules/engine/importer/adapters/shopee.adapter").importarShopeeEngine, "function");
  assert.equal(typeof validarContratoOfertaUniversal, "function");
});
