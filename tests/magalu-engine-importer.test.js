"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  importarProdutoMagaluEngine
} = require("../modules/engine/importer/adapters/magalu.adapter");
const {
  escolherProdutoPrincipal
} = require("../modules/engine/link-role.service");
const {
  montarOfertaUniversalEngine,
  validarContratoOfertaUniversal
} = require("../modules/engine/oferta-universal.contract");
const {
  resolverImagemEngineFallback
} = require("../modules/engine/importer/importer.service");

const urlProduto = "https://www.magazineluiza.com.br/smart-tv-50/p/abc123/et/elit/";
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

function deps({ html = htmlProduto, promoterId = "d1egopc", gerarLinkAfiliadoMagaluSeguro } = {}) {
  const chamadas = [];
  return {
    chamadas,
    deps: {
      magaluParserOptions: { html },
      getIntegracaoCliente(clienteId, marketplace) {
        chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
        return promoterId ? { credenciais: { promoterId } } : null;
      },
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
  assert.strictEqual(resultado.precoOriginal, "R$\u00a02.499,90");
  assert.strictEqual(resultado.imagem, "https://a-static.mlcdn.com.br/tv.jpg");
  assert.strictEqual(resultado.categoria, "TV e Video");
  assert.strictEqual(resultado.seller, "Magalu");
  assert.strictEqual(resultado.parcelamento.includes("10x de R$ 199,99"), true);
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

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.preco, 1999.9);
  assert.strictEqual(resultado.metadata.precoRadarUsado, false);
  assert.strictEqual(resultado.metadata.precoAuditoria.origemPreco, "pagina_magalu");
}

async function testarUrlOriginalNaoViraAfiliada() {
  const pacote = deps({
    gerarLinkAfiliadoMagaluSeguro: () => ({
      urlAfiliada: urlProduto,
      tipoLink: "magazineluiza_original",
      proveniencia: "host_produto_magalu_original",
      comprovado: false,
      avisos: ["magalu_url_original_nao_e_afiliada"]
    })
  });

  const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "link_afiliado_vazio");
  assert.strictEqual(resultado.metadata.provaAfiliado.comprovado, false);
}

