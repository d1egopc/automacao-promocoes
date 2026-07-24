const crypto = require("crypto");
const { normalizarPrecoTextoBR } = require("../../utils/moeda");
const {
  buscarProdutosAliExpressAPI,
  gerarLinkCurtoAliExpress: gerarLinkCurtoAliExpressApi
} = require("./api");

// ================= IMPORTADOR API ALIEXPRESS =================

async function importarAliExpressLegado(urlEntrada, config = {}) {
  try {
    if (urlEntrada && !urlEntrada.startsWith("http")) {
      urlEntrada = "https://" + urlEntrada;
    }

    const ehBrasil =
      String(urlEntrada).includes("ship_from%22%3A%22BR") ||
      String(urlEntrada).includes('"ship_from":"BR"') ||
      String(urlEntrada).includes("%22ship_from%22%3A%22BR%22");

    const productId =
      String(urlEntrada).match(/\/item\/(\d+)\.html/i)?.[1] ||
      String(urlEntrada).match(/[?&]productId=(\d+)/i)?.[1];

    if (!productId) {
      throw new Error("Product ID não encontrado no link AliExpress");
    }

    const credenciais = config?.credenciais || config || {};
    const appKey = credenciais.appKey || "";
    const secret = credenciais.secret || credenciais.appSecret || "";
    const trackingId = credenciais.trackingId || "";

    if (!appKey || !secret || !trackingId) {
      throw new Error("Credenciais AliExpress incompletas");
    }

    const params = {
      method: "aliexpress.affiliate.productdetail.get",
      app_key: appKey,
      timestamp: timestampGMT8(),
      sign_method: "md5",
      format: "json",
      v: "2.0",
      product_ids: productId,
      fields: "product_title,product_main_image_url,product_small_image_urls,target_sale_price,sale_price,target_app_sale_price,app_sale_price,target_min_sale_price,min_sale_price,target_original_price,original_price,discount,promotion_link,promotion_link_short,product_detail_url,product_url,first_level_category_name,second_level_category_name",
      target_currency: "BRL",
      target_language: "PT",
      ship_to_country: "BR",
      tracking_id: trackingId
    };

    params.sign = assinar(params, secret);

    const response = await fetch("https://api-sg.aliexpress.com/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: new URLSearchParams(params)
    });

    const data = await response.json();

    console.log("[INFO] ALIEXPRESS API RESPONSE:", JSON.stringify(data));

    const result =
      data?.aliexpress_affiliate_productdetail_get_response?.resp_result?.result ||
      data?.resp_result?.result ||
      data?.result ||
      {};

    const listaProdutos = [];
    const adicionarProduto = valor => {
      if (Array.isArray(valor)) {
        for (const item of valor) adicionarProduto(item);
        return;
      }
      if (valor && typeof valor === "object") listaProdutos.push(valor);
    };

    adicionarProduto(result?.products?.product);
    adicionarProduto(result?.products);
    adicionarProduto(result?.product);

    const produto = listaProdutos.find(item => item && typeof item === "object" && !Array.isArray(item)) || {};

    const avisoCupom = ehBrasil
      ? "🇧🇷 Produto no Brasil. Confira cupom ou desconto com moedas na página."
      : "🌍 Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na página.";

    if (!produto || Object.keys(produto).length === 0) {
      return {
        marketplace: "aliexpress",
        titulo: "Produto AliExpress",
        precoAntigo: "",
        precoAtual: "",
        cupom: "",
        linkOriginal: urlEntrada,
        linkAfiliado: urlEntrada,
        imagem: "",
        categoria: "AliExpress",
        avisoCupom,
        aviso: "AliExpress não retornou dados pela API."
      };
    }

    let titulo =
      produto.product_title ||
      produto.title ||
      produto.productTitle ||
      "Produto AliExpress";

let imagem =
  produto.product_main_image_url ||
  produto.product_small_image_urls?.string?.[0] ||
  produto.product_small_image_urls?.string ||
  produto.product_small_image_urls?.[0] ||
  produto.image_url ||
  produto.product_image ||
  "";

    let precoAtual =
  produto.sale_price ||
  produto.target_sale_price ||
  produto.app_sale_price ||
  produto.target_app_sale_price ||
  produto.target_min_sale_price ||
  produto.min_sale_price ||
  produto.target_sale_price_min ||
  "";

    let precoAntigo =
      produto.target_original_price ||
      produto.original_price ||
      "";

    precoAtual = limparPreco(precoAtual);
    precoAntigo = limparPreco(precoAntigo);

    if (precoAntigo === precoAtual) {
      precoAntigo = "";
    }

    let linkAfiliado =
      produto.promotion_link ||
      produto.promotion_link_short ||
      produto.product_detail_url ||
      produto.product_url ||
      urlEntrada;

    if (String(linkAfiliado).includes("s.click.aliexpress.com/s/")) {
      const match = String(linkAfiliado).match(
        /https:\/\/s\.click\.aliexpress\.com\/e\/_[a-zA-Z0-9]+/i
      );

      if (match?.[0]) {
        linkAfiliado = match[0];
      }
    }


console.log("[INFO] ALIEXPRESS PRODUTO FINAL:", {
  titulo,
  precoAtual,
  precoAntigo,
  imagem,
  camposPreco: {
    sale_price: produto.sale_price,
    target_sale_price: produto.target_sale_price,
    app_sale_price: produto.app_sale_price,
    target_app_sale_price: produto.target_app_sale_price,
    target_min_sale_price: produto.target_min_sale_price,
    min_sale_price: produto.min_sale_price,
    target_original_price: produto.target_original_price,
    original_price: produto.original_price
  }
});

    return {
      marketplace: "aliexpress",
      titulo: htmlDecode(titulo),
      precoAntigo,
      precoAtual,
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado,
      imagem: corrigirImagemUrl(imagem),
      categoria:
        produto.first_level_category_name ||
        produto.second_level_category_name ||
        "AliExpress",
      categoriaProduto:
        produto.first_level_category_name ||
        produto.second_level_category_name ||
        "AliExpress",
      avisoCupom,
      aviso: !imagem || titulo === "Produto AliExpress"
        ? "Dados parciais retornados pela API AliExpress."
        : ""
    };

  } catch (e) {
    console.log("[API] ERRO IMPORTAR ALIEXPRESS:", e.message);

    return {
      marketplace: "aliexpress",
      titulo: "Produto AliExpress",
      precoAntigo: "",
      precoAtual: "",
      cupom: "",
      linkOriginal: urlEntrada,
      linkAfiliado: urlEntrada,
      imagem: "",
      categoria: "AliExpress",
      aviso: "Erro ao consultar API AliExpress"
    };
  }
}

