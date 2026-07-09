const axios = require("axios");

const resolversRegistrados = [];
const PROMOZONE_API_BASE = "https://link-shortener-501307668672.southamerica-east1.run.app";
const MARKETPLACES_PROMOZONE_PERMITIDOS = new Set(["mercadolivre", "shopee", "amazon", "aliexpress", "awin"]);

function texto(valor = "") {
  return String(valor || "").trim();
}

function hostname(url = "") {
  try {
    return new URL(texto(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function detectarMarketplaceRedirect(url = "") {
  const host = hostname(url);
  if (!host) return "";
  if (host === "meli.la" || host.endsWith(".meli.la") || host === "mercadolivre.com" || host.endsWith(".mercadolivre.com") || host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br")) return "mercadolivre";
  if (host === "shopee.com.br" || host.endsWith(".shopee.com.br")) return "shopee";
  if (host === "amazon.com.br" || host.endsWith(".amazon.com.br") || host === "amzn.to" || host.endsWith(".amzn.to")) return "amazon";
  if (host.includes("aliexpress.")) return "aliexpress";
  if (host === "kabum.com.br" || host.endsWith(".kabum.com.br")) return "awin";
  if (host === "awin1.com" || host.endsWith(".awin1.com") || host === "awin.com" || host.endsWith(".awin.com")) return "awin";
  if (host === "magazineluiza.com" || host.endsWith(".magazineluiza.com") || host === "magalu.com" || host.endsWith(".magalu.com")) return "magalu";
  return "";
}

function dominioCompativel(host = "", dominio = "") {
  return host === dominio || host.endsWith(`.${dominio}`);
}

function registrarResolverRedirect({ nome = "", dominios = [], resolver } = {}) {
  const dominiosNormalizados = [...new Set(
    (Array.isArray(dominios) ? dominios : [dominios])
      .map(item => texto(item).toLowerCase().replace(/^www\./, ""))
      .filter(Boolean)
  )];

  if (!nome || !dominiosNormalizados.length || typeof resolver !== "function") {
    throw new Error("resolver_redirect_invalido");
  }

  const registro = { nome, dominios: dominiosNormalizados, resolver };
  resolversRegistrados.push(registro);
  return registro;
}

function localizarResolverRedirect(url = "") {
  const host = hostname(url);
  if (!host) return null;
  return resolversRegistrados.find(item => item.dominios.some(dominio => dominioCompativel(host, dominio))) || null;
}

function dominioRedirectPermitido(url = "") {
  return Boolean(localizarResolverRedirect(url));
}

function urlRespostaHttp(resposta = {}, fallback = "") {
  return texto(
    resposta?.request?.res?.responseUrl ||
    resposta?.request?._redirectable?._currentUrl ||
    resposta?.config?.url ||
    fallback
  );
}

function decodificarEscapesUrl(valor = "") {
  let resultado = texto(valor)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);?/gi, (_, codigo) => String.fromCodePoint(parseInt(codigo, 16)))
    .replace(/&#(\d+);?/g, (_, codigo) => String.fromCodePoint(Number(codigo)))
    .replace(/\\u003[aA]/g, ":")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003[dD]/g, "=")
    .replace(/\\x3[aA]/g, ":")
    .replace(/\\x2[fF]/g, "/")
    .replace(/\\\//g, "/");

  for (let tentativa = 0; tentativa < 2 && /%[0-9a-f]{2}/i.test(resultado); tentativa += 1) {
    try {
      resultado = decodeURIComponent(resultado);
    } catch {
      break;
    }
  }

  return resultado.trim();
}

function urlAbsoluta(candidata = "", base = "") {
  try {
    let valor = decodificarEscapesUrl(candidata).replace(/^["'`]+|["'`]+$/g, "");
    if (!valor) return "";
    if (/^(?:www\.)?(?:[\w-]+\.)*(?:mercadolivre\.com(?:\.br)?|meli\.la|shopee\.com\.br|amazon\.com\.br|amzn\.to|aliexpress\.[a-z.]+|kabum\.com\.br|awin1?\.com)(?:\/|$)/i.test(valor)) {
      valor = `https://${valor.replace(/^www\./i, "www.")}`;
    }
    const url = new URL(valor, texto(base));
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function atributosHtml(tag = "") {
  const atributos = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(String(tag || ""))) !== null) {
    atributos[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return atributos;
}

function extrairMetaRefresh(html = "") {
  const metas = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const meta of metas) {
    const atributos = atributosHtml(meta);
    if (texto(atributos["http-equiv"]).toLowerCase() !== "refresh") continue;

    const conteudo = decodificarEscapesUrl(atributos.content || "");
    const destino = conteudo.match(/(?:^|;)\s*url\s*=\s*(?:"([^"]+)"|'([^']+)'|(.+))$/i);
    const valor = destino?.[1] || destino?.[2] || destino?.[3] || "";
    if (valor) return valor.trim();
  }
  return "";
}

function extrairWindowLocation(html = "") {
  const fonte = decodificarEscapesUrl(html);
  const padroes = [
    /(?:window\.|document\.)?location\.(?:replace|assign)\s*\(\s*(["'`])([^"'`]+)\1\s*\)/i,
    /(?:window\.|document\.)?location\.href\s*=\s*(["'`])([^"'`]+)\1/i,
    /(?:window\.|document\.)?location\s*=\s*(["'`])([^"'`]+)\1/i
  ];

  for (const padrao of padroes) {
    const destino = fonte.match(padrao)?.[2] || "";
    if (destino) return destino;
  }
  return "";
}

function urlMarketplaceUtil(url = "") {
  const marketplace = detectarMarketplaceRedirect(url);
  if (!marketplace) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return !/\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/.test(path);
  } catch {
    return false;
  }
}

function pontuarUrlMarketplace(url = "") {
  const valor = texto(url).toLowerCase();
  let pontos = 0;
  if (/\bmlb-?\d+/i.test(valor) || /meli\.la\//i.test(valor)) pontos += 5;
  if (/amazon\.com\.br\/(?:dp|gp\/product)\//i.test(valor) || /amzn\.to\//i.test(valor)) pontos += 5;
  if (/s\.shopee\.com\.br\//i.test(valor) || /shopee\.com\.br\/.*-i\.\d+\.\d+/i.test(valor)) pontos += 5;
  if (/aliexpress\.[^/]+\/(?:item|e)\//i.test(valor)) pontos += 5;
  if (/kabum\.com\.br\/produto\//i.test(valor)) pontos += 5;
  if (/awin1?\.com\//i.test(valor)) pontos += 3;
  return pontos;
}

function extrairUrlsMarketplaceHtml(html = "", base = "") {
  const fonte = decodificarEscapesUrl(html);
  const regex = /(?:(?:https?:)?\/\/|www\.)?(?:[\w-]+\.)*(?:mercadolivre\.com(?:\.br)?|meli\.la|shopee\.com\.br|amazon\.com\.br|amzn\.to|aliexpress\.[a-z.]+|kabum\.com\.br|awin1?\.com)(?:[^\s"'`<>\\)]*)/gi;
  const urls = [];

  for (const match of fonte.matchAll(regex)) {
    const url = urlAbsoluta(match[0], base);
    if (url && urlMarketplaceUtil(url) && !urls.includes(url)) urls.push(url);
  }

  return urls
    .map((url, indice) => ({ url, indice, pontos: pontuarUrlMarketplace(url) }))
    .sort((a, b) => b.pontos - a.pontos || a.indice - b.indice)
    .map(item => item.url);
}

function extrairDestinoHtml(html = "", base = "") {
  const metaRefresh = extrairMetaRefresh(html);
  const metaUrl = urlAbsoluta(metaRefresh, base);
  if (metaUrl) return { url: metaUrl, metodo: "meta_refresh" };

  const windowLocation = extrairWindowLocation(html);
  const jsUrl = urlAbsoluta(windowLocation, base);
  if (jsUrl) return { url: jsUrl, metodo: "window_location" };

  const urlSolta = extrairUrlsMarketplaceHtml(html, base)[0] || "";
  if (urlSolta) return { url: urlSolta, metodo: "html_marketplace_url" };

  return { url: "", metodo: "html_sem_redirect" };
}

function resultadoFalha(urlOriginal, dados = {}) {
  return {
    ok: false,
    urlOriginal,
    urlFinal: dados.urlFinal || "",
    urlExpandida: "",
    marketplaceDetectado: "",
    status: dados.status || "falhou",
    statusHttp: dados.statusHttp || "",
    metodo: dados.metodo || "erro_http",
    motivo: dados.motivo || "redirect_nao_resolvido",
    ...(dados.erro ? { erro: dados.erro } : {})
  };
}

function sanitizarHtmlAmostra(html = "") {
  return String(html || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT_REDACTED]")
    .replace(/([?&](?:access_?token|token|api_?key|secret|signature|auth|authorization)=)[^&\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/((?:access_?token|token|api_?key|secret|signature|authorization)["'\s]*[:=]["'\s]*)[^,"'\s<>}]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function logHtmlAmostraPromozone({ urlOriginal = "", statusHttp = "", html = "" } = {}) {
  console.log("[REDIRECT-RESOLVER-HTML-AMOSTRA]", JSON.stringify({
    urlOriginal,
    statusHttp,
    tamanhoHtml: Buffer.byteLength(String(html || ""), "utf8"),
    trechoHtmlSanitizado: sanitizarHtmlAmostra(html)
  }));
}

async function resolverHttpGenerico(urlOriginal = "", contexto = {}) {
  const httpClient = contexto.httpClient || axios;
  const timeoutTotal = Math.max(250, Number(contexto.timeout || 4500));
  const maxRedirects = Math.max(0, Number(contexto.maxRedirects || 5));
  const maxHtmlHops = Math.max(1, Math.min(3, Number(contexto.maxHtmlHops || 2)));
  const inicio = Date.now();
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  };
  let urlAtual = urlOriginal;
  let urlFinal = urlOriginal;
  let statusHttp = "";
  let metodo = "http_sem_redirect";

  try {
    for (let hop = 0; hop < maxHtmlHops; hop += 1) {
      const restante = timeoutTotal - (Date.now() - inicio);
      if (restante <= 0) throw Object.assign(new Error("redirect_timeout"), { code: "ECONNABORTED" });

      const resposta = await httpClient.get(urlAtual, {
        maxRedirects,
        timeout: restante,
        validateStatus: () => true,
        responseType: "text",
        maxContentLength: 1024 * 1024,
        maxBodyLength: 1024 * 1024,
        headers
      });

      statusHttp = resposta.status || "";
      urlFinal = urlRespostaHttp(resposta, urlAtual);
      if (urlFinal !== urlAtual) metodo = "http_redirect";

      if (Number(statusHttp) >= 400) {
        return resultadoFalha(urlOriginal, {
          urlFinal,
          statusHttp,
          metodo: "erro_http",
          motivo: `http_status_${statusHttp}`
        });
      }

      const marketplaceHttp = detectarMarketplaceRedirect(urlFinal);
      if (marketplaceHttp && urlFinal !== urlOriginal) {
        return {
          ok: true,
          urlOriginal,
          urlFinal,
          urlExpandida: urlFinal,
          marketplaceDetectado: marketplaceHttp,
          status: "resolvido",
          statusHttp,
          metodo,
          motivo: "redirect_resolvido_marketplace"
        };
      }

      const html = Buffer.isBuffer(resposta.data) ? resposta.data.toString("utf8") : String(resposta.data || "");
      if (typeof contexto.onHtml === "function") {
        try {
          contexto.onHtml({ html, urlFinal, statusHttp });
        } catch {}
      }
      const destinoHtml = extrairDestinoHtml(html, urlFinal || urlAtual);
      if (!destinoHtml.url) {
        return resultadoFalha(urlOriginal, {
          urlFinal,
          statusHttp,
          metodo: destinoHtml.metodo,
          motivo: "redirect_nao_resolvido"
        });
      }

      const marketplaceHtml = detectarMarketplaceRedirect(destinoHtml.url);
      if (marketplaceHtml) {
        return {
          ok: true,
          urlOriginal,
          urlFinal: destinoHtml.url,
          urlExpandida: destinoHtml.url,
          marketplaceDetectado: marketplaceHtml,
          status: "resolvido",
          statusHttp,
          metodo: destinoHtml.metodo,
          motivo: "redirect_resolvido_marketplace"
        };
      }

      if (!dominioRedirectPermitido(destinoHtml.url) || destinoHtml.url === urlAtual) {
        return resultadoFalha(urlOriginal, {
          urlFinal: destinoHtml.url,
          statusHttp,
          metodo: destinoHtml.metodo,
          motivo: "redirect_destino_nao_permitido"
        });
      }

      urlAtual = destinoHtml.url;
      urlFinal = destinoHtml.url;
      metodo = destinoHtml.metodo;
    }

    return resultadoFalha(urlOriginal, {
      urlFinal,
      statusHttp,
      metodo,
      motivo: "limite_redirect_html"
    });
  } catch (e) {
    const timeout = e.code === "ECONNABORTED" || /timeout/i.test(e.message || "");
    return resultadoFalha(urlOriginal, {
      urlFinal,
      statusHttp: e.response?.status || statusHttp || "",
      metodo: "erro_http",
      motivo: timeout ? "redirect_timeout" : (e.message || "redirect_bloqueado"),
      erro: e.message || ""
    });
  }
}

function codigoPromozone(url = "") {
  try {
    const partes = new URL(url).pathname.split("/").filter(Boolean);
    const codigo = partes.at(-1) || "";
    return /^[0-9A-Za-z]{6,8}$/.test(codigo) ? codigo : "";
  } catch {
    return "";
  }
}

function extrairDestinoRespostaPromozone(dados) {
  let valor = dados;
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return "";
    }
  }

  const chaves = ["destinationUrl", "destination", "target", "redirect", "url", "href", "link", "deepLink"];
  const visitados = new Set();

  function procurar(item, profundidade = 0) {
    if (!item || typeof item !== "object" || profundidade > 4 || visitados.has(item)) return "";
    visitados.add(item);

    for (const chave of chaves) {
      if (typeof item[chave] === "string" && item[chave].trim()) return item[chave];
    }
    for (const filho of Object.values(item)) {
      const encontrado = procurar(filho, profundidade + 1);
      if (encontrado) return encontrado;
    }
    return "";
  }

  return procurar(valor);
}

async function resolverPromozone(urlOriginal = "", contexto = {}) {
  const codigo = codigoPromozone(urlOriginal);
  const httpClient = contexto.httpClient || axios;
  const timeout = Math.max(250, Number(contexto.timeout || 4500));
  let falhaApi = null;

  if (codigo) {
    try {
      const urlApi = `${PROMOZONE_API_BASE}/resolve/${encodeURIComponent(codigo)}`;
      const resposta = await httpClient.get(urlApi, {
        timeout,
        maxRedirects: 2,
        validateStatus: () => true,
        responseType: "json",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RedirectResolver/1.0)",
          Accept: "application/json"
        }
      });
      const statusHttp = resposta?.status || "";
      const candidata = extrairDestinoRespostaPromozone(resposta?.data);
      const destino = urlAbsoluta(candidata, urlOriginal);
      const marketplaceDetectado = detectarMarketplaceRedirect(destino);

      if (Number(statusHttp) < 400 && destino && MARKETPLACES_PROMOZONE_PERMITIDOS.has(marketplaceDetectado)) {
        return {
          ok: true,
          urlOriginal,
          urlFinal: destino,
          urlExpandida: destino,
          marketplaceDetectado,
          status: "resolvido",
          statusHttp,
          metodo: "promozone_api",
          motivo: "promozone_api_resolvida"
        };
      }

      falhaApi = Number(statusHttp) >= 400
        ? `promozone_api_status_${statusHttp}`
        : (destino ? "promozone_api_destino_nao_permitido" : "promozone_api_sem_destino");
    } catch (e) {
      const timeoutApi = e.code === "ECONNABORTED" || /timeout/i.test(e.message || "");
      if (timeoutApi) {
        return resultadoFalha(urlOriginal, {
          metodo: "promozone_api",
          motivo: "redirect_timeout",
          erro: e.message || ""
        });
      }
      falhaApi = e.message || "promozone_api_falhou";
    }
  }

  let amostraLogada = false;
  const resultadoFallback = await resolverHttpGenerico(urlOriginal, {
    ...contexto,
    onHtml(dados) {
      if (!amostraLogada) {
        logHtmlAmostraPromozone({ urlOriginal, ...dados });
        amostraLogada = true;
      }
      if (typeof contexto.onHtml === "function") contexto.onHtml(dados);
    }
  });

  if (!resultadoFallback.ok && falhaApi && resultadoFallback.motivo === "redirect_nao_resolvido") {
    resultadoFallback.motivo = falhaApi;
  }
  return resultadoFallback;
}

async function resolverAOferta(urlOriginal = "", contexto = {}) {
  const resultado = await resolverHttpGenerico(urlOriginal, contexto);
  const pistaKabum = /-kabum\/?$/i.test(new URL(urlOriginal).pathname || "");

  if (!resultado.ok && pistaKabum && !resultado.marketplaceDetectado) {
    return {
      ...resultado,
      pistaMarketplace: "kabum",
      motivo: "aoferta_kabum_nao_resolvido"
    };
  }

  return resultado;
}

function logAuditoriaRedirect(resultado = {}, tempoMs = 0) {
  console.log("[REDIRECT-RESOLVER-AUDITORIA]", JSON.stringify({
    urlOriginal: resultado.urlOriginal || "",
    urlFinal: resultado.urlFinal || "",
    urlExpandida: resultado.urlExpandida || "",
    marketplaceDetectado: resultado.marketplaceDetectado || "",
    resolver: resultado.resolver || "",
    metodo: resultado.metodo || "",
    statusHttp: resultado.statusHttp || "",
    status: resultado.status || "",
    motivo: resultado.motivo || "",
    tempoMs: Math.max(0, Number(tempoMs || 0))
  }));
}

async function resolverRedirectUniversal(url = "", opcoes = {}) {
  const inicio = Date.now();
  const urlOriginal = texto(url);
  const registro = localizarResolverRedirect(urlOriginal);

  if (!registro) {
    const ignorado = {
      ok: false,
      urlOriginal,
      urlFinal: "",
      urlExpandida: "",
      marketplaceDetectado: "",
      resolver: "",
      metodo: "whitelist",
      statusHttp: "",
      status: "ignorado",
      motivo: "dominio_redirect_nao_permitido"
    };
    logAuditoriaRedirect(ignorado, Date.now() - inicio);
    return ignorado;
  }

  let resultado;
  try {
    resultado = await registro.resolver(urlOriginal, opcoes);
  } catch (e) {
    resultado = resultadoFalha(urlOriginal, {
      metodo: "erro_resolver",
      motivo: e.message || "resolver_falhou",
      erro: e.message || ""
    });
  }

  const final = { ...resultado, urlOriginal, resolver: registro.nome };
  logAuditoriaRedirect(final, Date.now() - inicio);
  return final;
}

registrarResolverRedirect({
  nome: "promozone",
  dominios: ["go.promozone.ai", "promozone.ai"],
  resolver: resolverPromozone
});

registrarResolverRedirect({
  nome: "aoferta",
  dominios: ["aoferta.net"],
  resolver: resolverAOferta
});

module.exports = {
  detectarMarketplaceRedirect,
  dominioRedirectPermitido,
  extrairDestinoHtml,
  extrairMetaRefresh,
  extrairUrlsMarketplaceHtml,
  extrairWindowLocation,
  listarResolversRedirect: () => resolversRegistrados.map(item => ({ nome: item.nome, dominios: [...item.dominios] })),
  localizarResolverRedirect,
  registrarResolverRedirect,
  resolverAOferta,
  resolverHttpGenerico,
  resolverPromozone,
  resolverRedirectUniversal
};
