const crypto = require("crypto");
const {
  canonicalizarUrlShopee,
  extrairDadosHtmlShopee,
  extrairIdsShopee: extrairIdsShopeeNormalizado,
  gerarKeywordShopee: gerarKeywordShopeeNormalizado,
  tituloShopeeValido,
  urlShopeeValida
} = require("./normalizacao");

function normalizarPrecoApiShopee(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;

  const bruto = String(valor).replace(/R\$/gi, "").replace(/\s+/g, "").trim();
  if (/^\d+$/.test(bruto)) {
    const centavos = Number(bruto);
    return Number.isFinite(centavos) && centavos > 0 ? centavos / 100 : null;
  }

  let normalizado = bruto.replace(/[^\d.,]/g, "");
  if (!normalizado) return null;

  if (normalizado.includes(",") && normalizado.includes(".")) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  } else if (normalizado.includes(",")) {
    normalizado = normalizado.replace(",", ".");
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function formatarPrecoApiShopee(valor) {
  const numero = normalizarPrecoApiShopee(valor);
  return numero === null ? "" : numero.toFixed(2).replace(".", ",");
}

function numeroPrecoFormatadoShopee(valor = "") {
  const numero = Number(String(valor || "").replace(",", "."));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function analisarFaixaPrecoShopee(precoMin = "", precoMax = "") {
  const minNumero = numeroPrecoFormatadoShopee(precoMin);
  const maxNumero = numeroPrecoFormatadoShopee(precoMax || precoMin);
  const temMin = minNumero !== null;
  const temMax = maxNumero !== null;
  const variacaoComprovada = Boolean(temMin && temMax && maxNumero > minNumero);
  const diferencaAbsoluta = variacaoComprovada ? maxNumero - minNumero : 0;
  const diferencaRelativa = variacaoComprovada ? diferencaAbsoluta / minNumero : 0;
  const proporcaoMinMax = variacaoComprovada ? minNumero / maxNumero : 1;
  const precoAmbiguo = variacaoComprovada && proporcaoMinMax < 0.40 && diferencaAbsoluta >= 50;

  return {
    precoMin: temMin ? precoMin : "",
    precoMax: temMax ? (precoMax || precoMin) : "",
    temVariacaoPreco: precoAmbiguo,
    precoAmbiguo,
    variacaoComprovada,
    diferencaAbsoluta,
    diferencaRelativa,
    proporcaoMinMax,
    faixaPreco: variacaoComprovada ? `R$ ${precoMin} a R$ ${precoMax || precoMin}` : "",
    avisoVariacaoPreco: precoAmbiguo ? `Variacoes de R$ ${precoMin} a R$ ${precoMax || precoMin}` : ""
  };
}

function resolverPrecoPixComprovadoShopee(precoNormal = "", precoPix = "") {
  const precoNormalNumero = numeroPrecoFormatadoShopee(precoNormal);
  const precoPixFormatado = formatarPrecoApiShopee(precoPix) || "";
  const precoPixNumero = numeroPrecoFormatadoShopee(precoPixFormatado);

  if (precoNormalNumero === null || precoPixNumero === null || precoPixNumero >= precoNormalNumero) {
    return {
      precoPix: "",
      descontoPix: "",
      valorEfetivo: null,
      valorEfetivoOrigem: ""
    };
  }

  const descontoPix = precoNormalNumero - precoPixNumero;
  return {
    precoPix: precoPixFormatado,
    descontoPix: descontoPix.toFixed(2).replace(".", ","),
    valorEfetivo: precoPixNumero,
    valorEfetivoOrigem: "pix"
  };
}

function criarImportarShopee(deps = {}) {
  const {
    limparPreco,
    htmlDecode,
    extrairMeta,
    corrigirImagemUrl
  } = deps;

return async function importarShopee(url, config) {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const { appId, secret } = config.credenciais || {};

  function linkCurtoShopee(link = "") {
    try {
      const host = new URL(String(link || "").trim()).hostname.toLowerCase().replace(/^www\./, "");
      return host === "s.shopee.com.br" || host.endsWith(".s.shopee.com.br");
    } catch {
      return false;
    }
  }

  async function expandirLinkCurtoShopee(link = "") {
    const urlOriginal = String(link || "").trim();
    const urlCanonicaLocal = canonicalizarUrlShopee(urlOriginal);
    const idsLocais = extrairIdsShopeeNormalizado(urlCanonicaLocal);
    const precisaResolverHttp = linkCurtoShopee(urlOriginal) || !idsLocais.itemId;

    if (!precisaResolverHttp) {
      console.log("[SHOPEE-LINK-EXPANDIDO]", {
        urlOriginal,
        urlFinal: urlCanonicaLocal,
        expandiu: urlCanonicaLocal !== urlOriginal,
        metodo: "canonicalizacao_local"
      });
      return { urlExpandida: urlCanonicaLocal, statusHttp: null, html: "", motivo: "canonicalizacao_local" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(urlOriginal, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });
      const html = await response.text();
      const dadosHtml = extrairDadosHtmlShopee(html);
      const candidataHtml = urlShopeeValida(dadosHtml.canonical) ? dadosHtml.canonical : "";
      const urlFinal = canonicalizarUrlShopee(candidataHtml || response.url || urlCanonicaLocal || urlOriginal);
      const expandiu = Boolean(urlFinal && urlFinal !== urlOriginal);

      console.log("[SHOPEE-LINK-EXPANDIDO]", {
        urlOriginal,
        urlFinal,
        expandiu
      });

      return {
        urlExpandida: urlFinal || urlCanonicaLocal || urlOriginal,
        statusHttp: response.status,
        html,
        motivo: expandiu ? "redirect_ou_canonical_resolvido" : "sem_redirect"
      };
    } catch (e) {
      console.log("[SHOPEE-LINK-EXPANDIDO]", {
        urlOriginal,
        urlFinal: urlOriginal,
        expandiu: false,
        erro: e.message
      });
      return {
        urlExpandida: urlCanonicaLocal || urlOriginal,
        statusHttp: null,
        html: "",
        motivo: e.name === "AbortError" ? "timeout_resolver_shopee" : "erro_resolver_shopee"
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizarPrecoShopee(valor) {
    if (!valor) return "";

    const texto = String(valor).trim();

    if (/^\d+$/.test(texto)) {
      const centavos = Number(texto);
      return Number.isFinite(centavos) && centavos > 0
        ? (centavos / 100).toFixed(2).replace(".", ",")
        : "";
    }

    let normalizado = texto
      .replace("R$", "")
      .replace(/\s+/g, "")
      .replace(/[^\d.,]/g, "")
      .trim();

    if (normalizado.includes(",") && normalizado.includes(".")) {
      normalizado = normalizado.replace(/\./g, "").replace(",", ".");
    } else if (normalizado.includes(",")) {
      normalizado = normalizado.replace(",", ".");
    }

    const numero = Number(normalizado);
    return Number.isFinite(numero) && numero > 0
      ? numero.toFixed(2).replace(".", ",")
      : limparPreco(texto);
  }



  function normalizarCupomShopee(cupom = "") {
    const codigo = String(cupom || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9_-]/g, "")
      .trim();

    const bloqueados = new Set([
      "HTTP",
      "HTTPS",
      "WWW",
      "SHOPEE",
      "COM",
      "BR",
      "CUPOM",
      "CUPONS",
      "CODIGO",
      "VOUCHER",
      "LINK",
      "PRODUTO",
      "PAGINA",
      "RESGATE",
      "RESGATAR",
      "DISPON",
      "DISPONIVEL",
      "DISPONVEL",
      "DISPONÍVEL"
    ]);

    if (!codigo || bloqueados.has(codigo)) return "";
    if (codigo.length < 5 || codigo.length > 40) return "";
    if (!/[A-Z]/.test(codigo)) return "";
    return codigo;
  }

  function textoOriginalRadarShopee() {
    return String(
      config?.textoOriginal ||
      config?.texto_original ||
      config?.contextoRadar?.textoOriginal ||
      config?.contextoRadar?.texto_original ||
      ""
    );
  }

  function extrairPrecoTextoRadarShopee() {
    const texto = textoOriginalRadarShopee();
    const por = Array.from(texto.matchAll(/\bPor\s*:?\s*R\$\s*[\d.]+(?:[,.]\d{1,2})?/gi)).map(m => m[0]);
    if (por.length === 1) return por[0];

    const precos = Array.from(texto.matchAll(/R\$\s*[\d.]+(?:[,.]\d{1,2})?/gi)).map(m => m[0]);
    return precos.length === 1 ? precos[0] : "";
  }

  function logPrecoOrigemShopee({ titulo = "", origemPreco = "", valorBruto = "", valorNormalizado = "" } = {}) {
    console.log("[SHOPEE-PRECO-ORIGEM]", {
      titulo: String(titulo || "").trim(),
      url,
      origemPreco,
      valorBruto,
      valorNormalizado,
      precoTextoRadar: extrairPrecoTextoRadarShopee()
    });
  }

  function motivoNormalizacaoPrecoApiShopee(valor = "") {
    const bruto = String(valor ?? "").trim();
    if (!bruto) return "api_sem_preco_usou_fallback_html";
    if (/^\d+$/.test(bruto)) return "api_inteiro_em_centavos_dividido_por_100";
    if (/^\d+[.,]0+$/.test(bruto)) return "api_decimal_inteiro_em_centavos_dividido_por_100";
    if (/^\d+[.,]\d+$/.test(bruto)) return "api_decimal_preservado_como_reais";
    return "api_preco_invalido";
  }

  function tipoPrecoShopee(valor) {
    if (valor === null) return "null";
    if (Array.isArray(valor)) return "array";
    return typeof valor;
  }

  function criarPrecoAuditoriaShopee({
    precoApi = "",
    precoBruto = "",
    precoNormalizado = "",
    origemPreco = "",
    motivoEscolhaPreco = "",
    campoPrecoUsado = "",
    tipoCampoPrecoUsado = "",
    precoAntesNormalizacao = "",
    precoDepoisNormalizacao = "",
    normalizadorAplicado = "",
    precoMin = "",
    precoMax = "",
    precoPix = "",
    precoOrigem = "",
    precoAmbiguo = false,
    faixaPreco = "",
    variacaoComprovada = false
  } = {}) {
    return {
      precoTextoRadar: extrairPrecoTextoRadarShopee(),
      precoApi: precoApi ?? "",
      precoBruto: precoBruto ?? "",
      precoNormalizado: precoNormalizado || "",
      origemPreco: origemPreco || "",
      precoOrigem: precoOrigem || origemPreco || "",
      motivoEscolhaPreco: motivoEscolhaPreco || "",
      campoPrecoUsado: campoPrecoUsado || origemPreco || "",
      tipoCampoPrecoUsado: tipoCampoPrecoUsado || tipoPrecoShopee(precoBruto),
      precoAntesNormalizacao: precoAntesNormalizacao ?? precoBruto ?? "",
      precoDepoisNormalizacao: precoDepoisNormalizacao || precoNormalizado || "",
      normalizadorAplicado: normalizadorAplicado || "",
      precoMin: precoMin || "",
      precoMax: precoMax || "",
      precoPix: precoPix || "",
      precoAmbiguo: precoAmbiguo === true,
      faixaPreco: faixaPreco || "",
      variacaoComprovada: variacaoComprovada === true
    };
  }

  function normalizarPrecoWebShopee(valor) {
    const bruto = String(valor ?? "").replace(/R\$/gi, "").replace(/\s+/g, "").trim();
    if (!bruto) return "";
    let normalizado = bruto.replace(/[^\d.,]/g, "");
    if (!normalizado) return "";
    if (normalizado.includes(",") && normalizado.includes(".")) {
      normalizado = normalizado.replace(/\./g, "").replace(",", ".");
    } else if (normalizado.includes(",")) {
      normalizado = normalizado.replace(",", ".");
    }
    const numero = Number(normalizado);
    return Number.isFinite(numero) && numero > 0 ? numero.toFixed(2).replace(".", ",") : "";
  }

  function linkShopeeInvalido(link = "") {
    const valor = String(link || "").toLowerCase();
    return valor.includes("shope.ee/error_page") || valor.includes("/error_page");
  }

  function tituloShopeeInvalido(titulo = "") {
    return !tituloShopeeValido(titulo);
  }

  function numeroPrecoShopee(valor) {
    const preco = normalizarPrecoShopee(valor);
    const numero = Number(String(preco || "").replace(",", "."));
    return Number.isFinite(numero) && numero > 0 ? numero : 0;
  }

  function diagnosticarVariacaoPrecoShopee(precoMin = "", precoMax = "") {
    return analisarFaixaPrecoShopee(precoMin, precoMax);
  }

  function diagnosticarVariacaoPrecoShopeeLegado(precoMin = "", precoMax = "") {
    const minNumero = Number(String(precoMin || "").replace(",", "."));
    const maxNumero = Number(String(precoMax || "").replace(",", "."));
    const temMin = Number.isFinite(minNumero) && minNumero > 0;
    const temMax = Number.isFinite(maxNumero) && maxNumero > 0;

    if (!temMin || !temMax || maxNumero <= minNumero) {
      return {
        precoMin,
        precoMax: precoMax || precoMin,
        temVariacaoPreco: false,
        avisoVariacaoPreco: ""
      };
    }

    const diferenca = maxNumero - minNumero;
    const percentual = minNumero > 0 ? diferenca / minNumero : 0;
    const variacaoIrrelevante = diferenca < 1 || percentual <= 0.03;

    if (variacaoIrrelevante) {
      return {
        precoMin,
        precoMax,
        temVariacaoPreco: false,
        avisoVariacaoPreco: ""
      };
    }

    const variacaoGrande = percentual > 0.2 || diferenca >= 20;

    return {
      precoMin,
      precoMax,
      temVariacaoPreco: true,
      avisoVariacaoPreco: variacaoGrande
        ? `Variações de R$ ${precoMin} a R$ ${precoMax}`
        : `A partir de R$ ${precoMin}`
    };
  }

  function extrairFaixaPrecosHtmlShopee(precosHtml = []) {
    const numeros = precosHtml
      .map(numeroPrecoShopee)
      .filter(numero => Number.isFinite(numero) && numero > 0)
      .sort((a, b) => a - b);

    if (!numeros.length) {
      return diagnosticarVariacaoPrecoShopee("", "");
    }

    const precoMin = numeros[0].toFixed(2).replace(".", ",");
    const precoMax = numeros[numeros.length - 1].toFixed(2).replace(".", ",");
    return diagnosticarVariacaoPrecoShopee(precoMin, precoMax);
  }
  function extrairIdsShopee(link) {
    return extrairIdsShopeeNormalizado(link);
  }

  function gerarKeywordShopee(link) {
    return gerarKeywordShopeeNormalizado(link);
  }

  async function chamarShopeeGraphQL(bodyPayload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(bodyPayload);

    const baseString = `${appId}${timestamp}${payload}${secret}`;

    const sign = crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex");

    const response = await fetch(
      "https://open-api.affiliate.shopee.com.br/graphql",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${sign}`
        },
        body: payload
      }
    );

    const data = await response.json();

    console.log("[SHOPEE] SHOPEE RESPONSE:", JSON.stringify(data));

    return data;
  }

  const urlOriginalShopee = url;
  const resolucaoUrlShopee = await expandirLinkCurtoShopee(urlOriginalShopee);
  url = resolucaoUrlShopee.urlExpandida || canonicalizarUrlShopee(urlOriginalShopee);
  let cacheHtmlShopee = resolucaoUrlShopee.html || "";
  let cacheStatusHttpShopee = resolucaoUrlShopee.statusHttp ?? null;

  async function obterDadosHtmlFallbackShopee() {
    if (!cacheHtmlShopee) {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });
      cacheStatusHttpShopee = response.status;
      cacheHtmlShopee = await response.text();
      const canonicalHtml = extrairDadosHtmlShopee(cacheHtmlShopee).canonical;
      if (urlShopeeValida(canonicalHtml)) url = canonicalizarUrlShopee(canonicalHtml);
    }

    return {
      ...extrairDadosHtmlShopee(cacheHtmlShopee),
      html: cacheHtmlShopee,
      statusHttp: cacheStatusHttpShopee
    };
  }

  if (linkShopeeInvalido(url)) {
    return {
      ok: false,
      marketplace: "shopee",
      motivo: "link_shopee_invalido",
      linkOriginal: urlOriginalShopee,
      linkAfiliado: "",
      titulo: "",
      precoAtual: "",
      imagem: ""
    };
  }

  const ids = extrairIdsShopee(url);
  const keyword = gerarKeywordShopee(url);

  let produto = null;

  // 1) Tenta buscar pelo itemId do próprio link
  if (ids.itemId) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              itemId: ${ids.itemId},
              page: 1,
              limit: 10
            ) {
              nodes {
                itemId
                productName
                productLink
                offerLink
                imageUrl
                priceMin
                priceMax
                priceDiscountRate
                sales
                ratingStar
                commissionRate
                shopId
                shopName
              }
            }
          }
        `
      };

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto =
        nodes.find((p) => String(p.itemId) === String(ids.itemId)) ||
        nodes[0] ||
        null;
    } catch (e) {
      console.error("[ERRO] [SHOPEE] SHOPEE ITEMID ERRO:", e.message);
    }
  }

  // 2) Se não achou, tenta por keyword do link
  if (!produto && keyword) {
    try {
      const bodyPayload = {
        query: `
          query {
            productOfferV2(
              keyword: ${JSON.stringify(keyword)},
              listType: 0,
              sortType: 2,
              page: 1,
              limit: 20
            ) {
              nodes {
                itemId
                productName
                productLink
                offerLink
                imageUrl
                priceMin
                priceMax
                priceDiscountRate
                sales
                ratingStar
                commissionRate
                shopId
                shopName
              }
            }
          }
        `
      };

      const data = await chamarShopeeGraphQL(bodyPayload);
      const nodes = data?.data?.productOfferV2?.nodes || [];

      produto = nodes[0] || null;
    } catch (e) {
      console.error("[ERRO] [SHOPEE] SHOPEE KEYWORD ERRO:", e.message);
    }
  }

  // 3) Se a API não encontrou, fallback simples pelo HTML
  if (!produto) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      const html = await response.text();
      const dadosHtml = extrairDadosHtmlShopee(html);

console.log("[SHOPEE] SHOPEE HTML TAMANHO:", html.length);
console.log("[SHOPEE] SHOPEE HTML TEM R$:", html.includes("R$"));
console.log("[SHOPEE] SHOPEE HTML PREOS:", html.match(/R\$\s*[\d.]+,\d{2}/g)?.slice(0, 10));
console.log("[SHOPEE] SHOPEE KEYWORD:", keyword);
console.log("[SHOPEE] SHOPEE IDS:", ids);


      const titulo =
        dadosHtml.titulo ||
        extrairMeta(html, "og:title") ||
        extrairMeta(html, "twitter:title") ||
        keyword ||
        "";

      if (linkShopeeInvalido(url) || tituloShopeeInvalido(titulo)) {
        return {
          ok: false,
          marketplace: "shopee",
          motivo: "shopee_titulo_indisponivel",
          linkOriginal: urlOriginalShopee,
          linkExpandido: url,
          linkAfiliado: "",
          titulo: "",
          precoAtual: "",
          imagem: ""
        };
      }
        const imagemJsonLd = dadosHtml.imagem;
        const imagemOg = extrairMeta(html, "og:image");
        const imagemTwitter = extrairMeta(html, "twitter:image");
        const imagem =
        imagemJsonLd ||
        imagemOg ||
        imagemTwitter ||
        "";
        const origemImagem =
        imagemJsonLd ? dadosHtml.origemImagem :
        imagemOg ? "og:image" :
        imagemTwitter ? "twitter:image" :
        "nenhuma";

       console.log("[SHOPEE] SHOPEE PRODUTO RAW:", JSON.stringify(produto, null, 2));

      let cupom = "";
      let avisoCupom =
  "🎟️ Verifique se há cupons disponíveis na página";

const precosHtml = [...html.matchAll(/R\$\s*[\d.]+,\d{2}/g)]
  .map(m => m[0])
  .filter(Boolean);

const variacaoPrecoHtml = extrairFaixaPrecosHtmlShopee(precosHtml);
const precoBrutoHtml = dadosHtml.preco || precosHtml[0] || "";
const origemPrecoHtml = dadosHtml.preco ? "jsonLd.offers.price" : (precosHtml.length ? "html_regex_rs" : "html_sem_preco");
let precoAtual = normalizarPrecoWebShopee(dadosHtml.preco);

if (!precoAtual && precosHtml.length) {
  const unicos = [...new Set(precosHtml)];
  precoAtual = normalizarPrecoWebShopee(unicos[0]);
}

const precoAuditoriaHtml = criarPrecoAuditoriaShopee({
  precoBruto: precoBrutoHtml,
  precoNormalizado: precoAtual,
  origemPreco: origemPrecoHtml,
  precoOrigem: origemPrecoHtml,
  motivoEscolhaPreco: dadosHtml.preco ? "preco_jsonld_normalizado_como_valor_monetario" : "primeiro_preco_html_rs_normalizado",
  campoPrecoUsado: origemPrecoHtml,
  tipoCampoPrecoUsado: tipoPrecoShopee(precoBrutoHtml),
  precoAntesNormalizacao: precoBrutoHtml,
  precoDepoisNormalizacao: precoAtual,
  normalizadorAplicado: "normalizarPrecoWebShopee",
  precoMin: variacaoPrecoHtml.precoMin,
  precoMax: variacaoPrecoHtml.precoMax,
  precoAmbiguo: variacaoPrecoHtml.precoAmbiguo,
  faixaPreco: variacaoPrecoHtml.faixaPreco,
  variacaoComprovada: variacaoPrecoHtml.variacaoComprovada
});

if (variacaoPrecoHtml.precoAmbiguo && !dadosHtml.preco) {
  return {
    ok: false,
    marketplace: "shopee",
    motivo: "shopee_preco_variacao_ambiguo",
    linkOriginal: urlOriginalShopee,
    linkExpandido: url,
    titulo: htmlDecode(titulo).replace(" | Shopee Brasil", "").replace(" | Shopee", "").trim(),
    precoAtual: "",
    precoMin: variacaoPrecoHtml.precoMin,
    precoMax: variacaoPrecoHtml.precoMax,
    precoOrigem: origemPrecoHtml,
    precoAmbiguo: true,
    faixaPreco: variacaoPrecoHtml.faixaPreco,
    variacaoComprovada: variacaoPrecoHtml.variacaoComprovada,
    imagem: corrigirImagemUrl(imagem) || imagem,
    shopId: ids.shopId,
    itemId: ids.itemId,
    precoAuditoria: precoAuditoriaHtml
  };
}

if (!precoAtual) {
  return {
    ok: false,
    marketplace: "shopee",
    motivo: "shopee_preco_indisponivel",
    linkOriginal: urlOriginalShopee,
    linkExpandido: url,
    linkAfiliado: "",
    titulo: htmlDecode(titulo).replace(" | Shopee Brasil", "").replace(" | Shopee", "").trim(),
    precoAtual: "",
    imagem: corrigirImagemUrl(imagem) || imagem,
    shopId: ids.shopId,
    itemId: ids.itemId,
    precoAuditoria: precoAuditoriaHtml
  };
}

logPrecoOrigemShopee({
  titulo,
  origemPreco: origemPrecoHtml,
  valorBruto: precoBrutoHtml,
  valorNormalizado: precoAtual
});

console.log("[SHOPEE-IMAGEM-ORIGEM]", JSON.stringify({
  titulo: htmlDecode(titulo)
    .replace(" | Shopee Brasil", "")
    .replace(" | Shopee", "")
    .trim(),
  url,
  temImagem: Boolean(imagem),
  origemImagem,
  imagemPreview: String(corrigirImagemUrl(imagem) || imagem || "").slice(0, 140)
}));

      return {
  marketplace: "shopee",
  titulo: htmlDecode(titulo)
    .replace(" | Shopee Brasil", "")
    .replace(" | Shopee", "")
    .trim(),
  precoAntigo: "",
  precoAtual,
  precoMin: precoAtual,
  precoMax: variacaoPrecoHtml.precoMax || precoAtual,
  precoOrigem: origemPrecoHtml,
  precoAmbiguo: variacaoPrecoHtml.precoAmbiguo,
  faixaPreco: variacaoPrecoHtml.faixaPreco,
  variacaoComprovada: variacaoPrecoHtml.variacaoComprovada,
  temVariacaoPreco: variacaoPrecoHtml.temVariacaoPreco,
  avisoVariacaoPreco: variacaoPrecoHtml.avisoVariacaoPreco,
  cupom: normalizarCupomShopee(cupom),
  avisoCupom,
  linkOriginal: urlOriginalShopee,
  linkExpandido: url,
  linkAfiliado: url,
  imagem: corrigirImagemUrl(imagem) || imagem,
  imagemOrigem: origemImagem,
  categoria: "Shopee",
  shopId: ids.shopId,
  itemId: ids.itemId,
  produtoId: ids.shopId && ids.itemId ? `${ids.shopId}/${ids.itemId}` : "",
  statusHttp: response.status,
  motivoFalha: imagem ? "" : "shopee_imagem_indisponivel",
  precoAuditoria: precoAuditoriaHtml
};
  } catch (e) {
   console.error("[ERRO] [SHOPEE] SHOPEE HTML ERRO:", e.message);
    }
  }

 let dadosHtmlApi = {};
 const precisaHtmlApi = !tituloShopeeValido(produto?.productName || "") || !produto?.priceMin || !produto?.imageUrl;
 if (precisaHtmlApi) {
   try {
     dadosHtmlApi = await obterDadosHtmlFallbackShopee();
   } catch (e) {
     console.log("[SHOPEE] FALLBACK HTML API FALHOU:", e.message);
   }
 }

 const tituloFinalApi = tituloShopeeValido(produto?.productName || "")
   ? produto.productName
   : (tituloShopeeValido(dadosHtmlApi.titulo || "") ? dadosHtmlApi.titulo : "");
 if (!tituloFinalApi) {
   return {
     ok: false,
     marketplace: "shopee",
     motivo: "shopee_titulo_indisponivel",
     linkOriginal: urlOriginalShopee,
     linkExpandido: url,
     titulo: "",
     precoAtual: "",
     imagem: dadosHtmlApi.imagem || "",
     shopId: ids.shopId || produto?.shopId || "",
     itemId: ids.itemId || produto?.itemId || ""
   };
 }

 const precoApiBruto = produto?.priceMin || "";
 const precoHtmlFallbackBruto = dadosHtmlApi.preco || "";
 const precoMin = formatarPrecoApiShopee(precoApiBruto) || normalizarPrecoWebShopee(precoHtmlFallbackBruto);

console.log("[SHOPEE] SHOPEE PRODUTO API FINAL:", JSON.stringify(produto, null, 2));

const precoMax = formatarPrecoApiShopee(produto?.priceMax || "") || precoMin;

let precoAtual = "";
let precoAntigo = "";

const minNumero = Number(String(precoMin).replace(",", "."));
const maxNumero = Number(String(precoMax).replace(",", "."));

const temMin = Number.isFinite(minNumero) && minNumero > 0;
const temMax = Number.isFinite(maxNumero) && maxNumero > 0;

const variacaoPreco = diagnosticarVariacaoPrecoShopee(precoMin, precoMax);
let precoOrigemFinal = precoApiBruto ? "api_productOfferV2.priceMin" : "html_fallback";

if (variacaoPreco.precoAmbiguo) {
  if (!dadosHtmlApi.preco) {
    try {
      dadosHtmlApi = await obterDadosHtmlFallbackShopee();
    } catch (e) {
      console.log("[SHOPEE] FALLBACK HTML PRECO AMBIGUO FALHOU:", e.message);
    }
  }

  const precoHtmlEstruturado = normalizarPrecoWebShopee(dadosHtmlApi.preco || "");
  const precoTextoRadar = normalizarPrecoWebShopee(extrairPrecoTextoRadarShopee());

  if (precoHtmlEstruturado) {
    precoAtual = precoHtmlEstruturado;
    precoOrigemFinal = "html_jsonld_estruturado";
  } else if (precoTextoRadar) {
    precoAtual = precoTextoRadar;
    precoOrigemFinal = "texto_radar_preco_unico_claro";
  } else {
    return {
      ok: false,
      marketplace: "shopee",
      motivo: "shopee_preco_variacao_ambiguo",
      linkOriginal: urlOriginalShopee,
      linkExpandido: url,
      titulo: tituloFinalApi,
      precoAtual: "",
      precoMin: variacaoPreco.precoMin,
      precoMax: variacaoPreco.precoMax,
      precoOrigem: "api_productOfferV2.priceMin_priceMax",
      precoAmbiguo: true,
      faixaPreco: variacaoPreco.faixaPreco,
      variacaoComprovada: variacaoPreco.variacaoComprovada,
      imagem: produto?.imageUrl || dadosHtmlApi.imagem || "",
      shopId: ids.shopId || produto?.shopId || "",
      itemId: ids.itemId || produto?.itemId || "",
      precoAuditoria: criarPrecoAuditoriaShopee({
        precoApi: precoApiBruto,
        precoBruto: precoApiBruto || precoHtmlFallbackBruto,
        precoNormalizado: "",
        origemPreco: "api_productOfferV2.priceMin_priceMax",
        precoOrigem: "api_productOfferV2.priceMin_priceMax",
        motivoEscolhaPreco: "priceMin_priceMax_variacao_ambigua_sem_fonte_alternativa",
        campoPrecoUsado: "productOfferV2.priceMin/productOfferV2.priceMax",
        tipoCampoPrecoUsado: tipoPrecoShopee(precoApiBruto || precoHtmlFallbackBruto),
        precoAntesNormalizacao: JSON.stringify({ priceMin: produto?.priceMin || "", priceMax: produto?.priceMax || "" }),
        precoDepoisNormalizacao: "",
        normalizadorAplicado: "analisarFaixaPrecoShopee",
        precoMin: variacaoPreco.precoMin,
        precoMax: variacaoPreco.precoMax,
        precoAmbiguo: true,
        faixaPreco: variacaoPreco.faixaPreco,
        variacaoComprovada: variacaoPreco.variacaoComprovada
      })
    };
  }
} else if (temMin && temMax && minNumero !== maxNumero) {
  precoAtual = precoMin;

  // Produto com variação: não inventa preço antigo automático
  precoAntigo = "";
} else {
  precoAtual = precoMin || precoMax || "";

  // Shopee não retorna preço antigo real nesse endpoint.
  // Não calcular "De" automaticamente para evitar desconto inflado.
  precoAntigo = "";
}

if (!precoAtual) {
  return {
    ok: false,
    marketplace: "shopee",
    motivo: "shopee_preco_indisponivel",
    linkOriginal: urlOriginalShopee,
    linkExpandido: url,
    titulo: tituloFinalApi,
    precoAtual: "",
    imagem: produto?.imageUrl || dadosHtmlApi.imagem || "",
    shopId: ids.shopId || produto?.shopId || "",
    itemId: ids.itemId || produto?.itemId || ""
  };
}

const pixComprovado = resolverPrecoPixComprovadoShopee(
  precoAtual,
  produto?.precoPix || produto?.pricePix || produto?.pixPrice || dadosHtmlApi.precoPix || ""
);

const precoAuditoriaApi = criarPrecoAuditoriaShopee({
  precoApi: precoApiBruto,
  precoBruto: precoApiBruto || precoHtmlFallbackBruto,
  precoNormalizado: precoAtual,
  origemPreco: precoOrigemFinal,
  precoOrigem: precoOrigemFinal,
  motivoEscolhaPreco: variacaoPreco.precoAmbiguo
    ? `priceMin_priceMax_ambiguo_usou_${precoOrigemFinal}`
    : precoApiBruto
    ? motivoNormalizacaoPrecoApiShopee(precoApiBruto)
    : "api_sem_preco_usou_fallback_html",
  campoPrecoUsado: precoOrigemFinal,
  tipoCampoPrecoUsado: tipoPrecoShopee(precoApiBruto || precoHtmlFallbackBruto),
  precoAntesNormalizacao: precoApiBruto || precoHtmlFallbackBruto,
  precoDepoisNormalizacao: precoAtual,
  normalizadorAplicado: precoOrigemFinal === "api_productOfferV2.priceMin" ? "normalizarPrecoApiShopee" : "normalizarPrecoWebShopee",
  precoMin: variacaoPreco.precoMin,
  precoMax: variacaoPreco.precoMax,
  precoPix: pixComprovado.precoPix,
  precoAmbiguo: variacaoPreco.precoAmbiguo,
  faixaPreco: variacaoPreco.faixaPreco,
  variacaoComprovada: variacaoPreco.variacaoComprovada
});

logPrecoOrigemShopee({
  titulo: tituloFinalApi,
  origemPreco: produto ? "api_productOfferV2_priceMin_priceMax" : "api_sem_produto",
  valorBruto: produto ? JSON.stringify({ priceMin: produto?.priceMin || "", priceMax: produto?.priceMax || "" }) : "",
  valorNormalizado: precoAtual
});

  let imagem = produto?.imageUrl || dadosHtmlApi.imagem || "";
  const origemImagemApi = produto?.imageUrl ? "api_productOfferV2.imageUrl" : (dadosHtmlApi.origemImagem || "nenhuma");
  imagem = htmlDecode(imagem).replace(/\\u002F/g, "/");

  if (imagem && imagem.startsWith("//")) {
    imagem = "https:" + imagem;
  }

  if (linkShopeeInvalido(produto?.offerLink || produto?.productLink || "") || !tituloShopeeValido(tituloFinalApi)) {
    return {
      ok: false,
      marketplace: "shopee",
      motivo: "shopee_titulo_indisponivel",
      linkOriginal: urlOriginalShopee,
      linkExpandido: url,
      linkAfiliado: "",
      titulo: "",
      precoAtual: "",
      imagem: ""
    };
  }

  console.log("[SHOPEE-IMAGEM-ORIGEM]", JSON.stringify({
    titulo: htmlDecode(tituloFinalApi)
      .replace(" | Shopee Brasil", "")
      .replace(" | Shopee", "")
      .trim(),
    url,
    temImagem: Boolean(imagem),
    origemImagem: origemImagemApi,
    imagemPreview: String(corrigirImagemUrl(imagem) || imagem || "").slice(0, 140)
  }));

  return {
    marketplace: "shopee",
    titulo: htmlDecode(tituloFinalApi)
      .replace(" | Shopee Brasil", "")
      .replace(" | Shopee", "")
      .trim(),
    precoAntigo,
    precoAtual,
    precoMin: variacaoPreco.precoMin,
    precoMax: variacaoPreco.precoMax,
    precoPix: pixComprovado.precoPix,
    descontoPix: pixComprovado.descontoPix,
    valorEfetivo: pixComprovado.valorEfetivo,
    valorEfetivoOrigem: pixComprovado.valorEfetivoOrigem,
    precoOrigem: precoOrigemFinal,
    precoAmbiguo: variacaoPreco.precoAmbiguo,
    faixaPreco: variacaoPreco.faixaPreco,
    variacaoComprovada: variacaoPreco.variacaoComprovada,
    temVariacaoPreco: variacaoPreco.temVariacaoPreco,
    avisoVariacaoPreco: variacaoPreco.avisoVariacaoPreco,
    cupom: normalizarCupomShopee(""),
    linkOriginal: urlOriginalShopee,
    linkExpandido: url,
    linkAfiliado: produto?.offerLink || produto?.productLink || url,
    imagem: corrigirImagemUrl(imagem) || imagem,
    imagemOrigem: origemImagemApi,
    categoria: "Shopee",
    shopId: ids.shopId || produto?.shopId || "",
    itemId: ids.itemId || produto?.itemId || "",
    produtoId: (ids.shopId || produto?.shopId) && (ids.itemId || produto?.itemId)
      ? `${ids.shopId || produto.shopId}/${ids.itemId || produto.itemId}`
      : "",
  statusHttp: dadosHtmlApi.statusHttp ?? resolucaoUrlShopee.statusHttp ?? null,
  motivoFalha: imagem ? "" : "shopee_imagem_indisponivel",
  precoAuditoria: precoAuditoriaApi
  };
 };

}

module.exports = {
  criarImportarShopee,
  normalizarPrecoApiShopee,
  analisarFaixaPrecoShopee,
  resolverPrecoPixComprovadoShopee
};
