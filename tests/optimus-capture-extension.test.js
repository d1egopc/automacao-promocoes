const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..", "optimus-capture");
const detector = require(path.join(raiz, "core", "marketplace-detector.js"));
const contrato = require(path.join(raiz, "core", "product-contract.js"));
const ml = require(path.join(raiz, "adapters", "mercadolivre.js"));
const amazon = require(path.join(raiz, "adapters", "amazon.js"));
const shopee = require(path.join(raiz, "adapters", "shopee.js"));
const aliexpress = require(path.join(raiz, "adapters", "aliexpress.js"));
const apiFonte = fs.readFileSync(path.join(raiz, "services", "api.js"), "utf8");
const panelFonte = fs.readFileSync(path.join(raiz, "sidepanel", "panel.js"), "utf8");
const panelHtml = fs.readFileSync(path.join(raiz, "sidepanel", "panel.html"), "utf8");
const panelCss = fs.readFileSync(path.join(raiz, "sidepanel", "panel.css"), "utf8");
const manifestFonte = fs.readFileSync(path.join(raiz, "manifest.json"), "utf8");

function htmlProdutoJsonLd() {
  return `
    <html>
      <head>
        <title>Creatine Beauty Pro | Mercado Livre</title>
        <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_123.webp">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Creatine Beauty Pro 180g Cranberry",
            "image": ["https://http2.mlstatic.com/D_NQ_NP_456.webp"],
            "offers": {
              "@type": "Offer",
              "price": "129.90",
              "priceCurrency": "BRL",
              "listPrice": "199.90"
            }
          }
        </script>
      </head>
      <body>
        <h1>Creatine Beauty Pro</h1>
        <p>Use o cupom SEMDEMORA</p>
      </body>
    </html>
  `;
}

function htmlWall() {
  return `
    <html>
      <head><title>Seguridad - Mercado Libre</title></head>
      <body>captcha/wall/logged account-verification</body>
    </html>
  `;
}

function htmlPrecoAmbiguo() {
  return `
    <html>
      <head><meta property="og:title" content="Produto com preco ambiguo"></head>
      <body>
        <h1>Produto com preco ambiguo</h1>
        <span>R$ 129,90</span>
        <span>R$ 149,90</span>
      </body>
    </html>
  `;
}

function htmlPrecoAnteriorDomMercadoLivre({ anterior = "129", centavos = "90", atual = "72.16", incluirOriginal = true } = {}) {
  return `
    <html>
      <head>
        <title>Produto real com preco de | Mercado Livre</title>
        <meta property="og:title" content="Produto real com preco de">
        <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_DOM.webp">
        <meta itemprop="price" content="${atual}">
      </head>
      <body>
        <div class="ui-pdp-price" id="_R_8kb2hcp9vqra_">
          ${incluirOriginal ? `
            <s
              class="andes-money-amount ui-pdp-price__part ui-pdp-price__original-value andes-money-amount--previous"
              aria-label="Antes: ${anterior} reais com ${centavos} centavos"
              data-andes-money-amount="true">
              <span data-andes-money-amount-fraction="true">${anterior}</span>
              <span data-andes-money-amount-cents="true">${centavos}</span>
            </s>
          ` : ""}
          <span class="andes-money-amount" itemprop="offers" data-andes-money-amount="true">
            <span data-andes-money-amount-fraction="true">72</span>
            <span data-andes-money-amount-cents="true">16</span>
          </span>
          <span>44% OFF</span>
          <span>12x R$ 7,11</span>
        </div>
      </body>
    </html>
  `;
}

function documentoShopeeFixture({ comPrecoAnterior = false } = {}) {
  const url = "https://shopee.com.br/product/123456/987654";
  const imagem = "https://down-br.img.susercontent.com/file/produto-hero.webp";
  const titulo = {
    textContent: "Tenis de Corrida Unissex Respiravel Challenger 6 - Olympikus",
    innerText: "Tenis de Corrida Unissex Respiravel Challenger 6 - Olympikus"
  };
  const secaoPreco = {
    textContent: "R$212,90 no Pix com cupom > ou R$249,00 sem cupom em outros metodos de pagamento",
    innerText: "R$212,90 no Pix com cupom > ou R$249,00 sem cupom em outros metodos de pagamento"
  };
  const precoAnterior = {
    textContent: "R$ 299,90",
    innerText: "R$ 299,90",
    getAttribute: () => "Antes: R$ 299,90"
  };
  const main = {
    textContent: `${titulo.textContent} ${secaoPreco.textContent}`,
    innerText: `${titulo.textContent} ${secaoPreco.textContent}`,
    querySelector(seletor) {
      if (seletor === "h1") return titulo;
      if (seletor === 'section[aria-live="polite"]') return secaoPreco;
      return null;
    },
    querySelectorAll() {
      return comPrecoAnterior ? [precoAnterior] : [];
    }
  };
  return {
    location: { href: url },
    documentElement: {
      outerHTML: `
        <html>
          <head><meta property="og:image" content="${imagem}"></head>
          <body>
            <div role="main">
              <h1>${titulo.textContent}</h1>
              <img elementtiming="shopee:heroComponentPaint" src="${imagem}">
              <section aria-live="polite">
                <div>R$212,90</div>
                <p>no Pix com cupom ></p>
                <p>ou R$249,00 sem cupom em outros metodos de pagamento</p>
              </section>
            </div>
          </body>
        </html>
      `
    },
    body: main,
    querySelector(seletor) {
      if (seletor === 'div[role="main"], main') return main;
      if (seletor === 'img[elementtiming="shopee:heroComponentPaint"]') {
        return {
          src: imagem,
          currentSrc: "",
          getAttribute: () => imagem
        };
      }
      return null;
    }
  };
}

