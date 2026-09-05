(function publicarApi(global) {
  const API_BASE = "https://go.optimuspromo.com.br";
  const APP_BASE = "https://www.optimuspromo.com.br";

  function texto(valor) {
    return String(valor ?? "").trim();
  }

  function endpoint(path) {
    return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async function requestJson(path, opcoes) {
    const opts = opcoes || {};
    const headers = {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {})
    };
    const timeoutMs = Number(opts.timeoutMs || 0);
    const usarTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 && typeof AbortController !== "undefined";
    const controller = usarTimeout ? new AbortController() : null;
    let timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    let res;
    try {
      res = await fetch(endpoint(path), {
        method: opts.method || "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (erro) {
      if (erro?.name === "AbortError") {
        const timeoutErro = new Error("tempo_limite_esgotado");
        timeoutErro.status = 408;
        throw timeoutErro;
      }
      throw erro;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (res.status === 401) {
      const erro = new Error("sessao_expirada");
      erro.status = 401;
      erro.body = body;
      throw erro;
    }
    if (!res.ok || body?.ok === false) {
      const erro = new Error(texto(body?.motivo || body?.erro || "api_erro"));
      erro.status = res.status;
      erro.body = body;
      throw erro;
    }
    return body;
  }

  function login(user, pass) {
    return requestJson("/login", {
      method: "POST",
      body: { user: texto(user), pass: String(pass ?? "") }
    });
  }

  function me(token) {
    return requestJson("/me", { token });
  }

  function gerarPreviewCapture(token, produto) {
    return requestJson("/manual-v2/capture/ofertas", {
      method: "POST",
      token,
      body: produto,
      timeoutMs: 45000
    });
  }

  function salvarOfertaManualV2(token, oferta) {
    return requestJson("/manual-v2/ofertas", {
      method: "POST",
      token,
      body: { oferta: oferta || {} }
    });
  }

  function listarDestinosManualV2(token) {
    return requestJson(`/manual-v2/destinos?_=${Date.now()}`, { token });
  }

  function enviarAgoraManualV2(token, ofertaId, destinosIds) {
    return requestJson(`/manual-v2/ofertas/${encodeURIComponent(texto(ofertaId))}/enviar-agora`, {
      method: "POST",
      token,
      body: { destinosIds: Array.isArray(destinosIds) ? destinosIds : [] }
    });
  }

  function iniciarCaptureHandoff(payload) {
    return requestJson("/auth/capture/handoff/iniciar", {
      method: "POST",
      body: payload || {}
    });
  }

  function trocarCaptureHandoff(payload) {
    return requestJson("/auth/capture/handoff/trocar", {
      method: "POST",
      body: payload || {}
    });
  }


  const api = {
    API_BASE,
    APP_BASE,
    endpoint,
    requestJson,
    login,
    me,
    gerarPreviewCapture,
    salvarOfertaManualV2,
    listarDestinosManualV2,
    enviarAgoraManualV2,
    iniciarCaptureHandoff,
    trocarCaptureHandoff
  };
  global.OptimusCaptureApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
