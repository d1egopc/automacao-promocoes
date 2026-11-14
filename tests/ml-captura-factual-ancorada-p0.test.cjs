"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
process.env.ML_WORK_ENRICHMENT_CANARY_CLIENTES = "workspace-a";

const {
  enriquecerTituloMlPorOcorrencia,
  normalizarOfertaImportada,
  avaliarGateIdentidadeMercadoLivre,
  validarCapturaFactualMercadoLivre,
  tituloFactualConfiavelEngine
} = require("../modules/engine/importer/importer.service");

const catalogId = "MLB12345001";
const listingId = "MLB9876500001";
const urlTecnica = `https://www.mercadolivre.com.br/fixture/p/${catalogId}?pdp_filters=item_id%3A${listingId}`;

function cenario(titulo = "Molinete Pesca 9000-12000") {
  const linkOriginal = "https://meli.la/fixture";
  const capturadoEm = new Date(Date.now() - 5_000).toISOString();
  const evento = { id: 201, capturado_em: capturadoEm, links_extraidos: [linkOriginal] };
  const job = { id: 101, evento_id: 201, cliente_id: "workspace-a", marketplace: "mercadolivre", criado_em: capturadoEm };
  const link = { id: 301, evento_id: 201, url_original: linkOriginal };
  const oferta = {
    marketplace: "mercadolivre", titulo, categoria: "Diversos",
    preco: 275.99, precoOriginal: 310, cupom: "PESCA10",
    instrucaoCupom: "Aplicar PESCA10", linkOriginal,
    linkExpandido: urlTecnica, linkAfiliado: "https://meli.la/fixture-afiliado",
    metadata: {
      adapter: "mercadolivre", fallbackMercadoLivreClonador: true,
      origemTitulo: "clonador_grupos", aguardaTituloMl: false,
      jobId: 101, eventoId: 201, linkOriginalEngine: linkOriginal,
      linkExpandidoEngine: urlTecnica,
      identidadeCanonicaMl: {
        status: "transporte_confirmado", urlOriginal: linkOriginal,
        urlCanonicaRevalidada: urlTecnica,
        mlbProduto: catalogId, mlbRevalidado: catalogId,
        transporteShowProductConfirmado: true
      },
      resolucaoProduto: { provaTransporteShowProduct: {
        ok: true, actionId: "show_product", ctaPrincipalUnico: true,
        linkResolvidoTecnico: urlTecnica,
        imagemCandidataAnchor: { eventoId: "201", linkOriginalRadar: linkOriginal }
      } },
      linksClassificados: [{ id: 301, urlOriginal: linkOriginal, papelLink: "desconhecido" }],
      produto: {}
    }
  };
  return { job, evento, link, oferta,
    deps: { mlWorkEnrichmentAtivo: true, linksEventoPersistidos: [link] } };
}

test("captura factual e show_product da mesma ocorrência dispensam título oficial sem trocar dados comerciais", async () => {
  const f = cenario();
  let chamadasWorker = 0;
  f.deps.garantirIdentidadeMercadoLivreLocalWorker = async () => { chamadasWorker++; throw Error("worker desnecessário"); };
  const enriquecida = await enriquecerTituloMlPorOcorrencia(f);
  assert.equal(enriquecida?.capturadoAncorado, true);
  assert.equal(chamadasWorker, 0);
  assert.equal(enriquecida.oferta.produtoIdDetectado, listingId);
  assert.equal(enriquecida.oferta.metadata.identidadeCanonicaMl.catalogId, catalogId);
  assert.equal(enriquecida.oferta.metadata.provaTituloTecnicoValidada, undefined);
  assert.equal(validarCapturaFactualMercadoLivre(enriquecida.oferta, enriquecida.oferta.metadata, f.job), true);
  const normalizada = normalizarOfertaImportada(enriquecida.oferta, f.job, null, true);
  assert.equal(normalizada.titulo, f.oferta.titulo);
  assert.equal(normalizada.categoria, "Pesca e Camping");
  assert.equal(avaliarGateIdentidadeMercadoLivre(normalizada, normalizada.metadata, true, f.job).retida, false);
  const outroJob = { ...f.job, id: 102, cliente_id: "workspace-b" };
  assert.equal(validarCapturaFactualMercadoLivre(enriquecida.oferta, enriquecida.oferta.metadata, outroJob), false);
  assert.equal(avaliarGateIdentidadeMercadoLivre(normalizada, normalizada.metadata, true, outroJob).retida, true);
  assert.equal(enriquecida.oferta.instrucaoCupom, f.oferta.instrucaoCupom);
  for (const campo of ["preco", "precoOriginal", "cupom", "linkOriginal", "linkExpandido", "linkAfiliado"])
    assert.equal(normalizada[campo], f.oferta[campo], campo);
});

test("outro anúncio, outra variante e página sem produto não recebem prova de captura", async () => {
  const divergente = cenario();
  divergente.oferta.metadata.resolucaoProduto.provaTransporteShowProduct.linkResolvidoTecnico =
    urlTecnica.replace(listingId, "MLB9876500002");
  assert.equal(await enriquecerTituloMlPorOcorrencia(divergente), null);

  const variante = cenario();
  variante.oferta.metadata.produto.variationId = "4567";
  assert.equal(await enriquecerTituloMlPorOcorrencia(variante), null);

  const seguranca = cenario();
  seguranca.oferta.linkExpandido = "https://www.mercadolivre.com.br/captcha";
  assert.equal(await enriquecerTituloMlPorOcorrencia(seguranca), null);
});

test("os cinco títulos informados são factuais; convite, loja e slogan não são", () => {
  for (const titulo of [
    "Molinete Pesca 9000-12000", "Copo Térmico Inox 500 ml",
    "Kit Sobrevivência Faca/Lanterna", "Isca Nelson Nakamura Zig Zara 110",
    "Isca Fatal Evo Tucunaré"
  ]) assert.equal(tituloFactualConfiavelEngine(titulo, "mercadolivre"), true, titulo);
  for (const titulo of ["Entre no grupo de ofertas", "Loja Oficial Mercado Livre", "Promoção imperdível venha para nosso canal"])
    assert.equal(tituloFactualConfiavelEngine(titulo, "mercadolivre"), false, titulo);
});
