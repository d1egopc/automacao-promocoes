const crypto = require("crypto");

const MENSAGENS = {
  ok: "Integração válida.",
  cookie_expirado: "Cookies expirados. Atualize os cookies e teste novamente.",
  cookie_ausente: "Cookies ausentes.",
  tag_ausente: "Tag ID ausente.",
  credencial_ausente: "Credenciais ausentes.",
  credencial_invalida: "Credenciais inválidas.",
  bloqueio_ml: "Mercado Livre bloqueou a validação. Tente novamente mais tarde.",
  falha_teste: "Não conseguimos validar a integração agora.",
  teste_nao_implementado: "Teste real ainda não implementado para este marketplace.",
  marketplace_nao_suportado: "Marketplace não suportado para teste de integração."
};

function normalizarMarketplace(marketplace = "") {
  const valor = String(marketplace || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  const aliases = {
    ml: "mercadolivre",
    meli: "mercadolivre",
    mercadolivrebr: "mercadolivre",
    mercadolivre: "mercadolivre",
    mercadoLivre: "mercadolivre",
    amazonbr: "amazon",
    amazon: "amazon",
    shopee: "shopee",
    awin: "awin",
    feedawin: "awin",
    kabum: "kabum",
    feedkabum: "kabum",
    ali: "aliexpress",
    aliexpress: "aliexpress",
    aliexpressbr: "aliexpress"
  };

  return aliases[valor] || valor;
}

function resultado(marketplace, status, detalhes = {}, ok = false, mensagem = "") {
  const codigo = String(status || "falha_teste");
  return {
    ok: ok === true,
    marketplace: normalizarMarketplace(marketplace),
    status: codigo,
    codigo,
    mensagem: mensagem || MENSAGENS[codigo] || MENSAGENS.falha_teste,
    detalhes: detalhes || {},
    testadoEm: new Date().toISOString()
  };
}

function credenciais(config = {}) {
  return config?.credenciais || config || {};
}

function valorTexto(obj = {}, campos = []) {
  for (const campo of campos) {
    const valor = obj?.[campo];
    if (valor !== undefined && valor !== null && String(valor).trim()) {
      return String(valor).trim();
    }
  }
  return "";
}

function tagMercadoLivre(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, [
    "tag",
    "tagId",
    "tagID",
    "tag_id",
    "codigoAfiliado",
    "trackingId",
    "partnerTag",
    "affiliateTag"
  ]);
}

function tagAmazon(config = {}) {
  const c = credenciais(config);
  return valorTexto(c, [
    "trackingId",
    "partnerTag",
    "tag",
    "tagId",
    "affiliateTag",
    "appId"
  ]);
}

