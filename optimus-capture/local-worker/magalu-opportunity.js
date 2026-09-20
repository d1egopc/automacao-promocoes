(function publicarMagaluOpportunityResolver(global) {
  "use strict";

  const CAPABILITY = "magalu_opportunity_v1";
  const URL_OFICIAL = "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/";
  const TIMEOUT_MS = 8000;

  function texto(valor = "") { return String(valor ?? "").trim(); }
  function normalizarTexto(valor = "") {
    return texto(valor).replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  }
  function urlOficial(valor = "") {
    try {
      const url = new URL(texto(valor));
      return url.protocol === "https:"
        && !url.username
        && !url.password
        && !url.port
        && url.hostname.toLowerCase() === "www.magazineluiza.com.br"
        && url.pathname.replace(/\/+$/, "/") === "/selecao/ofertasdodiamundo/";
    } catch (_) { return false; }
  }
  function temChallenge(conteudo = "") {
    return /az-request-verify|captcha|challenge|akamai|robot|verifique que voce nao e um robo/i.test(normalizarTexto(conteudo));
  }
  async function verificar({ sourceUrl = URL_OFICIAL, fetchFn = global.fetch, timeoutMs = TIMEOUT_MS } = {}) {
    if (!urlOficial(sourceUrl) || texto(sourceUrl) !== URL_OFICIAL) {
      return { accessible: false, indicatorFound: false, finalUrl: "", checkedAt: new Date().toISOString(), reason: "magalu_oportunidade_url_origem_invalida" };
    }
    if (typeof fetchFn !== "function") {
      return { accessible: false, indicatorFound: false, finalUrl: "", checkedAt: new Date().toISOString(), reason: "magalu_oportunidade_fetch_indisponivel" };
    }
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    let response = null;
    try {
      const limiteMs = Math.max(1, Number(timeoutMs) || TIMEOUT_MS);
      const limite = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          const erro = new Error("magalu_oportunidade_timeout");
          erro.name = "AbortError";
          reject(erro);
        }, limiteMs);
      });
      response = await Promise.race([
        fetchFn(URL_OFICIAL, { redirect: "follow", ...(controller ? { signal: controller.signal } : {}) }),
        limite
      ]);
      const finalUrl = texto(response?.url || URL_OFICIAL);
      const checkedAt = new Date().toISOString();
      if (!urlOficial(finalUrl)) return { accessible: false, indicatorFound: false, finalUrl, checkedAt, reason: "magalu_oportunidade_url_final_invalida" };
      if (!response?.ok || Number(response.status) !== 200) return { accessible: false, indicatorFound: false, finalUrl, checkedAt, reason: `magalu_oportunidade_http_${Number(response?.status || 0)}` };
      const body = await Promise.race([response.text(), limite]);
      if (temChallenge(body)) return { accessible: false, indicatorFound: false, finalUrl, checkedAt, reason: "magalu_oportunidade_challenge" };
      return {
        accessible: true,
        indicatorFound: normalizarTexto(body).includes("ofertas do dia"),
        finalUrl,
        checkedAt
      };
    } catch (erro) {
      return {
        accessible: false,
        indicatorFound: false,
        finalUrl: urlOficial(response?.url) ? texto(response.url) : "",
        checkedAt: new Date().toISOString(),
        reason: erro?.name === "AbortError" ? "magalu_oportunidade_timeout" : "magalu_oportunidade_fetch_falhou"
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (response && !response.bodyUsed) {
        try { await response.body?.cancel?.(); } catch (_) {}
      }
    }
  }

  const resolver = { CAPABILITY, URL_OFICIAL, TIMEOUT_MS, verificar, urlOficial, temChallenge };
  global.OptimusMagaluOpportunityResolver = resolver;
  if (typeof module !== "undefined" && module.exports) module.exports = resolver;
})(typeof globalThis !== "undefined" ? globalThis : self);
