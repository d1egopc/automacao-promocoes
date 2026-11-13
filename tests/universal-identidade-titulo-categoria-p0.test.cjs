"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolve } = require("node:path");
const root = process.env.OPTIMUS_TEST_ROOT || resolve(__dirname, "..");
const fromRepo = path => require(resolve(root, path));
const { normalizarOfertaImportada } = fromRepo("modules/engine/importer/importer.service");
const { montarProvaTituloTecnico } = fromRepo("modules/engine/importer/adapters/prova-identidade-tecnica");
const { montarOfertaUniversalEngine } = fromRepo("modules/engine/oferta-universal.contract");
const { resolverPrecedenciaComercialRadar, validarFidelidadeComercialRadar } = fromRepo("modules/radar/comercial-precedencia");
const { criarRadarMirror } = fromRepo("modules/radar/radar-mirror");
const { extrairComercialUniversal } = fromRepo("modules/radar/extrator-comercial-universal");
const { criarEvidenciaCategoriaMarketplace } = fromRepo("marketplaces/inteligencia/classificador-categorias");
const { analisarDestinoOferta } = fromRepo("utils/destinos");

const pesca = "Pesca e Camping";
const beleza = "Perfumaria, Farmácia e Beleza";
const roupa = "Roupas e Moda Masculina";
const gamer = "Gamer e Hardware";
const diversos = "Diversos";
const mlb = "MLB900000511";
const mlUrl = "https://produto.mercadolivre.com.br/MLB-900000511-produto-fixture-_JM";
const shopeeUrl = "https://shopee.com.br/product/900011/900022";
const amazonUrl = "https://www.amazon.com.br/dp/B000000911";
const aliId = "1005009999000011";
const aliUrl = "https://pt.aliexpress.com/item/" + aliId + ".html";
const magId = "dg7dj18da7";
const magUrl = "https://www.magazinevoce.com.br/magazinefixture/blue-melody/p/" + magId + "/pf/pfme/";
const kabumUrl = "https://www.kabum.com.br/produto/911000/fixture";
const winUrl = "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=" + encodeURIComponent(kabumUrl);

