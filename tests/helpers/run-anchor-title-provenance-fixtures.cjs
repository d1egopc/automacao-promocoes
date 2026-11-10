"use strict";

const path = require("node:path");

function load(root, file) {
  return require(path.join(path.resolve(root), file));
}

function responseHtml(url, html, status = 200) {
  return { ok: status >= 200 && status < 300, status, url, text: async () => html };
}

async function runMercadoLivre(root, options = {}) {
  const { importarMercadoLivreEngine } = load(root, "modules/engine/importer/adapters/mercadolivre.adapter.js");
  const { importarMercadoLivre } = load(root, "marketplaces/mercadolivre/importar.js");
  const { normalizarOfertaImportada } = load(root, "modules/engine/importer/importer.service.js");

  const job = {
    id: "fixture-job-ml-source-01",
    evento_id: "fixture-event-ml-source-01",
    cliente_id: options.workspace || "fixture-workspace-ml-a",
    marketplace: "mercadolivre"
  };
  const productId = "MLB900000001";
  const anchor = `https://produto.mercadolivre.com.br/MLB-${productId.slice(3)}-fixture-item-_JM`;
  const foreign = "https://produto.mercadolivre.com.br/MLB-900000002-different-fixture-_JM";
  const pageUrl = options.foreignProduct ? foreign : anchor;
  const title = "Monitor Orbit de Estudos 27 Polegadas Fixture";
  const jsonLd = options.noOfficialTitle
    ? { "@context": "https://schema.org", "@type": "Product", image: "https://http2.mlstatic.com/fixture-image.jpg" }
    : { "@context": "https://schema.org", "@type": "Product", name: title,
      image: "https://http2.mlstatic.com/fixture-image.jpg", offers: { price: "349.90" } };
  const ogTitle = options.noOfficialTitle ? "" : `<meta property="og:title" content="${title}">`;
  const html = `<html><head>${ogTitle}<meta property="og:image" content="https://http2.mlstatic.com/fixture-image.jpg"><meta property="product:price:amount" content="349.90"></head><body><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></body></html>`;
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const requested = [];
  global.fetch = async url => {
    requested.push(String(url));
    if (String(url) !== anchor) throw new Error("fixture_blocked_unexpected_network_request");
    return responseHtml(pageUrl, html);
  };
  console.log = () => {};
  console.error = () => {};
  try {
    const workspaceAffiliate = `https://meli.la/fixture-${job.cliente_id}`;
    const links = [{
      ocorrencia_id: "fixture-ml-occurrence-01",
      ordem_captura: 1,
      url_original: anchor,
      url_normalizada: anchor,
      papelLink: "produto",
      tipo: "produto"
    }];
    const event = {
      id: job.evento_id,
      origem: "radar",
      texto_original: options.radarMissingPrevious
        ? "Convide seus amigos para o grupo.\nPor: R$ 219,90\nCupom: RADAR20"
        : "Convide seus amigos para o grupo.\nDe R$ 499,90 | Por: R$ 219,90\nCupom: RADAR20",
      links_extraidos: [anchor],
      metadata: {
        radarMirror: {
          preco: { ...(options.radarMissingPrevious ? {} : { anteriorCapturado: 499.9 }), atualCapturado: 219.9 },
          cupom: { codigoCapturado: "RADAR20" },
          produto: { tituloCapturado: "Convide seus amigos para o grupo." }
        }
      }
    };
    const result = await importarMercadoLivreEngine({
      job,
      evento: event,
      links,
      deps: {
        getIntegracaoCliente: clienteId => ({ clienteId, credenciais: { tag: `fixture-${clienteId}` } }),
        importarMercadoLivre: async (...args) => {
          const imported = await importarMercadoLivre(...args);
          return options.pagePreviousPrice == null ? imported : { ...imported, precoOriginal: options.pagePreviousPrice };
        },
        gerarLinkAfiliadoMercadoLivre: async (_url, _integracao, context) => `https://meli.la/fixture-${context.clienteId}`
      }
    });
    const normalized = result?.ok ? normalizarOfertaImportada(result, job) : null;
    return {
      ok: result?.ok === true,
      terminalReason: result?.motivo || "",
      productId: result?.produtoIdDetectado || "",
      titleSource: result?.metadata?.provaTituloTecnico?.titulo?.fonte || result?.metadata?.produto?.tituloFonteOficial || "",
      proofPresent: Boolean(result?.metadata?.provaTituloTecnico),
      proofOccurrence: result?.metadata?.provaTituloTecnico?.ocorrenciaLink?.id || "",
      proofJobId: result?.metadata?.provaTituloTecnico?.jobId || "",
      proofEventId: result?.metadata?.provaTituloTecnico?.eventoId || "",
      proofWorkspaceId: result?.metadata?.provaTituloTecnico?.workspaceId || "",
      proofAnchorUrl: result?.metadata?.provaTituloTecnico?.ocorrenciaLink?.urlOriginal || "",
      proofTitle: result?.metadata?.provaTituloTecnico?.titulo?.valor || "",
      proofCanonicalUrl: result?.metadata?.provaTituloTecnico?.produto?.urlCanonica || "",
      normalizedTitle: normalized?.titulo || "",
      normalizedProof: normalized?.metadata?.provaTituloTecnicoValidada?.validacao || "",
      price: normalized?.preco ?? null,
      previousPrice: normalized?.precoOriginal ?? null,
      coupon: normalized?.cupom || "",
      affiliate: normalized?.linkAfiliado || "",
      commercialLinks: normalized?.metadata?.linksComerciais?.length || 0,
      commercialLinkOriginals: (normalized?.metadata?.linksComerciais || []).map(item => item.urlOriginal || item.original || ""),
      imagePresent: Boolean(normalized?.imagem),
      imageUrl: normalized?.imagem || "",
      requested
    };
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
}

async function runShopee(root, options = {}) {
  const { importarShopeeEngine } = load(root, "modules/engine/importer/adapters/shopee.adapter.js");
  const { criarImportarShopee } = load(root, "marketplaces/shopee/importar.js");
  const { normalizarOfertaImportada } = load(root, "modules/engine/importer/importer.service.js");

  const job = {
    id: "fixture-job-shopee-source-01",
    evento_id: "fixture-event-shopee-source-01",
    cliente_id: options.workspace || "fixture-workspace-shopee-a",
    marketplace: "shopee"
  };
  const shopId = "900001";
  const itemId = "900002";
  const otherShopId = "900009";
  const canonical = `https://shopee.com.br/product/${shopId}/${itemId}`;
  const original = "https://s.shopee.com.br/fixture-product-link";
  const title = "Cooler Aigo Darkflash DC360 Fixture";
  const appId = options.appId || "fixture-app-shopee-a";
  const affiliate = `${canonical}?mmp_pid=an_${appId}`;
  const expectedNode = {
    itemId: options.wrongItem ? "900099" : itemId,
    productName: options.noApiTitle ? "" : title,
    productLink: canonical,
    offerLink: affiliate,
    imageUrl: "https://cf.shopee.com.br/file/fixture-official-image.jpg",
    priceMin: "349.90",
    priceMax: "349.90",
    sales: "10",
    ratingStar: "5",
    commissionRate: "5.0",
    shopId: options.wrongShop ? otherShopId : shopId,
    shopName: "Fixture shop"
  };
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const requests = [];
  global.fetch = async (url, config = {}) => {
    requests.push({ url: String(url), method: config.method || "GET" });
    if (String(url) !== "https://open-api.affiliate.shopee.com.br/graphql") {
      if (options.noApiTitle && String(url) === canonical) {
        return responseHtml(canonical, `<html><head><meta property="og:title" content="${title}"><meta property="og:image" content="https://cf.shopee.com.br/file/fixture-html-image.jpg"></head></html>`);
      }
      throw new Error("fixture_blocked_unexpected_network_request");
    }
    const query = JSON.parse(config.body).query;
    const nodes = options.wrongShop && !query.includes(`itemId: ${itemId}`) ? [] : [expectedNode];
    return { ok: true, status: 200, json: async () => ({ data: { productOfferV2: { nodes } } }) };
  };
  console.log = () => {};
  console.error = () => {};
  try {
    const importer = criarImportarShopee({
      limparPreco: value => String(value || "").replace(/^R\$\s*/i, ""),
      htmlDecode: value => String(value || ""),
      extrairMeta: () => "",
      corrigirImagemUrl: value => String(value || "")
    });
    const links = [{
      ocorrenciaId: "fixture-shopee-occurrence-01",
      ordemCaptura: 1,
      url_original: original,
      metadata: { papelLink: "cupom", papelLinkMotivo: "contexto_cupom" }
    }];
    const event = {
      id: job.evento_id,
      origem: "radar",
      texto_original: options.radarMissingPrevious
        ? `Grupo de ofertas Gerais\nCupom: ${original}\nPor: R$ 219,90\nCupom: SHOPEE10`
        : `Grupo de ofertas Gerais\nCupom: ${original}\nDe R$ 499,90 | Por: R$ 219,90\nCupom: SHOPEE10`,
      links_extraidos: [original]
    };
    const result = await importarShopeeEngine({
      job,
      evento: event,
      links,
      deps: {
        getIntegracaoCliente: clienteId => ({
          clienteId,
          credenciais: { appId, secret: "fixture-secret-only" }
        }),
        importarShopee: async (...args) => {
          const imported = await importer(...args);
          return options.pagePreviousPrice == null ? imported : {
            ...imported,
            precoOriginal: options.pagePreviousPrice,
            precoAntigo: options.pagePreviousPrice
          };
        },
        resolverRedirectContextualShopee: async url => {
          if (url !== original) throw new Error("fixture_blocked_unexpected_redirect");
          return { request: { res: { responseUrl: canonical } } };
        },
        expandirShortlinkShopee: async url => url === canonical ? affiliate : url
      }
    });
    const normalized = result?.ok ? normalizarOfertaImportada(result, job) : null;
    return {
      ok: result?.ok === true,
      terminalReason: result?.motivo || "",
      productId: result?.produtoIdDetectado || "",
      titleSource: result?.metadata?.provaTituloTecnico?.titulo?.fonte || result?.metadata?.produto?.tituloOrigem || "",
      identitySource: result?.metadata?.produto?.identidadeProdutoValidada?.fonte || "",
      proofPresent: Boolean(result?.metadata?.provaTituloTecnico),
      proofOccurrence: result?.metadata?.provaTituloTecnico?.ocorrenciaLink?.id || "",
      proofJobId: result?.metadata?.provaTituloTecnico?.jobId || "",
      proofEventId: result?.metadata?.provaTituloTecnico?.eventoId || "",
      proofWorkspaceId: result?.metadata?.provaTituloTecnico?.workspaceId || "",
      proofAnchorUrl: result?.metadata?.provaTituloTecnico?.ocorrenciaLink?.urlOriginal || "",
      proofTitle: result?.metadata?.provaTituloTecnico?.titulo?.valor || "",
      proofCanonicalUrl: result?.metadata?.provaTituloTecnico?.produto?.urlCanonica || "",
      normalizedTitle: normalized?.titulo || "",
      normalizedProof: normalized?.metadata?.provaTituloTecnicoValidada?.validacao || "",
      price: normalized?.preco ?? null,
      previousPrice: normalized?.precoOriginal ?? null,
      coupon: normalized?.cupom || "",
      affiliate: normalized?.linkAfiliado || "",
      expectedAffiliate: affiliate,
      commercialLinks: normalized?.metadata?.linksComerciais?.length || 0,
      commercialLinkOriginals: (normalized?.metadata?.linksComerciais || []).map(item => item.urlOriginal || item.original || ""),
      imagePresent: Boolean(normalized?.imagem),
      imageUrl: normalized?.imagem || "",
      requestCount: requests.length
    };
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
}

async function runAnchorTitleProvenanceFixtures(root, options = {}) {
  return {
    mercadolivre: await runMercadoLivre(root, options.mercadolivre || {}),
    shopee: await runShopee(root, options.shopee || {})
  };
}

module.exports = { runAnchorTitleProvenanceFixtures };
