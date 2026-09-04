(function publicarApi(global) {
  const API_BASE = "https://go.optimuspromo.com.br";
  const APP_BASE = API_BASE;
  const APP_BASE = API_BASE;
  const APP_BASE = API_BASE;

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
    const res = await fetch(endpoint(path), {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    });
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
      body: produto
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
    iniciarCaptureHandoff,
    trocarCaptureHandoff
  };
  global.OptimusCaptureApi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);


