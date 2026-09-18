"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  importarProdutoMagaluEngine,
  extrairPrecoRadarSeguroMagalu
} = require("../modules/engine/importer/adapters/magalu.adapter");
const {
  escolherProdutoPrincipal
} = require("../modules/engine/link-role.service");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal
} = require("../modules/engine/oferta-universal.contract");

const urlProduto = "https://www.magazineluiza.com.br/smart-tv-50/p/abc123/et/elit/";
const urlWorkspaceFixture = "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/";
const urlRealA07 = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a07/p/240466500/te/ga07/";
const urlA17Divergente = "https://www.magazinevoce.com.br/magazined1egopc/smartphone-samsung-a17/p/240575800/te/ga17/";
const urlNightCaviar = "https://www.magazinevoce.com.br/d1egopc/night-caviar-100ml-paris-elysses/p/be172949ba/pf/ppfm/";
const urlDivulgadorOferta = "https://www.magazineluiza.com.br/smart-tv-50-tcl-4k-uhd-qled-50p7k-google-tv-aipq-google-assistente-3-hdmi/divulgador/oferta/240144700/et/elit/?promoter_id=5438968&partner_id=3440";
const urlDivulgadorOfertaPdp = "https://www.magazineluiza.com.br/smart-tv-50-tcl-4k-uhd-qled-50p7k-google-tv-aipq-google-assistente-3-hdmi/p/240144700/et/elit/";
const htmlProduto = `
  <html>
    <head>
      <link rel="canonical" href="${urlProduto}">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Smart TV Magalu 50",
          "sku": "abc123",
          "image": "https://a-static.mlcdn.com.br/tv.jpg",
          "offers": { "price": "1999.90", "priceCurrency": "BRL" }
        }
      </script>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home" },
            { "@type": "ListItem", "position": 2, "name": "TV e Video" },
            { "@type": "ListItem", "position": 3, "name": "Smart TV" }
          ]
        }
      </script>
    </head>
    <body>
      <span>Preco anterior R$ 2.499,90</span>
      <p>em 10x de R$ 199,99 sem juros</p>
      <p>vendido e entregue por <strong>Magalu</strong></p>
      <p>Cupom MAGALU10</p>
    </body>
  </html>
`;

function linkRow(id, url) {
  return {
    id,
    url_original: url,
    url_normalizada: url,
    url_expandida: "",
    marketplace_detectado: "magalu",
    metadata: {}
  };
}

function deps({ html = htmlProduto, promoterId = "d1egopc", gerarLinkAfiliadoMagaluSeguro, resolverFatosMagalu } = {}) {
  const chamadas = [];
  return {
    chamadas,
    deps: {
      magaluParserOptions: { html },
      getIntegracaoCliente(clienteId, marketplace) {
        chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
        return promoterId ? { credenciais: { promoterId } } : null;
      },
      resolverFatosMagalu: resolverFatosMagalu || (async () => ({
        ok: true, produtoId: "abc123", sellerIdOriginal: "",
        fonteUsada: "magazinevoce_magazine_promoter",
        fatos: {
          urlOriginal: urlProduto, urlCanonica: urlWorkspaceFixture, urlAfiliavelComprovada: urlWorkspaceFixture,
          magaluWorkspaceValidado: true, produtoId: "abc123", codigo: "abc123", titulo: "Smart TV Magalu 50",
          precoAtual: "R$ 1.999,90", precoAnterior: "R$ 2.499,90", imagem: "https://a-static.mlcdn.com.br/tv.jpg",
          categoria: "TV e Video", seller: "Magalu", parcelamento: "", cupom: "", avisos: [],
          metadata: { fontes: { urlCanonica: "canonical" }, imagemOficial: { dimensoes: { largura: 800, altura: 560 } } }
        }, avisos: []
      })),
      ...(gerarLinkAfiliadoMagaluSeguro ? { gerarLinkAfiliadoMagaluSeguro } : {})
    }
  };
}

async function importarMagaluFixture({ evento = {}, depsExtras = {} } = {}) {
  return importarProdutoMagaluEngine({
    job: { id: 501, evento_id: 601, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smart TV Magalu 50\nPor R$ 1.777,00\nLink do produto:\n" + urlProduto,
      links_extraidos: [urlProduto],
      ...evento
    },
    links: [linkRow(1, urlProduto)],
    deps: depsExtras
  });
}