function row(adapter, titulo, capturado, categoriaEsperada, opts = {}) {
  const cfg = {
    mercadolivre: [mlUrl, mlUrl, mlb, "jsonld.name", "https://meli.la/fixture"],
    shopee: [shopeeUrl, shopeeUrl, "900011/900022", "api.productOfferV2", "https://s.shopee.com.br/fixture"],
    amazon: [amazonUrl, amazonUrl, "B000000911", "amazon_importer", "https://amzn.to/fixture"],
    aliexpress: [aliUrl, aliUrl, aliId, "aliexpress_api.produto", "https://s.click.aliexpress.com/e/fixture"],
    magalu: [magUrl, magUrl, magId, "jsonld.name", magUrl + "?fixture="],
    awin_kabum: [winUrl, kabumUrl, "911000", "kabum_html.title", "https://www.awin1.com/cread.php?fixture="]
  };
  const [original, canonical, id, source, affiliate] = cfg[adapter];
  const mercado = adapter === "awin_kabum" ? "kabum" : adapter;
  const cliente = opts.workspace || "fixture-workspace-a";
  const job = { id: "fixture-job-" + adapter, evento_id: "fixture-event-" + adapter, cliente_id: cliente, marketplace: mercado };
  const link = { id: "fixture-produto", url_original: original };
  const imagem = opts.imagem || "https://cdn.example.invalid/imagem.jpg";
  const extraUrl = adapter === "shopee" ? "https://shopee.com.br/m/cupom-fixture" :
    adapter === "aliexpress" ? "https://a.aliexpress.com/_appfixture" : "https://links.example.invalid/condicoes";
  const links = [
    { id: link.id, urlOriginal: original, papelLink: adapter === "aliexpress" ? "link_pc" : "produto", urlAfiliadaWorkspace: affiliate + cliente },
    { id: "fixture-extra", urlOriginal: extraUrl, papelLink: adapter === "aliexpress" ? "link_app" : "resgate",
      urlAfiliadaWorkspace: extraUrl + "?ws=" + cliente }
  ];
  const produto = { titulo, imagem, produtoId: id };
  const metadata = { adapter, jobId: job.id, eventoId: job.evento_id, clienteId: cliente,
    linkOriginalEngine: adapter === "awin_kabum" ? canonical : original, produto,
    ...(adapter === "aliexpress" ? { linksClassificados: links } : { linksComerciais: links }) };
  if (adapter === "mercadolivre") {
    produto.tituloFonteOficial = source;
    metadata.identidadeCanonicaMl = { status: "consistente", mlbForteConfirmado: true,
      mlbProduto: id, mlbRevalidado: id, urlOriginal: original, urlCanonicaRevalidada: canonical };
  }
  if (adapter === "shopee") Object.assign(produto, { shopId: "900011", itemId: "900022",
    identidadeProdutoValidada: { fonte: source, shopId: "900011", itemId: "900022", urlCanonica: canonical } });
  if (adapter === "amazon") {
    produto.asin = id;
    metadata.diagnosticoAmazon = { tituloOrigem: source };
  }
  if (adapter === "aliexpress") {
    produto.metadata = { tituloFonteOficial: source };
    metadata.produtoCanonico = { produtoId: id, origem: "produto_api" };
  }
  if (adapter === "magalu") {
    Object.assign(produto, { urlCanonica: canonical, urlOriginal: canonical, urlAfiliavelComprovada: canonical,
      metadata: { fontes: { titulo: source }, factualResolver: { status: "ok",
        tentativas: [{ statusFactual: "aceita", canonicalValida: true, canonicalOrigem: "canonical", productIdObservado: id }] } } });
    metadata.fallbackRadar = { identidadeProdutoConfirmada: true };
  }
  if (adapter === "awin_kabum") Object.assign(produto, { tituloFonteOficial: source,
    produtoIdCanonico: id, categoriaOrigem: "padrao_importador_kabum" });
  if (opts.prova !== false) metadata.provaTituloTecnico = montarProvaTituloTecnico({
    marketplace: adapter, job, workspaceId: cliente, links: [link], linkEscolhido: { link },
    urlOriginal: original, urlCanonica: canonical, produtoId: id, titulo, fonteTitulo: source
  });
  if (opts.divergente) metadata.provaTituloTecnico.ocorrenciaLink.id = "outra-ocorrencia";
  const categoriaMarketplace = opts.categoriaOficial && criarEvidenciaCategoriaMarketplace({
    marketplace: mercado, fonte: opts.categoriaOficial[0], produtoId: id, hierarquia: [opts.categoriaOficial[1]]
  });
  const raw = { marketplace: mercado, titulo: capturado, preco: 19, precoOriginal: 42, cupom: "IMPORT99",
    categoria: opts.categoria || diversos, produtoIdDetectado: id, linkOriginal: original, linkExpandido: canonical,
    linkAfiliado: affiliate + cliente, imagem, metadata, categoriaMarketplace };
  const textoOriginal = [capturado, "De R$ 149,90 por R$ 89,90", "Use o cupom: RADAR10", original, extraUrl].join("\n");
  const comercial = extrairComercialUniversal({ textoOriginal, marketplaceDetectado: mercado });
  const mirror = criarRadarMirror({ textoOriginal, marketplace: mercado, clienteId: cliente, extracaoRadarLocal: {
    comercial, cupom: comercial.cupom, precoAtual: comercial.precoAtual, precoAnterior: comercial.precoAntigo, titulo: { valor: capturado }
  } });
  const normalizada = normalizarOfertaImportada(raw, job);
  const resolvida = resolverPrecedenciaComercialRadar({ ofertaImportador: normalizada, metadata: { ...normalizada.metadata, radarMirror: mirror },
    radarMirror: mirror, clienteId: cliente }).oferta;
  const fidelidade = validarFidelidadeComercialRadar(resolvida);
  const universal = montarOfertaUniversalEngine({ oferta: resolvida, ofertaEntrada: raw, job, link, metadata: resolvida.metadata });
  return { id, job, titulo, capturado, raw, links, normalizada, resolvida, universal, fidelidade, categoriaEsperada,
    retida: !normalizada.titulo || !fidelidade.ok };
}

const casos = [
  ["mercadolivre", "Isca Artificial Rapala X Rap 10 cm", "O clássico que combina com qualquer look", pesca],
  ["mercadolivre", "Anzol de Pesca Maruseigo 10 un", "Anzol de Pesca Maruseigo 10 un", pesca],
  ["mercadolivre", "Barraca de Camping Nautika 4 pessoas", "Barraca de Camping Nautika 8 pessoas", pesca],
  ["shopee", "Camiseta Masculina Algodão Modelo Atlas", "Ótima escolha para o fim de semana", roupa],
  ["amazon", "Placa de Vídeo RTX 4060 8 GB", "Placa de Vídeo RTX 4060 8 GB", gamer],
  ["aliexpress", "Barraca de Camping Nautika 4 pessoas", "Tênis esportivo Modelo ZX", pesca],
  ["magalu", "Paris Elysees Blue Melody 100ml", "O clássico que combina com qualquer look", beleza],
  ["magalu", "Produto Factual Modelo XY300", "Produto Factual Modelo XY300", beleza,
    { categoria: "Utilidades Domésticas", categoriaOficial: ["magalu_product_jsonld", "Perfumes"] }],
  ["awin_kabum", "Barraca de Camping Nautika 4 pessoas", "Oferta do dia", pesca, { categoria: gamer }],
  ["amazon", "Produto Factual Modelo XY300", "Produto Factual Modelo XY300", diversos],
  ["shopee", "Barraca de Camping Nautika 4 pessoas", "Oferta do dia", diversos, { prova: false }],
  ["mercadolivre", "Barraca de Camping Nautika 4 pessoas", "Oferta do dia", diversos, { divergente: true }]
];
const resultados = casos.map(args => row(...args));