async function testarDeepLinkSemPrefixoPromoter() {
  const pacote = deps({
    html: `
      <link rel="canonical" href="${urlNightCaviar}">
      <meta property="og:title" content="Night Caviar 100ml - Paris Elysses">
      <meta property="og:image" content="https://a-static.mlcdn.com.br/night.jpg">
      <meta property="product:price:amount" content="78.90">
      <span>Preco anterior R$ 99,90</span>
    `
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
  assert.strictEqual(resultado.linkAfiliado, urlNightCaviar, "deep link /d1egopc deve ser comprovado para o workspace");
  assert.strictEqual(resultado.preco, 78.9);
}

async function testarIntegracaoAusenteBloqueiaImportacaoAutomatica() {
  const pacote = deps({ promoterId: "" });
  const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "integracao_ausente");
}

async function testarEngineNaoTrocaProdutoPorCanonicaDivergente() {
  const chamadasGerador = [];
  const htmlDivergente = `
    <link rel="canonical" href="${urlA17Divergente}">
    <meta property="og:title" content="Smartphone Samsung A07">
    <meta property="product:price:amount" content="799.90">
  `;
  const pacote = deps({
    html: htmlDivergente,
    gerarLinkAfiliadoMagaluSeguro: (url, promoterId) => {
      chamadasGerador.push({ url, promoterId });
      return {
        urlAfiliada: url,
        tipoLink: "magazinevoce_loja",
        proveniencia: "url_ja_pertence_a_loja_configurada",
        comprovado: true,
        avisos: []
      };
    }
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
  assert.strictEqual(resultado.motivo, "identidade_produto_insegura");
  assert.strictEqual(chamadasGerador.length, 0);
  assert.ok(!JSON.stringify(resultado).includes("240575800"));
}

async function testarPaginaIndisponivelComRadarSuficienteContinuaPipeline() {
  const chamadasGerador = [];
  const pacote = deps({
    html: "<html><head><title>Magazine Luiza | Não é possível acessar a página</title></head><body>Não é possível acessar a página</body></html>",
    gerarLinkAfiliadoMagaluSeguro: (url, promoterId) => {
      chamadasGerador.push({ url, promoterId });
      return {
        urlAfiliada: url,
        comprovado: true,
        avisos: []
      };
    }
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 505, evento_id: 605, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Night Caviar\nPor R$ 78,90\nLink: " + urlNightCaviar,
      links_extraidos: [urlNightCaviar]
    },
    links: [linkRow(5, urlNightCaviar)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Night Caviar");
  assert.strictEqual(resultado.preco, 78.9);
  assert.strictEqual(resultado.linkAfiliado, urlNightCaviar);
  assert.strictEqual(resultado.metadata.fallbackRadar.usado, true);
  assert.strictEqual(chamadasGerador.length, 1, "pagina indisponivel pode gerar afiliado pela URL original comprovada");
  assert.strictEqual(chamadasGerador[0].url, urlNightCaviar);
}

async function testarCaptchaComRadarSuficienteContinuaPipeline() {
  const chamadasGerador = [];
  const pacote = deps({
    html: `
      <html>
        <head>
          <title>Captcha Magalu</title>
        </head>
        <body>Complete o CAPTCHA</body>
      </html>
    `,
    gerarLinkAfiliadoMagaluSeguro: (url, promoterId) => {
      chamadasGerador.push({ url, promoterId });
      return {
        urlAfiliada: url,
        comprovado: true,
        avisos: []
      };
    }
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 503, evento_id: 603, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Smartphone Samsung A07 128GB Preto\nPor R$ 777,00\nLink: " + urlRealA07,
      links_extraidos: [urlRealA07]
    },
    links: [linkRow(3, urlRealA07)],
    deps: pacote.deps
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Smartphone Samsung A07 128GB Preto");
  assert.strictEqual(resultado.preco, 777);
  assert.strictEqual(resultado.linkAfiliado, urlRealA07);
  assert.strictEqual(resultado.metadata.fallbackRadar.usado, true);
  assert.strictEqual(chamadasGerador.length, 1);
  assert.strictEqual(chamadasGerador[0].url, urlRealA07);
}

async function testarResolverFalhaComRadarSuficienteContinuaPipeline() {
  const pacote = deps({
    gerarLinkAfiliadoMagaluSeguro: (url) => ({
      urlAfiliada: url,
      comprovado: true,
      avisos: []
    })
  });

  const resultado = await importarProdutoMagaluEngine({
    job: { id: 507, evento_id: 607, cliente_id: "workspace_magalu", marketplace: "magalu" },
    evento: {
      texto_original: "Night Caviar 100ml - Paris Elysses\nPor R$ 78,90\nLink: " + urlNightCaviar,
      links_extraidos: [urlNightCaviar]
    },
    links: [linkRow(7, urlNightCaviar)],
    deps: {
      ...pacote.deps,
      resolverFatosMagalu: async () => {
        throw new Error("HTTP 403");
      }
    }
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Night Caviar 100ml - Paris Elysses");
  assert.strictEqual(resultado.preco, 78.9);
  assert.strictEqual(resultado.metadata.fallbackRadar.resolverFalhou, true);
}

async function testarRadarSemTituloNaoContinuaPipeline() {
  const pacote = deps({
    html: "<html><head><title>Captcha Magalu</title></head><body>Complete o CAPTCHA</body></html>",
    gerarLinkAfiliadoMagaluSeguro: (url) => ({
      urlAfiliada: url,
      comprovado: true,
      avisos: []
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
  const pacote = deps({
    html: "<html><head><title>Captcha Magalu</title></head><body>Complete o CAPTCHA</body></html>"
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
  assert.strictEqual(resultado.motivo, "identidade_produto_insegura");
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
  const pacote = deps({
    html: `
      <link rel="canonical" href="${urlDivulgadorOferta}">
      <script type="application/ld+json">
        { "@type": "Product", "name": "Smart TV 50 TCL", "sku": "240144700", "offers": { "price": "2069.10" } }
      </script>
    `
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
  assert.strictEqual(resultado.linkExpandido, urlDivulgadorOfertaPdp);
  assert.ok(resultado.linkAfiliado.includes("/magazined1egopc/"));
  assert.ok(!resultado.linkAfiliado.includes("/divulgador/oferta/"));
  assert.strictEqual(resultado.linkOriginal, urlDivulgadorOferta);
}

async function testarDivulgadorOfertaUsaPdpComprovadaParaAfiliado() {
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

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(chamadasGerador.length, 1);
  assert.strictEqual(chamadasGerador[0].url, urlDivulgadorOfertaPdp);
  assert.strictEqual(chamadasGerador[0].promoterId, "d1egopc");
  assert.strictEqual(resultado.produtoId, "240144700");
  assert.strictEqual(resultado.linkExpandido, urlDivulgadorOfertaPdp);
  assert.ok(resultado.linkAfiliado.includes("/magazined1egopc/"));
  assert.ok(!resultado.linkAfiliado.includes("/divulgador/oferta/"));
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

  assert.strictEqual(resultado.ok, true);
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
      gerarLinkAfiliadoMagaluSeguro: () => ({
        urlAfiliada: "",
        tipoLink: "magazineluiza_original",
        proveniencia: "host_produto_magalu_original",
        comprovado: false,
        avisos: ["magalu_url_original_nao_e_afiliada"]
      })
    });

    const resultado = await importarMagaluFixture({ depsExtras: pacote.deps });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.motivo, "link_afiliado_vazio");
    assert.ok(!logs.some(log =>
      log.evento === "[ENGINE-MAGALU-IMPORTADOR-RETORNO]" &&
      log.payload.ok === true
    ));
  } finally {
    console.log = originalLog;
  }
}

async function testarImagemRadarPreservadaQuandoResolverSemImagem() {
  const imagemRadar = "https://cdn.optimus.test/radar-magalu.jpg";
  const htmlSemImagem = `
    <link rel="canonical" href="${urlProduto}">
    <meta property="og:title" content="Smart TV Magalu 50">
    <meta property="product:price:amount" content="1999.90">
  `;
  const pacote = deps({ html: htmlSemImagem });
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
  assert.strictEqual(resultado.imagem, "", "resolver factual sem imagem deve continuar sem fallback Magalu especifico");

  const resolucaoImagem = resolverImagemEngineFallback({
    oferta: resultado,
    ofertaEntrada: resultado,
    evento,
    job,
    link
  });
  const ofertaComImagemRadar = {
    ...resultado,
    imagem: resolucaoImagem.imagem,
    imagemOrigem: resolucaoImagem.origem
  };
  const ofertaUniversal = montarOfertaUniversalEngine({
    oferta: ofertaComImagemRadar,
    ofertaEntrada: resultado,
    job,
    evento,
    link,
    metadata: resultado.metadata
  });

  assert.strictEqual(resolucaoImagem.imagem, imagemRadar);
  assert.strictEqual(resolucaoImagem.origem, "evento.metadata.imagem");
  assert.strictEqual(ofertaUniversal.midia.imagemPrincipal, imagemRadar);
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
  await testarDeepLinkSemPrefixoPromoter();
  await testarIntegracaoAusenteBloqueiaImportacaoAutomatica();
  await testarEngineNaoTrocaProdutoPorCanonicaDivergente();
  await testarPaginaIndisponivelComRadarSuficienteContinuaPipeline();
  await testarCaptchaComRadarSuficienteContinuaPipeline();
  await testarResolverFalhaComRadarSuficienteContinuaPipeline();
  await testarRadarSemTituloNaoContinuaPipeline();
  await testarRadarSemPrecoNaoContinuaPipeline();
  await testarDeepLinkOutraLojaNaoContinuaPipeline();
  await testarOfertaUniversalValida();
  await testarDivulgadorOfertaNaoFalhaPorLinkProduto();
  await testarDivulgadorOfertaUsaPdpComprovadaParaAfiliado();
  await testarEngineUsaPoliticaRapidaNoResolver();
  await testarLogRetornoNaoAnunciaOkAntesDosGuards();
  await testarImagemRadarPreservadaQuandoResolverSemImagem();
  testarClassificadorDeLinksMagalu();
  testarRegistriesPipelineUnico();

  console.log("magalu-engine-importer.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
