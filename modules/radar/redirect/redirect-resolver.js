const axios = require("axios");

const resolversRegistrados = [];

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
  const valor = texto(url).toLowerCase();
  if (valor.includes("mercadolivre.com") || valor.includes("meli.la")) return "mercadolivre";
  if (valor.includes("shopee.")) return "shopee";
  if (valor.includes("amazon.") || valor.includes("amzn.to")) return "amazon";
  if (valor.includes("aliexpress.")) return "aliexpress";
  if (valor.includes("kabum.com.br")) return "awin";
  if (valor.includes("awin1.com") || valor.includes("awin.com")) return "awin";
  if (valor.includes("magazineluiza.com") || valor.includes("magalu.")) return "magalu";
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
    fallback
  );
}

function urlAbsoluta(candidata = "", base = "") {
  try {
    const url = new URL(texto(candidata), texto(base));
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function extrairMetaRefresh(html = "") {
  const metas = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const meta of metas) {
    if (!/http-equiv\s*=\s*["']?refresh["']?/i.test(meta)) continue;
    const conteudo = meta.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] ||
      meta.match(/content\s*=\s*([^\s>]+)/i)?.[1] || "";
    const destino = conteudo.match(/url\s*=\s*(.+)$/i)?.[1] || "";
    if (destino) return destino.trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function extrairWindowLocation(html = "") {
  const fonte = String(html || "");
  const padroes = [
    /(?:window\.)?location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/i,
    /(?:window\.)?location\.href\s*=\s*["']([^"']+)["']/i,
    /(?:window\.)?location\s*=\s*["']([^"']+)["']/i
  ];

  for (const padrao of padroes) {
    const destino = fonte.match(padrao)?.[1] || "";
    if (destino) return destino;
  }
  return "";
}

async function resolverHttpGenerico(urlOriginal = "", contexto = {}) {
  const httpClient = contexto.httpClient || axios;
  const timeout = Number(contexto.timeout || 4500);
  const maxRedirects = Number(contexto.maxRedirects || 5);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  };

  try {
    const resposta = await httpClient.get(urlOriginal, {
      maxRedirects,
      timeout,
      validateStatus: () => true,
      responseType: "stream",
      headers
    });

    const urlHttp = urlRespostaHttp(resposta, urlOriginal);
    let urlFinal = urlHttp;
    let metodo = urlFinal !== urlOriginal ? "http_redirect" : "http_sem_redirect";
    let marketplaceDetectado = detectarMarketplaceRedirect(urlFinal);
    let html = typeof resposta.data === "string" ? resposta.data : "";

    if (marketplaceDetectado) {
      if (resposta.data?.destroy) resposta.data.destroy();
    } else if (!html) {
      if (resposta.data?.destroy) resposta.data.destroy();
      const respostaHtml = await httpClient.get(urlOriginal, {
        maxRedirects: 0,
        timeout,
        validateStatus: () => true,
        responseType: "text",
        maxContentLength: 1024 * 1024,
        headers
      });
      html = typeof respostaHtml.data === "string" ? respostaHtml.data : "";
    }

    if (!marketplaceDetectado) {
      const metaRefresh = extrairMetaRefresh(html);
      const windowLocation = metaRefresh ? "" : extrairWindowLocation(html);
      const candidata = metaRefresh || windowLocation;
      const expandidaHtml = urlAbsoluta(candidata, urlHttp || urlOriginal);

      if (expandidaHtml) {
        urlFinal = expandidaHtml;
        metodo = metaRefresh ? "meta_refresh" : "window_location";
        marketplaceDetectado = detectarMarketplaceRedirect(urlFinal);
      }
    }

    const ok = Boolean(marketplaceDetectado && urlFinal && urlFinal !== urlOriginal);
    return {
      ok,
      urlOriginal,
      urlFinal,
      urlExpandida: ok ? urlFinal : "",
      marketplaceDetectado,
      status: ok ? "resolvido" : "falhou",
      statusHttp: resposta.status || "",
      metodo,
      motivo: ok ? "redirect_resolvido_marketplace" : "redirect_nao_resolvido"
    };
  } catch (e) {
    return {
      ok: false,
      urlOriginal,
      urlFinal: "",
      urlExpandida: "",
      marketplaceDetectado: "",
      status: "falhou",
      statusHttp: e.response?.status || "",
      metodo: "erro_http",
      motivo: e.message || "redirect_bloqueado",
      erro: e.message || ""
    };
  }
}

async function resolverRedirectUniversal(url = "", opcoes = {}) {
  const urlOriginal = texto(url);
  const registro = localizarResolverRedirect(urlOriginal);
  if (!registro) {
    return {
      ok: false,
      urlOriginal,
      urlFinal: "",
      urlExpandida: "",
      marketplaceDetectado: "",
      status: "ignorado",
      motivo: "dominio_redirect_nao_permitido"
    };
  }

  const resultado = await registro.resolver(urlOriginal, opcoes);
  return { ...resultado, resolver: registro.nome };
}

registrarResolverRedirect({
  nome: "promozone",
  dominios: ["go.promozone.ai", "promozone.ai"],
  resolver: resolverHttpGenerico
});

module.exports = {
  detectarMarketplaceRedirect,
  dominioRedirectPermitido,
  extrairMetaRefresh,
  extrairWindowLocation,
  listarResolversRedirect: () => resolversRegistrados.map(item => ({ nome: item.nome, dominios: [...item.dominios] })),
  localizarResolverRedirect,
  registrarResolverRedirect,
  resolverHttpGenerico,
  resolverRedirectUniversal
};