function timestampGMT8() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function assinar(params, appSecret) {
  const sortedKeys = Object.keys(params).sort();
  let base = appSecret;

  for (const key of sortedKeys) {
    if (key === "sign") continue;
    base += key + params[key];
  }

  base += appSecret;

  return crypto
    .createHash("md5")
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

function limparPreco(valor) {
  return normalizarPrecoTextoBR(valor);
}

function htmlDecode(str = "") {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function corrigirImagemUrl(url = "") {
  if (!url) return "";
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

function extrairProductIdAliExpressManual(urlEntrada = "") {
  const urlTexto = String(urlEntrada || "");
  const candidatos = [
    urlTexto.match(/\/item\/(\d+)\.html/i)?.[1],
    urlTexto.match(/[?&](?:productId|product_id|itemId|item_id)=(\d+)/i)?.[1],
    urlTexto.match(/\b(1005\d{8,})\b/)?.[1]
  ].filter(Boolean);

  if (candidatos.length) return candidatos[0];

  try {
    const decodificada = decodeURIComponent(urlTexto);
    return decodificada.match(/\/item\/(\d+)\.html/i)?.[1] ||
      decodificada.match(/[?&](?:productId|product_id|itemId|item_id)=(\d+)/i)?.[1] ||
      decodificada.match(/\b(1005\d{8,})\b/)?.[1] ||
      "";
  } catch {
    return "";
  }
}

function listaAliExpress(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  return [valor];
}

function primeiroCampoAliExpress(objeto = {}, campos = []) {
  for (const campo of campos) {
    const valor = campo.split(".").reduce((atual, chave) => atual?.[chave], objeto);
    if (Array.isArray(valor) && valor.length) return valor[0];
    if (valor && typeof valor === "object" && Array.isArray(valor.string) && valor.string.length) return valor.string[0];
    if (valor && typeof valor === "object" && typeof valor.string === "string") return valor.string;
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") return valor;
  }

  return "";
}

function extrairProdutosAliExpressResposta(data = {}) {
  const resposta = data?.aliexpress_affiliate_productdetail_get_response || data || {};
  const respResult = resposta?.resp_result || data?.resp_result || {};
  const result = respResult?.result || resposta?.result || data?.result || {};
  const produtos = result?.products || result?.product || data?.products || data?.product || {};
  return [
    ...listaAliExpress(produtos?.product),
    ...listaAliExpress(produtos),
    ...listaAliExpress(result?.products?.product),
    ...listaAliExpress(result?.products),
    ...listaAliExpress(result?.product)
  ].filter(item => item && typeof item === "object" && !Array.isArray(item));
}

function produtoAliExpressTemCamposEssenciais(produto = {}) {
  return Boolean(
    primeiroCampoAliExpress(produto, ["product_title", "title", "productTitle", "product_subject"]) &&
    primeiroCampoAliExpress(produto, ["target_sale_price", "sale_price", "target_app_sale_price", "app_sale_price", "target_min_sale_price", "min_sale_price"]) &&
    primeiroCampoAliExpress(produto, ["product_main_image_url", "product_small_image_urls", "product_small_image_urls.string", "image_url"]) &&
    primeiroCampoAliExpress(produto, ["promotion_link", "promotion_link_short", "product_detail_url", "product_url", "target_sale_url"])
  );
}

function extrairProductIdAliExpressProduto(produto = {}, campo = "") {
  if (campo === "productId") {
    return String(
      produto.product_id ||
      produto.productId ||
      produto.item_id ||
      produto.itemId ||
      ""
    ).trim();
  }

  return extrairProductIdAliExpressManual(
    primeiroCampoAliExpress(produto, [campo])
  );
}

function selecionarProdutoAliExpressPorId(produtos = [], productId = "") {
  const campos = [
    "productId",
    "product_detail_url",
    "product_url",
    "promotion_link",
    "promotion_link_short"
  ];

  for (const campo of campos) {
    const produto = produtos.find(item => extrairProductIdAliExpressProduto(item, campo) === productId);
    if (produto) {
      return {
        produto,
        campo
      };
    }
  }

  return {
    produto: null,
    campo: ""
  };
}

function limparLinkAfiliadoAliExpress(link = "") {
  let linkAfiliado = String(link || "").trim();
  if (linkAfiliado.includes("s.click.aliexpress.com/s/")) {
    const match = linkAfiliado.match(/https:\/\/s\.click\.aliexpress\.com\/e\/_[a-zA-Z0-9]+/i);
    if (match?.[0]) linkAfiliado = match[0];
  }
  return linkAfiliado;
}

function montarProdutoAliExpressManual(produto = {}, urlEntrada = "", avisoCupom = "", linkAfiliado = "") {
  const titulo = primeiroCampoAliExpress(produto, ["product_title", "title", "productTitle", "product_subject"]) || "Produto AliExpress";
  const imagem = primeiroCampoAliExpress(produto, [
    "product_main_image_url",
    "product_small_image_urls.string",
    "product_small_image_urls",
    "image_url",
    "product_image"
  ]);
  let precoAtual = primeiroCampoAliExpress(produto, [
    "target_sale_price",
    "sale_price",
    "target_app_sale_price",
    "app_sale_price",
    "target_min_sale_price",
    "min_sale_price",
    "target_sale_price_min"
  ]);
  let precoAntigo = primeiroCampoAliExpress(produto, [
    "target_original_price",
    "original_price",
    "product_original_price"
  ]);

  precoAtual = limparPreco(precoAtual);
  precoAntigo = limparPreco(precoAntigo);

  if (precoAntigo === precoAtual) precoAntigo = "";

  return {
    marketplace: "aliexpress",
    titulo: htmlDecode(titulo),
    precoAntigo,
    precoAtual,
    cupom: "",
    linkOriginal: urlEntrada,
    linkAfiliado,
    imagem: corrigirImagemUrl(imagem),
    categoria: primeiroCampoAliExpress(produto, ["first_level_category_name", "second_level_category_name"]) || "AliExpress",
    categoriaProduto: primeiroCampoAliExpress(produto, ["first_level_category_name", "second_level_category_name"]) || "AliExpress",
    desconto: primeiroCampoAliExpress(produto, ["discount", "discount_rate", "evaluate_rate"]) || "",
    avisoCupom,
    aviso: !imagem || titulo === "Produto AliExpress"
      ? "Dados parciais retornados pela API AliExpress."
      : ""
  };
}

function produtoAliExpressGenerico(urlEntrada = "", aviso = "Erro ao consultar API AliExpress", extras = {}) {
  console.log("[ALIEXPRESS-MANUAL-FALLBACK-GENERICO]", {
    productId: extras.productId || "",
    motivo: extras.motivo || aviso
  });

  return {
    marketplace: "aliexpress",
    titulo: "Produto AliExpress",
    precoAntigo: "",
    precoAtual: "",
    cupom: "",
    linkOriginal: urlEntrada,
    linkAfiliado: extras.linkAfiliado || urlEntrada,
    imagem: "",
    categoria: "AliExpress",
    aviso,
    erroTecnico: extras.erroTecnico || "aliexpress_manual_fallback_generico",
    motivoErroAliExpress: extras.motivo || ""
  };
}

async function consultarDetalheAliExpress(productId, credenciais = {}) {
  const params = {
    method: "aliexpress.affiliate.productdetail.get",
    app_key: credenciais.appKey || "",
    timestamp: timestampGMT8(),
    sign_method: "md5",
    format: "json",
    v: "2.0",
    product_ids: productId,
    fields: "product_title,product_main_image_url,product_small_image_urls,target_sale_price,sale_price,target_app_sale_price,app_sale_price,target_min_sale_price,min_sale_price,target_original_price,original_price,discount,promotion_link,promotion_link_short,product_detail_url,product_url,first_level_category_name,second_level_category_name",
    target_currency: "BRL",
    target_language: "PT",
    ship_to_country: "BR",
    tracking_id: credenciais.trackingId || ""
  };

  params.sign = assinar(params, credenciais.secret || credenciais.appSecret || "");

  const response = await fetch("https://api-sg.aliexpress.com/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body: new URLSearchParams(params)
  });

  const data = await response.json();
  const respostaApi = data?.aliexpress_affiliate_productdetail_get_response || data || {};
  const erroApi = data?.error_response || respostaApi?.error_response || null;
  const respResult = respostaApi?.resp_result || data?.resp_result || {};
  const codigoApi = erroApi?.code || respResult?.resp_code || respostaApi?.code || "";
  const mensagemApi = erroApi?.msg || erroApi?.sub_msg || respResult?.resp_msg || respostaApi?.msg || "";

  if (!response.ok || erroApi || (codigoApi && !["200", "20010000"].includes(String(codigoApi)))) {
    const erro = new Error(mensagemApi || "AliExpress API retornou erro");
    erro.status = response.status;
    erro.codigo = codigoApi || "api_erro";
    throw erro;
  }

  const produtos = extrairProdutosAliExpressResposta(data);
  return produtos[0] || {};
}

async function buscarProdutoAliExpressPorQuery(productId, credenciais = {}) {
  const produtos = await buscarProdutosAliExpressAPI(productId, credenciais, {
    page: 1,
    limit: 20
  });
  const match = selecionarProdutoAliExpressPorId(produtos, productId);

  console.log("[ALIEXPRESS-QUERY-MATCH]", {
    productId,
    total: produtos.length,
    encontrou: Boolean(match.produto),
    campo: match.campo || ""
  });

  return match.produto;
}

async function importarAliExpress(urlEntrada, config = {}) {
  let urlOriginal = String(urlEntrada || "").trim();
  if (urlOriginal && !urlOriginal.startsWith("http")) {
    urlOriginal = "https://" + urlOriginal;
  }

  const credenciais = config?.credenciais || config || {};
  const appKey = credenciais.appKey || "";
  const secret = credenciais.secret || credenciais.appSecret || "";
  const trackingId = credenciais.trackingId || "";
  const clienteId = config?.clienteId || config?.cliente || "";
  const productId = extrairProductIdAliExpressManual(urlOriginal);
  const ehBrasil =
    urlOriginal.includes("ship_from%22%3A%22BR") ||
    urlOriginal.includes('"ship_from":"BR"') ||
    urlOriginal.includes("%22ship_from%22%3A%22BR%22");
  const avisoCupom = ehBrasil
    ? "Produto no Brasil. Confira cupom ou desconto com moedas na pagina."
    : "Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na pagina.";

  console.log("[ALIEXPRESS-MANUAL-INICIO]", {
    clienteId,
    temUrl: Boolean(urlOriginal)
  });
  console.log("[ALIEXPRESS-PRODUCT-ID]", {
    clienteId,
    productId: productId || "",
    encontrado: Boolean(productId)
  });

  if (!productId) {
    return produtoAliExpressGenerico(urlOriginal, "Erro ao consultar API AliExpress", {
      motivo: "product_id_ausente"
    });
  }

  if (!appKey || !secret || !trackingId) {
    return produtoAliExpressGenerico(urlOriginal, "Erro ao consultar API AliExpress", {
      productId,
      motivo: "credenciais_incompletas"
    });
  }

  let produto = {};
  let origemProduto = "";
  let detalheErro = "";

  try {
    produto = await consultarDetalheAliExpress(productId, credenciais);
    origemProduto = "productdetail";
  } catch (erro) {
    detalheErro = erro.message || "erro_productdetail";
  }

  console.log("[ALIEXPRESS-DETAIL-RESULTADO]", {
    productId,
    sucesso: Boolean(produto && Object.keys(produto).length),
    temCamposEssenciais: produtoAliExpressTemCamposEssenciais(produto),
    motivo: detalheErro
  });

  if (!produtoAliExpressTemCamposEssenciais(produto)) {
    console.log("[ALIEXPRESS-QUERY-FALLBACK]", {
      productId,
      motivo: detalheErro || "campos_essenciais_ausentes"
    });

    try {
      const produtoQuery = await buscarProdutoAliExpressPorQuery(productId, credenciais);
      if (produtoQuery) {
        produto = produtoQuery;
        origemProduto = "product_query";
      }
    } catch (erroQuery) {
      console.log("[ALIEXPRESS-QUERY-FALLBACK]", {
        productId,
        erro: erroQuery.message || "erro_query"
      });
    }
  }

  if (!produtoAliExpressTemCamposEssenciais(produto)) {
    return produtoAliExpressGenerico(urlOriginal, "Erro ao consultar API AliExpress", {
      productId,
      motivo: "produto_sem_campos_essenciais"
    });
  }

  const linkOriginalAfiliado = primeiroCampoAliExpress(produto, [
    "promotion_link_short",
    "promotion_link",
    "product_detail_url",
    "product_url",
    "target_sale_url"
  ]) || urlOriginal;
  const linkAfiliadoBase = limparLinkAfiliadoAliExpress(linkOriginalAfiliado);
  const gerarLinkCurto = typeof config.gerarLinkCurtoAliExpress === "function"
    ? config.gerarLinkCurtoAliExpress
    : gerarLinkCurtoAliExpressApi;
  const aplicarLinkOptimus = typeof config.gerarLinkOptimus === "function"
    ? config.gerarLinkOptimus
    : (link) => link;
  const linkAliCurto = await gerarLinkCurto(linkAfiliadoBase, credenciais);
  const linkFinal = aplicarLinkOptimus(linkAliCurto || linkAfiliadoBase, "aliexpress", { clienteId });

  console.log("[ALIEXPRESS-DEEPLINK]", {
    productId,
    origemProduto,
    deeplinkGerado: Boolean(linkAliCurto && linkAliCurto !== linkAfiliadoBase),
    linkOptimusAplicado: Boolean(linkFinal && linkFinal !== (linkAliCurto || linkAfiliadoBase))
  });

  return montarProdutoAliExpressManual(produto, urlOriginal, avisoCupom, linkFinal || linkAliCurto || linkAfiliadoBase);
}

module.exports = {
  importarAliExpress,
  extrairProductIdAliExpressManual,
  selecionarProdutoAliExpressPorId
};
