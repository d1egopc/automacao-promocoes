const assert = require("assert");

const { criarImportarAmazon } = require("../marketplaces/amazon/importar");
const { importarAmazonEngine } = require("../modules/engine/importer/adapters/amazon.adapter");
const { resolverPrecedenciaComercialRadar } = require("../modules/radar/comercial-precedencia");

function extrairMeta(html = "", nome = "") {
  const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i")) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"));
  return match?.[1] || "";
}

function extrairJsonLd(html = "") {
  const match = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  return JSON.parse(match[1]);
}

function criarImportadorAmazonTeste(html, { status = 200, urlFinal = "https://www.amazon.com.br/dp/B0TESTE123" } = {}) {
  return criarImportarAmazon({
    extrairJsonLd,
    extrairMeta,
    htmlDecode: valor => String(valor || "")
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'"),
    limparPreco: valor => String(valor || "").replace(/^R\$\s*/i, "").trim(),
    corrigirImagemUrl: valor => String(valor || ""),
    limparLinkAmazon: valor => String(valor || ""),
    gerarLinkOptimus: valor => String(valor || ""),
    extrairCuponsAmazonDoHtml: () => [],
    detectarAvisoCupomAmazon: () => null,
    escolherCupomParaOfertaAmazon: () => null,
    resolverRedirectUniversal: async () => ({ urlFinal, urlExpandida: urlFinal })
  });
}

async function comFetchMock(html, fn, { status = 200, urlFinal = "https://www.amazon.com.br/dp/B0TESTE123" } = {}) {
  const fetchOriginal = global.fetch;
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    url: urlFinal,
    text: async () => html
  });

  try {
    return await fn();
  } finally {
    global.fetch = fetchOriginal;
  }
}

const htmlAmazonReal = `
  <html>
    <head>
      <meta property="og:title" content="Echo Dot 5a Geracao">
      <meta property="og:image" content="https://m.media-amazon.com/images/I/echo-og.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"Echo Dot 5a Geracao","image":"https://m.media-amazon.com/images/I/echo.jpg","offers":{"price":"299.90"}}</script>
    </head>
    <body>
      <span id="productTitle">Echo Dot 5a Geracao</span>
      <img id="landingImage" src="https://m.media-amazon.com/images/I/echo-gallery.jpg" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/echo-dynamic.jpg&quot;:[1500,1500]}">
      <span class="priceToPay"><span class="a-offscreen">R$ 299,90</span></span>
    </body>
  </html>
`;

const htmlAmazonCaptcha = `
  <html>
    <head><title>Robot Check</title></head>
    <body>
      <form action="/errors/validateCaptcha">
        Sorry, we just need to make sure you're not a robot.
        api-services-support@amazon.com
      </form>
    </body>
  </html>
`;

function radarMirrorAmazon(overrides = {}) {
  return {
    origem: { clienteId: "cliente_amazon", tipo: "whatsapp" },
    produto: { tituloCapturado: "Whey Protein Dux 900g Cookies" },
    preco: {
      atualCapturado: 173.89,
      anteriorCapturado: 219.9,
      confianca: "alta",
      tipoCapturado: "final",
      evidenciaCapturada: "Por R$ 173,89"
    },
    cupom: {
      codigoCapturado: "RADAR10",
      textoCapturado: "Cupom RADAR10",
      condicaoCapturada: "Use RADAR10",
      confianca: "alta"
    },
    midia: {
      imagemOrigem: "mensagem",
      imagemOriginal: "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_amazon.jpg"
    },
    comercial: {
      precoAtual: { valor: 173.89, confianca: "alta", evidencia: "Por R$ 173,89", tipo: "final" },
      precoAntigo: { valor: 219.9, confianca: "media", evidencia: "De R$ 219,90" },
      cupom: { codigo: "RADAR10", texto: "Cupom RADAR10", instrucao: "Use RADAR10", confianca: "alta", provavel: false },
      parcelamento: { quantidade: 10, valorParcela: 17.39, semJuros: true, confianca: "alta", evidencia: "10x de R$ 17,39 sem juros" },
      freteGratis: { valor: true, confianca: "media", evidencia: "Frete gratis" },
      links: { produto: "https://amzn.to/produto", classificados: [{ link: "https://amzn.to/produto", tipo: "produto" }] }
    },
    links: {
      encontrados: ["https://amzn.to/produto"],
      produtoOriginal: "https://amzn.to/produto",
      quantidadeEncontrada: 1
    },
    texto: {
      original: "Whey Protein Dux 900g Cookies\nPor R$ 173,89\nCupom RADAR10\nhttps://amzn.to/produto"
    },
    ...overrides
  };
}

