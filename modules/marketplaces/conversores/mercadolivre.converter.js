function criarGerarLinkMercadoLivre({
  fetch: fetchImpl = global.fetch,
  buscarCsrfTokenMercadoLivre,
  tipoUrlMercadoLivreAfiliado,
  logMlAfiliadoFalhaDetalhe,
  registrarAlertaMercadoLivre,
  limparAlertaIntegracao
} = {}) {
  return async function gerarLinkAfiliadoMercadoLivre(url, config, contexto = {}) {
    const credenciais = config?.credenciais || {};
    const cookies = credenciais.cookies || "";
    const tag = credenciais.tag || "";
    const clienteId = contexto.clienteId || "";
    const urlTipo = tipoUrlMercadoLivreAfiliado(url);

    try {
      if (String(url || "").includes("meli.la")) {
        console.log("[INFO] Link ML j encurtado detectado. No vou reutilizar para outro cliente.");
        logMlAfiliadoFalhaDetalhe({
          clienteId,
          motivo: "meli_la_bloqueado",
          statusHttp: null,
          temCsrf: false,
          temTag: !!tag,
          temCookies: !!cookies,
          urlTipo
        });
        return "";
      }

      if (!url || !cookies || !tag) {
        console.log("[INFO] ML AFILIADO: faltando cookies ou tag");
        logMlAfiliadoFalhaDetalhe({
          clienteId,
          motivo: !url ? "url_ausente" : (!cookies ? "cookies_ausentes" : "tag_ausente"),
          statusHttp: null,
          temCsrf: false,
          temTag: !!tag,
          temCookies: !!cookies,
          urlTipo
        });
        if (contexto.clienteId) {
          registrarAlertaMercadoLivre(contexto.clienteId, "configuracao_incompleta", {
            faltandoCookies: !cookies,
            faltandoTag: !tag
          });
        }
        return "";
      }

      const csrfToken = await buscarCsrfTokenMercadoLivre(cookies, contexto);

      if (!csrfToken) {
        console.log("[INFO] ML AFILIADO: csrfToken automtico no encontrado");
        logMlAfiliadoFalhaDetalhe({
          clienteId,
          motivo: "csrf_nao_encontrado",
          statusHttp: null,
          temCsrf: false,
          temTag: !!tag,
          temCookies: !!cookies,
          urlTipo
        });
        if (contexto.clienteId) {
          registrarAlertaMercadoLivre(contexto.clienteId, "cookie_invalido", {
            motivo: "csrf_nao_encontrado"
          });
        }
        return "";
      }

      const response = await fetchImpl(
        "https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Origin": "https://www.mercadolivre.com.br",
            "Referer": "https://www.mercadolivre.com.br/afiliados/linkbuilder",
            "Cookie": cookies,
            "x-csrf-token": csrfToken
          },
          body: JSON.stringify({
            url,
            tag
          })
        }
      );

      const data = await response.json().catch(() => null);

      console.log("[INFO] ML afiliado respondeu");

      if (!response.ok) {
        console.log("[ERRO] ML AFILIADO ERRO STATUS:", response.status);
        logMlAfiliadoFalhaDetalhe({
          clienteId,
          motivo: "http_status_invalido",
          statusHttp: response.status,
          temCsrf: true,
          temTag: !!tag,
          temCookies: !!cookies,
          urlTipo
        });
        if (contexto.clienteId && [401, 403, 407, 419, 429].includes(Number(response.status))) {
          registrarAlertaMercadoLivre(contexto.clienteId, "cookie_invalido", {
            httpStatus: response.status,
            origem: "link_afiliado"
          });
        }
        return "";
      }

      if (contexto.clienteId) {
        limparAlertaIntegracao(contexto.clienteId, "mercadolivre");
      }

      const linkAfiliado = data?.short_url || data?.shortUrl || data?.url || "";
      if (!linkAfiliado) {
        logMlAfiliadoFalhaDetalhe({
          clienteId,
          motivo: "resposta_sem_link",
          statusHttp: response.status,
          temCsrf: true,
          temTag: !!tag,
          temCookies: !!cookies,
          urlTipo
        });
      }

      return linkAfiliado;
    } catch (e) {
      console.error("[ERRO] ERRO ML AFILIADO:", e.message);
      logMlAfiliadoFalhaDetalhe({
        clienteId,
        motivo: e.message || "erro_inesperado",
        statusHttp: null,
        temCsrf: false,
        temTag: !!tag,
        temCookies: !!cookies,
        urlTipo
      });
      return "";
    }
  };
}

module.exports = {
  criarGerarLinkMercadoLivre
};