function documentoShopeeFaixaFixture() {
  const url = "https://shopee.com.br/product/123456/555555";
  const imagem = "https://down-br.img.susercontent.com/file/faixa.webp";
  const titulo = {
    textContent: "Triturador De Alimentos Carne e Legumes Multiprocessador Eletrico",
    innerText: "Triturador De Alimentos Carne e Legumes Multiprocessador Eletrico"
  };
  const secaoPreco = {
    textContent: "R$67,99 - R$99,99 R$79,99 - R$180,00 -15% 12x R$ 6,60",
    innerText: "R$67,99 - R$99,99\nR$79,99 - R$180,00\n-15%\n12x R$ 6,60"
  };
  const main = {
    textContent: `${titulo.textContent} ${secaoPreco.textContent}`,
    innerText: `${titulo.textContent}\n${secaoPreco.innerText}`,
    querySelector(seletor) {
      if (seletor === "h1") return titulo;
      if (seletor === 'section[aria-live="polite"]') return secaoPreco;
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  return {
    location: { href: url },
    documentElement: {
      outerHTML: `<html><head><meta property="og:image" content="${imagem}"></head><body><div role="main"><h1>${titulo.textContent}</h1><img elementtiming="shopee:heroComponentPaint" src="${imagem}"><section aria-live="polite">${secaoPreco.innerText}</section></div></body></html>`
    },
    body: main,
    querySelector(seletor) {
      if (seletor === 'div[role="main"], main') return main;
      if (seletor === 'img[elementtiming="shopee:heroComponentPaint"]') {
        return { src: imagem, currentSrc: "", getAttribute: () => imagem };
      }
      return null;
    }
  };
}

function documentoShopeePercentualFixture({ incluirPreco = true } = {}) {
  const url = "https://shopee.com.br/product/123456/666666";
  const imagem = "https://down-br.img.susercontent.com/file/mochila.webp";
  const titulo = {
    textContent: "Mochila Esportiva Unissex com Compartimento para Notebook",
    innerText: "Mochila Esportiva Unissex com Compartimento para Notebook"
  };
  const secaoPreco = {
    textContent: incluirPreco ? "R$69,00 1% OFF" : "1% OFF",
    innerText: incluirPreco ? "R$69,00\n1% OFF" : "1% OFF"
  };
  const main = {
    textContent: `${titulo.textContent} ${secaoPreco.textContent}`,
    innerText: `${titulo.textContent}\n${secaoPreco.innerText}`,
    querySelector(seletor) {
      if (seletor === "h1") return titulo;
      if (seletor === 'section[aria-live="polite"]') return secaoPreco;
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  return {
    location: { href: url },
    documentElement: {
      outerHTML: `<html><head><meta property="og:image" content="${imagem}"></head><body><div role="main"><h1>${titulo.textContent}</h1><img elementtiming="shopee:heroComponentPaint" src="${imagem}"><section aria-live="polite">${secaoPreco.innerText}</section></div></body></html>`
    },
    body: main,
    querySelector(seletor) {
      if (seletor === 'div[role="main"], main') return main;
      if (seletor === 'img[elementtiming="shopee:heroComponentPaint"]') {
        return { src: imagem, currentSrc: "", getAttribute: () => imagem };
      }
      return null;
    }
  };
}

function documentoAmazonSoundbarFixture({ semPrecoPrincipal = false, oldHires = "https://m.media-amazon.com/images/I/soundbar-SL1000.jpg" } = {}) {
  const url = "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6?th=1";
  const titulo = "Soundbar TCL com Subwoofer sem fio Bluetooth 2.1 Canais HDMI ARC S55H";
  const imagemSrc = "https://m.media-amazon.com/images/I/soundbar-SX522.jpg";
  const tituloNo = { textContent: ` ${titulo} `, innerText: ` ${titulo} ` };
  const imagemNo = {
    src: imagemSrc,
    currentSrc: "",
    getAttribute(nome) {
      if (nome === "data-old-hires") return oldHires;
      if (nome === "src") return imagemSrc;
      return "";
    }
  };
  const precoAtualNo = {
    textContent: "R$ 798,99",
    innerText: "R$ 798,99",
    querySelector(seletor) {
      if (seletor === ".a-price-whole") return { textContent: "798", innerText: "798" };
      if (seletor === ".a-price-fraction") return { textContent: "99", innerText: "99" };
      if (seletor === ".a-offscreen") return { textContent: "R$798,99", innerText: "R$798,99" };
      return null;
    }
  };
  const precoAnteriorNo = {
    textContent: "R$1.099,00",
    innerText: "R$1.099,00",
    querySelector(seletor) {
      if (seletor === ".a-offscreen") return { textContent: "R$1.099,00", innerText: "R$1.099,00" };
      return null;
    }
  };
  const descontoNo = { textContent: "-27%", innerText: "-27%" };
  const blocoPreco = {
    textContent: "R$ 798,99 R$1.099,00 -27% 12x de R$66,61 25% off na 1a compra com cartao Amazon Insira o codigo CARTAO90 Exclusivo Prime Salve o cupom R$20 : VEMPRIME99.",
    innerText: "R$ 798,99\nR$1.099,00\n-27%\n12x de R$66,61\n25% off na 1a compra com cartao Amazon. Insira o codigo CARTAO90.\nExclusivo Prime: Salve o cupom R$20 : VEMPRIME99.",
    querySelector(seletor) {
      if (seletor === ".priceToPay") return semPrecoPrincipal ? null : precoAtualNo;
      if (seletor === ".savingsPercentage") return descontoNo;
      return null;
    },
    querySelectorAll(seletor) {
      if (seletor.includes("apex-basisprice-value")) return [precoAnteriorNo];
      return [];
    }
  };

  return {
    location: { href: url },
    documentElement: {
      outerHTML: `
        <html>
          <head><meta property="og:image" content="https://m.media-amazon.com/images/I/soundbar-og.jpg"></head>
          <body>
            <span id="productTitle">${titulo}</span>
            <img id="landingImage" data-old-hires="${oldHires || ""}" src="${imagemSrc}">
            <div id="corePriceDisplay_desktop_feature_div">
              <span class="priceToPay"><span class="a-price-whole">798</span><span class="a-price-fraction">99</span></span>
              <span class="apex-basisprice-value a-text-price"><span class="a-offscreen">R$1.099,00</span></span>
              <span class="savingsPercentage">-27%</span>
              <span>12x de R$66,61</span>
              <div id="promoPriceBlockMessage_feature_div">25% off na 1a compra com cartao Amazon. Insira o codigo CARTAO90. Exclusivo Prime: Salve o cupom R$20 : VEMPRIME99.</div>
            </div>
          </body>
        </html>
      `
    },
    querySelector(seletor) {
      if (seletor === "#productTitle") return tituloNo;
      if (seletor === "#landingImage") return imagemNo;
      if (seletor === "#corePriceDisplay_desktop_feature_div") return blocoPreco;
      return null;
    }
  };
}

function jsonLdAliExpressProduto(extra = {}) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: extra.name || "Mini Projetor Portatil AliExpress Full HD",
    image: Object.prototype.hasOwnProperty.call(extra, "image") ? extra.image : ["https://ae01.alicdn.com/kf/projetor.jpg"],
    offers: extra.offers || {
      "@type": "Offer",
      price: "213.25",
      priceCurrency: "BRL",
      url: "https://pt.aliexpress.com/item/1005007871648778.html"
    }
  });
}

function documentoAliExpressFixture({
  url = "https://pt.aliexpress.com/item/1005007871648778.html?spm=tracking",
  titulo = "Mini Projetor Portatil AliExpress Full HD",
  tituloVisual = titulo,
  precoTexto = "R$ 213,25",
  jsonLd = jsonLdAliExpressProduto({ name: titulo }),
  imagem = "https://ae01.alicdn.com/kf/projetor.jpg",
  precoAnterior = "",
  precoEstrutural = true,
  ogImagem = imagem
} = {}) {
  const tituloNo = {
    textContent: tituloVisual,
    innerText: tituloVisual
  };
  const h1Aliexpress = { textContent: "Aliexpress", innerText: "Aliexpress" };
  const h1Ia = { textContent: "Resumo do item com IA", innerText: "Resumo do item com IA" };
  const precoNo = {
    textContent: precoTexto,
    innerText: precoTexto
  };
  const anteriorNo = {
    textContent: precoAnterior,
    innerText: precoAnterior,
    getAttribute: () => precoAnterior ? `Antes: ${precoAnterior}` : ""
  };
  const main = {
    textContent: `${h1Aliexpress.textContent}\n${tituloVisual}\n${h1Ia.textContent}\n${precoTexto}\n${precoAnterior}`,
    innerText: `${h1Aliexpress.innerText}\n${tituloVisual}\n${h1Ia.innerText}\n${precoTexto}\n${precoAnterior}`,
    querySelector(seletor) {
      if (seletor === "img") return { src: imagem, currentSrc: "", getAttribute: () => imagem };
      return null;
    },
    querySelectorAll(seletor) {
      if (seletor.includes("title") || seletor.includes("h1") || seletor.includes("heading")) {
        return [h1Aliexpress, tituloNo, h1Ia];
      }
      if (precoEstrutural && seletor.includes("product-price")) {
        return [precoNo];
      }
      if (/original|previous|old|aria-label|\bdel\b|\bs\b/.test(seletor)) {
        return precoAnterior ? [anteriorNo] : [];
      }
      return [];
    }
  };

  return {
    location: { href: url },
    documentElement: {
      outerHTML: `
        <html>
          <head>
            ${ogImagem ? `<meta property="og:image" content="${ogImagem}">` : ""}
            <script type="application/ld+json">${jsonLd}</script>
          </head>
          <body>
            <div role="main">
              <h1>Aliexpress</h1>
              <h1>${tituloVisual}</h1>
              <h1>Resumo do item com IA</h1>
              <div data-pl="product-price">${precoTexto}</div>
              ${precoAnterior ? `<s>${precoAnterior}</s>` : ""}
              <img src="${imagem}">
            </div>
          </body>
        </html>
      `
    },
    body: main,
    querySelector(seletor) {
      if (seletor === 'div[role="main"], main') return main;
      return null;
    }
  };
}

function documentoShopeeSpaFixture({ precoAnteriorEstrutural = false } = {}) {
  const url = "https://shopee.com.br/product/555/999";
  const imagem = "https://down-br.img.susercontent.com/file/baby-tee.webp";
  const titulo = "Kit 4 Baby Tee Feminina - Blusa Slim Fit Manga Curta Blusa de Compressao Varias Cores Ajuste Perfeito Candy Color";
  const anterior = {
    textContent: "R$130,90",
    innerText: "R$130,90",
    getAttribute: () => "Antes: R$130,90"
  };
  const main = {
    textContent: `${titulo}\nR$59,90\nR$130,90\n-54%`,
    innerText: `${titulo}\nR$59,90\nR$130,90\n-54%`,
    querySelector() {
      return null;
    },
    querySelectorAll(seletor) {
      if (/original|previous|aria-label|\bdel\b|\bs\b/.test(seletor)) {
        return precoAnteriorEstrutural ? [anterior] : [];
      }
      return [];
    }
  };
  return {
    location: { href: url },
    documentElement: {
      outerHTML: `<html><body><div role="main">${titulo}<span>R$59,90</span><span>R$130,90</span><span>-54%</span></div></body></html>`
    },
    body: main,
    querySelector(seletor) {
      if (seletor === 'div[role="main"], main') return main;
      if (seletor === 'img[elementtiming="shopee:heroComponentPaint"]') {
        return {
          src: imagem,
          currentSrc: "",
          getAttribute: () => imagem
        };
      }
      return null;
    }
  };
}

(async function main() {
  {
    const deteccao = detector.detectarMarketplacePorUrl("https://produto.mercadolivre.com.br/MLB-123-produto-_JM");
    assert.strictEqual(deteccao.suportado, true);
    assert.strictEqual(deteccao.marketplace, "mercadolivre");
  }

  {
    const deteccao = detector.detectarMarketplacePorUrl("https://shopee.com.br/product/123456/987654");
    assert.strictEqual(deteccao.suportado, true);
    assert.strictEqual(deteccao.marketplace, "shopee");
    const shortlink = detector.detectarMarketplacePorUrl("https://s.shopee.com.br/abc123");
    assert.strictEqual(shortlink.suportado, false);
    assert.strictEqual(shortlink.motivo, "shopee_shortlink_requer_url_real");
  }

  {
    const deteccao = detector.detectarMarketplacePorUrl("https://www.amazon.com.br/Soundbar-TCL/dp/B0G2T13LT6?th=1");
    assert.strictEqual(deteccao.suportado, true);
    assert.strictEqual(deteccao.marketplace, "amazon");
    assert.strictEqual(deteccao.asin, "B0G2T13LT6");
    assert.strictEqual(detector.detectarMarketplacePorUrl("https://amzn.to/abc123").motivo, "amazon_shortlink_requer_url_real");
    assert.strictEqual(detector.detectarMarketplacePorUrl("https://www.amazon.com.br/s?k=soundbar").motivo, "pagina_amazon_sem_produto");
  }

  {
    const deteccao = detector.detectarMarketplacePorUrl("https://pt.aliexpress.com/item/1005007871648778.html?spm=tracking");
    assert.strictEqual(deteccao.suportado, true);
    assert.strictEqual(deteccao.marketplace, "aliexpress");
    assert.strictEqual(deteccao.itemId, "1005007871648778");
    assert.strictEqual(deteccao.url, "https://pt.aliexpress.com/item/1005007871648778.html");
    assert.strictEqual(detector.detectarMarketplacePorUrl("https://a.aliexpress.com/_mTeste").motivo, "aliexpress_shortlink_requer_url_real");
    assert.strictEqual(detector.detectarMarketplacePorUrl("https://pt.aliexpress.com/w/wholesale-projetor.html").motivo, "pagina_aliexpress_sem_produto");
    assert.strictEqual(detector.detectarMarketplacePorUrl("https://pt.aliexpress.com/w/wholesale-projetor.html?itemId=1005007871648778").suportado, false);
    assert.strictEqual(detector.detectarMarketplacePorUrl("https://login.aliexpress.com/").motivo, "pagina_aliexpress_sem_produto");
  }

  {
    assert.ok(panelFonte.includes("tabs.onActivated.addListener"));
    assert.ok(panelFonte.includes("tabs.onUpdated.addListener"));
    assert.ok(panelFonte.includes("agendarCapturaAutomatica"));
    assert.ok(panelFonte.includes("state.ultimoPreviewKey === previewKey"));
    assert.ok(panelFonte.includes("gerarPreview({ automatico: true })"));
    assert.ok(panelFonte.includes('new Intl.NumberFormat("pt-BR"'));
    assert.ok(panelFonte.includes("formatarMoeda"));
    assert.ok(panelHtml.includes('id="botaoPreview" class="primary" hidden'));
    assert.ok(panelHtml.includes('id="botaoSalvar" disabled'));
    assert.ok(panelHtml.includes('id="botaoEnviar" disabled'));
    assert.ok(!panelHtml.includes("botaoCapturar"));
    assert.ok(!panelFonte.includes("botaoCapturar"));
    assert.ok(!panelHtml.includes("Atualizar captura"));
    assert.ok(!panelHtml.includes("Preview ainda nao gerado"));
    assert.ok(!panelFonte.includes("Preview ainda nao gerado"));
    assert.ok(!panelFonte.includes("Clique em Atualizar captura"));
    assert.ok(!panelFonte.includes("MutationObserver"));
    assert.ok(panelFonte.includes("enviarMensagemCapturaComRecuperacao"));
    assert.ok(panelFonte.includes("abaPermaneceNaCaptura"));
    assert.ok(panelFonte.includes("state.capturaPendente = true"));
    assert.ok(panelFonte.includes("AMAZON_RETRY_DELAYS_MS"));
    assert.ok(panelFonte.includes("[OPTIMUS-CAPTURE-TIMING]"));
    assert.ok(apiFonte.includes("AbortController"));
    assert.ok(apiFonte.includes("tempo_limite_esgotado"));
    assert.ok(apiFonte.includes("timeoutMs: 45000"));
    assert.ok(panelHtml.includes('id="destinosView"'));
    assert.ok(panelCss.includes("button:disabled"));
    assert.ok(panelCss.includes("cursor: default"));
    assert.ok(panelCss.includes('button[data-estado="salvo"]:disabled'));
    assert.ok(panelCss.includes(".destino-opcao"));
    assert.ok(apiFonte.includes("function salvarOfertaManualV2"));
    assert.ok(apiFonte.includes('requestJson("/manual-v2/ofertas"'));
    assert.ok(apiFonte.includes("function listarDestinosManualV2"));
    assert.ok(apiFonte.includes('requestJson(`/manual-v2/destinos?_=${Date.now()}`'));
    assert.ok(apiFonte.includes("function enviarAgoraManualV2"));
    assert.ok(apiFonte.includes('body: { destinosIds: Array.isArray(destinosIds) ? destinosIds : [] }'));
    assert.ok(!apiFonte.includes("clienteId"));
    assert.ok(manifestFonte.includes("https://shopee.com.br/*"));
    assert.ok(manifestFonte.includes("adapters/shopee.js"));
    assert.ok(manifestFonte.includes("https://www.amazon.com.br/*"));
    assert.ok(manifestFonte.includes("adapters/amazon.js"));
    assert.ok(manifestFonte.includes("https://*.aliexpress.com/*"));
    assert.ok(manifestFonte.includes("adapters/aliexpress.js"));
    assert.ok(panelFonte.includes("marketplaceLabel"));
    assert.ok(panelFonte.includes('valor === "amazon"'));
    assert.ok(panelFonte.includes('valor === "aliexpress"'));
    assert.ok(!panelHtml.includes("<div class=\"marketplace\">Mercado Livre</div>"));
  }

  {
    const produto = amazon.capturarAmazonDaPagina(
      documentoAmazonSoundbarFixture(),
      { href: "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6?th=1" }
    );
    assert.strictEqual(produto.marketplace, "amazon");
    assert.strictEqual(produto.titulo, "Soundbar TCL com Subwoofer sem fio Bluetooth 2.1 Canais HDMI ARC S55H");
    assert.strictEqual(produto.precoAtual, 798.99);
    assert.strictEqual(produto.precoAnterior, 1099.00);
    assert.strictEqual(produto.descontoPercentual, 27);
    assert.strictEqual(produto.imagem, "https://m.media-amazon.com/images/I/soundbar-SL1000.jpg");
    assert.strictEqual(produto.cupom, "");
    assert.strictEqual(produto.fonte, "dom_amazon_v1");
    assert.strictEqual(produto.completo, true);
    assert.notStrictEqual(produto.precoAtual, 66.61, "parcelamento nao vira preco atual");
    assert.notStrictEqual(produto.precoAtual, 20, "beneficio R$20 nao vira preco");
    assert.notStrictEqual(produto.descontoPercentual, 25, "beneficio de cartao nao vira desconto principal");
  }

  {
    const produto = amazon.capturarAmazonDaPagina(
      documentoAmazonSoundbarFixture({ oldHires: "" }),
      { href: "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6" }
    );
    assert.strictEqual(produto.imagem, "https://m.media-amazon.com/images/I/soundbar-SX522.jpg");
  }

  {
    const produto = amazon.capturarAmazonDaPagina(
      documentoAmazonSoundbarFixture({ semPrecoPrincipal: true }),
      { href: "https://www.amazon.com.br/Soundbar-Subwoofer-Bluetooth-Canais-S55H/dp/B0G2T13LT6" }
    );
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.completo, false);
    assert.ok(produto.warnings.includes("preco_atual_ausente"));
    assert.notStrictEqual(produto.precoAtual, 66.61);
    assert.notStrictEqual(produto.precoAtual, 20);
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let previews = 0;
    let sendMessages = 0;
    const delays = [];
    const urlAtual = "https://www.amazon.com.br/Soundbar-TCL/dp/B0G2T13LT6";
    const produtos = [
      {
        marketplace: "amazon",
        urlOriginal: urlAtual,
        titulo: "",
        precoAtual: null,
        imagem: "https://m.media-amazon.com/images/I/parcial.jpg",
        completo: false
      },
      {
        marketplace: "amazon",
        urlOriginal: urlAtual,
        titulo: "Soundbar TCL",
        precoAtual: null,
        imagem: "https://m.media-amazon.com/images/I/parcial.jpg",
        completo: false
      },
      {
        marketplace: "amazon",
        urlOriginal: urlAtual,
        titulo: "Soundbar TCL",
        precoAtual: 798.99,
        imagem: "https://m.media-amazon.com/images/I/soundbar.jpg",
        completo: true
      }
    ];
    const contexto = {
      console,
      setTimeout(callback, ms) {
        delays.push(ms);
        return setTimeout(callback, 0);
      },
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 9, url: urlAtual }];
          },
          async sendMessage() {
            sendMessages += 1;
            return { ok: true, produto: produtos[Math.min(sendMessages - 1, produtos.length - 1)] };
          },
          onActivated: { addListener() {} },
          onUpdated: { addListener() {} }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture(_token, payload) {
          previews += 1;
          assert.strictEqual(sendMessages, 3, "preview so deve iniciar depois da captura local valida");
          assert.strictEqual(payload.marketplace, "amazon");
          assert.strictEqual(payload.titulo, "Soundbar TCL");
          assert.strictEqual(payload.precoAtual, 798.99);
          return {
            oferta: {
              titulo: payload.titulo,
              precoAtual: payload.precoAtual,
              urlOriginal: payload.urlOriginal,
              urlAfiliada: "https://www.amazon.com.br/dp/B0G2T13LT6?tag=teste"
            }
          };
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual(sendMessages, 3, "Amazon deve parar a recuperacao assim que a captura ficar valida");
    assert.strictEqual(previews, 1, "captura valida deve gerar um unico preview");
    assert.ok(delays.includes(500));
    assert.ok(delays.includes(1000));
    assert.ok(!delays.includes(1600), "retry final nao deve ocorrer depois de captura valida");
    assert.strictEqual(elemento("campoTitulo").value, "Soundbar TCL");
    assert.strictEqual(elemento("campoPrecoAtual").value, "R$ 798,99");
    assert.strictEqual(elemento("statusProduto").textContent, "Produto capturado");
    assert.strictEqual(elemento("statusLink").textContent, "Oferta pronta");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let previews = 0;
    let sendMessages = 0;
    const delays = [];
    const urlAtual = "https://www.amazon.com.br/Soundbar-TCL/dp/B0G2T13LT6";
    const contexto = {
      console,
      setTimeout(callback, ms) {
        delays.push(ms);
        return setTimeout(callback, 0);
      },
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 10, url: urlAtual }];
          },
          async sendMessage() {
            sendMessages += 1;
            return {
              ok: true,
              produto: {
                marketplace: "amazon",
                urlOriginal: urlAtual,
                titulo: "",
                precoAtual: null,
                imagem: "https://m.media-amazon.com/images/I/parcial.jpg",
                completo: false
              }
            };
          },
          onActivated: { addListener() {} },
          onUpdated: { addListener() {} }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture() {
          previews += 1;
          throw new Error("preview_nao_deveria_ser_chamado");
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual(sendMessages, 4, "Amazon incompleta deve ter limite de uma tentativa inicial e tres recuperacoes");
    assert.deepStrictEqual(delays.filter((ms) => [500, 1000, 1600].includes(ms)), [500, 1000, 1600]);
    assert.strictEqual(previews, 0, "captura Amazon incompleta nao deve chamar preview/backend");
    assert.strictEqual(elemento("campoTitulo").value, "", "card parcial nao deve expor titulo/imagem como produto capturado");
    assert.strictEqual(elemento("produtoImagem").hidden, true);
    assert.strictEqual(elemento("statusProduto").textContent, "Captura incompleta");
    assert.strictEqual(elemento("botaoSalvar").disabled, true);
    assert.strictEqual(elemento("botaoEnviar").disabled, true);
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let previews = 0;
    let sendMessages = 0;
    const delays = [];
    let urlAtual = "https://www.amazon.com.br/Produto-A/dp/B0G2T13LT6";
    const urlB = "https://www.amazon.com.br/Produto-B/dp/B0H9T13LT6";
    const contexto = {
      console,
      setTimeout(callback, ms) {
        delays.push(ms);
        if (ms === 500) urlAtual = urlB;
        return setTimeout(callback, 0);
      },
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 11, url: urlAtual }];
          },
          async get(_abaId) {
            return { id: 11, url: urlAtual };
          },
          async sendMessage() {
            sendMessages += 1;
            return {
              ok: true,
              produto: {
                marketplace: "amazon",
                urlOriginal: "https://www.amazon.com.br/Produto-A/dp/B0G2T13LT6",
                titulo: "",
                precoAtual: null,
                imagem: "https://m.media-amazon.com/images/I/parcial.jpg",
                completo: false
              }
            };
          },
          onActivated: { addListener() {} },
          onUpdated: { addListener() {} }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture() {
          previews += 1;
          throw new Error("preview_nao_deveria_ser_chamado");
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual(sendMessages, 1, "troca de URL deve cancelar retries antigos antes de nova leitura");
    assert.strictEqual(previews, 0);
    assert.ok(delays.includes(500));
    assert.ok(!delays.includes(1000));
    assert.strictEqual(elemento("botaoSalvar").disabled, true);
    assert.strictEqual(elemento("botaoEnviar").disabled, true);
  }

  {
    const documento = documentoShopeeFixture();
    const produto = shopee.capturarShopeeDaPagina(documento, documento.location);
    assert.strictEqual(produto.marketplace, "shopee");
    assert.strictEqual(produto.titulo, "Tenis de Corrida Unissex Respiravel Challenger 6 - Olympikus");
    assert.strictEqual(produto.imagem, "https://down-br.img.susercontent.com/file/produto-hero.webp");
    assert.strictEqual(produto.precoAtual, 212.90);
    assert.strictEqual(produto.precoAnterior, null);
    assert.strictEqual(produto.cupom, "");
    assert.strictEqual(produto.fonte, "dom_shopee_v1");
    assert.strictEqual(produto.completo, true);
  }

  {
    const documento = documentoShopeeFixture({ comPrecoAnterior: true });
    const produto = shopee.capturarShopeeDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, 212.90);
    assert.strictEqual(produto.precoAnterior, 299.90);
    assert.notStrictEqual(produto.precoAnterior, 249.00);
  }

  {
    const payload = contrato.payloadPreview({
      marketplace: "shopee",
      urlOriginal: "https://shopee.com.br/product/123456/987654",
      titulo: "Produto Shopee",
      precoAtual: 212.90,
      imagem: "https://down-br.img.susercontent.com/file/produto.webp"
    });
    assert.strictEqual(payload.marketplace, "shopee");
    assert.strictEqual(payload.precoAtual, 212.90);
    assert.strictEqual(payload.temVariacaoPreco, false);
  }

  {
    const documento = documentoShopeeFaixaFixture();
    const produto = shopee.capturarShopeeDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.precoMin, 67.99);
    assert.strictEqual(produto.precoMax, 99.99);
    assert.strictEqual(produto.temVariacaoPreco, true);
    assert.strictEqual(produto.precoAnterior, null);
    assert.strictEqual(produto.completo, true);
    assert.notStrictEqual(produto.precoAtual, 67.99, "minimo da faixa nao vira preco unico");
    assert.notStrictEqual(produto.precoMin, 6.60, "parcelamento nao vira preco minimo");
    const payload = contrato.payloadPreview(produto);
    assert.strictEqual(payload.precoAtual, "");
    assert.strictEqual(payload.precoMin, 67.99);
    assert.strictEqual(payload.precoMax, 99.99);
    assert.strictEqual(payload.temVariacaoPreco, true);
  }

  {
    const produto = shopee.capturarShopeeDaPagina(
      documentoShopeePercentualFixture(),
      { href: "https://shopee.com.br/product/123456/666666" }
    );
    assert.strictEqual(produto.precoAtual, 69.00);
    assert.notStrictEqual(produto.precoAtual, 1.00, "percentual nunca vira preco");
  }

  {
    const produto = shopee.capturarShopeeDaPagina(
      documentoShopeePercentualFixture({ incluirPreco: false }),
      { href: "https://shopee.com.br/product/123456/666666" }
    );
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.precoMin, null);
    assert.strictEqual(produto.completo, false);
    assert.ok(produto.warnings.includes("preco_atual_ausente"));
  }

  {
    const documento = documentoShopeeSpaFixture();
    const produto = shopee.capturarShopeeDaPagina(documento, documento.location);
    assert.strictEqual(produto.titulo, "Kit 4 Baby Tee Feminina - Blusa Slim Fit Manga Curta Blusa de Compressao Varias Cores Ajuste Perfeito Candy Color");
    assert.strictEqual(produto.precoAtual, 59.90);
    assert.strictEqual(produto.precoAnterior, null, "segundo preco textual nao deve virar preco anterior");
    assert.strictEqual(produto.imagem, "https://down-br.img.susercontent.com/file/baby-tee.webp");
    assert.strictEqual(produto.completo, true);
  }

  {
    const documento = documentoShopeeSpaFixture({ precoAnteriorEstrutural: true });
    const produto = shopee.capturarShopeeDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, 59.90);
    assert.strictEqual(produto.precoAnterior, 130.90);
    assert.strictEqual(produto.descontoPercentual, 54);
  }

  {
    const documento = documentoAliExpressFixture();
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.marketplace, "aliexpress");
    assert.strictEqual(produto.urlOriginal, "https://pt.aliexpress.com/item/1005007871648778.html");
    assert.strictEqual(produto.titulo, "Mini Projetor Portatil AliExpress Full HD");
    assert.notStrictEqual(produto.titulo, "Aliexpress");
    assert.notStrictEqual(produto.titulo, "Resumo do item com IA");
    assert.strictEqual(produto.precoAtual, 213.25);
    assert.strictEqual(produto.imagem, "https://ae01.alicdn.com/kf/projetor.jpg");
    assert.strictEqual(produto.cupom, "");
    assert.strictEqual(produto.completo, true);
  }

  {
    const documento = documentoAliExpressFixture({
      precoTexto: "Stern R$ 258,29\n2% de desconto extra ao usar moedas\nR$134,66 x 3 sem juros\nPoupe R$313,29\nR$43,69+ em impostos estimados",
      jsonLd: jsonLdAliExpressProduto({
        name: "Produto AliExpress com fallback JSON-LD",
        offers: {
          "@type": "Offer",
          price: "403.99",
          priceCurrency: "BRL",
          url: "https://pt.aliexpress.com/item/1005011981610735.html"
        }
      }),
      url: "https://pt.aliexpress.com/item/1005011981610735.html",
      precoEstrutural: false
    });
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, 403.99);
    assert.notStrictEqual(produto.precoAtual, 258.29);
    assert.notStrictEqual(produto.precoAtual, 2);
    assert.notStrictEqual(produto.precoAtual, 134.66);
    assert.notStrictEqual(produto.precoAtual, 313.29);
    assert.notStrictEqual(produto.precoAtual, 43.69);
    assert.strictEqual(produto.fonte, "json_ld_aliexpress_v1");
  }

  {
    const documento = documentoAliExpressFixture({
      precoTexto: "Stern R$ 258,29",
      jsonLd: jsonLdAliExpressProduto({
        offers: {
          "@type": "Offer",
          price: "403.99"
        }
      }),
      precoEstrutural: false
    });
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.completo, false);
  }

  {
    const documento = documentoAliExpressFixture({
      precoTexto: "",
      jsonLd: jsonLdAliExpressProduto({
        offers: {
          "@type": "Offer",
          price: "403.99",
          priceCurrency: "USD"
        }
      }),
      precoEstrutural: false
    });
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.completo, false);
  }

  {
    const documento = documentoAliExpressFixture({
      precoTexto: "R$67,99 - R$99,99\nR$19,54 x 12 meses\n-15%",
      jsonLd: jsonLdAliExpressProduto({
        offers: {
          "@type": "AggregateOffer",
          lowPrice: "67.99",
          highPrice: "99.99",
          priceCurrency: "BRL"
        }
      })
    });
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.precoMin, 67.99);
    assert.strictEqual(produto.precoMax, 99.99);
    assert.strictEqual(produto.temVariacaoPreco, true);
    assert.notStrictEqual(produto.precoMin, 15);
    assert.notStrictEqual(produto.precoMin, 19.54);
    const payload = contrato.payloadPreview(produto);
    assert.strictEqual(payload.precoAtual, "");
    assert.strictEqual(payload.precoMin, 67.99);
    assert.strictEqual(payload.precoMax, 99.99);
    assert.strictEqual(payload.temVariacaoPreco, true);
  }

  {
    const documento = documentoAliExpressFixture({
      precoTexto: "2% de desconto extra ao usar moedas\nR$19,54 x 12 meses",
      jsonLd: "{}"
    });
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.precoMin, null);
    assert.strictEqual(produto.completo, false);
    assert.ok(produto.warnings.includes("preco_atual_ausente"));
  }

  {
    const documento = documentoAliExpressFixture({
      jsonLd: jsonLdAliExpressProduto({ image: "" }),
      imagem: "https://ae01.alicdn.com/kf/banner-generico.jpg",
      ogImagem: ""
    });
    const produto = aliexpress.capturarAliExpressDaPagina(documento, documento.location);
    assert.strictEqual(produto.imagem, "");
  }

  {
    const fonteAli = fs.readFileSync(path.join(raiz, "adapters", "aliexpress.js"), "utf8");
    assert.ok(!/appKey|trackingId|client_secret|access_token|cookie/i.test(fonteAli));
    assert.ok(!fonteAli.includes("fetch("));
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let onUpdated = null;
    let urlAtual = "https://produto.mercadolivre.com.br/MLB-111-produto-a-_JM";
    let produtoAtual = {
      marketplace: "mercadolivre",
      urlOriginal: urlAtual,
      titulo: "Produto A",
      precoAtual: 60.31,
      precoAnterior: 124.45,
      imagem: "https://http2.mlstatic.com/a.webp"
    };
    let previews = 0;
    let saves = 0;
    let destinosRequests = 0;
    let envios = 0;
    let falharSave = false;
    let falharEnvio = false;
    let resolverSavePendente = null;
    const payloadsPreview = [];
    const ofertasSalvas = [];
    const enviosPayloads = [];
    const contexto = {
      console,
      setTimeout,
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 1, url: urlAtual }];
          },
          async sendMessage() {
            return { produto: produtoAtual };
          },
          onActivated: { addListener() {} },
          onUpdated: {
            addListener(callback) {
              onUpdated = callback;
            }
          }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture(_token, payload) {
          previews += 1;
          payloadsPreview.push(payload);
          return {
            oferta: {
              clienteId: "cliente_ignorado_pelo_frontend",
              titulo: payload.titulo,
              precoAtual: payload.precoAtual,
              precoAnterior: payload.precoAnterior,
              urlOriginal: payload.urlOriginal,
              urlAfiliada: "https://meli.la/teste"
            }
          };
        },
        async salvarOfertaManualV2(_token, oferta) {
          saves += 1;
          ofertasSalvas.push(oferta);
          if (resolverSavePendente) {
            await new Promise((resolve) => {
              resolverSavePendente = resolve;
            });
            resolverSavePendente = null;
          }
          if (falharSave) {
            const erro = new Error("falha_temporaria");
            erro.status = 503;
            throw erro;
          }
          return {
            ok: true,
            oferta: {
              id: `manual_salvo_${saves}`,
              ...oferta
            }
          };
        },
        async listarDestinosManualV2(token) {
          assert.strictEqual(token, "jwt_teste");
          destinosRequests += 1;
          return {
            ok: true,
            destinos: [
              { id: "wa_ok", nome: "WA Ofertas", tipo: "whatsapp", ativo: true, utilizavel: true },
              { id: "tg_ok", nome: "TG Ofertas", tipo: "telegram", ativo: true, utilizavel: true },
              {
                id: "dc_off",
                nome: "Discord OFF",
                tipo: "discord",
                ativo: false,
                utilizavel: false,
                motivoIndisponivel: "Destino inativo"
              }
            ]
          };
        },
        async enviarAgoraManualV2(token, ofertaId, destinosIds) {
          assert.strictEqual(token, "jwt_teste");
          envios += 1;
          enviosPayloads.push({ ofertaId, destinosIds });
          if (falharEnvio) {
            const erro = new Error("envio_temporario");
            erro.status = 409;
            throw erro;
          }
          return {
            ok: true,
            envio: {
              enviados: destinosIds.length,
              erros: 0,
              creditosDebitados: destinosIds.length
            }
          };
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(previews, 1);
    assert.strictEqual(elemento("statusConexao").textContent, "Conectado - DiegoPC");
    assert.strictEqual(elemento("loginView").hidden, true);
    assert.strictEqual(elemento("produtoView").hidden, false);
    assert.strictEqual(elemento("campoPrecoAtual").value, "R$ 60,31");
    assert.strictEqual(elemento("campoPrecoAnterior").value, "R$ 124,45");
    assert.strictEqual(payloadsPreview[0].precoAtual, 60.31);
    assert.strictEqual(payloadsPreview[0].precoAnterior, 124.45);
    assert.strictEqual(elemento("previewView").children[1].textContent, "Produto A - R$ 60,31");
    assert.strictEqual(elemento("estadoPagina").textContent, "Oferta pronta");
    assert.strictEqual(elemento("statusLink").textContent, "Oferta pronta");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);

    resolverSavePendente = true;
    const primeiroSave = elemento("botaoSalvar").listeners.click();
    const segundoSave = elemento("botaoSalvar").listeners.click();
    assert.strictEqual(saves, 1, "duplo clique rapido nao deve gerar dois saves");
    assert.strictEqual(elemento("botaoSalvar").disabled, true);
    assert.strictEqual(elemento("botaoSalvar").textContent, "Salvando...");
    resolverSavePendente();
    await Promise.all([primeiroSave, segundoSave]);
    assert.strictEqual(previews, 1, "salvar nao deve chamar preview/capture novamente");
    assert.strictEqual(saves, 1);
    assert.strictEqual(elemento("statusLink").textContent, "Salvo na Galeria do Optimus");
    assert.strictEqual(elemento("botaoSalvar").disabled, true);
    assert.strictEqual(elemento("botaoSalvar").textContent, "Salvo no Optimus");
    assert.strictEqual(elemento("botaoSalvar").dataset.estado, "salvo");
    assert.strictEqual(ofertasSalvas[0].urlAfiliada, "https://meli.la/teste");
    assert.strictEqual(ofertasSalvas[0].precoAtual, 60.31);
    assert.ok(!("clienteId" in ofertasSalvas[0]));
    await elemento("botaoSalvar").listeners.click();
    assert.strictEqual(saves, 1, "mesmo preview salvo nao deve salvar novamente");

    await elemento("botaoEnviar").listeners.click();
    assert.strictEqual(destinosRequests, 1);
    assert.strictEqual(elemento("destinosView").hidden, false);
    assert.strictEqual(elemento("destinosLista").children.length, 3);
    const destinoWa = elemento("destinosLista").children[0].children[0];
    const destinoTg = elemento("destinosLista").children[1].children[0];
    const destinoDiscordOff = elemento("destinosLista").children[2].children[0];
    assert.strictEqual(destinoDiscordOff.disabled, true);
    destinoWa.checked = true;
    destinoWa.listeners.change();
    destinoTg.checked = true;
    destinoTg.listeners.change();
    assert.strictEqual(elemento("botaoConfirmarEnvio").disabled, false);
    await elemento("botaoConfirmarEnvio").listeners.click();
    assert.strictEqual(envios, 1);
    assert.strictEqual(enviosPayloads[0].ofertaId, "manual_salvo_1");
    assert.deepStrictEqual(Array.from(enviosPayloads[0].destinosIds), ["wa_ok", "tg_ok"]);
    assert.strictEqual(saves, 1, "oferta ja salva deve reutilizar ofertaSalvaId");
    assert.strictEqual(previews, 1, "enviar nao deve chamar preview/capture novamente");
    assert.strictEqual(elemento("statusLink").textContent, "Enviado para 2 destino(s)");
    assert.strictEqual(elemento("botaoEnviar").disabled, true);
    assert.strictEqual(elemento("botaoEnviar").textContent, "Enviado");
    await elemento("botaoConfirmarEnvio").listeners.click();
    assert.strictEqual(envios, 1, "mesmo preview enviado nao deve enviar novamente");

    onUpdated(1, { status: "complete" });
    await new Promise(resolve => setTimeout(resolve, 760));
    assert.strictEqual(previews, 1);

    urlAtual = "https://produto.mercadolivre.com.br/MLB-222-produto-b-_JM";
    produtoAtual = {
      marketplace: "mercadolivre",
      urlOriginal: urlAtual,
      titulo: "Produto B",
      precoAtual: 1249.9,
      imagem: "https://http2.mlstatic.com/b.webp"
    };
    onUpdated(1, { url: urlAtual });
    await new Promise(resolve => setTimeout(resolve, 760));
    assert.strictEqual(previews, 2);
    assert.strictEqual(elemento("campoTitulo").value, "Produto B");
    assert.strictEqual(elemento("campoPrecoAtual").value, "R$ 1.249,90");
    assert.strictEqual(elemento("campoPrecoAnterior").value, "");
    assert.strictEqual(payloadsPreview[1].precoAtual, 1249.9);
    assert.strictEqual(payloadsPreview[1].precoAnterior, "");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);
    assert.strictEqual(elemento("botaoSalvar").dataset.estado, "");

    await elemento("botaoEnviar").listeners.click();
    elemento("destinosLista").children[0].children[0].checked = true;
    elemento("destinosLista").children[0].children[0].listeners.change();
    await elemento("botaoConfirmarEnvio").listeners.click();
    assert.strictEqual(envios, 2);
    assert.strictEqual(saves, 2, "preview nao salvo deve ser salvo uma unica vez antes do envio");
    assert.strictEqual(enviosPayloads[1].ofertaId, "manual_salvo_2");
    assert.deepStrictEqual(Array.from(enviosPayloads[1].destinosIds), ["wa_ok"]);
    assert.strictEqual(ofertasSalvas[1].urlAfiliada, "https://meli.la/teste");
    assert.ok(!("clienteId" in ofertasSalvas[1]));

    urlAtual = "https://produto.mercadolivre.com.br/MLB-333-produto-c-_JM";
    produtoAtual = {
      marketplace: "mercadolivre",
      urlOriginal: urlAtual,
      titulo: "Produto C",
      precoAtual: 89.9,
      imagem: "https://http2.mlstatic.com/c.webp"
    };
    onUpdated(1, { url: urlAtual });
    await new Promise(resolve => setTimeout(resolve, 760));
    assert.strictEqual(previews, 3);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);

    falharSave = true;
    await elemento("botaoSalvar").listeners.click();
    assert.strictEqual(saves, 3);
    assert.strictEqual(elemento("statusLink").textContent, "Nao foi possivel salvar. Tente novamente.");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(envios, 2, "falha no save nao deve chamar enviar-agora");
    falharSave = false;
    await elemento("botaoSalvar").listeners.click();
    assert.strictEqual(saves, 4);
    assert.strictEqual(ofertasSalvas[3].precoAtual, 89.9);
    assert.strictEqual(elemento("statusLink").textContent, "Salvo na Galeria do Optimus");

    urlAtual = "https://produto.mercadolivre.com.br/MLB-444-produto-d-_JM";
    produtoAtual = {
      marketplace: "mercadolivre",
      urlOriginal: urlAtual,
      titulo: "Produto D",
      precoAtual: 77.7,
      imagem: "https://http2.mlstatic.com/d.webp"
    };
    onUpdated(1, { url: urlAtual });
    await new Promise(resolve => setTimeout(resolve, 760));
    falharEnvio = true;
    await elemento("botaoEnviar").listeners.click();
    elemento("destinosLista").children[0].children[0].checked = true;
    elemento("destinosLista").children[0].children[0].listeners.change();
    await elemento("botaoConfirmarEnvio").listeners.click();
    assert.strictEqual(saves, 5);
    assert.strictEqual(envios, 3);
    assert.strictEqual(enviosPayloads[2].ofertaId, "manual_salvo_5");
    assert.strictEqual(elemento("statusLink").textContent, "Nao foi possivel enviar: envio_temporario");
    falharEnvio = false;
    await elemento("botaoConfirmarEnvio").listeners.click();
    assert.strictEqual(saves, 5, "falha no envio preserva ID salvo para retry seguro");
    assert.strictEqual(envios, 4);
    assert.strictEqual(enviosPayloads[3].ofertaId, "manual_salvo_5");
    assert.strictEqual(elemento("statusLink").textContent, "Enviado para 1 destino(s)");
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let previews = 0;
    const produtoAtual = {
      marketplace: "shopee",
      urlOriginal: "https://shopee.com.br/product/123456/555555",
      titulo: "Triturador De Alimentos",
      precoAtual: null,
      precoMin: 67.99,
      precoMax: 99.99,
      temVariacaoPreco: true,
      imagem: "https://down-br.img.susercontent.com/file/faixa.webp",
      completo: true
    };
    const contexto = {
      console,
      setTimeout,
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 8, url: produtoAtual.urlOriginal }];
          },
          async sendMessage() {
            return { ok: true, produto: produtoAtual };
          },
          onActivated: { addListener() {} },
          onUpdated: { addListener() {} }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture(_token, payload) {
          previews += 1;
          assert.strictEqual(payload.precoAtual, "");
          assert.strictEqual(payload.precoMin, 67.99);
          assert.strictEqual(payload.precoMax, 99.99);
          assert.strictEqual(payload.temVariacaoPreco, true);
          return {
            oferta: {
              titulo: payload.titulo,
              precoAtual: payload.precoAtual,
              precoMin: payload.precoMin,
              precoMax: payload.precoMax,
              temVariacaoPreco: payload.temVariacaoPreco,
              urlOriginal: payload.urlOriginal,
              urlAfiliada: "https://shopee.com.br/oferta-afiliada"
            }
          };
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(previews, 1);
    assert.strictEqual(elemento("campoPrecoAtual").value, "A partir de R$ 67,99");
    assert.strictEqual(elemento("previewView").children[1].textContent, "Triturador De Alimentos - A partir de R$ 67,99");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let onUpdated = null;
    let previews = 0;
    let urlAtual = "https://shopee.com.br/product/123456/987654";
    let produtoAtual = {
      marketplace: "shopee",
      urlOriginal: urlAtual,
      titulo: "Mochila Esportiva Unissex com Compartimento para Notebook Braze OIWB221802 - Olympikus",
      precoAtual: 76.87,
      precoAnterior: "",
      imagem: "https://down-br.img.susercontent.com/file/mochila.webp",
      cupom: ""
    };
    const contexto = {
      console,
      setTimeout,
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 2, url: urlAtual }];
          },
          async sendMessage() {
            return { ok: true, produto: produtoAtual };
          },
          onActivated: { addListener() {} },
          onUpdated: {
            addListener(callback) {
              onUpdated = callback;
            }
          }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture(_token, payload) {
          previews += 1;
          return {
            oferta: {
              titulo: payload.titulo,
              precoAtual: payload.precoAtual,
              precoAnterior: payload.precoAnterior,
              urlOriginal: payload.urlOriginal,
              urlAfiliada: "https://shopee.com.br/oferta-afiliada"
            }
          };
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(previews, 1, "Shopee capturada deve gerar preview automaticamente");
    assert.strictEqual(elemento("produtoMarketplace").textContent, "Shopee");
    assert.strictEqual(elemento("campoTitulo").value, produtoAtual.titulo);
    assert.strictEqual(elemento("campoPrecoAtual").value, "R$ 76,87");
    assert.strictEqual(elemento("campoPrecoAnterior").value, "");
    assert.strictEqual(elemento("campoCupom").value, "");
    assert.strictEqual(elemento("estadoPagina").textContent, "Oferta pronta");
    assert.strictEqual(elemento("statusProduto").textContent, "Produto capturado");
    assert.strictEqual(elemento("statusLink").textContent, "Oferta pronta");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);

    produtoAtual = {
      marketplace: "shopee",
      urlOriginal: "https://shopee.com.br/product/123456/111111",
      titulo: "",
      precoAtual: null,
      imagem: "https://down-br.img.susercontent.com/file/incompleto.webp"
    };
    urlAtual = produtoAtual.urlOriginal;
    onUpdated(2, { url: urlAtual });
    await new Promise(resolve => setTimeout(resolve, 1700));
    assert.strictEqual(previews, 1, "captura invalida nao deve gerar preview");
    assert.strictEqual(elemento("statusProduto").textContent, "Captura incompleta");
    assert.strictEqual(elemento("estadoPagina").textContent, "Nao foi possivel capturar este produto.");
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let previews = 0;
    let sendMessages = 0;
    const urlAtual = "https://shopee.com.br/product/123456/222222";
    const produtoAtual = {
      marketplace: "shopee",
      urlOriginal: urlAtual,
      titulo: "Produto Shopee Recuperado",
      precoAtual: 59.90,
      imagem: "https://down-br.img.susercontent.com/file/recuperado.webp"
    };
    const contexto = {
      console,
      setTimeout,
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 4, url: urlAtual }];
          },
          async sendMessage() {
            sendMessages += 1;
            if (sendMessages === 1) {
              throw new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received");
            }
            return { ok: true, produto: produtoAtual };
          },
          onActivated: { addListener() {} },
          onUpdated: { addListener() {} }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture(_token, payload) {
          previews += 1;
          return {
            oferta: {
              titulo: payload.titulo,
              precoAtual: payload.precoAtual,
              urlOriginal: payload.urlOriginal,
              urlAfiliada: "https://shopee.com.br/oferta-afiliada"
            }
          };
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    await domReady();
    await new Promise(resolve => setTimeout(resolve, 950));
    assert.strictEqual(sendMessages, 2, "falha de canal deve gerar uma unica recuperacao");
    assert.strictEqual(previews, 1, "recuperacao valida deve gerar um unico preview");
    assert.strictEqual(elemento("campoTitulo").value, "Produto Shopee Recuperado");
    assert.strictEqual(elemento("statusLink").textContent, "Oferta pronta");
    assert.strictEqual(elemento("botaoSalvar").disabled, false);
    assert.strictEqual(elemento("botaoEnviar").disabled, false);
  }

  {
    const elementos = new Map();
    function elemento(id) {
      if (!elementos.has(id)) {
        const node = {
          id,
          hidden: false,
          textContent: "",
          value: "",
          src: "",
          disabled: false,
          dataset: {},
          title: "",
          _innerHTML: "",
          children: [],
          listeners: {},
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          },
          append(...itens) {
            this.children.push(...itens);
          }
        };
        Object.defineProperty(node, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(valor) {
            this._innerHTML = String(valor || "");
            this.children = [];
          }
        });
        elementos.set(id, node);
      }
      return elementos.get(id);
    }

    let domReady = null;
    let onUpdated = null;
    let resolverProdutoA = null;
    let previews = 0;
    let urlAtual = "https://shopee.com.br/product/123456/333333";
    const produtoA = {
      marketplace: "shopee",
      urlOriginal: urlAtual,
      titulo: "Produto A Antigo",
      precoAtual: 49.90,
      imagem: "https://down-br.img.susercontent.com/file/a.webp"
    };
    const produtoB = {
      marketplace: "shopee",
      urlOriginal: "https://shopee.com.br/product/123456/444444",
      titulo: "Produto B Atual",
      precoAtual: 79.90,
      imagem: "https://down-br.img.susercontent.com/file/b.webp"
    };
    let sendMessages = 0;
    const payloadsPreview = [];
    const contexto = {
      console,
      setTimeout,
      clearTimeout,
      document: {
        getElementById: elemento,
        createElement: (tag) => ({
          tag,
          textContent: "",
          children: [],
          listeners: {},
          value: "",
          checked: false,
          disabled: false,
          className: "",
          append(...itens) { this.children.push(...itens); },
          addEventListener(evento, callback) {
            this.listeners[evento] = callback;
          }
        }),
        addEventListener(evento, callback) {
          if (evento === "DOMContentLoaded") domReady = callback;
        }
      },
      chrome: {
        tabs: {
          async query() {
            return [{ id: 5, url: urlAtual }];
          },
          async sendMessage() {
            sendMessages += 1;
            if (sendMessages === 1) {
              return new Promise((resolve) => {
                resolverProdutoA = () => resolve({ ok: true, produto: produtoA });
              });
            }
            return { ok: true, produto: produtoB };
          },
          onActivated: { addListener() {} },
          onUpdated: {
            addListener(callback) {
              onUpdated = callback;
            }
          }
        }
      },
      OptimusCaptureAuth: {
        async restaurarSessao() {
          return { token: "jwt_teste", usuario: { nome: "DiegoPC" } };
        },
        async sair() {}
      },
      OptimusCaptureApi: {
        async gerarPreviewCapture(_token, payload) {
          previews += 1;
          payloadsPreview.push(payload);
          return {
            oferta: {
              titulo: payload.titulo,
              precoAtual: payload.precoAtual,
              urlOriginal: payload.urlOriginal,
              urlAfiliada: "https://shopee.com.br/oferta-afiliada"
            }
          };
        }
      },
      OptimusCaptureContract: contrato,
      OptimusCaptureDetector: detector
    };
    contexto.globalThis = contexto;
    contexto.window = contexto;
    vm.createContext(contexto);
    vm.runInContext(panelFonte, contexto);

    const inicializacao = domReady();
    await new Promise(resolve => setTimeout(resolve, 20));
    urlAtual = produtoB.urlOriginal;
    onUpdated(5, { url: urlAtual });
    resolverProdutoA();
    await inicializacao;
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.strictEqual(previews, 1, "resposta antiga nao deve gerar preview do produto A");
    assert.strictEqual(payloadsPreview[0].titulo, "Produto B Atual");
    assert.strictEqual(elemento("campoTitulo").value, "Produto B Atual");
    assert.strictEqual(elemento("estadoPagina").textContent, "Oferta pronta");
    assert.notStrictEqual(elemento("estadoPagina").textContent, "Nenhuma aba ativa disponivel.");
  }

  {
    const deteccao = detector.detectarMarketplacePorUrl("https://meli.la/abc123");
    assert.strictEqual(deteccao.suportado, false);
    assert.strictEqual(deteccao.motivo, "meli_la_requer_url_real");
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlProdutoJsonLd(),
      "https://produto.mercadolivre.com.br/MLB-5065365233-produto-_JM"
    );
    assert.strictEqual(produto.marketplace, "mercadolivre");
    assert.strictEqual(produto.titulo, "Creatine Beauty Pro 180g Cranberry");
    assert.strictEqual(produto.precoAtual, 129.9);
    assert.strictEqual(produto.precoAnterior, 199.9);
    assert.strictEqual(produto.imagem, "https://http2.mlstatic.com/D_NQ_NP_456.webp");
    assert.strictEqual(produto.cupom, "SEMDEMORA");
    assert.strictEqual(produto.completo, true);
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlPrecoAnteriorDomMercadoLivre(),
      "https://produto.mercadolivre.com.br/MLB-999-produto-real-_JM"
    );
    assert.strictEqual(produto.precoAtual, 72.16);
    assert.strictEqual(produto.precoAnterior, 129.9);
    assert.notStrictEqual(produto.precoAnterior, 7.11);
    assert.strictEqual(produto.descontoPercentual, 44);
    assert.strictEqual(produto.imagem, "https://http2.mlstatic.com/D_NQ_NP_DOM.webp");
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlPrecoAnteriorDomMercadoLivre({ incluirOriginal: false }),
      "https://produto.mercadolivre.com.br/MLB-999-produto-sem-de-_JM"
    );
    assert.strictEqual(produto.precoAtual, 72.16);
    assert.strictEqual(produto.precoAnterior, null);
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlPrecoAnteriorDomMercadoLivre({ anterior: "72", centavos: "16" }),
      "https://produto.mercadolivre.com.br/MLB-999-produto-original-igual-_JM"
    );
    assert.strictEqual(produto.precoAtual, 72.16);
    assert.strictEqual(produto.precoAnterior, null);
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlWall(),
      "https://www.mercadolivre.com.br/captcha/wall/logged"
    );
    assert.strictEqual(produto.completo, false);
    assert.ok(produto.warnings.includes("wall_captcha_detectado"));
  }

  {
    const produto = ml.capturarMercadoLivreDeHtml(
      htmlPrecoAmbiguo(),
      "https://produto.mercadolivre.com.br/MLB-123-produto-_JM"
    );
    assert.strictEqual(produto.precoAtual, null);
    assert.strictEqual(produto.precoAmbiguo, true);
    assert.strictEqual(produto.requerConferencia, true);
  }

  {
    const payload = contrato.payloadPreview({
      marketplace: "mercadolivre",
      urlOriginal: "https://produto.mercadolivre.com.br/MLB-123-produto-_JM",
      titulo: "Produto editado",
      precoAtual: "129,90",
      precoAnterior: "199,90",
      imagem: "https://http2.mlstatic.com/imagem.webp",
      cupom: "sem demora",
      origem: "cliente_malicioso"
    });
    assert.deepStrictEqual(payload, {
      marketplace: "mercadolivre",
      urlOriginal: "https://produto.mercadolivre.com.br/MLB-123-produto-_JM",
      titulo: "Produto editado",
      precoAtual: 129.9,
      precoAnterior: 199.9,
      precoMin: "",
      precoMax: "",
      temVariacaoPreco: false,
      imagem: "https://http2.mlstatic.com/imagem.webp",
      cupom: "SEM DEMORA",
      origem: "optimus_capture_v1"
    });
  }

  {
    const fetchOriginal = global.fetch;
    let abortado = false;
    try {
      global.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          abortado = true;
          const erro = new Error("abortado");
          erro.name = "AbortError";
          reject(erro);
        });
      });
      delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
      const apiTimeout = require(path.join(raiz, "services", "api.js"));
      await assert.rejects(
        apiTimeout.requestJson("/manual-v2/capture/ofertas", { timeoutMs: 1 }),
        (erro) => erro.message === "tempo_limite_esgotado" && erro.status === 408
      );
      assert.strictEqual(abortado, true, "requestJson deve abortar quando timeoutMs expira");
    } finally {
      global.fetch = fetchOriginal;
      delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    }
  }

  {
    const storageMemoria = {};
    global.chrome = {
      storage: {
        local: {
          async get(chave) {
            return { [chave]: storageMemoria[chave] };
          },
          async set(dados) {
            Object.assign(storageMemoria, dados);
          },
          async remove(chave) {
            delete storageMemoria[chave];
          }
        }
      }
    };

    const respostas = [
      { ok: true, status: 200, body: { ok: true, token: "jwt_secreto_teste", usuario: { id: "cliente_a", nome: "Cliente A" } } },
      { ok: true, status: 200, body: { ok: true, usuario: { id: "cliente_a", nome: "Cliente A", plano: "ultimate" } } },
      { ok: false, status: 401, body: { ok: false, erro: "nao_autorizado" } }
    ];
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });
      const resposta = respostas.shift();
      return {
        ok: resposta.ok,
        status: resposta.status,
        async json() {
          return resposta.body;
        }
      };
    };

    delete require.cache[require.resolve(path.join(raiz, "services", "storage.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "auth.js"))];
    const storage = require(path.join(raiz, "services", "storage.js"));
    const api = require(path.join(raiz, "services", "api.js"));
    const auth = require(path.join(raiz, "services", "auth.js"));

    const authSalvo = await auth.autenticar("cliente_a", "senha_teste");
    assert.strictEqual(authSalvo.usuario.id, "cliente_a");
    assert.strictEqual(requests[0].url, api.endpoint("/login"));
    assert.ok(!JSON.stringify(requests[0].options.body || "").includes("jwt_secreto_teste"));
    const restaurado = await auth.restaurarSessao();
    assert.strictEqual(restaurado.usuario.plano, "ultimate");
    const depoisExpirado = await auth.restaurarSessao();
    assert.strictEqual(depoisExpirado, null);
    assert.strictEqual(await storage.lerAuth(), null);
  }


  {
    const { hashCodeChallenge } = require("../modules/auth/capture-handoff.service");
    delete require.cache[require.resolve(path.join(raiz, "services", "handoff.js"))];
    const handoff = require(path.join(raiz, "services", "handoff.js"));
    const codeVerifier = "verifier_seguro_capture_" + "x".repeat(48);
    const challenge = await handoff.criarCodeChallenge(codeVerifier);
    assert.strictEqual(challenge, hashCodeChallenge(codeVerifier));
  }

  {
    const storageMemoria = {};
    global.chrome = {
      storage: {
        local: {
          async get(chave) {
            return { [chave]: storageMemoria[chave] };
          },
          async set(dados) {
            Object.assign(storageMemoria, dados);
          },
          async remove(chave) {
            delete storageMemoria[chave];
          }
        }
      }
    };

    delete require.cache[require.resolve(path.join(raiz, "services", "storage.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "handoff.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "auth.js"))];
    const storage = require(path.join(raiz, "services", "storage.js"));
    const api = require(path.join(raiz, "services", "api.js"));
    const auth = require(path.join(raiz, "services", "auth.js"));

    const urlsAbertas = [];
    const status = [];
    let tentativasTroca = 0;
    let esperas = 0;
    api.iniciarCaptureHandoff = async (payload) => {
      assert.ok(payload.state.length >= 16);
      assert.ok(payload.codeChallenge.length >= 32);
      return { ok: true, handoffId: "handoff_teste", state: payload.state };
    };
    api.trocarCaptureHandoff = async (payload) => {
      assert.strictEqual(payload.handoffId, "handoff_teste");
      assert.ok(payload.codeVerifier.length >= 32);
      tentativasTroca += 1;
      if (tentativasTroca === 1) {
        const erro = new Error("capture_handoff_nao_autorizado");
        erro.status = 409;
        erro.body = { motivo: "capture_handoff_nao_autorizado" };
        throw erro;
      }
      return { ok: true, token: "jwt_capture_teste" };
    };
    api.me = async (token) => {
      assert.strictEqual(token, "jwt_capture_teste");
      return { ok: true, usuario: { id: "cliente_a", nome: "Cliente A", plano: "ultimate" } };
    };

    const authSalvo = await auth.conectarComOptimus({
      abrirUrl: (url) => urlsAbertas.push(url),
      onStatus: (mensagem) => status.push(mensagem),
      esperar: async () => { esperas += 1; },
      intervaloMs: 1,
      maxTentativas: 3
    });

    assert.strictEqual(authSalvo.token, "jwt_capture_teste");
    assert.strictEqual(authSalvo.origem, "capture_handoff");
    assert.strictEqual(authSalvo.usuario.id, "cliente_a");
    assert.strictEqual(tentativasTroca, 2);
    assert.strictEqual(esperas, 1);
    assert.strictEqual(urlsAbertas.length, 1);
    assert.ok(urlsAbertas[0].includes("/capture/connect?"));
    assert.ok(!urlsAbertas[0].includes("jwt_capture_teste"));
    assert.ok(status.includes("Conexao autorizada."));
    assert.strictEqual((await storage.lerAuth()).token, "jwt_capture_teste");
  }

  {
    const storageMemoria = {};
    global.chrome = {
      storage: {
        local: {
          async get(chave) {
            return { [chave]: storageMemoria[chave] };
          },
          async set(dados) {
            Object.assign(storageMemoria, dados);
          },
          async remove(chave) {
            delete storageMemoria[chave];
          }
        }
      }
    };

    delete require.cache[require.resolve(path.join(raiz, "services", "storage.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "api.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "handoff.js"))];
    delete require.cache[require.resolve(path.join(raiz, "services", "auth.js"))];
    const storage = require(path.join(raiz, "services", "storage.js"));
    const api = require(path.join(raiz, "services", "api.js"));
    const auth = require(path.join(raiz, "services", "auth.js"));

    api.iniciarCaptureHandoff = async (payload) => ({ ok: true, handoffId: "handoff_expirado", state: payload.state });
    api.trocarCaptureHandoff = async () => {
      const erro = new Error("capture_handoff_expirado");
      erro.status = 410;
      erro.body = { motivo: "capture_handoff_expirado" };
      throw erro;
    };

    await assert.rejects(
      auth.conectarComOptimus({ abrirUrl: () => undefined, esperar: async () => undefined, maxTentativas: 1 }),
      /capture_handoff_expirado/
    );
    assert.strictEqual(await storage.lerAuth(), null);
  }
  console.log("optimus-capture-extension.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