async function executarAdapterAmazon(produto, { radarMirror = radarMirrorAmazon() } = {}) {
  const link = "https://amzn.to/produto";
  return importarAmazonEngine({
    job: {
      id: 101,
      cliente_id: "cliente_amazon",
      marketplace: "amazon",
      marketplace_detectado: "amazon"
    },
    evento: {
      id: 201,
      texto_original: radarMirror.texto?.original || "",
      links_extraidos: [link],
      metadata: { radarMirror }
    },
    links: [{ id: 301, url_original: link }],
    deps: {
      getIntegracaoCliente: () => ({ credenciais: { trackingId: "tag-20" } }),
      importarAmazon: async () => produto
    }
  });
}

async function testarImportadorHtmlReal() {
  const importarAmazon = criarImportadorAmazonTeste(htmlAmazonReal);
  const oferta = await comFetchMock(htmlAmazonReal, () => importarAmazon("https://www.amazon.com.br/dp/B0TESTE123", {
    credenciais: { trackingId: "tag-20" }
  }));

  assert.strictEqual(oferta.titulo, "Echo Dot 5a Geracao");
  assert.strictEqual(oferta.imagem, "https://m.media-amazon.com/images/I/echo.jpg");
  assert.strictEqual(oferta.statusHttp, 200);
  assert.strictEqual(oferta.temCaptcha, false);
  assert.strictEqual(oferta.temRobotCheck, false);
  assert.strictEqual(oferta.origemImagem, "jsonLd.image");
}

async function testarImportadorCaptchaDiagnostico() {
  const importarAmazon = criarImportadorAmazonTeste(htmlAmazonCaptcha);
  const oferta = await comFetchMock(htmlAmazonCaptcha, () => importarAmazon("https://www.amazon.com.br/dp/B0CAPTCHA1", {
    credenciais: { trackingId: "tag-20" }
  }));

  assert.strictEqual(oferta.statusHttp, 200);
  assert.strictEqual(oferta.temCaptcha, true);
  assert.strictEqual(oferta.temRobotCheck, true);
  assert.strictEqual(oferta.titulo, "Produto Amazon");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.origemImagem, "nenhuma");
}

async function testarAdapterUsaAmazonReal() {
  const resultado = await executarAdapterAmazon({
    marketplace: "amazon",
    titulo: "Echo Dot 5a Geracao",
    precoAtual: "299,90",
    imagem: "https://m.media-amazon.com/images/I/echo.jpg",
    linkAfiliado: "https://www.amazon.com.br/dp/B0TESTE123?tag=tag-20",
    categoria: "Amazon",
    statusHttp: 200,
    temCaptcha: false,
    temRobotCheck: false,
    origemImagem: "jsonLd.image"
  });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Echo Dot 5a Geracao");
  assert.strictEqual(resultado.imagem, "https://m.media-amazon.com/images/I/echo.jpg");
  assert.strictEqual(resultado.metadata.diagnosticoAmazon.tituloOrigem, "amazon_importer");
}