if (process.env.OPTIMUS_MEASURE === "1") {
  const metrics = { total: resultados.length, diversos: 0, categoriasErradas: 0, titulosArtisticos: 0, retidas: 0 };
  for (const [i, o] of resultados.entries()) {
    if (o.resolvida.categoria === diversos) metrics.diversos++;
    if (o.resolvida.categoria !== o.categoriaEsperada && o.resolvida.categoria !== diversos) metrics.categoriasErradas++;
    if (o.resolvida.titulo === o.capturado && [0, 3, 6, 8].includes(i)) metrics.titulosArtisticos++;
    if (o.retida) metrics.retidas++;
    console.log("AMOSTRA", i, o.job.marketplace, JSON.stringify([o.resolvida.titulo || "", o.resolvida.categoria, o.retida, o.fidelidade.motivos]));
  }
  console.log("METRICAS", JSON.stringify(metrics));
} else {
  for (const [i, o] of resultados.entries()) {
    test("projeção e destino seletivo: caso " + i + " " + o.job.marketplace, () => {
      const negativa = i >= 10;
      assert.equal(o.resolvida.categoria, o.categoriaEsperada);
      assert.equal(o.universal.produto.categoriaNormalizada, o.categoriaEsperada);
      assert.equal(o.retida, negativa);
      assert.equal(o.universal.comercial.precoAtual, 89.9);
      assert.equal(o.universal.comercial.precoAnterior, 149.9);
      assert.equal(o.universal.comercial.cupom, "RADAR10");
      assert.equal(o.universal.afiliacao.urlAfiliada, o.raw.linkAfiliado);
      assert.deepEqual(o.normalizada.metadata.linksComerciais || o.normalizada.metadata.linksClassificados, o.links);
      if (negativa) {
        assert.equal(o.normalizada.titulo, "");
        assert.equal(Boolean(o.normalizada.metadata.provaTituloTecnicoValidada), false);
        return;
      }
      assert.equal(o.universal.produto.titulo, o.titulo);
      assert.equal(o.universal.produto.idExterno, o.id);
      assert.equal(o.universal.midia.imagemPrincipal, o.raw.imagem);
      assert.equal(o.normalizada.metadata.provaTituloTecnicoValidada.titulo.valor, o.titulo);
      assert.equal(o.normalizada.metadata.provaTituloTecnicoValidada.workspaceId, o.job.cliente_id);
      if (o.categoriaEsperada !== diversos) {
        const gate = categoria => analisarDestinoOferta({ ativo: true, categorias: [categoria] }, o.resolvida).aceita;
        assert.equal(gate(o.categoriaEsperada), true);
        assert.equal(gate(o.categoriaEsperada === pesca ? gamer : pesca), false);
      }
    });
  }

  test("rótulo externo não mapeado não substitui categoria do catálogo", () => {
    const titulo = "Camiseta Masculina Algodão Modelo Atlas";
    const o = row("shopee", titulo, titulo, roupa, { categoria: "Moda Internacional 123" });
    assert.equal(o.universal.produto.categoriaNormalizada, roupa);
  });

  test("Radar não reintroduz título factual quando a prova enviada é de outra ocorrência", () => {
    const titulo = "Barraca de Camping Nautika 4 pessoas";
    const o = row("aliexpress", titulo, titulo, diversos, { divergente: true });
    assert.equal(o.normalizada.metadata.provaTituloTecnicoRejeitada, true);
    assert.equal(o.resolvida.titulo ?? "", "");
    assert.equal(o.resolvida.categoria, diversos);
    assert.equal(o.retida, true);
  });

  test("captura compatível permanece; modelo/variante não são substituídos", () => {
    const titulo = "Smart TV Samsung 50 polegadas 4K UHD";
    const tituloCapturado = "Smart TV Samsung 50 polegadas";
    const o = row("magalu", titulo, tituloCapturado, "");
    assert.equal(o.resolvida.titulo, tituloCapturado);
    assert.equal(o.normalizada.tituloFactual, titulo);
    assert.equal(o.normalizada.metadata.provaTituloTecnicoValidada.titulo.valor, titulo);
    assert.equal(o.fidelidade.ok, true);
    assert.equal(row("magalu", titulo, "Smart TV Samsung 55 polegadas", "").resolvida.titulo, titulo);
  });

  test("afiliação mantém as ocorrências em cada workspace", () => {
    const a = row(...casos[5]);
    const b = row(...casos[5].slice(0, 4), { workspace: "fixture-workspace-b" });
    assert.equal(a.universal.produto.idExterno, b.universal.produto.idExterno);
    assert.notEqual(a.universal.workspaceId, b.universal.workspaceId);
    assert.notEqual(a.universal.afiliacao.urlAfiliada, b.universal.afiliacao.urlAfiliada);
    assert.deepEqual(a.links.map(link => link.urlOriginal), b.links.map(link => link.urlOriginal));
    assert.ok(a.links.every((link, i) => link.urlAfiliadaWorkspace !== b.links[i].urlAfiliadaWorkspace));
  });
}