async function testarImportacaoCompletaPreservaPrecoRadar() {
  const pacote = deps();
  const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.marketplace, "magalu");
  assert.strictEqual(resultado.titulo, "Smart TV Magalu 50");
  assert.strictEqual(resultado.preco, 1777);
  assert.strictEqual(resultado.precoAtual, 1777);
  assert.strictEqual(resultado.precoPagina, 1999.9);
  assert.strictEqual(resultado.precoOriginal, "");
  assert.strictEqual(resultado.imagem, "https://a-static.mlcdn.com.br/tv.jpg");
  assert.strictEqual(resultado.categoria, "TV e Video");
  assert.strictEqual(resultado.seller, "Magalu");
  assert.strictEqual(resultado.parcelamento, "");
  assert.strictEqual(resultado.linkAfiliado, "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50/p/abc123/et/elit/");
  assert.strictEqual(resultado.metadata.precoRadarUsado, true);
  assert.strictEqual(resultado.metadata.precoAuditoria.motivoEscolhaPreco, "preco_radar_explicito_confiavel");
  assert.deepStrictEqual(pacote.chamadas, [{ tipo: "getIntegracaoCliente", clienteId: "workspace_magalu", marketplace: "magalu" }]);
  assert.ok(!Object.prototype.hasOwnProperty.call(resultado.metadata, "promoterId"), "metadata nao deve expor promoterId como campo");
  assert.ok(!Object.prototype.hasOwnProperty.call(resultado.metadata.provaAfiliado, "promoterId"), "prova de afiliado nao deve expor promoterId como campo");
}

async function testarSemPrecoRadarUsaPagina() {
  const pacote = deps();
  const resultado = await importarMagaluFixture({
    evento: { texto_original: "Smart TV Magalu 50\nLink: " + urlProduto },
    depsExtras: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "preco_indisponivel");
}

async function testarUrlOriginalNaoViraAfiliada() {
  const pacote = deps();
  const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.linkAfiliado, urlWorkspaceFixture);
  assert.notStrictEqual(resultado.linkAfiliado, urlProduto);
  assert.strictEqual(resultado.metadata.afiliacaoWorkspace.conversaoStatus, "convertida");

  const semProva = await importarMagaluFixture({
    depsExtras: {
      ...pacote.deps,
      resolverFatosMagalu: async () => ({ ok: false, motivo: "magalu_http_403", fatos: {}, avisos: ["magalu_http_403"] })
    }
  });
  assert.strictEqual(semProva.ok, false);
  assert.strictEqual(semProva.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(semProva.linkAfiliado, undefined);
}

async function testarDiagnosticoAfiliacaoFalhaSemRelaxarGate() {
  const logs = [];
  const originalLog = console.log;
  console.log = (evento, payload) => {
    if (evento === "[ENGINE-MAGALU-AFILIACAO-DIAGNOSTICO]") logs.push(JSON.parse(payload));
  };

  try {
    const pacote = deps({
      resolverFatosMagalu: async () => ({
        ok: false,
        motivo: "magalu_http_403",
        produtoId: "",
        fatos: {
          avisos: ["magalu_http_403"],
          metadata: { httpFactual: { tentativas: [{ status: 403 }] } }
        },
        tentativas: [{
          fonte: "magazinevoce_magazine_promoter",
          statusFactual: "rejeitada",
          motivo: "magalu_http_403",
          statusHttp: 403,
          urlFinalTipo: "magazinevoce_produto",
          canonicalValida: false,
          productIdObservado: ""
        }],
        avisos: ["magalu_http_403"]
      })
    });
    const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });
    const diagnostico = resultado.metadata.afiliacaoWorkspaceDiagnostico;

    assert.strictEqual(resultado.ok, false, "falha continua fail-closed");
    assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
    assert.strictEqual(diagnostico.jobId, 501);
    assert.strictEqual(diagnostico.eventoId, 601);
    assert.strictEqual(diagnostico.productIdEsperado, "abc123");
    assert.strictEqual(diagnostico.promoterIdEsperado, "d1egopc");
    assert.strictEqual(diagnostico.statusHttp, 403);
    assert.strictEqual(diagnostico.motivoInterno, "magalu_http_403");
    assert.strictEqual(diagnostico.urlAfiliavelComprovadaExiste, false);
    assert.strictEqual(diagnostico.provaAfiliacaoExiste, false);
    assert.strictEqual(diagnostico.candidatasTentadas[0].statusHttp, 403);
    assert.strictEqual(resultado.linkAfiliado, undefined, "URL original nao vira fallback");
    assert.strictEqual(logs.length, 1, "diagnostico estruturado deve ser logado uma vez");
    assert.strictEqual(logs[0].motivoInterno, "magalu_http_403");
  } finally {
    console.log = originalLog;
  }
}

