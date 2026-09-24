"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  consultarMlWorkIdentityBestEffort,
  mlWorkEnrichmentAtivo,
  prepararMlWorkEnrichmentAtivo,
  aplicarImagemMlWorkCanonica,
  aplicarTituloMlWork,
  montarTelemetriaMlWorkAtivo
} = require("../modules/engine/importer/ml-work-enrichment-shadow");
const {
  reclassificarCategoriaFinalEngine,
  tituloFactualConfiavelEngine
} = require("../modules/engine/importer/importer.service");
const {
  resolverImagemUniversal
} = require("../modules/imagens/resolver-imagem-universal");

const MLB = "MLB123456789";
const AGORA = Date.parse("2026-09-24T20:00:00.000Z");
const TITULO_WORK = "Tênis Nike Air Max Excee Masculino";
const IMAGEM_WORK = "https://http2.mlstatic.com/D_NQ_NP_2X_123-MLB123456789.jpg";

function identidade(overrides = {}) {
  const collectedAt = new Date(AGORA - 1000).toISOString();
  return {
    capability: "ml_identity_v1",
    contractVersion: 1,
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    observedMlb: MLB,
    identidadeValidada: true,
    tituloOficial: TITULO_WORK,
    imagemOficial: IMAGEM_WORK,
    origemTitulo: "jsonld.name",
    origemImagem: "jsonld.image",
    finalUrl: `https://produto.mercadolivre.com.br/${MLB}-tenis`,
    canonicalUrl: `https://produto.mercadolivre.com.br/${MLB}-tenis`,
    collectedAt,
    provaTecnica: {
      capability: "ml_identity_v1",
      contractVersion: 1,
      source: "local_first_party",
      provenance: "local_worker.ml_identity_v1",
      expectedMlb: MLB,
      observedMlb: MLB,
      sameProductObject: true,
      origemTitulo: "jsonld.name",
      origemImagem: "jsonld.image",
      finalUrl: `https://produto.mercadolivre.com.br/${MLB}-tenis`,
      canonicalUrl: `https://produto.mercadolivre.com.br/${MLB}-tenis`,
      collectedAt
    },
    ...overrides
  };
}

function consultaValida(overrides = {}) {
  return {
    observado: true,
    identidadeValidada: true,
    cacheHit: true,
    motivoRejeicao: "",
    duracaoMs: 7,
    resultado: identidade(),
    ...overrides
  };
}

function promocao(consulta = consultaValida(), extras = {}) {
  return prepararMlWorkEnrichmentAtivo({
    consulta,
    expectedMlb: MLB,
    marketplace: "mercadolivre",
    ativo: true,
    agoraMs: AGORA,
    tituloValido: tituloFactualConfiavelEngine,
    ...extras
  });
}

function motivoFallbackSanitizado(motivoRejeicao) {
  return promocao({
    identidadeValidada: false,
    cacheHit: false,
    motivoRejeicao,
    resultado: null
  }).motivoFallback;
}