function extrairCsrfMercadoLivre(html = "") {
  const texto = String(html || "");
  const patterns = [
    /name=["']_csrf["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']_csrf["']/i,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
    /_csrf["']?\s*[:=]\s*["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function textoBloqueioMl(texto = "") {
  const lower = String(texto || "").toLowerCase();
  return (
    lower.includes("suspicious-traffic") ||
    lower.includes("account-verification") ||
    lower.includes("captcha") ||
    lower.includes("verificacao") ||
    lower.includes("verificacion")
  );
}

async function testarMercadoLivre(config = {}) {
  const c = credenciais(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const tagId = tagMercadoLivre(config);
  const urlTeste = valorTexto(c, ["urlTeste", "linkTeste"]) || "https://www.mercadolivre.com.br/ofertas";

  if (!tagId) return resultado("mercadolivre", "tag_ausente", { faltandoTag: true }, false);
  if (!cookies) return resultado("mercadolivre", "cookie_ausente", { faltandoCookies: true }, false);

  try {
    const response = await fetch("https://www.mercadolivre.com.br/afiliados/linkbuilder", {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Cookie: cookies
      }
    });

    const html = await response.text().catch(() => "");
    const urlFinal = response.url || "";
    const diagnostico = `${urlFinal}\n${html}`;

    if (textoBloqueioMl(diagnostico)) {
      return resultado("mercadolivre", "bloqueio_ml", { httpStatus: response.status, urlFinal }, false);
    }

    if ([401, 403, 419].includes(Number(response.status)) || !response.ok) {
      return resultado("mercadolivre", "cookie_expirado", { httpStatus: response.status, urlFinal }, false);
    }

    const csrf = extrairCsrfMercadoLivre(html);
    if (!csrf) {
      return resultado("mercadolivre", "cookie_expirado", {
        motivo: "csrf_nao_encontrado",
        httpStatus: response.status,
        urlFinal
      }, false);
    }

    const conversao = await fetch("https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Origin: "https://www.mercadolivre.com.br",
        Referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
        Cookie: cookies,
        "x-csrf-token": csrf
      },
      body: JSON.stringify({ url: urlTeste, tag: tagId })
    });

    const data = await conversao.json().catch(() => null);
    const linkAfiliado = valorTexto(data || {}, ["short_url", "shortUrl", "url"]);

    if ([401, 403, 419].includes(Number(conversao.status))) {
      return resultado("mercadolivre", "cookie_expirado", { httpStatus: conversao.status }, false);
    }

    if (!conversao.ok || !/^https?:\/\/meli\.la\//i.test(linkAfiliado)) {
      return resultado("mercadolivre", "falha_teste", {
        httpStatus: conversao.status,
        linkAfiliado: linkAfiliado || null
      }, false);
    }

    return resultado("mercadolivre", "ok", { linkAfiliado }, true);
  } catch (e) {
    return resultado("mercadolivre", "falha_teste", { erro: e.message }, false);
  }
}

async function testarAmazon(config = {}) {
  const c = credenciais(config);
  const modo = String(config?.modo || c.modo || "cookies").toLowerCase();
  const tagId = tagAmazon(config);
  const cookies = valorTexto(c, ["cookies", "cookie"]);
  const asin = valorTexto(c, ["asinTeste", "asin"]) || "B07PGL2ZSL";

  if (!tagId) return resultado("amazon", "tag_ausente", { faltandoTag: true, modo }, false);

  if (modo === "api") {
    const accessKey = valorTexto(c, ["accessKey", "access_key"]);
    const secretKey = valorTexto(c, ["secretKey", "secret_key"]);
    if (!accessKey || !secretKey) {
      return resultado("amazon", "credencial_ausente", {
        modo,
        faltandoAccessKey: !accessKey,
        faltandoSecretKey: !secretKey
      }, false);
    }

    return resultado("amazon", "teste_nao_implementado", { modo }, false);
  }

  if (!cookies) return resultado("amazon", "cookie_ausente", { faltandoCookies: true, modo }, false);

  try {
    const url = new URL(`https://www.amazon.com.br/dp/${encodeURIComponent(asin)}`);
    url.searchParams.set("tag", tagId);
    const linkAfiliado = url.toString();

    const response = await fetch(linkAfiliado, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Cookie: cookies
      }
    });

    const html = await response.text().catch(() => "");
    const urlFinal = response.url || "";
    const lower = `${urlFinal}\n${html}`.toLowerCase();

    if (
      [401, 403, 419, 429, 503].includes(Number(response.status)) ||
      lower.includes("captcha") ||
      lower.includes("robot check") ||
      lower.includes("automated access") ||
      lower.includes("digite os caracteres")
    ) {
      return resultado("amazon", "cookie_expirado", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!response.ok) {
      return resultado("amazon", "falha_teste", { modo, httpStatus: response.status, urlFinal }, false);
    }

    if (!linkAfiliado.includes(`tag=${encodeURIComponent(tagId)}`) && !linkAfiliado.includes(`tag=${tagId}`)) {
      return resultado("amazon", "falha_teste", { modo, linkAfiliado }, false);
    }

    return resultado("amazon", "ok", { modo, linkAfiliado, httpStatus: response.status }, true);
  } catch (e) {
    return resultado("amazon", "falha_teste", { modo, erro: e.message }, false);
  }
}

function credenciaisShopee(config = {}) {
  const c = credenciais(config);
  return {
    appId: valorTexto(c, ["appId", "app_id"]),
    secret: valorTexto(c, ["secret", "appSecret", "app_secret"])
  };
}