async function testarDeepLinkSemPrefixoPromoter() {
  const urlWorkspaceNight = "https://www.magazinevoce.com.br/magazined1egopc/night-caviar-100ml-paris-elysses/p/be172949ba/pf/ppfm/";
  const pacote = deps({
    resolverFatosMagalu: async () => ({
      ok: true, produtoId: "be172949ba", sellerIdOriginal: "", fonteUsada: "magazinevoce_magazine_promoter",
      fatos: {
        urlOriginal: urlNightCaviar, urlCanonica: urlWorkspaceNight, urlAfiliavelComprovada: urlWorkspaceNight,
        magaluWorkspaceValidado: true, produtoId: "be172949ba", codigo: "be172949ba", titulo: "Night Caviar 100ml - Paris Elysses",
        imagem: "https://a-static.mlcdn.com.br/800x560/night.jpg", categoria: "Perfumaria", seller: "", avisos: [],
        metadata: { fontes: { urlCanonica: "canonical" }, imagemOficial: { dimensoes: { largura: 800, altura: 560 } } }
      }, avisos: []
    })
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 504, evento_id: 604, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Night Caviar 100ml - Paris Elysses\nPor R$ 78,90\nLink: " + urlNightCaviar,
      links_extraidos: [urlNightCaviar]
    },
    links: [linkRow(4, urlNightCaviar)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Night Caviar 100ml - Paris Elysses");
  assert.strictEqual(resultado.produtoId, "be172949ba");
  assert.strictEqual(resultado.linkAfiliado, urlWorkspaceNight);
  assert.notStrictEqual(resultado.linkAfiliado, urlNightCaviar);
  assert.strictEqual(resultado.preco, 78.9);
}

async function testarIntegracaoAusenteBloqueiaImportacaoAutomatica() {
  const pacote = deps({ promoterId: "" });
  const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "integracao_ausente");
}

async function testarEngineNaoTrocaProdutoPorCanonicaDivergente() {
  const pacote = deps({
    resolverFatosMagalu: async () => ({
      ok: false,
      produtoId: "240466500",
      sellerIdOriginal: "",
      fatos: {
        urlOriginal: urlRealA07,
        urlCanonica: "",
        urlAfiliavelComprovada: "",
        magaluWorkspaceValidado: false,
        imagem: "",
        avisos: ["magalu_url_factual_produto_divergente"]
      },
      avisos: ["magalu_url_factual_produto_divergente"]
    })
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 502, evento_id: 602, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smartphone Samsung A07\nPor R$ 777,00\nLink: " + urlRealA07,
      links_extraidos: [urlRealA07]
    },
    links: [linkRow(2, urlRealA07)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.linkAfiliado, undefined);
  assert.strictEqual(resultado.imagem, undefined);
  assert.ok(!JSON.stringify(resultado).includes("240575800"));
  assert.strictEqual(resultado.linkOriginal, urlRealA07, "URL original permanece apenas para auditoria");
}

async function testarPaginaIndisponivelComRadarSuficienteContinuaPipeline() {
  const resolucoes = [];
  const textoRadar = "Night Caviar\nDe R$ 99,90\nPor R$ 78,90\nCupom: MAGALU10\nLink: " + urlNightCaviar;
  const pacote = deps({
    resolverFatosMagalu: async ({ urlOriginal }) => {
      resolucoes.push(urlOriginal);
      return {
        ok: false,
        motivo: "magalu_http_403",
        fatos: { imagem: "", avisos: ["magalu_http_403"] },
        avisos: ["magalu_http_403"]
      };
    }
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 505, evento_id: 605, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: textoRadar,
      links_extraidos: [urlNightCaviar]
    },
    links: [linkRow(5, urlNightCaviar)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.linkOriginal, urlNightCaviar, "link original permanece somente para auditoria");
  assert.strictEqual(resultado.linkAfiliado, undefined);
  assert.strictEqual(resultado.imagem, undefined);
  assert.strictEqual(resultado.metadata.provaAfiliado.conversaoStatus, "falhou");
  assert.deepStrictEqual(resolucoes, [urlNightCaviar], "nao procura produto alternativo quando a pagina workspace falha");
  assert.strictEqual(textoRadar.includes("R$ 78,90") && textoRadar.includes("MAGALU10"), true, "verdade comercial Radar permanece no evento de auditoria");
}

async function testarCaptchaComRadarSuficienteContinuaPipeline() {
  const resolucoes = [];
  const textoRadar = "Smartphone Samsung A07 128GB Preto\nDe R$ 899,00\nPor R$ 777,00\nCupom: MAGALU10\nLink: " + urlRealA07;
  const pacote = deps({
    resolverFatosMagalu: async ({ urlOriginal }) => {
      resolucoes.push(urlOriginal);
      return {
        ok: false,
        motivo: "magalu_captcha_detectado",
        fatos: { imagem: "", avisos: ["magalu_captcha_detectado"] },
        avisos: ["magalu_captcha_detectado"]
      };
    }
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 503, evento_id: 603, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: textoRadar,
      links_extraidos: [urlRealA07]
    },
    links: [linkRow(3, urlRealA07)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.linkOriginal, urlRealA07, "link original permanece somente para auditoria");
  assert.strictEqual(resultado.linkAfiliado, undefined);
  assert.strictEqual(resultado.imagem, undefined);
  assert.strictEqual(resultado.metadata.provaAfiliado.conversaoStatus, "falhou");
  assert.deepStrictEqual(resolucoes, [urlRealA07], "CAPTCHA nao procura produto alternativo");
  assert.strictEqual(textoRadar.includes("R$ 777,00") && textoRadar.includes("MAGALU10"), true, "verdade comercial Radar permanece no evento de auditoria");
}

async function testarResolverFalhaComRadarSuficienteContinuaPipeline() {
  const resolucoes = [];
  const textoRadar = "Night Caviar 100ml - Paris Elysses\nDe R$ 99,90\nPor R$ 78,90\nCupom: MAGALU10\nLink: " + urlNightCaviar;
  const pacote = deps();

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 507, evento_id: 607, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: textoRadar,
      links_extraidos: [urlNightCaviar]
    },
    links: [linkRow(7, urlNightCaviar)],
    deps: {
      ...pacote.deps,
      resolverFatosMagalu: async ({ urlOriginal }) => {
        resolucoes.push(urlOriginal);
        throw new Error("HTTP 403");
      }
    }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.linkOriginal, urlNightCaviar, "link original permanece somente para auditoria");
  assert.strictEqual(resultado.linkAfiliado, undefined);
  assert.strictEqual(resultado.imagem, undefined);
  assert.strictEqual(resultado.metadata.provaAfiliado.conversaoStatus, "falhou");
  assert.deepStrictEqual(resolucoes, [urlNightCaviar], "falha do resolver nao procura produto alternativo");
  assert.strictEqual(textoRadar.includes("R$ 78,90") && textoRadar.includes("MAGALU10"), true, "verdade comercial Radar permanece no evento de auditoria");
}

async function testarRadarSemTituloNaoContinuaPipeline() {
  const pacote = deps({
    resolverFatosMagalu: async () => ({
      ok: false,
      produtoId: "240466500",
      sellerIdOriginal: "",
      fatos: {
        titulo: "",
        imagem: "",
        avisos: ["magalu_http_403"]
      },
      avisos: ["magalu_http_403"]
    })
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 508, evento_id: 608, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Por R$ 777,00\nLink: " + urlRealA07,
      links_extraidos: [urlRealA07]
    },
    links: [linkRow(8, urlRealA07)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "titulo_indisponivel");
  assert.strictEqual(resultado.linkAfiliado, undefined);
}

async function testarTituloTecnicoConfiavelProssegueAteGateAfiliacao() {
  const pacote = deps();
  const resultado = await importarProdutoMagaluEngine({
    job: { id: 5081, evento_id: 6081, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Por R$ 777,00\nLink: " + urlRealA07,
      links_extraidos: [urlRealA07]
    },
    links: [linkRow(81, urlRealA07)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.notStrictEqual(resultado.motivo, "titulo_indisponivel");
  assert.strictEqual(resultado.linkAfiliado, undefined);
}

async function testarRadarSemPrecoNaoContinuaPipeline() {
  const pacote = deps({
    html: "<html><head><title>Captcha Magalu</title></head><body>Complete o CAPTCHA</body></html>",
    gerarLinkAfiliadoMagaluSeguro: (url) => ({
      urlAfiliada: url,
      comprovado: true,
      avisos: []
    })
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 509, evento_id: 609, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smartphone Samsung A07 128GB Preto\nLink: " + urlRealA07,
      links_extraidos: [urlRealA07]
    },
    links: [linkRow(9, urlRealA07)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "preco_indisponivel");
}

async function testarDeepLinkOutraLojaNaoContinuaPipeline() {
  const urlOutraLoja = "https://www.magazinevoce.com.br/outraloja/night-caviar-100ml-paris-elysses/p/be172949ba/pf/ppfm/";
  const resolucoes = [];
  const pacote = deps({
    resolverFatosMagalu: async ({ urlOriginal }) => {
      resolucoes.push(urlOriginal);
      return {
        ok: false,
        produtoId: "be172949ba",
        sellerIdOriginal: "",
        fatos: {
          titulo: "Night Caviar 100ml - Paris Elysses",
          imagem: "",
          urlAfiliavelComprovada: "",
          magaluWorkspaceValidado: false,
          avisos: []
        },
        avisos: []
      };
    }
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 510, evento_id: 610, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Night Caviar 100ml - Paris Elysses\nPor R$ 78,90\nLink: " + urlOutraLoja,
      links_extraidos: [urlOutraLoja]
    },
    links: [linkRow(10, urlOutraLoja)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(resultado.linkOriginal, urlOutraLoja, "deep-link de outra loja permanece apenas para auditoria");
  assert.strictEqual(resultado.linkAfiliado, undefined);
  assert.strictEqual(resultado.imagem, undefined);
  assert.ok(!JSON.stringify(resultado.metadata.provaAfiliado).includes("outraloja"));
  assert.deepStrictEqual(resolucoes, [urlOutraLoja], "nao procura produto ou loja alternativos");
}

async function testarOfertaUniversalValida() {
  const pacote = deps();
  const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });
  const ofertaUniversal = montarOfertaUniversalEngine({
    oferta: resultado,
    ofertaEntrada: resultado,
    job: { id: 501, evento_id: 601, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: { id: 601, texto_original: "Smart TV Magalu 50\nPor R$ 1.777,00" },
    link: linkRow(1, urlProduto),
    metadata: resultado.metadata
  });

  assert.strictEqual(validarContratoOfertaUniversal(ofertaUniversal).ok, true);
  assert.strictEqual(ofertaUniversal.marketplace, "magalu");
  assert.strictEqual(ofertaUniversal.comercial.precoAtual, 1777);
  assert.strictEqual(ofertaUniversal.produto.idExterno, "abc123");
  assert.strictEqual(ofertaUniversal.afiliacao.urlAfiliada, resultado.linkAfiliado);
}

async function testarDivulgadorOfertaNaoFalhaPorLinkProduto() {
  const urlWorkspaceDivulgador = "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50-tcl-4k-uhd-qled-50p7k-google-tv-aipq-google-assistente-3-hdmi/p/240144700/et/elit/?seller_id=magazineluiza";
  const pacote = deps({
    resolverFatosMagalu: async () => ({
      ok: true,
      produtoId: "240144700",
      sellerIdOriginal: "magazineluiza",
      fonteUsada: "magazinevoce_magazine_promoter",
      fatos: {
        urlOriginal: urlDivulgadorOferta,
        urlCanonica: urlWorkspaceDivulgador,
        urlAfiliavelComprovada: urlWorkspaceDivulgador,
        magaluWorkspaceValidado: true,
        produtoId: "240144700",
        codigo: "240144700",
        titulo: "Smart TV 50 TCL",
        seller: "magazineluiza",
        imagem: "https://a-static.mlcdn.com.br/800x560/smart-tv-240144700.jpg",
        categoria: "TV e Video",
        avisos: [],
        metadata: {
          fontes: { urlCanonica: "canonical" },
          imagemOficial: { dimensoes: { largura: 800, altura: 560 } }
        }
      },
      avisos: []
    })
  });
  const resultado = await importarProdutoMagaluEngine({
    job: { id: 1501, evento_id: 1601, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smart TV 50 TCL 4K UHD QLED 50P7K\nDE 2.811,00 | POR 2.069,10\n" + urlDivulgadorOferta,
      links_extraidos: [urlDivulgadorOferta]
    },
    links: [linkRow(55, urlDivulgadorOferta)],
    deps: pacote.deps
  });

  assert.notStrictEqual(resultado.motivo, "sem_link_produto_confirmado");
  assert.strictEqual(resultado.marketplace, "magalu");
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.produtoId, "240144700");
  assert.strictEqual(resultado.linkExpandido, urlWorkspaceDivulgador);
  assert.strictEqual(resultado.linkAfiliado, urlWorkspaceDivulgador);
  assert.ok(!resultado.linkAfiliado.includes("/divulgador/oferta/"));
  assert.strictEqual(resultado.linkOriginal, urlDivulgadorOferta);
}

async function testarFormatosComerciaisRadarDePor() {
  const casos = [
    { texto: "DE 2.811,00 | POR 2.069,10", atual: 2069.1, anterior: "2.811,00" },
    { texto: "DE R$ 2.811,00 | POR R$ 2.069,10", atual: 2069.1, anterior: "2.811,00" },
    { texto: "POR 2.069,10", atual: 2069.1, anterior: "" },
    { texto: "POR R$ 2.069,10", atual: 2069.1, anterior: "" }
  ];

  for (const caso of casos) {
    const pacote = deps();
    const resultado = await importarMagaluFixture({
      evento: {
        texto_original: `Smart TV Magalu 50\n${caso.texto}\n${urlProduto}`
      },
      depsExtras: pacote.deps
    });
    assert.strictEqual(resultado.ok, true, caso.texto);
    assert.strictEqual(resultado.precoAtual, caso.atual, caso.texto);
    assert.strictEqual(resultado.precoOriginal, caso.anterior, caso.texto);
  }

  for (const textoInvalido of [
    "SKU 240466500",
    "em 10x de R$ 206,91 sem juros",
    "20% OFF",
    "Quantidade 2",
    "Codigo 2069"
  ]) {
    assert.strictEqual(extrairPrecoRadarSeguroMagalu({ texto_original: textoInvalido }), "", textoInvalido);
  }
}

async function testarDivulgadorPdpPublicaNaoProvaAfiliacaoWorkspace() {
  const chamadasGerador = [];
  const pacote = deps();
  const resultado = await importarProdutoMagaluEngine({
    job: { id: 1502, evento_id: 1602, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smart TV 50 TCL 4K UHD QLED 50P7K\nPor R$ 2.069,10\n" + urlDivulgadorOferta,
      links_extraidos: [urlDivulgadorOferta]
    },
    links: [linkRow(56, urlDivulgadorOferta)],
    deps: {
      ...pacote.deps,
      resolverFatosMagalu: async ({ urlOriginal, promoterId }) => {
        assert.strictEqual(urlOriginal, urlDivulgadorOferta);
        assert.strictEqual(promoterId, "d1egopc");
        return {
          ok: true,
          produtoId: "240144700",
          fonteUsada: "pdp_www",
          tentativas: [{ fonte: "pdp_www", statusFactual: "aceita", motivo: "aceito" }],
          fatos: {
            urlOriginal,
            urlCanonica: urlDivulgadorOferta,
            urlAfiliavelComprovada: urlDivulgadorOfertaPdp,
            produtoId: "240144700",
            codigo: "240144700",
            titulo: "Smart TV 50 TCL 4K UHD QLED 50P7K",
            precoAtual: "R$ 2.069,10",
            precoAnterior: "",
            imagem: "https://a-static.mlcdn.com.br/tv-50-tcl.jpg",
            categoria: "TV e Video",
            seller: "Magalu",
            parcelamento: "",
            cupom: "",
            avisos: []
          },
          avisos: []
        };
      },
      gerarLinkAfiliadoMagaluSeguro: (url, promoterId) => {
        chamadasGerador.push({ url, promoterId });
        return {
          urlAfiliada: "https://www.magazinevoce.com.br/magazined1egopc/smart-tv-50-tcl-4k-uhd-qled-50p7k-google-tv-aipq-google-assistente-3-hdmi/p/240144700/et/elit/",
          tipoLink: "magazinevoce_loja_produto",
          proveniencia: "conversao_dominio_oficial_para_loja_configurada",
          comprovado: true,
          avisos: []
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(chamadasGerador.length, 0, "PDP publica nao pode ser convertida por gerador legado");
  assert.strictEqual(resultado.linkAfiliado, undefined);
}

async function testarEngineUsaPoliticaRapidaNoResolver() {
  let parserOptionsRecebidas = null;
  const pacote = deps();
  const resultado = await importarProdutoMagaluEngine({
    job: { id: 1600, evento_id: 1700, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smart TV Magalu 50\nPor R$ 1.777,00\n" + urlProduto,
      links_extraidos: [urlProduto]
    },
    links: [linkRow(57, urlProduto)],
    deps: {
      ...pacote.deps,
      resolverFatosMagalu: async (_entrada, opcoes = {}) => {
        parserOptionsRecebidas = opcoes.parserOptions || {};
        return {
          ok: true,
          produtoId: "abc123",
          fonteUsada: "pdp_www",
          tentativas: [{ fonte: "pdp_www", statusFactual: "aceita", motivo: "aceito" }],
          fatos: {
            urlOriginal: urlProduto,
            urlCanonica: urlProduto,
            produtoId: "abc123",
            codigo: "abc123",
            titulo: "Smart TV Magalu 50",
            precoAtual: "R$ 1.999,90",
            imagem: "https://a-static.mlcdn.com.br/tv.jpg",
            categoria: "TV e Video",
            avisos: []
          },
          avisos: []
        };
      }
    }
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
  assert.strictEqual(parserOptionsRecebidas.timeoutMs, 2500, "Engine deve usar timeout factual curto");
  assert.strictEqual(parserOptionsRecebidas.retries, 0, "Engine nao deve herdar retries longos do Manual");
  assert.strictEqual(parserOptionsRecebidas.retryDelayMs, 0);
}

async function testarLogRetornoNaoAnunciaOkAntesDosGuards() {
  const logs = [];
  const originalLog = console.log;
  console.log = (evento, payload) => {
    logs.push({ evento, payload: payload ? JSON.parse(payload) : {} });
  };

  try {
    const pacote = deps({
      resolverFatosMagalu: async () => ({
        ok: false,
        motivo: "magalu_factual_resolver_sem_fonte_segura",
        fatos: {},
        avisos: ["magalu_factual_resolver_sem_fonte_segura"]
      })
    });

    const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "afiliacao_workspace_incompleta");
    assert.ok(!logs.some(log =>
      log.evento === "[ENGINE-MAGALU-IMPORTADOR-RETORNO]" &&
      log.payload.ok === true
    ));
  } finally {
    console.log = originalLog;
  }
}

async function testarImagemRadarNaoSubstituiImagemOficialAusente() {
  const imagemRadar = "https://cdn.optimus.test/radar-magalu.jpg";
  const pacote = deps({
    resolverFatosMagalu: async () => ({
      ok: true,
      produtoId: "abc123",
      sellerIdOriginal: "",
      fonteUsada: "magazinevoce_magazine_promoter",
      fatos: {
        urlOriginal: urlProduto,
        urlCanonica: urlWorkspaceFixture,
        urlAfiliavelComprovada: urlWorkspaceFixture,
        magaluWorkspaceValidado: true,
        produtoId: "abc123",
        codigo: "abc123",
        titulo: "Smart TV Magalu 50",
        imagem: "",
        categoria: "TV e Video",
        avisos: [],
        metadata: { fontes: { urlCanonica: "canonical" } }
      },
      avisos: []
    })
  });
  const job = { id: 506, evento_id: 606, cliente_id: "workspace_magalu", marketplace: "magalu" };
  const evento = {
    id: 606,
    texto_original: "Smart TV Magalu 50\nPor R$ 1.777,00\nLink do produto:\n" + urlProduto,
    links_extraidos: [urlProduto],
    metadata: { imagem: imagemRadar }
  };
  const link = linkRow(6, urlProduto);
  const resultado = await importarProdutoMagaluEngine({
    job,
    evento,
    links: [link],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.imagem, "", "pagina sem imagem oficial deve permanecer sem imagem Magalu");
  assert.strictEqual(resultado.imagemEnviavel, false);
  assert.notStrictEqual(resultado.imagem, imagemRadar, "imagem Radar nao substitui prova oficial Magalu");
}

function testarClassificadorDeLinksMagalu() {
  const produto = escolherProdutoPrincipal([
    { url: "https://magazineluiza.onelink.me/589508454/herbiqvt", campo: "url_original", link: {} },
    { url: urlProduto, campo: "url_original", link: {} }
  ], "magalu", {
    texto_original: "Link curto: https://magazineluiza.onelink.me/589508454/herbiqvt\nLink do produto:\n" + urlProduto
  });

  assert.strictEqual(produto.url, urlProduto);
  assert.strictEqual(produto.papelLink, "produto");

  const divulgadorOferta = escolherProdutoPrincipal([
    { url: urlDivulgadorOferta, campo: "url_original", link: { marketplace_detectado: "magalu" } }
  ], "magalu", {
    texto_original: "Smart TV 50 TCL\nDE 2.811,00 | POR 2.069,10\n" + urlDivulgadorOferta
  });

  assert.strictEqual(divulgadorOferta.url, urlDivulgadorOferta);
  assert.strictEqual(divulgadorOferta.papelLink, "produto");
  assert.strictEqual(divulgadorOferta.papelLinkMotivo, "magalu_url_produto");

  const onelink = escolherProdutoPrincipal([
    { url: "https://magazineluiza.onelink.me/589508454/herbiqvt", campo: "url_original", link: {} }
  ], "magalu", {
    texto_original: "Oferta Magalu https://magazineluiza.onelink.me/589508454/herbiqvt"
  });

  assert.strictEqual(onelink.url, "");
  assert.strictEqual(onelink.papelLinkMotivo, "sem_link_produto_confirmado");
}

function testarRegistriesPipelineUnico() {
  const runner = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "importer", "importer.runner.js"), "utf8");
  const orchestrator = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "orchestrator.runner.js"), "utf8");
  const adapter = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "importer", "adapters", "magalu.adapter.js"), "utf8");
  const linkRole = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "link-role.service.js"), "utf8");

  assert.ok(runner.includes("magalu: importarProdutoMagaluEngine"), "runner deve registrar adapter Magalu no registry oficial");
  assert.ok(orchestrator.includes("importar_magalu"), "orchestrator deve importar Magalu pelo Engine");
  assert.ok(orchestrator.includes("distribuir_magalu"), "orchestrator deve distribuir Magalu pelo Distributor existente");
  assert.ok(linkRole.includes("classificarMagalu"), "link-role deve reconhecer produto Magalu no mecanismo central");

  for (const proibido of [
    "utils/fila-ofertas",
    "importarMagalu",
    "/importar-magalu-manual",
    "farejarMagalu",
    "adicionarOfertaNaFila",
    "salvarFila",
    "processarFila",
    "prepararOfertaGlobal",
    "manual-v2",
    "manual-offers",
    "/fila",
    "/enviar-manual"
  ]) {
    assert.ok(!adapter.includes(proibido), `adapter Engine Magalu nao deve referenciar ${proibido}`);
  }
}

(async function main() {
  await testarImportacaoCompletaPreservaPrecoRadar();
  await testarSemPrecoRadarUsaPagina();
  await testarUrlOriginalNaoViraAfiliada();
  await testarDiagnosticoAfiliacaoFalhaSemRelaxarGate();
  await testarDeepLinkSemPrefixoPromoter();
  await testarIntegracaoAusenteBloqueiaImportacaoAutomatica();
  await testarEngineNaoTrocaProdutoPorCanonicaDivergente();
  await testarPaginaIndisponivelComRadarSuficienteContinuaPipeline();
  await testarCaptchaComRadarSuficienteContinuaPipeline();
  await testarResolverFalhaComRadarSuficienteContinuaPipeline();
  await testarRadarSemTituloNaoContinuaPipeline();
  await testarTituloTecnicoConfiavelProssegueAteGateAfiliacao();
  await testarRadarSemPrecoNaoContinuaPipeline();
  await testarDeepLinkOutraLojaNaoContinuaPipeline();
  await testarOfertaUniversalValida();
  await testarDivulgadorOfertaNaoFalhaPorLinkProduto();
  await testarFormatosComerciaisRadarDePor();
  await testarDivulgadorPdpPublicaNaoProvaAfiliacaoWorkspace();
  await testarEngineUsaPoliticaRapidaNoResolver();
  await testarLogRetornoNaoAnunciaOkAntesDosGuards();
  await testarImagemRadarNaoSubstituiImagemOficialAusente();
  testarClassificadorDeLinksMagalu();
  testarRegistriesPipelineUnico();

  console.log("magalu-engine-importer.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