(async () => {
  assert.strictEqual(mlWorkEnrichmentAtivo({ env: {} }), false);
  assert.strictEqual(mlWorkEnrichmentAtivo({ env: { ML_WORK_ENRICHMENT_ACTIVE: "true" } }), true);
  assert.strictEqual(mlWorkEnrichmentAtivo({ deps: { mlWorkEnrichmentAtivo: false }, env: { ML_WORK_ENRICHMENT_ACTIVE: "true" } }), false);
  const importerSource = fs.readFileSync(path.join(__dirname, "../modules/engine/importer/importer.service.js"), "utf8");
  const indicePrecedencia = importerSource.indexOf("const resultadoPrecedenciaComercial = resolverPrecedenciaComercialRadar(");
  const indiceTituloWork = importerSource.indexOf("const tituloMlWork = aplicarTituloMlWork(");
  const indiceReclassificacao = importerSource.indexOf("const categoriaFinalResolvida = reclassificarCategoriaFinalEngine(");
  const indiceImagemWork = importerSource.indexOf("imagemCanonicaFinal = aplicarImagemMlWorkCanonica(");
  const indiceBarreiraImagem = importerSource.indexOf("oferta = aplicarImagemCanonicaFinalOferta(");
  assert.ok(indicePrecedencia >= 0 && indiceTituloWork > indicePrecedencia && indiceReclassificacao > indiceTituloWork);
  assert.ok(indiceImagemWork >= 0 && indiceBarreiraImagem > indiceImagemWork);

  const ofertaBase = {
    marketplace: "mercadolivre",
    titulo: "Tênis Mercado Livre Atual",
    nome: "Tênis Mercado Livre Atual",
    imagem: "https://http2.mlstatic.com/D_NQ_NP_ATUAL-MLB.jpg",
    categoria: "Diversos",
    preco: 1379,
    precoAtual: 1379,
    precoOriginal: 2199,
    precoAnterior: 2199,
    cupom: "RADAR100",
    codigoCupom: "RADAR100",
    beneficios: ["R$ 100 OFF", "frete grátis"],
    parcelamento: "10x sem juros",
    linkAfiliado: "https://meli.la/workspace",
    linkResgateCupom: "",
    linkApp: "https://app.exemplo/workspace",
    linkPc: "https://pc.exemplo/workspace",
    linksComerciais: [
      { papel: "produto", url: "https://meli.la/workspace", proof: "hmac-workspace" },
      { papel: "resgate", url: "https://resgate.exemplo/workspace", proof: "hmac-resgate" }
    ]
  };
  const metadataBase = {
    produto: { titulo: ofertaBase.titulo },
    linksClassificados: ofertaBase.linksComerciais,
    hmac: "hmac-workspace",
    comercialCapturado: { precoAtual: 1379, cupom: "RADAR100" }
  };

  // 1 e 2: cache válido promove título e imagem oficiais do mesmo MLB.
  const ativa = promocao();
  assert.strictEqual(ativa.identidadeValidada, true);
  assert.strictEqual(ativa.tituloWork, TITULO_WORK);
  assert.strictEqual(ativa.imagemWork, IMAGEM_WORK);
  const tituloAplicado = aplicarTituloMlWork({ oferta: ofertaBase, metadataFinal: metadataBase, promocao: ativa });
  const imagemAplicada = aplicarImagemMlWorkCanonica({
    imagemCanonicaDuravel: ofertaBase.imagem,
    imagemOrigem: "mercadolivre_api",
    imagemStatus: "imagem_oficial_ml"
  }, ativa);
  assert.strictEqual(tituloAplicado.oferta.titulo, TITULO_WORK);
  assert.strictEqual(imagemAplicada.imagemCanonicaDuravel, IMAGEM_WORK);
  assert.strictEqual(imagemAplicada.imagemOrigem, "local_worker.ml_identity_v1");
  assert.strictEqual(imagemAplicada.localWorkerIdentityProof.provenance, "local_worker.ml_identity_v1");
  assert.strictEqual(Object.hasOwn(imagemAplicada.localWorkerIdentityProof, "finalUrl"), false);
  const flagOff = prepararMlWorkEnrichmentAtivo({
    consulta: consultaValida(),
    expectedMlb: MLB,
    marketplace: "mercadolivre",
    ativo: false,
    agoraMs: AGORA,
    tituloValido: tituloFactualConfiavelEngine
  });
  assert.strictEqual(flagOff.tituloWork, "");
  assert.strictEqual(flagOff.imagemWork, "");
  assert.strictEqual(flagOff.motivoFallback, "flag_desabilitada");
  const ofertaImagemWork = {
    ...ofertaBase,
    imagem: imagemAplicada.imagemCanonicaDuravel,
    imagemUrl: imagemAplicada.imagemCanonicaDuravel,
    imagemOrigem: imagemAplicada.imagemOrigem,
    imagemStatus: imagemAplicada.imagemStatus,
    imagemEnviavel: true,
    imagemDuravel: true,
    metadata: { localWorkerIdentityProof: imagemAplicada.localWorkerIdentityProof }
  };
  assert.strictEqual(resolverImagemUniversal(ofertaImagemWork).imagem, IMAGEM_WORK);

  // 7 e 8: somente identidade/visual mudam; comércio, links, papéis e HMAC ficam byte-semanticamente iguais.
  const camposComerciais = objeto => JSON.stringify({
    preco: objeto.preco,
    precoAtual: objeto.precoAtual,
    precoOriginal: objeto.precoOriginal,
    precoAnterior: objeto.precoAnterior,
    cupom: objeto.cupom,
    codigoCupom: objeto.codigoCupom,
    beneficios: objeto.beneficios,
    parcelamento: objeto.parcelamento
  });
  const camposLinks = objeto => JSON.stringify({
    linkAfiliado: objeto.linkAfiliado,
    linkResgateCupom: objeto.linkResgateCupom,
    linkApp: objeto.linkApp,
    linkPc: objeto.linkPc,
    linksComerciais: objeto.linksComerciais
  });
  assert.strictEqual(camposComerciais(tituloAplicado.oferta), camposComerciais(ofertaBase));
  assert.strictEqual(camposLinks(tituloAplicado.oferta), camposLinks(ofertaBase));
  assert.strictEqual(JSON.stringify(tituloAplicado.metadataFinal.linksClassificados), JSON.stringify(metadataBase.linksClassificados));
  assert.strictEqual(tituloAplicado.metadataFinal.hmac, metadataBase.hmac);

  // 9 e 10: o classificador atual recebe o título factual; categoria específica segue preservada.
  const reclassificada = reclassificarCategoriaFinalEngine(tituloAplicado.oferta, tituloAplicado.metadataFinal, {});
  assert.strictEqual(reclassificada.oferta.categoria, "Tênis e Chinelos");
  const especifica = reclassificarCategoriaFinalEngine({ ...tituloAplicado.oferta, categoria: "Moda" }, tituloAplicado.metadataFinal, {});
  assert.strictEqual(especifica.oferta.categoria, "Moda");
  assert.strictEqual(especifica.motivo, "categoria_especifica_preservada");

  // 3: cache miss não promove nem altera o fallback ML atual.
  const miss = promocao({ identidadeValidada: false, cacheHit: false, motivoRejeicao: "cache_identity_indisponivel", resultado: null });
  assert.strictEqual(miss.tituloWork, "");
  assert.strictEqual(miss.imagemWork, "");
  assert.strictEqual(aplicarTituloMlWork({ oferta: ofertaBase, metadataFinal: metadataBase, promocao: miss }).oferta, ofertaBase);
  assert.strictEqual(aplicarImagemMlWorkCanonica({ imagemCanonicaDuravel: ofertaBase.imagem }, miss).imagemCanonicaDuravel, ofertaBase.imagem);

  // 4: worker offline continua best-effort e não cria bloqueio/retry no contrato ativo.
  const offlineConsulta = await consultarMlWorkIdentityBestEffort({
    marketplace: "mercadolivre",
    expectedMlb: MLB,
    sourceUrl: `https://produto.mercadolivre.com.br/${MLB}-tenis`,
    agoraMs: AGORA,
    deps: {
      obterIdentidadeMercadoLivreLocalWorker: async () => { throw new Error("worker_offline"); },
      garantirIdentidadeMercadoLivreLocalWorker: async () => { throw new Error("worker_offline"); }
    }
  });
  const offline = promocao(offlineConsulta);
  assert.strictEqual(offline.identidadeValidada, false);
  assert.strictEqual(offline.tituloWork, "");
  assert.strictEqual(Object.hasOwn(offlineConsulta, "retriavel"), false);

  // 5: conflito de MLB falha fechado.
  const conflito = promocao(consultaValida({ resultado: identidade({ observedMlb: "MLB999999999" }) }));
  assert.strictEqual(conflito.identidadeValidada, false);
  assert.match(conflito.motivoFallback, /ml_identity_mlb_divergente/);

  // 6: sem expected MLB não há tentativa de inferência nem promoção.
  const semExpected = promocao(consultaValida(), { expectedMlb: "" });
  assert.strictEqual(semExpected.expectedMlbPresente, false);
  assert.strictEqual(semExpected.motivoFallback, "expected_mlb_ausente");
  assert.strictEqual(semExpected.tituloWork, "");

  // 11 e 12: imagem não oficial e cache expirado são rejeitados.
  const imagemInvalida = promocao(consultaValida({ resultado: identidade({ imagemOficial: "https://evil.example/produto.jpg" }) }));
  assert.strictEqual(imagemInvalida.imagemWork, "");
  assert.match(imagemInvalida.motivoFallback, /ml_identity_imagem_host_invalido/);
  const expirado = promocao(consultaValida({ resultado: identidade({
    collectedAt: new Date(AGORA - 25 * 60 * 60 * 1000).toISOString(),
    provaTecnica: {
      ...identidade().provaTecnica,
      collectedAt: new Date(AGORA - 25 * 60 * 60 * 1000).toISOString()
    }
  }) }));
  assert.strictEqual(expirado.identidadeValidada, false);
  assert.match(expirado.motivoFallback, /ml_identity_resultado_stale/);

  // 13: resultado tardio não modifica a decisão já tomada para a ocorrência atual.
  const consultaTardia = { identidadeValidada: false, cacheHit: false, motivoRejeicao: "cache_identity_indisponivel", resultado: null };
  const decisaoOcorrenciaAtual = promocao(consultaTardia);
  consultaTardia.identidadeValidada = true;
  consultaTardia.cacheHit = true;
  consultaTardia.resultado = identidade();
  assert.strictEqual(decisaoOcorrenciaAtual.tituloWork, "");
  assert.strictEqual(decisaoOcorrenciaAtual.imagemWork, "");

  // 14: flag é exclusiva de ML e o objeto ml_image_v1 permanece intacto sem promoção aplicável.
  const magalu = prepararMlWorkEnrichmentAtivo({ consulta: consultaValida(), expectedMlb: MLB, marketplace: "magalu", ativo: true, agoraMs: AGORA });
  assert.strictEqual(magalu.motivoFallback, "marketplace_nao_ml");
  const mlImageAtual = { imagemCanonicaDuravel: ofertaBase.imagem, imagemOrigem: "local_worker.ml_image_v1", localWorkerProof: { proof: "existente" } };
  assert.strictEqual(aplicarImagemMlWorkCanonica(mlImageAtual, magalu), mlImageAtual);

  const telemetria = montarTelemetriaMlWorkAtivo({
    promocao: ativa,
    categoriaAntes: "Diversos",
    categoriaDepois: reclassificada.oferta.categoria
  });
  assert.strictEqual(telemetria.tituloWorkAplicado, true);
  assert.strictEqual(telemetria.imagemWorkAplicada, true);
  assert.strictEqual(telemetria.comercialAlterado, false);
  assert.strictEqual(telemetria.linksAlterados, false);
  assert.strictEqual(telemetria.expectedMlbHash.length, 16);
  assert.strictEqual(JSON.stringify(telemetria).includes(TITULO_WORK), false);
  assert.strictEqual(JSON.stringify(telemetria).includes(IMAGEM_WORK), false);

  // Telemetria: valores sensíveis e query/tracking são redigidos antes da normalização.
  const casosSensiveis = [
    "https://exemplo.test/path?access_token=SEGREDO123#fragmento",
    "access_token=SEGREDO123",
    "access_token: SEGREDO123",
    "Authorization: Bearer ABC123",
    "Authorization Bearer ABC123",
    "Bearer ABC123",
    "client_secret=MINHACHAVE",
    "cookie=sessionid=XYZ",
    "https://exemplo.test/path?utm_source=x&clickid=abc"
  ];
  for (const entrada of casosSensiveis) {
    const motivo = motivoFallbackSanitizado(entrada);
    assert.strictEqual(motivo.includes("SEGREDO123"), false);
    assert.strictEqual(motivo.includes("ABC123"), false);
    assert.strictEqual(motivo.includes("MINHACHAVE"), false);
    assert.strictEqual(motivo.includes("XYZ"), false);
    assert.strictEqual(motivo.includes("utm_source"), false);
    assert.strictEqual(motivo.includes("clickid"), false);
  }
  const queriesIsoladas = [
    ["?utm_source=x&clickid=abc", ["x", "abc"]],
    ["utm_source=x&clickid=abc", ["x", "abc"]],
    ["?foo=bar", ["bar"]],
    ["foo=bar&baz=qux", ["bar", "qux"]],
    ["?access_token=SEGREDO123&foo=bar", ["SEGREDO123", "bar"]],
    ["falha: ?utm_source=x&clickid=abc", ["x", "abc"]],
    ["falha utm_source=x&clickid=abc", ["x", "abc"]]
  ];
  for (const [entrada, valores] of queriesIsoladas) {
    const motivo = motivoFallbackSanitizado(entrada);
    assert.strictEqual(motivo, "query_redigida", entrada);
    for (const valor of valores) assert.strictEqual(motivo.includes(valor), false, entrada);
    assert.strictEqual(montarTelemetriaMlWorkAtivo({ promocao: { motivoFallback: entrada } }).motivoFallback, "query_redigida");
  }
  assert.strictEqual(motivoFallbackSanitizado("expected_mlb_ausente"), "expected_mlb_ausente");
  assert.strictEqual(motivoFallbackSanitizado("worker offline temporariamente"), "worker_offline_temporariamente");
  assert.strictEqual(motivoFallbackSanitizado("worker_offline_temporariamente"), "worker_offline_temporariamente");
  assert.strictEqual(motivoFallbackSanitizado("cache_expirado"), "cache_expirado");
  assert.strictEqual(motivoFallbackSanitizado("identidade_conflitante"), "identidade_conflitante");

  const telemetriaDefensiva = montarTelemetriaMlWorkAtivo({
    promocao: { motivoFallback: "Authorization: Bearer ABC123" }
  });
  assert.strictEqual(JSON.stringify(telemetriaDefensiva).includes("ABC123"), false);
  assert.strictEqual(telemetriaDefensiva.motivoFallback, "credencial_redigida");

  console.log("ml-work-enrichment-active.test.js: ok");
})().catch(erro => { console.error(erro); process.exitCode = 1; });