async function testarShopee(config = {}) {
  const c = credenciaisShopee(config);
  if (!c.appId || !c.secret) {
    return resultado("shopee", "credencial_ausente", {
      faltandoAppId: !c.appId,
      faltandoSecret: !c.secret
    }, false);
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {
      query: `
        query {
          productOfferV2(keyword: "oferta", page: 1, limit: 1) {
            nodes {
              itemId
              productName
              offerLink
            }
          }
        }
      `
    };
    const payload = JSON.stringify(body);
    const sign = crypto
      .createHash("sha256")
      .update(`${c.appId}${timestamp}${payload}${c.secret}`, "utf8")
      .digest("hex");

    const response = await fetch("https://open-api.affiliate.shopee.com.br/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `SHA256 Credential=${c.appId}, Timestamp=${timestamp}, Signature=${sign}`
      },
      body: payload
    });

    const data = await response.json().catch(() => null);
    const erros = Array.isArray(data?.errors) ? data.errors : [];

    if ([401, 403].includes(Number(response.status)) || erros.length) {
      return resultado("shopee", "credencial_invalida", {
        httpStatus: response.status,
        erros
      }, false);
    }

    if (!response.ok) {
      return resultado("shopee", "falha_teste", { httpStatus: response.status, resposta: data }, false);
    }

    const nodes = data?.data?.productOfferV2?.nodes || [];
    const primeiroLink = String(nodes?.[0]?.offerLink || "").trim();
    if (!/^https?:\/\//i.test(primeiroLink)) {
      return resultado("shopee", "falha_teste", {
        motivo: "offer_link_nao_retornado",
        totalItens: Array.isArray(nodes) ? nodes.length : 0
      }, false);
    }

    return resultado("shopee", "ok", {
      httpStatus: response.status,
      totalItens: nodes.length,
      linkAfiliado: primeiroLink
    }, true);
  } catch (e) {
    return resultado("shopee", "falha_teste", { erro: e.message }, false);
  }
}

function credenciaisAwin(config = {}) {
  const c = credenciais(config);
  return {
    publisherId: valorTexto(c, ["publisherId", "publisher_id", "publisher"]),
    apiToken: valorTexto(c, ["apiToken", "api_token", "token"])
  };
}

async function testarAwin(config = {}, marketplace = "awin") {
  const c = credenciaisAwin(config);
  if (!c.publisherId || !c.apiToken) {
    return resultado(marketplace, "credencial_ausente", {
      faltandoPublisherId: !c.publisherId,
      faltandoApiToken: !c.apiToken
    }, false);
  }

  try {
    const url = new URL(`https://api.awin.com/publishers/${encodeURIComponent(c.publisherId)}/programmes`);
    url.searchParams.set("relationship", "joined");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${c.apiToken}`
      }
    });
    const data = await response.json().catch(() => null);

    if ([401, 403].includes(Number(response.status))) {
      return resultado(marketplace, "credencial_invalida", { httpStatus: response.status }, false);
    }

    if (!response.ok) {
      return resultado(marketplace, "falha_teste", { httpStatus: response.status, resposta: data }, false);
    }

    return resultado(marketplace, "ok", {
      httpStatus: response.status,
      totalProgramas: Array.isArray(data) ? data.length : 0
    }, true);
  } catch (e) {
    return resultado(marketplace, "falha_teste", { erro: e.message }, false);
  }
}

function testarAliExpress(config = {}) {
  const c = credenciais(config);
  const appKey = valorTexto(c, ["appKey", "app_key"]);
  const secret = valorTexto(c, ["secret", "appSecret", "app_secret"]);
  const trackingId = valorTexto(c, ["trackingId", "tracking_id"]);

  if (!appKey || !secret || !trackingId) {
    return resultado("aliexpress", "credencial_ausente", {
      faltandoAppKey: !appKey,
      faltandoSecret: !secret,
      faltandoTrackingId: !trackingId
    }, false);
  }

  return resultado("aliexpress", "teste_nao_implementado", {
    camposPresentes: ["appKey", "secret", "trackingId"]
  }, false);
}

async function testarIntegracaoMarketplace(clienteId = "admin", marketplace = "", integracao = {}) {
  const mp = normalizarMarketplace(marketplace);
  const config = integracao || {};

  if (!config && mp !== "kabum") {
    return resultado(mp, "credencial_ausente", { clienteId, motivo: "integracao_nao_configurada" }, false);
  }

  if (mp === "mercadolivre") return testarMercadoLivre(config);
  if (mp === "amazon") return testarAmazon(config);
  if (mp === "shopee") return testarShopee(config);
  if (mp === "awin") return testarAwin(config, "awin");
  if (mp === "kabum") return testarAwin(config, "kabum");
  if (mp === "aliexpress") return testarAliExpress(config);

  return resultado(mp, "marketplace_nao_suportado", { clienteId }, false);
}

module.exports = {
  testarIntegracaoMarketplace,
  normalizarMarketplaceIntegracaoTeste: normalizarMarketplace
};