async function testarAdapterBloqueadoPreservaRadar() {
  const imagemRadar = "https://go.optimuspromo.com.br/social/midia/publica/engine/radar_amazon.jpg";
  const mirror = radarMirrorAmazon({
    produto: { tituloCapturado: "Whey Protein Dux 900g Cookies" },
    midia: { imagemOrigem: "mensagem", imagemOriginal: imagemRadar }
  });
  const resultado = await executarAdapterAmazon({
    marketplace: "amazon",
    titulo: "Produto Amazon",
    precoAtual: "",
    imagem: "",
    linkAfiliado: "https://www.amazon.com.br/dp/B0CAPTCHA1?tag=tag-20",
    categoria: "Amazon",
    statusHttp: 200,
    temCaptcha: true,
    temRobotCheck: true,
    origemImagem: "nenhuma"
  }, { radarMirror: mirror });

  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.titulo, "Whey Protein Dux 900g Cookies");
  assert.strictEqual(resultado.imagem, "");
  assert.strictEqual(resultado.metadata.diagnosticoAmazon.importadorBloqueado, true);
  assert.strictEqual(resultado.metadata.diagnosticoAmazon.tituloGenerico, true);

  const imagemResolvida = resultado.imagem || mirror.midia.imagemOriginal || "";
  assert.strictEqual(imagemResolvida, imagemRadar);
}

async function testarComercialRadarIntocado() {
  const mirror = radarMirrorAmazon();
  const resultado = await executarAdapterAmazon({
    marketplace: "amazon",
    titulo: "Produto Amazon",
    precoAtual: "999,00",
    precoOriginal: "1299,00",
    cupom: "AMAZON999",
    tipoCupom: "confirmado_amazon",
    beneficioExtra: "Beneficio divergente da Amazon",
    parcelamento: "12x de R$ 83,25",
    imagem: "",
    linkAfiliado: "https://www.amazon.com.br/dp/B0CAPTCHA1?tag=tag-20",
    categoria: "Amazon",
    statusHttp: 200,
    temCaptcha: true,
    temRobotCheck: true,
    origemImagem: "nenhuma"
  }, { radarMirror: mirror });

  const precedencia = resolverPrecedenciaComercialRadar({
    ofertaImportador: resultado,
    radarMirror: mirror,
    clienteId: "cliente_amazon",
    marketplace: "amazon"
  });

  assert.strictEqual(precedencia.oferta.preco, 173.89);
  assert.strictEqual(precedencia.oferta.precoOriginal, 219.9);
  assert.strictEqual(precedencia.oferta.cupom, "RADAR10");
  assert.strictEqual(precedencia.oferta.parcelamento, "10x de R$ 17,39 sem juros");
  assert.strictEqual(precedencia.metadata.precedenciaComercial.camposProtegidos.preco, true);
  assert.strictEqual(precedencia.metadata.precedenciaComercial.camposProtegidos.cupom, true);
}

async function testarSemTituloRadarAmazonBloqueada() {
  const resultado = await executarAdapterAmazon({
    marketplace: "amazon",
    titulo: "Produto Amazon",
    precoAtual: "",
    imagem: "",
    linkAfiliado: "https://www.amazon.com.br/dp/B0CAPTCHA1?tag=tag-20",
    categoria: "Amazon",
    statusHttp: 200,
    temCaptcha: true,
    temRobotCheck: true,
    origemImagem: "nenhuma"
  }, {
    radarMirror: radarMirrorAmazon({ produto: { tituloCapturado: "" } })
  });

  assert.strictEqual(resultado.titulo, "");
  assert.notStrictEqual(resultado.titulo, "Produto Amazon");
}

async function testarSemImagemAmazonSemRadarNaoInventa() {
  const resultado = await executarAdapterAmazon({
    marketplace: "amazon",
    titulo: "Produto Amazon",
    precoAtual: "",
    imagem: "",
    linkAfiliado: "https://www.amazon.com.br/dp/B0CAPTCHA1?tag=tag-20",
    categoria: "Amazon",
    statusHttp: 200,
    temCaptcha: true,
    temRobotCheck: true,
    origemImagem: "nenhuma"
  }, {
    radarMirror: radarMirrorAmazon({
      produto: { tituloCapturado: "" },
      midia: { imagemOrigem: "thumbnail", imagemOriginal: "" }
    })
  });

  assert.strictEqual(resultado.imagem, "");
}

(async function main() {
  await testarImportadorHtmlReal();
  await testarImportadorCaptchaDiagnostico();
  await testarAdapterUsaAmazonReal();
  await testarAdapterBloqueadoPreservaRadar();
  await testarComercialRadarIntocado();
  await testarSemTituloRadarAmazonBloqueada();
  await testarSemImagemAmazonSemRadarNaoInventa();

  console.log("amazon-rio-captcha-guard.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
